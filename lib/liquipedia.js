'use strict';
// Liquipedia (wiki communautaire) : source des matchs Valorant et des événements Fortnite.
// Règles de Liquipedia : User-Agent qui identifie l'appli, pas plus d'une lecture « parse » toutes les 30 s → on garde 10 min en mémoire
// et on sert l'ancienne copie si la source ne répond pas.
const { parse } = require('node-html-parser');
const { slug } = require('./model');

const BASE = 'https://liquipedia.net';
const UA = 'EsportStremioAddon/1.0 (https://github.com/Wallacecleaver/esport-stremio; addon Stremio perso)';
const TTL = 10 * 60e3, MIN_GAP = 35e3;
const memo = new Map(), last = new Map();

async function page(wiki, title) {
  const k = wiki + '|' + title, hit = memo.get(k);
  if (hit && Date.now() - hit.t < TTL) return hit.html;
  if (hit && Date.now() - (last.get(wiki) || 0) < MIN_GAP) return hit.html;
  try {
    last.set(wiki, Date.now());
    const r = await fetch(BASE + '/' + wiki + '/api.php?' + new URLSearchParams({ action: 'parse', format: 'json', origin: '*', page: title }), { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' }, signal: AbortSignal.timeout(9000) });
    if (!r.ok) throw new Error('Liquipedia ' + wiki + ' : HTTP ' + r.status);
    const j = await r.json(), html = j && j.parse && j.parse.text && j.parse.text['*'];
    if (!html) throw new Error('Liquipedia ' + wiki + ' : page vide (' + title + ')');
    memo.set(k, { t: Date.now(), html });
    return html;
  } catch (e) { if (hit) return hit.html; throw e; }
}

// Adresse absolue d'une image (prend la plus grande du srcset ; ignore l'image « vide »).
function imgOf(img) {
  if (!img) return null;
  let p = img.getAttribute('src');
  const ss = img.getAttribute('srcset');
  if (ss) { const best = ss.split(',').map(x => x.trim().split(/\s+/)).map(([u, d]) => ({ u, d: parseFloat(d) || 1 })).sort((a, b) => b.d - a.d)[0]; if (best && best.u) p = best.u; }
  if (!p || /filler|default/i.test(p)) return null;
  return /^https?:/.test(p) ? p : p.startsWith('//') ? 'https:' + p : BASE + p;
}
const clean = t => String(t || '').replace(/\(page does not exist\)/gi, '').replace(/\s+/g, ' ').trim();

// Un côté (équipe) d'un match du « ticker » : { name, code, logo, score, win }
function side(td) {
  if (!td) return null;
  const a = td.querySelector('.team-template-text a, .team-template-text');
  const full = clean((a && a.getAttribute && a.getAttribute('title')) || '') || clean(td.querySelector('.team-template-image-icon img, img') && td.querySelector('.team-template-image-icon img, img').getAttribute('alt')) || clean(a && a.text);
  const short = clean(a && a.text);
  const name = full || short;
  if (!name || /^(tbd|tba)$/i.test(name)) return { name: 'À déterminer', code: 'TBD', logo: null, score: null, win: null };
  return { name, code: short && short.length <= 5 ? short : '', logo: imgOf(td.querySelector('.team-template-image-icon img, img')), score: null, win: null };
}

// Page « matchs à venir et en cours » : tableaux .infobox_matches_content (équipe | score + format | équipe) suivis d'une ligne tournoi + compte à rebours.
function matchTicker(html, { game, now = Date.now() } = {}) {
  const root = parse(html), out = [];
  for (const tbl of root.querySelectorAll('.infobox_matches_content')) {
    const L = side(tbl.querySelector('.team-left')), R = side(tbl.querySelector('.team-right'));
    if (!L || !R) continue;
    const timer = tbl.querySelector('.timer-object[data-timestamp], [data-timestamp]');
    const ts = timer ? Number(timer.getAttribute('data-timestamp')) * 1000 : NaN;
    if (!ts) continue;
    const bo = (tbl.querySelector('.versus abbr') || {}).text, boN = bo && /(\d+)/.exec(bo) ? Number(/(\d+)/.exec(bo)[1]) : null;
    const sc = /^\s*(\d+)\s*:\s*(\d+)\s*$/.exec(clean((tbl.querySelector('.versus > div') || {}).text));
    const left = tbl.querySelector('.team-left'), right = tbl.querySelector('.team-right');
    const concluded = /recent-matches/.test((left && left.getAttribute('class')) || '') || /recent-matches/.test((right && right.getAttribute('class')) || '');
    if (sc) { L.score = Number(sc[1]); R.score = Number(sc[2]); if (concluded && L.score !== R.score) { L.win = L.score > R.score; R.win = !L.win; } }
    const lg = tbl.querySelector('.league-icon-small-image a, .match-filler a[title]');
    const ev = clean(lg && lg.getAttribute('title')) || clean((tbl.querySelectorAll('.match-filler a').pop() || {}).text) || 'Événement';
    const year = new Date(ts).getUTCFullYear();
    const streams = (timer.getAttribute('data-stream-twitch') || '').split(/[,\s]+/).map(s => s.toLowerCase().replace(/^.*twitch\.tv\//, '')).filter(s => /^[a-z0-9_]{3,25}$/.test(s));
    const state = concluded ? 'done' : ts <= now ? (now - ts > 10 * 3600e3 ? 'done' : 'live') : 'upcoming';
    const raw = slug(ev) + '-' + new Date(ts).toISOString().slice(0, 10) + '-' + slug(L.name) + '-' + slug(R.name) + (L.code === 'TBD' || R.code === 'TBD' ? '-' + Math.floor(ts / 60000) : '');
    out.push({ id: game + '~' + raw, game, raw, year, event: { key: slug(ev) + '-' + year, name: ev, logo: imgOf(lg && lg.querySelector('img')) }, stage: '', startTime: ts, state, bestOf: boN, teams: [L, R], streams });
  }
  return out.sort((a, b) => a.startTime - b.startTime);
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const mon = s => MONTHS[String(s || '').slice(0, 3).toLowerCase()];
// « Oct 17, 2026 - Oct 19, 2026 », « Oct 17 - 19, 2026 », « Nov 2, 2026 » → { from, to } (UTC, jours entiers) ou null
function dateRange(text, fallbackYear) {
  const m = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?(?:\s*[-–—]\s*(?:([A-Za-z]{3,9})\.?\s+)?(\d{1,2})(?:,?\s+(\d{4}))?)?/.exec(String(text || ''));
  if (!m || mon(m[1]) == null) return null;
  const y2 = Number(m[6] || m[3] || fallbackYear), y1 = Number(m[3] || (m[6] && mon(m[4] || m[1]) < mon(m[1]) ? m[6] - 1 : m[6]) || fallbackYear);
  const from = Date.UTC(y1, mon(m[1]), Number(m[2]));
  const to = m[5] ? Date.UTC(y2, mon(m[4] || m[1]), Number(m[5])) : from;
  return to >= from ? { from, to } : { from, to: from };
}

// Liste de tournois (Portal:Tournaments) : lignes .divRow avec .Tournament .Name et .Date.
function tournamentList(html, { fallbackYear = new Date().getUTCFullYear() } = {}) {
  const root = parse(html), out = [], seen = new Set();
  for (const row of root.querySelectorAll('.divRow')) {
    const a = row.querySelector('.Tournament .Name a, .Tournament a');
    const name = clean(a && (a.text || a.getAttribute('title')));
    const range = dateRange(clean((row.querySelector('.Date') || {}).text), fallbackYear);
    if (!name || !range || seen.has(name + range.from)) continue;
    seen.add(name + range.from);
    out.push({ name, ...range, logo: imgOf(row.querySelector('.Tournament img')), tier: clean((row.querySelector('.Tier') || {}).text) });
  }
  if (out.length) return out;
  // Nouvelle mise en page de Liquipedia : lignes .table2__row--body (nom dans .tournament, dates quelque part dans la ligne)
  for (const row of root.querySelectorAll('.table2__row--body')) {
    const a = row.querySelector('.tournament a, [class*="tournament"] a, .name a');
    const name = clean(a && (a.text || a.getAttribute('title')));
    const range = dateRange(clean(row.text.replace(name, '')), fallbackYear);
    if (!name || !range || seen.has(name + range.from)) continue;
    seen.add(name + range.from);
    out.push({ name, ...range, logo: imgOf(row.querySelector('img:not(.flag img)')), tier: '' });
  }
  return out;
}

// Diagnostic : que contient vraiment la page ? (longueur, éléments reconnus, classes les plus fréquentes)
async function inspect(wiki, title) {
  try {
    const html = await page(wiki, title), root = parse(html), n = sel => root.querySelectorAll(sel).length;
    const cls = {};
    for (const m of html.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) cls[c] = (cls[c] || 0) + 1;
    return { page: title, octets: html.length, tickers: n('.infobox_matches_content'), timers: n('[data-timestamp]'), divRow: n('.divRow'), tables: n('table'), classes: Object.entries(cls).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([c, k]) => c + '×' + k).join(' '), debut: html.replace(/\s+/g, ' ').slice(0, 300) };
  } catch (e) { return { page: title, erreur: e.message }; }
}

module.exports = { inspect, page, matchTicker, tournamentList, dateRange, imgOf, UA };
