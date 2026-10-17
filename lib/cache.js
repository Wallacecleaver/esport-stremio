'use strict';
// Cache mémoire « stale-while-revalidate » : valeur fraîche renvoyée telle quelle ; périmée → renvoyée ET rafraîchie en arrière-plan ;
// absente → on attend la source. Si la source plante, on garde la dernière valeur connue.
// (Sur Vercel, chaque instance a son propre cache : le cache partagé passe par Upstash, voir lib/store.js.)
const store = new Map();

function refresh(key, ttlMs, fn) {
  const entry = store.get(key) || {};
  if (entry.pending) return entry.pending;
  const pending = (async () => {
    try {
      const value = await fn();
      store.set(key, { value, hasValue: true, expires: Date.now() + ttlMs });
      return value;
    } catch (err) {
      const cur = store.get(key) || {};
      if (cur.hasValue) { store.set(key, { value: cur.value, hasValue: true, expires: Date.now() + Math.min(ttlMs, 15000) }); return cur.value; }
      store.delete(key);
      throw err;
    }
  })();
  store.set(key, { ...entry, pending });
  return pending;
}
async function cached(key, ttlMs, fn) {
  const entry = store.get(key);
  if (entry && entry.hasValue) {
    if (entry.expires <= Date.now()) refresh(key, ttlMs, fn).catch(() => {});
    return entry.value;
  }
  return refresh(key, ttlMs, fn);
}
const clearCache = () => store.clear();
const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise(r => setTimeout(() => r(fallback), ms))]);

module.exports = { cached, clearCache, withTimeout };
