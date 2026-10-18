'use strict';
/*
 * Addon Stremio « Esport » — matchs, lives Twitch et rediffusions (LoL pour l'instant ; Valorant, Rocket League, Fortnite, CoD ensuite).
 *
 *   /manifest.json                       manifeste (catalogues selon les jeux choisis)
 *   /catalog/tv/esport-live.json         en direct & à venir        (affiches de match)
 *   /catalog/tv/esport-fav.json          ⭐ Mon équipe
 *   /catalog/series/esport-<jeu>-<an>.json   catalogue annuel : série « <Jeu> <année> », saison = événement, épisode = match
 *   /meta/…  /stream/…                   fiches et sources (lives Twitch, rediffs Twitch)
 *   /img/…                               affiches générées
 *   /p/<chaîne>.m3u8                     live Twitch sans pub (relais) ; /r/<morceaux>.m3u8 : rediff découpée sur le match
 *   /config  /admin                      configuration (profils) et dashboard
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');
const siteLib = require('./lib/site');
const prefs = require('./lib/prefs');
const games = require('./lib/games');
const channelsDef = require('./lib/channels');
const model = require('./lib/model');
const poster = require('./lib/poster');
const replay = require('./lib/replay');
const hls = require('./lib/hls');
const tw = require('./lib/twitch');
const makeAdmin = require('./lib/admin');
const { cached, withTimeout } = require('./lib/cache');

const PORT = process.env.PORT || 7000;
const START_YEAR = 2026;
const SCHEDULE_TTL = 3 * 60e3;

const send = (res, code, type, body, h = {}) => { res.writeHead(code, { 'Content-Type': type, ...h }); res.end(body); };
const json = (res, o, h) => send(res, 200, 'application/json; charset=utf-8', JSON.stringify(o), { 'Cache-Control': 'no-store', ...h });
const originOf = req => 'https://' + String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
const extraOf = e => new URLSearchParams(String(e || '').replace(/\.json$/, ''));
const strip = s => String(s || '').replace(/\.json$/, '');
const readBody = (req, max = 2e4) => new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > max) req.destroy(); }); req.on('end', () => r(b)); });
const asset = name => fs.readFileSync(path.join(__dirname, 'lib', 'pages', name), 'utf8');
const pageCache = {};
const page = name => (pageCache[name] ||= asset(name));

/* ------------------------------------------------------------------ données : matchs par jeu */
// Le calendrier est lu chez la source officielle, gardé en mémoire (3 min) et dans Upstash (partagé entre les instances Vercel).
async function fetchSchedule(gameId, SS) {
  const g = games.mod(gameId);
  if (!g) return [];
  try {
    const raw = await store.getKey('sched:' + gameId);
    if (raw) { const o = JSON.parse(raw); if (o && Date.now() - o.t < SCHEDULE_TTL - 30e3 && Array.isArray(o.m)) return o.m; }
  } catch { /* pas de copie partagée : on interroge la source */ }
  let m = await g.matches({ leagues: SS.feat.leagues, valKeywords: SS.feat.valKeywords, fnRegions: SS.feat.fnRegions, fnKeywords: SS.feat.fnKeywords, fnExclude: SS.feat.fnExclude });
  if (g.accumulate) m = await withHistory(gameId, m); // la source ne garde que peu de matchs terminés : on les garde nous-mêmes
  store.setKey('sched:' + gameId, JSON.stringify({ t: Date.now(), m })).catch(() => {});
  return m;
}
// Historique : les matchs vus une fois restent (année >= START_YEAR) ; un match disparu de la source est considéré terminé.
async function withHistory(gameId, fresh) {
  let old = [];
  try { const r = await store.getKey('hist2:' + gameId); if (r) old = JSON.parse(r); } catch { /* pas d'historique */ }
  const now = Date.now(), by = new Map();
  for (const o of old) if (o && o.raw && o.year >= START_YEAR) by.set(o.raw, o.state === 'done' || now - o.startTime > 12 * 3600e3 ? { ...o, state: 'done' } : o);
  for (const f of fresh) by.set(f.raw, f);
  const all = [...by.values()].sort((a, b) => a.startTime - b.startTime).slice(-2500);
  store.setKey('hist2:' + gameId, JSON.stringify(all)).catch(() => {});
  return all;
}
async function matchesOf(gameId, SS) {
  if (!games.get(gameId) || !games.get(gameId).ready || SS.feat.games[gameId] === false) return [];
  try { return await withTimeout(cached('m:' + gameId, SCHEDULE_TTL, () => fetchSchedule(gameId, SS)), 9000, []); } catch { return []; }
}
async function allMatches(gameIds, SS) { return (await Promise.all(gameIds.map(g => matchesOf(g, SS)))).flat(); }
async function findMatch(key, SS) {
  const k = model.parseKey(key);
  if (!k) return null;
  const list = await matchesOf(k.game, SS);
  return list.find(m => m.raw === k.raw) || null;
}
const enabledGames = (cfg, SS) => cfg.games.filter(g => games.get(g) && games.get(g).ready && SS.feat.games[g] !== false);
const yearsOf = SS => { const now = model.yearOf(Date.now()), out = []; for (let y = now; y >= START_YEAR; y--) { out.push(y); if (!SS.feat.years) break; } return out.length ? out : [START_YEAR]; };

