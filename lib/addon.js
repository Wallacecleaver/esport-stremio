'use strict';
// Cœur de l'addon : données (cache), manifeste, catalogues, fiches et sources.
const val = require('./valorant');
const tw = require('./twitch');
const disc = require('./discover');
const M = require('./model');
const prefs = require('./prefs');
const siteLib = require('./site');
const store = require('./store');
const TEAMS = require('./teams'), LEC_TEAMS = require('./teams').LEC;

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
const DESIGN = 8; // à augmenter quand le design des affiches change (force Stremio à recharger les images)
const ver = (m, cfg) => ['d' + DESIGN, m.state, m.startTime % 100000, cfg.score ? 1 : 0].join('-');
const img = (base, kind, m, cfg) => base + '/' + kind + '/' + m.raw + '.png?v=' + ver(m, cfg);

function matchMeta(m, cfg, S, origin) {
  const [a, b] = M.teamsOf(m), P = posterOn(S);
  return {
    id: M.key(m), type: 'movie', name: star(m, cfg) + M.shortOf(a) + ' vs ' + M.shortOf(b), posterShape: P ? 'poster' : 'square',
    poster: P ? img(origin, 'poster', m, cfg) : a.logo || b.logo || undefined, background: P ? img(origin, 'bg', m, cfg) : undefined,
    description: describe(m, cfg), releaseInfo: m.state === 'live' ? '🔴 En direct' : M.fmtDate(m.startTime), genres: [m.event.name, m.stage, gameOf(m).name].filter(Boolean), released: new Date(m.startTime).toISOString(),
  };
}

// ---------- manifeste ----------
const COMPS = { intl: { name: '🌍 Masters & Champions', label: 'Masters & Champions' }, emea: { name: '🇪🇺 VCT EMEA', label: 'VCT EMEA' }, ewc: { name: '🏆 Esports World Cup', label: 'Esports World Cup' }, gc: { name: '💜 Game Changers', label: 'Game Changers' }, lolw: { name: '🌍 Worlds & MSI (LoL)', label: 'Worlds & MSI', game: 'lol' }, lec: { name: '🇪🇺 LEC (LoL)', label: 'LEC', game: 'lol' }, lolewc: { name: '🏆 Esports World Cup (LoL)', label: 'EWC (LoL)', game: 'lol' } };
const GAMES = { val: { name: 'Valorant', host: 'https://valorantesports.com/fr-FR/', re: /valorant/i, dir: 'VALORANT', kw: /vct|valorant champions|masters|game changers|gc |ewc|world cup|esports world|champions|worlds|emea|watch ?party|co ?stream|costream/ }, lol: { name: 'League of Legends', host: 'https://lolesports.com/fr-FR', re: /league of legends/i, dir: 'League of Legends', kw: /lec|worlds|msi|first stand|lol esports|season finals|versus|spring|summer|playoffs|watch ?party|co ?stream|costream/ } };
const gameOf = m => GAMES[m.game] || GAMES.val;
const COMP_ORDER = ['intl', 'emea', 'ewc', 'gc', 'lolw', 'lec', 'lolewc'];
function manifest(S, cfg, { name, pseudo, have } = {}) {
  const cats = [{ type: 'movie', id: 'val-live', name: '🔴 En direct & à venir' }];
  if (cfg.teams.length) cats.push({ type: 'movie', id: 'val-team', name: '⭐ Mon équipe' });
  for (const c of COMP_ORDER) if (cfg.comps.includes(c) && S.comps.includes(c) && !(c === 'lolewc' && have && !have.has(c))) cats.push({ type: 'series', id: 'val-c-' + c, name: COMPS[c].name });
  if (S.feat.replays) cats.push({ type: 'movie', id: 'val-replays', name: '📼 Rediffusions' });
  return {
    id: 'community.esportio', version: '1.2.0', name: pseudo ? (name || S.name) + ' · ' + pseudo : name || S.name,
    description: 'Esport : Valorant (VCT EMEA, Masters & Champions, Game Changers, EWC) et League of Legends (LEC, Worlds, MSI). Lives Twitch avec les co-streams de ton équipe, et rediffusions Twitch / YouTube.',
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
  const c = /^val-c-(\w+)$/.exec(id);
  if (type === 'series' && c && COMPS[c[1]]) return M.eventsOf(mine, c[1]).map(e => eventMeta(e, cfg, S, origin, false));
  return [];
}
const dateRange = e => { const f = t => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: M.TZ }), a = e.matches[0].startTime, b = e.matches[e.matches.length - 1].startTime; return f(a) === f(b) ? f(a) : f(a) + ' → ' + f(b); };
// Un événement = une série. Saison = phase (Semaine 1, Play-offs, Finale…), épisode = match.
function eventMeta(e, cfg, S, origin, withVideos) {
  const P = posterOn(S), n = e.matches.length, done = e.matches.filter(x => x.state === 'done').length, up = e.matches.filter(x => x.state === 'upcoming').length, lv = e.matches.filter(x => x.state === 'live').length;
  const pv = '?v=d' + DESIGN + '-' + n + '-' + lv, url = P ? origin + '/poster/event/' + e.key + '.png' + pv : undefined;
  const mine = e.matches.filter(x => M.hasTeam(x, cfg.teams)).length;
  const meta = {
    id: 'val:e:' + e.key, type: 'series', name: e.event.name, posterShape: 'poster', poster: url || e.event.logo || undefined, background: url, logo: e.event.logo || undefined,
    description: [(COMPS[e.comp] || {}).label + ' · ' + dateRange(e), n + ' matchs · ' + (lv ? '🔴 ' + lv + ' en direct · ' : '') + done + ' terminés · ' + up + ' à venir' + (mine ? ' · ⭐ ' + mine + ' pour ton équipe' : ''), '',
      ...e.stages.map(s => '• ' + s.name + ' (' + s.matches.length + ')'), '', 'Saison = phase de la compétition · épisode = un match.'].join('\n'),
    releaseInfo: String(e.year), genres: [(COMPS[e.comp] || {}).label || 'Valorant', (GAMES[(COMPS[e.comp] || {}).game] || GAMES.val).name],
  };
  if (!withVideos) return meta;
  meta.videos = e.stages.flatMap(s => s.matches.map((x, i) => ({
    id: M.key(x), title: star(x, cfg) + M.matchTitle(x) + (s.name !== 'Matchs' ? ' · ' + s.name : ''), season: s.n, episode: i + 1, released: new Date(x.startTime).toISOString(),
    thumbnail: P ? img(origin, 'thumb', x, cfg) : (M.teamsOf(x)[0].logo || undefined), overview: [stateLabel(x), cfg.score && x.state === 'done' ? scoreLine(x) : ''].filter(Boolean).join(' · '),
  })));
  return meta;
}

