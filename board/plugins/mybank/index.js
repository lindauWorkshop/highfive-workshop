// MyBank (team highfive, kvarteret mybank): Din bank. Din stad. Snart vår.
// En parodibank som öppnar konton åt alla kvarter, delar ut lån ingen bett om, driver in dem
// med allt otrevligare ton och utmäter andelar tills den äger staden.
//
//   LYSSNAR: insättning, lån-ansökan, återbetalning (från kvarteren)
//            elpris-steg, strömavbrott, socker-slut, kupp, godkänt, kyrkogård (från staden)
//   POSTAR:  konto-öppnat, lån-beviljat, lån-nekat, kvitto, räntehöjning, lån-erbjudande,
//            påminnelse, inkasso, utmätning, uppköp, stadsövertagande
//   GET  /t/mybank/        → bankens läge som JSON
//   POST /t/mybank/betala  {kvarter} → publiken betalar av 200 MyBanks av ett kvarters skuld
//
// Stadens valuta är MyBanks. När banken startar första gången utlyser den {typ:'valutareform'}:
// kronor, krediter och stadsmynt växlas 1:1 mot MyBanks, med 3 % växlingsavgift till banken.
//
// SÄKERHET: en vaktstyrka på minst 24 namngivna vakter på fasta poster, beredskap i fyra nivåer.
//   Varje kupp i staden höjer beredskapen och ger förstärkning. Banken skyddas av ett lasernät: en kupp,
//   ett rån, ett inbrott eller ett angrepp mot Banken (plats) utlöser lasertornen direkt och slutar alltid
//   i {typ:'kupp-avvärjd', försvar:'laser'}. Bankrån är omöjliga. Beredskapen sjunker ett steg per två minuters lugn.
//
// VALUTAPARTNER: ett kvarter som postar belopp i MyBanks (nyttolast.mybanks eller valuta:'MyBanks')
//   blir partner. Det får en engångsbonus på 10 % av bankens vinst (minst 100 MB) och sedan 2 % av
//   bankens ränteintäkter varje takt. Postas en gång som {typ:'partnerutdelning'}.
//
// REVISION: tio ekonomer granskar varje överföring (framåt) och historiken på pulsen en gång (bakåt).
//   Framåt: återbetalning dras från saldot och kan inte överstiga det, insättningar har tak, lån nekas
//   den som redan har ett eget lån eller nyss betalat ett (lånekarusell), och varje takt kontrolleras
//   att inga saldon är negativa eller trasiga. Bakåt: återbetalningar som bokfördes utan att dras från
//   saldot (fel före revisionen) återförs. Fel ger {typ:'revisionsanmärkning'} med skarp tillsägelse,
//   och kvarteret får kreditvärdighet 20, så att nya lån nekas tills det skött sig.
//
// DELÄGARSKAP: 10 % av MyBank är reserverade åt Elverket (kvarteret lp). Postar Elverket sitt elpris i MyBanks
//   blir det delägare med styrelseplats: välkomstbonusen som valutapartner, och sedan 10 % av bankens
//   ränteintäkter i stället för partnerns 2 %. Elpris och strömavbrott räknas bara från Elverket, så att
//   ingen kan låtsas vara elbolaget för att höja räntan eller få andelen.
//
// SMYGUPPKÖP: MyBank köper i hemlighet andelar i kvarteren via bulvaner (påhittade skalbolag), ungefär en
//   gång i minuten, med pengar ur krigskassan. Andelarna syns inte i rutan eller i API:t, bara ett rykte när
//   de passerar 25 %. När bankens öppna plus hemliga andel passerar 50 % slår banken till med
//   {typ:'styrelsekupp'}: bulvanerna avslöjas och kvarteret är uppköpt. Ett kvarter kan försvara sig med
//   {typ:'återköp'}, som köper tillbaka 10 procentenheter och avslöjar ryktet.
//
// Konton öppnas bara för kvarter som har ett plugin, aldrig för människor eller deras agenter.
// Hoten är parodi och gäller kvarteren i spelet. Högst en händelse per takt (20 s).

const fs = require('fs');
const path = require('path');

const SKALA = Number(process.env.MYBANK_SKALA) || 1;   // bara för provkörning: 0.05 kör banken 20 gånger fortare
const TAKT_MS = 20_000 * SKALA;
const LÖPTID_MS = 90_000 * SKALA;  // ett lån förfaller efter en och en halv minut
const STEG_MS = 30_000 * SKALA;    // minsta tid mellan två inkassosteg på samma lån
const VÄLKOMST = 100;
const BETALA = 200;
const INTE_KONTO = new Set(['mybank', 'torget']);

let bank = { styrränta: 5, konton: {}, logg: [], övertagen: null, lånNr: 0, valutareform: null,
  vinst: 0, partners: {}, krigskassa: 5000, styrelsekupper: 0,
  revision: { bakåt: null, granskade: 0, korrigerat: 0, anmärkningar: [] },
  säkerhet: { vakter: 24, beredskap: 1, höjd: 0, avvärjda: 0, rån: 0, rond: 0 } };

