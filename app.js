/* Global Quran — surah reader. One surah scrolls inside a framed page; the ayah ribbon is its fast scroller.
   Runs full-site or embedded (?embed=1, see embed.js). */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const root = document.documentElement, app = $("#app"), scroller = $("#scroll"), inner = $("#inner");

  /* ---------- configuration: URL parameters win, then saved settings ---------- */
  const qs = new URLSearchParams(location.search);
  if (window.GQ_QS) new URLSearchParams(window.GQ_QS).forEach((v, k) => { if (!qs.has(k)) qs.append(k, v); });   // parameters handed over by a server-side wrapper (the old PHP "upload-auto" proxy)
  const EMBED = qs.get("embed") === "1";
  const mem = {};
  const store = EMBED ? { get: k => mem[k] ?? null, set: (k, v) => { mem[k] = v; } } : {
    get: k => { try { return localStorage.getItem("gq2." + k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem("gq2." + k, v); } catch (e) {} }
  };
  if (EMBED) { root.classList.add("embed"); if (qs.get("sidebar") === "1") root.classList.add("embed-side"); if (qs.get("player") === "0") root.classList.add("noplayer"); }
  const accent = qs.get("accent"); if (accent && /^#?[0-9a-f]{3,8}$/i.test(accent)) root.style.setProperty("--gold", "#" + accent.replace("#", ""));
  const pref = (k, d) => qs.get(k) ?? store.get(k) ?? d;
  /* usage statistics (analytics.js, only on globalquran.com and only with consent; elsewhere this does nothing). Never send text the person typed or what they saved. */
  const stat = (name, params) => { try { window.GQA && GQA.track(name, params); } catch (e) {} };
  const PROG = { s: 0, got: 0, at: 0 };
  function progress(s, n) {   // how far down a surah people read: 25 / 50 / 75 / 100 %, once each per visit (the highest one passed)
    if (PROG.s !== s) { PROG.s = s; PROG.got = 0; }
    if (Date.now() - PROG.at < 2000) return;   // the page is still settling after a surah opens
    const pct = Math.floor(n / meta(s).c * 100), t = [100, 75, 50, 25].find(x => pct >= x);
    if (t && t > PROG.got) { PROG.got = t; stat("read_progress", { surah: s, pct: t, view: S.view }); }
  }

  /* ---------- addresses (links) ----------
     How the reader writes the current place into the address bar: "hash" (#2:255, works on any static host, the default) or "path" (/2:255, the way
     GlobalQuran.com has always worked; needs the host to serve index.html for every path). On globalquran.com the default is "path". Anyone can change it:
     window.GQ_URLS = "path" | "hash" | "off" (before app.js), ?urls=..., or <meta name="gq-urls" content="...">. In an embed the address is never touched.
     Reading accepts every format the older versions used, whichever mode is on:
       /2:255 · /37 (a bare number is a Madani PAGE) · /quran-uthmani+en.sahih/2:255 · /en.sahih/50 · /search/word · and the same behind #  (#/2:255)
       (and ?surah=2&ayah=255). Editions in the link choose the translations; ids we don't have are ignored. */
  /* Settings written for the older Global Quran app are understood too (backward compatibility). A site that still has the old app.settings.js
     (var config = {...}; gq.setConfig(config); gq.start();) can keep it: index.html carries a tiny `gq` shim that hands the config over (GQ_LEGACY),
     and the old `gq.quran.add("id")` calls become the default translations. The old keys that matter here:
       url.enable false -> no addresses ("off") · url.html5 true -> "path", false -> "hash" · url.startWith "/sub/" -> the base folder of the links.
     (url.startWith "?page=" is read, and written as a hash link; url.by is not needed, the reader writes ayah links and reads page links too.)
     Order of priority for the link style: window.GQ_URLS / ?urls= / <meta name="gq-urls"> > the old config > the default (path on globalquran.com, else hash).
     Order for the base folder of path links: window.GQ_BASE > the old url.startWith ("/sub/") > found by itself from the page's own address (index.html). All read when used,
     so a settings file loaded after app.js still counts. */
  const legacy = () => window.GQ_LEGACY || (window.config && window.config.url ? window.config : null) || {};
  const DOCBASE = new URL(document.baseURI).pathname.replace(/[^/]*$/, "");
  const baseFolder = () => {
    const norm = b => typeof b === "string" && /^\/[^?#]*$/.test(b) && b !== "/" ? b.replace(/\/?$/, "/") : null;
    return norm(window.GQ_BASE) || norm((legacy().url || {}).startWith) || DOCBASE;
  };
  const urlMode = () => {
    const ok = m => ["path", "hash", "off"].includes(m) ? m : null, u = legacy().url;
    const explicit = ok(String(window.GQ_URLS || qs.get("urls") || (document.querySelector('meta[name="gq-urls"]') || {}).content || "").toLowerCase());
    if (explicit) return explicit;
    if (u) { if (u.enable === false) return "off"; if (typeof u.startWith === "string" && /^\?/.test(u.startWith)) return "hash"; if (typeof u.html5 === "boolean") return u.html5 ? "path" : "hash"; }
    return /^(www\.)?globalquran\.com$/i.test(location.hostname) ? "path" : "hash";
  };
  function writeAddress(s, n) {
    if (EMBED || urlMode() === "off") return;
    try {
      const sp = new URLSearchParams(location.search); ["surah", "ayah", "page"].forEach(k => sp.delete(k));   // the place now lives in the link itself; an old ?surah=&ayah= must not win on reload
      const q = sp.toString() ? "?" + sp.toString() : "";
      history.replaceState(null, "", location.origin + (urlMode() === "path" ? baseFolder() + s + ":" + n + q : (new URL(document.baseURI).origin === location.origin ? DOCBASE : location.pathname) + q + "#" + s + ":" + n));
    } catch (e) {}
  }
  /* Mushaf glyph data and page fonts are hosted on the DigitalOcean Space behind audio.globalquran.com: {ASSETS}/quran_data/qcf/<surah>.json and {ASSETS}/fonts/qcf/... (the five small fonts in app.css are local). Override with window.GQ_ASSETS. */
  const ASSETS = String(window.GQ_ASSETS || "https://audio.globalquran.com").replace(/\/$/, "");
  function parseRoute(raw) {
    const parts = String(raw || "").replace(/^\/+|\/+$/g, "").split("/").filter(Boolean); if (!parts.length) return null;
    if (parts[0] === "search") return { search: parts.slice(1).join("/"), eds: [] };
    const m = /^(\d{1,4})(?::(\d{1,4}))?$/.exec(parts[parts.length - 1]); if (!m) return null;
    const eds = parts.length > 1 ? parts[0].split("+").filter(Boolean) : [];
    return m[2] ? { s: +m[1], a: +m[2], eds } : { page: +m[1], eds };
  }
  function readAddress() {
    const dec = v => { try { return decodeURIComponent(v); } catch (e) { return v; } };
    let r = null;
    if (+qs.get("surah")) r = { s: +qs.get("surah"), a: +qs.get("ayah") || 1, eds: [] };
    if (+qs.get("page") && !r) r = { page: +qs.get("page"), eds: [] };   // old "?page=" links
    r = r || parseRoute(dec(location.pathname.slice(baseFolder().length)).replace(/^index\.html$/i, "")) || parseRoute(dec(location.hash.slice(1)));
    return r || { eds: [] };
  }
  let PAGES = null;   // first ayah of each of the 604 Madani pages: data/pages.json
  const pageStart = async p => { PAGES = PAGES || await fetch("data/pages.json").then(r => r.json()); return PAGES[clamp(p, 1, 604) - 1]; };

  /* ---------- state ---------- */
  const hadTr = qs.get("trs") ?? store.get("trs") ?? qs.get("tr") ?? store.get("tr");   // null = first visit: choose by browser language
  const trParse = v => String(v ?? "").split(",").map(x => x.trim()).filter(Boolean);
  const S = { last: ["read", "verse"].includes(pref("lastview", "verse")) ? pref("lastview", "verse") : "verse", view: ["read", "listen"].includes(pref("view", "verse")) ? pref("view", "verse") : "verse", rd: pref("rd", "ar") === "tr" ? "tr" : "ar", rdTr: pref("rdtr", ""), data: null, ar: [], trList: [], tlList: [], trCache: {}, tlCache: {}, qcf: {}, s: 1, cur: 1, sel: 0, trs: trParse(pref("trs", pref("tr", "en.hilali"))), theme: pref("theme", "day"), offs: [], count: 0 };
  let bms = []; try { bms = JSON.parse(store.get("bm") || "[]"); } catch (e) {}
  const meta = n => S.data.surahs[n - 1];
  /* plain Arabic text comes from the API (quran-uthmani), one surah at a time; if the API is unreachable the words of the glyph data stand in */
  const arText = (s, n) => (S.ar[s - 1] && S.ar[s - 1][n - 1]) || (S.qcf[s] && S.qcf[s][n - 1] ? S.qcf[s][n - 1].filter(w => !w[5]).map(w => w[1]).join(" ") : "");
  async function loadAr(s) {
    if (S.ar[s - 1]) return;
    try { const got = await GQ.text(s, ["quran-uthmani"]); if (got["quran-uthmani"]) { S.ar[s - 1] = got["quran-uthmani"]; return; } } catch (e) {}
    try { await loadQcf(s); } catch (e) {}   // offline: the glyph data carries the same words
  }

  /* ---------- theme / type settings ---------- */
  const mq = matchMedia("(prefers-color-scheme: dark)");
  function applyTheme() { const night = S.theme === "night" || (S.theme === "auto" && mq.matches); root.classList.toggle("night", night); $("#btnTheme use").setAttribute("href", "img/sprite.svg#" + (night ? "i-sun" : "i-moon")); $("#optTheme").value = S.theme; }
  mq.addEventListener && mq.addEventListener("change", applyTheme);
  const setVar = (name, px) => root.style.setProperty(name, px + "px");
  const curVar = name => parseFloat(getComputedStyle(root).getPropertyValue(name));
  if (store.get("fsAr")) setVar("--fs-ar", store.get("fsAr")); if (store.get("fsTr")) setVar("--fs-tr", store.get("fsTr"));
  const fontPref = (qs.get("font") || store.get("font") || "mushaf");   // mushaf = Quran.com page glyph font (default)
  if (fontPref === "me" || fontPref === "kfc") root.classList.add("font-" + fontPref);
  if (store.get("credit")) root.classList.add("cite-each");
  let layoutPref = pref("layout", "auto"), follow = store.get("follow") !== "0";

  /* ---------- helpers for markup ---------- */
  const BR = `<svg viewBox="0 0 15 27"><use href="img/sprite.svg#brL"/></svg><b>%</b><svg viewBox="0 0 15 27"><use href="img/sprite.svg#brR"/></svg>`;
  /* any number of translations can be shown under each ayah, in the order they were chosen */
  const readTr = () => S.view === "read" && S.rd === "tr";   // reading view shows ONE thing: Arabic, or a single translation
  const trInfos = () => readTr() ? [S.trList.find(t => t.id === S.rdTr)].filter(Boolean) : S.trs.map(id => S.trList.find(t => t.id === id)).filter(Boolean);
  const trReady = (id, s) => !!(S.trCache[id] && S.trCache[id][s - 1]);
  const trAt = (id, s, n) => (S.trCache[id] && S.trCache[id][s - 1] && S.trCache[id][s - 1][n - 1]) || "";
  const trBlocks = (s, n) => { const ts = trInfos(), multi = ts.length > 1; return ts.filter(t => trReady(t.id, s)).map(t => `<div class="tr${t.dir === "rtl" ? " rtl" : ""}" lang="${esc(t.lang)}"><span class="tt">${S.view === "read" ? `<span class="vnum">${n}</span>` : ""}${esc(trAt(t.id, s, n))}</span><cite>— ${esc(multi ? t.label : t.credit)}</cite></div>`).join(""); };
  const innerCls = () => S.view === "read" ? "inner reading" + (readTr() && (trInfos()[0] || {}).dir === "rtl" ? " rd-rtl" : "") : "inner layout-" + layoutPref;
  const trTexts = (s, n) => trInfos().filter(t => trReady(t.id, s)).map(t => trAt(t.id, s, n));
  const arabicHtml = (s, n, text) => esc(text);
  /* tajweed: the API text (quran-tajweed) is converted to "{x…}" runs (x = rule letter, may nest) and drawn as coloured spans */
  let KEYHIDE = store.get("keyhide") === "1";   // the small x on the key strip hides it; toggling tajweed off/on is the only way back
  /* tajweed colours are drawn on letter ranges; they land correctly in the mushaf colour font, Amiri Quran and KFC Naskh, but not in Me Quran
     (marks and joined letters pick up the wrong colours). On an unsupported font tajweed switches itself off and returns when the font does. */
  /* the mushaf tajweed colours live inside the colour (COLRv1) page fonts: Chrome / Edge / Firefox 117+ draw them, Safari does not (it would show plain black glyphs while saying "On") */
  const COLR = (() => { try { return CSS.supports("font-tech(color-COLRv1)"); } catch (e) { return false; } })();
  const TJ_FONTS = ["mushaf", "amiri", "kfc"], tjOk = f => f === "mushaf" ? COLR : TJ_FONTS.includes(f);
  let FONT = ["mushaf", "amiri", "kfc", "me"].includes(fontPref) ? fontPref : "mushaf";
  const TJ = { want: store.get("tajweed") !== "0", on: store.get("tajweed") !== "0" && tjOk(FONT), data: [],   // tajweed is on by default
    rules: [["n", "Natural madd · 2"], ["p", "Permissible madd · 2/4/6"], ["o", "Obligatory madd · 4–5"], ["m", "Necessary madd · 6"], ["g", "Ghunnah"], ["q", "Qalqalah"], ["f", "Ikhfa"], ["c", "Ikhfa shafawi"], ["a", "Idgham with ghunnah"], ["u", "Idgham without ghunnah"], ["w", "Idgham shafawi"], ["i", "Iqlab"], ["d", "Idgham mutajanisayn"], ["b", "Idgham mutaqaribayn"], ["h", "Hamzat wasl"], ["l", "Lam shamsiyyah"], ["s", "Silent letter"]] };
  function tajweedHtml(raw) {
    let out = "", depth = 0;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === "{") { out += `<span class="tj-${raw[i + 1]}">`; i++; depth++; }
      else if (ch === "}") { if (depth) { out += "</span>"; depth--; } }
      else out += ch === "<" ? "&lt;" : ch === "&" ? "&amp;" : ch;
    }
    return out + "</span>".repeat(depth);
  }
  /* transliteration: Arabic written in Latin letters, joined from the per-word transliteration in data/qcf (English for now) */
  /* word by word (meaning on hover / tap) is off by default; switched on in the sidebar Settings */
  const WBW = { on: store.get("wbw") === "1" };
  function syncWbw() { root.classList.toggle("wbw-on", WBW.on); $("#optWbw").checked = WBW.on; if (!WBW.on) hideWordTip(); }
  const TL = { on: store.get("tlit") !== "0", id: store.get("tlid") || "" };   // on by default so people discover it; easy to switch off
  const tlText = (s, n) => {
    const a = S.tlCache[TL.id]; if (a && a[s - 1] && a[s - 1][n - 1] != null) return a[s - 1][n - 1];
    return /^en\./.test(TL.id) && S.qcf[s] ? S.qcf[s][n - 1].filter(w => !w[5]).map(w => w[3] || "").join(" ") : "";   // English fallback from the glyph data
  };
  async function loadTl(s = S.s) {
    if (!TL.id || (S.tlCache[TL.id] && S.tlCache[TL.id][s - 1])) return;
    try { const got = await GQ.text(s, [TL.id]); if (got[TL.id]) (S.tlCache[TL.id] = S.tlCache[TL.id] || [])[s - 1] = got[TL.id]; } catch (e) {}
  }
  function fillTlit() {
    root.classList.toggle("tl-on", TL.on);
    $("#optTlit").checked = TL.on; const ts = $("#selTlit"); ts.value = TL.on ? TL.id : ""; ts.classList.toggle("on", TL.on);
    if (!S.data) return;
    $$(".ayah", inner).forEach(el => { $(".tlit", el).textContent = TL.on ? tlText(S.s, +el.dataset.n) : ""; });
  }
  async function setTlit(on) { stat("setting_change", { setting: "transliteration", value: on ? TL.id : "off" }); TL.on = on; store.set("tlit", on ? "1" : "0"); if (on) await loadTl(S.s); fillTlit(); requestAnimationFrame(recalc); refreshSaved(); }
  function buildTlitSelect() {
    const sel = $("#selTlit");
    sel.innerHTML = `<option value="">Off</option>` + S.tlList.map(x => `<option value="${esc(x.id)}">${esc(langNames(x.lang).nat)}</option>`).join(""); sel.value = TL.on ? TL.id : "";
  }
  $("#selTlit").onchange = async e => { const v = e.target.value; if (!v) return setTlit(false); TL.id = v; store.set("tlid", v); await setTlit(true); fillTlit(); };
  const numHtml = n => `<span class="num" data-n="${n}">${BR.replace("%", n)}</span>`;
  const arHtml = (s, n, text) => (TJ.on && TJ.data[s - 1] && TJ.data[s - 1][n - 1]) ? tajweedHtml(TJ.data[s - 1][n - 1]) : arabicHtml(s, n, text);

  /* mushaf glyph font (Quran.com's QCF), the default. One glyph per word from that word's page font, real words kept underneath,
     so it wraps like text, copies/reads as real Arabic (hidden .sr text + copy handler) and keeps word-by-word.
     data/qcf/<surah>.json: [ayah][word] = [glyph, uthmani, translation, transliteration, page, isEnd] (built once from the Quran.com API; the script is in git history, see rules/data-and-assets.md) */
  const QC = { on: fontPref === "mushaf", pages: new Set() };
  const qcfOn = s => QC.on && !!S.qcf[s];
  const pad3 = n => String(n).padStart(3, "0");
  const gSpan = (w) => `<span class="g p${w[4]}" aria-hidden="true">${w[0]}</span>`;
  const qcfWords = (s, n, from = 0, to = Infinity) => S.qcf[s][n - 1].map((w, i) => i < from || i >= to ? "" : w[5]
    ? `<span class="qe">${gSpan(w)}</span>`
    : `<span class="w q" data-k="${s}:${n}:${i}" data-q="1">${gSpan(w)}<span class="sr">${esc(w[1])}</span></span>`).filter(Boolean).join(" ");
  const tmpHtml = (s, n, text) => esc(text) + " " + numHtml(n);   // readable stand-in while a page font is still loading
  const arLine = (s, n, text) => qcfOn(s) ? tmpHtml(s, n, text) : arHtml(s, n, text) + " " + numHtml(n);   // mushaf ayahs start as plain text; realize() swaps in the glyphs
  const qw = (s, n, i) => { const w = S.qcf[s][n - 1][i]; return { ar: w[1], tr: w[2], tl: w[3] }; };
  // the bismillah above a surah is the first four words of 1:1, set in the same font (and tajweed) as the text
  const bismHtml = () => qcfOn(1) && QC.on ? qcfWords(1, 1, 0, 4) : (TJ.on && TJ.data[0] && TJ.data[0][0]) ? tajweedHtml(TJ.data[0][0].split(" ").slice(0, 4).join(" ")) : esc(S.data.bismillah);
  async function loadQcf(s) {
    if (S.qcf[s]) return;
    try { S.qcf[s] = await (await fetch(`${ASSETS}/quran_data/qcf/${s}.json`)).json(); } catch (e) { toast("Couldn't load the mushaf font data"); }
  }
  /* page fonts are registered on demand, a few pages at a time (see "lazy glyphs" below) */
  const qStyle = document.head.appendChild(document.createElement("style"));
  function useFonts(pages) {
    let css = ""; for (const p of pages) { if (QC.pages.has(p)) continue; QC.pages.add(p);
      css += `@font-face{font-family:QCF2P${p};src:url(${ASSETS}/fonts/qcf/v2-p${p}.woff2) format("woff2");font-display:block}` +
             `@font-face{font-family:QCF4P${p};src:url(${ASSETS}/fonts/qcf/v4-p${p}.woff2) format("woff2") tech(color-COLRv1);font-display:block}` +
             `.qcf .g.p${p}{font-family:QCF2P${p}}html.tj-on .qcf .g.p${p}{font-family:QCF4P${p},QCF2P${p}}`; }
    if (css) qStyle.appendChild(document.createTextNode(css));
  }
  const FR = new Map();   // one load per page font per mode
  function fontReady(p) {
    const key = (TJ.on ? 4 : 2) + ":" + p;
    if (!FR.has(key)) FR.set(key, (async () => {
      const r = await document.fonts.load("32px " + (TJ.on ? "QCF4P" : "QCF2P") + p).catch(() => []);
      if (!r.length && TJ.on) await document.fonts.load("32px QCF2P" + p).catch(() => {});   // no COLRv1 (Safari): mono font
    })());
    return FR.get(key);
  }
  async function ensureTexts(s) {
    await Promise.all([loadAr(s), loadTrs(readTr() ? [S.rdTr] : S.trs, s), TL.on ? loadTl(s) : 0, (!QC.on && TJ.on) ? loadTajweedFor(s) : 0]);
  }
  async function prepare(s) {
    await Promise.all([ensureTexts(s), QC.on ? Promise.all([loadQcf(s), loadQcf(1)]) : 0]);
    if (QC.on) { useFonts([1]); await fontReady(1); }
  }
  function refreshArabic() {
    if (!S.data) return;
    const q = qcfOn(S.s);
    $$(".ayah", inner).forEach(el => {
      const n = +el.dataset.n, ar = $(".ar", el);
      if (q) { if (ar.dataset.m !== "q") { ar.className = "ar tmp"; ar.dataset.m = "q"; ar.dataset.r = ""; ar.innerHTML = tmpHtml(S.s, n, arText(S.s, n)); } }
      else { ar.className = "ar"; ar.dataset.m = "t"; ar.dataset.r = ""; ar.innerHTML = arLine(S.s, n, arText(S.s, n)); }
    });
    const b = $(".bism", inner); if (b) { b.classList.toggle("qcf", qcfOn(1)); b.innerHTML = bismHtml(); }
    if (q) realizeWindow();
    fillTlit(); requestAnimationFrame(recalc); refreshSaved();
  }

  /* ---------- lazy glyphs: only the pages near the reader are fetched ----------
     Every ayah is on screen at once as plain readable text (instant, no network). Ayahs near the viewport are then upgraded to the
     mushaf glyphs as their page fonts arrive, nearest first, with extra reach in the direction the reader is travelling. Fast jumps
     (ribbon drags) never show blank space, and fonts are only requested once movement settles. The reader's position is held steady
     while an upgrade changes heights. */
  const LZ = { dir: 1, last: 0, t: 0, busy: false, again: false, q: new Set(), flushT: 0 };
  const firstVisible = () => { const els = $$(".ayah", inner), y = scroller.scrollTop + 1; let lo = 0, hi = els.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (els[mid].offsetTop <= y) lo = mid; else hi = mid - 1; } return els[lo]; };
  function range(ahead, behind) {   // ayah indices whose offsets fall in [top - behind, bottom + ahead] viewports, "ahead" being the travel direction
    const o = S.offs, vh = scroller.clientHeight, top = scroller.scrollTop, d = LZ.dir;
    const a = top - vh * (d > 0 ? behind : ahead), b = top + vh * (1 + (d > 0 ? ahead : behind));
    let lo = 0, hi = 0; for (let i = 0; i < o.length; i++) { if (o[i] <= a) lo = i; if (o[i] <= b) hi = i; }
    return [lo, hi];
  }
  function flushUpgrades() {   // swap in glyphs for every ayah whose fonts are ready, in one layout pass
    LZ.flushT = 0; if (!LZ.q.size || !qcfOn(S.s)) { LZ.q.clear(); return; }
    const s = S.s, els = $$(".ayah", inner), anchor = firstVisible(), rel = anchor ? anchor.offsetTop - scroller.scrollTop : 0;
    LZ.q.forEach(i => { const ar = els[i] && $(".ar", els[i]); if (!ar || ar.dataset.r === "1") return; ar.innerHTML = qcfWords(s, i + 1); ar.className = "ar qcf"; ar.dataset.r = "1"; });
    LZ.q.clear();
    if (anchor) scroller.scrollTop = anchor.offsetTop - rel;
    LZ.last = scroller.scrollTop; recalc(); paintReading();   // replaced glyph text invalidates the highlight range
  }
  async function realize(lo, hi) {
    if (!qcfOn(S.s) || readTr()) return;   // translation-only reading hides the Arabic: nothing to upgrade
    const s = S.s, tok = openTok, els = $$(".ayah", inner), todo = [], y = scroller.scrollTop + scroller.clientHeight / 2;
    for (let i = lo; i <= hi && i < els.length; i++) if ($(".ar", els[i]).dataset.r !== "1") todo.push(i);
    if (!todo.length) return;
    todo.sort((a, b) => Math.abs(els[a].offsetTop - y) - Math.abs(els[b].offsetTop - y));   // nearest first
    const pagesOf = i => [...new Set(S.qcf[s][i].map(w => w[4]))];
    useFonts(todo.flatMap(pagesOf));
    await Promise.all(todo.map(async i => {
      await Promise.all(pagesOf(i).map(fontReady));
      if (tok !== openTok || s !== S.s || !qcfOn(s)) return;
      LZ.q.add(i); if (!LZ.flushT) LZ.flushT = setTimeout(flushUpgrades, 30);
    }));
  }
  async function realizeWindow() {
    if (!qcfOn(S.s)) return;
    if (drag || sm.raf) { setTimeout(scheduleRealize, 200); return; }   // still moving: look again shortly, never depend on a "finished" callback
    if (LZ.busy) { LZ.again = true; return; }
    LZ.busy = true;
    try {
      await realize(...range(.6, .6));    // what is on screen, plus a little
      await realize(...range(2.5, 1));    // then reach ahead in the travel direction, less behind
      settleJump();
    } finally { LZ.busy = false; if (LZ.again) { LZ.again = false; scheduleRealize(); } }
  }
  function scheduleRealize() { if (!qcfOn(S.s) || LZ.t) return; LZ.t = setTimeout(() => { LZ.t = 0; realizeWindow(); }, 70); }
  function settleJump() {   // after a jump to ayah N, glyph sizes replaced estimates: land exactly on N
    if (!S.jump) return; const n = S.jump; S.jump = 0; const y = ayahTop(n);
    if (Math.abs(scroller.scrollTop - y) > 3) { scroller.scrollTop = y; LZ.last = y; scheduleRealize(); }
  }
  /* surah names: always the calligraphic Surah Names font (ligature "001".."114"), whatever Arabic font is chosen */
  function fitName() {
    const el = $("#cartName"), cart = $("#cart"), btn = $("#cartBtn"); if (!el || !cart.clientWidth) return;
    el.style.fontSize = "100px"; const r = el.getBoundingClientRect(); if (!r.width) return;
    el.style.fontSize = Math.min(100 * btn.clientWidth * .9 / r.width, 100 * cart.clientHeight * .74 / r.height, 70) + "px";
  }
  const ayahHtml = (s, n, text) => `<div class="ayah" id="a${n}" data-n="${n}" role="group" aria-label="Verse ${n}"><div class="ar${qcfOn(s) ? " tmp" : ""}" lang="ar" data-m="${qcfOn(s) ? "q" : "t"}">${arLine(s, n, text)}</div><div class="tlit"></div><div class="trs"></div>
      <div class="actions"><button data-act="play"><svg><use href="img/sprite.svg#i-play"/></svg>Play from here</button><button data-act="mark" aria-pressed="false"><svg><use href="img/sprite.svg#i-star"/></svg>Save</button><button data-act="copy"><svg><use href="img/sprite.svg#i-copy"/></svg>Copy</button><button data-act="share"><svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3"/></svg>Share</button></div></div>`;

  /* ---------- render a surah ---------- */
  function renderSurah(n) {
    const m = meta(n), ay = Array.from({ length: m.c }, (_, i) => arText(n, i + 1));
    S.s = n; S.count = m.c; S.sel = 0;
    const bism = (n !== 1 && n !== 9) ? `<div class="bism${qcfOn(1) ? " qcf" : ""}" lang="ar">${bismHtml()}</div>` : "";
    inner.innerHTML = `<div class="surah-head"><div class="s-cal" aria-hidden="true"><i></i><span class="sn">${pad3(n)}</span><i></i></div>
      <p class="s-info"><b>${esc(m.en)}</b> · ${esc(m.me)} · ${m.t === "M" ? "Meccan" : "Medinan"} · ${m.c} verses · Juz ${m.j}</p></div>${bism}`
      + ay.map((t, i) => ayahHtml(n, i + 1, t)).join(S.view === "read" ? " " : "")
      + `<div class="end">${n < 114 ? `<button data-act="nextSurah">Next: ${esc(meta(n + 1).en)} ›</button>` : "End of the Qur'an"}</div>`;
    inner.className = innerCls();
    fillTranslations(); fillTlit(); markBookmarks();
    $("#cartName").textContent = pad3(n); $("#cartName").setAttribute("aria-label", `Surah ${n}, ${m.en}`); $("#cartBtn").setAttribute("aria-label", `Surah ${n}, ${m.en}. Choose another surah`);
    announce(`${m.en}, surah ${n}, ${m.c} verses`);
    $("#btnPrevS").disabled = n <= 1; $("#btnNextS").disabled = n >= 114;
    $$("#surahList button, #pickList button").forEach(b => { b.classList.toggle("cur", +b.dataset.s === n); +b.dataset.s === n ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current"); });
    setTitle();
    buildRibbon(); recalc(); fitName(); if (typeof markPlaying === "function") markPlaying(); paintReading();
  }
  const keyBtn = $("#btnKey"), keyBox = $("#tjKey");
  function showKey(v) { if (v) closePops(); keyBox.hidden = !v; keyBtn.setAttribute("aria-expanded", !!v); }
  keyBtn.onclick = () => showKey(keyBox.hidden); $("#btnKeyHide").onclick = () => { KEYHIDE = true; store.set("keyhide", "1"); syncTajweedUi(); }; $("#btnKeyX").onclick = () => showKey(false);
  function syncTajweedUi() { const showStrip = TJ.on && !KEYHIDE; keyBtn.hidden = !showStrip; $("#btnKeyHide").hidden = !showStrip; if (!showStrip) showKey(false); if (typeof syncFoot === "function") syncFoot(); root.classList.toggle("tj-on", TJ.on); $("#optTajweed").checked = TJ.on; $("#btnTajweed").setAttribute("aria-pressed", TJ.on); $("#btnTajweed").textContent = !tjOk(FONT) ? "N/A" : TJ.on ? "On" : "Off";
    const ok = tjOk(FONT); [$("#btnTajweed"), $("#optTajweed")].forEach(x => { x.disabled = !ok; x.title = ok ? "" : "Tajweed colours aren't available with this font"; }); $("#optTajweed").checked = TJ.on; }
  /* API markup "[h:1[ٱ]" -> our "{hٱ}" runs (nested runs fine; stray brackets in the source text are dropped) */
  const convertTj = t => String(t).replace(/\[([a-z])(?::\d+)?\[/g, "{$1").replace(/\]/g, "}").replace(/\[/g, "");
  async function loadTajweed(s = S.s) {
    if (TJ.data[s - 1]) return;
    try { const got = await GQ.text(s, ["quran-tajweed"]); if (got["quran-tajweed"]) TJ.data[s - 1] = got["quran-tajweed"].map(convertTj); } catch (e) { toast("Couldn't load tajweed. Check your connection."); }
  }
  const loadTajweedFor = s => Promise.all([loadTajweed(s), loadTajweed(1)]);
  async function setTajweed(on) {
    if (!tjOk(FONT)) { syncTajweedUi(); return toast(FONT === "mushaf" ? "This browser can't show the mushaf tajweed colours. Choose Amiri Quran or KFC Naskh for them." : "Tajweed colours aren't available with this font"); }
    stat("setting_change", { setting: "tajweed", value: on ? "on" : "off" }); TJ.want = on; TJ.on = on; store.set("tajweed", on ? "1" : "0"); KEYHIDE = false; store.set("keyhide", "");   // any tajweed toggle brings the key back
    syncTajweedUi();
    if (on && !QC.on) await loadTajweedFor(S.s);
    if (QC.on && S.qcf[S.s]) { const [lo, hi] = range(1, 1), pages = new Set(); for (let i = lo; i <= hi; i++) (S.qcf[S.s][i] || []).forEach(w => pages.add(w[4])); useFonts(pages); await Promise.all([...pages].map(fontReady)); }   // colour fonts first, so nothing blinks out
    syncTajweedUi();
    refreshArabic();
  }
  function fillTranslations() {
    const ts = trInfos();
    root.classList.toggle("no-tr", !ts.length); root.classList.toggle("multi-tr", ts.length > 1);
    $$(".ayah", inner).forEach(el => { $(".trs", el).innerHTML = trBlocks(S.s, +el.dataset.n); });   // whichever chosen translations are available
    recalc();
    refreshSaved();
  }

  /* ---------- scroll geometry + "current ayah" ---------- */
  let lastBottom = 0;
  function recalc() {
    S.offs = $$(".ayah", inner).map(el => el.offsetTop);
    buildRibbonMarks(); onScroll(); paintReading();
  }
  const ayahTop = n => Math.max(0, (S.offs[n - 1] ?? 0) - 6);
  let scrollRaf = 0;
  function onScroll() { if (!scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updateCurrent(); }); }
  function updateCurrent() {
    if (!scroller.clientHeight) return;   // surah text is hidden (saved view): keep the reading position
    const y = scroller.scrollTop + Math.min(120, scroller.clientHeight * .2), o = S.offs; let lo = 0, hi = o.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (o[mid] <= y) lo = mid; else hi = mid - 1; }
    const n = o.length ? lo + 1 : 1;
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4 && o.length) { setCur(S.count); return; }
    setCur(n);
  }
  function setTitle() {   // "2:255 Al-Baqarah · Global Quran": follows the reading place, or the ayah being played
    if (S.mode === "saved") return;
    const s = A.on ? A.s : S.s, n = A.on ? (A.n || 1) : (S.cur || 1), m = meta(s); if (!m) return;
    document.title = `${s}:${n} ${m.en} · Global Quran`;
  }
  function setCur(n) {
    if (n === S.cur && S.curS === S.s) { moveHandle(); return; }
    S.cur = n; S.curS = S.s; progress(S.s, n); setTitle();
    $$(".ayah.cur").forEach(e => e.classList.remove("cur")); const el = $("#a" + n, inner); if (el) el.classList.add("cur");
    const m = meta(S.s);
    moveHandle(); if (typeof idleLabel === "function") idleLabel(); if (lsVis() && !A.on && Date.now() - LS.openAt > 1500) lsIdle(n);
    writeAddress(S.s, n);
    store.set("pos", S.s + ":" + n);
    if (EMBED) parent.postMessage({ source: "globalquran", type: "ayah", surah: S.s, ayah: n }, "*");
  }
  scroller.addEventListener("scroll", () => { onScroll(); const t = scroller.scrollTop; if (Math.abs(t - LZ.last) > 2) { LZ.dir = t > LZ.last ? 1 : -1; LZ.last = t; } scheduleRealize(); }, { passive: true });

  /* ---------- smooth scrolling (speed follows how far / how fast the target moves) ---------- */
  const sm = { target: 0, raf: 0, boost: 0 };
  const calm = matchMedia("(prefers-reduced-motion: reduce)");   // people who ask for less motion get instant jumps
  function smoothTo(y, boost = 0) {
    if (calm.matches) { stopSmooth(); scroller.scrollTop = clamp(y, 0, scroller.scrollHeight - scroller.clientHeight); scheduleRealize(); return; }
    sm.target = clamp(y, 0, scroller.scrollHeight - scroller.clientHeight); sm.boost = boost;
    if (!sm.raf) sm.raf = requestAnimationFrame(smTick);
  }
  function smTick() {
    const d = sm.target - scroller.scrollTop;
    if (Math.abs(d) < 1.5) { scroller.scrollTop = sm.target; sm.raf = 0; scheduleRealize(); return; }
    const k = clamp(.1 + Math.abs(d) / 2400 + sm.boost, .1, .55);   // far targets (fast drags) move faster; near ones ease out
    const before = scroller.scrollTop; scroller.scrollTop += d * k;
    if (scroller.scrollTop === before) { scroller.scrollTop = sm.target; sm.raf = 0; scheduleRealize(); return; }   // sub-pixel steps round to nothing: finish instead of looping forever
    sm.raf = requestAnimationFrame(smTick);
  }
  const stopSmooth = () => { sm.raf && cancelAnimationFrame(sm.raf); sm.raf = 0; S.jump = 0; };
  const smoothToAyah = (n, boost = 0) => { S.jump = n; smoothTo(ayahTop(n), boost); };
  ["wheel", "touchstart", "keydown"].forEach(ev => scroller.addEventListener(ev, stopSmooth, { passive: true }));
  function jumpAyah(n, { smooth = true, flash = true } = {}) {
    n = clamp(Math.round(n), 1, S.count);
    smooth ? smoothToAyah(n) : (stopSmooth(), scroller.scrollTop = ayahTop(n), S.jump = n, LZ.last = scroller.scrollTop, scheduleRealize());
    if (flash) { const el = $("#a" + n, inner); if (el) { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); } }
  }

  /* ---------- ayah ribbon ---------- */
  const track = $("#rbTrack"), rbMarks = $("#rbMarks"), handle = $("#rbHandle"), tip = $("#rbTip");
  function buildRibbon() { track.setAttribute("aria-valuemax", S.count); }
  const RB_PAD = 13;   // numbers and the handle stay fully inside the lighter track
  const rbTop = f => `calc(${RB_PAD}px + (100% - ${2 * RB_PAD}px) * ${f})`;
  function buildRibbonMarks() {
    const H = track.clientHeight - 2 * RB_PAD, N = S.count; if (H <= 0 || !N) return;
    const per = N > 1 ? H / (N - 1) : H, steps = [1, 2, 5, 10, 20, 25, 50, 100];
    const step = steps.find(s => s * per >= 17) || 100;
    const f = n => N > 1 ? (n - 1) / (N - 1) : .5;
    let html = "";
    const minor = step === 1 ? 0 : step >= 10 ? step / 5 : 1;
    if (minor && per * minor >= 3) for (let n = 1; n <= N; n++) if (n % step !== 0 && n % minor === 0) html += `<i style="top:${rbTop(f(n))}"></i>`;
    const labels = new Set([1]); for (let n = step; n <= N; n += step) labels.add(n);
    if (N - [...labels].pop() >= step * .6 || N === 1) labels.add(N);
    labels.forEach(n => { html += `<span style="top:${rbTop(f(n))}">${n}</span>`; });
    rbMarks.innerHTML = html; moveHandle();
  }
  function moveHandle() {
    const N = S.count || 1, frac = N > 1 ? (S.cur - 1) / (N - 1) : 0;
    handle.style.top = (RB_PAD + frac * (track.clientHeight - 2 * RB_PAD)) + "px"; $("#rbNow").textContent = S.cur;
    track.setAttribute("aria-valuenow", S.cur);
  }
  let drag = false;
  const ayahAt = e => { const r = track.getBoundingClientRect(), f = clamp((e.clientY - r.top - RB_PAD) / (r.height - 2 * RB_PAD), 0, 1); return { n: Math.round(f * (S.count - 1)) + 1, y: clamp(e.clientY - r.top, RB_PAD, r.height - RB_PAD), f }; };
  function showTip(e) { const p = ayahAt(e), rb = $("#ribbon").getBoundingClientRect(), tr = track.getBoundingClientRect(); tip.hidden = false; tip.textContent = `Ayah ${p.n}`; tip.style.top = (tr.top - rb.top + p.y) + "px"; }
  track.addEventListener("pointerdown", e => { drag = true; track.setPointerCapture(e.pointerId); track.classList.add("drag"); stopSmooth(); const p = ayahAt(e); smoothToAyah(p.n, .18); showTip(e); e.preventDefault(); });
  track.addEventListener("pointermove", e => { if (drag) { const p = ayahAt(e); smoothToAyah(p.n, .22); } if (drag || e.pointerType === "mouse") showTip(e); });
  const endDrag = e => { if (!drag) return; drag = false; track.classList.remove("drag"); const p = ayahAt(e); smoothToAyah(p.n, .1); scheduleRealize(); const el = $("#a" + p.n, inner); if (el) { el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); } setTimeout(() => { if (!drag) tip.hidden = true; }, 500); };
  track.addEventListener("pointerup", endDrag); track.addEventListener("pointercancel", endDrag);
  track.addEventListener("pointerleave", () => { if (!drag) tip.hidden = true; });
  track.addEventListener("keydown", e => {
    const d = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }[e.key];
    if (d) { e.preventDefault(); jumpAyah(S.cur + d); } else if (e.key === "Home") { e.preventDefault(); jumpAyah(1); } else if (e.key === "End") { e.preventDefault(); jumpAyah(S.count); }
  });
  /* a new width (rotating a phone, opening the sidebar, resizing the window) reflows the text: keep the reader on the ayah it was at, not on a pixel offset */
  let lastW = 0;
  new ResizeObserver(() => {
    if (!S.data) return; const w = scroller.clientWidth, cur = S.curS === S.s ? S.cur : 0; recalc(); fitName();
    if (lastW && w !== lastW && cur > 0 && !S.jump && !sm.raf && S.mode !== "saved") { scroller.scrollTop = ayahTop(cur); LZ.last = scroller.scrollTop; scheduleRealize(); }
    lastW = w;
  }).observe(scroller);
  new ResizeObserver(() => fitName()).observe($("#cart"));
  if (document.fonts) document.fonts.addEventListener("loadingdone", () => { if (S.data) { recalc(); fitName(); } });

  /* ---------- opening a surah / ayah ---------- */
  let openTok = 0;
  async function openSurah(n, ayah = 1, opts = {}) {
    n = clamp(n, 1, 114); if (S.mode === "saved") exitSaved(); if (!opts.keepAudio) stopAudio(); const tok = ++openTok;
    const before = $(".ayah", inner) ? [S.s, S.cur || 1] : null;
    if (!downKind) { S.retry = () => openSurah(n, ayah, opts); S.undo = before && before[0] !== n ? () => openSurah(before[0], before[1], { flash: false }) : null; }
    await prepare(n); if (tok !== openTok) return;
    if (!downKind) S.retry = S.undo = null;
    renderSurah(n); closeMenu(); lsAfterOpen(ayah); PROG.s = n; PROG.got = 0; PROG.at = Date.now(); if (["sidebar", "picker", "arrows", "end_button", "keyboard"].includes(opts.via) && modesOn()) putAwayModes(); stat("surah_open", { surah: n, via: opts.via || "load", view: S.view });
    S.cur = 0; S.curS = 0;
    requestAnimationFrame(() => { recalc();
      ayah > 1 ? jumpAyah(ayah, { smooth: false, flash: opts.flash !== false }) : (scroller.scrollTop = 0); LZ.last = scroller.scrollTop; LZ.dir = 1; updateCurrent(); realizeWindow(); });
    const cur = $("#surahList button.cur"); if (cur && !opts.noList) cur.scrollIntoView({ block: "nearest" });
  }
  $("#btnPrevS").onclick = () => openSurah(S.s - 1, 1, { via: "arrows" }); $("#btnNextS").onclick = () => openSurah(S.s + 1, 1, { via: "arrows" });
  inner.addEventListener("click", e => {
    const act = e.target.closest("[data-act]");
    if (act) return doAction(act.dataset.act, act.closest(".ayah"));
    const w = e.target.closest(".w"); if (w && WBW.on) { showWordTip(w); return; }
    hideWordTip();
    const nb = e.target.closest(".num, .qe, .vnum"), ay = e.target.closest(".ayah");
    if (!(nb && ay) && !e.target.closest("#vpop")) closeVpop();
    if (nb && ay) {
      const n = +ay.dataset.n;
      if (S.view === "read") { selectAyah(n, true); openVpop(nb, ay); return; }   // reading view: the number opens a little menu (play, save, copy, share)
      if (S.sel !== n) selectAyah(n, true); if (A.on && !A.paused) playAyah(n, S.s); return;   // only while it is actually playing: selecting never starts audio
    }
    if (ay) selectAyah(+ay.dataset.n, S.view === "verse");   // verse by verse: the chosen verse stays chosen, with its buttons showing
  });
  /* the small menu on a verse number in the reading view */
  const vpop = document.createElement("div"); vpop.id = "vpop"; vpop.hidden = true; vpop.setAttribute("role", "menu"); document.body.appendChild(vpop);
  const closeVpop = () => { vpop.hidden = true; };
  function openVpop(anchor, ay) {
    const n = +ay.dataset.n, key = S.s + ":" + n, saved = bms.includes(key), ic = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    vpop.innerHTML = `<div class="vp-h">${esc(meta(S.s).en)} ${key}</div><div class="vp-b">
      <button type="button" role="menuitem" data-act="play">${ic('<path d="M7 5l12 7-12 7z"/>')}Play</button>
      <button type="button" role="menuitem" data-act="mark">${ic('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>')}${saved ? "Saved" : "Save"}</button>
      <button type="button" role="menuitem" data-act="copy">${ic('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>')}Copy</button>
      <button type="button" role="menuitem" data-act="share">${ic('<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3"/>')}Share</button></div>`;
    vpop.hidden = false; vpop._ay = ay;
    const r = anchor.getBoundingClientRect(), W = vpop.offsetWidth, H = vpop.offsetHeight;
    vpop.style.left = clamp(r.left + r.width / 2 - W / 2, 8, innerWidth - W - 8) + "px";
    vpop.style.top = (r.bottom + H + 12 > innerHeight ? Math.max(8, r.top - H - 8) : r.bottom + 8) + "px";
    const f = $("button", vpop); f && f.focus({ preventScroll: true });
  }
  vpop.addEventListener("click", e => { const b = e.target.closest("[data-act]"); if (!b || !vpop._ay) return; const ay = vpop._ay; closeVpop(); doAction(b.dataset.act, ay); });
  function selectAyah(n, keep) {
    const was = S.sel === n && !keep; $$(".ayah.sel").forEach(e => e.classList.remove("sel")); S.sel = was ? 0 : n;
    if (!was) { const el = $("#a" + n, inner); el.classList.add("sel"); $("[data-act=mark]", el).setAttribute("aria-pressed", bms.includes(S.s + ":" + n)); }
    paintReading(); idleLabel();
  }
  /* reading view: ONE solid highlight that follows what will play / is playing (the clicked ayah, then the playing ayah).
     It is drawn as bands behind the text: one band per line, stretched to the line pitch so neighbouring bands touch but never overlap,
     and the band follows the ayah's own words (starts/ends mid-line). Not a background on the glyph spans: their boxes are taller than the
     lines and different per word, which looked like word-by-word boxes and overlapped other ayahs. Repainted from recalc(). */
  function paintReading() {
    const old = $(".hl-layer", inner); if (old) old.remove();
    if (S.view !== "read" || S.mode === "saved" || typeof A === "undefined") return;
    let n = -1, kind = "";
    if (A.on && !A.q && A.s === S.s) { n = A.n; kind = "play"; } else if (S.sel) { n = S.sel; kind = "sel"; } else return;
    const el = n === 0 ? $(".bism", inner) : $("#a" + n, inner), t = n === 0 ? el : el && (readTr() ? $(".trs", el) : $(".ar", el)); if (!t) return;
    const range = document.createRange(); range.selectNodeContents(t);
    const ib = inner.getBoundingClientRect(), rects = [...range.getClientRects()].filter(q => q.width > 1 && q.height > 1); if (!rects.length) return;
    const cs = getComputedStyle(t), lhx = parseFloat(cs.lineHeight), lh = lhx > 0 ? lhx : parseFloat(cs.fontSize) * 2, lines = [];
    rects.forEach(q => {
      const mid = (q.top + q.bottom) / 2, l = lines.find(x => Math.abs(x.c - mid) < lh * .45);
      if (l) { l.l = Math.min(l.l, q.left); l.r = Math.max(l.r, q.right); l.m.push(mid); l.c = l.m.reduce((s, v) => s + v, 0) / l.m.length; }
      else lines.push({ c: mid, m: [mid], l: q.left, r: q.right });
    });
    lines.sort((x, y) => x.c - y.c);
    const layer = document.createElement("div"); layer.className = "hl-layer " + kind; layer.setAttribute("aria-hidden", "true");
    lines.forEach((l, i) => {
      const top = i ? (lines[i - 1].c + l.c) / 2 : l.c - lh / 2, bot = i < lines.length - 1 ? (l.c + lines[i + 1].c) / 2 : l.c + lh / 2, band = document.createElement("div");
      band.className = "hl-band"; band.style.cssText = `left:${l.l - ib.left}px;top:${top - ib.top}px;width:${l.r - l.l}px;height:${bot - top}px`; layer.appendChild(band);
    });
    inner.prepend(layer);
  }
  function doAction(act, el) {
    if (act === "nextSurah") return openSurah(S.s + 1, 1, { via: "end_button" });
    const n = +el.dataset.n, key = S.s + ":" + n; if (act !== "mark") stat("ayah_action", { action: act, surah: S.s, ayah: n, ref: key });   // which verses are played / copied / saved (no one's list, no identity)
    if (act === "play") { playAyah(n); selectAyah(n, S.view === "verse"); }
    if (act === "mark") { const i = bms.indexOf(key); i < 0 ? bms.push(key) : bms.splice(i, 1); stat("ayah_action", { action: i < 0 ? "save" : "unsave", surah: S.s, ayah: n, ref: key }); store.set("bm", JSON.stringify(bms)); $("[data-act=mark]", el).setAttribute("aria-pressed", i < 0); drawMarks(); syncSavedUi(); toast(i < 0 ? "Saved" : "Removed"); }
    if (act === "share") return shareAyah(S.s, n);
    if (act === "copy") {
      const t = [arText(S.s, n), ...(TL.on ? [tlText(S.s, n)] : []), ...trTexts(S.s, n), `— ${meta(S.s).en} ${key}`].join("\n");
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast("Copied"), () => toast("Couldn't copy"));
    }
  }
  /* ---------- share a verse: the phone's own share sheet where there is one, else a small menu ---------- */
  const verseLink = (s, n) => location.origin + (urlMode() === "path" ? baseFolder() + s + ":" + n : (new URL(document.baseURI).origin === location.origin ? DOCBASE : location.pathname) + "#" + s + ":" + n);
  const verseText = (s, n) => [arText(s, n), ...trTexts(s, n).slice(0, 1), `— ${meta(s).en} ${s}:${n}`].join("\n");
  const shareEl = document.createElement("div"); shareEl.id = "shareMenu"; shareEl.hidden = true; shareEl.setAttribute("role", "dialog"); shareEl.setAttribute("aria-label", "Share this verse"); document.body.appendChild(shareEl);
  const closeShare = () => { shareEl.hidden = true; };
  async function shareAyah(s, n) {
    const url = verseLink(s, n), text = verseText(s, n), title = `${meta(s).en} ${s}:${n}`;
    stat("ayah_action", { action: "share", surah: s, ayah: n, ref: s + ":" + n });
    if (navigator.share) { try { await navigator.share({ title, text, url }); return; } catch (e) { if (e && e.name === "AbortError") return; } }   // cancelled: nothing more to do
    const enc = encodeURIComponent, msg = text + "\n" + url, ic = (d, c) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="${c || "currentColor"}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    const rows = [
      ["WhatsApp", "https://wa.me/?text=" + enc(msg)], ["Telegram", `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`],
      ["X", `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`], ["Facebook", "https://www.facebook.com/sharer/sharer.php?u=" + enc(url)],
      ["Email", `mailto:?subject=${enc(title)}&body=${enc(msg)}`]];
    shareEl.innerHTML = `<div class="sh-back" data-close="1"></div><div class="sh-card"><div class="sh-h"><b>Share ${esc(title)}</b><button type="button" class="pl-b" data-close="1" aria-label="Close">${ic('<path d="M6 6l12 12M18 6L6 18"/>')}</button></div>
      <blockquote lang="ar">${esc(arText(s, n))}</blockquote>
      <div class="sh-grid">${rows.map(([n2, h]) => `<a href="${h}" target="_blank" rel="noopener noreferrer">${esc(n2)}</a>`).join("")}<button type="button" data-copy="link">Copy link</button><button type="button" data-copy="text">Copy verse</button></div></div>`;
    shareEl.hidden = false; const f = $("a", shareEl); f && f.focus();
    shareEl.onclick = e => {
      if (e.target.closest("[data-close]")) return closeShare();
      const c = e.target.closest("[data-copy]"); if (c) { (navigator.clipboard ? navigator.clipboard.writeText(c.dataset.copy === "link" ? url : msg) : Promise.reject()).then(() => toast("Copied"), () => toast("Couldn't copy")); closeShare(); }
      else if (e.target.closest("a")) setTimeout(closeShare, 100);
    };
  }
  function markBookmarks() { $$(".ayah", inner).forEach(el => { const k = S.s + ":" + el.dataset.n; const b = $("[data-act=mark]", el); if (b) b.setAttribute("aria-pressed", bms.includes(k)); }); }

  /* ---------- word-by-word tooltip (mushaf words: meaning + transliteration from the glyph data) ---------- */
  const wtip = $("#tip");
  function showWordTip(el) {
    const [s, n, i] = el.dataset.k.split(":").map(Number), w = qw(s, n, i);
    let h = `<div class="hd"><span class="a">${esc(w.ar)}</span><span class="t">${esc(w.tr)}</span><span class="ref">(${s}:${n}:${i + 1})</span></div>`;
    if (w.tl) h += `<div class="gram"><b>${esc(w.tl)}</b></div>`;
    wtip.innerHTML = h; wtip.hidden = false; $$(".w.on").forEach(e => e.classList.remove("on")); el.classList.add("on");
    const r = el.getBoundingClientRect(), W = wtip.offsetWidth, H = wtip.offsetHeight;
    wtip.style.left = clamp(r.left + r.width / 2 - W / 2, 8, innerWidth - W - 8) + "px";
    wtip.style.top = (r.bottom + H + 14 > innerHeight ? Math.max(8, r.top - H - 8) : r.bottom + 8) + "px";
  }
  function hideWordTip() { wtip.hidden = true; $$(".w.on").forEach(e => e.classList.remove("on")); }
  inner.addEventListener("mouseover", e => { const w = e.target.closest(".w"); if (w && WBW.on && matchMedia("(hover:hover)").matches) showWordTip(w); });
  inner.addEventListener("mouseout", e => { if (e.target.closest(".w") && matchMedia("(hover:hover)").matches) hideWordTip(); });
  scroller.addEventListener("scroll", hideWordTip, { passive: true });

  /* copying selected mushaf-font words gives real Arabic, not private-use glyph codes */
  [inner, $("#svinner")].forEach(box => box.addEventListener("copy", e => {
    const sel = getSelection(); if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const r = sel.getRangeAt(0), ws = $$(".w.q", box).filter(w => r.intersectsNode(w)); if (!ws.length) return;
    const by = new Map(); ws.forEach(w => { const a = w.closest(".ayah"); by.set(a, (by.get(a) || []).concat($(".sr", w).textContent)); });
    e.preventDefault(); e.clipboardData.setData("text/plain", [...by.values()].map(a => a.join(" ")).join("\n"));
  }));

  /* ---------- toast ---------- */
  let toastT = 0; const toastEl = $("#toast");
  /* ---------- "oops": when the service can't be reached or is failing, the whole reader is replaced by one calm screen ----------
     Kinds (set by gq-api.js): offline, network, timeout, server (5xx / the API reports an error such as a database problem), rate, key.
     Every kind has "Try again" (repeats what failed; on a first load it reloads the page). Only a SERVER fault also offers "Go back to where I was":
     the action that failed (opening a surah, changing a translation) is undone and the reader returns exactly as it was.
     No people, animals or faces: a desert, a palm and the moon or sun. Preview any of them with ?oops=server|network|offline|timeout|rate|key. */
  const OOPS = {
    offline: ["You're offline", "Global Quran can't reach the internet. Check your connection and try again. It will retry by itself when you're back online."],
    network: ["We can't reach Global Quran", "The service isn't answering right now. This is usually brief: please try again in a moment."],
    timeout: ["This is taking too long", "The service is slow to answer. Check your connection and try again."],
    server: ["Something went wrong on our side", "The service is having trouble right now. Nothing you did caused this. Please try again in a moment."],
    rate: ["Please slow down for a moment", "There were too many requests in a short time. Wait a minute, then try again."],
    key: ["This isn't allowed from here", "The service refused the request. If you run this site, check the API key and the allowed domain."]
  };
  let downKind = "";
  function down(e, o = {}) {
    const kind = OOPS[e && e.kind] ? e.kind : (navigator.onLine === false ? "offline" : "network"); downKind = kind;
    stat("error_screen", { kind, status: (e && e.status) || 0 });
    const t = OOPS[kind]; $("#oopsT").textContent = t[0]; $("#oopsP").textContent = t[1];
    $("#oopsD").textContent = [kind === "server" || kind === "key" || kind === "rate" ? "Error " + ((e && e.status) || "") : "", new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })].filter(Boolean).join(" · ").replace(/^Error \s*·/, "");
    $("#oopsBack").hidden = !(kind === "server" && S.undo);
    try { stopAudio(); } catch (x) {}
    $("#oops").hidden = false; root.classList.add("down"); $("#oopsRetry").focus({ preventScroll: true });
  }
  function upAgain() {
    if (qs.has("oops")) { qs.delete("oops"); try { const q = qs.toString(); history.replaceState(null, "", location.origin + location.pathname + (q ? "?" + q : "") + location.hash); } catch (e) {} }   // a previewed error must not come back on refresh
    $("#oops").hidden = true; root.classList.remove("down"); downKind = ""; requestAnimationFrame(() => { recalc(); }); }
  $("#oopsRetry").onclick = () => { upAgain(); if (S.retry) S.retry(); else location.reload(); };
  $("#oopsBack").onclick = () => { upAgain(); const u = S.undo; S.undo = S.retry = null; u && u(); };
  addEventListener("online", () => { if (downKind === "offline") $("#oopsRetry").click(); });
  if (qs.get("oops")) addEventListener("load", () => down({ kind: qs.get("oops"), status: { server: 503, rate: 429, key: 403 }[qs.get("oops")] }));

  function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 1600); }

  /* ---------- audio ---------- */
  /* Each ayah plays up to two voices in turn: the Quran reciter (optional), then a translation reciter (optional, "auto" follows the
     chosen translation's language). Neither chosen = the default Quran reciter, so something always plays. */
  let RECITERS = [["ar.alafasy", "Mishary Alafasy", "Alafasy"]], TR_REC = [];   // [id, name, short] and [id, lang, name, -, short]; filled from /v2/list/recitor
  const REC_MEDIA = {};
  function setVoices(list) {
    const by = (x, y) => (x.id === "ar.alafasy" ? -1 : y.id === "ar.alafasy" ? 1 : x.full.localeCompare(y.full));
    RECITERS = list.filter(r => r.lang === "ar").sort(by).map(r => [r.id, r.full, r.name]);
    TR_REC = list.filter(r => r.lang !== "ar").sort((x, y) => x.lang.localeCompare(y.lang) || x.full.localeCompare(y.full)).map(r => [r.id, r.lang, r.full, 0, r.name]);
    list.forEach(r => { REC_MEDIA[r.id] = r.media; });
    RECITERS = RECITERS.filter(r => audioVariants(r[0]).length); TR_REC = TR_REC.filter(r => audioVariants(r[0]).length);   // e.g. ogg-only reciters on a browser without Ogg
    if (A.reciter && !RECITERS.some(r => r[0] === A.reciter)) A.reciter = RECITERS.some(r => r[0] === "ar.alafasy") ? "ar.alafasy" : ((RECITERS[0] || [""])[0]);
    if (A.trRec && A.trRec !== "auto" && !TR_REC.some(r => r[0] === A.trRec)) A.trRec = "auto";
  }
  /* which file of a reciter to use: its media list says what exists (e.g. en.walk is only mp3 192 kbps) */
  const canOgg = (() => { try { return !!new Audio().canPlayType('audio/ogg; codecs="vorbis"'); } catch (e) { return false; } })();
  /* every working-looking file of a reciter, best first (some listed files do not exist, e.g. minshawimujawwad mp3; the player moves on to the next on error) */
  function audioVariants(id) {
    const m = REC_MEDIA[id] || {}, ok = Object.entries(m).filter(([, v]) => v && v.status !== "inactive" && v.status !== "disabled").map(([k, v]) => ({ k, type: v.type || k.split("-")[0], kbs: v.kbs || k.split("-")[1] })).filter(v => v.type !== "ogg" || canOgg);
    const slow = navigator.connection && navigator.connection.saveData;
    const order = slow ? ["mp3-32", "mp3-40", "mp3-48", "mp3-64", "ogg-32", "ogg-64", "mp3-128"] : ["mp3-128", "mp3-192", "mp3-64", "mp3-48", "mp3-40", "mp3-32", "ogg-128", "ogg-64", "ogg-192", "ogg-32"];
    const rank = v => { const i = order.indexOf(v.k); return i < 0 ? 99 : i; };
    return ok.sort((a, b) => rank(a) - rank(b));
  }
  function audioVariant(id) {
    const m = REC_MEDIA[id] || {}, ok = Object.entries(m).filter(([, v]) => v && v.status !== "inactive" && v.status !== "disabled").map(([k, v]) => ({ k, type: v.type || k.split("-")[0], kbs: v.kbs || k.split("-")[1] }));
    const slow = navigator.connection && navigator.connection.saveData;
    const order = slow ? ["mp3-32", "mp3-40", "mp3-48", "mp3-64", "ogg-32", "ogg-64", "mp3-128"] : ["mp3-128", "mp3-192", "mp3-64", "mp3-48", "mp3-40", "mp3-32", "ogg-128", "ogg-64", "ogg-192", "ogg-32"];
    for (const k of order) { const v = ok.find(x => x.k === k); if (v) return v; }
    return ok[0] || { type: "mp3", kbs: "128" };
  }
  const audioFile = (id, ayahNo, vi = 0) => { const v = audioVariants(id)[vi] || audioVariant(id); return `https://audio.globalquran.com/${id}/${v.type}/${v.kbs}kbs/${ayahNo}.${v.type}`; };
  const audio = $("#audio"), A = { on: false, s: 1, n: 0, q: null, qi: 0, st: [], stage: 0, sim: 0, simT: 0, reciter: pref("reciter", "ar.alafasy"), trRec: pref("rtr", "auto"), speed: +pref("speed", 1), repeat: 0, times: 1, done: 0, rk: "", paused: false };
  const plBox = $("#player");
  const trRecId = () => {   // which translation voice plays, if any
    if (A.trRec === "") return ""; if (A.trRec !== "auto") return A.trRec;
    for (const t of trInfos()) { const r = TR_REC.find(x => x[1] === t.lang); if (r) return r[0]; } return "";
  };
  const gAyah = (s, n) => meta(s).g + n - 1;
  const stageId = kind => kind === "ar" ? (A.reciter || "ar.alafasy") : trRecId();
  /* The Bismillah above a surah is played first when playback starts at ayah 1 (Play button, no ayah picked), once per surah per day.
     It is audio ayah 1:1 for every voice (Quran and translation); in the player it is "ayah 0" and the highlight sits on the Bismillah at the top.
     Surah 1 (the Bismillah is its ayah 1) and surah 9 (none) never get it. "Play from here" on ayah 1 skips it. */
  const BISM = new Map();   // surah -> date it was played (resets on reload)
  const hasBism = s => s !== 1 && s !== 9;
  const bismDone = s => BISM.get(s) === new Date().toDateString();
  const markBism = s => BISM.set(s, new Date().toDateString());
  const stageUrl = (kind, s, n) => audioFile(stageId(kind), n === 0 ? 1 : gAyah(s, n), A.vi || 0);
  const stagesNow = () => {
    if (S.view === "read") return S.rd === "ar" ? ["ar"] : (trRecId() ? ["tr"] : ["ar"]);   // reading = one voice, matching what is on the page
    const st = []; if (A.reciter) st.push("ar"); if (trRecId()) st.push("tr"); return st.length ? st : ["ar"];
  };
  const arShort = () => (RECITERS.find(r => r[0] === (A.reciter || "ar.alafasy")) || RECITERS[0])[2];
  const trShort = () => { const r = TR_REC.find(x => x[0] === trRecId()); return r ? `${r[4]} (${r[1].toUpperCase()})` : ""; };
  const voiceText = () => stagesNow().map(k => k === "ar" ? arShort() : trShort()).join(" + ");
  const voiceHtml = () => `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c.6-3.6 3.4-5.6 7-5.6s6.4 2 7 5.6"/></svg><span class="vp-t">${esc(voiceText())}</span><i class="vp-s">${A.speed !== 1 ? A.speed + "×" : ""}</i>`;
  function syncVoiceBtn() {
    $("#plVoices").innerHTML = voiceHtml();
    $("#plVoices").title = "Voices and speed: " + voiceText() + (A.speed !== 1 ? ", " + A.speed + "×" : "");
    $("#vcSub").textContent = S.view !== "read" ? "Quran first, then translation" : S.rd === "ar" ? "Reading plays the Arabic" : "Reading plays this translation";
  }
  /* the player lives inside the book and only appears while something is playing */
  const footRow = $("#footRow");
  function syncFoot() { $("#btnListen").hidden = A.on; footRow.hidden = A.on && (!TJ.on || KEYHIDE); }
  function idleLabel() { $("#listenT").textContent = S.mode === "saved" ? "Play saved ayahs" : "Play from ayah " + (S.sel || S.cur || 1); }
  let plHide = false;   // Listen view: the bottom player is tucked away (audio keeps playing); tap the voice label on the stage to bring it back
  function showPlayer(v) { plBox.hidden = !v || (plHide && S.view === "listen"); if (!v) closePops(); syncFoot(); idleLabel(); }
  new ResizeObserver(() => root.style.setProperty("--foot", ($("#foot").offsetHeight + 10) + "px")).observe($("#foot"));
  function setPlayIcon() { lsState(); $("#plPlay use").setAttribute("href", "img/sprite.svg#" + (A.on && !A.paused ? "i-pause" : "i-play")); $("#plPlay").setAttribute("aria-label", A.on && !A.paused ? "Pause" : "Play"); }
  function playingEl() { if (!A.on || A.n == null) return null; if (A.n === 0) return (!A.q && A.s === S.s) ? $(".bism", inner) : null; return A.q ? $(`#svinner .ayah[data-s="${A.s}"][data-n="${A.n}"]`) : (A.s === S.s ? $("#a" + A.n, inner) : null); }
  function markPlaying() { setTitle(); $$(".ayah.playing, .bism.playing").forEach(e => e.classList.remove("playing")); const el = playingEl(); if (el) el.classList.add("playing"); root.classList.toggle("playing-on", !!el); paintReading(); }
  function nowLabel(extra = "") {
    const m = meta(A.s); $("#plSurah").textContent = `${m.n}. ${m.en}`;
    const voice = A.st.length > 1 ? (A.st[A.stage] === "ar" ? " · Quran" : " · Translation") : (A.st[0] === "tr" ? " · Translation" : "");
    const full = A.q ? `Saved ${A.s}:${A.n} · ${A.qi + 1} of ${A.q.length}` : A.n === 0 ? "Bismillah" : `Ayah ${A.n} of ${m.c}`, short = A.q ? `${A.qi + 1}/${A.q.length}` : A.n === 0 ? "Bismillah" : `${A.n}/${m.c}`;
    $("#plSub").innerHTML = `<span class="l-full">${esc(full)}</span><span class="l-short">${esc(short)}</span><span class="l-voice">${esc(voice + extra)}</span>`;
  }
  function playAyah(n, s = S.s, queue = null, qi = 0) {
    clearTimeout(A.simT); n = n === 0 ? 0 : clamp(n, 1, meta(s).c); if (!queue && n <= 1) markBism(s); const wasOff = !A.on; A.on = true; A.paused = false; A.s = s; A.n = n; A.q = queue; A.qi = qi; A.sim = 0; A.st = stagesNow(); A.stage = 0;
    if (wasOff && modesOn()) putAwayModes();   // the note must not sit over the verse being recited
    if (wasOff) { A.played = 0; A.t0 = Date.now(); stat("play_start", { surah: s, ref: n > 0 ? s + ":" + n : "", from: queue ? "saved" : n === 0 ? "bismillah" : n === 1 ? "start" : "ayah", voices: A.st.join("+"), reciter: A.reciter, view: S.view, show: S.view === "read" ? S.rd : "both" }); }
    if (S.view === "read" && !queue) { $$(".ayah.sel").forEach(e => e.classList.remove("sel")); S.sel = 0; }
    else if (S.view === "verse" && !queue && s === S.s && n >= 1 && S.sel !== n && $("#a" + n, inner)) selectAyah(n, true);   // the buttons follow the verse being played   // the click selection has done its job
    showPlayer(true); markPlaying(); setPlayIcon();
    if (follow) { if (A.q) { const el = playingEl(); el && el.scrollIntoView({ block: "center", behavior: "smooth" }); } else smoothTo(n === 0 ? 0 : ayahTop(n) - Math.min(40, scroller.clientHeight * .06), .06); }
    startStage();
  }
  function startStage() {
    lsStage();
    clearTimeout(A.simT); A.sim = 0; A.vi = 0; nowLabel(); $("#plFill").style.width = "0%";
    audio.src = stageUrl(A.st[A.stage], A.s, A.n); audio.playbackRate = A.speed; $("#plPlay").classList.add("loading");
    audio.play().then(() => $("#plPlay").classList.remove("loading")).catch(simulate);
  }
  function stageDone() { if (A.stage < A.st.length - 1) { A.stage++; startStage(); } else advance(); }
  function simulate() {   // offline / blocked audio: keep the interface working with a timed preview
    $("#plPlay").classList.remove("loading"); A.sim = performance.now(); nowLabel(" · preview (audio unavailable)");
    const tick = () => { if (!A.on || A.paused || !A.sim) return; const f = (performance.now() - A.sim) / 3200; $("#plFill").style.width = Math.min(100, f * 100) + "%"; f >= 1 ? stageDone() : A.simT = setTimeout(tick, 120); };
    tick();
  }
  const replay = () => playAyah(A.n, A.s, A.q, A.qi);
  function advance() {
    A.played = (A.played || 0) + 1;
    if (A.n === 0 && !A.q) return playAyah(1, A.s);   // Bismillah done: on to ayah 1
    if (A.times > 1 && !A.q) {   // Memorise: each verse is played "times" times in a row
      const k = A.s + ":" + A.n; if (A.rk !== k) { A.rk = k; A.done = 0; }
      if (A.done < A.times - 1) { A.done++; return replay(); } A.done = 0;
    }
    if (A.repeat === 1) return replay();
    if (A.q) { if (A.qi < A.q.length - 1) { const [s, n] = A.q[A.qi + 1]; return playAyah(n, s, A.q, A.qi + 1); } if (A.repeat === 2) { const [s, n] = A.q[0]; return playAyah(n, s, A.q, 0); } return stopAudio(); }
    if (A.n < meta(A.s).c) return playAyah(A.n + 1, A.s);
    if (A.repeat === 2) return playAyah(1, A.s);
    nextSurahPlay();
  }
  async function nextSurahPlay() {   // surah finished: carry on with the next one, until after surah 114
    if (A.s >= 114) return stopAudio();
    const to = A.s + 1; A.paused = false; $("#plPlay").classList.add("loading");
    await openSurah(to, 1, { keepAudio: true, via: "autoplay" });
    if (!A.on || S.s !== to) return;   // stopped, or another surah was opened meanwhile
    playAyah(hasBism(to) ? 0 : 1, to);
  }
  function stopAudio() { plHide = false; lsEl.classList.remove("plhid"); setTimeout(lsIdle, 0); if (A.on) stat("play_stop", { surah: A.s, ayahs: A.played || 0, secs: Math.round((Date.now() - (A.t0 || Date.now())) / 1000) }); A.on = false; A.paused = false; A.sim = 0; A.q = null; clearTimeout(A.simT); audio.pause(); audio.removeAttribute("src"); showPlayer(false); markPlaying(); setPlayIcon(); $("#plFill").style.width = "0%"; $("#plPlay").classList.remove("loading"); }
  function togglePlay() {
    if (!A.on) {
      if (S.mode === "saved") return playSaved(0);
      const n = S.sel || S.cur || 1;
      return playAyah(n === 1 && !S.sel && hasBism(S.s) && !bismDone(S.s) ? 0 : n);   // from the top: Bismillah first
    }
    if (A.paused) { A.paused = false; setPlayIcon(); A.sim ? (A.sim = performance.now(), simulate()) : audio.play().catch(simulate); }
    else { A.paused = true; audio.pause(); setPlayIcon(); }
  }
  function skip(d) {
    if (!A.on) return S.mode === "saved" ? null : jumpAyah(S.cur + d);
    if (A.q) { const i = clamp(A.qi + d, 0, A.q.length - 1), [s, n] = A.q[i]; return playAyah(n, s, A.q, i); }
    playAyah(clamp(A.n + d, 1, meta(A.s).c), A.s);   // from the Bismillah, "next" goes to ayah 1
  }
  audio.addEventListener("ended", stageDone);
  audio.addEventListener("error", () => {
    if (!A.on || !audio.getAttribute("src")) return;
    const vs = audioVariants(stageId(A.st[A.stage]));
    if ((A.vi || 0) + 1 < vs.length) { A.vi = (A.vi || 0) + 1; audio.src = stageUrl(A.st[A.stage], A.s, A.n); audio.play().catch(simulate); } else { stat("audio_error", { reciter: stageId(A.st[A.stage]) }); simulate(); }   // next file variant, else the timed preview
  });
  audio.addEventListener("timeupdate", () => { if (A.on && audio.duration) $("#plFill").style.width = (audio.currentTime / audio.duration * 100) + "%"; });
  audio.addEventListener("playing", () => $("#plPlay").classList.remove("loading"));
  $("#plPlay").onclick = togglePlay; $("#btnListen").onclick = togglePlay; $("#plClose").onclick = () => { if (S.view === "listen" && A.on && !plHide) { plHide = true; showPlayer(true); lsEl.classList.add("plhid"); $("#lsVoice").title = "Show player controls"; } else stopAudio(); };   // in Listen view the stage has its own controls: X only tucks the player away
  $("#plEye").onclick = () => setView(S.view === "listen" ? (S.last || "verse") : "listen");   // flips between Listen and the reading view you last chose
  $("#plNext").onclick = () => skip(1); $("#plPrev").onclick = () => skip(-1);
  $("#plBar").onclick = e => { if (!A.on || A.sim || !audio.duration) return; const r = e.currentTarget.getBoundingClientRect(); audio.currentTime = clamp((e.clientX - r.left) / r.width, 0, 1) * audio.duration; };
  function syncRepeatUi() { const b = $("#plRepeat"), x3 = A.times > 1; b.classList.toggle("on", A.repeat > 0 || x3); $("#rpBadge").textContent = x3 ? "×" + A.times : A.repeat === 1 ? "1" : A.repeat === 2 ? "∞" : ""; b.title = x3 ? `Repeat: each verse ${A.times} times` : "Repeat: " + ["off", "this ayah", "all"][A.repeat]; }
  $("#plRepeat").onclick = () => { A.times = 1; A.repeat = (A.repeat + 1) % 3; syncRepeatUi(); toast($("#plRepeat").title); };
  function setReciter(id) { stat("setting_change", { setting: "quran_reciter", value: id }); A.reciter = id; store.set("reciter", id); syncReciters(); if (A.on && !A.paused) replay(); }
  function setTrRec(id) { stat("setting_change", { setting: "translation_reciter", value: id || "none" }); A.trRec = id; store.set("rtr", id); syncReciters(); if (A.on && !A.paused) replay(); }
  function setSpeed(v) { if (+v !== A.speed) stat("setting_change", { setting: "speed", value: String(v) }); A.speed = +v; if (typeof syncVoiceBtn === "function") syncVoiceBtn(); store.set("speed", v); audio.playbackRate = A.speed; $$("#plSpeedSeg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === String(v))); $("#optSpeed").value = v; }
  const trAutoLabel = () => { const r = TR_REC.find(x => x[0] === (A.trRec === "auto" ? trRecId() : "")); return r ? `Auto: ${r[2]}` : "Auto (none for this language)"; };
  function buildReciters() {
    const ar = `<option value="">None (translation only)</option>` + RECITERS.map(([id, nm]) => `<option value="${id}">${esc(nm)}</option>`).join("");
    const langs = [...new Set(TR_REC.map(r => r[1]))];
    const tr = `<option value="auto">${esc(trAutoLabel())}</option><option value="">None</option>` + langs.map(l => `<optgroup label="${esc(langNames(l).nat)}">` + TR_REC.filter(r => r[1] === l).map(r => `<option value="${r[0]}">${esc(r[2])}</option>`).join("") + `</optgroup>`).join("");
    [$("#plReciter"), $("#optReciter")].forEach(s => { s.innerHTML = ar; }); [$("#plTrRec"), $("#optTrRec")].forEach(s => { s.innerHTML = tr; });
    syncReciters(false);
  }
  function syncReciters(rebuildAuto = true) {
    if (rebuildAuto) { const o = $("#plTrRec").options[0], o2 = $("#optTrRec").options[0]; if (o) o.textContent = trAutoLabel(); if (o2) o2.textContent = trAutoLabel(); }
    [$("#plReciter"), $("#optReciter")].forEach(s => { s.value = A.reciter; }); [$("#plTrRec"), $("#optTrRec")].forEach(s => { s.value = A.trRec; });
    syncVoiceBtn();
  }
  $("#plReciter").onchange = e => setReciter(e.target.value); $("#optReciter").onchange = e => setReciter(e.target.value);
  $("#plTrRec").onchange = e => setTrRec(e.target.value); $("#optTrRec").onchange = e => setTrRec(e.target.value);
  $("#plSpeedSeg").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (b) setSpeed(b.dataset.v); });
  $("#optSpeed").onchange = e => setSpeed(e.target.value);

  /* ---------- saved ayahs: only the bookmarked ayahs, drawn with the current reading settings ---------- */
  const svscroll = $("#svscroll"), svinner = $("#svinner");
  const savedList = () => bms.map(k => k.split(":").map(Number)).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  function syncSavedUi() { const b = $("#btnSaved"); b.setAttribute("aria-pressed", S.mode === "saved"); $("#bmCount").textContent = bms.length || ""; b.setAttribute("aria-label", `Saved ayahs (${bms.length})`); }
  async function renderSaved() {
    const list = savedList(); svinner.className = "inner layout-" + layoutPref;
    if (!list.length) { svinner.innerHTML = `<div class="sv-empty"><b>No saved ayahs yet</b><p>Tap an ayah, then choose Save.<br>Everything you save appears here, in your reading settings.</p></div>`; return; }
    await Promise.all([...new Set(list.map(x => x[0]))].map(ensureTexts));
    if (QC.on) {
      await Promise.all([...new Set(list.map(x => x[0]))].map(loadQcf));
      const pages = new Set(); list.forEach(([s, n]) => (S.qcf[s] ? S.qcf[s][n - 1] : []).forEach(w => pages.add(w[4]))); useFonts(pages); await Promise.all([...pages].map(fontReady));
    }
    if (S.mode !== "saved") return;
    let html = "", last = 0;
    list.forEach(([s, n]) => {
      const m = meta(s), q = QC.on && !!S.qcf[s];
      if (s !== last) { last = s; const cnt = list.filter(x => x[0] === s).length; html += `<div class="sv-group"><b>${esc(m.en)}</b><span>${esc(m.me)} · ${cnt} saved</span></div>`; }
      const ar = q ? qcfWords(s, n) : arHtml(s, n, arText(s, n)) + " " + numHtml(n);
      html += `<div class="ayah" data-s="${s}" data-n="${n}"><div class="ar${q ? " qcf" : ""}" lang="ar">${ar}</div><div class="tlit">${TL.on ? esc(tlText(s, n)) : ""}</div><div class="trs">${trBlocks(s, n)}</div>
        <div class="actions"><button data-act="play"><svg><use href="img/sprite.svg#i-play"/></svg>Play</button><button data-act="unsave"><svg><use href="img/sprite.svg#i-star"/></svg>Remove</button><button data-act="open">Open in surah</button></div></div>`;
    });
    svinner.innerHTML = html; markPlaying();
  }
  const refreshSaved = () => { if (S.mode === "saved") renderSaved(); };
  async function enterSaved() {
    stopAudio(); closePops(); showKey(false); S.mode = "saved"; root.classList.add("saved-on"); lsVisibility(); svscroll.hidden = false; svscroll.scrollTop = 0;
    $("#btnPrevS").disabled = $("#btnNextS").disabled = true; syncSavedUi(); idleLabel(); await renderSaved();
  }
  function exitSaved() {
    S.mode = ""; stopAudio(); root.classList.remove("saved-on"); lsVisibility(); svscroll.hidden = true;
    $("#btnPrevS").disabled = S.s <= 1; $("#btnNextS").disabled = S.s >= 114; syncSavedUi(); idleLabel(); requestAnimationFrame(recalc);
  }
  function playSaved(i) { const l = savedList(); if (!l[i]) return; playAyah(l[i][1], l[i][0], l, i); }
  $("#btnSaved").onclick = () => S.mode === "saved" ? exitSaved() : enterSaved();
  svinner.addEventListener("click", e => {
    const act = e.target.closest("[data-act]"), el = e.target.closest(".ayah");
    if (act && el) {
      const s = +el.dataset.s, n = +el.dataset.n, a = act.dataset.act;
      if (a === "play") playSaved(savedList().findIndex(x => x[0] === s && x[1] === n));
      if (a === "unsave") { const i = bms.indexOf(s + ":" + n); if (i >= 0) bms.splice(i, 1); store.set("bm", JSON.stringify(bms)); drawMarks(); markBookmarks(); syncSavedUi(); toast("Removed"); renderSaved(); }
      if (a === "open") { exitSaved(); openSurah(s, n); }
      return;
    }
    const w = e.target.closest(".w"); if (w && WBW.on) { showWordTip(w); return; }
    hideWordTip();
    if (el) { const was = el.classList.contains("sel"); $$(".ayah.sel", svinner).forEach(x => x.classList.remove("sel")); if (!was) el.classList.add("sel"); }
  });
  svinner.addEventListener("mouseover", e => { const w = e.target.closest(".w"); if (w && WBW.on && matchMedia("(hover:hover)").matches) showWordTip(w); });
  svinner.addEventListener("mouseout", e => { if (e.target.closest(".w") && matchMedia("(hover:hover)").matches) hideWordTip(); });
  svscroll.addEventListener("scroll", hideWordTip, { passive: true });

  /* ---------- sidebar ---------- */
  const wideMq = matchMedia("(min-width: 1100px)");
  const drawerMode = () => !wideMq.matches || (EMBED && !root.classList.contains("embed-side"));
  const menuOpen = () => drawerMode() ? app.classList.contains("menu-open") : !app.classList.contains("side-off");
  const syncMenuBtn = () => $("#btnMenu").setAttribute("aria-expanded", menuOpen());
  function toggleMenu() {
    if (drawerMode()) menuOpen() ? closeMenu() : openMenu();
    else { app.classList.toggle("side-off"); syncMenuBtn(); }   // opening it is not remembered: the next visit starts closed again
  }
  if (!(EMBED && root.classList.contains("embed-side"))) app.classList.add("side-off");   // closed on every load; only the menu button opens it
  wideMq.addEventListener && wideMq.addEventListener("change", () => { app.classList.remove("menu-open"); syncMenuBtn(); });
  function openMenu() { app.classList.add("menu-open"); syncMenuBtn(); const cur = $("#surahList button.cur"); cur && cur.scrollIntoView({ block: "center" }); }
  function closeMenu() { app.classList.remove("menu-open"); syncMenuBtn(); }
  $("#btnMenu").onclick = toggleMenu; $("#scrim").onclick = closeMenu;
  $$(".side-tabs button").forEach(b => b.onclick = () => { $$(".side-tabs button").forEach(x => x.classList.toggle("on", x === b)); $$(".tab").forEach(t => t.classList.toggle("on", t.id === "tab-" + b.dataset.tab)); if (b.dataset.tab === "marks") drawMarks(); });
  function buildSurahList() {
    $("#pickList").innerHTML = $("#surahList").innerHTML = S.data.surahs.map(m => `<li><button data-s="${m.n}" data-q="${esc((m.n + " " + m.en + " " + m.me + " " + m.ar).toLowerCase())}"><span class="s-no">${m.n}</span><span class="s-nm">${esc(m.en)}<small>${esc(m.me)} · ${m.c} verses</small></span><span class="s-ar sn" aria-hidden="true">${pad3(m.n)}</span></button></li>`).join("");
  }
  $("#surahList").addEventListener("click", e => { const b = e.target.closest("[data-s]"); if (b) openSurah(+b.dataset.s, 1, { via: "sidebar" }); });
  $("#surahFilter").addEventListener("input", e => {
    const q = e.target.value.trim().toLowerCase().replace(/[-']/g, "");
    $$("#surahList li").forEach(li => { const b = li.firstChild, t = (b.dataset.q || "").toLowerCase().replace(/[-']/g, ""); li.hidden = !!q && !t.includes(q); });
  });
  function drawMarks() {
    const list = $("#markList");
    list.innerHTML = bms.length ? bms.map(k => { const [s, n] = k.split(":").map(Number), m = meta(s), t = arText(s, n);
      return `<li><button data-s="${s}" data-n="${n}"><span class="s-no">${n}</span><span class="s-nm">${esc(m.en)} · Ayah ${n}<small>${t ? esc(t.slice(0, 36)) + "…" : ""}</small></span></button></li>`; }).join("")
      : `<li class="empty">No saved verses yet. Tap a verse, then Save.</li>`;
  }
  async function fillMarkSnippets() { const ss = [...new Set(bms.map(k => +k.split(":")[0]))].filter(s => !S.ar[s - 1]); if (!ss.length) return; await Promise.all(ss.map(loadAr)); drawMarks(); }
  $("#markList").addEventListener("click", e => { const b = e.target.closest("[data-s]"); if (b) openSurah(+b.dataset.s, +b.dataset.n); });

  /* ---------- reading view: verse by verse (default) or one flowing text, Arabic OR a single translation ---------- */
  function syncView() {
    root.classList.toggle("listen-on", S.view === "listen"); if (S.view !== "listen" && plHide) { plHide = false; lsEl.classList.remove("plhid"); if (A.on) showPlayer(true); } lsVisibility();
    $("#plEye").setAttribute("aria-pressed", S.view === "listen"); root.classList.toggle("read-on", S.view === "read"); root.classList.toggle("rd-tr", readTr());
    $$("#segView button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === S.view)); $$("#segRd button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === S.rd));
    drawTabs();
  }
  const reRender = () => openSurah(S.s, S.cur || 1, { flash: false, keepAudio: true });
  async function setView(v) { stat("setting_change", { setting: "view", value: v }); S.view = v; store.set("view", v); if (v !== "listen") { S.last = v; store.set("lastview", v); } if (readTr()) await loadTr(S.rdTr); syncView(); syncTrChip(); syncReciters(); reRender(); }
  async function setRd(v) { stat("setting_change", { setting: "show", value: v }); S.rd = v; store.set("rd", v); if (readTr()) await loadTr(S.rdTr); syncView(); syncTrChip(); syncReciters(); reRender(); }
  async function setRdTr(id) { S.rdTr = id; store.set("rdtr", id); await loadTr(id); syncTrChip(); syncReciters(); reRender(); }
  $("#segView").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (b && b.dataset.v !== S.view) setView(b.dataset.v); });
  $("#segRd").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (b && b.dataset.v !== S.rd) setRd(b.dataset.v); });

  /* ---------- on-page popovers: reading options + quick surah picker ---------- */
  const POPS = { picker: [$("#picker"), $("#cartBtn")], trpick: [$("#trpick"), $("#trChip")], voices: [$("#voices"), $("#plVoices")] };
  function closePops(except) { for (const k in POPS) { if (k === except) continue; const [p, b] = POPS[k]; p.hidden = true; b.setAttribute("aria-expanded", "false"); } }
  function togglePop(k) {
    const [p, b] = POPS[k], open = p.hidden; if (open) stat("open_panel", { panel: k }); closePops(open ? k : null); p.hidden = !open; b.setAttribute("aria-expanded", open);
    if (!open) return; showKey(false);
    if (k === "trpick") openTrPick();
    if (k === "picker") { const f = $("#pickFilter"); f.value = ""; $$("#pickList li").forEach(li => { li.hidden = false; }); const cur = $("#pickList button.cur"); cur && cur.scrollIntoView({ block: "center" }); if (matchMedia("(hover:hover)").matches) f.focus({ preventScroll: true }); }
  }
  const sub = $("#tools");
  function showTools(v) { sub.hidden = !v; $("#btnTools").setAttribute("aria-expanded", !!v); if (v) closePops(); }
  new ResizeObserver(() => root.style.setProperty("--sh", sub.hidden ? "0px" : sub.offsetHeight + "px")).observe(sub);
  $("#btnTools").onclick = () => showTools(sub.hidden); $("#btnToolsX").onclick = () => showTools(false);
  $("#cartBtn").onclick = () => togglePop("picker"); $("#plVoices").onclick = () => togglePop("voices");
  addEventListener("pointerdown", e => { if (!e.target.closest(".pop, #cartBtn, #trChip, #plVoices")) closePops(); });
  $("#pickList").addEventListener("click", e => { const b = e.target.closest("[data-s]"); if (b) { closePops(); openSurah(+b.dataset.s, 1, { via: "picker" }); } });
  $("#pickFilter").addEventListener("input", e => {
    const q = e.target.value.trim().toLowerCase().replace(/[-']/g, "");
    $$("#pickList li").forEach(li => { const b = li.firstChild, t = (b.dataset.q || "").toLowerCase().replace(/[-']/g, ""); li.hidden = !!q && !t.includes(q); });
  });

  /* ---------- translation + settings controls ---------- */
  /* translation text comes from the Global Quran API, one surah at a time, only for the editions that are chosen */
  async function loadTrs(ids, s = S.s) {
    const need = ids.filter(id => id && !trReady(id, s)); if (!need.length) return;
    try { const got = await GQ.text(s, need); need.forEach(id => { if (got[id]) (S.trCache[id] = S.trCache[id] || [])[s - 1] = got[id]; }); }
    catch (e) { down(e); }
  }
  const loadTr = (id, s) => loadTrs([id], s);
  async function setTranslations(ids) {
    const prev = S.trs; S.trs = [...new Set(ids)];
    stat("translation_change", { count: S.trs.length, first: S.trs[0] || "none", langs: [...new Set(S.trs.map(id => (id.split(".")[0])))].join(",") }); store.set("trs", S.trs.join(","));
    S.retry = () => setTranslations(S.trs); S.undo = () => { S.trs = prev; store.set("trs", prev.join(",")); syncTrChip(); fillTranslations(); syncReciters(); };
    await loadTrs(S.trs); if (!downKind) S.retry = S.undo = null;
    syncTrChip(); fillTranslations(); if (typeof syncReciters === "function") syncReciters();
  }
  const toggleTr = id => setTranslations(S.trs.includes(id) ? S.trs.filter(x => x !== id) : [...S.trs, id]);
  function setSizes(ar, tr) { setVar("--fs-ar", ar); setVar("--fs-tr", tr); store.set("fsAr", ar); store.set("fsTr", tr); $("#optAr").value = ar; $("#optTrSize").value = tr; requestAnimationFrame(() => recalc()); }
  /* translations picker: search, "No translation" on top, chosen ones as chips, languages that open to their translators */
  const enNames = (() => { try { return new Intl.DisplayNames(["en"], { type: "language" }); } catch (e) { return null; } })();
  const langNames = code => {
    let nat = code, en = code;
    try { nat = new Intl.DisplayNames([code], { type: "language" }).of(code) || code; } catch (e) {}
    try { en = (enNames && enNames.of(code)) || code; } catch (e) {}
    return { nat: nat.charAt(0).toUpperCase() + nat.slice(1), en };
  };
  const TP = { open: new Set(), q: "", order: [] };
  function tpOrder() {   // chosen languages first, then A-Z; fixed while the list is open so rows don't jump
    const sel = new Set(S.view === "read" ? [S.rdTr] : S.trs), langs = [...new Set(S.trList.map(t => t.lang))].map(l => ({ l, en: langNames(l).en, on: S.trList.some(t => t.lang === l && sel.has(t.id)) }));
    langs.sort((a, b) => (b.on - a.on) || a.en.localeCompare(b.en)); TP.order = langs.map(x => x.l); TP.open = new Set(langs.filter(x => x.on).map(x => x.l));
  }
  function syncTrChip() {
    const ts = trInfos(), first = ts[0];
    $("#trChipName").textContent = !first ? "No translation" : `${(first.lang || "").toUpperCase()} · ${first.label}` + (ts.length > 1 ? ` +${ts.length - 1}` : "");
    $("#optTrBtn").textContent = !first ? "None" : first.label + (ts.length > 1 ? ` +${ts.length - 1}` : "");
    renderTrList();
  }
  function renderTrList() {
    const body = $("#tpBody"), keep = body.scrollTop, q = TP.q.trim().toLowerCase(), ts = trInfos(), single = S.view === "read", sel = new Set(single ? [S.rdTr] : S.trs);
    $("#tpNone").hidden = single; $("#tpNone").setAttribute("aria-checked", !ts.length);
    $("#tpChosen").innerHTML = ts.length && !single ? `<span class="tc-l">Showing</span>` + ts.map(t => `<button class="chip" data-rm="${esc(t.id)}" title="Remove">${esc(t.label)} <i>✕</i></button>`).join("") : "";
    const order = TP.order.length ? TP.order : [...new Set(S.trList.map(t => t.lang))];
    let html = "";
    order.forEach(l => {
      const all = S.trList.filter(t => t.lang === l), nm = langNames(l), hit = q && [nm.nat, nm.en, l].some(x => x.toLowerCase().includes(q));
      const items = q && !hit ? all.filter(t => (t.label + " " + t.credit).toLowerCase().includes(q)) : all; if (!items.length) return;
      const nSel = all.filter(t => sel.has(t.id)).length, open = !!q || TP.open.has(l);
      html += `<li class="tl"><button class="tl-h" data-l="${esc(l)}" aria-expanded="${open}"><span class="tl-n">${esc(nm.nat)}${nm.en !== nm.nat ? `<small>${esc(nm.en)}</small>` : ""}</span>${nSel ? `<span class="tl-sel">${nSel}</span>` : ""}<span class="tl-c">${all.length}</span><i>›</i></button>`
        + (open ? `<ul class="tl-items">` + items.map(t => `<li><button class="ti" role="${single ? "radio" : "checkbox"}" aria-checked="${sel.has(t.id)}" data-id="${esc(t.id)}"><span class="cb"></span><span class="ti-t">${esc(t.label)}<small>${esc(t.credit)}</small></span></button></li>`).join("") + `</ul>` : "") + `</li>`;
    });
    $("#tpList").innerHTML = html || `<li class="tp-empty">Nothing matches “${esc(TP.q)}”.</li>`;
    body.scrollTop = keep;
  }
  function buildTrList() {
    $("#tpCount").textContent = `${S.trList.length} translations · ${new Set(S.trList.map(t => t.lang)).size} languages`;
    tpOrder(); syncTrChip();
  }
  function openTrPick() { TP.q = ""; $("#tpFilter").value = ""; tpOrder(); renderTrList(); $("#tpBody").scrollTop = 0; if (matchMedia("(hover:hover)").matches) $("#tpFilter").focus({ preventScroll: true }); }
  $("#tpList").addEventListener("click", e => {
    const h = e.target.closest(".tl-h"); if (h) { const l = h.dataset.l; TP.open.has(l) ? TP.open.delete(l) : TP.open.add(l); renderTrList(); return; }
    const b = e.target.closest(".ti"); if (b) { if (S.view === "read") { closePops(); setRdTr(b.dataset.id); } else toggleTr(b.dataset.id); }
  });
  $("#tpChosen").addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (b) toggleTr(b.dataset.rm); });
  $("#tpNone").onclick = () => setTranslations([]);
  $("#tpFilter").addEventListener("input", e => { TP.q = e.target.value; renderTrList(); });
  $("#tpX").onclick = () => closePops();
  $("#optTrBtn").onclick = () => { closeMenu(); closePops(); showKey(false); const [p] = POPS.trpick; if (p.hidden) togglePop("trpick"); };
  $("#trChip").onclick = () => togglePop("trpick");
  $("#optAr").oninput = e => setSizes(+e.target.value, curVar("--fs-tr")); $("#optTrSize").oninput = e => setSizes(curVar("--fs-ar"), +e.target.value);
  $("#btnBigger").onclick = () => setSizes(Math.min(52, curVar("--fs-ar") + 2), Math.min(26, curVar("--fs-tr") + 1));
  $("#btnSmaller").onclick = () => setSizes(Math.max(22, curVar("--fs-ar") - 2), Math.max(13, curVar("--fs-tr") - 1));
  $("#optLayout").onchange = e => { stat("setting_change", { setting: "layout", value: e.target.value }); layoutPref = e.target.value; store.set("layout", layoutPref); inner.className = innerCls(); svinner.className = "inner layout-" + layoutPref; requestAnimationFrame(recalc); };
  $("#optFont").onchange = async e => { const v = e.target.value; stat("setting_change", { setting: "font", value: v }); FONT = v; TJ.on = TJ.want && tjOk(v); syncTajweedUi(); QC.on = v === "mushaf"; root.classList.toggle("font-me", v === "me"); root.classList.toggle("font-kfc", v === "kfc"); store.set("font", v); await prepare(S.s); refreshArabic(); };
  $("#optTheme").onchange = e => { stat("setting_change", { setting: "theme", value: e.target.value }); S.theme = e.target.value; store.set("theme", S.theme); applyTheme(); };
  $("#btnTheme").onclick = () => { S.theme = root.classList.contains("night") ? "day" : "night"; stat("setting_change", { setting: "theme", value: S.theme }); store.set("theme", S.theme); applyTheme(); };
  $("#optCredit").onchange = e => { root.classList.toggle("cite-each", e.target.checked); store.set("credit", e.target.checked ? "1" : ""); requestAnimationFrame(recalc); };
  $("#optTajweed").onchange = e => setTajweed(e.target.checked); $("#btnTajweed").onclick = () => setTajweed(!TJ.on);
  $("#optWbw").onchange = e => { stat("setting_change", { setting: "word_by_word", value: e.target.checked ? "on" : "off" }); WBW.on = e.target.checked; store.set("wbw", WBW.on ? "1" : "0"); syncWbw(); };
  $("#optTlit").onchange = e => setTlit(e.target.checked);
  $("#optFollow").onchange = e => { stat("setting_change", { setting: "follow_scroll", value: e.target.checked ? "on" : "off" }); follow = e.target.checked; store.set("follow", follow ? "1" : "0"); };

  /* ---------- keyboard ---------- */
  const srEl = $("#sr"); let srT = 0;
  function announce(msg) { clearTimeout(srT); srEl.textContent = ""; srT = setTimeout(() => { srEl.textContent = msg; }, 60); }   // polite screen-reader message
  const ARROW = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${{ l: '<path d="M19 12H5M11 6l-6 6 6 6"/>', r: '<path d="M5 12h14M13 6l6 6-6 6"/>' }[d]}</svg>`;
  const cap = k => ({
    left: `<kbd class="kc" aria-label="Left arrow">${ARROW("l")}</kbd>`, right: `<kbd class="kc" aria-label="Right arrow">${ARROW("r")}</kbd>`,
    plus: `<kbd class="kc" aria-label="Plus">+</kbd>`, minus: `<kbd class="kc" aria-label="Minus">&minus;</kbd>`,
    space: `<kbd class="kc kc-w">Space</kbd>`, shift: `<kbd class="kc kc-w">Shift</kbd>`, esc: `<kbd class="kc">Esc</kbd>`, home: `<kbd class="kc">Home</kbd>`, end: `<kbd class="kc">End</kbd>`
  }[k] || `<kbd class="kc">${esc(k.length === 1 ? k.toUpperCase() : k)}</kbd>`);
  /* [keys, ...]: each item is one way to do it; "a+b" is a combination, items are joined with "or" */
  const SHORTCUTS = [
    ["Move around", [
      [["left"], "Previous verse", "Goes to the verse before. If audio is on it plays that verse; in Listen view it shows it."],
      [["right"], "Next verse", "Goes to the next verse. At the end of a surah it carries on into the next surah."],
      [["shift+left", "["], "Previous surah", "Opens the surah before, at its first verse."],
      [["shift+right", "]"], "Next surah", "Opens the surah after, at its first verse."],
      [["home", "end"], "First and last verse", "Home jumps to the first verse of this surah, End to the last."],
      [["g", "/"], "Go to a surah", "Opens the surah list so you can type a name or number."]]],
    ["Listen", [
      [["space", "k"], "Play or pause", "Plays from the verse you are on (with the Bismillah when you start at the top of a surah), or pauses and resumes."],
      [["r"], "Repeat", "Cycles: off, repeat this verse, repeat the whole surah."],
      [["s"], "Stop", "Stops the audio and closes the player."],
      [["<", ">"], "Slower and faster", "Steps the speed through 0.75×, 1×, 1.25× and 1.5×."],
      [["b"], "Save verse", "Adds the verse, or removes it, in your saved verses."],
      [["c"], "Copy verse", "Copies the Arabic, the translation and the reference."]]],
    ["View and settings", [
      [["1", "2", "3"], "Choose the view", "1 is verse by verse, 2 is reading, 3 is Listen (one verse at a time)."],
      [["m"], "Reading mode", "Opens the mode picker (Read, Understand, Listen, Memorise). Press it again, or Esc, to put it away."],
      [["f"], "Focus and full screen", "Hides the menus and buttons so only the page is left, in the view you are using. Press again for full screen, again to go back. Esc steps back."],
      [["t"], "Tajweed colours", "Turns the tajweed colouring on or off."],
      [["d"], "Day or night", "Switches between the day and night look."],
      [["plus", "minus"], "Text size", "Plus makes the Arabic and translation text larger, minus makes it smaller."]]],
    ["Anywhere", [
      [["?"], "Show this list", "Opens and closes the shortcuts."],
      [["esc"], "Close", "Closes the open panel, menu or full screen."]]]
  ];
  const combo = s => s.split("+").map(cap).join('<span class="kbd-plus" aria-hidden="true">+</span>');
  function buildKbd() {
    $("#kbdBody").innerHTML = SHORTCUTS.map(([g, rows]) => `<div class="kbd-g" role="presentation">${esc(g)}</div>` + rows.map(([keys, t, d]) =>
      `<div class="kbd-r"><div class="kbd-k">${keys.map(combo).join('<span class="kbd-or">or</span>')}</div><div class="kbd-t"><b>${esc(t)}</b><span>${esc(d)}</span></div></div>`).join("")).join("");
  }
  buildKbd();
  const kbdEl = $("#kbd"); let kbdFrom = null;
  const kbdOpen = () => !kbdEl.hidden;
  function openKbd() { if (kbdOpen()) return; kbdFrom = document.activeElement; closePops(); kbdEl.hidden = false; $("#kbdClose").focus({ preventScroll: true }); stat("open_panel", { panel: "shortcuts" }); }
  function closeKbd() { kbdEl.hidden = true; if (kbdFrom && kbdFrom.focus && document.contains(kbdFrom)) kbdFrom.focus({ preventScroll: true }); kbdFrom = null; }
  $("#btnKbd").onclick = openKbd; $("#kbdClose").onclick = closeKbd; kbdEl.addEventListener("click", e => { if (e.target === kbdEl) closeKbd(); });
  $("#skip").onclick = e => { e.preventDefault(); (S.mode === "saved" ? svscroll : scroller).focus(); };
  function trapTab(e, box) {   // keep Tab inside an open dialog
    const f = $$("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])", box).filter(x => !x.disabled && x.offsetParent !== null); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  /* moving between verses: while audio plays it jumps the audio; otherwise it moves the page (Listen view: the stage) */
  function goVerse(n) {
    n = clamp(n, 1, S.count); if (A.on) return playAyah(n, A.s);
    jumpAyah(n, { smooth: false, flash: S.view !== "listen" }); setCur(n);
    if (S.view === "listen") lsIdle(n); else if (S.sel !== n) selectAyah(n);
    announce(`Verse ${n}`);
  }
  function navVerse(d) {
    if (S.mode === "saved") return;
    if (A.on) return skip(d);
    const n = (S.view === "listen" && LS.s === S.s && LS.n ? LS.n : (S.sel || S.cur || 1)) + d;
    if (n < 1) return S.s > 1 ? openSurah(S.s - 1, meta(S.s - 1).c, { via: "keyboard" }) : null;
    if (n > S.count) return S.s < 114 ? openSurah(S.s + 1, 1, { via: "keyboard" }) : null;
    goVerse(n);
  }
  const SPEEDS = [0.75, 1, 1.25, 1.5];
  function stepSpeed(d) { const i = clamp(SPEEDS.indexOf(A.speed) + d, 0, SPEEDS.length - 1); setSpeed(SPEEDS[i]); toast(SPEEDS[i] + "× speed"); }
  function onVerse() { const n = A.on ? A.n : (S.view === "listen" && LS.n ? LS.n : (S.sel || S.cur || 1)); return n > 0 && (!A.on || A.s === S.s) ? $("#a" + n, inner) : null; }
  addEventListener("keydown", e => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const t = e.target, k = e.key, key = k.length === 1 ? k.toLowerCase() : k;
    if (t.closest && t.closest("input, select, textarea, [contenteditable=''], [contenteditable='true']")) { if (key !== "Escape" || (t.type === "search" && t.value)) return; t.blur(); }   // never take keys away from typing; Esc in an empty search box closes the panel it is in (a box with text is cleared by the browser first)
    const help = key === "?" || (key === "/" && e.shiftKey);   // "?" is Shift + / on most keyboards
    if (kbdOpen()) { if (key === "Escape" || help) { e.preventDefault(); closeKbd(); } else if (key === "Tab") trapTab(e, kbdEl); return; }
    if (!$("#oops").hidden || !$("#privacy").hidden) return;
    if (help) { e.preventDefault(); return openKbd(); }
    if (key === "Escape") { if (!vpop.hidden) { closeVpop(); return; } if (!shareEl.hidden) { closeShare(); return; } closeMenu(); hideWordTip(); showKey(false); closePops(); if (modesOn()) putAwayModes(); return; }
    const onCtl = t.closest && t.closest("button, a, summary, [role=tab], [role=slider], [role=checkbox]"), inMenu = t.closest && t.closest(".pop, .side, .tj-key");
    const verseKeys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (verseKeys.includes(key) && (inMenu || (t.closest && t.closest("[role=slider]")))) return;   // lists, menus and the ribbon keep their own arrow keys
    switch (key) {
      case "ArrowLeft": case "ArrowRight": e.preventDefault(); e.shiftKey ? openSurah(S.s + (key === "ArrowRight" ? 1 : -1), 1, { via: "keyboard" }) : navVerse(key === "ArrowRight" ? 1 : -1); break;
      case "Home": if (S.mode !== "saved") { e.preventDefault(); goVerse(1); } break;
      case "End": if (S.mode !== "saved") { e.preventDefault(); goVerse(S.count); } break;
      case "[": case "p": openSurah(S.s - 1, 1, { via: "keyboard" }); break;
      case "]": case "n": openSurah(S.s + 1, 1, { via: "keyboard" }); break;
      case "g": case "/": e.preventDefault(); if (POPS.picker[0].hidden) togglePop("picker"); break;
      case " ": if (onCtl) return; e.preventDefault(); togglePlay(); break;
      case "k": togglePlay(); break;
      case "r": $("#plRepeat").click(); break;
      case "s": if (A.on) { stopAudio(); toast("Stopped"); } break;
      case "<": case ",": stepSpeed(-1); break;
      case ">": case ".": stepSpeed(1); break;
      case "b": { const el = onVerse(); if (el) doAction("mark", el); break; }
      case "c": { const el = onVerse(); if (el) doAction("copy", el); break; }
      case "1": if (S.view !== "verse") setView("verse"); announce("Verse by verse view"); break;
      case "2": if (S.view !== "read") setView("read"); announce("Reading view"); break;
      case "3": if (S.view !== "listen") setView("listen"); announce("Listen view"); break;
      case "f": lsMode((lsStageNow() + 1) % 3); break;   // whatever view you are in: it is never changed
      case "m": if (modesOn()) putAwayModes(); else { showTools(false); showModes(true, true); } break;
      case "t": setTajweed(!TJ.on); break;
      case "d": $("#btnTheme").click(); break;
      case "+": case "=": setSizes(clamp(curVar("--fs-ar") + 2, 22, 52), clamp(curVar("--fs-tr") + 1, 13, 26)); break;
      case "-": case "_": setSizes(clamp(curVar("--fs-ar") - 2, 22, 52), clamp(curVar("--fs-tr") - 1, 13, 26)); break;
    }
  });

  /* ---------- host page messages (embedding) ---------- */
  addEventListener("message", e => {
    const d = e.data; if (!d || d.target !== "globalquran") return;
    if (d.type === "goto") openSurah(+d.surah || S.s, +d.ayah || 1);
    if (d.type === "theme") { S.theme = d.value; applyTheme(); }
    if (d.type === "translation") setTranslations(Array.isArray(d.value) ? d.value : trParse(d.value));
    if (d.type === "tajweed") setTajweed(d.value !== false);
    if (d.type === "play") d.value === false ? stopAudio() : playAyah(+d.ayah || S.cur);
  });

  /* ---------- lists from the Global Quran API ---------- */
  function mergeSurahs(d) {
    const L = (d && d.surahList) || {};
    S.data.surahs.forEach(m => { const x = L[m.n]; if (!x) return; m.en = x.name_english || m.en; m.me = x.name_translation || m.me; m.c = x.ayahs || m.c; m.g = x.start_ayah || m.g; m.j = (x.juz && x.juz[0]) || m.j; m.t = x.revelation_type === "Medinan" ? "D" : "M"; });
  }
  const RTL = new Set(["ar", "fa", "ur", "ps", "sd", "ug", "ku", "dv", "he", "yi"]);   // the list has no text direction
  const PREF_TR = { en: "en.sahih", ur: "ur.jalandhry", fr: "fr.hamidullah", id: "id.indonesian", tr: "tr.diyanet", fa: "fa.makarem", ru: "ru.kuliev", de: "de.bubenheim", es: "es.cortes", zh: "zh.jian", hi: "hi.hindi", bn: "bn.bengali", it: "it.piccardo", nl: "nl.keyzer", ms: "ms.basmeih", sq: "sq.ahmeti", sw: "sw.barwani", ta: "ta.tamil", th: "th.thai", pt: "pt.elhayek", pl: "pl.bielawskiego", sv: "sv.bernstrom", ro: "ro.grigore" };
  const mapTranslations = d => Object.entries(d.list || {}).filter(([id, v]) => v.format === "text" && v.type === "translation" && !id.startsWith("quran-"))
    .map(([id, v]) => ({ id, lang: v.language_code, label: v.name || id, credit: v.english_name && v.english_name !== "Unknown" ? v.english_name : (v.name || id), dir: RTL.has(v.language_code) ? "rtl" : "ltr" }))
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.label.localeCompare(b.label));
  const mapRecitors = d => Object.entries(d.list || {}).filter(([, v]) => v.format === "audio")
    .map(([id, v]) => ({ id, lang: v.language_code, name: v.name || v.english_name || id, full: v.english_name || v.name || id, media: v.media || {} }));
  const mapTlit = d => Object.entries(d.quranList || {}).filter(([, v]) => v.type === "transliteration").map(([id, v]) => ({ id, lang: v.language_code }));
  async function loadLists() {
    const out = { tr: [], tl: [{ id: "en.transliteration", lang: "en" }], rec: [{ id: "ar.alafasy", lang: "ar", name: "Alafasy", full: "Mishary Alafasy", media: { "mp3-128": { kbs: "128", type: "mp3", status: "active" } } }] };
    const [t, r, e] = await Promise.allSettled([GQ.translations(), GQ.recitors(), GQ.editions()]);
    if (t.status === "fulfilled") out.tr = mapTranslations(t.value);
    else { out.failed = t.reason; }
    if (r.status === "fulfilled") { const v = mapRecitors(r.value); if (v.length) out.rec = v; }
    if (e.status === "fulfilled") { const v = mapTlit(e.value); if (v.length) out.tl = v; }
    return out;
  }


  /* ---------- Listen view ----------
     One verse on the page at a time, like a slow film: when a verse is recited it fades in; Arabic first, then (when a translation voice follows) the Arabic fades out and
     the translation fades in; then the next verse. Arabic-only or translation-only voices show just that. Not playing: the current verse, Arabic with its translation, and a
     big Play. Paused: everything freezes and dims with a "Paused" mark. The page itself (mushaf glyphs / chosen font, tajweed colours, translation) is the same as elsewhere.
     Behind the text a canvas draws a slow rotating geometric rosette and drifting light motes; it runs while playing, drifts gently when idle, stops when paused. */
  const lsEl = $("#lstage"), lsText = $("#lsText"), lsBody = $("#lsBody"), lsCv = $("#lsCanvas");
  const LS = { openAt: 0, tok: 0, key: "", raf: 0, last: 0, phase: 0, speed: .3, amp: 0, motes: null, still: matchMedia("(prefers-reduced-motion: reduce)").matches };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const lsVis = () => S.view === "listen" && S.mode !== "saved" && !!S.data;
  function lsVisibility() { lsEl.hidden = !lsVis(); if (lsVis()) { lsSize(); lsKick(); } else { cancelAnimationFrame(LS.raf); LS.raf = 0; } }
  async function lsArabicHtml(s, n) {
    if (n === 0) return { html: bismHtml(), cls: qcfOn(1) && QC.on ? "qcf" : "" };
    if (QC.on) { try { await loadQcf(s); } catch (e) {} }
    if (qcfOn(s)) {
      const pages = [...new Set(S.qcf[s][n - 1].map(w => w[4]))]; useFonts(pages);
      await Promise.race([Promise.all(pages.map(fontReady)), sleep(1800)]);
      return { html: qcfWords(s, n), cls: "qcf" };
    }
    return { html: arLine(s, n, arText(s, n)), cls: "" };
  }
  async function lsTrHtml(s, n) {   // the translation that matches the voice that is (or would be) reading, else the first chosen
    const infos = trInfos(); if (!infos.length) return "";
    const rec = TR_REC.find(x => x[0] === trRecId()), t = (rec && infos.find(i => i.lang === rec[1])) || infos[0], ts = n === 0 ? 1 : s, tn = n === 0 ? 1 : n;
    await loadTrs([t.id], ts); const text = trAt(t.id, ts, tn); if (!text) return "";
    return `<div class="ls-tr" dir="${t.dir}" lang="${esc(t.lang)}">${esc(text)}</div><div class="ls-cr">${esc(t.credit)}</div>`;
  }
  function lsFit() {   // shrink until the verse fits the space; never cut it off
    let k = root.classList.contains("ls-focus") ? 1.7 : 1.3; lsText.style.setProperty("--ls-k", k);   // short verses are shown large, long ones shrink to fit
    for (let i = 0; i < 24 && lsText.scrollHeight > lsBody.clientHeight + 1 && k > .3; i++) { k -= .05; lsText.style.setProperty("--ls-k", k.toFixed(2)); }
  }
  async function lsShow(s, n, show, force) {
    const key = s + ":" + n + ":" + show; if (!force && key === LS.key) return; LS.key = key; LS.s = s; LS.n = n;
    const tok = ++LS.tok; lsText.classList.add("out"); await sleep(LS.first ? 0 : 320);
    const [ar, tr] = await Promise.all([show !== "tr" ? lsArabicHtml(s, n) : null, show !== "ar" ? lsTrHtml(s, n) : ""]); if (tok !== LS.tok) return;
    LS.first = false;
    $("#lsRef").textContent = n === 0 ? "Bismillah" : `${meta(s).en} · ${s}:${n}`;
    const both = show === "both" && ar && tr;
    lsText.className = "ls-text out " + (both ? "show-both" : "show-" + show);
    lsText.innerHTML = (ar ? `<div class="ls-ar${ar.cls ? " " + ar.cls : ""}" lang="ar">${ar.html}</div>` : "") + (!ar || tr ? tr : "");
    $$(".ls-ar .w, .ls-ar .qe", lsText).forEach((el, i) => el.style.setProperty("--i", Math.min(i, 40)));   // the words appear one after another (CSS)
    lsFit(); requestAnimationFrame(() => requestAnimationFrame(() => lsText.classList.remove("out")));
  }
  function lsIdle(n) {
    if (!lsVis() || A.on) return;
    n = typeof n === "number" ? n : (S.cur || 1); lsEl.classList.add("idle"); lsEl.classList.remove("playing", "paused"); $("#lsVoiceT").textContent = ""; lsState();
    lsShow(S.s, clamp(n, 1, S.count || 1), S.trs.length ? "both" : "ar");
  }
  function lsStage() {
    if (!lsVis()) return;
    lsEl.classList.remove("idle"); const kind = A.st[A.stage];
    $("#lsVoiceT").textContent = kind === "ar" ? "Quran · " + arShort() : "Translation · " + trShort();
    lsShow(A.s, A.n, kind === "ar" ? "ar" : "tr"); lsState();
  }
  function lsState() {
    const playing = A.on && !A.paused; lsText.setAttribute("aria-live", A.on ? "off" : "polite");   // don't read the verse aloud over the recitation
    lsEl.classList.toggle("playing", playing); lsEl.classList.toggle("paused", A.on && A.paused); lsEl.classList.toggle("idle", !A.on);
    LS.speed = !A.on ? .3 : A.paused ? 0 : 1; if (lsVis()) lsKick();
  }
  function lsAfterOpen(ayah) { if (!lsVis()) return; LS.openAt = Date.now(); LS.key = ""; LS.first = true; A.on ? lsStage() : lsIdle(ayah || 1); }
  $("#lsVoice").onclick = e => { if (plHide) { e.stopPropagation(); }  if (plHide) { plHide = false; lsEl.classList.remove("plhid"); $("#lsVoice").title = ""; showPlayer(true); } };
  /* full screen: the stage fills the screen (real full screen where the browser allows it, otherwise it just covers the page); only the verse and the animation stay.
     Touch or mouse movement shows the controls for a moment; Esc leaves. A tap there reveals them instead of pausing. */
  let lsRevT = 0;
  function lsReveal() { lsEl.classList.add("reveal"); clearTimeout(lsRevT); lsRevT = setTimeout(() => lsEl.classList.remove("reveal"), 2800); }
  /* three stages, like a video player: 0 normal > 1 focus (only the verse and the animation inside the book's frame; menu, header and player hide) > 2 full screen
     (real full screen where the browser allows it; the frame goes too). The same button steps through them and its icon shows the next one; Esc steps back. */
  let lsSideWas = false;
  const lsStageNow = () => root.classList.contains("ls-full") ? 2 : root.classList.contains("ls-focus") ? 1 : 0;
  function lsMode(n) {
    const cur = lsStageNow(); if (n === cur) return;
    if (cur === 0) { lsSideWas = app.classList.contains("side-off"); app.classList.add("side-off"); closePops(); }
    if (n === 0 && !lsSideWas) app.classList.remove("side-off");
    root.classList.toggle("ls-focus", n >= 1); root.classList.toggle("ls-full", n === 2); lsEl.classList.remove("reveal");
    const lab = ["Focus view", "Full screen", "Exit full screen"][n]; [$("#lsFs"), $("#fsBtn")].forEach(b => { b.setAttribute("aria-label", lab); b.title = lab; });
    try { if (n === 2) { const r = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen; r && r.call(document.documentElement); } else if (cur === 2 && document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
    setTimeout(() => { lsSize(); lsFit(); }, 60); announce(["Normal view", "Focus view", "Full screen"][n]); stat("setting_change", { setting: "listen_screen", value: ["normal", "focus", "full"][n] });
  }
  const lsFull = on => lsMode(on ? 2 : 0);
  $("#lsFs").onclick = e => { e.stopPropagation(); lsMode((lsStageNow() + 1) % 3); };
  $("#fsBtn").onclick = () => lsMode((lsStageNow() + 1) % 3);   // verse by verse / reading: the small button in the corner
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && root.classList.contains("ls-full")) lsMode(1); });   // the browser's own Esc: back to focus
  addEventListener("keydown", e => { if (e.key === "Escape" && lsStageNow() && !e.defaultPrevented) lsMode(lsStageNow() - 1); });
  lsEl.addEventListener("pointermove", () => { if (root.classList.contains("ls-full")) lsReveal(); });
  lsEl.addEventListener("click", e => {
    if (e.target.closest("button") || e.target.closest(".ls-text .num")) return;
    if (root.classList.contains("ls-full") && !lsEl.classList.contains("reveal")) return lsReveal();
    togglePlay(); if (root.classList.contains("ls-full")) lsReveal();
  });

  /* the canvas: an illuminated stage. A deep halo, slow light rays, interlaced girih star rings turning against each other, a ring of small khatams, the surah's
     calligraphic name as a faint watermark, drifting motes, and all of it breathing with the recitation itself: an AnalyserNode on the <audio> (the CDN answers with
     Access-Control-Allow-Origin: *, and the element is crossorigin="anonymous", so the samples are readable). Without an analyser the stage breathes on a timer.
     LS.amp (0..1) is also written to --amp on #lstage, so the play button's ring, the equalizer and the text glow follow the voice in CSS. */
  let AN = null;   // { ctx, an, buf } once created; false when the browser cannot
  function anInit() {
    if (AN !== null) return AN;
    try { const C = window.AudioContext || window.webkitAudioContext; if (!C || !audio.crossOrigin) return (AN = false);
      const ctx = new C(), src = ctx.createMediaElementSource(audio), an = ctx.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = .72;
      src.connect(an); an.connect(ctx.destination); AN = { ctx, an, buf: new Uint8Array(an.fftSize) };
    } catch (e) { AN = false; }
    return AN;
  }
  audio.addEventListener("play", () => { anInit(); if (AN && AN.ctx.state !== "running") AN.ctx.resume().catch(() => {}); });
  function anLevel() {   // 0..1 loudness of what is playing right now, or -1 when nothing can be measured
    if (!AN || !A.on || A.paused || A.sim || AN.ctx.state !== "running") return -1;
    AN.an.getByteTimeDomainData(AN.buf); let sum = 0; for (let i = 0; i < AN.buf.length; i += 2) { const v = (AN.buf[i] - 128) / 128; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / (AN.buf.length / 2)) * 3.4);
  }
  function lsSize() {
    const dpr = Math.min(2, devicePixelRatio || 1), w = lsEl.clientWidth, h = lsEl.clientHeight; if (!w || !h) return;
    lsCv.width = Math.round(w * dpr); lsCv.height = Math.round(h * dpr);
    LS.motes = Array.from({ length: Math.round(w * h / 12000) + 16 }, () => ({ x: Math.random(), y: Math.random(), r: .5 + Math.random() * 1.7, v: .00002 + Math.random() * .00005, p: Math.random() * 6.28, tw: Math.random() < .25 }));
    lsDraw(0);
  }
  const P2 = Math.PI * 2;
  function lsStar(g, cx, cy, r, n, step, rot) {   // the {n/step} star polygon: every vertex joined to the one `step` further round
    g.beginPath();
    for (let i = 0; i < n; i++) { const a = rot + i * P2 / n, b = rot + ((i + step) % n) * P2 / n; g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.lineTo(cx + Math.cos(b) * r, cy + Math.sin(b) * r); }
    g.stroke();
  }
  function lsKhatam(g, cx, cy, r, rot) {   // a small eight-pointed star: two squares
    g.beginPath(); for (let k = 0; k < 2; k++) for (let i = 0; i <= 4; i++) { const a = rot + k * Math.PI / 4 + i * Math.PI / 2, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  }
  function lsDraw(dt) {
    const g = lsCv.getContext("2d"), w = lsCv.width, h = lsCv.height; if (!w) return;
    const night = root.classList.contains("night"), col = night ? "222,190,96" : "150,122,40", ph = LS.phase, cx = w / 2, cy = h / 2, R = Math.min(w, h) * .5, u = Math.max(1, w / 800), amp = LS.amp;
    g.clearRect(0, 0, w, h);
    /* the halo: breathes slowly, swells with the voice */
    const br = .5 + .5 * Math.sin(ph * .0012), hal = (night ? .17 : .13) + br * .05 + amp * .3;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, R * (1.05 + amp * .25));
    gr.addColorStop(0, `rgba(${col},${hal.toFixed(3)})`); gr.addColorStop(.45, `rgba(${col},${((night ? .06 : .045) + amp * .05).toFixed(3)})`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    /* light rays, turning very slowly */
    g.save(); g.translate(cx, cy); g.rotate(ph * .000012);
    for (let i = 0; i < 32; i++) {
      const a = i * P2 / 32, wd = .018 + .012 * Math.sin(ph * .0007 + i), al = (night ? .05 : .035) + amp * .06 * (.5 + .5 * Math.sin(ph * .003 + i * 1.7));
      const rg = g.createLinearGradient(0, 0, Math.cos(a) * R * 1.6, Math.sin(a) * R * 1.6); rg.addColorStop(0, `rgba(${col},${al.toFixed(3)})`); rg.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = rg; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R * 1.6, a - wd, a + wd); g.closePath(); g.fill();
    }
    g.restore();
    /* the surah's name in calligraphy, as a watermark behind everything */
    if (LS.s && document.fonts && document.fonts.check("20px SurahNames")) { g.save(); g.font = `${Math.round(R * .9)}px SurahNames`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = `rgba(${col},${((night ? .1 : .085) + amp * .05).toFixed(3)})`; g.fillText(pad3(LS.s), cx, cy); g.restore(); }
    /* girih rings: interlaced star polygons turning against each other (eight-fold family only) */
    g.lineJoin = "round"; g.lineCap = "round";
    const rings = [[.2, 8, 3, -1], [.34, 16, 6, 1], [.5, 16, 5, -1], [.68, 32, 12, 1], [.88, 32, 13, -1]];   // 8-, 16- and 32-fold only: never a count divisible by 3, whose crossings form six-pointed figures
    rings.forEach(([f, n, st, dir], k) => {
      const r = R * f * (1 + .02 * Math.sin(ph * .0009 + k) + amp * .03), al = ((night ? .26 : .22) - k * .035) * (.75 + amp * .5);
      g.lineWidth = (k === 1 || k === 3 ? 1.3 : .9) * u; g.strokeStyle = `rgba(${col},${al.toFixed(3)})`;
      lsStar(g, cx, cy, r, n, st, ph * .00005 * dir * (1 + k * .12) + k * .3);
      g.lineWidth = .7 * u; g.strokeStyle = `rgba(${col},${(al * .5).toFixed(3)})`; g.beginPath(); g.arc(cx, cy, r, 0, P2); g.stroke();
    });
    /* a ring of sixteen small khatams orbiting between the middle rings */
    for (let i = 0; i < 16; i++) {
      const a = ph * .00004 + i * P2 / 16, r = R * .59, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      g.lineWidth = .9 * u; g.strokeStyle = `rgba(${col},${Math.min(1, (night ? .3 : .24) * (.6 + .4 * Math.sin(ph * .002 + i)) + amp * .2).toFixed(3)})`; lsKhatam(g, x, y, R * .035, -a * 2);
    }
    /* motes drifting up, a few of them twinkling */
    if (LS.motes) for (const m of LS.motes) {
      m.y -= m.v * dt; if (m.y < -.02) { m.y = 1.02; m.x = Math.random(); }
      const tw = m.tw ? Math.max(0, Math.sin(ph * .004 + m.p)) ** 6 : 0, a = (.22 + .5 * (.5 + .5 * Math.sin(ph * .002 + m.p))) * (night ? .9 : .6) + tw * .6 + amp * .2;
      g.fillStyle = `rgba(${col},${Math.min(1, a).toFixed(3)})`; g.beginPath(); g.arc(m.x * w, m.y * h, m.r * u * (1 + tw * 1.5), 0, P2); g.fill();
    }
  }
  function lsLoop(now) {
    LS.raf = 0; if (!lsVis() || document.hidden) return;
    const dt = Math.min(64, now - (LS.last || now)); LS.last = now; const sp = LS.still ? 0 : LS.speed; LS.phase += dt * sp;
    const lv = anLevel(), target = lv >= 0 ? lv : (A.on && !A.paused ? .18 + .14 * Math.sin(LS.phase * .003) : 0);
    LS.amp += (target - LS.amp) * (target > LS.amp ? .35 : .08); if (LS.amp < .002) LS.amp = 0;
    lsEl.style.setProperty("--amp", LS.amp.toFixed(3)); lsDraw(dt * sp);
    if (sp > 0 || LS.amp > 0) LS.raf = requestAnimationFrame(lsLoop);
  }
  function lsKick() { if (!LS.raf) { LS.last = 0; LS.raf = requestAnimationFrame(lsLoop); } }
  /* the bottom play button follows the voice the way the stage's big button used to: --amp (0..1, the level the stage uses) drives its ring and glow, in every view */
  const plPlayEl = $("#plPlay"); let plRaf = 0, plAmp = 0;
  function plLoop(now) {
    plRaf = 0; if (document.hidden) return;
    const on = A.on && !A.paused && !plBox.hidden; let target = 0;
    if (on) { const lv = anLevel(); target = lv >= 0 ? lv : .18 + .14 * Math.sin(now * .003); }
    if (lsVis()) plAmp = LS.amp; else { plAmp += (target - plAmp) * (target > plAmp ? .35 : .08); if (plAmp < .002) plAmp = 0; }
    plPlayEl.style.setProperty("--amp", plAmp.toFixed(3));
    if (on || plAmp > 0) plRaf = requestAnimationFrame(plLoop);
  }
  const plKick = () => { if (!plRaf) plRaf = requestAnimationFrame(plLoop); };
  ["play", "pause", "ended"].forEach(ev => audio.addEventListener(ev, plKick));
  new ResizeObserver(() => { if (lsVis()) { lsSize(); lsFit(); } }).observe(lsEl);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && lsVis()) lsKick(); });
  new MutationObserver(() => lsDraw(0)).observe(root, { attributes: true, attributeFilter: ["class"] });   // day / night: redraw at once, even while paused


  /* ---------- reading modes ----------
     A few ready-made ways to use the reader. Four intents (Read, Understand, Listen, Memorise); Read and Listen open a short list that explains each choice. A mode is only a bundle of
     existing settings (view, what is shown, voices, repeat, tajweed). It appears as a note pinned on the book on the very first visit to the landing page (Al-Fatihah), and any time from
     the gear > Mode or the Global Quran logo. Choosing one (or the x) puts it away, and so does opening another surah. */
  const MICON = {
    read: '<path d="M4 5.5c2.5-1 5-1 8 .8 3-1.8 5.5-1.8 8-.8V19c-2.5-1-5-1-8 .8-3-1.8-5.5-1.8-8-.8z"/><path d="M12 6.3v13.5"/>',
    understand: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    listen: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
    memorise: '<path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4"/>'
  };
  const MODES = [
    { id: "read", name: "Read", hint: "On the page", subs: [
      { id: "read_understand", name: "Read & understand", def: true, text: "The Arabic with its translation under every verse, one verse at a time. This is how the page opens." },
      { id: "read", name: "Read", text: "Only the Arabic, in the Madani mushaf style with the tajweed colours, flowing like a printed page. Nothing else to look at." }] },
    { id: "understand", name: "Understand", hint: "Translation first", text: "Reads like a book in your language: the translation flows as plain text, with the verse numbers. Switch the language from the line under the title." },
    { id: "listen", name: "Listen", hint: "Hear the recitation", subs: [
      { id: "listen_ar", name: "Recitation", text: "One verse at a time on a calm screen while it is recited in Arabic. Starts playing at once." },
      { id: "listen_both", name: "Recitation with translation", text: "Each verse is recited in Arabic, then its translation is spoken, and the text on screen follows along." },
      { id: "listen_tr", name: "Translation only", text: "Hear and see just the translation, verse by verse. If your language has no recording it plays the recitation." }] },
    { id: "memorise", name: "Memorise", hint: "Repeat and learn", text: "One verse at a time in Arabic with the tajweed colours, each verse recited three times before the next. Starts playing at once." }
  ];
  const modesEl = $("#modes"), mChips = $("#modesChips"), mSub = $("#modesSub");
  let mOpen = "";
  const mCur = () => store.get("mode") || "read_understand";
  const mTop = id => (MODES.find(m => m.id === id || (m.subs || []).some(s => s.id === id)) || {}).id;
  function drawModes() {
    const cur = mTop(mCur());
    mChips.innerHTML = MODES.map(m => `<button type="button" class="mchip${m.id === cur ? " cur" : ""}" data-m="${m.id}"${m.subs ? ` aria-expanded="${mOpen === m.id}" aria-controls="modesSub"` : ""}><svg viewBox="0 0 24 24" aria-hidden="true">${MICON[m.id]}</svg><b>${esc(m.name)}</b><small>${esc(m.hint)}</small></button>`).join("");
    const m = MODES.find(x => x.id === mOpen), now = mCur();
    /* a mode with choices takes the whole note: the tiles and the intro go, the heading becomes the mode's name, "All modes" leads back */
    mChips.hidden = !!m; modesEl.classList.toggle("sub-open", !!m);
    $("#modesT").textContent = m ? m.name : "How would you like to read today?";
    mSub.hidden = !m; mSub.innerHTML = m ? `<button type="button" class="msub-back" data-back="1"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>All modes</button><p class="msub-h">Choose one. You can change any of it afterwards in the options.</p>` + m.subs.map(s => `<button type="button" class="msub${s.id === now ? " cur" : ""}" data-s="${s.id}"${s.id === now ? ' aria-current="true"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true">${MICON[m.id]}</svg><b>${esc(s.name)}${s.def ? "<em>Default</em>" : ""}</b><span>${esc(s.text)}</span></button>`).join("") : "";
  }
  function showModes(on, focus) {
    modesEl.hidden = !on; if (!on) { mOpen = ""; return; }
    mOpen = ""; drawModes(); stat("open_panel", { panel: "modes" });
    if (focus) { const f = $(".mchip", mChips); f && f.focus({ preventScroll: true }); }
  }
  const modesOn = () => !modesEl.hidden;
  function putAwayModes() { store.set("modes", "1"); showModes(false); }
  async function applyMode(id) {
    putAwayModes(); showTools(false); store.set("mode", id); stat("mode_select", { mode: id });
    const needTr = ["read_understand", "understand", "listen_both", "listen_tr"].includes(id);
    if (needTr && !S.trs.length) await setTranslations([(S.trList.find(t => t.id === "en.sahih") || S.trList[0] || { id: "en.sahih" }).id]);
    const rec = A.reciter || "ar.alafasy", voices = { listen_ar: [rec, ""], listen_both: [rec, "auto"], listen_tr: ["", "auto"], memorise: [rec, ""] }[id];
    if (voices) { A.reciter = voices[0]; store.set("reciter", A.reciter); A.trRec = voices[1]; store.set("rtr", A.trRec); }
    A.times = id === "memorise" ? 3 : 1; syncRepeatUi();
    if ((id === "read" || id === "memorise") && !TJ.on && tjOk(FONT)) await setTajweed(true);
    const view = { read: "read", read_understand: "verse", understand: "read" }[id] || "listen", show = id === "understand" ? "tr" : "ar";
    S.view = view; S.rd = show; store.set("view", view); store.set("rd", show); if (view !== "listen") { S.last = view; store.set("lastview", view); }
    if (!S.trList.some(t => t.id === S.rdTr)) S.rdTr = S.trs[0] || "en.sahih";
    if (readTr()) await loadTr(S.rdTr);
    syncView(); syncTrChip(); syncReciters(); await reRender();
    if (view === "listen") { if (A.on) replay(); else togglePlay(); }
    drawTabs();
    announce(`${(MODES.flatMap(m => m.subs || [m]).find(x => x.id === id) || {}).name} mode`);
  }
  mChips.addEventListener("click", e => {
    const b = e.target.closest("[data-m]"); if (!b) return; const m = MODES.find(x => x.id === b.dataset.m);
    if (m.subs) { mOpen = m.id; drawModes(); const f = $(".msub", mSub); f && f.focus({ preventScroll: true }); } else applyMode(m.id);
  });
  mSub.addEventListener("click", e => {
    if (e.target.closest("[data-back]")) { mOpen = ""; drawModes(); const f = $(".mchip", mChips); f && f.focus({ preventScroll: true }); return; }
    const b = e.target.closest("[data-s]"); if (b) applyMode(b.dataset.s);
  });
  $("#modesX").onclick = putAwayModes;
  $(".brand").addEventListener("click", e => { if (EMBED) return; e.preventDefault(); openSurah(1, 1, { via: "home" }); showModes(true); });   // the logo is the way "home": the landing page and its note

  /* ---------- mode tabs on the book: Read, Understand, Listen, Memorise. Placement: top (default), side or none (then the options bar shows a Mode menu button) ---------- */
  var mtNav = document.createElement("nav"); mtNav.className = "modetabs"; mtNav.id = "modeTabs"; mtNav.setAttribute("aria-label", "Reading mode"); $("#book").appendChild(mtNav);
  var mtMenu = document.createElement("div"); mtMenu.className = "mtmenu"; mtMenu.id = "mtMenu"; mtMenu.setAttribute("role", "menu"); mtMenu.hidden = true; $("#book").appendChild(mtMenu);
  let mtFrom = null, mtCur = "read";
  const TABSET = ["top", "side", "none"];
  const tabsNorm = v => { v = String(v == null ? "" : v).toLowerCase(); return v === "left" ? "side" : ["hidden", "off", "0", "false"].includes(v) ? "none" : TABSET.includes(v) ? v : "top"; };
  function mtVariant(v, save) {
    if (v == null) v = qs.get("tabs") ?? store.get("tabs") ?? window.GQ_TABS;   // the address wins, then the visitor's own choice, then the site's default
    v = tabsNorm(v); if (save) store.set("tabs", v);
    TABSET.forEach(x => root.classList.toggle("mt-" + x, x === v)); mtClose(); $("#optTabs").value = v;
  }
  function drawTabs() {
    if (!mtNav) return; if (mtMenu && !mtMenu.hidden) mtClose(); root.classList.remove("mt-tuck");   // a view or mode change brings the tabs back
    const cur = mtCur = S.view === "listen" ? (A.times === 3 ? "memorise" : "listen") : S.view === "read" && S.rd === "tr" ? "understand" : "read";   // what the page is actually showing
    mtNav.innerHTML = MODES.map(m => `<button type="button" class="mtab${m.id === cur ? " on" : ""}" data-m="${m.id}" ${m.subs ? 'aria-haspopup="menu" aria-expanded="false"' : `aria-pressed="${m.id === cur}"`} title="${esc(m.name)}${m.subs ? " (choose)" : ""}"><svg viewBox="0 0 24 24" aria-hidden="true">${MICON[m.id]}</svg><span>${esc(m.name)}</span>${m.subs ? '<svg class="mt-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>' : ""}</button>`).join("");
  }
  /* a menu under a tab or under the Mode button; nothing changes until a choice is made */
  function mtClose(back) {
    if (mtMenu.hidden) return; mtMenu.hidden = true;
    document.querySelectorAll(".mtab[aria-expanded=true], #segView [aria-expanded=true]").forEach(b => b.setAttribute("aria-expanded", "false"));
    if (back && mtFrom) mtFrom.focus({ preventScroll: true }); mtFrom = null;
  }
  function mtShow(b, html, side, cls) {
    mtMenu.className = "mtmenu" + (cls ? " " + cls : ""); mtMenu.innerHTML = html; mtMenu.hidden = false; mtFrom = b; b.setAttribute("aria-expanded", "true");
    const bk = $("#book").getBoundingClientRect(), r = b.getBoundingClientRect(), w = mtMenu.offsetWidth, h = mtMenu.offsetHeight;
    let x = side ? r.right - bk.left + 8 : r.left - bk.left, y = side ? r.top - bk.top : r.bottom - bk.top + 6;
    x = Math.max(6, Math.min(x, bk.width - w - 6)); y = Math.max(6, Math.min(y, bk.height - h - 6)); mtMenu.style.left = x + "px"; mtMenu.style.top = y + "px";
    const f = mtMenu.querySelector(".mtm.cur") || mtMenu.querySelector(".mtm"); f && f.focus({ preventScroll: true });
  }
  const mtItem = (id, name, text, cur, def) => `<button type="button" role="menuitem" class="mtm${cur ? " cur" : ""}" data-s="${id}" title="${esc(text)}"><b>${esc(name)}${def ? "<em>Default</em>" : ""}</b><span>${esc(text)}</span></button>`;
  mtNav.addEventListener("click", e => {
    const b = e.target.closest(".mtab"); if (!b) return; const m = MODES.find(x => x.id === b.dataset.m);
    if (!m.subs) { mtClose(); applyMode(m.id); return; }
    if (b.getAttribute("aria-expanded") === "true") { mtClose(true); return; }
    mtClose(); showModes(false); const now = mCur();
    mtShow(b, `<p class="mtm-h">${esc(m.name)}: choose one</p>` + m.subs.map(s => mtItem(s.id, s.name, s.text, s.id === now, s.def)).join(""), root.classList.contains("mt-side"));
  });
  /* the options bar's View segment: Listen has choices too, so it opens the same menu under the button (Verse by verse and Reading have none) */
  $("#segView").addEventListener("click", e => {
    const b = e.target.closest("[data-v=listen]"); if (!b) return; e.stopPropagation();
    if (b.getAttribute("aria-expanded") === "true") { mtClose(true); return; }
    mtClose(); showModes(false); const now = mCur(), L = MODES.find(x => x.id === "listen");
    mtShow(b, `<p class="mtm-h">Listen: choose one</p>` + L.subs.map(s => mtItem(s.id, s.name, s.text, s.id === now && mtCur === "listen", s.def)).join(""));
  }, true);
  mtMenu.addEventListener("click", e => { const b = e.target.closest("[data-s]"); if (b) { mtClose(); applyMode(b.dataset.s); } });
  document.addEventListener("pointerdown", e => { if (!mtMenu.hidden && !e.target.closest("#mtMenu, .mtab, #segView [data-v=listen]")) mtClose(); });
  document.addEventListener("keydown", e => {
    if (mtMenu.hidden) return;
    if (e.key === "Escape") { e.stopPropagation(); mtClose(true); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { const it = [...mtMenu.querySelectorAll(".mtm")], i = it.indexOf(document.activeElement); e.preventDefault(); it[(i + (e.key === "ArrowDown" ? 1 : it.length - 1)) % it.length].focus(); }
  }, true);
  { const grip = document.createElement("button"); grip.type = "button"; grip.className = "mt-grip"; grip.setAttribute("aria-label", "Show the mode tabs"); $("#reader").appendChild(grip);
    let last = 0, acc = 0;
    const tuck = on => { if (root.classList.contains("mt-tuck") === on) return; root.classList.toggle("mt-tuck", on); if (on) mtClose(); setTimeout(() => recalc(), 300); };
    scroller.addEventListener("scroll", () => {
      const y = scroller.scrollTop, d = y - last; last = y; if (!d) return;
      acc = Math.sign(d) === Math.sign(acc) ? acc + d : d;
      if (acc > 60 && y > 160) { tuck(true); acc = 0; } else if (acc < -28 || y < 40) { tuck(false); acc = 0; }
    }, { passive: true });
    grip.onclick = () => tuck(false); }
  $("#optTabs").onchange = e => { stat("setting_change", { setting: "tabs", value: e.target.value }); mtVariant(e.target.value, true); requestAnimationFrame(recalc); };
  drawTabs(); mtVariant();

  /* ---------- go ---------- */
  async function init() {
    const route = readAddress();
    const [data, lists] = await Promise.all([fetch("data/surahs.json").then(r => r.json()), loadLists()]);
    const trList = lists.tr; S.data = data; if (lists.failed) { S.undo = S.retry = null; down(lists.failed); }
    // surah names / counts / global start / juz: the API is the source; the local skeleton is only for the very first, offline-safe paint
    try { mergeSurahs(await Promise.race([GQ.surahs(), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 900))])); } catch (e) { GQ.surahs().then(d => { mergeSurahs(d); buildSurahList(); }).catch(() => {}); } S.trList = trList; S.tlList = lists.tl; setVoices(lists.rec);
    const linked = route.eds.filter(id => trList.some(t => t.id === id)); if (linked.length) S.trs = linked;   // translations named in an old-style link
    const legacyTr = (typeof window.GQ_TRANSLATIONS === "string" ? trParse(window.GQ_TRANSLATIONS) : Array.isArray(window.GQ_TRANSLATIONS) ? window.GQ_TRANSLATIONS : (window.gq && window.gq._quran) || []).filter(id => trList.some(t => t.id === id));
    if (hadTr == null && !linked.length && legacyTr.length) S.trs = [...new Set(legacyTr)];   // the site's own default translations (GQ_TRANSLATIONS, or the old gq.quran.add calls); ids we don't have are ignored
    else if (hadTr == null && !linked.length) {   // first visit: a translation in the reader's language if we have one, else English
      const langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"]).map(l => String(l).toLowerCase().split("-")[0]);
      const pick = l => trList.find(t => t.id === PREF_TR[l]) || trList.find(t => t.lang === l);
      const hit = langs.map(pick).find(Boolean); S.trs = [(hit || trList.find(t => t.id === "en.sahih") || trList[0] || { id: "en.sahih" }).id];
    }
    if (!trList.some(t => t.id === S.rdTr)) S.rdTr = S.trs[0] || "en.sahih";
    const asked = S.trs.length; S.trs = S.trs.filter(id => trList.some(t => t.id === id)); if (asked && !S.trs.length) S.trs = [(trList.find(t => t.id === "en.sahih") || trList[0] || { id: "en.sahih" }).id];
    if (!S.tlList.some(x => x.id === TL.id)) { const l0 = String(navigator.language || "en").toLowerCase().split("-")[0]; TL.id = (S.tlList.find(x => x.lang === l0) || S.tlList.find(x => x.lang === "en") || S.tlList[0]).id; }
    buildTlitSelect(); buildTrList();
    $("#optAr").value = curVar("--fs-ar"); $("#optTrSize").value = curVar("--fs-tr");
    $("#optLayout").value = layoutPref; $("#optFont").value = ["mushaf", "me", "amiri", "kfc"].includes(fontPref) ? fontPref : "mushaf";
    $("#optCredit").checked = root.classList.contains("cite-each"); $("#optFollow").checked = follow;
    buildReciters(); setSpeed(A.speed);
    $("#yr").textContent = new Date().getFullYear(); syncMenuBtn();
    $("#btnKey").innerHTML = `<span class="lbl">Tajweed</span>` + [["n", "Madd"], ["g", "Ghunnah"], ["q", "Qalqalah"], ["f", "Ikhfa"], ["a", "Idgham"], ["i", "Iqlab"], ["s", "Silent"]].map(([k, t]) => `<span class="g"><i class="tj-${k}"></i>${t}</span>`).join("") + `<span class="more">KEY ›</span>`;
    $("#legend").innerHTML = $("#legend2").innerHTML = TJ.rules.map(([k, t]) => `<li class="tj-${k}"><i></i><span>${t}</span></li>`).join("");
    syncTajweedUi(); syncWbw(); fillMarkSnippets();
    applyTheme(); buildSurahList(); drawMarks(); syncSavedUi();
    let s = route.s || 0, a = route.a || 1;
    if (route.page) { try { [s, a] = await pageStart(route.page); } catch (e) {} }
    if (!s && store.get("pos")) { const p = store.get("pos").split(":"); s = +p[0]; a = +p[1] || 1; }
    s = clamp(s || 1, 1, 114); a = clamp(a, 1, meta(s).c);
    syncView(); syncTrChip(); syncReciters();
    openSurah(s, a, { flash: false, via: "start" });
    if (!EMBED && !route.s && !route.page && !route.eds.length && route.search == null && !store.get("pos") && !store.get("modes")) showModes(true);   // very first visit, landing page
    if (window.GQA) GQA.start({ mode: store.get("mode") || "default", entry: route.search != null ? "search_link" : route.page ? "page_link" : route.eds.length ? "edition_link" : route.s ? "link" : store.get("pos") ? "resume" : "new", view: S.view, show: S.view === "read" ? S.rd : "both", font: FONT, theme: S.theme, tajweed: TJ.on ? "on" : "off", translit: TL.on ? TL.id : "off", translations: S.trs.length, tr_lang: (S.trs[0] || "none").split(".")[0], device: innerWidth < 720 ? "phone" : innerWidth < 1100 ? "tablet" : "desktop" });
    if (EMBED) parent.postMessage({ source: "globalquran", type: "ready" }, "*");
    if (document.fonts) document.fonts.ready.then(() => recalc());
  }
  /* the address changed in place (a typed #2:255, a link on this page, the back / forward buttons): open that place. The reader writes places with replaceState, which fires nothing, so only outside changes arrive here. */
  async function onAddress() {
    if (EMBED || !S.data || urlMode() === "off") return;
    const r = readAddress(); if (!r.s && !r.page) return;
    let s = r.s || 0, a = r.a || 1; if (r.page) { try { [s, a] = await pageStart(r.page); } catch (e) { return; } }
    s = clamp(s, 1, 114); a = clamp(a, 1, meta(s).c);
    if (s !== S.s || S.mode === "saved") openSurah(s, a, { via: "link" }); else if (a !== (S.cur || 1)) jumpAyah(a, { smooth: true });
  }
  addEventListener("hashchange", onAddress); addEventListener("popstate", onAddress);
  init();
})();
