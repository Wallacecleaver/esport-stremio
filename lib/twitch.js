'use strict';
// Fonctions Twitch reprises de l'addon Twitch : lecture d'un live (avec relais « sans pub »), rediffusions (dont TwitchNoSub), liste des rediffs d'une chaîne.
const crypto = require('crypto');
const store = require('./store');
const GQL = 'https://gql.twitch.tv/gql';
const GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // identifiant public du lecteur web de Twitch
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const LOGIN_RE = /^[a-z0-9_]{3,25}$/;
let FEAT = { fast: false, timeout: 2500, offRelays: [] };
const setFeat = f => { FEAT = { ...FEAT, ...f }; };
const TOKEN_QUERY = 'query PlaybackAccessToken($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature __typename } videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature __typename } }';

const PERSISTED_HASH = 'ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9'; // requête enregistrée utilisée par le lecteur web
async function accessToken(login, playerType = 'site', clientId = GQL_CLIENT_ID, o = {}) {
  const headers = { 'Client-ID': clientId, 'Content-Type': 'application/json', 'User-Agent': UA };
  if (o.oauth) { headers.Authorization = 'OAuth ' + o.oauth; headers['X-Device-Id'] = crypto.randomBytes(16).toString('hex'); }
  const body = o.persisted
    ? { operationName: 'PlaybackAccessToken', variables: { isLive: true, login, isVod: false, vodID: '', playerType, platform: 'web' }, extensions: { persistedQuery: { version: 1, sha256Hash: PERSISTED_HASH } } }
    : { operationName: 'PlaybackAccessToken', variables: { isLive: true, login, isVod: false, vodID: '', playerType }, query: TOKEN_QUERY };
  const r = await fetch(GQL, { method: 'POST', headers, signal: AbortSignal.timeout(10000), body: JSON.stringify(body) });
  if (!r.ok) throw new Error('Twitch (GQL) : HTTP ' + r.status);
  const j = await r.json().catch(() => ({}));
  const t = j && j.data && j.data.streamPlaybackAccessToken;
  if (!t || !t.value || !t.signature) throw new Error('Twitch n\'a pas fourni de jeton de lecture' + (j && j.errors ? ' : ' + String(j.errors[0] && j.errors[0].message).slice(0, 100) : ''));
  return t;
}
// Variantes de demande à Twitch pour obtenir les qualités HEVC / AV1 (1440p et plus) : on les essaie toutes et on garde la meilleure.
const WEB = { platform: 'web', player_backend: 'mediaplayer', playlist_include_framerate: 'true', reassignments_supported: 'true', transcode_mode: 'cbr_v1' };
const TV_ID = 'ue6666qo983tsx6so1t0vnawi233wa', ANDROID_ID = 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp'; // identifiants publics des applications Twitch TV et Android
// copie de la demande du lecteur web de Twitch (relevée dans Chrome) : adresse /api/v2/, include_unavailable, acmb, etc.
const hex = n => [...Array(n)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
const WEBV2 = (codecs, unavailable = true) => login => ({
  acmb: Buffer.from(JSON.stringify({ AppVersion: '76ac281a-9974-467d-bf30-ba2ea81eec47', ClientApp: 'twilight', URL: 'https://www.twitch.tv/' + login })).toString('base64'),
  browser_family: 'chrome', browser_version: '155.0', cdm: 'wv', enable_score: 'true', ...(unavailable ? { include_unavailable: 'true' } : {}), lang: 'fr', os_name: 'Windows', os_version: 'NT 10.0',
  platform: 'web', play_session_id: hex(32), player_backend: 'mediaplayer', player_version: '1.57.0-rc.2', playlist_include_framerate: 'true', reassignments_supported: 'true', supported_codecs: codecs, transcode_mode: 'cbr_v1',
});
const EXACT = { _exact: 1, allow_source: 'true', allow_audio_only: 'true', include_unavailable: 'true', multigroup_video: 'false', platform: 'web', playlist_include_framerate: 'true', supported_codecs: 'av1,h265,h264' }; // demande de l'application Xtra
const AUTH_TRIES = [
  { auth: 1, tok: 'site', v2: true, q: WEBV2('av1,h265,h264') },
  { auth: 1, tok: 'site', v2: true, persisted: true, q: EXACT },
  { auth: 1, tok: 'site', v2: true, q: EXACT },
  { auth: 1, tok: 'site', v2: true, persisted: true, q: WEBV2('h265,h264') },
];
const HEVC_TRIES = [
  { tok: 'site', v2: true, q: WEBV2('av1,h265,h264') },
  { tok: 'site', v2: true, q: WEBV2('h265,h264') },
  { tok: 'site', v2: true, q: WEBV2('av1,h265,h264', false) },
  { tok: 'site', q: { supported_codecs: 'av1,h265,h264', ...WEB } },
  { tok: 'site', q: { supported_codecs: 'h265,h264', ...WEB } },
  { tok: 'site', q: { supported_codecs: 'av1,h264', ...WEB } },
  { tok: 'site', q: { supported_codecs: 'av1,h265,h264' } },
  { tok: 'site', q: { supported_codecs: 'av01,hev1,avc1' } },
  { tok: 'site', q: { supported_codecs: 'hev1,avc1' } },
  { tok: 'embed', q: { supported_codecs: 'av1,h265,h264', ...WEB } },
  { tok: 'popout', q: { supported_codecs: 'av1,h265,h264', ...WEB } },
  { tok: 'site', cid: TV_ID, q: { supported_codecs: 'av1,h265,h264', ...WEB } },
  { tok: 'site', cid: TV_ID, q: { supported_codecs: 'h265,h264' } },
  { tok: 'site', cid: ANDROID_ID, q: { supported_codecs: 'av1,h265,h264', ...WEB } },
  { tok: 'site', cid: ANDROID_ID, q: { supported_codecs: 'h265,h264' } },
];
function usherUrl(login, t, extra, v2) {
  const exact = extra && extra._exact; if (exact) { extra = { ...extra }; delete extra._exact; }
  const q = new URLSearchParams(exact ? { sig: t.signature, token: t.value, p: String(Math.floor(Math.random() * 1e7)), ...extra } : { sig: t.signature, token: t.value, allow_source: 'true', allow_audio_only: 'true', ...(FEAT.fast ? { fast_bread: 'true' } : {}), player: 'twitchweb', type: 'any', supported_codecs: 'avc1', p: String(Math.floor(Math.random() * 1e7)), ...(extra || {}) });
  return 'https://usher.ttvnw.net/api/' + (v2 ? 'v2/' : '') + 'channel/hls/' + login + '.m3u8?' + q;
}
// qualités individuelles d'une liste de lecture principale : [{ name, url }]
function variantsOf(txt) {
  const names = {}, variants = [], lines = String(txt).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-MEDIA')) {
      const g = (lines[i].match(/GROUP-ID="([^"]+)"/) || [])[1], n = (lines[i].match(/NAME="([^"]+)"/) || [])[1];
      if (g && n) names[g] = n;
    }
    if (lines[i].startsWith('#EXT-X-STREAM-INF') && /^https?:\/\//.test(lines[i + 1] || '')) {
      const L = lines[i], g = (L.match(/VIDEO="([^"]+)"/) || [])[1], res = L.match(/RESOLUTION=(\d+)x(\d+)/), fr = L.match(/FRAME-RATE=([\d.]+)/), bw = L.match(/(?:^|[:,])BANDWIDTH=(\d+)/);
      const h = res ? Number(res[2]) : 0, fps = fr ? Math.round(Number(fr[1])) : 0;
      let name = (g && names[g]) || '';
      const audio = /audio_only/i.test(g || '') || /audio/i.test(name) || (!res && /audio/i.test(L));
      if (audio) name = 'Audio seul';
      else if (!/\d{3,4}p/.test(name)) name = h ? h + 'p' + (fps > 30 ? fps : '') : (g && g !== 'chunked' ? g : bw ? (Number(bw[1]) / 1e6).toFixed(1) + ' Mb/s' : 'Source');
      variants.push({ name, url: lines[i + 1].trim(), h, fps, audio });
    }
  }
  return variants;
}
// Retourne { url, qualities } si la chaîne est en direct, sinon { offline: true }
const hevcCache = new Map();
async function liveStream(login, hevc, oauth) {
  if (!hevc && !oauth) return liveOnce(login, 'site', null);
  const ck = login + '|' + (oauth ? crypto.createHash('sha1').update(oauth).digest('hex').slice(0, 8) : ''), c = hevcCache.get(ck);
  if (c && c.exp > Date.now()) return c.v;
  const list = (oauth ? AUTH_TRIES : []).concat(HEVC_TRIES), tokens = {};
  const res = await Promise.allSettled(list.map(async t => {
    const key = t.tok + (t.cid || '') + (t.auth ? 'A' : '') + (t.persisted ? 'P' : ''), tk = await (tokens[key] ||= accessToken(login, t.tok, t.cid, { oauth: t.auth ? oauth : null, persisted: t.persisted }));
    const r = await liveOnce(login, t.tok, typeof t.q === 'function' ? t.q(login) : t.q, tk, t.v2);
    r.tk = tk;
    return r;
  }));
  const hOf = r => Math.max(0, ...r.variants.map(v => v.h));
  const ok = res.map((x, i) => ({ i, x })).filter(o => o.x.status === 'fulfilled').map(o => ({ i: o.i, r: o.x.value }));
  const tries = res.map((x, i) => (list[i].auth ? 'compte:' : '') + (x.status === 'fulfilled' ? (x.value.offline ? 'hors ligne' : hOf(x.value) + 'p') : 'échec (' + String(x.reason && x.reason.message).slice(0, 40) + ')'));
  if (!ok.length) throw res[0].reason;
  let best;
  const live = ok.filter(o => !o.r.offline);
  if (!live.length) best = ok[0].r;
  else { live.sort((a, b) => hOf(b.r) - hOf(a.r) || a.i - b.i); best = { ...live[0].r, essai: live[0].i + 1 }; }
  best.essais = tries;
  if (oauth) { // ce que Twitch accorde à ce compte
    const a = ok.find(o => list[o.i].auth && o.r.tk), j = (() => { try { return a ? JSON.parse(a.r.tk.value) : null; } catch { return null; } })();
    best.compte = j ? { resolution: j.maximum_resolution || '?', connecte: !!j.user_id } : { resolution: null, connecte: false };
  }
  delete best.tk;
  if (hevcCache.size > 100) hevcCache.clear();
  hevcCache.set(ck, { v: best, exp: Date.now() + 20000 });
  return best;
}
async function liveOnce(login, tokType, extra, tok, v2) {
  const t = tok || await accessToken(login, tokType), url = usherUrl(login, t, extra, v2);
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (r.status === 404) return { offline: true, status: 404 };
  if (!r.ok) throw new Error('Twitch (usher) : HTTP ' + r.status);
  const txt = await r.text();
  if (!txt.startsWith('#EXTM3U')) throw new Error('Réponse de Twitch inattendue (pas une liste de lecture)');
  const qualities = [...txt.matchAll(/NAME="([^"]+)"/g)].map(m => m[1]);
  const variants = variantsOf(txt);
  return { url, qualities, variants, text: txt, status: r.status };
}

