/* Global Quran API client (https://docs.globalquran.com).
   Everything the reader shows except the mushaf glyph text (data/qcf) comes through here: translation / recitor / transliteration lists
   and per-surah text for any edition.

   Configuration (all optional):
     window.GQ_API_URL   default https://api.globalquran.com        (or ?api=https://...)
     window.GQ_API_KEY   sent as ?key=... only when set             (or ?key=...). The API accepts keyless requests today; if keys are
                                                                     ever enforced, set the key here (site config / embed data-api-key).
   Caching: lists are kept in localStorage for 24h and served stale while they refresh; surah text is kept in memory and IndexedDB. */
window.GQ = (() => {
  "use strict";
  const qs = new URLSearchParams(location.search);
  const cfg = { base: String(window.GQ_API_URL || qs.get("api") || "https://api.globalquran.com").replace(/\/+$/, ""), key: window.GQ_API_KEY || qs.get("key") || "" };
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

  async function get(path, { timeout = 20000 } = {}) {
    const url = cfg.base + path + (cfg.key ? (path.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(cfg.key) : "");
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
    /* every failure carries e.kind: "offline" | "network" | "timeout" | "server" (5xx, or the API itself reports an error such as a database problem)
       | "rate" (429) | "key" (401/403) | "client" (other 4xx), and e.status when there was a response, so the app can explain it properly */
    const fail = (kind, msg, status) => { const e = new Error(msg); e.kind = kind; if (status) e.status = status; return e; };
    try {
      let r;
      try { r = await fetch(url, { signal: ctl.signal }); }
      catch (e) { throw ctl.signal.aborted ? fail("timeout", "Global Quran API timed out") : fail(navigator.onLine === false ? "offline" : "network", "Global Quran API unreachable"); }
      if (!r.ok) throw fail(r.status === 429 ? "rate" : r.status === 401 || r.status === 403 ? "key" : r.status >= 500 ? "server" : "client", "Global Quran API " + r.status, r.status);
      let d; try { d = await r.json(); } catch (e) { throw fail("server", "Global Quran API sent something unreadable", r.status); }
      if (d && d.error) throw fail("server", typeof d.error === "string" ? d.error : (d.error.message || "API error"), r.status);
      return d;
    } finally { clearTimeout(t); }
  }

  /* lists: shown from the cache at once (even if old), refreshed in the background when older than the ttl */
  async function cached(name, path, ttl = 24 * 3600e3) {
    const k = "gq2.api." + name; let c = null; try { c = JSON.parse(ls.get(k) || "null"); } catch (e) {}
    const fresh = () => get(path).then(d => { ls.set(k, JSON.stringify({ t: Date.now(), d })); return d; });
    if (c && c.d) { if (Date.now() - c.t > ttl) fresh().catch(() => {}); return c.d; }
    return fresh();
  }

  /* surah text: memory, then IndexedDB, then one request for everything still missing (editions joined with "|") */
  const mem = new Map();
  let dbp = null;
  const db = () => dbp || (dbp = new Promise(res => {
    if (!window.indexedDB) return res(null);
    const r = indexedDB.open("gq-text", 1); r.onupgradeneeded = () => r.result.createObjectStore("t"); r.onsuccess = () => res(r.result); r.onerror = () => res(null);
  }));
  const idbGet = async k => { const d = await db(); return d ? new Promise(res => { try { const q = d.transaction("t").objectStore("t").get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch (e) { res(undefined); } }) : undefined; };
  const idbPut = async (k, v) => { const d = await db(); if (d) try { d.transaction("t", "readwrite").objectStore("t").put(v, k); } catch (e) {} };

  /* -> { editionId: [ayah 1 text, ayah 2 text, ...] } */
  async function text(surah, ids) {
    const out = {}, need = [];
    for (const id of ids) {
      const k = id + "|" + surah;
      if (mem.has(k)) { out[id] = mem.get(k); continue; }
      const c = await idbGet(k); if (c) { mem.set(k, c); out[id] = c; } else need.push(id);
    }
    if (need.length) {
      const d = await get("/v1/surah/" + surah + "/" + need.map(encodeURIComponent).join("%7C")), q = (d && d.quran) || {};
      for (const id of need) {
        const o = q[id]; if (!o) continue;
        const arr = []; Object.values(o).forEach(v => { arr[v.ayah - 1] = v.verse; });
        mem.set(id + "|" + surah, arr); idbPut(id + "|" + surah, arr); out[id] = arr;
      }
    }
    return out;
  }

  return {
    cfg, get, text,
    translations: () => cached("translations", "/v2/list/translation"),
    recitors: () => cached("recitors", "/v2/list/recitor"),
    surahs: () => cached("surahs", "/v1/surah", 7 * 24 * 3600e3),   // names, ayah counts, global start ayah, juz
    editions: () => cached("editions", "/v1/quran")      // every edition incl. transliterations (the v2 lists have none)
  };
})();
