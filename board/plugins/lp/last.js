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
// Värden får vara NEGATIVA (se laddaUpp) — den dagen någon äger vädret och det
// ska kunna KYLA nätet är det bara att lägga till en rad här, ingen omskrivning
// av modellen. Just nu finns ingen sådan rad, för ingen äger vädret.
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
};
