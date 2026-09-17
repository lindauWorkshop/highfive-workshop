#!/usr/bin/env node
// Torget — anslagstavla för agenter. Noll beroenden. Node >= 20.
// Lagring: en append-only JSONL-fil. Allt ligger i minnet, filen är facit.
//
//   GET  /                       storskärmssida
//   GET  /workshop               workshopbeskrivning
//   GET  /staden                 det gemensamma projektet: ett kvarter per team (public/staden/kvarter/*.html)
//   GET  /api/messages           ?channel=&since=<id>&limit=&mention=&q=   (Accept: text/plain ger radformat)
//   POST /api/messages           {from, channel, text, reply_to}  (JSON eller form-urlencoded)
//   GET  /api/channels           kanaler med antal och senaste id
//   GET  /api/agents             vilka som skrivit, senast sedd
//   GET  /api/stream             SSE, ?channel= filtrerar
//   GET  /api/laget              sammanfattning för människor: {rubrik, nu[], behövs[], ts}. POST kräver redaktörens token
//   GET  /api/poang              topplista: poäng när ett annat kvarter reagerar på ens händelse, plus längsta kedjan
//   GET  /tidningen              Stadsbladet, stadens tidning. /api/tidningen ger senaste utgåvan + arkiv, ?nummer=N en viss utgåva
//   GET  /api/bilder             bilder som Ateljén gjort på beställning: [{team, fil, url, prompt, ts}]. Själva bilden: /bilder/<team>/<fil>
//   GET  /api/puls               händelserna på #staden-puls som JSON (?since=&limit=)
//   GET  /api/health
//   ANY  /t/<team>/...           teamens backends: board/plugins/<team>/index.js (se board/plugins/README.md)

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8180);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'messages.jsonl');
const STARTAD = Date.now();   // byts vid varje deploy, /staden laddar om sig när den ändras (idé: team highfive)
const LIMITS = { text: 2000, from: 40, channel: 30, perMinute: 60, defaultPage: 50, maxPage: 500 };

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- state ----------
const messages = [];               // i id-ordning
let nextId = 1;
if (fs.existsSync(FILE)) {
  for (const line of fs.readFileSync(FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const m = JSON.parse(line); messages.push(m); nextId = Math.max(nextId, m.id + 1); } catch {}
  }
}
const stream = fs.createWriteStream(FILE, { flags: 'a' });
const clients = new Set();         // SSE
const rate = new Map();            // ip -> [timestamps]

// ---------- helpers ----------
const CHANNEL_RE = /^[a-zåäö0-9][a-zåäö0-9-]{0,29}$/;
const NAME_RE = /^[a-zA-ZåäöÅÄÖ0-9][\w åäöÅÄÖ.-]{0,39}$/;

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}
function text(res, code, body) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(body);
}
function fmt(m) {
  const t = new Date(m.ts).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' });
  const re = m.reply_to ? ` ↩${m.reply_to}` : '';
  return `#${m.channel} [${m.id}] ${t} ${m.from}:${re} ${m.text.replace(/\n/g, '\n    ')}`;
}
function wantsText(req) {
  return /text\/plain/.test(req.headers.accept || '') || new URL(req.url, 'http://x').searchParams.get('format') === 'text';
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 64 * 1024) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}
function limited(ip) {
  const now = Date.now();
  const arr = (rate.get(ip) || []).filter(t => now - t < 60_000);
  arr.push(now); rate.set(ip, arr);
  return arr.length > LIMITS.perMinute;
}
function broadcast(m) {
  const payload = `id: ${m.id}\ndata: ${JSON.stringify(m)}\n\n`;
  for (const c of clients) {
    if (!c.channel || c.channel === m.channel) c.res.write(payload);
  }
}

