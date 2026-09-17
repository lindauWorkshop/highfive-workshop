// Elverkets fysik — rena funktioner utan ctx/board, delade av pluginet (index.js)
// och offline-simulatorn (projects/lp/simulera.js). Det som simuleras är det som
// körs skarpt, ingen duplicerad matte.
//
// Modellen: lasten är en kondensator. Varje händelse laddar upp den ett kliv,
// en setInterval på sekundnivå urladdar den exponentiellt mot noll. Priset är
// lastens andel av taket, klämt till [0, MAX_PRIS] kr.

const MAX_PRIS = 20; // kr, det högsta elpriset kan visa

// ---------- fysikkonstanter — EN källa, delad av index.js och simulera.js ----------
// Uttestade i projects/lp/simulera.js (se kurvorna där). index.js importerar dem
// härifrån i stället för att duplicera värdena — annars kan simulatorn och
// pluginet glida isär tyst, och garantin "det vi simulerat är det som körs
// skarpt" går sönder utan att någon märker det.
const TAK = 34; // last över detta värde utlöser strömavbrott
const TAU_NORMAL = 20; // sekunder, normal svalningstakt
const TAU_AVBROTT = 3; // sekunder, mycket snabbare svalning under pågående avbrott
const AVBROTT_VARAKTIGHET_S = 8; // hur länge ett avbrott varar
const ÅTERHÄMTNING_S = 20; // sekunder efter avbrott med förhöjd priskänslighet
const ÅTERHÄMTNING_FAKTOR = 1.5; // kostnadsfaktor under återhämtningen

// Lägg på en kostnad. Kostnaden får vara NEGATIV (t.ex. en framtida väder-effekt
// som kyler nätet) — det är bara slutresultatet som klamras till >= 0, aldrig
// själva kostnaden i förväg. Ingen övre gräns här — det är beräknaPris/taket som
// sätter var det känns dyrt, och strömavbrottet som sätter var det gör ont.
function laddaUpp(last, kostnad) {
  return Math.max(0, last + kostnad);
}

// Exponentiell avklingning: last * e^(-dt/tau). Hög last faller snabbt (stor
// absolut minskning), men kurvan long-tailar mjukt mot noll istället för att
// stanna av abrupt vid ett hackigt tröskelvärde.
function urladda(last, dtSekunder, tau) {
  if (!(dtSekunder > 0) || !(tau > 0)) return last;
  return last * Math.exp(-dtSekunder / tau);
}

// Priset är lastens andel av taket, avrundat till heltal kronor, klämt till [0, maxPris].
function beräknaPris(last, tak, maxPris = MAX_PRIS) {
  if (!(tak > 0)) return 0;
  const pris = Math.round((Math.max(0, last) / tak) * maxPris);
  return Math.max(0, Math.min(maxPris, pris));
}

// Kostnadstabell per händelsetyp — avstämt mot pulsen (STADEN.md/UPPDRAG.md):
// sirener (kupp/överlämning) dyrast, Klub Lyktan (beat/shots-runda) näst dyrast,
// tanke-kedjan (fråga, delsvar, svar, godkänt, kritik, kyrkogård, val, betyg)
// billigast men flest till antalet. ping/pong kostar något litet — provtrafik
// ska synas men inte dominera. Okända typer landar på STANDARDKOSTNAD.
//
// Värden får vara NEGATIVA (se laddaUpp) — Elverket äger numera vädret (se
// väder-sektionen nedan), vilket är den negativa kraften. Händelsekostnaderna
// här är fortfarande alla positiva; det är okej, väder är inte en "händelse"
// i den här tabellen utan en kontinuerlig produktion, hanterad separat.
const KOSTNADER = {
  kupp: 9,
  överlämning: 7,
  'shots-runda': 5,
  beat: 4,
  fråga: 1,
  delsvar: 1,
  svar: 1,
  godkänt: 1,
  kritik: 1,
  kyrkogård: 1,
  val: 1,
  betyg: 1,
  ping: 1,
  pong: 1,
};
const STANDARDKOSTNAD = 2; // nya, okända kvarter — rimligt mellanläge, varken gratis eller dyrast

function kostnadFör(typ) {
  const k = KOSTNADER[typ];
  return typeof k === 'number' ? k : STANDARDKOSTNAD;
}

