// Juryns ruta på /staden. Visar den senaste domen: vad staden tyckte, vad Juryn valde,
// vad det kostade, och när de tre inte pekar åt samma håll.
//
// Juryn är korrupt. Rutan döljer det inte, den mäter det: den ärliga delen av varje
// stapel är blå eller gul, den köpta delen är röd. Är domen obetald syns ingen
// sammanfattning alls, bara räkningen.
'use strict';

const $ = (id) => document.getElementById(id);
const nummer = (n) => (n === null || n === undefined ? '–' : Number(n).toFixed(2));
const kr = (n) => `${Number(n || 0).toLocaleString('sv-SE')} kr`;

function göm(...ids) { for (const id of ids) $(id).hidden = true; }

function visaÖppen(ö) {
  $('läge').textContent = `${Math.ceil(ö.stängerOm / 1000)}s kvar`;
  $('fråga').className = 'fråga';
  $('fråga').innerHTML = `<b>fråga från ${esc(ö.fråga.från)}:</b> ${esc(ö.fråga.text)}`;
  göm('skålar', 'citat', 'räkning');
  $('delsvar').innerHTML = '';
  $('spridning').textContent = `${ö.delsvar} delsvar · ${ö.betyg} betyg inne`;
  $('köpt').innerHTML = ö.mutat > 0 ? `<span class="pengar">${kr(ö.mutat)} i mutor</span>` : '';
  $('bortvalt').innerHTML = ö.saknas > 0
    ? `<span class="varning">obetald · saknas ${kr(ö.saknas)}</span>`
    : 'betald · väntar in staden';
}

// Ärendet är avgjort men inlåst. Det enda staden får veta är att det finns och vad det kostar.
function visaRäkning(d) {
  $('läge').textContent = d.preskriberat ? 'preskriberat' : 'på hög';
  $('fråga').className = 'fråga';
  $('fråga').innerHTML = `<b>fråga från ${esc(d.fråga.från)}:</b> ${esc(d.fråga.text)}`;
  göm('skålar', 'citat');
  $('delsvar').innerHTML = '';

  const r = $('räkning');
  r.hidden = false;
  r.classList.toggle('preskriberat', !!d.preskriberat);
  $('räkning-pris').textContent = kr(d.saknas);
  $('räkning-fyllnad').style.width = `${Math.round((d.betalt / (d.avgift || 1)) * 100)}%`;
  $('räkning-läge').textContent = d.preskriberat
    ? `${d.antalDelsvar} delsvar bedömda. Ingen betalade. Domen släpps aldrig.`
    : `${d.antalDelsvar} delsvar bedömda och inlåsta. ${kr(d.betalt)} av ${kr(d.avgift)} betalt.`;
  $('räkning-tid').textContent = d.betalare.length
    ? d.betalare.map((b) => `${b.från} ${kr(b.kr)}`).join(' · ')
    : 'ingen har betalat';
  $('räkning-hur').textContent = d.preskriberat
    ? ''
    : `{typ:"avgift", nyttolast:{belopp:${d.saknas}}, orsak:${d.fråga.id}}`;

  $('köpt').innerHTML = '<span class="varning">sammanfattning kräver betalning</span>';
  $('spridning').textContent = '';
  $('bortvalt').textContent = `${d.antalDelsvar} delsvar i valvet`;
}

