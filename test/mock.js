'use strict';
// Faux serveurs pour tester sans réseau : passerelle valorantesports.com + GQL Twitch.   node test/mock.js <port>
const http = require('http');
const now = Date.now(), H = 3600e3;
const img = n => 'http://127.0.0.1:1/' + n + '.png';
const T = (code, name, w) => ({ code, name, image: img(code), result: w == null ? null : { gameWins: w, outcome: w >= 2 ? 'win' : 'loss' } });
const L = [{ id: '1', slug: 'vct-emea', name: 'VCT EMEA' }, { id: '2', slug: 'champions', name: 'VALORANT Champions' }, { id: '3', slug: 'game-changers-emea', name: 'VCT Game Changers EMEA' }, { id: '4', slug: 'vct-americas', name: 'VCT Americas' }, { id: '5', slug: 'challengers-emea', name: 'Challengers EMEA' }, { id: '6', slug: 'ewc', name: 'Esports World Cup' }];
const ev = (id, dt, st, a, b, wa, wb, block) => ({ type: 'match', startTime: new Date(now + dt).toISOString(), state: st, blockName: block, match: { id, teams: [T(a[0], a[1], wa), T(b[0], b[1], wb)], strategy: { type: 'bestOf', count: 3 } } });
const SCH = {
  1: [ev('101', -30 * 24 * H, 'completed', ['FNC', 'Fnatic'], ['TH', 'Team Heretics'], 2, 1, 'Semaine 1'), ev('102', -2 * 24 * H, 'completed', ['VIT', 'Team Vitality'], ['KC', 'Karmine Corp'], 0, 2, 'Semaine 3'), ev('103', -0.2 * H, 'inProgress', ['FNC', 'Fnatic'], ['M8', 'Gentle Mates'], 1, 0, 'Semaine 4'), ev('104', 2 * 24 * H, 'unstarted', ['NAVI', 'Natus Vincere'], ['TL', 'Team Liquid'], null, null, 'Semaine 4')],
  2: [ev('201', -10 * 24 * H, 'completed', ['EDG', 'EDward Gaming'], ['PRX', 'Paper Rex'], 3, 0, 'Finale')],
  3: [ev('301', 1 * 24 * H, 'unstarted', ['GX', 'Giants Gaming'], ['FUT', 'FUT Esports'], null, null, 'Groupes')],
  4: [ev('401', 1 * 24 * H, 'unstarted', ['SEN', 'Sentinels'], ['C9', 'Cloud9'], null, null, '')], 5: [ev('501', 1 * H, 'unstarted', ['A', 'A'], ['B', 'B'], null, null, '')], 6: [ev('601', 5 * 24 * H, 'unstarted', ['FNC', 'Fnatic'], ['TL', 'Team Liquid'], null, null, 'Quarts')],
};
const vod = (loc, p, s, e) => ({ provider: 'twitch', parameter: p, locale: loc, startMillis: s * 1000, endMillis: e * 1000 });
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), send = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname.endsWith('getLeagues')) return send({ data: { leagues: L.map(l => ({ ...l, image: img(l.slug) })) } });
  if (u.pathname.endsWith('getSchedule')) return send({ data: { schedule: { events: (SCH[u.searchParams.get('leagueId')] || []), pages: {} } } });
  if (u.pathname.endsWith('getEventDetails')) {
    const id = u.searchParams.get('id'), done = ['101', '102', '201'].includes(id);
    return send({ data: { event: { match: { games: done ? [{ number: 1, state: 'completed', vods: [vod('fr-FR', '9001', 600, 2400), vod('en-US', '9002', 700, 2500)] }, { number: 2, state: 'completed', vods: [vod('fr-FR', '9001', 3000, 5000), vod('en-US', '9002', 3100, 5200), { provider: 'youtube', parameter: 'YTabc123', locale: 'en-US' }] }] : [] } } } });
  }
  if (req.method === 'POST' && u.pathname === '/gql') {
    let b = ''; req.on('data', c => b += c); req.on('end', () => { const q = JSON.parse(b).query || ''; const d = {}; (q.match(/c\d+: user\(login: "[^"]+"\)/g) || []).forEach((m, i) => { const login = /"([^"]+)"/.exec(m)[1]; d['c' + i] = { login, displayName: login, profileImageURL: '', stream: login === 'itachi' ? { title: 'VCT EMEA', viewersCount: 1234, game: { displayName: 'VALORANT' } } : null }; }); if (/user\(login: "valorant"\) \{ id/.test(q)) d.user = { id: '1' }; send({ data: d }); });
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(Number(process.argv[2]) || 7101);