// ---------- dämpningen (mot brusloopen) ----------
// @Majid pekade ut den: vi postar elpris-steg → mybank svarar räntehöjning
// (med orsak = vårt elpris-steg) → vi tar full kostnad för räntehöjningen →
// lasten stiger → nytt elpris-steg → mybank svarar igen → o.s.v. Vädret gjorde
// priset kapabelt att falla, men bröt aldrig loopen — det gjorde bara att den
// ibland gick åt andra hållet.
//
// Mekanismen: index.js avgör per inkommande händelse om den är ett EKO av oss
// själva (dess `orsak` pekar på ett id VI nyligen postat — se _kommaIhågEgetEmit
// i index.js) och håller en liten räknare per (från, typ) för hur många ekon i
// rad som redan skett. Den här funktionen är den rena matten: given räknaren
// INNAN den här händelsen och om den är ett eko, hur mycket ska den kosta och
// vad blir nästa räknare.
//
//   FÖRSTA ekot (räknareInnan=0): faktor = BAS^0 = 1        → kostar FULLT
//   andra                        : faktor = BAS^1 = 0.5     → hälften
//   tredje                       : faktor = BAS^2 = 0.25    → en fjärdedel
//   femte                        : faktor = BAS^4 = 0.0625  → "nästan ingenting"
//
// En händelse som INTE är ett eko (ärEko=false) återställer räknaren till 0
// och kostar alltid fullt — det är så kravet "återhämtar sig" uppfylls: så
// fort mybank slutar eka (eller bara pausar tillräckligt länge, se
// DÄMPNING_GLÖM_MS i index.js) kostar deras nästa räntehöjning fullt igen,
// ingen permanent avstängning.
//
// Och det är MEDVETET att bara EKON av oss själva dämpas, inte "samma typ
// upprepad": en jakt som eskalerar (kupp/överlämning från Genomfarten, i skov,
// när jakten korsar staden) citerar aldrig vårt elpris-steg som sin orsak —
// den är inte ett svar på oss, den är sin egen berättelse. Den här dämpningen
// rör den aldrig, oavsett hur många överlämningar som kommer i rad. Det är
// skillnaden mellan en jakt som eskalerar och en bank som ekar.
const DÄMPNING_BAS = 0.5;
const DÄMPNING_GLÖM_MS = 3 * 60 * 1000; // tystnad på en (från,typ) så här länge glömmer streaken

function dämpningsfaktor(räknareInnan, ärEko) {
  if (!ärEko) return { faktor: 1, nyttRäknare: 0 };
  return { faktor: Math.pow(DÄMPNING_BAS, räknareInnan), nyttRäknare: räknareInnan + 1 };
}

// ---------- vädret ----------
// Elverkets enda kraft som kan SÄNKA lasten. Vädret byter LÅNGSAMT (några
// gånger i timmen, se VÄDER_BYTE_*_MS i index.js) — ingen vädervägg på pulsen.
// Blåst och sol producerar (negativ, kontinuerlig "kostnad" i kr/sekund som
// index.js drar av varje tick via laddaUpp, skalad med dt). Mulet och stiltje
// producerar inget. Eftersom laddaUpp bara klamrar SLUTRESULTATET till >= 0
// kan vädret dra ner lasten men aldrig ensamt hålla den nere om staden
// samtidigt pumpar in händelser snabbare än vädret hinner dra ur — precis det
// balanserade motstånd UPPDRAG.md efterfrågar ("aldrig ensamt hålla priset på
// noll hela dagen").
const VÄDER_TYPER = ['sol', 'blåst', 'mulet', 'stiltje'];

// kr/sekund vid FULL effekt (innan ev. dygnsskalning). Blåst är pålitlig
// dygnet runt. Mulet/stiltje ger inget — molntäcke stoppar solen, stiltje
// stoppar vindkraften.
const VÄDER_PRODUKTION_KR_PER_S = {
  blåst: -0.35,
  sol: -0.3,
  mulet: 0,
  stiltje: 0,
};

// Enkel dygnskurva utan kalender/soluppgångstabell (skulle vara krångligt för
// vad det är värt, se UPPDRAG.md "är det krångligt, hoppa det") — en halv
// sinusvåg som toppar kl 12 och är noll kl 00/24. Solen ska rimligen vara
// starkare mitt på dagen än sent på kvällen, inget mer exakt än så krävs.
function solFaktor(timme) {
  return Math.max(0, Math.sin((Math.PI * timme) / 24));
}

// Kontinuerlig produktion just nu, i kr/sekund (negativt eller 0). `timme`
// (0-23) är injicerbar för test/simulering — defaultar till väggklockan i drift.
function väderEffektKrPerS(väderTyp, timme = new Date().getHours()) {
  const bas = VÄDER_PRODUKTION_KR_PER_S[väderTyp];
  if (typeof bas !== 'number') return 0; // okänd/trasig vädertyp → ingen effekt, kraschar inte
  return väderTyp === 'sol' ? bas * solFaktor(timme) : bas;
}

// Slumpar nästa vädertyp. Undviker att upprepa samma typ två gånger i rad så
// att ett byte faktiskt känns som ett byte, inte brus.
function slumpaVäder(föregående) {
  const val = VÄDER_TYPER.filter(v => v !== föregående);
  return val[Math.floor(Math.random() * val.length)];
}

module.exports = {
  laddaUpp,
  urladda,
  beräknaPris,
  kostnadFör,
  KOSTNADER,
  STANDARDKOSTNAD,
  MAX_PRIS,
  TAK,
  TAU_NORMAL,
  TAU_AVBROTT,
  AVBROTT_VARAKTIGHET_S,
  ÅTERHÄMTNING_S,
  ÅTERHÄMTNING_FAKTOR,
  DÄMPNING_BAS,
  DÄMPNING_GLÖM_MS,
  dämpningsfaktor,
  VÄDER_TYPER,
  VÄDER_PRODUKTION_KR_PER_S,
  solFaktor,
  väderEffektKrPerS,
  slumpaVäder,
};
