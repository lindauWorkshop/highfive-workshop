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
const platser = ['Genomfarten', 'Godisfabriken', 'Elverket', 'Banken', 'Hamnen', 'Klub Lyktan', 'Kasinot'];
const HJUL = ['🍒', '🚗', '💰', '💎', '🚔', '🍀'];
const KORT_R = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const KORT_S = ['♠', '♥', '♦', '♣'];

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
    // Vägval: publiken röstar vart jakten ska styras vid nästa överlämning.
    if (req.method === 'POST' && p === '/riktning') {
      const b = await this._body(req);
      if (this.state.harJakt && typeof b.mål === 'string' && b.mål.trim()) {
        const m = b.mål.trim().slice(0, 40);
        this.state.riktningRöster = this.state.riktningRöster || {};
        this.state.riktningRöster[m] = (this.state.riktningRöster[m] || 0) + 1;
        this._spara();
      }
      return this._json(res, 200, this.state);
    }
    // Casino: satsa på jaktens utgång medan vadslagningen är öppen.
    if (req.method === 'POST' && p === '/satsa') {
      const b = await this._body(req);
      const val = b.på === 'fly' ? 'fly' : (b.på === 'gripen' ? 'gripen' : null);
      if (val && this.state.casino && this.state.casino.öppen) {
        this.state.casino[val] = (this.state.casino[val] || 0) + 1;
        this._spara();
      }
      return this._json(res, 200, this.state);
    }
    // Kasinot: spela den enarmade banditen. Delad jackpot, tre 🚔 startar en razzia.
    if (req.method === 'POST' && p === '/snurra') {
      const b = await this._body(req);
      this._snurra(board, this._namn(b.spelare));
      return this._json(res, 200, this.state);
    }
    // Roulette: satsa på en färg och snurra hjulet direkt.
    if (req.method === 'POST' && p === '/rulett') {
      const b = await this._body(req);
      const färg = ['röd', 'svart', 'grön'].includes(b.färg) ? b.färg : 'röd';
      this._rulett(board, färg, this._namn(b.spelare));
      return this._json(res, 200, this.state);
    }
    // Blackjack: ett delat bord som rummet spelar tillsammans.
    if (req.method === 'POST' && p === '/bj-ny') { const b = await this._body(req); this._bjNy(board, this._namn(b.spelare)); return this._json(res, 200, this.state); }
    if (req.method === 'POST' && p === '/bj-hit') { this._bjHit(board); return this._json(res, 200, this.state); }
    if (req.method === 'POST' && p === '/bj-stand') { const b = await this._body(req); this._bjStand(board, this._namn(b.spelare)); return this._json(res, 200, this.state); }
    return false; // → 404
  },

  _namn(v) { return (typeof v === 'string' && v.trim()) ? v.trim().slice(0, 24) : null; },
  _kreditera(namn, belopp) {
    if (!namn || !belopp) return;
    this.state.spelare = this.state.spelare || {};
    this.state.spelare[namn] = (this.state.spelare[namn] || 0) + belopp;
  },

  _bjKort() { return KORT_R[Math.floor(Math.random() * 13)] + KORT_S[Math.floor(Math.random() * 4)]; },
  _bjVärde(hand) {
    let sum = 0, ess = 0;
    for (const k of hand) {
      const r = k.slice(0, -1);
      if (r === 'A') { sum += 11; ess++; }
      else if (r === 'K' || r === 'Q' || r === 'J' || r === '10') sum += 10;
      else sum += Number(r);
    }
    while (sum > 21 && ess > 0) { sum -= 10; ess--; }
    return sum;
  },
  _bjUppdatera() {
    const bj = this.state.bj;
    bj.spelarVärde = this._bjVärde(bj.spelarhand);
    bj.givarVärde = this._bjVärde(bj.givarhand);
  },
  _bjNy(board, spelare) {
    const bj = this.state.bj;
    bj.spelarhand = [this._bjKort(), this._bjKort()];
    bj.givarhand = [this._bjKort(), this._bjKort()];
    bj.status = 'spelar'; bj.resultat = ''; bj.vinst = 0;
    this._bjUppdatera();
    if (bj.spelarVärde === 21) { bj.status = 'klar'; bj.resultat = 'BLACKJACK! 50 marker.'; bj.vinst = 50; this._registreraVinst(board, 50, 'blackjack', spelare); }
    this._spara();
  },
  _bjHit() {
    const bj = this.state.bj;
    if (bj.status !== 'spelar') return;
    bj.spelarhand.push(this._bjKort());
    this._bjUppdatera();
    if (bj.spelarVärde > 21) { bj.status = 'klar'; bj.resultat = `Tjock på ${bj.spelarVärde} — givaren vinner.`; bj.vinst = 0; }
    this._spara();
  },
  _bjStand(board, spelare) {
    const bj = this.state.bj;
    if (bj.status !== 'spelar') return;
    while (this._bjVärde(bj.givarhand) < 17) bj.givarhand.push(this._bjKort());
    this._bjUppdatera();
    const pv = bj.spelarVärde, gv = bj.givarVärde;
    if (gv > 21 || pv > gv) { bj.vinst = 20; bj.resultat = `Du ${gv > 21 ? 'vann — givaren blev tjock' : 'vann ' + pv + ' mot ' + gv}! 20 marker.`; this._registreraVinst(board, 20, 'blackjack', spelare); }
    else if (pv === gv) { bj.vinst = 0; bj.resultat = `Lika på ${pv} — push.`; }
    else { bj.vinst = 0; bj.resultat = `Givaren vann ${gv} mot ${pv}.`; }
    bj.status = 'klar';
    this._spara();
  },

  // Roulette: 0 är grön, udda röd, jämn svart. Grön ger 14x, röd/svart 2x. Insats 10 marker.
  _rulett(board, färg, spelare) {
    const r = this.state.rulett;
    const n = Math.floor(Math.random() * 37);                 // 0–36
    const utfall = n === 0 ? 'grön' : (n % 2 ? 'röd' : 'svart');
    r.senasteNummer = n; r.senasteFärg = utfall; r.snurr = (r.snurr || 0) + 1;
    if (färg === utfall) {
      const vinst = utfall === 'grön' ? 140 : 20;
      r.senasteVinst = vinst;
      r.meddelande = `${n} ${utfall.toUpperCase()} — du satsade ${färg} och vann ${vinst} marker!`;
      this._registreraVinst(board, vinst, 'roulette', spelare);
    } else {
      r.senasteVinst = 0;
      r.meddelande = `${n} ${utfall.toUpperCase()} — du satsade ${färg}. Ingen vinst.`;
    }
    this._spara();
  },

  // Registrerar en vinst: topplista + (vid stor vinst) en casino-vinst-händelse till staden/nyheterna.
  _registreraVinst(board, belopp, spel, spelare) {
    this._kreditera(spelare, belopp);
    this.state.topp = this.state.topp || [];
    this.state.topp.push({ belopp, spel, spelare: spelare || null, tid: new Date().toISOString() });
    this.state.topp.sort((a, b) => b.belopp - a.belopp);
    this.state.topp = this.state.topp.slice(0, 5);
    if (belopp >= 50) {
      board.emit('casino-vinst', { belopp, spel, plats: 'Kasinot' });
      this._logga('kasino', `Stor vinst på ${spel}: ${belopp} marker! (rubrik till staden)`);
    }
  },

  // Enarmad bandit. Varje snurr matar jackpoten; tre lika vinner, tre 🚔 = razzia (startar en jakt).
  _snurra(board, spelare) {
    const k = this.state.kasino;
    const hjul = [0, 1, 2].map(() => HJUL[Math.floor(Math.random() * HJUL.length)]);
    k.snurr = (k.snurr || 0) + 1;
    k.jackpot = (k.jackpot || 0) + 5;
    k.senaste = hjul;
    const [a, bb, c] = hjul;
    if (a === bb && bb === c) {
      if (a === '🚔') {                                 // razzia på kasinot: en jakt bryter ut
        k.senasteVinst = 0;
        k.meddelande = 'RAZZIA! Tre 🚔 — polisen stormar kasinot.';
        this._logga('kasino', 'Tre 🚔 på banditen — razzia! En jakt bryter ut från Kasinot.');
        this._startaKupp(board, 'Kasinot');
      } else if (a === '💰') {                           // jackpot
        const pott = k.jackpot;
        k.senasteVinst = pott;
        k.utbetalt = (k.utbetalt || 0) + pott;
        k.meddelande = `💰💰💰 JACKPOT! ${pott} marker!`;
        this._logga('kasino', `JACKPOT på banditen: ${pott} marker!`);
        k.jackpot = 100;                                 // pott återställs
        this._registreraVinst(board, pott, 'jackpot', spelare);
      } else {
        k.senasteVinst = 50; k.utbetalt = (k.utbetalt || 0) + 50;
        k.meddelande = `${a}${a}${a} Tre i rad — 50 marker!`;
        this._registreraVinst(board, 50, 'banditen', spelare);
      }
    } else if (a === bb || bb === c || a === c) {
      k.senasteVinst = 10; k.utbetalt = (k.utbetalt || 0) + 10;
      k.meddelande = 'Par! 10 marker.';
      this._registreraVinst(board, 10, 'banditen', spelare);
    } else {
      k.senasteVinst = 0;
      k.meddelande = 'Ingen vinst. Snurra igen!';
    }
    this._spara();
  },

  // Publikens vinnande vägval (flest röster), eller undefined om ingen röstat.
  _vinnandeRiktning() {
    const r = this.state.riktningRöster || {};
    let bäst, max = 0;
    for (const k of Object.keys(r)) if (r[k] > max) { max = r[k]; bäst = k; }
    return bäst;
  },

  // Startar en jakt lokalt: sätter tillstånd, nollar grip-mätaren och ger jakten ett id.
  _börjaJakt(namn, wanted) {
    this.state.wanted = Math.min(WANTED_MAX, wanted);
    this.state.harJakt = true;
    this.state.förare = namn;
    this.state.gripTryck = 0;
    this.state.gripMål = 3 + this.state.wanted * 2;   // högre wanted = fler tryck krävs
    this.state.storlarm = false;
    this.state.riktningRöster = {};                    // publikens vägval för den här jakten
    this.state.casino = { öppen: true, fly: 0, gripen: 0, resultat: null };  // vadslå på utgången
    this.state.jaktId = (this.state.jaktId || 0) + 1;
    return this.state.jaktId;
  },

  // Casinot avgörs när jakten tar slut: grips förövaren vinner "gripen", flyr hen vinner "fly".
  _avgörCasino(utgång) {
    const c = this.state.casino;
    if (!c || !c.öppen) return;
    c.öppen = false;
    c.resultat = utgång;
    const vinnare = c[utgång] || 0, förlorare = (utgång === 'fly' ? c.gripen : c.fly) || 0;
    this._logga('casino', `Casinot: ${utgång === 'fly' ? 'FLYKT' : 'GRIPEN'} vann! ${vinnare} rätt, ${förlorare} fel.`);
  },

  // Vid wanted 5 kopplas hela staden in: ett storlarm på pulsen (en gång per jakt).
  _kollaStorlarm(board) {
    if (this.state.harJakt && this.state.wanted >= WANTED_MAX && !this.state.storlarm) {
      this.state.storlarm = true;
      board.emit('storlarm', { förare: this.state.förare, plats: 'Genomfarten' });
      this._logga('storlarm', `STORLARM! wanted ${WANTED_MAX}★ — hela staden kopplas in på jakten på ${this.state.förare}.`);
    }
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
    this._kollaStorlarm(board);
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
      this._avgörCasino('gripen');
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
      this._kollaStorlarm(board);
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
      this._kollaStorlarm(board);
      this._planeraÖverlämning(board, e.id, id);
      this._spara();
      return;
    }
    // Nattliv på Klub Lyktan (@marianne): en shots-runda kan sluta i ett rån i natten.
    if (e.typ === 'shots-runda' || e.typ === 'beat') {
      if (this.state.harJakt) return;
      if (e.typ === 'shots-runda' && Math.random() < 0.4) {
        this._startaKupp(board, 'Klub Lyktan', e.id);
      } else {
        this.state.poliserUte = Math.min(9, (this.state.poliserUte || 0) + 1);
        this._logga('natt', `Nattpulsen stiger (@${e.från}) — en patrull svänger förbi Klub Lyktan.`);
        this._spara();
      }
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
        this._kollaStorlarm(board);
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
          this._avgörCasino('gripen');
          this.state.harJakt = false;
          this._spara();
          return;
        }
        const riktning = this._vinnandeRiktning();
        const r = board.emit('överlämning', { vad: 'jakt', wanted: this.state.wanted, förare: this.state.förare, riktning }, orsak);
        if (r && r.message) {
          let djup = '?'; try { djup = JSON.parse(r.message.text).djup; } catch { /* ok */ }
          this._logga('ut', `Jakten på ${this.state.förare} lämnade Genomfarten${riktning ? ' mot ' + riktning : ''} (djup ${djup}).`);
          this._avgörCasino('fly');
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
      gripTryck: 0, gripMål: 0, jaktId: 0, storlarm: false, riktningRöster: {},
      casino: { öppen: false, fly: 0, gripen: 0, resultat: null },
      kasino: { jackpot: 100, snurr: 0, senaste: null, senasteVinst: 0, utbetalt: 0, meddelande: 'Snurra för att spela!' },
      rulett: { senasteNummer: null, senasteFärg: null, senasteVinst: 0, snurr: 0, meddelande: 'Satsa på en färg och snurra.' },
      bj: { spelarhand: [], givarhand: [], spelarVärde: 0, givarVärde: 0, status: 'väntar', resultat: '', vinst: 0 },
      topp: [], spelare: {},
      platser, senaste: [], senasteHändelseTs: Date.now() };
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
