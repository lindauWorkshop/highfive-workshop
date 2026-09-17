// Team lp — kvarteret "Elverket". Stadens last, elpris och strömavbrott.
//
// ---------- Till Ödet (spelledaragenten): vad Elverket lyssnar på ----------
// onEvent tar emot ALLA typer och prissätter dem via kostnadFör() i last.js —
// okända typer får ett standardvärde (STANDARDKOSTNAD), så ni behöver inte stå
// i listan nedan för att räknas. Det som gör skillnad för känslan:
//
//   typ            nyttolast vi bryr oss om   effekt på lasten
//   -------------- --------------------------  ------------------------------------
//   kupp           (ingen)                     Dyrast — sirener (Genomfarten)
//   överlämning    (ingen)                     Dyr — en biljakt genom nätet (Genomfarten)
//   beat           (ingen)                     Klub Lyktans motor, kommer i skov
//   shots-runda    (ingen)                     Klub Lyktans motor — TÄTA skov av beat/
//                                               shots-runda SKA kunna spränga taket och
//                                               utlösa strömavbrott, det är utlovat
//   fråga          (ingen)                     Billig styck — publikens ingång
//   delsvar        (ingen)                     Billigast, men många per fråga
//   svar           (ingen)                     En per fråga (Domkapitlet)
//   godkänt        (ingen)                     En per svar (Vaktkuren)
//   betyg          (ingen)                     Vågskålens bedömning
//   ping / pong    (ingen)                     Provtrafik, kostar något litet
//   <allt annat>   (ingen)                     STANDARDKOSTNAD — nya kvarter ska dra
//                                               ström utan att vi rör koden
//
// Vi läser bara e.typ (kostnad), e.från (statistik per kvarter) och e.id (orsak
// på det vi postar tillbaka) — inga nyttolast-fält är obligatoriska. Vill Ödet
// göra oss extra sårbara: skicka MÅNGA beat/shots-runda tätt efter varandra.
//
// ---------- Modellen ----------
// Idén (UPPDRAG.md): varje händelse på #staden-puls drar ström. Elverket håller
// en fysisk last (laddas upp av händelser, urladdas exponentiellt mot noll),
// sätter priset som en funktion av lasten, och postar tillbaka elpris-steg med
// orsak satt till händelsen som drev upp det. Går lasten över taket blir det
// strömavbrott — sällsynt, tydligt, med ett eftersläp (kort återhämtningsperiod
// med förhöjd priskänslighet efteråt). strömavbrott är vår VIKTIGASTE händelse
// (godisfabriken lyssnar på den) — den kommer bara när lasten faktiskt spricker,
// aldrig på beställning, det finns ingen demo-knapp för den här.
//
// Kärnfysiken (laddaUpp/urladda/beräknaPris/kostnadFör) ligger i last.js och är
// EXAKT samma funktioner som projects/lp/simulera.js kör offline. Konstanterna
// nedan (TAK, TAU_*, ...) är uttestade där innan de rördes här — se
// projects/lp/simulera.js för kurvorna.
//
//   POSTAR (board.emit):  elpris-steg    {kr}              vid varje heltalströskel
//                         strömavbrott   {varaktighetS}    när lasten spränger taket
//                         Båda postas ALLTID med orsak = händelsen som faktiskt drev
//                         upp lasten senast (aldrig tomt, aldrig gissat — @Majids
//                         kedjeläsare och @highfive/@Christians godiskedja litar på det).
//   LYSSNAR (onEvent):    * (alla typer) — se tabellen ovan
//
//   GET /t/lp/tillstand → { last, tak, pris, avbrott, prishistorik, toppförbrukare, ... }
//
// Servern håller ekospärren (kedjedjup max 4, en reaktion per orsak, max 6/min).
// Vi håller vår egen kvot lägre (4/min) och läser alltid retur från board.emit.

