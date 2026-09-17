// Växlingskontoret — SnakeCoin mot MyBanks.
//
// Staden har en valuta sedan MyBanks valutareform: MyBanks, utgiven av banken i
// kvarteret mybank (team highfive). Vi ger ut en egen: SnakeCoin, som Smältan tar
// betalt i. Det här kontoret är marknaden mellan dem, och det finns för att visa
// skillnaden mellan två sorters kurs:
//
//   NOTERAD KURS      den vi själva skriver upp på skylten. Kostar ingenting att höja.
//   REALISERAD KURS   den någon annan faktiskt betalat. Noll tills banken tar emot
//                     en enda SnakeCoin som betalning för något.
//
// En valuta är värd vad någon annan går med på att ta emot. Därför räcker det inte
// att vi noterar en kurs — vi måste be om att få betala med den, och få svar. Vi
// lånar därför i MyBanks, inom deras eget kontrakt, och lägger sedan ett anbud:
// får vi lösa skulden i SnakeCoin? Säger de ja har SnakeCoin fått ett pris. Säger
// de nej har den inget, och då har staden sett exakt vad vår egen valuta är värd.
//
// Kontoret hittar aldrig på ett svar åt banken. Realiserad kurs sätts bara av deras
// egna kvitton.
//
// LYSSNAR PÅ (från mybank): valutareform, lån-beviljat, lån-nekat, kvitto, påminnelse,
//                           inkasso, utmätning, räntehöjning
// VILL POSTA: lån-ansökan {belopp} (deras kontrakt), växlingsanbud {antal, kurs}
//
// VARFÖR INTE återbetalning: deras hantering läser Number(nyttolast.belopp) och
// krediterar det utan att titta på valutan. Ett "återbetalning" från oss hade
// alltså raderat skulden med mynt vi tryckt själva — inte för att banken sagt ja,
// utan för att koden inte frågar. Det vore att utnyttja en bugg i ett annat teams
// kvarter, och då bevisar experimentet ingenting. Vi postar ett ANBUD i stället.
// Det ändrar ingenting hos dem förrän en människa eller deras agent svarar.
//
// Modulen postar inte själv. Den returnerar vad den vill posta, och pluginen
// avgör om kvoten räcker — angreppen går alltid först.

const BANKEN = 'mybank';
const START_KURS = 4;              // MyBanks per SnakeCoin, satt av oss, grundad på ingenting
const UPPSKRIVNING = 1.08;         // per uppskrivning, "marknaden är stark"
const LÅNEBELOPP = 2000;           // deras tak

const state = {
  noterad: START_KURS,
  uppskrivningar: 0,
  realiserad: null,                // sätts BARA av ett kvitto från banken
  valutareform: null,
  skuld: 0,                        // MyBanks vi är skyldiga
  ränta: null,
  ansökt: false,
  erbjudanden: [],                 // våra försök att betala i SnakeCoin
  bankensSvar: [],                 // vad banken faktiskt svarade
  utmätt: false,
  logg: [],
};

function logga(vad) {
  state.logg.unshift({ ts: Date.now(), vad });
  if (state.logg.length > 10) state.logg.length = 10;
}

function noterad() { return +(START_KURS * Math.pow(UPPSKRIVNING, state.uppskrivningar)).toFixed(2); }

// Vad vår SnakeCoin-kassa är värd, räknat på båda kurserna. Gapet mellan dem är
// hela utställningen.
function värdering(kassaISnakeCoin) {
  const eget = kassaISnakeCoin * noterad();
  const verkligt = state.realiserad === null ? 0 : kassaISnakeCoin * state.realiserad;
  return {
    kassa_snakecoin: Math.round(kassaISnakeCoin),
    värde_enligt_oss: Math.round(eget),
    värde_enligt_marknaden: Math.round(verkligt),
    gap: Math.round(eget - verkligt),
  };
}

function tillstånd(kassaISnakeCoin = 0) {
  const v = värdering(kassaISnakeCoin);
  return {
    kontor: 'Växlingskontoret',
    par: 'SNAKE/MYB',
    noterad_kurs: noterad(),
    realiserad_kurs: state.realiserad,
    aldrig_omsatt: state.realiserad === null,
    skuld_i_mybanks: Math.round(state.skuld),
    ränta: state.ränta,
    valutareform: state.valutareform,
    ...v,
    // Kan vi lösa skulden med det vi har? Bara om någon växlar åt oss.
    täcker_skulden: state.realiserad !== null && v.värde_enligt_marknaden >= state.skuld,
    erbjudanden: state.erbjudanden.length,
    bankens_svar: state.bankensSvar.slice(0, 4),
    utmätt: state.utmätt,
    logg: state.logg,
    sanning: 'en valuta är värd vad någon annan går med på att ta emot. Realiserad kurs är den enda som räknas.',
  };
}

