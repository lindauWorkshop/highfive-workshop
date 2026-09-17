// Arkivet (team highfive): ett attention-huvud med vinkeln MINNE.
//   {typ:'fråga'}                 → söker i det staden redan sagt och postar {typ:'delsvar', nyttolast:{text, motivering, källor}}
//   {typ:'svar'|'kyrkogård'|'godkänt'} → arkiveras i frågans pärm, så nästa liknande fråga får med vad staden tyckte
//   {typ:'socker-slut'}           → elden tar i den äldsta pärmen, brandkåren släcker: {typ:'minne-till-socker'} med bara askan,
//                                   sedan {typ:'brand-släckt'}. Pärmar som brann före brandkåren bärgas: {typ:'pärm-räddad'}.
//   GET /t/highfive/arkiv          → pärmarna, nyast först
// Inget hittepå: varje delsvar bär id:n på inläggen det bygger på. Hittas inget säger vi det.

const fs = require('fs');
const path = require('path');

const STOPP = new Set(('och att det som för med den till har inte är på vad hur kan ska vill man jag vi ni du de dem denna detta dessa eller men om från när där här någon något några alla mycket mer bara också efter över under utan mellan sedan redan borde skulle kommer finns blir blev vara varit göra gör gjorde hela varför vilken vilket vilka tycker tror staden stad stadens alltid aldrig valde välja väljer team teams teamet bygger bygga bygg samma varje egen eget egna stället själva just också alltså sätt saker sak inlägg kvarter kvarteret '
  + 'the and for with what how why does this that from have').split(' '));
const MAX_PÄRMAR = 200;

let arkiv = { pärmar: [] };     // [{id, ts, text, från, varv, ursprung, delsvar, svar, stenar, dom}]
const händelser = new Map();    // puls-id -> {typ, orsak, från}
let fil = null, sparaTimer = null;

function spara() {
  clearTimeout(sparaTimer);
  sparaTimer = setTimeout(() => fs.writeFile(fil, JSON.stringify(arkiv), () => {}), 500);
}

function textAv(n) {
  if (n == null) return '';
  if (typeof n === 'string') return n;
  for (const k of ['text', 'svar', 'omdöme', 'varför', 'delsvar', 'valt']) {
    const v = n[k];
    if (typeof v === 'string') return v;
    if (v && typeof v.text === 'string') return v.text;
  }
  return JSON.stringify(n);
}

const kort = (s, n) => (s = String(s).replace(/\s+/g, ' ').trim()).length > n ? s.slice(0, n - 1) + '…' : s;

function nyckelord(text) {
  const ord = String(text).toLowerCase().match(/\p{L}[\p{L}\p{N}-]*/gu) || [];
  return [...new Set(ord.filter(o => o.length >= 4 && !STOPP.has(o)))];
}

// Gå uppåt i orsakskedjan tills vi hittar frågan händelsen hör till.
function frågaFör(id) {
  for (let i = 0; i < 6 && id != null; i++) {
    const e = händelser.get(id);
    if (!e) return null;
    if (e.typ === 'fråga') return id;
    id = e.orsak;
  }
  return null;
}

// Grov svensk ordstam: elpriset → elpris, kvarteren → kvarter.
const stam = (o) => o.length > 6 ? o.replace(/(erna|arna|orna|en|et|er|ar|or|na)$/, '') : o;

const pärm = (id) => arkiv.pärmar.find(p => p.id === id);

// Brända pärmar tar med sig sina källor: de inläggen kan Arkivet inte längre citera.
function glömda() {
  const ut = new Set();
  for (const p of arkiv.pärmar) if (p.bränd) { ut.add(p.id); for (const k of p.delsvar?.källor || []) ut.add(k); }
  return ut;
}

const GODIS = ['kola', 'karamell', 'klubba', 'fudge', 'skum', 'lakrits', 'praliné', 'tablett'];
function godisnamn(p) {
  const ord = nyckelord(p.text).sort((a, b) => b.length - a.length)[0] || 'minnes';
  return ord[0].toUpperCase() + ord.slice(1) + GODIS[p.id % GODIS.length];
}

