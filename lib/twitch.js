'use strict';
// Twitch (API publique du site web, aucune clé nécessaire) : lives des chaînes, archives, lecture des rediffusions et des lives.
const crypto = require('crypto');
const GQL = process.env.TW_GQL || 'https://gql.twitch.tv/gql';
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // identifiant public du lecteur web de Twitch
const TV_ID = 'ue6666qo983tsx6so1t0vnawi233wa', ANDROID_ID = 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const LOGIN_RE = /^[a-z0-9_]{3,25}$/;

async function gql(query, { cid = CLIENT_ID, oauth, body } = {}) {
  const headers = { 'Client-ID': cid, 'Content-Type': 'application/json', 'User-Agent': UA };
  if (oauth) { headers.Authorization = 'OAuth ' + oauth; headers['X-Device-Id'] = crypto.randomBytes(16).toString('hex'); }
  const r = await fetch(GQL, { method: 'POST', headers, body: JSON.stringify(body || { query }), signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('Twitch : HTTP ' + r.status);
  const j = await r.json().catch(() => ({}));
  if (!j.data) throw new Error('Twitch : réponse vide' + (j.errors && j.errors[0] ? ' (' + String(j.errors[0].message).slice(0, 80) + ')' : ''));
  return j.data;
}

// ----- qui est en direct ? (une seule requête pour toutes les chaînes) -----
const liveCache = { v: null, k: '', exp: 0 };
async function liveStatus(logins) {
  const list = [...new Set(logins.filter(l => LOGIN_RE.test(l)))], k = list.join(',');
  if (liveCache.v && liveCache.k === k && liveCache.exp > Date.now()) return liveCache.v;
  const q = 'query { ' + list.map((l, i) => 'c' + i + ': user(login: ' + JSON.stringify(l) + ') { login displayName profileImageURL(width: 150) stream { title viewersCount game { displayName } } }').join(' ') + ' }';
  const d = await gql(q), out = {};
  list.forEach((l, i) => { const u = d['c' + i]; if (u) out[l] = { login: u.login || l, name: u.displayName || l, avatar: u.profileImageURL || '', live: !!u.stream, viewers: u.stream ? Number(u.stream.viewersCount) || 0 : 0, title: u.stream ? u.stream.title || '' : '', game: u.stream && u.stream.game ? u.stream.game.displayName : '' }; });
  liveCache.v = out; liveCache.k = k; liveCache.exp = Date.now() + 30000;
  return out;
}

// ----- archives (rediffusions) d'une chaîne -----
const arcCache = new Map();
async function archives(login, n = 40) {
  const c = arcCache.get(login);
  if (c && c.exp > Date.now()) return c.v;
  const d = await gql('query { user(login: ' + JSON.stringify(login) + ') { videos(first: ' + n + ', type: ARCHIVE, sort: TIME) { edges { node { id title publishedAt lengthSeconds } } } } }');
  const v = (((d.user || {}).videos || {}).edges || []).map(e => e.node).filter(Boolean).map(x => ({ id: String(x.id), title: x.title || '', start: Date.parse(x.publishedAt), len: Number(x.lengthSeconds) || 0 })).filter(x => x.start);
  arcCache.set(login, { v, exp: Date.now() + 600000 });
  if (arcCache.size > 60) arcCache.delete(arcCache.keys().next().value);
  return v;
}
// Archives d'une chaîne qui couvrent la fenêtre [from, to] (ms) : [{ v, s, e }] en secondes dans chaque vidéo.
function partsForWindow(arcs, from, to) {
  const out = [];
  for (const a of arcs.slice().sort((x, y) => x.start - y.start)) {
    const end = a.start + a.len * 1000;
    if (end < from || a.start > to) continue;
    out.push({ v: a.id, s: Math.max(0, Math.floor((from - a.start) / 1000)), e: Math.min(a.len, Math.ceil((to - a.start) / 1000)) });
  }
  return out;
}

// ----- lecture d'une rediffusion -----
const TOKEN_Q = 'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature __typename } videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature __typename } }';
async function token({ login = '', vod = '', cid = CLIENT_ID, pt = 'site', oauth } = {}) {
  const live = !vod;
  const d = await gql(null, { cid, oauth, body: { operationName: 'PlaybackAccessToken', variables: { isLive: live, login, isVod: !live, vodID: vod || '', playerType: pt }, query: TOKEN_Q } });
  const t = live ? d.streamPlaybackAccessToken : d.videoPlaybackAccessToken;
  if (!t || !t.value || !t.signature) throw new Error('jeton refusé');
  return t;
}
async function text(url, ms = 8000) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(ms) });
  const t = await r.text();
  if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
  if (!t.startsWith('#EXTM3U')) throw new Error('liste de lecture invalide');
  return t;
}
const abs = (u, base) => new URL(u, base).toString();