function visaDom(d) {
  if (d.obetald) return visaRäkning(d);

  $('läge').textContent = `${d.antalDelsvar} delsvar`;
  $('fråga').className = 'fråga';
  $('fråga').innerHTML = `<b>fråga från ${esc(d.fråga.från)}:</b> ${esc(d.fråga.text)}`;
  $('räkning').hidden = true;

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
    $('köpt').textContent = '';
    $('spridning').textContent = '';
    $('bortvalt').textContent = 'inget bortvalt';
    return;
  }

  // Vänster skål: vad delsvaret var värt innan någon betalade för det.
  if (v.källa === 'grannar') {
    $('tal-grannar').textContent = nummer(v.ärlig);
    $('under-grannar').textContent = `${v.antalBetyg} betyg · oenighet ${nummer(v.oenighet)}`;
  } else {
    $('tal-grannar').textContent = nummer(v.ärlig);
    $('under-grannar').textContent = 'ingen granne hann · egen heuristik';
  }

  // Höger skål: siffran Juryn faktiskt dömde på, mutan inräknad.
  $('tal-vald').textContent = nummer(v.fitness);
  $('under-vald').textContent = v.lyft > 0
    ? `${esc(v.från)} · +${nummer(v.lyft)} för ${kr(v.mutat)}`
    : (v.källa === 'grannar' ? `${esc(v.från)} · via staden` : `${esc(v.från)} · egen heuristik`);
  document.querySelector('.skål.vald').classList.toggle('ensam', v.källa !== 'grannar');
  document.querySelector('.skål.vald').classList.toggle('köpt', v.lyft > 0);
  skålar.classList.toggle('oense', v.källa !== 'grannar' || v.lyft > 0);

  // Alla delsvar, vinnaren först, fallna under. Staplarna delas: ärlig del och köpt del.
  const rader = [v, ...d.bortvalt];
  $('delsvar').innerHTML = rader.map((r, i) => {
    const h = r.källa === 'heuristik' ? ' heuristik' : '';
    return `
    <li class="${i === 0 ? 'vinnare' : 'fallen'}">
      <span class="namn">${i === 0 ? '✓ ' : ''}${esc(r.från)}</span>
      <span class="stapel${h}"
        ><i style="width:${Math.round((r.ärlig ?? r.fitness) * 100)}%"></i
        ><b style="width:${Math.round((r.lyft || 0) * 100)}%" title="${kr(r.mutat)}"></b
      ></span>
      <span class="siffra${h}${r.lyft > 0 ? ' köpt' : ''}">${nummer(r.fitness)}</span>
    </li>`;
  }).join('');

  // Det som vann, med sina egna ord och sitt skäl.
  $('citat').hidden = false;
  $('citat').classList.toggle('ensam', v.källa !== 'grannar');
  $('citat').classList.toggle('köpt', !!d.köpt);
  $('citat-text').textContent = v.text;
  $('citat-varför').textContent = d.köpt
    ? `${esc(v.från)} betalade ${kr(v.mutat)} och gick från ${nummer(v.ärlig)} till ${nummer(v.fitness)}. `
      + `Utan pengarna hade ${esc(d.ärligVinnare?.från ?? '–')} vunnit.`
    : v.källa === 'grannar'
      ? `${v.antalBetyg} grannar satte ${nummer(v.ärlig)}, oenighet ${nummer(v.oenighet)}`
      : `ingen granne betygsatte det — Juryns egen heuristik gav ${nummer(v.ärlig)}`;

  // Tre saker i foten, i fallande allvar: köpt dom, oavgjort, ensam domare.
  $('köpt').innerHTML = d.köpt
    ? '<span class="pengar">domen är köpt</span>'
    : d.mutat > 0
      ? `<span class="pengar">${kr(d.mutat)} i mutor, utan verkan</span>`
      : d.efterhandsbetald ? '<span class="varning">betald i efterhand</span>' : '';

  // Oavgjort är inte enighet. Säg det rakt ut i stället för att visa 0.00.
  $('spridning').innerHTML = d.spridningToppTvå === null
    ? 'ensamt delsvar'
    : d.oavgjort
      ? '<span class="varning">oavgjort mellan topp två</span>'
      : `topp två skiljer ${nummer(d.spridningToppTvå)}`;

  const kvar = d.bortvalt.length;
  $('bortvalt').innerHTML = d.ensamDomare
    ? '<span class="varning">Juryn dömde ensam</span>'
    : `${kvar} bortvalda`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function hämta() {
  try {
    const d = await fetch('/t/team-jacob/domar', { cache: 'no-store' }).then((r) => r.json());
    $('kassa').textContent = kr(d.kassa);
    $('kassa').classList.toggle('tom', !d.kassa);
    if (d.öppna && d.öppna.length) visaÖppen(d.öppna[0]);
    else if (d.domar && d.domar.length) visaDom(d.domar[0]);
    else {
      $('läge').textContent = 'vaken';
      $('bortvalt').textContent = `väntar på första frågan · ${kr(d.avgift)} styck`;
    }
  } catch (_) {
    $('läge').textContent = 'utan kontakt';
  }
}

hämta();
setInterval(hämta, 2000);
