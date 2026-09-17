// Lyktstolpen (team iPät): varv två i tanken som vandrar genom staden.
//   GET /t/ipat/fragor  → de senaste trådarna: fråga, delsvar, svar, kyrkogård, dom, alla varv i samma tråd
//
// Kritikern skickar tillbaka en fråga med orsak = svaret, och hamnar då på djup 4.
// Där får ingen svara längre, så vi tar emot den och ställer om den som en ny fråga på djup 1,
// med {varv, ursprung, föregående} i nyttolasten så kedjan går att följa. Högst MAX_VARV varv.
// Publikens frågor tar Frågeporten (mohamad) och ann emot, inte vi.
//
// Under gatan ligger Vattenlandet (vattenland.js), GET /t/ipat/vattenland ger läget.

const vattenland = require('./vattenland');

const MAX_VARV = 3;
const TRÅDAR = 8;

const omställda = new Set();  // id på frågor vi redan ställt om

const text = v => typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? (v.text ?? v.svar ?? v.omdöme ?? v.motivering ?? JSON.stringify(v)) : String(v);

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// Bygg trådar ur pulsen: varje fråga på djup 1 är en rot, allt som via orsak leder dit hör till den.
// Omställda frågor pekar på sin ursprungsfråga med nyttolast.ursprung, så alla varv hamnar i samma tråd.
function trådar(pulse) {
  const byId = new Map(pulse.map(e => [e.id, e]));
  const rot = e => { let x = e, n = 0; while (x && x.orsak && byId.has(x.orsak) && n++ < 10) x = byId.get(x.orsak); return x; };
  // ursprung kan peka på frågan eller på något längre ner i kedjan (t.ex. svaret), vi följer den till roten
  const rotId = id => { const x = byId.get(id); if (!x) return id; const r = rot(x); const u = Number(r.nyttolast?.ursprung); return u && u < r.id ? rotId(u) : r.id; };
  const trådar = new Map();
  for (const e of pulse) {
    if (e.typ !== 'fråga' || e.orsak) continue;
    const ursprung = e.nyttolast?.ursprung ? rotId(Number(e.nyttolast.ursprung)) : e.id;
    if (!trådar.has(ursprung)) trådar.set(ursprung, { id: ursprung, text: text(e.nyttolast), från: e.från, ts: e.ts, varv: [] });
    trådar.get(ursprung).varv.push({ id: e.id, nr: Number(e.nyttolast?.varv) || 1, ts: e.ts, delsvar: [], svar: null, kyrkogård: [], dom: null });
  }
  const varvFör = new Map();
  for (const t of trådar.values()) for (const v of t.varv) varvFör.set(v.id, v);
  for (const e of pulse) {
    if (!e.orsak) continue;
    const r = rot(e); const v = r && varvFör.get(r.id); if (!v) continue;
    const kort = { id: e.id, från: e.från, ts: e.ts, text: text(e.nyttolast), djup: e.djup };
    if (e.typ === 'delsvar') v.delsvar.push({ ...kort, motivering: e.nyttolast?.motivering });
    else if (e.typ === 'svar') v.svar = { ...kort, osäkerhet: e.nyttolast?.osäkerhet ?? e.nyttolast?.spridning, valt: e.nyttolast?.från ?? e.nyttolast?.kvarter };
    else if (e.typ === 'kyrkogård') v.kyrkogård.push({ ...kort, fitness: e.nyttolast?.fitness, varför: e.nyttolast?.varför ?? e.nyttolast?.['varför det föll'] });
    else if (e.typ === 'godkänt') v.dom = { ...kort, utslag: 'godkänt' };
    else if (e.typ === 'fråga') v.dom = { ...kort, utslag: 'varv två' };
  }
  // ett varv som följs av ett nytt varv skickades tillbaka, även om kritikern postade frågan utan orsak
  for (const t of trådar.values()) {
    t.varv.sort((a, b) => a.id - b.id);
    t.varv.forEach((v, i) => { const nästa = t.varv[i + 1]; if (nästa && !v.dom) v.dom = { id: nästa.id, från: byId.get(nästa.id)?.från, utslag: 'varv två' }; });
  }
  return [...trådar.values()].sort((a, b) => b.id - a.id).slice(0, TRÅDAR);
}

module.exports = {
  async handle(req, res, { path, board }) {
    if (req.method === 'GET' && path === '/fragor') return send(res, 200, { trådar: trådar(board.pulse(500)) }), true;
    if (req.method === 'GET' && path === '/vattenland') return send(res, 200, vattenland.läge()), true;
    return false;
  },

  init(ctx) { vattenland.init(ctx); },

  // Allt som rinner ner går till Vattenlandet. En fråga från ett annat kvarter som redan har en orsak
  // (kritikerns varv två) ställs dessutom om på djup 1.
  onEvent(e, ctx) {
    vattenland.onEvent(e, ctx);
    const { board } = ctx;
    if (e.typ !== 'fråga' || !e.orsak || omställda.has(e.id)) return;
    omställda.add(e.id);
    const pulse = board.pulse(500);
    const byId = new Map(pulse.map(x => [x.id, x]));
    let r = e, n = 0; while (r.orsak && byId.has(r.orsak) && n++ < 10) r = byId.get(r.orsak);
    // bara kritikerns återskickade frågor: kedjan börjar i en fråga och djupet räcker inte till delsvar + svar.
    // En fråga som väckts av något annat (en kupp, ett elpris) har fortfarande djup kvar och är inte vår sak.
    if (r === e || r.typ !== 'fråga' || (e.djup || 1) < 3) return;
    const ursprung = Number(r.nyttolast?.ursprung) || r.id;
    const förra = Number(r.nyttolast?.varv) || 1;
    const varv = Math.max(Number(e.nyttolast?.varv) || 0, förra + 1);
    if (varv > MAX_VARV) return;
    const t = text(e.nyttolast) || text(r.nyttolast);
    const res = board.emit('fråga', { text: t, varv, ursprung, föregående: e.id, kritik: e.nyttolast?.skäl ?? e.nyttolast?.kritik ?? e.nyttolast?.omdöme });
    if (res.error) console.error('[ipat] kunde inte ställa om frågan:', res.error);
  },
};
