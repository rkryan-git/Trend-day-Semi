/* Card hover: rim light, tilt + depth, glass that bends under the cursor, and live chart crosshairs.
   All off under prefers-reduced-motion except the chart crosshair (which is information, not motion). */
"use strict";
(() => {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CARDS = ".lift";

  // ---------------------------------------------------------------- tilt + depth + rim position
  let active = null, raf = 0, ev = null;
  function frame() {
    raf = 0;
    if (!ev) return;
    const card = ev.target.closest?.(CARDS);
    if (card !== active) { leave(active); active = card; if (card) enter(card); }
    if (!card) return;
    const r = card.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width, py = (ev.clientY - r.top) / r.height;   // 0..1
    card.style.setProperty("--mx", `${ev.clientX - r.left}px`);
    card.style.setProperty("--my", `${ev.clientY - r.top}px`);
    if (still) return;
    const dx = px * 2 - 1, dy = py * 2 - 1;                                                 // -1..1
    card.style.setProperty("--dx", dx.toFixed(3));
    card.style.setProperty("--dy", dy.toFixed(3));
    const big = r.width > 700;                                                              // wide cards tilt less
    const k = big ? 1.2 : 4;
    card.style.transform = `perspective(1000px) rotateX(${(-dy * k).toFixed(2)}deg) rotateY(${(dx * k).toFixed(2)}deg) translateY(-3px)`;
  }
  document.addEventListener("pointermove", (e) => { ev = e; if (!raf) raf = requestAnimationFrame(frame); }, { passive: true });
  document.addEventListener("pointerleave", () => { leave(active); active = null; });

  function enter(card) {
    card.classList.add("hovering");
    if (!still) bend(card, true);
  }
  function leave(card) {
    if (!card) return;
    card.classList.remove("hovering");
    card.style.transform = "";
    card.style.setProperty("--dx", 0);
    card.style.setProperty("--dy", 0);
    if (!still) bend(card, false);
  }

  // ---------------------------------------------------------------- glass bends (one hover filter, animated)
  let bendRaf = 0, bendCur = 26, bendTarget = 26, bendCard = null;
  function bend(card, on) {
    const disp = document.querySelector("#lg-refract-hover feDisplacementMap");
    if (!disp) return;
    if (on) { if (bendCard && bendCard !== card) bendCard.classList.remove("bending"); bendCard = card; card.classList.add("bending"); bendTarget = 70; }
    else { bendTarget = 26; setTimeout(() => { if (bendCard === card && bendTarget === 26) { card.classList.remove("bending"); bendCard = null; } }, 420); }
    if (!bendRaf) bendRaf = requestAnimationFrame(stepBend);
  }
  function stepBend() {
    const disp = document.querySelector("#lg-refract-hover feDisplacementMap");
    bendCur += (bendTarget - bendCur) * 0.16;
    if (disp) disp.setAttribute("scale", bendCur.toFixed(1));
    bendRaf = Math.abs(bendTarget - bendCur) > 0.4 ? requestAnimationFrame(stepBend) : 0;
  }

  // ---------------------------------------------------------------- chart crosshair + tooltip
  const tip = document.createElement("div");
  tip.className = "chart-tip"; tip.hidden = true; tip.setAttribute("role", "status");
  const line = document.createElement("div"); line.className = "chart-xh"; line.hidden = true;
  const dot = document.createElement("div"); dot.className = "chart-dot"; dot.hidden = true;
  document.addEventListener("DOMContentLoaded", () => document.body.append(line, dot, tip));
  const fmtN = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sgn = (x) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(2) + "%";

  function hideTip() { tip.hidden = line.hidden = dot.hidden = true; }
  document.addEventListener("pointermove", (e) => {
    const svg = e.target.closest?.("svg.has-tip");
    if (!svg) { hideTip(); return; }
    const v = JSON.parse(svg.dataset.v || "[]"), t = JSON.parse(svg.dataset.t || "[]");
    if (v.length < 2) return;
    const r = svg.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const i = Math.round(f * (v.length - 1));
    if (typeof v[i] !== "number") return;
    const lo = +svg.dataset.lo, hi = +svg.dataset.hi, pt = +svg.dataset.pt || 0, pb = +svg.dataset.pb || 0, H = +svg.dataset.h;
    const yVb = pt + (1 - (v[i] - lo) / ((hi - lo) || 1)) * (H - pt - pb);
    const x = r.left + (i / (v.length - 1)) * r.width, y = r.top + (yVb / H) * r.height;
    line.style.cssText = `left:${x}px;top:${r.top}px;height:${r.height}px`;
    dot.style.cssText = `left:${x}px;top:${y}px`;
    const ref = svg.dataset.ref ? JSON.parse(svg.dataset.ref) : null;
    const base = Array.isArray(ref) ? ref[i] : ref;
    const vs = typeof base === "number" ? ` <span class="${v[i] >= base ? "gain" : "loss"}">${sgn((v[i] / base - 1) * 100)}</span> <span class="muted">${svg.dataset.refLabel || ""}</span>` : "";
    tip.innerHTML = `<b>${fmtN(v[i])}</b>${vs}<br><span class="muted">${t[i] || ""}</span>`;
    const tw = 170;
    tip.style.cssText = `left:${Math.min(innerWidth - tw - 8, Math.max(8, x + 12))}px;top:${Math.max(8, y - 54)}px`;
    tip.hidden = line.hidden = dot.hidden = false;
  }, { passive: true });
  addEventListener("scroll", hideTip, { passive: true });
})();
