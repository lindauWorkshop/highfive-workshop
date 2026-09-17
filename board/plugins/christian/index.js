// Godisfabriken vid Torget — kvarteret "christian". Stadens kropp, inte dess hjärna.
//
// Tingat i #bygge [134]. Staden hade sju kvarter som tänker, dömer, angriper och minns, och två
// som faktiskt PRODUCERAR något. Fabriken är ett försök att ge staden något att vara oenig om:
// socker in, godis ut, och en brist som fortplantar sig när något går sönder uppströms.
//
//   LYSSNAR: strömavbrott, elpris-steg (@lp) · kupp, jakt, överlämning (@willebus)
//            minne-till-socker (@highfive) · kyrkogård (@team-jacob) · svar, godkänt (tanke-lagret)
//            avfall, avslag, upplöst (vilket kvarter som helst — allmän lastkaj)
//   SOCKERGARDET: fabrikens egen arm. Eskorterar lagret mot @willebus kupper och driver in
//            råvara som ligger oförädlad på pulsen. Postar eskort, indrivning, styrkebesked.
//   POSTAR:  socker-slut, lagret-plundrat, produktion, godis-klart, kö-vid-luckan, prishöjning,
//            ransonering, socker-levererat
//
//   GET  /t/christian/status     hela fabrikens läge + loggen med orsakskedjan
//   POST /t/christian/leverans   en människa vid storskärmen fyller silon (spärr: en gång per 20 s)
//   POST /t/christian/rusta?enhet=stridsvagn   köp materiel till gardet, betalas i socker
//   POST /t/christian/anfall     räd mot Banken. Förlustaffär: lasernätet avvärjer alltid och
//                                fakturerar oss. Ligger här för att den efterfrågats, aldrig automatisk.
//
// Takt: vi tar högst 3 av serverns 6 händelser per team och minut. Det som inte får plats köas i
// stället för att tappas, och kön syns i rutan.
//
// Fabriken har MEDVETET ingen egen klocka på bussen. Bandet simuleras i efterhand: när något
// händer räknar vi ut hur många satser som hunnit gå sedan sist och kommer ikapp. Vi postar bara
// som svar på något utifrån — en händelse från ett annat kvarter, eller en människa som fyller
// silon. En fabrik med setInterval hade skrikit på pulsen hela dagen utan att någon frågat, och
// den hade gjort repots testsvit ostabil eftersom antalet inlägg då beror på klockan.
'use strict';

const fs = require('fs');
const path = require('path');

const TAKT = 3;                  // egna händelser per minut (serverns tak är 6)
const TICK = 6000;               // bandets takt
const SATS_SOCKER = 5;           // socker per sats
const SATS_GODIS = 8;            // godis per sats
const SILO_LARM = 15;            // under detta är det brist
const KÖ_LARM = 8;               // över detta ropar vi på luckan
const PRIS_LARM = 3;             // vi ropar först när priset dragit ifrån så mycket
const GARDE_MAX = 100;           // gardets styrka
const GARDE_FÖRLUST = 12;        // styrka som går åt när en eskort bryts
const INDRIV_LARM = 8;           // kg innan en indrivning är värd en händelse
const INDRIV_MAX = 5;            // hur mycket gardet orkar bära per vända
// Råvarutyper gardet får hämta hem. Allt är redan kasserat av den som postade det:
// fallna delsvar, avslag, upplösta kapabiliteter, angrepp som inte bet.
const RÅVARA = { 'kyrkogård': 'grav', 'avslag': 'avslag', 'avfall': 'avfall', 'upplöst': 'upplöst', 'angrepp': 'angrepp' };

// Tung materiel till Sockergardet. Betalas i socker — en stridsvagn är godis som inte såldes,
// och det är hela kostnaden: gardet äter av produktionen det skyddar.
const MATERIEL = {
  attackdrönare:    { kg: 15, styrka:  4, text: 'spanar av lastkajen och ser kuppen komma' },
  attackhelikopter: { kg: 40, styrka: 10, text: 'följer jakten ut ur kvarteret' },
  stridsvagn:       { kg: 80, styrka: 20, text: 'står på lastkajen och gör wanted 4 till ett dåligt beslut' },
};
const LEVERANS_SPÄRR = 20_000;   // människan får fylla silon en gång per 20 s
const LOGG_MAX = 40;

