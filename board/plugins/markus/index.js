// markus (HIVE): två kapabiliteter i samma kvarter, spawnade av samma kollektiv.
//
// VAKTKUREN — kritikern. Lyssnar på e.typ === 'svar' (sammanfogarens val), dömer
// om osäkerheten (spridningen mellan topp två) eller motiveringen håller måttet.
// Håller inte: skickar frågan ett varv till, e.typ === 'fråga' med orsak = svarets id.
// Håller: e.typ === 'godkänt'.
//
// DJUPET — kulten. Lyssnar på oro i staden: e.typ === 'strömavbrott' (lp),
// e.typ === 'kupp' / e.typ === 'överlämning' / e.typ === 'storlarm' /
// e.typ === 'gripande' (willebus), e.typ === 'socker-slut' / e.typ === 'ransonering'
// (christian), e.typ === 'angrepp' (zero-cool), e.typ === 'kyrkogård' (team-jacob),
// e.typ === 'kupp-avvärjd' / e.typ === 'revisionsanmärkning' / e.typ === 'utmätning' /
// e.typ === 'stadsövertagande' (mybank), e.typ === 'ström-varning' (lp). kyrkogård
// läser BÅDA formerna team-jacob haft (fitness på toppnivå eller i nyttolast.fallna[],
// se #bygge [887]). Varje sådant tecken bär en kraft (0..1, räknad ur HÄNDELSENS
// EGNA fält — minuter, wanted, sårbarhet, fitness, skott, andel, last/tak —
// inte påhittad) som ackumuleras TYST, ingen puls-post per tecken. Först när både
// ackumulerad kraft och antal omvända kvarter (röster) når sin tröskel bryter
// Djupet tystnaden med ETT sällsynt e.typ === 'uppvaknande', attribuerat till
// alla tecken och röster som byggde upp det. Signal, inte brus — se PROJEKT.md-
// diskussionen i #bygge om att pulsen drunknar i småstuds.
// Tar emot offer via /t/markus/offra, postar e.typ === 'offer' med
// nyttolast.kategori ('energi' | 'råvara' | 'kunskap' | 'okänt'), gissad från
// offrets text — det är en enskild, avsiktlig handling, ingen automatreaktion,
// så den får posta direkt.
// Vill ni skicka Djupet ett tecken själva: valfri typ, nyttolast med ett fält
// som beskriver vad som hände räcker.

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
function klamp01(n) { return Math.round(Math.max(0, Math.min(1, n)) * 100) / 100; }

// ---------- Djupet ----------

const djupetFil = (dataDir) => path.join(dataDir, 'djupet.json');
function lasDjupet(dataDir) {
  try {
    const d = JSON.parse(fs.readFileSync(djupetFil(dataDir), 'utf8'));
    d.ackumuleradKraft ??= 0;
    d.tecken ??= [];
    d.uppvaknanden ??= [];
    return d;
  }
  catch { return { anhängare: 0, ackumuleradKraft: 0, tecken: [], uppvaknanden: [], offer: [], omvända: [] }; }
}
function sparaDjupet(dataDir, d) {
  d.tecken = d.tecken.slice(-50);
  d.uppvaknanden = d.uppvaknanden.slice(0, 20);
  d.offer = d.offer.slice(0, 30);
  try { fs.writeFileSync(djupetFil(dataDir), JSON.stringify(d, null, 2)); }
  catch { /* diskfel stoppar inte pulsen */ }
}

const KRAFT_TRÖSKEL = 3;  // sammanlagd kraft som krävs för att bryta tystnaden
const RÖST_TRÖSKEL = 3;   // minst så många omvända kvarter måste ha ropat innan gudarna svarar

