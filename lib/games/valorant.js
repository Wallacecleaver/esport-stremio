'use strict';
// Valorant : source officielle valorantesports.com (même passerelle que lolesports, sport = val), tous les championnats proposés.
// Repli sur Liquipedia si la source officielle ne répond pas. Un championnat/événement = une saison.
const lol = require('./lol');
const lp = require('../liquipedia');

const API = { base: 'https://esports-api.service.valorantesports.com/persisted/val', extra: { sport: 'val' } };

// Championnats gardés : ceux dont le nom contient un des mots-clés (réglable dans le dashboard) ; challengers, académies, universitaires exclus.
const DEFAULT_KEYWORDS = ['vct', 'champions', 'game changers', 'masters', 'world cup', 'ewc'];
const EXCLUDE = /challengers|ascension|collegiate|academy|academie|universit/i;
const keep = (l, kw) => { const t = (l.name + ' ' + l.slug).toLowerCase().replace(/_/g, ' '); return !EXCLUDE.test(t) && kw.some(k => t.includes(k)); };

async function official(opts = {}) {
  const kw = opts.keywords && opts.keywords.length ? opts.keywords : DEFAULT_KEYWORDS;
  const all = (await lol.leagues(API)).filter(l => keep(l, kw));
  if (!all.length) throw new Error('Valorant Esports : aucune ligue');
  const res = await Promise.allSettled(all.map(l => lol.leagueMatches(l, { game: 'valorant', api: API, pages: 3 })));
  const ok = res.filter(r => r.status === 'fulfilled');
  if (!ok.length) throw res[0].reason;
  return ok.flatMap(r => r.value).sort((a, b) => a.startTime - b.startTime);
}

const PAGES = ['Liquipedia:Upcoming_and_ongoing_matches', 'Liquipedia:Matches'];
async function liquipedia() {
  let lastErr;
  for (const title of PAGES) {
    try { const list = lp.tickerAny(await lp.page('valorant', title), { game: 'valorant' }); if (list.length) return list; } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Liquipedia valorant : aucun match reconnu');
}

async function matches(opts = {}) {
  try { const m = await official({ keywords: opts.valKeywords }); if (m.length) return m; } catch (e) { try { return await liquipedia(); } catch { throw e; } }
  return liquipedia();
}

module.exports = { id: 'valorant', accumulate: true, matches, replays: m => lol.replays(m, API), official, liquipedia };
