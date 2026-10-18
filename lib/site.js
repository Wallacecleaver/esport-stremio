'use strict';
// Réglages du site (nom, couleur, textes, accès, jeux activés, ligues LoL) : modifiables depuis le dashboard, gardés dans Upstash.
const store = require('./store');
const games = require('./games');

const DEF = {
  name: process.env.ADDON_NAME || 'Esport', color: '#00c8c8', title: 'L\'esport, dans Stremio', text: '', banner: '', open: true, code: '',
  feat: { games: Object.fromEntries(games.ORDER.map(g => [g, games.GAMES[g].ready])), leagues: ['worlds', 'msi', 'first_stand', 'lck'], upcoming: 24, past: 0, years: true, logs: true, maint: false, maintMsg: '', channels: {}, offRelays: [], timeout: 2500 },
};
const LOGIN = /^[a-z0-9_]{3,25}$/;
// Chaînes modifiées dans le dashboard : { jeu: [{ login, label, lang, role }] } ; un jeu absent garde la liste par défaut.
function cleanChannels(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  for (const g of games.ORDER) {
    if (!Array.isArray(v[g])) continue;
    out[g] = v[g].map(c => ({ login: String(c && c.login || '').toLowerCase().replace(/^.*twitch\.tv\//, '').trim(), label: String(c && c.label || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 30), lang: ['FR', 'EN'].includes(String(c && c.lang).toUpperCase()) ? String(c.lang).toUpperCase() : 'EN', role: c && c.role === 'Officiel' ? 'Officiel' : 'Co-stream' }))
      .filter(c => LOGIN.test(c.login)).map(c => ({ ...c, label: c.label || c.login })).slice(0, 25);
  }
  return out;
}
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

function clean(o = {}) {
  const f = o.feat && typeof o.feat === 'object' ? o.feat : {}, D = DEF.feat;
  const gm = {}; for (const g of games.ORDER) gm[g] = games.GAMES[g].ready && (f.games && f.games[g] !== undefined ? f.games[g] !== false : D.games[g]);
  const num = (v, d, lo, hi) => { const n = Math.round(Number(v)); return n >= lo && n <= hi ? n : d; };
  return {
    name: str(o.name, 40) || DEF.name, color: /^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color.toLowerCase() : DEF.color,
    title: str(o.title, 80) || DEF.title, text: str(o.text, 400), banner: str(o.banner, 200), open: o.open !== false, code: str(o.code, 40),
    feat: {
      games: gm, leagues: Array.isArray(f.leagues) ? f.leagues.map(x => str(x, 40).toLowerCase()).filter(Boolean).slice(0, 30) : D.leagues,
      upcoming: num(f.upcoming, D.upcoming, 6, 60), past: num(f.past, D.past, 0, 40), years: f.years !== false,
      channels: cleanChannels(f.channels), logs: f.logs !== false, maint: f.maint === true, maintMsg: str(f.maintMsg, 160),
      offRelays: Array.isArray(f.offRelays) ? f.offRelays.map(x => str(x, 60)).filter(Boolean).slice(0, 60) : [], timeout: num(f.timeout, D.timeout, 1000, 8000),
    },
  };
}
let cache = null, at = 0;
async function load(force) {
  if (!force && cache && Date.now() - at < 15000) return cache;
  let o = {}; try { const r = await store.getKey('site'); if (r) o = JSON.parse(r); } catch { /* base indisponible : valeurs par défaut */ }
  cache = clean(o); at = Date.now(); return cache;
}
async function save(o) {
  const cur = await load(true);
  const c = clean({ ...cur, ...o, feat: o.feat ? { ...cur.feat, ...o.feat, games: { ...cur.feat.games, ...(o.feat.games || {}) } } : cur.feat });
  await store.setKey('site', JSON.stringify(c)); cache = c; at = Date.now(); return c;
}
module.exports = { load, save, clean, cleanChannels, DEF };
