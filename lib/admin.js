'use strict';
// Dashboard esport (/admin) : mot de passe = variable ADMIN_PASSWORD. Connexion par cookie signé, 8 essais / 10 min / adresse.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const siteLib = require('./site');
const PASS = process.env.ADMIN_PASSWORD || '';
const sig = () => crypto.createHmac('sha256', PASS).update('esport-admin-v1').digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cookieOf = req => Object.fromEntries(String(req.headers.cookie || '').split(/;\s*/).map(c => c.split(/=(.*)/s).slice(0, 2)));
const authed = req => !!PASS && safeEq(cookieOf(req).adm || '', sig());
const body = (req, max = 2e4) => new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > max) req.destroy(); }); req.on('end', () => r(b)); });
const fails = new Map();
const refOf = id => crypto.createHash('sha256').update('ref|' + id).digest('hex').slice(0, 10);

module.exports = function admin(api) {
  return async function (req, res, seg) {
    const { send, json } = api;
    if (seg[0] !== 'admin') return false;
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
    const secure = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Frame-Options': 'DENY' };
    if (!PASS) return send(res, 200, 'text/html; charset=utf-8', page('setup'), secure), true;
    if (seg[1] === 'login' && req.method === 'POST') {
      const f = fails.get(ip) || { n: 0, t: Date.now() };
      if (Date.now() - f.t > 6e5) { f.n = 0; f.t = Date.now(); }
      if (f.n >= 8) return json(res, { ok: false, error: 'Trop d\'essais, réessaie dans quelques minutes.' }), true;
      let pw = ''; try { pw = JSON.parse(await body(req)).password || ''; } catch { /* vide */ }
      if (!safeEq(pw, PASS)) { f.n++; fails.set(ip, f); return json(res, { ok: false, error: 'Mot de passe incorrect.' }), true; }
      fails.delete(ip);
      return json(res, { ok: true }, { 'Set-Cookie': 'adm=' + sig() + '; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000' }), true;
    }
    if (seg[1] === 'logout') return send(res, 302, 'text/plain', '', { Location: '/admin', 'Set-Cookie': 'adm=; Path=/admin; Max-Age=0' }), true;
    if (!authed(req)) return send(res, 200, 'text/html; charset=utf-8', page('login'), secure), true;
    if (!seg[1]) return send(res, 200, 'text/html; charset=utf-8', page('admin'), secure), true;
    if (seg[1] !== 'api') return send(res, 404, 'text/plain', 'Introuvable'), true;
    const q = new URL(req.url, 'http://x').searchParams;
    try {
      if (seg[2] === 'state') return json(res, { ...(await store.snapshot(Math.min(Number(q.get('n')) || 300, 500))), ...(await api.state()), now: Date.now(), up: process.uptime() }), true;
      if (seg[2] === 'matches') return json(res, await api.matches(q.get('force') === '1')), true;
      if (seg[2] === 'replay') return json(res, await api.replay(String(q.get('raw') || ''))), true;
      if (seg[2] === 'relay') return json(res, await api.relay(String(q.get('login') || ''))), true;
      if (seg[2] === 'chanstatus') return json(res, await api.chanstatus(String(q.get('logins') || ''))), true;
      if (seg[2] === 'diag') return json(res, await api.diag()), true;
      if (seg[2] === 'teams') return json(res, await api.teams()), true;
      if (seg[2] === 'site') {
        if (seg[3] === 'logo' && req.method === 'POST') { const b = JSON.parse((await body(req, 450000)) || '{}'); return json(res, await siteLib.setLogo(b.data)), true; }
        if (req.method === 'POST') { const b = JSON.parse((await body(req)) || '{}'); const s = await siteLib.save(b); await api.refresh(); return json(res, { ok: true, site: s }), true; }
        return json(res, await siteLib.load(true)), true;
      }
      if (seg[2] === 'export') {
        const rows = (await store.snapshot(500)).logs;
        if (q.get('fmt') === 'json') return send(res, 200, 'application/json', JSON.stringify(rows, null, 1), { 'Content-Disposition': 'attachment; filename="journal-esport.json"', ...secure }), true;
        const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', cols = ['date', 'niveau', 'contexte', 'utilisateur', 'details'];
        const csv = [cols.join(',')].concat(rows.map(l => { const { t, lvl, k, u, dev, ...r } = l; return [new Date(t).toISOString(), lvl, k, u, JSON.stringify(r)].map(esc).join(','); })).join('\n');
        return send(res, 200, 'text/csv; charset=utf-8', '﻿' + csv, { 'Content-Disposition': 'attachment; filename="journal-esport.csv"', ...secure }), true;
      }
      if (seg[2] === 'profiles') {
        if (req.method === 'POST') {
          const b = JSON.parse((await body(req)) || '{}'), id = (await store.profIds()).find(i => refOf(i) === b.ref);
          if (!id) return json(res, { ok: false, error: 'Profil introuvable' }), true;
          const p = JSON.parse((await store.getKey('p:' + id)) || '{}');
          if (b.action === 'delete') { await store.delKey('p:' + id); store.log({ k: 'config', u: p.pseudo, action: 'profil supprimé par l\'administrateur' }); }
          else { await store.setKey('p:' + id, JSON.stringify({ ...p, pw: '' })); store.log({ k: 'config', u: p.pseudo, action: 'mot de passe réinitialisé par l\'administrateur' }); }
          await store.flush();
          return json(res, { ok: true }), true;
        }
        const rows = [];
        for (const id of await store.profIds()) { try { const p = JSON.parse(await store.getKey('p:' + id)); rows.push({ ref: refOf(id), pseudo: p.pseudo, device: (p.cfg || {}).device || '', pw: !!p.pw, cfg: p.cfg || {}, maj: p.maj || 0 }); } catch { /* profil illisible */ } }
        return json(res, { profils: rows.sort((x, y) => y.maj - x.maj) }), true;
      }
      if (seg[2] === 'reset' && req.method === 'POST') { await store.reset(q.get('what') === 'logs' ? 'logs' : 'all'); return json(res, { ok: true }), true; }
    } catch (e) { return json(res, { error: e.message }), true; }
    return json(res, { error: 'inconnu' }), true;
  };
};

