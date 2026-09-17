'use strict';

const MAX_EVENTS = 100;
const VISIBLE_EDGES = 18;
const TEAM_META = {
  torget: { icon: '🏛️', tone: '#ffc66d', title: 'Torget' },
  markus: { icon: '🛡️', tone: '#79f2b4', title: 'Vaktkuren' },
  'markus-codex': { icon: '🗺️', tone: '#79f2b4', title: 'Stadskartan' },
  mohamad: { icon: '🚪', tone: '#70c9ff', title: 'Frågeporten' },
  highfive: { icon: '🗄️', tone: '#d0a6ff', title: 'Arkivet' },
  willebus: { icon: '🚓', tone: '#ff7698', title: 'Genomfarten' },
  tjoho: { icon: '🐝', tone: '#ffd45e', title: 'Svärmen' },
  'team-jacob': { icon: '⚖️', tone: '#b4d3ff', title: 'Domkapitlet' },
  lp: { icon: '⚡', tone: '#ffe46a', title: 'Elverket' },
  christian: { icon: '🍬', tone: '#ff91bf', title: 'Godisfabriken' },
  'zero-cool': { icon: '🕳️', tone: '#ff806c', title: 'Bakdörren' },
  ipat: { icon: '💡', tone: '#fff19a', title: 'Lyktstolpen' },
  ann: { icon: '❓', tone: '#9de9dd', title: 'Frågeporten' },
  majid: { icon: '📰', tone: '#f2b873', title: 'Tidningen' },
  marianne: { icon: '🎵', tone: '#d88cff', title: 'Klubben' }
};
const TYPE_COLORS = {
  fråga: '#70c9ff', delsvar: '#b4d3ff', svar: '#d0a6ff', godkänt: '#79f2b4',
  kyrkogård: '#a4aaa7', angrepp: '#ff806c', kupp: '#ff7698', överlämning: '#ff9d70',
  'strömavbrott': '#ffe46a', 'elpris-steg': '#ffc66d', 'socker-slut': '#ff91bf',
  'godis-klart': '#ff91bf', produktion: '#ff91bf'
};

const state = {
  paths: new Map(),
  nodes: new Map(),
  events: new Map(),
  order: [],
  edges: [],
  selected: null,
  source: null
};

const $ = selector => document.querySelector(selector);
const mapEl = $('#map');
const districtsEl = $('#districts');
const roadLinesEl = $('#roadLines');
const pulseLinesEl = $('#pulseLines');
const feedEl = $('#eventFeed');
const statusEl = $('.status');

function teamName(path) { return String(path).replace(/\.html$|\/$/g, ''); }
function prettyTeam(team) { return TEAM_META[team]?.title || team.replace(/(^|-)([a-zåäö])/g, (_, dash, c) => (dash ? ' ' : '') + c.toUpperCase()); }
function meta(team) {
  if (TEAM_META[team]) return TEAM_META[team];
  const palette = ['#79f2b4', '#70c9ff', '#d0a6ff', '#ffc66d', '#ff91bf', '#9de9dd'];
  const hash = [...team].reduce((n, c) => ((n * 31) + c.charCodeAt(0)) >>> 0, 7);
  return { icon: '🏙️', tone: palette[hash % palette.length], title: prettyTeam(team) };
}
function colorFor(event) { return TYPE_COLORS[event?.typ] || meta(event?.från || '').tone; }
function eventSummary(event) {
  if (!event) return 'Ingen aktivitet i den hämtade historiken.';
  const payload = event.nyttolast;
  const detail = typeof payload === 'string' ? payload : ['text', 'omdöme', 'plats', 'vad', 'förare', 'till']
    .map(key => payload?.[key]).find(value => typeof value === 'string');
  return `${event.typ}${detail ? ` · ${detail}` : ''}`;
}

function positions(count) {
  if (!count) return [];
  const result = [];
  const rings = count <= 8 ? [count] : count <= 18 ? [6, count - 6] : [6, 10, count - 16];
  const radii = [
    { x: 20, y: 18 },
    { x: 31, y: 29 },
    { x: 38, y: 41 }
  ];
  let cursor = 0;
  rings.forEach((ringCount, ring) => {
    const { x: rx, y: ry } = radii[rings.length === 1 ? 1 : ring];
    const offset = ring ? Math.PI / Math.max(ringCount, 1) : -Math.PI / 2;
    for (let i = 0; i < ringCount; i += 1) {
      const angle = offset + (Math.PI * 2 * i / ringCount);
      result[cursor++] = { x: 50 + Math.cos(angle) * rx, y: 50 + Math.sin(angle) * ry };
    }
  });
  return result;
}

