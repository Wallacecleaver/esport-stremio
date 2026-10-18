'use strict';
// Registre des jeux. `ready: false` = module pas encore branché (affiché « bientôt » dans la configuration).
// Pour ajouter un jeu : créer lib/games/<id>.js exportant { matches(opts), replays?(match) } puis passer `ready` à true ici.
const channels = require('../channels');

const GAMES = {
  lol: { id: 'lol', name: 'League of Legends', short: 'LoL', color: '#00c8c8', ready: true, mod: () => require('./lol') },
  lec: { id: 'lec', name: 'LEC', short: 'LEC', color: '#c9a24b', ready: true, mod: () => require('./lec') },
  valorant: { id: 'valorant', name: 'Valorant', short: 'VAL', color: '#ff4655', ready: true, mod: () => require('./valorant') },
  rocketleague: { id: 'rocketleague', name: 'Rocket League', short: 'RL', color: '#1f7bff', ready: true, mod: () => require('./rocketleague') },
  fortnite: { id: 'fortnite', name: 'Fortnite', short: 'FN', color: '#a855f7', ready: true, mod: () => require('./fortnite') },
  cod: { id: 'cod', name: 'Call of Duty', short: 'CoD', color: '#8bc34a', ready: false },
};
const ORDER = Object.keys(GAMES);
const list = () => ORDER.map(id => ({ ...GAMES[id], mod: undefined, channels: channels[id] || [] }));
const get = id => GAMES[id] || null;
const readyIds = () => ORDER.filter(id => GAMES[id].ready);
const mod = id => (GAMES[id] && GAMES[id].ready ? GAMES[id].mod() : null);

module.exports = { GAMES, ORDER, list, get, readyIds, mod };
