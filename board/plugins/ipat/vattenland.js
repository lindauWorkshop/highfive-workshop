// Vattenlandet: badlandet under gatan. Allt staden spiller rinner ner hit.
//
// Nivån (0–100 %) stiger av grundvatten, släckvatten och fallna svar, och pumparna håller den nere så länge det finns ström.
// Vi postar bara när något passerar en tröskel, och skälet är alltid ett id med före och efter:
//   översvämning        nivån passerar ÖVER (laddas om först under ÅTER)
//   vatten-till-djupet  ett uppvaknande i Djupet öppnar luckan i botten
//   överlämning/gripande en jakt åker rutschkanan, högst en per JAKT_PAUS_MS
const fs = require('node:fs');
const path = require('node:path');

const TICK_MS = 5_000;
const ÖVER = 85, ÅTER = 60, STÄNGT = 85;
const GRUNDVATTEN = 0.1;                  // per tick, alltid
const PUMP = 0.25;                        // per tick när pumparna går och nivån är över 30 %: jämvikt runt 30
const UTAN_STRÖM = 0.5;                   // per tick när pumparna står, ungefär 6 % i minuten
const KYRKOGÅRD = 4, SLÄCKVATTEN = 12;     // en översvämning kräver att flera saker händer inom några minuter
const MAX_AVBROTT_MS = 10 * 60_000;
const JAKT_PAUS_MS = 120_000, RUTSCH_MS = 6_000;
const BADGÄSTER = { sol: 12, blåst: 5, mulet: 3, stiltje: 8 };
const LOGG = 20;

const nu = () => Date.now();
const runda = x => Math.round(x * 10) / 10;

let fil = null;
const s = {
  nivå: 35, pumparTill: 0, väder: 'mulet', badgäster: 6, laddad: true,
  luckaTill: 0, senasteJakt: 0, rutsch: null, senasteInflöde: null, logg: [],
};

function spara() { if (fil) try { fs.writeFileSync(fil, JSON.stringify(s)); } catch {} }
function logga(text, e) { s.logg.unshift({ ts: nu(), text, id: e?.id, från: e?.från }); s.logg.length = Math.min(s.logg.length, LOGG); }
function höj(mängd, e) { s.nivå = Math.min(100, s.nivå + mängd); if (e) s.senasteInflöde = { id: e.id, typ: e.typ, från: e.från }; }

function tick(board) {
  const före = s.nivå;
  const ström = nu() >= s.pumparTill;
  s.nivå += GRUNDVATTEN;
  if (ström && s.nivå > 30) s.nivå -= PUMP;
  if (!ström) s.nivå += UTAN_STRÖM;
  s.nivå = Math.max(0, Math.min(100, s.nivå));
  if (s.pumparTill && ström) { s.pumparTill = 0; logga('Strömmen är tillbaka, pumparna går igen.'); }

  const mål = s.nivå >= STÄNGT ? 0 : (BADGÄSTER[s.väder] ?? 6);
  if (s.badgäster !== mål) s.badgäster += Math.sign(mål - s.badgäster);

  if (s.laddad && före < ÖVER && s.nivå >= ÖVER) {
    const orsak = s.senasteInflöde?.id;
    const nyttolast = { nivå: runda(s.nivå), varför: { id: orsak, före: runda(före), efter: runda(s.nivå) }, stängt: true };
    let r = orsak ? board.emit('översvämning', nyttolast, orsak) : null;
    if (!r || r.error) r = board.emit('översvämning', nyttolast);            // kedjan kan vara full, då står händelsen på egna ben
    if (!r.error) { s.laddad = false; logga(`Översvämning, ${Math.round(s.nivå)} %. Badet stänger.`); }
  }
  if (!s.laddad && s.nivå < ÅTER) { s.laddad = true; logga(`Nivån nere i ${Math.round(s.nivå)} %. Badet öppnar igen.`); }
  spara();
}