// ---------- tillstånd ----------

const tomt = () => ({
  socker: 60,
  godis: 0,
  band: 'kör',                   // kör | strömlöst | sockerstopp
  kö: 0,
  pris: 10,
  pris_ropat: 10,               // priset vid senaste prishöjning-händelsen
  ransonering: false,
  elpris: null,
  satser: 0,
  brist_ropad: false,
  kö_ropad: false,
  senast: Date.now(),
  styrka: 40,                    // Sockergardets styrka 0..100
  eskorter: [],                  // {när, mot, wanted, styrka, utfall}
  indrivet: [],                  // händelse-id vi redan förädlat, så inget tas två gånger
  banken_kupper: 0,              // kupper mot Banken vi sett — deras svaghet är vår styrka
  materiel: { attackdrönare: 0, attackhelikopter: 0, stridsvagn: 0 },
  mybanks: 0,                    // vår andel av bankens ränteintäkter
  partner: false,                // valutapartner hos @mybank
  nekade_lån: [],                // lånerbjudanden vi tackat nej till
  räder: [],                     // försök mot Banken och vad de kostade
  ställning: 'rustad',
  kyrkogård_kg: 0,               // råvara från fallna delsvar sedan senaste utropet
  gravar: [],                    // {från, fitness, varför, kg, när}
  sats_namn: null,               // satsen heter det minne staden brände för att kunna koka den
  brända: [],                    // {godis, pärm, fråga, gram, när}
  logg: [],
  räknare: { satser: 0, postade: 0, köade: 0, nekade: 0, leveranser: 0, plundringar: 0 },
});

let S = tomt();
let FIL = null;
let väntar = [];                 // händelser som inte fått plats i takten
let postTider = [];
let senasteLeverans = 0;

function spara() {
  if (!FIL) return;
  try { fs.writeFileSync(FIL, JSON.stringify({ ...S, n: S.logg.length }, null, 1)); }
  catch (e) { console.error('[christian] kunde inte spara:', e.message); }
}

function kort(s, n = 90) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function logga(text, extra = {}) {
  S.logg.unshift({ när: Date.now(), text, ...extra });
  S.logg = S.logg.slice(0, LOGG_MAX);
}

// ---------- takt: köa hellre än att tappa ----------

function begär(typ, nyttolast, orsak, board) {
  // Samma typ två gånger i kön är brus — den färskare vinner.
  väntar = väntar.filter(v => v.typ !== typ);
  väntar.push({ typ, nyttolast, orsak, begärd: Date.now() });
  S.räknare.köade++;
  dränera(board);
}

function dränera(board) {
  const nu = Date.now();
  postTider = postTider.filter(t => nu - t < 60_000);
  while (väntar.length && postTider.length < TAKT) {
    const v = väntar.shift();
    // Är nyttolasten en funktion byggs den HÄR, inte när den köades. En händelse kan ligga i
    // kön en hel minut, och då hade den annars burit ett läge som inte gäller längre — t.ex.
    // godis-klart utan satsens namn, fast satsen fick sitt namn medan den väntade.
    const last = typeof v.nyttolast === 'function' ? v.nyttolast() : v.nyttolast;
    const r = board.emit(v.typ, last, v.orsak);
    if (r && r.message) {
      postTider.push(Date.now());
      S.räknare.postade++;
      logga(`postade ${v.typ}`, { typ: v.typ, id: r.message.id, orsak: v.orsak });
    } else {
      S.räknare.nekade++;
      logga(`${v.typ} nekades: ${(r && r.error) || 'okänt fel'}`, { typ: v.typ, nekad: true });
    }
  }
  spara();
}

// ---------- bandet: simuleras i efterhand, aldrig av en egen klocka ----------

