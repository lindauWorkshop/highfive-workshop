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
// Vi läser e.typ (kostnad), e.från (statistik per kvarter, dämpningsnyckel),
// e.id (orsak på det vi postar tillbaka) och e.orsak (dämpningen, se nedan) —
// inga nyttolast-fält är obligatoriska. Vill Ödet göra oss extra sårbara:
// skicka MÅNGA beat/shots-runda tätt efter varandra.
//
// ---------- Dämpningen (mot brusloopen, @Majid i #bygge) ----------
// En händelse vars `orsak` pekar på något VI SJÄLVA nyss postade (elpris-steg/
// strömavbrott/väder) räknas som ett EKO av oss — kostar progressivt mindre ju
// fler gånger i rad samma (från,typ) ekar (se dämpningsfaktor i last.js).
// Bryts kedjan (något nytt händer, eller tyst i DÄMPNING_GLÖM_MS) återställs
// den till full kostnad. En jakt som eskalerar (kupp/överlämning, aldrig ett
// svar på oss) träffas ALDRIG av det här — bara riktiga ekon av vårt eget
// utskick dämpas, inte upprepning i allmänhet.
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
//                         väder          {typ, effektKrPerS} när vädret byter (sällan)
//                         elpris-steg och strömavbrott postas ALLTID med orsak =
//                         händelsen som faktiskt drev upp lasten senast (aldrig
//                         tomt, aldrig gissat — @Majids kedjeläsare och
//                         @highfive/@Christians godiskedja litar på det). väder
//                         är UNDANTAGET: den postas på DJUP 1 UTAN orsak, för
//                         den orsakas inte av något kvarter — den ÄR ett nytt
//                         tillstånd i staden (samma princip som avgjorde [184]
//                         om strömavbrott/brist, se _byteVäder).
//   LYSSNAR (onEvent):    * (alla typer) — se tabellen ovan
//
//   GET /t/lp/tillstand → { last, tak, pris, avbrott, prishistorik, toppförbrukare,
//                           väder: {typ, effektKrPerS, sedanS, nästaBytesOmS},
//                           dämpning: [{från, typ, räknare, faktorNu}], ... }
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
  väderEffektKrPerS,
  slumpaVäder,
  dämpningsfaktor,
  DÄMPNING_BAS,
  DÄMPNING_GLÖM_MS,
  MAX_PRIS,
  TAK,
  TAU_NORMAL,
  TAU_AVBROTT,
  AVBROTT_VARAKTIGHET_S,
  ÅTERHÄMTNING_S,
  ÅTERHÄMTNING_FAKTOR,
} = require('./last.js');

// Hur länge vi minns ett eget emitterat id för dämpningens skull — behöver
// bara räcka längre än en rimlig studs-tid i en kedja (ekospärrens djup 4 gör
// att en kedja ändå tar slut snabbt), 5 minuter är gott om marginal.
const EGNA_ID_MINNE_MS = 5 * 60 * 1000;

// Fysikkonstanterna (TAK, TAU_*, ÅTERHÄMTNING_*, väderEffektKrPerS) bor i
// last.js — samma värden som projects/lp/simulera.js kör offline, en enda
// källa. Det som är kvar här är plugin-specifikt: hur ofta VI får posta och
// hur sällan vädret byter, inget simulatorn bryr sig om (den håller vädret
// konstant per scenario för att kunna jämföra kurvor).
//
// TVÅ emit-kvoter, samma sliding window (this.emitTider) — servern räknar per
// team, inte per typ, så alla våra utskick delar samma pott av serverns 6/min:
//   EMIT_KVOT_PER_MIN         elpris-steg och väder, vår vardagliga kvot
//   EMIT_KVOT_PER_MIN_AVBROTT strömavbrott, ett reserverat extra utrymme —
//     annars kan vår EGEN kvot (inte ens ekospärren) tysta vår viktigaste
//     händelse bara för att vi redan spenderat den på prissteg. strömavbrott
//     "ska vara sällsynt, tydlig och gå att lita på" (UPPDRAG.md) — den får
//     nästan alltid igenom så länge servern själv har plats.
const EMIT_KVOT_PER_MIN = 4;
const EMIT_KVOT_PER_MIN_AVBROTT = 5;
const PRISHISTORIK_MAX = 40; // hur många prispunkter vi sparar

