'use strict';
// Valorant : calendrier lu sur Liquipedia (matchs à venir, en cours et récemment terminés, tous événements confondus).
// Liquipedia ne garde que quelques jours de matchs terminés : le serveur accumule l'historique (voir index.js, `accumulate`).
const lp = require('../liquipedia');

const PAGES = ['Liquipedia:Upcoming_and_ongoing_matches', 'Liquipedia:Matches'];
async function matches() {
  let lastErr;
  for (const title of PAGES) {
    try {
      const list = lp.matchTicker(await lp.page('valorant', title), { game: 'valorant' });
      if (list.length) return list;
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return [];
}

module.exports = { id: 'valorant', accumulate: true, matches };
