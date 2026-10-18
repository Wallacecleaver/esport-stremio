'use strict';
// Fortnite : API publique d'Osirion (beta, sans clé) — https://fnapi.osirion.gg/v1/tournaments?region=EU
// Battle royale : pas de « A contre B ». Un tournoi (Cash Cup, Ranked Cup, FNCS…) = une saison, chaque session (fenêtre d'événement) = un épisode.
// Repli sur la liste des tournois de Liquipedia si l'API ne répond pas.
const lp = require('../liquipedia');
const { slug } = require('../model');

const API = 'https://fnapi.osirion.gg';
const REGIONS = ['OCE', 'ASIA', 'ME', 'EU', 'BR', 'NAC', 'NAE', 'NAW', 'ONSITE'];
const DEFAULT_REGIONS = ['EU'];
// « En direct & à venir » : les gros tournois ; catalogue annuel : seulement les plus gros (finale mondiale, EWC, majeurs). Réglables dans le dashboard.
const DEFAULT_LIVE_KW = ['fncs', 'global championship', 'world cup', 'ewc', 'major', 'champion series'];
const DEFAULT_CAT_KW = ['global championship', 'world cup', 'ewc', 'major'];
const norm = x => String(x || '').toLowerCase().replace(/[_-]+/g, ' ');
const hit = (m, kw) => { const t = norm(m.event.name + ' ' + (m.tid || '')); return kw.some(k => t.includes(k)); };
// Garde les gros tournois et marque ceux qui vont dans le catalogue annuel.
function filterBig(list, liveKw, catKw) {
  const lk = (liveKw && liveKw.length ? liveKw : DEFAULT_LIVE_KW).map(norm), ck = (catKw && catKw.length ? catKw : DEFAULT_CAT_KW).map(norm);
  return list.filter(m => hit(m, lk) || hit(m, ck)).map(m => ({ ...m, inCatalog: hit(m, ck) }));
}
// Tournois gardés : le nom contient un des mots-clés ET aucun des mots exclus (réglable dans le dashboard).
const DEFAULT_KEYWORDS = ['fncs', 'global championship', 'major', 'world cup', 'ewc'];
const DEFAULT_EXCLUDE = ['qualifier', 'cash cup', 'ranked cup', 'reload', 'scrim'];
const keep = (name, kw, ex) => { const t = String(name).toLowerCase(); return kw.some(k => t.includes(k)) && !ex.some(k => t.includes(k)); };
const filterOf = o => ({ kw: (o.keywords && o.keywords.length ? o.keywords : DEFAULT_KEYWORDS), ex: o.exclude || DEFAULT_EXCLUDE });

const imgOf = d => { const u = d && (d.squarePosterImage || d.posterFrontImage || d.playlistTileImage || d.tournamentViewBackgroundImage || d.loadingScreenImage); return u && /^https?:/.test(u) ? u : null; };
const titleOf = (d, t) => String((d && (d.longFormatTitle || [d.titleLine1, d.titleLine2].filter(Boolean).join(' ') || d.backgroundTitle)) || t.eventGroup || t.eventId || 'Tournoi Fortnite').replace(/\s+/g, ' ').trim();

// Réponse de l'API → sessions (une par fenêtre d'événement)
function fromApi(json, region, now = Date.now(), f = filterOf({})) {
  const out = [];
  for (const t of (json && json.tournaments) || []) {
    const d = t.displayData || {}, name = titleOf(d, t);
    if (!keep(name, f.kw, f.ex)) continue;
    const logo = imgOf(d), wins = (t.eventWindows || []).slice().sort((a, b) => Date.parse(a.beginTime) - Date.parse(b.beginTime));
    wins.forEach((w, i) => {
      const s = Date.parse(w.beginTime), e = Date.parse(w.endTime);
      if (!s) return;
      const year = new Date(s).getUTCFullYear(), end = e && e > s ? e : s + 3 * 3600e3;
      const rn = d.roundNames && d.roundNames[(Number(w.round) || i + 1) - 1];
      const raw = region.toLowerCase() + '-' + slug(w.eventWindowId || t.eventId + '-' + i);
      out.push({
        id: 'fortnite~' + raw, game: 'fortnite', raw, year, solo: true, tid: [t.eventGroup, t.eventId].filter(Boolean).join(' '),
        event: { key: slug(name) + '-' + year, name, logo },
        stage: [rn || (wins.length > 1 ? 'Session ' + (i + 1) : ''), REGIONS.includes(region) && region !== 'EU' ? region : ''].filter(Boolean).join(' · '),
        startTime: s, span: { from: s - 10 * 60e3, to: end + 30 * 60e3 }, endTime: end,
        state: now >= end ? 'done' : now >= s ? 'live' : 'upcoming', bestOf: null, teams: [],
      });
    });
  }
  return out;
}

