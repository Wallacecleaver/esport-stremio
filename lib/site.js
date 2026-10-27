'use strict';
// Réglages du site (nom, couleur, accès, fonctionnalités, chaînes, équipes) : modifiables depuis le dashboard, gardés dans Upstash.
const store = require('./store');
const prefs = require('./prefs');
const CHANNELS = require('./channels');

const DEF = {
  name: process.env.ADDON_NAME || 'Esportio', color: '#ff4655', title: 'Valorant, LoL et Fortnite, dans Stremio', text: '', credit: '', open: true, code: '', logoV: 0,
  feat: { live: true, discover: true, relay: true, replays: true, posters: true, logs: true, maint: false, maintMsg: '', capMax: 0, upcoming: 24, doneMax: 60 },
  comps: [...prefs.COMP_IDS],          // compétitions proposées à tous
  extraKeywords: [],                   // mots-clés de ligues en plus (ex. « showmatch »)
  channels: null,                      // liste de chaînes Twitch qui remplace celle par défaut : [{ login, label, lang, role }]
  teamChannels: { KC: [{ login: 'kamet0', label: 'Kameto', lang: 'FR' }] }, // co-streamers par équipe : { CODE: [{ login, label, lang }] }
  fortnite: { patterns: {}, regions: [], events: [], stats: true, logos: {}, structures: [], suggest: [{ login: 'leothecrack', label: 'Leothecrack', lang: 'FR' }] },  // Fortnite : motifs des compétitions, régions gardées, événements ajoutés à la main
  teams: null,                         // liste d'équipes proposées qui remplace celle par défaut : [{ code, name }]
  startYear: 2026,
};
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const int = (v, a, b, d) => { const n = Math.round(Number(v)); return n >= a && n <= b ? n : d; };