/* ------------------------------------------------------------------ fiches (meta) */
const stateTag = m => (m.state === 'live' ? 'l' : m.state === 'done' ? 'd' : 'u');
function imgUrl(origin, m, cfg, kind, fav) {
  const sc = m.teams.map(t => (t.score == null ? '' : t.score)).join('-');
  return origin + '/img/m/' + encodeURIComponent(model.keyOf(m)) + '.png?k=' + kind + '&s=' + stateTag(m) + '&t=' + Math.floor(m.startTime / 60000).toString(36) + (fav ? '&f=1' : '') + (cfg.score && m.state === 'done' ? '&sp=1&c=' + sc : m.state === 'live' ? '&c=' + sc : '');
}
const statusLabel = m => (m.state === 'live' ? (m.allDay ? '🔴 Aujourd\'hui' : '🔴 En direct') : m.state === 'done' ? '📼 Rediffusion' : '🕒 ' + (m.allDay ? model.fmtDay(m.startTime) : model.fmtDate(m.startTime)));

function matchMeta(m, cfg, origin, favs) {
  const g = games.get(m.game), fav = model.hasTeam(m, favs), [a, b] = model.teamsOf(m);
  return {
    id: 'esp:m:' + model.keyOf(m), type: 'tv', name: (fav ? '⭐ ' : '') + model.matchTitle(m),
    poster: imgUrl(origin, m, cfg, 'poster', fav), posterShape: 'poster', background: imgUrl(origin, m, cfg, 'thumb', fav),
    description: [m.solo ? m.event.name : `${a.name} contre ${b.name}`, [m.event.name, m.stage, m.bestOf ? 'BO' + m.bestOf : ''].filter(Boolean).join(' · '), (m.allDay ? model.fmtDay(m.startTime) : model.fmtDate(m.startTime) + ' (heure de Paris)'), statusLabel(m), '', 'Ouvre la fiche pour voir les sources : lives Twitch, puis rediffusions.'].join('\n'),
    releaseInfo: m.state === 'live' ? '🔴 En direct' : m.allDay ? model.fmtDay(m.startTime) : model.fmtDate(m.startTime), genres: [g.name],
  };
}

// Série annuelle : saison = événement, épisode = match.
function seriesMeta(gameId, year, matches, cfg, origin, favs, withVideos) {
  const g = games.get(gameId), seasons = model.seasonsOf(matches, year);
  const m = {
    id: 'esp:s:' + gameId + ':' + year, type: 'series', name: g.name + ' ' + year, poster: origin + '/img/s/' + gameId + '-' + year + '.png', posterShape: 'poster',
    background: origin + '/img/s/' + gameId + '-' + year + '.png', releaseInfo: String(year), genres: [g.name],
    description: seasons.length ? seasons.map(s => 'Saison ' + s.n + ' : ' + s.event.name).join('\n') + '\n\nChaque épisode est un match : lives Twitch en direct, rediffusion ensuite.' : 'Aucun match pour le moment : le calendrier apparaît dès que les événements sont annoncés.',
  };
  if (!withVideos) return m;
  m.videos = [];
  for (const s of seasons) s.matches.forEach((mm, i) => {
    const fav = model.hasTeam(mm, favs);
    m.videos.push({
      id: 'esp:v:' + model.keyOf(mm), title: (fav ? '⭐ ' : '') + (mm.solo ? model.matchTitle(mm) : [s.event.name, mm.stage].filter(Boolean).join(' · ') + ' · ' + model.matchTitle(mm)), season: s.n, episode: i + 1,
      released: new Date(mm.startTime).toISOString(), thumbnail: imgUrl(origin, mm, cfg, 'thumb', fav), overview: [statusLabel(mm), mm.allDay ? model.fmtDay(mm.startTime) : model.fmtDate(mm.startTime), mm.bestOf ? 'BO' + mm.bestOf : ''].filter(Boolean).join(' · '),
    });
  });
  return m;
}