const CSS = `:root{--bg:#0b0d12;--p:#141821;--p2:#1b2030;--b:#2a3042;--t:#eef1f7;--m:#98a2b8;--a:#ff4655;--ok:#2dd4a0;--ko:#ff5d73;--w:#f5b942}
*{box-sizing:border-box}html{color-scheme:dark}body{margin:0;background:var(--bg);color:var(--t);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}code{background:var(--p2);padding:2px 6px;border-radius:6px}`;
const LOGIN = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Connexion · Dashboard Esport</title><style>${CSS}
body{display:grid;place-items:center;min-height:100vh;padding:16px}form{width:100%;max-width:340px;background:var(--p);border:1px solid var(--b);border-radius:14px;padding:26px;display:grid;gap:14px}
input,button{font:inherit;padding:11px 13px;border-radius:9px;border:1px solid var(--b);background:var(--p2);color:var(--t)}button{background:var(--a);border-color:var(--a);font-weight:700;cursor:pointer}#e{color:var(--ko);min-height:18px;font-size:13px}</style>
<form id=f><h2 style="margin:0">⚡ Dashboard Esport</h2><input id=pw type=password placeholder="Mot de passe" autofocus autocomplete=current-password><button>Se connecter</button><div id=e></div></form>
<script>f.onsubmit=async e=>{e.preventDefault();const r=await fetch('/admin/login',{method:'POST',body:JSON.stringify({password:pw.value})}).then(r=>r.json());r.ok?location.reload():(document.getElementById('e').textContent=r.error)}</script>`;
const SETUP = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Dashboard Esport</title><style>${CSS}body{display:grid;place-items:center;min-height:100vh;padding:16px}.c{max-width:480px;background:var(--p);border:1px solid var(--b);border-radius:14px;padding:26px}</style>
<div class=c><h2 style="margin-top:0">Dashboard non activé</h2><p style="color:var(--m)">Ajoute la variable d'environnement <code>ADMIN_PASSWORD</code> dans Vercel (Settings → Environment Variables), puis redéploie.</p></div>`;
let cache; const page = k => k === 'login' ? LOGIN : k === 'setup' ? SETUP : (cache ||= fs.readFileSync(path.join(__dirname, 'pages', 'admin.html'), 'utf8'));
