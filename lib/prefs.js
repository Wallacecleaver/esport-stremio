'use strict';
// Réglages personnels : compétitions suivies, équipes favorites (Europe), langue des lives, scores visibles, qualité.
// Gardés dans un profil (Upstash) ou, sans base, directement dans l'adresse d'installation : /c/<pseudo>/<réglages>/manifest.json
const PSEUDO_RE = /^[a-z0-9_]{2,20}$/;
const COMPS = [
  { id: 'emea', name: 'VCT EMEA', desc: 'Le championnat européen (Europe, Moyen-Orient, Afrique)' },
  { id: 'intl', name: 'VCT international', desc: 'Masters et Champions (le championnat du monde)' },
  { id: 'gc', name: 'Game Changers', desc: 'Game Changers Europe (EMEA) et championnat du monde' },
  { id: 'ewc', name: 'Esports World Cup', desc: 'Le tournoi Valorant de l\'EWC' },
  { id: 'lolw', name: 'Worlds & MSI (LoL)', desc: 'League of Legends : le championnat du monde, le MSI et le First Stand', game: 'lol' },
  { id: 'fnmajor', name: 'FNCS Majors (Fortnite)', desc: 'Fortnite : les Majors du circuit FNCS (affichés seulement si la clé Osirion est enregistrée ou si des événements sont ajoutés)', game: 'fn' },
  { id: 'fnworld', name: 'Championnat du monde (Fortnite)', desc: 'Fortnite : le Global Championship', game: 'fn' },
  { id: 'fnewc', name: 'Esports World Cup (Fortnite)', desc: 'Fortnite : le tournoi de l\'EWC', game: 'fn' },
  { id: 'lolewc', name: 'Esports World Cup (LoL)', desc: 'League of Legends : le tournoi de l\'EWC (affiché seulement s\'il est publié sur lolesports.com)', game: 'lol' },
  { id: 'lec', name: 'LEC (LoL)', desc: 'League of Legends : le championnat européen (LEC), avec ses splits', game: 'lol' },
];
const COMP_IDS = COMPS.map(c => c.id);
const LANGS = ['FR', 'EN', 'all'];
const CAPS = [0, 1440, 1080, 720, 480, 360];
const DEFAULTS = { cv: 4, comps: [...COMP_IDS], teams: [], players: [], lang: 'FR', score: false, cap: 0, device: '' };

const cleanPseudo = p => String(p || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]/g, '').slice(0, 20);
const cleanDevice = d => String(d || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 24);
const cleanTeam = t => String(t || '').replace(/[\u0000-\u001f<>"]/g, '').trim().slice(0, 40);

function normalize(o = {}) {
  const c = { ...DEFAULTS, comps: [...DEFAULTS.comps], teams: [], players: [] };
  if (Array.isArray(o.comps)) { c.comps = [...new Set(o.comps.map(String).filter(x => COMP_IDS.includes(x)))]; if (!c.comps.length) c.comps = [...DEFAULTS.comps]; }
  if (Array.isArray(o.players)) c.players = [...new Set(o.players.map(x => String(x || '').toLowerCase().replace(/^@/, '')).filter(x => /^[a-z0-9_]{3,25}$/.test(x)))].slice(0, 12);
  if (Array.isArray(o.teams)) c.teams = [...new Set(o.teams.map(cleanTeam).filter(Boolean))].slice(0, 12);
  const cv = Number(o.cv) || 0; // ajouts de compétitions depuis les anciens profils : v2 = LoL, v3 = EWC (LoL), v4 = Fortnite
  if (Array.isArray(o.comps)) for (const [v, ids] of [[2, ['lolw', 'lec']], [3, ['lolewc']], [4, ['fnmajor', 'fnworld', 'fnewc']]]) if (cv < v) for (const x of ids) if (!c.comps.includes(x)) c.comps.push(x);
  c.cv = 4;
  if (LANGS.includes(o.lang)) c.lang = o.lang;
  if (typeof o.score === 'boolean') c.score = o.score;
  if (CAPS.includes(Number(o.cap))) c.cap = Number(o.cap);
  c.device = cleanDevice(o.device);
  return c;
}
const encode = o => Buffer.from(JSON.stringify(normalize(o))).toString('base64url');
function decode(s) { try { return normalize(JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8'))); } catch { return null; } }
const summary = c => c.comps.join('+') + (c.teams.length ? ' ⭐' + c.teams.join(',') : '') + (c.players.length ? ' 🎮' + c.players.join(',') : '') + ' · ' + c.lang + (c.score ? ' · scores' : '');

module.exports = { PSEUDO_RE, COMPS, COMP_IDS, DEFAULTS, CAPS, LANGS, cleanPseudo, cleanDevice, normalize, encode, decode, summary };