async function official(opts = {}) {
  const regions = (opts.regions && opts.regions.length ? opts.regions : DEFAULT_REGIONS).map(r => String(r).toUpperCase()).filter(r => REGIONS.includes(r));
  const res = await Promise.allSettled((regions.length ? regions : DEFAULT_REGIONS).map(async r => {
    const x = await fetch(API + '/v1/tournaments?' + new URLSearchParams({ region: r, includeHistoricData: 'true' }), { headers: { Accept: 'application/json', 'User-Agent': lp.UA }, signal: AbortSignal.timeout(9000) });
    if (!x.ok) throw new Error('Osirion Fortnite : HTTP ' + x.status);
    return fromApi(await x.json(), r, opts.now, filterOf(opts));
  }));
  const ok = res.filter(r => r.status === 'fulfilled');
  if (!ok.length) throw res[0].reason;
  const seen = new Set();
  const all = ok.flatMap(r => r.value).filter(m => m.year >= 2026 && !seen.has(m.id) && seen.add(m.id)).sort((a, b) => a.startTime - b.startTime);
  return opts.all ? all : filterBig(all, opts.liveKw, opts.catKw);
}

// Repli : liste de tournois Liquipedia (une journée = un épisode, horaires à la journée)
const DAY = 86400e3, MAX_DAYS = 10;
async function liquipedia(opts = {}) {
  const now = opts.now || Date.now();
  const html = await lp.page('fortnite', 'Portal:Tournaments');
  const out = [];
  const f = filterOf(opts);
  for (const t of lp.tournamentList(html, { fallbackYear: new Date(now).getUTCFullYear() })) {
    if (!keep(t.name, f.kw, f.ex)) continue;
    const days = Math.min(MAX_DAYS, Math.round((t.to - t.from) / DAY) + 1), year = new Date(t.from).getUTCFullYear();
    for (let i = 0; i < days; i++) {
      const d0 = t.from + i * DAY, iso = new Date(d0).toISOString().slice(0, 10), raw = slug(t.name) + '-' + iso;
      out.push({
        id: 'fortnite~' + raw, game: 'fortnite', raw, year, solo: true, allDay: true,
        event: { key: slug(t.name) + '-' + year, name: t.name, logo: t.logo }, stage: days > 1 ? 'Jour ' + (i + 1) + '/' + days : '',
        startTime: d0 + 12 * 3600e3, span: { from: d0 + 6 * 3600e3, to: d0 + DAY + 2 * 3600e3 },
        state: now >= d0 + DAY ? 'done' : now >= d0 ? 'live' : 'upcoming', bestOf: null, teams: [],
      });
    }
  }
  return filterBig(out.filter(m => m.year >= 2026).sort((a, b) => a.startTime - b.startTime), opts.liveKw, opts.catKw);
}

async function matches(opts = {}) {
  try { const m = await official({ regions: opts.fnRegions, keywords: opts.fnKeywords, exclude: opts.fnExclude, now: opts.now }); if (m.length) return m; } catch (e) { try { return await liquipedia(opts); } catch { throw e; } }
  return liquipedia(opts);
}

module.exports = { DEFAULT_KEYWORDS, DEFAULT_EXCLUDE, id: 'fortnite', accumulate: true, matches, official, liquipedia, fromApi, REGIONS };