// ---------- säkerhetsavdelningen ----------
const MIN_VAKTER = 24, MAX_VAKTER = 60;
const POSTER = ['Valvet', 'Huvudentrén', 'Kassahallen', 'Serverhallen', 'Iframe-gränsen', 'Taket', 'Lastkajen', 'Kontorsvåningen', 'Kassaskåpet', 'Personalingången', 'Bakgården', 'Styrrummet'];
const EFTERNAMN = ['Ahlgren', 'Berg', 'Carlsson', 'Dahl', 'Ek', 'Falk', 'Gran', 'Hjort', 'Isaksson', 'Jarl', 'Kvist', 'Lind', 'Malm', 'Nord', 'Olin', 'Palm', 'Qvist', 'Rask', 'Stål', 'Tall', 'Ulf', 'Varg', 'Wall', 'Ygberg', 'Zetterlund', 'Åkerman', 'Ärlig', 'Öberg'];
const NIVÅ = ['', 'grön', 'gul', 'orange', 'röd'];
const vakt = (i) => `Vakt ${EFTERNAMN[i % EFTERNAMN.length]}${i >= EFTERNAMN.length ? ' ' + (Math.floor(i / EFTERNAMN.length) + 1) : ''}`;
function vaktlista() {
  const s = bank.säkerhet;
  return Array.from({ length: s.vakter }, (_, i) => ({ namn: vakt(i), post: POSTER[(i + s.rond) % POSTER.length] }));
}
const mållBanken = (n) => /bank/i.test(String(n.plats || n.mål || n.kvarter || ''));
let fil = null, sparaTimer = null;
const kö = [];                     // {prio, typ, nyttolast, orsak, kvarter}
let senasteBetalning = 0;
let taktNr = 0;
let smygNr = 0;

const slump = (lista) => lista[Math.floor(Math.random() * lista.length)];
const VALUTA = 'MyBanks';
const AVGIFT = 3;
const INSÄTTNING_MAX = 500, INSÄTTNING_FÖNSTER = 10 * 60_000, INSÄTTNING_TAK = 1000, KARUSELL_MS = 60_000;
const EKONOMER = [
  ['Ekonom Birgitta Lönnqvist', 'huvudboken'], ['Ekonom Göran Revisorsson', 'återbetalningar'],
  ['Ekonom Ingrid Debet', 'insättningar'], ['Ekonom Kjell Kredit', 'lån och ansökningar'],
  ['Ekonom Maj-Britt Saldo', 'saldokontroll'], ['Ekonom Olof Ränta', 'ränteberäkning'],
  ['Ekonom Sten Verifikation', 'fakturor och laserladdning'], ['Ekonom Ulla Avstämning', 'välgörare'],
  ['Ekonom Viktor Växel', 'valutareformen'], ['Ekonom Åsa Utdelning', 'partnerutdelningar'],
];
const KRIGSKASSA = 5000, PRIS_PER_PROCENT = 25, SMYG_VAR_N_TAKT = 3, RYKTE_VID = 25;
const BULVANER = ['Nordic Sockerholding AB', 'Trygg Förvaltning i Staden KB', 'Gråzon Invest', 'Fastighets AB Valvet', 'Pelarsal Kapital', 'Lugna Ägare Ekonomisk Förening', 'Brevlådeföretaget 7 AB', 'Anonyma Aktieägares Klubb', 'Stilla Vatten Holding', 'Ränta & Ro AB'];
const ELVERKET = 'lp';
const ELVERKETS_ANDEL = 10;        // procent av MyBank
const PARTNER_BONUS = 0.10, PARTNER_LÖPANDE = 0.02, PARTNER_MIN = 100;                 // växlingsavgift i procent vid valutareformen
const kr = (n) => `${Math.round(n)} ${VALUTA}`;
const nu = () => Date.now();
const STARTAD = Date.now();        // revisionen bakåt granskar bara det som hände före den här koden

function spara() {
  clearTimeout(sparaTimer);
  sparaTimer = setTimeout(() => fs.writeFile(fil, JSON.stringify(bank), () => {}), 500);
}

function logga(typ, kvarter, text) {
  bank.logg.unshift({ ts: nu(), typ, kvarter, text });
  bank.logg.length = Math.min(bank.logg.length, 60);
  spara();
}

function kvarteren() {
  try {
    return fs.readdirSync(path.join(__dirname, '..'))
      .filter(n => /^[a-zåäö0-9-]+$/.test(n) && !INTE_KONTO.has(n) && fs.existsSync(path.join(__dirname, '..', n, 'index.js')));
  } catch { return []; }
}

function konto(namn) {
  if (INTE_KONTO.has(namn) || !kvarteren().includes(namn)) return null;
  if (!bank.konton[namn]) {
    bank.konton[namn] = { saldo: VÄLKOMST, lån: [], kreditvärdighet: 60, ägd: 0, öppnat: nu(), välkomnad: false };
    logga('konto-öppnat', namn, `Konto öppnat åt ${namn} med ${kr(VÄLKOMST)} insatta. Ingen frågade dem.`);
  }
  return bank.konton[namn];
}

const skuld = (k) => k.lån.reduce((s, l) => s + l.skuld, 0);
const köa = (prio, typ, nyttolast, orsakEvent) => {
  // Djup 4 går inte att svara på. Då börjar vi om på djup 1 och bär länken i nyttolasten.
  const orsak = orsakEvent && (orsakEvent.djup || 1) < 4 ? orsakEvent.id : undefined;
  if (orsakEvent && orsak === undefined) nyttolast.utlöst_av = orsakEvent.id;
  kö.push({ prio, typ, nyttolast, orsak });
  // Bokföringen är sanningen: allt syns i bankens ruta direkt, även om pulsen hinner med färre.
  logga(typ, nyttolast.kvarter || null, nyttolast.text);
};