/* ------------------------------------------------------------------ relais « sans pub » (variable PROXIES pour changer la liste) */
// Un relais renvoie la liste de lecture d'une chaîne depuis une autre région, où Twitch n'insère pas de publicité.
// Format de PROXIES : une adresse par ligne, avec {channel} (nom optionnel : « Nom | adresse »).
const Q = '?allow_source=true&allow_audio_only=true';
const DEFAULT_PROXIES = [
  ['Luminous EU', 'https://eu.luminous.dev/live/{channel}'], ['Luminous EU 2', 'https://eu2.luminous.dev/live/{channel}'], ['Luminous EU 3', 'https://eu3.luminous.dev/live/{channel}'],
  ['Luminous AS', 'https://as.luminous.dev/live/{channel}'], ['Nadeko', 'https://twitch-al.nadeko.net/live/{channel}'],
  ['Perfprod EU', 'https://lb-eu.cdn-perfprod.com/live/{channel}'], ['Perfprod EU 2', 'https://lb-eu2.cdn-perfprod.com/live/{channel}'], ['Perfprod EU 3', 'https://lb-eu3.cdn-perfprod.com/live/{channel}'],
  ['Perfprod EU 4', 'https://lb-eu4.cdn-perfprod.com/live/{channel}'], ['Perfprod EU 5', 'https://lb-eu5.cdn-perfprod.com/live/{channel}'], ['Perfprod NA', 'https://lb-na.cdn-perfprod.com/live/{channel}'],
  ['Perfprod AS', 'https://lb-as.cdn-perfprod.com/live/{channel}'], ['Perfprod SA', 'https://lb-sa.cdn-perfprod.com/live/{channel}'],
].map(([name, url]) => ({ name, url: url + Q }));
const allProxies = () => {
  const env = String(process.env.PROXIES || '').split('\n').map(x => x.trim()).filter(Boolean);
  if (!env.length) return DEFAULT_PROXIES;
  return env.map((l, i) => { const [a, b] = l.includes('|') ? l.split('|').map(x => x.trim()) : ['Relais ' + (i + 1), l]; return { name: a, url: b }; }).filter(x => /^https:\/\/.+\{channel\}/.test(x.url));
};
const proxyList = () => allProxies().filter(x => !FEAT.offRelays.includes(x.name));
const isMaster = t => typeof t === 'string' && t.startsWith('#EXTM3U') && /#EXT-X-STREAM-INF/.test(t);
async function askProxy(px, login, signal, hevc) {
  const t0 = Date.now(), url = px.url.replace('{channel}', login) + (FEAT.fast ? (px.url.includes('?') ? '&' : '?') + 'fast_bread=true' : '') + (hevc ? (px.url.includes('?') ? '&' : '?') + 'supported_codecs=av1,h265,h264' : '');
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), FEAT.timeout);
  if (signal) signal.addEventListener('abort', () => ctl.abort(), { once: true });
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal, redirect: 'follow' });
    const text = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status);
    if (!isMaster(text)) throw new Error('réponse inattendue');
    store.incr('r|' + px.name + '|ok'); store.incr('r|' + px.name + '|ms', Date.now() - t0);
    return { name: px.name, url, text, ms: Date.now() - t0 };
  } catch (e) { if (!(signal && signal.aborted)) store.incr('r|' + px.name + '|fail'); throw Object.assign(new Error(e.name === 'AbortError' ? 'délai dépassé' : e.message), { ms: Date.now() - t0, proxy: px.name }); }
  finally { clearTimeout(timer); }
}
async function relayReport(login) {
  if (!LOGIN_RE.test(login)) return { erreur: 'nom de chaîne invalide' };
  const inspect = async r => { // où sont les segments, et y a-t-il des pubs dans la liste de lecture ?
    const v = variantsOf(absolutize(r.text, r.url)).filter(x => !x.audio).pop();
    if (!v) return {};
    try {
  const pr = await fetch(v.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(3000) }), t = await pr.text();
  const seg = t.split(/\r?\n/).find(l => /^https?:\/\//.test(l));
  return { qualite_testee: v.name, liste_http: pr.status, hote_liste: new URL(v.url).hostname, hote_segments: seg ? new URL(seg).hostname : null, pubs_detectees: /stitched|X-TV-TWITCH-AD|SCTE35|CUE-OUT/i.test(t) };
    } catch (e) { return { qualite_testee: v.name, liste_erreur: e.message }; }
  };
  const rows = await Promise.all(proxyList().map(px => askProxy(px, login).then(async r => ({ relais: px.name, ok: true, ms: r.ms, ...(await inspect(r)) }), e => ({ relais: px.name, ok: false, ms: e.ms, erreur: e.message }))));
  const direct = await liveStream(login).then(async d => d.offline ? { hors_ligne: true } : { officiel: await inspect({ text: await fetch(d.url, { headers: { 'User-Agent': UA } }).then(x => x.text()), url: d.url }) }, e => ({ officiel_erreur: e.message }));
  return { chaine: login, relais_valides: rows.filter(r => r.ok).length, sur: rows.length, flux_officiel: direct, detail: rows.filter(r => r.ok).concat(rows.filter(r => !r.ok).map(r => ({ relais: r.relais, ok: false, erreur: r.erreur }))) };
}
const proxyCache = new Map();
async function bestProxy(login, hevc) { // le relais valide le plus rapide (les autres requêtes sont annulées)
  const key = login + (hevc ? '+' : ''), c = proxyCache.get(key);
  if (c && c.exp > Date.now()) return c.v;
  const all = new AbortController();
  let v = null;
  try { v = await Promise.any(proxyList().map(px => askProxy(px, login, all.signal, hevc))); } catch { v = null; }
  all.abort();
  if (v) store.incr('r|' + v.name + '|win');
  if (proxyCache.size > 200) proxyCache.clear();
  proxyCache.set(key, { v, exp: Date.now() + (v ? 15000 : 5000) });
  return v;
}
// adresses relatives de la liste de lecture -> absolues (le lecteur ne contacte alors jamais le relais lui-même)
function absolutize(text, base) {
  const abs = u => { try { return new URL(u, base).href; } catch { return u; } };
  return text.split(/\r?\n/).map(l => !l || l.startsWith('#') ? l.replace(/URI="([^"]+)"/g, (_, u) => 'URI="' + abs(u) + '"') : abs(l)).join('\n');
}

