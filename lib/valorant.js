'use strict';
// Valorant : source officielle valorantesports.com (passerelle publique de Riot, identique à celle de lolesports mais avec sport = val).
//   getLeagues  → les ligues/compétitions ;  getSchedule → les matchs d'une ligue ;  getEventDetails → les vidéos Twitch de chaque manche.
// Compétitions proposées : emea (VCT EMEA), intl (Masters, Champions), gc (Game Changers), ewc (Esports World Cup).
const { yearOf, slug } = require('./model');

const BASE = process.env.VAL_API || 'https://esports-api.service.valorantesports.com/persisted/val';
const KEY = process.env.VAL_API_KEY || '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z'; // clé publique utilisée par le site officiel
const LOL_BASE = process.env.LOL_API || 'https://esports-api.lolesports.com/persisted/gw'; // même passerelle Riot pour League of Legends
const TIMEOUT = 8000;
const HOST = { val: 'valorantesports.com', lol: 'lolesports.com' };

async function call(path, params = {}, game = 'val') {
  const r = await fetch((game === 'lol' ? LOL_BASE : BASE) + '/' + path + '?' + new URLSearchParams({ hl: 'fr-FR', ...(game === 'lol' ? {} : { sport: 'val' }), ...params }), { headers: { 'x-api-key': KEY }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(HOST[game] + ' ' + path + ' : HTTP ' + r.status);
  const j = await r.json().catch(() => ({}));
  return j.data || {};
}

// ----- compétitions : quelle ligue appartient à quelle compétition ? -----
const LOL_COMPS = ['lolw', 'lec', 'lolewc'];
const EXCLUDE = /challengers|ascension|collegiate|academy|academie|universit|qualifier|open qualifier/i;
function classify(league, extra = []) {
  const t = (String(league.name || '') + ' ' + String(league.slug || '')).toLowerCase().replace(/_/g, ' ').replace(/-/g, ' ');
  if (EXCLUDE.test(t) && !/game ?changers/.test(t)) return null;
  if (/game ?changers|\bgc\b/.test(t)) return /emea|europe|championship|world|global/.test(t) ? 'gc' : null; // GC : Europe + championnat du monde seulement
  if (/world cup|\bewc\b/.test(t)) return 'ewc';
  if (/emea/.test(t)) return 'emea';
  if (/champions|masters|\bworlds?\b|vct|valorant/.test(t)) return /pacific|americas|china|\bcn\b|\bna\b|latam|brazil|\bbr\b/.test(t) ? null : 'intl';
  if (extra.some(k => t.includes(k))) return 'intl';
  return null;
}

// League of Legends : Worlds / MSI (compétition « lolw ») et LEC (« lec »). Les autres ligues ne sont pas proposées.
function classifyLol(league) {
  const t = String(league.slug || league.name || '').toLowerCase().replace(/[\s_]+/g, '-');
  if (t === 'lec') return 'lec';
  if (['worlds', 'msi', 'first-stand'].includes(t)) return 'lolw';
  if (/esports-world-cup|^ewc/.test(t) || /esports world cup|\bewc\b/i.test(String(league.name || ''))) return 'lolewc';
  return null;
}
let lolMemo = null;
async function lolLeagues() {
  if (!lolMemo || lolMemo.exp < Date.now()) {
    const l = ((await call('getLeagues', {}, 'lol')).leagues || []).map(x => ({ id: x.id, slug: x.slug, name: x.name, image: x.image ? String(x.image).replace(/^http:\/\/(?!localhost)/, 'https://') : null, game: 'lol' }));
    lolMemo = { v: l, exp: Date.now() + 6 * 3600e3 };
  }
  return lolMemo.v.map(l => ({ ...l, comp: classifyLol(l) })).filter(l => l.comp);
}
// Splits / tournois d'une ligue LoL (LEC Hiver, Printemps, Été…) : permet de ne pas mélanger leurs semaines dans une même série.
const trnMemo = new Map();
async function lolTournaments(lg) {
  const c = trnMemo.get(lg.id); if (c && c.exp > Date.now()) return c.v;
  let v = [];
  try {
    const l = ((await call('getTournamentsForLeague', { leagueId: lg.id }, 'lol')).leagues || [])[0] || {};
    v = (l.tournaments || []).map(t => ({ slug: String(t.slug || ''), start: Date.parse(t.startDate), end: Date.parse(t.endDate) + 36 * 3600e3 })).filter(t => t.slug && t.start).sort((a, b) => a.start - b.start);
  } catch { v = []; }
  trnMemo.set(lg.id, { v, exp: Date.now() + (v.length ? 6 * 3600e3 : 10 * 60e3) });
  return v;
}
const trnOf = (list, t0) => list.filter(t => t.start - 36 * 3600e3 <= t0 && t0 <= t.end)[0] || [...list].reverse().find(t => t.start <= t0) || null;
function trnName(lg, slugT, year) {
  const ls = String(lg.slug).toLowerCase().split(/[-_\s]+/);
  const rest = String(slugT).toLowerCase().split(/[-_\s]+/).filter((w, i) => w && !/^20\d\d$/.test(w) && !(i < ls.length && ls.includes(w))).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  return (lg.name + (rest ? ' ' + rest : '') + ' ' + year).replace(/\s+/g, ' ');
}

let leaguesMemo = null;
async function leagues(extra = []) {
  if (!leaguesMemo || leaguesMemo.exp < Date.now()) {
    const l = ((await call('getLeagues')).leagues || []).map(x => ({ id: x.id, slug: x.slug, name: x.name, image: x.image ? String(x.image).replace(/^http:\/\/(?!localhost)/, 'https://') : null }));
    leaguesMemo = { v: l, exp: Date.now() + 6 * 3600e3 };
  }
  return leaguesMemo.v.map(l => ({ ...l, comp: classify(l, extra) })).filter(l => l.comp);
}

function toMatch(ev, lg, startYear, trns) {
  const m = ev.match, t0 = Date.parse(ev.startTime), year = yearOf(t0), L = ev.league || lg, game = lg.game || 'val', tr = trns && trns.length ? trnOf(trns, t0) : null;
  const teams = (m.teams || []).map(t => ({ name: t.name, code: t.code, logo: t.image ? String(t.image).replace(/^http:\/\/(?!localhost)/, 'https://') : null, score: t.result ? t.result.gameWins : null, win: t.result ? t.result.outcome === 'win' : null }));
  return {
    id: game + '~' + m.id, raw: String(m.id), game, year, comp: lg.comp,
    league: { slug: lg.slug, name: lg.name, image: lg.image },
    event: tr ? { key: slug(lg.slug) + '-' + slug(tr.slug), name: trnName(lg, tr.slug, year), logo: lg.image } : { key: slug(lg.slug || lg.name) + '-' + year, name: (L && L.name ? L.name : lg.name) + ' ' + year, logo: lg.image },
    stage: ev.blockName || '', startTime: t0,
    state: ev.state === 'inProgress' ? 'live' : ev.state === 'completed' ? 'done' : 'upcoming',
    bestOf: m.strategy && m.strategy.count ? m.strategy.count : null, teams,
  };
}

async function leagueMatches(lg, { pages = 6, startYear = 2026 } = {}) {
  const game = lg.game || 'val', trns = game === 'lol' ? await lolTournaments(lg) : null;
  const first = await call('getSchedule', { leagueId: lg.id }, game);
  let events = [...(((first.schedule || {}).events) || [])];
  const pg = (first.schedule || {}).pages || {};
  for (const dir of ['older', 'newer']) {
    let token = pg[dir];
    for (let i = 0; token && i < pages; i++) {
      try { const p = (await call('getSchedule', { leagueId: lg.id, pageToken: token }, game)).schedule || {}; events = events.concat(p.events || []); token = p.pages && p.pages[dir]; } catch { break; }
    }
  }
  const seen = new Set(), out = [];
  for (const e of events) {
    if (e.type !== 'match' || !e.match || !e.startTime || seen.has(e.match.id)) continue;
    if (yearOf(Date.parse(e.startTime)) < startYear) continue;
    seen.add(e.match.id); out.push(toMatch(e, lg, startYear, trns));
  }
  return out;
}

// Tous les matchs des compétitions voulues (une ligue qui plante n'empêche pas les autres).
// Retourne { matches, leagues, errors } ; lève une erreur seulement si rien n'a pu être lu.
async function matches({ comps, extra = [], startYear = 2026 } = {}) {
  const wantLol = !comps || comps.some(c => LOL_COMPS.includes(c)), wantVal = !comps || comps.some(c => !LOL_COMPS.includes(c));
  const [va, lo] = await Promise.allSettled([wantVal ? leagues(extra) : [], wantLol ? lolLeagues() : []]);
  const all = [...(va.status === 'fulfilled' ? va.value : []), ...(lo.status === 'fulfilled' ? lo.value : [])].filter(l => !comps || comps.includes(l.comp));
  if (!all.length) { if (va.status === 'rejected') throw va.reason; if (lo.status === 'rejected') throw lo.reason; throw new Error('aucune ligue reconnue'); }
  const res = await Promise.allSettled(all.map(l => leagueMatches(l, { startYear })));
  const ok = res.filter(r => r.status === 'fulfilled'), errors = [va, lo].filter(r => r.status === 'rejected').map(r => 'ligues : ' + r.reason.message).concat(res.map((r, i) => r.status === 'rejected' ? all[i].name + ' : ' + r.reason.message : null).filter(Boolean));
  if (!ok.length) throw res[0].reason;
  return { matches: ok.flatMap(r => r.value).sort((a, b) => a.startTime - b.startTime), leagues: all.map(l => ({ slug: l.slug, name: l.name, comp: l.comp, game: l.game || 'val' })), errors };
}

// Équipes européennes : toutes celles vues dans les matchs des ligues EMEA (VCT EMEA et Game Changers EMEA).
function europeTeams(matches) {
  const by = new Map();
  for (const m of matches) {
    const eu = m.comp === 'emea' || (m.comp === 'gc' && /emea/i.test(m.league.slug + ' ' + m.league.name));
    if (!eu) continue;
    for (const t of m.teams) if (t.name && t.code !== 'TBD' && !by.has(t.name)) by.set(t.name, { code: t.code, name: t.name, logo: t.logo });
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

// Équipes LEC (seulement) : toutes celles vues dans les matchs LEC.
function lecTeams(matches) {
  const by = new Map();
  for (const m of matches) {
    if (m.comp !== 'lec') continue;
    for (const t of m.teams) if (t.name && t.code !== 'TBD' && !by.has(t.name)) by.set(t.name, { code: t.code, name: t.name, logo: t.logo, game: 'lol' });
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

// ----- Rediffusions : vidéos Twitch officielles de chaque manche -----
const langOf = v => String((v.mediaLocale && v.mediaLocale.locale) || v.locale || '??').split(/[-_]/)[0].toUpperCase();
const windowOf = v => {
  const s = v.startMillis != null ? Number(v.startMillis) / 1000 : v.offset != null ? Number(v.offset) : 0;
  const e = v.endMillis != null ? Number(v.endMillis) / 1000 : null;
  return { start: Math.max(0, s || 0), end: e && e > s ? e : null };
};
// [{ lang, parts: [{ v: idVidéoTwitch, s, e }] }] : une entrée par langue, avec les morceaux de vidéo qui couvrent le match
// (8 min avant la 1re manche, 3 min après la dernière). Les manches d'une même vidéo sont fusionnées.
async function replays(raw, game = 'val') {
  const ev = (await call('getEventDetails', { id: raw }, game)).event;
  const games = ((ev && ev.match && ev.match.games) || []).filter(g => g.state !== 'unneeded' && g.state !== 'unstarted').sort((a, b) => a.number - b.number);
  const byLang = new Map(), ytLang = new Map();
  for (const g of games) for (const v of g.vods || []) {
    if (!v.parameter) continue;
    if (v.provider === 'youtube') { // vidéos YouTube : une entrée par identifiant, dans l'ordre des manches
      const lang = langOf(v), list = ytLang.get(lang) || [], id = String(v.parameter); let it = list.find(x => x.id === id); if (!it) { it = { id, games: [] }; list.push(it); } if (g.number != null && !it.games.includes(g.number)) it.games.push(g.number); ytLang.set(lang, list); continue;
    }
    if (v.provider !== 'twitch') continue;
    const lang = langOf(v); if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang).push({ video: String(v.parameter), ...windowOf(v) });
  }
  for (const lang of ytLang.keys()) if (!byLang.has(lang)) byLang.set(lang, []);
  const out = [];
  for (const [lang, list] of byLang) {
    const parts = [], yt = ytLang.get(lang) || [];
    for (const g of list) { const last = parts[parts.length - 1]; if (last && last.v === g.video) last.e = g.end; else parts.push({ v: g.video, s: g.start, e: g.end }); }
    if (!parts.length && !yt.length) continue;
    if (parts.length) { parts[0].s = Math.max(0, parts[0].s - 8 * 60); const L = parts[parts.length - 1]; if (L.e != null) L.e += 3 * 60; }
    out.push({ lang, parts, yt });
  }
  return out.sort((a, b) => (a.lang === 'FR' ? 0 : a.lang === 'EN' ? 1 : 2) - (b.lang === 'FR' ? 0 : b.lang === 'EN' ? 1 : 2));
}

module.exports = { call, leagues, lolLeagues, classify, classifyLol, matches, europeTeams, lecTeams, replays, BASE, LOL_COMPS };
