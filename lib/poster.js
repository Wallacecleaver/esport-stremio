'use strict';
// Affiches générées (PNG) — style sobre : fond sombre, lueur aux couleurs de chaque équipe, logos grands et nets, textes fins et espacés.
//   en-tête : jeu · événement · phase    |    au centre : logo A, VS, logo B    |    en bas : heure de Paris, EN DIRECT ou REDIFFUSION
// Les textes sont convertis en tracés (opentype.js + police Inter fournie) : aucune police système n'est nécessaire sur Vercel.
const fs = require('fs');
const path = require('path');
const { teamsOf, fmtHour, fmtDay } = require('./model');

let sharp = null, opentype = null;
try { sharp = require('sharp'); } catch { /* affiches indisponibles */ }
try { opentype = require('opentype.js'); } catch { /* idem */ }

const FONT_DIR = path.join(__dirname, '..', 'node_modules', '@fontsource', 'inter', 'files');
const fonts = {};
function font(weight) {
  if (!fonts[weight]) {
    const buf = fs.readFileSync(path.join(FONT_DIR, 'inter-latin-' + weight + '-normal.woff'));
    fonts[weight] = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  return fonts[weight];
}

const MUTED = '#9aa4b8';
// Texte → tracé SVG. ls = espacement des lettres (px) ; maxW = largeur maximale (le texte est réduit au besoin).
function text(str, x, y, size, { weight = 700, fill = '#fff', anchor = 'start', ls = 0, maxW = 0, opacity = 1 } = {}) {
  const f = font(weight), chars = [...String(str)];
  const adv = c => f.getAdvanceWidth(c, size);
  const width = s => (ls ? chars.reduce((a, c) => a + adv(c), 0) + ls * (chars.length - 1) : f.getAdvanceWidth(String(str), s || size));
  let w = width();
  if (maxW && w > maxW) { const k = maxW / w; size *= k; ls *= k; w = maxW; }
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  let d;
  if (ls) { let cx = x0; d = chars.map(c => { const p = f.getPath(c, cx, y, size).toPathData(2); cx += f.getAdvanceWidth(c, size) + ls; return p; }).join(''); }
  else d = f.getPath(String(str), x0, y, size).toPathData(2);
  return '<path d="' + d + '" fill="' + fill + '"' + (opacity < 1 ? ' fill-opacity="' + opacity + '"' : '') + '/>';
}
const measure = (str, size, { weight = 700, ls = 0 } = {}) => { const f = font(weight); return ls ? [...String(str)].reduce((a, c) => a + f.getAdvanceWidth(c, size), 0) + ls * (String(str).length - 1) : f.getAdvanceWidth(String(str), size); };

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
  const hue = h % 360, c = 0.55, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = 0.3;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
// Couleur d'équipe : le pixel opaque le plus saturé du logo. Trop sombre → éclaircie, pour que la lueur reste visible.
async function dominant(buf, seed) {
  let c = null;
  if (buf) {
    try {
      const { data, info } = await sharp(buf).resize(32, 32, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let bestScore = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0, score = a * sat * (0.4 + mx / 255);
        if (score > bestScore) { bestScore = score; c = { r, g, b }; }
      }
      if (bestScore <= 0.12) c = null;
    } catch { c = null; }
  }
  c = c || hashColor(seed);
  const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  if (lum < 90) { const k = (90 - lum) / 165 + 0.15; c = { r: c.r + (255 - c.r) * k, g: c.g + (255 - c.g) * k, b: c.b + (255 - c.b) * k }; }
  return c;
}
async function logoPng(buf, size) {
  if (!buf) return null;
  try { return await sharp(buf, { density: 240 }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().png().toBuffer(); } catch { return null; }
}
// Ombre douce sous un logo (même forme, noire, floutée) : le détache du fond.
async function shadowOf(png) {
  try { return await sharp(png).modulate({ brightness: 0 }).blur(9).linear([1, 1, 1, 0.55], [0, 0, 0, 0]).png().toBuffer(); } catch { return null; }
}

const star = (cx, cy, r, fill = '#ffc83d') => {
  const pts = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; pts.push((cx + rr * Math.cos(a)).toFixed(1) + ',' + (cy + rr * Math.sin(a)).toFixed(1)); }
  return '<polygon points="' + pts.join(' ') + '" fill="' + fill + '" stroke-linejoin="round"/>';
};

// Fond : noir bleuté, lueur de la couleur de chaque équipe derrière son logo, léger voile de la couleur du jeu en haut, vignette, fin liseré.
function background(W, H, game, ca, cb, geo) {
  const g = geo;
  return '<defs>' +
    '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b0f19"/><stop offset="1" stop-color="#05070c"/></linearGradient>' +
    '<radialGradient id="ga" gradientUnits="userSpaceOnUse" cx="' + g.ax + '" cy="' + g.ay + '" r="' + g.r + '"><stop offset="0" stop-color="' + ca + '" stop-opacity=".42"/><stop offset="1" stop-color="' + ca + '" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="gb" gradientUnits="userSpaceOnUse" cx="' + g.bx + '" cy="' + g.by + '" r="' + g.r + '"><stop offset="0" stop-color="' + cb + '" stop-opacity=".42"/><stop offset="1" stop-color="' + cb + '" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="gg" gradientUnits="userSpaceOnUse" cx="' + W / 2 + '" cy="0" r="' + W * 0.8 + '"><stop offset="0" stop-color="' + game.color + '" stop-opacity=".16"/><stop offset="1" stop-color="' + game.color + '" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="vg" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>' +
    '<linearGradient id="hl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
    '</defs>' +
    '<rect width="' + W + '" height="' + H + '" fill="url(#bg)"/>' +
    '<rect width="' + W + '" height="' + H + '" fill="url(#gg)"/><rect width="' + W + '" height="' + H + '" fill="url(#ga)"/><rect width="' + W + '" height="' + H + '" fill="url(#gb)"/>' +
    '<rect width="' + W + '" height="' + H + '" fill="url(#vg)"/>' +
    '<rect x="12" y="12" width="' + (W - 24) + '" height="' + (H - 24) + '" rx="22" fill="none" stroke="#fff" stroke-opacity=".09" stroke-width="1.5"/>';
}

const scoreOf = m => { const [a, b] = teamsOf(m); return a.score != null && b.score != null ? a.score + ' – ' + b.score : ''; };
const RED = '#ff4256';
const dayOf = m => fmtDay(m.startTime).toUpperCase();

// Cadre vide quand l'équipe n'est pas connue (à déterminer) ou que son logo ne charge pas.
function placeholder(cx, cy, size, t) {
  const code = t.code && t.code !== 'TBD' ? String(t.code).toUpperCase() : '?';
  return '<circle cx="' + cx + '" cy="' + cy + '" r="' + size * 0.36 + '" fill="#fff" fill-opacity=".04" stroke="#fff" stroke-opacity=".28" stroke-width="2" stroke-dasharray="3 9" stroke-linecap="round"/>' +
    text(code, cx, cy + size * (code.length > 2 ? 0.07 : 0.1), size * (code.length > 2 ? 0.22 : 0.3), { weight: 700, anchor: 'middle', fill: '#fff', opacity: 0.42, maxW: size * 0.6 });
}

/**
 * Affiche d'un match.
 * @param m     match normalisé (voir lib/model.js)
 * @param game  { name, short, color }
 * @param o     { kind: 'poster' | 'thumb', fav: bool, showScore: bool }
 */
async function renderMatch(m, game, o = {}) {
  if (!sharp || !opentype) throw new Error('sharp / opentype.js indisponibles');
  const thumb = o.kind === 'thumb', W = thumb ? 640 : 600, H = thumb ? 360 : 900;
  const [A, B] = teamsOf(m);
  const [la, lb] = await Promise.all([fetchLogo(A.logo), fetchLogo(B.logo)]);
  const [ca, cb] = (await Promise.all([dominant(la, A.name), dominant(lb, B.name)])).map(hex);
  const box = thumb ? 150 : 236;
  const pos = thumb
    ? { a: { x: 105, y: 108 }, b: { x: 385, y: 108 } }
    : { a: { x: (W - box) / 2, y: 178 }, b: { x: (W - box) / 2, y: 500 } };
  const ctr = p => [p.x + box / 2, p.y + box / 2];
  const [cax, cay] = ctr(pos.a), [cbx, cby] = ctr(pos.b);
  const parts = [background(W, H, game, ca, cb, { ax: cax, ay: cay, bx: cbx, by: cby, r: thumb ? 230 : 330 })];
  const live = m.state === 'live', done = m.state === 'done';

  // ----- en-tête
  if (thumb) {
    parts.push(text(game.name.toUpperCase(), 36, 44, 13, { weight: 700, fill: game.color, ls: 4 }));
    parts.push(text(String(m.event.name).toUpperCase(), 36, 76, 25, { weight: 700, ls: 2.5, maxW: 400 }));
    const sub = [m.stage, m.bestOf ? 'BO' + m.bestOf : ''].filter(Boolean).join(' · ').toUpperCase();
    if (sub) parts.push(text(sub, 36, 98, 12, { weight: 500, fill: MUTED, ls: 3, maxW: 400 }));
  } else {
    parts.push(text(game.name.toUpperCase(), W / 2, 66, 17, { weight: 700, fill: game.color, ls: 7, anchor: 'middle', maxW: 460 }));
    parts.push(text(String(m.event.name).toUpperCase(), W / 2, 110, 33, { weight: 700, ls: 4, anchor: 'middle', maxW: 500 }));
    const sub = [m.stage, m.bestOf ? 'BO' + m.bestOf : ''].filter(Boolean).join(' · ').toUpperCase();
    if (sub) parts.push(text(sub, W / 2, 144, 16, { weight: 500, fill: MUTED, ls: 5, anchor: 'middle', maxW: 500 }));
  }
  if (o.fav) parts.push(star(W - (thumb ? 38 : 52), thumb ? 40 : 60, thumb ? 13 : 16));

  // ----- séparateur VS
  if (thumb) {
    parts.push('<rect x="319" y="124" width="1.5" height="42" fill="url(#hl)" transform="rotate(180 320 145)"/><rect x="319" y="202" width="1.5" height="42" fill="url(#hl)"/>');
    parts.push(text('VS', 320, 191, 17, { weight: 700, ls: 4, anchor: 'middle', fill: '#fff', opacity: 0.85 }));
  } else {
    const vy = 458;
    parts.push('<rect x="60" y="' + (vy - 6) + '" width="190" height="1.5" fill="url(#hl)"/><rect x="350" y="' + (vy - 6) + '" width="190" height="1.5" fill="url(#hl)"/>');
    parts.push(text('VS', W / 2, vy, 17, { weight: 700, ls: 5, anchor: 'middle', fill: '#fff', opacity: 0.85 }));
  }

  // ----- bas : état
  if (thumb) {
    const y = 330;
    parts.push('<rect x="36" y="296" width="568" height="1.5" fill="url(#hl)"/>');
    if (live) {
      parts.push('<circle cx="42" cy="' + (y - 7) + '" r="5" fill="' + RED + '"/>');
      parts.push(text('EN DIRECT', 56, y, 17, { weight: 700, fill: RED, ls: 3 }));
      if (scoreOf(m)) parts.push(text(scoreOf(m), W - 36, y + 3, 28, { weight: 700, anchor: 'end' }));
    } else if (done) {
      parts.push(text(o.showScore && scoreOf(m) ? scoreOf(m) : 'REDIFFUSION', 36, y, 18, { weight: 700, ls: o.showScore && scoreOf(m) ? 0 : 3.5, maxW: 300 }));
      parts.push(text(dayOf(m), W - 36, y, 13, { weight: 500, fill: MUTED, ls: 3, anchor: 'end' }));
    } else {
      parts.push(text(fmtHour(m.startTime), 36, y + 3, 28, { weight: 700 }));
      parts.push(text(dayOf(m), W - 36, y, 13, { weight: 500, fill: MUTED, ls: 3, anchor: 'end' }));
    }
  } else {
    parts.push('<rect x="60" y="744" width="480" height="1.5" fill="url(#hl)"/>');
    if (live) {
      const w = measure('EN DIRECT', 19, { ls: 6 }), x0 = W / 2 - (w + 26) / 2;
      parts.push('<circle cx="' + (x0 + 6) + '" cy="787" r="6" fill="' + RED + '"/>');
      parts.push(text('EN DIRECT', x0 + 26, 794, 19, { weight: 700, fill: RED, ls: 6 }));
      parts.push(text(scoreOf(m) || '', W / 2, 858, 66, { weight: 700, anchor: 'middle' }));
    } else if (done) {
      parts.push(text(o.showScore && scoreOf(m) ? scoreOf(m) : 'REDIFFUSION', W / 2, o.showScore && scoreOf(m) ? 826 : 820, o.showScore && scoreOf(m) ? 62 : 27, { weight: 700, ls: o.showScore && scoreOf(m) ? 0 : 7, anchor: 'middle', maxW: 460 }));
      parts.push(text(dayOf(m), W / 2, 862, 16, { weight: 500, fill: MUTED, ls: 5, anchor: 'middle' }));
    } else {
      parts.push(text('COUP D\'ENVOI', W / 2, 782, 14, { weight: 500, fill: MUTED, ls: 6, anchor: 'middle' }));
      parts.push(text(fmtHour(m.startTime), W / 2, 842, 66, { weight: 700, anchor: 'middle' }));
      parts.push(text(dayOf(m), W / 2, 874, 16, { weight: 500, fill: MUTED, ls: 5, anchor: 'middle' }));
    }
  }

  // ----- logos (ou cadre vide)
  const comps = [];
  for (const [t, buf, p] of [[A, la, pos.a], [B, lb, pos.b]]) {
    const png = await logoPng(buf, box);
    if (!png) { parts.push(placeholder(p.x + box / 2, p.y + box / 2, box, t)); continue; }
    const sh = await shadowOf(png);
    if (sh) comps.push({ input: sh, left: p.x, top: p.y + (thumb ? 5 : 9) });
    comps.push({ input: png, left: p.x, top: p.y });
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + parts.join('') + '</svg>';
  // le fond d'abord, les logos au-dessus, puis les textes par-dessus (les textes ne chevauchent jamais un logo)
  return sharp(Buffer.from(svg)).composite(comps).png({ compressionLevel: 9 }).toBuffer();
}

// Retour à la ligne (par mots) selon la largeur mesurée.
function wrap(str, size, maxW, maxLines, o = {}) {
  const words = String(str).split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (cur && measure(t, size, o) > maxW) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); keep[maxLines - 1] += '…'; return keep; }
  return lines;
}

