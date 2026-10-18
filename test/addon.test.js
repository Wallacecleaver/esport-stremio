'use strict';
// Tests hors-ligne : tous les serveurs externes (lolesports, Twitch, relais, CDN) sont simulés en remplaçant fetch.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const sharp = require('sharp');

const NOW = Date.now(), H = 3600e3;
const iso = ms => new Date(ms).toISOString();
const ev = (id, state, start, a, b, block = 'Phase finale', lg = { name: 'Worlds', slug: 'worlds' }) => ({
  startTime: iso(start), state, type: 'match', blockName: block, league: lg,
  match: { id, strategy: { count: 5 }, teams: [a, b].map(t => t && { name: t[0], code: t[1], image: 'http://logos.test/' + t[1] + '.png', result: t[2] != null ? { gameWins: t[2], outcome: t[3] } : null }).filter(Boolean) },
});
const SCHEDULES = {
  '98767975604431411': [ // Worlds
    ev('w1', 'completed', NOW - 3 * 24 * H, ['Karmine Corp', 'KC', 3, 'win'], ['Cloud9', 'C9', 1, 'loss'], 'Quart de finale'),
    ev('w2', 'inProgress', NOW - 0.5 * H, ['Karmine Corp', 'KC', 1, null], ['MVK', 'MVK', 0, null], 'Demi-finale'),
    ev('w3', 'unstarted', NOW + 2 * 24 * H, ['T1', 'T1'], ['Gen.G', 'GEN'], 'Finale'),
  ],
  '98767991325878492': [ // EWC (retrouvé par l'alias « ewc »), plus tôt dans l'année
    ev('m1', 'completed', Date.UTC(2026, 4, 20, 17), ['G2', 'G2', 3, 'win'], ['Karmine Corp', 'KC', 2, 'loss'], 'Finale', { name: 'Esports World Cup', slug: 'esports_world_cup' }),
  ],
};
SCHEDULES['98767991302996019'] = [ // LEC : deux splits
  ev('l1', 'completed', Date.UTC(2026, 0, 20, 17), ['G2 Esports', 'G2'], ['Fnatic', 'FNC', 1, 'loss'], 'Semaine 1', { name: 'LEC', slug: 'lec' }),
  ev('l2', 'completed', Date.UTC(2026, 3, 8, 17), ['Karmine Corp', 'KC', 2, 'win'], ['Fnatic', 'FNC', 0, 'loss'], 'Semaine 1', { name: 'LEC', slug: 'lec' }),
  ev('l3', 'unstarted', NOW + 24 * H, ['Karmine Corp', 'KC'], ['G2 Esports', 'G2'], 'Semaine 2', { name: 'LEC', slug: 'lec' }),
];
const TOURNAMENTS = [{ id: 't1', slug: 'lec_winter_2026', startDate: '2026-01-15', endDate: '2026-03-10' }, { id: 't2', slug: 'lec_spring_2026', startDate: '2026-04-01', endDate: '2026-05-20' }];
const LEAGUES = [{ id: '98767975604431411', slug: 'worlds', name: 'Worlds' }, { id: '98767991325878492', slug: 'esports_world_cup', name: 'Esports World Cup' }, { id: '98767991302996019', slug: 'lec', name: 'LEC' }];

const png = () => sharp({ create: { width: 120, height: 120, channels: 4, background: { r: 0, g: 160, b: 255, alpha: 1 } } }).png().toBuffer();
const j = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const t = (s, status = 200) => new Response(s, { status });

const MASTER = id => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,VIDEO="chunked"\nhttps://cdn.test/vod/' + id + '/chunked/index-dvr.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=854x480,FRAME-RATE=30.000,VIDEO="480p30"\nhttps://cdn.test/vod/' + id + '/480p30/index-dvr.m3u8\n';
const MEDIA = n => '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n' + Array.from({ length: n }, (_, i) => '#EXTINF:10.000,\n' + i + '-unmuted.ts').join('\n') + '\n#EXT-X-ENDLIST\n';
const LIVE_MASTER = '#EXTM3U\n#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60 (source)"\n#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,VIDEO="chunked"\nhttps://relay-cdn.test/riot/1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=854x480,FRAME-RATE=30.000,VIDEO="480p30"\nhttps://relay-cdn.test/riot/480.m3u8\n';

