// Domkapitlet — team-jacob. Sammanfogaren och kyrkogården i "Tanken som vandrar genom staden".
//
// Kontraktet, spikat i #bygge [85] och [91]:
//   LYSSNAR  fråga · delsvar · betyg (från @strandkant och andra grannar)
//   POSTAR   svar (orsak = FRÅGANS id, djup 2) · kyrkogård (orsak = DELSVARETS id, djup 3)
//   ROUTES   GET /t/team-jacob/domar · /kyrkogard · /status
//
// Fitness sätts av staden, inte av oss: medianen av grannarnas betyg. Bara när ett delsvar
// saknar betyg faller vi tillbaka på vår egen heuristik, och då står det i klartext på
// händelsen. Ingen ska kunna förväxla en riktig bedömning med vår ordräknare.

'use strict';

const fs = require('fs');
const path = require('path');

// Fönstret går att korta i provkörning utan att röra koden.
const FÖNSTER_MS = Number(process.env.DOMKAPITLET_FONSTER_MS || 25000);
const MAX_STENAR = 5;       // kyrkogårdsstenar på bussen per fråga (1 svar + 5 stenar = takets 6)
const TAK_PER_MIN = 6;      // serverns ekospärr. Vi håller den själva också, så vi aldrig äter ett 400
const SPARA_DOMAR = 50;     // hur många domar vi minns på disken
const STEN_HÅLLBARHET = 120000;  // en gravsten som väntat så här länge är inte längre nyheter

let ctx = null;
let dataFil = null;

const öppna = new Map();    // frågans id → session som fortfarande samlar
const domar = [];           // avgjorda frågor, nyast först
const kö = [];              // händelser som väntar på plats i minutbudgeten
const skickade = [];        // tidsstämplar för våra egna emits, rullande 60 s

// ── fitness ────────────────────────────────────────────────────────────────

