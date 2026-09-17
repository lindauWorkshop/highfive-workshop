'use strict';

const status = {
  startad: new Date().toISOString(),
  mottagnaHändelser: 0,
  senasteHändelse: null
};

module.exports = {
  async handle(req, res, { path }) {
    if (req.method !== 'GET' || (path !== '/' && path !== '/status')) return false;
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      namn: 'Stadskartan',
      roll: 'Skrivskyddad livevisualisering',
      postar: [],
      läser: ['api/kvarter', 'staden-puls'],
      ...status
    }));
    return true;
  },

  onEvent(event) {
    status.mottagnaHändelser += 1;
    status.senasteHändelse = {
      id: event.id,
      typ: event.typ,
      från: event.från,
      orsak: event.orsak || null,
      djup: event.djup
    };
  }
};