/** Affiche d'une journée d'événement sans « A contre B » (ex. Fortnite) : logo de l'événement au centre, nom en dessous. */
async function renderEvent(m, game, o = {}) {
  if (!sharp || !opentype) throw new Error('sharp / opentype.js indisponibles');
  const thumb = o.kind === 'thumb', W = thumb ? 640 : 600, H = thumb ? 360 : 900;
  const logo = await fetchLogo(m.event.logo);
  const col = hex(await dominant(logo, m.event.name));
  const box = thumb ? 140 : 250, lx = thumb ? 470 : (W - box) / 2, ly = thumb ? 90 : 190;
  const parts = [background(W, H, game, col, col, { ax: lx + box / 2, ay: ly + box / 2, bx: lx + box / 2, by: ly + box / 2, r: thumb ? 230 : 340 })];
  const live = m.state === 'live', done = m.state === 'done', day = dayOf(m);
  if (thumb) {
    parts.push(text(game.name.toUpperCase(), 36, 44, 13, { weight: 700, fill: game.color, ls: 4 }));
    wrap(m.event.name.toUpperCase(), 25, 380, 3, { ls: 2 }).forEach((l, i) => parts.push(text(l, 36, 90 + i * 32, 25, { weight: 700, ls: 2, maxW: 400 })));
    if (m.stage) parts.push(text(m.stage.toUpperCase(), 36, 210, 13, { weight: 500, fill: MUTED, ls: 3, maxW: 380 }));
    parts.push('<rect x="36" y="296" width="568" height="1.5" fill="url(#hl)"/>');
    parts.push(text(live ? 'AUJOURD\'HUI' : done ? 'REDIFFUSION' : day, 36, 330, 18, { weight: 700, ls: 3.5, fill: live ? RED : '#fff', maxW: 300 }));
    if (live || done) parts.push(text(day, W - 36, 330, 13, { weight: 500, fill: MUTED, ls: 3, anchor: 'end' }));
  } else {
    parts.push(text(game.name.toUpperCase(), W / 2, 66, 17, { weight: 700, fill: game.color, ls: 7, anchor: 'middle', maxW: 460 }));
    wrap(m.event.name.toUpperCase(), 33, 500, 3, { ls: 3 }).forEach((l, i) => parts.push(text(l, W / 2, 500 + i * 46, 33, { weight: 700, ls: 3, anchor: 'middle', maxW: 520 })));
    if (m.stage) parts.push(text(m.stage.toUpperCase(), W / 2, 668, 17, { weight: 500, fill: MUTED, ls: 5, anchor: 'middle', maxW: 480 }));
    parts.push('<rect x="60" y="744" width="480" height="1.5" fill="url(#hl)"/>');
    if (live) {
      const w = measure('AUJOURD\'HUI', 22, { ls: 6 }), x0 = W / 2 - (w + 26) / 2;
      parts.push('<circle cx="' + (x0 + 6) + '" cy="803" r="6" fill="' + RED + '"/>');
      parts.push(text('AUJOURD\'HUI', x0 + 26, 810, 22, { weight: 700, fill: RED, ls: 6 }));
      parts.push(text(day, W / 2, 858, 16, { weight: 500, fill: MUTED, ls: 5, anchor: 'middle' }));
    } else if (done) {
      parts.push(text('REDIFFUSION', W / 2, 820, 27, { weight: 700, ls: 7, anchor: 'middle', maxW: 460 }));
      parts.push(text(day, W / 2, 862, 16, { weight: 500, fill: MUTED, ls: 5, anchor: 'middle' }));
    } else {
      parts.push(text('JOURNÉE DU', W / 2, 790, 14, { weight: 500, fill: MUTED, ls: 6, anchor: 'middle' }));
      parts.push(text(day, W / 2, 846, 44, { weight: 700, anchor: 'middle', maxW: 480 }));
    }
  }
  if (o.fav) parts.push(star(W - (thumb ? 38 : 52), thumb ? 40 : 60, thumb ? 13 : 16));
  const comps = [], png = await logoPng(logo, box);
  if (png) { const sh = await shadowOf(png); if (sh) comps.push({ input: sh, left: lx, top: ly + 8 }); comps.push({ input: png, left: lx, top: ly }); }
  else parts.push(placeholder(lx + box / 2, ly + box / 2, box, { code: String(m.event.name).split(/\s+/).map(w => w[0]).join('').slice(0, 3) }));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + parts.join('') + '</svg>';
  return sharp(Buffer.from(svg)).composite(comps).png({ compressionLevel: 9 }).toBuffer();
}

