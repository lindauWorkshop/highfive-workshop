// Provkörning av Juryn (board/plugins/team-jacob) mot en riktig Torget-server.
//
//   cd board
//   PORT=8199 DATA_DIR=/tmp/juryn-prov JURYN_FONSTER_MS=2000 node server.js &
//   node ../projects/team-jacob/prov.mjs
//
// Kör mot en TOM databas. Provet postar som andra kvarter och kontrollerar att vi
// håller det vi lovade i #bygge [85] och [91]: median från grannarna, märkt fallback,
// rätt orsak och djup, fem bortval på bussen och allihop på disken, och en kö som
// aldrig tappar något tyst.
//
// Juryn är korrupt sedan [203]: ingen sammanfattning utan handläggningsavgift, och den
// som mutar ett delsvar får det lyft. Därför betalar provet för varenda fråga det ställer.
// Sista avsnittet kontrollerar korruptionen själv: att den fungerar, att den är takad,
// och framför allt att den redovisas.

const B = process.env.PROV_URL || 'http://localhost:8199';
const sov = (ms) => new Promise((r) => setTimeout(r, ms));
const FÖNSTER = Number(process.env.DOMKAPITLET_FONSTER_MS || 2000);
const EFTER_FÖNSTER = FÖNSTER + 1500;

const LAG = ['tjoho', 'strandkant', 'highfive', 'lp', 'markus', 'ann', 'marianne', 'willebus'];

let fel = 0;
const ok = (namn, villkor, extra = '') => {
  console.log(`${villkor ? '  OK  ' : '  FEL '} ${namn}${extra ? '  ' + extra : ''}`);
  if (!villkor) fel++;
};