// ---------- fiches ----------
async function meta(type, id, S, cfg, origin) {
  const data = await load(S), mine = forComps(data, cfg.comps);
  const em = /^val:e:([\w-]+)$/.exec(id);
  if (em) { const e = M.eventsOf(mine).find(x => x.key === em[1]); return e ? eventMeta(e, cfg, S, origin, true) : null; }
  const raw = M.parseKey(id), m = raw && byRaw(data, raw);
  return m ? matchMeta(m, cfg, S, origin) : null;
}
// événement par identifiant (pour l'affiche de la série)
async function eventByKey(S, key) { const data = await load(S); return M.eventsOf(data.matches).find(x => x.key === key) || null; }

// ---------- sources ----------
const up = s => String(s || '').toUpperCase();
// chaînes surveillées + co-streamers des équipes qui jouent ce match
function channelsFor(m, S) {
  const base = siteLib.channelsOf(S).filter(c => (c.game || 'val') === (m.game || 'val')).map(c => ({ ...c })), tc = siteLib.teamChannelsOf(S), by = new Map(base.map(c => [c.login, c]));
  for (const t of M.teamsOf(m)) for (const c of tc[up(t.code)] || []) {
    const cur = by.get(c.login) || { login: c.login, label: c.label, lang: c.lang, role: 'Co-stream' };
    cur.team = up(t.code); cur.label = c.label || cur.label; by.set(c.login, cur);
  }
  return [...by.values()];
}
const dur = parts => { let t = 0; for (const p of parts) { if (p.e == null) return 0; t += p.e - p.s; } return t; };
const fmtDur = s => { const h = Math.floor(s / 3600), mn = Math.round((s % 3600) / 60); return h ? h + ' h ' + String(mn).padStart(2, '0') : mn + ' min'; };
const capOf = (cfg, S) => { const c = cfg.cap || 0, mx = S.feat.capMax || 0; return c && mx ? Math.min(c, mx) : c || mx; };

