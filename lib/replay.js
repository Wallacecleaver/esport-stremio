'use strict';
// Rediffusions Twitch d'un match : on découpe la vidéo d'un live (VOD) sur la durée du match et on la sert comme un seul flux.
// Les rediffs réservées aux abonnés passent par la lecture directe (méthode TwitchNoSub, voir twitch.vodMaster / vodDirect).
const tw = require('./twitch');

const SEG_TIMEOUT = 8000;
const fetchText = async url => {
  const r = await fetch(url, { headers: { 'User-Agent': tw.UA }, signal: AbortSignal.timeout(SEG_TIMEOUT) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
};

// Qualité choisie dans la liste principale d'une rediff, selon le plafond du profil (cap = 0 : la meilleure).
function pickVariant(masterText, cap) {
  const vars = tw.variantsOf(masterText).filter(v => !v.audio && v.url);
  if (!vars.length) return null;
  const ok = vars.filter(v => !cap || !v.h || v.h <= cap);
  return (ok.length ? ok : vars).sort((a, b) => (b.h - a.h) || (b.fps - a.fps))[0];
}

// Garde seulement les segments entre `start` et `end` (secondes depuis le début de la vidéo).
function trimPlaylist(text, baseUrl, start = 0, end = null, { muted = false } = {}) {
  const from = Math.max(0, start), to = end != null ? end : Infinity;
  const header = [], body = [];
  let t = 0, pending = [], started = false, firstSeq = null, idx = 0, baseSeq = 0, target = 0, version = 3;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#EXT-X-ENDLIST')) continue;
    let m = line.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/);
    if (m) { baseSeq = Number(m[1]); continue; }
    if ((m = line.match(/^#EXT-X-TARGETDURATION:(\d+)/))) { target = Number(m[1]); continue; }
    if ((m = line.match(/^#EXT-X-VERSION:(\d+)/))) { version = Number(m[1]); continue; }
    if (!started && line.startsWith('#') && !line.startsWith('#EXTINF') && !line.startsWith('#EXT-X-PROGRAM-DATE-TIME')) {
      if (!/^#EXT-X-(PLAYLIST-TYPE|TWITCH|START|DATERANGE|MAP)/.test(line) && line !== '#EXTM3U') header.push(line);
      if (/^#EXT-X-MAP/.test(line)) header.push(line.replace(/URI="([^"]+)"/, (_, u) => 'URI="' + new URL(u, baseUrl).href + '"'));
      continue;
    }
    started = true;
    if (line.startsWith('#')) { pending.push(line); continue; }
    const inf = pending.find(l => l.startsWith('#EXTINF')), dur = inf ? parseFloat(inf.slice(8)) || 0 : 0, segStart = t;
    t += dur;
    if (t > from && segStart < to) {
      if (firstSeq == null) firstSeq = baseSeq + idx;
      let url = new URL(line, baseUrl).href;
      if (muted) url = url.replace(/-unmuted/g, '-muted'); // rediff réservée aux abonnés : seuls les segments « muted » sont ouverts
      body.push(...pending.filter(l => !/^#EXT-X-(PROGRAM-DATE-TIME|DATERANGE|TWITCH)/.test(l)), url);
    }
    idx++; pending = [];
  }
  return { text: ['#EXTM3U', '#EXT-X-VERSION:' + version, '#EXT-X-TARGETDURATION:' + (target || 10), ...header.filter(l => !/^#EXT-X-(VERSION|TARGETDURATION)/.test(l)), '#EXT-X-MEDIA-SEQUENCE:' + (firstSeq || 0), '#EXT-X-PLAYLIST-TYPE:VOD', ...body.filter(Boolean), '#EXT-X-ENDLIST'].join('\n') + '\n', segments: body.filter(l => !l.startsWith('#')).length };
}

async function partPlaylist(p, cap) {
  const master = await tw.vodMaster(p.v);
  const v = pickVariant(master.text, cap);
  if (!v) throw new Error('aucune qualité dans la rediffusion ' + p.v);
  const media = await fetchText(v.url);
  const muted = !!master.direct || /cloudfront/.test(v.url);
  const r = trimPlaylist(media, v.url, p.s || 0, p.e == null ? null : p.e, { muted });
  if (!r.segments) throw new Error('aucun segment dans la tranche demandée (rediffusion trop courte ?)');
  return r.text;
}

// parts = [{ v: id de la vidéo Twitch, s: début (s), e: fin (s) | null }] ; plusieurs vidéos sont mises bout à bout.
async function playlist(parts, cap = 0) {
  const lists = await Promise.all(parts.map(p => partPlaylist(p, cap)));
  if (lists.length === 1) return lists[0];
  let target = 0, version = 3;
  const body = [];
  lists.forEach((l, i) => {
    const lines = l.split(/\r?\n/);
    target = Math.max(target, Number((lines.find(x => x.startsWith('#EXT-X-TARGETDURATION')) || '').split(':')[1]) || 0);
    version = Math.max(version, Number((lines.find(x => x.startsWith('#EXT-X-VERSION')) || '').split(':')[1]) || 3);
    const segs = lines.filter(x => x && (x.startsWith('#EXTINF') || x.startsWith('#EXT-X-BYTERANGE') || !x.startsWith('#')));
    if (i > 0 && segs.length) body.push('#EXT-X-DISCONTINUITY');
    body.push(...segs);
  });
  return ['#EXTM3U', '#EXT-X-VERSION:' + version, '#EXT-X-TARGETDURATION:' + (target || 10), '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD', ...body, '#EXT-X-ENDLIST'].join('\n') + '\n';
}

// Adresse d'une rediffusion : les morceaux voyagent dans l'URL (base64url), rien n'est stocké.
const encodeParts = parts => Buffer.from(JSON.stringify(parts.map(p => [String(p.v), Math.round(p.s || 0), p.e == null ? null : Math.round(p.e)]))).toString('base64url');
function decodeParts(s) {
  try {
    const a = JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8'));
    if (!Array.isArray(a) || !a.length || a.length > 6) return null;
    const parts = a.map(([v, st, e]) => ({ v: String(v), s: Number(st) || 0, e: e == null ? null : Number(e) }));
    return parts.every(p => /^\d{5,14}$/.test(p.v)) ? parts : null;
  } catch { return null; }
}

// ---- Repli : retrouver le match dans les rediffs (VOD) d'une chaîne, à partir de l'heure du match ----
// span = { from, to } en ms. Retourne les morceaux de vidéos qui couvrent la tranche, ou [].
async function archiveParts(login, span) {
  const ch = await tw.channelVods(login).catch(() => null);
  if (!ch) return [];
  const arch = ch.archives.map(a => ({ id: a.id, start: Date.parse(a.publishedAt), end: Date.parse(a.publishedAt) + (a.lengthSeconds || 0) * 1000 })).filter(a => a.start && a.end > a.start);
  return arch.filter(a => a.end > span.from && a.start < span.to).sort((a, b) => a.start - b.start).map(a => ({
    v: a.id, s: Math.max(0, Math.floor((Math.max(span.from, a.start) - a.start) / 1000)), e: Math.ceil((Math.min(span.to, a.end) - a.start) / 1000),
  }));
}
// Tranche supposée d'un match quand on n'a pas les heures exactes : 10 min avant → durée probable du BO + 25 min.
const spanOf = m => ({ from: m.startTime - 10 * 60e3, to: m.startTime + ((m.bestOf || 3) * 50 + 25) * 60e3 });

module.exports = { playlist, encodeParts, decodeParts, archiveParts, spanOf, trimPlaylist, pickVariant };
