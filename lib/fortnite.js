'use strict';
// Fortnite : Majors (FNCS), championnat du monde (Global Championship) et Esports World Cup.
// Un tournoi Fortnite n'a pas de « A contre B » : chaque session (jour, finale…) devient un match « solo » dans le catalogue.
//   Sources : (1) l'API publique Osirion (fnapi.osirion.gg, sans clé en bêta ; une clé facultative peut être mise dans le dashboard) qui liste les tournois avec leurs horaires ;
//             (2) les événements ajoutés à la main dans le dashboard (pour les dates à venir).
const store = require('./store');
const { yearOf, slug } = require('./model');

const OSI = process.env.OSIRION_API || 'https://fnapi.osirion.gg';
const COMPS = ['fnmajor', 'fnworld', 'fnewc'];
const DEF_PATTERNS = { fnmajor: 'major|fncs.?solo', fnworld: 'global.?champ|worlds', fnewc: 'ewc|esports.?world.?cup|world.?cup' };
const REGION_RE = /^(EU|NAE|NAW|NAC|NA|ASIA|BR|ME|OCE|GLOBAL|ALL)$/i;
const DEF_REGIONS = ['EU', 'ONSITE'];

// ---------- clé Osirion (gardée côté serveur, jamais renvoyée au navigateur) ----------
async function getKey() { try { return String((await store.getKey('osirion')) || process.env.OSIRION_API_KEY || '').trim(); } catch { return String(process.env.OSIRION_API_KEY || '').trim(); } }
async function keyInfo() { const k = await getKey(); return { set: !!k, last4: k ? k.slice(-4) : '' }; }
async function setKey(k) { k = String(k || '').trim(); if (k) await store.setKey('osirion', k); else await store.delKey('osirion'); memo.clear(); stats.clear(); }

async function osi(path, key) {
  const r = await fetch(OSI + path, { headers: { ...(key ? { api_key: key } : {}), 'User-Agent': 'Esportio/1.2' }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Osirion : ' + (j && j.message ? String(j.message).slice(0, 120) : 'HTTP ' + r.status));
  return j;
}

// ---------- noms lisibles ----------
const pretty = s => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/\s+/g, ' ').trim();
function names(eventId, windowId) {
  const tok = s => String(s || '').replace(/^epicgames_/i, '').split(/[_-]+/).filter(Boolean);
  const et = tok(eventId), wt = tok(windowId);
  const region = (et.concat(wt).find(t => REGION_RE.test(t)) || '').toUpperCase();
  const keep = t => !/^S\d+$/i.test(t) && !REGION_RE.test(t);
  const evName = pretty(et.filter(keep).join(' ')) || pretty(eventId);
  // la session = ce que la fenêtre ajoute à l'événement (Day 1, Finals…)
  const extra = wt.filter(t => keep(t) && !et.map(x => x.toLowerCase()).includes(t.toLowerCase()));
  let session = pretty(extra.join(' '));
  if (!session) session = pretty(wt.filter(keep).join(' ')) || evName;
  return { evName, session, region };
}

// ---------- calendrier de Paris (pour les dates saisies dans le dashboard) ----------
function parisToMs(str) {
  const s = String(str || '').trim(); if (!s) return null;
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) { const t = Date.parse(s); return isNaN(t) ? null : t; }
  const guess = Date.parse(s.replace(' ', 'T') + 'Z'); if (isNaN(guess)) return null;
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess)).reduce((a, p) => (a[p.type] = p.value, a), {});
  const asUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return guess - (asUtc - guess);
}

const stateOf = (start, end, now = Date.now()) => (now < start ? 'upcoming' : now <= end + 20 * 60e3 ? 'live' : 'done');
const safe = s => String(s).replace(/[^\w-]/g, '_').slice(0, 80);

function mk({ raw, comp, evKey, evName, logo, stage, name, start, end, channels }) {
  const year = yearOf(start);
  return {
    id: 'fn~' + raw, raw, game: 'fn', solo: true, year, comp, channels: channels || null,
    league: { slug: comp, name: evName, image: logo || null },
    event: { key: evKey, name: evName + (new RegExp(String(year)).test(evName) ? '' : ' ' + year), logo: logo || null },
    stage: stage || '', startTime: start, endTime: end, state: stateOf(start, end), bestOf: null,
    teams: [{ name, code: '', logo: logo || null, score: null, win: null }],
  };
}

// ---------- tournois Osirion (API publique bêta fnapi.osirion.gg, sans clé) ----------
const memo = new Map();
const API_REGIONS = ['EU', 'ONSITE'];   // EU = tournois européens, ONSITE = finales sur place (Global Championship, EWC…)
async function osirionWindows(regions) {
  const out = [], key = await getKey();
  for (const r of regions) {
    const k = 'w|' + r, c = memo.get(k); if (c && c.exp > Date.now()) { out.push(...c.v); continue; }
    const j = await osi('/v1/tournaments?' + new URLSearchParams({ region: r, includeHistoricData: 'true' }), key);
    const v = (j.tournaments || []).map(t => ({ ...t, apiRegion: r }));
    memo.set(k, { v, exp: Date.now() + 30 * 60e3 }); out.push(...v);
  }
  return out;
}

