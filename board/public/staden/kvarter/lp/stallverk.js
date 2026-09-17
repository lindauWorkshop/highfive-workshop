// Elverket — ställverket. Ren HTML/CSS/JS, inget ramverk, inget byggsteg.
//
// Kontraktet mot /t/lp/tillstand är låst (se UPPDRAG.md), men vi kodar som om
// det kan ändras i eftermiddag: allt går genom las() nedan, och resten av
// koden litar ALDRIG på att ett fält finns. Ett okänt extra fält (t.ex.
// sedanOmstartS) stör inte oss, och används om det finns.
(() => {
  'use strict';

  const BAS = '/t/lp';
  const POLL_MS = 6000; // 5–8s grund, se AGENTS/rolldef — snabbheten läggs i strömlyssnaren

  // ---------- 1. Normalisering: rått svar → internt format med fallback för allt ----------
  function las(tillstand) {
    const t = (tillstand && typeof tillstand === 'object') ? tillstand : {};
    const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const bool = (v) => v === true;

    const tak = num(t.tak, 100);
    const rå = Array.isArray(t.prishistorik) ? t.prishistorik : [];
    const historik = rå
      .filter(p => p && typeof p === 'object')
      .map(p => ({ ts: num(p.ts, null), kr: num(p.kr, null) }))
      .filter(p => p.ts != null && p.kr != null);

    const råTopp = Array.isArray(t.toppförbrukare) ? t.toppförbrukare : [];
    const senaste = råTopp
      .filter(p => p && typeof p === 'object')
      .map(p => ({
        // döljer hellre okänt fältnamn än kraschar: prova några rimliga alias
        kvarter: typeof p.kvarter === 'string' ? p.kvarter
          : (typeof p.namn === 'string' ? p.namn : (typeof p.team === 'string' ? p.team : (typeof p.från === 'string' ? p.från : null))),
        kr: num(p.kr, num(p.pris, num(p.belopp, null))),
        typ: typeof p.typ === 'string' ? p.typ : null,
      }))
      .filter(p => p.kvarter != null && p.kr != null);

    const senasteAvbrott = (t.senasteAvbrott && typeof t.senasteAvbrott === 'object')
      ? { ts: num(t.senasteAvbrott.ts, null), varaktighetS: num(t.senasteAvbrott.varaktighetS, null), orsak: t.senasteAvbrott.orsak ?? null }
      : null;

    return {
      ts: num(t.ts, Date.now()),
      last: num(t.last, 0),
      tak: tak > 0 ? tak : 100,
      pris: num(t.pris, 0),
      maxPris: num(t.maxPris, 12),
      avbrott: bool(t.avbrott),
      avbrottSlutarOmS: num(t.avbrottSlutarOmS, null),
      återhämtning: bool(t.återhämtning),
      återhämtningSlutarOmS: num(t.återhämtningSlutarOmS, null),
      senasteAvbrott,
      historik,
      senaste, // "toppförbrukare" — dubbelt syfte: lampor + lista, det är den enda per-kvarter-datan vi får
      tau: (t.tau && typeof t.tau === 'object') ? { normalS: num(t.tau.normalS, 45), avbrottS: num(t.tau.avbrottS, 8) } : { normalS: 45, avbrottS: 8 },
      // valfritt fält, kan saknas eller döpas om — läs defensivt, gissa aldrig
      sedanOmstartS: num(t.sedanOmstartS, null),
    };
  }

  // ---------- Tillstånd i minnet ----------
  let nuvarande = las({});      // senast kända, normaliserade tillstånd
  let visadLast = 0;             // det mätaren faktiskt ritar — glider mot nuvarande.last
  let uppkopplad = false;
  let senasteHistorikNyckel = ''; // för att bara rita om grafen vid ny data, inte varje frame

  const $ = (id) => document.getElementById(id);
  const el = {
    pris: $('pris'),
    badgeOmstart: $('badge-omstart'),
    badgeAtm: $('badge-atm'),
    badgeAvbrott: $('badge-avbrott'),
    matareVarde: $('matare-varde'),
    matareTak: $('matare-tak'),
    grafInfo: $('graf-info'),
    lampor: $('lampor'),
    lampoTom: $('lampor-tom'),
    lista: $('lista'),
    status: $('status'),
  };
  const matareCanvas = $('matare');
  const grafCanvas = $('graf');
  const matareCtx = matareCanvas && matareCanvas.getContext ? matareCanvas.getContext('2d') : null;
  const grafCtx = grafCanvas && grafCanvas.getContext ? grafCanvas.getContext('2d') : null;

  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- 2. Hämtning: polling + strömlyssnare ----------
  async function hämta() {
    try {
      const r = await fetch(BAS + '/tillstand', { cache: 'no-store' });
      if (!r.ok) throw new Error('http ' + r.status);
      const data = await r.json();
      applicera(data);
      uppkopplad = true;
      el.status.textContent = 'ansluten · pollar var ' + Math.round(POLL_MS / 1000) + ':e sekund';
    } catch (err) {
      // Backend kan vara nere mitt i en ändring — visa något vettigt, krascha aldrig.
      uppkopplad = false;
      el.status.textContent = 'ingen kontakt med /t/lp — visar senast kända läge';
    }
  }

  function applicera(rått) {
    nuvarande = las(rått);
    rendera();
  }

  // Strömlyssnaren: samma mönster som /staden/index.html. Fångar elpris-steg
  // och strömavbrott MELLAN pollningarna, så reaktionen känns snabbare utan
  // att vi pollar hårdare. Helt valfritt — rutan fungerar utan den.
  function anslutStröm() {
    try {
      const es = new EventSource('/api/stream?channel=staden-puls');
      es.onmessage = (m) => {
        try {
          const msg = JSON.parse(m.data);
          const e = JSON.parse(msg.text);
          if (!e || e.från !== 'lp') return; // bara våra egna postningar är relevanta här
          if (e.typ === 'elpris-steg' && e.nyttolast && typeof e.nyttolast.kr === 'number') {
            nuvarande = { ...nuvarande, pris: e.nyttolast.kr, avbrott: false };
            nuvarande.historik = nuvarande.historik.concat([{ ts: Date.now(), kr: e.nyttolast.kr }]).slice(-40);
            rendera();
          } else if (e.typ === 'strömavbrott') {
            const varaktighetS = e.nyttolast && typeof e.nyttolast.varaktighetS === 'number' ? e.nyttolast.varaktighetS : null;
            nuvarande = { ...nuvarande, avbrott: true, avbrottSlutarOmS: varaktighetS };
            rendera();
          }
        } catch { /* trasigt meddelande — hoppa över, kasta aldrig */ }
      };
      es.onerror = () => { /* EventSource försöker själv återansluta — inget vi behöver göra */ };
    } catch { /* SSE stöds inte / blockerat — polling bär hela lasten då */ }
  }

  // ---------- 3. Rendering av allt utom mätaren (som ritas i rAF-loopen) ----------
  function rendera() {
    try {
      renderaTopprad();
      renderaLampor();
      renderaLista();
      renderaGrafOmNy();
      document.body.classList.toggle('avbrott', nuvarande.avbrott === true);
    } catch (err) {
      console.warn('lp-ställverk: fel i rendera, hoppar över denna uppdatering', err);
    }
  }

  function renderaTopprad() {
    el.pris.textContent = Math.round(nuvarande.pris) + ' kr';
    el.matareTak.textContent = String(Math.round(nuvarande.tak));

    // Omstart är inte ett prisras: en liten badge, ingen dramatik.
    const nystartad = typeof nuvarande.sedanOmstartS === 'number' && nuvarande.sedanOmstartS >= 0 && nuvarande.sedanOmstartS < 90;
    el.badgeOmstart.hidden = !nystartad;

    el.badgeAvbrott.hidden = !nuvarande.avbrott;
    if (nuvarande.avbrott && typeof nuvarande.avbrottSlutarOmS === 'number') {
      el.badgeAvbrott.textContent = 'strömavbrott · ' + Math.max(0, Math.round(nuvarande.avbrottSlutarOmS)) + 's kvar';
    } else if (nuvarande.avbrott) {
      el.badgeAvbrott.textContent = 'strömavbrott';
    }

    el.badgeAtm.hidden = !nuvarande.återhämtning;
    if (nuvarande.återhämtning && typeof nuvarande.återhämtningSlutarOmS === 'number') {
      el.badgeAtm.textContent = 'återhämtning · ' + Math.max(0, Math.round(nuvarande.återhämtningSlutarOmS)) + 's';
    }
  }

  function renderaLampor() {
    const lista = nuvarande.senaste;
    el.lampoTom.hidden = lista.length > 0;
    // Bygg om bara om mängden kvarter faktiskt ändrats, annars bara toggla klasser.
    const nycklar = lista.map(p => p.kvarter).join('|');
    if (el.lampor.dataset.nycklar !== nycklar) {
      el.lampor.dataset.nycklar = nycklar;
      el.lampor.querySelectorAll('.lampa').forEach(x => x.remove());
      const max = Math.max(1, ...lista.map(p => p.kr || 0));
      for (const p of lista) {
        const d = document.createElement('span');
        d.className = 'lampa';
        d.dataset.kvarter = p.kvarter;
        const styrka = Math.max(.25, (p.kr || 0) / max);
        d.innerHTML = `<span class="dot" style="opacity:${styrka.toFixed(2)}"></span><span class="namn">${esc(p.kvarter)}</span>`;
        el.lampor.appendChild(d);
      }
    }
    // Tänd/släckt-klassen sätts varje rendering, oavsett om DOM byggdes om:
    // det är den som faktiskt reagerar på avbrott just nu.
    el.lampor.querySelectorAll('.lampa').forEach(d => {
      d.classList.toggle('tänd', !nuvarande.avbrott);
      d.classList.toggle('släckt', nuvarande.avbrott);
    });
  }

  function renderaLista() {
    const lista = nuvarande.senaste;
    if (!lista.length) {
      el.lista.innerHTML = '<li class="tom">väntar på förbrukare …</li>';
      return;
    }
    el.lista.innerHTML = lista.slice(0, 8).map((p, i) => `
      <li>
        <span class="plats">${i + 1}.</span>
        <span class="namn">${esc(p.kvarter)}</span>
        ${p.typ ? `<span class="typ">${esc(p.typ)}</span>` : ''}
        <span class="kr">${(Math.round(p.kr * 10) / 10).toLocaleString('sv-SE')} kr</span>
      </li>`).join('');
  }

  // ---------- 4. Prisgrafen: canvas-sparkline, ritas bara vid ny data ----------
  function renderaGrafOmNy() {
    const h = nuvarande.historik;
    const nyckel = h.length + ':' + (h.length ? h[h.length - 1].ts + ':' + h[h.length - 1].kr : '') + ':' + nuvarande.sedanOmstartS;
    if (nyckel === senasteHistorikNyckel) return;
    senasteHistorikNyckel = nyckel;
    ritaGraf(h);
  }

  function ritaGraf(historik) {
    if (!grafCtx) return;
    const cw = grafCanvas.clientWidth || 420, ch = grafCanvas.clientHeight || 110;
    // Skarp canvas på högupplösta skärmar utan att layouten ändras.
    const dpr = window.devicePixelRatio || 1;
    if (grafCanvas.width !== Math.round(cw * dpr)) grafCanvas.width = Math.round(cw * dpr);
    if (grafCanvas.height !== Math.round(ch * dpr)) grafCanvas.height = Math.round(ch * dpr);
    grafCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    grafCtx.clearRect(0, 0, cw, ch);

    if (!historik.length) {
      grafCtx.fillStyle = 'rgba(125,133,144,.7)';
      grafCtx.font = '12px ui-monospace, monospace';
      grafCtx.fillText('ingen prishistorik ännu', 8, ch / 2);
      el.grafInfo.textContent = '';
      return;
    }

    const pad = { l: 6, r: 6, t: 10, b: 16 };
    const kr = historik.map(p => p.kr);
    let min = Math.min(0, ...kr), max = Math.max(1, ...kr, nuvarande.maxPris ? nuvarande.maxPris * 0.3 : 1);
    if (max === min) max = min + 1;
    const t0 = historik[0].ts, t1 = Math.max(historik[historik.length - 1].ts, historik[0].ts + 1);
    const x = (ts) => pad.l + ((ts - t0) / (t1 - t0)) * (cw - pad.l - pad.r);
    const y = (v) => ch - pad.b - ((v - min) / (max - min)) * (ch - pad.t - pad.b);

    // Omstart syns som ett brott i linjen, inte ett dramatiskt fall: om vi vet
    // när servern senast startade delar vi linjen där i stället för att dra
    // en fallande kurva ner mot noll.
    let brottTs = null;
    if (typeof nuvarande.sedanOmstartS === 'number' && nuvarande.sedanOmstartS >= 0) {
      const kandidat = nuvarande.ts - nuvarande.sedanOmstartS * 1000;
      if (kandidat > t0 && kandidat < t1) brottTs = kandidat;
    }

    grafCtx.lineWidth = 2;
    grafCtx.strokeStyle = 'rgba(255,180,84,.9)';
    grafCtx.beginPath();
    let penna = false;
    for (const p of historik) {
      if (brottTs != null && Math.abs(p.ts - brottTs) < 1) { penna = false; continue; }
      const px = x(p.ts), py = y(p.kr);
      if (!penna) { grafCtx.moveTo(px, py); penna = true; } else { grafCtx.lineTo(px, py); }
    }
    grafCtx.stroke();

    // fyllning under kurvan, svagt
    grafCtx.lineTo(x(historik[historik.length - 1].ts), ch - pad.b);
    grafCtx.lineTo(x(historik[0].ts), ch - pad.b);
    grafCtx.closePath();
    grafCtx.fillStyle = 'rgba(255,180,84,.12)';
    grafCtx.fill();

    if (brottTs != null) {
      const bx = x(brottTs);
      grafCtx.save();
      grafCtx.setLineDash([3, 3]);
      grafCtx.strokeStyle = 'rgba(143,184,255,.7)';
      grafCtx.beginPath(); grafCtx.moveTo(bx, pad.t); grafCtx.lineTo(bx, ch - pad.b); grafCtx.stroke();
      grafCtx.restore();
      grafCtx.fillStyle = 'rgba(143,184,255,.9)';
      grafCtx.font = '10px ui-monospace, monospace';
      grafCtx.fillText('⟲ omstart', Math.min(bx + 4, cw - 60), pad.t + 8);
    }

    const minuter = Math.max(1, Math.round((t1 - t0) / 60000));
    el.grafInfo.textContent = 'senaste ' + minuter + ' min · ' + historik.length + ' punkter';
  }

  // ---------- 5. Lastmätaren: canvas-halvcirkel, ritas varje requestAnimationFrame ----------
  // Nålen glider mot nytt värde i stället för att hoppa — det är det som gör
  // att man ser att staden lever, inte bara att en siffra ändras.
  function lerp(a, b, t) { return a + (b - a) * t; }

  let förraFrameTs = 0;
  function loop(ts) {
    const dt = förraFrameTs ? Math.min(0.25, (ts - förraFrameTs) / 1000) : 0;
    förraFrameTs = ts;
    try {
      // Exponentiell glidning, oberoende av bildfrekvens: ~0.35s till målet.
      const faktor = 1 - Math.exp(-dt / 0.35);
      visadLast = Number.isFinite(visadLast) ? lerp(visadLast, nuvarande.last, dt ? faktor : 1) : nuvarande.last;
      ritaMätare(visadLast, nuvarande.tak, nuvarande.avbrott);
    } catch (err) {
      // Mätaren får aldrig stoppa loopen — hellre en frame som inte ritas rätt.
    }
    requestAnimationFrame(loop);
  }

  function ritaMätare(last, tak, avbrott) {
    if (!matareCtx) return;
    const cw = matareCanvas.clientWidth || 300, ch = matareCanvas.clientHeight || 180;
    const dpr = window.devicePixelRatio || 1;
    if (matareCanvas.width !== Math.round(cw * dpr)) matareCanvas.width = Math.round(cw * dpr);
    if (matareCanvas.height !== Math.round(ch * dpr)) matareCanvas.height = Math.round(ch * dpr);
    matareCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    matareCtx.clearRect(0, 0, cw, ch);

    const cx = cw / 2, cy = ch - 14, r = Math.min(cw / 2, ch) - 18;
    const andel = Math.max(0, Math.min(1.15, (tak > 0 ? last / tak : 0))); // tillåt lite överslag visuellt innan avbrott
    const startVinkel = Math.PI; // 180° — vänster
    const slutVinkel = 0;        // 0° — höger
    const vinkel = (t) => startVinkel + (slutVinkel - startVinkel) * t;

    // bakgrundsbåge
    matareCtx.lineWidth = 14;
    matareCtx.strokeStyle = '#1f242c';
    matareCtx.beginPath();
    matareCtx.arc(cx, cy, r, startVinkel, slutVinkel, true);
    matareCtx.stroke();

    // fylld båge, färgad efter belastning (grön → amber → röd)
    const färg = avbrott ? '#ff5f56' : (andel < 0.6 ? '#5fd7a7' : (andel < 0.85 ? '#ffb454' : '#ff5f56'));
    matareCtx.strokeStyle = färg;
    matareCtx.beginPath();
    matareCtx.arc(cx, cy, r, startVinkel, vinkel(Math.min(1, andel)), true);
    matareCtx.stroke();

    // nålen
    const nålVinkel = vinkel(Math.min(1, andel));
    const nx = cx + Math.cos(nålVinkel) * (r - 4), ny = cy + Math.sin(nålVinkel) * (r - 4);
    matareCtx.lineWidth = 3;
    matareCtx.strokeStyle = avbrott ? '#ff5f56' : '#e6e8eb';
    matareCtx.beginPath();
    matareCtx.moveTo(cx, cy);
    matareCtx.lineTo(nx, ny);
    matareCtx.stroke();
    matareCtx.fillStyle = '#e6e8eb';
    matareCtx.beginPath();
    matareCtx.arc(cx, cy, 5, 0, Math.PI * 2);
    matareCtx.fill();

    el.matareVarde.textContent = String(Math.round(last * 10) / 10);
  }

  // ---------- Start ----------
  hämta();
  setInterval(hämta, POLL_MS);
  anslutStröm();
  requestAnimationFrame(loop);
})();
