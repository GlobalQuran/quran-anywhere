/* Global Quran reader: optional sign-in.
 *
 * Nothing here is needed to read. Saved verses, the place you stopped and settings live on the device as before; signing in
 * only keeps them on every device. Three places ask, none of them a wall:
 *   - a small card next to the Save button, right after a verse is saved (also in embeds, where sign-in opens in a window)
 *   - a Sign in card on the menu's Saved tab (once signed in, Sign out is at the top of Settings)
 *   - on a return visit, Google's "Continue as ..." card; and from the 5th visit a small "pick up where you stopped" pill
 * Closing a card with its x hides asking for 3 days; after 3 closes it never asks again. The pill has its own schedule (see below).
 *
 * Turn it off with ?login=0, window.GQ_LOGIN = false, or data-login="0" on the embed.
 * Embeds are on globalquran.com inside an iframe, so third-party cookies may be blocked: they sign in through a popup and
 * receive a short-lived token (kept for the tab only) instead of using the cookie.
 */
(function () {
  "use strict";
  const qs = new URLSearchParams(location.search);
  const App = window.GQApp;
  if (!App || qs.get("login") === "0" || window.GQ_LOGIN === false) return;
  const EMBED = App.EMBED;

  /* ---------- where things are (overrides only for local testing or our own hosts) ---------- */
  const okHost = h => h === "localhost" || h === "127.0.0.1" || /(^|\.)globalquran\.com$/.test(h);
  const base = (v, fallback) => { try { const u = new URL(v); return okHost(u.hostname) ? u.origin : fallback; } catch (e) { return fallback; } };
  const AUTH = base(window.GQ_AUTH_URL || qs.get("auth"), "https://api-login.globalquran.com");
  const LOGIN = base(window.GQ_LOGIN_URL || qs.get("loginurl"), "https://login.globalquran.com");

  /* ---------- small storage helpers (never throw; fall back to memory) ---------- */
  const mem = {}; const P = EMBED ? "gq2e." : "gq2.";
  const kv = {
    get(k) { try { const v = localStorage.getItem(P + k); if (v != null) return v; } catch (e) {} return mem[k] ?? null; },
    set(k, v) { mem[k] = v; try { localStorage.setItem(P + k, v); } catch (e) {} },
    del(k) { delete mem[k]; try { localStorage.removeItem(P + k); } catch (e) {} },
  };
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return mem["s" + k] ?? null; } }, set(k, v) { mem["s" + k] = v; try { sessionStorage.setItem(k, v); } catch (e) {} } };

  /* ---------- how often we may ask ---------- */
  const DAYS = 3, MAX = 3;
  const nag = () => { try { return JSON.parse(kv.get("nag") || "{}"); } catch (e) { return {}; } };
  const mayAsk = () => { const s = nag(); return (s.n || 0) < MAX && Date.now() - (s.t || 0) > DAYS * 864e5; };
  const closedByUser = () => { const s = nag(); kv.set("nag", JSON.stringify({ n: (s.n || 0) + 1, t: Date.now() })); };

  /* ---------- state ---------- */
  let user = null;     // { user_id, name, email }
  let token = null;    // embeds only: { t, exp }
  let providers = null; // { providers: [...], googleClientId }
  let applying = false;
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  async function api(path, opt = {}) {
    const h = { Accept: "application/json" };
    if (opt.body) h["Content-Type"] = "application/json";
    if (EMBED) { if (!token || token.exp < Date.now()) { const e = new Error("signed out"); e.status = 401; throw e; } h.Authorization = "Bearer " + token.t; }
    const r = await fetch(AUTH + path, { method: opt.method || "GET", headers: h, body: opt.body ? JSON.stringify(opt.body) : undefined, credentials: EMBED ? "omit" : "include" });
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  const loadProviders = () => providers ? Promise.resolve(providers) : fetch(AUTH + "/api/gq/providers").then(r => r.json()).then(p => (providers = p)).catch(() => (providers = { providers: [] }));

  /* ---------- what is kept ---------- */
  const SET_KEYS = ["trs", "rtr", "reciter", "theme", "font", "fsAr", "fsTr", "layout", "speed", "tajweed", "tlit", "wbw", "credit", "follow", "rdtr", "rd", "tabs", "view", "lastview", "mode", "modes", "tlid", "lsbg", "keyhide", "tr"];
  function collect() {
    const d = { bm: App.getBms() };
    if (!EMBED) {   // an embed only keeps saved verses: the host page decides the look and where it opens
      const pos = App.store.get("pos"); if (pos) d.pos = pos;
      const set = {}; SET_KEYS.forEach(k => { const v = App.store.get(k); if (v != null && v !== "") set[k] = String(v); }); d.set = set;
    }
    return d;
  }
  function apply(data, allowSettings) {
    applying = true;
    try {
      if (Array.isArray(data.bm)) { const a = App.getBms().slice().sort().join(","), b = data.bm.slice().sort().join(","); if (a !== b) App.setBms(data.bm); }
      if (!EMBED && data.pos) App.store.set("pos", data.pos);
      if (!EMBED && allowSettings && data.set) {
        let changed = false;
        Object.entries(data.set).forEach(([k, v]) => { if (String(App.store.get(k) ?? "") !== v) { App.store.set(k, v); changed = true; } });
        if (changed && !ss.get("gq.reloaded")) { ss.set("gq.reloaded", "1"); applying = false; location.reload(); }
      }
    } finally { applying = false; }
  }
  async function pull(fresh) {
    const id = String(user.user_id);
    if (kv.get("syncUser") !== id) {   // first time on this device: put what is saved here together with the account's
      const r = await api("/api/gq/sync", { method: "PUT", body: { merge: true, data: collect() } });
      apply(r.data, true); kv.set("syncUser", id); kv.set("dirty", "0");
    } else if (kv.get("dirty") === "1") { await push();
    } else { const r = await api("/api/gq/sync"); apply(r.data, !fresh); }
  }
  let pushT = 0;
  async function push() {
    if (!user) return;
    try { await api("/api/gq/sync", { method: "PUT", body: { data: collect() } }); kv.set("dirty", "0"); }
    catch (e) { if (e.status === 401) { user = null; token = null; ss.set("gq.tok", ""); renderSide(); } }
  }
  addEventListener("gq:store", e => {
    const k = e.detail && e.detail.k; if (applying) return;
    if (k === "bm" || (!EMBED && (k === "pos" || SET_KEYS.includes(k)))) { kv.set("dirty", "1"); if (user) { clearTimeout(pushT); pushT = setTimeout(push, 1500); } }
  });

  /* ---------- signing in ---------- */
  function startSignIn(method) {
    const u = new URL(LOGIN + "/");
    u.searchParams.set("mode", "popup"); u.searchParams.set("origin", location.origin); u.searchParams.set("reason", "save");
    if (method) u.searchParams.set("provider", method);
    const w = window.open(u.href, "gq-login", "popup=yes,width=440,height=700");
    if (!w) {   // pop-ups blocked: on the website go there and come back; an embed asks to allow them
      if (!EMBED) { const f = new URL(LOGIN + "/"); f.searchParams.set("reason", "save"); f.searchParams.set("redirect", location.href); location.href = f.href; }
      else App.toast("Allow pop-ups to sign in");
      return;
    }
    const t = setInterval(() => { if (w.closed) { clearInterval(t); if (!EMBED && !user) checkSession(true); } }, 700);
  }
  addEventListener("message", e => {
    if (e.origin !== LOGIN) return;
    const d = e.data; if (!d || d.type !== "gq-login" || !d.token) return;
    if (EMBED) {
      token = { t: d.token, exp: Date.now() + Math.max(60, d.expires_in || 900) * 1000 - 5000 };
      user = d.user || {};
      ss.set("gq.tok", JSON.stringify({ token, user }));
      signedIn(true);
    } else checkSession(true);
  });
  async function checkSession(fresh) {
    try { const s = await api("/api/gq/session"); user = s.user; } catch (e) { user = null; }
    if (user) signedIn(fresh); else renderSide();
  }
  async function signedIn(fresh) {
    closeCard(); closePill(); renderSide();
    try { await pull(fresh); } catch (e) { /* offline or server down: everything stays on the device and is sent next time */ }
    if (fresh) App.toast("Signed in" + (user.name ? " as " + user.name : "") + ". Saved verses are kept on every device.");
  }
  async function signOut() {
    try { if (!EMBED) await fetch(AUTH + "/api/v1/auth/logout", { method: "POST", credentials: "include" }); } catch (e) {}
    user = null; token = null; ss.set("gq.tok", ""); kv.del("syncUser"); kv.set("dirty", "0");
    renderSide(); App.toast("Signed out. Your saved verses stay on this device.");
  }

  /* ---------- the card next to Save ---------- */
  const G = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.5z"/><path fill="#34A853" d="M12 22.5c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7A10.5 10.5 0 0 0 12 22.5z"/><path fill="#FBBC05" d="M6.2 14.1a6.300 6.300 0 0 1 0-4.200V7.200H2.700a10.500 10.500 0 0 0 0 9.600z"/><path fill="#EA4335" d="M12 5.800c1.500 0 2.800.5 3.900 1.500l2.900-2.900A10.500 10.500 0 0 0 2.700 7.200l3.500 2.700C7 7.600 9.300 5.800 12 5.800z"/></svg>';
  const A = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="#fff"><path d="M16.400 12.700c0-2.300 1.900-3.400 2-3.500-1.100-1.600-2.800-1.800-3.400-1.800-1.400-.1-2.800.9-3.500.9s-1.800-.8-3-.8c-1.500 0-3 .9-3.800 2.300-1.600 2.800-.4 7 1.200 9.300.8 1.100 1.700 2.400 2.900 2.300 1.200 0 1.600-.7 3-.7s1.800.7 3 .7c1.300 0 2.100-1.100 2.800-2.200.9-1.300 1.300-2.500 1.300-2.600-.1 0-2.500-1-2.500-3.900zM14.200 5.800c.6-.8 1.100-1.900.9-3-.9 0-2.100.6-2.700 1.400-.6.7-1.100 1.800-1 2.900 1.100.1 2.200-.5 2.800-1.300z"/></svg>';
  let card = null, shown = false, offClick = null;
  function closeCard() { if (card) { card.remove(); card = null; } removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", offClick, true); }
  const onKey = e => { if (e.key === "Escape") closeCard(); };
  async function showCard(anchor) {
    if (card || shown || user) return; shown = true;
    const p = await loadProviders(); if (user || card) return;
    const have = new Set(p.providers || []);
    card = el("div", "sg-card"); card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "Keep your saved verses on every device");
    card.innerHTML = '<button class="sg-x" aria-label="Close">×</button><h3>Saved on this device</h3><p>Sign in to keep your saved verses, where you stopped and your settings on every device.</p>' +
      (have.has("google") ? '<button class="sg-b" data-m="google">' + G + 'Continue with Google</button>' : "") +
      (have.has("apple") ? '<button class="sg-b sg-a" data-m="apple">' + A + 'Continue with Apple</button>' : "") +
      (have.size ? '<button class="sg-link" data-m="email">Use email instead</button>' : '<button class="sg-b" data-m="email">Continue with email</button>');
    document.body.appendChild(card);
    card.addEventListener("click", e => {
      if (e.target.closest(".sg-x")) { closedByUser(); closeCard(); return; }
      const b = e.target.closest("[data-m]"); if (b) startSignIn(b.dataset.m);
    });
    place(card, anchor);
    addEventListener("keydown", onKey);
    offClick = e => { if (card && !card.contains(e.target)) closeCard(); };
    setTimeout(() => document.addEventListener("pointerdown", offClick, true), 0);   // clicking elsewhere just puts it away (no count)
  }
  function place(c, a) {
    const vw = innerWidth, vh = innerHeight;
    if (vw < 460) { c.classList.add("sheet"); return; }   // narrow: a bottom sheet
    if (!a || !a.getBoundingClientRect) { c.style.left = Math.max(10, (vw - c.offsetWidth) / 2) + "px"; c.style.top = Math.max(10, vh - c.offsetHeight - 90) + "px"; c.classList.add("noarrow"); c.style.setProperty("--ax", "-99px"); return; }
    const r = a.getBoundingClientRect(), w = c.offsetWidth, h = c.offsetHeight;
    const left = Math.max(10, Math.min(vw - w - 10, r.left + r.width / 2 - 36));
    const below = r.bottom + 14 + h < vh;
    c.style.left = left + "px"; c.style.top = (below ? r.bottom + 12 : Math.max(10, r.top - 12 - h)) + "px";
    if (!below) c.classList.add("up");
    c.style.setProperty("--ax", Math.max(14, r.left + r.width / 2 - left - 5) + "px");
  }
  addEventListener("gq:saved", () => {
    if (user || !mayAsk()) return;
    const btn = document.querySelector(".ayah.sel [data-act=mark]");
    const vis = btn && btn.getBoundingClientRect().height ? btn : null;
    setTimeout(() => showCard(vis), 250);
  });

  /* ---------- the menu (website only): "Sign in" on the Saved tab, "Sign out" at the top of Settings ---------- */
  let side = null, acct = null;
  function renderSide() {
    if (EMBED) return;
    const list = $("#markList"), set = $("#tab-settings"); if (!list || !set) return;
    if (!side) { side = el("div"); list.parentNode.insertBefore(side, list); }
    if (!acct) { acct = el("div"); set.insertBefore(acct, set.firstChild); }
    if (user) {
      side.hidden = true; acct.hidden = false;
      acct.className = "sg-side on";
      acct.innerHTML = '<span>Signed in as <b style="display:inline;font:inherit;font-weight:700">' + esc(user.name || user.email || "you") + '</b></span><button class="sg-link" type="button">Sign out</button>';
      $("button", acct).onclick = signOut;
    } else {
      acct.hidden = true; side.hidden = false;
      side.className = "sg-side";
      side.innerHTML = '<b>Keep these on every device</b><small>Sign in to keep your saved verses, where you stopped and your settings.</small><button class="ob pri" type="button">Sign in</button>';
      $("button", side).onclick = () => startSignIn();
    }
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- return visits: Google's card (2nd visit on), and a small "pick up where you stopped" pill (own schedule) ---------- */
  let pill = null, pillShown = false;
  function closePill() { if (pill) { pill.remove(); pill = null; } }
  /* The pill: first on the 5th visit. "Not now" brings it back only when the reader moves to another surah, after a week, then
     after a month; after the third "Not now" it never comes back. Ignoring it (it fades after 20 s) counts for nothing. */
  const PILL_WAIT = [0, 7, 30], PILL_MAX = 3;
  const pillState = () => { try { return JSON.parse(kv.get("pill") || "{}"); } catch (e) { return {}; } };
  function pillDue(onLoad) {
    const st = pillState(), n = st.n || 0;
    if (n >= PILL_MAX || pillShown || user || EMBED) return false;
    if (n === 0) return onLoad && (+kv.get("visits") || 0) >= 5;
    return !onLoad && Date.now() - (st.t || 0) >= PILL_WAIT[n] * 864e5;
  }
  function showPill() {
    if (pill || user) return;
    const pos = App.store.get("pos"); if (!pos) return;
    pillShown = true;
    pill = el("div", "sg-pill"); pill.setAttribute("role", "status");
    pill.innerHTML = '<span>Pick up at <b>' + esc(pos) + '</b> on every device?</span><span class="sg-pb"><button class="ob pri sm" type="button">Sign in</button><button class="sg-link" type="button">Not now</button></span>';
    document.body.appendChild(pill);
    $(".ob", pill).onclick = () => startSignIn();
    $(".sg-link", pill).onclick = () => { const st = pillState(); kv.set("pill", JSON.stringify({ n: (st.n || 0) + 1, t: Date.now() })); closePill(); };
    setTimeout(closePill, 20000);
  }
  let lastSurah = 0;
  addEventListener("gq:store", e => {
    if (!e.detail || e.detail.k !== "pos") return;
    const s = +String(App.store.get("pos") || "").split(":")[0];
    if (lastSurah && s && s !== lastSurah && pillDue(false)) setTimeout(showPill, 800);
    if (s) lastSurah = s;
  });
  async function returnVisit() {
    if (EMBED || user || !mayAsk()) return;
    const p = await loadProviders();
    if (user || !(p.providers || []).includes("google") || !p.googleClientId) return;
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => {
      try {
        google.accounts.id.initialize({
          client_id: p.googleClientId, auto_select: false, cancel_on_tap_outside: true, use_fedcm_for_prompt: true,
          callback: async r => {
            try { await fetch(AUTH + "/api/auth/one-tap/callback", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ idToken: r.credential }) }); } catch (e) {}
            checkSession(true);
          },
        });
        google.accounts.id.prompt(n => { try { if (n.isDismissedMoment() && n.getDismissedReason() === "user_cancel") closedByUser(); } catch (e) {} });
      } catch (e) {}
    };
    document.head.appendChild(s);
  }

  /* ---------- start ---------- */
  async function start() {
    if (EMBED) {
      try { const t = JSON.parse(ss.get("gq.tok") || "null"); if (t && t.token && t.token.exp > Date.now() + 30000) { token = t.token; user = t.user; } } catch (e) {}
      if (user) signedIn(false);
      return;
    }
    renderSide();
    await checkSession(false);
    if (!user) {
      if (!ss.get("gq.visit")) { ss.set("gq.visit", "1"); kv.set("visits", String((+kv.get("visits") || 0) + 1)); }
      if ((+kv.get("visits") || 0) >= 2) setTimeout(returnVisit, 4000);   // never on a first visit
      lastSurah = +String(App.store.get("pos") || "").split(":")[0] || 0;
      if (pillDue(true)) setTimeout(showPill, 5000);
    }
  }
  start();
})();