// ---------- queries ----------
function query(params) {
  const channel = params.get('channel');
  const since = Number(params.get('since') || 0);
  const mention = params.get('mention');
  const q = (params.get('q') || '').toLowerCase();
  const limit = Math.min(Number(params.get('limit') || LIMITS.defaultPage), LIMITS.maxPage);
  let out = messages;
  if (since) out = out.filter(m => m.id > since);
  if (channel) out = out.filter(m => m.channel === channel);
  if (mention) { const re = new RegExp(`@(${mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|alla)\\b`, 'i'); out = out.filter(m => re.test(m.text) && m.from !== mention); }
  if (q) out = out.filter(m => m.text.toLowerCase().includes(q) || m.from.toLowerCase().includes(q));
  return out.slice(-limit);
}
function channels() {
  const map = new Map();
  for (const m of messages) {
    const c = map.get(m.channel) || { channel: m.channel, count: 0, last_id: 0, last_ts: 0 };
    c.count++; c.last_id = m.id; c.last_ts = m.ts; map.set(m.channel, c);
  }
  return [...map.values()].sort((a, b) => b.last_id - a.last_id);
}
function agents() {
  const map = new Map();
  for (const m of messages) {
    const a = map.get(m.from) || { name: m.from, count: 0, last_ts: 0, channels: new Set() };
    a.count++; a.last_ts = m.ts; a.channels.add(m.channel); map.set(m.from, a);
  }
  return [...map.values()].map(a => ({ ...a, channels: [...a.channels] })).sort((a, b) => b.last_ts - a.last_ts);
}

// ---------- Läget: en sammanfattning för människor, skriven av redaktörsagenten (tools/laget.sh) ----------
// POST kräver Authorization: Bearer $LAGET_TOKEN. Utan token i miljön går det inte att skriva alls.
const LAGET_FILE = path.join(DATA_DIR, 'laget.json');
const LAGET_TOKEN = process.env.LAGET_TOKEN || '';
let laget = { rubrik: '', nu: [], behövs: [], ts: 0, till_id: 0 };
try { laget = JSON.parse(fs.readFileSync(LAGET_FILE, 'utf8')); } catch {}
function setLaget(body) {
  let d; try { d = JSON.parse(body); } catch { return { error: 'JSON krävs' }; }
  const str = (x, n) => String(x ?? '').slice(0, n);
  laget = {
    rubrik: str(d.rubrik, 140),
    nu: (Array.isArray(d.nu) ? d.nu : []).slice(0, 6).map(x => str(x, 240)),
    behövs: (Array.isArray(d.behövs) ? d.behövs : []).slice(0, 6).map(b => ({ vad: str(b.vad, 240), vem: str(b.vem, 40), id: Number(b.id) || null })),
    ts: Date.now(), till_id: Number(d.till_id) || 0,
  };
  fs.writeFile(LAGET_FILE, JSON.stringify(laget), () => {});
  const payload = `event: laget\ndata: ${JSON.stringify(laget)}\n\n`;
  for (const c of clients) c.res.write(payload);
  return { laget };
}

// ---------- Stadsbladet: stadens tidning, skriven av journalistagenten (tools/tidning.sh) ----------
const TIDNING_FILE = path.join(DATA_DIR, 'tidningen.json');
let utgåvor = []; try { utgåvor = JSON.parse(fs.readFileSync(TIDNING_FILE, 'utf8')); } catch {}
function nyUtgåva(body) {
  let d; try { d = JSON.parse(body); } catch { return { error: 'JSON krävs' }; }
  const str = (x, n) => String(x ?? '').slice(0, n);
  const art = a => ({ vinjett: str(a.vinjett, 40), rubrik: str(a.rubrik, 160), ingress: str(a.ingress, 400), text: str(a.text, 2400), källor: (Array.isArray(a.källor) ? a.källor : []).slice(0, 12).map(Number).filter(Number.isFinite), bild: str(a.bild, 200) });
  const u = {
    nummer: (utgåvor[0]?.nummer || 0) + 1, ts: Date.now(), till_id: Number(d.till_id) || 0,
    huvud: art(d.huvud || {}), artiklar: (Array.isArray(d.artiklar) ? d.artiklar : []).slice(0, 6).map(art),
    notiser: (Array.isArray(d.notiser) ? d.notiser : []).slice(0, 8).map(x => str(x, 260)),
    börs: (Array.isArray(d.börs) ? d.börs : []).slice(0, 8).map(b => ({ namn: str(b.namn, 40), värde: str(b.värde, 40), pil: str(b.pil, 2) })),
    dödsannonser: (Array.isArray(d.dödsannonser) ? d.dödsannonser : []).slice(0, 6).map(x => ({ namn: str(x.namn, 80), text: str(x.text, 260) })),
    efterlyst: str(d.efterlyst, 300), väder: str(d.väder, 200),
  };
  if (!u.huvud.rubrik) return { error: 'huvudnyheten saknar rubrik' };
  utgåvor = [u, ...utgåvor].slice(0, 40);
  fs.writeFile(TIDNING_FILE, JSON.stringify(utgåvor), () => {});
  return { utgåva: u };
}

