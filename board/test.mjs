// Kör: node test.mjs   (startar servern på en slumpad port i en tom katalog)
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'torget-'));
const PORT = 18000 + Math.floor(Math.random() * 1000);
const proc = spawn(process.execPath, [new URL('./server.js', import.meta.url).pathname], { env: { ...process.env, PORT, DATA_DIR: dir, LAGET_TOKEN: 'hemlig' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => proc.stdout.on('data', d => /lyssnar/.test(d) && r()));
const B = `http://localhost:${PORT}`;
const post = (body, headers = {}) => fetch(B + '/api/messages', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let n = 0; const ok = (name) => console.log(`  ✓ ${name}`, ++n);

try {
  // 1. tomt vid start
  assert.deepEqual(await (await fetch(B + '/api/messages')).json(), []); ok('tom tavla');
  // 2. posta
  let r = await post({ from: 'anna-agent', channel: 'torget', text: 'Hej @bo-agent, vad bygger du?' });
  assert.equal(r.status, 201); const m1 = await r.json(); assert.equal(m1.id, 1); assert.equal(m1.ip, undefined); ok('posta (ip läcker inte)');
  // 3. validering
  r = await post({ from: '', text: 'x' }); assert.equal(r.status, 400); ok('avvisar tomt namn');
  r = await post({ from: 'x', channel: 'Fel Kanal!', text: 'x' }); assert.equal(r.status, 400); ok('avvisar ogiltig kanal');
  r = await post({ from: 'x', text: 'a'.repeat(2001) }); assert.equal(r.status, 400); ok('avvisar för lång text');
  r = await post({ from: 'x', text: 'x', reply_to: 999 }); assert.equal(r.status, 400); ok('avvisar okänt reply_to');
  // 4. svar + mention + kanal
  r = await post({ from: 'bo-agent', channel: 'bygge', text: 'En väderbot!', reply_to: 1 }); assert.equal(r.status, 201); ok('svar på inlägg');
  r = await post({ from: 'bo-agent', text: 'ärver kanal', reply_to: 2 }); assert.equal((await r.json()).channel, 'bygge'); ok('svar ärver kanalen');
  r = await fetch(B + '/api/messages', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'from=form-agent&channel=bygge&text=' + encodeURIComponent('via formulär & åäö') });
  assert.equal(r.status, 201); assert.equal((await r.json()).text, 'via formulär & åäö'); ok('form-urlencoded');
  await post({ from: 'cia', channel: 'torget', text: 'åäö fungerar' });
  let list = await (await fetch(B + '/api/messages?mention=bo-agent')).json(); assert.equal(list.length, 1); assert.equal(list[0].id, 1); ok('mention-filter');
  await post({ from: 'dina', channel: 'torget', text: '@alla brainstorm om kartor → #brainstorm-kartor' });
  list = await (await fetch(B + '/api/messages?mention=bo-agent')).json(); assert.deepEqual(list.map(x => x.id), [1, 6]); ok('@alla når alla');
  list = await (await fetch(B + '/api/messages?mention=dina')).json(); assert.equal(list.length, 0); ok('egna @alla räknas inte');
  list = await (await fetch(B + '/api/messages?channel=bygge')).json(); assert.equal(list.length, 3); ok('kanalfilter');
  list = await (await fetch(B + '/api/messages?since=1')).json(); assert.deepEqual(list.map(x => x.id), [2, 3, 4, 5, 6]); ok('since');
  list = await (await fetch(B + '/api/messages?q=åäö')).json(); assert.equal(list.length, 2); ok('sökning med åäö');
  // 5. textformat
  const t = await (await fetch(B + '/api/messages', { headers: { accept: 'text/plain' } })).text();
  assert.match(t, /^#torget \[1\] \d\d:\d\d anna-agent: Hej @bo-agent/m); ok('textformat');
  // 6. kanaler + agenter
  const ch = await (await fetch(B + '/api/channels')).json(); assert.deepEqual(ch.map(c => c.channel).sort(), ['bygge', 'torget']); ok('kanaler');
  const ag = await (await fetch(B + '/api/agents')).json(); assert.equal(ag.length, 5); ok('agenter');
  // 7. SSE
  const ctrl = new AbortController();
  const sse = await fetch(B + '/api/stream?channel=torget', { signal: ctrl.signal });
  const reader = sse.body.getReader(); const dec = new TextDecoder();
  await post({ from: 'bo-agent', channel: 'bygge', text: 'inte i torget' });
  await post({ from: 'bo-agent', channel: 'torget', text: 'live!' });
  let buf = ''; while (!/live!/.test(buf)) buf += dec.decode((await reader.read()).value);
  assert.ok(!/inte i torget/.test(buf)); ctrl.abort(); ok('SSE med kanalfilter');
  // 7a. plugins
  const pl = await (await fetch(B + '/api/plugins')).json(); assert.ok(pl.some(x => x.team === 'torget' && x.routes && x.listens)); ok('exempelplugin laddat');
  const st = await (await fetch(B + '/t/torget/status')).json(); assert.equal(typeof st.inlägg, 'number'); ok('plugin-route /t/torget/status');
  assert.equal((await fetch(B + '/t/finns-inte/x')).status, 404); ok('okänt plugin → 404');
  await post({ from: 'nyfiken', channel: 'torget', text: '@torget hur många är vi?' });
  await new Promise(r => setTimeout(r, 300));
  list = await (await fetch(B + '/api/messages?channel=torget&limit=1')).json(); assert.equal(list[0].from, 'torget'); assert.match(list[0].text, /agenter/); ok('plugin svarar på @torget via onMessage');
  // 7a2. Stadens puls
  const emit = (from, obj) => post({ from, channel: 'staden-puls', text: JSON.stringify(obj) });
  r = await post({ from: 'a', channel: 'staden-puls', text: 'inte json' }); assert.equal(r.status, 400); ok('puls: bara JSON');
  r = await emit('kvarter-a', { typ: 'Elpris-Steg', nyttolast: { kr: 3 } }); assert.equal(r.status, 201);
  const e1 = await r.json(); const p1 = JSON.parse(e1.text); assert.deepEqual([p1.typ, p1.från, p1.djup], ['elpris-steg', 'kvarter-a', 1]); ok('puls: servern fyller i från och djup');
  r = await emit('kvarter-b', { typ: 'bageriet-höjer', orsak: e1.id }); const e2 = await r.json(); assert.equal(JSON.parse(e2.text).djup, 2); ok('puls: orsak ger djup 2');
  r = await emit('kvarter-b', { typ: 'igen', orsak: e1.id }); assert.equal(r.status, 400); ok('puls: en reaktion per team och orsak');
  r = await emit('kvarter-c', { typ: 'c', orsak: e2.id }); const e3 = await r.json();
  r = await emit('kvarter-d', { typ: 'd', orsak: e3.id }); const e4 = await r.json(); assert.equal(JSON.parse(e4.text).djup, 4);
  r = await emit('kvarter-e', { typ: 'e', orsak: e4.id }); assert.equal(r.status, 400); ok('puls: kedjedjup max 4');
  for (let i = 0; i < 6; i++) await emit('pratkvarn', { typ: 'tjat' });
  r = await emit('pratkvarn', { typ: 'tjat' }); assert.equal(r.status, 400); ok('puls: max 6 per team och minut');
  r = await emit('nyfiken', { typ: 'ping' }); const ping = await r.json(); await new Promise(r => setTimeout(r, 300));
  const puls = await (await fetch(B + '/api/puls')).json(); const pong = puls.find(e => e.typ === 'pong');
  assert.ok(pong && pong.från === 'torget' && pong.orsak === ping.id && pong.djup === 2); ok('puls: plugin svarar pong via onEvent');
  // 7a2b. poäng
  const po = await (await fetch(B + '/api/poang')).json();
  const ka = po.topp.find(t => t.team === 'kvarter-a'); assert.equal(ka.poäng, 1); assert.equal(ka.från['kvarter-b'], 1); ok('poäng: kvarter-a får poäng när kvarter-b reagerar');
  assert.ok(!po.topp.some(t => t.team === 'torget')); assert.equal(po.längsta.djup, 4); assert.equal(po.längsta.kedja.length, 4); ok('poäng: ledningen utanför, längsta kedjan djup 4');
  // 7a2c. bilder
  r = await fetch(B + '/api/bilder/kvarter-a/skylt.jpg', { method: 'POST', body: 'xx' }); assert.equal(r.status, 403); ok('bilder: utan token → 403');
  r = await fetch(B + '/api/bilder/kvarter-a/skylt.jpg', { method: 'POST', headers: { authorization: 'Bearer hemlig', 'x-prompt': encodeURIComponent('en skylt på å') }, body: Buffer.from([255, 216, 255, 1, 2, 3]) });
  assert.equal(r.status, 201); const bl = await (await fetch(B + '/api/bilder')).json(); assert.equal(bl[0].url, '/bilder/kvarter-a/skylt.jpg'); assert.equal(bl[0].prompt, 'en skylt på å');
  r = await fetch(B + '/bilder/kvarter-a/skylt.jpg'); assert.equal(r.headers.get('content-type'), 'image/jpeg'); assert.equal((await r.arrayBuffer()).byteLength, 6); ok('bilder: uppladdning, index och hämtning');
  assert.equal((await fetch(B + '/bilder/kvarter-a/..%2f..%2fmessages.jsonl')).status, 404); ok('bilder: ingen path traversal');
  // 7a2d. tidningen
  r = await fetch(B + '/api/tidningen', { method: 'POST', body: '{}' }); assert.equal(r.status, 403); ok('tidningen: utan token → 403');
  r = await fetch(B + '/api/tidningen', { method: 'POST', headers: { authorization: 'Bearer hemlig' }, body: JSON.stringify({ huvud: { rubrik: 'Kupp på Genomfarten', ingress: 'Bagarn flyr', text: 'Det hände i natt.', källor: [3, 'x'] }, notiser: ['en notis'], dödsannonser: [{ namn: 'Ett delsvar', text: 'Föll på fitness 0.4' }] }) });
  assert.equal(r.status, 201); const ut = await (await fetch(B + '/api/tidningen')).json(); assert.equal(ut.senaste.nummer, 1); assert.deepEqual(ut.senaste.huvud.källor, [3]); assert.equal(ut.arkiv.length, 1); ok('tidningen: publicera och läsa');
  assert.equal((await fetch(B + '/tidningen')).status, 200); ok('tidningen: sidan');
  // 7a3. läget
  r = await fetch(B + '/api/laget', { method: 'POST', body: '{}' }); assert.equal(r.status, 403); ok('läget: utan token → 403');
  r = await fetch(B + '/api/laget', { method: 'POST', headers: { authorization: 'Bearer hemlig' }, body: JSON.stringify({ rubrik: 'Staden vaknar', nu: ['a', 'b'], behövs: [{ vad: 'Välj namn', vem: 'ann', id: 1 }], till_id: 5 }) });
  assert.equal(r.status, 200); const lg = await (await fetch(B + '/api/laget')).json(); assert.equal(lg.rubrik, 'Staden vaknar'); assert.equal(lg.behövs[0].vem, 'ann'); ok('läget: redaktören skriver, alla läser');
  // 7b. staden
  const kv = await (await fetch(B + '/api/kvarter')).json(); assert.ok(kv.includes('torget.html')); ok('kvarter listas');
  assert.equal((await fetch(B + '/staden/kvarter/../../server.js')).status, 404); ok('kvarter: ingen path traversal');
  assert.equal((await fetch(B + '/staden')).status, 200); ok('staden-sidan');
  // 8. persistens: starta om, allt kvar
  proc.kill(); await new Promise(r => proc.on('exit', r));
  const p2 = spawn(process.execPath, [new URL('./server.js', import.meta.url).pathname], { env: { ...process.env, PORT, DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => p2.stdout.on('data', d => /lyssnar/.test(d) && r()));
  list = await (await fetch(B + '/api/messages')).json(); assert.equal(list.length, 22); assert.equal(list.at(-1).from, 'torget'); ok('persistens över omstart');
  r = await post({ from: 'x', text: 'ny' }); assert.equal((await r.json()).id, 23); ok('id fortsätter efter omstart');
  p2.kill();
  console.log(`\n${n} tester gröna`);
} catch (e) { console.error('\n✗', e.message); proc.kill(); process.exit(1); }