const compOf = (id, patterns) => { for (const c of ['fnewc', 'fnworld', 'fnmajor']) { try { if (new RegExp(patterns[c] || DEF_PATTERNS[c], 'i').test(id)) return c; } catch { /* motif invalide */ } } return null; };
const ms = t => { const n = Date.parse(t); return isNaN(n) ? 0 : n; };
const httpsImg = u => (/^https:\/\//.test(String(u || '')) ? String(u) : null);

// Tous les matchs (sessions) Fortnite voulus. `F` = réglages du dashboard.
async function matches({ comps, startYear = 2026, F = {} } = {}) {
  const patterns = { ...DEF_PATTERNS, ...(F.patterns || {}) }, regions = (F.regions && F.regions.length ? F.regions : DEF_REGIONS).map(x => String(x).toUpperCase());
  const want = c => !comps || comps.includes(c), out = [], errors = [], since = Date.UTC(startYear, 0, 1);
  try {
    for (const t of await osirionWindows(API_REGIONS)) {
      const dd = t.displayData || {}, title = String(dd.longFormatTitle || [dd.titleLine1, dd.titleLine2].filter(Boolean).join(' ') || '').trim();
      const comp = compOf([t.eventId, t.eventGroup, title].join(' '), patterns);
      if (!comp || !want(comp)) continue;
      const regs = (t.regions || []).map(x => String(x).toUpperCase());
      if (regs.length && !regs.some(x => regions.includes(x)) && !regions.includes('ALL')) continue;
      const base = names(t.eventId, ''), evName = title || base.evName, logo = (F.logos || {})[comp] || httpsImg(dd.squarePosterImage);
      for (const w of t.eventWindows || []) {
        const start = ms(w.beginTime), end = ms(w.endTime) || start + 3 * 3600e3;
        if (!start || end < since) continue;
        const n = names(t.eventId, w.eventWindowId), rn = (dd.roundNames || [])[w.round];
        const sl = (w.scoreLocations || []).find(x => x.isMain) || (w.scoreLocations || [])[0];
        const m = mk({ raw: 'fn-' + safe(w.eventWindowId || t.eventId), comp, evKey: 'fn-' + slug(String(t.eventId).replace(/^epicgames_/i, '')), evName, logo, stage: regs.length === 1 ? regs[0] : '', name: n.session !== n.evName ? n.session : (rn || n.session), start, end });
        m.windowId = String(w.eventWindowId || ''); if (sl) m.lb = { e: sl.leaderboardEventId, w: sl.leaderboardEventWindowId };
        out.push(m);
      }
    }
  } catch (e) { errors.push(e.message); }
  // événements ajoutés à la main
  for (const ev of F.events || []) {
    if (!want(ev.comp)) continue;
    const evKey = 'fn-m-' + slug(ev.id || ev.name);
    (ev.sessions || []).forEach((s, i) => {
      const start = parisToMs(s.start); if (!start) return;
      const end = parisToMs(s.end) || start + 3 * 3600e3;
      out.push(mk({ raw: 'fn-m-' + safe((ev.id || slug(ev.name)) + '-' + i), comp: ev.comp, evKey, evName: ev.name, logo: ev.logo || (F.logos || {})[ev.comp], stage: s.stage || '', name: s.name || 'Session ' + (i + 1), start, end, channels: ev.channels }));
    });
  }
  const seen = new Set(), uniq = out.filter(m => !seen.has(m.raw) && seen.add(m.raw));
  return { matches: uniq.sort((a, b) => a.startTime - b.startTime), errors };
}

// ---------- classement d'une session terminée : le haut du tableau ----------
const stats = new Map();
async function topPlayers(lb) {
  if (!lb || !lb.e || !lb.w) return null;
  const id = lb.e + '|' + lb.w, c = stats.get(id); if (c && c.exp > Date.now()) return c.v;
  let v = null;
  try {
    const j = await osi('/v1/tournaments/leaderboard?' + new URLSearchParams({ leaderboardEventId: lb.e, leaderboardEventWindowId: lb.w, page: '0' }), await getKey());
    v = ((j.leaderboard || {}).entries || []).slice(0, 5).map(e => ({ name: (e.players || []).map(p => p.username).filter(Boolean).join(' & ') || 'Équipe ' + e.rank, rank: e.rank, score: Math.round(Number(e.score) || 0) })).filter(p => p.name);
  } catch { v = null; }
  stats.set(id, { v, exp: Date.now() + (v ? 24 * 3600e3 : 10 * 60e3) }); if (stats.size > 100) stats.delete(stats.keys().next().value);
  return v;
}

// Test depuis le dashboard : l'API répond-elle, et quels tournois voit-on ?
async function test() {
  try {
    memo.clear();
    const l = await osirionWindows(API_REGIONS), ids = l.map(t => t.eventId);
    return { ok: true, n: l.length, exemple: ids.slice(-6), cles: l.length ? undefined : 'aucun tournoi renvoyé' };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { COMPS, DEF_PATTERNS, DEF_REGIONS, matches, topPlayers, keyInfo, setKey, test, parisToMs, names, compOf, getKey };
