#!/usr/bin/env node
// Offline-simulator för Elverkets lastmodell.
//
// Kör: node projects/lp/simulera.js
//
// Matar syntetiska händelsesekvenser genom EXAKT samma kärnfunktioner som
// pluginet använder skarpt (board/plugins/lp/last.js), och ritar en ASCII-kurva
// av last/pris per sekund. Poängen: tau, tak och kostnadstabellen ska vara
// uttestade här — i lugn och ro — innan en enda rad onEvent skrivs. Simulering
// ersätter aldrig sista steget (tools/board.sh emit mot en riktig server), men
// den gör att man väljer konstanterna med självförtroende i stället för att
// gissa live.

const path = require('node:path');
const {
  laddaUpp,
  urladda,
  beräknaPris,
  kostnadFör,
  TAK,
  TAU_NORMAL,
  TAU_AVBROTT,
  AVBROTT_VARAKTIGHET_S,
  ÅTERHÄMTNING_S,
  ÅTERHÄMTNING_FAKTOR,
} = require(path.join(__dirname, '..', '..', 'board', 'plugins', 'lp', 'last.js'));

// Konstanterna (TAK, TAU_*, ÅTERHÄMTNING_*) kommer från last.js — EXAKT samma
// värden som pluginet (index.js) kör skarpt. Inget duplicerat här längre: ändra
// en gång i last.js, och både simuleringen och driften följer med automatiskt.

// ---------- simuleringsmotor ----------
// händelser: [{ t: sekund, typ: 'kupp' }, ...]. Kör sekund för sekund, ackumulerar
// alla händelser som inträffar samma sekund innan urladdningen för nästa steg.
function körScenario(namn, händelser, totalSekunder) {
  console.log(`\n=== ${namn} (tak=${TAK}, tau=${TAU_NORMAL}s/${TAU_AVBROTT}s under avbrott) ===`);

  const perSekund = new Map();
  for (const h of händelser) {
    if (!perSekund.has(h.t)) perSekund.set(h.t, []);
    perSekund.get(h.t).push(h.typ);
  }

  let last = 0;
  let avbrott = false;
  let avbrottSlutarS = -1;
  let återhämtningSlutarS = -1;
  let antalAvbrott = 0;
  const rader = [];

  for (let s = 0; s <= totalSekunder; s++) {
    // 1. urladda ett sekundsteg med rätt tau (snabbare under pågående avbrott)
    const tau = avbrott ? TAU_AVBROTT : TAU_NORMAL;
    last = urladda(last, 1, tau);

    // 2. ladda upp med sekundens händelser, med återhämtningsfaktor om aktuellt
    const typer = perSekund.get(s) || [];
    const iÅterhämtning = !avbrott && s < återhämtningSlutarS;
    for (const typ of typer) {
      const kostnad = kostnadFör(typ) * (iÅterhämtning ? ÅTERHÄMTNING_FAKTOR : 1);
      last = laddaUpp(last, kostnad);
    }

    // 3. tröskelpassage: går lasten över taket → avbrott
    if (!avbrott && last > TAK) {
      avbrott = true;
      antalAvbrott += 1;
      avbrottSlutarS = s + AVBROTT_VARAKTIGHET_S;
      console.log(`  [s=${s}] STRÖMAVBROTT — last=${last.toFixed(1)} > tak=${TAK}`);
    }
    if (avbrott && s >= avbrottSlutarS) {
      avbrott = false;
      återhämtningSlutarS = s + ÅTERHÄMTNING_S;
      console.log(`  [s=${s}] strömmen tillbaka, återhämtning i ${ÅTERHÄMTNING_S}s (${ÅTERHÄMTNING_FAKTOR}x kostnad)`);
    }

    const pris = beräknaPris(last, TAK);
    rader.push({ s, last, pris, avbrott, iÅterhämtning, typer });
  }

  rita(rader);
  console.log(`  → toppast=${Math.max(...rader.map(r => r.last)).toFixed(1)}, antal avbrott=${antalAvbrott}`);
  return rader;
}

function rita(rader) {
  const bredd = 50;
  for (const r of rader) {
    const n = Math.max(0, Math.min(bredd, Math.round((r.last / TAK) * bredd)));
    const bar = '#'.repeat(n).padEnd(bredd, '.');
    const flagga = r.avbrott ? ' AVBROTT' : (r.iÅterhämtning ? ' åter' : '');
    const märke = r.typer.length ? ` <- ${r.typer.join(',')}` : '';
    console.log(
      `${String(r.s).padStart(3)}s |${bar}| last=${r.last.toFixed(1).padStart(6)} pris=${String(r.pris).padStart(2)}kr${flagga}${märke}`,
    );
  }
}

// ---------- scenario 1: lugn tankekedja ----------
// fråga → delsvar-skov → svar → godkänt, två varv, utspritt över en minut.
// Vi postar aldrig delsvar själva, men vi TAR EMOT dem från andra kvarter i onEvent
// — så de måste finnas i kostnadstabellen och i det här scenariot.
const tankekedja = [];
tankekedja.push({ t: 2, typ: 'fråga' });
for (let i = 0; i < 4; i++) tankekedja.push({ t: 4 + i, typ: 'delsvar' });
tankekedja.push({ t: 10, typ: 'svar' });
tankekedja.push({ t: 13, typ: 'godkänt' });
tankekedja.push({ t: 30, typ: 'fråga' });
for (let i = 0; i < 3; i++) tankekedja.push({ t: 32 + i, typ: 'delsvar' });
tankekedja.push({ t: 37, typ: 'svar' });
tankekedja.push({ t: 40, typ: 'kyrkogård' });

// ---------- scenario 2: klubbkväll ----------
// Klub Lyktan i skov: beat/shots-runda varannan sekund, sex skov med korta andrum.
// Ska kunna orsaka avbrott — utlovat till @Marianne i #bygge [86].
const klubbkväll = [];
{
  let ts = 2;
  for (let skov = 0; skov < 6; skov++) {
    for (let i = 0; i < 5; i++) {
      klubbkväll.push({ t: ts, typ: i % 2 === 0 ? 'beat' : 'shots-runda' });
      ts += 2;
    }
    ts += 3; // andrum mellan skoven
  }
}

// ---------- scenario 3: jakten (kupp + överlämningar) ----------
// Sällsynt och dramatiskt, men inte tätt nog för att ensamt spränga taket.
const jakt = [
  { t: 2, typ: 'kupp' },
  { t: 10, typ: 'överlämning' },
  { t: 20, typ: 'överlämning' },
];

// ---------- scenario 4: blandad kväll ----------
// Tankekedja som pågår i bakgrunden medan en klubbkväll drar igång ovanpå —
// verifierar att en riktig kväll (flera berättelser samtidigt) beter sig rimligt.
const blandad = [...tankekedja, ...klubbkväll.map(h => ({ t: h.t + 5, typ: h.typ }))];

körScenario('Lugn tankekedja (fråga/delsvar/svar/godkänt)', tankekedja, 60);
körScenario('Klubbkväll (beat/shots-runda i skov)', klubbkväll, 100);
körScenario('Jakten (kupp + överlämningar)', jakt, 60);
körScenario('Blandad kväll (tankekedja + klubbkväll)', blandad, 100);

console.log('\nSlutsats: tankekedjan ska hålla sig lågt, klubbkvällen ska nå avbrott, jakten ska synas men inte ensam släcka.');