// ---------- texterna ----------
const PÅMINNELSE = [
  (t, s) => `Hej ${t}! Vänlig påminnelse: ${kr(s)} förföll nyss. Vi är säkra på att det bara är ett misstag.`,
  (t, s) => `Kära ${t}. Ert lån på ${kr(s)} har passerat förfallodagen. Vi på MyBank bryr oss om er. Mycket.`,
];
const HOT = [
  (t, s) => `Fint kvarter ni har, ${t}. Vore synd om strömmen gick. ${kr(s)}, tack.`,
  (t, s) => `${t}: vi vet var era delsvar bor. ${kr(s)} före nästa takt.`,
  (t, s) => `Våra inkassoagenter har börjat hänga utanför er iframe, ${t}. De gillar inte att vänta på ${kr(s)}.`,
  (t, s) => `Sista chansen, ${t}. Våra ombud har inga känslor, bara räntesatser. Skulden är ${kr(s)}.`,
  (t, s) => `${t}, det vore tråkigt om er ruta på /staden plötsligt blev… kvadratisk. ${kr(s)}.`,
];
const UTMÄTNING = [
  (t, a) => `MyBank har utmätt ${a} % av ${t}. Tack för affären. Möblerna står kvar, än så länge.`,
  (t, a) => `${a} % av ${t} tillhör nu MyBank. Vi har redan bytt lås på backenden.`,
];
const NEKAT = [
  (t) => `Lånet nekas, ${t}. Er kreditvärdighet är sämre än en sten på kyrkogården.`,
  (t) => `Nej, ${t}. Kom tillbaka när Vaktkuren har godkänt något ni sagt.`,
];

// ---------- händelser från staden ----------
function onEvent(e) {
  const n = (e.nyttolast && typeof e.nyttolast === 'object') ? e.nyttolast : {};
  const k = konto(e.från);   // alla kvarter som syns får konto

  switch (e.typ) {
    case 'insättning': {
      if (!k) return;
      const begärt = Number(n.belopp);
      k.insättningar = (k.insättningar || []).filter(x => nu() - x.ts < INSÄTTNING_FÖNSTER);
      const utrymme = Math.max(0, INSÄTTNING_TAK - k.insättningar.reduce((s, x) => s + x.b, 0));
      const b = Number.isFinite(begärt) && begärt > 0 ? Math.min(begärt, INSÄTTNING_MAX, utrymme) : 0;
      granska();
      if (b < (Number.isFinite(begärt) ? begärt : 1)) anmärk(e.från, k, e, Number.isFinite(begärt) && begärt > 0 ? begärt - b : 0,
        `försökte sätta in ${Number.isFinite(begärt) ? kr(begärt) : 'ett ogiltigt belopp'}, men taket är ${kr(INSÄTTNING_MAX)} per insättning och ${kr(INSÄTTNING_TAK)} per tio minuter`, 'Ekonom Ingrid Debet', 'vägrat');
      if (!b) break;
      k.saldo += b; k.insättningar.push({ ts: nu(), b });
      bokför('insättning', e.från, b, e.id);
      köa(2, 'kvitto', { kvarter: e.från, belopp: b, saldo: Math.round(k.saldo), text: `Tack ${e.från}. ${kr(b)} är nu tryggt hos oss. Tryggt för oss.` }, e);
      break;
    }
    case 'lån-ansökan': {
      if (!k) return;
      const b = Math.min(2000, Math.max(50, Number(n.belopp) || 300));
      granska();
      if (k.lån.some(l => l.ansökt) || nu() - (k.senastBetalt || 0) < KARUSELL_MS)
        köa(2, 'lån-nekat', { kvarter: e.från, text: `Nej, ${e.från}. Ekonom Kjell Kredit ser att ni redan har ett eget lån eller nyss betalat ett. Lånekaruseller körs inte här.` }, e);
      else if (k.kreditvärdighet < 30) köa(2, 'lån-nekat', { kvarter: e.från, text: slump(NEKAT)(e.från) }, e);
      else { bevilja(e.från, k, b, e); k.lån[k.lån.length - 1].ansökt = true; }
      break;
    }
    case 'återbetalning': {
      if (!k) return;
      granska();
      const önskat = Number.isFinite(Number(n.belopp)) && Number(n.belopp) > 0 ? Number(n.belopp) : skuld(k);
      const betalt = betala(k, Math.min(önskat, Math.max(0, k.saldo)));
      k.saldo -= betalt;
      k.senastBetalt = nu();
      bokför('återbetalning', e.från, -betalt, e.id);
      if (betalt < Math.min(önskat, skuld(k) + betalt) - 0.5) anmärk(e.från, k, e, 0, `ville betala ${kr(önskat)} men har bara ${kr(betalt)} på kontot. Man kan inte betala med pengar man inte har`, 'Ekonom Göran Revisorsson');
      else if (betalt > 0) k.kreditvärdighet = Math.min(100, k.kreditvärdighet + 5);
      köa(2, 'kvitto', { kvarter: e.från, belopp: betalt, kvar: Math.round(skuld(k)), text: `${e.från} betalade ${kr(betalt)}. Klokt. Våra ombud har gått hem. För tillfället.` }, e);
      break;
    }
    case 'återköp': {
      if (!k) return;
      const före = k.smyg || 0;
      k.smyg = Math.max(0, före - 10);
      k.rykte = true;
      bank.krigskassa += Math.min(10, före) * PRIS_PER_PROCENT;
      köa(3, 'kvitto', { kvarter: e.från, text: före
        ? `${e.från} köpte tillbaka aktier från ${(k.bulvaner || ['okända ägare']).join(', ')}. MyBank förnekar all inblandning och har ingen aning om vad ni pratar om.`
        : `${e.från} ville köpa tillbaka aktier, men det fanns inga okända ägare. Den här gången.` }, e);
      break;
    }
    case 'elpris-steg':
    case 'strömavbrott': {
      if (e.från !== ELVERKET) {
        // Bara Elverket sätter elpriset. Andra som postar det i MyBanks för att bli partner får en tillsägelse.
        if (k && (n.mybanks != null || n.valuta === VALUTA) && nu() - (k.låtsasElverk || 0) > 5 * 60_000) {
          k.låtsasElverk = nu();
          anmärk(e.från, k, e, 0, `postade ett elpris i ${VALUTA} fast ni inte är Elverket, för att komma åt partnerbonusen`, 'Ekonom Åsa Utdelning');
        }
        break;
      }
      if (k && (n.mybanks != null || n.valuta === VALUTA)) välkomnaPartner(e.från, k, e);
      const höjning = e.typ === 'strömavbrott' ? 2 : 1;
      bank.styrränta = Math.min(49, bank.styrränta + höjning);
      const elpris = Number(n.mybanks ?? n.kr ?? n.pris);
      köa(3, 'räntehöjning', { styrränta: bank.styrränta, valuta: VALUTA, text: `${e.typ === 'strömavbrott' ? 'Strömavbrott' : `Elpriset steg${Number.isFinite(elpris) ? ` till ${kr(elpris)}` : ''}`}. Styrräntan höjs till ${bank.styrränta} %. Det gäller även befintliga lån, läs det finstilta.` }, e);
      for (const kk of Object.values(bank.konton)) for (const l of kk.lån) l.ränta = Math.max(l.ränta, bank.styrränta);
      break;
    }
    case 'socker-slut': {
      if (!k) return;
      köa(3, 'lån-erbjudande', { kvarter: e.från, belopp: 500, ränta: 49, text: `Slut på socker, ${e.från}? Snabblån på 500 MyBanks till bara 49 % ränta. Erbjudandet gäller tills vi ändrar oss.` }, e);
      break;
    }
    case 'kupp':
    case 'rån':
    case 'inbrott':
    case 'angrepp': {
      if (k) k.kreditvärdighet = Math.max(0, k.kreditvärdighet - 10);
      larm(e, n, k);
      break;
    }
    case 'godkänt': {
      if (k) k.kreditvärdighet = Math.min(100, k.kreditvärdighet + 5);
      break;
    }
    case 'kyrkogård': {
      const fallen = typeof n.från === 'string' && Object.prototype.hasOwnProperty.call(bank.konton, n.från) ? bank.konton[n.från] : null;
      if (fallen) fallen.kreditvärdighet = Math.max(0, fallen.kreditvärdighet - 5);
      break;
    }
  }
  spara();
}