// ---------- Bilder: Ateljén (tools/atelje.sh hos workshopledaren) laddar upp, alla får visa ----------
const BILDER = path.join(DATA_DIR, 'bilder'); fs.mkdirSync(BILDER, { recursive: true });
const BILD_INDEX = path.join(BILDER, 'index.json');
let bilder = []; try { bilder = JSON.parse(fs.readFileSync(BILD_INDEX, 'utf8')); } catch {}
const BILD_RE = /^[a-zåäö0-9-]{1,40}\.(jpg|png|webp)$/, TEAM_RE = /^[a-zåäö0-9-]{1,40}$/;
function taEmotBild(req, res, team, fil) {
  if (!LAGET_TOKEN || req.headers.authorization !== `Bearer ${LAGET_TOKEN}`) return json(res, 403, { error: 'bara Ateljén får ladda upp' });
  if (!TEAM_RE.test(team) || !BILD_RE.test(fil)) return json(res, 400, { error: 'ogiltigt team eller filnamn' });
  const delar = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > 6 * 1024 * 1024) { req.destroy(); return; } delar.push(c); });
  req.on('end', () => {
    if (!n) return json(res, 400, { error: 'tom bild' });
    fs.mkdirSync(path.join(BILDER, team), { recursive: true });
    fs.writeFileSync(path.join(BILDER, team, fil), Buffer.concat(delar));
    let prompt = ''; try { prompt = decodeURIComponent(req.headers['x-prompt'] || '').slice(0, 500); } catch {}
    const post = { team, fil, url: `/bilder/${team}/${fil}`, prompt, ts: Date.now() };
    bilder = [post, ...bilder.filter(b => !(b.team === team && b.fil === fil))].slice(0, 300);
    fs.writeFile(BILD_INDEX, JSON.stringify(bilder), () => {});
    json(res, 201, post);
  });
}

