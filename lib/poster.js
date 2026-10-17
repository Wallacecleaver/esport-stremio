'use strict';
// Affiches générées (PNG) — style « broadcast » : les deux logos côte à côte sur un fond aux couleurs du jeu et des équipes,
// le jeu en badge, l'événement et la phase en en-tête, et une bande d'état en bas (heure de Paris, EN DIRECT ou REDIFFUSION).
// Les textes sont convertis en tracés (opentype.js + police fournie) : aucun besoin de polices système sur Vercel.
const fs = require('fs');
const path = require('path');
const { teamsOf, shortOf, fmtHour, fmtDay } = require('./model');

let sharp = null, opentype = null;
try { sharp = require('sharp'); } catch { /* affiches indisponibles : l'addon renvoie alors le logo d'une équipe */ }
try { opentype = require('opentype.js'); } catch { /* idem */ }

const FONT_DIR = path.join(__dirname, '..', 'node_modules', '@fontsource', 'barlow-condensed', 'files');
const fonts = {};
function font(weight) {
  if (!fonts[weight]) {
    const buf = fs.readFileSync(path.join(FONT_DIR, 'barlow-condensed-latin-' + weight + '-normal.woff'));
    fonts[weight] = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  return fonts[weight];
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Texte → tracé SVG. anchor : 'start' | 'middle' | 'end'. Réduit la taille si le texte dépasse maxW.
function text(str, x, y, size, { weight = 800, fill = '#fff', anchor = 'start', maxW = 0, opacity = 1 } = {}) {
  const f = font(weight);
  str = String(str);
  let w = f.getAdvanceWidth(str, size);
  if (maxW && w > maxW) { size = size * maxW / w; w = maxW; }
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return '<path d="' + f.getPath(str, x0, y, size).toPathData(2) + '" fill="' + fill + '"' + (opacity < 1 ? ' fill-opacity="' + opacity + '"' : '') + '/>';
}

const logoCache = new Map();
async function fetchLogo(url) {
  if (!url) return null;
  if (logoCache.has(url)) return logoCache.get(url);
  let buf = null;
  try {
    if (/^data:/.test(url)) buf = Buffer.from(url.split(',')[1], 'base64');
    else if (/^file:/.test(url)) buf = fs.readFileSync(new URL(url));
    else { const r = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { 'User-Agent': 'Mozilla/5.0' } }); if (r.ok) buf = Buffer.from(await r.arrayBuffer()); }
  } catch { buf = null; }
  if (logoCache.size > 300) logoCache.clear();
  logoCache.set(url, buf);
  return buf;
}

