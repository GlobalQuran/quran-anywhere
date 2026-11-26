/* Languages: which one the reader gets, the words of the interface, and numbers in the reader's own digits. Loaded in <head>, before everything else.
   See rules/languages.md.

   Which language (first that applies):
     1. what the reader chose before (the language list or the "English" button) - never overwritten
     2. the language in the link (/ur/2:255, or ?lang=ur), which is also how an embed asks for one (data-lang)
     3. window.GQ_LANG, set by a site that hosts the reader
     4. the browser's (phone's) language list, in its order
     5. the country, only when the browser names no language at all
     6. English
   "lang" is the reader's language (it chooses translation and voice). "ui" is the language of the menus: the same, or English when we have no menus for it.

   Strings: the English text is the key. lang/<ui>.js sets window.GQ_STRINGS = { "English text": "translation" }; a plural is { "one": "...", "other": "..." }
   (the categories of Intl.PluralRules). {name} places a value; numbers are written in the reader's digits. A missing string shows in English. */
window.GQL = (() => {
  "use strict";
  const VER = "2";   // bump when any lang/*.js changes
  const L = window.GQ_LANGS || { en: { n: "English", e: "English", menus: 1, tr: "en.sahih", pick: 1 } };
  const qs = new URLSearchParams(location.search);
  if (window.GQ_QS) new URLSearchParams(window.GQ_QS).forEach((v, k) => { if (!qs.has(k)) qs.append(k, v); });
  const EMBED = qs.get("embed") === "1";
  const get = k => { if (EMBED) return null; try { return localStorage.getItem("gq2." + k); } catch (e) { return null; } };
  const has = c => !!c && Object.prototype.hasOwnProperty.call(L, c);

  /* a browser tag ("nb-NO", "ckb", "zh-Hant-TW") to one of our codes, or "" */
  const ALIAS = { nb: "no", nn: "no", in: "id", ckb: "ku", mo: "ro", prs: "fa", fil: "tl", arz: "ar", apc: "ar", ary: "ar", aeb: "ar", acm: "ar", afb: "ar", apd: "ar", arq: "ar", ajp: "ar", acq: "ar", ayl: "ar", acw: "ar" };
  function code(tag) {
    const t = String(tag || "").toLowerCase().replace(/_/g, "-"); if (!t) return "";
    const p = t.split("-")[0];
    if (p === "ku" && !/-(arab|iq|ir)\b/.test(t)) return "";   // our Kurdish is Sorani in Arabic letters; a Kurmanji reader cannot read it
    const c = ALIAS[p] || p; return has(c) ? c : "";
  }
  const browser = () => (navigator.languages && navigator.languages.length ? [...navigator.languages] : [navigator.language]).filter(Boolean);

  /* language addresses (/ur/2:255) are only recognised on our own site: someone else's copy may live in a folder called /de/ */
  const pathsOk = window.GQ_LANG_PATHS === true || /^((www\.)?globalquran\.com|localhost|127\.0\.0\.1)$/i.test(location.hostname);
  const basePath = () => new URL(document.baseURI).pathname.replace(/[^/]*$/, "");
  const pathLang = () => { if (!pathsOk || EMBED) return ""; const b = basePath(), p = location.pathname; if (!p.startsWith(b)) return ""; const s = p.slice(b.length).split("/")[0].toLowerCase(); return has(s) ? s : ""; };
  const inPath = pathLang();

  const saved = has(get("lang")) ? get("lang") : "";
  const linked = inPath || code(qs.get("lang"));
  const hosted = code(window.GQ_LANG);
  const fromBrowser = browser().map(code).find(Boolean) || "";
  const geo = has(get("geo")) ? get("geo") : "";
  const lang = saved || linked || hosted || fromBrowser || (browser().length ? "" : geo) || "en";
  const info = L[lang], ui = info.menus ? lang : "en", rtl = !!L[ui].rtl;

  /* numbers follow the menu language; Settings > Numbers can ask for 0-9. Arabic as written in Morocco, Algeria and Tunisia uses 0-9. */
  const zero = L[ui].digits || 0;
  const west = ui === "ar" && /^ar-(ma|dz|tn)\b/i.test(browser().find(t => /^ar\b/i.test(t)) || "");
  const pref = qs.get("digits") || get("digits") || "";
  const native = !!zero && (pref === "native" || (pref !== "latn" && !west));
  const DIGITS = native ? Array.from({ length: 10 }, (_, i) => String.fromCharCode(zero + i)) : null;
  const num = s => DIGITS ? String(s).replace(/[0-9]/g, d => DIGITS[+d]) : String(s);
  /* any script's digits back to 0-9, so a search or a jump box accepts what the reader types */
  const ZEROS = [1632, 1776, 1984, 2406, 2534, 2662, 2790, 2918, 3046, 3174, 3302, 3430, 3664, 3792, 3872, 4160, 6112, 65296];
  const asc = s => String(s).replace(/[^\x00-\x7f]/g, ch => { const c = ch.charCodeAt(0), z = ZEROS.find(x => c >= x && c <= x + 9); return z === undefined ? ch : String(c - z); });

  const root = document.documentElement;
  root.lang = ui === "no" ? "nb" : ui; root.dir = rtl ? "rtl" : "ltr";
  if (native) root.setAttribute("data-digits", String(zero));
  if (ui !== "en") document.write('<script src="lang/' + ui + '.js?v=' + VER + '"><\/script>');

  /* ---------- words ---------- */
  const entry = k => { const S = window.GQ_STRINGS; return S && Object.prototype.hasOwnProperty.call(S, k) ? S[k] : null; };
  const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v && v[k] != null ? (typeof v[k] === "number" ? num(v[k]) : String(v[k])) : m);
  function t(key, vars) {
    let s = entry(key); if (s && typeof s === "object") s = s.other;
    return fill(num(s == null ? key : s), vars);
  }
  let rules = null;
  function tn(n, one, other, vars) {
    let s = entry(other);
    if (s && typeof s === "object") { try { rules = rules || new Intl.PluralRules(ui); s = s[rules.select(n)] || s.other; } catch (e) { s = s.other; } }
    if (s == null) s = n === 1 ? one : other;
    return fill(num(s), Object.assign({ n }, vars));
  }

  /* the words already written in index.html: text and labels are looked up as they stand */
  const SKIP = "script,style,textarea,.sn,.s-cal,.ar,[lang=ar]:not(html),[data-noi18n]", ATTRS = ["aria-label", "title", "placeholder", "alt"];
  function apply(el) {
    if (ui === "en" || !el) return;
    el.querySelectorAll("[data-i18n-html]").forEach(e => {
      const vars = {}; e.querySelectorAll("[data-slot]").forEach(c => { vars[c.dataset.slot] = c.outerHTML; });
      e.innerHTML = t(e.getAttribute("data-i18n-html"), vars); e.setAttribute("data-noi18n", "");
    });
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    nodes.forEach(n => {
      const raw = n.nodeValue, key = raw.replace(/\s+/g, " ").trim(); if (!key || (n.parentElement && n.parentElement.closest(SKIP))) return;
      const out = t(key); if (out !== key) n.nodeValue = (/^\s/.test(raw) ? " " : "") + out + (/\s$/.test(raw) ? " " : "");
    });
    [el, ...el.querySelectorAll("*")].forEach(e => ATTRS.forEach(a => { const v = e.getAttribute && e.getAttribute(a); if (v && !e.closest("[data-noi18n]")) { const out = t(v); if (out !== v) e.setAttribute(a, out); } }));
  }

  /* a language's name in its own script and in English */
  function names(c) {
    if (has(c)) return { nat: L[c].n, en: L[c].e };
    let nat = "", en = "";
    try { nat = new Intl.DisplayNames([c], { type: "language", fallback: "none" }).of(c) || ""; } catch (e) {}
    try { en = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" }).of(c) || ""; } catch (e) {}
    nat = nat || en || String(c).toUpperCase(); return { nat: nat.charAt(0).toUpperCase() + nat.slice(1), en: en || nat };
  }

  /* ---------- choosing a language ---------- */
  const of = id => String(id || "").split(".")[0];
  /* What picking a language changes (it overrides translation and voice, user's rule): the translations of the language being left are removed, one of the
     new language already on the page stays, else its default is added; the voice becomes the new language's, or none. Arabic: the Quran only.
     Only ONE translation of the new language is ever selected by itself.
     cur = { trs: [...], rtr: "auto" | "" | id, tr / voice: the new language's default, fallback: the English default, has: id => the translation exists }. Returns the settings to store. */
  function plan(next, cur) {
    const to = L[next], exists = cur.has || (() => true), set = { lang: next };
    if (next === "ar") Object.assign(set, { trs: "", rtr: "", rdtr: "", rd: "ar", tajweed: "1", tlit: "0" });
    else {
      const kept = cur.trs.filter(id => of(id) === next);
      const usual = cur.tr || (to.tr && exists(to.tr) ? to.tr : "");
      const add = [kept.length ? (kept.includes(usual) ? usual : kept[0]) : usual || cur.fallback || "en.sahih"];
      const others = cur.trs.filter(id => of(id) !== next && of(id) !== lang);
      set.trs = add.concat(others).join(","); set.rdtr = add[0];
      const voice = cur.voice || to.voice;
      set.rtr = voice ? (of(cur.rtr) === next ? cur.rtr : voice) : "";
      if (lang === "ar") set.tlit = "1";
    }
    set.tlid = to.tl || "en.transliteration";
    return set;
  }

  /* the part of a path address that names the language ("ur/"), or "" */
  const prefix = (c = ui) => pathsOk && c !== "en" && L[c] && L[c].menus ? c + "/" : "";

  /* open the page again in another language (called after the choice is stored). paths = the reader writes path addresses (/2:255) */
  function go(next, paths, place) {
    const u = new URL(location.href);
    ["lang", "tr", "trs", "rtr", "t", "m", "l", "r", "v", "tajweed", "tlit", "tlid"].forEach(k => u.searchParams.delete(k));
    if (EMBED) { u.searchParams.set("lang", next); if (place) { u.searchParams.set("surah", place.s); u.searchParams.set("ayah", place.a); } }
    else if (paths) { const b = basePath(); let rest = u.pathname.startsWith(b) ? u.pathname.slice(b.length) : ""; if (pathLang()) rest = rest.split("/").slice(1).join("/"); u.pathname = b + prefix(L[next].menus ? next : "en") + rest; }
    try { history.replaceState(null, "", u.href); location.reload(); } catch (e) { location.href = u.href; }
  }

  /* the browser's first language, when we cannot give all of it: counted (without any identity) so the next language to add can be chosen */
  function missing() {
    const tag = String(browser()[0] || "").toLowerCase().split("-")[0]; if (!/^[a-z]{2,3}$/.test(tag)) return null;
    const c = code(browser()[0]), i = c ? L[c] : null;
    const m = { menus: !(i && i.menus), translation: c !== "ar" && !(i && i.tr), voice: c !== "ar" && !(i && i.voice) };
    return m.menus || m.translation || m.voice ? { lang: tag, missing: Object.keys(m).filter(k => m[k]) } : null;
  }

  /* a browser that names no language at all (rare): the country the host reports, remembered for next time */
  const COUNTRY = { ar: "SA AE EG IQ JO KW LB LY MA OM PS QA SD SY TN YE BH DZ MR", ur: "PK", fa: "IR AF", fr: "FR SN CI ML NE BF GN", tr: "TR", id: "ID", ms: "MY BN", bn: "BD", de: "DE AT", es: "ES MX AR CO PE CL VE EC GT CU BO DO HN PY SV NI CR PA UY", it: "IT", ru: "RU BY KG", zh: "CN TW HK", nl: "NL SR", pt: "PT BR AO MZ", bg: "BG", cs: "CZ", pl: "PL", ro: "RO MD", sv: "SE", no: "NO", ja: "JP", ko: "KR", th: "TH", bs: "BA", sq: "AL XK", sw: "TZ", az: "AZ", so: "SO", si: "LK", tg: "TJ", uz: "UZ", dv: "MV" };
  if (!EMBED && !saved && !linked && !hosted && !browser().length && !geo) {
    fetch("/cdn-cgi/trace").then(r => r.ok ? r.text() : "").then(x => {
      const cc = (/^loc=([A-Z]{2})$/m.exec(x) || [])[1], c = cc && Object.keys(COUNTRY).find(k => COUNTRY[k].split(" ").includes(cc));
      if (c) { localStorage.setItem("gq2.geo", c); if (c !== lang) location.reload(); }
    }).catch(() => {});
  }

  return {
    VER, LANGS: L, lang, ui, rtl, native, zero, hasDigits: !!zero, chosen: !!saved, source: saved ? "chosen" : linked ? "link" : hosted ? "site" : fromBrowser ? "browser" : "default",
    info, code, browser: () => browser().map(code).find(Boolean) || "", t, tn, num, asc, apply, names, plan, go, prefix, pathLang, pathsOk, missing
  };
})();
