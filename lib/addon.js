'use strict';
// Cœur de l'addon : données (cache), manifeste, catalogues, fiches et sources.
const val = require('./valorant');
const tw = require('./twitch');
const M = require('./model');
const prefs = require('./prefs');
const siteLib = require('./site');
const store = require('./store');
const TEAMS = require('./teams');

// ---------- données : cache mémoire 5 min, dernière lecture réussie gardée dans Upstash (repli quand la source plante) ----------
const memo = new Map();
async function load(S, { force = false } = {}) {
  const key = S.comps.join(',') + '|' + S.extraKeywords.join(',') + '|' + S.startYear, c = memo.get(key);
  if (!force && c && c.exp > Date.now()) return c.v;
  try {
    const v = await val.matches({ comps: S.comps, extra: S.extraKeywords, startYear: S.startYear });
    v.at = Date.now(); v.stale = false;
    memo.set(key, { v, exp: Date.now() + 5 * 60e3 });
    store.setKey('cache:' + key, JSON.stringify({ at: v.at, matches: v.matches, leagues: v.leagues, errors: v.errors })).catch(() => {});
    return v;
  } catch (e) {
    if (c) return { ...c.v, stale: true, error: e.message };
    try { const raw = await store.getKey('cache:' + key); if (raw) { const v = { ...JSON.parse(raw), stale: true, error: e.message }; memo.set(key, { v, exp: Date.now() + 60e3 }); return v; } } catch { /* pas de copie */ }
    throw e;
  }
}
const forComps = (data, comps) => data.matches.filter(m => comps.includes(m.comp));
const byRaw = (data, raw) => data.matches.find(m => m.raw === String(raw));

// ---------- affichage ----------
const FLAG = { FR: '🇫🇷', EN: '🇬🇧' };
const star = (m, cfg) => (M.hasTeam(m, cfg.teams) ? '⭐ ' : '');
const stateLabel = m => (m.state === 'live' ? '🔴 En direct' : m.state === 'done' ? '📼 Rediffusion' : '⏳ ' + M.fmtDate(m.startTime));
function scoreLine(m) {
  const [a, b] = M.teamsOf(m);
  if (a.score == null || b.score == null) return '';
  return (a.win ? '✅ ' : '') + M.shortOf(a) + ' ' + a.score + ' - ' + b.score + ' ' + M.shortOf(b);
}
function describe(m, cfg) {
  const [a, b] = M.teamsOf(m);
  return [a.name + ' contre ' + b.name, [m.event.name, m.stage, m.bestOf ? 'BO' + m.bestOf : ''].filter(Boolean).join(' · '), M.fmtDate(m.startTime), '',
    m.state === 'done' ? (cfg.score && scoreLine(m) ? scoreLine(m) : 'Rediffusion du match complet (sans spoiler).') : m.state === 'live' ? '🔴 Match en cours : lives Twitch disponibles.' : 'Les lives Twitch apparaissent ici au début du match.'].join('\n');
}

// ---------- adresses des images (générées à la demande) ----------
const posterOn = S => S.feat.posters && require('./poster').available();
const DESIGN = 5; // à augmenter quand le design des affiches change (force Stremio à recharger les images)
const ver = (m, cfg) => ['d' + DESIGN, m.state, m.startTime % 100000, cfg.score ? 1 : 0].join('-');
const img = (base, kind, m, cfg) => base + '/' + kind + '/' + m.raw + '.png?v=' + ver(m, cfg);

function matchMeta(m, cfg, S, origin) {
  const [a, b] = M.teamsOf(m), P = posterOn(S);
  return {
    id: M.key(m), type: 'movie', name: star(m, cfg) + M.shortOf(a) + ' vs ' + M.shortOf(b), posterShape: P ? 'poster' : 'square',
    poster: P ? img(origin, 'poster', m, cfg) : a.logo || b.logo || undefined, background: P ? img(origin, 'bg', m, cfg) : undefined,
    description: describe(m, cfg), releaseInfo: m.state === 'live' ? '🔴 En direct' : M.fmtDate(m.startTime), genres: [m.event.name, m.stage].filter(Boolean), released: new Date(m.startTime).toISOString(),
  };
}
const yearsOf = S => { const y = M.yearOf(Date.now()), out = []; for (let i = S.startYear; i <= Math.max(y, S.startYear); i++) out.push(i); return out; };

// ---------- manifeste ----------
function manifest(S, cfg, { name, pseudo } = {}) {
  const cats = [{ type: 'movie', id: 'val-live', name: 'Valorant · En direct & à venir' }];
  if (cfg.teams.length) cats.push({ type: 'movie', id: 'val-team', name: '⭐ Mon équipe' });
  for (const y of yearsOf(S).reverse()) cats.push({ type: 'series', id: 'val-series-' + y, name: 'Valorant ' + y });
  if (S.feat.replays) cats.push({ type: 'movie', id: 'val-replays', name: 'Valorant · Rediffusions' });
  return {
    id: 'community.esport.valorant', version: '1.0.0', name: pseudo ? (name || S.name) + ' · ' + pseudo : name || S.name,
    description: 'Matchs Valorant (VCT, VCT EMEA, Game Changers, Champions, EWC) : lives Twitch et rediffusions',
    resources: ['catalog', 'meta', 'stream'], types: ['movie', 'series'], idPrefixes: ['val:'], catalogs: cats,
    behaviorHints: { configurable: true, configurationRequired: false },
  };
}

