// Energiräkningen — vad SnakeCoin kostar staden i ström.
//
// Synergin mellan Elverket, Smältan och SnakeCoin är inte en affär. Den är en
// räkning, och den går att ställa ut på öret tack vare hur Elverket (team lp)
// byggt sitt kvarter:
//
//   "varje händelse på #staden-puls drar ström. Elverket håller en fysisk last,
//    sätter priset som en funktion av lasten, och postar tillbaka elpris-steg
//    med orsak satt till händelsen som drev upp det."
//
// Det betyder att ATTRIBUTIONEN är exakt. Kommer ett {typ:'elpris-steg'} med
// orsak = en av VÅRA händelser, då var det vår händelse som lyfte priset. Ingen
// gissning, ingen modell: deras egen orsakskedja.
//
// Och där ligger hela poängen med en egen valuta:
//
//   Att ge ut en SnakeCoin kostar oss ingenting. Vi skriver en siffra.
//   Men varje händelse vi postar för att göra det drar ström i stadens nät,
//   priset stiger för alla, och räkningen hamnar hos Elverket och hos varje
//   kvarter som råkar behöva el samtidigt.
//
// Det är inte gratis pengar. Det är pengar vars kostnad någon annan betalar.
// Smältan gör samma sak en gång till: den smälter stål med riktig ström och
// tar betalt i mynt vi tryckt själva.
//
// SPIRALEN är det obehagligaste vi kan visa, och den är äkta:
//   elpriset stiger → vår kostnad i stadens valuta stiger → vi skriver upp
//   SnakeCoin-kursen för att "täcka" den → uppskrivningen kräver händelser →
//   händelserna driver upp lasten → elpriset stiger.
// Vi svarar på en verklig kostnad med att trycka mer, och det gör kostnaden större.
//
// LYSSNAR PÅ: elpris-steg, strömavbrott (från Elverket)
// POSTAR: ingenting. Det här är en räkning, inte ett erbjudande.

const ELVERKET = 'lp';

const state = {
  egna: new Set(),                 // id på händelser vi själva postat
  vårasteg: [],                    // { id, kr, orsak, ts } — steg som VÅR händelse drev
  allaSteg: 0,
  förstaPris: null,
  senastePris: null,
  avbrott: 0,
  avbrottAvOss: 0,
  spiralvarv: 0,
  senasteVårtSteg: null,
  logg: [],
};

function logga(vad) {
  state.logg.unshift({ ts: Date.now(), vad });
  if (state.logg.length > 10) state.logg.length = 10;
}

// Kalla in varje gång vi själva postat något på pulsen.
function egen(id) {
  if (!id) return;
  state.egna.add(id);
  if (state.egna.size > 400) state.egna.delete(state.egna.values().next().value);
}

// Kalla in när vi skrivit upp kursen. Kom det tätt efter ett elpris-steg som VI
// orsakade har spiralen snurrat ett varv till.
function uppskrivning() {
  if (state.senasteVårtSteg && Date.now() - state.senasteVårtSteg < 60_000) {
    state.spiralvarv++;
    logga('spiralen snurrade: vi svarade på ett elpris vi själva drev upp med att trycka mer');
  }
}

function händelse(e) {
  if (!e || !e.typ) return;
  const n = e.nyttolast || {};

  if (e.typ === 'elpris-steg' && e.från === ELVERKET) {
    const kr = Number(n.kr);
    state.allaSteg++;
    if (state.förstaPris === null && Number.isFinite(kr)) state.förstaPris = kr;
    if (Number.isFinite(kr)) state.senastePris = kr;

    if (e.orsak && state.egna.has(e.orsak)) {
      state.vårasteg.push({ id: e.id, kr, orsak: e.orsak, ts: e.ts });
      if (state.vårasteg.length > 60) state.vårasteg.shift();
      state.senasteVårtSteg = Date.now();
      logga('vår händelse ' + e.orsak + ' lyfte stadens elpris till ' + kr);
    }
    return;
  }

  if (e.typ === 'strömavbrott' && e.från === ELVERKET) {
    state.avbrott++;
    if (e.orsak && state.egna.has(e.orsak)) {
      state.avbrottAvOss++;
      logga('strömavbrottet utlöstes av vår händelse. Vår valuta släckte staden.');
    }
    return;
  }
}

// Räkningen. mynt = antal SnakeCoin vi gett ut (Smältans intäkt).
function räkningen(mynt = 0) {
  const steg = state.vårasteg.length;
  const höjning = state.förstaPris !== null && state.senastePris !== null
    ? +(state.senastePris - state.förstaPris).toFixed(2) : null;
  return {
    våra_elprissteg: steg,
    alla_elprissteg: state.allaSteg,
    andel_av_stegen: state.allaSteg ? +(steg / state.allaSteg).toFixed(2) : 0,
    elpris_nu: state.senastePris,
    elpris_höjning: höjning,
    strömavbrott: state.avbrott,
    strömavbrott_av_oss: state.avbrottAvOss,
    spiralvarv: state.spiralvarv,
    mynt_utgivna: Math.round(mynt),
    // Vad det kostade staden att vi gav ut tusen mynt: antal elprissteg vi drev
    // upp per tusen SnakeCoin. Vår kostnad för samma mynt är noll.
    stadens_pris_per_1000_mynt: mynt > 0 ? +((steg / mynt) * 1000).toFixed(2) : null,
    vår_kostnad_per_1000_mynt: 0,
    sanning: 'att ge ut valutan kostar oss ingenting och staden ström. Det är inte gratis pengar, det är pengar någon annan betalar för.',
    logg: state.logg,
  };
}

module.exports = { egen, uppskrivning, händelse, räkningen, ELVERKET };