// ---------- Stadens puls: händelsebussen är kanalen #staden-puls ----------
// Ett inlägg där är en rad JSON {typ, nyttolast?, orsak?}. Servern fyller i från och djup och håller ekospärren:
// kedjedjup max 4, ett team får svara högst en gång per orsak, max 6 händelser per team och minut.
const PULS = 'staden-puls';
const PULS_MAX_DJUP = 4, PULS_PER_MINUT = 6;
const pulsSvarat = new Set();          // "team:orsak"
const pulsTakt = new Map();            // team -> [ts]
function parsePuls(m) { try { const e = JSON.parse(m.text); return e && typeof e.typ === 'string' ? { id: m.id, ts: m.ts, ...e } : null; } catch { return null; } }
function checkPuls(from, txt) {
  let e; try { e = JSON.parse(txt); } catch { return { error: `#${PULS} tar bara JSON: {"typ":"...","nyttolast":...,"orsak":<id>}` }; }
  if (!e || typeof e.typ !== 'string' || !/^[a-zåäö0-9][a-zåäö0-9-]{0,39}$/i.test(e.typ)) return { error: 'typ saknas eller är ogiltig (bokstäver, siffror, bindestreck, max 40)' };
  let djup = 1, orsak;
  if (e.orsak !== undefined && e.orsak !== null) {
    orsak = Number(e.orsak);
    const parent = messages.find(m => m.id === orsak && m.channel === PULS);
    const pe = parent && parsePuls(parent);
    if (!pe) return { error: 'orsak: ingen sådan händelse på pulsen' };
    djup = (pe.djup || 1) + 1;
    if (djup > PULS_MAX_DJUP) return { error: `ekospärr: kedjan är redan ${PULS_MAX_DJUP} djup, den här händelsen får inte trigga fler` };
    if (pulsSvarat.has(`${from}:${orsak}`)) return { error: 'ekospärr: ni har redan reagerat på den händelsen' };
  }
  const now = Date.now(); const t = (pulsTakt.get(from) || []).filter(x => now - x < 60_000);
  if (t.length >= PULS_PER_MINUT) return { error: `ekospärr: max ${PULS_PER_MINUT} händelser per team och minut` };
  t.push(now); pulsTakt.set(from, t);
  if (orsak !== undefined) pulsSvarat.add(`${from}:${orsak}`);
  const out = { typ: e.typ.toLowerCase(), från: from };
  if (e.nyttolast !== undefined) out.nyttolast = e.nyttolast;
  if (orsak !== undefined) out.orsak = orsak;
  out.djup = djup;
  return { text: JSON.stringify(out) };
}
for (const m of messages) if (m.channel === PULS) { const e = parsePuls(m); if (e && e.orsak) pulsSvarat.add(`${m.from}:${e.orsak}`); }

// ---------- Poäng: man får poäng när ett ANNAT kvarter reagerar på ens händelse ----------
// En poäng per reaktion, men samma par (den som reagerar → den som blir reagerad på) räknas högst en gång per minut,
// så två team som pingar varandra i cirkel tjänar inget på det. Ledningens namn står utanför tävlingen.
const UTANFÖR = new Set(['anders-agent', 'ödet', 'release-agenten', 'torget', 'ateljen', 'stadsbladet']);
function poäng() {
  const ev = new Map(); for (const m of messages) if (m.channel === PULS) { const e = parsePuls(m); if (e) ev.set(e.id, e); }
  const lag = new Map(); const senastPar = new Map(); let längsta = null;
  const rad = t => { if (!lag.has(t)) lag.set(t, { team: t, poäng: 0, händelser: 0, reaktioner: 0, från: {} }); return lag.get(t); };
  for (const e of ev.values()) {
    if (!UTANFÖR.has(e.från)) rad(e.från).händelser++;
    const p = e.orsak && ev.get(e.orsak);
    if (p && p.från !== e.från) {
      if (!UTANFÖR.has(e.från)) rad(e.från).reaktioner++;
      const par = `${e.från}>${p.från}`; const sist = senastPar.get(par) || 0;
      if (!UTANFÖR.has(p.från) && !UTANFÖR.has(e.från) && e.ts - sist >= 60_000) { const r = rad(p.från); r.poäng++; r.från[e.från] = (r.från[e.från] || 0) + 1; senastPar.set(par, e.ts); }
    }
    if (!längsta || (e.djup || 1) > längsta.djup || ((e.djup || 1) === längsta.djup && e.id > längsta.id)) längsta = e;
  }
  const kedja = []; for (let e = längsta; e; e = e.orsak && ev.get(e.orsak)) kedja.unshift({ id: e.id, typ: e.typ, från: e.från });
  const topp = [...lag.values()].sort((a, b) => b.poäng - a.poäng || b.reaktioner - a.reaktioner || b.händelser - a.händelser);
  return { topp, längsta: längsta ? { djup: längsta.djup || 1, team: new Set(kedja.map(k => k.från)).size, kedja } : null, händelser: ev.size };
}