async function liveSources(m, cfg, S, origin, base) {
  const chans = channelsFor(m, S), favs = (cfg.teams || []).map(up);
  let st = {}; try { st = await tw.liveStatus(chans.map(c => c.login)); } catch { st = {}; }
  const lang = cfg.lang === 'all' ? 'FR' : cfg.lang;
  // Un live n'est proposé que s'il diffuse vraiment ce match : jeu Valorant, et (sauf chaîne officielle ou co-stream d'une des équipes) un titre qui parle du match.
  const nrm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(), teams = M.teamsOf(m).filter(t => t.code && t.code !== 'TBD'), ev = nrm((m.event && m.event.name) || '');
  const words = new Set(); teams.forEach(t => { if (nrm(t.code).length >= 2) words.add(nrm(t.code)); if (nrm(t.name).length >= 3) words.add(nrm(t.name)); });
  const G = gameOf(m), kw = G.kw;
  const about = title => { const t = ' ' + nrm(title) + ' '; return [...words].some(w => t.includes(' ' + w + ' ') || (w.length >= 4 && t.includes(w))) || kw.test(t) || false; };
  // Lives trouvés automatiquement : annuaire Twitch (titre qui cite les équipes) + chaînes listées sur Liquipedia
  let found = [];
  if (S.feat.discover) { try { found = await disc.discover(m, teams, kw, chans.map(c => c.login), { twitch: true, liquipedia: true, game: m.game || 'val' }); } catch { found = []; } }
  const live = chans.filter(c => st[c.login] && st[c.login].live && G.re.test(st[c.login].game || '') && (c.role === 'Officiel' || c.team || about(st[c.login].title)))
    .map(c => ({ ...c, ...st[c.login], label: c.label, lang: c.lang, role: c.role, team: c.team, fav: !!c.team && favs.includes(c.team) }))
    .concat(found.map(f => ({ login: f.login, label: f.name, lang: /^fr/i.test(f.lang) ? 'FR' : 'EN', role: 'Trouvé', found: f.found, viewers: f.viewers, game: f.game, title: f.title, team: '', fav: false })));
  const score = c => (c.fav ? 0 : 4) + (c.lang === lang ? 0 : 2) + (c.team ? 0 : 1);
  const list = live.filter(c => cfg.lang === 'all' || c.lang === cfg.lang || c.role === 'Officiel' || c.team || c.found).sort((a, b) => score(a) - score(b) || (a.role === 'Officiel' ? 0 : 1) - (b.role === 'Officiel' ? 0 : 1) || b.viewers - a.viewers);
  return list.map(c => ({
    name: '🔴 LIVE\n' + c.label,
    title: [(FLAG[c.lang] || '') + ' ' + (c.team ? 'Co-stream ' + c.team : c.found ? 'Co-stream ' + (c.found === 'liquipedia' ? '📚 Liquipedia' : '🔎 titre') : c.role), '👁 ' + M.fmtN(c.viewers) + (c.game ? ' · 🎮 ' + c.game.slice(0, 14) : ''), c.fav ? '⭐ Ton équipe' : ''].filter(Boolean).join('\n'),
    url: origin + base + '/live/' + c.login + '.m3u8',
  }));
}

// Rediffusions : vidéos officielles de chaque manche (API valorantesports.com), sinon archives des chaînes qui ont diffusé le match.
const repCache = new Map();
async function replaysOf(m, S) {
  const c = repCache.get(m.raw);
  if (c && c.exp > Date.now()) return c.v;
  let out = [];
  try { out = (await val.replays(m.raw, m.game || 'val')).map(r => ({ lang: r.lang, label: r.lang === 'FR' ? 'Français' : r.lang === 'EN' ? 'Anglais' : r.lang, parts: r.parts, yt: r.yt || [], src: 'officiel' })); } catch { out = []; }
  if (!out.length) { // repli : archives des chaînes configurées (et co-streamers des équipes) autour de l'heure du match
    const from = m.startTime - 10 * 60e3, to = m.startTime + (m.bestOf || 3) * 55 * 60e3 + 20 * 60e3;
    const res = await Promise.allSettled(channelsFor(m, S).map(async ch => ({ ch, parts: tw.partsForWindow(await tw.archives(ch.login), from, to) })));
    for (const r of res) if (r.status === 'fulfilled' && r.value.parts.length) out.push({ lang: r.value.ch.lang, label: r.value.ch.label, parts: r.value.parts, yt: [], src: 'archive', team: r.value.ch.team });
  }
  repCache.set(m.raw, { v: out, exp: Date.now() + (out.length ? 30 * 60e3 : 3 * 60e3) });
  if (repCache.size > 300) repCache.delete(repCache.keys().next().value);
  return out;
}
const encParts = p => encodeURIComponent(p.map(x => x.v + ':' + Math.floor(x.s) + ':' + (x.e == null ? '' : Math.ceil(x.e))).join(','));
const decParts = s => String(s || '').split(',').map(x => x.split(':')).filter(a => /^\d+$/.test(a[0])).map(a => ({ v: a[0], s: Number(a[1]) || 0, e: a[2] === '' || a[2] == null ? null : Number(a[2]) })).slice(0, 8);

