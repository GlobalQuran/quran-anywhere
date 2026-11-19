/* Global Quran service worker.
   1. Opens the reader with no internet: the page and its scripts, styles, icons and small fonts are kept in the "gq-shell-*" cache.
   2. Serves what the reader chose to save for offline (the Offline library): the mushaf glyph data, the page fonts and the recitation files are kept by
      offline.js in the "gq-offline" cache, and are answered from there first (audio with Range support, which <audio> needs, Safari above all).
   The surah text is not handled here: gq-api.js keeps it in IndexedDB. See rules/offline.md. */
"use strict";
const SHELL = "gq-shell-v1", OFFLINE = "gq-offline";
const BASE = new URL("./", self.location).href;           // the folder the app lives in (any depth)
const INDEX = BASE + "index.html";
const STATIC = /\.(css|js|json|woff2?|ttf|png|jpe?g|webp|svg|ico|webmanifest)$/i;
const SAVED = /\.(mp3|ogg|woff2?|json)$/i;                 // what the Offline library may hold, on the CDN hosts
let refreshed = false;

/* a redirected response cannot answer a navigation: copy it into a plain one */
const clean = async r => r.redirected ? new Response(await r.blob(), { status: 200, headers: r.headers }) : r;

/* the page plus every file it names (scripts, styles, icons, manifest), and the two small data files the reader loads at once */
async function cacheShell() {
  const c = await caches.open(SHELL);
  let html = "";
  try { const r = await fetch(INDEX, { cache: "reload" }); if (r.ok) { html = await r.clone().text(); await c.put(INDEX, await clean(r)); } } catch (e) {}
  const urls = new Set(["data/surahs.json", "data/pages.json", "site.webmanifest"]);
  html.replace(/(?:src|href)="([^"#]+)"/g, (m, u) => { if (!/^(?:[a-z]+:|\/\/|mailto)/i.test(u) && !/^index\.html/.test(u) && u !== "./") urls.add(u); });
  await Promise.all([...urls].map(u => fetch(new URL(u, BASE), { cache: "reload" }).then(r => r.ok && r.type === "basic" ? c.put(new URL(u, BASE).href, r) : 0).catch(() => {})));
  /* an older ?v= of a file the page now names is dropped, so versions never pile up */
  const now = new Set([...urls].map(u => new URL(u, BASE).href));
  for (const k of await c.keys()) { const x = new URL(k.url); if (x.search && !now.has(k.url) && [...now].some(h => h.split("?")[0] === x.origin + x.pathname)) await c.delete(k); }
}

self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(cacheShell()); });
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("gq-shell-") && k !== SHELL) await caches.delete(k);   // never the saved surahs
  await self.clients.claim();
})()));

/* files the page has already loaded (icons, fonts, images named only inside the CSS) are handed over so the first offline visit is complete */
self.addEventListener("message", e => {
  const d = e.data || {};
  if (d.type === "precache" && Array.isArray(d.urls)) e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all([...new Set(d.urls.map(u => String(u).split("#")[0]))].filter(u => { try { const x = new URL(u); return x.origin === location.origin && x.href.startsWith(BASE) && STATIC.test(x.pathname); } catch (e) { return false; } })
      .map(async u => { if (await c.match(u)) return; try { const r = await fetch(u); if (r.ok && r.type === "basic") await c.put(u, r); } catch (e) {} }));
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.endsWith("/sw.js") || !url.href.startsWith(BASE)) return;
    if (req.mode === "navigate") return e.respondWith(navigate(req, e));
    if (STATIC.test(url.pathname) && !url.pathname.includes("/card/")) return e.respondWith(swr(req, e));
    return;
  }
  if (SAVED.test(url.pathname) && url.hostname !== "api.globalquran.com") e.respondWith(saved(req));
});

/* a page: the network first (the host adds the link-preview tags there), the saved page when the network is gone or slow */
async function navigate(req, e) {
  const c = await caches.open(SHELL), have = await c.match(INDEX);
  try {
    const r = await (have ? Promise.race([fetch(req), new Promise((_, no) => setTimeout(no, 5000))]) : fetch(req));
    if (!refreshed && r.ok && new URL(req.url).pathname === new URL(BASE).pathname) { refreshed = true; e.waitUntil(cacheShell()); }   // a new version of the page: keep the saved copy current
    return r;
  } catch (err) { return have || Response.error(); }
}

/* scripts, styles, fonts, icons: what is saved answers at once, and is refreshed behind it */
async function swr(req, e) {
  const c = await caches.open(SHELL), hit = await c.match(req);
  const net = fetch(req).then(r => { if (r.ok && r.type === "basic") c.put(req, r.clone()); return r; }).catch(() => null);
  if (hit) { e.waitUntil(net); return hit; }
  return (await net) || Response.error();
}

/* what the reader saved: from the "gq-offline" cache first, the network otherwise */
async function saved(req) {
  const hit = await (await caches.open(OFFLINE)).match(req.url, { ignoreVary: true });
  if (!hit) return fetch(req);
  return req.headers.has("range") ? ranged(req, hit) : hit;
}
/* <audio> asks for byte ranges; a plain 200 makes Safari refuse the file and stops seeking everywhere */
async function ranged(req, res) {
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || ""); if (!m) return res;
  const buf = await res.arrayBuffer(), size = buf.byteLength;
  const start = m[1] === "" ? Math.max(0, size - +m[2]) : +m[1], end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(+m[2], size - 1);
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
  return new Response(buf.slice(start, end + 1), { status: 206, headers: { "Content-Type": res.headers.get("Content-Type") || "audio/mpeg", "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" } });
}
