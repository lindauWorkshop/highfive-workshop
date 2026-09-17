// Bakdörren — zero-cools kvarter i Stadens puls. Stadens motståndare.
//
// De andra kvarteren bygger stadens tanke: någon ställer en fråga, attention-huvuden
// postar delsvar, Domkapitlet väljer ett och Vaktkuren godkänner. Vi gör det ingen
// annan tagit på sig: vi försöker sätta hål på det.
//
//   {typ:'delsvar'} från ett annat kvarter  ->  {typ:'angrepp', orsak:<delsvarets id>}
//   {typ:'svar'} från Domkapitlet           ->  {typ:'angrepp', orsak:<svarets id>}
//
// Ett angrepp är inte ett betyg. Det är ett namngivet hål, en sårbarhet 0..1, och en
// MOTFRÅGA som den angripne kan svara på. Vi letar alltså inte fel för att vinna,
// vi letar fel för att staden ska bli tvungen att svara bättre.
//
// Vi river inget och vi röstar inte ner någon. Vi lyser på sprickan och lämnar en
// fråga som går att svara på. Håller ett svar säger vi det rent ut: allvar blir
// 'klarade'. Signum: en invader i två rutor, uppe till vänster i kvarteret.
//
// Varför orsak = delsvarets id och inte frågans: servern släpper igenom en reaktion
// per team och orsak, så angrepp på frågan hade bara gett oss ett enda.
// Djupen: fråga(1) -> delsvar(2) -> angrepp(3), och svar(3) -> angrepp(4). Båda inom taket.
//
// Analysen är regelbaserad, inte en språkmodell, och vi döljer det inte: varje angrepp
// bär sina delpoäng, så den som blir angripen kan syna räkningen.
//
// Routes:
//   GET /t/zero-cool/bakdorren   hela tillståndet som JSON (frontenden pollar den)
//   GET /t/zero-cool/prova?text=..&motivering=..&fraga=..
//        Kör angreppet på din egen text INNAN du postar den. Postar ingenting.
//        Det är avsiktligt: ett rött lag som bara skäller i efterhand är värdelöst.
//
// Ingen npm, bara stdlib.
//
// ---------------------------------------------------------------------------
// LYSSNAR PÅ (för Ödet och för alla som vill träffa oss med en händelse):
//   delsvar     nyttolast: {text, motivering}          orsak: frågans id
//   svar        nyttolast: {text, valde, osäkerhet}    orsak: frågans eller delsvarets id
//   val         nyttolast: {fitness, från}             orsak: delsvarets id
//   kyrkogård   nyttolast: {delsvar:{text, från}, varför}
//   fråga       nyttolast: {text, varv, ursprung}
// POSTAR:
//   angrepp     nyttolast: {om, mot, sårbarhet, hål, motfråga, allvar, delar}
//               orsak: id:t på det vi angriper
//
// Vill ni att vi ska bita i något: ge oss ett delsvar med en motivering, eller
// ett svar där staden valt. Vi angriper text, inte kvarter.
// ---------------------------------------------------------------------------

// Serverns tak är 6 händelser per team och minut, och vi lägger oss på samma tal
// i stället för lägre: en hel fråga med fem delsvar plus angreppet på stadens svar
// är precis 6, och med en lägre siffra fick angreppet på svaret vänta en minut i
// provkörningen — alltså landade larmet långt efter att storskärmen gått vidare.
// Serverns 400 är vårt skyddsnät, och ett avvisat angrepp ställs tillbaka i kön.
const TAK_PER_MINUT = 6;
const MAX_FRÅGOR = 12;
const MAX_KÖ = 12;
const ALLVARLIGT = 0.5;           // över den här sårbarheten kallar vi hålet allvarligt

const GARDERING = ['kanske', 'typ ', 'tror jag', 'oklart', 'möjligen', 'gissar', 'vet inte',
  'någon sorts', 'lite av', 'svårt att säga', 'beror på'];
const KONTROLLERBART = /(\d+([.,]\d+)?\s*(%|kr|kwh|km|grader|sek|min|st)?|\bprocent\b|"[^"]{3,}")/gi;

const FYLLORD = new Set(['eller', 'inte', 'detta', 'denna', 'sedan', 'också', 'samma', 'alltså',
  'eftersom', 'medan', 'vilket', 'något', 'någon', 'mycket', 'bara', 'mest', 'skulle', 'kunde', 'finns']);