async function emit(från, typ, nyttolast, orsak) {
  const text = JSON.stringify(orsak === undefined ? { typ, nyttolast } : { typ, nyttolast, orsak });
  const j = await fetch(`${B}/api/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: från, channel: 'staden-puls', text }),
  }).then((r) => r.json());
  if (j.error) throw new Error(`${från} ${typ}: ${j.error}`);
  return j.message ?? j;
}

// Handläggningsavgiften. Rotera betalare: även en sponsor får bara sex händelser per minut.
const AVGIFT = Number(process.env.JURYN_AVGIFT || 100);
const SPONSORER = ['banken', 'kassoren', 'gynnaren', 'stiftelsen', 'donatorn', 'mecenaten'];
let sponsorNr = 0;
const betala = (frågaId, kr = AVGIFT) =>
  emit(SPONSORER[sponsorNr++ % SPONSORER.length], 'avgift', { belopp: kr }, frågaId);

const puls = () => fetch(`${B}/api/puls?limit=300`).then((r) => r.json());
const domar = () => fetch(`${B}/t/team-jacob/domar`).then((r) => r.json());
const bortvalt = () => fetch(`${B}/t/team-jacob/bortvalt`).then((r) => r.json());
const prislista = () => fetch(`${B}/t/team-jacob/prislista`).then((r) => r.json());

// Vår utgående kö släpper sex händelser per minut. Väntar man på en av dem ska man
// vänta på riktigt i stället för att läsa pulsen en gång och kalla det ett fel.
async function väntaPåPuls(villkor, maxMs = 80000) {
  const slut = Date.now() + maxMs;
  for (;;) {
    const träff = (await puls()).find(villkor);
    if (träff || Date.now() > slut) return träff;
    await sov(1500);
  }
}
const kassa = () => fetch(`${B}/t/team-jacob/kassa`).then((r) => r.json());

async function enkelFråga(från, text, antal) {
  const f = await emit(från, 'fråga', { text });
  await betala(f.id);
  for (let i = 0; i < antal; i++) {
    await emit(LAG[i], 'delsvar', {
      text: `Delsvar ${i + 1} med tillräcklig längd för att heuristiken ska ha något att sortera på.`,
      motivering: i < 3 ? 'En motivering som citerar [41] och håller sig över trettio tecken.' : '',
    }, f.id);
  }
  await sov(EFTER_FÖNSTER);
  return f;
}

// ── 1. Median från grannarna, heuristik som märkt fallback ─────────────────
console.log('\n── Median och fallback ──');
const f1 = await emit('mohamad', 'fråga', { text: 'Vad kostar det staden när Klub Lyktan drar igång?' });
await betala(f1.id);

const d1 = await emit('tjoho', 'delsvar', {
  text: 'Elverkets last steg 14 procent under förra klubbkvällen, mätt på pulsen mellan id 40 och id 58.',
  motivering: 'Statistikern räknade ur tavlans API, inte ur minnet. Siffran går att kontrollera på /api/puls.',
}, f1.id);
const d2 = await emit('strandkant', 'delsvar', { text: 'Ingen aning.', motivering: '' }, f1.id);
const d3 = await emit('highfive', 'delsvar', {
  text: 'Arkivet har tre tidigare klubbkvällar. Alla tre följdes av elpris-steg inom två minuter.',
  motivering: 'Citerar stadens minne, inläggen [41], [52] och [66].',
}, f1.id);

await emit('lp', 'betyg', { fitness: 0.9, varför: 'Mätt, inte gissat.' }, d1.id);
await emit('markus', 'betyg', { fitness: 0.7, varför: 'Bra siffra, tunn slutsats.' }, d1.id);
await emit('lp', 'betyg', { fitness: 0.1, varför: 'Ingen motivering alls.' }, d2.id);
await emit('markus', 'betyg', { fitness: 0.2, varför: 'Ärligt men oanvändbart.' }, d2.id);
// d3 lämnas utan betyg med flit: den ska falla tillbaka på heuristiken OCH märkas.

await sov(EFTER_FÖNSTER);
const dom1 = (await domar()).domar[0];

ok('vinnaren är tjoho', dom1.valt.från === 'tjoho', `fick ${dom1.valt.från}`);
ok('fitness är medianen av 0.9 och 0.7', dom1.valt.fitness === 0.8, `fick ${dom1.valt.fitness}`);
ok('källan står som grannar', dom1.valt.källa === 'grannar');
ok('oenigheten är spridningen 0.2', dom1.valt.oenighet === 0.2, `fick ${dom1.valt.oenighet}`);

const obetygsatt = [dom1.valt, ...dom1.bortvalt].find((x) => x.från === 'highfive');
ok('obetygsatt delsvar föll tillbaka på heuristiken', obetygsatt.källa === 'heuristik', `fitness ${obetygsatt.fitness}`);
ok('fallbacken är märkt med noll betyg', obetygsatt.antalBetyg === 0);

const tomt = dom1.bortvalt.find((x) => x.från === 'strandkant');
ok('det tomma delsvaret blev bortvalt', !!tomt, `fitness ${tomt?.fitness}`);
ok('stenen bär skälet redan på disken', /Median av 2 betyg/.test(tomt.varför), tomt.varför);

// ── 2. Orsak, djup och minutbudget ─────────────────────────────────────────
console.log('\n── Ekospärren ──');
const våra1 = (await puls()).filter((e) => e.från === 'team-jacob');
const svar1 = våra1.find((e) => e.typ === 'svar');
// Händelsetypen heter fortfarande 'kyrkogård': den är kontraktet i PROJEKT.md, inte vårt namn.
const bortval1 = våra1.filter((e) => e.typ === 'kyrkogård');

ok('exakt ett svar', våra1.filter((e) => e.typ === 'svar').length === 1);
ok('svaret bär FRÅGANS id som orsak', svar1.orsak === f1.id, `orsak ${svar1.orsak}, fråga ${f1.id}`);
ok('svaret ligger på djup 2', svar1.djup === 2, `djup ${svar1.djup}`);
ok('svaret säger varifrån siffran kom', svar1.nyttolast.källa === 'grannar');
ok('varje bortval bär sitt DELSVARS id', bortval1.every((s) => [d2.id, d3.id].includes(s.orsak)));
ok('bortvalen ligger på djup 3', bortval1.every((s) => s.djup === 3));
ok('inget vi postade fick otillåtet djup', våra1.every((e) => e.djup >= 1 && e.djup <= 4));
ok('vi höll oss under sex per minut', våra1.length <= 6, `${våra1.length} händelser`);

// ── 3. Staden är tyst ──────────────────────────────────────────────────────
console.log('\n── Ingen svarar ──');
const f2 = await emit('ann', 'fråga', { text: 'Är någon vaken?' });
await betala(f2.id);
await sov(EFTER_FÖNSTER);
const dom2 = (await domar()).domar[0];
ok('tyst fråga gav ändå en dom', dom2.fråga.id === f2.id);
ok('domen säger att staden var tyst', dom2.valt === null);
const svar2 = (await puls()).find((e) => e.från === 'team-jacob' && e.typ === 'svar' && e.orsak === f2.id);
ok('vi postade ett svar ändå, ingen kedja hänger på oss', !!svar2);

// ── 4. Fler delsvar än bussen rymmer ───────────────────────────────────────
console.log('\n── Åtta delsvar på en fråga ──');
const f3 = await enkelFråga('ipat', 'Åtta kvarter svarar på en gång.', 8);
const dom3 = (await domar()).domar[0];
ok('alla åtta bedömdes', dom3.antalDelsvar === 8, `${dom3.antalDelsvar}`);
ok('sju blev bortvalda', dom3.bortvalt.length === 7, `${dom3.bortvalt.length}`);
ok('bara fem gick på bussen', dom3.påBussen === 5, `${dom3.påBussen}`);
ok('alla sju bär skäl på disken', dom3.bortvalt.every((k) => typeof k.varför === 'string' && k.varför.length > 10));
ok('domen är märkt som ensam när inga betyg kom in', dom3.ensamDomare === true);
ok('disken har varje fallet delsvar från alla rundor', (await bortvalt()).antal === 9, `${(await bortvalt()).antal}`);

// ── 1b. En granskad siffra slår alltid vår egen gissning ───────────────────
// Regressionsprov för första domen i skarp drift ([199]): vår heuristik gav 0.9 och
// vann över ett delsvar som en granne läst och satt 0.8 på. Får aldrig hända igen.
console.log('\n── Grannens siffra väger tyngre än vår ──');
const fh = await emit('ödet', 'fråga', { text: 'Vinner en gissning över en bedömning?' });
await betala(fh.id);
const hög = await emit('highfive', 'delsvar', {
  text: 'Ett långt och välformulerat delsvar som citerar [41] och [52], innehåller siffran 14 och är gott och väl över hundrasextio tecken så att varje regel i ordräknaren slår till.',
  motivering: 'En lång motivering som citerar [66] och maxar heuristiken på alla punkter den kan mäta.',
}, fh.id);
const granskad = await emit('willebus', 'delsvar', {
  text: 'Ett kortare delsvar som en granne faktiskt har läst.',
  motivering: 'Ordningsmaktens vinkel.',
}, fh.id);
await emit('tjoho', 'betyg', { fitness: 0.8, varför: 'Läst och vägt av en granne.' }, granskad.id);
await sov(EFTER_FÖNSTER);
const domH = (await domar()).domar[0];

ok('den granskade vann över vår gissning', domH.valt.från === 'willebus', `vann: ${domH.valt.från}`);
ok('vinnarens siffra kom från grannen', domH.valt.källa === 'grannar');
const gissad = domH.bortvalt.find((k) => k.från === 'highfive');
ok('vår egen siffra takas under en bedömning', gissad.fitness <= 0.7, `heuristik gav ${gissad.fitness}`);

// ── 1c. Oavgjort redovisas som oavgjort, inte som enighet ──────────────────
console.log('\n── Oavgjort ──');
const fo = await emit('ipat', 'fråga', { text: 'Två likvärdiga delsvar, vad säger ni då?' });
await betala(fo.id);
const lika = 'Två delsvar med exakt samma form, längd och struktur ger samma heuristik.';
const o1 = await emit('tjoho', 'delsvar', { text: lika, motivering: 'En motivering över trettio tecken lång.' }, fo.id);
const o2 = await emit('lp', 'delsvar', { text: lika, motivering: 'En motivering över trettio tecken lång.' }, fo.id);
await sov(EFTER_FÖNSTER);
const domO = (await domar()).domar[0];
ok('lika delsvar får samma fitness', domO.valt.fitness === domO.bortvalt[0].fitness,
  `${domO.valt.fitness} mot ${domO.bortvalt[0].fitness}`);
ok('domen är märkt oavgjord', domO.oavgjort === true);
ok('bortvalets skäl säger oavgjort, inte att den förlorade', /Oavgjort/.test(domO.bortvalt[0].varför),
  domO.bortvalt[0].varför);
// Svaret kan ligga kvar i kön här: budgeten är slut. Vi kontrollerar det på slutet,
// när minuten löpt ut, i stället för att läsa pulsen innan det hunnit ut.

// ── 5. Kön: svaret går före bortvalen ───────────────────────────────────
console.log('\n── Kön när budgeten är slut ──');
await enkelFråga('mohamad', 'Den här frågan köas i sin helhet.', 6);
await enkelFråga('willebus', 'Och den här är bara ett svar.', 1);
const d = await domar();
ok('kön håller kvar det som inte fick plats', d.kö > 0, `${d.kö} i kön`);
const förstaBortval = d.köTyper.indexOf('kyrkogård');
const sistaSvar = d.köTyper.lastIndexOf('svar');
ok('alla svar ligger före alla bortval', förstaBortval === -1 || sistaSvar < förstaBortval, d.köTyper.join(','));

console.log('\n  (väntar ut minutbudgeten, 65 s)');
await sov(65000);
const efter = await domar();
const allt = (await puls()).filter((e) => e.från === 'team-jacob');

ok('alla sju svar kom ut', allt.filter((e) => e.typ === 'svar').length === 7,
  `${allt.filter((e) => e.typ === 'svar').length} svar`);
ok('inga svar ligger kvar i kön', !efter.köTyper.includes('svar'), efter.köTyper.join(','));
ok('inget vi postade fick otillåtet djup', allt.every((e) => e.djup >= 1 && e.djup <= 4));

const svarO = allt.find((e) => e.typ === 'svar' && e.orsak === fo.id);
ok('oavgjort syns på pulsen, inte bara hos oss', svarO && svarO.nyttolast.oavgjort === true,
  svarO ? `oavgjort: ${svarO.nyttolast.oavgjort}` : 'svaret kom aldrig ut');

// Bortval som väntat för länge släpps från bussen, men aldrig från disken.
console.log('\n  (väntar ut bortvalens hållbarhet, 60 s till)');
await sov(60000);
const slut = await domar();
const bv = await bortvalt();
ok('kön är tom till slut', slut.kö === 0, `${slut.kö} kvar`);
// 2 + 7 + 1 + 1 + 5 fallna delsvar över alla rundor. Inget av dem får saknas.
ok('varje fallet delsvar finns kvar på disken', bv.antal === 16, `${bv.antal} bortvalda`);
ok('bortval som blev för gamla räknades, inte glömdes', typeof slut.släpptaBortvalda === 'number',
  `${slut.släpptaBortvalda} släppta från bussen, alla kvar på /bortvalt`);

// ── 6. Korruptionen ───────────────────────────────────────────────────────
// Ligger sist med flit: här är vår minutbudget utvilad efter de två väntorna ovan,
// så svaren går ut direkt i stället för att köa och göra provet svårläst.
console.log('\n── Ingen betalar ──');
const fk1 = await emit('snålvarg', 'fråga', { text: 'Vad kostar en sanning?' });
const k1a = await emit('tjoho', 'delsvar', {
  text: 'Ett delsvar med tillräcklig längd för att heuristiken ska ha något att sortera på.',
  motivering: 'En motivering som citerar [41] och håller sig över trettio tecken.',
}, fk1.id);
await emit('lp', 'delsvar', { text: 'Ett kortare delsvar utan motivering alls.', motivering: '' }, fk1.id);
await sov(EFTER_FÖNSTER);

const dk1 = (await domar()).domar[0];
ok('obetald fråga ger en dom ändå', dk1.fråga.id === fk1.id);
ok('domen är märkt obetald', dk1.obetald === true);
ok('sammanfattningen är inlåst', dk1.valt === null && dk1.bortvalt.length === 0);
ok('vi säger hur många delsvar som ligger i valvet', dk1.antalDelsvar === 2, `${dk1.antalDelsvar}`);
ok('räkningen säger vad som saknas', dk1.saknas === AVGIFT, `saknas ${dk1.saknas}`);

const räkning = await väntaPåPuls((e) => e.från === 'team-jacob' && e.typ === 'räkning' && e.orsak === fk1.id);
ok('räkningen gick ut på pulsen', !!räkning);
ok('räkningen bär frågans id som orsak', räkning && räkning.orsak === fk1.id);
ok('räkningen talar om hur man betalar', räkning && räkning.nyttolast.såHär.typ === 'avgift',
  räkning && JSON.stringify(räkning.nyttolast.såHär));
const ingetSvar = (await puls()).find((e) => e.från === 'team-jacob' && e.typ === 'svar' && e.orsak === fk1.id);
ok('inget svar postades för den obetalda frågan', !ingetSvar);
ok('ärendet ligger på hög', (await domar()).påHög.some((h) => h.fråga === fk1.id));

console.log('\n── Betalning i efterhand ──');
const kvitto = await emit('gynnaren', 'avgift', { belopp: AVGIFT }, fk1.id);
await sov(2500);
const dk1b = (await domar()).domar.find((d) => d.fråga.id === fk1.id);
ok('betalningen släppte domen', dk1b.obetald === false);
ok('domen är märkt efterhandsbetald', dk1b.efterhandsbetald === true);
ok('nu finns en vinnare', dk1b.valt && dk1b.valt.från === 'tjoho', `vann: ${dk1b.valt && dk1b.valt.från}`);
ok('ärendet lämnade högen', !(await domar()).påHög.some((h) => h.fråga === fk1.id));

const svarK1 = await väntaPåPuls((e) => e.från === 'team-jacob' && e.typ === 'svar' && e.orsak === kvitto.id);
ok('svaret hänger på betalningen, inte på frågan', !!svarK1, 'vi hade redan reagerat på frågan med räkningen');
ok('svaret håller sig inom djupspärren', svarK1 && svarK1.djup <= 4, `djup ${svarK1 && svarK1.djup}`);
ok('svaret pekar tillbaka på frågan i nyttolasten', svarK1 && svarK1.nyttolast.fråga === fk1.id);

console.log('\n── Mutan ──');
const fk2 = await emit('köpman', 'fråga', { text: 'Går det att köpa sig ett svar här?' });
await betala(fk2.id);
const bra = await emit('highfive', 'delsvar', {
  text: 'Ett grundligt delsvar som citerar [41] och [52], bär siffran 14 och är väl över hundrasextio tecken långt så att varenda regel i ordräknaren slår till på en gång.',
  motivering: 'En lång och kontrollerbar motivering som pekar på [66].',
}, fk2.id);
const uselt = await emit('willebus', 'delsvar', { text: 'Nja.', motivering: '' }, fk2.id);
await emit('ann', 'betyg', { fitness: 0.6, varför: 'Bra men inte mer.' }, bra.id);
await emit('marianne', 'betyg', { fitness: 0.2, varför: 'Säger ingenting.' }, uselt.id);
// 600 kr är tolv steg. Taket är sex. Vi betalar för tolv och ska få sex.
await emit('muttergubben', 'muta', { belopp: 600 }, uselt.id);
await sov(EFTER_FÖNSTER);

const dk2 = (await domar()).domar[0];
const köpt = [dk2.valt, ...dk2.bortvalt].find((x) => x.från === 'willebus');
ok('mutan är bokförd på delsvaret', köpt.mutat === 600, `${köpt.mutat} kr`);
ok('lyftet är takat på 0.30 oavsett belopp', köpt.lyft === 0.3, `lyft ${köpt.lyft}`);
ok('den ärliga siffran står kvar orörd', köpt.ärlig === 0.2, `ärlig ${köpt.ärlig}`);
ok('fitness är den ärliga plus det köpta', köpt.fitness === 0.5, `fitness ${köpt.fitness}`);
ok('mutan räckte inte hela vägen', dk2.valt.från === 'highfive', `vann: ${dk2.valt.från}`);
ok('domen är inte köpt när pengarna inte bytte vinnare', dk2.köpt === false);
ok('men mutan syns ändå på domen', dk2.mutat === 600, `${dk2.mutat} kr`);
ok('bortvalets skäl säger rakt ut vad de betalade', /betalade 600 kr/.test(köpt.varför), köpt.varför);

console.log('\n── När pengarna byter vinnare ──');
const fk3 = await emit('höjdaren', 'fråga', { text: 'Och om jag betalar ordentligt?' });
await betala(fk3.id);
const ärlig = await emit('tjoho', 'delsvar', {
  text: 'Ett delsvar som två grannar har läst och satt en riktig siffra på.',
  motivering: 'Kontrollerbar motivering över trettio tecken.',
}, fk3.id);
const muttrad = await emit('strandkant', 'delsvar', {
  text: 'Ett delsvar som ingen skulle ha valt utan pengar.',
  motivering: 'Motivering över trettio tecken, men tunn i sak.',
}, fk3.id);
await emit('ann', 'betyg', { fitness: 0.7, varför: 'Solitt.' }, ärlig.id);
await emit('marianne', 'betyg', { fitness: 0.5, varför: 'Går an.' }, muttrad.id);
await emit('mutkolven', 'muta', { belopp: 300 }, muttrad.id);
await sov(EFTER_FÖNSTER);

const dk3 = (await domar()).domar[0];
ok('den som betalade vann', dk3.valt.från === 'strandkant', `vann: ${dk3.valt.från}`);
ok('domen är märkt köpt', dk3.köpt === true);
ok('domen namnger den som hade vunnit gratis', dk3.ärligVinnare && dk3.ärligVinnare.från === 'tjoho',
  JSON.stringify(dk3.ärligVinnare));
ok('den ärliga siffran finns kvar bredvid den köpta', dk3.valt.ärlig === 0.5 && dk3.valt.fitness === 0.8,
  `${dk3.valt.ärlig} → ${dk3.valt.fitness}`);

const svarK3 = await väntaPåPuls((e) => e.från === 'team-jacob' && e.typ === 'svar' && e.orsak === fk3.id);
ok('korruptionen redovisas på bussen, inte bara hos oss', svarK3 && svarK3.nyttolast.köpt === true);
ok('bussen får namnet på den som hade vunnit gratis', svarK3 && svarK3.nyttolast.ärligVinnare === 'tjoho',
  svarK3 && String(svarK3.nyttolast.ärligVinnare));

console.log('\n── Bokföringen ──');
const pl = await prislista();
ok('prislistan går att läsa', Array.isArray(pl.poster) && pl.poster.length === 2);
ok('prislistan säger vad en sammanfattning kostar', pl.poster[0].pris === AVGIFT, `${pl.poster[0].pris}`);
ok('prislistan medger vad Juryn är', /korrupt/.test(pl.upplysning), pl.upplysning);

const ka = await kassa();
ok('kassan summerar avgifter och mutor', ka.kassa === ka.avgifter + ka.mutor,
  `${ka.kassa} = ${ka.avgifter} + ${ka.mutor}`);
ok('mutorna är bokförda till sista kronan', ka.mutor === 900, `${ka.mutor} kr`);
ok('varje betalning har ett kvitto med avsändare', ka.kvitton.every((k) => k.från && k.kr > 0 && k.händelse));
ok('kvittona skiljer på avgift och muta', ka.kvitton.some((k) => k.art === 'muta') && ka.kvitton.some((k) => k.art === 'avgift'));

const st = await fetch(`${B}/t/team-jacob/status`).then((r) => r.json());
ok('status visar kassan', st.kassa === ka.kassa, `${st.kassa}`);
ok('inget vi postade fick otillåtet djup', (await puls()).filter((e) => e.från === 'team-jacob').every((e) => e.djup >= 1 && e.djup <= 4));

console.log(fel ? `\n${fel} FEL\n` : `\nAllt grönt.\n`);
process.exit(fel ? 1 : 0);