function clean(o = {}) {
  const f = o.feat && typeof o.feat === 'object' ? o.feat : {}, D = DEF.feat, b = k => (f[k] === undefined ? D[k] : f[k] !== false);
  const c = {
    name: (str(o.name, 40) === 'Valorant Esport' ? '' : str(o.name, 40)) || DEF.name, color: /^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color.toLowerCase() : DEF.color,
    title: (['Tous les matchs Valorant, dans Stremio', 'Valorant et LoL, dans Stremio'].includes(str(o.title, 80)) ? '' : str(o.title, 80)) || DEF.title, text: str(o.text, 400), credit: str(o.credit, 120), open: o.open !== false, code: str(o.code, 40), logoV: Number(o.logoV) || 0,
    feat: { live: b('live'), discover: b('discover'), relay: b('relay'), replays: b('replays'), posters: b('posters'), logs: b('logs'), maint: f.maint === true, maintMsg: str(f.maintMsg, 160),
      capMax: [0, 1440, 1080, 720, 480].includes(Number(f.capMax)) ? Number(f.capMax) : 0, upcoming: int(f.upcoming, 6, 60, D.upcoming), doneMax: int(f.doneMax, 10, 200, D.doneMax) },
    comps: Array.isArray(o.comps) ? o.comps.filter(x => prefs.COMP_IDS.includes(x)) : [...DEF.comps],
    extraKeywords: Array.isArray(o.extraKeywords) ? o.extraKeywords.map(x => str(x, 30).toLowerCase()).filter(Boolean).slice(0, 12) : [],
    channels: null, teams: null, teamChannels: null, startYear: int(o.startYear, 2020, 2100, DEF.startYear),
  };
  const cv = Number(o.compsV) || 0; // v2 = LoL ajouté, v3 = EWC (LoL)
  for (const [v, ids] of [[2, ['lolw', 'lec']], [3, ['lolewc']], [4, ['fnmajor', 'fnworld', 'fnewc']]]) if (cv < v) for (const x of ids) if (!c.comps.includes(x)) c.comps.push(x);
  c.compsV = 4;
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
    const ch = o.channels.map(x => ({ login: str(x && x.login, 25).toLowerCase().replace(/^@/, ''), label: str(x && x.label, 30), lang: ['FR', 'EN'].includes(x && x.lang) ? x.lang : 'EN', role: x && x.role === 'Officiel' ? 'Officiel' : 'Co-stream', game: ['lol', 'fn'].includes(x && x.game) ? x.game : 'val', off: !!(x && x.off) })).filter(x => /^[a-z0-9_]{3,25}$/.test(x.login)).slice(0, 40);
    if (ch.length) c.channels = ch.map(x => ({ ...x, label: x.label || x.login }));
  }
  { // noms, descriptions et logos des compétitions + noms des catalogues généraux (réglés dans l'onglet Jeux)
    const cm = {}, src = o.compMeta && typeof o.compMeta === 'object' && !Array.isArray(o.compMeta) ? o.compMeta : {};
    for (const id of prefs.COMP_IDS) { const x = src[id]; if (!x || typeof x !== 'object') continue; const v = { name: str(x.name, 40), desc: str(x.desc, 200), logo: /^https:\/\//.test(str(x.logo, 300)) ? str(x.logo, 300) : '' }; if (v.name || v.desc || v.logo) cm[id] = v; }
    c.compMeta = cm;
    const cn = {}, sn = o.catNames && typeof o.catNames === 'object' ? o.catNames : {};
    for (const k of ['live', 'team', 'replays']) { const v = str(sn[k], 40); if (v) cn[k] = v; }
    c.catNames = cn;
  }
  { // Fortnite
    const F = o.fortnite && typeof o.fortnite === 'object' ? o.fortnite : {}, pat = {};
    for (const k of ['fnmajor', 'fnworld', 'fnewc']) { const v = str(F.patterns && F.patterns[k], 80); if (v) { try { new RegExp(v); pat[k] = v; } catch { /* motif invalide */ } } }
    const ev = (Array.isArray(F.events) ? F.events : []).slice(0, 30).map(e => ({
      id: str(e && e.id, 40) || Math.random().toString(36).slice(2, 8), comp: ['fnmajor', 'fnworld', 'fnewc'].includes(e && e.comp) ? e.comp : 'fnmajor', name: str(e && e.name, 60), logo: /^https:\/\//.test(e && e.logo || '') ? str(e.logo, 300) : '',
      channels: (Array.isArray(e && e.channels) ? e.channels : []).map(x => str(x, 25).toLowerCase().replace(/^@/, '')).filter(x => /^[a-z0-9_]{3,25}$/.test(x)).slice(0, 8),
      sessions: (Array.isArray(e && e.sessions) ? e.sessions : []).slice(0, 30).map(s => ({ name: str(s && s.name, 40), stage: str(s && s.stage, 30), start: str(s && s.start, 25), end: str(s && s.end, 25) })).filter(s => s.start),
    })).filter(e => e.name && e.sessions.length);
    const logos = {}; for (const k of ['fnmajor', 'fnworld', 'fnewc']) { const v = str(F.logos && F.logos[k], 300); if (/^https:\/\//.test(v)) logos[k] = v; }
    const sg = F.suggest === undefined ? DEF.fortnite.suggest : (Array.isArray(F.suggest) ? F.suggest : []).slice(0, 20).map(x => ({ login: str(x && x.login, 25).toLowerCase().replace(/^@/, ''), label: str(x && x.label, 30), lang: x && x.lang === 'EN' ? 'EN' : 'FR' })).filter(x => /^[a-z0-9_]{3,25}$/.test(x.login)).map(x => ({ ...x, label: x.label || x.login }));
    const stc = F.structures === undefined ? DEF.fortnite.structures : (Array.isArray(F.structures) ? F.structures : []).slice(0, 30).map(x => ({ name: str(x && x.name, 40), logo: /^https:\/\//.test(str(x && x.logo, 300)) ? str(x.logo, 300) : '', channels: (Array.isArray(x && x.channels) ? x.channels : []).slice(0, 8).map(h => ({ login: str(h && h.login, 25).toLowerCase().replace(/^@/, ''), label: str(h && h.label, 30), lang: h && h.lang === 'EN' ? 'EN' : 'FR' })).filter(h => /^[a-z0-9_]{3,25}$/.test(h.login)).map(h => ({ ...h, label: h.label || h.login })) })).filter(x => x.name);
    c.fortnite = { logos, suggest: sg, structures: stc, patterns: pat, regions: (Array.isArray(F.regions) ? F.regions : []).map(x => str(x, 8).toUpperCase()).filter(x => /^[A-Z]{2,6}$/.test(x)).slice(0, 10), events: ev, stats: F.stats !== false };
  }
  if (Array.isArray(o.teams)) {
    const t = o.teams.map(x => ({ code: str(x && x.code, 8), name: str(x && x.name, 40), games: Array.isArray(x && x.games) ? x.games.filter(g => g === 'val' || g === 'lol') : [] })).filter(x => x.name).slice(0, 60);
    if (t.length) c.teams = t;
  }
  return c;
}
// chaînes surveillées (Valorant + LoL) ; une liste personnalisée sans aucune chaîne LoL reçoit celles par défaut
const channelsAll = S => { let c = S && S.channels; if (!c) return CHANNELS; if (!c.some(x => x.game === 'lol')) c = c.concat(CHANNELS.LOL); if (!c.some(x => x.game === 'fn')) c = c.concat(CHANNELS.FN); return c; };
const channelsOf = S => channelsAll(S).filter(c => !c.off);   // sans les chaînes désactivées
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
module.exports = { load, save, setLogo, clean, channelsOf, channelsAll, teamChannelsOf, DEF };