// ---------- catalogues ----------
async function catalog(type, id, S, cfg, origin) {
  const data = await load(S), mine = forComps(data, cfg.comps);
  if (type === 'movie' && id === 'val-live') return M.upcomingList(mine, { upcoming: S.feat.upcoming }).map(m => matchMeta(m, cfg, S, origin));
  if (type === 'movie' && id === 'val-team') {
    const t = mine.filter(m => M.hasTeam(m, cfg.teams)), live = M.upcomingList(t, { upcoming: 40 }), done = M.doneList(t, S.feat.doneMax);
    return [...live, ...done].map(m => matchMeta(m, cfg, S, origin));
  }
  if (type === 'movie' && id === 'val-replays') return S.feat.replays ? M.doneList(mine, S.feat.doneMax).map(m => matchMeta(m, cfg, S, origin)) : [];
  const y = /^val-series-(\d{4})$/.exec(id);
  if (type === 'series' && y) {
    const seasons = M.seasonsOf(mine, Number(y[1]));
    if (!seasons.length) return [];
    return [seriesMeta(Number(y[1]), seasons, cfg, S, origin, false)];
  }
  return [];
}
function seriesMeta(year, seasons, cfg, S, origin, withVideos) {
  const P = posterOn(S), total = seasons.reduce((n, s) => n + s.matches.length, 0);
  const m = {
    id: 'val:s:' + year, type: 'series', name: 'Valorant ' + year, posterShape: 'poster', poster: P ? origin + '/poster/series/' + year + '.png?v=d' + DESIGN + '-' + seasons.length : undefined,
    background: P ? origin + '/poster/series/' + year + '.png?v=d' + DESIGN + '-' + seasons.length : undefined,
    description: seasons.map(s => 'Saison ' + s.n + ' · ' + s.event.name + ' (' + s.matches.length + ' matchs)').join('\n') + '\n\nÉpisode = un match, dans l\'ordre du calendrier.', releaseInfo: String(year), genres: ['Esport', 'Valorant'],
  };
  if (!withVideos) return m;
  m.videos = seasons.flatMap(s => s.matches.map((x, i) => ({
    id: M.key(x), title: star(x, cfg) + M.matchTitle(x) + (x.stage ? ' · ' + x.stage : ''), season: s.n, episode: i + 1, released: new Date(x.startTime).toISOString(),
    thumbnail: P ? img(origin, 'thumb', x, cfg) : (M.teamsOf(x)[0].logo || undefined), overview: [s.event.name, stateLabel(x), cfg.score && x.state === 'done' ? scoreLine(x) : ''].filter(Boolean).join(' · '),
  })));
  m.description += '\n\n' + total + ' matchs';
  return m;
}

// ---------- fiches ----------
async function meta(type, id, S, cfg, origin) {
  const data = await load(S), mine = forComps(data, cfg.comps);
  const sm = /^val:s:(\d{4})$/.exec(id);
  if (sm) { const seasons = M.seasonsOf(mine, Number(sm[1])); return seasons.length ? seriesMeta(Number(sm[1]), seasons, cfg, S, origin, true) : null; }
  const raw = M.parseKey(id), m = raw && byRaw(data, raw);
  return m ? matchMeta(m, cfg, S, origin) : null;
}

// ---------- sources ----------
const sortCh = (list, lang) => list.slice().sort((a, b) => (a.lang === lang ? 0 : 1) - (b.lang === lang ? 0 : 1) || (a.role === 'Officiel' ? 0 : 1) - (b.role === 'Officiel' ? 0 : 1) || b.viewers - a.viewers);
const capOf = (cfg, S) => { const c = cfg.cap || 0, mx = S.feat.capMax || 0; return c && mx ? Math.min(c, mx) : c || mx; };

async function liveSources(m, cfg, S, origin, base) {
  const chans = siteLib.channelsOf(S);
  let st = {}; try { st = await tw.liveStatus(chans.map(c => c.login)); } catch { st = {}; }
  const lang = cfg.lang === 'all' ? 'FR' : cfg.lang;
  const live = chans.filter(c => st[c.login] && st[c.login].live).map(c => ({ ...c, ...st[c.login], label: c.label, lang: c.lang, role: c.role }));
  const list = sortCh(live, lang).filter(c => cfg.lang === 'all' || c.lang === cfg.lang || c.role === 'Officiel');
  return list.map(c => ({ name: 'Twitch\n' + c.label, title: ['🔴 En direct · ' + M.fmtN(c.viewers) + ' 👁', (FLAG[c.lang] || '') + ' ' + c.lang + ' · ' + c.role, c.game ? '🎮 ' + c.game.slice(0, 22) : ''].filter(Boolean).join('\n'), url: origin + base + '/live/' + c.login + '.m3u8' }));
}

