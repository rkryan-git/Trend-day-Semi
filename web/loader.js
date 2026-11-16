/* Chart loader: a white rising line; under it a flat green level fills the "bucket" as the page loads,
   with a count-up "+64%" in the app's big-number style. No card, no glow, no gradient (DESIGN.md).
   - Never shows for quick loads: waits SHOW_AFTER ms first (under ~1 s feels instant; a loader there only flashes).
   - Once shown it stays at least MIN_SHOWN ms, so it never blinks.
   - The server sends each page in one piece, so real progress isn't known: like most apps it eases toward 92%,
     then fills to +100% the moment the data is in, fades out, and the page fades in underneath.
   It follows the pages' own "Loading…" placeholders (p.loading), so page code only has to show one. */
"use strict";
(() => {
  const SHOW_AFTER = 700, MIN_SHOWN = 600, FILL_MS = 420, HOLD_MS = 220, FADE_MS = 260, TAU = 4500;
  // chart icon: rising, small zigzags (viewBox 0 0 160 84; baseline at y=80)
  const PTS = [[4, 72], [22, 60], [34, 65], [52, 47], [64, 53], [84, 33], [96, 39], [116, 20], [128, 25], [156, 6]];
  const LINE = PTS.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join("");
  const BUCKET = `${LINE}L156,80L4,80Z`;
  const TOP = 6, BOTTOM = 80;

  let el = null, start = 0, shownAt = 0, showTimer = null, raf = 0, finishing = false, active = false, p = 0;

  function build(caption, anchor) {
    el = document.createElement("div");
    el.className = "chart-loader";
    el.setAttribute("role", "progressbar");
    el.setAttribute("aria-label", caption || "Loading");
    el.setAttribute("aria-valuemin", "0"); el.setAttribute("aria-valuemax", "100");
    el.innerHTML = `<svg viewBox="0 0 160 84" aria-hidden="true">
        <defs><clipPath id="clBucket"><path d="${BUCKET}"/></clipPath></defs>
        <line class="cl-axis" x1="4" x2="156" y1="80" y2="80"/>
        <path class="cl-empty" d="${BUCKET}"/>
        <rect class="cl-level" clip-path="url(#clBucket)" x="0" y="${BOTTOM}" width="160" height="0"/>
        <path class="cl-line" d="${LINE}"/>
      </svg>
      <div class="cl-read"><span class="cl-pct">+0%</span><span class="cl-cap">${(caption || "Loading").replace(/[<>&]/g, "")}</span></div>`;
    const r = anchor && anchor.isConnected ? anchor.getBoundingClientRect() : null;
    el.style.top = `${Math.round(Math.max(96, Math.min(window.innerHeight - 190, r ? r.top + 8 : window.innerHeight * 0.35)))}px`;
    document.body.appendChild(el);
    document.body.classList.add("cl-active");
    requestAnimationFrame(() => requestAnimationFrame(() => el && el.classList.add("on")));
  }
  function setP(v) {
    p = Math.min(1, v);
    if (!el) return;
    const y = BOTTOM - p * (BOTTOM - TOP);
    const lv = el.querySelector(".cl-level");
    lv.setAttribute("y", y.toFixed(2)); lv.setAttribute("height", (BOTTOM - y).toFixed(2));
    const n = Math.round(p * 100);
    el.querySelector(".cl-pct").textContent = `+${n}%`;
    el.setAttribute("aria-valuenow", String(n));
  }
  function tick() {
    if (!el || finishing) return;
    setP(0.92 * (1 - Math.exp(-(performance.now() - start) / TAU)));
    raf = requestAnimationFrame(tick);
  }
  function begin(caption, anchor) {
    if (active) return;
    active = true; finishing = false; p = 0; start = performance.now();
    showTimer = setTimeout(() => { if (!active) return; build(caption, anchor); shownAt = performance.now(); tick(); }, SHOW_AFTER);
  }
  function end() {
    if (!active) return;
    active = false;
    clearTimeout(showTimer);
    if (!el) return;                                   // fast load: nothing was ever shown
    document.body.classList.add("cl-hold");            // keep the new page hidden until the loader hands over
    const wait = Math.max(0, MIN_SHOWN - (performance.now() - shownAt));
    setTimeout(() => {
      finishing = true; cancelAnimationFrame(raf);
      const node = el, from = p, t0 = performance.now();
      const fill = () => {
        const k = Math.min(1, (performance.now() - t0) / FILL_MS), e = 1 - Math.pow(1 - k, 3);
        if (el === node) setP(from + (1 - from) * e);
        if (k < 1) return requestAnimationFrame(fill);
        node.classList.add("done");
        setTimeout(() => {
          node.classList.remove("on");
          document.body.classList.remove("cl-hold");     // page fades in while the loader fades out
          setTimeout(() => { node.remove(); if (el === node) { el = null; document.body.classList.remove("cl-active"); } }, FADE_MS);
        }, HOLD_MS);
      };
      requestAnimationFrame(fill);
    }, wait);
  }
  const pending = () => [...document.querySelectorAll(".page:not([hidden]) p.loading:not(.err)")];
  function check() {
    const q = pending();
    if (q.length) begin(q[0].textContent.trim().replace(/…$/, ""), q[0]);
    else end();
  }
  new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  document.addEventListener("DOMContentLoaded", check);
})();
