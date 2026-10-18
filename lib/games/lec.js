'use strict';
// LEC : catalogue à part. Même source que LoL (lolesports), mais une saison = un split (Hiver, Printemps, Été…).
// Les splits viennent de getTournamentsForLeague ; chaque match est rattaché au split dont les dates le contiennent.
const lol = require('./lol');
const { slug, yearOf } = require('../model');

const SPLIT_NAMES = [[/winter|hiver/, 'Hiver'], [/spring|printemps/, 'Printemps'], [/summer|ete/, 'Été'], [/final/, 'Finales'], [/versus|vs/, 'Versus'], [/season/, 'Saison']];
const splitName = s => { const k = slug(s); const f = SPLIT_NAMES.find(([re]) => re.test(k)); return f ? f[1] : String(s || '').replace(/^lec[_ -]?/i, '').replace(/[_-]?\d{4}$/, '').replace(/[_-]+/g, ' ').trim() || 'Saison'; };

async function tournaments(leagueId) {
  try {
    const d = await lol.call('getTournamentsForLeague', { leagueId });
    const t = ((d.leagues || [])[0] || {}).tournaments || [];
    return t.map(x => ({ id: x.id, slug: x.slug, start: Date.parse(x.startDate), end: Date.parse(x.endDate) + 86400e3 })).filter(x => x.start).sort((a, b) => a.start - b.start);
  } catch { return []; }
}

async function matches() {
  const all = await lol.leagues();
  const league = all.find(l => l.slug === 'lec') || { id: lol.FALLBACK_IDS.lec, slug: 'lec', name: 'LEC' };
  const tours = await tournaments(league.id);
  const logo = league.image ? String(league.image).replace(/^http:/, 'https:') : null;
  const event = (t0, lg, year) => {
    // dernier split commencé avant le match (les finales d'un split dépassent parfois sa date de fin annoncée)
    const t = [...tours].reverse().find(x => yearOf(x.start) === year && t0 >= x.start - 86400e3);
    const name = t ? splitName(t.slug) : 'Saison';
    return { key: 'lec-' + year + '-' + slug(t ? t.slug : 'saison'), name: 'LEC ' + name + ' ' + year, logo };
  };
  return (await lol.leagueMatches(league, { game: 'lec', event })).sort((a, b) => a.startTime - b.startTime);
}

module.exports = { id: 'lec', matches, replays: lol.replays, splitName };