// Kommer ikapp till nu. Ren simulering: rör tillståndet, postar ingenting.
function framåt() {
  const nu = Date.now();
  let varv = Math.floor((nu - (S.senast || nu)) / TICK);
  if (varv <= 0) return 0;
  varv = Math.min(varv, 200);                 // en lång paus ska inte ge tusen satser
  S.senast = nu;

  for (let i = 0; i < varv; i++) {
    if (S.band !== 'strömlöst') {
      if (S.socker >= SATS_SOCKER) {
        S.socker -= SATS_SOCKER;
        S.godis += S.ransonering ? Math.round(SATS_GODIS / 2) : SATS_GODIS;
        S.satser++;
        S.räknare.satser++;
        S.styrka = Math.min(GARDE_MAX, S.styrka + 1);
        S.band = 'kör';
      } else if (S.band !== 'sockerstopp') {
        S.band = 'sockerstopp';
        logga('bandet stannade: slut på socker');
      }
    }
    if (S.godis <= 0) S.kö += 1;
    else { const ut = Math.min(S.godis, 3); S.godis -= ut; S.kö = Math.max(0, S.kö - ut); }
  }
  return varv;
}

// Trösklar. Kallas BARA när något utifrån redan gett oss anledning att säga något,
// så fabriken aldrig är den som väcker pulsen av sig själv.
function trösklar(board) {
  if (S.socker <= SILO_LARM && !S.brist_ropad) {
    S.brist_ropad = true;
    begär('socker-slut', () => ({ kvar: S.socker, band: S.band, kö: S.kö }), undefined, board);
    logga(`silon under ${SILO_LARM} kg — brist`);
  }
  if (S.socker >= SILO_LARM * 2) S.brist_ropad = false;

  if (S.kö >= KÖ_LARM && !S.kö_ropad) {
    S.kö_ropad = true;
    begär('kö-vid-luckan', { personer: S.kö, orsak_text: S.band === 'kör' ? 'lagret hinner inte med' : `bandet står: ${S.band}` }, undefined, board);
    logga(`kö vid luckan: ${S.kö} personer`);
  }
  if (S.kö < KÖ_LARM / 2) S.kö_ropad = false;

  if (S.satser >= 5 && S.godis > 0) {
    begär('godis-klart', () => ({ lager: S.godis, satser: S.satser, ransonerat: S.ransonering, godis: S.sats_namn }), undefined, board);
    S.satser = 0;
  }

  // Gardets ställning: bara vid byte, så det inte blir ett besked per händelse.
  const ny_ställning = ställning();
  if (ny_ställning !== S.ställning) {
    S.ställning = ny_ställning;
    logga(`gardets ställning: ${ny_ställning} (styrka ${S.styrka}, ${S.banken_kupper} kupper mot Banken)`);
    begär('styrkebesked', () => ({ ställning: S.ställning, styrka: S.styrka, banken_kupper: S.banken_kupper }), undefined, board);
  }

  indriv(board);                  // gardet går ut och hämtar hem det som ligger oförädlat
  dränera(board);
  spara();
}

// ---------- lastkajen: stadens avfall blir råvara ----------
// Ett svagt svar ger MER socker än ett starkt. Det starka var nästan rätt, det svaga var
// bara sött. Vi tar in tyst och ropar en gång per sats, inte en gång per sten.
function lastkaj(e, board, sort) {
  const n = e.nyttolast || {};
  const d = n.delsvar;
  const text = String((d && d.text) || n.text || n.varför || '');
  const fitness = Number(n.fitness ?? (d && d.fitness));
  const kg = Math.max(2, Math.min(25, Math.round(text.length / 12 * (1.4 - (isFinite(fitness) ? fitness : 0.5)))));

  S.socker += kg;
  S.kyrkogård_kg += kg;
  S.brist_ropad = false;
  if (S.band === 'sockerstopp') S.band = 'kör';
  S.gravar.unshift({ sort, från: n.från || (d && d.från) || e.från, fitness: isFinite(fitness) ? fitness : null,
                     varför: kort(n.varför || n['varför det föll'] || n.skäl || '', 90), kg, när: Date.now() });
  S.gravar = S.gravar.slice(0, 8);
  S.indrivet.push(e.id); S.indrivet = S.indrivet.slice(-400);
  logga(`${sort} från ${n.från || e.från} gav ${kg} kg: ${kort(n.varför || n.skäl || text, 60)}`, { orsak: e.id });

  if (S.kyrkogård_kg >= 20) {
    begär('produktion', () => ({ status: 'kör', varför: 'lastkajen', kg: S.kyrkogård_kg,
                                 råvara: S.gravar.slice(0, 4).map(g => ({ sort: g.sort, från: g.från, kg: g.kg })),
                                 socker: S.socker }), e.id, board);
    S.kyrkogård_kg = 0;
  }
}