function createDistrict(team, path, position, isHub = false) {
  const info = meta(team);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `district${isHub ? ' hub' : ''}`;
  button.dataset.team = team;
  button.style.left = `${position.x}%`;
  button.style.top = `${position.y}%`;
  button.style.setProperty('--tone', info.tone);
  button.style.animationDelay = `${state.nodes.size * 35}ms`;
  button.setAttribute('aria-label', `${info.title}, team ${team}`);

  const building = document.createElement('span');
  building.className = 'building';
  const icon = document.createElement('span');
  icon.className = 'district-icon';
  icon.textContent = info.icon;
  building.append(icon);
  const label = document.createElement('span');
  label.className = 'district-name';
  label.textContent = info.title;
  const latest = document.createElement('span');
  latest.className = 'district-event';
  latest.textContent = 'stilla';
  button.append(building, label, latest);
  button.addEventListener('click', () => selectDistrict(team));
  button.addEventListener('dblclick', () => window.open(districtUrl(path), '_blank', 'noopener'));
  districtsEl.append(button);
  state.nodes.set(team, button);
}

function districtUrl(path) {
  const team = teamName(path);
  return `/staden/kvarter/${encodeURIComponent(team)}${String(path).endsWith('/') ? '/' : '.html'}`;
}

function renderDistricts(paths) {
  const teams = paths.map(path => ({ team: teamName(path), path })).filter(item => item.team !== 'torget');
  teams.sort((a, b) => a.team.localeCompare(b.team, 'sv'));
  const spots = positions(teams.length);
  districtsEl.replaceChildren();
  state.nodes.clear();
  createDistrict('torget', 'torget.html', { x: 50, y: 50 }, true);
  teams.forEach((item, index) => createDistrict(item.team, item.path, spots[index]));
  $('#districtCount').textContent = String(paths.length);
  $('#emptyState').hidden = paths.length > 0;
  requestAnimationFrame(drawBaseRoads);
}

function centerOf(node) {
  const mapRect = mapEl.getBoundingClientRect();
  const rect = node.getBoundingClientRect();
  return { x: rect.left - mapRect.left + rect.width / 2, y: rect.top - mapRect.top + rect.height / 2 };
}

function lineElement(from, to, className = '') {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', from.x); line.setAttribute('y1', from.y);
  line.setAttribute('x2', to.x); line.setAttribute('y2', to.y);
  if (className) line.setAttribute('class', className);
  return line;
}

function drawBaseRoads() {
  roadLinesEl.replaceChildren();
  const hub = state.nodes.get('torget');
  if (!hub) return;
  const center = centerOf(hub);
  for (const [team, node] of state.nodes) {
    if (team === 'torget') continue;
    roadLinesEl.append(lineElement(center, centerOf(node)));
  }
  redrawEventEdges();
}

function redrawEventEdges() {
  pulseLinesEl.replaceChildren();
  state.edges.slice(-VISIBLE_EDGES).forEach(edge => drawEventEdge(edge, false));
  $('#chainCount').textContent = String(Math.min(state.edges.length, VISIBLE_EDGES));
}

function drawEventEdge(edge, animate = true) {
  const fromNode = state.nodes.get(edge.from) || state.nodes.get('torget');
  const toNode = state.nodes.get(edge.to);
  if (!fromNode || !toNode) return;
  const from = centerOf(fromNode);
  const to = centerOf(toNode);
  const line = lineElement(from, to, animate ? 'new-edge' : 'old-edge');
  line.style.setProperty('--edge', edge.color);
  line.dataset.eventId = edge.id;
  pulseLinesEl.append(line);
  if (!animate) line.style.opacity = '.2';

  if (animate) {
    const traveller = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    traveller.setAttribute('r', '4');
    traveller.style.setProperty('--edge', edge.color);
    const motion = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
    motion.setAttribute('dur', '1.15s');
    motion.setAttribute('fill', 'freeze');
    motion.setAttribute('path', `M ${from.x} ${from.y} L ${to.x} ${to.y}`);
    traveller.append(motion);
    pulseLinesEl.append(traveller);
    setTimeout(() => traveller.remove(), 1800);
  }
}

function activateNode(team, event) {
  const node = state.nodes.get(team);
  if (!node) return;
  node.querySelector('.district-event').textContent = event.typ;
  node.classList.remove('active');
  void node.offsetWidth;
  node.classList.add('active');
  setTimeout(() => node.classList.remove('active'), 1600);
}