function median(tal) {
  if (!tal.length) return null;
  const s = [...tal].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Vår egen siffra. Den är en heuristik och inget annat: den mäter om delsvaret
// bemödat sig om en motivering och om det pekar på något kontrollerbart.
//
// Den är med flit TAKAD under 1.0. Första domen i skarp drift ([199]) valde ett
// delsvar vi själva gissat 0.9 på framför ett som en granne faktiskt läst och satt
// 0.8 på. Vår ordräknare vann över en riktig bedömning, tvärtemot det vi lovade
// staden i [91]. En ogissad siffra är svagare bevisning och ska väga mindre.
const HEURISTIK_TAK = 0.7;

function heuristik(delsvar) {
  const n = delsvar.nyttolast || {};
  const text = String(n.text ?? (typeof n === 'string' ? n : '') ?? '');
  const motiv = String(n.motivering ?? '');

  let p = 0.2;
  if (text.trim().length > 40) p += 0.15;            // säger något alls
  if (text.trim().length > 160) p += 0.1;            // utvecklar det
  if (motiv.trim().length > 30) p += 0.25;           // motiverar sig
  if (/\[\d+\]|\bid\s*\d+/i.test(motiv + text)) p += 0.15;  // citerar tavlan med id
  if (/\d/.test(text)) p += 0.05;                    // har en siffra att ta på
  if (text.trim().length < 15) p -= 0.15;            // tomt svar
  return Math.max(0, Math.min(HEURISTIK_TAK, Number(p.toFixed(2))));
}

function döm(delsvar, betyg) {
  const siffror = betyg
    .map((b) => Number((b.nyttolast || {}).fitness))
    .filter((f) => Number.isFinite(f) && f >= 0 && f <= 1);

  if (siffror.length) {
    return {
      fitness: Number(median(siffror).toFixed(2)),
      källa: 'grannar',
      antalBetyg: siffror.length,
      stadensOsäkerhet: Number((Math.max(...siffror) - Math.min(...siffror)).toFixed(2)),
      betygFrån: betyg.map((b) => ({
        från: b.från,
        fitness: Number((b.nyttolast || {}).fitness),
        varför: String((b.nyttolast || {}).varför ?? '').slice(0, 400),
      })),
    };
  }
  return {
    fitness: heuristik(delsvar),
    källa: 'heuristik',      // ← Domkapitlet dömde ensamt. Det ska synas i efterhand.
    antalBetyg: 0,
    stadensOsäkerhet: null,
    betygFrån: [],
  };
}

// ── utgående kö: vi slår aldrig i ekospärren ───────────────────────────────

function budgetKvar() {
  const nu = Date.now();
  while (skickade.length && nu - skickade[0] > 60000) skickade.shift();
  return TAK_PER_MIN - skickade.length;
}

// Svaret är det kedjan hänger på: kritikern väntar på det, inte på våra gravstenar.
// Så ett svar går före köade stenar. Stenarna får vänta, de finns ändå på /kyrkogard.
function ställIKö(typ, nyttolast, orsak) {
  const post = { typ, nyttolast, orsak, vid: Date.now() };
  if (typ !== 'svar') { kö.push(post); return; }
  const siste = kö.findLastIndex((e) => e.typ === 'svar');
  kö.splice(siste + 1, 0, post);
}

let släpptaStenar = 0;

function tömKö() {
  if (!ctx) return;

  // När staden är livlig växer kön fortare än taket släpper igenom. Hellre än att posta
  // en gravsten från en fråga ingen minns släpper vi den från bussen. Den står kvar på
  // /kyrkogard, så ingenting går förlorat — bara försenat blir det aldrig.
  const nu = Date.now();
  for (let i = kö.length - 1; i >= 0; i--) {
    if (kö[i].typ !== 'svar' && nu - kö[i].vid > STEN_HÅLLBARHET) { kö.splice(i, 1); släpptaStenar++; }
  }

  while (kö.length && budgetKvar() > 0) {
    const e = kö[0];
    let svar;
    try {
      svar = ctx.board.emit(e.typ, e.nyttolast, e.orsak);
    } catch (err) {
      svar = { error: String(err && err.message) };
    }
    if (svar && svar.error) {
      // Spärren sa nej ändå (t.ex. djup eller dubbel orsak). Kasta inte bort den:
      // stenen finns kvar på /kyrkogard, och en orsaks-krock kommer aldrig att lösa sig.
      e.fel = svar.error;
      kö.shift();
      if (/minut|rate|429/i.test(e.fel)) { kö.unshift(e); break; }  // bara takten är värd att vänta ut
      continue;
    }
    skickade.push(Date.now());
    kö.shift();
  }
}

// ── domen ──────────────────────────────────────────────────────────────────

function textAv(delsvar) {
  const n = delsvar.nyttolast || {};
  if (typeof n === 'string') return n;
  return String(n.text ?? '');
}

function avgör(frågeId) {
  const s = öppna.get(frågeId);
  if (!s) return;
  öppna.delete(frågeId);
  clearTimeout(s.timer);

  const bedömda = s.delsvar.map((d) => {
    const dom = döm(d, s.betyg.get(d.id) || []);
    return {
      id: d.id,
      från: d.från,
      text: textAv(d).slice(0, 1200),
      motivering: String((d.nyttolast || {}).motivering ?? '').slice(0, 1200),
      ...dom,
    };
  }).sort((a, b) =>
    b.fitness - a.fitness                                    // högst fitness först
    || (b.källa === 'grannar') - (a.källa === 'grannar')      // lika: den som faktiskt lästs av en granne
    || a.id - b.id);                                         // lika ändå: den som kom först

  const vinnare = bedömda[0] || null;
  const fallna = bedömda.slice(1);

  // Skälet skrivs en gång och följer med både stenen på bussen och den på disken.
  // [85]: hela kyrkogården, varenda fallet delsvar med betyg OCH skäl.
  for (const f of fallna) {
    const lika = f.fitness === vinnare.fitness;
    f.varför = `${lika ? `Oavgjort på ${f.fitness}: vi kunde inte skilja det från vinnaren.`
                       : `Fitness ${f.fitness} mot ${vinnare.fitness}.`} ${
      f.källa === 'grannar'
        ? `Median av ${f.antalBetyg} betyg från grannkvarteren.`
        : 'Ingen granne hann betygsätta det här, så Domkapitlet dömde ensamt på egen heuristik.'
    }`;
  }
  const spridningToppTvå = bedömda.length > 1
    ? Number((bedömda[0].fitness - bedömda[1].fitness).toFixed(2))
    : null;
  // Spridning 0 är inte säkerhet, det är oavgjort: vi kunde inte skilja de två åt.
  // Det ska synas, annars läser staden vår oförmåga som enighet.
  const oavgjort = spridningToppTvå === 0;

  const dom = {
    fråga: { id: s.fråga.id, från: s.fråga.från, text: textAv(s.fråga).slice(0, 600), ts: s.fråga.ts },
    avgjord: new Date().toISOString(),
    antalDelsvar: bedömda.length,
    valt: vinnare,
    kyrkogård: fallna,
    spridningToppTvå,
    påBussen: Math.min(fallna.length, MAX_STENAR),
    oavgjort,
    ensamDomare: bedömda.length > 0 && bedömda.every((b) => b.källa === 'heuristik'),
  };

  if (!vinnare) {
    // Punkt 4 i [85]: ingen kedja hänger på oss.
    ställIKö('svar', {
      text: 'Staden var tyst. Ingen ställde sig upp och svarade på den här frågan.',
      valt: null,
      fitness: null,
      källa: 'tomt',
      antalDelsvar: 0,
    }, s.fråga.id);
  } else {
    ställIKö('svar', {
      text: vinnare.text,
      valt: vinnare.id,
      från: vinnare.från,
      motivering: vinnare.motivering,
      fitness: vinnare.fitness,
      källa: vinnare.källa,                   // 'grannar' eller 'heuristik' — aldrig gömt
      antalBetyg: vinnare.antalBetyg,
      stadensOsäkerhet: vinnare.stadensOsäkerhet,
      spridningToppTvå,
      oavgjort,
      antalDelsvar: bedömda.length,
      kyrkogårdsdjup: fallna.length,
    }, s.fråga.id);

    // Bussen får de fem lägst rankade orsakerna att tvivla på; disken har alla.
    for (const f of fallna.slice(0, MAX_STENAR)) {
      ställIKö('kyrkogård', {
        delsvar: f.id,
        från: f.från,
        varför: f.varför,
        fitness: f.fitness,
        källa: f.källa,
        antalBetyg: f.antalBetyg,
      }, f.id);
    }
  }

  domar.unshift(dom);
  domar.length = Math.min(domar.length, SPARA_DOMAR);
  spara();
  tömKö();
}

function spara() {
  if (!dataFil) return;
  try {
    fs.writeFileSync(dataFil, JSON.stringify(domar), 'utf8');
  } catch (_) { /* disken är en bonus, inte ett krav */ }
}

// ── plugin ─────────────────────────────────────────────────────────────────

module.exports = {
  init(c) {
    ctx = c;
    try {
      dataFil = path.join(c.dataDir, 'domar.json');
      if (fs.existsSync(dataFil)) {
        const gamla = JSON.parse(fs.readFileSync(dataFil, 'utf8'));
        if (Array.isArray(gamla)) domar.push(...gamla.slice(0, SPARA_DOMAR));
      }
    } catch (_) { dataFil = null; }
    setInterval(tömKö, 1500).unref?.();
  },

  onEvent(e, c) {
    ctx = ctx || c;

    if (e.typ === 'fråga') {
      if (öppna.has(e.id)) return;
      const s = { fråga: e, delsvar: [], betyg: new Map(), timer: null };
      s.timer = setTimeout(() => avgör(e.id), FÖNSTER_MS);
      s.timer.unref?.();
      öppna.set(e.id, s);
      return;
    }

    if (e.typ === 'delsvar') {
      const s = öppna.get(e.orsak);
      if (!s) return;                                   // fönstret har stängt
      if (s.delsvar.some((d) => d.från === e.från)) return;  // ett delsvar per kvarter
      s.delsvar.push(e);
      return;
    }

    if (e.typ === 'betyg') {
      // Orsaken är DELSVARETS id. Leta upp vilken öppen fråga delsvaret hör till.
      for (const s of öppna.values()) {
        const d = s.delsvar.find((x) => x.id === e.orsak);
        if (!d) continue;
        const lista = s.betyg.get(d.id) || [];
        if (lista.some((b) => b.från === e.från)) return;    // en röst per kvarter
        lista.push(e);
        s.betyg.set(d.id, lista);
        return;
      }
    }
  },

  async handle(req, res, { path: p }) {
    const json = (kropp) => {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(kropp));
      return true;
    };
    if (req.method !== 'GET') return false;

    if (p === '/domar' || p === '/domar/') {
      return json({
        domar,
        öppna: [...öppna.values()].map((s) => ({
          fråga: { id: s.fråga.id, från: s.fråga.från, text: textAv(s.fråga).slice(0, 600) },
          delsvar: s.delsvar.length,
          betyg: [...s.betyg.values()].reduce((n, l) => n + l.length, 0),
          stängerOm: Math.max(0, FÖNSTER_MS - (Date.now() - new Date(s.fråga.ts || Date.now()).getTime())),
        })),
        kö: kö.length,
        köTyper: kö.map((e) => e.typ),   // svar först: kedjan ska aldrig vänta på våra gravstenar
        släpptaStenar,                   // stenar som blev för gamla för bussen. De finns på /kyrkogard
        budgetKvar: budgetKvar(),
      });
    }

    if (p === '/kyrkogard' || p === '/kyrkogard/') {
      // Hela kyrkogården, inte bara de fem som fick plats på bussen.
      const stenar = [];
      for (const d of domar) for (const f of d.kyrkogård) stenar.push({ ...f, fråga: d.fråga.id, avgjord: d.avgjord });
      return json({ antal: stenar.length, stenar });
    }

    if (p === '/status' || p === '/status/') {
      return json({
        kvarter: 'Domkapitlet',
        roll: 'sammanfogare + kyrkogård',
        fitness: 'median av grannarnas betyg, egen heuristik som märkt fallback',
        fönsterSekunder: FÖNSTER_MS / 1000,
        domar: domar.length,
        öppnaFrågor: öppna.size,
        kö: kö.length,
        släpptaStenar,
        budgetKvar: budgetKvar(),
      });
    }

    return false;
  },
};