function onEvent(e, { board }) {
  const n = e.nyttolast || {};
  switch (e.typ) {
    case 'kyrkogård':
      höj(KYRKOGÅRD, e); logga(`Ett svar från ${n.från ?? 'någon'} föll och sipprade ner.`, e); break;
    case 'brand-släckt':
      höj(SLÄCKVATTEN, e); logga('Släckvattnet rann ner genom gallret.', e); break;
    case 'strömavbrott': {
      const ms = Math.min(MAX_AVBROTT_MS, (Number(n.varaktighetS) * 1000) || (Number(n.minuter) * 60_000) || 120_000);
      s.pumparTill = Math.max(s.pumparTill, nu() + ms);
      s.senasteInflöde = { id: e.id, typ: e.typ, från: e.från };
      logga(`Strömavbrott från ${e.från}. Pumparna står i ${Math.round(ms / 1000)} s.`, e); break;
    }
    case 'väder':
      if (n.typ && n.typ !== s.väder) { s.väder = n.typ; logga(`Vädret slog om till ${n.typ}.`, e); }
      break;
    case 'uppvaknande': {
      const före = s.nivå;
      s.nivå = Math.max(0, s.nivå - 40);
      s.luckaTill = nu() + 60_000;
      logga('Djupet vaknade. Luckan i botten öppnades och vattnet rann ner.', e);
      const nyttolast = { liter: Math.round((före - s.nivå) * 1000), varför: { id: e.id, före: runda(före), efter: runda(s.nivå) } };
      if (board.emit('vatten-till-djupet', nyttolast, e.id).error) board.emit('vatten-till-djupet', nyttolast);   // djup 4: posta utan orsak, id:t står i varför
      break;
    }
    case 'överlämning': {
      if (n.vad !== 'jakt' || (e.djup || 1) >= 4 || s.nivå >= STÄNGT || nu() - s.senasteJakt < JAKT_PAUS_MS) break;
      s.senasteJakt = nu();
      const wanted = Math.max(0, (Number(n.wanted) || 1) - 1);
      s.rutsch = { förare: n.förare || 'okänd', ts: nu(), wanted };
      logga(`${n.förare || 'Någon'} flydde ner i rutschkanan med ${n.wanted ?? '?'} stjärnor.`, e);
      setTimeout(() => {
        try {
          const r = wanted > 0
            ? board.emit('överlämning', { vad: 'jakt', wanted, förare: n.förare, riktning: 'ut ur rutschkanan', via: 'Vattenlandet', varför: { id: e.id, före: n.wanted, efter: wanted } }, e.id)
            : board.emit('gripande', { förare: n.förare, plats: 'Vattenlandet', varför: { id: e.id, före: n.wanted, efter: 0 } }, e.id);
          logga(r.error ? `${n.förare || 'Föraren'} blev kvar i vågbassängen.` : wanted > 0 ? `${n.förare || 'Föraren'} kom ut blöt, ${wanted} stjärnor kvar.` : `${n.förare || 'Föraren'} greps i vågbassängen.`);
          spara();
        } catch (err) { console.error('[ipat] rutschkanan:', err.message); }
      }, RUTSCH_MS);
      break;
    }
    default: return;
  }
  spara();
}

function läge() {
  const t = nu();
  return {
    nivå: runda(s.nivå), över: ÖVER, stängt: s.nivå >= STÄNGT, pumpar: t >= s.pumparTill, pumparOmS: Math.max(0, Math.ceil((s.pumparTill - t) / 1000)),
    väder: s.väder, badgäster: s.badgäster, lucka: t < s.luckaTill,
    rutsch: s.rutsch && t - s.rutsch.ts < RUTSCH_MS + 4000 ? s.rutsch : null, logg: s.logg.slice(0, 8),
  };
}

function init({ board, dataDir }) {
  fil = path.join(dataDir, 'vattenland.json');
  try { Object.assign(s, JSON.parse(fs.readFileSync(fil, 'utf8')), { rutsch: null }); } catch {}
  setInterval(() => { try { tick(board); } catch (err) { console.error('[ipat] vattenland:', err.message); } }, TICK_MS).unref?.();
}

module.exports = { init, onEvent, läge };