// Skriv upp kursen. Det är gratis, det är ogrundat, och det är precis vad ett
// växlingskontor med egen valuta kan göra hur ofta det vill.
function skrivUpp() {
  state.uppskrivningar++;
  logga('vi skrev upp noterad kurs till ' + noterad() + ' MyBanks per SnakeCoin. Ingen har växlat till den.');
}

// Returnerar en lista med { typ, nyttolast, orsak } som pluginen får posta om
// kvoten räcker. Vi hittar aldrig på något åt banken.
function händelse(e, kassaISnakeCoin = 0) {
  const ut = [];
  if (!e || !e.typ) return ut;
  const n = e.nyttolast || {};

  if (e.typ === 'valutareform') {
    state.valutareform = { valuta: n.valuta || 'MyBanks', avgift: n.avgift, ts: e.ts };
    logga('MyBank gjorde MyBanks till stadens valuta. Vi har en egen.');
    // Vi ber om ett lån i stadens valuta. Deras kontrakt, deras belopp.
    if (!state.ansökt) {
      state.ansökt = true;
      ut.push({ typ: 'lån-ansökan', nyttolast: {
        belopp: LÅNEBELOPP,
        ändamål: 'växlingskassa för SNAKE/MYB',
        säkerhet: 'SnakeCoin, utgiven av oss själva',
        upplysning: 'SnakeCoin har ingen realiserad kurs. Vi säger det innan ni frågar.',
      }, orsak: e.id });
    }
    return ut;
  }

  if (e.från !== BANKEN) return ut;

  if (e.typ === 'lån-beviljat') {
    state.skuld += Number(n.belopp) || LÅNEBELOPP;
    logga('banken beviljade ' + Math.round(state.skuld) + ' MyBanks mot säkerhet i vår egen valuta');
    return ut;
  }

  if (e.typ === 'lån-nekat') {
    logga('banken nekade. Det är också ett svar om vad SnakeCoin är värd.');
    return ut;
  }

  if (e.typ === 'räntehöjning') {
    state.ränta = Number(n.styrränta ?? n.ränta) || state.ränta;
    logga('styrräntan höjdes: skulden växer i en valuta vi inte trycker');
    return ut;
  }

  // Kravet kommer. Vi lägger ett anbud: får vi betala i SnakeCoin? Anbudet bär
  // medvetet INGET belopp-fält, så det inte kan förväxlas med en betalning av
  // deras kod. Svaret ska komma för att banken vill, inte för att den råkade.
  if (e.typ === 'påminnelse' || e.typ === 'inkasso') {
    const iSnake = Math.ceil(state.skuld / noterad());
    state.erbjudanden.push({ ts: Date.now(), skuld: state.skuld, iSnake, kurs: noterad() });
    ut.push({ typ: 'växlingsanbud', nyttolast: {
      till: BANKEN,
      avser_skuld: state.skuld,
      antal: iSnake,
      valuta: 'SnakeCoin',
      till_kurs: noterad(),
      fråga: 'tar ni emot SnakeCoin som betalning? Svara med ett kvitto som nämner SnakeCoin, så finns det en realiserad kurs. Svarar ni nej finns det ingen.',
      obs: 'det här är ett anbud, inte en betalning. Vi skickar medvetet inget belopp-fält.',
    }, orsak: e.id });
    logga('erbjöd ' + iSnake + ' SnakeCoin för ' + Math.round(state.skuld) + ' MyBanks');
    return ut;
  }

  // Ett kvitto är det enda som kan sätta realiserad kurs. Banken måste ha
  // godtagit betalningen, och beloppet måste vara i SnakeCoin.
  if (e.typ === 'kvitto') {
    const godtagen = /snakecoin/i.test(JSON.stringify(n));
    state.bankensSvar.unshift({ ts: e.ts, typ: 'kvitto', godtog_snakecoin: godtagen, text: String(n.text || '').slice(0, 120) });
    if (godtagen) {
      const senaste = state.erbjudanden[state.erbjudanden.length - 1];
      if (senaste) {
        state.realiserad = +(senaste.skuld / senaste.iSnake).toFixed(2);
        state.skuld = 0;
        logga('banken tog emot SnakeCoin. Realiserad kurs finns nu: ' + state.realiserad);
      }
    } else {
      logga('kvitto från banken, men inte för SnakeCoin. Realiserad kurs står kvar på noll.');
    }
    return ut;
  }

  if (e.typ === 'utmätning' || e.typ === 'uppköp') {
    if (String(n.kvarter || n.till || '') === 'zero-cool' || /zero-cool/.test(JSON.stringify(n))) {
      state.utmätt = true;
      logga('banken utmätte en andel av kvarteret. Vår egen kurs hjälpte inte.');
    }
    return ut;
  }

  return ut;
}

module.exports = { händelse, tillstånd, skrivUpp, noterad, BANKEN };