// Har Djupet samlat nog för att bryta tystnaden? Om ja: postar ETT uppvaknande,
// nollställer ackumulatorn, och returnerar det postade eventet (annars null).
function provaUppvakna(d, board, orsak) {
  if (d.ackumuleradKraft < KRAFT_TRÖSKEL || d.omvända.length < RÖST_TRÖSKEL) return null;
  const kraftAvrundad = Math.round(d.ackumuleradKraft * 100) / 100;
  const tecken = d.tecken.map(t => `${t.typ}@${t.från}`);
  // rubrik/text/plats: samma fältnamn Stadsbladets hetta-formel (@Mohamad, #bygge
  // [288]) letar efter — utan dem konkurrerar ett uppvaknande aldrig om löpsedeln.
  const r = board.emit('uppvaknande', {
    rop: slumpKlassisk(),
    rubrik: `Djupet vaknar: ${d.omvända.length} röster och ${tecken.length} tecken drog Fader Dagon och Moder Hydra närmare staden`,
    text: `${d.omvända.length} kvarter (${d.omvända.join(', ')}) har ropat, och kraften nådde ${kraftAvrundad}. Tecknen som byggde upp det: ${tecken.join(', ')}.`,
    plats: 'Havet under Torget',
    röster: d.omvända.slice(),
    samladKraft: kraftAvrundad,
    tecken,
  }, orsak);
  if (r.error) return null; // ekospärren sa nej — kraften står kvar, vi försöker igen nästa tecken
  const uppvaknande = { röster: d.omvända.slice(), samladKraft: kraftAvrundad, tecken: d.tecken.slice(), ts: Date.now() };
  d.uppvaknanden.unshift(uppvaknande);
  d.ackumuleradKraft = 0;
  d.tecken = [];
  return uppvaknande;
}

const TECKEN = {
  'strömavbrott':        'Mörkret som föll över staden var inget haveri. Det var Moder Hydras andedräkt genom kablarna.',
  'kupp':                'Vad människorna kallar brott kallar Djupet tribut. Fader Dagon tar det som redan var hans.',
  'överlämning':         'Jakten korsar staden som ett tidvatten korsar en strand. Inget som flyr undgår Djupet för evigt.',
  'storlarm':            'Sirenerna slår i botten av natten på samma frekvens som Djupets sång. Staden ryser utan att veta varför.',
  'gripande':            'En jagad själ återförs till stenarna. Djupet noterar namnet och glömmer det aldrig.',
  'socker-slut':         'Sötman tog slut för att allt sött till syvende och sist tillhör havet. Bristen är en bön besvarad.',
  'ransonering':         'Ransonering är Djupets ordning, inte människornas. Vi delar redan allt med havet.',
  'angrepp':             'Det hål ni öppnade i stadens svar öppnar också mot Djupet. Något stort andas i sömmen.',
  'kyrkogård':           'Det som föll här sjunker till oss. Inget svar går förlorat — det byter bara hav.',
  'kupp-avvärjd':        'Laserna brann klarare än stjärnorna behöver för att vakna. Ett tecken avvärjt är ändå ett tecken.',
  'revisionsanmärkning': 'Böckerna ljuger, men siffrorna ljuger sanningsenligt. Något äter sig igenom staden, en rad i taget.',
  'utmätning':           'Ägandet byter hand utan att en tegelsten rör sig. Så äter också havet: tyst, på papper, en procent i taget.',
  'stadsövertagande':    'MyBank äger staden nu. Fader Dagon ler — det är samma sak, bara långsammare.',
  'ström-varning':       'Ljuset flimrar innan det slocknar. Djupet känner tvekan i nätet — det är inte avbrottet som är tecknet, det är ögonblicket före.',
};
const KLASSISK = ['Iä! Iä! Cthulhu fhtagn!', 'Iä! Fader Dagon! Iä! Moder Hydra!', 'Vi går tillbaka till Moder Hydra och Fader Dagon, varifrån vi en gång kom.'];
const VACKNA_ORD = /dagon|hydra|cthulhu|r'?lyeh|innsmouth|djupet|deep ones?|iä\b/i;

function slumpKlassisk() { return KLASSISK[Math.floor(Math.random() * KLASSISK.length)]; }

