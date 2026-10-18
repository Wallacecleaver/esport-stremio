'use strict';
// Profils, dashboard et réglages avec une base Upstash simulée en mémoire.
process.env.UPSTASH_REDIS_REST_URL = 'https://up.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
process.env.ADMIN_PASSWORD = 'motdepasse-admin-long';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const kv = new Map(), hashes = new Map(), lists = new Map(), zsets = new Map();
function redis(cmd) {
  const [c, ...a] = cmd;
  switch (c) {
    case 'GET': return kv.has(a[0]) ? kv.get(a[0]) : null;
    case 'SET': kv.set(a[0], a[1]); return 'OK';
    case 'DEL': { let n = 0; for (const k of a) { n += kv.delete(k) + hashes.delete(k) + lists.delete(k) + zsets.delete(k); } return n; }
    case 'HINCRBY': { const h = hashes.get(a[0]) || new Map(); h.set(a[1], Number(h.get(a[1]) || 0) + Number(a[2])); hashes.set(a[0], h); return h.get(a[1]); }
    case 'HSET': { const h = hashes.get(a[0]) || new Map(); h.set(a[1], a[2]); hashes.set(a[0], h); return 1; }
    case 'HGETALL': return [...(hashes.get(a[0]) || new Map())].flat().map(String);
    case 'LPUSH': { const l = lists.get(a[0]) || []; l.unshift(a[1]); lists.set(a[0], l); return l.length; }
    case 'LTRIM': { const l = lists.get(a[0]) || []; lists.set(a[0], l.slice(a[1], a[2] + 1)); return 'OK'; }
    case 'LRANGE': return (lists.get(a[0]) || []).slice(a[1], a[2] + 1);
    case 'ZINCRBY': { const z = zsets.get(a[0]) || new Map(); z.set(a[2], (z.get(a[2]) || 0) + Number(a[1])); zsets.set(a[0], z); return z.get(a[2]); }
    case 'ZREVRANGE': return [...(zsets.get(a[0]) || new Map())].sort((x, y) => y[1] - x[1]).slice(0, a[2] + 1).flat().map(String);
    case 'PFADD': { const s = kv.get(a[0]) || new Set(); s.add(a[1]); kv.set(a[0], s); return 1; }
    case 'PFCOUNT': { const s = kv.get(a[0]); return s instanceof Set ? s.size : 0; }
    case 'SCAN': { const pre = a[2].replace('*', ''); return ['0', [...kv.keys()].filter(k => typeof k === 'string' && k.startsWith(pre))]; }
    default: return null;
  }
}
const realFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === 'up.test') return new Response(JSON.stringify(JSON.parse(init.body).map(c => ({ result: redis(c) }))), { status: 200 });
  if (u.hostname === '127.0.0.1') return realFetch(url, init);
  return new Response('not stubbed', { status: 599 });
};

const handler = require('../index.js');
let server, base;
test.before(async () => { server = http.createServer(handler); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => server.close());
const call = (p, o = {}) => realFetch(base + p, { ...o, headers: { host: 'esport.test', 'x-forwarded-host': 'esport.test', ...(o.headers || {}) } });
const post = (p, b, h) => call(p, { method: 'POST', body: JSON.stringify(b), headers: h });

let id;
test('création d\'un profil : mot de passe obligatoire, pseudo nettoyé, réglages normalisés', async () => {
  let r = await (await post('/api/profile', { pseudo: 'Wallace', cfg: {} })).json();
  assert.equal(r.ok, false);
  r = await (await post('/api/profile', { pseudo: 'Wallace É!', newPassword: 'secret1', cfg: { games: ['lol', 'nimporte'], teams: { lol: ['KC', '<b>x</b>'] }, lang: 'EN', cap: 999 } })).json();
  assert.equal(r.ok, true);
  assert.equal(r.pseudo, 'wallacee');
  id = r.id;
  const m = await (await call('/u/' + id + '/manifest.json')).json();
  assert.match(m.name, /wallacee/);
  assert.ok(m.catalogs.some(c => c.id === 'esport-fav'));
});

test('modification : mot de passe exigé, mauvais mot de passe refusé, réglages mis à jour sans réinstaller', async () => {
  let r = await (await call('/api/profile?id=' + id)).json();
  assert.equal(r.locked, true);
  r = await (await post('/api/profile', { id, action: 'open', password: 'faux' })).json();
  assert.equal(r.bad, true);
  r = await (await post('/api/profile', { id, action: 'open', password: 'secret1' })).json();
  assert.equal(r.cfg.teams.lol[0], 'KC');
  assert.ok(r.cfg.teams.lol.every(t => !/[<>]/.test(t))); // balises retirées
  assert.equal(r.cfg.lang, 'EN');
  assert.equal(r.cfg.cap, 0); // valeur hors liste ignorée
  r = await (await post('/api/profile', { id, pseudo: 'wallace', password: 'secret1', cfg: { games: ['lol'], teams: { lol: [] }, lang: 'FR' } })).json();
  assert.equal(r.ok, true);
  const m = await (await call('/u/' + id + '/manifest.json')).json();
  assert.ok(!m.catalogs.some(c => c.id === 'esport-fav')); // équipe retirée : le catalogue disparaît
});

test('dashboard : connexion, état, réglages du site, inscriptions par code', async () => {
  let r = await call('/admin/api/state');
  assert.match(await r.text(), /Connexion/); // pas connecté : page de connexion
  r = await post('/admin/login', { password: 'mauvais' });
  assert.equal((await r.json()).ok, false);
  r = await post('/admin/login', { password: process.env.ADMIN_PASSWORD });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^adm=/);
  const st = await (await call('/admin/api/state', { headers: { cookie } })).json();
  assert.equal(st.persistent, true);
  assert.ok(st.users.some(u => u.pseudo === 'wallace'));
  assert.ok(st.stats.req > 0);
  const saved = await (await post('/admin/api/site', { name: 'Esport Crew', code: 'amis2026', feat: { games: { lol: true, rocketleague: true }, upcoming: 10, maint: false } }, { cookie })).json();
  assert.equal(saved.site.name, 'Esport Crew');
  assert.equal(saved.site.feat.games.rocketleague, false); // jeu non branché : reste désactivé
  assert.equal(saved.site.feat.upcoming, 10);
  // code d'invitation exigé pour un nouveau profil
  let p = await (await post('/api/profile', { pseudo: 'ami', newPassword: 'secret2', cfg: {} })).json();
  assert.equal(p.bad, 'code');
  p = await (await post('/api/profile', { pseudo: 'ami', newPassword: 'secret2', cfg: {}, code: 'amis2026' })).json();
  assert.equal(p.ok, true);
  const profs = await (await call('/admin/api/profiles', { headers: { cookie } })).json();
  assert.equal(profs.profils.length, 2);
  const mf = await (await call('/manifest.json')).json();
  assert.equal(mf.name, 'Esport Crew');
});

test('dashboard : maintenance, puis le live affiche le message', async () => {
  const cookie = (await post('/admin/login', { password: process.env.ADMIN_PASSWORD })).headers.get('set-cookie').split(';')[0];
  await post('/admin/api/site', { feat: { maint: true, maintMsg: 'Retour dans 5 min' } }, { cookie });
  const s = await (await call('/stream/tv/esp:m:lol~x.json')).json();
  assert.match(s.streams[0].title, /Retour dans 5 min/);
  await post('/admin/api/site', { feat: { maint: false } }, { cookie });
});