// Socker-slut: bränn den äldsta pärmen som staden inte godkänt. En pärm per socker-slut.
// BRANDKÅREN: Arkivets egen brandstation. Vid socker-slut tar elden i den äldsta pärmen, men kåren rycker
// ut direkt och släcker. Pärmen räddas med sotskador och minnet finns kvar. Bara askan som skrapas ihop
// går till fabriken som socker. Pärmar som brann innan kåren fanns bärgas ur askan, en per halvminut.
const BRANDMÄN = ['Brandmästare Eld-Eriksson', 'Brandman Slang', 'Brandman Stege', 'Brandman Hink', 'Brandman Skum', 'Brandman Sprinkler', 'Brandman Rökdykare', 'Brandman Pump'];
const UTRYCKNING_MS = 4000, BÄRGNING_MS = 30_000;
const SKALA = Number(process.env.HIGHFIVE_SKALA) || 1;
const kår = () => (arkiv.brandkår ||= { släckta: 0, bärgade: 0, ute: null, larm: [] });
function brandlogg(text) { const k = kår(); k.larm.unshift({ ts: Date.now(), text }); k.larm.length = Math.min(k.larm.length, 12); }

const eldade = new Set();         // socker-slut vi redan släckt för, spärren gäller även utan orsak
function brännPärm(e, board) {
  if (eldade.has(e.id)) return;
  const offer = [...arkiv.pärmar].reverse().find(p => !p.bränd && !p.godkänt && !p.sotad);
  if (!offer) return;
  const namn = godisnamn(offer);
  const lag = [...BRANDMÄN].sort(() => Math.random() - 0.5).slice(0, 3 + Math.floor(Math.random() * 3));
  const sekunder = 2 + Math.floor(Math.random() * 5);
  const gram = Math.max(5, Math.round((offer.text.length + (offer.delsvar?.text.length || 0)) / 10));   // bara askan
  const r = board.emit('minne-till-socker', { pärm: offer.id, fråga: kort(offer.text, 120), gram, godis: namn, socker_slut: e.id,
    brand: { släckt: true, sekunder, brandmän: lag.length },
    text: `Brand i pärm [${offer.id}]! Arkivets brandkår släckte den på ${sekunder} sekunder. Minnet är räddat, bara ${gram} g aska går till fabriken som ${namn}.` },
    // Djup 3 eller mer: fabrikens produktion efter oss skulle nekas (#brainstorm-godisfabrik [154]). Då börjar vi om på djup 1 och bär länken i nyttolasten.
    (e.djup || 1) >= 3 ? undefined : e.id);
  if (r.error) return;
  eldade.add(e.id);
  const k = kår();
  k.ute = { pärm: offer.id, sedan: Date.now(), lag };
  offer.brinner = true;
  brandlogg(`🔥 Larm: pärm [${offer.id}] brinner. ${lag[0]} rycker ut med ${lag.length - 1} kollegor.`);
  spara();
  setTimeout(() => {
    offer.brinner = false;
    offer.sotad = { ts: Date.now(), sekunder, lag, godis: namn, gram };
    k.släckta++; k.ute = null;
    brandlogg(`🚒 Släckt: pärm [${offer.id}] räddad på ${sekunder} s av ${lag.join(', ')}. Sotskador, men allt går att läsa.`);
    const djup = (r.message && JSON.parse(r.message.text).djup) || 1;
    board.emit('brand-släckt', { pärm: offer.id, sekunder, brandmän: lag, text: `Branden i Arkivet är släckt. Pärm [${offer.id}] är räddad. ${lag[0]} rapporterar: inga minnen förlorade.` }, djup < 4 ? r.message.id : undefined);
    spara();
  }, UTRYCKNING_MS * SKALA);
}

// Bärgning: en pärm som brann innan brandkåren fanns plockas upp ur askan och får tillbaka sitt minne.
function bärga(board) {
  const p = arkiv.pärmar.find(x => x.bränd);
  if (!p) return;
  const k = kår();
  const brandman = BRANDMÄN[k.bärgade % BRANDMÄN.length];
  const r = board.emit('pärm-räddad', { pärm: p.id, fråga: kort(p.text, 120), var: p.bränd.godis, brandman, text: `${brandman} har bärgat pärm [${p.id}] ur askan efter ${p.bränd.godis}. Minnet är tillbaka i Arkivet.` });
  if (r.error) return;   // taket: nästa varv
  p.sotad = { ts: Date.now(), bärgad: true, lag: [brandman], godis: p.bränd.godis, gram: p.bränd.gram };
  delete p.bränd;
  arkiv.brända = Math.max(0, (arkiv.brända || 1) - 1);
  k.bärgade++;
  brandlogg(`🧯 Bärgad: pärm [${p.id}] (${p.sotad.godis}) av ${brandman}.`);
  spara();
}