// Mode ordinateur : les listes de lecture passent par nous, nettoyées (sans balises Twitch propres) pour le lecteur de Stremio PC.
async function gqlRaw(query) {
  const r = await fetch(GQL, { method: 'POST', headers: { 'Client-ID': GQL_CLIENT_ID, 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ query }), signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Twitch (lives) : HTTP ' + r.status);
  const j = await r.json().catch(() => ({}));
  if (!j.data) throw new Error('Twitch n\'a pas renvoyé de lives' + (j.errors && j.errors[0] ? ' : ' + String(j.errors[0].message).slice(0, 120) : ''));
  return j.data;
}
const VIDEO_NODE = 'id title publishedAt lengthSeconds viewCount previewThumbnailURL(width: 640, height: 360) game { displayName }';
const vodCache = new Map();
async function channelVods(login) {
  const c = vodCache.get(login);
  if (c && c.exp > Date.now()) return c.v;
  const d = await gqlRaw('query { user(login: ' + JSON.stringify(login) + ') { displayName login description profileImageURL(width: 300) offlineImageURL a: videos(first: 30, type: ARCHIVE, sort: TIME) { edges { node { ' + VIDEO_NODE + ' } } } h: videos(first: 10, type: HIGHLIGHT, sort: TIME) { edges { node { ' + VIDEO_NODE + ' } } } } }');
  const u = d.user, nodes = k => ((u && u[k] || {}).edges || []).map(e => e && e.node).filter(n => n && n.id);
  const v = u ? { login: u.login || login, name: u.displayName || login, avatar: u.profileImageURL || '', banner: u.offlineImageURL || '', bio: u.description || '', archives: nodes('a'), highlights: nodes('h') } : null;
  vodCache.set(login, { v, exp: Date.now() + 120000 });
  if (vodCache.size > 100) vodCache.delete(vodCache.keys().next().value);
  return v;
}
async function vodToken(id, cid = GQL_CLIENT_ID, playerType = 'site', oauth = null) {
  const hd = { 'Client-ID': cid, 'Content-Type': 'application/json', 'User-Agent': UA };
  if (oauth) { hd.Authorization = 'OAuth ' + oauth; hd['X-Device-Id'] = crypto.randomBytes(16).toString('hex'); }
  const r = await fetch(GQL, { method: 'POST', headers: hd, signal: AbortSignal.timeout(10000), body: JSON.stringify({ operationName: 'PlaybackAccessToken', variables: { isLive: false, login: '', isVod: true, vodID: id, playerType }, query: TOKEN_QUERY }) });
  if (!r.ok) throw new Error('jeton : HTTP ' + r.status);
  const j = await r.json().catch(() => ({})), t = j && j.data && j.data.videoPlaybackAccessToken;
  if (!t || !t.value || !t.signature) throw new Error('jeton refusé' + (j && j.errors && j.errors[0] ? ' (' + String(j.errors[0].message).slice(0, 80) + ')' : ' (rediff supprimée ou réservée aux abonnés ?)'));
  return t;
}
// Plusieurs variantes en parallèle (identifiant client, type de lecteur, adresse usher) : on garde la première qui répond.
const VOD_TRIES = [{ cid: GQL_CLIENT_ID, pt: 'site', path: '/vod/' }, { cid: GQL_CLIENT_ID, pt: 'site', path: '/vod/v2/' }, { cid: GQL_CLIENT_ID, pt: 'embed', path: '/vod/' }, { cid: TV_ID, pt: 'site', path: '/vod/' }, { cid: ANDROID_ID, pt: 'site', path: '/vod/' }];
async function vodMaster(id, oauth) { // avec le compte Twitch lié : les rediffs réservées aux abonnés s'ouvrent si le compte est abonné
  const errs = [], tries = oauth ? [{ cid: GQL_CLIENT_ID, pt: 'site', path: '/vod/', auth: 1 }, { cid: GQL_CLIENT_ID, pt: 'site', path: '/vod/v2/', auth: 1 }, ...VOD_TRIES] : VOD_TRIES;
  const one = async (t, i) => {
    try {
      const k = await vodToken(id, t.cid, t.pt, t.auth ? oauth : null);
      const url = 'https://usher.ttvnw.net' + t.path + id + '.m3u8?' + new URLSearchParams({ nauth: k.value, nauthsig: k.signature, allow_source: 'true', allow_audio_only: 'true', allow_spectre: 'true', player: 'twitchweb', playlist_include_framerate: 'true', p: String(Math.floor(Math.random() * 1e7)) });
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }), text = await r.text();
      if (!r.ok || !text.startsWith('#EXTM3U')) throw new Error('usher : HTTP ' + r.status);
      if (!variantsOf(text).length) throw new Error('liste vide');
      return { url, text };
    } catch (e) { errs.push('essai ' + (i + 1) + (t.auth ? ' (compte)' : '') + ' ' + e.message); throw e; }
  };
  try { return await Promise.any(tries.map(one)); } catch { /* usher refuse (403) : lecture directe depuis le CDN de Twitch */ }
  try { return await vodDirect(id); } catch (e) { errs.push('cdn ' + e.message); }
  throw new Error('Rediffusion indisponible — ' + errs.join(' ; '));
}
// Lecture directe sur le CDN de Twitch (méthode « TwitchNoSub ») : les rediffs, même réservées aux abonnés, sont servies par CloudFront à une adresse
// déduite de l'aperçu de la vidéo (…/<dossier>/storyboards/…). Utilisé quand usher refuse (403).
const CDN_Q = [['chunked', '1920x1080', 60, 8000000], ['1440p60', '2560x1440', 60, 6000000], ['1080p60', '1920x1080', 60, 5000000], ['720p60', '1280x720', 60, 3400000], ['480p30', '854x480', 30, 1400000], ['360p30', '640x360', 30, 750000], ['160p30', '284x160', 30, 300000]];
async function vodDirect(id) {
  const d = await gqlRaw('query { video(id: "' + id + '") { broadcastType createdAt seekPreviewsURL owner { login } } }'), v = d.video;
  if (!v || !v.seekPreviewsURL) throw new Error('adresse introuvable');
  const u0 = new URL(v.seekPreviewsURL), parts = u0.pathname.split('/'), k = parts.findIndex(x => x.includes('storyboards'));
  if (k < 1) throw new Error('adresse inattendue');
  const host = u0.host, special = parts[k - 1], type = String(v.broadcastType || '').toLowerCase(), old = (Date.now() - new Date(v.createdAt).getTime()) / 864e5 > 7;
  const urlOf = q => type === 'highlight' ? 'https://' + host + '/' + special + '/' + q + '/highlight-' + id + '.m3u8'
    : type === 'upload' && old ? 'https://' + host + '/' + (v.owner && v.owner.login) + '/' + id + '/' + special + '/' + q + '/index-dvr.m3u8'
      : 'https://' + host + '/' + special + '/' + q + '/index-dvr.m3u8';
  const ok = await Promise.all(CDN_Q.map(async q => { try { const u = urlOf(q[0]), r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) }); if (!r.ok) throw new Error('HTTP ' + r.status); const t = await r.text(); if (!t.startsWith('#EXTM3U')) throw new Error('liste invalide'); return { q, u }; } catch { return null; } }));
  let have = ok.filter(Boolean);
  if (have.some(o => /^(1080|1440)p60$/.test(o.q[0]))) have = have.filter(o => o.q[0] !== 'chunked'); // évite un doublon avec la source
  if (!have.length) throw new Error('aucune qualité accessible (rediff supprimée ?)');
  // « chunked » = qualité source : on ne la garde que si la 1080p60 n'existe pas déjà en doublon ; 1440p60 / 1080p60 explicites passent avant
  const text = '#EXTM3U\n' + have.map(o => '#EXT-X-STREAM-INF:BANDWIDTH=' + o.q[3] + ',RESOLUTION=' + o.q[1] + ',FRAME-RATE=' + o.q[2] + '.000\n' + o.u).join('\n') + '\n';
  return { url: have[0].u, text, direct: true };
}