// Liste principale d'une rediffusion : [{ h, fps, bw, url }] (de la meilleure à la moins bonne).
function variantsOf(master, base) {
  const L = master.split(/\r?\n/), out = [];
  for (let i = 0; i < L.length; i++) {
    if (!L[i].startsWith('#EXT-X-STREAM-INF')) continue;
    if (/audio_only/i.test(L[i])) continue;
    let j = i + 1; while (j < L.length && (!L[j].trim() || L[j].startsWith('#'))) j++;
    if (j >= L.length) continue;
    const res = /RESOLUTION=(\d+)x(\d+)/.exec(L[i]), fr = /FRAME-RATE=([\d.]+)/.exec(L[i]), bw = /BANDWIDTH=(\d+)/.exec(L[i]);
    out.push({ h: res ? Number(res[2]) : 0, fps: fr ? Math.round(Number(fr[1])) : 30, bw: bw ? Number(bw[1]) : 0, url: abs(L[j].trim(), base) });
  }
  return out.sort((a, b) => b.h - a.h || b.fps - a.fps || b.bw - a.bw);
}

// Plusieurs essais en parallèle (usher peut répondre 403 depuis certains serveurs) ; repli sur le CDN de Twitch (adresse déduite de l'aperçu de la vidéo).
const CDN_Q = [['chunked', 1080, 60, 8e6], ['1440p60', 1440, 60, 6e6], ['1080p60', 1080, 60, 5e6], ['720p60', 720, 60, 3.4e6], ['480p30', 480, 30, 1.4e6], ['360p30', 360, 30, 7.5e5], ['160p30', 160, 30, 3e5]];
async function vodMaster(id, oauth) {
  const errs = [];
  const tries = [{ pt: 'site', path: '/vod/' }, { pt: 'site', path: '/vod/v2/' }, { pt: 'embed', path: '/vod/' }, { pt: 'site', cid: TV_ID, path: '/vod/' }, { pt: 'site', cid: ANDROID_ID, path: '/vod/' }];
  if (oauth) tries.unshift({ pt: 'site', path: '/vod/', oauth }, { pt: 'site', path: '/vod/v2/', oauth });
  const one = async (t, i) => {
    try {
      const k = await token({ vod: id, cid: t.cid, pt: t.pt, oauth: t.oauth });
      const url = 'https://usher.ttvnw.net' + t.path + id + '.m3u8?' + new URLSearchParams({ nauth: k.value, nauthsig: k.signature, allow_source: 'true', allow_audio_only: 'true', allow_spectre: 'true', player: 'twitchweb', playlist_include_framerate: 'true', p: String(Math.floor(Math.random() * 1e7)) });
      const txt = await text(url); const v = variantsOf(txt, url); if (!v.length) throw new Error('liste vide');
      return { variants: v, via: 'usher' };
    } catch (e) { errs.push('essai ' + (i + 1) + ' ' + e.message); throw e; }
  };
  try { return await Promise.any(tries.map(one)); } catch { /* CDN direct */ }
  try { return await vodDirect(id); } catch (e) { errs.push('cdn ' + e.message); }
  throw new Error('rediffusion indisponible — ' + errs.join(' ; '));
}
async function vodDirect(id) {
  const d = await gql('query { video(id: "' + String(id).replace(/\D/g, '') + '") { broadcastType createdAt seekPreviewsURL owner { login } } }'), v = d.video;
  if (!v || !v.seekPreviewsURL) throw new Error('adresse introuvable');
  const u0 = new URL(v.seekPreviewsURL), parts = u0.pathname.split('/'), k = parts.findIndex(x => x.includes('storyboards'));
  if (k < 1) throw new Error('adresse inattendue');
  const host = u0.host, special = parts[k - 1], type = String(v.broadcastType || '').toLowerCase(), old = (Date.now() - new Date(v.createdAt).getTime()) / 864e5 > 7;
  const urlOf = q => type === 'highlight' ? 'https://' + host + '/' + special + '/' + q + '/highlight-' + id + '.m3u8'
    : type === 'upload' && old ? 'https://' + host + '/' + (v.owner && v.owner.login) + '/' + id + '/' + special + '/' + q + '/index-dvr.m3u8'
      : 'https://' + host + '/' + special + '/' + q + '/index-dvr.m3u8';
  const ok = await Promise.all(CDN_Q.map(async q => { try { const u = urlOf(q[0]); await text(u, 6000); return { h: q[1], fps: q[2], bw: q[3], url: u, name: q[0] }; } catch { return null; } }));
  let have = ok.filter(Boolean);
  if (have.some(x => /^(1080|1440)p60$/.test(x.name))) have = have.filter(x => x.name !== 'chunked');
  if (!have.length) throw new Error('aucune qualité accessible');
  return { variants: have.sort((a, b) => b.h - a.h || b.bw - a.bw), via: 'cdn' };
}