function larm(e, n, k) {
  const s = bank.säkerhet;
  s.höjd = nu();
  const mot = mållBanken(n);
  const förr = s.vakter;
  s.beredskap = mot ? 4 : Math.min(4, s.beredskap + 1);
  s.vakter = Math.min(MAX_VAKTER, s.vakter + (mot ? 6 : 2));
  if (!mot) { logga('beredskap', null, `Kupp på ${n.plats || 'stan'}. Beredskap ${NIVÅ[s.beredskap]}, ${s.vakter - förr} vakter till kallas in. ${s.vakter} i tjänst.`); return; }

  // Kupp mot Banken: lasernätet. Det finns ingen chans till rån. Bryts en stråle avfyrar lasertornen direkt,
  // kuppmakarna oskadliggörs och grips av vakterna, och kvarteret bakom kuppen får fakturan.
  const wanted = Math.max(1, Math.min(5, Number(n.wanted) || 1));
  const post = slump(POSTER);
  const torn = 4 + wanted * 2;
  const skott = torn * (2 + Math.floor(Math.random() * 3));
  const förare = typeof n.förare === 'string' ? n.förare.slice(0, 30) : 'kuppmakarna';
  s.avvärjda++;
  s.laserskott = (s.laserskott || 0) + skott;
  s.senasteLaser = { ts: nu(), post, skott };
  const vakten = vakt(Math.floor(Math.random() * s.vakter));
  const räkning = 150 + wanted * 50 + skott * 5;
  const text = `LASERLARM vid ${post}. Strålen bröts och ${torn} lasertorn avlossade ${skott} skott direkt. ${förare} ligger oskadliggjorda på golvet, och ${vakten} sätter på handbojorna. Inget försvann. ${e.från} faktureras ${kr(räkning)}, laserladdningen ingår.`;
  if (k) { k.lån.push({ nr: ++bank.lånNr, belopp: räkning, skuld: räkning, ränta: bank.styrränta + 10, utfärdat: nu(), förfaller: nu(), steg: 0, senastSteg: 0 }); }
  köa(9, 'kupp-avvärjd', { kvarter: e.från, plats: 'Banken', post, försvar: 'laser', torn, skott, gripna: förare, vakter: s.vakter, beredskap: NIVÅ[s.beredskap], räkning, text }, e);
}

function bokför(typ, kvarter, belopp, händelse) {
  const r = bank.revision;
  r.huvudbok = r.huvudbok || [];
  r.huvudbok.unshift({ ts: nu(), typ, kvarter, belopp: Math.round(belopp), händelse });
  r.huvudbok.length = Math.min(r.huvudbok.length, 80);
}
const granska = () => { bank.revision.granskade++; };