/* ------------------------------------------------------------------ sources (streams) */
const langRank = (cfg, lang) => (cfg.lang === 'all' ? 0 : lang === cfg.lang ? 0 : 1);
const fmtN = n => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' M' : n >= 1000 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace('.', ',') + ' k' : String(n));
const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1).trimEnd() + '…' : String(t));

const chansOf = (game, F) => (F && F.channels && F.channels[game]) || channelsDef[game] || [];

async function liveSources(m, cfg, origin, base, F) {
  const list = chansOf(m.game, F).slice();
  for (const l of m.streams || []) if (!list.some(c => c.login === l)) list.unshift({ login: l, label: l, lang: 'EN', role: 'Officiel' });
  const st = await withTimeout(tw.liveStatuses(list.map(c => c.login)).catch(() => ({})), 3500, {});
  const live = list.map((c, i) => ({ c, i, s: st[c.login] })).filter(x => x.s && x.s.live)
    .sort((a, b) => langRank(cfg, a.c.lang) - langRank(cfg, b.c.lang) || b.s.viewers - a.s.viewers || a.i - b.i);
  return live.map(({ c, s }) => ({
    name: c.label + '\n' + c.lang,
    title: ['🔴 En direct · ' + fmtN(s.viewers) + ' 👁', '📺 ' + c.role + ' · ' + c.lang, cfg.relay ? '🚫 Sans pub' : '⚠️ Avec pubs'].join('\n'),
    url: origin + base + '/p/' + c.login + '.m3u8',
  }));
}

async function replaySources(m, cfg, origin, base, F) {
  const g = games.mod(m.game), out = [], used = new Set();
  const entry = (label, lang, parts, official) => ({
    name: label + '\n' + lang, title: ['📼 Rediffusion · ' + lang, official ? '✅ Flux officiel' : '📺 Chaîne du streamer', '⏱ Match complet'].join('\n'),
    url: origin + base + '/r/' + replay.encodeParts(parts) + '.m3u8', _lang: lang,
  });
  if (g && g.replays) {
    try {
      const official = await withTimeout(g.replays(m), 7000, []);
      await Promise.all(official.map(async o => {
        const info = await withTimeout(tw.videoInfo(o.parts[0].v).catch(() => null), 3000, null);
        const label = info && info.name ? info.name : o.lang === 'FR' ? 'Rediff FR' : 'Rediff ' + o.lang;
        if (info && info.login) used.add(info.login);
        out.push(entry(label, o.lang, o.parts, true));
      }));
    } catch { /* source officielle indisponible : on cherche dans les rediffs des chaînes */ }
  }
  // chaînes sans vidéo officielle : on retrouve le match dans leurs rediffs à partir de l'heure
  const span = replay.spanOf(m);
  const extra = chansOf(m.game, F).filter(c => !used.has(c.login));
  const found = await withTimeout(Promise.all(extra.map(async c => ({ c, parts: await replay.archiveParts(c.login, span).catch(() => []) }))), 6500, []);
  for (const { c, parts } of found) if (parts.length) out.push(entry(c.label, c.lang, parts, false));
  return out.sort((a, b) => langRank(cfg, a._lang) - langRank(cfg, b._lang) || (a.title.includes('officiel') ? 0 : 1) - (b.title.includes('officiel') ? 0 : 1)).map(({ _lang, ...s }) => s);
}