// Rediffusions : vidéos officielles de chaque manche (API valorantesports.com), sinon archives des chaînes qui ont diffusé le match.
const repCache = new Map();
async function replaysOf(m, S) {
  const c = repCache.get(m.raw);
  if (c && c.exp > Date.now()) return c.v;
  let out = [];
  try { out = (await val.replays(m.raw)).map(r => ({ lang: r.lang, label: r.lang === 'FR' ? 'Français' : r.lang === 'EN' ? 'Anglais' : r.lang, parts: r.parts, yt: r.yt || [], src: 'officiel' })); } catch { out = []; }
  if (!out.length) { // repli : archives des chaînes configurées autour de l'heure du match
    const from = m.startTime - 10 * 60e3, to = m.startTime + (m.bestOf || 3) * 55 * 60e3 + 20 * 60e3;
    const chans = siteLib.channelsOf(S);
    const res = await Promise.allSettled(chans.map(async ch => ({ ch, parts: tw.partsForWindow(await tw.archives(ch.login), from, to) })));
    for (const r of res) if (r.status === 'fulfilled' && r.value.parts.length) out.push({ lang: r.value.ch.lang, label: r.value.ch.label, parts: r.value.parts, src: 'archive' });
  }
  repCache.set(m.raw, { v: out, exp: Date.now() + (out.length ? 30 * 60e3 : 3 * 60e3) });
  if (repCache.size > 300) repCache.delete(repCache.keys().next().value);
  return out;
}
const encParts = p => encodeURIComponent(p.map(x => x.v + ':' + Math.floor(x.s) + ':' + (x.e == null ? '' : Math.ceil(x.e))).join(','));
const decParts = s => String(s || '').split(',').map(x => x.split(':')).filter(a => /^\d+$/.test(a[0])).map(a => ({ v: a[0], s: Number(a[1]) || 0, e: a[2] === '' || a[2] == null ? null : Number(a[2]) })).slice(0, 8);

async function replaySources(m, cfg, S, origin, base) {
  const reps = await replaysOf(m, S), lang = cfg.lang === 'all' ? 'FR' : cfg.lang;
  const ordered = reps.slice().sort((a, b) => (a.lang === lang ? 0 : 1) - (b.lang === lang ? 0 : 1));
  const keep = cfg.lang === 'all' ? ordered : ordered.filter(r => r.lang === cfg.lang).concat(ordered.filter(r => r.lang !== cfg.lang));
  const out = [];
  for (const r of keep) {
    if (r.parts.length) out.push({ name: 'Replay\n' + r.lang, title: ['📼 Match complet', (FLAG[r.lang] || '') + ' ' + r.label, r.src === 'officiel' ? '✅ Source officielle' : '📺 Archive Twitch'].join('\n'), url: origin + base + '/vod/match.m3u8?p=' + encParts(r.parts) });
    (r.yt || []).forEach((id, i, all) => out.push({ name: 'YouTube\n' + r.lang, title: ['▶️ YouTube' + (all.length > 1 ? ' · partie ' + (i + 1) + '/' + all.length : ''), (FLAG[r.lang] || '') + ' ' + r.label, '✅ Source officielle'].join('\n'), ytId: id }));
  }
  return out.slice(0, 8);
}

async function streams(id, S, cfg, origin, base) {
  if (S.feat.maint) return [{ name: 'Maintenance', title: S.feat.maintMsg || 'Addon en maintenance, réessaie plus tard.', externalUrl: 'https://valorantesports.com/fr-FR/' }];
  const data = await load(S), raw = M.parseKey(id), m = raw && byRaw(data, raw);
  if (!m) return [];
  const out = [];
  const near = Math.abs(Date.now() - m.startTime) < 6 * 3600e3;
  if (S.feat.live && (m.state === 'live' || (m.state === 'upcoming' && near))) out.push(...await liveSources(m, cfg, S, origin, base));
  if (S.feat.replays && m.state === 'done') out.push(...await replaySources(m, cfg, S, origin, base));
  if (!out.length) {
    const msg = m.state === 'done' ? ['📼 Rediffusion pas encore disponible', 'Elle apparaît quand la vidéo', 'est publiée sur Twitch.'] : ['⏳ Début ' + M.fmtDate(m.startTime), 'Les lives Twitch apparaissent', 'ici au début du match.'];
    out.push({ name: m.state === 'done' ? 'Bientôt' : 'À venir', title: msg.join('\n'), externalUrl: 'https://valorantesports.com/fr-FR/' });
  }
  return out;
}

module.exports = { load, forComps, byRaw, manifest, catalog, meta, streams, replaysOf, matchMeta, posterOn, decParts, encParts, capOf, TEAMS, tw, val, M, prefs };
