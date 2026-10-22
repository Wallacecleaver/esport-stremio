'use strict';
// Modèle commun.
// Match : { id, raw, year, comp, league: { slug, name, image }, event: { key, name }, stage, startTime (ms), state ('upcoming'|'live'|'done'),
//           bestOf, teams: [{ name, code, logo, score, win }] }
const TZ = 'Europe/Paris';

const yearOf = ms => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric' }).format(new Date(ms)));
const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const TBD = { name: 'À déterminer', code: 'TBD', logo: null, score: null, win: null };
const teamsOf = m => [m.teams[0] || TBD, m.teams[1] || TBD];
const shortOf = t => (t.code && t.code !== 'TBD' ? t.code : t.name);

// Une des équipes favorites joue-t-elle ce match ? (nom ou code, sans accents ni ponctuation)
function hasTeam(match, favs) {
  if (!favs || !favs.length) return false;
  const set = new Set(favs.map(norm));
  return match.teams.some(t => set.has(norm(t.code)) || set.has(norm(t.name)));
}

const fmt = (ms, o) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, ...o }).format(new Date(ms));
const fmtDay = ms => cap(fmt(ms, { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', ''));
const fmtHour = ms => fmt(ms, { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
const fmtDate = ms => fmtDay(ms) + ' · ' + fmtHour(ms);
const fmtShort = ms => fmt(ms, { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtN = n => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',').replace(',0', '') + ' M' : n >= 1e4 ? Math.round(n / 1e3) + ' k' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.', ',').replace(',0', '') + ' k' : String(n); };

const matchTitle = m => { const [a, b] = teamsOf(m); return shortOf(a) + ' vs ' + shortOf(b); };
const key = m => 'val:m:' + m.raw;               // identifiant Stremio d'un match
const parseKey = id => { const x = /^val:m:([\w-]+)/.exec(String(id)); return x ? x[1] : null; };

// Regroupe les matchs d'une année en saisons (= une compétition de l'année), dans l'ordre chronologique.
// Retourne [{ n, event, matches }] ; l'épisode d'un match = son rang dans la saison.
function seasonsOf(matches, year) {
  const by = new Map();
  for (const m of matches) {
    if (m.year !== year) continue;
    if (!by.has(m.event.key)) by.set(m.event.key, { event: m.event, matches: [] });
    by.get(m.event.key).matches.push(m);
  }
  const list = [...by.values()];
  for (const s of list) s.matches.sort((a, b) => a.startTime - b.startTime || String(a.raw).localeCompare(String(b.raw)));
  list.sort((a, b) => a.matches[0].startTime - b.matches[0].startTime);
  return list.map((s, i) => ({ n: i + 1, ...s }));
}

// « En direct & à venir » : en cours d'abord, puis les prochains.
function upcomingList(matches, { upcoming = 24, now = Date.now() } = {}) {
  const live = matches.filter(m => m.state === 'live').sort((a, b) => a.startTime - b.startTime);
  const next = matches.filter(m => m.state === 'upcoming' && m.startTime > now - 6 * 3600e3).sort((a, b) => a.startTime - b.startTime).slice(0, upcoming);
  return [...live, ...next];
}
const doneList = (matches, n = 60) => matches.filter(m => m.state === 'done').sort((a, b) => b.startTime - a.startTime).slice(0, n);

module.exports = { TZ, yearOf, slug, norm, cap, TBD, teamsOf, shortOf, hasTeam, fmtDay, fmtHour, fmtDate, fmtShort, fmtN, matchTitle, key, parseKey, seasonsOf, upcomingList, doneList };