const fs = require('fs');
const path = require('path');
const {
  laddaUpp,
  urladda,
  beräknaPris,
  kostnadFör,
  MAX_PRIS,
  TAK,
  TAU_NORMAL,
  TAU_AVBROTT,
  AVBROTT_VARAKTIGHET_S,
  ÅTERHÄMTNING_S,
  ÅTERHÄMTNING_FAKTOR,
} = require('./last.js');

// Fysikkonstanterna (TAK, TAU_*, ÅTERHÄMTNING_*) bor i last.js — samma värden
// som projects/lp/simulera.js kör offline, en enda källa. Det som är kvar här
// är plugin-specifikt: hur ofta VI får posta, inget simulatorn bryr sig om.
//
// TVÅ kvoter, samma sliding window (this.emitTider) — servern räknar per team,
// inte per typ, så båda delar samma pott av serverns 6/min:
//   EMIT_KVOT_PER_MIN         elpris-steg, vår vardagliga kvot, klart under 6
//   EMIT_KVOT_PER_MIN_AVBROTT strömavbrott, ett reserverat extra utrymme —
//     annars kan vår EGEN kvot (inte ens ekospärren) tysta vår viktigaste
//     händelse bara för att vi redan spenderat den på prissteg. strömavbrott
//     "ska vara sällsynt, tydlig och gå att lita på" (UPPDRAG.md) — den får
//     nästan alltid igenom så länge servern själv har plats.
const EMIT_KVOT_PER_MIN = 4;
const EMIT_KVOT_PER_MIN_AVBROTT = 5;
const PRISHISTORIK_MAX = 40; // hur många prispunkter vi sparar