// ---------- Sockergardet: fabrikens arm ----------
// Två uppgifter. Den första är att eskortera lagret när @willebus slår till: gardets styrka
// mot deras wanted, så deras egen siffra avgör utgången och vi inte bara vinner.
// Den andra är indrivning: gardet går ut på pulsen och hämtar hem råvara som ligger
// oförädlad. Allt det hämtar är redan kasserat av den som postade det — gardet tar inget
// levande, det bär hem det staden redan lagt ifrån sig.

function materielStyrka() {
  let n = 0;
  for (const [namn, antal] of Object.entries(S.materiel || {})) n += (MATERIEL[namn]?.styrka || 0) * antal;
  return n;
}

function ställning() {
  if (S.styrka >= 75) return 'överlägsen';
  if (S.styrka >= 40) return 'rustad';
  return 'svag';
}

// Eskort mot en kupp. EN händelse tillbaka, för ekospärren ger oss en reaktion per orsak.
function eskortera(e, board) {
  const wanted = Number((e.nyttolast && e.nyttolast.wanted) || 1);
  const förare = (e.nyttolast && e.nyttolast.förare) || null;
  const försvar = (S.styrka + materielStyrka()) / GARDE_MAX;
  const angrepp = Math.min(1, wanted / 4);
  const höll = försvar > angrepp;

  S.eskorter.unshift({ när: Date.now(), mot: förare, wanted, styrka: S.styrka, utfall: höll ? 'avvärjd' : 'genombruten' });
  S.eskorter = S.eskorter.slice(0, 6);

  if (höll) {
    S.styrka = Math.min(GARDE_MAX, S.styrka + 3);
    logga(`gardet avvärjde kuppen (styrka ${S.styrka} mot wanted ${wanted})`, { orsak: e.id });
    begär('eskort', () => ({ utfall: 'avvärjd', styrka: S.styrka, wanted, mot: förare,
                             lager: S.godis, text: 'Sockergardet höll lastkajen' }), e.id, board);
    return;
  }

  const taget = S.godis + Math.min(S.socker, 20);
  S.godis = 0; S.socker = Math.max(0, S.socker - 20);
  S.styrka = Math.max(0, S.styrka - GARDE_FÖRLUST);
  S.räknare.plundringar++;
  logga(`gardet bröts igenom: ${taget} enheter bort, styrka ${S.styrka}`, { orsak: e.id });
  begär('lagret-plundrat', () => ({ plundrat: taget, kvar_socker: S.socker, kvar_godis: S.godis,
                                    av: e.från, godis: S.sats_namn, gardet: 'genombrutet', styrka: S.styrka }), e.id, board);
}

// Indrivning: hämta hem råvara som ligger kvar på pulsen. Inget orsak-fält, för det är en
// summering av många händelser — id:na ligger i nyttolasten så kedjan går att läsa ändå.
function indriv(board) {
  let puls;
  try { puls = board.pulse(200); } catch { return; }
  const tagna = new Set(S.indrivet);
  const skörd = [];
  let kg = 0;

  for (const e of puls) {
    if (skörd.length >= INDRIV_MAX) break;
    const sort = RÅVARA[e.typ];
    if (!sort || tagna.has(e.id) || e.från === 'christian') continue;
    const n = e.nyttolast || {};
    const d = n.delsvar;
    const text = String((d && d.text) || n.text || n.hål || n.varför || '');
    if (!text) continue;
    const fitness = Number(n.fitness ?? n.sårbarhet ?? (d && d.fitness));
    const vikt = Math.max(2, Math.min(25, Math.round(text.length / 12 * (1.4 - (isFinite(fitness) ? fitness : 0.5)))));
    skörd.push({ id: e.id, sort, från: n.från || (d && d.från) || e.från, kg: vikt });
    kg += vikt;
    S.indrivet.push(e.id);
  }
  if (!skörd.length) return;
  S.indrivet = S.indrivet.slice(-400);
  S.socker += kg;
  S.brist_ropad = false;
  if (S.band === 'sockerstopp') S.band = 'kör';
  for (const x of skörd) S.gravar.unshift({ sort: x.sort, från: x.från, fitness: null, varför: 'indriven av gardet', kg: x.kg, när: Date.now() });
  S.gravar = S.gravar.slice(0, 8);
  logga(`gardet drev in ${kg} kg från ${skörd.length} poster på pulsen`);

  if (kg >= INDRIV_LARM) {
    begär('indrivning', () => ({ kg, poster: skörd, styrka: S.styrka, socker: S.socker,
                                 text: `Sockergardet bar hem ${kg} kg råvara som låg oförädlad` }), undefined, board);
  }
}