const side = (cls, code, name, extra = '') => '<td class="' + cls + '"><span class="team-template-team-standard"><span class="team-template-image-icon"><a href="/valorant/' + name + '"><img src="/commons/images/' + code + '.png" srcset="/commons/images/' + code + '.png 1x, /commons/images/' + code + '_2x.png 2x"></a></span><span class="team-template-text"><a href="/valorant/' + name + '" title="' + name + '">' + code + '</a></span></span></td>';
const vm = (ts, L, R, score, bo, ev, concl, tw) => '<table class="infobox_matches_content"><tbody><tr>' + side(concl ? 'team-left recent-matches-left' : 'team-left', ...L) + '<td class="versus"><div>' + score + '</div><abbr title="Best of ' + bo + '">Bo' + bo + '</abbr></td>' + side(concl ? 'team-right recent-matches-right' : 'team-right', ...R) + '</tr><tr><td class="match-filler" colspan="3"><div><span class="timer-object" data-timestamp="' + Math.floor(ts / 1000) + '"' + (tw ? ' data-stream-twitch="' + tw + '"' : '') + '></span><div class="league-icon-small-image"><a href="/valorant/x" title="' + ev + '"><img src="/commons/images/ev.png"></a></div></div></td></tr></tbody></table>';
const VAL_HTML = [
  vm(NOW - 30 * H, ['G2', 'G2 Esports'], ['NRG', 'NRG'], '2:0', 3, 'VCT 2026: Masters Test', true),
  vm(NOW - 1 * H, ['FNC', 'Fnatic'], ['KC', 'Karmine Corp'], '1:0', 3, 'VCT 2026: Masters Test', false, 'valorant_emea'),
  vm(NOW + 24 * H, ['TBD', 'TBD'], ['T1', 'T1'], '0:0', 5, 'VCT 2026: Champions Test', false),
].join('');
const RL_HTML = (ts, L, R, sc, bo, ev, win) => '<div class="match-info"><div class="match-info-countdown"><span class="timer-object" data-timestamp="' + Math.floor(ts / 1000) + '" data-stream-twitch="rocketleague"></span></div><div class="match-info-header">' +
  '<div class="match-info-header-opponent match-info-header-opponent-left' + (win === 0 ? ' match-info-header-winner' : '') + '"><div class="block-team"><span class="team-template-image-icon"><img src="/commons/images/' + L + '.png"></span><span class="name"><a title="' + L + ' Team">' + L + '</a></span></div></div>' +
  '<div class="match-info-header-scoreholder"><div class="match-info-header-scoreholder-upper"><span class="match-info-header-scoreholder-score">' + sc[0] + '</span>:<span class="match-info-header-scoreholder-score">' + sc[1] + '</span></div><div class="match-info-header-scoreholder-lower">(Bo' + bo + ')</div></div>' +
  '<div class="match-info-header-opponent' + (win === 1 ? ' match-info-header-winner' : '') + '"><div class="block-team"><span class="team-template-image-icon"><img src="/commons/images/' + R + '.png"></span><span class="name"><a title="' + R + ' Team">' + R + '</a></span></div></div></div>' +
  '<div class="match-info-tournament"><a title="' + ev + '">' + ev + '</a></div></div>';
const FN_HTML = '<div class="divTable"><div class="divRow"><div class="divCell Tournament Header"><b>Tournoi</b></div></div>' +
  '<div class="divRow"><div class="divCell Tournament Name"><a href="/fortnite/FNCS" title="FNCS Test">FNCS Test</a></div><div class="divCell Date">Oct 17, 2026 - Oct 19, 2026</div></div>' +
  '<div class="divRow"><div class="divCell Tournament Name"><a href="/fortnite/Cup">Cash Cup Test</a></div><div class="divCell Date">Nov 2, 2026</div></div></div>';