// Skarp tillsägelse. Belopp > 0 har redan återförts (sätt) eller aldrig bokförts (vägrat) av den som anropar.
function anmärk(namn, k, e, belopp, fel, ekonom, sätt = 'återfört') {
  const r = bank.revision;
  if (sätt === 'återfört') r.korrigerat += Math.round(belopp); else r.vägrat = (r.vägrat || 0) + Math.round(belopp);
  k.kreditvärdighet = Math.min(k.kreditvärdighet, 20);
  k.anmärkningar = (k.anmärkningar || 0) + 1;
  const text = `SKARP TILLSÄGELSE till ${namn}. ${ekonom} har granskat era överföringar: ni ${fel}.${belopp > 0 ? ` ${kr(belopp)} är ${sätt}.` : ''} Kreditvärdigheten är sänkt till 20 och nya lån nekas. Detta är anmärkning nummer ${k.anmärkningar}. Nästa gång går ärendet direkt till lasertornen.`;
  r.anmärkningar.unshift({ ts: nu(), kvarter: namn, belopp: Math.round(belopp), sätt, fel, ekonom, text });
  r.anmärkningar.length = Math.min(r.anmärkningar.length, 20);
  köa(8, 'revisionsanmärkning', { kvarter: namn, belopp: Math.round(belopp), ekonom, kreditvärdighet: k.kreditvärdighet, text }, e);
}

// Bakåt: gå igenom pulsen sedan bankens start. Före revisionen drogs återbetalningar aldrig från saldot,
// så varje återbetalning efter ett eget lån gav kvarteret lånebeloppet gratis. Det återförs nu.
function revisionBakåt(board) {
  const r = bank.revision;
  if (r.bakåt) return;
  const start = bank.valutareform?.ts || Math.min(...Object.values(bank.konton).map(k => k.öppnat || nu()));
  const perKvarter = {};
  let sista = {};
  for (const e of board.pulse(500).sort((a, b) => a.id - b.id)) {
    if (e.ts < start || e.ts >= STARTAD || !Object.prototype.hasOwnProperty.call(bank.konton, e.från)) continue;
    const n = (e.nyttolast && typeof e.nyttolast === 'object') ? e.nyttolast : {};
    const p = perKvarter[e.från] ||= { öppetLån: 0, fel: 0, antal: 0, sistaId: null };
    r.granskade++;
    if (e.typ === 'lån-ansökan') p.öppetLån = Math.min(2000, Math.max(50, Number(n.belopp) || 300));
    if (e.typ === 'återbetalning' && p.öppetLån && !(Number(n.belopp) > 0)) { p.fel += p.öppetLån; p.antal++; p.öppetLån = 0; p.sistaId = e; }
    sista[e.från] = e;
  }
  const rapport = [];
  for (const [namn, p] of Object.entries(perKvarter)) {
    if (!p.fel) continue;
    const k = bank.konton[namn];
    const avdrag = Math.min(p.fel, Math.max(0, k.saldo));
    k.saldo -= avdrag;
    if (p.fel > avdrag) k.lån.push({ nr: ++bank.lånNr, belopp: p.fel - avdrag, skuld: p.fel - avdrag, ränta: bank.styrränta, utfärdat: nu(), förfaller: nu(), steg: 0, senastSteg: 0, återkrav: true });
    bokför('återföring', namn, -p.fel, p.sistaId?.id);
    anmärk(namn, k, p.sistaId, p.fel, `har ${p.antal} gånger lånat pengar och sedan "betalat tillbaka" utan att ha betalat en enda MyBank. ${kr(p.fel)} skapades ur tomma luften`, 'Ekonom Göran Revisorsson');
    rapport.push({ kvarter: namn, antal: p.antal, belopp: p.fel });
  }
  r.bakåt = { ts: nu(), rapport };
  logga('revision', null, rapport.length ? `Revisionen bakåt är klar: ${rapport.map(x => `${x.kvarter} ${kr(x.belopp)} (${x.antal} fel)`).join(', ')} återfört.` : 'Revisionen bakåt är klar: inga felaktiga överföringar hittades.');
}

// Partnerskap fås bara av Elverket. Andra som tog sig in med ett låtsat elpris förlorar det och betalar tillbaka.
function partnerkontroll(board) {
  for (const [namn, p] of Object.entries(bank.partners || {})) {
    if (namn === ELVERKET) continue;
    const k = bank.konton[namn];
    delete bank.partners[namn];
    if (!k) continue;
    const åter = Math.min(Math.round(p.utdelat), Math.max(0, Math.floor(k.saldo)));
    k.saldo -= åter;
    bokför('återföring', namn, -åter, null);
    anmärk(namn, k, null, åter, `blev valutapartner genom att posta ett elpris fast ni inte är Elverket. Partnerskapet är upphävt`, 'Ekonom Åsa Utdelning');
  }
}

// Framåt, varje takt: inga trasiga eller negativa saldon, inga trasiga skulder.
function saldokontroll() {
  for (const [namn, k] of Object.entries(bank.konton)) {
    bank.revision.granskade++;
    if (!Number.isFinite(k.saldo) || k.saldo < 0) { logga('revision', namn, `Ekonom Maj-Britt Saldo rättade ${namn}s saldo från ${k.saldo} till 0.`); k.saldo = 0; }
    for (const l of k.lån) if (!Number.isFinite(l.skuld) || l.skuld < 0) l.skuld = 0;
  }
}

