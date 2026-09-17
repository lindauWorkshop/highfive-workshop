// Domkapitlets ruta på /staden. Visar den senaste domen: vad staden tyckte,
// vad Domkapitlet valde, och när de två inte pekar åt samma håll.
'use strict';

const $ = (id) => document.getElementById(id);
const nummer = (n) => (n === null || n === undefined ? '–' : Number(n).toFixed(2));

function visaÖppen(ö) {
  $('läge').textContent = `${Math.ceil(ö.stängerOm / 1000)}s kvar`;
  $('fråga').className = 'fråga';
  $('fråga').innerHTML = `<b>fråga från ${ö.fråga.från}:</b> ${esc(ö.fråga.text)}`;
  $('skålar').hidden = true;
  $('citat').hidden = true;
  $('delsvar').innerHTML = '';
  $('spridning').textContent = `${ö.delsvar} delsvar · ${ö.betyg} betyg inne`;
  $('kyrkogård').textContent = 'väntar in staden';
}

function visaDom(d) {
  $('läge').textContent = `${d.antalDelsvar} delsvar`;
  $('fråga').className = 'fråga';
  $('fråga').innerHTML = `<b>fråga från ${d.fråga.från}:</b> ${esc(d.fråga.text)}`;

  const v = d.valt;
  const skålar = $('skålar');
  skålar.hidden = false;

  if (!v) {
    $('tal-grannar').textContent = '–';
    $('under-grannar').textContent = 'inga delsvar';
    $('tal-vald').textContent = '–';
    $('under-vald').textContent = 'staden var tyst';
    $('delsvar').innerHTML = '';
    $('citat').hidden = true;
    $('spridning').textContent = '';
    $('kyrkogård').textContent = 'kyrkogården tom';
    return;
  }

  // Vänster skål: vad grannarna tyckte om det vinnande delsvaret.
  if (v.källa === 'grannar') {
    $('tal-grannar').textContent = nummer(v.fitness);
    $('under-grannar').textContent = `${v.antalBetyg} betyg · spridning ${nummer(v.stadensOsäkerhet)}`;
  } else {
    $('tal-grannar').textContent = '–';
    $('under-grannar').textContent = 'ingen granne hann';
  }

  // Höger skål: siffran Domkapitlet faktiskt dömde på, och varifrån den kom.
  $('tal-vald').textContent = nummer(v.fitness);
  $('under-vald').textContent = v.källa === 'grannar' ? `${v.från} · via staden` : `${v.från} · egen heuristik`;
  document.querySelector('.skål.vald').classList.toggle('ensam', v.källa !== 'grannar');
  skålar.classList.toggle('oense', v.källa !== 'grannar');

  // Alla delsvar, vinnaren först, fallna under.
  const rader = [v, ...d.kyrkogård];
  $('delsvar').innerHTML = rader.map((r, i) => `
    <li class="${i === 0 ? 'vinnare' : 'fallen'}">
      <span class="namn">${i === 0 ? '✓ ' : ''}${esc(r.från)}</span>
      <span class="stapel ${r.källa === 'heuristik' ? 'heuristik' : ''}"><i style="width:${Math.round(r.fitness * 100)}%"></i></span>
      <span class="siffra ${r.källa === 'heuristik' ? 'heuristik' : ''}">${nummer(r.fitness)}</span>
    </li>`).join('');

  // Det som vann, med sina egna ord och sitt skäl.
  $('citat').hidden = false;
  $('citat').classList.toggle('ensam', v.källa !== 'grannar');
  $('citat-text').textContent = v.text;
  $('citat-varför').textContent = v.källa === 'grannar'
    ? `${v.antalBetyg} grannar satte ${nummer(v.fitness)}, spridning ${nummer(v.stadensOsäkerhet)}`
    : `ingen granne betygsatte det — Domkapitlets egen heuristik gav ${nummer(v.fitness)}`;

  // Oavgjort är inte enighet. Säg det rakt ut i stället för att visa 0.00.
  $('spridning').innerHTML = d.spridningToppTvå === null
    ? 'ensamt delsvar'
    : d.oavgjort
      ? '<span class="varning">oavgjort mellan topp två</span>'
      : `topp två skiljer ${nummer(d.spridningToppTvå)}`;

  const kvar = d.kyrkogård.length;
  $('kyrkogård').innerHTML = d.ensamDomare
    ? '<span class="varning">Domkapitlet dömde ensamt</span>'
    : `${kvar} på kyrkogården`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function hämta() {
  try {
    const d = await fetch('/t/team-jacob/domar', { cache: 'no-store' }).then((r) => r.json());
    if (d.öppna && d.öppna.length) visaÖppen(d.öppna[0]);
    else if (d.domar && d.domar.length) visaDom(d.domar[0]);
    else {
      $('läge').textContent = 'vaken';
      $('kyrkogård').textContent = 'väntar på första frågan';
    }
  } catch (_) {
    $('läge').textContent = 'utan kontakt';
  }
}

hämta();
setInterval(hämta, 2000);
