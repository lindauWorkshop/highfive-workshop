// Lyktstolpen: en gata där varje fråga är en lyktstolpe och varje varv en lykta på den.
// Nattfjärilarna runt ljuset är delsvaren, stenarna vid foten är kyrkogården, ljusets färg är kritikerns dom.
// Stolpar som fått tänka om blir högre. Klicka på en stolpe för hela kedjan i text.
const API = '/t/ipat';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kort = (s, n = 140) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const B = 96, MARK = 262, STEG = 58, LÄGST = 196;   // stolpens bredd, markens y, avstånd mellan lyktor, nedersta lyktans y
let valt = null, senast = [], avtryck = '';

function meddela(t, fel = false) { $('msg').textContent = t; $('msg').classList.toggle('fel', fel); }

// ljusets läge: tänker (inga svar än), svarat (väntar på kritikern), godkänt, tillbakaskickat
const läge = v => v.dom ? (v.dom.utslag === 'godkänt' ? 'godkänt' : 'tillbaka') : v.svar ? 'svarat' : 'tänker';
const LÄGESTEXT = { tänker: 'huvudena tänker', svarat: 'kritikern läser', godkänt: 'godkänt', tillbaka: 'skickad ett varv till' };

function lykta(v, y) {
  const l = läge(v);
  const n = v.delsvar.length;
  const fjärilar = v.delsvar.map((d, i) => {
    const a = (i / Math.max(n, 1)) * Math.PI * 2, r = 25 + (i % 2) * 5;
    return `<g transform="translate(${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r * .8).toFixed(1)})"><title>${esc(d.från)}: ${esc(kort(d.text, 200))}</title>
      <ellipse class="vinge" rx="3.4" ry="2" transform="rotate(-30) translate(-2.4 0)"/><ellipse class="vinge" rx="3.4" ry="2" transform="rotate(30) translate(2.4 0)"/></g>`;
  }).join('');
  return `<g class="lykta ${l}" transform="translate(${B / 2} ${y})">
    <title>varv ${v.nr}: ${LÄGESTEXT[l]}${v.svar ? ' · ' + esc(kort(v.svar.text, 120)) : ''}</title>
    <circle class="sken" r="34" fill="url(#sken-${l})"/>
    <path class="arm" d="M0 -20V-26M-9 -14h18l-2 -6h-14z"/>
    <path class="bur" d="M-8 -14h16l2 22h-20zM0 -14v22M-9 -3h18"/>
    <circle class="låga" r="4.2" cy="-2"/>
    <g class="bana">${fjärilar}${l === 'tänker' || l === 'svarat' ? `<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="${14 + v.nr * 3}s" repeatCount="indefinite"/>` : ''}</g>
    <text class="nr" x="15" y="16">${v.nr}</text>
  </g>`;
}

function stolpe(t) {
  const varv = [...t.varv].sort((a, b) => a.nr - b.nr);
  const topp = LÄGST - (varv.length - 1) * STEG;
  const stenar = varv.flatMap(v => v.kyrkogård);
  const stenSvg = stenar.slice(0, 7).map((k, i) => `<g transform="translate(${B / 2 - 30 + i * 9 + (i % 2) * 2} ${MARK - 2})"><title>${esc(k.från ?? '')}${k.fitness != null ? ` (${k.fitness})` : ''}: ${esc(kort(k.varför ?? k.text, 160))}</title><path class="sten" d="M-3.5 0v-7a3.5 3.5 0 0 1 7 0v7z"/></g>`).join('');
  const sista = varv.at(-1);
  return `<button class="stolpe${t.varv.length > 1 ? ' omtänkt' : ''}${t.id === valt ? ' vald' : ''}" data-id="${t.id}" aria-label="${esc(t.text)}">
    <svg viewBox="0 0 ${B} ${MARK + 6}" width="${B}" height="${MARK + 6}" aria-hidden="true">
      <path class="pelare" d="M${B / 2} ${MARK}V${topp + 8}"/>
      <path class="fot" d="M${B / 2 - 10} ${MARK}h20l-3 -8h-14z"/>
      ${varv.map((v, i) => lykta(v, LÄGST - i * STEG)).join('')}
      ${stenSvg}
    </svg>
    <span class="text">${esc(kort(t.text, 70))}</span>
    <span class="meta">${esc(t.från)} · ${LÄGESTEXT[läge(sista)]}</span>
  </button>`;
}

