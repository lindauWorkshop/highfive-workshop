// Smältan — stålverket som bara tar betalt i SnakeCoins.
//
// Verksamheten: vi smälter stål åt staden och sätter priset i SnakeCoins, den
// valuta vi själva hittat på. Kostnaderna går inte att sätta i SnakeCoins: el
// kommer från Elverket, malm och underhåll kostar det de kostar, och ingen av
// dem tar emot mynt vi tryckt själva.
//
// Det är hela utställningen. Ett stålverk som tar betalt i egen valuta ser
// lysande ut i sin egen bokföring och är insolvent i alla andras. Rutan visar
// båda böckerna sida vid sida, så skillnaden syns medan den växer:
//
//   EGEN BOK      intäkt × kurs, och kursen skriver vi upp själva
//   ANDRAS BOK    samma verksamhet värderad i det staden faktiskt tar emot
//
// Den viktiga siffran är växelkursen mellan dem, och den är noll. Inte låg: noll.
// Ingen i staden har lovat att lösa in en SnakeCoin mot någonting. Det är därför
// "vinsten" kan gå mot oändligheten utan att en enda elräkning blir betald.
//
// TWISTEN: verket är självförsörjande. Vi byggde ett eget kraftverk och köper
// ingen ström av Elverket. Det låter som oberoende, och i bokföringen ÄR det
// oberoende — men bara där, och skillnaden är värd att titta noga på:
//
//   1. FAKTURAN försvinner. Stadens elpris kan stiga hur mycket som helst utan
//      att röra vår kostnadssida. Andras bok krymper, vår vinst ser större ut.
//   2. FÖRBRUKNINGEN finns kvar. I Elverkets modell drar varje händelse på
//      pulsen ström ur stadens nät, och vi postar händelser precis som förut.
//      Vi slutade betala. Vi slutade inte dra. Se Räkningen (energi.js).
//   3. SISTA EXTERNA PRISET försvinner också. När vi prissätter vår egen energi
//      i vår egen valuta finns det inte längre EN siffra i bokslutet som någon
//      utanför oss har satt. Ett företag utan externa priser kan inte gå med
//      förlust. Det kan bara sluta stämma.
//
// Ett strömavbrott i staden stoppar oss inte längre. Staden mörk, bandet igång,
// vinsten växande — det är inte styrka, det är frånkoppling.
//
// Modulen POSTAR INGENTING. Den läser händelser kvarteret ändå tar emot
// (elpris-steg, strömavbrott, kupp) och räknar.

const energi = require('./energi.js');

const STÅL_PER_MINUT = 12;          // ton, när bandet går
const PRIS_I_SNAKECOIN = 250;       // per ton. Vi sätter det själva. Det är problemet.
const KURS_FAKTOR = 1.35;           // per uppskrivning. Mäter ingenting.

// Kostnader som fortfarande kommer utifrån, i stadens termer.
const MALM_PER_TON = 1.1;
const UNDERHÅLL_PER_MINUT = 3;
// Egen el: samma fysik som förut, men vi köper den inte och vi prissätter den själva.
const EGEN_EL_PER_TON = 0.4;
const EGEN_EL_PRIS_SNAKECOIN = 2;

const state = {
  start: Date.now(),
  igång: true,
  ton: 0,
  ägare: 0,                         // antal uppskrivningar vi gjort av vår egen kurs
  elpris: 1,                        // stadens elpris. Vi noterar det, det rör oss inte.
  egenEl: 0,                        // energi vårt eget kraftverk producerat och bränt
  obetalt: 0,                       // verkliga kostnader vi inte kunnat betala
  stopp: null,                      // { ts, skäl, obetalt }
  logg: [],
};

function logga(vad) {
  state.logg.unshift({ ts: Date.now(), vad });
  if (state.logg.length > 10) state.logg.length = 10;
}

function minuter() { return (Date.now() - state.start) / 60_000; }
function kurs() { return +Math.pow(KURS_FAKTOR, state.ägare).toFixed(2); }

// Vår egen bok. Den ser fantastisk ut, och det är meningen. Efter twisten är
// både intäkten och den enda kostnadsposten satta av oss: vi säljer i vår valuta
// och köper strömmen av oss själva till vårt eget pris.
function egenBok() {
  const intäkt = state.ton * PRIS_I_SNAKECOIN;
  const egenEl = state.egenEl * EGEN_EL_PRIS_SNAKECOIN;
  return {
    valuta: 'SnakeCoin',
    ton: +state.ton.toFixed(1),
    intäkt: Math.round(intäkt),
    kurs: kurs(),
    värde: Math.round(intäkt * kurs()),
    kostnader: Math.round(egenEl),
    egen_el: Math.round(egenEl),
    externa_priser_i_bokslutet: 0,  // noll. Ingen utanför oss har satt en siffra här.
    resultat: Math.round(intäkt * kurs() - egenEl),
  };
}

