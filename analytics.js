/* Global Quran usage statistics (Google Analytics 4) with consent.
   Runs ONLY on globalquran.com / www.globalquran.com (never inside an embed or an iframe). Anywhere else it does nothing and shows nothing, unless the host
   sets window.GQ_GA = true (and window.GQ_GA_ID = "G-...") or the page is opened with ?ga=debug (then events also show in GA4 DebugView).

   Consent: in the EU / EEA / UK / Switzerland (guessed from time zone and browser language, so it is a little over-inclusive) nothing is loaded or stored
   until the person presses Allow. Elsewhere statistics run from the start and can be turned off in Settings > "Share anonymous usage statistics".
   "Do Not Track" / Global Privacy Control count as No. No advertising features, no Google signals, no personal data, no typed text, no one's list of saved verses. It does note WHICH verse is saved / copied / played (anonymous, to learn the most-loved verses).
   The choice is kept in localStorage (gq2.consent = granted | denied). app.js talks to this file only through GQA.track(name, params) / GQA.start(params). */
(() => {
  "use strict";
  const ID = "G-CSMH8ZXD5S";   // window.GQ_GA_ID || (We have removed so its a fixed) - GA4 property 397794074, stream "GlobalQuran.com - GA4"
  const qs = new URLSearchParams(location.search);
  let inFrame = false; try { inFrame = window.top !== window; } catch (e) { inFrame = true; }
  const ours = /^(www\.)?globalquran\.com$/i.test(location.hostname), debug = qs.get("ga") === "debug" || qs.get("ga") === "eu";   // ?ga=eu also pretends to be in the EU (to try the consent card)
  const enabled = !inFrame && qs.get("embed") !== "1" && window.GQ_GA !== false && !!ID && (window.GQ_GA === true || ours || debug);
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: k => v => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const $ = s => document.querySelector(s);

  const EEA = new Set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH".split(" "));
  function needsConsent() {
    if (qs.get("ga") === "eu") return true;
    try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; if (/^Europe\//.test(tz) || /^Atlantic\/(Canary|Madeira|Azores|Reykjavik|Faroe)$/.test(tz) || tz === "Africa/Ceuta") return true; } catch (e) {}
    return (navigator.languages || [navigator.language || ""]).some(l => { const r = String(l).split("-")[1]; return !!r && EEA.has(r.toUpperCase()); });
  }
  const optedOut = () => navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
  const mode = () => ls.get("gq2.consent") || (optedOut() ? "denied" : needsConsent() ? "unset" : "granted");   // granted | denied | unset (waiting for an answer)

  let loaded = false, startParams = null, startSent = false;
  const push = function () { (window.dataLayer = window.dataLayer || []).push(arguments); };

  function load() {
    if (loaded) return; loaded = true; window["ga-disable-" + ID] = false;
    push("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    push("js", new Date());
    push("config", ID, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, cookie_flags: "SameSite=Lax;Secure", cookie_domain: ours ? "globalquran.com" : "auto", debug_mode: debug });
    const s = document.createElement("script"); s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ID); document.head.appendChild(s);
  }
  function wipe() {   // stop sending and remove what was stored
    window["ga-disable-" + ID] = true; if (loaded) push("consent", "update", { analytics_storage: "denied" });
    const hosts = ["", location.hostname, "." + location.hostname.replace(/^www\./, "")];
    document.cookie.split(";").map(c => c.split("=")[0].trim()).filter(n => /^_ga(_|$)/.test(n)).forEach(n => hosts.forEach(h => { document.cookie = n + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/" + (h ? "; domain=" + h : ""); }));
  }
  const active = () => enabled && mode() === "granted" && loaded;

  function track(name, params) {
    if (!active()) return;
    const p = {}; for (const k in params || {}) { const v = params[k]; if (v !== undefined && v !== null && v !== "") p[k] = typeof v === "string" ? v.slice(0, 100) : v; }
    push("event", name, p);
  }
  function sendStart() {
    if (startSent || !startParams || !active()) return; startSent = true;
    const u = {}; ["view", "show", "font", "theme", "tajweed", "translit", "device", "mode"].forEach(k => { if (startParams[k] !== undefined) u[k] = String(startParams[k]); });
    push("set", "user_properties", u); track("app_open", startParams);
  }
  const start = p => { startParams = p; sendStart(); };

  /* ---------- the small interface: a quiet card inside the page frame, a details panel, a Settings row ---------- */
  function ui() {
    const banner = $("#cookie"), panel = $("#privacy"), row = $("#setStats"), chk = $("#optStats");
    if (!banner || !panel) return;
    const state = () => {
      const m = mode(); banner.hidden = m !== "unset";
      if (chk) chk.checked = m === "granted";
      $("#prState").textContent = m === "granted" ? "Statistics are on." : m === "denied" ? "Statistics are off." : "No choice made yet: statistics are off.";
      $("#prToggle").textContent = m === "granted" ? "Turn off" : "Allow";
    };
    const set = v => {
      ls.set("gq2.consent")(v);
      if (v === "granted") { window["ga-disable-" + ID] = false; if (loaded) push("consent", "update", { analytics_storage: "granted" }); load(); sendStart(); track("consent_update", { choice: "granted" }); } else { if (loaded) track("consent_update", { choice: "denied" }); wipe(); }
      state();
    };
    if (row) row.hidden = false;
    $("#ckAllow").onclick = () => set("granted"); $("#ckNo").onclick = () => set("denied");
    const open = () => { panel.hidden = false; state(); $("#prClose").focus({ preventScroll: true }); };
    const close = () => { panel.hidden = true; };
    $("#ckMore").onclick = e => { e.preventDefault(); open(); };
    const more = $("#statsMore"); if (more) more.onclick = e => { e.preventDefault(); e.stopPropagation(); open(); };
    if (chk) chk.onchange = () => set(chk.checked ? "granted" : "denied");
    $("#prToggle").onclick = () => set(mode() === "granted" ? "denied" : "granted");
    $("#prClose").onclick = close; panel.addEventListener("click", e => { if (e.target === panel) close(); });
    addEventListener("keydown", e => { if (e.key === "Escape" && !panel.hidden) close(); });
    window.GQA.open = open; state();
  }

  window.GQA = { enabled, track, start, open: () => {}, consent: mode };
  if (!enabled) return;
  if (mode() === "granted") load();
  const ready = () => { ui(); };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", ready) : ready();
})();
