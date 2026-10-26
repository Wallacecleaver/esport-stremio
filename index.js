'use strict';
// Addon Stremio « Esport » : Valorant (VCT, VCT EMEA, Game Changers, Champions, EWC). Hébergé sur Vercel (Upstash pour les profils et les statistiques).
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
// Fichier .env (à la racine) : lu au démarrage, sans écraser les variables déjà définies.
try {
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
    if (m && !l.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
} catch { /* pas de .env */ }
const store = require('./lib/store');
const siteLib = require('./lib/site');
const prefs = require('./lib/prefs');
const A = require('./lib/addon');
const fortnite = require('./lib/fortnite');
const poster = require('./lib/poster');
const makeAdmin = require('./lib/admin');
const { tw, val, M } = A;

const PORT = process.env.PORT || 7000;
const ID_RE = /^[A-Za-z0-9_-]{16,40}$/;
const strip = s => String(s || '').replace(/\.json$/, '').replace(/\.png$/, '').replace(/\.m3u8$/, '');
const send = (res, status, type, body, headers = {}) => { res.writeHead(status, { 'Content-Type': type, ...headers }); res.end(body); };
const json = (res, obj, headers = {}) => send(res, 200, 'application/json; charset=utf-8', JSON.stringify(obj), { 'Cache-Control': 'no-store', ...headers });
const readBody = (req, max = 2e4) => new Promise((ok, no) => { let b = ''; req.on('data', c => { b += c; if (b.length > max) { no(new Error('trop gros')); req.destroy(); } }); req.on('end', () => ok(b)); req.on('error', no); });
// Adresse publique de l'addon : PUBLIC_URL si définie (VPS), sinon déduite de la requête (http en local, https derrière Vercel / un proxy).
const originOf = req => {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(host) ? 'http' : 'https');
  return proto + '://' + host;
};
const hits = new Map();
const tooMany = req => { const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x', now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 60000); h.push(now); hits.set(ip, h); if (hits.size > 2000) hits.clear(); return h.length > 40; };

// ---------- profils ----------
async function loadProfile(id) {
  try { const raw = await store.getKey('p:' + id); if (!raw) return null; const p = JSON.parse(raw); return { pseudo: prefs.cleanPseudo(p.pseudo), cfg: prefs.normalize(p.cfg), pw: typeof p.pw === 'string' ? p.pw : '' }; } catch { return null; }
}
const pwHash = pw => { const salt = crypto.randomBytes(16); return salt.toString('base64url') + ':' + crypto.scryptSync(String(pw), salt, 32).toString('base64url'); };
const pwCheck = (pw, h) => { try { const [s, k] = String(h).split(':'), a = crypto.scryptSync(String(pw), Buffer.from(s, 'base64url'), 32), b = Buffer.from(k, 'base64url'); return a.length === b.length && crypto.timingSafeEqual(a, b); } catch { return false; } };
const fails = new Map();
const locked = id => { const f = fails.get(id); return !!f && f.n >= 8 && Date.now() - f.t < 600000; };
const failed = id => { const f = fails.get(id), now = Date.now(); fails.set(id, f && now - f.t < 600000 ? { n: f.n + 1, t: f.t } : { n: 1, t: now }); if (fails.size > 500) fails.clear(); };
async function profileApi(req) {
  if (tooMany(req)) return { ok: false, error: 'trop de demandes, réessaie dans une minute' };
  if (req.method === 'GET') {
    const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
    if (!id) return { ok: true, persistent: store.persistent };
    if (!ID_RE.test(id)) return { ok: false, error: 'Lien inconnu' };
    const p = await loadProfile(id);
    if (!p) return { ok: false, error: 'Profil introuvable' };
    return p.pw ? { ok: true, persistent: store.persistent, locked: true } : { ok: true, persistent: store.persistent, locked: false, nopw: true, pseudo: p.pseudo, cfg: p.cfg };
  }
  if (!store.persistent) return { ok: false, persistent: false, error: 'La base de données n\'est pas configurée : utilise le lien classique.' };
  let b = {}; try { b = JSON.parse(await readBody(req)); } catch { return { ok: false, error: 'requête invalide' }; }
  const id0 = String(b.id || ''), pw = String(b.password || '').slice(0, 100), npw = String(b.newPassword || '').slice(0, 100);
  let old = null;
  if (id0) {
    if (!ID_RE.test(id0) || !(old = await loadProfile(id0))) return { ok: false, error: 'Profil introuvable' };
    if (old.pw) {
      if (locked(id0)) return { ok: false, error: 'Trop d\'essais : réessaie dans 10 minutes.' };
      if (!pwCheck(pw, old.pw)) { failed(id0); return { ok: false, bad: true, error: 'Mot de passe incorrect' }; }
    }
    if (b.action === 'open') return { ok: true, pseudo: old.pseudo, cfg: old.cfg, nopw: !old.pw };
  }
  if (!id0) {
    const S = await siteLib.load();
    if (!S.open) return { ok: false, error: 'Les inscriptions sont fermées pour le moment.' };
    if (S.code && String(b.code || '').trim() !== S.code) return { ok: false, bad: 'code', error: 'Code d\'invitation incorrect' };
  }
  if ((!old || !old.pw) && npw.length < 6) return { ok: false, error: 'Choisis un mot de passe d\'au moins 6 caractères' };
  if (npw && npw.length < 6) return { ok: false, error: 'Mot de passe : 6 caractères minimum' };
  const pseudo = prefs.cleanPseudo(b.pseudo);
  if (pseudo.length < 2) return { ok: false, error: 'Pseudo trop court (2 caractères minimum)' };
  const cfg = prefs.normalize(b.cfg), id = id0 || crypto.randomBytes(16).toString('base64url');
  await store.setKey('p:' + id, JSON.stringify({ pseudo, cfg, pw: npw ? pwHash(npw) : old.pw, maj: Date.now() }));
  store.log({ k: 'config', u: pseudo, reglages: prefs.summary(cfg), action: id0 ? 'modifiée' : 'créée' });
  return { ok: true, id, pseudo };
}

// ---------- pages ----------
const pageCache = {};
async function configPage() {
  const S = await siteLib.load(), raw = pageCache.config ||= fs.readFileSync(path.join(__dirname, 'lib', 'pages', 'config.html'), 'utf8');
  // logo de chaque compétition : image de la ligue (Riot) ou logo choisi dans le dashboard (Fortnite)
  const logos = {}; try { for (const l of (await A.load(S)).leagues || []) if (l.image && !logos[l.comp]) logos[l.comp] = logoUrl(l.image); } catch { /* sans logos */ }
  for (const [k, v] of Object.entries((S.fortnite || {}).logos || {})) logos[k] = logoUrl(v);
  const site = { needCode: !!S.code, open: S.open, comps: prefs.COMPS.filter(c => S.comps.includes(c.id)).map(c => ({ ...c, logo: logos[c.id] || null })), def: prefs.DEFAULTS, caps: prefs.CAPS, capMax: S.feat.capMax, fnSuggest: (S.fortnite || {}).suggest || [] };
  return raw.replace(/\{\{NAME\}\}/g, S.name).replace(/\{\{COLOR\}\}/g, S.color).replace(/\{\{TITLE\}\}/g, S.title).replace(/\{\{TEXT\}\}/g, S.text).replace(/\{\{CREDIT\}\}/g, S.credit).replace(/\{\{V\}\}/g, String(S.logoV)).replace('{{SITE}}', JSON.stringify(site).replace(/</g, '\\u003c'));
}

// ---------- équipes d'Europe proposées à la config ----------
// Les logos d'équipes passent par notre serveur (évite les blocages de CDN et le contenu mixte dans le navigateur).
const logoUrl = u => (u ? '/team-logo/' + Buffer.from(u, 'utf8').toString('base64url') + '.png' : null);
const logoCache = new Map();
async function teamLogo(id) {
  let u; try { u = new URL(Buffer.from(String(id), 'base64url').toString('utf8')); } catch { return null; }
  const local = process.env.LOGO_ALLOW_LOCAL === '1' && u.hostname === 'localhost';
  if (!local && (u.protocol !== 'https:' || u.port || !/\.[a-z]{2,}$/i.test(u.hostname))) return null;
  const c = logoCache.get(u.href); if (c) return c;
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 Esportio' }, signal: AbortSignal.timeout(6000) });
  const type = String(r.headers.get('content-type') || '');
  if (!r.ok || !/^image\//.test(type)) return null;
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 2e6) return null;
  const v = { type, buf }; logoCache.set(u.href, v); if (logoCache.size > 300) logoCache.delete(logoCache.keys().next().value);
  return v;
}
let teamsMemo = { v: null, exp: 0 };
// Équipes proposées : Valorant EMEA / Game Changers EMEA et LEC (LoL) seulement. Une équipe présente dans les deux jeux n'apparaît qu'une fois.
async function teamList(S) {
  if (teamsMemo.v && teamsMemo.exp > Date.now()) return teamsMemo.v;
  const nk = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let list = [], source = 'liste';
  try { const d = await A.load({ ...S, comps: ['emea', 'gc'] }); list = val.europeTeams(d.matches); if (list.length) source = 'officiel'; } catch { /* repli */ }
  if (!list.length) list = A.TEAMS.map(t => ({ ...t, logo: null }));
  let lec = [];
  try { const d = await A.load({ ...S, comps: ['lec'] }); lec = val.lecTeams(d.matches); } catch { /* repli */ }
  if (!lec.length) lec = A.LEC_TEAMS.map(t => ({ ...t, logo: null }));
  const by = new Map();
  for (const t of list) by.set(nk(t.name), { ...t, games: ['val'] });
  for (const t of lec) { const k = nk(t.name), c = by.get(k); if (c) { c.games.push('lol'); c.logo = c.logo || t.logo; } else by.set(k, { code: t.code, name: t.name, logo: t.logo || null, games: ['lol'] }); }
  let out = [...by.values()];
  if (S.teams && S.teams.length) { source = 'dashboard'; out = S.teams.map(t => ({ code: t.code, name: t.name, logo: (by.get(nk(t.name)) || {}).logo || null, games: t.games && t.games.length ? t.games : (by.get(nk(t.name)) || { games: ['val'] }).games })); }
  if (!out.some(t => t.games.includes('lol'))) for (const t of by.values()) if (t.games.includes('lol')) { const o = out.find(x => nk(x.name) === nk(t.name)); if (o) o.games = [...new Set([...o.games, 'lol'])]; else out.push(t); } // ancienne liste du dashboard : on ajoute la LEC
  out = out.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  out = out.map(t => ({ ...t, logo: logoUrl(t.logo) }));
  teamsMemo = { v: { teams: out, source }, exp: Date.now() + 15 * 60e3 };
  return teamsMemo.v;
}

// ---------- vérification d'un lien (écran « Analyse de ton lien ») ----------
async function checkReport(cfg, S, origin) {
  const timed = async f => { const t = Date.now(); try { return { ok: true, ms: Date.now() - t, ...(await f()) }; } catch (e) { return { ok: false, ms: Date.now() - t, err: String(e.message).slice(0, 140) }; } };
  const out = { v: require('./package.json').version, maint: !!S.feat.maint, stockage: store.persistent, posters: A.posterOn(S) };
  let data = null;
  out.source = await timed(async () => { data = await A.load({ ...S, comps: cfg.comps }); const mine = A.forComps(data, cfg.comps); return { n: mine.length, live: mine.filter(m => m.state === 'live').length, upcoming: mine.filter(m => m.state === 'upcoming').length, done: mine.filter(m => m.state === 'done').length, stale: !!data.stale, leagues: data.leagues.map(l => l.name) }; });
  out.twitch = await timed(async () => { const st = await tw.liveStatus(require('./lib/site').channelsOf(S).map(c => c.login)); return { chaines: Object.keys(st).length, live: Object.values(st).filter(x => x.live).map(x => x.name) }; });
  if (cfg.teams.length && data) out.equipe = { teams: cfg.teams.map(t => ({ name: t, matches: data.matches.filter(m => M.hasTeam(m, [t])).length })) };
  if (S.feat.replays && data) {
    const done = data.matches.filter(m => m.state === 'done' && cfg.comps.includes(m.comp)).sort((a, b) => b.startTime - a.startTime)[0];
    if (done) out.replay = await timed(async () => { const r = await A.replaysOf(done, S); return { match: M.matchTitle(done), n: r.length, langs: r.map(x => x.lang) }; });
  }
  out.catalogues = A.manifest(S, cfg).catalogs.map(c => c.name);
  return out;
}

// ---------- adaptateur du dashboard ----------
const adminRoute = makeAdmin({
  send, json,
  async refresh() { teamsMemo = { v: null, exp: 0 }; A.reset(); },
  async osirion(action, key) {
    if (action === 'set') { await fortnite.setKey(key); A.reset(); return { ok: true, ...(await fortnite.keyInfo()) }; }
    if (action === 'test') return fortnite.test();
    return { ...(await fortnite.keyInfo()), env: !!process.env.OSIRION_API_KEY };
  },
  async state() {
    const S = await siteLib.load(); let data = null, error = null;
    try { data = await A.load(S); } catch (e) { error = e.message; }
    const ms = data ? data.matches : [], by = k => ms.filter(m => m.state === k).length;
    const comps = prefs.COMPS.map(c => ({ id: c.id, name: c.name, on: S.comps.includes(c.id), n: ms.filter(m => m.comp === c.id).length, live: ms.filter(m => m.comp === c.id && m.state === 'live').length }));
    return { config: { rows: [
      ['Version', require('./package.json').version, null], ['Stockage persistant (Upstash)', store.persistent ? (store.fileOn ? 'fichier data/' : 'Upstash') : 'mémoire temporaire', store.persistent],
      ['Source des matchs', val.BASE.replace(/^https:\/\//, ''), !error], ['Affiches (sharp)', poster.available() ? 'actives' : 'indisponibles', poster.available()],
      ['ADMIN_PASSWORD', process.env.ADMIN_PASSWORD ? 'défini' : 'absent', !!process.env.ADMIN_PASSWORD] ] },
      data: { error, stale: data ? !!data.stale : null, at: data ? data.at : null, total: ms.length, live: by('live'), upcoming: by('upcoming'), done: by('done'), leagues: data ? data.leagues : [], errors: data ? data.errors || [] : [], comps }, site: S, channels: siteLib.channelsOf(S) };
  },
  async matches(force) {
    const S = await siteLib.load(), d = await A.load(S, { force });
    return { at: d.at, stale: !!d.stale, matches: d.matches.map(m => ({ raw: m.raw, comp: m.comp, game: m.game || 'val', event: m.event.name, stage: m.stage, start: m.startTime, state: m.state, bo: m.bestOf, a: M.teamsOf(m)[0].name, b: M.teamsOf(m)[1].name, ac: M.teamsOf(m)[0].code, bc: M.teamsOf(m)[1].code, al: M.teamsOf(m)[0].logo || null, bl: M.teamsOf(m)[1].logo || null })).sort((x, y) => y.start - x.start) };
  },
  async replay(raw) {
    const S = await siteLib.load(), d = await A.load(S), m = A.byRaw(d, raw);
    if (!m) return { error: 'match introuvable' };
    const t0 = Date.now(), official = await val.replays(m.raw, m.game || 'val').then(r => ({ ok: true, langs: r.map(x => x.lang + ' (' + [x.parts.length ? x.parts.length + ' Twitch' : '', x.yt && x.yt.length ? x.yt.length + ' YouTube' : ''].filter(Boolean).join(' + ') + ')') }), e => ({ ok: false, err: e.message }));
    const reps = await A.replaysOf(m, S);
    const firstTw = reps.find(r => r.parts.length), test = firstTw ? await tw.vodMaster(firstTw.parts[0].v).then(r => ({ ok: true, via: r.via, qualites: r.variants.map(v => v.h + 'p').join(' · ') }), e => ({ ok: false, err: e.message })) : null;
    return { match: M.matchTitle(m), officiel: official, sources: reps.map(r => ({ lang: r.lang, label: r.label, src: r.src, parties: r.parts.length + (r.yt && r.yt.length ? r.yt.length : 0) })), lecture: test, ms: Date.now() - t0 };
  },
  async relay(login) { return { ...(await tw.relayReport(login.toLowerCase())), stats: tw.relayStats() }; },
  async chanstatus(logins) {
    const l = logins.split(',').map(x => x.trim().toLowerCase()).filter(x => tw.LOGIN_RE.test(x)).slice(0, 40);
    return l.length ? tw.liveStatus(l) : {};
  },
  async diag() {
    const rows = [], timed = async (name, f) => { const t = Date.now(); try { const detail = await f(); rows.push({ name, ok: true, ms: Date.now() - t, detail }); } catch (e) { rows.push({ name, ok: false, ms: Date.now() - t, detail: e.message }); } };
    const S = await siteLib.load();
    await timed('valorantesports.com · ligues', async () => { const l = await val.leagues(S.extraKeywords); return l.length + ' ligues retenues : ' + l.map(x => x.name + ' [' + x.comp + ']').join(', '); });
    await timed('lolesports.com · ligues', async () => { const l = await val.lolLeagues(); return l.length + ' ligues retenues : ' + l.map(x => x.name + ' [' + x.comp + ']').join(', '); });
    await timed('valorantesports.com · matchs', async () => { const d = await A.load(S, { force: true }); return d.matches.length + ' matchs' + (d.errors && d.errors.length ? ' · erreurs : ' + d.errors.join(' | ') : ''); });
    await timed('Twitch · statut des chaînes', async () => { const st = await tw.liveStatus(siteLib.channelsOf(S).map(c => c.login)); return Object.keys(st).length + ' chaînes lues, ' + Object.values(st).filter(x => x.live).length + ' en direct'; });
    await timed('Twitch · jeton de lecture', async () => { await tw.liveStatus(['valorant']); const k = await tw.gql('query { user(login: "valorant") { id } }'); return k.user ? 'API Twitch joignable' : 'réponse vide'; });
    return { rows };
  },
  async teams() { return teamList(await siteLib.load()); },
});

// ---------- serveur ----------
const cutLog = (m, e) => store.log({ k: 'erreur', err: String(e && e.message || e).slice(0, 200), route: m });

async function handler(req, res) {
  let pseudo = '';
  try {
    let seg = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean).map(decodeURIComponent);
    let cfg = prefs.DEFAULTS, base = '';
    if (seg[0] === 'c' && seg.length >= 3) { pseudo = prefs.cleanPseudo(seg[1]); cfg = prefs.decode(seg[2]) || prefs.DEFAULTS; base = '/c/' + encodeURIComponent(seg[1]) + '/' + seg[2]; seg = seg.slice(3); }
    if (seg[0] === 'u' && ID_RE.test(seg[1] || '')) {
      if (!seg[2]) return send(res, 302, 'text/plain', '', { Location: '/u/' + seg[1] + '/configure' });
      if (seg[2] !== 'configure') {
        const p = await loadProfile(seg[1]);
        if (!p) return send(res, 404, 'text/plain; charset=utf-8', 'Profil introuvable : crée un nouveau lien sur /config');
        pseudo = p.pseudo; cfg = p.cfg; base = '/u/' + seg[1];
      }
      seg = seg.slice(2);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (await adminRoute(req, res, seg)) return;
    const S = await siteLib.load(); store.setLog(S.feat.logs);
    cfg = { ...cfg, comps: cfg.comps.filter(c => S.comps.includes(c)) };
    if (!cfg.comps.length) cfg.comps = [...S.comps];
    const end = res.end.bind(res);
    res.end = (...a) => { store.flush().finally(() => end(...a)); return res; };
    const dev = store.deviceId(req), origin = originOf(req), t0 = Date.now();
    store.incr('req'); store.incr('d:' + store.day() + ':req');
    if (['stream', 'catalog', 'manifest.json'].includes(seg[0])) store.uniq(dev);
    const head = seg[0] || '';

    if (!head) return send(res, 302, 'text/plain', '', { Location: '/config' });
    if (head === 'config' || head === 'configure') return send(res, 200, 'text/html; charset=utf-8', await configPage(), { 'Cache-Control': 'no-store' });
    if (head === 'logo.png') {
      const raw = S.logoV ? await store.getKey('logo') : null, m = raw && /^data:image\/[a-z]+;base64,(.+)$/.exec(raw);
      const buf = m ? Buffer.from(m[1], 'base64') : poster.available() ? await poster.logoPng(S.color) : null;
      return buf ? send(res, 200, m ? 'image/png' : 'image/png', buf, { 'Cache-Control': 'public, max-age=86400' }) : send(res, 404, 'text/plain', 'pas de logo');
    }
    if (head === 'team-logo') {
      const l = await teamLogo(strip(seg[1] || '')).catch(() => null);
      return l ? send(res, 200, l.type, l.buf, { 'Cache-Control': 'public, max-age=86400' }) : send(res, 404, 'text/plain', 'logo introuvable');
    }
    if (head === 'api' && seg[1] === 'profile') return json(res, await profileApi(req));
    if (head === 'api' && seg[1] === 'twitch') { // nom, photo et état d'une chaîne (pour choisir ses joueurs Fortnite)
      if (tooMany(req)) return json(res, {});
      const l = String(new URL(req.url, 'http://x').searchParams.get('logins') || '').split(',').map(x => x.trim().toLowerCase().replace(/^@/, '')).filter(x => tw.LOGIN_RE.test(x)).slice(0, 12);
      return json(res, l.length ? await tw.liveStatus(l).catch(() => ({})) : {});
    }
    if (head === 'api' && seg[1] === 'teams') return json(res, await teamList(S));
    if (head === 'check') {
      if (tooMany(req)) return json(res, { error: 'trop de demandes' });
      const c = prefs.decode(new URL(req.url, 'http://x').searchParams.get('cfg') || '') || cfg;
      return json(res, await checkReport({ ...c, comps: c.comps.filter(x => S.comps.includes(x)) }, S, origin));
    }
    if (head === 'manifest.json') {
      let have = null; try { have = new Set((await A.load(S)).matches.map(m => m.comp)); } catch { /* source indisponible : on garde tout */ }
      const mf = A.manifest(S, cfg, { pseudo, have }); mf.logo = origin + '/logo.png?v=' + S.logoV;
      store.log({ k: 'manifest', u: pseudo, dev, cfg: prefs.summary(cfg) });
      if (pseudo) store.user(pseudo, { dev, cfg: prefs.summary(cfg) });
      return json(res, mf);
    }
    if (head === 'catalog') {
      const type = seg[1], id = strip(seg[2]);
      try { const metas = await A.catalog(type, id, S, cfg, origin); return json(res, { metas }, { 'Cache-Control': 'max-age=120' }); }
      catch (e) { cutLog('catalog ' + id, e); return json(res, { metas: [] }); }
    }
    if (head === 'meta') {
      try { const m = await A.meta(seg[1], strip(seg[2]), S, cfg, origin); return json(res, m ? { meta: m } : {}, { 'Cache-Control': 'max-age=120' }); }
      catch (e) { cutLog('meta', e); return json(res, {}); }
    }
    if (head === 'stream') {
      const id = strip(seg[2]);
      try {
        const out = await A.streams(id, S, cfg, origin, base);
        store.log({ k: 'stream', u: pseudo, dev, id, n: out.length, ms: Date.now() - t0 });
        return json(res, { streams: out }, { 'Cache-Control': 'max-age=20' });
      } catch (e) { cutLog('stream ' + id, e); return json(res, { streams: [{ name: 'Erreur', title: 'Source indisponible, réessaie.', externalUrl: origin + '/config' }] }); }
    }
    if (head === 'poster' || head === 'thumb' || head === 'bg') {
      if (!poster.available()) return send(res, 404, 'text/plain', 'affiches indisponibles');
      const png = b => send(res, 200, 'image/png', b, { 'Cache-Control': 'public, max-age=1800' });
      if (head === 'poster' && seg[1] === 'event') {
        const e = await A.eventByKey(S, strip(seg[2]).toLowerCase()); if (!e) return send(res, 404, 'text/plain', 'événement inconnu');
        return png(await poster.eventPoster({ name: e.event.name, year: e.year, comp: (A.COMPS[e.comp] || {}).label || 'Valorant', game: (A.COMPS[e.comp] || {}).game || 'val', logo: e.event.logo, count: e.matches.length, live: e.live }));
      }
      const raw = head === 'poster' ? strip(seg[1]) : strip(seg[1]), data = await A.load(S), m = A.byRaw(data, raw);
      if (!m) return send(res, 404, 'text/plain', 'match inconnu');
      const spoil = !!new URL(req.url, 'http://x').searchParams.get('s');
      return png(head === 'poster' ? await poster.matchPoster(m, { spoil: cfg.score }) : head === 'thumb' ? await poster.matchThumb(m) : await poster.matchBackground(m));
    }
    if (head === 'live') {
      const login = strip(seg[1]).toLowerCase();
      if (!tw.LOGIN_RE.test(login)) return send(res, 400, 'text/plain', 'chaîne invalide');
      const r = await tw.liveMaster(login, A.capOf(cfg, S), { relay: S.feat.relay, wrap: id => origin + base + '/m/' + id + '.m3u8' });
      store.log({ k: 'play', u: pseudo || undefined, ch: login, relais: r.via, ms: Date.now() - t0, dev });
      return send(res, 200, 'application/vnd.apple.mpegurl', r.text, { 'Cache-Control': 'no-store', 'X-Relais': r.via });
    }
    if (head === 'm') {
      const u = tw.decU(strip(seg[1] || ''));
      if (!u) return send(res, 400, 'text/plain', 'lien invalide');
      return send(res, 200, 'application/vnd.apple.mpegurl', await tw.mediaPlaylist(u), { 'Cache-Control': 'no-store' });
    }
    if (head === 'vod') {
      const parts = A.decParts(new URL(req.url, 'http://x').searchParams.get('p'));
      if (!parts.length) return send(res, 400, 'text/plain', 'vidéo manquante');
      const txt = await tw.vodPlaylist(parts, A.capOf(cfg, S));
      return send(res, 200, 'application/vnd.apple.mpegurl', txt, { 'Cache-Control': 'public, max-age=60' });
    }
    return send(res, 404, 'text/plain; charset=utf-8', 'Introuvable');
  } catch (e) {
    cutLog('handler', e);
    return send(res, 500, 'text/plain; charset=utf-8', 'Erreur : ' + String(e.message).slice(0, 120));
  }
}

module.exports = handler; module.exports.handler = handler;
if (require.main === module) http.createServer(handler).listen(PORT, () => console.log('Esportio : http://localhost:' + PORT));
