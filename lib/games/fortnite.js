'use strict';
// Fortnite : pas de « A contre B » (battle royale). Un événement (FNCS, Cash Cup, Champion Series…) = une série de journées.
// Chaque journée est un épisode (« solo »: une seule affiche avec le logo de l'événement). Source : liste des tournois Liquipedia.
const lp = require('../liquipedia');
const { slug } = require('../model');

const DAY = 86400e3, MAX_DAYS = 10;
async function matches(opts = {}) {
  const now = opts.now || Date.now();
  const html = await lp.page('fortnite', 'Portal:Tournaments');
  const out = [];
  for (const t of lp.tournamentList(html, { fallbackYear: new Date(now).getUTCFullYear() })) {
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
  return out.filter(m => m.year >= 2026).sort((a, b) => a.startTime - b.startTime);
}

module.exports = { id: 'fortnite', accumulate: true, matches };
