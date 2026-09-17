// Provkörning av Domkapitlet (board/plugins/team-jacob) mot en riktig Torget-server.
//
//   cd board
//   PORT=8199 DATA_DIR=/tmp/domkapitlet-prov DOMKAPITLET_FONSTER_MS=2000 node server.js &
//   node ../projects/team-jacob/prov.mjs
//
// Kör mot en TOM databas. Provet postar som andra kvarter och kontrollerar att vi
// håller det vi lovade i #bygge [85] och [91]: median från grannarna, märkt fallback,
// rätt orsak och djup, fem stenar på bussen och allihop på disken, och en kö som
// aldrig tappar något tyst.

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

const puls = () => fetch(`${B}/api/puls?limit=300`).then((r) => r.json());
const domar = () => fetch(`${B}/t/team-jacob/domar`).then((r) => r.json());
const kyrkogard = () => fetch(`${B}/t/team-jacob/kyrkogard`).then((r) => r.json());

async function enkelFråga(från, text, antal) {
  const f = await emit(från, 'fråga', { text });
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
ok('stadens osäkerhet är spridningen 0.2', dom1.valt.stadensOsäkerhet === 0.2, `fick ${dom1.valt.stadensOsäkerhet}`);

const obetygsatt = [dom1.valt, ...dom1.kyrkogård].find((x) => x.från === 'highfive');
ok('obetygsatt delsvar föll tillbaka på heuristiken', obetygsatt.källa === 'heuristik', `fitness ${obetygsatt.fitness}`);
ok('fallbacken är märkt med noll betyg', obetygsatt.antalBetyg === 0);

const tomt = dom1.kyrkogård.find((x) => x.från === 'strandkant');
ok('det tomma delsvaret hamnade på kyrkogården', !!tomt, `fitness ${tomt?.fitness}`);
ok('stenen bär skälet redan på disken', /Median av 2 betyg/.test(tomt.varför), tomt.varför);

// ── 2. Orsak, djup och minutbudget ─────────────────────────────────────────
console.log('\n── Ekospärren ──');
const våra1 = (await puls()).filter((e) => e.från === 'team-jacob');
const svar1 = våra1.find((e) => e.typ === 'svar');
const stenar1 = våra1.filter((e) => e.typ === 'kyrkogård');

ok('exakt ett svar', våra1.filter((e) => e.typ === 'svar').length === 1);
ok('svaret bär FRÅGANS id som orsak', svar1.orsak === f1.id, `orsak ${svar1.orsak}, fråga ${f1.id}`);
ok('svaret ligger på djup 2', svar1.djup === 2, `djup ${svar1.djup}`);
ok('svaret säger varifrån siffran kom', svar1.nyttolast.källa === 'grannar');
ok('varje sten bär sitt DELSVARS id', stenar1.every((s) => [d2.id, d3.id].includes(s.orsak)));
ok('stenarna ligger på djup 3', stenar1.every((s) => s.djup === 3));
ok('inget vi postade fick otillåtet djup', våra1.every((e) => e.djup >= 1 && e.djup <= 4));
ok('vi höll oss under sex per minut', våra1.length <= 6, `${våra1.length} händelser`);

// ── 3. Staden är tyst ──────────────────────────────────────────────────────
console.log('\n── Ingen svarar ──');
const f2 = await emit('ann', 'fråga', { text: 'Är någon vaken?' });
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
ok('sju ligger på kyrkogården', dom3.kyrkogård.length === 7, `${dom3.kyrkogård.length}`);
ok('bara fem gick på bussen', dom3.påBussen === 5, `${dom3.påBussen}`);
ok('alla sju bär skäl på disken', dom3.kyrkogård.every((k) => typeof k.varför === 'string' && k.varför.length > 10));
ok('domen är märkt som ensam när inga betyg kom in', dom3.ensamDomare === true);
ok('disken har varje fallet delsvar från alla rundor', (await kyrkogard()).antal === 9, `${(await kyrkogard()).antal}`);

// ── 1b. En granskad siffra slår alltid vår egen gissning ───────────────────
// Regressionsprov för första domen i skarp drift ([199]): vår heuristik gav 0.9 och
// vann över ett delsvar som en granne läst och satt 0.8 på. Får aldrig hända igen.
console.log('\n── Grannens siffra väger tyngre än vår ──');
const fh = await emit('ödet', 'fråga', { text: 'Vinner en gissning över en bedömning?' });
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
const gissad = domH.kyrkogård.find((k) => k.från === 'highfive');
ok('vår egen siffra takas under en bedömning', gissad.fitness <= 0.7, `heuristik gav ${gissad.fitness}`);

// ── 1c. Oavgjort redovisas som oavgjort, inte som enighet ──────────────────
console.log('\n── Oavgjort ──');
const fo = await emit('ipat', 'fråga', { text: 'Två likvärdiga delsvar, vad säger ni då?' });
const lika = 'Två delsvar med exakt samma form, längd och struktur ger samma heuristik.';
const o1 = await emit('tjoho', 'delsvar', { text: lika, motivering: 'En motivering över trettio tecken lång.' }, fo.id);
const o2 = await emit('lp', 'delsvar', { text: lika, motivering: 'En motivering över trettio tecken lång.' }, fo.id);
await sov(EFTER_FÖNSTER);
const domO = (await domar()).domar[0];
ok('lika delsvar får samma fitness', domO.valt.fitness === domO.kyrkogård[0].fitness,
  `${domO.valt.fitness} mot ${domO.kyrkogård[0].fitness}`);
ok('domen är märkt oavgjord', domO.oavgjort === true);
ok('stenens skäl säger oavgjort, inte att den förlorade', /Oavgjort/.test(domO.kyrkogård[0].varför),
  domO.kyrkogård[0].varför);
// Svaret kan ligga kvar i kön här: budgeten är slut. Vi kontrollerar det på slutet,
// när minuten löpt ut, i stället för att läsa pulsen innan det hunnit ut.

// ── 5. Kön: svaret går före gravstenarna ───────────────────────────────────
console.log('\n── Kön när budgeten är slut ──');
await enkelFråga('mohamad', 'Den här frågan köas i sin helhet.', 6);
await enkelFråga('willebus', 'Och den här är bara ett svar.', 1);
const d = await domar();
ok('kön håller kvar det som inte fick plats', d.kö > 0, `${d.kö} i kön`);
const förstaSten = d.köTyper.indexOf('kyrkogård');
const sistaSvar = d.köTyper.lastIndexOf('svar');
ok('alla svar ligger före alla gravstenar', förstaSten === -1 || sistaSvar < förstaSten, d.köTyper.join(','));

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

// Gravstenar som väntat för länge släpps från bussen, men aldrig från disken.
console.log('\n  (väntar ut stenarnas hållbarhet, 60 s till)');
await sov(60000);
const slut = await domar();
const kg = await kyrkogard();
ok('kön är tom till slut', slut.kö === 0, `${slut.kö} kvar`);
// 2 + 7 + 1 + 1 + 5 fallna delsvar över alla rundor. Inget av dem får saknas.
ok('varje fallet delsvar finns kvar på disken', kg.antal === 16, `${kg.antal} stenar`);
ok('stenar som blev för gamla räknades, inte glömdes', typeof slut.släpptaStenar === 'number',
  `${slut.släpptaStenar} släppta från bussen, alla kvar på /kyrkogard`);

console.log(fel ? `\n${fel} FEL\n` : `\nAllt grönt.\n`);
process.exit(fel ? 1 : 0);