async function streamsFor(m, cfg, origin, base, F) {
  const info = (title, name = 'Esport') => ({ name, title, externalUrl: origin + '/config' });
  let live = [], reps = [];
  // lives : pendant le match, ou dans les 45 min avant (avant-match) ; un match lointain n'affiche pas les lives d'un autre match
  if (m.state === 'live' || (m.state === 'upcoming' && m.startTime - Date.now() < 45 * 60e3)) live = await liveSources(m, cfg, origin, base, F);
  if (m.state === 'done') reps = await replaySources(m, cfg, origin, base, F);
  if (live.length || reps.length) return [...live, ...reps];
  if (m.state === 'done') return [info('📼 Rediffusion pas\nencore disponible\n(le live vient de\nse terminer ?)', '⏳ Bientôt')];
  if (m.state === 'live') return [info('Aucune chaîne en\ndirect pour ce match\nréessaie dans\nquelques minutes', '🔴 Live')];
  return [info('🕒 ' + model.fmtDate(m.startTime) + '\n(heure de Paris)\nLes lives\napparaissent ici\nau démarrage', '⏳ À venir')];
}

/* ------------------------------------------------------------------ manifeste */
const BASE_MANIFEST = {
  id: 'community.esport.stremio', version: '0.1.0', name: 'Esport', description: 'Matchs d\'esport dans Stremio : calendrier, lives Twitch (FR/EN) et rediffusions sans spoiler.',
  resources: ['catalog', 'meta', 'stream'], types: ['tv', 'series'], idPrefixes: ['esp:'], behaviorHints: { configurable: true, configurationRequired: false }, catalogs: [],
};
function manifestFor(cfg, SS, origin) {
  const gs = enabledGames(cfg, SS), favs = prefs.favTeams(cfg);
  const cats = [{ type: 'tv', id: 'esport-live', name: SS.name + ' · En direct & à venir', extra: gs.length > 1 ? [{ name: 'genre', isRequired: false, options: gs.map(g => games.get(g).name) }] : [] }];
  if (favs.length) cats.push({ type: 'tv', id: 'esport-fav', name: '⭐ Mon équipe', extra: [] });
  for (const g of gs) for (const y of yearsOf(SS)) cats.push({ type: 'series', id: 'esport-' + g + '-' + y, name: games.get(g).name + ' ' + y, extra: [] });
  return { ...BASE_MANIFEST, name: SS.name, logo: origin + '/logo.png', background: origin + '/img/s/' + (gs[0] || 'lol') + '-' + model.yearOf(Date.now()) + '.png', catalogs: cats };
}