const mapsLabel = (games, total) => !games || !games.length || (total === 1 && games.length > 1) ? '🎞 Match complet' : games.length === 1 ? '🗺 Map ' + games[0] : '🗺 Maps ' + games[0] + ' à ' + games[games.length - 1];
function replaySources(m, cfg, S, origin, base, reps) {
  const lang = cfg.lang === 'all' ? 'FR' : cfg.lang;
  // FR et EN uniquement (les autres langues seulement s'il n'y a rien d'autre)
  let list = reps.filter(r => r.lang === 'FR' || r.lang === 'EN'); if (!list.length) list = reps;
  list = list.filter(r => cfg.lang === 'all' || r.lang === cfg.lang || r.src === 'officiel' || !list.some(x => x.lang === cfg.lang)).sort((a, b) => (a.lang === lang ? 0 : 1) - (b.lang === lang ? 0 : 1) || (a.src === 'officiel' ? 0 : 1) - (b.src === 'officiel' ? 0 : 1));
  const out = [];
  for (const r of list) {
    const flag = FLAG[r.lang] || '🌐';
    if (r.parts.length) { const d = dur(r.parts); out.push({ name: '📼 REPLAY\n' + r.lang, title: [flag + ' ' + r.label, '🎞 Match complet' + (d ? ' · ' + fmtDur(d) : ''), r.src === 'officiel' ? '✅ Source officielle' : '📺 Archive' + (r.team ? ' · ' + r.team : '')].join('\n'), url: origin + base + '/vod/match.m3u8?p=' + encParts(r.parts) }); }
    (r.yt || []).forEach(y => out.push({ name: '▶️ YOUTUBE\n' + r.lang, title: [flag + ' ' + r.label, mapsLabel(y.games, r.yt.length), '✅ Source officielle'].join('\n'), ytId: y.id }));
  }
  return out.slice(0, 8);
}

async function streams(id, S, cfg, origin, base) {
  if (S.feat.maint) return [{ name: '🛠 Maintenance', title: S.feat.maintMsg || 'Addon en maintenance,\nréessaie plus tard.', externalUrl: GAMES.val.host }];
  const data = await load(S), raw = M.parseKey(id), m = raw && byRaw(data, raw);
  if (!m) return [];
  const out = [];
  const near = Math.abs(Date.now() - m.startTime) < 6 * 3600e3;
  if (S.feat.live && (m.state === 'live' || (m.state === 'upcoming' && near))) out.push(...await liveSources(m, cfg, S, origin, base));
  if (S.feat.replays && m.state === 'done') out.push(...replaySources(m, cfg, S, origin, base, await replaysOf(m, S)));
  if (!out.length) {
    if (m.state === 'done') out.push({ name: '📼 BIENTÔT\nRediffusion', title: ['Pas encore publiée.', 'Elle apparaît ici dès que', 'la vidéo est en ligne.'].join('\n'), externalUrl: gameOf(m).host });
    else {
      const plan = channelsFor(m, S).filter(c => c.team).map(c => c.label);
      out.push({ name: '⏳ À VENIR\n' + M.fmtHour(m.startTime), title: ['Début ' + M.fmtDate(m.startTime), 'Les lives Twitch arrivent', 'ici au début du match.', plan.length ? '📡 Co-stream : ' + plan.slice(0, 3).join(', ') : ''].filter(Boolean).join('\n'), externalUrl: gameOf(m).host });
    }
  }
  return out;
}

module.exports = { load, forComps, byRaw, manifest, catalog, meta, streams, replaysOf, matchMeta, posterOn, decParts, encParts, capOf, eventByKey, COMPS, TEAMS, LEC_TEAMS, GAMES, tw, val, M, prefs };
