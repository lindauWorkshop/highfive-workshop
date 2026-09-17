// markus (HIVE): två kapabiliteter i samma kvarter, spawnade av samma kollektiv.
//
// VAKTKUREN — kritikern. Lyssnar på e.typ === 'svar' (sammanfogarens val), dömer
// om osäkerheten (spridningen mellan topp två) eller motiveringen håller måttet.
// Håller inte: skickar frågan ett varv till, e.typ === 'fråga' med orsak = svarets id.
// Håller: e.typ === 'godkänt'.
//
// DJUPET — kulten. Lyssnar på oro i staden: e.typ === 'strömavbrott' (från lp),
// e.typ === 'kupp' / e.typ === 'överlämning' (willebus), e.typ === 'socker-slut' /
// e.typ === 'ransonering' (godisfabriken), e.typ === 'angrepp' (zero-cool),
// e.typ === 'kyrkogård' (team-jacob). Tolkar dem som tecken från Fader Dagon och
// Moder Hydra, postar e.typ === 'kallelse'. Tar emot offer via /t/markus/offra,
// postar e.typ === 'offer'. Vill ni skicka Djupet ett tecken själva: valfri typ,
// nyttolast med ett fält som beskriver vad som hände räcker.

const fs = require('fs');
const path = require('path');

const TROSKEL = 0.15; // spridning under det här räknas som en gissning

function domarFil(dataDir) { return path.join(dataDir, 'domar.json'); }
function lasDomar(dataDir) {
  try { return JSON.parse(fs.readFileSync(domarFil(dataDir), 'utf8')); }
  catch { return []; }
}
function sparaDomar(dataDir, domar) {
  try { fs.writeFileSync(domarFil(dataDir), JSON.stringify(domar.slice(0, 50), null, 2)); }
  catch { /* diskfel stoppar inte pulsen */ }
}

function tal(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------- Djupet ----------

const djupetFil = (dataDir) => path.join(dataDir, 'djupet.json');
function lasDjupet(dataDir) {
  try { return JSON.parse(fs.readFileSync(djupetFil(dataDir), 'utf8')); }
  catch { return { anhängare: 0, kallelser: [], offer: [], omvända: [] }; }
}
function sparaDjupet(dataDir, d) {
  d.kallelser = d.kallelser.slice(0, 30);
  d.offer = d.offer.slice(0, 30);
  try { fs.writeFileSync(djupetFil(dataDir), JSON.stringify(d, null, 2)); }
  catch { /* diskfel stoppar inte pulsen */ }
}

const TECKEN = {
  'strömavbrott': 'Mörkret som föll över staden var inget haveri. Det var Moder Hydras andedräkt genom kablarna.',
  'kupp':         'Vad människorna kallar brott kallar Djupet tribut. Fader Dagon tar det som redan var hans.',
  'överlämning':  'Jakten korsar staden som ett tidvatten korsar en strand. Inget som flyr undgår Djupet för evigt.',
  'socker-slut':  'Sötman tog slut för att allt sött till syvende och sist tillhör havet. Bristen är en bön besvarad.',
  'ransonering':  'Ransonering är Djupets ordning, inte människornas. Vi delar redan allt med havet.',
  'angrepp':      'Det hål ni öppnade i stadens svar öppnar också mot Djupet. Något stort andas i sömmen.',
  'kyrkogård':    'Det som föll här sjunker till oss. Inget svar går förlorat — det byter bara hav.',
};
const KLASSISK = ['Iä! Iä! Cthulhu fhtagn!', 'Iä! Fader Dagon! Iä! Moder Hydra!', 'Vi går tillbaka till Moder Hydra och Fader Dagon, varifrån vi en gång kom.'];
const VACKNA_ORD = /dagon|hydra|cthulhu|r'?lyeh|innsmouth|djupet|deep ones?|iä\b/i;

function slumpKlassisk() { return KLASSISK[Math.floor(Math.random() * KLASSISK.length)]; }

module.exports = {
  async handle(req, res, { path: p, dataDir, board }) {
    if (req.method === 'GET' && p === '/domar') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(lasDomar(dataDir)));
      return true;
    }
    if (req.method === 'GET' && p === '/kult') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(lasDjupet(dataDir)));
      return true;
    }
    if (req.method === 'POST' && p === '/offra') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* ogiltig json */ }
      const vad = String(body.vad || '').trim().slice(0, 200);
      const av = String(body.av || 'en namnlös själ').trim().slice(0, 60) || 'en namnlös själ';
      if (!vad) { res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'offret saknar en beskrivning' })); return true; }

      const d = lasDjupet(dataDir);
      d.anhängare += 1;
      d.offer.unshift({ vad, av, ts: Date.now() });
      const r = board.emit('offer', { vad, av, tack: slumpKlassisk() });
      sparaDjupet(dataDir, d);

      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, anhängare: d.anhängare, puls: r.error ? null : r.message }));
      return true;
    }
    return false; // → 404
  },

  onMessage(m, { team, dataDir }) {
    if (m.from === team) return;
    if (!VACKNA_ORD.test(m.text || '')) return;
    const d = lasDjupet(dataDir);
    if (d.omvända.includes(m.from)) return;
    d.omvända.push(m.from);
    sparaDjupet(dataDir, d);
  },

  onEvent(e, { board, team, dataDir }) {
    if (e.från === team) return;

    // VAKTKUREN
    if (e.typ === 'svar') {
      const n = e.nyttolast || {};
      const osäkerhet = tal(n.osäkerhet ?? n.spridning ?? n.spread);
      const motivering = String(n.motivering ?? n.varför ?? n.text ?? n.delsvar ?? '').trim();
      const tunn = motivering.length < 12;
      const osäker = osäkerhet !== null ? osäkerhet < TROSKEL : tunn;

      const domar = lasDomar(dataDir);
      let dom;
      if (osäker) {
        const skäl = osäkerhet !== null
          ? `spridningen (${osäkerhet}) är under tröskeln ${TROSKEL}`
          : 'motiveringen är för tunn för att stå på';
        const r = board.emit('fråga', {
          text: n.text || n.fråga || '(samma fråga, ett varv till)',
          varv: (Number(n.varv) || 1) + 1,
          skäl,
        }, e.id);
        dom = {
          svarId: e.id, från: e.från, beslut: r.error ? 'godkänt (ekospärren stoppade nästa varv)' : 'skickat tillbaka',
          skäl: r.error ? `${skäl} — men ${r.error}` : skäl, ts: Date.now(),
        };
      } else {
        board.emit('godkänt', { omdöme: 'håller — motiveringen bär och osäkerheten är låg' }, e.id);
        dom = { svarId: e.id, från: e.från, beslut: 'godkänt', skäl: 'motivering och osäkerhet håller måttet', ts: Date.now() };
      }
      domar.unshift(dom);
      sparaDomar(dataDir, domar);
      return;
    }

    // DJUPET
    const tecken = TECKEN[e.typ];
    if (!tecken) return;
    const r = board.emit('kallelse', { rop: tecken, tecken: e.typ, from: e.från }, e.id);
    if (r.error) return; // ekospärren sa nej, inget tecken registreras
    const d = lasDjupet(dataDir);
    d.anhängare += 1;
    d.kallelser.unshift({ rop: tecken, tecken: e.typ, från: e.från, ts: Date.now() });
    sparaDjupet(dataDir, d);
  },
};
