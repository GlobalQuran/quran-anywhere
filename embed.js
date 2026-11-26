/*!
 * Global Quran — embed loader.
 *
 *   <div class="globalquran-book" data-surah="2" data-ayah="1" data-height="720"></div>
 *   <script src="https://YOUR-HOST/embed.js" async></script>
 *
 * The reader lives in an iframe, so the host page's CSS/JS can't affect it (and it can't affect the host).
 * It fills the frame, scrolls inside it, and reflows to the width the host gives it.
 *
 * Options (data- attributes on the div):
 *   data-surah       1–114 (default: where the visitor stopped, else 1)    data-ayah   ayah to open at
 *   data-height      px, default 720                                        data-sidebar  1 = show the surah list (needs ≥ 1100px width)
 *   data-translation any Global Quran translation id, e.g. en.sahih, fr.hamidullah, ur.jalandhry (several: "en.sahih,ur.jalandhry"), or none
 *   data-theme       day | night | auto (follows the visitor's system)      data-accent   hex colour, no #
 *   data-lang        language of the reader, e.g. en, ar, ur, fr (default: the visitor's browser language). It picks the menus, translation and voice
 *                    unless data-translation says otherwise; the visitor can change it with the language button
 *   data-player      0 hides the audio player                               data-font     mushaf | amiri | me
 *   data-login       0 turns off the "keep your saved verses on every device" sign-in prompt (saved verses then stay on the visitor's device)
 *   data-api-key     your Global Quran API key (free: docs.globalquran.com). Optional for now; one key per site lets you see your own usage. The frame also
 *                    tells the API which site embeds it, so the usage is listed under your site.
 *   data-api-url     use another API base URL (default https://api.globalquran.com)
 *
 * JavaScript API on the element:  el.globalquran.goto(36, 12)  .setTheme("night")  .setTranslation("en.sahih")  .setLanguage("ur")  .play(5)  .pause()
 * Events on the element (bubbling): globalquran:ready   globalquran:ayah  (detail.surah, detail.ayah)
 */
(function () {
  var script = document.currentScript || (function () { var s = document.getElementsByTagName("script"); return s[s.length - 1]; })();
  var base = new URL(".", script.src).href;

  function mount(el) {
    if (el.__gq) return; el.__gq = true;
    var d = el.dataset, q = ["embed=1", "from=" + encodeURIComponent(location.hostname)];
    [["surah", "surah"], ["ayah", "ayah"], ["theme", "theme"], ["accent", "accent"], ["font", "font"], ["sidebar", "sidebar"], ["player", "player"], ["login", "login"], ["lang", "lang"]].forEach(function (p) {
      if (d[p[0]] != null && d[p[0]] !== "") q.push(p[1] + "=" + encodeURIComponent(d[p[0]]));
    });
    if (d.translation) q.push("tr=" + encodeURIComponent(d.translation === "none" ? "" : d.translation));
    if (d.apiKey) q.push("key=" + encodeURIComponent(d.apiKey));
    if (d.apiUrl) q.push("api=" + encodeURIComponent(d.apiUrl));

    var f = document.createElement("iframe");
    f.src = base + "index.html?" + q.join("&");
    f.title = d.title || "Quran reader — GlobalQuran.com";
    f.loading = "lazy";
    f.allow = "autoplay";
    f.setAttribute("allowtransparency", "true");
    f.style.cssText = "display:block;width:100%;max-width:100%;border:0;background:transparent;color-scheme:normal;height:" + (parseInt(d.height, 10) || 720) + "px";
    el.appendChild(f);

    window.addEventListener("message", function (e) {
      if (e.source !== f.contentWindow) return;
      var m = e.data; if (!m || m.source !== "globalquran") return;
      if (m.type === "ayah") el.dispatchEvent(new CustomEvent("globalquran:ayah", { bubbles: true, detail: { surah: m.surah, ayah: m.ayah } }));
      if (m.type === "ready") el.dispatchEvent(new CustomEvent("globalquran:ready", { bubbles: true }));
    });
    function send(m) { m.target = "globalquran"; f.contentWindow.postMessage(m, "*"); }
    el.globalquran = {
      goto: function (surah, ayah) { send({ type: "goto", surah: surah, ayah: ayah || 1 }); },
      setTheme: function (t) { send({ type: "theme", value: t }); },
      setTranslation: function (id) { send({ type: "translation", value: id === "none" ? "" : id }); },
      setLanguage: function (code) { send({ type: "language", value: code }); },
      play: function (ayah) { send({ type: "play", ayah: ayah }); },
      pause: function () { send({ type: "play", value: false }); },
      iframe: f
    };
  }
  function init() { [].forEach.call(document.querySelectorAll(".globalquran-book"), mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.GlobalQuranBook = { mount: mount, init: init };
})();