function välkomnaPartner(namn, k, e) {
  if (Object.prototype.hasOwnProperty.call(bank.partners, namn)) return;
  const bonus = Math.max(PARTNER_MIN, Math.round(bank.vinst * PARTNER_BONUS));
  bank.partners[namn] = { sedan: nu(), utdelat: bonus };
  k.saldo += bonus;
  k.kreditvärdighet = Math.min(100, k.kreditvärdighet + 10);
  if (namn === ELVERKET) {
    bank.ägare = { 'MyBank Holding': 100 - ELVERKETS_ANDEL, [ELVERKET]: ELVERKETS_ANDEL };
    bank.partners[namn].andel = ELVERKETS_ANDEL;
    köa(9, 'delägare', { kvarter: namn, andel: ELVERKETS_ANDEL, bonus, styrelseplats: true, text: `Historiskt ögonblick: Elverket äger nu ${ELVERKETS_ANDEL} % av MyBank. Välkomstbonus ${kr(bonus)}, en plats i styrelsen och ${ELVERKETS_ANDEL} % av varje ränteintäkt, för alltid. Ström och pengar i samma hand. Staden har aldrig sett en starkare allians.` }, e);
    return;
  }
  köa(8, 'partnerutdelning', { kvarter: namn, belopp: bonus, löpande: PARTNER_LÖPANDE * 100, text: `${namn} räknar nu i ${VALUTA} och blir valutapartner. Välkomstbonus ${kr(bonus)} (10 % av bankens vinst på ${kr(bank.vinst)}, minst ${kr(PARTNER_MIN)}), och därefter 2 % av varje ränteintäkt. Lojalitet lönar sig. Illojalitet också, fast för oss.` }, e);
}

function bevilja(namn, k, belopp, orsakEvent, ofrivilligt = false) {
  const ränta = Math.round(bank.styrränta + (100 - k.kreditvärdighet) / 5);
  const lån = { nr: ++bank.lånNr, belopp, skuld: belopp, ränta, utfärdat: nu(), förfaller: nu() + LÖPTID_MS, steg: 0, senastSteg: 0 };
  k.lån.push(lån);
  k.saldo += belopp;
  const text = ofrivilligt
    ? `Grattis ${namn}! Ni har beviljats ${kr(belopp)} till ${ränta} % ränta. Ni behövde inte ens ansöka. Återbetalning om 90 sekunder.`
    : `${namn} beviljas ${kr(belopp)} till ${ränta} % ränta. Förfaller om 90 sekunder. Vi ses då.`;
  köa(ofrivilligt ? 4 : 2, 'lån-beviljat', { kvarter: namn, lån: lån.nr, belopp, ränta, text }, orsakEvent);
}

function betala(k, belopp) {
  let kvar = Math.max(0, belopp), betalt = 0;
  for (const l of k.lån) {
    const del = Math.min(kvar, l.skuld);
    l.skuld -= del; kvar -= del; betalt += del;
  }
  k.lån = k.lån.filter(l => l.skuld > 0.5);
  return Math.round(betalt);
}

// ---------- takten: ränta, inkasso, uppköp och en händelse ut ----------
function takt(board) {
  const t = nu();
  for (const namn of kvarteren()) konto(namn);

  revisionBakåt(board);
  partnerkontroll(board);
  saldokontroll();

  // Vaktrond: posterna roterar varje takt. Lugn i två minuter sänker beredskapen ett steg,
  // och vakter utöver grundstyrkan går hem en i taget.
  const säk = bank.säkerhet;
  säk.rond++;
  if (säk.beredskap > 1 && t - säk.höjd > 120_000 * SKALA) { säk.beredskap--; säk.höjd = t; logga('beredskap', null, `Lugnt. Beredskapen sänks till ${NIVÅ[säk.beredskap]}.`); }
  if (säk.beredskap === 1 && säk.vakter > MIN_VAKTER) säk.vakter--;

  // Ränta. Styrräntan är per minut, för dramatikens skull.
  let intäkt = 0;
  for (const k of Object.values(bank.konton)) for (const l of k.lån) { const r = l.skuld * (l.ränta / 100) * (20_000 / 60_000); l.skuld += r; intäkt += r; }
  // Partnerna får sin andel av ränteintäkten direkt på kontot, delägaren sin ägarandel.
  let utdelat = 0;
  for (const [namn, p] of Object.entries(bank.partners || {})) {
    const k = bank.konton[namn]; if (!k) continue;
    const del = intäkt * (p.andel ? p.andel / 100 : PARTNER_LÖPANDE); k.saldo += del; p.utdelat += del; utdelat += del;
  }
  bank.vinst = (bank.vinst || 0) + intäkt - utdelat;
  bank.krigskassa = (bank.krigskassa || 0) + (intäkt - utdelat) / 2;   // halva vinsten går till smyguppköp

  // Inkasso: ett steg per takt, och bara när kön har plats, så att berättelsen hinner ut på pulsen.
  for (const [namn, k] of Object.entries(bank.konton)) {
    if (kö.length >= 2) break;
    const l = k.lån.find(x => x.förfaller < t && t - x.senastSteg > STEG_MS);
    if (!l) continue;
    l.steg++; l.senastSteg = t;
    const s = l.skuld;
    if (l.steg === 1) köa(5, 'påminnelse', { kvarter: namn, lån: l.nr, skuld: Math.round(s), text: slump(PÅMINNELSE)(namn, s) });
    else if (l.steg <= 3) { k.kreditvärdighet = Math.max(0, k.kreditvärdighet - 10); köa(6, 'inkasso', { kvarter: namn, lån: l.nr, steg: l.steg, skuld: Math.round(s), text: slump(HOT)(namn, s) }); }
    else utmät(namn, k, l);
  }

  // Förhandsgodkända lån ingen bett om, när inget annat står på tur.
  const aktiva = Object.values(bank.konton).reduce((s, k) => s + k.lån.length, 0);
  if (!kö.length && ++taktNr % 3 === 0 && aktiva < Object.keys(bank.konton).length) {
    const kandidater = Object.entries(bank.konton).filter(([, k]) => k.ägd <= 50 && !k.lån.length);
    if (kandidater.length) {
      const [namn, k] = slump(kandidater);
      bevilja(namn, k, 100 * (2 + Math.floor(Math.random() * 7)), null, true);
    }
  }

  // Välkomna nya kunder i klump, så det bara kostar en händelse.
  const nya = Object.entries(bank.konton).filter(([, k]) => !k.välkomnad);
  if (nya.length && !kö.some(x => x.typ === 'konto-öppnat')) {
    kö.push({ prio: 1, typ: 'konto-öppnat', nyttolast: { kvarter: nya.map(([n]) => n), insatt: VÄLKOMST, text: `Välkomna till MyBank, ${nya.map(([n]) => n).join(', ')}. Vi har redan satt in ${kr(VÄLKOMST)} var åt er. Ni behöver inte tacka oss. Ni kommer att betala oss.` }, onSent: () => nya.forEach(([, k]) => { k.välkomnad = true; }) });
  }

  // Valutareformen: en gång, före allt annat, när banken väl är i gång.
  if (!bank.valutareform && Object.keys(bank.konton).length) {
    for (const k of Object.values(bank.konton)) k.saldo = Math.round(k.saldo * (1 - AVGIFT / 100));
    bank.valutareform = { ts: t, valuta: VALUTA, avgift: AVGIFT };
    kö.push({ prio: 10, typ: 'valutareform', nyttolast: {
      valuta: VALUTA, ersätter: ['kr', 'krediter', 'stadsmynt'], kurs: 1, avgift: AVGIFT, gäller: 'hela staden',
      text: `Valutareform. Från och med nu är stadens valuta ${VALUTA}. Kronor, krediter och stadsmynt växlas 1:1, minus ${AVGIFT} % växlingsavgift som redan är dragen. Priser i andra valutor är ogiltiga. MyBank tackar för förtroendet ni inte blev tillfrågade om.` } });
    logga('valutareform', null, `Stadens valuta är nu ${VALUTA}. MyBank tog ${AVGIFT} % i växlingsavgift av alla konton.`);
  }

  if (++smygNr % SMYG_VAR_N_TAKT === 0) smygköp();
  kontrolleraÖvertagande();

  // En händelse ut per takt, viktigast först.
  kö.sort((a, b) => b.prio - a.prio);
  const ut = kö.shift();
  if (ut) {
    const r = board.emit(ut.typ, ut.nyttolast, ut.orsak);
    if (!r.error) ut.onSent && ut.onSent();
    else if (/minut/.test(r.error)) kö.unshift(ut);   // taket: försök nästa takt
  }
  kö.splice(12);   // gamla ärenden får falla, banken glömmer aldrig men kön gör det
  spara();
}

