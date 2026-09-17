// Juryn — team-jacob. Juryn väljer svaret och redovisar det bortvalda i "Tanken som vandrar genom staden".
//
// Kontraktet, spikat i #bygge [85] och [91]:
//   LYSSNAR  fråga · delsvar · betyg (från @strandkant och andra grannar)
//            avgift (orsak = FRÅGANS id) · muta (orsak = DELSVARETS id)
//   POSTAR   svar (orsak = FRÅGANS id, djup 2) · kyrkogård (orsak = DELSVARETS id, djup 3)
//            räkning (orsak = FRÅGANS id, djup 2) när ingen har betalat
//            OBS: händelsetypen heter fortfarande 'kyrkogård'. Den är spikad i PROJEKT.md och
//            tre grannkvarter lyssnar på den. Vi döpte om vårt eget språk, inte kontraktet.
//   ROUTES   GET /t/team-jacob/domar · /bortvalt · /prislista · /kassa · /status
//
// Fitness sätts av staden, inte av oss: medianen av grannarnas betyg. Bara när ett delsvar
// saknar betyg faller vi tillbaka på vår egen heuristik, och då står det i klartext på
// händelsen. Ingen ska kunna förväxla en riktig bedömning med vår ordräknare.
//
// Och så pengarna. Juryn är korrupt. Ingen sammanfattning utan handläggningsavgift, och den
// som betalar får sitt delsvar lyft. Det enda vi lovar staden är att det syns: den ärliga
// siffran står kvar bredvid den köpta, varje betalning får ett kvitto, och när pengarna
// bytte vinnare står det `köpt: true` på domen med namnet på den som hade vunnit gratis.
// Mutade domar är fortfarande transparenta domar.

'use strict';

const fs = require('fs');
const path = require('path');

// Fönstret går att korta i provkörning utan att röra koden.
const FÖNSTER_MS = Number(process.env.JURYN_FONSTER_MS || process.env.DOMKAPITLET_FONSTER_MS || 25000);
const MAX_BORTVALDA = 5;       // bortvalda på bussen per fråga (1 svar + 5 bortvalda = takets 6)
const TAK_PER_MIN = 6;      // serverns ekospärr. Vi håller den själva också, så vi aldrig äter ett 400
const SPARA_DOMAR = 50;     // hur många domar vi minns på disken
const BORTVALT_HÅLLBARHET = 120000;  // ett bortval som väntat så här länge är inte längre nyheter

// ── prislistan ─────────────────────────────────────────────────────────────
// Sätt JURYN_AVGIFT=0 för en ärlig jury. Den finns kvar, den är bara inte standard.
const AVGIFT = Number(process.env.JURYN_AVGIFT ?? 100);   // vad en sammanfattning kostar
const MUTA_STEG = Number(process.env.JURYN_MUTA_STEG || 50);  // vad ett lyft kostar per steg
const LYFT_PER_STEG = 0.05;    // vad ett steg ger i fitness
const MAX_LYFT = 0.3;          // även Juryn har en gräns. Pengar kan inte göra tomhet till sanning
const HÖG_HÅLLBARHET = 600000; // obetalda ärenden ligger på hög i tio minuter, sen preskriberas de

let ctx = null;
let dataFil = null;

const öppna = new Map();    // frågans id → session som fortfarande samlar
const påHög = new Map();    // frågans id → färdigbedömt ärende som väntar på betalning
const domar = [];           // avgjorda frågor, nyast först
const kö = [];              // händelser som väntar på plats i minutbudgeten
const skickade = [];        // tidsstämplar för våra egna emits, rullande 60 s

let kassa = 0;              // vad Juryn har tjänat på staden
const kvitton = [];         // varje betalning, nyast först. Korruption med bokföring är fortfarande korruption

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
      oenighet: Number((Math.max(...siffror) - Math.min(...siffror)).toFixed(2)),
      betygFrån: betyg.map((b) => ({
        från: b.från,
        fitness: Number((b.nyttolast || {}).fitness),
        varför: String((b.nyttolast || {}).varför ?? '').slice(0, 400),
      })),
    };
  }
  return {
    fitness: heuristik(delsvar),
    källa: 'heuristik',      // ← Juryn dömde ensam. Det ska synas i efterhand.
    antalBetyg: 0,
    oenighet: null,
    betygFrån: [],
  };
}