// Statut de plusieurs chaînes en une seule requête : { login: { exists, live, name, avatar, viewers, title, game } }
async function liveStatuses(logins) {
  const ok = [...new Set(logins)].filter(l => LOGIN_RE.test(l));
  if (!ok.length) return {};
  const q = 'query { ' + ok.map((l, i) => 'u' + i + ': user(login: ' + JSON.stringify(l) + ') { login displayName profileImageURL(width: 150) stream { id title viewersCount game { displayName } } }').join(' ') + ' }';
  const d = await gqlRaw(q), out = {};
  ok.forEach((l, i) => {
    const u = d['u' + i];
    out[l] = u ? { exists: true, live: !!u.stream, name: u.displayName || l, avatar: u.profileImageURL || '', viewers: u.stream ? u.stream.viewersCount || 0 : 0, title: u.stream ? u.stream.title || '' : '', game: u.stream && u.stream.game ? u.stream.game.displayName : '' } : { exists: false, live: false, name: l };
  });
  return out;
}
// Infos d'une rediffusion : chaîne, date de début, durée
async function videoInfo(id) {
  const d = await gqlRaw('query { video(id: "' + String(id).replace(/\D/g, '') + '") { id createdAt lengthSeconds owner { login displayName } } }');
  const v = d.video;
  return v ? { id: v.id, start: Date.parse(v.createdAt), seconds: v.lengthSeconds || 0, login: v.owner ? v.owner.login : '', name: v.owner ? v.owner.displayName : '' } : null;
}

module.exports = { liveStatuses, videoInfo, setFeat, LOGIN_RE, UA, GQL, GQL_CLIENT_ID, gqlRaw, liveStream, liveOnce, variantsOf, bestProxy, relayReport, proxyList, absolutize, vodMaster, vodDirect, channelVods };
