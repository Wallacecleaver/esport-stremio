'use strict';
// Affiches générées (PNG) : fond sombre, lame diagonale rouge Valorant, logos des deux équipes dans leur couleur, heure de Paris.
// Les textes sont convertis en tracés (opentype.js + police Inter fournie) : aucune police système n'est nécessaire sur Vercel.
const fs = require('fs');
const path = require('path');
const { teamsOf, fmtHour, fmtDay, fmtShort } = require('./model');

let sharp = null, opentype = null;
try { sharp = require('sharp'); } catch { /* affiches indisponibles */ }
try { opentype = require('opentype.js'); } catch { /* idem */ }
const available = () => !!(sharp && opentype);

const FONT_DIR = path.join(__dirname, '..', 'node_modules', '@fontsource', 'inter', 'files');
const fonts = {};
function font(w) {
  if (!fonts[w]) { const b = fs.readFileSync(path.join(FONT_DIR, 'inter-latin-' + w + '-normal.woff')); fonts[w] = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  return fonts[w];
}
const RED = '#ff4655', INK = '#0b0d12', MUTED = '#9aa3b5';

// Texte → tracé. ls = espacement des lettres ; maxW = largeur maximale (le texte rétrécit au besoin).
function text(str, x, y, size, { weight = 700, fill = '#fff', anchor = 'start', ls = 0, maxW = 0, opacity = 1 } = {}) {
  str = String(str ?? ''); if (!str) return '';
  const f = font(weight), chars = [...str], adv = (c, s) => f.getAdvanceWidth(c, s);
  const width = s => (ls ? chars.reduce((a, c) => a + adv(c, s), 0) + ls * (chars.length - 1) : adv(str, s));
  let w = width(size);
  if (maxW && w > maxW) { const k = maxW / w; size *= k; ls *= k; w = maxW; }
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  let d;
  if (ls) { let cx = x0; d = chars.map(c => { const p = f.getPath(c, cx, y, size).toPathData(2); cx += adv(c, size) + ls; return p; }).join(''); }
  else d = f.getPath(str, x0, y, size).toPathData(2);
  return '<path d="' + d + '" fill="' + fill + '"' + (opacity < 1 ? ' fill-opacity="' + opacity + '"' : '') + '/>';
}
const measure = (str, size, { weight = 700, ls = 0 } = {}) => { const f = font(weight); return [...String(str)].reduce((a, c) => a + f.getAdvanceWidth(c, size), 0) + ls * Math.max(0, String(str).length - 1); };

const logoCache = new Map();
async function fetchBuf(url) {
  if (!url) return null;
  if (logoCache.has(url)) return logoCache.get(url);
  let buf = null;
  try { const r = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { 'User-Agent': 'Mozilla/5.0' } }); if (r.ok) buf = Buffer.from(await r.arrayBuffer()); } catch { buf = null; }
  if (logoCache.size > 300) logoCache.clear();
  logoCache.set(url, buf);
  return buf;
}
const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function hashColor(s) {
  let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360, c = 0.55, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = 0.3;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
// Couleur dominante d'un logo (assombrie / saturée pour rester lisible sur fond sombre).
async function tint(buf, name) {
  try { if (buf) { const { dominant } = await sharp(buf).resize(48, 48, { fit: 'inside' }).stats(); const lum = (dominant.r + dominant.g + dominant.b) / 3; if (lum > 25 && lum < 235) return hex(dominant); } } catch { /* repli */ }
  return hex(hashColor(name));
}
// Logo contenu dans un carré size × size (PNG), avec une ombre légère.
async function fitLogo(buf, size) { try { return await sharp(buf).resize(size, size, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(); } catch { return null; } }

async function compose(w, h, svg, layers) {
  const comp = (await Promise.all(layers)).filter(Boolean);
  return sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' + svg + '</svg>')).composite(comp).png({ compressionLevel: 8 }).toBuffer();
}
const place = async (buf, size, cx, cy) => { if (!buf) return null; const b = await fitLogo(buf, size); if (!b) return null; const m = await sharp(b).metadata(); return { input: b, left: Math.round(cx - m.width / 2), top: Math.round(cy - m.height / 2) }; };

const defs = (a, b, w, h) => '<defs><radialGradient id="ga" cx="18%" cy="20%" r="75%"><stop offset="0" stop-color="' + a + '" stop-opacity=".55"/><stop offset="1" stop-color="' + a + '" stop-opacity="0"/></radialGradient>'
  + '<radialGradient id="gb" cx="82%" cy="82%" r="75%"><stop offset="0" stop-color="' + b + '" stop-opacity=".55"/><stop offset="1" stop-color="' + b + '" stop-opacity="0"/></radialGradient>'
  + '<linearGradient id="bl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + RED + '" stop-opacity="0"/><stop offset=".5" stop-color="' + RED + '"/><stop offset="1" stop-color="' + RED + '" stop-opacity="0"/></linearGradient>'
  + '<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".75"/></linearGradient></defs>'
  + '<rect width="' + w + '" height="' + h + '" fill="' + INK + '"/><rect width="' + w + '" height="' + h + '" fill="url(#ga)"/><rect width="' + w + '" height="' + h + '" fill="url(#gb)"/>';
const hud = (w, h, m = 26, l = 34) => '<g stroke="#fff" stroke-opacity=".28" stroke-width="2" fill="none"><path d="M' + m + ' ' + (m + l) + 'V' + m + 'H' + (m + l) + '"/><path d="M' + (w - m - l) + ' ' + m + 'H' + (w - m) + 'V' + (m + l) + '"/><path d="M' + m + ' ' + (h - m - l) + 'V' + (h - m) + 'H' + (m + l) + '"/><path d="M' + (w - m - l) + ' ' + (h - m) + 'H' + (w - m) + 'V' + (h - m - l) + '"/></g>';
const statusOf = m => (m.state === 'live' ? { t: 'EN DIRECT', fill: RED, ink: '#fff' } : m.state === 'done' ? { t: 'REPLAY', fill: 'none', ink: '#fff' } : { t: 'À VENIR', fill: 'none', ink: '#fff' });
function pill(st, x, y, size = 24) {
  const ls = 3, w = measure(st.t, size, { weight: 800, ls }) + 44, h = size + 24;
  return '<rect x="' + x + '" y="' + (y - h + 8) + '" width="' + w + '" height="' + h + '" rx="6" fill="' + st.fill + '" stroke="' + (st.fill === 'none' ? 'rgba(255,255,255,.55)' : RED) + '" stroke-width="2"/>' + text(st.t, x + 22, y - 3, size, { weight: 800, ls, fill: st.ink });
}
const vsBadge = (cx, cy, s = 1) => '<g transform="translate(' + cx + ' ' + cy + ') scale(' + s + ')"><path d="M-62 -26 L50 -26 L62 26 L-50 26 Z" fill="' + RED + '"/>' + text('VS', 0, 14, 40, { weight: 800, anchor: 'middle', ls: 3 }) + '</g>';

// ---------- affiche verticale d'un match (600 × 900) ----------
// Mise en page épurée : en-tête, équipe A, VS, équipe B, bandeau heure / date / statut.
const accent = g => (g === 'lol' ? '#c8aa6e' : g === 'fn' ? '#7c8cff' : RED);
const gameName = g => (g === 'lol' ? 'LEAGUE OF LEGENDS' : g === 'fn' ? 'FORTNITE' : 'VALORANT');

// ---------- Fortnite : une session de tournoi (pas de « A contre B ») ----------
const sessionWords = (str, size, maxW) => { const w = String(str).split(' '); if (measure(str, size, { weight: 800 }) <= maxW || w.length < 2) return [str, '']; let best = 1, bd = 1e9; for (let k = 1; k < w.length; k++) { const d = Math.abs(measure(w.slice(0, k).join(' '), size, { weight: 800 }) - measure(w.slice(k).join(' '), size, { weight: 800 })); if (d < bd) { bd = d; best = k; } } return [w.slice(0, best).join(' '), w.slice(best).join(' ')]; };
async function soloPoster(m) {
  const ACC = accent(m.game), W = 600, H = 900, lg = await fetchBuf(m.event.logo), c = await tint(lg, m.event.name), st = statusOf(m);
  const name = m.teams[0].name, [e1, e2] = sessionWords(m.event.name, 42, 520), [s1, s2] = sessionWords(name, 84, 520), pw = measure(st.t, 30, { weight: 800, ls: 3 }) + 46;
  const svg = '<defs><radialGradient id="g" gradientUnits="userSpaceOnUse" cx="300" cy="330" r="300"><stop offset="0" stop-color="' + c + '" stop-opacity=".45"/><stop offset="1" stop-color="' + c + '" stop-opacity="0"/></radialGradient>'
    + '<linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + ACC + '" stop-opacity=".2"/><stop offset="1" stop-color="' + ACC + '" stop-opacity="0"/></linearGradient></defs>'
    + '<rect width="600" height="900" fill="' + INK + '"/><rect width="600" height="260" fill="url(#top)"/><rect width="600" height="900" fill="url(#g)"/>'
    + '<rect x="36" y="30" width="48" height="6" rx="3" fill="' + ACC + '"/>'
    + text(e1, 36, 84, 42, { weight: 800, maxW: 528 }) + (e2 ? text(e2, 36, 130, 42, { weight: 800, maxW: 528 }) : '')
    + (lg ? '' : text('FNCS', 300, 360, 120, { weight: 800, anchor: 'middle', fill: c, maxW: 440 }))
    + text(s1, 300, s2 ? 600 : 640, 84, { weight: 800, anchor: 'middle', maxW: 540 }) + (s2 ? text(s2, 300, 690, 84, { weight: 800, anchor: 'middle', maxW: 540 }) : '')
    + (m.stage ? text(m.stage, 300, s2 ? 726 : 690, 28, { weight: 700, anchor: 'middle', fill: ACC, ls: 4 }) : '')
    + '<rect x="24" y="748" width="552" height="132" rx="22" fill="#fff" fill-opacity=".08" stroke="#fff" stroke-opacity=".14" stroke-width="1.5"/>'
    + text(fmtHour(m.startTime), 52, 828, 86, { weight: 800, ls: -2 }) + text(fmtDay(m.startTime), 54, 863, 28, { weight: 600, fill: MUTED, ls: 0.5, maxW: 300 }) + pill(st, 552 - pw, 825, 30);
  return compose(W, H, svg, [place(lg, 280, 300, 300)]);
}
async function soloThumb(m) {
  const ACC = accent(m.game), W = 640, H = 360, lg = await fetchBuf(m.event.logo), c = await tint(lg, m.event.name), st = statusOf(m);
  const svg = defs(c, ACC, W, H) + hud(W, H, 16, 22) + (lg ? '' : text('FNCS', 140, 205, 56, { weight: 800, anchor: 'middle', fill: c }))
    + text(m.teams[0].name, 290, 190, 54, { weight: 800, maxW: 330 }) + text(m.event.name, 290, 235, 22, { weight: 600, fill: MUTED, maxW: 330 })
    + text(fmtHour(m.startTime), 28, 340, 40, { weight: 800 }) + text(fmtDay(m.startTime), 28 + measure(fmtHour(m.startTime), 40, { weight: 800 }) + 14, 340, 20, { weight: 500, fill: MUTED })
    + text(st.t, W - 28, 340, 17, { weight: 800, anchor: 'end', ls: 3, fill: m.state === 'live' ? RED : '#fff', opacity: m.state === 'live' ? 1 : .75 });
  return compose(W, H, svg, [place(lg, 170, 140, 150)]);
}
async function soloBackground(m) {
  const ACC = accent(m.game), W = 1280, H = 720, lg = await fetchBuf(m.event.logo), c = await tint(lg, m.event.name);
  const svg = defs(c, ACC, W, H) + '<rect width="1280" height="720" fill="#000" opacity=".35"/>' + text('FORTNITE', 640, 90, 28, { weight: 800, anchor: 'middle', fill: ACC, ls: 10 })
    + text(m.teams[0].name, 640, 450, 110, { weight: 800, anchor: 'middle', maxW: 1000 }) + text(m.event.name, 640, 650, 40, { weight: 800, anchor: 'middle', maxW: 1100, opacity: .9 });
  return compose(W, H, svg, [place(lg, 300, 640, 250)]);
}
async function matchPoster(m, { spoil = false } = {}) {
  if (m.solo) return soloPoster(m);
  const ACC = accent(m.game), GN = gameName(m.game);
  const [A, B] = teamsOf(m), W = 600, H = 900;
  const [la, lb] = await Promise.all([fetchBuf(A.logo), fetchBuf(B.logo)]);
  const [ca, cb] = await Promise.all([tint(la, A.name), tint(lb, B.name)]);
  const st = statusOf(m), done = m.state === 'done';
  const glow = (id, c, cx, cy) => '<radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="' + cx + '" cy="' + cy + '" r="230"><stop offset="0" stop-color="' + c + '" stop-opacity=".42"/><stop offset="1" stop-color="' + c + '" stop-opacity="0"/></radialGradient>';
  const hasScore = spoil && done && A.score != null && B.score != null;
  const mid = hasScore ? A.score + '  -  ' + B.score : 'VS';
  const pw = measure(st.t, 30, { weight: 800, ls: 3 }) + 46;
  // lisible même en petit (Stremio affiche l'affiche à ~170 px de large) : très gros textes, très peu d'éléments
  const words = String(m.event.name).split(' '), one = measure(m.event.name, 42, { weight: 800 }) <= 520;
  let l1 = m.event.name, l2 = '';
  if (!one && words.length > 1) { let best = 1, bd = 1e9; for (let k = 1; k < words.length; k++) { const d = Math.abs(measure(words.slice(0, k).join(' '), 42, { weight: 800 }) - measure(words.slice(k).join(' '), 42, { weight: 800 })); if (d < bd) { bd = d; best = k; } } l1 = words.slice(0, best).join(' '); l2 = words.slice(best).join(' '); }
  const svg = '<defs>' + glow('g1', ca, 300, 270) + glow('g2', cb, 300, 580)
    + '<linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + ACC + '" stop-opacity=".18"/><stop offset="1" stop-color="' + ACC + '" stop-opacity="0"/></linearGradient></defs>'
    + '<rect width="600" height="900" fill="' + INK + '"/><rect width="600" height="260" fill="url(#top)"/>'
    + '<rect width="600" height="900" fill="url(#g1)"/><rect width="600" height="900" fill="url(#g2)"/>'
    + '<rect x="36" y="30" width="48" height="6" rx="3" fill="' + ACC + '"/>'
    + text(l1, 36, 84, 42, { weight: 800, maxW: 528 }) + (l2 ? text(l2, 36, 130, 42, { weight: 800, maxW: 528 }) : '')
    + (la ? '' : text(A.code || A.name, 300, 300, 120, { weight: 800, anchor: 'middle', maxW: 330, fill: ca }))
    + text(A.name, 300, 414, 42, { weight: 800, anchor: 'middle', maxW: 560 })
    + '<rect x="36" y="455" width="215" height="2" fill="#fff" fill-opacity=".16"/><rect x="349" y="455" width="215" height="2" fill="#fff" fill-opacity=".16"/>'
    + text(mid, 300, 468, hasScore ? 40 : 32, { weight: 800, anchor: 'middle', ls: hasScore ? 2 : 6, fill: hasScore ? '#fff' : ACC })
    + (lb ? '' : text(B.code || B.name, 300, 610, 120, { weight: 800, anchor: 'middle', maxW: 330, fill: cb }))
    + text(B.name, 300, 727, 42, { weight: 800, anchor: 'middle', maxW: 560 })
    + '<rect x="24" y="748" width="552" height="132" rx="22" fill="#fff" fill-opacity=".08" stroke="#fff" stroke-opacity=".14" stroke-width="1.5"/>'
    + text(fmtHour(m.startTime), 52, 828, 86, { weight: 800, ls: -2 })
    + text(fmtDay(m.startTime), 54, 863, 28, { weight: 600, fill: MUTED, ls: 0.5, maxW: 300 })
    + pill(st, 552 - pw, 825, 30);
  const lgBuf = await fetchBuf(m.event && m.event.logo || m.league && m.league.image);
  const faded = async (size, cx, cy, a) => { if (!lgBuf) return null; try { const b = await sharp(lgBuf).resize(size, size, { fit: 'inside' }).ensureAlpha().linear([1, 1, 1, a], [0, 0, 0, 0]).png().toBuffer(); const mt = await sharp(b).metadata(); return { input: b, left: Math.round(cx - mt.width / 2), top: Math.round(cy - mt.height / 2) }; } catch { return null; } };
  return compose(W, H, svg, [faded(600, 300, 450, 0.035), place(la, 225, 300, 270), place(lb, 225, 300, 585)]);
}

// ---------- vignette d'épisode (640 × 360) ----------
async function matchThumb(m) {
  if (m.solo) return soloThumb(m);
  const ACC = accent(m.game), GN = gameName(m.game);
  const [A, B] = teamsOf(m), W = 640, H = 360;
  const [la, lb] = await Promise.all([fetchBuf(A.logo), fetchBuf(B.logo)]);
  const [ca, cb] = await Promise.all([tint(la, A.name), tint(lb, B.name)]), st = statusOf(m);
  const svg = defs(ca, cb, W, H) + '<polygon points="300,0 340,0 260,360 220,360" fill="' + ACC + '" opacity=".85"/>' + hud(W, H, 16, 22)
    + vsBadge(320, 180, .62) + (la ? '' : text(A.code || A.name, 120, 205, 56, { weight: 800, anchor: 'middle', maxW: 170, fill: ca })) + (lb ? '' : text(B.code || B.name, 520, 205, 56, { weight: 800, anchor: 'middle', maxW: 170, fill: cb }))
    + text(fmtHour(m.startTime), 28, 340, 40, { weight: 800 }) + text(fmtDay(m.startTime), 28 + measure(fmtHour(m.startTime), 40, { weight: 800 }) + 14, 340, 20, { weight: 500, fill: MUTED })
    + text(st.t, W - 28, 340, 17, { weight: 800, anchor: 'end', ls: 3, fill: m.state === 'live' ? ACC : '#fff', opacity: m.state === 'live' ? 1 : .75 })
    + text(m.stage || m.event.name, 28, 42, 18, { weight: 600, fill: MUTED, maxW: 584, ls: 1 });
  return compose(W, H, svg, [place(la, 150, 120, 180), place(lb, 150, 520, 180)]);
}

// ---------- fond 16:9 de la fiche (1280 × 720) ----------
async function matchBackground(m) {
  if (m.solo) return soloBackground(m);
  const ACC = accent(m.game), GN = gameName(m.game);
  const [A, B] = teamsOf(m), W = 1280, H = 720;
  const [la, lb] = await Promise.all([fetchBuf(A.logo), fetchBuf(B.logo)]);
  const [ca, cb] = await Promise.all([tint(la, A.name), tint(lb, B.name)]);
  const svg = defs(ca, cb, W, H) + '<polygon points="560,0 700,0 560,720 420,720" fill="' + ACC + '" opacity=".6"/><rect width="1280" height="720" fill="#000" opacity=".35"/>'
    + text(GN, 640, 90, 28, { weight: 800, anchor: 'middle', fill: ACC, ls: 10 }) + text(m.event.name, 640, 650, 40, { weight: 800, anchor: 'middle', maxW: 1100, opacity: .9 });
  return compose(W, H, svg, [place(la, 360, 300, 360), place(lb, 360, 980, 360)]);
}

// ---------- affiche d'une série « Valorant 2026 » (600 × 900) ----------
async function seriesPoster({ year, title = 'VALORANT', subtitle = '', logo } = {}) {
  const W = 600, H = 900, lg = await fetchBuf(logo);
  const svg = defs('#ff4655', '#5a1d28', W, H) + '<polygon points="-10,700 610,330 610,372 -10,742" fill="url(#bl)"/><polygon points="0,0 250,0 0,420" fill="#fff" fill-opacity=".04"/>' + hud(W, H)
    + text(title, 52, 470, 78, { weight: 800, maxW: 496, ls: 2 }) + text(String(year), 50, 600, 150, { weight: 800, fill: RED, ls: -4 })
    + text(subtitle, 54, 660, 26, { weight: 500, fill: MUTED, maxW: 496, ls: 2 }) + text('ESPORT · MATCHS · REDIFFUSIONS', 54, 846, 18, { weight: 700, fill: '#fff', opacity: .7, ls: 5, maxW: 496 });
  return compose(W, H, svg, [place(lg, 200, 300, 200)]);
}

// ---------- affiche d'un événement / d'une série (600 × 900) ----------
async function eventPoster({ name = '', year = '', comp = '', logo, count = 0, live = false, game = 'val' } = {}) {
  const ACC = accent(game), GN = gameName(game);
  const W = 600, H = 900, lg = await fetchBuf(logo), c = await tint(lg, name);
  const title = String(name).replace(new RegExp('\\s*' + year + '\\s*$'), '').trim() || String(name);
  const words = title.split(' '), fits = measure(title, 56, { weight: 800 }) <= 520;
  let l1 = title, l2 = '';
  if (!fits && words.length > 1) { let best = 1, bd = 1e9; for (let k = 1; k < words.length; k++) { const d = Math.abs(measure(words.slice(0, k).join(' '), 56, { weight: 800 }) - measure(words.slice(k).join(' '), 56, { weight: 800 })); if (d < bd) { bd = d; best = k; } } l1 = words.slice(0, best).join(' '); l2 = words.slice(best).join(' '); }
  const ny = l2 ? 560 : 590;
  const svg = '<defs><radialGradient id="g" gradientUnits="userSpaceOnUse" cx="300" cy="320" r="300"><stop offset="0" stop-color="' + c + '" stop-opacity=".45"/><stop offset="1" stop-color="' + c + '" stop-opacity="0"/></radialGradient>'
    + '<linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + ACC + '" stop-opacity=".2"/><stop offset="1" stop-color="' + ACC + '" stop-opacity="0"/></linearGradient></defs>'
    + '<rect width="600" height="900" fill="' + INK + '"/><rect width="600" height="280" fill="url(#top)"/><rect width="600" height="900" fill="url(#g)"/>'
    + '<rect x="36" y="30" width="48" height="6" rx="3" fill="' + ACC + '"/>'
    + text(title.toLowerCase().includes(String(comp).toLowerCase()) ? GN : String(comp).toUpperCase(), 36, 86, 30, { weight: 800, fill: ACC, ls: 5, maxW: 528 })
    + (lg ? '' : text(GN, 300, 360, 90, { weight: 800, anchor: 'middle', fill: c, maxW: 440 }))
    + text(l1, 300, ny, 56, { weight: 800, anchor: 'middle', maxW: 540 }) + (l2 ? text(l2, 300, ny + 60, 56, { weight: 800, anchor: 'middle', maxW: 540 }) : '')
    + text(String(year), 300, 770, 130, { weight: 800, anchor: 'middle', fill: ACC, ls: -3 })
    + '<rect x="24" y="796" width="552" height="80" rx="20" fill="#fff" fill-opacity=".08" stroke="#fff" stroke-opacity=".14" stroke-width="1.5"/>'
    + text(count + ' matchs', live ? 56 : 300, 848, 34, { weight: 700, anchor: live ? 'start' : 'middle', fill: '#fff' })
    + (live ? '<rect x="400" y="814" width="152" height="44" rx="8" fill="' + ACC + '"/>' + text('EN DIRECT', 476, 846, 24, { weight: 800, anchor: 'middle', ls: 2 }) : '');
  return compose(W, H, svg, [place(lg, 300, 300, 330)]);
}

// ---------- affiche « Mon équipe » / catalogue d'une équipe (600 × 900) ----------
async function teamPoster({ name, logo, sub = '' } = {}) {
  const W = 600, H = 900, lg = await fetchBuf(logo), c = await tint(lg, name);
  const svg = defs(c, '#ff4655', W, H) + '<circle cx="300" cy="330" r="210" fill="' + c + '" fill-opacity=".16"/><polygon points="-10,700 610,330 610,372 -10,742" fill="url(#bl)"/>' + hud(W, H)
    + text('⭐ MON ÉQUIPE', 52, 84, 22, { weight: 800, fill: RED, ls: 6 }) + text(name, 52, 790, 56, { weight: 800, maxW: 496 }) + text(sub, 54, 836, 22, { weight: 500, fill: MUTED, ls: 2, maxW: 496 });
  return compose(W, H, svg, [place(lg, 300, 300, 330)]);
}

// ---------- logo de l'addon (512 × 512) : un « E » dont la barre du milieu est un bouton lecture ----------
const MARK = c => '<defs><linearGradient id="pl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c + '"/><stop offset="1" stop-color="#ff8b95"/></linearGradient></defs>'
  + '<rect x="132" y="118" width="62" height="276" rx="16" fill="#fff"/><rect x="132" y="118" width="250" height="62" rx="16" fill="#fff"/><rect x="132" y="332" width="250" height="62" rx="16" fill="#fff"/>'
  + '<path d="M238 212 L356 256 L238 300 Z" fill="url(#pl)" stroke="url(#pl)" stroke-width="20" stroke-linejoin="round"/>';
async function logoPng(color = RED) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1c2233"/><stop offset="1" stop-color="#0a0c11"/></linearGradient>'
    + '<radialGradient id="h" cx="30%" cy="22%" r="75%"><stop offset="0" stop-color="' + color + '" stop-opacity=".38"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></radialGradient></defs>'
    + '<rect width="512" height="512" rx="112" fill="url(#g)"/><rect width="512" height="512" rx="112" fill="url(#h)"/><rect x="5" y="5" width="502" height="502" rx="107" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="3"/>'
    + MARK(color) + '</svg>';
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { logoPng, available, matchPoster, matchThumb, matchBackground, seriesPoster, eventPoster, teamPoster };