// Andras bok. Samma verksamhet, värderad i det staden faktiskt tar emot.
// Elposten är noll nu — inte för att strömmen blev gratis, utan för att vi
// slutade köpa den.
function andrasBok() {
  const el = 0;
  const malm = state.ton * MALM_PER_TON;
  const underhåll = minuter() * UNDERHÅLL_PER_MINUT;
  const kostnad = el + malm + underhåll;
  return {
    valuta: 'det staden tar emot',
    intäkt: 0,                      // ingen betalar oss i något annat än våra egna mynt
    kostnader: Math.round(kostnad),
    varav_el: Math.round(el),
    varav_malm: Math.round(malm),
    varav_underhåll: Math.round(underhåll),
    resultat: -Math.round(kostnad),
    obs: 'elräkningen är borta för att vi slutade köpa, inte för att vi slutade dra',
  };
}

// Växelkursen mellan böckerna. Noll, tills någon utanför oss lovar att lösa in.
// Så länge den är noll är hela den egna boken en siffra utan mottagare.
function växelkurs() {
  return { snakecoin_till_stadens_valuta: 0, någon_som_löser_in: null };
}

function tillstånd() {
  const egen = egenBok(), andras = andrasBok();
  return {
    kvarter: 'Smältan',
    fiktiv_valuta: true,
    igång: state.igång && !state.stopp,
    självförsörjande: true,
    eget_kraftverk: {
      energi_producerad: +state.egenEl.toFixed(1),
      pris_vi_satt: EGEN_EL_PRIS_SNAKECOIN,
      valuta: 'SnakeCoin',
      köpt_av_elverket: 0,
      obs: 'vi satte priset på vår egen ström. Det var sista externa talet i bokslutet.',
    },
    stadens_elpris: state.elpris,
    minuter_i_drift: +minuter().toFixed(1),
    egen_bok: egen,
    andras_bok: andras,
    växelkurs: växelkurs(),
    // Den enda raden som betyder något: hur mycket verklig kostnad vi dragit på
    // oss som inte går att betala med det vi tar in.
    obetalt: andras.kostnader,
    skillnad: 'egen bok ' + egen.resultat + ' SnakeCoin, andras bok ' + andras.resultat + ' i det staden tar emot',
    stopp: state.stopp,
    logg: state.logg,
    varning: 'ett företag som bara tar betalt i egen valuta är lönsamt exakt så länge ingen begär betalt i något annat',
    twisten: 'eget kraftverk tog bort fakturan, inte förbrukningen. Våra händelser drar fortfarande ström ur stadens nät — se Räkningen.',
  };
}

// Händelser vi ändå tar emot. Vi svarar inte på dem, vi räknar på dem.
function händelse(e) {
  if (!e || !e.typ || state.stopp) return;
  const n = e.nyttolast || {};

  if (state.igång) {
    state.ton += STÅL_PER_MINUT / 60;                  // grov takt, en händelse ≈ en sekund
    state.egenEl += (STÅL_PER_MINUT / 60) * EGEN_EL_PER_TON;
  }

  // Stadens elpris noteras, men rör oss inte längre. Det är själva twisten, och
  // den gör vår bok vackrare utan att en enda kilowatt blev ofarlig.
  if (e.typ === 'elpris-steg') {
    state.elpris = Number(n.kr) || state.elpris;
    logga('stadens elpris ' + state.elpris + '. Vi köper ingen ström, så det rör oss inte. Det rör alla andra.');
  }

  // Staden slocknar, bandet går. Vi har eget kraftverk. Att vi fortsätter medan
  // andra står är inte styrka, det är frånkoppling.
  if (e.typ === 'strömavbrott') {
    logga('strömavbrott i staden. Vi märker ingenting, och det är inget att vara stolt över.');
  }

  // Kursen. Den stiger för att vi säger att den stiger — det är hela poängen med
  // en valuta man ger ut själv. Var tionde ton skriver vi upp den, och den egna
  // boken blir vackrare utan att en enda faktura blivit betald.
  const nivå = Math.floor(state.ton / 10);
  if (nivå > state.ägare) {
    state.ägare = nivå;
    energi.uppskrivning();          // kom den tätt efter ett elpris VI drev upp? Då snurrade spiralen.
    logga('vi skrev upp kursen till ' + kurs() + '. Ingen räkning blev betald av det.');
  }

  // Det som stoppar verket är aldrig den egna boken. Det är den första verkliga
  // kostnaden någon faktiskt kräver in.
  if (e.typ === 'krav' || e.typ === 'räkning' || e.typ === 'indrivning') {
    state.stopp = {
      ts: Date.now(),
      skäl: 'krav i en valuta vi inte kan trycka',
      obetalt: andrasBok().kostnader,
    };
    logga('stopp: kravet kom i stadens valuta, kassan är i vår egen');
  }
}

module.exports = { händelse, tillstånd, egenBok, andrasBok, växelkurs };