const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function hashColor(s) {
  let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360, c = 0.62, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = 0.28;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
// Couleur « d'équipe » : le pixel opaque le plus saturé du logo (un fond transparent ne fausse pas le résultat).
async function dominant(buf, fallbackSeed) {
  if (!buf) return hashColor(fallbackSeed);
  try {
    const { data, info } = await sharp(buf).resize(24, 24, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let best = null, bestScore = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx ? (mx - mn) / mx : 0, score = a * sat * (0.4 + mx / 255);
      if (score > bestScore) { bestScore = score; best = { r, g, b }; }
    }
    return best && bestScore > 0.12 ? best : hashColor(fallbackSeed);
  } catch { return hashColor(fallbackSeed); }
}
async function logoPng(buf, size) {
  if (!buf) return null;
  try { return await sharp(buf, { density: 200 }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(); } catch { return null; }
}

const star = (cx, cy, r) => {
  const pts = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; pts.push((cx + rr * Math.cos(a)).toFixed(1) + ',' + (cy + rr * Math.sin(a)).toFixed(1)); }
  return '<polygon points="' + pts.join(' ') + '" fill="#ffc83d" stroke="#7a5200" stroke-width="2" stroke-linejoin="round"/>';
};

// Calques communs : fond + lueurs + trame.
function background(W, H, gameColor, ca, cb) {
  return '<defs>' +
    '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1220"/><stop offset="1" stop-color="#05070d"/></linearGradient>' +
    '<radialGradient id="ga" cx="0.12" cy="0.46" r="0.62"><stop offset="0" stop-color="' + ca + '" stop-opacity=".62"/><stop offset="1" stop-color="' + ca + '" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="gb" cx="0.88" cy="0.46" r="0.62"><stop offset="0" stop-color="' + cb + '" stop-opacity=".62"/><stop offset="1" stop-color="' + cb + '" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="gg" cx="0.5" cy="0" r="0.85"><stop offset="0" stop-color="' + gameColor + '" stop-opacity=".38"/><stop offset="1" stop-color="' + gameColor + '" stop-opacity="0"/></radialGradient>' +
    '<pattern id="st" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(32)"><rect width="2" height="26" fill="#fff" fill-opacity=".035"/></pattern>' +
    '</defs>' +
    '<rect width="' + W + '" height="' + H + '" fill="url(#bg)"/><rect width="' + W + '" height="' + H + '" fill="url(#ga)"/><rect width="' + W + '" height="' + H + '" fill="url(#gb)"/>' +
    '<rect width="' + W + '" height="' + H + '" fill="url(#gg)"/><rect width="' + W + '" height="' + H + '" fill="url(#st)"/>';
}

const stateLine = (m, opts) => {
  if (m.state === 'live') return { kind: 'live', main: opts.score ? opts.score : 'EN DIRECT', sub: 'EN DIRECT' };
  if (m.state === 'done') return { kind: 'done', main: opts.showScore && opts.score ? opts.score : 'REDIFFUSION', sub: fmtDay(m.startTime) };
  return { kind: 'up', main: fmtHour(m.startTime), sub: fmtDay(m.startTime) };
};
const scoreOf = m => { const [a, b] = teamsOf(m); return a.score != null && b.score != null ? a.score + ' - ' + b.score : ''; };

/**
 * Affiche d'un match.
 * @param m        match normalisé (voir lib/model.js)
 * @param game     { name, short, color }
 * @param o        { kind: 'poster' | 'thumb', fav: bool, showScore: bool }
 */
async function renderMatch(m, game, o = {}) {
  if (!sharp || !opentype) throw new Error('sharp / opentype.js indisponibles');
  const thumb = o.kind === 'thumb', W = thumb ? 640 : 600, H = thumb ? 360 : 900;
  const [A, B] = teamsOf(m);
  const [la, lb] = await Promise.all([fetchLogo(A.logo), fetchLogo(B.logo)]);
  const [ca, cb] = (await Promise.all([dominant(la, A.name), dominant(lb, B.name)])).map(hex);
  const S = stateLine(m, { score: scoreOf(m), showScore: o.showScore });
  const L = thumb ? { box: 130, ax: 60, bx: 450, y: 82, codeY: 262, codeSize: 44, plate: 68 } : { box: 200, ax: 40, bx: 360, y: 320, codeY: 640, codeSize: 76, plate: 106 };
  const parts = [background(W, H, game.color, ca, cb)];
  const cxA = L.ax + L.box / 2, cxB = L.bx + L.box / 2, cy = L.y + L.box / 2;

  parts.push('<rect width="' + W + '" height="' + (thumb ? 6 : 10) + '" fill="' + game.color + '"/>');
  // en-tête : badge du jeu, événement, phase
  const hx = thumb ? 28 : 40, hy = thumb ? 38 : 74;
  const badge = game.short.toUpperCase(), bw = font(800).getAdvanceWidth(badge, thumb ? 20 : 30) + (thumb ? 22 : 34);
  parts.push('<rect x="' + hx + '" y="' + (hy - (thumb ? 22 : 34)) + '" width="' + bw + '" height="' + (thumb ? 30 : 46) + '" rx="' + (thumb ? 6 : 9) + '" fill="' + game.color + '"/>');
  parts.push(text(badge, hx + bw / 2, hy - (thumb ? 1 : 2), thumb ? 20 : 30, { anchor: 'middle', fill: '#06101a' }));
  parts.push(text(String(m.event.name).toUpperCase(), hx + bw + (thumb ? 12 : 18), hy - (thumb ? 1 : 2), thumb ? 22 : 34, { weight: 800, maxW: W - hx - bw - (thumb ? 80 : 130) }));
  const sub = [m.stage, m.bestOf ? 'BO' + m.bestOf : ''].filter(Boolean).join(' · ').toUpperCase();
  if (sub) parts.push(text(sub, hx, hy + (thumb ? 30 : 56), thumb ? 17 : 27, { weight: 600, fill: game.color, maxW: W - hx * 2 - 60 }));

  // logos sur des plaques rondes
  for (const [cx, col] of [[cxA, ca], [cxB, cb]]) {
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + L.plate + '" fill="#000" fill-opacity=".34" stroke="' + col + '" stroke-opacity=".75" stroke-width="' + (thumb ? 2 : 3) + '"/>');
  }
  const mid = W / 2;
  parts.push(text('VS', mid, cy + (thumb ? 11 : 20), thumb ? 30 : 52, { anchor: 'middle', fill: '#ffffff', opacity: 0.95 }));
  for (const [t, cx] of [[A, cxA], [B, cxB]]) {
    const code = (t.code === 'TBD' ? 'TBD' : String(shortOf(t))).toUpperCase();
    parts.push(text(code, cx, L.codeY, L.codeSize, { anchor: 'middle', maxW: L.box + (thumb ? 10 : 30) }));
    if (!t.logo || !t.code || t.code === 'TBD') parts.push(text(t.code === 'TBD' ? '?' : code.slice(0, 3), cx, cy + (thumb ? 22 : 40), thumb ? 70 : 120, { anchor: 'middle', fill: '#fff', opacity: 0.35 }));
  }

  // bande d'état
  const by = thumb ? 296 : 720, bh = thumb ? 48 : 140, bx = thumb ? 28 : 40, bwid = W - bx * 2;
  if (S.kind === 'live') {
    parts.push('<rect x="' + bx + '" y="' + by + '" width="' + bwid + '" height="' + bh + '" rx="' + (thumb ? 10 : 18) + '" fill="#e5192d"/>');
    parts.push('<circle cx="' + (bx + (thumb ? 24 : 44)) + '" cy="' + (by + bh / 2) + '" r="' + (thumb ? 7 : 12) + '" fill="#fff"/>');
    parts.push(text(S.sub, bx + (thumb ? 44 : 78), by + bh / 2 + (thumb ? 10 : 18), thumb ? 28 : 50, { }));
    if (scoreOf(m)) parts.push(text(scoreOf(m), bx + bwid - (thumb ? 18 : 30), by + bh / 2 + (thumb ? 11 : 22), thumb ? 32 : 58, { anchor: 'end' }));
  } else {
    parts.push('<rect x="' + bx + '" y="' + by + '" width="' + bwid + '" height="' + bh + '" rx="' + (thumb ? 10 : 18) + '" fill="#fff" fill-opacity=".08" stroke="#fff" stroke-opacity=".16" stroke-width="2"/>');
    if (thumb) {
      parts.push(text(S.main, bx + 20, by + 34, 30, { maxW: 200 }));
      parts.push(text(S.sub.toUpperCase(), bx + bwid - 20, by + 33, 22, { weight: 600, anchor: 'end', fill: '#c7cfdd' }));
    } else {
      parts.push(text(S.main, mid, by + (S.kind === 'up' ? 84 : 78), S.kind === 'up' ? 96 : 66, { anchor: 'middle', maxW: bwid - 40 }));
      parts.push(text(S.sub.toUpperCase(), mid, by + 124, 30, { weight: 600, anchor: 'middle', fill: S.kind === 'up' ? game.color : '#c7cfdd' }));
    }
  }
  if (o.fav) parts.push(star(W - (thumb ? 34 : 60), thumb ? 34 : 60, thumb ? 20 : 34));

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + parts.join('') + '</svg>';
  const comps = [];
  for (const [buf, left] of [[la, L.ax], [lb, L.bx]]) {
    const png = await logoPng(buf, L.box);
    if (png) comps.push({ input: png, left, top: L.y });
  }
  return sharp(Buffer.from(svg)).composite(comps).png({ compressionLevel: 8 }).toBuffer();
}