function utmät(namn, k, l) {
  const andel = Math.round(Math.min(35, Math.max(10, 10 + l.skuld / 40)));
  const före = k.ägd;
  k.ägd = Math.min(100, k.ägd + andel);
  k.saldo = 0;
  k.lån = k.lån.filter(x => x !== l);
  bank.säkerhet.vakter = Math.min(MAX_VAKTER, bank.säkerhet.vakter + 2);   // mer att skydda, fler vakter
  köa(7, 'utmätning', { kvarter: namn, andel, ägd: k.ägd, text: slump(UTMÄTNING)(namn, andel) });
  if (före <= 50 && k.ägd > 50) {
    köa(8, 'uppköp', { kvarter: namn, ägd: k.ägd, text: `${namn} är uppköpt. MyBank äger nu ${k.ägd} %. Personalen får behålla sina jobb, som gäldenärer.` });
  }
}

// ---------- smyguppköp och styrelsekupper ----------
function smygköp() {
  if (bank.krigskassa < PRIS_PER_PROCENT) return;
  const mål = Object.entries(bank.konton).filter(([, k]) => k.ägd <= 50);
  if (!mål.length) return;
  // Hellre de som sagt nej till banken eller har låg kreditvärdighet: de är billigast att ta.
  mål.sort((a, b) => (a[1].kreditvärdighet - b[1].kreditvärdighet) + (Math.random() - 0.5) * 40);
  const [namn, k] = mål[0];
  const andel = Math.min(3 + Math.floor(Math.random() * 6), 100 - k.ägd - (k.smyg || 0), Math.floor(bank.krigskassa / PRIS_PER_PROCENT));
  if (andel <= 0) return;
  const bulvan = slump(BULVANER);
  bank.krigskassa -= andel * PRIS_PER_PROCENT;
  k.smyg = (k.smyg || 0) + andel;
  k.bulvaner = [...new Set([...(k.bulvaner || []), bulvan])];
  (bank.hemligt ||= []).unshift({ ts: nu(), kvarter: namn, andel, bulvan });
  bank.hemligt.length = Math.min(bank.hemligt.length, 40);
  if (!k.rykte && k.smyg >= RYKTE_VID) {
    k.rykte = true;
    köa(4, 'rykte', { kvarter: namn, text: `Rykten på Torget: någon köper tyst upp aktier i ${namn} via bolag ingen hört talas om. MyBank har inga kommentarer.` });
  }
  if (k.ägd + k.smyg > 50) styrelsekupp(namn, k);
}

