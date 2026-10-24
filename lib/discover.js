'use strict';
// Découverte automatique des lives d'un match : (1) annuaire Twitch de Valorant, recherche par titre ; (2) chaînes listées sur Liquipedia pour la compétition.
const tw = require('./twitch');

const nrm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const UA = 'Esportio/1.0 (https://github.com/Wallacecleaver/esport-stremio; addon Stremio personnel)';

// ---------- 1. annuaire Twitch (jeu VALORANT) ----------
const dirCache = new Map();
async function page(lang, after) {
  const opts = '{ sort: VIEWER_COUNT' + (lang ? ', broadcasterLanguages: ["' + lang + '"]' : '') + ' }';
  const q = 'query { game(name: "VALORANT") { streams(first: 100' + (after ? ', after: ' + JSON.stringify(after) : '') + ', options: ' + opts + ') { edges { cursor node { title viewersCount broadcaster { login displayName broadcastSettings { language } } } } } } }';
  const d = await tw.gql(q);
  return (((d.game || {}).streams || {}).edges || []);
}
async function directory(lang, pages) {
  const k = lang + '|' + pages, c = dirCache.get(k);
  if (c && c.exp > Date.now()) return c.v;
  const out = []; let after = '';
  for (let i = 0; i < pages; i++) {
    const e = await page(lang, after);
    for (const x of e) {
      const n = x.node, b = n && n.broadcaster; if (!b || !b.login) continue;
      out.push({ login: String(b.login).toLowerCase(), name: b.displayName || b.login, title: n.title || '', viewers: Number(n.viewersCount) || 0, lang: String((b.broadcastSettings || {}).language || lang || '').toUpperCase() });
    }
    if (e.length < 100) break; after = e[e.length - 1].cursor;
  }
  dirCache.set(k, { v: out, exp: Date.now() + 45000 }); if (dirCache.size > 10) dirCache.clear();
  return out;
}

// Le titre parle-t-il de ce match ? (nom d'équipe, ou code court accompagné d'un indice : l'autre équipe, "vs", "cast"…)
function mentions(title, teams, kwRe) {
  const t = ' ' + nrm(title) + ' ';
  const hit = teams.map(x => (nrm(x.name).length >= 4 && t.includes(nrm(x.name))) || (nrm(x.code) && t.includes(' ' + nrm(x.code) + ' ')));
  const n = hit.filter(Boolean).length;
  if (n >= 2) return true;
  return n === 1 && (/ vs | v | contre | cast | co ?stream| costream | watch ?party | reaction /.test(t) || kwRe.test(t));
}

// ---------- 2. Liquipedia ----------
const lqCache = new Map();
async function lq(params) {
  const u = 'https://liquipedia.net/valorant/api.php?' + new URLSearchParams({ format: 'json', origin: '*', ...params });
  const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('Liquipedia HTTP ' + r.status);
  return r.json();
}
// chaînes Twitch citées sur la page de la compétition : [{ login }]
async function liquipediaChannels(eventName, year) {
  const k = eventName + '|' + year, c = lqCache.get(k);
  if (c && c.exp > Date.now()) return c.v;
  let v = [];
  try {
    const s = await lq({ action: 'query', list: 'search', srsearch: eventName.replace(/\b20\d\d\b/, '') + ' ' + year, srlimit: '6', srnamespace: '0' });
    const titles = ((s.query || {}).search || []).map(x => x.title);
    const best = titles.find(t => t.includes(String(year)) && /^(VCT|Esports World Cup|Valorant)/i.test(t)) || titles.find(t => t.includes(String(year))) || titles[0];
    if (best) {
      const p = await lq({ action: 'parse', page: best, prop: 'text', disablelimitreport: '1' });
      const html = String(((p.parse || {}).text || {})['*'] || '');
      const set = new Set();
      for (const m of html.matchAll(/Special:Stream\/twitch\/([A-Za-z0-9_]{3,25})/g)) set.add(m[1].toLowerCase());
      v = [...set].slice(0, 30).map(login => ({ login, page: best }));
    }
  } catch { v = []; }
  lqCache.set(k, { v, exp: Date.now() + (v.length ? 6 * 3600e3 : 600e3) }); if (lqCache.size > 40) lqCache.delete(lqCache.keys().next().value);
  return v;
}

// Résultat : [{ login, name, title, viewers, lang, game, found: 'titre' | 'liquipedia' }], hors chaînes déjà connues (`known`).
async function discover(m, teams, kwRe, known, { twitch = true, liquipedia = true } = {}) {
  const out = new Map(), skip = new Set(known);
  const real = teams.filter(t => t.code && t.code !== 'TBD');
  if (twitch && real.length) {
    try {
      const lists = await Promise.allSettled([directory('', 3), directory('FR', 2)]);
      for (const r of lists) if (r.status === 'fulfilled') for (const s of r.value) {
        if (skip.has(s.login) || out.has(s.login)) continue;
        if (mentions(s.title, real, kwRe)) out.set(s.login, { ...s, game: 'VALORANT', found: 'titre' });
      }
    } catch { /* annuaire indisponible */ }
  }
  if (liquipedia && m.event) {
    const cand = (await liquipediaChannels((m.league && m.league.name) || m.event.name, m.year || new Date().getFullYear())).filter(c => !skip.has(c.login) && !out.has(c.login));
    if (cand.length) {
      try {
        const st = await tw.liveStatus(cand.map(c => c.login));
        for (const c of cand) { const s = st[c.login]; if (s && s.live && /valorant/i.test(s.game || '') && mentions(s.title, real, kwRe)) out.set(c.login, { login: c.login, name: s.name, title: s.title, viewers: s.viewers, lang: '', game: s.game, found: 'liquipedia' }); }
      } catch { /* statut indisponible */ }
    }
  }
  return [...out.values()];
}

module.exports = { discover, mentions, liquipediaChannels, directory };
