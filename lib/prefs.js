'use strict';
// Réglages personnels : jeux suivis, équipes favorites, langue des sources, spoilers, qualité.
// Stockés dans un profil (Upstash) ou, sans base, directement dans l'adresse d'installation : /c/<pseudo>/<réglages>/manifest.json
const games = require('./games');

const PSEUDO_RE = /^[a-z0-9_]{2,20}$/;
const LANGS = ['FR', 'EN', 'all'];
const CAPS = [0, 1440, 1080, 720, 480, 360];
const DEFAULTS = { games: ['lol'], teams: {}, lang: 'FR', score: false, cap: 0, relay: true, device: '' };

const cleanPseudo = p => String(p || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]/g, '').slice(0, 20);
const cleanDevice = d => String(d || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 24);
const cleanTeam = t => String(t || '').replace(/[\u0000-\u001f<>"]/g, '').trim().slice(0, 40);

function normalize(o = {}) {
  const c = { ...DEFAULTS, teams: {} };
  const ids = games.ORDER;
  if (Array.isArray(o.games)) c.games = [...new Set(o.games.map(String).filter(g => ids.includes(g)))];
  if (!c.games.length) c.games = [...DEFAULTS.games];
  if (o.teams && typeof o.teams === 'object') {
    for (const g of ids) if (Array.isArray(o.teams[g])) c.teams[g] = [...new Set(o.teams[g].map(cleanTeam).filter(Boolean))].slice(0, 12);
  }
  if (LANGS.includes(o.lang)) c.lang = o.lang;
  if (typeof o.score === 'boolean') c.score = o.score;
  if (CAPS.includes(Number(o.cap))) c.cap = Number(o.cap);
  if (typeof o.relay === 'boolean') c.relay = o.relay;
  c.device = cleanDevice(o.device);
  return c;
}
const encode = o => Buffer.from(JSON.stringify(normalize(o))).toString('base64url');
function decode(s) { try { return normalize(JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8'))); } catch { return null; } }
const favTeams = cfg => [...new Set(Object.values(cfg.teams || {}).flat())];
const summary = c => c.games.join('+') + (favTeams(c).length ? ' ⭐' + favTeams(c).join(',') : '') + ' · ' + c.lang + (c.score ? ' · scores' : '');

module.exports = { PSEUDO_RE, DEFAULTS, CAPS, LANGS, cleanPseudo, cleanDevice, normalize, encode, decode, favTeams, summary };
