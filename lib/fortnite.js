'use strict';
// Fortnite : Majors (FNCS), championnat du monde (Global Championship) et Esports World Cup.
// Un tournoi Fortnite n'a pas de « A contre B » : chaque session (jour, finale…) devient un match « solo » dans le catalogue.
//   Sources : (1) l'API Osirion (clé enregistrée dans le dashboard) qui liste les tournois avec leurs horaires ;
//             (2) les événements ajoutés à la main dans le dashboard (pour les dates à venir).
const store = require('./store');
const { yearOf, slug } = require('./model');

const OSI = process.env.OSIRION_API || 'https://api.osirion.gg';
const COMPS = ['fnmajor', 'fnworld', 'fnewc'];
const DEF_PATTERNS = { fnmajor: 'major|fncs.?solo', fnworld: 'global.?champ|worlds', fnewc: 'ewc|esports.?world.?cup|world.?cup' };
const REGION_RE = /^(EU|NAE|NAW|NAC|NA|ASIA|BR|ME|OCE|GLOBAL|ALL)$/i;
const DEF_REGIONS = ['EU', 'GLOBAL', 'ALL'];

// ---------- clé Osirion (gardée côté serveur, jamais renvoyée au navigateur) ----------
async function getKey() { try { return String((await store.getKey('osirion')) || process.env.OSIRION_API_KEY || '').trim(); } catch { return String(process.env.OSIRION_API_KEY || '').trim(); } }
async function keyInfo() { const k = await getKey(); return { set: !!k, last4: k ? k.slice(-4) : '' }; }
async function setKey(k) { k = String(k || '').trim(); if (k) await store.setKey('osirion', k); else await store.delKey('osirion'); memo.clear(); stats.clear(); }

async function osi(path, key) {
  const r = await fetch(OSI + path, { headers: { Authorization: 'Bearer ' + key, 'User-Agent': 'Esportio/1.1' }, signal: AbortSignal.timeout(15000) });
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

// ---------- tournois Osirion ----------
const memo = new Map();
async function osirionWindows(startYear) {
  const key = await getKey(); if (!key) return [];
  const k = 'w|' + startYear, c = memo.get(k); if (c && c.exp > Date.now()) return c.v;
  const from = Math.floor(Date.UTC(startYear, 0, 1) / 1000), to = Math.floor((Date.now() + 90 * 864e5) / 1000), out = [];
  for (let i = 0; i < 6; i++) {
    const j = await osi('/fortnite/v1/tournaments?' + new URLSearchParams({ fromUnix: String(from), toUnix: String(to), limit: '200', fromIndex: String(i * 200) }), key);
    const l = j.tournaments || []; out.push(...l); if (l.length < 200) break;
  }
  memo.set(k, { v: out, exp: Date.now() + 30 * 60e3 });
  return out;
}

const compOf = (id, patterns) => { for (const c of ['fnewc', 'fnworld', 'fnmajor']) { try { if (new RegExp(patterns[c] || DEF_PATTERNS[c], 'i').test(id)) return c; } catch { /* motif invalide */ } } return null; };
const toMs = t => { const n = Number(t); return n < 1e12 ? n * 1000 : n; };

// Tous les matchs (sessions) Fortnite voulus. `F` = réglages du dashboard.
async function matches({ comps, startYear = 2026, F = {} } = {}) {
  const patterns = { ...DEF_PATTERNS, ...(F.patterns || {}) }, regions = (F.regions && F.regions.length ? F.regions : DEF_REGIONS).map(x => String(x).toUpperCase());
  const want = c => !comps || comps.includes(c), out = [], errors = [];
  try {
    const ws = await osirionWindows(startYear);
    for (const w of ws) {
      const id = String(w.eventId || '') + ' ' + String(w.eventWindowId || ''), comp = compOf(id, patterns);
      if (!comp || !want(comp)) continue;
      const n = names(w.eventId, w.eventWindowId);
      if (n.region && !regions.includes(n.region)) continue;
      const start = toMs(w.startTime), end = toMs(w.endTime) || start + 3 * 3600e3;
      if (!start) continue;
      out.push(mk({ raw: 'fn-' + safe(w.eventWindowId || w.eventId), comp, evKey: 'fn-' + slug(String(w.eventId).replace(/^epicgames_/i, '')), evName: n.evName, logo: (F.logos || {})[comp], stage: n.region ? n.region : '', name: n.session, start, end }));
      out[out.length - 1].windowId = String(w.eventWindowId || '');
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
  return { matches: out.sort((a, b) => a.startTime - b.startTime), errors };
}

// ---------- stats Osirion d'une session terminée : meilleurs joueurs ----------
const stats = new Map();
async function topPlayers(windowId) {
  if (!windowId) return null;
  const c = stats.get(windowId); if (c && c.exp > Date.now()) return c.v;
  const key = await getKey(); if (!key) return null;
  let v = null;
  try {
    const j = await osi('/fortnite/v1/tournaments/stats?' + new URLSearchParams({ eventWindowId: windowId, orderBy: 'eliminations', orderByDescending: 'true', limit: '5' }), key);
    v = (j.players || []).slice(0, 5).map(p => ({ name: p.epicUsername || p.epicId, elims: Math.round(Number(p.eliminations) || 0), place: p.avgPlacement ? Math.round(Number(p.avgPlacement) * 10) / 10 : null, games: Number(p.matchesPlayed) || 0 }));
  } catch { v = null; }
  stats.set(windowId, { v, exp: Date.now() + (v ? 24 * 3600e3 : 10 * 60e3) }); if (stats.size > 100) stats.delete(stats.keys().next().value);
  return v;
}

// Test de la clé depuis le dashboard.
async function test() {
  const key = await getKey(); if (!key) return { ok: false, error: 'Aucune clé enregistrée.' };
  try {
    const j = await osi('/fortnite/v1/tournaments?' + new URLSearchParams({ fromUnix: String(Math.floor((Date.now() - 60 * 864e5) / 1000)), toUnix: String(Math.floor(Date.now() / 1000)), limit: '50' }), key);
    const l = j.tournaments || [];
    return { ok: true, n: l.length, exemple: l.slice(0, 4).map(x => x.eventWindowId) };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { COMPS, DEF_PATTERNS, DEF_REGIONS, matches, topPlayers, keyInfo, setKey, test, parisToMs, names, compOf, getKey };