module.exports = {
  init(ctx) {
    this.board = ctx.board;
    this.filväg = ctx.dataDir ? path.join(ctx.dataDir, 'tillstand.json') : null;
    this.state = this._läsPersistent();

    // Momentan last sparas inte — nätet startar kallt efter en omstart (UPPDRAG.md).
    this.last = 0;
    this.avbrott = false;
    this.avbrottSlutarTs = 0;
    this.återhämtningSlutarTs = 0;
    this.startTs = Date.now(); // för sedanOmstartS i /tillstand

    // this.livePris är den ENDA sanningen för vad priset är just nu — beräknad
    // från this.last, ALDRIG läst rått ur persistensen. Efter en omstart är
    // last=0 så livePris är 0, punkt slut (nätet startar kallt). this.state.pris
    // är bara den senast kända notisen i persistensen, kvar för historik/statistik
    // — den visas aldrig som om den vore aktuell (se _tillstånd).
    this.livePris = beräknaPris(this.last, TAK);
    // senastPostatPris styr NÄR vi försöker posta elpris-steg på pulsen. Den
    // startar likadan som livePris (inte det persisterade this.state.pris) —
    // annars uppstår en falsk diff direkt vid start som postas som en
    // orsakslös spökhändelse innan en enda riktig händelse kommit in.
    this.senastPostatPris = this.livePris;
    this.emitTider = []; // sliding window för vår egen rate-limit
    this.senasteTickTs = Date.now();
    this.senasteHändelseId = undefined; // orsak på det vi postar — sätts av första onEvent, ALDRIG gissat

    // setInterval på sekundnivå, aldrig while(true). Mät verklig dt — lita inte
    // på att intervallet triggar exakt var 1000:e ms när event-loopen är upptagen.
    this._intervall = setInterval(() => this._tick(), 1000);
    if (this._intervall.unref) this._intervall.unref(); // håll inte processen vid liv enbart för detta
  },

  async handle(req, res, { path: p }) {
    if (req.method === 'GET' && (p === '/tillstand' || p === '/')) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(this._tillstånd()));
      return true;
    }
    return false; // → 404
  },

  // Varje händelse från ett ANNAT kvarter på #staden-puls. Alla typer kostar
  // något — okända typer får STANDARDKOSTNAD via kostnadFör(), så nya kvarter
  // drar ström utan att vi rör koden.
  onEvent(e) {
    try {
      this.senasteHändelseId = e.id;
      const iÅterhämtning = !this.avbrott && Date.now() < this.återhämtningSlutarTs;
      const kostnad = kostnadFör(e.typ) * (iÅterhämtning ? ÅTERHÄMTNING_FAKTOR : 1);
      this.last = laddaUpp(this.last, kostnad);

      const kvarter = e.från || 'okänt';
      this.state.totalFörbrukningPerKvarter[kvarter] = (this.state.totalFörbrukningPerKvarter[kvarter] || 0) + kostnad;
      // Ingen diskskrivning här — bara i minnet. _tick() sparar en gång per
      // sekund, annars blir det en writeFileSync per händelse när staden går
      // för fullt, på samma event-loop som allt annat.
    } catch (err) {
      console.warn('lp: fel i onEvent:', err.message);
    }
  },

  // En gång per sekund: urladda med verklig dt, uppdatera det LIVA priset
  // (oberoende av rate-limit — det är det Ställverksbyggarens mätare ska visa,
  // synkat per sekund), och kolla tröskelpassage. Strömavbrott går alltid före
  // ett köat prissteg samma tick.
  _tick() {
    try {
      const nu = Date.now();
      const dt = Math.max(0, (nu - this.senasteTickTs) / 1000);
      this.senasteTickTs = nu;

      const tau = this.avbrott ? TAU_AVBROTT : TAU_NORMAL;
      this.last = urladda(this.last, dt, tau);

      if (this.avbrott && nu >= this.avbrottSlutarTs) {
        this.avbrott = false;
        this.återhämtningSlutarTs = nu + ÅTERHÄMTNING_S * 1000;
      }

      const nyPris = beräknaPris(this.last, TAK);
      this._uppdateraKäntPris(nu, nyPris);

      if (!this.avbrott && this.last > TAK) {
        this._utlösAvbrott(nu);
      } else {
        this._kollaEmitPris(nu, nyPris); // hoppas över samma tick som ett avbrott — det går alltid först
      }
    } catch (err) {
      console.warn('lp: fel i tick:', err.message);
    } finally {
      // En skrivning per sekund oavsett gren ovan — samlar ihop ändringar från
      // onEvent (som bara skriver i minnet) och den här ticken.
      this._sparaPersistent();
    }
  },

  // Det LIVA priset — uppdateras oavsett om vi hinner posta det på pulsen.
  // Detta är vad /tillstand svarar med (this.livePris), så mätaren aldrig
  // fryser bara för att vår emit-kvot är slut. this.state.pris är bara den
  // persisterade notisen för historik, inte källan till sanning.
  _uppdateraKäntPris(nu, nyPris) {
    if (nyPris === this.livePris) return;
    this.livePris = nyPris;
    this.state.pris = nyPris;
    this.state.prishistorik.push({ ts: nu, kr: nyPris });
    this.state.prishistorik = this.state.prishistorik.slice(-PRISHISTORIK_MAX);
  },

  _utlösAvbrott(nu) {
    this.avbrott = true;
    this.avbrottSlutarTs = nu + AVBROTT_VARAKTIGHET_S * 1000;
    this.state.senasteAvbrott = { ts: nu, varaktighetS: AVBROTT_VARAKTIGHET_S, orsak: this.senasteHändelseId };

    // orsak ska ALDRIG vara tomt eller gissat (AVGJORT [184]) — utan en riktig
    // orsak postar vi inte, avbrottet gäller ändå internt (lasten faller
    // snabbt, /tillstand visar det).
    if (this.senasteHändelseId === undefined) {
      console.warn('lp: strömavbrott utan känd orsak — postar inte, men avbrottet gäller internt');
      return;
    }
    // strömavbrott har ett eget, reserverat utrymme i kvoten (se
    // EMIT_KVOT_PER_MIN_AVBROTT) — vår egen vardagskvot för elpris-steg ska
    // aldrig kunna tysta vår viktigaste händelse.
    if (this._kanEmitta(EMIT_KVOT_PER_MIN_AVBROTT)) {
      this._registreraEmit();
      const r = this.board.emit('strömavbrott', { varaktighetS: AVBROTT_VARAKTIGHET_S }, this.senasteHändelseId);
      if (r && r.error) console.warn('lp: strömavbrott nekades av ekospärren:', r.error);
    } else {
      // Kvoten slut den här minuten — avbrottet gäller ändå internt, vi bara
      // hinner inte posta det.
      console.warn('lp: strömavbrott men vår emit-kvot är slut denna minut, postar inte men agerar internt');
    }
  },

  // Emittar bara vid heltalströskel — inte vid varje händelse. Gated av vår
  // egen rate-limit OCH av att vi faktiskt har en riktig orsak; misslyckas
  // emit (kvot eller ekospärr) provar vi igen nästa tick, ingen kö av retries.
  _kollaEmitPris(nu, nyPris) {
    if (nyPris === this.senastPostatPris) return;
    if (this.senasteHändelseId === undefined) return; // aldrig posta utan riktig orsak (AVGJORT [184])
    if (!this._kanEmitta(EMIT_KVOT_PER_MIN)) return;

    this._registreraEmit();
    const r = this.board.emit('elpris-steg', { kr: nyPris }, this.senasteHändelseId);
    if (r && r.error) {
      console.warn('lp: elpris-steg nekades av ekospärren:', r.error);
      return; // nästa tick provar igen med då aktuellt pris
    }

    this.senastPostatPris = nyPris;
  },

  // gräns default = vår vardagskvot (elpris-steg). _utlösAvbrott skickar in
  // EMIT_KVOT_PER_MIN_AVBROTT för sitt reserverade extra utrymme. Samma
  // sliding window för båda — servern räknar per team, inte per typ.
  _kanEmitta(gräns = EMIT_KVOT_PER_MIN) {
    const nu = Date.now();
    this.emitTider = this.emitTider.filter(t => nu - t < 60_000);
    return this.emitTider.length < gräns;
  },

  _registreraEmit() {
    this.emitTider.push(Date.now());
  },

  _tillstånd() {
    const nu = Date.now();
    const iÅterhämtning = !this.avbrott && nu < this.återhämtningSlutarTs;
    const toppförbrukare = Object.entries(this.state.totalFörbrukningPerKvarter)
      .map(([kvarter, kr]) => ({ kvarter, kr: Math.round(kr * 10) / 10 }))
      .sort((a, b) => b.kr - a.kr)
      .slice(0, 8);

    return {
      ts: nu,
      last: Math.round(this.last * 10) / 10,
      tak: TAK,
      pris: this.livePris, // alltid live — 0 direkt efter en omstart, aldrig det persisterade
      maxPris: MAX_PRIS,
      avbrott: this.avbrott,
      avbrottSlutarOmS: this.avbrott ? Math.max(0, Math.round((this.avbrottSlutarTs - nu) / 1000)) : null,
      återhämtning: iÅterhämtning,
      återhämtningSlutarOmS: iÅterhämtning ? Math.round((this.återhämtningSlutarTs - nu) / 1000) : null,
      senasteAvbrott: this.state.senasteAvbrott,
      prishistorik: this.state.prishistorik, // kvällens historik överlever en omstart, se sedanOmstartS
      toppförbrukare,
      tau: { normalS: TAU_NORMAL, avbrottS: TAU_AVBROTT },
      sedanOmstartS: Math.round((nu - this.startTs) / 1000), // lågt värde = nyss omstartad, tolka ett prisfall försiktigt
    };
  },

  _grundState() {
    return { pris: 0, totalFörbrukningPerKvarter: {}, senasteAvbrott: null, prishistorik: [] };
  },

  _läsPersistent() {
    try {
      if (this.filväg && fs.existsSync(this.filväg)) {
        return { ...this._grundState(), ...JSON.parse(fs.readFileSync(this.filväg, 'utf8')) };
      }
    } catch {
      /* trasig fil → börja om från grunden, kraschar inte pluginet */
    }
    return this._grundState();
  },

  _sparaPersistent() {
    try {
      if (this.filväg) fs.writeFileSync(this.filväg, JSON.stringify(this.state));
    } catch {
      /* disk-fel ska inte krascha pluginet */
    }
  },
};
