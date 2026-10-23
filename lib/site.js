'use strict';
// Réglages du site (nom, couleur, accès, fonctionnalités, chaînes, équipes) : modifiables depuis le dashboard, gardés dans Upstash.
const store = require('./store');
const prefs = require('./prefs');
const CHANNELS = require('./channels');

const DEF = {
  name: process.env.ADDON_NAME || 'Valorant Esport', color: '#ff4655', title: 'Tous les matchs Valorant, dans Stremio', text: '', credit: '', open: true, code: '', logoV: 0,
  feat: { live: true, relay: true, replays: true, posters: true, logs: true, maint: false, maintMsg: '', capMax: 0, upcoming: 24, doneMax: 60 },
  comps: [...prefs.COMP_IDS],          // compétitions proposées à tous
  extraKeywords: [],                   // mots-clés de ligues en plus (ex. « showmatch »)
  channels: null,                      // liste de chaînes Twitch qui remplace celle par défaut : [{ login, label, lang, role }]
  teamChannels: { KC: [{ login: 'kamet0', label: 'Kameto', lang: 'FR' }] }, // co-streamers par équipe : { CODE: [{ login, label, lang }] }
  teams: null,                         // liste d'équipes proposées qui remplace celle par défaut : [{ code, name }]
  startYear: 2026,
};
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const int = (v, a, b, d) => { const n = Math.round(Number(v)); return n >= a && n <= b ? n : d; };

function clean(o = {}) {
  const f = o.feat && typeof o.feat === 'object' ? o.feat : {}, D = DEF.feat, b = k => (f[k] === undefined ? D[k] : f[k] !== false);
  const c = {
    name: str(o.name, 40) || DEF.name, color: /^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color.toLowerCase() : DEF.color,
    title: str(o.title, 80) || DEF.title, text: str(o.text, 400), credit: str(o.credit, 120), open: o.open !== false, code: str(o.code, 40), logoV: Number(o.logoV) || 0,
    feat: { live: b('live'), relay: b('relay'), replays: b('replays'), posters: b('posters'), logs: b('logs'), maint: f.maint === true, maintMsg: str(f.maintMsg, 160),
      capMax: [0, 1440, 1080, 720, 480].includes(Number(f.capMax)) ? Number(f.capMax) : 0, upcoming: int(f.upcoming, 6, 60, D.upcoming), doneMax: int(f.doneMax, 10, 200, D.doneMax) },
    comps: Array.isArray(o.comps) ? o.comps.filter(x => prefs.COMP_IDS.includes(x)) : [...DEF.comps],
    extraKeywords: Array.isArray(o.extraKeywords) ? o.extraKeywords.map(x => str(x, 30).toLowerCase()).filter(Boolean).slice(0, 12) : [],
    channels: null, teams: null, teamChannels: null, startYear: int(o.startYear, 2020, 2100, DEF.startYear),
  };
  if (!c.comps.length) c.comps = [...DEF.comps];
  if (o.teamChannels && typeof o.teamChannels === 'object' && !Array.isArray(o.teamChannels)) {
    const t = {};
    for (const [code, list] of Object.entries(o.teamChannels).slice(0, 80)) {
      const k = str(code, 8).toUpperCase(); if (!k || !Array.isArray(list)) continue;
      const l = list.map(x => ({ login: str(x && x.login, 25).toLowerCase().replace(/^@/, ''), label: str(x && x.label, 30), lang: x && x.lang === 'EN' ? 'EN' : 'FR' })).filter(x => /^[a-z0-9_]{3,25}$/.test(x.login)).slice(0, 8);
      if (l.length) t[k] = l.map(x => ({ ...x, label: x.label || x.login }));
    }
    c.teamChannels = t;
  } else c.teamChannels = JSON.parse(JSON.stringify(DEF.teamChannels));
  if (Array.isArray(o.channels)) {
    const ch = o.channels.map(x => ({ login: str(x && x.login, 25).toLowerCase().replace(/^@/, ''), label: str(x && x.label, 30), lang: ['FR', 'EN'].includes(x && x.lang) ? x.lang : 'EN', role: x && x.role === 'Officiel' ? 'Officiel' : 'Co-stream' })).filter(x => /^[a-z0-9_]{3,25}$/.test(x.login)).slice(0, 40);
    if (ch.length) c.channels = ch.map(x => ({ ...x, label: x.label || x.login }));
  }
  if (Array.isArray(o.teams)) {
    const t = o.teams.map(x => ({ code: str(x && x.code, 8), name: str(x && x.name, 40) })).filter(x => x.name).slice(0, 60);
    if (t.length) c.teams = t;
  }
  return c;
}
const channelsOf = S => (S && S.channels) || CHANNELS;
const teamChannelsOf = S => (S && S.teamChannels) || DEF.teamChannels;

let cache = null, at = 0;
async function load(force) {
  if (!force && cache && Date.now() - at < 15000) return cache;
  let o = {}; try { const r = await store.getKey('site'); if (r) o = JSON.parse(r); } catch { /* base indisponible : valeurs par défaut */ }
  cache = clean(o); at = Date.now(); return cache;
}
async function save(o) { const cur = await load(true), c = clean({ ...cur, ...o, feat: o.feat ? { ...cur.feat, ...o.feat } : cur.feat, logoV: cur.logoV }); await store.setKey('site', JSON.stringify(c)); cache = c; at = Date.now(); return c; }
async function setLogo(data) {
  const cur = await load(true);
  if (!data) { await store.delKey('logo'); cache = clean({ ...cur, logoV: 0 }); await store.setKey('site', JSON.stringify(cache)); at = Date.now(); return { ok: true, site: cache }; }
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(data)) || data.length > 400000) return { ok: false, error: 'Image refusée (PNG, JPG ou WebP, 300 Ko maximum).' };
  await store.setKey('logo', data); cache = clean({ ...cur, logoV: Date.now() }); await store.setKey('site', JSON.stringify(cache)); at = Date.now();
  return { ok: true, site: cache };
}
module.exports = { load, save, setLogo, clean, channelsOf, teamChannelsOf, DEF };