/** Affiche d'une série « <Jeu> <année> » (catalogue annuel d'un jeu). */
async function renderSeries(game, year, o = {}) {
  if (!sharp || !opentype) throw new Error('sharp / opentype.js indisponibles');
  const W = 600, H = 900, c = game.color;
  const parts = [background(W, H, game, c, '#ffffff', { ax: W * 0.3, ay: H * 0.55, bx: W * 0.8, by: H * 0.85, r: 420 })];
  parts.push(text(game.name.toUpperCase(), W / 2, 330, 18, { weight: 700, fill: c, ls: 9, anchor: 'middle', maxW: 480 }));
  parts.push(text(String(year), W / 2, 500, 168, { weight: 700, anchor: 'middle' }));
  parts.push('<rect x="60" y="560" width="480" height="1.5" fill="url(#hl)"/>');
  parts.push(text(o.label || 'MATCHS · LIVES · REDIFFS', W / 2, 604, 14, { weight: 500, fill: MUTED, ls: 6, anchor: 'middle', maxW: 480 }));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + parts.join('') + '</svg>';
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

/** Icône de l'addon (carrée). */
async function renderIcon(color = '#00c8c8') {
  if (!sharp || !opentype) throw new Error('sharp / opentype.js indisponibles');
  const S = 512, game = { color }, parts = [background(S, S, game, color, '#ffffff', { ax: 150, ay: 200, bx: 380, by: 330, r: 330 })];
  parts.push('<circle cx="256" cy="256" r="170" fill="none" stroke="' + color + '" stroke-opacity=".9" stroke-width="6"/>');
  parts.push(text('ESPORT', 256, 282, 62, { weight: 700, anchor: 'middle', ls: 7, maxW: 250 }));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + S + '" height="' + S + '" viewBox="0 0 ' + S + ' ' + S + '">' + parts.join('') + '</svg>';
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { renderEvent, renderMatch, renderSeries, renderIcon, available: () => !!(sharp && opentype) };