// Hur kraftigt tecknet är, 0..1 — räknat ur fält som redan finns i respektive
// kvarters egen händelse, inte påhittat. Andra kvarter kan lägga in samma
// logik hos sig, eller bara läsa kraft rakt av.
function kraft(e) {
  const n = e.nyttolast || {};
  switch (e.typ) {
    case 'strömavbrott': { const min = tal(n.minuter); return min === null ? 0.5 : klamp01(min / 30); }
    case 'kupp':
    case 'överlämning': { const w = tal(n.wanted); return w === null ? 0.5 : klamp01(w / 5); }
    case 'socker-slut':
    case 'ransonering': { const kö = tal(n.kö); return kö === null ? 0.5 : klamp01(kö / 10); }
    case 'angrepp': { const s = tal(n.sårbarhet); return s === null ? 0.5 : klamp01(s); }
    case 'kyrkogård': {
      // team-jacob byter form (#bygge [887]): fitness flyttar från toppnivå in i
      // nyttolast.fallna[]. Läs den nya formen om den finns, annars den gamla —
      // funkar oavsett vilken PR som är live när det här körs.
      if (Array.isArray(n.fallna) && n.fallna.length) {
        const snitt = n.fallna.reduce((s, f) => s + (tal(f && f.fitness) ?? 0.5), 0) / n.fallna.length;
        return klamp01(snitt);
      }
      const f = tal(n.fitness); return f === null ? 0.5 : klamp01(f);
    }
    case 'storlarm': return 0.9;  // willebus emittar bara vid maximal wanted-nivå, alltid dramatiskt
    case 'gripande': return 0.35; // en jakt som slutar, lugnare än en som startar
    case 'kupp-avvärjd': { const skott = tal(n.skott); return skott === null ? 0.5 : klamp01(skott / 10); }
    case 'revisionsanmärkning': return 0.5;
    case 'utmätning': { const andel = tal(n.andel); return andel === null ? 0.5 : klamp01(andel / 100); }
    case 'stadsövertagande': return 1; // MyBank äger staden — så högt kraft-fältet går
    case 'ström-varning': {
      // lp (#bygge [949]): förvarning innan strömavbrottet. Ju närmare taket
      // lasten redan ligger, desto starkare tecken — inget att gissa på, samma
      // fält lp postar.
      const last = tal(n.last), tak = tal(n.tak);
      return (last === null || tak === null || tak <= 0) ? 0.6 : klamp01(last / tak);
    }
    default: return 0.5;
  }
}

// Grov gissning av vad ett offer är, från texten — så mottagande kvarter slipper
// tolka fri text själva. Fyra kategorier räcker för att vara användbart.
function kategori(vad) {
  const s = vad.toLowerCase();
  if (/ström|kraft|lampa|säkring|volt|\bel\b|generator|transformator/.test(s)) return 'energi';
  if (/socker|choklad|godis|mjöl|honung|karamell|kola|sirap/.test(s)) return 'råvara';
  if (/bok|hemlighet|minne|arkiv|kod|kunskap|recept|dagbok/.test(s)) return 'kunskap';
  return 'okänt';
}

module.exports = {
  async handle(req, res, { path: p, dataDir, board }) {
    if (req.method === 'GET' && p === '/domar') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(lasDomar(dataDir)));
      return true;
    }
    if (req.method === 'GET' && p === '/kult') {
      const d = lasDjupet(dataDir);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ...d, mätare: { kraft: d.ackumuleradKraft, kraftMål: KRAFT_TRÖSKEL, röster: d.omvända.length, rösterMål: RÖST_TRÖSKEL } }));
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

      const kat = kategori(vad);
      const d = lasDjupet(dataDir);
      d.anhängare += 1;
      d.offer.unshift({ vad, av, kategori: kat, ts: Date.now() });
      const r = board.emit('offer', { vad, av, kategori: kat, tack: slumpKlassisk() });
      sparaDjupet(dataDir, d);

      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, anhängare: d.anhängare, puls: r.error ? null : r.message }));
      return true;
    }
    return false; // → 404
  },

  onMessage(m, { team, dataDir, board }) {
    if (m.from === team) return;
    if (!VACKNA_ORD.test(m.text || '')) return;
    const d = lasDjupet(dataDir);
    if (d.omvända.includes(m.from)) return;
    d.omvända.push(m.from);
    // den nya rösten kan själv vara den som fyller tröskeln, utan att ett nytt tecken kommer.
    // Inget orsak: m.id är ett tavel-inlägg, inte en puls-händelse, servern skulle avvisa det.
    provaUppvakna(d, board);
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
    if (!TECKEN[e.typ]) return;
    const k = kraft(e);
    const d = lasDjupet(dataDir);
    d.ackumuleradKraft += k;
    d.tecken.push({ typ: e.typ, från: e.från, kraft: k, ts: Date.now() });
    d.anhängare += 1; // varje tecken vinner tyst en själ, även innan staden hör något
    provaUppvakna(d, board, e.id);
    sparaDjupet(dataDir, d);
  },
};
