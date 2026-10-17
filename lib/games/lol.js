'use strict';
// League of Legends : API publique de lolesports.com (celle qu'utilise le site).
// Calendrier : getSchedule par ligue ; rediffusions : getEventDetails (vidéos Twitch par manche, avec le moment où la manche commence).
const { yearOf, slug } = require('../model');

const API = 'https://esports-api.lolesports.com/persisted/gw';
const API_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z'; // clé publique du site lolesports.com
const TIMEOUT = 8000;
const START_YEAR = 2026;

// Ligues suivies (slug lolesports). Modifiable depuis le dashboard (réglage « leagues »).
const DEFAULT_LEAGUES = ['worlds', 'msi', 'first_stand', 'lec', 'lck'];
// Identifiants connus, utilisés si getLeagues ne répond pas.
const FALLBACK_IDS = { worlds: '98767975604431411', msi: '98767991325878492', lec: '98767991302996019', lck: '98767991310872058', lpl: '98767991314006698', lcs: '98767991299243165' };

async function call(path, params) {
  const r = await fetch(API + '/' + path + '?' + new URLSearchParams({ hl: 'fr-FR', ...params }), { headers: { 'x-api-key': API_KEY }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error('LoL Esports ' + path + ' : HTTP ' + r.status);
  const j = await r.json();
  return j.data || {};
}

let leaguesMemo = null;
async function leagues() {
  if (leaguesMemo && leaguesMemo.exp > Date.now()) return leaguesMemo.v;
  let v;
  try { v = ((await call('getLeagues', {})).leagues || []).map(l => ({ id: l.id, slug: l.slug, name: l.name, image: l.image })); } catch { v = Object.entries(FALLBACK_IDS).map(([s, id]) => ({ id, slug: s, name: s.toUpperCase(), image: null })); }
  leaguesMemo = { v, exp: Date.now() + 24 * 3600e3 };
  return v;
}

function toMatch(event, league) {
  const m = event.match, t0 = Date.parse(event.startTime), year = yearOf(t0);
  const teams = (m.teams || []).map(t => ({ name: t.name, code: t.code, logo: t.image ? String(t.image).replace(/^http:/, 'https:') : null, score: t.result ? t.result.gameWins : null, win: t.result ? t.result.outcome === 'win' : null }));
  const lg = event.league || league || {};
  return {
    id: 'lol~' + m.id, game: 'lol', raw: m.id, year,
    event: { key: slug(lg.slug || lg.name) + '-' + year, name: (lg.name || 'LoL') + ' ' + year, logo: league && league.image ? String(league.image).replace(/^http:/, 'https:') : null },
    stage: event.blockName || '',
    startTime: t0,
    state: event.state === 'inProgress' ? 'live' : event.state === 'completed' ? 'done' : 'upcoming',
    bestOf: m.strategy && m.strategy.count ? m.strategy.count : null,
    teams,
  };
}

async function leagueMatches(league) {
  const first = await call('getSchedule', { leagueId: league.id });
  let events = [...((first.schedule && first.schedule.events) || [])];
  const pages = (first.schedule && first.schedule.pages) || {};
  for (const dir of ['older', 'newer']) {
    let token = pages[dir];
    for (let i = 0; token && i < 8; i++) {
      try {
        const p = (await call('getSchedule', { leagueId: league.id, pageToken: token })).schedule || {};
        events = events.concat(p.events || []);
        token = p.pages && p.pages[dir];
      } catch { break; }
    }
  }
  const seen = new Set(), out = [];
  for (const e of events) {
    if (e.type !== 'match' || !e.match || !e.startTime || seen.has(e.match.id)) continue;
    if (yearOf(Date.parse(e.startTime)) < START_YEAR) continue;
    seen.add(e.match.id);
    out.push(toMatch(e, league));
  }
  return out;
}

// Tous les matchs des ligues suivies (une ligue qui plante n'empêche pas les autres).
async function matches(opts = {}) {
  const wanted = (opts.leagues && opts.leagues.length ? opts.leagues : DEFAULT_LEAGUES).map(s => String(s).toLowerCase());
  const all = await leagues();
  const picked = wanted.map(s => all.find(l => l.slug === s) || (FALLBACK_IDS[s] ? { id: FALLBACK_IDS[s], slug: s, name: s.toUpperCase() } : null)).filter(Boolean);
  const res = await Promise.allSettled(picked.map(leagueMatches));
  const ok = res.filter(r => r.status === 'fulfilled');
  if (!ok.length && res.length) throw res[0].reason;
  return ok.flatMap(r => r.value).sort((a, b) => a.startTime - b.startTime);
}

// ---- Rediffusions : vidéos Twitch officielles de chaque manche ----
const langOf = v => String(((v.mediaLocale && v.mediaLocale.locale) || v.locale || '??')).split(/[-_]/)[0].toUpperCase();
const windowOf = v => {
  const s = v.startMillis != null ? Number(v.startMillis) / 1000 : v.offset != null ? Number(v.offset) : 0;
  const e = v.endMillis != null ? Number(v.endMillis) / 1000 : null;
  return { start: Math.max(0, s || 0), end: e && e > s ? e : null };
};

// Retourne [{ lang, parts: [{ v, s, e }] }] : une entrée par langue, avec les morceaux de vidéos Twitch qui couvrent le match.
// Marge : 8 min avant la 1re manche (draft), 3 min après la dernière.
async function replays(match) {
  const ev = (await call('getEventDetails', { id: match.raw })).event;
  const games = ((ev && ev.match && ev.match.games) || []).filter(g => g.state !== 'unneeded' && g.state !== 'unstarted').sort((a, b) => a.number - b.number);
  const byLang = new Map();
  for (const g of games) {
    for (const v of g.vods || []) {
      if (v.provider !== 'twitch' || !v.parameter) continue;
      const lang = langOf(v);
      if (!byLang.has(lang)) byLang.set(lang, []);
      byLang.get(lang).push({ video: String(v.parameter), ...windowOf(v) });
    }
  }
  const out = [];
  for (const [lang, list] of byLang) {
    const parts = [];
    for (const g of list) {
      const last = parts[parts.length - 1];
      if (last && last.v === g.video) last.e = g.end; else parts.push({ v: g.video, s: g.start, e: g.end });
    }
    if (!parts.length) continue;
    parts[0].s = Math.max(0, parts[0].s - 8 * 60);
    const L = parts[parts.length - 1];
    if (L.e != null) L.e += 3 * 60;
    out.push({ lang, parts });
  }
  return out.sort((a, b) => (a.lang === 'FR' ? 0 : a.lang === 'EN' ? 1 : 2) - (b.lang === 'FR' ? 0 : b.lang === 'EN' ? 1 : 2));
}

module.exports = { id: 'lol', START_YEAR, DEFAULT_LEAGUES, matches, replays, leagues, toMatch };
