/* Chart loader: a small rising line that fills green as the page loads.
   - Never shows for quick loads: it waits SHOW_AFTER ms first (under ~1 s feels instant, so a loader there only flashes).
   - Once shown it stays at least MIN_SHOWN ms, so it never blinks.
   - The server sends each page in one piece, so real progress isn't known: like most apps, it eases toward 92%
     and fills the rest the moment the data is in, then fades out.
   It follows the page's own "Loading…" placeholders (p.loading), so no page code had to change. */
"use strict";
(() => {
  const SHOW_AFTER = 700, MIN_SHOWN = 500, FILL_MS = 320, HOLD_MS = 160, FADE_MS = 300, TAU = 4000;
  // a simple chart icon: rising, with small zigzags (viewBox 0 0 120 56)
  const PTS = [[4, 50], [18, 40], [28, 44], [42, 31], [52, 35], [66, 22], [76, 26], [90, 13], [100, 16], [116, 5]];
  const D = PTS.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join("");
  const AREA = `${D}L116,54L4,54Z`;

  let el = null, start = 0, shownAt = 0, showTimer = null, raf = 0, finishing = false, active = false;

  function build(caption) {
    el = document.createElement("div");
    el.className = "chart-loader";
    el.setAttribute("role", "progressbar");
    el.setAttribute("aria-label", caption || "Loading");
    el.setAttribute("aria-valuemin", "0"); el.setAttribute("aria-valuemax", "100");
    el.innerHTML = `<svg viewBox="0 0 120 56" aria-hidden="true">
        <defs><clipPath id="clDone"><rect x="0" y="0" width="0" height="56"/></clipPath>
          <linearGradient id="clArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--gain)" stop-opacity=".28"/><stop offset="1" stop-color="var(--gain)" stop-opacity="0"/></linearGradient></defs>
        <path class="cl-base" d="${D}"/>
        <g clip-path="url(#clDone)"><path class="cl-area" d="${AREA}" fill="url(#clArea)"/><path class="cl-done" d="${D}"/></g>
      </svg><span class="cl-cap">${caption ? caption.replace(/[<>&]/g, "") : "Loading"}</span>`;
    document.body.appendChild(el);
    document.body.classList.add("cl-active");
    requestAnimationFrame(() => el && el.classList.add("on"));
  }
  function setP(p) {
    if (!el) return;
    el.querySelector("#clDone rect").setAttribute("width", (Math.min(1, p) * 120).toFixed(1));
    el.setAttribute("aria-valuenow", String(Math.round(p * 100)));
  }
  function tick() {
    if (!el || finishing) return;
    setP(0.92 * (1 - Math.exp(-(performance.now() - start) / TAU)));
    raf = requestAnimationFrame(tick);
  }
  function begin(caption) {
    if (active) return;
    active = true; finishing = false; start = performance.now();
    showTimer = setTimeout(() => { build(caption); shownAt = performance.now(); tick(); }, SHOW_AFTER);
  }
  function end() {
    if (!active) return;
    active = false;
    clearTimeout(showTimer);
    if (!el) return;                                    // fast load: nothing was ever shown
    const wait = Math.max(0, MIN_SHOWN - (performance.now() - shownAt));
    setTimeout(() => {
      finishing = true; cancelAnimationFrame(raf);
      const node = el, from = Number(node.getAttribute("aria-valuenow") || 0) / 100, t0 = performance.now();
      const fill = () => {
        const k = Math.min(1, (performance.now() - t0) / FILL_MS), e = 1 - Math.pow(1 - k, 3);
        if (el === node) setP(from + (1 - from) * e);
        if (k < 1) return requestAnimationFrame(fill);
        node.classList.add("done");
        setTimeout(() => { node.classList.remove("on"); setTimeout(() => { node.remove(); if (el === node) { el = null; document.body.classList.remove("cl-active"); } }, FADE_MS); }, HOLD_MS);
      };
      requestAnimationFrame(fill);
    }, wait);
  }
  // follow the pages' own placeholders
  const pending = () => [...document.querySelectorAll(".page:not([hidden]) p.loading:not(.err), #trendOut p.loading")];
  function check() {
    const p = pending();
    if (p.length) begin(p[0].textContent.trim().replace(/…$/, ""));
    else end();
  }
  new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  document.addEventListener("DOMContentLoaded", check);
})();