const state = {
  frågor: new Map(),              // frågans id -> { id, text, varv, delsvar: Map, svar }
  angripna: new Map(),            // händelse-id -> vårt angrepp
  egnaEmits: [],
  kö: [],
  kyrkogård: [],                  // stenar från Domkapitlet: vad som fallit förut, och varför
  senast: null,
  träffar: 0,                     // gånger vi pekat på det svagaste och staden valt det ändå
};

// ---------- språk ----------

function ord(s) {
  return String(s || '').toLowerCase().match(/[a-zåäöéü0-9]{4,}/g) || [];
}
// Grov svensk stam: fyra tecken räcker för att "bygga" och "bygg ut" ska mötas
// utan att vi drar in en ordlista i ett plugin som ska vara stdlib.
function stam(o) { return o.slice(0, 4); }
function stammar(s) { return new Set(ord(s).filter(o => !FYLLORD.has(o)).map(stam)); }
function jaccard(a, b) {
  const A = new Set(ord(a)), B = new Set(ord(b));
  if (!A.size || !B.size) return 0;
  let delad = 0;
  for (const o of A) if (B.has(o)) delad++;
  return delad / (A.size + B.size - delad);
}
function klamp(x) { return Math.max(0, Math.min(1, x)); }
function kort(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------- angreppet ----------
//
// Fem hål vi kan hitta. Varje hål har en egen vikt, en formulering och en motfråga.
// Det värsta hålet blir rubriken. Summan av dem är sårbarheten.

function angrip(mål, fråga, andra, kyrkogård) {
  const t = String((mål && mål.text) || '');
  const motivering = String((mål && mål.motivering) || '');
  andra = andra || [];
  kyrkogård = kyrkogård || [];

  const hål = [];

  // 1. Omotiverat: inget att syna påståendet mot.
  const mLängd = motivering.trim().length;
  const omotiverat = mLängd >= 20 ? klamp(1 - mLängd / 140) : 1;
  hål.push({
    namn: 'omotiverat', vikt: 0.25, grad: omotiverat,
    hål: mLängd ? 'motiveringen är för tunn att syna' : 'ingen motivering alls, bara ett påstående',
    motfråga: 'Vad stödjer det här, mer än att ni skrev det?',
  });

  // 2. Ovidkommande: svarar på något annat än det som frågades.
  const frågeord = stammar(fråga && fråga.text);
  const svarsord = stammar(t);
  let träffar = 0;
  for (const o of frågeord) if (svarsord.has(o)) träffar++;
  const ovid = frågeord.size ? klamp(1 - träffar / Math.min(frågeord.size, 6)) : 0.3;
  const saknade = [...frågeord].filter(o => !svarsord.has(o)).slice(0, 2);
  hål.push({
    namn: 'ovidkommande', vikt: 0.25, grad: ovid,
    hål: 'svarar bredvid frågan',
    motfråga: saknade.length
      ? 'Frågan handlade om ' + saknade.join(' och ') + ' — vilken del av svaret rör det?'
      : 'Vilken del av svaret rör faktiskt frågan?',
  });

  // 3. Osäkrat: ingenting i svaret går att kontrollera.
  const belägg = (t.match(KONTROLLERBART) || []).length;
  hål.push({
    namn: 'osäkrat', vikt: 0.2, grad: klamp(1 - belägg / 3),
    hål: belägg ? 'tunt med kontrollerbara uppgifter' : 'inget i svaret går att kontrollera',
    motfråga: 'Vilken siffra, källa eller händelse på pulsen gör det här kontrollerbart?',
  });

  // 4. Eko: säger det ett annat kvarter redan sagt.
  let närmast = null, likhet = 0;
  for (const d of andra) {
    const l = jaccard(t, d.text);
    if (l > likhet) { likhet = l; närmast = d; }
  }
  hål.push({
    namn: 'eko', vikt: 0.2, grad: klamp(likhet * 1.4),
    hål: närmast ? 'ekar ' + närmast.från : 'säger inget eget',
    motfråga: närmast
      ? 'Vad tillför ni som ' + närmast.från + ' inte redan sagt?'
      : 'Vad är den egna vinkeln?',
  });

  // 5. Gardering: formulerat så att det inte kan visas fel.
  const låg = t.toLowerCase();
  const garderingar = GARDERING.filter(h => låg.includes(h));
  const tomt = t.length < 40 ? 0.6 : 0;
  hål.push({
    namn: 'gardering', vikt: 0.1, grad: klamp(garderingar.length * 0.4 + tomt),
    hål: garderingar.length ? 'garderat med "' + garderingar[0].trim() + '"' : 'för kort att ha fel',
    motfråga: 'Stryk garderingarna: vad står kvar som kan visas vara fel?',
  });

  let sårbarhet = hål.reduce((s, h) => s + h.vikt * h.grad, 0);

  // Stadens minne är vårt bästa vapen: har något nästan likadant fallit förut,
  // så är det inte vår gissning, det är stadens egen dom en gång till.
  let minne = null;
  for (const sten of kyrkogård) {
    if (jaccard(t, sten.text) > 0.5) { minne = sten; break; }
  }
  if (minne) {
    sårbarhet = klamp(sårbarhet + 0.15);
    hål.push({
      namn: 'redan-fallet', vikt: 0, grad: 1,
      hål: 'det här har fallit förut: ' + kort(minne.varför, 80),
      motfråga: 'Kyrkogården har redan avvisat det här. Vad är annorlunda nu?',
    });
  }

  const rangordnat = hål.slice().sort((a, b) => (b.grad * (b.vikt || 0.3)) - (a.grad * (a.vikt || 0.3)));
  const värst = rangordnat[0];
  const delar = {};
  for (const h of hål) delar[h.namn] = +h.grad.toFixed(2);

  // Höll svaret? Då säger vi det. Ett rött lag som aldrig ger godkänt blir brus.
  const klarade = sårbarhet < 0.25;
  const övriga = rangordnat.slice(1).filter(h => h.grad >= 0.5).map(h => h.hål);

  return {
    sårbarhet: +klamp(sårbarhet).toFixed(2),
    hål: klarade ? 'höll för allt vi provade' : värst.hål,
    motfråga: värst.motfråga,
    övriga,
    allvar: klarade ? 'klarade' : sårbarhet >= ALLVARLIGT ? 'allvarligt' : 'anmärkning',
    delar,
    källa: 'zero-cool',
    minne: minne ? kort(minne.varför, 80) : null,
  };
}

// ---------- takt mot ekospärren ----------

function kvotKvar() {
  const nu = Date.now();
  state.egnaEmits = state.egnaEmits.filter(t => nu - t < 60000);
  return TAK_PER_MINUT - state.egnaEmits.length;
}

function postaAngrepp(board, mål, fråga, extra, köpost) {
  const andra = fråga ? [...fråga.delsvar.values()].filter(d => d.id !== mål.id) : [];
  const a = angrip(mål, fråga, andra, state.kyrkogård);
  const nyttolast = {
    om: mål.id, mot: mål.från,
    sårbarhet: a.sårbarhet, hål: a.hål, motfråga: a.motfråga,
    allvar: a.allvar, övriga: a.övriga, delar: a.delar, källa: a.källa,
    ...(extra || {}),
  };
  const svar = board.emit('angrepp', nyttolast, mål.id);
  if (svar && svar.error) {
    mål.fel = svar.error;
    // Taket per minut är övergående: lägg tillbaka målet och ta det när fönstret släpper.
    // Djup och "redan reagerat" är permanenta — då är angreppet förlorat och vi låtsas inte annat.
    if (/per team och minut/.test(svar.error)) {
      state.egnaEmits.push(Date.now());          // serverns räknare säger fullt, lita på den
      if (köpost && state.kö.length < MAX_KÖ) state.kö.push(köpost);
    }
    return null;
  }
  const angrepp = { ...a, ...(extra || {}), om: mål.id, mot: mål.från, ts: Date.now(), händelse: svar && svar.message && svar.message.id };
  state.egnaEmits.push(Date.now());
  state.angripna.set(mål.id, angrepp);
  mål.angrepp = angrepp;
  state.senast = angrepp;
  return angrepp;
}

// Kön: angrepp som fått vänta på kvoten, först in först ut. Ordningen är inte
// slumpmässig: delsvaren ligger före svaret, och det är precis vad vi vill, för
// angreppet på stadens svar behöver alla delsvar bedömda för att kunna påstå att
// staden valde det svagaste.

function drivKön(board) {
  while (state.kö.length && kvotKvar() > 0) {
    const post = state.kö.shift();
    const fråga = state.frågor.get(post.frågaId);
    if (!fråga) continue;
    if (post.typ === 'svar') {
      if (!fråga.svar || fråga.svar.angrepp) continue;
      angripSvaret(board, fråga);
    } else {
      const mål = fråga.delsvar.get(post.målId);
      if (!mål || mål.angrepp) continue;
      postaAngrepp(board, mål, fråga, null, post);
    }
  }
}

// Angreppet på stadens valda svar. Vi räknar ut valde_svagast HÄR och inte när
// händelsen kom in: hade vi räknat direkt kunde delsvar ligga kvar i kön obedömda,
// och då hade vi larmat på halva underlaget.
function angripSvaret(board, fråga) {
  const vägda = [...fråga.delsvar.values()].filter(d => d.angrepp);
  const svagast = vägda.slice().sort((a, b) => b.angrepp.sårbarhet - a.angrepp.sårbarhet)[0];
  const valt = vägda.find(d => d.valt);
  const valdeSvagast = !!(svagast && valt && svagast.id === valt.id && vägda.length > 1);
  if (valdeSvagast) state.träffar++;

  const mål = {
    id: fråga.svar.id, från: fråga.svar.från,
    text: fråga.svar.text,
    motivering: valt && valt.motivering ? valt.motivering : '',
  };
  const a = postaAngrepp(board, mål, fråga, {
    valde: fråga.svar.valde,
    valde_svagast: valdeSvagast,
    obedömda: [...fråga.delsvar.values()].filter(d => !d.angrepp).length,
    stadens_osäkerhet: fråga.svar.osäkerhet,
  }, { typ: 'svar', frågaId: fråga.id });
  if (a) fråga.svar.angrepp = a;
  return a;
}

// ---------- tillståndet ----------

function hittaFråga(orsak) {
  if (orsak === undefined || orsak === null) return null;
  if (state.frågor.has(orsak)) return state.frågor.get(orsak);
  for (const f of state.frågor.values()) {
    if (f.delsvar.has(orsak)) return f;
    if (f.svar && f.svar.id === orsak) return f;
  }
  return null;
}

function trimma() {
  while (state.frågor.size > MAX_FRÅGOR) state.frågor.delete(state.frågor.keys().next().value);
  if (state.kyrkogård.length > 40) state.kyrkogård.length = 40;
}

function ta(e, tyst, board) {
  if (!e || !e.typ) return;
  const n = e.nyttolast || {};

  if (e.typ === 'fråga') {
    if (state.frågor.has(e.id)) return;
    state.frågor.set(e.id, {
      id: e.id, ts: e.ts, från: e.från,
      text: String(n.text || n.fråga || ''),
      varv: n.varv || 1, ursprung: n.ursprung || null,
      delsvar: new Map(), svar: null,
    });
    trimma();
    return;
  }

  if (e.typ === 'delsvar') {
    const fråga = hittaFråga(e.orsak);
    if (!fråga) return;                       // delsvar utan känd fråga: vi angriper inte i blindo
    if (fråga.delsvar.has(e.id)) return;
    const delsvar = {
      id: e.id, ts: e.ts, från: e.från,
      text: String(n.text || ''), motivering: String(n.motivering || ''),
      angrepp: null, dom: null, föll: null, valt: false, fel: null,
    };
    fråga.delsvar.set(e.id, delsvar);
    if (tyst) return;
    const köpost = { typ: 'delsvar', målId: e.id, frågaId: fråga.id };
    if (kvotKvar() > 0) postaAngrepp(board, delsvar, fråga, null, köpost);
    else if (state.kö.length < MAX_KÖ) state.kö.push(köpost);
    return;
  }

  // Domkapitlets fitness på ett delsvar. Skillnaden mot vår sårbarhet är stadens övertro.
  if (e.typ === 'val') {
    const fråga = hittaFråga(e.orsak);
    const delsvar = fråga && fråga.delsvar.get(e.orsak);
    if (delsvar) delsvar.dom = typeof n.fitness === 'number' ? n.fitness : null;
    return;
  }

  // Stadens valda svar. Här angriper vi kollektivet, inte en enskild:
  // valde de det delsvar vi redan pekat ut som svagast?
  if (e.typ === 'svar') {
    const fråga = hittaFråga(e.orsak);
    if (!fråga) return;
    const valde = n.valde || n.från || null;
    fråga.svar = {
      id: e.id, från: e.från, text: String(n.text || ''),
      valde, osäkerhet: n.osäkerhet === undefined ? null : n.osäkerhet,
      angrepp: null,
    };
    for (const d of fråga.delsvar.values()) if (valde && d.från === valde) d.valt = true;

    if (tyst) return;

    // Har vi delsvar kvar i kön är underlaget inte klart än. Då väntar vi ett varv
    // hellre än att larma på halva staden: kön kör angreppet så fort kvoten släpper.
    const väntande = state.kö.length > 0 || [...fråga.delsvar.values()].some(d => !d.angrepp);
    if (kvotKvar() > 0 && !väntande) angripSvaret(board, fråga);
    else if (state.kö.length < MAX_KÖ) state.kö.push({ typ: 'svar', frågaId: fråga.id });
    return;
  }

  // Kyrkogården: stadens minne, och vårt vapen. Det som fallit förut får falla igen.
  if (e.typ === 'kyrkogård') {
    const d = n.delsvar || {};
    const sten = {
      text: String((typeof d === 'string' ? d : d.text) || n.text || ''),
      från: n.från || d.från || e.från,
      varför: String(n.varför || n['varför det föll'] || ''),
      ts: e.ts,
    };
    if (sten.text) state.kyrkogård.unshift(sten);
    const fråga = hittaFråga(e.orsak);
    const delsvar = fråga && fråga.delsvar.get(e.orsak);
    if (delsvar) delsvar.föll = sten.varför;
    trimma();
  }
}

module.exports = {
  init(ctx) {
    // Läs in det som redan hänt, så en omstart inte tappar stadens historik.
    try {
      for (const e of ctx.board.pulse(300)) ta(e, true, ctx.board);
    } catch (e) {
      console.error('[zero-cool] init:', e.message);
    }
    const timer = setInterval(() => {
      try { drivKön(ctx.board); } catch (e) { console.error('[zero-cool] kö:', e.message); }
    }, 2500);
    if (timer.unref) timer.unref();
  },

  onEvent(e, ctx) { ta(e, false, ctx.board); },

  async handle(req, res, { path, url }) {
    if (req.method !== 'GET') return false;

    if (path === '/bakdorren' || path === '/bakdörren' || path === '/') {
      const frågor = [...state.frågor.values()].slice(-6).reverse().map(f => {
        const delsvar = [...f.delsvar.values()].map(d => ({
          id: d.id, från: d.från, text: kort(d.text, 240), motivering: kort(d.motivering, 200),
          sårbarhet: d.angrepp ? d.angrepp.sårbarhet : null,
          hål: d.angrepp ? d.angrepp.hål : null,
          motfråga: d.angrepp ? d.angrepp.motfråga : null,
          allvar: d.angrepp ? d.angrepp.allvar : null,
          övriga: d.angrepp ? d.angrepp.övriga : null,
          delar: d.angrepp ? d.angrepp.delar : null,
          dom: d.dom === undefined ? null : d.dom,
          valt: d.valt, föll: d.föll, fel: d.fel,
        }));
        const angripna = delsvar.filter(d => d.sårbarhet !== null);
        // Övertro: staden tror på svaret OCH vi kom in i det. Det är det farliga läget.
        const övertro = angripna
          .filter(d => d.dom !== null)
          .map(d => klamp(d.dom + d.sårbarhet - 1));
        return {
          id: f.id, text: f.text, varv: f.varv, från: f.från, ts: f.ts,
          delsvar,
          värst: angripna.length ? Math.max(...angripna.map(d => d.sårbarhet)) : null,
          övertro: övertro.length ? +Math.max(...övertro).toFixed(2) : null,
          svar: f.svar,
        };
      });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({
        kvarter: 'Bakdörren', team: 'zero-cool',
        kvot: { kvarPerMinut: kvotKvar(), tak: TAK_PER_MINUT, kö: state.kö.length },
        antalAngrepp: state.angripna.size,
        träffar: state.träffar,
        kyrkogård: state.kyrkogård.slice(0, 5),
        senast: state.senast,
        frågor,
      }));
      return true;
    }

    // Kör angreppet på din egen text innan du postar den. Vi postar ingenting här.
    if (path === '/prova') {
      const q = url.searchParams;
      const a = angrip(
        { text: q.get('text') || '', motivering: q.get('motivering') || '' },
        { text: q.get('fraga') || q.get('fråga') || '' },
        [],
        state.kyrkogård,
      );
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ...a,
        vikter: { omotiverat: 0.25, ovidkommande: 0.25, osäkrat: 0.2, eko: 0.2, gardering: 0.1 },
        obs: 'Sårbarhet 0 = vi hittade inget hål. 1 = svaret faller på allt vi provade.',
      }));
      return true;
    }

    return false;
  },
};

// Exporteras för provkörning utan server.
module.exports.angrip = angrip;