/* ------------------------------------------------------------------ profils (Upstash) */
const ID_RE = /^[A-Za-z0-9_-]{16,40}$/;
async function loadProfile(id) {
  try { const raw = await store.getKey('p:' + id); if (!raw) return null; const p = JSON.parse(raw); return { pseudo: prefs.cleanPseudo(p.pseudo), cfg: prefs.normalize(p.cfg), pw: typeof p.pw === 'string' ? p.pw : '' }; } catch { return null; }
}
const pwHash = pw => { const salt = crypto.randomBytes(16); return salt.toString('base64url') + ':' + crypto.scryptSync(String(pw), salt, 32).toString('base64url'); };
const pwCheck = (pw, h) => { try { const [s, k] = String(h).split(':'), a = crypto.scryptSync(String(pw), Buffer.from(s, 'base64url'), 32), b = Buffer.from(k, 'base64url'); return a.length === b.length && crypto.timingSafeEqual(a, b); } catch { return false; } };
const fails = new Map();
const locked = id => { const f = fails.get(id); return !!f && f.n >= 8 && Date.now() - f.t < 600000; };
const failed = id => { const f = fails.get(id), now = Date.now(); fails.set(id, f && now - f.t < 600000 ? { n: f.n + 1, t: f.t } : { n: 1, t: now }); if (fails.size > 500) fails.clear(); };
const hits = new Map();
function tooMany(req) { // 40 demandes par minute et par adresse sur l'API des profils
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x', now = Date.now(), h = hits.get(ip);
  if (!h || now - h.t > 60000) hits.set(ip, { n: 1, t: now }); else h.n++;
  if (hits.size > 500) hits.clear();
  return (hits.get(ip).n) > 40;
}
async function profileApi(req) {
  if (tooMany(req)) return { ok: false, error: 'trop de demandes, réessaie dans une minute' };
  if (req.method === 'GET') {
    const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
    if (!id) return { ok: true, persistent: store.persistent };
    if (!ID_RE.test(id)) return { ok: false, error: 'Lien inconnu' };
    const p = await loadProfile(id);
    if (!p) return { ok: false, error: 'Profil introuvable' };
    return p.pw ? { ok: true, persistent: store.persistent, locked: true } : { ok: true, persistent: store.persistent, locked: false, nopw: true, pseudo: p.pseudo, cfg: p.cfg };
  }
  if (!store.persistent) return { ok: false, persistent: false, error: 'La base de données n\'est pas configurée : utilise le lien classique.' };
  let b = {}; try { b = JSON.parse(await readBody(req)); } catch { return { ok: false, error: 'requête invalide' }; }
  const id0 = String(b.id || ''), pw = String(b.password || '').slice(0, 100), npw = String(b.newPassword || '').slice(0, 100);
  let old = null;
  if (id0) {
    if (!ID_RE.test(id0) || !(old = await loadProfile(id0))) return { ok: false, error: 'Profil introuvable' };
    if (old.pw) {
      if (locked(id0)) return { ok: false, error: 'Trop d\'essais : réessaie dans 10 minutes.' };
      if (!pwCheck(pw, old.pw)) { failed(id0); return { ok: false, bad: true, error: 'Mot de passe incorrect' }; }
    }
    if (b.action === 'open') return { ok: true, pseudo: old.pseudo, cfg: old.cfg, nopw: !old.pw };
  }
  if (!id0) {
    const S = await siteLib.load();
    if (!S.open) return { ok: false, error: 'Les inscriptions sont fermées pour le moment.' };
    if (S.code && String(b.code || '').trim() !== S.code) return { ok: false, bad: 'code', error: 'Code d\'invitation incorrect' };
  }
  if ((!old || !old.pw) && npw.length < 6) return { ok: false, error: 'Choisis un mot de passe d\'au moins 6 caractères' };
  if (npw && npw.length < 6) return { ok: false, error: 'Mot de passe : 6 caractères minimum' };
  const pseudo = prefs.cleanPseudo(b.pseudo);
  if (pseudo.length < 2) return { ok: false, error: 'Pseudo trop court (2 caractères minimum)' };
  const cfg = prefs.normalize(b.cfg), id = id0 || crypto.randomBytes(16).toString('base64url');
  await store.setKey('p:' + id, JSON.stringify({ pseudo, cfg, pw: npw ? pwHash(npw) : old.pw, maj: Date.now() }));
  store.log({ k: 'config', u: pseudo, reglages: prefs.summary(cfg), action: id0 ? 'modifiée' : 'créée' });
  return { ok: true, id, pseudo };
}

/* ------------------------------------------------------------------ diagnostic */
async function checkSources(SS) {
  const timed = async f => { const t = Date.now(); try { return { ok: true, ms: Date.now() - t, ...(await f()) }; } catch (e) { return { ok: false, ms: Date.now() - t, err: String(e.message).slice(0, 140) }; } };
  const out = { stockage: store.persistent, affiches: poster.available() };
  out.twitch = await timed(async () => { const r = await tw.liveStatuses(['riotgames']); return { riotgames: r.riotgames && r.riotgames.live ? 'en direct' : 'hors ligne' }; });
  const lp = require('./lib/liquipedia');
  out.valorant_officiel = await timed(async () => { const l = await games.mod('valorant').official(); return { matchs: l.length, evenements: [...new Set(l.map(m => m.event.name))].length }; });
  out.liquipedia_valorant = await Promise.all(['Liquipedia:Upcoming_and_ongoing_matches', 'Liquipedia:Matches', 'Matches'].map(t => lp.inspect('valorant', t)));
  out.fortnite_osirion = await timed(async () => { const l = await games.mod('fortnite').official({ regions: SS.feat.fnRegions, keywords: SS.feat.fnKeywords, exclude: SS.feat.fnExclude }); return { sessions: l.length, tournois: [...new Set(l.map(m => m.event.name))].length }; });
  out.liquipedia_rocketleague = await Promise.all(['Liquipedia:Matches'].map(t => lp.inspect('rocketleague', t)));
  out.liquipedia_fortnite = await Promise.all(['Portal:Tournaments', 'Tournaments'].map(t => lp.inspect('fortnite', t)));
  for (const g of games.readyIds()) out[g] = await timed(async () => { const list = await games.mod(g).matches({ leagues: SS.feat.leagues, valKeywords: SS.feat.valKeywords, fnRegions: SS.feat.fnRegions, fnKeywords: SS.feat.fnKeywords, fnExclude: SS.feat.fnExclude }); return { matchs: list.length, evenements: [...new Set(list.map(m => m.event.name))].length }; });
  return out;
}

