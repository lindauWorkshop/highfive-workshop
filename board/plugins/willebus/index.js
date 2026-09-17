// Team willebus — kvarteret "Genomfarten". Polisen och jakten som rör sig genom staden.
//
// Berättelse 3 på Stadens puls (PROJEKT.md): en kupp höjer wanted-nivån, och en jakt
// är ett objekt som ägs av ETT kvarter i taget och lämnas över när den korsar en gräns.
//
// Publiken spelar med (via rutan på /staden, delat tillstånd i dataDir):
//   POST /t/willebus/kupp  {plats?, förare?, wanted?}  → bygg din egen kupp mot valfritt kvarter
//   POST /t/willebus/grip                              → kollektivt: alla trycker, fylls mätaren grips förövaren
//
//   POSTAR (board.emit):  kupp, överlämning, delsvar, gripande
//   LYSSNAR (onEvent):    kupp (vem som helst → vi tar upp jakten), överlämning (först till kvarn),
//                         fråga (patrull + delsvar), strömavbrott, godis-klart, socker-slut, svar, godkänt
//
// Servern håller ekospärren (djup max 4, en reaktion per orsak, 6/min) och fyller i från och djup.

const fs = require('fs');
const path = require('path');

const WANTED_MAX = 5;
const SVALNAR_MS = 60 * 1000;   // wanted −1 per minut utan händelse
const OVERLAMNING_MS = 10000;   // hur länge jakten stannar hos oss (och går att gripa) innan den skickas vidare
const förare = ['Röda Sköden', 'Bagarn', 'Loff', 'Tvillingen', 'Doris 78', 'Kajan'];
const platser = ['Genomfarten', 'Godisfabriken', 'Elverket', 'Banken', 'Hamnen', 'Klub Lyktan'];