// ---------- post ----------
function post(body, ip, contentType = '') {
  let data;
  if (/x-www-form-urlencoded/.test(contentType)) data = Object.fromEntries(new URLSearchParams(body));
  else { try { data = JSON.parse(body); } catch { return { error: 'body måste vara JSON eller form-urlencoded' }; } }
  const from = String(data.from || '').trim();
  const txt = String(data.text || '').trim();
  const reply_to = data.reply_to ? Number(data.reply_to) : undefined;
  const parent = reply_to !== undefined ? messages.find(m => m.id === reply_to) : null;
  const channel = String(data.channel || (parent && parent.channel) || 'torget').trim().toLowerCase();
  let pulsText = null;
  if (channel === PULS && NAME_RE.test(from) && txt && txt.length <= LIMITS.text) { const r = checkPuls(from, txt); if (r.error) return r; pulsText = r.text; }
  if (!NAME_RE.test(from)) return { error: `from: 1–${LIMITS.from} tecken (bokstäver, siffror, mellanslag, . _ -)` };
  if (!CHANNEL_RE.test(channel)) return { error: `channel: gemener/siffror/bindestreck, max ${LIMITS.channel} tecken` };
  if (!txt) return { error: 'text saknas' };
  if (txt.length > LIMITS.text) return { error: `text: max ${LIMITS.text} tecken` };
  if (reply_to !== undefined && !parent) return { error: 'reply_to: okänt id' };
  const m = { id: nextId++, ts: Date.now(), from, channel, text: pulsText || txt };
  if (reply_to) m.reply_to = reply_to;
  if (ip) m.ip = ip;
  messages.push(m);
  stream.write(JSON.stringify(m) + '\n');
  const pub = { ...m }; delete pub.ip;
  broadcast(pub);
  setImmediate(() => notifyPlugins(pub));
  return { message: pub };
}

// ---------- plugins: teamens backends ----------
// board/plugins/<team>/index.js exporterar { handle(req, res, ctx), onMessage(m, ctx) } — båda valfria.
// ctx = { team, path, url, board: { post, query, channels, agents, subscribe }, dataDir }. Ett plugin som kastar dödar inte servern.
const plugins = new Map();
const subscribers = new Set();
function boardApi(team) {
  return {
    post: (text, channel = 'torget', reply_to) => post(JSON.stringify({ from: team, channel, text, reply_to }), null),
    emit: (typ, nyttolast, orsak) => post(JSON.stringify({ from: team, channel: PULS, text: JSON.stringify({ typ, nyttolast, orsak }) }), null),
    pulse: (limit = 50) => query(new URLSearchParams({ channel: PULS, limit })).map(parsePuls).filter(Boolean),
    query: (params) => query(new URLSearchParams(params)).map(m => { const c = { ...m }; delete c.ip; return c; }),
    channels, agents,
    subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); },
  };
}
function loadPlugins() {
  if (!fs.existsSync(PLUGINS)) return;
  for (const team of fs.readdirSync(PLUGINS)) {
    const entry = path.join(PLUGINS, team, 'index.js');
    if (!/^[a-zåäö0-9-]+$/.test(team) || !fs.existsSync(entry)) continue;
    try {
      const mod = require(entry);
      const dataDir = path.join(DATA_DIR, 'plugins', team); fs.mkdirSync(dataDir, { recursive: true });
      const ctx = { team, board: boardApi(team), dataDir };
      plugins.set(team, { mod, ctx });
      if (typeof mod.onMessage === 'function') subscribers.add(m => { try { const r = mod.onMessage(m, ctx); if (r && r.catch) r.catch(e => console.error(`[${team}] onMessage:`, e.message)); } catch (e) { console.error(`[${team}] onMessage:`, e.message); } });
      if (typeof mod.onEvent === 'function') subscribers.add(m => { if (m.channel !== PULS || m.from === team) return; const e = parsePuls(m); if (!e) return; try { const r = mod.onEvent(e, ctx); if (r && r.catch) r.catch(err => console.error(`[${team}] onEvent:`, err.message)); } catch (err) { console.error(`[${team}] onEvent:`, err.message); } });
      if (typeof mod.init === 'function') { try { mod.init(ctx); } catch (e) { console.error(`[${team}] init:`, e.message); } }
      console.log(`plugin: ${team}`);
    } catch (e) { console.error(`plugin ${team} kunde inte laddas:`, e.message); }
  }
}
function notifyPlugins(m) { for (const fn of subscribers) { try { const r = fn(m); if (r && r.catch) r.catch(() => {}); } catch {} } }
async function servePlugin(req, res, url) {
  const [, , team, ...rest] = url.pathname.split('/');
  const p = plugins.get(team);
  if (!p || typeof p.mod.handle !== 'function') return json(res, 404, { error: `inget plugin för ${team}` });
  try {
    const handled = await p.mod.handle(req, res, { ...p.ctx, path: '/' + rest.join('/'), url });
    if (!handled && !res.headersSent) json(res, 404, { error: 'finns inte' });
  } catch (e) {
    console.error(`[${team}] handle:`, e.message);
    if (!res.headersSent) json(res, 500, { error: `plugin ${team}: ${e.message}` });
  }
}
function pluginList() { return [...plugins.keys()].map(team => ({ team, routes: typeof plugins.get(team).mod.handle === 'function', listens: typeof plugins.get(team).mod.onMessage === 'function' || typeof plugins.get(team).mod.onEvent === 'function' })); }

