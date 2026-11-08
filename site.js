/* GlobalQuran.com site chrome: the top nav, the "for developers" panel and the footer links.
   Shown ONLY on GlobalQuran.com itself (and on localhost so it can be tested), never inside an embed/iframe, so people who embed or
   clone the reader don't get our site links.

   Turn it on/off while testing:   ?site=1  or  ?site=0   (remembered in localStorage; ?site=0 on localhost hides it again)
   Pin it from the page that loads this app (strongest, e.g. for a self-hosted copy):  <script>window.GQ_SITE = false</script>
   Edit the links below. */
(() => {
  "use strict";
  const qs = new URLSearchParams(location.search);
  if (qs.get("embed") === "1" || window.top !== window.self) return;   // embedded: never show

  const host = location.hostname;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) || host.endsWith(".localhost");
  let on = /^(www\.)?globalquran\.com$/i.test(host) || local;
  const q = qs.get("site"); if (q === "0" || q === "1") { try { localStorage.setItem("gq2.site", q); } catch (e) {} }
  try { const s = localStorage.getItem("gq2.site"); if (s === "0" || s === "1") on = s === "1"; } catch (e) {}
  if (typeof window.GQ_SITE === "boolean") on = window.GQ_SITE;
  if (!on) return;

  const L = {
    quran: "https://GlobalQuran.com", salat: "https://MuslimSalat.com",
    docs: "https://docs.globalquran.com", donate: "https://docs.globalquran.com/donate", data: "https://docs.globalquran.com/data",
    repo: "GlobalQuran/quran-anywhere", bugs: "https://github.com/GlobalQuran/quran-anywhere/issues", v2: "https://v2.globalquran.com",
    about: "https://docs.globalquran.com/about", contact: "https://docs.globalquran.com/contact"
  };
  const VERSIONS = [["V4", "http://v4.globalquran.com/"], ["V3", "https://v3.globalquran.com/"], ["V2", "https://v2.globalquran.com/"]];   // earlier versions of the site (there is no V1)
  const FALLBACK = { stars: 118, forks: 67 };   // last known, shown until GitHub answers
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const root = document.documentElement;
  root.classList.add("site-on");
  const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "site.css?v=5"; document.head.appendChild(css);

  /* ---------- top nav ---------- */
  const bar = document.createElement("nav");
  bar.className = "sitebar"; bar.setAttribute("aria-label", "GlobalQuran.com");
  bar.innerHTML = `<div class="sb-l"><a class="on" href="${L.quran}" aria-current="page">Quran</a><a href="${L.salat}">Salat</a></div>
    <div class="sb-r"><button type="button" id="sbDev" aria-haspopup="dialog" aria-expanded="false" aria-controls="devpop">For developers <i>▾</i></button><a href="${L.donate}">Donate</a><button type="button" id="sbVer" class="sb-ver" aria-haspopup="menu" aria-expanded="false" aria-controls="verpop" title="Earlier versions of GlobalQuran.com">V5 <i>▾</i></button></div>`;
  document.body.prepend(bar);

  /* ---------- for developers: API, data, the code (with stars/forks), embed snippet ---------- */
  const base = new URL("./", location.href).href;
  const snippet = `<div class="globalquran-book" data-surah="2" data-height="720"></div>\n<script src="${base}embed.js" async></script>`;
  const pop = document.createElement("div");
  pop.className = "devpop"; pop.id = "devpop"; pop.hidden = true; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "For developers");
  pop.innerHTML = `<div class="dv-h"><b>Build with GlobalQuran</b><span>Free API, data and code</span></div>
    <a class="dv-card" href="${L.docs}"><b>API</b><small>JSON API for the text, translations, audio and search.</small><i>↗</i></a>
    <a class="dv-card" href="${L.data}"><b>Download the data</b><small>The whole Quran, translations and word by word, ready to use.</small><i>↗</i></a>
    <a class="dv-card" href="https://github.com/${L.repo}" target="_blank" rel="noopener"><b>Get the code</b><small>Clone this website and host it yourself.</small>
      <span class="dv-gh"><em>★ <span id="ghStars">${FALLBACK.stars}</span></em><em>⑂ <span id="ghForks">${FALLBACK.forks}</span></em></span></a>
    <div class="dv-embed"><b>Put the reader on your site</b><textarea readonly rows="4" spellcheck="false" aria-label="Embed code">${esc(snippet)}</textarea>
      <small class="dv-hint">API key? It is optional today; add <code>data-api-key="…"</code> to the div if you have one.</small>
      <div class="dv-row"><button type="button" id="dvCopy">Copy code</button><a href="embed-demo.html">See an example</a></div></div>`;
  document.body.appendChild(pop);

  /* ---------- version menu: this is V5; earlier versions are one click away ---------- */
  const vpop = document.createElement("div");
  vpop.className = "verpop"; vpop.id = "verpop"; vpop.hidden = true; vpop.setAttribute("role", "menu"); vpop.setAttribute("aria-label", "GlobalQuran.com versions");
  vpop.innerHTML = `<div class="vp-h">Versions</div><span class="vp-cur" role="menuitem" aria-current="true">V5 <em>this version</em></span>` + VERSIONS.map(([n, h]) => `<a role="menuitem" href="${h}">${esc(n)}<i>↗</i></a>`).join("");
  document.body.appendChild(vpop);

  const btn = $id("sbDev");
  function $id(id) { return document.getElementById(id); }
  function setStats(s) { $id("ghStars").textContent = s.stars; $id("ghForks").textContent = s.forks; }
  async function stats() {   // cached for 6 hours so visitors don't hammer the GitHub API
    let c = null; try { c = JSON.parse(localStorage.getItem("gq2.gh") || "null"); } catch (e) {}
    if (c) setStats(c); if (c && Date.now() - c.t < 6 * 3600e3) return;
    try { const r = await fetch("https://api.github.com/repos/" + L.repo); if (!r.ok) return; const d = await r.json(); const s = { stars: d.stargazers_count, forks: d.forks_count, t: Date.now() };
      setStats(s); try { localStorage.setItem("gq2.gh", JSON.stringify(s)); } catch (e) {} } catch (e) {}
  }
  /* line the panel up with its button's right edge, but never let it run off the left of a narrow screen (on a phone the button is far from the right edge and the panel is almost as wide as the screen) */
  function place(panel, button) {
    const r = button.getBoundingClientRect(), w = panel.offsetWidth || 0;
    panel.style.right = Math.min(Math.max(8, innerWidth - r.right), Math.max(8, innerWidth - w - 8)) + "px";
  }
  function toggle(open) {
    const v = open ?? pop.hidden; pop.hidden = !v; btn.setAttribute("aria-expanded", v);
    if (v) { place(pop, btn); stats(); }
  }
  const vbtn = $id("sbVer");
  function toggleVer(open) {
    const v = open ?? vpop.hidden; vpop.hidden = !v; vbtn.setAttribute("aria-expanded", v);
    if (v) { toggle(false); place(vpop, vbtn); }
  }
  btn.onclick = () => { toggle(); if (!pop.hidden) toggleVer(false); };
  vbtn.onclick = () => toggleVer();
  addEventListener("pointerdown", e => { if (!pop.hidden && !e.target.closest("#devpop, #sbDev")) toggle(false); if (!vpop.hidden && !e.target.closest("#verpop, #sbVer")) toggleVer(false); });
  addEventListener("keydown", e => { if (e.key === "Escape") { toggle(false); toggleVer(false); } });
  $id("dvCopy").onclick = e => { const t = pop.querySelector("textarea"); t.select();
    (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).then(() => { e.target.textContent = "Copied ✓"; setTimeout(() => { e.target.textContent = "Copy code"; }, 1600); }, () => { document.execCommand && document.execCommand("copy"); }); };

  /* ---------- footer links (in the sidebar footer) ---------- */
  const foot = document.querySelector(".side-foot");
  if (foot) {
    const links = [["Donate", L.donate], ["About us", L.about], ["Contact us", L.contact]];   // the footer stays this small; developer links live in the top "For developers" panel
    const nav = document.createElement("nav"); nav.className = "site-links"; nav.setAttribute("aria-label", "GlobalQuran.com");
    nav.innerHTML = links.map(([t, h]) => `<a href="${h}">${esc(t)}</a>`).join("<span>·</span>");
    if (window.GQA && GQA.enabled) { const pv = document.createElement("a"); pv.href = "#"; pv.textContent = "Privacy"; pv.onclick = e => { e.preventDefault(); GQA.open(); }; nav.appendChild(Object.assign(document.createElement("span"), { textContent: "·" })); nav.appendChild(pv); }
    foot.appendChild(nav);
  }
})();