/** Affiche d'une série « <Jeu> <année> » (catalogue annuel d'un jeu). */
async function renderSeries(game, year, o = {}) {
  if (!sharp || !opentype) throw new Error('sharp / opentype.js indisponibles');
  const W = 600, H = 900, c = game.color;
  const parts = [background(W, H, c, c, '#ffffff')];
  parts.push('<rect width="' + W + '" height="10" fill="' + c + '"/>');
  const words = String(game.name).toUpperCase().split(' ');
  words.forEach((w, i) => parts.push(text(w, 48, 330 + i * 110, 112, { maxW: W - 96 })));
  parts.push(text(String(year), 48, 330 + words.length * 110 + 70, 150, { fill: c }));
  parts.push('<rect x="48" y="720" width="120" height="8" rx="4" fill="' + c + '"/>');
  parts.push(text(o.label || 'MATCHS · LIVES · REDIFFS', 48, 790, 34, { weight: 600, fill: '#c7cfdd', maxW: W - 96 }));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + parts.join('') + '</svg>';
  return sharp(Buffer.from(svg)).png({ compressionLevel: 8 }).toBuffer();
}

/** Icône de l'addon (carrée). */
async function renderIcon(color = '#00c8c8') {
  if (!sharp || !opentype) throw new Error('sharp / opentype.js indisponibles');
  const S = 512, parts = [background(S, S, color, color, '#ff4655')];
  parts.push('<circle cx="256" cy="256" r="196" fill="none" stroke="' + color + '" stroke-width="14"/>');
  parts.push(text('ESPORT', 256, 300, 150, { anchor: 'middle', maxW: 300 }));
  parts.push('<rect x="176" y="330" width="160" height="10" rx="5" fill="' + color + '"/>');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + S + '" height="' + S + '" viewBox="0 0 ' + S + ' ' + S + '">' + parts.join('') + '</svg>';
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { renderMatch, renderSeries, renderIcon, available: () => !!(sharp && opentype) };