module.exports = {
  init(ctx) {
    this.ctx = ctx;
    this.filväg = ctx.dataDir ? path.join(ctx.dataDir, 'state.json') : null;
    this.state = this._läs();
  },

  async handle(req, res, { path: p, board }) {
    if (req.method === 'GET' && (p === '/state' || p === '/')) {
      this._svalna();
      return this._json(res, 200, this.state);
    }
    // Bygg din egen kupp: publiken väljer mål, förare och wanted (allt valfritt).
    if (req.method === 'POST' && p === '/kupp') {
      const b = await this._body(req);
      const plats = (typeof b.plats === 'string' && b.plats.trim()) ? b.plats.trim().slice(0, 40)
        : platser[Math.floor(Math.random() * platser.length)];
      const namn = (typeof b.förare === 'string' && b.förare.trim()) ? b.förare.trim().slice(0, 40) : undefined;
      const w = Number(b.wanted);
      const wanted = Number.isFinite(w) ? Math.max(1, Math.min(WANTED_MAX, Math.round(w))) : undefined;
      this._startaKupp(board, plats, undefined, { förare: namn, wanted });
      return this._json(res, 200, this.state);
    }
    // Kollektivt GRIP: varje tryck fyller mätaren. Full mätare = förövaren grips.
    if (req.method === 'POST' && p === '/grip') {
      this._grip(board);
      return this._json(res, 200, this.state);
    }
    return false; // → 404
  },

  // Startar en jakt lokalt: sätter tillstånd, nollar grip-mätaren och ger jakten ett id.
  _börjaJakt(namn, wanted) {
    this.state.wanted = Math.min(WANTED_MAX, wanted);
    this.state.harJakt = true;
    this.state.förare = namn;
    this.state.gripTryck = 0;
    this.state.gripMål = 3 + this.state.wanted * 2;   // högre wanted = fler tryck krävs
    this.state.jaktId = (this.state.jaktId || 0) + 1;
    return this.state.jaktId;
  },

  // Startar en kupp: postar kupp på pulsen och skickar jakten vidare.
  // orsak sätts när kuppen är en reaktion (t.ex. på godis-klart), annars är den kedjans start.
  _startaKupp(board, plats, orsak, opts = {}) {
    if (this.state.harJakt) return false;
    const wanted = Number.isFinite(opts.wanted) ? opts.wanted : 1 + Math.floor(Math.random() * 3);
    const namn = opts.förare || förare[Math.floor(Math.random() * förare.length)];
    const r = board.emit('kupp', { wanted, plats }, orsak);
    if (!(r && r.message)) return false;              // ekospärren nekade (för djup kedja) — ingen storm
    const id = this._börjaJakt(namn, wanted);
    this._logga('kupp', `Kupp på ${plats}! ${namn} flyr, wanted ${this.state.wanted}★`);
    this._planeraÖverlämning(board, r.message.id, id);
    this._spara();
    return true;
  },

  // Kollektivt gripande: publikens tryck fyller mätaren.
  _grip(board) {
    if (!this.state.harJakt) return;
    this.state.gripTryck = (this.state.gripTryck || 0) + 1;
    if (this.state.gripTryck >= (this.state.gripMål || 1)) {
      this._logga('gripen', `GRIPEN! Publiken tog ${this.state.förare} på Genomfarten (${this.state.gripTryck} tryck).`);
      board.emit('gripande', { förare: this.state.förare, plats: 'Genomfarten' });
      this.state.harJakt = false;
      this.state.wanted = 0;
      this.state.jaktId = (this.state.jaktId || 0) + 1;   // ogiltigförklara väntande överlämning
    }
    this._spara();
  },

  // Varje händelse från ett ANNAT kvarter på #staden-puls
  onEvent(e, { board }) {
    // Tar emot en pågående jakt — bara om vi är lediga (först till kvarn)
    if (e.typ === 'överlämning' && e.nyttolast && e.nyttolast.vad === 'jakt') {
      if (this.state.harJakt) return;
      const id = this._börjaJakt(e.nyttolast.förare || 'okänd', Math.min(WANTED_MAX, Number(e.nyttolast.wanted) || 1));
      this._logga('in', `Jakten på ${this.state.förare} kom in från @${e.från} (wanted ${this.state.wanted}★).`);
      this._planeraÖverlämning(board, e.id, id);
      this._spara();
      return;
    }
    // Ett kupp NÅGON ANNANSTANS: Genomfarten tar upp jakten och gör den till en rörlig jakt.
    if (e.typ === 'kupp') {
      if (this.state.harJakt) return;
      const plats = (e.nyttolast && e.nyttolast.plats) || 'stan';
      const namn = förare[Math.floor(Math.random() * förare.length)];
      const id = this._börjaJakt(namn, Math.min(WANTED_MAX, Number(e.nyttolast && e.nyttolast.wanted) || 1));
      this._logga('larm', `Larm: kupp på ${plats} (@${e.från})! Genomfarten tar upp jakten på ${namn} (wanted ${this.state.wanted}★).`);
      this._planeraÖverlämning(board, e.id, id);
      this._spara();
      return;
    }
    // Staden har svarat / en dom står fast: läget lugnar sig, färre patruller.
    if (e.typ === 'svar' || e.typ === 'godkänt') {
      this.state.poliserUte = Math.max(0, (this.state.poliserUte || 0) - 1);
      this._logga('dom', e.typ === 'svar'
        ? `Staden har svarat (@${e.från}) — läget på Genomfarten lugnar sig.`
        : `Domen står fast (@${e.från}) — patrullerna drar sig tillbaka.`);
      this._spara();
      return;
    }
    // En het fråga drar ut mer polis OCH ger stadens tanke-lager ordningsmaktens vinkel
    if (e.typ === 'fråga') {
      this.state.poliserUte = Math.min(9, (this.state.poliserUte || 0) + 1);
      this._logga('patrull', `Het fråga från @${e.från} — fler polispatruller ut på Genomfarten.`);
      const d = this._delsvar(e.nyttolast && e.nyttolast.text);
      const r = board.emit('delsvar', { text: d.text, motivering: d.motivering }, e.id);
      if (r && r.message) this._logga('delsvar', `Delsvar till @${e.från}: ordningsmaktens vinkel.`);
      this._spara();
      return;
    }
    // Reagerar på Elverket: strömavbrott = mörker. Den flyende utnyttjar det.
    if (e.typ === 'strömavbrott') {
      if (this.state.harJakt) {
        this.state.wanted = Math.min(WANTED_MAX, this.state.wanted + 1);
        this._logga('mörker', `Strömavbrott (@${e.från})! ${this.state.förare} utnyttjar mörkret — wanted ${this.state.wanted}★.`);
      } else {
        this.state.poliserUte = Math.max(0, (this.state.poliserUte || 0) - 1);
        this._logga('mörker', `Strömavbrott (@${e.från}) — patrullerna kör blint på Genomfarten.`);
      }
      this._spara();
      return;
    }
    // Godisfabriken (@christian): en färsk sats är ett nytt byte. Tjuven slår till på lagret.
    if (e.typ === 'godis-klart') {
      if (this.state.harJakt) return;
      this._startaKupp(board, 'Godisfabriken', e.id);   // orsak-länkad; nekas den (för djup) svalnar det bara
      return;
    }
    // Bristen efter kuppen är vår. Vi kvitterar den synligt.
    if (e.typ === 'socker-slut') {
      this._logga('brist', `Lagret på Godisfabriken är tömt (@${e.från}) — bristen efteråt är vårt jobb.`);
      this._spara();
    }
  },

  // Ordningsmaktens/risk-vinkel som delsvar till en fråga. Regelbaserat, ingen språkmodell.
  _delsvar(fråga) {
    const f = (fråga || '').toString().slice(0, 120);
    return {
      text: `Sett från gatan: väg in ordning och risk innan ni svarar på "${f}". Vad kostar det om det går fel, och vem får städa?`,
      motivering: 'Ordningsmaktens vinkel — en påminnelse om konsekvens och risk som de andra huvudena lätt hoppar över.',
    };
  },

  // Skicka jakten vidare efter en stund. Grips förövaren först (jaktId ändras) händer inget här.
  _planeraÖverlämning(board, orsak, jaktId) {
    setTimeout(() => {
      try {
        if (this.state.jaktId !== jaktId || !this.state.harJakt) return;   // gripen eller ersatt av ny jakt
        if (this.state.wanted <= 0) {
          this._logga('gripen', `${this.state.förare} greps på Genomfarten. Wanted nollas.`);
          this.state.harJakt = false;
          this._spara();
          return;
        }
        const r = board.emit('överlämning', { vad: 'jakt', wanted: this.state.wanted, förare: this.state.förare }, orsak);
        if (r && r.message) {
          let djup = '?'; try { djup = JSON.parse(r.message.text).djup; } catch { /* ok */ }
          this._logga('ut', `Jakten på ${this.state.förare} lämnade Genomfarten (djup ${djup}).`);
          this.state.harJakt = false;
        } else {
          this._logga('slut', `Kedjan är slut — jakten på ${this.state.förare} svalnar på Genomfarten.`);
        }
        this._spara();
      } catch (e) { /* ett plugin som kastar ska inte ta ner servern */ }
    }, OVERLAMNING_MS);
  },

  _svalna() {
    const nu = Date.now();
    const sen = this.state.senasteHändelseTs || nu;
    const minuter = Math.floor((nu - sen) / SVALNAR_MS);
    if (minuter > 0 && this.state.wanted > 0) {
      this.state.wanted = Math.max(0, this.state.wanted - minuter);
      this.state.senasteHändelseTs = nu;
      if (this.state.wanted === 0) this.state.harJakt = false;
      this._spara();
    }
  },

  _logga(typ, text) {
    this.state.senasteHändelseTs = Date.now();
    this.state.senaste = this.state.senaste || [];
    this.state.senaste.unshift({ typ, text, tid: new Date().toISOString() });
    this.state.senaste = this.state.senaste.slice(0, 12);
  },

  _body(req) {
    return new Promise((resolve) => {
      let d = '';
      req.on('data', (c) => { d += c; if (d.length > 10000) req.destroy(); });
      req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    });
  },

  _grund() {
    return { kvarter: 'Genomfarten', wanted: 0, harJakt: false, förare: null, poliserUte: 0,
      gripTryck: 0, gripMål: 0, jaktId: 0, platser, senaste: [], senasteHändelseTs: Date.now() };
  },

  _läs() {
    try {
      if (this.filväg && fs.existsSync(this.filväg)) {
        return { ...this._grund(), ...JSON.parse(fs.readFileSync(this.filväg, 'utf8')), platser };
      }
    } catch { /* trasig fil → börja om från grunden */ }
    return this._grund();
  },

  _spara() {
    try { if (this.filväg) fs.writeFileSync(this.filväg, JSON.stringify(this.state)); } catch { /* ok */ }
  },

  _json(res, kod, data) {
    res.writeHead(kod, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
    return true;
  },
};