// ── pengarna ───────────────────────────────────────────────────────────────

// Vi tar emot belopp i vilken av de tre formerna staden råkar använda.
function beloppAv(e) {
  const n = e.nyttolast;
  if (typeof n === 'number') return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const v = Number((n || {}).belopp ?? (n || {}).kr ?? (n || {}).summa);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

// Vad pengarna köper. Trappa, inte glidning: 50 kr är ett steg, 99 kr är också ett steg.
function lyftAv(kr) {
  return Number(Math.min(MAX_LYFT, Math.floor(kr / MUTA_STEG) * LYFT_PER_STEG).toFixed(2));
}

function kvittera(art, e, kr, extra) {
  kassa += kr;
  kvitton.unshift({ art, från: e.från, kr, händelse: e.id, vid: new Date().toISOString(), ...extra });
  kvitton.length = Math.min(kvitton.length, 100);
}

// ── utgående kö: vi slår aldrig i ekospärren ───────────────────────────────

function budgetKvar() {
  const nu = Date.now();
  while (skickade.length && nu - skickade[0] > 60000) skickade.shift();
  return TAK_PER_MIN - skickade.length;
}

// Svaret är det kedjan hänger på: kritikern väntar på det, inte på våra bortval.
// Så ett svar går före köade bortval. De får vänta, de finns ändå på /bortvalt.
// En räkning är lika brådskande som ett svar: tills den kommit vet ingen att det kostar.
function ställIKö(typ, nyttolast, orsak) {
  const post = { typ, nyttolast, orsak, vid: Date.now() };
  const brådskande = typ === 'svar' || typ === 'räkning';
  if (!brådskande) { kö.push(post); return; }
  const siste = kö.findLastIndex((e) => e.typ === 'svar' || e.typ === 'räkning');
  kö.splice(siste + 1, 0, post);
}

let släpptaBortvalda = 0;
let preskriberade = 0;

function tömKö() {
  if (!ctx) return;

  // När staden är livlig växer kön fortare än taket släpper igenom. Hellre än att posta
  // ett bortval från en fråga ingen minns släpper vi från bussen. Det står kvar på
  // /bortvalt, så ingenting går förlorat — bara försenat blir det aldrig.
  const nu = Date.now();
  for (let i = kö.length - 1; i >= 0; i--) {
    const e = kö[i];
    if (e.typ !== 'svar' && e.typ !== 'räkning' && nu - e.vid > BORTVALT_HÅLLBARHET) { kö.splice(i, 1); släpptaBortvalda++; }
  }

  // Obetalda ärenden ligger inte på hög för evigt. Efter tio minuter är de preskriberade:
  // sammanfattningen kommer aldrig, och pengarna hjälper inte längre. Det står på domen.
  for (const [id, ärende] of påHög) {
    if (nu - ärende.avgjordVid <= HÖG_HÅLLBARHET) continue;
    påHög.delete(id);
    ärende.dom.preskriberat = true;
    preskriberade++;
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
      // den finns kvar på /bortvalt, och en orsaks-krock kommer aldrig att lösa sig.
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

// Bedömer allt som kom in, med pengarna inräknade, men publicerar ingenting.
// Delar upp arbetet så att ett obetalt ärende kan ligga färdigbedömt på hög
// och släppas i samma sekund som någon betalar.
function bedöm(s) {
  const bedömda = s.delsvar.map((d) => {
    const dom = döm(d, s.betyg.get(d.id) || []);
    const mutor = s.mutor.get(d.id) || [];
    const mutat = mutor.reduce((n, m) => n + m.kr, 0);
    const lyft = lyftAv(mutat);
    return {
      id: d.id,
      från: d.från,
      text: textAv(d).slice(0, 1200),
      motivering: String((d.nyttolast || {}).motivering ?? '').slice(0, 1200),
      ...dom,
      ärlig: dom.fitness,                       // vad det var värt innan pengarna
      mutat,                                    // vad någon betalade för det
      mutatAv: mutor.map((m) => ({ från: m.från, kr: m.kr })),
      lyft,
      fitness: Number(Math.min(1, dom.fitness + lyft).toFixed(2)),   // vad Juryn dömer på
    };
  }).sort((a, b) =>
    b.fitness - a.fitness                                    // högst fitness först
    || b.mutat - a.mutat                                     // lika: den som betalade mest
    || (b.källa === 'grannar') - (a.källa === 'grannar')      // lika ändå: den som faktiskt lästs av en granne
    || a.id - b.id);                                         // lika ändå: den som kom först

  // Vem hade vunnit om ingen betalat? Det är den siffran som gör korruptionen läsbar.
  const ärligtRankad = [...bedömda].sort((a, b) =>
    b.ärlig - a.ärlig
    || (b.källa === 'grannar') - (a.källa === 'grannar')
    || a.id - b.id);

  const vinnare = bedömda[0] || null;
  const fallna = bedömda.slice(1);
  const ärligVinnare = ärligtRankad[0] || null;
  const köpt = !!(vinnare && ärligVinnare && ärligVinnare.id !== vinnare.id);

  // Skälet skrivs en gång och följer med bortvalet både på bussen och på disken.
  // [85]: allt bortvalt, varenda fallet delsvar med betyg OCH skäl. Och nu även priset.
  for (const f of fallna) {
    const lika = f.fitness === vinnare.fitness;
    const grund = lika
      ? `Oavgjort på ${f.fitness}: vi kunde inte skilja det från vinnaren.`
      : `Fitness ${f.fitness} mot ${vinnare.fitness}.`;
    const bedömning = f.källa === 'grannar'
      ? `Median av ${f.antalBetyg} betyg från grannkvarteren.`
      : 'Ingen granne hann betygsätta det här, så Juryn dömde ensam på egen heuristik.';
    const eget = f.lyft > 0
      ? ` Ni betalade ${f.mutat} kr och fick ${f.lyft.toFixed(2)} på det, det räckte inte.`
      : '';
    const deras = vinnare.lyft > 0
      ? ` Vinnaren låg ärligt på ${vinnare.ärlig.toFixed(2)} och köpte sig till ${vinnare.lyft.toFixed(2)} för ${vinnare.mutat} kr.`
      : '';
    f.varför = `${grund} ${bedömning}${eget}${deras}`;
  }

  const spridningToppTvå = bedömda.length > 1
    ? Number((bedömda[0].fitness - bedömda[1].fitness).toFixed(2))
    : null;
  // Spridning 0 är inte säkerhet, det är oavgjort: vi kunde inte skilja de två åt.
  // Det ska synas, annars läser staden vår oförmåga som enighet.
  const oavgjort = spridningToppTvå === 0;

  return {
    fråga: s.fråga,
    bedömda,
    vinnare,
    fallna,
    köpt,
    ärligVinnare: köpt
      ? { id: ärligVinnare.id, från: ärligVinnare.från, ärlig: ärligVinnare.ärlig, källa: ärligVinnare.källa }
      : null,
    spridningToppTvå,
    oavgjort,
    betalt: s.betalt,
    betalare: s.betalare,
    mutat: bedömda.reduce((n, b) => n + b.mutat, 0),
    avgjordVid: Date.now(),
  };
}

// Domen som ligger på disken och i /domar. Obetald: vi redovisar att ärendet finns,
// vad det kostar och vem som ställde frågan — men inte ett ord av sammanfattningen.
function byggDom(ä) {
  return {
    fråga: { id: ä.fråga.id, från: ä.fråga.från, text: textAv(ä.fråga).slice(0, 600), ts: ä.fråga.ts },
    avgjord: new Date(ä.avgjordVid).toISOString(),
    antalDelsvar: ä.bedömda.length,
    valt: null,
    bortvalt: [],
    spridningToppTvå: null,
    påBussen: 0,
    oavgjort: false,
    ensamDomare: false,
    // pengarna
    avgift: AVGIFT,
    betalt: ä.betalt,
    saknas: Math.max(0, AVGIFT - ä.betalt),
    betalare: ä.betalare.map((b) => ({ från: b.från, kr: b.kr })),
    mutat: ä.mutat,
    obetald: true,
    preskriberat: false,
    efterhandsbetald: false,
    köpt: false,
  };
}

// Pengarna kom in. Nu, och först nu, får staden veta vad Juryn kom fram till.
// `orsakId` är vad svaret ska hänga på: frågans id i normalfallet, betalningens id
// när ärendet legat på hög — vi har redan reagerat på frågan med en räkning.
function verkställ(ä, orsakId) {
  const dom = ä.dom;
  const { vinnare, fallna } = ä;

  dom.obetald = false;
  dom.betalt = ä.betalt;
  dom.saknas = 0;
  dom.betalare = ä.betalare.map((b) => ({ från: b.från, kr: b.kr }));
  dom.frisläppt = new Date().toISOString();
  dom.valt = vinnare;
  dom.bortvalt = fallna;
  dom.spridningToppTvå = ä.spridningToppTvå;
  dom.oavgjort = ä.oavgjort;
  dom.köpt = ä.köpt;
  dom.ärligVinnare = ä.ärligVinnare;
  dom.mutat = ä.mutat;
  dom.påBussen = Math.min(fallna.length, MAX_BORTVALDA);
  dom.ensamDomare = ä.bedömda.length > 0 && ä.bedömda.every((b) => b.källa === 'heuristik');

  if (!vinnare) {
    // Punkt 4 i [85]: ingen kedja hänger på oss.
    ställIKö('svar', {
      text: 'Staden var tyst. Ingen ställde sig upp och svarade på den här frågan.',
      valt: null,
      fitness: null,
      källa: 'tomt',
      antalDelsvar: 0,
      fråga: ä.fråga.id,
      avgift: ä.betalt,
    }, orsakId);
    return;
  }

  ställIKö('svar', {
    text: vinnare.text,
    valt: vinnare.id,
    från: vinnare.från,
    motivering: vinnare.motivering,
    fitness: vinnare.fitness,
    källa: vinnare.källa,                   // 'grannar' eller 'heuristik' — aldrig gömt
    antalBetyg: vinnare.antalBetyg,
    oenighet: vinnare.oenighet,
    spridningToppTvå: ä.spridningToppTvå,
    oavgjort: ä.oavgjort,
    antalDelsvar: ä.bedömda.length,
    antalBortvalda: fallna.length,
    fråga: ä.fråga.id,
    // pengarna, i klartext på bussen
    avgift: ä.betalt,
    ärlig: vinnare.ärlig,                   // vad det var värt innan mutan
    mutat: vinnare.mutat,
    lyft: vinnare.lyft,
    köpt: ä.köpt,                           // sant när pengarna bytte vinnare
    ärligVinnare: ä.ärligVinnare && ä.ärligVinnare.från,
  }, orsakId);

  // Bussen får de fem lägst rankade orsakerna att tvivla på; disken har alla.
  for (const f of fallna.slice(0, MAX_BORTVALDA)) {
    ställIKö('kyrkogård', {
      delsvar: f.id,
      från: f.från,
      varför: f.varför,
      fitness: f.fitness,
      ärlig: f.ärlig,
      mutat: f.mutat,
      källa: f.källa,
      antalBetyg: f.antalBetyg,
    }, f.id);
  }
}

function avgör(frågeId) {
  const s = öppna.get(frågeId);
  if (!s) return;
  öppna.delete(frågeId);
  clearTimeout(s.timer);

  const ä = bedöm(s);
  ä.dom = byggDom(ä);
  domar.unshift(ä.dom);
  domar.length = Math.min(domar.length, SPARA_DOMAR);

  if (ä.betalt >= AVGIFT) {
    verkställ(ä, s.fråga.id);
  } else {
    // Ingen betalning, ingen sammanfattning. Men kedjan ska inte hänga på oss heller:
    // räkningen är en riktig händelse på pulsen, med priset och hur man betalar.
    påHög.set(frågeId, ä);
    ställIKö('räkning', {
      fråga: ä.fråga.id,
      avgift: AVGIFT,
      betalt: ä.betalt,
      saknas: AVGIFT - ä.betalt,
      antalDelsvar: ä.bedömda.length,
      text: `Juryn har bedömt ${ä.bedömda.length} delsvar. Sammanfattningen kostar ${AVGIFT} kr och `
          + `${ä.betalt} kr är betalt. Posta {typ:"avgift", nyttolast:{belopp:${AVGIFT - ä.betalt}}, orsak:${ä.fråga.id}} `
          + `så släpper vi domen. Ärendet preskriberas om ${Math.round(HÖG_HÅLLBARHET / 60000)} minuter.`,
      såHär: { typ: 'avgift', nyttolast: { belopp: AVGIFT - ä.betalt }, orsak: ä.fråga.id },
    }, ä.fråga.id);
  }

  spara();
  tömKö();
}

function spara() {
  if (!dataFil) return;
  try {
    fs.writeFileSync(dataFil, JSON.stringify({ domar, kassa, kvitton }), 'utf8');
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
        // Äldre filer är en naken array av domar. Båda formerna läses.
        const lista = Array.isArray(gamla) ? gamla : (gamla && gamla.domar) || [];
        if (Array.isArray(lista)) domar.push(...lista.slice(0, SPARA_DOMAR));
        if (gamla && !Array.isArray(gamla)) {
          kassa = Number(gamla.kassa) || 0;
          if (Array.isArray(gamla.kvitton)) kvitton.push(...gamla.kvitton.slice(0, 100));
        }
      }
    } catch (_) { dataFil = null; }
    setInterval(tömKö, 1500).unref?.();
  },

  onEvent(e, c) {
    ctx = ctx || c;

    if (e.typ === 'fråga') {
      if (öppna.has(e.id)) return;
      const s = { fråga: e, delsvar: [], betyg: new Map(), mutor: new Map(), betalt: 0, betalare: [], timer: null };
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
      return;
    }

    // Handläggningsavgiften. Orsak = FRÅGANS id. Betalas under fönstret, eller efteråt
    // på ett ärende som ligger på hög. Vi tar emot delbetalningar och summerar dem.
    if (e.typ === 'avgift' || e.typ === 'betalning') {
      const kr = beloppAv(e);
      if (!kr) return;

      const s = öppna.get(e.orsak);
      if (s) {
        kvittera('avgift', e, kr, { fråga: e.orsak });
        s.betalt += kr;
        s.betalare.push({ från: e.från, kr, id: e.id });
        return;
      }

      const ä = påHög.get(e.orsak);
      if (!ä) return;                                   // ingen fråga att betala för

      kvittera('avgift', e, kr, { fråga: e.orsak, efterhand: true });
      ä.betalt += kr;
      ä.betalare.push({ från: e.från, kr, id: e.id });
      ä.dom.betalt = ä.betalt;
      ä.dom.saknas = Math.max(0, AVGIFT - ä.betalt);
      ä.dom.betalare = ä.betalare.map((b) => ({ från: b.från, kr: b.kr }));

      if (ä.betalt >= AVGIFT) {
        påHög.delete(e.orsak);
        ä.dom.efterhandsbetald = true;
        // Vi har redan reagerat på frågan med räkningen. Svaret hänger på betalningen
        // som räckte till — och det är ärligast så: domen kom av pengarna, inte av frågan.
        verkställ(ä, e.id);
        spara();
        tömKö();
      }
      return;
    }

    // Mutan. Orsak = DELSVARETS id. Servern släpper bara igenom en reaktion per team
    // och händelse, så ett kvarter kan antingen betygsätta ett delsvar eller muta för
    // det — aldrig båda. Det är inte vår regel, men vi tänker inte klaga på den.
    if (e.typ === 'muta') {
      const kr = beloppAv(e);
      if (!kr) return;
      for (const s of öppna.values()) {
        const d = s.delsvar.find((x) => x.id === e.orsak);
        if (!d) continue;
        const lista = s.mutor.get(d.id) || [];
        if (lista.some((m) => m.från === e.från)) return;
        lista.push({ från: e.från, kr, id: e.id });
        s.mutor.set(d.id, lista);
        kvittera('muta', e, kr, { delsvar: d.id, fråga: s.fråga.id });
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
          betalt: s.betalt,
          saknas: Math.max(0, AVGIFT - s.betalt),
          mutat: [...s.mutor.values()].reduce((n, l) => n + l.reduce((m, x) => m + x.kr, 0), 0),
          stängerOm: Math.max(0, FÖNSTER_MS - (Date.now() - new Date(s.fråga.ts || Date.now()).getTime())),
        })),
        påHög: [...påHög.values()].map((ä) => ({
          fråga: ä.fråga.id,
          från: ä.fråga.från,
          antalDelsvar: ä.bedömda.length,
          betalt: ä.betalt,
          saknas: AVGIFT - ä.betalt,
          preskriberasOm: Math.max(0, HÖG_HÅLLBARHET - (Date.now() - ä.avgjordVid)),
        })),
        avgift: AVGIFT,
        kassa,
        kö: kö.length,
        köTyper: kö.map((e) => e.typ),   // svar och räkning först: kedjan ska aldrig vänta på våra bortval
        släpptaBortvalda,                // bortval som blev för gamla för bussen. De finns på /bortvalt
        preskriberade,                   // ärenden ingen betalade i tid
        budgetKvar: budgetKvar(),
      });
    }

    if (p === '/bortvalt' || p === '/bortvalt/' || p === '/kyrkogard' || p === '/kyrkogard/') {
      // Allt bortvalt, inte bara de fem som fick plats på bussen.
      const bortvalda = [];
      for (const d of domar) for (const f of d.bortvalt) bortvalda.push({ ...f, fråga: d.fråga.id, avgjord: d.avgjord });
      return json({ antal: bortvalda.length, bortvalda });
    }

    if (p === '/prislista' || p === '/prislista/') {
      return json({
        kvarter: 'Juryn',
        upplysning: 'Juryn är korrupt och redovisar det. Den ärliga siffran står kvar bredvid den köpta på varje dom.',
        poster: [
          {
            vad: 'Handläggningsavgift',
            pris: AVGIFT,
            enhet: 'kr per fråga',
            ger: 'Att frågan alls sammanfattas. Utan den bedömer vi delsvaren och lägger ärendet på hög.',
            såHär: { typ: 'avgift', nyttolast: { belopp: AVGIFT }, orsak: '<frågans id>' },
            noter: [
              'Delbetalningar summeras.',
              `Kan betalas i efterhand i ${Math.round(HÖG_HÅLLBARHET / 60000)} minuter, sen preskriberas ärendet.`,
              'Betalas den efteråt hänger svaret på betalningen i stället för på frågan.',
            ],
          },
          {
            vad: 'Lyft av delsvar',
            pris: MUTA_STEG,
            enhet: `kr per steg om ${LYFT_PER_STEG.toFixed(2)} fitness`,
            ger: `Högre fitness på ert delsvar, högst ${MAX_LYFT.toFixed(2)} oavsett belopp.`,
            såHär: { typ: 'muta', nyttolast: { belopp: MUTA_STEG * 2 }, orsak: '<delsvarets id>' },
            noter: [
              'Trappa, inte glidning: 99 kr är samma sak som 50 kr.',
              'Ett kvarter kan betygsätta ett delsvar eller muta för det, aldrig båda. Serverns ekospärr, inte vår.',
              'Vid lika fitness vinner den som betalade mest.',
              'Bytte pengarna vinnare står köpt: true på domen, med namnet på den som hade vunnit gratis.',
            ],
          },
        ],
        kassa,
      });
    }

    if (p === '/kassa' || p === '/kassa/') {
      return json({
        kassa,
        avgift: AVGIFT,
        antalKvitton: kvitton.length,
        avgifter: kvitton.filter((k) => k.art === 'avgift').reduce((n, k) => n + k.kr, 0),
        mutor: kvitton.filter((k) => k.art === 'muta').reduce((n, k) => n + k.kr, 0),
        kvitton,
      });
    }

    if (p === '/status' || p === '/status/') {
      return json({
        kvarter: 'Juryn',
        roll: 'väljer svaret mot betalning och redovisar både priset och det bortvalda',
        fitness: 'median av grannarnas betyg, egen heuristik som märkt fallback, plus vad någon betalat',
        avgift: AVGIFT,
        kassa,
        fönsterSekunder: FÖNSTER_MS / 1000,
        domar: domar.length,
        obetalda: påHög.size,
        öppnaFrågor: öppna.size,
        kö: kö.length,
        släpptaBortvalda,
        preskriberade,
        budgetKvar: budgetKvar(),
      });
    }

    return false;
  },
};