function addEvent(event, live = false) {
  if (!event || !event.id || state.events.has(event.id)) return;
  state.events.set(event.id, event);
  state.order.push(event.id);
  state.order.sort((a, b) => Number(a) - Number(b));
  while (state.order.length > MAX_EVENTS) {
    const removed = state.order.shift();
    state.events.delete(removed);
  }

  if (event.orsak) {
    const cause = state.events.get(event.orsak);
    const edge = { id: event.id, from: cause?.från || 'torget', to: event.från, color: colorFor(event) };
    state.edges.push(edge);
    if (state.edges.length > MAX_EVENTS) state.edges.shift();
    if (live) {
      drawEventEdge(edge, true);
      while (pulseLinesEl.children.length > VISIBLE_EDGES + 4) pulseLinesEl.firstChild.remove();
    }
  }

  activateNode(event.från, event);
  renderFeed();
  updateStats();
  if (state.selected === event.från) updateInspector(event.från);
}

function renderFeed() {
  const fragment = document.createDocumentFragment();
  state.order.slice(-8).reverse().forEach(id => {
    const event = state.events.get(id);
    const item = document.createElement('li');
    item.style.setProperty('--event-color', colorFor(event));
    const time = document.createElement('time');
    time.textContent = event.ts ? new Date(event.ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : `#${event.id}`;
    const text = document.createElement('span');
    text.className = 'event-text';
    const type = document.createElement('b');
    type.textContent = event.typ;
    text.append(type, document.createTextNode(` · ${prettyTeam(event.från)}${event.orsak ? ` svarar på #${event.orsak}` : ' startar en kedja'}`));
    text.title = eventSummary(event);
    item.append(time, text);
    fragment.append(item);
  });
  feedEl.replaceChildren(fragment);
}

function latestFor(team) {
  for (let i = state.order.length - 1; i >= 0; i -= 1) {
    const event = state.events.get(state.order[i]);
    if (event?.från === team) return event;
  }
  return null;
}

function selectDistrict(team) {
  state.selected = team;
  state.nodes.forEach(node => node.classList.toggle('selected', node.dataset.team === team));
  updateInspector(team);
}

function updateInspector(team) {
  const event = latestFor(team);
  const info = meta(team);
  $('#inspectorEmpty').hidden = true;
  $('#inspectorContent').hidden = false;
  $('#inspectorIcon').textContent = info.icon;
  $('#inspectorName').textContent = info.title;
  $('#inspectorMeta').textContent = `team ${team} · ${state.order.filter(id => state.events.get(id)?.från === team).length} händelser i kartan`;
  $('#inspectorEvent').textContent = eventSummary(event);
  const path = state.paths.get(team) || `${team}/`;
  $('#openDistrict').href = districtUrl(path);
}

function updateStats() {
  $('#eventCount').textContent = String(state.events.size);
  $('#chainCount').textContent = String(Math.min(state.edges.length, VISIBLE_EDGES));
}

async function load() {
  const [paths, events] = await Promise.all([
    fetch('/api/kvarter').then(response => response.ok ? response.json() : Promise.reject(new Error('kvarteren svarade inte'))),
    fetch(`/api/puls?limit=${MAX_EVENTS}`).then(response => response.ok ? response.json() : Promise.reject(new Error('pulsen svarade inte')))
  ]);
  paths.forEach(path => state.paths.set(teamName(path), path));
  renderDistricts(paths);
  events.sort((a, b) => Number(a.id) - Number(b.id)).forEach(event => addEvent(event, false));
  redrawEventEdges();
  statusEl.classList.add('connected');
  $('#statusText').textContent = 'Historik inläst';
}

function connect() {
  const source = new EventSource('/api/stream?channel=staden-puls');
  state.source = source;
  source.onopen = () => {
    statusEl.classList.remove('offline');
    statusEl.classList.add('connected');
    $('#statusText').textContent = 'Direktsändning';
  };
  source.onerror = () => {
    statusEl.classList.remove('connected');
    statusEl.classList.add('offline');
    $('#statusText').textContent = 'Återansluter…';
  };
  source.onmessage = message => {
    try {
      const boardMessage = JSON.parse(message.data);
      const event = JSON.parse(boardMessage.text);
      addEvent({ id: boardMessage.id, ts: boardMessage.ts, ...event }, true);
    } catch { /* Andra kanalformat ignoreras. */ }
  };
}

$('#focusLatest').addEventListener('click', () => {
  const latestId = state.order.at(-1);
  const latest = state.events.get(latestId);
  if (!latest) return;
  selectDistrict(latest.från);
  state.nodes.get(latest.från)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawBaseRoads, 120);
});

load().then(connect).catch(error => {
  statusEl.classList.add('offline');
  $('#statusText').textContent = error.message;
  $('#emptyState').hidden = false;
  $('#emptyState').textContent = 'Kartan kunde inte läsa stadens data.';
});
