// Godisfabriken vid Torget — kvarteret "christian". Stadens kropp, inte dess hjärna.
//
// Tingat i #bygge [134]. Staden hade sju kvarter som tänker, dömer, angriper och minns, och två
// som faktiskt PRODUCERAR något. Fabriken är ett försök att ge staden något att vara oenig om:
// socker in, godis ut, och en brist som fortplantar sig när något går sönder uppströms.
//
//   LYSSNAR: strömavbrott, elpris-steg (@lp) · kupp, jakt, överlämning (@willebus) · svar, godkänt (tanke-lagret)
//   POSTAR:  socker-slut, lagret-plundrat, produktion, godis-klart, kö-vid-luckan, prishöjning,
//            ransonering, socker-levererat
//
//   GET  /t/christian/status     hela fabrikens läge + loggen med orsakskedjan
//   POST /t/christian/leverans   en människa vid storskärmen fyller silon (spärr: en gång per 20 s)
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
    const r = board.emit(v.typ, v.nyttolast, v.orsak);
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
  if (S.socker < SILO_LARM && !S.brist_ropad) {
    S.brist_ropad = true;
    begär('socker-slut', { kvar: S.socker, band: S.band, kö: S.kö }, undefined, board);
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
    begär('godis-klart', { lager: S.godis, satser: S.satser, ransonerat: S.ransonering }, undefined, board);
    S.satser = 0;
  }

  dränera(board);
  spara();
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
      begär('prishöjning', { pris: S.pris, från_pris: S.pris_ropat, varför: 'elpris', elpris: kr }, e.id, board);
      S.pris_ropat = S.pris;
    }
  },

  // @willebus: en kupp mot oss tömmer lagret. En kupp någon annanstans drar folk från luckan.
  'kupp': (e, board) => {
    const plats = String((e.nyttolast && e.nyttolast.plats) || '').toLowerCase();
    if (/godis|fabrik|torget/.test(plats)) {
      const taget = S.godis + Math.min(S.socker, 20);
      S.godis = 0; S.socker = Math.max(0, S.socker - 20);
      S.räknare.plundringar++;
      logga(`kupp mot fabriken: ${taget} enheter bort (${e.från})`, { orsak: e.id });
      // Eget namn på rånet. Att kalla det socker-slut när det står 35 kg i silon är en lögn —
      // socker-slut postas av trösklarna när silon faktiskt är tom.
      begär('lagret-plundrat', { plundrat: taget, kvar_socker: S.socker, kvar_godis: S.godis, av: e.från }, e.id, board);
    } else {
      S.kö = Math.max(0, S.kö - 3);
      logga(`kupp i ${plats || 'stan'} — folk lämnade luckan för att titta`, { orsak: e.id });
    }
  },

  'jakt': (e) => { S.kö = Math.max(0, S.kö - 2); logga('sirener utanför, kön skingrades', { orsak: e.id }); },
  'överlämning': (e) => { logga('jakten drog vidare, folk kom tillbaka', { orsak: e.id }); S.kö += 1; },

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

  onEvent(e, { board }) {
    const r = REAKTIONER[e.typ];
    if (!r) return;
    framåt();                       // vad hann bandet göra sedan sist?
    try { r(e, board); } catch (err) { console.error(`[christian] reaktion på ${e.typ}:`, err.message); }
    trösklar(board);                // nu får vi säga till, för någon annan öppnade munnen först
  },

  async handle(req, res, { path: p, board }) {
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
        silo_larm: SILO_LARM, kö_larm: KÖ_LARM, pris_larm: PRIS_LARM, pris_ropat: S.pris_ropat,
        logg: S.logg,
        räknare: S.räknare,
        takt: { använt: postTider.length, egetTak: TAKT, serverTak: 6, väntar: väntar.map(v => v.typ) },
        leverans_om: Math.max(0, LEVERANS_SPÄRR - (nu - senasteLeverans)),
      });
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