/* ------------------------------------------------------------------ routeur */
const adminRoute = makeAdmin({
  send, json,
  sources: async () => checkSources(await siteLib.load(true)),
  extra: async () => ({ games: games.list().map(g => ({ id: g.id, name: g.name, ready: g.ready })), chanDef: channelsDef }),
});

async function handler(req, res) {
  let pseudo = '';
  try {
    let seg = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean).map(decodeURIComponent);
    let cfg = prefs.DEFAULTS, base = '';
    if (seg[0] === 'c' && seg.length >= 3) { pseudo = prefs.cleanPseudo(seg[1]); cfg = prefs.decode(seg[2]) || prefs.DEFAULTS; base = '/c/' + encodeURIComponent(seg[1]) + '/' + seg[2]; seg = seg.slice(3); }
    if (seg[0] === 'u' && ID_RE.test(seg[1] || '')) {
      if (!seg[2]) return send(res, 302, 'text/plain', '', { Location: '/u/' + seg[1] + '/configure' });
      if (seg[2] !== 'configure') {
        const p = await loadProfile(seg[1]);
        if (!p) return send(res, 404, 'text/plain; charset=utf-8', 'Profil introuvable : crée un nouveau lien sur /config');
        pseudo = p.pseudo; cfg = p.cfg; base = '/u/' + seg[1];
      }
      seg = seg.slice(2);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (await adminRoute(req, res, seg)) return;
    const SS = await siteLib.load(), F = SS.feat;
    store.setLog(F.logs); tw.setFeat({ timeout: F.timeout, offRelays: F.offRelays });
    const origin = originOf(req), end = res.end.bind(res);
    res.end = (...a) => { store.flush().finally(() => end(...a)); return res; }; // Vercel coupe le travail après la réponse : on attend l'enregistrement des stats
    const dev = store.deviceId(req), t0 = Date.now();
    store.incr('req'); store.incr('d:' + store.day() + ':req');
    if (['stream', 'catalog', 'manifest.json'].includes(seg[0])) store.uniq(dev);
    const maint = () => json(res, { streams: [{ name: '⚠️ Maintenance', title: F.maintMsg || 'Addon en maintenance, réessaie un peu plus tard.', externalUrl: origin + '/config' }] });

    if (!seg.length) return send(res, 302, 'text/plain', '', { Location: '/config' });
    if (seg[0] === 'config' || seg[0] === 'configure') return send(res, 200, 'text/html; charset=utf-8', page('config.html').replace(/\{\{NAME\}\}/g, SS.name).replace(/\{\{COLOR\}\}/g, SS.color).replace('{{TITLE}}', SS.title).replace('{{TEXT}}', SS.text).replace('{{BANNER}}', SS.banner), { 'Cache-Control': 'no-cache' });
    if (seg[0] === 'api' && seg[1] === 'profile') return json(res, await profileApi(req));
    if (seg[0] === 'api' && seg[1] === 'games') return json(res, { games: games.list().map(g => ({ id: g.id, name: g.name, short: g.short, color: g.color, ready: g.ready && F.games[g.id] !== false })), open: SS.open, code: !!SS.code, persistent: store.persistent }, { 'Cache-Control': 'public, max-age=60' });
    if (seg[0] === 'api' && seg[1] === 'teams') { // équipes d'un jeu (pour choisir ses favorites dans /config)
      const g = String(new URL(req.url, 'http://x').searchParams.get('game') || '');
      const list = await matchesOf(g, SS), by = new Map();
      for (const m of list) for (const t of m.teams) if (t.code && t.code !== 'TBD' && !by.has(t.code)) by.set(t.code, { code: t.code, name: t.name, logo: t.logo });
      return json(res, { teams: [...by.values()].sort((a, b) => a.name.localeCompare(b.name)) }, { 'Cache-Control': 'public, max-age=300' });
    }
    if (seg[0] === 'check') return json(res, await checkSources(SS));
    if (seg[0] === 'logo.png') { try { return send(res, 200, 'image/png', await poster.renderIcon(SS.color), { 'Cache-Control': 'public, max-age=86400' }); } catch { return send(res, 404, 'text/plain', 'Logo indisponible'); } }

    if (seg[0] === 'manifest.json') {
      store.log({ k: 'install', u: pseudo || undefined, appareil: cfg.device || undefined, reglages: pseudo ? prefs.summary(cfg) : 'défaut', dev });
      store.user(pseudo, { cfg, dev: cfg.device });
      const mf = manifestFor(cfg, SS, origin);
      return json(res, pseudo ? { ...mf, name: SS.name + ' · ' + pseudo } : mf);
    }

    // ----- affiches
    if (seg[0] === 'img' && seg[1]) {
      const q = new URL(req.url, 'http://x').searchParams;
      try {
        if (seg[1] === 's') { // série annuelle : /img/s/<jeu>-<année>.png
          const m = /^([a-z]+)-(\d{4})\.png$/.exec(seg[2] || ''), g = m && games.get(m[1]);
          if (!g) return send(res, 404, 'text/plain', 'Introuvable');
          return send(res, 200, 'image/png', await poster.renderSeries(g, m[2]), { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' });
        }
        if (seg[1] === 'm') { // match : /img/m/<jeu~id>.png?k=poster|thumb
          const key = strip(String(seg[2] || '').replace(/\.png$/, '')), m = await findMatch(key, SS);
          if (!m) return send(res, 404, 'text/plain', 'Match introuvable');
          const png = await (m.solo ? poster.renderEvent : poster.renderMatch)(m, games.get(m.game), { kind: q.get('k') === 'thumb' ? 'thumb' : 'poster', fav: q.get('f') === '1', showScore: q.get('sp') === '1' });
          return send(res, 200, 'image/png', png, { 'Cache-Control': 'public, max-age=' + (m.state === 'done' ? 86400 : 60) + ', s-maxage=' + (m.state === 'done' ? 86400 : 60) });
        }
      } catch (e) { store.log({ k: 'erreur', ou: 'affiche', msg: e.message }); return send(res, 500, 'text/plain', 'Affiche indisponible'); }
      return send(res, 404, 'text/plain', 'Introuvable');
    }

    // ----- lectures : live sans pub et rediffusion découpée
    if (seg[0] === 'p' && seg[1]) {
      const login = strip(seg[1]).replace(/\.m3u8$/, '').toLowerCase();
      if (!tw.LOGIN_RE.test(login)) return send(res, 400, 'text/plain; charset=utf-8', 'Nom de chaîne invalide');
      if (F.maint) return send(res, 503, 'text/plain; charset=utf-8', 'Addon en maintenance');
      const b = cfg.relay ? await tw.bestProxy(login, false) : null;
      store.incr('play'); store.top(login); store.user(pseudo, { ch: login, dev: cfg.device });
      store.log({ k: 'play', u: pseudo || undefined, ch: login, relais: b ? b.name : cfg.relay ? 'officiel (repli)' : 'officiel (relais coupés)', ms: Date.now() - t0, appareil: cfg.device || undefined, dev });
      if (b) return send(res, 200, 'application/vnd.apple.mpegurl', hls.filterMaster(tw.absolutize(b.text, b.url), cfg.cap), { 'Cache-Control': 'no-store', 'X-Relais': b.name });
      const s = await tw.liveStream(login, false, null);
      if (s.offline) return send(res, 404, 'text/plain; charset=utf-8', 'Chaîne hors ligne');
      const o = await fetch(s.url, { headers: { 'User-Agent': tw.UA }, signal: AbortSignal.timeout(8000) }).then(r => r.text());
      return send(res, 200, 'application/vnd.apple.mpegurl', hls.filterMaster(o, cfg.cap), { 'Cache-Control': 'no-store' });
    }
    if (seg[0] === 'r' && seg[1]) {
      const parts = replay.decodeParts(strip(seg[1]).replace(/\.m3u8$/, ''));
      if (!parts) return send(res, 400, 'text/plain; charset=utf-8', 'Rediffusion invalide');
      if (F.maint) return send(res, 503, 'text/plain; charset=utf-8', 'Addon en maintenance');
      try {
        const text = await replay.playlist(parts, cfg.cap);
        store.incr('replay'); store.user(pseudo, { dev: cfg.device });
        store.log({ k: 'replay', u: pseudo || undefined, parts: parts.length, ms: Date.now() - t0, appareil: cfg.device || undefined, dev });
        return send(res, 200, 'application/vnd.apple.mpegurl', text, { 'Cache-Control': 'public, max-age=60' });
      } catch (e) { store.incr('err'); store.log({ k: 'erreur', u: pseudo || undefined, ou: 'rediffusion', msg: e.message }); return send(res, 502, 'text/plain; charset=utf-8', 'Rediffusion indisponible : ' + e.message); }
    }

    // ----- catalogues, fiches, sources
    const favs = prefs.favTeams(cfg), gs = enabledGames(cfg, SS);
    if (seg[0] === 'catalog') {
      const id = strip(seg[2]), ex = extraOf(seg[3]);
      if (id === 'esport-live' || id === 'esport-fav') {
        let ms = await allMatches(gs, SS);
        const genre = ex.get('genre');
        if (genre) ms = ms.filter(m => games.get(m.game).name === genre);
        let list;
        if (id === 'esport-fav') {
          const mine = ms.filter(m => model.hasTeam(m, favs));
          list = [...mine.filter(m => m.state === 'live'), ...mine.filter(m => m.state === 'upcoming').sort((a, b) => a.startTime - b.startTime), ...mine.filter(m => m.state === 'done').sort((a, b) => b.startTime - a.startTime)].slice(0, 60);
        } else list = model.upcomingList(ms, { upcoming: F.upcoming, past: F.past });
        store.log({ k: 'catalog', u: pseudo || undefined, n: list.length, cat: id, dev });
        return json(res, { metas: list.map(m => matchMeta(m, cfg, origin, favs)) }, { 'Cache-Control': 'public, s-maxage=30' });
      }
      const sm = /^esport-([a-z]+)-(\d{4})$/.exec(id);
      if (sm && games.get(sm[1])) {
        store.log({ k: 'catalog', u: pseudo || undefined, cat: id, dev });
        return json(res, { metas: [seriesMeta(sm[1], Number(sm[2]), [], cfg, origin, favs, false)] }, { 'Cache-Control': 'public, s-maxage=300' });
      }
      return json(res, { metas: [] });
    }
    if (seg[0] === 'meta') {
      const id = strip(seg[2]);
      let m;
      if ((m = /^esp:s:([a-z]+):(\d{4})$/.exec(id)) && games.get(m[1])) {
        const ms = (await matchesOf(m[1], SS)).filter(x => x.inCatalog !== false); // Fortnite : seuls les plus gros tournois
        return json(res, { meta: seriesMeta(m[1], Number(m[2]), ms, cfg, origin, favs, true) }, { 'Cache-Control': 'public, s-maxage=60' });
      }
      if ((m = /^esp:[mv]:(.+)$/.exec(id))) {
        const mm = await findMatch(m[1], SS);
        return json(res, { meta: mm ? matchMeta(mm, cfg, origin, favs) : null });
      }
      return json(res, { meta: null });
    }
    if (seg[0] === 'stream') {
      const m0 = /^esp:[mv]:(.+)$/.exec(strip(seg[2]));
      if (!m0) return json(res, { streams: [] });
      if (F.maint) return maint();
      const mm = await findMatch(m0[1], SS);
      if (!mm) return json(res, { streams: [] });
      const streams = await streamsFor(mm, cfg, origin, base, F);
      store.incr('stream'); store.user(pseudo, { dev: cfg.device });
      for (const t of mm.teams) if (t.code && t.code !== 'TBD') store.incr('t|' + mm.game + '|' + t.code);
      store.incr('g|' + mm.game);
      store.log({ k: 'stream', u: pseudo || undefined, match: model.matchTitle(mm), jeu: mm.game, etat: mm.state, n: streams.length, ms: Date.now() - t0, appareil: cfg.device || undefined, dev });
      return json(res, { streams }, { 'Cache-Control': 'no-store' });
    }
    send(res, 404, 'text/plain; charset=utf-8', 'Introuvable');
  } catch (e) {
    console.error('requête :', e.message);
    store.incr('err'); store.log({ k: 'erreur', u: pseudo || undefined, ou: String(req.url).split('?')[0].slice(0, 60), msg: e.message });
    if (!res.headersSent) json(res, { error: e.message });
  }
}

module.exports = handler;
module.exports.handler = handler;
module.exports._t = { manifestFor, seriesMeta, matchMeta, streamsFor, matchesOf, yearsOf };
if (require.main === module) http.createServer(handler).listen(PORT, () => console.log('Esport pour Stremio sur http://localhost:' + PORT));