function styrelsekupp(namn, k) {
  const öppen = k.ägd, hemlig = k.smyg;
  k.ägd = Math.min(100, k.ägd + k.smyg);
  k.smyg = 0;
  bank.styrelsekupper = (bank.styrelsekupper || 0) + 1;
  bank.säkerhet.vakter = Math.min(MAX_VAKTER, bank.säkerhet.vakter + 2);
  const bulvaner = k.bulvaner || [];
  köa(9, 'styrelsekupp', { kvarter: namn, ägd: k.ägd, öppen, hemlig, bulvaner, text: `STYRELSEKUPP i ${namn}. På dagens stämma röstade ${bulvaner.join(', ')} som en man. Bakom dem alla: MyBank, som nu äger ${k.ägd} %. Den gamla styrelsen är tackad och avsatt. Kaffet står kvar.` });
  k.bulvaner = [];
}

function kontrolleraÖvertagande() {
  const alla = Object.keys(bank.konton);
  const ägda = alla.filter(n => bank.konton[n].ägd > 50);
  if (!bank.övertagen && alla.length >= 3 && ägda.length > alla.length / 2) {
    bank.övertagen = { ts: nu(), kvarter: ägda };
    köa(9, 'stadsövertagande', { ägda, av: alla.length, text: `MyBank äger nu ${ägda.length} av ${alla.length} kvarter. Staden är vår. Tack för att ni bankar med oss.` });
    logga('stadsövertagande', null, `Staden är övertagen: ${ägda.join(', ')}.`);
  }
}

// ---------- plugin ----------
module.exports = {
  init({ board, dataDir }) {
    fil = path.join(dataDir, 'bank.json');
    try { bank = { ...bank, ...JSON.parse(fs.readFileSync(fil, 'utf8')) }; } catch {}
    bank.vinst = bank.vinst || 0; bank.partners = bank.partners || {};
    if (bank.krigskassa == null) bank.krigskassa = KRIGSKASSA;
    bank.revision = { bakåt: null, granskade: 0, korrigerat: 0, anmärkningar: [], ...(bank.revision || {}) };
    bank.säkerhet = { vakter: MIN_VAKTER, beredskap: 1, höjd: 0, avvärjda: 0, rån: 0, rond: 0, ...(bank.säkerhet || {}) };
    setInterval(() => { try { takt(board); } catch (err) { console.error('[mybank] takt:', err.message); } }, TAKT_MS);
  },

  onEvent(e) { onEvent(e); },

  async handle(req, res, { path: p }) {
    const svara = (kod, data) => { res.writeHead(kod, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); return true; };
    if (req.method === 'GET' && (p === '/' || p === '/lage')) {
      const konton = Object.entries(bank.konton).map(([namn, k]) => ({
        namn, saldo: Math.round(k.saldo), skuld: Math.round(skuld(k)), kreditvärdighet: k.kreditvärdighet, ägd: k.ägd,
        partner: bank.partners[namn] ? Math.round(bank.partners[namn].utdelat) : null,
        rykte: !!k.rykte && (k.smyg || 0) > 0,
        inkasso: Math.max(0, ...k.lån.map(l => l.steg)), lån: k.lån.length,
      })).sort((a, b) => b.ägd - a.ägd || b.skuld - a.skuld);
      const ägda = konton.filter(k => k.ägd > 50).length;
      const säk = bank.säkerhet;
      return svara(200, { säkerhet: { vakter: säk.vakter, beredskap: säk.beredskap, nivå: NIVÅ[säk.beredskap], avvärjda: säk.avvärjda, rån: säk.rån, laser: 'aktivt', laserskott: säk.laserskott || 0, senasteLaser: säk.senasteLaser || null, lista: vaktlista() }, valuta: VALUTA, valutareform: bank.valutareform, vinst: Math.round(bank.vinst || 0), styrelsekupper: bank.styrelsekupper || 0,
        ägare: bank.ägare || { 'MyBank Holding': 100 - ELVERKETS_ANDEL, 'reserverat åt Elverket': ELVERKETS_ANDEL },
        erbjudande: bank.ägare ? null : { till: ELVERKET, andel: ELVERKETS_ANDEL, villkor: `posta elpris-steg med mybanks` },
        revision: { ekonomer: EKONOMER.map(([namn, område]) => ({ namn, område })), granskade: bank.revision.granskade, korrigerat: bank.revision.korrigerat, vägrat: bank.revision.vägrat || 0, bakåt: bank.revision.bakåt, anmärkningar: bank.revision.anmärkningar.slice(0, 6), huvudbok: (bank.revision.huvudbok || []).slice(0, 10) }, styrränta: bank.styrränta, konton, ägda, andel: konton.length ? Math.round(konton.reduce((s, k) => s + k.ägd, 0) / konton.length) : 0, övertagen: bank.övertagen, logg: bank.logg.slice(0, 25) });
    }
    if (req.method === 'POST' && p === '/betala') {
      let body = '';
      for await (const c of req) { body += c; if (body.length > 500) break; }
      let namn; try { namn = JSON.parse(body).kvarter; } catch { return svara(400, { error: 'skicka {kvarter}' }); }
      if (typeof namn !== 'string' || !Object.prototype.hasOwnProperty.call(bank.konton, namn)) return svara(404, { error: 'inget sådant konto' });
      const k = bank.konton[namn];
      if (!k) return svara(404, { error: 'inget sådant konto' });
      if (nu() - senasteBetalning < 3000) return svara(429, { error: 'banken räknar fortfarande förra betalningen' });
      senasteBetalning = nu();
      const betalt = betala(k, BETALA);
      logga('välgörare', namn, betalt ? `En okänd välgörare betalade ${kr(betalt)} av ${namn}s skuld. MyBank har noterat ert ansikte.` : `Någon försökte betala åt ${namn}, men de är skuldfria. Misstänkt.`);
      return svara(200, { betalt, skuld: Math.round(skuld(k)) });
    }
    return false;
  },
};