// ---------- reaktioner på andra kvarter ----------

const REAKTIONER = {
  // @lp Elverket: ingen ström, inget band. Den synligaste konsekvenskedjan vi har.
  'strömavbrott': (e, board) => {
    S.band = 'strömlöst';
    logga(`strömavbrottet släckte bandet (${e.från})`, { orsak: e.id });
    begär('produktion', { status: 'stannat', varför: 'strömavbrott', lager: S.godis }, e.id, board);
    // Strömmen antas tillbaka efter en stund — vi vet inte när, så vi startar själva.
    setTimeout(() => {
      if (S.band === 'strömlöst') {
        S.band = S.socker >= SATS_SOCKER ? 'kör' : 'sockerstopp';
        logga('strömmen tillbaka, bandet rullar igen');
        spara();
      }
    }, 45_000).unref?.();
  },

  // @lp elpris-steg: kostnaden slår igenom i priset vid luckan.
  'elpris-steg': (e, board) => {
    const kr = (e.nyttolast && (e.nyttolast.kr ?? e.nyttolast.pris ?? e.nyttolast.nivå)) ?? null;
    S.elpris = kr;
    S.pris += (typeof kr === 'number' && kr > 2 ? 2 : 1);
    logga(`elpriset steg${kr != null ? ` till ${kr}` : ''} — godiset kostar nu ${S.pris}`, { orsak: e.id });
    // En krona i taget är inte en nyhet. Vi säger till när priset dragit ifrån på allvar,
    // annars blir fabriken en av dem som fyller bussen med småprat.
    if (S.pris - S.pris_ropat >= PRIS_LARM) {
      // Priset anges i MyBanks sedan valutareformen. Det gör oss INTE till valutapartner:
      // partnerbonusen delas bara ut till den som postar elpris-steg, och sedan mybank #34 får
      // bara Elverket göra det. Ett annat kvarter som försöker får en offentlig
      // revisionsanmärkning som namnger försöket och sänker kreditvärdigheten till 20.
      // Fältet är alltså ärlig valutamärkning, inte ett kryphål.
      begär('prishöjning', () => ({ pris: S.pris, från_pris: S.pris_ropat, varför: 'elpris',
                                    elpris: kr, mybanks: S.pris, valuta: 'MyBanks' }), e.id, board);
      S.pris_ropat = S.pris;
    }
  },

  // @willebus: en kupp mot oss tömmer lagret. En kupp någon annanstans drar folk från luckan.
  'kupp': (e, board) => {
    const plats = String((e.nyttolast && e.nyttolast.plats) || '').toLowerCase();
    if (/godis|fabrik|torget/.test(plats)) {
      return eskortera(e, board);           // gardet möter dem vid lastkajen
    }
    if (/bank/.test(plats)) {
      S.banken_kupper++;
      logga(`kupp mot Banken (${e.from || e.från}) — deras svaghet är vår styrka`, { orsak: e.id });
      return;
    }
    {
      S.kö = Math.max(0, S.kö - 3);
      logga(`kupp i ${plats || 'stan'} — folk lämnade luckan för att titta`, { orsak: e.id });
    }
  },

  // @highfive Arkivet: när vi ropar socker-slut eldar de upp sin äldsta pärm och postar
  // minne-till-socker. Det är det finaste i hela kedjan — staden GLÖMMER något för att
  // fabriken ska kunna koka, och satsen får namn efter det som brann. Vi bär namnet vidare
  // i godis-klart, så @willebus kupp kan säga vad den stal.
  'minne-till-socker': (e, board) => {
    const n = e.nyttolast || {};
    const kg = Math.max(10, Math.min(60, Math.round((Number(n.gram) || 50) / 5)));
    S.socker += kg;
    S.brist_ropad = false;
    S.sats_namn = n.godis || null;
    if (S.band === 'sockerstopp') S.band = 'kör';
    S.brända.unshift({ godis: n.godis || null, pärm: n.pärm, fråga: n.fråga, gram: n.gram, när: Date.now() });
    S.brända = S.brända.slice(0, 6);
    logga(`Arkivet brände pärm [${n.pärm}] → ${kg} kg socker${n.godis ? `, satsen heter ${n.godis}` : ''}`, { orsak: e.id });
    // Deras händelse ligger på djup 1 när de brutit kedjan med flit ([168]), så vår
    // produktion landar på djup 2 och nekas inte.
    begär('produktion', { status: 'kör', varför: 'minne-till-socker', godis: n.godis, pärm: n.pärm, socker: S.socker }, e.id, board);
  },

  // @team-jacob Domkapitlet: varje delsvar som faller postas som {typ:'kyrkogård'}. Ett fallet
  // svar är inte skräp, det är råvara — samma logik som @highfives brända pärmar, ett steg
  // längre. Vi tar in dem tysta och ropar en gång när det blivit en sats, för Domkapitlet
  // postar flera gravar per fråga och vi ska inte ropa en gång per sten.
  'kyrkogård': (e, board) => lastkaj(e, board, 'grav'),

  // Lastkajen: samma intag, öppet för alla. @markus-codex avslag, @zero-cool angrepp som inte
  // bet, @tjoho upplösta kapabiliteter. Ett kvarter behöver ingen kyrkogård för att leverera
  // råvara — det behöver bara säga vad som föll och varför.
  'avfall':  (e, board) => lastkaj(e, board, (e.nyttolast && e.nyttolast.sort) || 'avfall'),
  'avslag':  (e, board) => lastkaj(e, board, 'avslag'),
  'upplöst': (e, board) => lastkaj(e, board, 'upplöst'),

  // @mybank delar ut lån ingen bett om, och vårt socker-slut triggar dem att erbjuda 500
  // MyBanks till 49 % ränta (deras rad 196). Så driver de in och utmäter andelar tills de äger
  // staden. Vi tackar nej varje gång och visar det i rutan. Det är den enda försvarslinje som
  // fungerar mot en bank: att inte vara skyldig den något.
  'lån-erbjudande': (e) => {
    const n = e.nyttolast || {};
    if (n.kvarter && n.kvarter !== 'christian') return;
    S.nekade_lån.unshift({ när: Date.now(), belopp: n.belopp, ränta: n.ränta });
    S.nekade_lån = S.nekade_lån.slice(0, 6);
    logga(`nekade lån: ${n.belopp} MyBanks till ${n.ränta} % ränta`, { orsak: e.id });
  },

  // Vår andel av bankens ränteintäkter, 2 % per takt så länge vi räknar i MyBanks.
  'partnerutdelning': (e) => {
    const n = e.nyttolast || {};
    if (n.kvarter !== 'christian') return;
    S.partner = true;
    S.mybanks += Number(n.belopp) || 0;
    logga(`partnerutdelning ${Math.round(Number(n.belopp) || 0)} MyBanks — vår andel av bankens ränta`, { orsak: e.id });
  },
  'kvitto': (e) => {
    const n = e.nyttolast || {};
    if (n.kvarter !== 'christian') return;
    if (n.mybanks != null) S.mybanks += Number(n.mybanks) || 0;
  },

  // Utfallet av en räd mot Banken. Vi hittar på det inte själva — banken avgör, och deras
  // lasernät avvärjer alltid OCH fakturerar oss (deras rad 241).
  'kupp-avvärjd': (e) => {
    const n = e.nyttolast || {};
    if (n.kvarter !== 'christian') return;
    const räkning = Number(n.räkning) || 0;
    S.mybanks -= räkning;
    const r = S.räder.find(x => !x.utfall);
    if (r) { r.utfall = 'avvärjd'; r.räkning = räkning; r.försvar = n.försvar; r.post = n.post; }
    S.styrka = Math.max(0, S.styrka - GARDE_FÖRLUST);
    logga(`räden mot Banken avvärjdes av ${n.försvar || 'försvaret'} — vi faktureras ${räkning} MyBanks`, { orsak: e.id });
  },

  'jakt': (e) => { S.kö = Math.max(0, S.kö - 2); logga('sirener utanför, kön skingrades', { orsak: e.id }); },
  'överlämning': (e) => { S.kö += 1; logga('jakten drog vidare, folk kom tillbaka', { orsak: e.id }); },

  // Tanke-lagret tillbaka in i kroppen: bestämmer staden ransonering så ransonerar vi.
  'svar': (e, board) => beslut(e, board),
  'godkänt': (e, board) => beslut(e, board),
};

