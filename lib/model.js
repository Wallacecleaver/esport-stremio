'use strict';
// Modèle commun à tous les jeux.
//
// Match : { id, game, raw, year, event: { key, name }, stage, startTime (ms), state ('upcoming'|'live'|'done'),
//           bestOf, teams: [{ name, code, logo, score, win }] }
//
// Catalogue : un catalogue par jeu et par année. Dans Stremio :
//   série  = « <Jeu> <année> »          (ex. League of Legends 2026)
//   saison = un événement de l'année    (ex. saison 1 = MSI, saison 2 = Worlds), dans l'ordre chronologique
//   épisode = un match
const TZ = 'Europe/Paris';

const yearOf = ms => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric' }).format(new Date(ms)));
const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// identifiant public d'un match : "lol~<id lolesports>"
const keyOf = m => m.game + '~' + m.raw;
const parseKey = k => { const i = String(k).indexOf('~'); return i < 0 ? null : { game: k.slice(0, i), raw: k.slice(i + 1) }; };

const TBD = { name: 'À déterminer', code: 'TBD', logo: null, score: null, win: null };
const teamsOf = m => [m.teams[0] || TBD, m.teams[1] || TBD];
const shortOf = t => (t.code && t.code !== 'TBD' ? t.code : t.name);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// Une équipe favorite (nom ou code) correspond-elle à ce match ?
function hasTeam(match, favs) {
  if (!favs || !favs.length) return false;
  const set = new Set(favs.map(norm));
  return match.teams.some(t => set.has(norm(t.code)) || set.has(norm(t.name)));
}

const fmtDate = (ms, opts) => {
  const s = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...opts }).format(new Date(ms));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const fmtHour = ms => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(ms)).replace(':', 'h');
const fmtDay = ms => { const s = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(ms)).replace('.', ''); return s.charAt(0).toUpperCase() + s.slice(1); };

const matchTitle = m => { const [a, b] = teamsOf(m); return shortOf(a) + ' vs ' + shortOf(b); };

// Regroupe les matchs d'une année en saisons (événements) triés par date de début.
// Retourne [{ n, event, matches }] ; les matchs sont triés par date, l'épisode = rang dans la saison.
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

// Catalogue « en direct & à venir » : en cours d'abord, puis les prochains ; `past` = derniers terminés.
function upcomingList(matches, { upcoming = 24, past = 0, now = Date.now() } = {}) {
  const live = matches.filter(m => m.state === 'live').sort((a, b) => a.startTime - b.startTime);
  const next = matches.filter(m => m.state === 'upcoming' && m.startTime > now - 6 * 3600e3).sort((a, b) => a.startTime - b.startTime).slice(0, upcoming);
  const done = past ? matches.filter(m => m.state === 'done').sort((a, b) => b.startTime - a.startTime).slice(0, past) : [];
  return [...live, ...next, ...done];
}

module.exports = { TZ, yearOf, slug, keyOf, parseKey, TBD, teamsOf, shortOf, norm, hasTeam, fmtDate, fmtHour, fmtDay, matchTitle, seasonsOf, upcomingList };
