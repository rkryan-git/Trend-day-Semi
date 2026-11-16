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
  // chart: rising with small zigzags, in a 100 x 100 plot (the reference's shape, flattened liquid)
  // the owner's drawing: only its turning points, joined by straight lines
  const LINE = "M0.0,92.0 L8.0,76.4 L23.1,58.2 L35.4,65.9 L68.9,30.6 L77.3,41.0 L100.0,8.0";
  const AREA = `${LINE} L100,100 L0,100 Z`;
  const PUMP_MS = 650, SURGE_MS = 420;
  const NAME_UNUSED = (c) => (/exit/i.test(c) ? "EXITS" : /backtest|60 days/i.test(c) ? "BACKTEST" : /2 years|hourly/i.test(c) ? "2Y CHECK"
    : /invest|trend/i.test(c) ? "INVEST" : /live/i.test(c) ? "LIVE" : /log/i.test(c) ? "LOG" : "RADAR");

  let el = null, start = 0, shownAt = 0, showTimer = null, raf = 0, finishing = false, active = false, p = 0;
  let from = 0, goal = 0, surgeAt = 0, lastPump = 0;

  function build(caption, anchor) {
    const cap = (caption || "Loading").replace(/[<>&]/g, "");
    el = document.createElement("div");
    el.className = "glass chart-loader";
    el.setAttribute("role", "progressbar");
    el.setAttribute("aria-label", cap);
    el.setAttribute("aria-valuemin", "0"); el.setAttribute("aria-valuemax", "100");
    el.innerHTML = `<div class="cl-plot">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <clipPath id="clShown"><rect x="0" y="-5" width="0" height="110"/></clipPath>
            <linearGradient id="clWater" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="var(--gain)" stop-opacity=".95"/><stop offset="1" stop-color="var(--gain)" stop-opacity=".18"/></linearGradient>
          </defs>
          <g class="cl-grid"><line x1="0" x2="100" y1="25" y2="25"/><line x1="0" x2="100" y1="50" y2="50"/><line x1="0" x2="100" y1="75" y2="75"/>
            <line y1="0" y2="100" x1="25" x2="25"/><line y1="0" y2="100" x1="50" x2="50"/><line y1="0" y2="100" x1="75" x2="75"/></g>
          <path class="cl-ghost" d="${AREA}"/>
          <g clip-path="url(#clShown)"><path class="cl-water" d="${AREA}" fill="url(#clWater)"/><path class="cl-edge" d="${LINE}"/></g>
          <line class="cl-front" x1="0" x2="0" y1="0" y2="100"/>
        </svg>
      </div>
      <div class="cl-read"><span class="cl-pct">+0%</span><span class="cl-cap">${cap}</span></div>`;
    const r = anchor && anchor.isConnected ? anchor.getBoundingClientRect() : null;
    el.style.top = `${Math.round(Math.max(88, Math.min(window.innerHeight - 330, r ? r.top : window.innerHeight * 0.2)))}px`;
    document.body.appendChild(el);
    document.body.classList.add("cl-active");
    requestAnimationFrame(() => requestAnimationFrame(() => el && el.classList.add("on")));
  }
  function setP(v) {
    p = Math.min(1, Math.max(0, v));
    if (!el) return;
    const w = (p * 100).toFixed(2);
    el.querySelector("#clShown rect").setAttribute("width", w);
    const f = el.querySelector(".cl-front");
    f.setAttribute("x1", w); f.setAttribute("x2", w);
    const n = Math.round(p * 100);
    el.querySelector(".cl-pct").textContent = `+${n}%`;
    el.setAttribute("aria-valuenow", String(n));
  }
  // pump: every PUMP_MS the target jumps to where the load "should" be, and the fill surges there and settles
  function tick() {
    if (!el || finishing) return;
    const now = performance.now();
    if (now - lastPump >= PUMP_MS) {
      lastPump = now; from = p; surgeAt = now;
      goal = 0.92 * (1 - Math.exp(-(now - start) / TAU));
      el.classList.remove("surge"); void el.offsetWidth; el.classList.add("surge");
    }
    const k = Math.min(1, (now - surgeAt) / SURGE_MS), e = 1 - Math.pow(1 - k, 4);
    setP(from + (goal - from) * e);
    raf = requestAnimationFrame(tick);
  }
  function begin(caption, anchor) {
    if (active) return;
    active = true; finishing = false; p = 0; from = 0; goal = 0; lastPump = 0; start = performance.now();
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