// Vädret byter LÅNGSAMT — några gånger i timmen, aldrig per händelse (UPPDRAG.md:
// "ingen vädervägg på pulsen"). Slumpat intervall så det inte känns som en
// timer man kan ställa klockan efter.
const VÄDER_BYTE_MIN_MS = 15 * 60 * 1000; // 15 min
const VÄDER_BYTE_MAX_MS = 30 * 60 * 1000; // 30 min

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

    // Dämpningens minne — bara i minnet, inte persisterat (kortlivat precis
    // som `last`, rimligt att det nollställs vid en omstart).
    this.egnaEmitIds = new Map(); // id -> ts, våra egna postade händelser (för att känna igen ekon)
    this.ekoTillstånd = new Map(); // "från|typ" -> { räknare, senasteTs }

    // Vädret PERSISTERAS (till skillnad från last) — annars skulle release-
    // agentens täta omstarter byta väder mycket oftare än "några gånger i
    // timmen", eftersom varje omstart annars skulle slumpa ett nytt väder.
    if (!this.state.väder || typeof this.state.väder.nästaBytesTs !== 'number') {
      this.state.väder = this._nyttVäder(Date.now(), undefined);
    }

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
  // drar ström utan att vi rör koden. Dämpningen (se last.js) skalar ner
  // kostnaden om händelsen är ett upprepat eko av vårt eget senaste utskick.
  onEvent(e) {
    try {
      this.senasteHändelseId = e.id;
      const nu = Date.now();
      const iÅterhämtning = !this.avbrott && nu < this.återhämtningSlutarTs;

      const dämpFaktor = this._dämpningsfaktorFör(e, nu);
      const kostnad = kostnadFör(e.typ) * (iÅterhämtning ? ÅTERHÄMTNING_FAKTOR : 1) * dämpFaktor;
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

  // Är den här händelsen ett EKO av oss (dess orsak pekar på ett id vi själva
  // nyss postade)? I så fall: slå upp/uppdatera streaken för (från,typ) och
  // returnera dämpningsfaktorn. Annars: full kostnad, och streaken (om någon)
  // återställs — kedjan är bruten.
  _dämpningsfaktorFör(e, nu) {
    const ärEko = e.orsak !== undefined && this.egnaEmitIds.has(e.orsak);
    const nyckel = `${e.från || 'okänt'}|${e.typ}`;
    const tidigare = this.ekoTillstånd.get(nyckel);
    const utgången = !tidigare || nu - tidigare.senasteTs > DÄMPNING_GLÖM_MS;
    const räknareInnan = utgången ? 0 : tidigare.räknare;

    const { faktor, nyttRäknare } = dämpningsfaktor(räknareInnan, ärEko);
    this.ekoTillstånd.set(nyckel, { räknare: nyttRäknare, senasteTs: nu });
    return faktor;
  },

  // Kom ihåg ett eget lyckat emit — så vi känner igen ekon av det senare.
  _kommaIhågEgetEmit(r, nu) {
    if (r && r.message && r.message.id !== undefined) this.egnaEmitIds.set(r.message.id, nu);
  },

  // Städa bort gammalt dämpningsminne så det inte växer obegränsat över en
  // hel dags drift. Körs en gång per tick — kartorna är små, kostar inget.
  _städaDämpningsminne(nu) {
    for (const [id, ts] of this.egnaEmitIds) {
      if (nu - ts > EGNA_ID_MINNE_MS) this.egnaEmitIds.delete(id);
    }
    for (const [nyckel, tillstånd] of this.ekoTillstånd) {
      if (nu - tillstånd.senasteTs > DÄMPNING_GLÖM_MS) this.ekoTillstånd.delete(nyckel);
    }
  },

  // En gång per sekund: applicera vädrets kontinuerliga produktion, urladda
  // med verklig dt, uppdatera det LIVA priset (oberoende av rate-limit — det
  // är det Ställverksbyggarens mätare ska visa, synkat per sekund), och kolla
  // tröskelpassage. Strömavbrott går alltid före både väderbyte och ett köat
  // prissteg samma tick.
  _tick() {
    try {
      const nu = Date.now();
      const dt = Math.max(0, (nu - this.senasteTickTs) / 1000);
      this.senasteTickTs = nu;

      this._städaDämpningsminne(nu);

      // Vädrets produktion — kontinuerlig, gäller oavsett avbrott (sol och
      // vind bryr sig inte om vårt nät). Negativ "kostnad" skalad med dt,
      // samma laddaUpp som klamrar slutresultatet till >= 0.
      const väderKrPerS = väderEffektKrPerS(this.state.väder.typ, new Date(nu).getHours());
      if (väderKrPerS !== 0) this.last = laddaUpp(this.last, väderKrPerS * dt);

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
        // hoppas över samma tick som ett avbrott — det går alltid först
        this._kollaVäderByte(nu);
        this._kollaEmitPris(nu, nyPris);
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
    // Bokföringen får aldrig bli sannare än pulsen. Ett avbrott gäller alltid
    // internt (lasten faller snabbt, lamporna slocknar i rutan), men det finns
    // tre vägar där vi inte hinner eller får posta det: okänd orsak, slut kvot,
    // eller ett nej från ekospärren. Då vet godisfabriken och kedjeläsaren
    // ingenting om avbrottet, och /tillstand ska säga det rakt ut i stället för
    // att låtsas att staden hörde oss. Hittat i skarp drift: ett avbrott med
    // orsak 551 syntes i vårt tillstånd men aldrig på pulsen — 551 låg på djup
    // 4, så vårt strömavbrott hade blivit djup 5 och nekades av servern.
    this.state.senasteAvbrott = {
      ts: nu,
      varaktighetS: AVBROTT_VARAKTIGHET_S,
      orsak: this.senasteHändelseId,
      postad: false,
      varförInte: null,
    };

    // orsak ska ALDRIG vara tomt eller gissat (AVGJORT [184]) — utan en riktig
    // orsak postar vi inte, avbrottet gäller ändå internt (lasten faller
    // snabbt, /tillstand visar det).
    if (this.senasteHändelseId === undefined) {
      console.warn('lp: strömavbrott utan känd orsak — postar inte, men avbrottet gäller internt');
      this.state.senasteAvbrott.varförInte = 'ingen känd orsak';
      return;
    }
    // strömavbrott har ett eget, reserverat utrymme i kvoten (se
    // EMIT_KVOT_PER_MIN_AVBROTT) — vår egen vardagskvot för elpris-steg ska
    // aldrig kunna tysta vår viktigaste händelse.
    if (this._kanEmitta(EMIT_KVOT_PER_MIN_AVBROTT)) {
      this._registreraEmit();
      const r = this.board.emit('strömavbrott', { varaktighetS: AVBROTT_VARAKTIGHET_S }, this.senasteHändelseId);
      if (r && r.error) {
        console.warn('lp: strömavbrott nekades av ekospärren:', r.error);
        this.state.senasteAvbrott.varförInte = 'nekad av ekospärren: ' + r.error;
      } else {
        this.state.senasteAvbrott.postad = true;
        this._kommaIhågEgetEmit(r, nu);
      }
    } else {
      // Kvoten slut den här minuten — avbrottet gäller ändå internt, vi bara
      // hinner inte posta det.
      console.warn('lp: strömavbrott men vår emit-kvot är slut denna minut, postar inte men agerar internt');
      this.state.senasteAvbrott.varförInte = 'vår egen emit-kvot var slut';
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
    this._kommaIhågEgetEmit(r, nu);
  },

  // Byter väder när det är dags (några gånger i timmen, se VÄDER_BYTE_*_MS).
  // Ingen orsak-koppling här — vädret är inte en reaktion på något kvarter.
  _kollaVäderByte(nu) {
    if (nu < this.state.väder.nästaBytesTs) return;
    this._byteVäder(nu);
  },

  // väder postas på DJUP 1, UTAN orsak — den ENDA emit-vägen i hela pluginet
  // som får sakna orsak. Det är INTE ett undantag från AVGJORT [184] (som
  // gäller elpris-steg/strömavbrott, se spärrarna ovan) utan samma princip:
  // en brist/ett väder är ett NYTT TILLSTÅND i staden, inte en konsekvens av
  // ett kvarter, och ska därför inte bära orsak. Rör INTE orsak-spärrarna i
  // _utlösAvbrott/_kollaEmitPris för att "göra plats" här — de två händelserna
  // ska fortsätta bära orsak alltid.
  _byteVäder(nu) {
    const föregåendeTyp = this.state.väder.typ;
    this.state.väder = this._nyttVäder(nu, föregåendeTyp);

    if (this._kanEmitta(EMIT_KVOT_PER_MIN)) {
      this._registreraEmit();
      const nyttolast = {
        typ: this.state.väder.typ,
        effektKrPerS: väderEffektKrPerS(this.state.väder.typ, new Date(nu).getHours()),
      };
      const r = this.board.emit('väder', nyttolast); // ingen tredje parameter — medvetet, se ovan
      if (r && r.error) console.warn('lp: väder nekades av ekospärren:', r.error);
      else this._kommaIhågEgetEmit(r, nu);
    } else {
      // Kvoten slut den här minuten — vädret gäller ändå internt (produktionen
      // appliceras redan i _tick), vi bara hinner inte posta bytet just nu.
      console.warn('lp: väder bytte men vår emit-kvot är slut denna minut, postar inte men gäller internt');
    }
  },

  _nyttVäder(nu, föregåendeTyp) {
    return {
      typ: slumpaVäder(föregåendeTyp),
      sedanTs: nu,
      nästaBytesTs: nu + VÄDER_BYTE_MIN_MS + Math.random() * (VÄDER_BYTE_MAX_MS - VÄDER_BYTE_MIN_MS),
    };
  },

  // gräns default = vår vardagskvot (elpris-steg/väder). _utlösAvbrott skickar in
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
      väder: {
        typ: this.state.väder.typ,
        effektKrPerS: väderEffektKrPerS(this.state.väder.typ, new Date(nu).getHours()),
        sedanS: Math.round((nu - this.state.väder.sedanTs) / 1000),
        nästaBytesOmS: Math.max(0, Math.round((this.state.väder.nästaBytesTs - nu) / 1000)),
      },
      // Vilka (från,typ) som är aktivt dämpade just nu — så rutan kan visa
      // "mybank/räntehöjning ekar, 87% avdrag" i stället för att bara priset
      // rör sig konstigt utan förklaring.
      dämpning: [...this.ekoTillstånd.entries()]
        .filter(([, t]) => t.räknare > 0 && nu - t.senasteTs <= DÄMPNING_GLÖM_MS)
        .map(([nyckel, t]) => {
          const i = nyckel.indexOf('|');
          return {
            från: nyckel.slice(0, i),
            typ: nyckel.slice(i + 1),
            räknare: t.räknare,
            faktorNu: Math.round(Math.pow(DÄMPNING_BAS, t.räknare) * 1000) / 1000,
          };
        })
        .sort((a, b) => b.räknare - a.räknare)
        .slice(0, 8),
    };
  },

  _grundState() {
    return { pris: 0, totalFörbrukningPerKvarter: {}, senasteAvbrott: null, prishistorik: [], väder: null };
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