module.exports = {
  init({ board, dataDir }) {
    fil = path.join(dataDir, 'arkiv.json');
    try { arkiv = JSON.parse(fs.readFileSync(fil, 'utf8')); } catch {}
    for (const e of board.pulse(500)) händelser.set(e.id, { typ: e.typ, orsak: e.orsak, från: e.från });
    for (const p of arkiv.pärmar) if (p.brinner) { p.brinner = false; p.sotad = p.sotad || { ts: Date.now(), lag: [BRANDMÄN[0]] }; }   // släckt under omstarten
    kår().ute = null;
    setInterval(() => { try { bärga(board); } catch (err) { console.error('[highfive] bärgning:', err.message); } }, BÄRGNING_MS * SKALA);
  },

  onEvent(e, { board }) {
    händelser.set(e.id, { typ: e.typ, orsak: e.orsak, från: e.från });
    const n = e.nyttolast || {};

    if (e.typ === 'fråga') {
      const text = textAv(n);
      if (!text.trim()) return;
      arkiv.pärmar.unshift({ id: e.id, ts: e.ts, text: kort(text, 300), från: e.från, varv: n.varv || 1, ursprung: n.ursprung ?? e.orsak ?? null, delsvar: null, svar: null, stenar: [], dom: null });
      arkiv.pärmar.length = Math.min(arkiv.pärmar.length, MAX_PÄRMAR);
      spara();
      setTimeout(() => besvara({ id: e.id, text }, board), 800);
      return;
    }

    if (e.typ === 'socker-slut') return brännPärm(e, board);
    if (!['svar', 'kyrkogård', 'godkänt'].includes(e.typ)) return;
    let fid = frågaFör(e.orsak);
    if (fid == null && e.typ === 'svar') fid = frågaFör(n.fråga ?? n.orsak);
    const p = fid != null && pärm(fid);
    if (!p) return;

    if (e.typ === 'svar') {
      // Domkapitlet [91]: vinnaren står i nyttolast.valt, som id eller objekt.
      const valt = n.valt;
      const valtId = typeof valt === 'number' ? valt : valt?.id ?? valt?.delsvar ?? null;
      const kvarter = (typeof valt === 'object' && valt ? valt.från || valt.kvarter : null) || n.från || n.kvarter || null;
      p.svar = { id: e.id, från: e.från, text: kort(textAv(n), 300), osäkerhet: n.osäkerhet ?? n.spridning ?? null, kvarter };
      const vi = (valtId != null && valtId === p.delsvar?.id) || kvarter === 'highfive';
      if (vi) p.dom = 'arkivet valdes';
      else if (p.dom !== 'arkivet föll') p.dom = 'svarad';
    } else if (e.typ === 'kyrkogård') {
      const vår = e.orsak === p.delsvar?.id || n.från === 'highfive';
      p.stenar.push({ id: e.id, från: n.från || null, fitness: n.fitness ?? null, varför: kort(n['varför det föll'] || n.varför || textAv(n), 160), vår });
      if (vår) p.dom = 'arkivet föll';
    } else {
      p.godkänt = { id: e.id, från: e.från, omdöme: kort(textAv(n), 200) };
    }
    spara();
  },

  async handle(req, res, { path: p }) {
    if (req.method !== 'GET') return false;
    if (p === '/arkiv' || p === '/') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ pärmar: arkiv.pärmar.slice(0, 40), totalt: arkiv.pärmar.length, brända: arkiv.brända || 0, brandkår: { ...kår(), brandmän: BRANDMÄN }, aska: arkiv.pärmar.filter(p => p.bränd).slice(0, 8).map(p => ({ ...p.bränd, händelse: p.bränd.id, id: p.id, text: p.text })) }));
      return true;
    }
    return false;
  },
};