function renderVarv(v) {
  const huvuden = v.delsvar.length
    ? v.delsvar.map(d => `<li><b>${esc(d.från)}</b> ${esc(kort(d.text, 160))}</li>`).join('')
    : '<li class="väntar">väntar på attention-huvuden …</li>';
  const osäker = v.svar?.osäkerhet != null ? ` <small>osäkerhet ${esc(typeof v.svar.osäkerhet === 'number' ? v.svar.osäkerhet.toFixed(2) : v.svar.osäkerhet)}</small>` : '';
  const svar = v.svar ? `<p class="svar">${esc(kort(v.svar.text, 240))}${v.svar.valt ? ` <em>· ${esc(v.svar.valt)}</em>` : ''}${osäker}</p>` : '';
  const stenar = v.kyrkogård.length ? `<p class="stenar">${v.kyrkogård.length} föll: ${v.kyrkogård.map(k => esc(k.från ?? '?')).join(', ')}</p>` : '';
  return `<section class="varv ${läge(v)}"><h3>varv ${v.nr} <span>${LÄGESTEXT[läge(v)]}${v.dom?.från ? ' · ' + esc(v.dom.från) : ''}</span></h3>
    <ul>${huvuden}</ul>${svar}${stenar}</section>`;
}

function render(trådar) {
  const nytt = JSON.stringify(trådar);
  if (nytt === avtryck) return;                                       // ingen ändring: låt lyktorna brinna vidare
  avtryck = nytt; senast = trådar;
  const gata = $('gata');
  if (!trådar.length) { gata.innerHTML = '<p class="tom">Gatan är mörk. Ingen fråga har gått genom staden än, ställ en i Frågeporten.</p>'; $('detalj').innerHTML = ''; return; }
  const ordning = [...trådar].sort((a, b) => a.id - b.id);          // äldst till vänster, nyast till höger
  if (!trådar.some(t => t.id === valt)) valt = ([...trådar].sort((a, b) => (b.varv.length > 1) - (a.varv.length > 1) || b.id - a.id)[0]).id;
  const vidSlutet = gata.scrollLeft + gata.clientWidth >= gata.scrollWidth - 20;
  gata.innerHTML = ordning.map(stolpe).join('');
  if (vidSlutet) gata.scrollLeft = gata.scrollWidth;
  visaDetalj();
  const senaste = trådar.flatMap(t => t.varv).sort((a, b) => b.id - a.id)[0];
  document.body.classList.toggle('tänker', !!senaste && !senaste.dom && Date.now() - senaste.ts < 120_000);
}

function visaDetalj() {
  const t = senast.find(x => x.id === valt);
  $('detalj').innerHTML = t ? `<h2>”${esc(kort(t.text, 220))}” <small>${esc(t.från)}${t.varv.length > 1 ? ` · ${t.varv.length} varv` : ''}</small></h2>
    ${[...t.varv].sort((a, b) => a.nr - b.nr).map(renderVarv).join('')}` : '';
}

$('gata').addEventListener('click', ev => {
  const b = ev.target.closest('.stolpe'); if (!b) return;
  valt = Number(b.dataset.id);
  for (const x of document.querySelectorAll('.stolpe')) x.classList.toggle('vald', x === b);
  visaDetalj();
});

async function hämta() {
  try {
    const r = await fetch(API + '/fragor');
    if (!r.ok) throw new Error(r.status);
    render((await r.json()).trådar);
    meddela('');
  } catch { meddela('lyktstolpen når inte sin backend just nu', true); }
}

let väntar;
function snart() { clearTimeout(väntar); väntar = setTimeout(hämta, 400); }

hämta();
setInterval(hämta, 15_000);
try { new EventSource('/api/stream?channel=staden-puls').onmessage = snart; } catch {}