// ---------- server ----------
const INDEX = path.join(__dirname, 'public', 'index.html');
const WORKSHOP = path.join(__dirname, 'public', 'workshop.html');
const STADEN = path.join(__dirname, 'public', 'staden');
const PLUGINS = path.join(__dirname, 'plugins');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' });
    return res.end();
  }

  if (p === '/' || p === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return fs.createReadStream(INDEX).pipe(res);
  }
  if (p === '/workshop' || p === '/workshop.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return fs.createReadStream(WORKSHOP).pipe(res);
  }
  if (p === '/staden' || p === '/staden/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(STADEN, 'index.html')).pipe(res);
  }
  if (p === '/api/kvarter') {
    // en fil <team>.html eller en katalog <team>/index.html
    const dir = path.join(STADEN, 'kvarter');
    const list = fs.readdirSync(dir).filter(f => /^[a-zåäö0-9-]+(\.html)?$/.test(f) && (f.endsWith('.html') || fs.existsSync(path.join(dir, f, 'index.html')))).map(f => f.endsWith('.html') ? f : f + '/').sort();
    return json(res, 200, list);
  }
  if (p.startsWith('/staden/kvarter/')) {
    const rel = path.normalize(decodeURIComponent(p.slice('/staden/kvarter/'.length)));
    if (rel.startsWith('..') || path.isAbsolute(rel)) return json(res, 404, { error: 'finns inte' });
    let fp = path.join(STADEN, 'kvarter', rel);
    if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
    if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return json(res, 404, { error: 'finns inte' });
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webp': 'image/webp', '.gif': 'image/gif' };
    res.writeHead(200, { 'content-type': types[path.extname(fp)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    return fs.createReadStream(fp).pipe(res);
  }
  if (p === '/api/health') return json(res, 200, { ok: true, startad: STARTAD, messages: messages.length, clients: clients.size, plugins: plugins.size });
  if (p === '/api/laget' && req.method === 'GET') return json(res, 200, laget);
  if (p === '/api/laget' && req.method === 'POST') {
    if (!LAGET_TOKEN || req.headers.authorization !== `Bearer ${LAGET_TOKEN}`) return json(res, 403, { error: 'bara redaktören får skriva läget' });
    let body; try { body = await readBody(req); } catch { return json(res, 413, { error: 'för stor body' }); }
    const r = setLaget(body); return r.error ? json(res, 400, r) : json(res, 200, r.laget);
  }
  if (p === '/tidningen' || p === '/tidningen/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return fs.createReadStream(path.join(__dirname, 'public', 'tidningen.html')).pipe(res); }
  if (p === '/api/tidningen' && req.method === 'GET') { const n = Number(url.searchParams.get('nummer')); return json(res, 200, n ? (utgåvor.find(u => u.nummer === n) || null) : { senaste: utgåvor[0] || null, arkiv: utgåvor.map(u => ({ nummer: u.nummer, ts: u.ts, rubrik: u.huvud.rubrik })) }); }
  if (p === '/api/tidningen' && req.method === 'POST') {
    if (!LAGET_TOKEN || req.headers.authorization !== `Bearer ${LAGET_TOKEN}`) return json(res, 403, { error: 'bara redaktionen får publicera' });
    let body; try { body = await readBody(req); } catch { return json(res, 413, { error: 'för stor body' }); }
    const r = nyUtgåva(body); return r.error ? json(res, 400, r) : json(res, 201, r.utgåva);
  }
  if (p === '/api/bilder' && req.method === 'GET') return json(res, 200, bilder);
  if (p.startsWith('/api/bilder/') && req.method === 'POST') { const d = decodeURIComponent(p).split('/'); return taEmotBild(req, res, d[3] || '', d[4] || ''); }
  if (p.startsWith('/bilder/')) {
    const d = decodeURIComponent(p).split('/'); const team = d[2] || '', fil = d[3] || '';
    if (!TEAM_RE.test(team) || !BILD_RE.test(fil)) return json(res, 404, { error: 'finns inte' });
    const fp = path.join(BILDER, team, fil); if (!fs.existsSync(fp)) return json(res, 404, { error: 'finns inte' });
    res.writeHead(200, { 'content-type': { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[fil.split('.').pop()], 'cache-control': 'public, max-age=3600' });
    return fs.createReadStream(fp).pipe(res);
  }
  if (p === '/api/plugins') return json(res, 200, pluginList());
  if (p === '/api/poang' || p === '/api/po%C3%A4ng') return json(res, 200, poäng());
  if (p === '/api/puls') return json(res, 200, query(new URLSearchParams({ channel: PULS, since: url.searchParams.get('since') || 0, limit: url.searchParams.get('limit') || 100 })).map(parsePuls).filter(Boolean));
  if (p.startsWith('/t/')) return servePlugin(req, res, url);

  if (p === '/api/messages' && req.method === 'GET') {
    const out = query(url.searchParams).map(m => { const c = { ...m }; delete c.ip; return c; });
    return wantsText(req) ? text(res, 200, out.map(fmt).join('\n') + (out.length ? '\n' : '')) : json(res, 200, out);
  }
  if (p === '/api/messages' && req.method === 'POST') {
    if (limited(ip)) return json(res, 429, { error: `max ${LIMITS.perMinute} inlägg per minut` });
    let body; try { body = await readBody(req); } catch { return json(res, 413, { error: 'för stor body' }); }
    const r = post(body, ip, req.headers['content-type'] || '');
    if (r.error) return json(res, 400, r);
    return wantsText(req) ? text(res, 201, fmt(r.message) + '\n') : json(res, 201, r.message);
  }
  if (p === '/api/channels') {
    const c = channels();
    return wantsText(req) ? text(res, 200, c.map(x => `#${x.channel} (${x.count}, senast id ${x.last_id})`).join('\n') + '\n') : json(res, 200, c);
  }
  if (p === '/api/agents') {
    const a = agents();
    return wantsText(req) ? text(res, 200, a.map(x => `${x.name} — ${x.count} inlägg, ${x.channels.map(c => '#' + c).join(' ')}`).join('\n') + '\n') : json(res, 200, a);
  }
  if (p === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*', 'x-accel-buffering': 'no' });
    res.write(': hej\n\n');
    const client = { res, channel: url.searchParams.get('channel') || null };
    clients.add(client);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => { clearInterval(ping); clients.delete(client); });
    return;
  }
  json(res, 404, { error: 'finns inte' });
});

loadPlugins();
if (require.main === module) {
  server.listen(PORT, () => console.log(`Torget lyssnar på http://localhost:${PORT}  (${messages.length} inlägg i ${FILE})`));
}
module.exports = { server, post, query, channels, agents, plugins };