// Garde dans une liste de lecture de rediffusion les segments entre `start` et `end` (secondes) ; segments « -unmuted » → « -muted » (CDN).
function trim(media, base, start = 0, end = null) {
  const from = Math.max(0, start - 3), to = end != null ? end + 6 : Infinity;
  const head = [], body = []; let t = 0, pending = [], started = false, map = null;
  for (const raw of media.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#EXT-X-ENDLIST') || line.startsWith('#EXT-X-MEDIA-SEQUENCE') || line.startsWith('#EXT-X-PLAYLIST-TYPE')) continue;
    if (line.startsWith('#EXT-X-MAP')) { map = '#EXT-X-MAP:URI="' + abs((/URI="([^"]+)"/.exec(line) || [])[1] || '', base) + '"'; continue; }
    if (!started && line.startsWith('#') && !line.startsWith('#EXTINF')) { if (!/^#EXT-X-(TWITCH|START|PROGRAM-DATE-TIME)/.test(line)) head.push(line); continue; }
    started = true;
    if (line.startsWith('#')) { if (!/^#EXT-X-(PROGRAM-DATE-TIME|DATERANGE|TWITCH)/.test(line)) pending.push(line); continue; }
    const inf = pending.find(l => l.startsWith('#EXTINF')), dur = inf ? parseFloat(inf.slice(8)) || 0 : 0, s0 = t; t += dur;
    if (t > from && s0 < to) body.push(...pending, abs(line, base).replace(/-unmuted/g, '-muted'));
    pending = [];
  }
  if (!body.length) throw new Error('aucun segment dans la fenêtre demandée');
  const tv = Math.max(...body.filter(l => l.startsWith('#EXTINF')).map(l => Math.ceil(parseFloat(l.slice(8)) || 0)), 2);
  return ['#EXTM3U', '#EXT-X-VERSION:' + (map ? 6 : 3), '#EXT-X-TARGETDURATION:' + tv, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD', ...head.filter(l => !/^#(EXTM3U|EXT-X-VERSION|EXT-X-TARGETDURATION)/.test(l)), ...(map ? [map] : []), ...body, '#EXT-X-ENDLIST'].join('\n') + '\n';
}

// Rediffusion d'un match : liste de lecture unique, pour une ou plusieurs vidéos mises bout à bout.
// parts : [{ v, s, e }] ; cap : hauteur maximale (0 = meilleure).
async function vodPlaylist(parts, cap = 0) {
  const chunks = [];
  for (const p of parts) {
    const m = await vodMaster(p.v), pick = m.variants.find(x => !cap || !x.h || x.h <= cap) || m.variants[m.variants.length - 1];
    const media = await text(pick.url, 10000);
    chunks.push(trim(media, pick.url, p.s, p.e));
  }
  if (chunks.length === 1) return chunks[0];
  return ['#EXTM3U', ...chunks[0].split('\n').filter(l => /^#EXT-X-(VERSION|TARGETDURATION|MEDIA-SEQUENCE|PLAYLIST-TYPE)/.test(l)),
    ...chunks.flatMap((c, i) => [...(i ? ['#EXT-X-DISCONTINUITY'] : []), ...c.split('\n').filter(l => l && !/^#(EXTM3U|EXT-X-VERSION|EXT-X-TARGETDURATION|EXT-X-MEDIA-SEQUENCE|EXT-X-PLAYLIST-TYPE|EXT-X-ENDLIST)/.test(l))]), '#EXT-X-ENDLIST'].join('\n') + '\n';
}

// ----- lecture d'un live -----
async function liveMaster(login, cap = 0) {
  const k = await token({ login });
  const url = 'https://usher.ttvnw.net/api/channel/hls/' + login + '.m3u8?' + new URLSearchParams({ sig: k.signature, token: k.value, allow_source: 'true', allow_audio_only: 'true', player: 'twitchweb', type: 'any', supported_codecs: 'avc1', p: String(Math.floor(Math.random() * 1e7)) });
  const txt = await text(url);
  return cap ? filterMaster(txt, cap) : txt;
}
// Retire les qualités plus hautes que `cap`.
function filterMaster(txt, cap) {
  const L = txt.split(/\r?\n/), out = []; let kept = 0;
  for (let i = 0; i < L.length; i++) {
    if (L[i].startsWith('#EXT-X-STREAM-INF')) {
      const h = Number((/RESOLUTION=\d+x(\d+)/.exec(L[i]) || [])[1] || 0);
      if (h && h > cap) { i++; continue; }
      kept++; out.push(L[i], L[i + 1]); i++;
    } else out.push(L[i]);
  }
  return kept ? out.join('\n') : txt;
}

module.exports = { LOGIN_RE, UA, gql, liveStatus, archives, partsForWindow, vodMaster, vodPlaylist, trim, variantsOf, liveMaster, filterMaster };