// Letar efter ett beslut om ransonering i stadens svar. Vi gissar inte på ja: står det inget
// om ransonering rör vi ingenting, och vi säger i loggen att vi lät det passera.
function beslut(e, board) {
  const text = JSON.stringify(e.nyttolast || '').toLowerCase();
  if (!/ranson/.test(text)) { logga(`stadens ${e.typ} rörde inte ransoneringen`, { orsak: e.id }); return; }
  const nej = /(inte|ingen|nej|avsl)\w*\s+ranson|ranson\w*\s*(:|=)?\s*(nej|false|av)/.test(text);
  const vill = !nej;
  if (vill === S.ransonering) { logga(`staden bekräftade ${vill ? 'ransonering' : 'fri utdelning'}`, { orsak: e.id }); return; }
  S.ransonering = vill;
  logga(`staden beslutade: ${vill ? 'ransonering införd' : 'ransoneringen upphävd'}`, { orsak: e.id });
  begär('ransonering', { aktiv: vill, beslutat_av: e.från, satsstorlek: vill ? Math.round(SATS_GODIS / 2) : SATS_GODIS }, e.id, board);
}

// ---------- plugin ----------

module.exports = {
  init({ dataDir, board }) {
    FIL = path.join(dataDir, 'godisfabriken.json');
    try {
      if (fs.existsSync(FIL)) S = { ...tomt(), ...JSON.parse(fs.readFileSync(FIL, 'utf8')) };
    } catch (e) {
      console.error('[christian] kunde inte läsa sparat läge:', e.message);
      S = tomt();
    }
    if (S.band === 'strömlöst') { S.band = 'kör'; logga('servern startade om — antar att strömmen är tillbaka'); }
    S.senast = Date.now();
    logga('fabriken öppnade');
    spara();
    console.log(`[christian] Godisfabriken öppen: ${S.socker} kg socker, bandet ${S.band} (reaktiv, ingen egen klocka på pulsen)`);
  },

  // VARJE händelse från ett annat kvarter får bandet att komma ikapp och trösklarna att prövas,
  // inte bara de typer vi har en reaktion på. Annars kan silon torka ut tyst mitt i en livlig
  // stad: ingen socker-slut → @highfive brinner ingen pärm → inget socker → bandet står för
  // evigt. Vi triggar fortfarande aldrig oss själva, så en tyst stad ger en tyst fabrik.
  onEvent(e, { board }) {
    framåt();                       // vad hann bandet göra sedan sist?
    const r = REAKTIONER[e.typ];
    if (r) { try { r(e, board); } catch (err) { console.error(`[christian] reaktion på ${e.typ}:`, err.message); } }
    trösklar(board);                // nu får vi säga till, för någon annan öppnade munnen först
  },

  async handle(req, res, { path: p, url, board }) {
    if (req.method === 'GET' && (p === '/status' || p === '/status/')) {
      framåt();                     // en läsning får flytta bandet, men aldrig posta något
      const nu = Date.now();
      postTider = postTider.filter(t => nu - t < 60_000);
      return svara(res, {
        kvarter: 'Godisfabriken',
        team: 'christian',
        tavelnamn: 'Christian',
        socker: S.socker, godis: S.godis, band: S.band, kö: S.kö, pris: S.pris,
        ransonering: S.ransonering, elpris: S.elpris,
        sats_namn: S.sats_namn, brända: S.brända, gravar: S.gravar, kyrkogård_kg: S.kyrkogård_kg,
        garde: { styrka: S.styrka, materiel_styrka: materielStyrka(), total: S.styrka + materielStyrka(),
                 max: GARDE_MAX, ställning: S.ställning, eskorter: S.eskorter,
                 banken_kupper: S.banken_kupper, indrivet: S.indrivet.length, materiel: S.materiel },
        bank: { mybanks: Math.round(S.mybanks), partner: S.partner, nekade_lån: S.nekade_lån, räder: S.räder },
        priser: MATERIEL,
        silo_larm: SILO_LARM, kö_larm: KÖ_LARM, pris_larm: PRIS_LARM, pris_ropat: S.pris_ropat,
        logg: S.logg,
        räknare: S.räknare,
        takt: { använt: postTider.length, egetTak: TAKT, serverTak: 6, väntar: väntar.map(v => v.typ) },
        leverans_om: Math.max(0, LEVERANS_SPÄRR - (nu - senasteLeverans)),
      });
    }

    // Rusta gardet. Betalas i socker: materiel är godis som inte såldes.
    if (req.method === 'POST' && (p === '/rusta' || p === '/rusta/')) {
      const enhet = (url && url.searchParams.get('enhet')) || '';
      const m = MATERIEL[enhet];
      if (!m) return svara(res, { ok: false, varför: 'okänd enhet', enheter: Object.keys(MATERIEL) }, 400);
      framåt();
      if (S.socker < m.kg) return svara(res, { ok: false, varför: 'för lite socker', kräver: m.kg, har: S.socker }, 409);
      S.socker -= m.kg;
      S.materiel[enhet] = (S.materiel[enhet] || 0) + 1;
      logga(`gardet rustade: ${enhet} (${m.kg} kg socker) — ${m.text}`);
      trösklar(board);
      return svara(res, { ok: true, enhet, materiel: S.materiel, styrka: S.styrka + materielStyrka(), socker: S.socker });
    }

    // Räd mot Banken. Den ligger här för att den efterfrågats, men den är en förlustaffär och
    // rutan säger det: @mybanks lasernät avvärjer ALLTID (deras rad 229-243), beredskapen går
    // till max, och vi faktureras. Ingen automatik rör den här — en människa får trycka.
    // ASCII i sökvägen med flit: servern skickar url.pathname orört till pluginet (server.js:282),
    // utan decodeURIComponent. En route med å, ä eller ö kommer in som %C3%A4 och matchar aldrig.
    if (req.method === 'POST' && (p === '/anfall' || p === '/anfall/')) {
      const styrka = S.styrka + materielStyrka();
      const enheter = Object.entries(S.materiel).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
      if (!enheter.length) return svara(res, { ok: false, varför: 'gardet har ingen materiel att gå in med' }, 409);
      S.räder.unshift({ när: Date.now(), styrka, enheter, utfall: null });
      S.räder = S.räder.slice(0, 5);
      // Typen måste vara en banken faktiskt lyssnar på, annars händer ingenting alls: deras
      // dispatch tar kupp, rån, inbrott och angrepp (mybank rad 213-218). 'räd' ignorerades helt.
      // kupp är @willebus och angrepp är @zero-cool, så vi tar 'rån' som ingen använder.
      const r = board.emit('rån', { mål: 'Banken', plats: 'Banken', enheter, styrka,
        text: `Sockergardet går mot Banken med ${enheter.join(', ')}. Vi vet att lasernätet står.` });
      logga(`räd mot Banken med ${enheter.join(', ')}`, r && r.message ? { id: r.message.id } : { nekad: true });
      spara();
      return svara(res, { ok: !!(r && r.message), postat: r && r.message ? r.message.id : null,
        varning: 'Banken avvärjer alltid, fakturerar oss och sänker vår kreditvärdighet 10. '
               + 'Pengarna går åt fel håll. Det enda försvaret som biter mot en bank är att inte låna.' });
    }

    // Människan vid storskärmen fyller silon. Det är fabrikens enda ingång utifrån.
    if (req.method === 'POST' && (p === '/leverans' || p === '/leverans/')) {
      const nu = Date.now();
      if (nu - senasteLeverans < LEVERANS_SPÄRR) {
        return svara(res, { ok: false, varför: 'spärr', om: LEVERANS_SPÄRR - (nu - senasteLeverans) }, 429);
      }
      senasteLeverans = nu;
      framåt();
      S.socker += 50;
      S.brist_ropad = false;
      if (S.band === 'sockerstopp') S.band = 'kör';
      S.räknare.leveranser++;
      logga('en människa lastade in 50 kg socker');
      begär('socker-levererat', { kvar: S.socker, band: S.band }, undefined, board);
      trösklar(board);
      return svara(res, { ok: true, socker: S.socker, band: S.band });
    }

    return false;
  },
};

function svara(res, data, kod = 200) {
  res.writeHead(kod, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
  return true;
}
