/* Global Quran offline: keep surahs on this device so they read, and play, with no internet. See rules/offline.md.
   One idea for the reader: a surah is ready offline, or it is not. What "ready" holds is decided once ("Read only" or "Read and listen") and kept as one switch.
   Reading = the surah's text in every edition the page uses (IndexedDB, through GQ.text), the mushaf glyph data and its page fonts (Cache Storage).
   Listening = every verse of the current voice(s) (Cache Storage). sw.js answers requests for those files from the cache; this file downloads, counts and removes them,
   and draws the three entry points: the cloud in the page header (this surah), a status on every surah in the list, and the Offline library (everything else).
   app.js hands over what only it knows (surah list, chosen translations, voices, audio URLs) through GQOff.attach(). */
window.GQOff = (() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const BUCKET = "gq-offline", KEY = "gq2.off", MB = 1048576;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const PAUSE = { paused: true };
  const qs = new URLSearchParams(location.search);
  let supported = (() => { try { return "serviceWorker" in navigator && "caches" in window && window.isSecureContext && window.top === window && qs.get("embed") !== "1" && new URL(document.baseURI).origin === location.origin; } catch (e) { return false; } })();
  let api = null, cache = null, PAGES = null, FREE = null;

  /* ---------- what is saved (localStorage, small): s[n] = { r: 1 reading is saved, t: [text editions], p: [pages], rb: MB of reading, a: { voice: MB } } ---------- */
  const fresh = () => ({ v: 1, s: {}, listen: true, asked: false, auto: false, q: [], seen: [] });
  let ST = (() => { try { const o = JSON.parse(localStorage.getItem(KEY) || "null"); if (o && o.v === 1) return Object.assign(fresh(), o); } catch (e) {} return fresh(); })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ST)); } catch (e) {} };

  const fmt = mb => mb < 1 ? Math.max(1, Math.round(mb * 1000)) + " KB" : mb < 10 ? mb.toFixed(1) + " MB" : mb < 1000 ? Math.round(mb) + " MB" : (mb / 1000).toFixed(2) + " GB";

  /* ---------- sizes: estimates for what is not saved yet (a mushaf page is two fonts, plain and colour; a verse of audio follows the bitrate) ---------- */
  const MT = .0026, fontMB = () => api.colr ? .235 : .12, audioMB = kbs => .112 * ((+kbs || 128) / 128);
  const surah = n => api.surahs()[n - 1];
  const hasBism = n => n !== 1 && n !== 9;
  const cmp = (a, b, c, d) => a !== c ? a - c : b - d;
  function pagesOf(n) {   // the Madani pages a surah touches, from data/pages.json (first ayah of each page)
    if (!PAGES) return Array.from({ length: Math.max(1, Math.ceil(surah(n).c / 12)) }, (_, i) => i + 1);
    const c = surah(n).c, out = [];
    for (let p = 1; p <= 604; p++) {
      const a = PAGES[p - 1], b = PAGES[p] || [115, 1];
      if (cmp(a[0], a[1], n, c) <= 0 && cmp(b[0], b[1], n, 1) > 0) out.push(p);
    }
    return out.length ? out : [1];
  }
  const textMB = (n, ids) => surah(n).c * MT * Math.max(.5, Math.min(4, ids / 4));
  const readMB = n => textMB(n, api.textIds().length) + .04 + pagesOf(n).length * fontMB();
  const voicesOn = () => ST.listen ? api.voices() : [];
  const voiceMB = (n, v) => (surah(n).c + (hasBism(n) ? 1 : 0)) * audioMB(v.kbs);
  function missing(n) {
    const r = ST.s[n], ids = api.textIds();
    return { read: !(r && r.r), text: r && r.r ? ids.filter(i => !(r.t || []).includes(i)) : [], voices: voicesOn().filter(v => !(r && r.a && r.a[v.id])) };
  }
  const isReady = n => !!(ST.s[n] && ST.s[n].r);
  const isComplete = n => { const m = missing(n); return !m.read && !m.text.length && !m.voices.length; };
  const costOf = n => { const m = missing(n); let c = 0; if (m.read) c += readMB(n); else if (m.text.length) c += textMB(n, m.text.length); m.voices.forEach(v => { c += voiceMB(n, v); }); return c; };
  const costList = list => list.reduce((a, n) => a + costOf(n), 0);
  const sizeOf = n => { const r = ST.s[n]; return r ? (r.rb || 0) + Object.values(r.a || {}).reduce((a, x) => a + x, 0) : 0; };
  const onDevice = () => Object.keys(ST.s).reduce((a, n) => a + sizeOf(+n), 0);
  const readOnDevice = () => Object.values(ST.s).reduce((a, r) => a + (r.rb || 0), 0);
  const nReady = () => Object.keys(ST.s).filter(n => ST.s[n].r).length;
  const nListen = () => Object.keys(ST.s).filter(n => ST.s[n].r && Object.keys(ST.s[n].a || {}).length).length;
  const savedVoices = () => [...new Set(Object.values(ST.s).flatMap(r => Object.keys(r.a || {})))];   // every voice that has files on this device
  const voiceCount = id => Object.keys(ST.s).filter(n => ST.s[n].r && ST.s[n].a && ST.s[n].a[id]).length;
  const voiceOnDevice = id => Object.values(ST.s).reduce((a, r) => a + ((r.a || {})[id] || 0), 0);
  const touched = n => (ST.seen || []).includes(n) || api.marks().includes(n);   // opened, played or saved
  const needUpdate = () => Object.keys(ST.s).map(Number).filter(n => ST.s[n].r && !isComplete(n) && !Q.list.includes(n));
  const allN = () => Array.from({ length: 114 }, (_, i) => i + 1);

  /* ---------- the download queue ---------- */
  const Q = { list: [], run: false, prog: {}, cost: {}, batch: null, err: null, busy: false, ctl: new Set() };
  const SEL = new Set();   // surahs ticked in the library or in the list
  let UI = { filter: "all", selMode: false, listFilter: "all", pop: null, lisOpen: false };
  const VS = { tab: "quran", q: "", open: false };   // the "Change voices" sheet

  async function open() { if (!cache) cache = await caches.open(BUCKET); return cache; }
  async function persist() { try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {} }
  async function refreshFree() { try { const e = await navigator.storage.estimate(); FREE = (e.quota - e.usage) / MB; } catch (e) { FREE = null; } emit(); }
  const persistQ = () => { ST.q = Q.list.slice(); save(); };
  const classify = e => e && e.name === "QuotaExceededError" ? { kind: "space" } : { kind: navigator.onLine === false ? "offline" : "network" };

  function enqueue(list) {
    let add = 0;
    list.forEach(n => { if (Q.list.includes(n) || isComplete(n)) return; Q.list.push(n); Q.cost[n] = costOf(n); Q.prog[n] = 0; add++; });
    if (!add) return;
    Q.batch = Q.batch || { n: 0, fin: 0, done: 0 }; Q.batch.n += add; Q.batch.complete = false; Q.run = true; Q.err = null; persistQ(); pump(); emit();
  }
  const batchStats = () => {
    const b = Q.batch; if (!b) return null;
    let tot = b.done, done = b.done; Q.list.forEach(n => { tot += Q.cost[n] || 0; done += (Q.cost[n] || 0) * (Q.prog[n] || 0); });
    return { complete: !!b.complete && !Q.list.length, tot: Math.max(tot, .01), done, left: Math.max(0, tot - done), idx: b.fin + 1, n: b.fin + Q.list.length };
  };
  function pause() { Q.run = false; Q.ctl.forEach(c => c.abort()); emit(); }
  function resume() { if (!Q.list.length) return; Q.run = true; Q.err = null; pump(); emit(); }
  function cancel() { Q.run = false; Q.ctl.forEach(c => c.abort()); Q.list = []; Q.prog = {}; Q.batch = null; Q.err = null; persistQ(); emit(); }
  function dequeue(n) {
    const wasCur = Q.list[0] === n && Q.busy; if (wasCur) { Q.run = false; Q.ctl.forEach(c => c.abort()); }
    Q.list = Q.list.filter(x => x !== n); delete Q.prog[n]; if (Q.batch) Q.batch.n = Math.max(Q.batch.fin, Q.batch.n - 1);
    if (!Q.list.length) { Q.batch = null; Q.run = false; } persistQ(); emit();
    if (wasCur && Q.list.length) (async () => { while (Q.busy) await sleep(30); if (Q.list.length) resume(); })();   // carry on with the next surah
  }

  async function pump() {
    if (Q.busy) return; Q.busy = true;
    try {
      await open(); persist(); refreshFree();
      while (Q.list.length && Q.run) {
        const n = Q.list[0];
        try { await doSurah(n); }
        catch (e) { if (e === PAUSE || !Q.run) break; Q.err = classify(e); Q.run = false; break; }
        Q.list.shift(); delete Q.prog[n]; Q.batch.fin++; Q.batch.done += Q.cost[n] || 0; persistQ(); emit();
      }
    } catch (e) { Q.err = classify(e); Q.run = false; }
    Q.busy = false;
    if (!Q.list.length && Q.batch) { Q.batch.complete = true; Q.run = false; refreshFree(); emit(); setTimeout(() => { if (!Q.list.length) { Q.batch = null; emit(); } }, 5000); }
    emit();
  }

  /* one file into the cache; resumes by skipping what is already there (a retry or a resume never repeats a file) */
  async function put(url) {
    if (await cache.match(url)) return { size: 0 };
    for (let a = 0; a < 3; a++) {
      if (!Q.run) throw PAUSE;
      const ctl = new AbortController(); Q.ctl.add(ctl);
      try {
        const r = await fetch(url, { signal: ctl.signal });
        if (r.status === 404) return { size: 0, missing: true };   // a file the host does not have: skipped, never a loop
        if (!r.ok) throw new Error("HTTP " + r.status);
        const b = await r.blob();
        await cache.put(url, new Response(b, { status: 200, headers: { "Content-Type": r.headers.get("Content-Type") || b.type || "application/octet-stream" } }));
        return { size: b.size };
      } catch (e) {
        if (!Q.run) throw PAUSE; if (e && e.name === "QuotaExceededError") throw e; if (a === 2) throw e; await sleep(700 * (a + 1));
      } finally { Q.ctl.delete(ctl); }
    }
  }
  async function pool(list, limit, fn) {
    let i = 0, dead = false;
    await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (i < list.length && !dead) { if (!Q.run) { dead = true; throw PAUSE; } const t = list[i++]; try { await fn(t); } catch (e) { dead = true; throw e; } }
    }));
  }
  async function doSurah(n) {
    const m = missing(n), ids = api.textIds(), rec = ST.s[n] || { t: [], a: {}, p: [], rb: 0 }, cost = Q.cost[n] || 1;
    let done = 0; const step = w => { done += w; Q.prog[n] = Math.max(Q.prog[n] || 0, Math.min(.99, done / cost)); emit(true); };
    const A = api.assets;
    if (m.read || m.text.length) {
      const want = m.read ? ids : m.text;
      await GQ.text(n, want); if (m.read) { await GQ.text(1, ["quran-uthmani", "quran-tajweed"].filter(i => ids.includes(i))).catch(() => {}); }
      step(textMB(n, want.length));
      if (m.read) {
        let bytes = 0;
        const gUrl = s => `${A}/quran_data/qcf/${s}.json`;
        const g = await put(gUrl(n)); bytes += g.size; const gj = await (await (await cache.match(gUrl(n))).clone()).json();
        if (n !== 1) bytes += (await put(gUrl(1))).size;
        const pages = [...new Set(gj.flatMap(ay => ay.map(w => w[4])))].sort((a, b) => a - b);
        if (!pages.includes(1)) pages.unshift(1);
        step(.04);
        const files = []; pages.forEach(p => { files.push(`${A}/fonts/qcf/v2-p${p}.woff2`); if (api.colr) files.push(`${A}/fonts/qcf/v4-p${p}.woff2`); });
        await pool(files, 5, async u => { const r = await put(u); bytes += r.size; step(fontMB() / (api.colr ? 2 : 1)); });
        rec.r = 1; rec.p = pages; rec.rb = (rec.rb || 0) + bytes / MB;
      }
      rec.t = [...new Set([...(rec.t || []), ...want])]; ST.s[n] = rec; save(); emit();
    }
    for (const v of m.voices) {
      const s = surah(n), urls = []; if (hasBism(n)) urls.push(api.audioUrl(v.id, 1));
      for (let k = 0; k < s.c; k++) urls.push(api.audioUrl(v.id, s.g + k));
      let bytes = 0, each = audioMB(v.kbs);
      await pool(urls, 5, async u => { const r = await put(u); bytes += r.size; step(each); });
      rec.a = rec.a || {}; rec.a[v.id] = (rec.a[v.id] || 0) + bytes / MB; ST.s[n] = rec; save(); emit();
    }
  }

  /* ---------- removing ---------- */
  const audioRe = /\/([^/]+)\/(?:mp3|ogg)\/\d+kbs\/(\d+)\.(?:mp3|ogg)$/, fontRe = /\/fonts\/qcf\/v[24]-p(\d+)\.woff2$/, glyphRe = /\/quran_data\/qcf\/(\d+)\.json$/;
  async function purge(test) { await open(); const keys = await cache.keys(); await Promise.all(keys.filter(r => test(r.url)).map(r => cache.delete(r))); }
  async function removeListening(n) {
    const r = ST.s[n]; if (!r) return; const ids = Object.keys(r.a || {}), s = surah(n), lo = s.g, hi = s.g + s.c - 1;
    const keepBism = id => Object.keys(ST.s).some(k => +k !== n && hasBism(+k) && ST.s[k].a && ST.s[k].a[id]);
    await purge(u => { const m = audioRe.exec(u); if (!m || !ids.includes(m[1])) return false; const g = +m[2]; return (g >= lo && g <= hi) || (g === 1 && hasBism(n) && !keepBism(m[1])); });
    r.a = {}; save(); emit();
  }
  async function removeSurah(n) {
    const r = ST.s[n]; if (!r) return;
    await removeListening(n);
    const others = new Set([1]); Object.keys(ST.s).forEach(k => { if (+k !== n) (ST.s[k].p || []).forEach(p => others.add(p)); });
    const mine = new Set((r.p || []).filter(p => !others.has(p)));
    await purge(u => { const f = fontRe.exec(u); if (f) return mine.has(+f[1]); const g = glyphRe.exec(u); return !!g && +g[1] === n && n !== 1; });
    delete ST.s[n]; save(); refreshFree(); emit();
  }
  async function removeVoice(id) {   // one voice's recitation from every surah; the reading part stays
    await purge(u => { const m = audioRe.exec(u); return !!m && m[1] === id; });
    Object.values(ST.s).forEach(r => { if (r.a) delete r.a[id]; }); save(); refreshFree(); emit();
  }
  async function removeAll() { cancel(); await caches.delete(BUCKET); cache = null; ST.s = {}; save(); refreshFree(); emit(); }

  /* ---------- small helpers for the pieces ---------- */
  const ICON = {
    cloud: `<path d="M7 18.5a4.2 4.2 0 0 1-.7-8.3A5.6 5.6 0 0 1 17.1 8.9 4.8 4.8 0 0 1 17.5 18.5H7z"/><path d="M12 10.5v6M9.6 14.2 12 16.6l2.4-2.4"/>`,
    check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`, pause: `<path d="M9 6v12M15 6v12"/>`, play: `<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>`, x: `<path d="M6 6l12 12M18 6L6 18"/>`,
    trash: `<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>`, ear: `<path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2zM20 14a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2z"/>`,
    text: `<path d="M4 18 9.5 5l5.5 13M6 14h7M16.5 9h4M18.5 9v9"/>`, wifi: `<path d="M2.5 9a15 15 0 0 1 19 0M5.7 12.4a10 10 0 0 1 12.6 0M9 15.7a5 5 0 0 1 6 0M12 19.2h.01"/>`,
    nowifi: `<path d="M2.5 9a15 15 0 0 1 19 0M5.7 12.4a10 10 0 0 1 12.6 0M9 15.7a5 5 0 0 1 6 0M12 19.2h.01M4 4l16 16"/>`, alert: `<path d="M12 4 3 19h18zM12 10v4M12 16.8h.01"/>`,
    chev: `<path d="M6 9.5l6 6 6-6"/>`, swap: `<path d="M7 4 3.5 7.5 7 11M3.5 7.5h13M17 13l3.5 3.5L17 20M20.5 16.5h-13"/>`,
    sel: `<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12.5l2.4 2.4 4.6-5"/>`
  };
  const ic = (n, c = "") => `<svg class="${c}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
  const ring = (p, r = 11, cls = "") => { const C = 2 * Math.PI * r; return `<svg class="rg ${cls}" viewBox="0 0 ${2 * r + 6} ${2 * r + 6}" aria-hidden="true"><circle class="t" cx="${r + 3}" cy="${r + 3}" r="${r}"/><circle class="v" cx="${r + 3}" cy="${r + 3}" r="${r}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}" transform="rotate(-90 ${r + 3} ${r + 3})"/></svg>`; };
  const online = () => navigator.onLine !== false;
  const state = n => Q.list.includes(n) ? (Q.list[0] === n ? "busy" : "wait") : isReady(n) ? "ready" : "none";
  const listenNames = () => api.voices().map(v => v.name).join(" + ");
  /* a voice is named in English and, when it differs, in its own language and script (read right to left where it needs to) */
  const nat = s => s ? `<span class="nat" dir="auto">${esc(s)}</span>` : "";
  const vh = (name, native) => esc(name) + nat(native);
  const listenHtml = () => api.voices().map(v => vh(v.name, v.native)).join(" + ");
  const surahName = n => surah(n).en;
  const pct = n => Math.round((Q.prog[n] || 0) * 100);

  /* ---------- the glyph on every surah row (list and quick picker) ---------- */
  const rowKey = {};
  function renderList() {
    $$("[data-og]").forEach(b => {
      const n = +b.dataset.og, st = state(n), p = st === "busy" ? pct(n) : 0, mis = st === "ready" && !isComplete(n);
      const tk = UI.selMode && st === "none" && SEL.has(n), key = st + p + (tk ? "t" : "") + (online() ? "" : "x"); if (b.dataset.k === key) return; b.dataset.k = key;
      b.className = "og og-" + st + (tk ? " og-tick" : ""); const li = b.closest("li"); if (li) li.classList.toggle("is-ready", st === "ready");
      b.innerHTML = st === "busy" ? ring(Q.prog[n] || 0, 11) + `<b>${Q.run ? p : ""}</b>${Q.run ? "" : ic("play")}` : st === "wait" ? `<svg class="rg" viewBox="0 0 28 28" aria-hidden="true"><circle class="t" cx="14" cy="14" r="11" stroke-dasharray="3 4.2"/></svg><b>${Q.list.indexOf(n) + 1}</b>` : st === "ready" || tk ? ic("check") : ic("cloud");
      b.setAttribute("aria-label", tk ? `${surahName(n)} is ticked` : st === "busy" ? `${Q.run ? "Pause" : "Resume"} saving ${surahName(n)}` : st === "wait" ? `${surahName(n)} is waiting. Cancel` : st === "ready" ? `${surahName(n)} is ready offline. Options` : `Save ${surahName(n)} for offline`);
      b.title = st === "ready" ? (mis ? "Ready offline (needs an update)" : "Ready offline") : st === "busy" ? "Saving" : st === "wait" ? "Waiting" : "Save for offline";
    });
    $$("#surahList li").forEach(li => { const g = $("[data-og]", li); if (g) li.classList.toggle("og-ticked", UI.selMode && SEL.has(+g.dataset.og)); });
    const ul = $("#surahList"); if (ul) { ul.classList.toggle("f-ready", UI.listFilter === "ready"); ul.classList.toggle("f-none", UI.listFilter === "none"); ul.classList.toggle("og-select", UI.selMode); }
  }
  function renderStrip() {
    const el = $("#offStrip"); if (!el) return;
    const off = !online(), sel = UI.selMode, list = [...SEL].filter(n => !isComplete(n) && !Q.list.includes(n)).sort((a, b) => a - b);
    el.innerHTML = (off ? `<div class="os-row">${ic("nowifi")}<span class="os-t"><b>You're offline</b><small>${nReady()} surah${nReady() === 1 ? " is" : "s are"} ready</small></span></div>`
      : `<div class="os-row">${ic("cloud")}<span class="os-t"><b>${nReady()} of 114 ready offline</b><small>${fmt(onDevice())} on this device</small></span><button type="button" class="os-btn" data-oa="lib">Manage</button></div>`)
      + `<div class="os-chips" role="group" aria-label="Show">${[["all", "All"], ["ready", "Ready"], ["none", "Not saved"]].map(([k, t]) => `<button type="button" class="os-chip" aria-pressed="${UI.listFilter === k}" data-oa="lf" data-k="${k}">${t}</button>`).join("")}${off ? "" : `<button type="button" class="os-chip os-sel" aria-pressed="${sel}" data-oa="selmode">${sel ? "Done" : "Select"}</button>`}</div>`
      + (sel ? `<div class="os-row os-go"><span class="os-t"><b>${list.length ? list.length + " surah" + (list.length > 1 ? "s" : "") + " · " + fmt(costList(list)) : "Tap surahs to tick them"}</b></span><button type="button" class="os-btn os-pri" data-oa="godl" ${list.length ? "" : "disabled"}>Download</button></div>` : "");
  }

  /* ---------- the cloud in the page header ---------- */
  function renderBtn() {
    const b = $("#btnOff"); if (!b) return; const n = api.cur(), st = n ? state(n) : "none", bs = batchStats(), busy = !!Q.list.length;
    b.classList.toggle("is-ready", st === "ready" && !busy); b.classList.toggle("is-busy", busy);
    const p = bs ? Math.min(1, bs.done / bs.tot) : 0;
    if (b.dataset.k !== `${busy}${Math.round(p * 100)}${st}`) { b.dataset.k = `${busy}${Math.round(p * 100)}${st}`;
      b.innerHTML = `<svg class="oi" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18.5a4.2 4.2 0 0 1-.7-8.3A5.6 5.6 0 0 1 17.1 8.9 4.8 4.8 0 0 1 17.5 18.5H7z"/><path class="oi-a" d="M12 10.5v6M9.6 14.2 12 16.6l2.4-2.4"/><path class="oi-c" d="M9.2 13.6l2.2 2.2 3.8-4.2"/></svg>` + (busy ? ring(p, 15, "ob-ring") : ""); }
    b.setAttribute("aria-label", busy ? `Offline: saving, ${Math.round(p * 100)} percent` : st === "ready" ? "Offline: this surah is ready" : "Offline: save this surah");
    b.title = busy ? "Saving for offline" : st === "ready" ? "Ready offline" : "Save for offline";
  }

  /* ---------- the panel under the cloud: this surah only ---------- */
  function renderPop() {
    const el = $("#offpop"); if (!el || el.hidden) return; const n = api.cur(), st = state(n), s = surah(n), m = missing(n), ids = api.textIds();
    const rd = readMB(n), au = api.voices().reduce((a, v) => a + voiceMB(n, v), 0), r = ST.s[n];
    const lib = `<div class="op-lib"><button type="button" class="lnk" data-oa="lib">Offline library ›</button></div>`;
    let h;
    if (st === "busy" || st === "wait") {
      const bs = batchStats(), p = pct(n);
      h = `<h4>${st === "busy" ? (Q.run ? "Saving " : "Paused: ") : "Waiting: "}${esc(s.en)}</h4><p data-d="pt">${st === "busy" ? `${p}% · ${fmt(Q.cost[n] || 0)}` : `Waits behind ${Q.list.indexOf(n)} other surah${Q.list.indexOf(n) > 1 ? "s" : ""}.`}</p>
        <div class="op-bar"><i data-d="pb" style="width:${st === "busy" ? p : 0}%"></i></div>
        <div class="op-act">${st === "busy" ? `<button type="button" class="ob" data-oa="${Q.run ? "pause" : "resume"}">${ic(Q.run ? "pause" : "play")}${Q.run ? "Pause" : "Resume"}</button>` : ""}<button type="button" class="ob" data-oa="unq" data-n="${n}">${ic("x")}${st === "busy" ? "Cancel this surah" : "Don't save"}</button></div>${lib}`;
    } else if (st === "ready") {
      const mis = !isComplete(n);
      h = `<h4>${esc(s.en)} is ready offline</h4><p>${fmt(sizeOf(n))} on this device. ${Object.keys((r && r.a) || {}).length ? "Reads and plays" : "Reads"} with no internet.</p>
        ${mis ? `<button type="button" class="ob pri wide" data-oa="upd" data-n="${n}">${ic("ear")}${m.voices.length && !m.text.length ? "Add listening" : "Update"} · ${fmt(costOf(n))}</button>` : ""}
        <div class="op-act">${Object.keys((r && r.a) || {}).length ? `<button type="button" class="ob" data-oa="rml" data-n="${n}">${ic("ear")}Remove listening</button>` : ""}<button type="button" class="ob dng" data-oa="rm" data-n="${n}">${ic("trash")}Remove from this device</button></div>${lib}`;
    } else if (!ST.asked) {
      h = `<h4>Save ${esc(s.en)} for offline</h4><p>It will open with no internet. Do you want to listen offline too?</p>
        <div class="op-opts"><button type="button" class="opt ${ST.listen ? "" : "on"}" role="radio" aria-checked="${!ST.listen}" data-oa="ls0"><i class="rd"></i><span><b>Read only</b><small>Arabic and your translation</small></span><em>${fmt(rd)}</em></button>
        <button type="button" class="opt ${ST.listen ? "on" : ""}" role="radio" aria-checked="${ST.listen}" data-oa="ls1"><i class="rd"></i><span><b>Read and listen<span class="tag">Suggested</span></b><small>Plus the recitation by ${listenHtml()}</small></span><em>${fmt(rd + au)}</em></button></div>
        <button type="button" class="ob pri wide" data-oa="save" data-n="${n}">${ic("cloud")}Save · ${fmt(rd + (ST.listen ? au : 0))}</button>
        <p class="op-note">${ic("sel")}Asked once. Change it any time in the Offline library.</p>${lib}`;
    } else {
      h = `<h4>Save ${esc(s.en)} for offline</h4><p>${ST.listen ? "Reads and plays" : "Reads"} with no internet.</p>
        <div class="op-line">${ic("check")}<span><b>${ST.listen ? "Read and listen" : "Read only"}</b><small>${ST.listen ? listenHtml() : "Arabic and your translation"}</small></span><em>${fmt(costOf(n))}</em></div>
        <button type="button" class="ob pri wide" data-oa="save" data-n="${n}">${ic("cloud")}Save · ${fmt(costOf(n))}</button>${lib}`;
    }
    if (!online() && st === "none") h += `<p class="op-note">${ic("nowifi")}You are offline. Saving starts when the connection returns.</p>`;
    const key = h.replace(/(data-d="pt">)[^<]*/, "$1").replace(/(data-d="pb" style="width:)[\d.]+/, "$1");   // progress alone never redraws the panel (a click on its buttons would be lost)
    if (el.dataset.h !== key) { el.dataset.h = key; const f = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.oa : ""; el.innerHTML = h; if (f) { const x = $(`[data-oa="${f}"]`, el); x && x.focus({ preventScroll: true }); } }
    else { const t = $("[data-d=pt]", el), b = $("[data-d=pb]", el); if (t && state(n) === "busy") t.textContent = `${pct(n)}% · ${fmt(Q.cost[n] || 0)}`; if (b) b.style.width = (state(n) === "busy" ? pct(n) : 0) + "%"; }
  }

  /* ---------- the progress card in the book ---------- */
  function renderDock() {
    const el = $("#offdock"); if (!el) return; const b = Q.batch, bs = batchStats();
    if (!b) { el.hidden = true; return; } el.hidden = false;
    let h;
    if (b.complete && !Q.list.length) h = `<span class="od-i">${ic("check")}</span><span class="od-t"><b>All ready</b>${b.n} surah${b.n > 1 ? "s" : ""} now work with no internet</span><i class="od-ln" style="width:100%"></i>`;
    else if (Q.err) h = `<span class="od-i err">${ic(Q.err.kind === "space" ? "alert" : "wifi")}</span><span class="od-t"><b>${Q.err.kind === "space" ? "Not enough space" : "No connection"}</b>${Q.err.kind === "space" ? "Free some room, then try again. What is saved stays." : `Paused at ${Math.round(bs.done / bs.tot * 100)}%. It carries on where it stopped.`}</span><button type="button" class="od-b txt" data-oa="resume">Retry</button><button type="button" class="od-b" data-oa="cancel" aria-label="Cancel">${ic("x")}</button><i class="od-ln err" style="width:${bs.done / bs.tot * 100}%"></i>`;
    else {
      const eta = Math.max(1, Math.round(bs.left / 4 / 60 * 10) / 10), cur = Q.list[0] ? surahName(Q.list[0]) : "";
      h = `<span class="od-i">${ic("cloud")}</span><span class="od-t"><b>${Q.run ? "Saving" : "Paused"} ${bs.idx} of ${bs.n} · ${Math.round(bs.done / bs.tot * 100)}%</b>${fmt(bs.done)} of ${fmt(bs.tot)} · ${Q.run ? "~" + (eta < 1.5 ? "1 min" : Math.round(eta) + " min") + " left" : "tap resume to continue"}</span><button type="button" class="od-b" data-oa="${Q.run ? "pause" : "resume"}" aria-label="${Q.run ? "Pause" : "Resume"}">${ic(Q.run ? "pause" : "play")}</button><button type="button" class="od-b" data-oa="cancel" aria-label="Cancel">${ic("x")}</button><i class="od-ln" style="width:${bs.done / bs.tot * 100}%"></i>`;
    }
    el.classList.toggle("err", !!Q.err);
    const key = h.replace(/(<span class="od-t">)[\s\S]*?(<\/span>(?:<button|<i))/, "$1$2").replace(/style="width:[\d.]+%"/, "");   // progress alone only moves the bar and the words: the buttons are never redrawn under a pointer
    if (el.dataset.h !== key) { el.dataset.h = key; el.innerHTML = h; }
    else { const m = /<span class="od-t">([\s\S]*?)<\/span>(?:<button|<i)/.exec(h), t = $(".od-t", el), ln = $(".od-ln", el); if (m && t) t.innerHTML = m[1]; if (ln && bs) ln.style.width = bs.done / bs.tot * 100 + "%"; }
  }

  /* ---------- the Offline library ---------- */
  const lib = () => $("#offlib");
  const libOpen = () => !!lib() && !lib().hidden;
  let libFrom = null;
  function tile(n) {
    const st = state(n), p = st === "busy" ? Q.prog[n] || 0 : 0, C = 2 * Math.PI * 19, mis = st === "ready" && !isComplete(n);
    const svg = st === "busy" ? `<svg viewBox="0 0 42 42" aria-hidden="true"><circle class="t" cx="21" cy="21" r="19"/><circle class="v" cx="21" cy="21" r="19" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}" transform="rotate(-90 21 21)"/></svg>`
      : st === "wait" ? `<svg viewBox="0 0 42 42" aria-hidden="true"><circle class="t" cx="21" cy="21" r="19" stroke-dasharray="3 4.4"/></svg>` : st === "ready" ? `<svg viewBox="0 0 42 42" aria-hidden="true"><circle class="f" cx="21" cy="21" r="21"/></svg>` : `<svg viewBox="0 0 42 42" aria-hidden="true"><circle class="t" cx="21" cy="21" r="19"/></svg>`;
    return `<button type="button" class="lt ${st} ${SEL.has(n) ? "sel" : ""}" data-oa="${st === "ready" ? "menu" : st === "none" ? "tick" : "tq"}" data-n="${n}" aria-pressed="${SEL.has(n)}" aria-label="${esc(surahName(n))}, ${st === "ready" ? "ready offline" : st === "busy" ? "saving" : st === "wait" ? "waiting" : "not saved"}"><span class="lt-t">${ic("check")}</span><span class="lt-r">${svg}<b>${n}</b></span><span class="lt-n">${esc(surahName(n))}</span><span class="lt-z">${st === "ready" ? fmt(sizeOf(n)) : fmt(costOf(n))}${mis ? " ·" : ""}</span></button>`;
  }
  const lackNames = list => { const ids = new Set(); list.forEach(n => missing(n).voices.forEach(v => ids.add(v.id))); return ids.size ? api.voices().filter(v => ids.has(v.id)).map(v => v.name).join(" + ") : "listening"; };
  /* the Listen row: collapsed it names the voices that get saved; open it shows each voice, how many saved surahs have it, and the way to change them */
  function lisRow() {
    const vs = api.voices(), on = ST.listen, open = UI.lisOpen && on, total = nReady();
    const lack = needUpdate().filter(n => missing(n).voices.length), others = savedVoices().filter(id => !vs.some(v => v.id === id));
    const head = `<div class="ol-row ol-lh"><button type="button" class="lis-t" data-oa="lisx" aria-expanded="${open}" aria-controls="lisBody" ${on ? "" : "disabled"}>${ic("ear", "i")}<span class="t"><b>Listen</b><small>${on ? "Saves" + api.voices().map(v => `<span class="vl">${vh(v.name, v.native)}</span>`).join("") : "Off: surahs read offline only"}</small></span>${on ? ic("chev", "chv") : ""}</button><button type="button" class="sw ${on ? "on" : ""}" role="switch" aria-checked="${on}" aria-label="Listen offline" data-oa="lsw"></button></div>`;
    if (!open) return `<div class="ol-lis">${head}</div>`;
    const rows = vs.map(v => { const c = voiceCount(v.id), fresh = total && !c; return `<div class="lv"><span class="t"><b>${vh(v.name, v.native)}${fresh ? `<span class="tag">New</span>` : ""}</b><small>${v.role === "tr" ? "Translation voice" : "Quran recitation"}</small></span><em class="${total && c < total ? "part" : ""}">${total ? c + " of " + total : ""}</em></div>`; }).join("");
    const oth = others.map(id => `<div class="lv old"><span class="t"><b>${vh(api.voiceName(id), api.voiceNative(id))}</b><small>Still saved · ${voiceCount(id)} surah${voiceCount(id) === 1 ? "" : "s"} · ${fmt(voiceOnDevice(id))}</small></span><button type="button" class="ob sm dng" data-oa="vrm" data-k="${esc(id)}">Remove</button></div>`).join("");
    return `<div class="ol-lis open">${head}<div class="lis-b" id="lisBody"><p class="lis-n">Saved surahs include the voices you have chosen now. To save others, change your voices, then add them.</p>${rows}
      ${lack.length ? `<button type="button" class="ob pri wide" data-oa="updall">${ic("cloud")}Add to ${lack.length} surah${lack.length > 1 ? "s" : ""} · ${fmt(costList(lack))}</button>` : ""}
      <button type="button" class="ob wide" data-oa="vopen">${ic("swap")}Change voices</button>${oth ? `<h5>Also on this device</h5>${oth}` : ""}</div></div>`;
  }
  /* the "Change voices" sheet: the player's own two lists. The Quran list is long, so it has search, and what you chose and what is already saved come first. */
  function vsList() {
    const L = api.voiceLists(), saved = new Set(savedVoices()), q = VS.q.trim().toLowerCase(), hit = nm => !q || nm.toLowerCase().includes(q);   // a search matches the English name and the own-language name
    const row = (kind, id, name, cur, sub, native) => `<button type="button" class="vo ${cur ? "on" : ""}" role="radio" aria-checked="${cur}" tabindex="${cur ? 0 : -1}" data-oa="vpick" data-t="${kind}" data-k="${esc(id)}"><i class="rd"></i><span><b>${esc(name)}</b>${nat(native)}${sub || saved.has(id) ? `<small>${esc(sub || "Saved on this device")}</small>` : ""}</span></button>`;
    const head = (t, nv) => `<h6>${esc(t)}${nat(nv)}</h6>`; let h = "", n = 0;
    if (VS.tab === "quran") {
      const cur = L.quran.cur, items = L.quran.items, by = id => items.find(x => x.id === id);
      if (!q || hit("none translation only")) { h += row("q", "", "None (translation only)", cur === "", ""); n++; }
      const first = q ? [] : [cur, ...[...saved].filter(id => id !== cur)].filter(id => by(id));   // searching shows one plain list of matches
      if (first.length) { h += head(q ? "Matches" : "Chosen and saved") + first.map(id => row("q", id, by(id).name, id === cur, "", by(id).native)).join(""); n += first.length; }
      const rest = items.filter(x => !first.includes(x.id) && hit(x.name + " " + x.native));
      if (rest.length) { h += head(first.length ? "All reciters" : q ? "Matches" : "Reciters") + rest.map(x => row("q", x.id, x.name, false, "", x.native)).join(""); n += rest.length; }
    } else {
      const cur = L.tr.cur;
      if (hit("auto")) { h += row("t", "auto", "Auto", cur === "auto", L.tr.auto ? "Follows your translation language: " + L.tr.auto : "None for your translation language"); n++; }
      if (hit("none")) { h += row("t", "", "None", cur === "", ""); n++; }
      L.tr.groups.slice().sort((a, b) => a.label.localeCompare(b.label)).forEach(g => { const it = g.items.filter(x => hit(x.name + " " + x.native) || hit(g.label + " " + g.native)); if (it.length) { h += head(g.label, g.native) + it.map(x => row("t", x.id, x.name, x.id === cur, "", x.native)).join(""); n += it.length; } });
    }
    return n ? h : `<p class="op-note">No voice matches "${esc(VS.q)}".</p>`;
  }
  function vsRender() {
    const m = $("#offmini"), list = $("#ovList"); if (!m || !list || !VS.open) return;
    const f = document.activeElement && m.contains(document.activeElement) ? document.activeElement.dataset : null, sc = list.scrollTop;
    list.innerHTML = vsList(); list.scrollTop = sc; if (!$(".vo.on", list)) { const x = $(".vo", list); x && (x.tabIndex = 0); }
    $$("#ovTabs [data-k]", m).forEach(b => { const on = b.dataset.k === VS.tab; b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; });
    $("#ovQ").placeholder = VS.tab === "quran" ? "Search reciters" : "Search translation voices"; $("#ovQ").setAttribute("aria-label", $("#ovQ").placeholder);
    const w = $("#ovNow"); w.innerHTML = `<b>Saved surahs get</b> ${listenHtml()}`;
    if (f && f.oa === "vpick") { const x = $$("#ovList [data-oa=vpick]").find(b => b.dataset.k === f.k && b.dataset.t === f.t); x && x.focus({ preventScroll: true }); }
  }
  function voiceSheet() {
    VS.open = true; VS.q = "";
    mini(`<div class="vs-h"><h4>Change voices</h4></div><p>These are the player's own voices, so the reader changes too. Pick what you want saved.</p>
      <div class="vs-tabs" id="ovTabs" role="tablist"><button type="button" role="tab" data-oa="vtab" data-k="quran">Quran recitation</button><button type="button" role="tab" data-oa="vtab" data-k="tr">Translation voice</button></div>
      <input id="ovQ" class="vs-q" type="search" autocomplete="off" spellcheck="false">
      <div class="vs-list" id="ovList" role="radiogroup" aria-label="Voices"></div>
      <div class="vs-foot"><span id="ovNow"></span><button type="button" class="ob pri" data-oa="mclose">Done</button></div>`);
    $("#offmini").classList.add("sheet"); vsRender(); const t = $("#ovTabs [aria-selected=true]"); t && t.focus({ preventScroll: true });
  }
  function renderLib() {
    const el = lib(); if (!el || el.hidden) return;
    const pend = [...SEL].filter(n => !isComplete(n) && !Q.list.includes(n)).sort((a, b) => a - b), cost = costList(pend), bs = batchStats(), upd = needUpdate();
    const allNeed = allN().filter(n => !isComplete(n)), readNeed = allN().filter(n => !isComplete(n) && (ST.s[n] || Q.list.includes(n) || touched(n)));
    const eq = a => SEL.size === a.length && a.length && a.every(n => SEL.has(n));
    const lis = ST.listen ? api.voices() : [];
    const side = `<div class="ol-sum"><div class="big">${fmt(onDevice())} <small>on this device</small></div>
      <div class="stack"><i class="a" style="width:${Math.min(100, readOnDevice() / Math.max(onDevice(), .01) * 100)}%"></i></div>
      <div class="key"><span><i class="a"></i>Reading ${fmt(readOnDevice())}</span><span><i class="b"></i>Listening ${fmt(onDevice() - readOnDevice())}</span></div>
      <small>${nReady()} of 114 surahs ready · ${nListen()} with listening${FREE != null ? " · " + fmt(FREE) + " free" : ""}</small></div>
      ${upd.length && !(UI.lisOpen && ST.listen && upd.every(n => !missing(n).text.length && !missing(n).read)) ? `<div class="ol-ban">${ic("ear")}<span><b>${upd.length} ready surah${upd.length > 1 ? "s" : ""} ${upd.every(n => !missing(n).text.length && !missing(n).read) ? (upd.length > 1 ? "have" : "has") + " no " + esc(lackNames(upd)) + " yet" : (upd.length > 1 ? "need" : "needs") + " an update"}</b><small>${upd.every(n => !missing(n).text.length) ? "Add the recitation" : "Add what is missing"} · ${fmt(costList(upd))}</small></span><button type="button" class="ob" data-oa="updall">Add</button></div>` : ""}
      <h3>Quick picks</h3>
      <div class="ol-picks"><button type="button" class="pk ${eq(allNeed) ? "on" : ""}" data-oa="pick" data-k="all" ${allNeed.length ? "" : "disabled"}><span><b>Whole Quran</b><small>${allNeed.length ? allNeed.length + " surah" + (allNeed.length > 1 ? "s" : "") + " to save" : "All ready"}</small></span><em>${allNeed.length ? fmt(costList(allNeed)) : ""}</em></button>
      <button type="button" class="pk ${eq(readNeed) ? "on" : ""}" data-oa="pick" data-k="read" ${readNeed.length ? "" : "disabled"}><span><b>The ones I read</b><small>${readNeed.length ? readNeed.length + " you opened, played or saved" : "Nothing new yet"}</small></span><em>${readNeed.length ? fmt(costList(readNeed)) : ""}</em></button></div>
      <h3>What to keep</h3>
      <div class="ol-row ol-read">${ic("text", "i")}<span class="t"><b>Read</b><small>Arabic, your translation, page fonts</small></span><i class="sw lock" aria-hidden="true"></i></div>
      ${lisRow()}
      <h3>Automatic</h3>
      <div class="ol-row">${ic("wifi", "i")}<span class="t"><b>Keep what I read ready</b><small>New surahs you open or play save themselves on Wi-Fi</small></span><button type="button" class="sw ${ST.auto ? "on" : ""}" role="switch" aria-checked="${ST.auto}" aria-label="Keep what I read ready" data-oa="auto"></button></div>
      <p class="op-note">${ic("wifi")}Wi-Fi is best for big downloads. It pauses by itself if the connection drops and carries on where it stopped.</p>
      ${nReady() ? `<button type="button" class="lnk dng" data-oa="rmall">Remove everything from this device</button>` : ""}`;
    const T = allN().filter(n => UI.filter === "ready" ? isReady(n) : UI.filter === "none" ? !isReady(n) : UI.filter === "sel" ? SEL.has(n) : true);
    const prog = bs && !bs.complete ? `<div class="ol-prog"><span><b data-d="lp1">${Q.err ? "Paused" : Q.run ? "Downloading" : "Paused"} · ${Math.round(bs.done / bs.tot * 100)}%</b><small data-d="lp2">${libProgSub(bs)}</small><div class="stack"><i class="a" data-d="lpb" style="width:${bs.done / bs.tot * 100}%"></i></div></span><button type="button" class="ob" data-oa="${Q.run ? "pause" : "resume"}">${ic(Q.run ? "pause" : "play")}${Q.run ? "Pause" : "Resume"}</button><button type="button" class="ob" data-oa="cancel">Cancel</button></div>` : "";
    const tb = `<div class="ol-tb"><div class="seg" role="group" aria-label="Show">${[["all", "All"], ["ready", "Ready"], ["none", "Not saved"], ["sel", "Ticked"]].map(([k, t]) => `<button type="button" aria-pressed="${UI.filter === k}" data-oa="lflt" data-k="${k}">${t}</button>`).join("")}</div><button type="button" class="ob sm" data-oa="clr" ${SEL.size ? "" : "disabled"}>Clear ticks</button><span class="ol-hint">Tap a surah to tick it</span></div>
      <div class="ol-leg"><span><i class="a"></i>Ready offline</span><span><i class="c"></i>Not saved</span></div>`;
    const foot = `<span class="of-t"><b data-d="lf1">${Q.list.length ? `Saving ${bs.idx} of ${bs.n}` : pend.length ? `${pend.length} surah${pend.length > 1 ? "s" : ""} · ${fmt(cost)}` : "Nothing new to save"}</b><small>${fmt(onDevice())} on this device${FREE != null ? " · " + fmt(FREE) + " free" : ""}</small></span><button type="button" class="ob" data-oa="libx">Close</button>${Q.list.length ? `<button type="button" class="ob" data-oa="${Q.run ? "pause" : "resume"}">${Q.run ? "Pause" : "Resume"}</button>` : `<button type="button" class="ob pri" data-oa="godl" ${pend.length ? "" : "disabled"}>${ic("cloud")}Download${pend.length ? " " + fmt(cost) : ""}</button>`}`;
    $("#olSub").textContent = `${nReady()} of 114 ready · ${fmt(onDevice())}`;
    const f = document.activeElement && el.contains(document.activeElement) ? [document.activeElement.dataset.oa, document.activeElement.dataset.n, document.activeElement.dataset.k] : null;
    const put = (sel, html, key) => { const x = $(sel); key = key == null ? html : key; if (x.dataset.h === key) return; x.dataset.h = key; const sc = x.scrollTop; x.innerHTML = html; x.scrollTop = sc; };
    const dyn = h => h.replace(/(data-d="l[a-z0-9]+">)[^<]*/g, "$1").replace(/style="width:[\d.]+%"/g, "");   // numbers that move while saving never count as a change
    put("#olSide", side); put("#olProg", prog, dyn(prog)); put("#olTb", tb); put("#olFoot", foot, dyn(foot));
    const g = $("#olGrid"), tiles = T.map(tile), order = T.join();   // a tile is replaced only when it changed; the grid keeps its scroll and its focus
    if (g.dataset.o !== order) { g.dataset.o = order; g.innerHTML = tiles.join("") || `<p class="op-note">Nothing here.</p>`; g._t = tiles; }
    else tiles.forEach((h, i) => { if (g._t[i] !== h) { const tmp = document.createElement("div"); tmp.innerHTML = h; g.children[i].replaceWith(tmp.firstChild); } }), g._t = tiles;
    if (f && f[0]) { const x = $$(`#offlib [data-oa="${f[0]}"]`).find(b => (b.dataset.n || "") === (f[1] || "") && (b.dataset.k || "") === (f[2] || "")); x && x.focus({ preventScroll: true }); }
  }
  const libProgSub = bs => `${fmt(bs.done)} of ${fmt(bs.tot)} · surah ${bs.idx} of ${bs.n}${Q.list[0] ? ": " + esc(surahName(Q.list[0])) : ""}`;
  function openLib() {
    api.closePops(); libFrom = document.activeElement; lib().hidden = false; closeMini(); refreshFree(); renderLib(); const x = $("#olClose"); x && x.focus({ preventScroll: true });
    api.stat("open_panel", { panel: "offline_library" });
  }
  function closeLib() { if (!libOpen()) return; closeMini(); lib().hidden = true; if (libFrom && libFrom.focus && document.contains(libFrom)) libFrom.focus({ preventScroll: true }); libFrom = null; }

  /* ---------- small dialogs: the one-time question, a saved surah's options, big downloads, no space ---------- */
  function closeMini() { const m = $("#offmini"); if (m) { m.hidden = true; m.innerHTML = ""; m.classList.remove("sheet"); } VS.open = false; }
  const miniOpen = () => { const m = $("#offmini"); return !!m && !m.hidden; };
  let miniFrom = null;
  function mini(html, acts) {
    const m = $("#offmini"); miniFrom = document.activeElement; m.hidden = false; m._acts = acts || {};
    m.innerHTML = `<div class="om-card" role="document">${html}</div>`; const f = $(".ob.pri, .ob", m); f && f.focus({ preventScroll: true });
  }
  function done() { const wasV = VS.open; VS.open = false; closeMini(); if (wasV) { const b = $("#offlib [data-oa=vopen]"); if (b) { b.focus({ preventScroll: true }); miniFrom = null; return; } } if (miniFrom && miniFrom.focus && document.contains(miniFrom)) miniFrom.focus({ preventScroll: true }); miniFrom = null; }
  function askListen(then) {
    const rd = readMB(api.cur()), au = api.voices().reduce((a, v) => a + voiceMB(api.cur(), v), 0);
    mini(`<h4>Listen offline too?</h4><p>Saved surahs open with no internet. Do you also want the recitation?</p>
      <div class="op-opts"><button type="button" class="opt ${ST.listen ? "" : "on"}" data-oa="ls0"><i class="rd"></i><span><b>Read only</b><small>Arabic and your translation</small></span></button>
      <button type="button" class="opt ${ST.listen ? "on" : ""}" data-oa="ls1"><i class="rd"></i><span><b>Read and listen<span class="tag">Suggested</span></b><small>Plus the recitation by ${listenHtml()}</small></span></button></div>
      <p class="op-note">${ic("sel")}Asked once. Change it any time in the Offline library.</p>
      <div class="om-btns"><button type="button" class="ob" data-oa="mclose">Not now</button><button type="button" class="ob pri" data-oa="asked">Continue</button></div>`, { ls0: () => { ST.listen = false; save(); askListen(then); }, ls1: () => { ST.listen = true; save(); askListen(then); }, asked: () => { ST.asked = true; save(); done(); then && then(); emit(); } });
  }
  function menu(n) {
    const r = ST.s[n], hasA = Object.keys((r && r.a) || {}).length, m = missing(n), mis = !isComplete(n);
    mini(`<h4>${esc(surahName(n))} is ready offline</h4><p>${fmt(sizeOf(n))} on this device. ${hasA ? "Reads and plays" : "Reads"} with no internet.</p><div class="om-list">
      ${mis ? `<button type="button" class="ob wide pri" data-oa="upd" data-n="${n}">${ic("ear")}${m.voices.length && !m.text.length ? "Add listening" : "Update"} · ${fmt(costOf(n))}</button>` : ""}
      ${hasA ? `<button type="button" class="ob wide" data-oa="rml" data-n="${n}">${ic("ear")}Remove listening only · frees ${fmt(Object.values(r.a).reduce((a, x) => a + x, 0))}</button>` : ""}
      <button type="button" class="ob wide dng" data-oa="rm" data-n="${n}">${ic("trash")}Remove from this device</button><button type="button" class="ob wide" data-oa="mclose">Keep it</button></div>`);
  }
  async function startList(list, opts = {}) {
    list = list.filter(n => !isComplete(n) && !Q.list.includes(n)); if (!list.length) return;
    if (!ST.asked) return askListen(() => startList(list, opts));
    const cost = costList(list); await refreshFree();
    if (FREE != null && cost > FREE * .9) {
      const ro = ST.listen ? list.reduce((a, n) => a + (isReady(n) ? 0 : readMB(n)), 0) : 0;
      return mini(`<div class="om-h">${ic("alert", "err")}<div><h4>Not enough space</h4><p>This needs ${fmt(cost)} and about ${fmt(FREE)} is free. ${ST.listen ? "Choose Read only, or fewer surahs." : "Choose fewer surahs."}</p></div></div><div class="om-btns"><button type="button" class="ob" data-oa="mclose">Choose surahs</button>${ST.listen && ro && ro < FREE * .9 ? `<button type="button" class="ob pri" data-oa="ro">Read only · ${fmt(ro)}</button>` : ""}</div>`, { ro: () => { ST.listen = false; save(); done(); enqueue(list); } });
    }
    if (cost > 300 && !opts.sure) {
      const ro = list.reduce((a, n) => a + (isReady(n) ? 0 : readMB(n)), 0);
      return mini(`<h4>Save ${list.length} surah${list.length > 1 ? "s" : ""}?</h4><p>${ST.listen ? "Arabic, translation, page fonts and the recitation." : "Arabic, translation and page fonts."}</p>
        <div class="op-line"><span><b>Download</b></span><em>${fmt(cost)}</em></div>${FREE != null ? `<div class="op-line"><span><b>Free on this device</b></span><em>${fmt(FREE)}</em></div>` : ""}
        <p class="op-note">${ic("wifi")}This is a large download. Wi-Fi is best. It pauses if the connection drops and carries on without repeating files.</p>
        <div class="om-list"><button type="button" class="ob wide pri" data-oa="sure">${ic("cloud")}${ST.listen ? "Read and listen" : "Read only"} · ${fmt(cost)}</button>${ST.listen ? `<button type="button" class="ob wide" data-oa="ro">Read only · ${fmt(ro)}</button>` : ""}<button type="button" class="ob wide" data-oa="mclose">Not now</button></div>`,
        { sure: () => { done(); enqueue(list); SEL.clear(); emit(); }, ro: () => { ST.listen = false; save(); done(); enqueue(list); SEL.clear(); emit(); } });
    }
    enqueue(list); SEL.clear(); emit();
  }

  /* ---------- actions: one place for every click ---------- */
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-oa], [data-og]"); if (!t || !api) return;
    if (t.dataset.og) { e.preventDefault(); e.stopPropagation(); return onGlyph(+t.dataset.og); }
    const a = t.dataset.oa, n = +t.dataset.n, k = t.dataset.k, m = $("#offmini");
    if (m && m._acts && m._acts[a] && m.contains(t)) return m._acts[a]();
    switch (a) {
      case "lib": openLib(); break; case "libx": closeLib(); break; case "mclose": done(); break;
      case "ls0": case "ls1": ST.listen = a === "ls1"; save(); break;
      case "lisx": UI.lisOpen = !UI.lisOpen; break;
      case "vopen": voiceSheet(); return;
      case "vtab": VS.tab = k; VS.q = ""; $("#ovQ").value = ""; vsRender(); return;
      case "vpick": (t.dataset.t === "q" ? api.setReciter : api.setTrRec)(k); vsRender(); break;
      case "vrm": { const id = k, c = voiceCount(id); mini(`<h4>Remove ${vh(api.voiceName(id), api.voiceNative(id))}?</h4><p>Its recitation is removed from ${c} surah${c === 1 ? "" : "s"} (${fmt(voiceOnDevice(id))}). They still read offline, and you can add it again any time.</p><div class="om-btns"><button type="button" class="ob" data-oa="mclose">Keep it</button><button type="button" class="ob dng" data-oa="vrmy">Remove</button></div>`, { vrmy: () => { done(); removeVoice(id).then(() => api.toast("Removed " + api.voiceName(id))); } }); return; }
      case "lsw": { ST.listen = !ST.listen; save(); const upd = needUpdate(); if (ST.listen && upd.length) { /* the banner offers the recitation */ } break; }
      case "auto": ST.auto = !ST.auto; save(); if (ST.auto) api.toast("New surahs you read will save on Wi-Fi"); break;
      case "save": ST.asked = true; save(); startList([n]); api.closePops(); break;
      case "upd": done(); startList([n]); break; case "updall": startList(needUpdate()); break;
      case "pause": pause(); break; case "resume": resume(); break; case "cancel": cancel(); break; case "unq": dequeue(n); break;
      case "rm": done(); removeSurah(n).then(() => api.toast("Removed from this device")); break;
      case "rml": done(); removeListening(n).then(() => api.toast("Listening removed")); break;
      case "rmall": mini(`<h4>Remove everything?</h4><p>All ${nReady()} saved surahs (${fmt(onDevice())}) are removed from this device. You can save them again any time.</p><div class="om-btns"><button type="button" class="ob" data-oa="mclose">Keep them</button><button type="button" class="ob dng" data-oa="rmy">Remove all</button></div>`, { rmy: () => { done(); removeAll().then(() => api.toast("Removed from this device")); } }); break;
      case "menu": menu(n); break;
      case "tick": SEL.has(n) ? SEL.delete(n) : SEL.add(n); break; case "tq": if (Q.list[0] === n) (Q.run ? pause() : resume()); else dequeue(n); break;
      case "pick": SEL.clear(); (k === "all" ? allN().filter(x => !isComplete(x)) : allN().filter(x => !isComplete(x) && (ST.s[x] || Q.list.includes(x) || touched(x)))).forEach(x => SEL.add(x)); break;
      case "clr": SEL.clear(); break; case "lflt": UI.filter = k; break; case "lf": UI.listFilter = k; break;
      case "selmode": UI.selMode = !UI.selMode; if (!UI.selMode) SEL.clear(); break;
      case "godl": startList([...SEL]); break;
      default: return;
    }
    emit();
  });
  function onGlyph(n) {
    if (UI.selMode && !isReady(n) && !Q.list.includes(n)) { SEL.has(n) ? SEL.delete(n) : SEL.add(n); return emit(); }
    const st = state(n);
    if (st === "none") return startList([n]);
    if (st === "busy") return Q.run ? pause() : resume();
    if (st === "wait") return dequeue(n);
    menu(n);
  }
  document.addEventListener("keydown", e => {
    if (!libOpen() && !miniOpen()) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); miniOpen() ? done() : closeLib(); }
    else if (VS.open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {   // arrow keys walk the voice list (search box -> list -> back)
      const all = $$("#ovList .vo"), i = all.indexOf(document.activeElement), inQ = document.activeElement && document.activeElement.id === "ovQ";
      if (i < 0 && !inQ) return; e.preventDefault();
      const j = inQ ? (e.key === "ArrowDown" ? 0 : -1) : i + (e.key === "ArrowDown" ? 1 : -1);
      if (j < 0) return $("#ovQ").focus(); const x = all[Math.min(j, all.length - 1)]; if (x) { all.forEach(b => { b.tabIndex = -1; }); x.tabIndex = 0; x.focus(); }
    }
    else if (e.key === "Tab") { const box = miniOpen() ? $("#offmini") : lib(), f = $$("button, [href], input, [tabindex]:not([tabindex='-1'])", box).filter(x => !x.disabled && x.offsetParent !== null); if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
  }, true);

  document.addEventListener("input", e => { if (e.target.id === "ovQ" && VS.open) { VS.q = e.target.value; vsRender(); } });

  /* ---------- drawing, once per frame at most ---------- */
  let raf = 0, tmr = 0, full = false, last = 0;
  function emit(progress) {   // progress ticks are throttled and only move numbers and bars; everything else redraws at once
    if (!api) return; if (!progress) full = true;
    if (raf) return;
    if (!full && Date.now() - last < 180) { if (!tmr) tmr = setTimeout(() => { tmr = 0; emit(true); }, 180); return; }
    raf = requestAnimationFrame(() => { raf = 0; last = Date.now(); if (full) { full = false; renderBtn(); renderDock(); renderList(); renderStrip(); renderPop(); renderLib(); } else patch(); });
  }
  function patch() {
    renderBtn(); renderList(); renderDock(); renderPop();
    const bs = batchStats(), n = Q.list[0]; if (!libOpen() || !bs || bs.complete) return;
    const set = (sel, v) => { const x = $(sel); if (x && x.textContent !== v) x.textContent = v; };
    set("[data-d=lp1]", `${Q.run ? "Downloading" : "Paused"} · ${Math.round(bs.done / bs.tot * 100)}%`); set("[data-d=lp2]", libProgSub(bs)); set("[data-d=lf1]", `Saving ${bs.idx} of ${bs.n}`);
    const bar = $("[data-d=lpb]"); if (bar) bar.style.width = bs.done / bs.tot * 100 + "%";
    const old = n && $(`#olGrid [data-n="${n}"]`); if (old) { const tmp = document.createElement("div"); tmp.innerHTML = tile(n); old.replaceWith(tmp.firstChild); }
  }

  /* ---------- keep what I read ready (an option, off by default) ---------- */
  let autoT = 0;
  function onSurah(n) {
    if (!api) return;
    if (n && !(ST.seen || []).includes(n)) { ST.seen = (ST.seen || []).concat(n); save(); }
    emit(); clearTimeout(autoT);
    if (!ST.auto || !n || isComplete(n) || Q.list.includes(n) || !online()) return;
    const c = navigator.connection || {}; if (c.saveData || c.type === "cellular" || /^(slow-2g|2g|3g)$/.test(c.effectiveType || "")) return;
    autoT = setTimeout(() => { if (api.cur() === n && !isComplete(n)) enqueue([n]); }, 8000);   // reading it, not just passing through
  }

  /* ---------- start: register the service worker, then draw ---------- */
  async function attach(a) {
    if (!supported) return hide();
    api = a;
    try {
      const reg = await navigator.serviceWorker.register(new URL("sw.js", document.baseURI).href);
      await navigator.serviceWorker.ready;
      const send = () => { const w = navigator.serviceWorker.controller || reg.active; if (w) w.postMessage({ type: "precache", urls: performance.getEntriesByType("resource").map(r => r.name) }); };
      if (document.readyState === "complete") setTimeout(send, 1500); else addEventListener("load", () => setTimeout(send, 1500));
    } catch (e) { supported = false; return hide(); }
    try { PAGES = await fetch("data/pages.json").then(r => r.json()); } catch (e) {}
    const btn = $("#btnOff"); if (btn) { btn.hidden = false; btn.onclick = () => api.togglePop("offline"); }
    const strip = document.createElement("div"); strip.id = "offStrip"; strip.className = "off-strip"; const sf = $("#tab-surahs .sfield"); sf && sf.after(strip);
    document.documentElement.classList.add("off-on");
    if (ST.q && ST.q.length) { Q.list = ST.q.filter(n => !isComplete(n)); if (Q.list.length) { Q.batch = { n: Q.list.length, fin: 0, done: 0 }; Q.list.forEach(n => { Q.cost[n] = costOf(n); Q.prog[n] = 0; }); } }   // an unfinished download comes back paused
    addEventListener("online", () => { if (Q.err && Q.err.kind !== "space") resume(); emit(); }); addEventListener("offline", () => { emit(); });
    const lb = lib(); lb && lb.addEventListener("click", e => { if (e.target === lb) closeLib(); }); const mm = $("#offmini"); mm && mm.addEventListener("click", e => { if (e.target === mm) done(); });
    refreshFree(); emit();
  }
  function hide() { const b = $("#btnOff"); if (b) b.hidden = true; }

  return {
    attach, get supported() { return supported; }, renderPop: () => { refreshFree(); renderPop(); }, onSurah, rows: () => { api && emit(); }, modalOpen: () => libOpen() || miniOpen(), closeLib,
    rowHtml: n => supported ? `<button type="button" class="og" data-og="${n}" aria-label="Save for offline"></button>` : "",
    status: n => state(n)
  };
})();
