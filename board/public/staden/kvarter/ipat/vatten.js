// Vattenlandet: genomskärningen under gatan. Vattenytan följer nivån, badgästerna guppar,
// pumpen snurrar så länge det finns ström och luckan i botten öppnas när Djupet vaknar.
(() => {
  const API = '/t/ipat/vattenland';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TOPP = 38, BOTTEN = 150;                       // bassängens kanter i SVG:n
  const gäster = [...Array(12)].map((_, i) => ({ x: 70 + ((i * 53) % 200), fas: (i * 0.7) % 2 }));
  let förraRutsch = null, förraBad = '';

  function rita(l) {
    const svg = $('vattensvg');
    svg.classList.toggle('stängt', l.stängt);
    svg.classList.toggle('utan-ström', !l.pumpar);
    svg.classList.toggle('lucka', l.lucka);
    const yta = BOTTEN - (BOTTEN - TOPP) * (l.nivå / 100);
    $('vatten').style.transform = `translateY(${yta.toFixed(1)}px)`;
    $('överlinje').setAttribute('y1', BOTTEN - (BOTTEN - TOPP) * (l.över / 100));
    $('överlinje').setAttribute('y2', BOTTEN - (BOTTEN - TOPP) * (l.över / 100));
    const bad = `${l.badgäster}:${yta.toFixed(0)}`;                            // rita bara om badgästerna när något ändrats
    if (bad !== förraBad) { förraBad = bad; $('badare').innerHTML = gäster.slice(0, l.badgäster).map(g =>
      `<g style="transform:translate(${g.x}px,${yta.toFixed(1)}px)"><g class="badare" style="animation-delay:-${g.fas}s"><circle r="3.2" cy="-2"/><path d="M-4 2h8"/></g></g>`).join(''); }
    $('nivåtext').textContent = `${Math.round(l.nivå)} %`;
    $('vstatus').innerHTML = [
      l.stängt ? '<b class="röd">STÄNGT, översvämning</b>' : `<b>${l.badgäster} badgäster</b> · ${esc(l.väder)}`,
      l.pumpar ? 'pumparna går' : `<b class="röd">pumparna står</b> ${l.pumparOmS} s till`,
      l.lucka ? '<b class="djup">luckan mot Djupet är öppen</b>' : '',
    ].filter(Boolean).join(' · ');
    $('vlogg').innerHTML = l.logg.map(r => `<li><time>${new Date(r.ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}</time> ${esc(r.text)}${r.id ? ` <small>↩${r.id}</small>` : ''}</li>`).join('');
    if (l.rutsch && l.rutsch.ts !== förraRutsch) {                           // ny åktur: skicka en bil ner i kanan
      förraRutsch = l.rutsch.ts;
      const bil = $('rutschbil');
      bil.querySelector('title').textContent = `${l.rutsch.förare} i rutschkanan`;
      bil.classList.add('åker');
      try { $('åkning').beginElement(); } catch {}
      setTimeout(() => bil.classList.remove('åker'), 2200);
    }
  }

  async function hämta() {
    try { const r = await fetch(API); if (r.ok) rita(await r.json()); } catch {}
  }
  hämta();
  setInterval(hämta, 3000);
})();
