'use strict';
// Rocket League : calendrier lu sur Liquipedia (RLCS et tous les événements listés). Même principe que Valorant en repli :
// Liquipedia ne garde que peu de matchs terminés, le serveur accumule l'historique (index.js, `accumulate`).
const lp = require('../liquipedia');

const PAGES = ['Liquipedia:Matches', 'Liquipedia:Upcoming_and_ongoing_matches'];
async function matches() {
  let lastErr;
  for (const title of PAGES) {
    try { const list = lp.tickerAny(await lp.page('rocketleague', title), { game: 'rocketleague' }); if (list.length) return list; } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Liquipedia rocketleague : aucun match reconnu');
}

module.exports = { id: 'rocketleague', accumulate: true, matches };