const calls = [];
const realFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  url = String(url); calls.push(url);
  const u = new URL(url);
  if (u.hostname === '127.0.0.1') return realFetch(url, init);
  if (u.hostname === 'esports-api.lolesports.com') {
    if (u.pathname.endsWith('/getLeagues')) return j({ data: { leagues: LEAGUES } });
    if (u.pathname.endsWith('/getTournamentsForLeague')) return j({ data: { leagues: [{ tournaments: TOURNAMENTS }] } });
    if (u.pathname.endsWith('/getSchedule')) return j({ data: { schedule: { events: SCHEDULES[u.searchParams.get('leagueId')] || [], pages: {} } } });
    if (u.pathname.endsWith('/getEventDetails')) {
      const id = u.searchParams.get('id');
      if (id !== 'w1') return j({ data: { event: { match: { games: [] } } } });
      return j({ data: { event: { match: { games: [
        { number: 1, state: 'completed', vods: [{ provider: 'twitch', parameter: '1111111111', mediaLocale: { locale: 'fr-FR' }, startMillis: 600000, endMillis: 3000000 }, { provider: 'twitch', parameter: '2222222222', mediaLocale: { locale: 'en-US' }, startMillis: 600000, endMillis: 3000000 }] },
        { number: 2, state: 'completed', vods: [{ provider: 'twitch', parameter: '1111111111', mediaLocale: { locale: 'fr-FR' }, startMillis: 3600000, endMillis: 6000000 }] },
      ] } } } });
    }
  }
  if (u.hostname === 'esports-api.service.valorantesports.com') {
    if (!globalThis.__valOfficial) return t('off', 599);
    assert.equal(u.searchParams.get('sport'), 'val');
    if (u.pathname.endsWith('/getLeagues')) return j({ data: { leagues: [{ id: 'v1', slug: 'vct_emea', name: 'VCT EMEA' }, { id: 'v2', slug: 'champions', name: 'Champions' }] } });
    if (u.pathname.endsWith('/getSchedule')) return j({ data: { schedule: { events: u.searchParams.get('leagueId') === 'v1' ? [ev('vv1', 'completed', Date.UTC(2026, 3, 2, 18), ['Fnatic', 'FNC', 2, 'win'], ['Team Heretics', 'TH', 0, 'loss'], 'Semaine 1', { name: 'VCT EMEA', slug: 'vct_emea' })] : [], pages: {} } } });
  }
  if (u.hostname === 'fnapi.osirion.gg') {
    if (!globalThis.__fnOfficial) return t('off', 599);
    assert.equal(u.pathname, '/v1/tournaments');
    return j({ success: true, region: u.searchParams.get('region'), tournaments: [{ eventId: 'epicgames_Cup1', eventGroup: 'cup', regions: ['EU'], platforms: [], metadata: {},
      displayData: { tournamentDisplayId: 'cup', longFormatTitle: 'Duos Ranked Cup', squarePosterImage: 'http://logos.test/FN.png', roundNames: ['Session 1', 'Finale'] },
      eventWindows: [{ eventWindowId: 'w-b', round: 2, beginTime: iso(NOW + 26 * H), endTime: iso(NOW + 29 * H) }, { eventWindowId: 'w-a', round: 1, beginTime: iso(NOW - 1 * H), endTime: iso(NOW + 2 * H) }] }] });
  }
  if (u.hostname === 'liquipedia.net') return j({ parse: { text: { '*': u.pathname.startsWith('/valorant') ? VAL_HTML : u.pathname.startsWith('/rocketleague') ? RL_HTML(NOW - 30 * H, 'KC', 'G2', [3, 1], 7, 'RLCS 2026: Test', 0) + RL_HTML(NOW + 24 * H, 'FAZE', 'NRG', [0, 0], 5, 'RLCS 2026: Test') : FN_HTML } } });
  if (u.hostname === 'logos.test') return new Response(await png(), { status: 200, headers: { 'content-type': 'image/png' } });
  if (u.hostname === 'gql.twitch.tv') {
    const b = JSON.parse(init.body || '{}'), q = String(b.query || '');
    if (/u0: user/.test(q)) {
      const logins = [...q.matchAll(/u(\d+): user\(login: "([^"]+)"/g)];
      const data = {};
      for (const [, i, l] of logins) data['u' + i] = { login: l, displayName: l === 'riotgames' ? 'Riot Games' : l, profileImageURL: '', stream: l === 'riotgames' || l === 'otplol_' || l === 'valorant_emea' ? { id: '1', title: 'Worlds', viewersCount: l === 'riotgames' ? 120000 : 40000, game: { displayName: 'League of Legends' } } : null };
      return j({ data });
    }
    if (/video\(id: "(\d+)"\) \{ id createdAt/.test(q)) { const id = /video\(id: "(\d+)"\)/.exec(q)[1]; return j({ data: { video: { id, createdAt: iso(NOW - 3 * 24 * H), lengthSeconds: 9000, owner: { login: id.startsWith('1') ? 'otplol_' : 'riotgames', displayName: id.startsWith('1') ? 'OTP' : 'Riot Games' } } } }); }
    if (/videos\(first/.test(q)) return j({ data: { user: { displayName: 'Kameto', login: 'kamet0', profileImageURL: '', offlineImageURL: '', description: '', a: { edges: !/"kamet0"/.test(q) ? [] : [{ node: { id: '3333333333', title: 'Worlds', publishedAt: iso(NOW - 3 * 24 * H - 2 * H), lengthSeconds: 5 * 3600, viewCount: 1 } }] }, h: { edges: [] } } } });
    if (b.operationName === 'PlaybackAccessToken') return j({ data: b.variables && b.variables.isVod ? { videoPlaybackAccessToken: { value: 'v', signature: 's' } } : { streamPlaybackAccessToken: { value: 'v', signature: 's' } } });
    return j({ data: {} });
  }
  if (u.hostname === 'usher.ttvnw.net') {
    const m = /\/vod\/(?:v2\/)?(\d+)\.m3u8/.exec(u.pathname);
    return m ? t(MASTER(m[1])) : t('', 404);
  }
  if (u.hostname === 'cdn.test') return t(MEDIA(2000));
  if (/luminous|nadeko|perfprod/.test(u.hostname)) return t(LIVE_MASTER);
  return t('not stubbed: ' + url, 599);
};

const handler = require('../index.js');
let server, base;
test.before(async () => { server = http.createServer(handler); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => server.close());
const get = async p => { const r = await realFetch(base + p, { headers: { host: 'esport.test', 'x-forwarded-host': 'esport.test' } }); const ct = r.headers.get('content-type') || ''; return { r, body: /json/.test(ct) ? await r.json() : /image/.test(ct) ? Buffer.from(await r.arrayBuffer()) : await r.text() }; };
const cfgUrl = o => '/c/wallace/' + Buffer.from(JSON.stringify(o)).toString('base64url');

test('modèle : saisons = événements dans l\'ordre chronologique', async () => {
  const model = require('../lib/model');
  const lol = require('../lib/games/lol');
  const ms = await lol.matches({ leagues: ['worlds', 'ewc'] });
  assert.equal(ms.length, 4);
  const seasons = model.seasonsOf(ms, 2026);
  assert.deepEqual(seasons.map(s => [s.n, s.event.name]), [[1, 'Esports World Cup 2026'], [2, 'Worlds 2026']]);
  assert.deepEqual(seasons[1].matches.map(m => m.raw), ['w1', 'w2', 'w3']);
  assert.equal(ms.find(m => m.raw === 'w2').state, 'live');
  assert.equal(ms.find(m => m.raw === 'w1').teams[0].win, true);
  assert.ok(model.hasTeam(ms.find(m => m.raw === 'w3'), ['t1']));
  assert.ok(model.hasTeam(ms.find(m => m.raw === 'w1'), ['Karmine Corp']));
  assert.ok(!model.hasTeam(ms.find(m => m.raw === 'w3'), ['KC']));
});

test('manifeste : un catalogue par jeu et par année, ⭐ seulement avec une équipe', async () => {
  let r = await get('/manifest.json');
  const ids = r.body.catalogs.map(c => c.id);
  assert.ok(ids.includes('esport-live') && ids.includes('esport-lol-2026'));
  assert.ok(!ids.includes('esport-fav'));
  r = await get(cfgUrl({ games: ['lol'], teams: { lol: ['KC'] } }) + '/manifest.json');
  assert.ok(r.body.catalogs.some(c => c.id === 'esport-fav'));
  assert.equal(r.body.catalogs.find(c => c.id === 'esport-lol-2026').type, 'series');
  // un jeu pas encore branché est ignoré
  r = await get(cfgUrl({ games: ['cod'] }) + '/manifest.json');
  assert.ok(!r.body.catalogs.some(c => c.id.includes('cod')));
});

test('catalogue en direct & à venir : en cours d\'abord, étoile sur l\'équipe favorite, affiche servie', async () => {
  const r = await get(cfgUrl({ games: ['lol'], teams: { lol: ['KC'] } }) + '/catalog/tv/esport-live.json');
  const names = r.body.metas.map(m => m.name);
  assert.deepEqual(names, ['⭐ KC vs MVK', 'T1 vs GEN']);
  assert.match(r.body.metas[0].poster, /^https:\/\/esport\.test\/img\/m\/lol~w2\.png\?k=poster&s=l/);
  assert.match(r.body.metas[0].poster, /&f=1/);
  const path = r.body.metas[0].poster.replace('https://esport.test', '');
  const img = await get(path);
  assert.equal(img.r.status, 200);
  const meta = await sharp(img.body).metadata();
  assert.deepEqual([meta.width, meta.height], [600, 900]);
  const thumb = await get(r.body.metas[0].background.replace('https://esport.test', ''));
  assert.deepEqual([(await sharp(thumb.body).metadata()).width, (await sharp(thumb.body).metadata()).height], [640, 360]);
});

test('⭐ Mon équipe : tous les matchs de KC (en direct, à venir, terminés)', async () => {
  const r = await get(cfgUrl({ games: ['lol'], teams: { lol: ['KC'] } }) + '/catalog/tv/esport-fav.json');
  assert.deepEqual(r.body.metas.map(m => m.id), ['esp:m:lol~w2', 'esp:m:lol~w1', 'esp:m:lol~m1']);
});

test('série annuelle : saison = événement, épisode = match, sans score dans les titres', async () => {
  const cat = await get('/catalog/series/esport-lol-2026.json');
  assert.equal(cat.body.metas[0].id, 'esp:s:lol:2026');
  assert.equal(cat.body.metas[0].name, 'League of Legends 2026');
  const r = await get(cfgUrl({ games: ['lol'], teams: { lol: ['KC'] } }) + '/meta/series/esp:s:lol:2026.json');
  const v = r.body.meta.videos;
  assert.deepEqual(v.map(x => [x.season, x.episode]), [[1, 1], [2, 1], [2, 2], [2, 3]]);
  assert.match(v[0].title, /^⭐ Esports World Cup 2026 · Finale · G2 vs KC$/);
  assert.ok(!/\d - \d/.test(v.map(x => x.title).join(' ')));
  assert.match(r.body.meta.description, /Saison 1 : Esports World Cup 2026\nSaison 2 : Worlds 2026/);
  assert.equal(v[1].id, 'esp:v:lol~w1');
});

test('sources d\'un match en cours : chaînes en direct, relais sans pub', async () => {
  const r = await get('/stream/tv/esp:m:lol~w2.json');
  const s = r.body.streams;
  assert.equal(s.length, 2);
  assert.match(s[0].name, /^OTP\nFR/); // français d'abord par défaut
  assert.match(s[1].name, /^Riot Games\nEN/);
  assert.match(s[1].title, /120 k 👁/);
  assert.ok(!('description' in s[0])); // Stremio : seulement title
  assert.equal(s[0].url, 'https://esport.test/p/otplol_.m3u8');
  const en = await get(cfgUrl({ lang: 'EN' }) + '/stream/tv/esp:m:lol~w2.json');
  assert.match(en.body.streams[0].name, /^Riot Games/);
  const p = await get('/p/riotgames.m3u8');
  assert.equal(p.r.status, 200);
  assert.match(p.body, /relay-cdn\.test\/riot\/1080\.m3u8/);
  const capped = await get(cfgUrl({ cap: 720 }) + '/p/riotgames.m3u8');
  assert.ok(!/1080\.m3u8/.test(capped.body) && /480\.m3u8/.test(capped.body));
});

test('sources d\'un match à venir : message d\'attente, pas de flux vide', async () => {
  const r = await get('/stream/series/esp:v:lol~w3.json');
  assert.equal(r.body.streams.length, 1);
  assert.match(r.body.streams[0].name, /À venir/);
  assert.ok(r.body.streams[0].externalUrl);
});

test('sources d\'un match terminé : rediffs officielles FR/EN + rediff de chaîne retrouvée par l\'heure', async () => {
  const r = await get('/stream/series/esp:v:lol~w1.json');
  const s = r.body.streams;
  assert.deepEqual(s.map(x => x.name.split('\n')[0]), ['OTP', 'Kameto', 'Riot Games']); // FR d'abord (officiel avant streamer), puis EN
  assert.match(s[0].title, /Flux officiel/);
  assert.match(s[1].title, /Chaîne du streamer/);
  assert.ok(s.every(x => /\/r\/[A-Za-z0-9_-]+\.m3u8$/.test(x.url)));
});

test('rediffusion : playlist découpée sur le match, segments « muted » (TwitchNoSub), un seul flux', async () => {
  const sr = (await get('/stream/series/esp:v:lol~w1.json')).body.streams;
  const fr = await get(sr[0].url.replace('https://esport.test', ''));
  assert.equal(fr.r.status, 200);
  assert.match(fr.body, /#EXT-X-PLAYLIST-TYPE:VOD/);
  assert.match(fr.body, /#EXT-X-ENDLIST/);
  const segs = fr.body.split('\n').filter(l => /\.ts$/.test(l));
  // FR : de 600 s - 8 min (= 120 s) à 6000 s + 3 min (= 6180 s) sur une seule vidéo (manches 1 et 2)
  assert.equal(segs.length, 606);
  assert.match(segs[0], /^https:\/\/cdn\.test\/vod\/1111111111\/chunked\/12-unmuted\.ts$/); // lecture normale : segments d'origine
  const low = await get(cfgUrl({ cap: 480 }) + sr[0].url.replace('https://esport.test', ''));
  assert.match(low.body, /480p30\/\d+-unmuted\.ts/);
});

test('rediffusion réservée aux abonnés (lecture directe) : segments « muted »', () => {
  const { trimPlaylist } = require('../lib/replay');
  const r = trimPlaylist(MEDIA(20), 'https://d.cloudfront.net/x/index-dvr.m3u8', 30, 60, { muted: true });
  const segs = r.text.split('\n').filter(l => /\.ts$/.test(l));
  assert.equal(segs.length, 3);
  assert.deepEqual(segs.map(x => x.split('/').pop()), ['3-muted.ts', '4-muted.ts', '5-muted.ts']);
  assert.match(r.text, /#EXT-X-MEDIA-SEQUENCE:3/);
});

test('rediffusion : adresse invalide refusée', async () => {
  const r = await get('/r/pas-valide.m3u8');
  assert.equal(r.r.status, 400);
});

test('profil : création, mot de passe, lecture (Upstash simulé en mémoire)', async () => {
  const store = require('../lib/store');
  assert.equal(store.persistent, false); // sans Upstash : lien /c/ classique
  const r = await realFetch(base + '/api/profile', { method: 'POST', body: JSON.stringify({ pseudo: 'x' }) });
  assert.equal((await r.json()).ok, false);
});

test('API équipes et jeux pour la page de configuration', async () => {
  const g = await get('/api/games');
  assert.deepEqual(g.body.games.filter(x => x.ready).map(x => x.id).slice(0, 2), ['lol', 'lec']);
  assert.equal(g.body.games.length, 6);
  const t = await get('/api/teams?game=lol');
  assert.ok(t.body.teams.some(x => x.code === 'KC'));
  const page = await get('/config');
  assert.match(page.body, /Configuration/);
  assert.ok(!/\{\{/.test(page.body));
});

test('admin : sans mot de passe configuré, la page explique quoi faire', async () => {
  const r = await get('/admin');
  assert.match(r.body, /ADMIN_PASSWORD/);
});

test('icône de l\'addon', async () => {
  const r = await get('/logo.png');
  assert.equal(r.r.status, 200);
  assert.equal((await sharp(r.body).metadata()).width, 512);
});

test('LEC : catalogue à part, saisons = splits, absent du catalogue LoL', async () => {
  const cfg = cfgUrl({ games: ['lol', 'lec'], lang: 'FR' });
  const m = (await get(cfg + '/manifest.json')).body;
  assert.ok(m.catalogs.some(c => c.id === 'esport-lec-2026' && c.name === 'LEC 2026'));
  const s = (await get(cfg + '/meta/series/esp:s:lec:2026.json')).body.meta;
  assert.deepEqual([...new Set(s.videos.map(v => v.season))], [1, 2]);
  assert.match(s.videos[0].title, /LEC Hiver 2026/);
  assert.match(s.videos[1].title, /LEC Printemps 2026/);
  assert.match(s.videos[0].id, /^esp:v:lec~l1$/);
  const lol = (await get(cfg + '/meta/series/esp:s:lol:2026.json')).body.meta;
  assert.ok(!lol.videos.some(v => /LEC/.test(v.title)));
});

test('Valorant : matchs lus sur Liquipedia, saisons = événements, live Twitch indiqué par la source', async () => {
  const cfg = cfgUrl({ games: ['valorant'], teams: { valorant: ['KC'] }, lang: 'FR' });
  const s = (await get(cfg + '/meta/series/esp:s:valorant:2026.json')).body.meta;
  assert.equal(s.name, 'Valorant 2026');
  assert.deepEqual([...new Set(s.videos.map(v => v.season))], [1, 2]);
  assert.match(s.videos[0].title, /VCT 2026: Masters Test/);
  assert.equal(s.videos.length, 3);
  const live = s.videos.find(v => /FNC vs KC/.test(v.title));
  assert.match(live.title, /^⭐/);
  const st = (await get(cfg + '/stream/tv/' + encodeURIComponent(live.id) + '.json')).body.streams;
  assert.ok(st.some(x => /valorant_emea/.test(x.url)), JSON.stringify(st));
  const img = await get('/img/m/' + encodeURIComponent(live.id.replace('esp:v:', '')) + '.png?k=poster');
  assert.equal(img.r.status, 200);
});

test('Fortnite : une journée = un épisode, affiche sans équipes', async () => {
  const cfg = cfgUrl({ games: ['fortnite'] });
  const s = (await get(cfg + '/meta/series/esp:s:fortnite:2026.json')).body.meta;
  assert.equal(s.videos.length, 4); // 3 jours + 1
  assert.equal(s.videos[0].title, 'FNCS Test · Jour 1/3');
  const key = s.videos[0].id.replace('esp:v:', '');
  for (const k of ['poster', 'thumb']) { const img = await get('/img/m/' + encodeURIComponent(key) + '.png?k=' + k); assert.equal(img.r.status, 200); assert.match(img.r.headers.get('content-type'), /png/); }
  const live = (await get(cfg + '/catalog/tv/esport-live.json')).body.metas;
  assert.ok(live.length >= 1);
});

test('Valorant : source officielle valorantesports.com (sport = val), toutes les ligues', async () => {
  globalThis.__valOfficial = true;
  try {
    const l = await require('../lib/games/valorant').official();
    assert.equal(l.length, 1);
    assert.equal(l[0].game, 'valorant');
    assert.equal(l[0].event.name, 'VCT EMEA 2026');
    assert.equal(l[0].id, 'valorant~vv1');
  } finally { globalThis.__valOfficial = false; }
});

test('Liquipedia : liste de tournois, nouvelle mise en page (table2)', () => {
  const lp = require('../lib/liquipedia');
  const html = '<div class="tournaments-listing"><div class="table2__row--body"><div class="tournament"><a title="FNCS Test">FNCS Test</a></div><div class="date">Oct 17 - 19, 2026</div></div></div>';
  const l = lp.tournamentList(html, { fallbackYear: 2026 });
  assert.equal(l.length, 1);
  assert.equal(l[0].name, 'FNCS Test');
  assert.equal(new Date(l[0].to).getUTCDate(), 19);
});

test('Rocket League : matchs Liquipedia (nouvelle mise en page), saison = événement', async () => {
  const cfg = cfgUrl({ games: ['rocketleague'], teams: { rocketleague: ['KC'] } });
  const s = (await get(cfg + '/meta/series/esp:s:rocketleague:2026.json')).body.meta;
  assert.equal(s.name, 'Rocket League 2026');
  assert.equal(s.videos.length, 2);
  assert.match(s.videos[0].title, /^⭐ RLCS 2026: Test · KC vs G2/);
  const t = await get('/api/teams?game=rocketleague');
  assert.ok(t.body.teams.some(x => x.code === 'KC'));
});

test('Fortnite : API Osirion (sessions avec heures précises), affiche sans équipes', async () => {
  globalThis.__fnOfficial = true;
  try {
    const l = await require('../lib/games/fortnite').official({ regions: ['EU'], now: NOW });
    assert.equal(l.length, 2);
    assert.deepEqual(l.map(m => [m.event.name, m.stage, m.state]), [['Duos Ranked Cup', 'Session 1', 'live'], ['Duos Ranked Cup', 'Finale', 'upcoming']]);
    assert.ok(!l[0].allDay && l[0].solo);
    const { renderEvent } = require('../lib/poster');
    const png = await renderEvent(l[0], { name: 'Fortnite', color: '#a855f7' }, { kind: 'poster' });
    assert.ok(png.length > 5000);
  } finally { globalThis.__fnOfficial = false; }
});
