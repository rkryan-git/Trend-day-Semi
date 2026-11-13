/* Semi Trend-Day Radar front end. Plain JS, no build step. All numbers come from /api (engine.py). */
"use strict";

// ------------------------------------------------------------------ helpers
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MINUS = "−";
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const isNum = (x) => typeof x === "number" && isFinite(x);
const fmt = (x, d = 2) => (isNum(x) ? x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).replace("-", MINUS) : "—");
const pct = (x, d = 2) => (isNum(x) ? (x > 0 ? "+" : x < 0 ? MINUS : "") + Math.abs(x).toFixed(d) + "%" : "—");
const tone = (x) => (isNum(x) ? (x > 0 ? "gain" : x < 0 ? "loss" : "") : "");
const pctHtml = (x, d = 2) => `<span class="num ${tone(x)}">${pct(x, d)}</span>`;
const eur = (x, d = 0) => (isNum(x) ? "€" + fmt(x, d) : "—");
const chev = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ------------------------------------------------------------------ settings
const DEFAULTS = { watch: "MU, SNDK, WDC, LRCX, AMAT, ASML, AMD", sector: "SMH", refresh: 60, long_only: true,
  require_sector: true, spread: 0.25, show_orb: false, exit: "", capital: 2000, risk_day: 1, stop: 3, size_mode: "one", sound: true };
let S = load("stdr.settings", DEFAULTS);
let SCHEMA = { exit_options: [], evidence: {} };
function load(k, d) { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || "{}") }; } catch (e) { return { ...d }; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
function qs(extra = {}) {
  const { sound, ...rest } = S;
  const p = new URLSearchParams({ ...rest, ...extra });
  return p.toString();
}

// ------------------------------------------------------------------ theme
const THEMES = ["system", "light", "dark"];
const THEME_ICON = {
  system: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/></svg>',
  light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
};
function applyTheme(choice) {
  const dark = choice === "dark" || (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themeChoice = choice;
  const b = $("#themeBtn");
  b.innerHTML = THEME_ICON[choice];
  b.setAttribute("aria-label", `Theme: ${choice}. Change theme`);
  b.title = `Theme: ${choice}`;
}
let themeChoice = (() => { try { return localStorage.getItem("stdr.theme") || "system"; } catch (e) { return "system"; } })();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => themeChoice === "system" && applyTheme("system"));

// ------------------------------------------------------------------ logos
let LOGOS = {};
function logo(t, cls = "") {
  const m = LOGOS[t];
  if (!m) return `<span class="logo mono ${cls}" aria-hidden="true">${esc(String(t || "?")[0])}</span>`;
  return `<span class="logo ${m.badge} ${cls}" aria-hidden="true"><img src="/web/logos/${encodeURIComponent(t)}.png" alt="" loading="lazy" decoding="async"></span>`;
}
const brand = (t) => (LOGOS[t] && LOGOS[t].color) || null;
const coName = (t) => (LOGOS[t] && LOGOS[t].name) || "";
const deltaPill = (x, d = 2) => (isNum(x) ? `<span class="delta ${tone(x)}"><span aria-hidden="true">${x >= 0 ? "↑" : "↓"}</span>${pct(x, d)}</span>` : "");

// ------------------------------------------------------------------ charts (SVG)
let sparkId = 0;
function spark(values, base, chg, color, times) {
  if (!values || values.length < 2) return '<svg class="spark" aria-hidden="true"></svg>';
  const w = 200, h = 40, all = values.concat(isNum(base) ? [base] : []);
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const x = (i) => (i / (values.length - 1)) * w, y = (v) => h - ((v - lo) / span) * h;
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const by = isNum(base) ? y(base).toFixed(1) : null;
  const col = chg > 0 ? "var(--gain)" : chg < 0 ? "var(--loss)" : "var(--muted)";
  if (color) {                                   // area chart: green above yesterday's close, red below, grey only at exactly 0
    const id = `sg${++sparkId}`, ref = by != null ? Number(by) : (chg > 0 ? h : 0);
    const flat = chg === 0;
    const area = `${d}L${w},${ref}L0,${ref}Z`;
    const tipData = ` data-v='${JSON.stringify(values)}' data-t='${JSON.stringify(times || [])}' data-lo="${lo}" data-hi="${hi}" data-h="${h}"${isNum(base) ? ` data-ref="${base}" data-ref-label="vs yesterday's close"` : ""}`;
    const hm = (s) => String(s || "").slice(-5);
    const tl = times && times.length > 1 ? `<div class="chart-axis"><span>${esc(hm(times[0]))}</span><span>${esc(hm(times[Math.floor(times.length / 2)]))}</span><span><span class="ax-d">${esc(String(times[times.length - 1] || "").slice(0, -6))} </span>${esc(hm(times[times.length - 1]))}</span></div>` : "";
    return `<svg class="spark area-spark has-tip${flat ? " flat" : ""}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"${tipData}>
      <defs>
        <clipPath id="${id}u"><rect x="0" y="0" width="${w}" height="${ref}"/></clipPath>
        <clipPath id="${id}d"><rect x="0" y="${ref}" width="${w}" height="${h - ref}"/></clipPath>

      </defs>
      ${by ? `<line class="base" x1="0" x2="${w}" y1="${by}" y2="${by}" vector-effect="non-scaling-stroke"/>` : ""}
      <path class="area up" d="${area}" clip-path="url(#${id}u)"/>
      <path class="area dn" d="${area}" clip-path="url(#${id}d)"/>
      <path class="line up" d="${d}" clip-path="url(#${id}u)" vector-effect="non-scaling-stroke"/>
      <path class="line dn" d="${d}" clip-path="url(#${id}d)" vector-effect="non-scaling-stroke"/>
      <circle cx="${x(values.length - 1)}" cy="${y(values[values.length - 1])}" r="2.8" fill="${col}"/></svg>${tl}`;
  }
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    ${by ? `<line class="base" x1="0" x2="${w}" y1="${by}" y2="${by}" vector-effect="non-scaling-stroke"/>` : ""}
    <path d="${d}" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(values.length - 1)}" cy="${y(values[values.length - 1])}" r="2.6" fill="${col}"/></svg>`;
}

function gauge(chance, level, rates, mini = false, id = "") {
  const top = Math.max(60, chance || 0), cx = 150, cy = 150, r = mini ? 112 : 118, sw = mini ? 30 : 18;
  const ang = (v) => Math.PI * (1 - Math.min(v, top) / top);
  const pt = (v, rr) => [cx + rr * Math.cos(ang(v)), cy - rr * Math.sin(ang(v))];
  const [x1, y1] = pt(0, r), [x2, y2] = pt(top, r);
  const d = `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}`;
  const target = (100 - (Math.min(chance || 0, top) / top) * 100).toFixed(2);
  const ticks = mini ? "" : [rates["no warning"], rates.base, rates["any warning"], rates["gap ±5%"]].map((v) => {
    const [a1, b1] = pt(v, r - sw / 2 - 1), [a2, b2] = pt(v, r + sw / 2 + 1), [lx, ly] = pt(v, r + sw / 2 + 14);
    return `<line class="tick" x1="${a1.toFixed(1)}" y1="${b1.toFixed(1)}" x2="${a2.toFixed(1)}" y2="${b2.toFixed(1)}"/>
      <text class="tick-lbl" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${v}</text>`;
  }).join("");
  const hot = level === "High" || level === "Elevated" ? " hot" : "";
  return `<svg class="gauge" ${id ? `id="${id}"` : ""} viewBox="0 ${mini ? 20 : 0} 300 ${mini ? 148 : 168}" role="img" aria-label="Chance of a 7 percent day: ${Math.round(chance)} percent">
    <path class="track" d="${d}" stroke-width="${sw}" fill="none"/>
    <path class="fill${hot}" d="${d}" stroke-width="${sw}" fill="none" pathLength="100" stroke-dasharray="100" data-target="${target}" style="stroke-dashoffset:${target}"/>
    ${ticks}</svg>`;
}

function candles(c, prev, marks) {
  const n = c.c.length;
  if (!n) return '<p class="empty">No intraday data yet.</p>';
  const W = 720, H = 280, L = 8, R = 52, T = 12, B = 22;
  const vals = c.h.concat(c.l).concat(c.vwap.filter(isNum)).concat(isNum(prev) ? [prev] : []).filter(isNum);
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const step = (W - L - R) / Math.max(n, 1), bw = Math.max(2, Math.min(9, step * 0.62));
  const x = (i) => L + step * (i + 0.5), y = (v) => T + (1 - (v - lo) / span) * (H - T - B);
  let g = "";
  for (let k = 0; k <= 4; k++) {
    const v = lo + (span * k) / 4, yy = y(v).toFixed(1);
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${W - R + 8}" y="${yy}" dominant-baseline="middle">${fmt(v)}</text>`;
  }
  let body = "";
  for (let i = 0; i < n; i++) {
    if (![c.o[i], c.h[i], c.l[i], c.c[i]].every(isNum)) continue;
    const cls = c.c[i] >= c.o[i] ? "up" : "down", xx = x(i).toFixed(1);
    const top = y(Math.max(c.o[i], c.c[i])), bot = y(Math.min(c.o[i], c.c[i]));
    body += `<line class="${cls}" x1="${xx}" x2="${xx}" y1="${y(c.h[i]).toFixed(1)}" y2="${y(c.l[i]).toFixed(1)}" stroke-width="1"/>`;
    body += `<rect class="${cls}" x="${(x(i) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, bot - top).toFixed(1)}" rx="1"/>`;
  }
  const vw = c.vwap.map((v, i) => (isNum(v) ? `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}` : "")).join("").replace(/^L/, "M");
  const pv = isNum(prev) ? `<line class="prev" x1="${L}" x2="${W - R}" y1="${y(prev).toFixed(1)}" y2="${y(prev).toFixed(1)}"/>` : "";
  let labels = "";
  c.t.forEach((t, i) => { const hm = String(t).slice(-5); if (hm.endsWith(":30") || hm.endsWith(":00")) { if (i % Math.ceil(n / 7) === 0) labels += `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${hm}</text>`; } });
  const mk = (marks || []).map((m) => {
    if (!isNum(m.bar) || m.bar >= n) return "";
    const xx = x(m.bar), yy = y(m.entry), up = m.side === "LONG";
    const p = up ? `${xx - 6},${yy + 14} ${xx + 6},${yy + 14} ${xx},${yy + 4}` : `${xx - 6},${yy - 14} ${xx + 6},${yy - 14} ${xx},${yy - 4}`;
    return `<polygon class="mark" points="${p}"><title>${esc(m.setup)} ${m.side} at ${fmt(m.entry)}</title></polygon>`;
  }).join("");
  const tip = ` data-v='${JSON.stringify(c.c)}' data-t='${JSON.stringify(c.t)}' data-lo="${lo}" data-hi="${hi}" data-h="${H}" data-pt="${T}" data-pb="${B}" data-x0="${L}" data-x1="${W - R}" data-w="${W}"${isNum(prev) ? ` data-ref="${prev}" data-ref-label="vs yesterday's close"` : ""}`;
  return `<svg class="candles has-tip" viewBox="0 0 ${W} ${H}" role="img" aria-label="5-minute candles with VWAP and yesterday's close"${tip}>${g}${pv}${body}<path class="vwap" d="${vw}"/>${mk}${labels}</svg>`;
}

// before / after bars. rows: [{label, without:{v,n}, with:{v,n}}]
function beforeAfter(rows, unit = "%", coin = null, whiskers = false) {
  const vals = rows.flatMap((r) => [r.without?.v, r.with?.v, ...(whiskers ? [r.with?.lo, r.with?.hi, r.without?.lo, r.without?.hi] : [])]).filter(isNum);
  if (!vals.length) return '<p class="empty">Nothing to compare.</p>';
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (coin != null) { lo = Math.min(lo, coin); hi = Math.max(hi, coin); }
  if (whiskers) { lo = 0; hi = 100; }
  const span = hi - lo || 1, pos = (v) => ((v - lo) / span) * 100;
  const line = (lbl, cell, cls) => {
    if (!cell || !isNum(cell.v)) return `<div class="bar-line"><span class="lbl">${lbl}</span><span class="muted">no trades</span><span></span></div>`;
    const a = pos(Math.min(0, cell.v)), b = pos(Math.max(0, cell.v));
    const left = whiskers ? 0 : a, width = whiskers ? pos(cell.v) : b - a;
    const sign = cell.v >= 0 ? "pos" : "neg";
    const wh = whiskers && isNum(cell.lo) && isNum(cell.hi) ? `<span class="whisker" style="left:${pos(cell.lo)}%;width:${pos(cell.hi) - pos(cell.lo)}%"></span>` : "";
    const val = whiskers ? `${cell.v.toFixed(1)}%` : pct(cell.v);
    return `<div class="bar-line"><span class="lbl">${lbl}</span>
      <span class="bar-track">${whiskers ? "" : `<span class="bar-axis" style="left:${pos(0)}%"></span>`}${coin != null ? `<span class="coin" style="left:${pos(coin)}%" title="coin flip"></span>` : ""}
      <span class="bar ${cls} ${sign}" style="left:${left}%;width:${Math.max(width, 0.6)}%"></span>${wh}</span>
      <span class="num">${val} <span class="muted">· n = ${cell.n}</span></span></div>`;
  };
  return `<div class="bars">${rows.map((r) => `<div class="bar-group"><h3 class="h-sub">${esc(r.label)}</h3>
    ${line("Without filter", r.without, "without")}${line("With filter", r.with, "with")}</div>`).join("")}</div>`;
}

// ------------------------------------------------------------------ generic table
const isPctCol = (c) => /%|_avg|avg_|stop|result|chg|gap|half/i.test(c) && !/range|won|trades|days/i.test(c);
function dataTable(t, opts = {}) {
  if (!t || !t.columns || !t.rows.length) return `<p class="empty">${opts.empty || "Nothing yet."}</p>`;
  const cols = t.columns.map((c) => (c === "index" ? "" : c));
  const numeric = t.columns.map((_, j) => t.rows.some((r) => isNum(r[j])) && t.rows.every((r) => r[j] == null || isNum(r[j])));
  const head = cols.map((c, j) => `<th scope="col" class="${numeric[j] ? "n" : ""}">${esc(c.replace(/_/g, " "))}</th>`).join("");
  const body = t.rows.map((r) => `<tr>${r.map((v, j) => {
    const c = t.columns[j];
    if (isNum(v)) {
      const s = isPctCol(c) ? `<span class="${tone(v)}">${(v > 0 ? "+" : v < 0 ? MINUS : "") + Math.abs(v).toFixed(2)}</span>` : fmt(v, Number.isInteger(v) ? 0 : 2);
      return `<td class="n">${s}</td>`;
    }
    if (v == null && numeric[j]) return `<td class="n muted">—</td>`;
    if (typeof v === "boolean") return `<td>${v ? "yes" : "no"}</td>`;
    return `<td>${esc(v ?? "—").replace(/-(\d)/g, MINUS + "$1")}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function markScrollers(root = document) {
  root.querySelectorAll(".table-wrap").forEach((w) => {
    const more = w.scrollWidth > w.clientWidth + 2;
    w.classList.toggle("scrolls", more);
    const upd = () => w.classList.toggle("at-end", w.scrollLeft + w.clientWidth >= w.scrollWidth - 2);
    if (more && !w.dataset.sc) { w.dataset.sc = "1"; w.addEventListener("scroll", upd, { passive: true }); }
    upd();
  });
}
new MutationObserver(() => requestAnimationFrame(() => markScrollers())).observe(document.documentElement, { childList: true, subtree: true });
addEventListener("resize", () => markScrollers());

function disclose(id, label, inner, open = false) {
  return `<div class="disclose"><button type="button" aria-expanded="${open}" aria-controls="${id}" data-disclose>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>${esc(label)}</button>
    <div class="disclose-body" id="${id}" ${open ? "" : "hidden"}>${inner}</div></div>`;
}
const openState = new Set();
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-disclose]");
  if (!b) return;
  const id = b.getAttribute("aria-controls"), body = document.getElementById(id), open = b.getAttribute("aria-expanded") !== "true";
  b.setAttribute("aria-expanded", open);
  body.hidden = !open;
  open ? openState.add(id) : openState.delete(id);
});
function restoreOpen(root) {
  openState.forEach((id) => { const b = root.querySelector(`[aria-controls="${id}"]`); const body = document.getElementById(id); if (b && body) { b.setAttribute("aria-expanded", "true"); body.hidden = false; } });
}

// ------------------------------------------------------------------ Live
let liveTimer = null, liveData = null, wlOpen = null, radarSel = null, introDone = false;
const phaseWord = { open: "US market open", pre: "Pre-market", closed: "US market closed", weekend: "Weekend" };

async function loadLive() {
  try {
    liveData = await api("/api/live?" + qs());
    if (currentTab === "live") renderLive(liveData);
    else setStatus(liveData.phase, `${phaseWord[liveData.phase]} · ${liveData.updated.slice(0, 5)}`);
  } catch (e) {
    if (!liveData) $("#page-live").innerHTML = `<p class="loading err">Couldn't load live data: ${esc(e.message)}. Retrying.</p>`;
    setStatus("closed", "Connection problem");
  }
  clearTimeout(liveTimer);
  liveTimer = setTimeout(loadLive, (Number(S.refresh) || 60) * 1000);
}

function setStatus(phase, text) {
  const el = $("#status");
  el.dataset.phase = phase;
  el.querySelector("span").textContent = text;
}

const levelTag = (lvl) => `<span class="status-tag ${lvl === "Low" ? "muted" : "caution"}" style="${lvl === "Low" ? "" : "color:var(--caution)"}"><i></i>${esc(lvl)}</span>`;
const radarChips = (r) => [
  isNum(r.gap) ? `<span class="chip">${r.gap_label === "gap" ? "Gap" : "Pre-market"} ${pct(r.gap, 1)}</span>` : "",
  r.memory && isNum(r.hynix) ? `<span class="chip">Hynix ${pct(r.hynix, 1)}</span>` : "",
  r.vol ? `<span class="chip">Volatility ${esc(r.vol)}${isNum(r.vol_ratio) ? ` ${r.vol_ratio.toFixed(2)}×` : ""}</span>` : "",
  isNum(r.yesterday) ? `<span class="chip">Yesterday ${pct(r.yesterday, 1)}</span>` : "",
].join("");

function featureHTML(r, rates) {
  return `<div>${gauge(r.chance, r.level, rates, false, "gFeature")}<div class="g-num" id="gNum">${Math.round(r.chance)}%</div></div>
    <div class="g-meta">
      <h3 class="g-name" id="gName">${logo(r.ticker, "lg")}${esc(r.ticker)}</h3>
      <span class="sub muted">Chance of a ±7% day</span>
      <div id="gLevel">${levelTag(r.level)}</div>
      <div class="chips" id="gChips">${radarChips(r)}</div>
      <p class="warn" id="gWarn">${esc((r.warnings || []).join(" · ").replace(/-(\d)/g, MINUS + "$1")) || "No warnings today."}</p>
      <p class="gauge-key">Marks on the dial: ${rates["no warning"]}% with no warning · ${rates.base}% on all days · ${rates["any warning"]}% with any warning · ${rates["gap ±5%"]}% after a 5%+ gap.</p>
    </div>`;
}

function selectRadar(t) {
  if (!liveData) return;
  const rows = liveData.radar.rows.filter((r) => r.level), r = rows.find((x) => x.ticker === t);
  if (!r) return;
  const prev = rows.find((x) => x.ticker === radarSel);
  radarSel = t;
  document.querySelectorAll(".stock-card").forEach((c) => c.setAttribute("aria-pressed", c.dataset.radar === t));
  const fill = $("#gFeature .fill"), top = Math.max(60, r.chance);
  if (fill) { fill.style.strokeDashoffset = 100 - (Math.min(r.chance, top) / top) * 100; fill.classList.toggle("hot", r.level !== "Low"); }
  countUp($("#gNum"), prev ? prev.chance : 0, r.chance, (v) => `${Math.round(v)}%`);
  $("#gName").innerHTML = logo(r.ticker, "lg") + esc(r.ticker);
  $("#gLevel").innerHTML = levelTag(r.level);
  $("#gChips").innerHTML = radarChips(r);
  $("#gWarn").textContent = (r.warnings || []).join(" · ").replace(/-(\d)/g, MINUS + "$1") || "No warnings today.";
}

function renderLive(d) {
  setStatus(d.phase, `${phaseWord[d.phase]} · ${d.updated.slice(0, 5)}`);
  const intro = !introDone;
  const D = d.decision;
  const today = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  let k = 0;
  const rv = () => (intro && !reduced ? `reveal" style="--d:${Math.min(k++ * 60, 600)}ms` : "");

  // ---- decision hero
  const tickets = (D.takes || []).map((p) => `
    <div class="ticket${p.late ? " ticket-late" : ""}"><div class="ticket-row">
      <div><span class="label">Position</span><span class="val" data-count="${p.position_eur}" data-fmt="eur0">${eur(p.position_eur)}</span></div>
      <div><span class="label">Margin 5:1</span><span class="val" data-count="${p.margin_eur_5to1}" data-fmt="eur0">${eur(p.margin_eur_5to1)}</span></div>
      <div><span class="label">Risk</span><span class="val" data-count="${p.risk_eur}" data-fmt="eur2">${eur(p.risk_eur, 2)}</span></div>
      <div><span class="label">Stop</span><span class="val" data-count="${p.stop_price}" data-fmt="n2">${fmt(p.stop_price)}</span></div>
      <div><span class="label">Exit</span><span class="val">${esc(D.exit)}</span></div>
    </div><div class="ticket-who">${logo(p.ticker, "xs")} ${p.late ? `<strong>Signal passed ${esc(String(p.age_min))} min ago, don't enter now</strong> · ` : ""}${esc(p.ticker)} ${p.side} · ${esc(p.setup)} · entry ${fmt(p.entry)} at ${esc(p.entry_time)}${isNum(p.now) ? ` · now ${pct(p.now)} from entry` : ""}</div></div>`).join("");
  const hero = `<section class="hero" data-tone="${D.tone}" aria-labelledby="decision">
    <div class="glass hero-card ${rv()}">
      <div class="hero-meta"><span class="label">${esc(today)}</span><span class="label">${esc(phaseWord[d.phase])}</span><span class="label">Updated ${esc(d.updated)}</span></div>
      <h1 class="h-display" id="decision"><span class="tone" aria-hidden="true"></span>${esc(D.head)}</h1>
      <p class="hero-sub">${esc(D.sub)}</p>${tickets}
    </div></section>`;

  // ---- fact blocks
  const blocks = [];
  const ago = (m) => (m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`);
  const breaking = (D.breaking || []).slice(0, 2);
  const breakingRow = breaking.length ? `<div class="bento" style="margin-top:16px"><div class="glass block lift breaking span-12 ${rv()}"><span class="label caution">Breaking · high impact</span>
      ${breaking.map((n) => `<a class="news-hl" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.headline)}</a>
        <p class="sub">${esc(n.time)} · ${ago(n.age_min)}${n.symbols.length ? " · " + n.symbols.map(esc).join(", ") : ""} · ${esc(n.source)}</p>`).join("")}</div></div>` : "";
  if (D.filter) {
    const f = D.filter, note = String(f.note || "").replace(/^since today's open: /, "").replace(/-(\d)/g, MINUS + "$1");
    blocks.push(`<div class="glass block lift"><span class="label">Market filter</span>
      <span class="big ${f.ok ? "gain" : D.state === "blocked" ? "" : "loss"}">${f.ok ? "Longs allowed" : D.state === "blocked" ? "SMH and QQQ below their open and VWAP" : "Longs blocked"}</span>
      <p class="sub">${esc(note)} since the open.${f.fade ? " Up on the day but fading since the open: the gap-up-and-fade case the filter is built to catch." : ""}</p></div>`);
  }
  if (D.size_mode === "split" && D.takes.length) {
    const used = D.takes.reduce((a, p) => a + (p.risk_eur || 0), 0);
    blocks.push(`<div class="glass block lift"><span class="label">Risk used today</span><span class="big num">${eur(used, 2)} <span class="muted">of ${eur(D.budget, 2)}</span></span>
      <span class="meter"><span class="meter-track"><span class="meter-fill" style="width:${Math.min(100, (used / (D.budget || 1)) * 100)}%"></span></span></span></div>`);
  }
  if (D.catalysts.length) blocks.push(`<div class="glass block lift"><span class="label">Catalysts today</span>${D.catalysts.map((c) => `<span class="big">${esc(c)}</span>`).join("")}<p class="sub">Very high impact. Expect bigger moves than usual.</p></div>`);
  if (D.stay_out.length) blocks.push(`<div class="glass block lift"><span class="label">Stay out</span><span class="big">${D.stay_out.map(esc).join(", ")}</span><p class="sub">The first hour went against the gap.</p></div>`);
  if (D.also.length) blocks.push(`<div class="glass block lift"><span class="label">Also fired</span><span class="big">${D.also.map((a) => esc(a.ticker)).join(", ")}</span><p class="sub">${D.also.map((a) => `${esc(a.ticker)}: ${esc((a.blocked || []).join(", ") || "not in plan")}`).join(" · ")}</p></div>`);
  const span = blocks.length >= 3 ? "span-4" : blocks.length === 2 ? "span-6" : "span-12";
  let why = "";
  if (d.since_open) {
    const f = D.filter;
    why = disclose("why-open", "Why: SMH, QQQ and your stocks since the open", dataTable(d.since_open) +
      (f ? `<p class="prose">Versus yesterday's close: SMH ${pctHtml(f.smh_day)}, QQQ ${pctHtml(f.qqq_day)}. The filter looks at the move since the 15:30 open, not the day.</p>` : "") +
      `<p class="prose">Last 10 min = latest 5-min close vs two candles earlier; the newest candle may still be forming.</p>`);
  }
  const factRow = breakingRow + (blocks.length ? `<div class="bento" style="margin-top:16px">${blocks.map((b) => b.replace('class="glass block lift"', `class="glass block lift ${span} ${rv()}"`)).join("")}</div>` : "");

  // ---- news radar
  const nf = d.news || { items: [], error: null };
  const newsSec = `<section class="section" aria-labelledby="h-news">
    <div class="section-head"><h2 class="h-section ${rv()}" id="h-news">News radar</h2>
      <p class="prose ${rv()}">Real-time headlines (Benzinga via Alpaca) for your watchlist and the names that move the sector: NVDA, TSM, SMH, QQQ. Sorted by impact words such as CEO change, guidance, investigation, export rules, takeover, downgrade. Visible institutional actions only: analyst calls, stake changes. Last 24 hours.</p></div>
    <div class="glass news-list ${rv()}">${nf.error ? `<p class="empty">${esc(nf.error)}</p>` : !nf.items.length ? '<p class="empty">No headlines in the last 24 hours.</p>' :
      nf.items.filter((n) => !breaking.some((b) => b.headline === n.headline)).slice(0, 18).map((n) => `<a class="news-row imp-${n.impact}" href="${esc(n.url)}" target="_blank" rel="noopener">
        <span class="label">${esc(n.time)}${n.age_min >= 600 ? " · " + esc(n.day) : ""}</span>
        <span class="imp">${n.impact === "high" ? "High" : n.impact === "medium" ? "Medium" : ""}</span>
        <span class="hl">${esc(n.headline)}</span>
        <span class="syms">${n.symbols.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</span></a>`).join("")}</div></section>`;

  // ---- radar
  const rows = d.radar.rows.filter((r) => r.level), rates = d.radar.rates;
  if (!rows.find((r) => r.ticker === radarSel)) radarSel = rows.slice().sort((a, b) => b.chance - a.chance)[0]?.ticker || null;
  const sel = rows.find((r) => r.ticker === radarSel);
  const radar = `<section class="section" aria-labelledby="h-radar">
    <div class="section-head"><h2 class="h-section ${rv()}" id="h-radar">Big-day radar</h2>
      <p class="prose ${rv()}">How likely a ±7% day is for each stock, from the warnings that came before past big days (SNDK/MU/WDC, Nov 2024 to Nov 2026). It says how big the day may get, not which way. Pick a stock to see why.</p></div>
    ${sel ? `<div class="glass radar-feature ${rv()}" id="radarFeature">${featureHTML(sel, rates)}</div>` : ""}
    <div class="radar-grid" role="group" aria-label="Stocks on your watchlist">
      ${d.radar.rows.map((r) => r.level ? `<button type="button" class="glass lift stock-card ${rv()}" data-radar="${esc(r.ticker)}" aria-pressed="${r.ticker === radarSel}">
          <span class="row1"><span class="who">${logo(r.ticker, "sm")}<span class="tick-name">${esc(r.ticker)}</span></span><span class="level-${r.level}" style="font-size:12px">${r.level}</span></span>
          ${gauge(r.chance, r.level, rates, true)}<span class="mini-num">${Math.round(r.chance)}%</span>
          <span class="muted" style="font-size:12px;text-align:center">${isNum(r.gap) ? `${r.gap_label === "gap" ? "gap" : "pre-mkt"} ${pct(r.gap, 1)}` : "&nbsp;"}</span></button>`
        : `<div class="glass stock-card"><span class="tick-name">${esc(r.ticker)}</span><span class="muted">No data</span></div>`).join("")}
    </div></section>`;

  // ---- signals
  const fired = d.setups.fired, cols = d.setups.columns;
  const allSetups = {
    columns: ["Stock", ...cols.flatMap((c) => [c, `${c} detail`])],
    rows: d.setups.rows.map((r) => [r.ticker, ...r.cells.flatMap((c) => [
      c.side ? `${c.passed ? "TAKE" : "Skip"} ${c.side} @ ${fmt(c.entry)} · now ${pct(c.now)}` : c.state,
      [c.detail, c.filters ? `sector ${c.filters.sector ? "ok" : "not ok"}${c.filters.breadth != null ? ` · breadth ${c.filters.breadth}/3` : ""}${isNum(c.filters.atr_used) ? ` · ATR used ${fmt(c.filters.atr_used)}` : ""}` : ""].filter(Boolean).join(" · ")])]),
  };
  const quiet = fired.filter((f) => !f.taken);
  const quietList = quiet.length ? `<div class="glass sig-list ${rv()}"><div class="sig-row sig-head-row"><span class="label">Stock</span><span class="label">Side</span><span class="label">Setup</span><span class="label">Entry</span><span class="label">Now</span><span class="label">Not taken because</span></div>
    ${quiet.map((f) => `<div class="sig-row"><span class="who">${logo(f.ticker, "sm")}<span class="tick-name">${esc(f.ticker)}</span></span><span class="side ${f.side === "SHORT" ? "loss" : "gain"}">${f.side}</span>
      <span class="muted">${esc(f.setup)} · ${esc(f.time)}</span><span class="num">${fmt(f.entry)}</span><span class="${tone(f.now)} num">${pct(f.now)}</span>
      <span class="muted">${esc((f.blocked || []).join(", ") || "today's plan")}${f.side === "SHORT" && f.filters.sector ? " · market agreed" : ""}</span></div>`).join("")}
    <p class="sub" style="padding:10px 16px 4px;font-size:12px">Every signal is logged, taken or not, so its result shows up in the Signal log.</p></div>` : "";
  const sigCards = fired.filter((f) => f.taken).map((f) => `<article class="glass lift sig-card ${f.taken ? "taken" : ""} ${rv()}">
      <div class="sig-head"><span class="who">${logo(f.ticker)}<span class="sig-tick">${esc(f.ticker)}</span></span><span class="status-tag ${f.taken ? "gain" : f.side === "SHORT" ? "loss" : "muted"}"><i></i>${f.taken ? `TAKE ${f.side}` : `${f.side} signal`}</span></div>
      <div class="chips"><span class="chip">${esc(f.setup)}</span><span class="chip">${esc(f.time)}</span></div>
      <div class="kv"><div><span class="label">Entry</span><b>${fmt(f.entry)}</b></div><div><span class="label">Now</span><b class="${tone(f.now)}">${pct(f.now)}</b></div>
        <div><span class="label">Sector</span><b>${f.filters.sector ? "ok" : "not ok"}</b></div></div>
      ${f.taken ? "" : `<p class="warn" style="margin:0">Not taken. Blocked by: ${esc((f.blocked || []).join(", ") || "today's plan")}${f.side === "SHORT" && f.filters.sector ? ". The market filter agreed with this short." : ""} Logged either way.</p>`}</article>`).join("");
  const nextCheck = d.phase === "open" ? (D.state === "waiting" ? D.sub : "Both setup checks are done for today.") : "Setup checks run at 15:40 and 16:30 your time.";
  const signals = `<section class="section" aria-labelledby="h-sig">
    <div class="section-head"><h2 class="h-section ${rv()}" id="h-sig">Signals today</h2>
      <p class="prose ${rv()}"><strong>${esc(cols[0])}:</strong> ${esc(d.setups.rules[cols[0]])} <strong>${esc(cols[1])}:</strong> ${esc(d.setups.rules[cols[1]])}</p></div>
    <div class="sig-grid">${sigCards || `<div class="glass block ${rv()}"><span class="label">${fired.length ? "No trade" : "No signal yet"}</span><span class="big">${fired.length ? "Nothing you would take today." : "Nothing has fired today."}</span><p class="sub">${esc(fired.length ? `${fired.length} signal${fired.length > 1 ? "s" : ""} fired but did not pass your rules; they are listed below.` : nextCheck)}</p></div>`}
      <div class="glass block ${rv()}"><span class="label">What the research says</span>
        ${d.setups.research.length ? `<ul class="list">${d.setups.research.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="sub">Both setups held up only with the market filter and only on the long side.</p>`}
        <p class="sub" style="font-size:13px">Exit: ${esc(d.exit_label.toLowerCase())}, ${d.caption.stop}% stop. Risk budget: ${d.caption.risk_day}% of ${eur(d.caption.capital)} for the whole day. Your ${fmt(d.caption.spread)}% spread setting comes off every result; check T212's live spread before you enter.</p></div>
    </div>
    ${quietList}
    ${disclose("all-setups", "All setups today, per stock", dataTable(allSetups))}
    ${d.log_error ? `<p class="err">Couldn't update signal_log.csv: ${esc(d.log_error)}</p>` : ""}
  </section>`;

  // ---- market
  const tape = d.tape.items.map((t) => t.last == null ? `<div class="card tile lift ${rv()}"><span class="label">${t.ticker}</span><span class="fig-val">—</span></div>` : `
    <div class="card tile lift ${rv()}"><span class="tile-top"><span class="label">${t.ticker}</span>${logo(t.ticker, "sm")}</span><span class="fig-val" data-count="${t.last}" data-fmt="n2">${fmt(t.last)}</span>
      <span class="chg">${deltaPill(t.chg)} <span class="muted">${t.vwap_dist > 0 ? "above" : "below"} VWAP</span></span>
      ${isNum(t.pre) ? `<span class="pre">Pre-market ${fmt(t.pre)} ${pctHtml(t.pre_chg)}</span>` : ""}
      ${spark(t.spark, t.prev_close, t.chg, brand(t.ticker), t.spark_t)}</div>`).join("");
  const br = d.tape.breadth;
  const breadth = `<div class="card tile lift ${rv()}"><span class="label">Watchlist breadth</span><span class="fig-val">${isNum(br) ? (br > 0 ? "+" : br < 0 ? MINUS : "") + Math.abs(br).toFixed(2) : "—"}</span>
    <span class="meter" style="margin-top:6px"><span class="meter-track"><span class="meter-fill" style="width:${isNum(br) ? ((br + 1) / 2) * 100 : 50}%"></span></span></span>
    <span class="pre">(up − down) / total. Near ±1, the whole group moves together.</span></div>`;
  const OVL = { "SK Hynix": "HYNIX", "Samsung": "SAMSUNG", "ASML (Amsterdam)": "ASML" };
  const ov = d.overnight.map((o) => `<div class="glass ov-card lift ${rv()}"><span class="tile-top"><span class="label">${esc(o.name)}</span>${OVL[o.name] ? logo(OVL[o.name], "sm") : ""}</span><span class="fig-val">${isNum(o.last) ? fmt(o.last, 0) : "—"}</span>
    <span class="chg">${pctHtml(o.chg)}${o.stale ? ' <span class="muted">· not today</span>' : ""}</span></div>`).join("");
  const market = `<section class="section" aria-labelledby="h-mkt">
    <div class="section-head"><h2 class="h-section ${rv()}" id="h-mkt">Sector tape</h2><p class="prose ${rv()}">Versus yesterday's close. The dotted line in each chart is yesterday's close.</p></div>
    <div class="tiles">${tape}${breadth}</div>
    <div class="section-head" style="margin-top:40px"><h3 class="h-sub ${rv()}">Overnight read</h3><p class="prose ${rv()}">Korea and Japan close 07:30 your time. When SK Hynix moved 3%+, MU/SNDK/WDC gapped the same way 77% of the time (60-day test).</p></div>
    <div class="ov-grid">${ov}</div></section>`;

  // ---- watchlist
  const wl = d.watchlist;
  if (wlOpen && !wl.rows.find((r) => r.ticker === wlOpen && r.last != null)) wlOpen = null;
  const wlCards = wl.rows.map((r) => {
    if (r.last == null) return `<div class="glass wl-card"><span class="tick-name">${esc(r.ticker)}</span><span class="muted">No data</span></div>`;
    const open = wlOpen === r.ticker;
    const card = `<button type="button" class="glass lift wl-card ${rv()}" data-ticker="${esc(r.ticker)}" aria-expanded="${open}" aria-controls="wl-panel">
      <span class="top"><span class="who">${logo(r.ticker)}<span><span class="tick-name">${esc(r.ticker)}</span><span class="co">${esc(coName(r.ticker))}</span></span></span>${deltaPill(r.chg)}</span>
      <span class="px" data-count="${r.last}" data-fmt="n2">${fmt(r.last)}</span>
      ${spark(r.spark, r.prev_close, r.chg, brand(r.ticker), r.spark_t)}
      <span class="chips"><span class="chip">${isNum(r.pre_chg) ? "Pre-mkt " + pct(r.pre_chg) : "Gap " + pct(r.gap)}</span><span class="chip">VWAP ${pct(r.vwap_dist)}</span>${isNum(r.rvol) ? `<span class="chip">RVOL ${fmt(r.rvol)}</span>` : ""}</span>
      <span class="verdict">${esc(r.verdict)}${isNum(r.score) ? ` · score ${fmt(r.score, 0).replace("-", MINUS)}` : ""}</span></button>`;
    const panel = open ? `<div class="glass wl-panel" id="wl-panel">
        <div><div class="block-title" style="margin-bottom:12px"><h3 class="h-sub">${esc(r.ticker)} · 5-minute chart, your time</h3>
          <span class="muted" style="font-size:13px">First 30 min ${pct(r.first30)} · range ${esc(r.or)}${isNum(r.range_atr) ? ` · ${fmt(r.range_atr)}× ATR` : ""}</span></div>
          ${candles(r.candles, r.prev_close, r.marks)}
          <div class="legend"><span><i></i>VWAP</span><span><i class="prev"></i>Yesterday's close</span><span>▲ ▼ setup entries</span></div></div>
        <div><h3 class="h-sub">Why the score</h3><ul class="list" style="margin:12px 0 24px">${(r.reasons || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          <h3 class="h-sub">Headlines</h3><ul class="list news" data-news="${esc(r.ticker)}" style="margin-top:12px"><li class="muted">Loading…</li></ul></div></div>` : "";
    return card + panel;
  }).join("");
  const watch = `<section class="section" aria-labelledby="h-wl">
    <div class="section-head"><h2 class="h-section ${rv()}" id="h-wl">Watchlist</h2>
      <p class="prose ${rv()}">${wl.session ? `Session of ${esc(wl.session)} · ${wl.minutes} min of trading. ` : ""}Open a stock for its 5-minute chart, the score reasons and headlines. The trend score is experimental: a simplified version didn't hold up in testing.</p></div>
    <div class="wl-grid">${wlCards}</div></section>`;

  // ---- calendar
  const ct = d.catalysts.today, up = d.catalysts.upcoming;
  const cal = `<section class="section" aria-labelledby="h-cal">
    <div class="section-head"><h2 class="h-section ${rv()}" id="h-cal">Calendar</h2><p class="prose ${rv()}">From catalysts.csv plus earnings dates from Yahoo. Add your own events to catalysts.csv.</p></div>
    <div class="cal"><div class="glass lift ${rv()}"><h3 class="h-sub" style="margin-bottom:8px">Today</h3>${ct.length ? ct.map((c) => `<div class="cal-item"><span class="label">${esc(c.time || "All day")}</span><span>${esc(c.event)}<br><span class="muted" style="font-size:13px">${esc(c.affects)}</span></span><span class="${c.impact === "Very high" ? "" : "muted"}" style="font-size:13px">${esc(c.impact)}</span></div>`).join("") : '<p class="empty">Nothing scheduled.</p>'}</div>
      <div class="glass lift ${rv()}"><h3 class="h-sub" style="margin-bottom:8px">Next 3 weeks</h3>${up.length ? up.map((c) => `<div class="cal-item"><span class="label">${esc(new Date(c.date + "T12:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }))}${c.time ? " · " + esc(c.time) : ""}</span><span>${esc(c.event)}</span><span class="muted" style="font-size:13px">${esc(c.impact)} · ${esc(c.status)}</span></div>`).join("") : '<p class="empty">Nothing on the calendar.</p>'}</div></div></section>`;

  const page = $("#page-live");
  page.innerHTML = hero + factRow + why + newsSec + radar + signals + market + watch + cal;
  restoreOpen(page);
  if (wlOpen) loadNews(wlOpen);
  animateIn(page, intro);
}

async function loadNews(t) {
  const ul = document.querySelector(`[data-news="${CSS.escape(t)}"]`);
  if (!ul || ul.dataset.loaded) return;
  ul.dataset.loaded = "1";
  try {
    const items = await api(`/api/news/${encodeURIComponent(t)}`);
    ul.innerHTML = items.length ? items.map((n) => `<li>${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : esc(n.title)}${n.source ? ` <span class="muted">· ${esc(n.source)}</span>` : ""}</li>`).join("") : '<li class="muted">No headlines from Yahoo.</li>';
  } catch (e) { ul.innerHTML = '<li class="muted">Headlines unavailable.</li>'; }
}

document.addEventListener("click", (e) => {
  const rc = e.target.closest(".stock-card[data-radar]");
  if (rc) { selectRadar(rc.dataset.radar); return; }
  const wc = e.target.closest(".wl-card[data-ticker]");
  if (wc && liveData) {
    wlOpen = wlOpen === wc.dataset.ticker ? null : wc.dataset.ticker;
    renderLive(liveData);
    const again = document.querySelector(`.wl-card[data-ticker="${CSS.escape(wc.dataset.ticker)}"]`);
    if (again) again.focus({ preventScroll: true });
  }
});

// ------------------------------------------------------------------ motion
const FMT = { eur0: (v) => eur(v), eur2: (v) => eur(v, 2), n2: (v) => fmt(v) };
function countUp(el, from, to, f, dur = 900) {
  if (!el || !isNum(to)) return;
  if (reduced) { el.textContent = f(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = f(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
let revealObs = null;
function animateIn(root, intro) {
  // gauges: start empty on the first load, then sweep to their value
  root.querySelectorAll(".gauge .fill").forEach((f) => {
    const target = f.dataset.target;
    if (intro && !reduced) { f.style.strokeDashoffset = 100; requestAnimationFrame(() => requestAnimationFrame(() => (f.style.strokeDashoffset = target))); }
    else f.style.strokeDashoffset = target;
  });
  if (!intro || reduced) return;
  document.body.classList.add("intro");
  document.body.classList.remove("settled");
  root.querySelectorAll("[data-count]").forEach((el) => countUp(el, 0, Number(el.dataset.count), FMT[el.dataset.fmt] || ((v) => fmt(v)), 1100));
  revealObs?.disconnect();
  revealObs = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); revealObs.unobserve(en.target); } }), { rootMargin: "0px 0px -8% 0px" });
  root.querySelectorAll(".reveal").forEach((el) => revealObs.observe(el));
  introDone = true;
  // after the first scroll-through window, refreshes render settled (no replays)
  setTimeout(() => { document.body.classList.remove("intro"); }, 2200);
  addEventListener("scroll", settleLater, { passive: true, once: true });
  setTimeout(settleLater, 12000);
}
function settleLater() { setTimeout(() => document.body.classList.add("settled"), 1500); }

// sheen follows the pointer across glass
let sheenRaf = 0, sheenEv = null;
document.addEventListener("pointermove", (e) => {
  sheenEv = e;
  if (sheenRaf) return;
  sheenRaf = requestAnimationFrame(() => {
    sheenRaf = 0;
    const el = sheenEv.target.closest?.(".glass, .card");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${sheenEv.clientX - r.left}px`);
    el.style.setProperty("--my", `${sheenEv.clientY - r.top}px`);
  });
}, { passive: true });

// liquid tab indicator
function movePill() {
  const nav = $(".tabs"), a = nav.querySelector('a[aria-current="page"]');
  let pill = nav.querySelector(".tab-pill");
  if (!pill) { pill = document.createElement("span"); pill.className = "tab-pill"; pill.setAttribute("aria-hidden", "true"); nav.prepend(pill); }
  if (!a) return;
  pill.style.left = `${a.offsetLeft}px`;
  pill.style.width = `${a.offsetWidth}px`;
}
addEventListener("resize", movePill);

// ------------------------------------------------------------------ Signal log
async function renderLog() {
  const p = $("#page-log");
  p.innerHTML = head("Signal log", "Every setup signal is written to signal_log.csv with its entry price and the filter state at that moment, then filled in with the close at your exit time. Rejected signals are logged too, so you can see live whether the filters help. After 30+ signals per line, trust these numbers over the research.") + '<p class="loading">Loading…</p>';
  try {
    const d = await api("/api/log?" + qs());
    p.innerHTML = head("Signal log", "Every setup signal is written to signal_log.csv with its entry price and the filter state at that moment, then filled in with the close at your exit time. Rejected signals are logged too, so you can see live whether the filters help. After 30+ signals per line, trust these numbers over the research.") +
      (d.count ? `<section class="section" style="padding-top:0"><div class="section-head"><h2 class="h-section">Results so far</h2><p class="prose">Closed signals the app called in real time. Results are % moves from entry to the close; after spread subtracts your ${fmt(Number(S.spread))}% setting. The log doesn't apply the 3% stop.${d.reconstructed ? ` ${d.reconstructed} signal${d.reconstructed > 1 ? "s were" : " was"} reconstructed after the fact (the app wasn't running at signal time) and ${d.reconstructed > 1 ? "are" : "is"} not counted here; ${d.reconstructed > 1 ? "they stay" : "it stays"} in the table below with live = false.` : ""}</p></div>${dataTable(d.stats, { empty: "No closed signals yet." })}</section>
      <section class="section"><div class="section-head"><h2 class="h-section">All signals</h2><a class="btn btn-ghost btn-sm" href="/api/log.csv" download>Download CSV</a></div>${dataTable(logView(d.rows))}<p class="prose" style="font-size:13px;margin-top:10px">The CSV has every column, including breadth, ATR used and the exit setting.</p></section>`
        : '<p class="empty">No signals logged yet. Keep the app open during US hours, from 15:30 your time.</p>');
  } catch (e) { p.insertAdjacentHTML("beforeend", `<p class="err">${esc(e.message)}</p>`); }
}
// the on-screen log shows the columns you decide on; the CSV keeps everything
function logView(t) {
  if (!t || !t.columns) return t;
  const ix = (c) => t.columns.indexOf(c);
  const short = (x) => String(x || "").replace("confirmed gap", "gap").replace("first-hour confirm", "1st hour");
  const cols = [["date", "Date"], ["ticker", "Stock"], ["setup", "Setup"], ["direction", "Side"], ["entry", "Entry"], ["close", "Exit"],
    ["result_pct", "Result %"], ["status", "Status"], ["blocked_by", "Not taken because"], ["sector_ok", "Market agreed"], ["live", "Live call"]];
  const keep = cols.filter(([c]) => ix(c) >= 0);
  return { columns: keep.map(([, l]) => l), rows: t.rows.map((r) => keep.map(([c]) => {
    const v = r[ix(c)];
    if (c === "setup") return short(v);
    if (c === "blocked_by") return v == null || v === "" ? "taken" : v;
    if (c === "live") return v === false || String(v).toLowerCase() === "false" ? "no (reconstructed)" : "yes";
    return v;
  })) };
}

function head(title, text) { return `<div class="page-head"><h1 class="h-display">${esc(title)}</h1><p class="prose">${esc(text)}</p></div>`; }

// ------------------------------------------------------------------ Spread log
async function renderSpread(msg = "") {
  const p = $("#page-spread");
  const tickers = String(S.watch).split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  const intro = `Measures what T212 really charges you. Every result in this app subtracts one fixed spread (${fmt(Number(S.spread))}% in Settings), but the real CFD spread changes during the day and is widest at the open. Type the Sell and Buy prices from the T212 order screen; a few readings at 15:30, 15:40, 16:30 and 21:30 over a week is enough.`;
  p.innerHTML = head("Spread log", intro) + `
    <form class="form-row" id="spreadForm">
      <label class="field"><span>Stock</span><select class="input" name="ticker">${tickers.map((t) => `<option>${esc(t)}</option>`).join("")}</select></label>
      <label class="field"><span>Sell price (bid)</span><input class="input" name="bid" type="number" step="0.01" min="0" required inputmode="decimal"></label>
      <label class="field"><span>Buy price (ask)</span><input class="input" name="ask" type="number" step="0.01" min="0" required inputmode="decimal"></label>
      <button class="btn btn-primary" type="submit">Save reading</button></form>
    <p class="toast" id="spreadMsg" aria-live="polite">${msg}</p><div id="spreadOut"><p class="loading">Loading…</p></div>`;
  $("#spreadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), body = { ticker: f.get("ticker"), bid: Number(f.get("bid")), ask: Number(f.get("ask")) };
    if (!(body.ask > body.bid && body.bid > 0)) { $("#spreadMsg").innerHTML = '<span class="err">Buy must be higher than Sell, and both above zero.</span>'; return; }
    try {
      await api("/api/spread?" + qs(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const sp = ((body.ask - body.bid) / ((body.ask + body.bid) / 2)) * 100;
      renderSpread(`Saved ${esc(body.ticker)}: spread ${sp.toFixed(3)}%.`);
    } catch (err) { $("#spreadMsg").innerHTML = `<span class="err">${esc(err.message)}</span>`; }
  });
  try {
    const d = await api("/api/spread?" + qs());
    const out = $("#spreadOut");
    if (d.average == null) { out.innerHTML = '<p class="empty">No readings yet.</p>'; return; }
    const ok = d.average <= d.setting + 0.02;
    out.innerHTML = `<section class="section" style="padding-top:24px"><dl class="facts"><div><dt class="label">Your average</dt><dd><span class="num ${ok ? "gain" : "loss"}">${d.average.toFixed(2)}%</span> ${ok ? `at or below your ${fmt(d.setting)}% setting: the backtest costs are realistic.` : `above your ${fmt(d.setting)}% setting: results in this app are too rosy. Raise the spread in Settings to match.`}</dd></div>
      <div><dt class="label">For comparison</dt><dd>The tested edges were about +1.1 to +1.2% per trade before costs.</dd></div></dl></section>
      <section class="section"><div class="section-head"><h2 class="h-section">By time of day</h2><p class="prose">Average round-trip spread (%) per stock and time window.</p></div>${dataTable(d.summary)}
      ${disclose("all-spreads", "All readings", dataTable(d.rows))}</section>`;
    restoreOpen(out);
  } catch (e) { $("#spreadOut").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

// ------------------------------------------------------------------ Backtest
let btCache = null;
function renderBacktest() {
  const p = $("#page-backtest");
  p.innerHTML = head("Backtest", "Re-runs both setups on the last ~60 days of 5-minute data (the most Yahoo gives for free), split into a first and second half, with and without each filter. A real edge should be positive in both halves and after spread.") +
    `<div class="form-row"><button class="btn btn-primary" id="runBt" type="button">Run setup backtest</button><span class="muted" id="btMsg" aria-live="polite"></span></div><div id="btOut"></div>
     <section class="section">${disclose("trend-bt", "Experimental: trend-score backtest", `<p class="prose">The original trend score. In a separate test a simplified version of it lost money, so treat it with care.</p>
       <div class="form-row" style="margin-top:14px"><label class="field"><span>Score the day after</span><select class="input" id="checkMin"><option value="45">45 min</option><option value="60" selected>60 min</option><option value="90">90 min</option><option value="120">120 min</option></select></label>
       <button class="btn btn-ghost" type="button" id="runTrend">Run trend-score backtest</button></div><div id="trendOut"></div>`)}</section>`;
  restoreOpen(p);
  $("#runBt").onclick = async (e) => {
    e.target.disabled = true; $("#btMsg").textContent = "Downloading 60 days of 5-minute data…";
    try { btCache = await api("/api/backtest?" + qs()); showBacktest(btCache); $("#btMsg").textContent = ""; }
    catch (err) { $("#btMsg").innerHTML = `<span class="err">${esc(err.message)}</span>`; }
    e.target.disabled = false;
  };
  $("#runTrend").onclick = async (e) => {
    e.target.disabled = true; $("#trendOut").innerHTML = '<p class="loading">Running…</p>';
    try {
      const d = await api("/api/trend?" + qs({ check_min: $("#checkMin").value }));
      $("#trendOut").innerHTML = d.empty ? '<p class="empty">Not enough data.</p>' : dataTable(d.summary) + dataTable(d.top);
    } catch (err) { $("#trendOut").innerHTML = `<p class="err">${esc(err.message)}</p>`; }
    e.target.disabled = false;
  };
  if (btCache) showBacktest(btCache);
}

function rowsBy(t) {
  const out = {};
  if (!t || !t.rows) return out;
  t.rows.forEach((r) => { const o = {}; t.columns.forEach((c, j) => (o[c] = r[j])); out[r[0]] = o; });
  return out;
}
function showBacktest(d) {
  const o = $("#btOut");
  if (d.empty) { o.innerHTML = '<p class="empty">Not enough data to backtest.</p>'; return; }
  const all = rowsBy(d.all), fil = rowsBy(d.filtered);
  const ba = Object.keys(all).filter((k) => !/^Baseline/.test(k)).map((k) => ({
    label: k, without: { v: all[k]["after_spread_%"], n: all[k].trades }, with: fil[k] ? { v: fil[k]["after_spread_%"], n: fil[k].trades } : null }));
  o.innerHTML = `
    <section class="section"><div class="section-head"><h2 class="h-section">With and without the market filter</h2>
      <p class="prose">Average result per trade after your ${fmt(d.spread)}% spread. "With" keeps only trades where SMH and QQQ were above their open and VWAP at entry. n is the number of trades.</p></div>
      <div class="card">${beforeAfter(ba)}</div></section>
    <section class="section"><div class="section-head"><h2 class="h-section">All signals</h2><p class="prose">won % = share of trades that ended in profit. 95% range = where the true win rate plausibly lies; if it includes 50%, it could be a coin flip.</p></div>${dataTable(d.all)}</section>
    <section class="section"><div class="section-head"><h2 class="h-section">Only with the filter passed</h2></div>${dataTable(d.filtered)}</section>
    <section class="section"><div class="section-head"><h2 class="h-section">Exit time</h2><p class="prose">Average result (before spread) if you exit at each time. Everything else uses your exit setting.</p></div>${dataTable(d.exit)}</section>
    <section class="section"><div class="section-head"><h2 class="h-section">Account result by sizing rule</h2><p class="prose">15:40 and 16:30 signals with your filters, ${d.risk_day}% risk, ${d.stop}% stop, your exit and spread. "Every signal at full risk" stacks correlated positions: the bigger total comes with bigger drawdowns, not more edge. Compare return per drawdown.</p></div>${dataTable(d.sims)}</section>
    <section class="section"><div class="section-head"><h2 class="h-section">Filter breakdown</h2></div>
      ${d.breakdown.map((b, i) => disclose(`fb-${i}`, b.title, dataTable(b.table))).join("")}
      ${disclose("all-trades", "All trades", dataTable(d.trades))}</section>`;
  restoreOpen(o);
}

// ------------------------------------------------------------------ 2-year check
let longCache = null;
function renderLong() {
  const p = $("#page-long");
  const tickers = String(S.watch).split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  const mem = ["MU", "SNDK", "WDC"].filter((t) => tickers.includes(t));
  const sel = new Set(load("stdr.long", { pick: mem.length ? mem : tickers.slice(0, 3) }).pick.filter((t) => tickers.includes(t)));
  p.innerHTML = head("2-year check", "Checks the big-day warnings and the 16:30 first-hour rule on about two years of daily and hourly data (Yahoo's limit for hourly bars). Run it every month or two to see whether the patterns still hold.") +
    `<div class="form-row"><div class="field"><span>Stocks</span><div class="seg" role="group" aria-label="Stocks">${tickers.map((t) => `<button type="button" data-pick="${esc(t)}" aria-pressed="${sel.has(t)}">${esc(t)}</button>`).join("")}</div></div>
     <button class="btn btn-primary" id="runLong" type="button">Run 2-year check</button><span class="muted" id="longMsg" aria-live="polite"></span></div><div id="longOut"></div>`;
  p.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => {
    const t = b.dataset.pick; sel.has(t) ? sel.delete(t) : sel.add(t); b.setAttribute("aria-pressed", sel.has(t)); save("stdr.long", { pick: [...sel] });
  }));
  $("#runLong").onclick = async (e) => {
    if (!sel.size) { $("#longMsg").textContent = "Pick at least one stock."; return; }
    e.target.disabled = true; $("#longMsg").textContent = "Downloading about 2 years of daily and hourly data…";
    try { longCache = await api("/api/long?stocks=" + encodeURIComponent([...sel].join(","))); showLong(longCache); $("#longMsg").textContent = ""; }
    catch (err) { $("#longMsg").innerHTML = `<span class="err">${esc(err.message)}</span>`; }
    e.target.disabled = false;
  };
  if (longCache) showLong(longCache);
}
function showLong(d) {
  const o = $("#longOut");
  if (d.empty) { o.innerHTML = '<p class="empty">Not enough data.</p>'; return; }
  const f = rowsBy(d.filters);
  const range = (s) => { const m = String(s || "").match(/([\d.]+)\D+([\d.]+)/); return m ? [Number(m[1]), Number(m[2])] : [null, null]; };
  const cell = (r) => { if (!r || !r.trades) return null; const [lo, hi] = range(r["95%_range"]); return { v: r["won_%"], n: r.trades, lo, hi }; };
  const ba = [{ label: "16:30 first-hour rule, long side", without: cell(f["all LONG signals"]), with: cell(f["SMH+QQQ up in the first hour"]) }];
  const avgW = f["all LONG signals"]?.["avg_rest_of_day_%"], avgF = f["SMH+QQQ up in the first hour"]?.["avg_rest_of_day_%"];
  o.innerHTML = `<p class="prose" style="margin-top:20px">${d.stock_days} stock-days, ${esc(d.span)}. A ±7% day happened on ${d.base}% of them.</p>
    <section class="section"><div class="section-head"><h2 class="h-section">Win rate with and without the filter</h2>
      <p class="prose">Bars show won %, the line through each bar its 95% range, and the dashed line 50%, a coin flip. "With" = SMH and QQQ both up in the first hour. Average rest of the day, before spread: ${pctHtml(avgW)} without, ${pctHtml(avgF)} with.</p></div>
      <div class="card">${beforeAfter(ba, "%", 50, true)}</div></section>
    <section class="section"><div class="section-head"><h2 class="h-section">Warnings before big days</h2></div>${dataTable(d.warnings)}</section>
    <section class="section"><div class="section-head"><h2 class="h-section">16:30 first-hour rule</h2></div>${dataTable(d.first_hour)}</section>
    <section class="section"><div class="section-head"><h2 class="h-section">Filters on the long side</h2><p class="prose">Sector = SMH and QQQ both up in the first hour. Hourly data has no VWAP, so this uses "above the open" only. Several stocks on the same day count separately, so the real sample is smaller than "days" suggests.</p></div>${dataTable(d.filters)}</section>`;
}

// ------------------------------------------------------------------ Guide
function renderGuide() {
  const ev = Object.values(SCHEMA.evidence || {});
  $("#page-guide").innerHTML = head("Guide", "Your day, step by step, in Amsterdam time. What the app tested, what held up and what didn't.") + `<div class="guide">
    <div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Look at</th><th>What to do</th></tr></thead><tbody>
      <tr><td>Before 15:30</td><td>Overnight read and Big-day radar</td><td>Low means probably a normal day: skip CFDs. Elevated or High: be at the screen and think about hedging your holdings. The radar says how big, not which way.</td></tr>
      <tr><td>15:30–15:40</td><td>Watch only</td><td>The biggest candles of the day happen here, and spreads are widest.</td></tr>
      <tr><td>15:40</td><td>15:40 confirmed gap and the market filter</td><td>Take the long only if SMH and QQQ are both above their open and VWAP (60 days: +1.22% average with the filter, +0.17% without).</td></tr>
      <tr><td>16:30</td><td>16:30 first-hour confirm and the market filter</td><td>Long with SMH and QQQ up: 70% won, +1.10% average over 2 years, positive in every half-year. Not aligned: −0.27%.</td></tr>
      <tr><td>Until 21:30</td><td>Hold to your exit time</td><td>3% stop. Tight trailing stops and VWAP stops lost money in testing.</td></tr></tbody></table></div>
    <h3>Sizing, exits and costs</h3><ul>
      <li>One risk budget per day, not per trade. Filtered signals bunched onto 11 days with 1–11 at once (60-day test). Taking all of them at 1% each gave a −3.7% worst day and −5.9% drawdown; one trade per day kept the worst day at −0.45%.</li>
      <li>Position size = (CFD money × daily risk %) ÷ stop %: €2,000 × 1% ÷ 3% ≈ €670 of exposure (about €135 margin at 5:1). The Live page shows it per signal.</li>
      <li>Exit 30 minutes before the close by default. The last 10 minutes moved 1.7× more than midday with no direction bias; 21:30 kept about 92% of the result.</li>
      <li>A 0.25% round-trip spread on €670 costs about €1.68, roughly 8% of a €20 risk budget. Set your real spread in Settings.</li></ul>
    <h3>The filter ideas, tested on your data</h3><ul>${ev.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <h3>Earlier research</h3><ul>
      <li>Big days are predictable in size, not direction. No warning: about 5% chance of a ±7% day; any warning (gap or Hynix ±3%): about 22%; gap ±5%: about 52%.</li>
      <li>Confirmation is the edge: when the first 10 minutes or the first hour move the same way as the gap, and the market agrees, the move tended to continue.</li>
      <li>What didn't work: news direction at 15:25/15:30, chasing a fixed % from the open, fading the gap, picking the "strongest" stock, VWAP stretch fades, opening-range breakouts.</li></ul>
    <h3>Caveats</h3><ul>
      <li>60 days of 5-minute data and 2 years of hourly data, mostly one huge memory bull run and its crash.</li>
      <li>Each filter makes the sample smaller. The 15:40 filter result rests on 11 vs 10 trading days.</li>
      <li>T212 spreads aren't in the data; the app subtracts your setting.</li>
      <li>The trend score in the Watchlist is experimental.</li></ul></div>`;
}

// ------------------------------------------------------------------ settings drawer
function field(label, html, help = "") { return `<label class="field"><span>${label}</span>${html}${help ? `<small>${esc(help)}</small>` : ""}</label>`; }
function sw(name, label, help = "") {
  return `<label class="switch"><span class="field"><span>${label}</span>${help ? `<small>${esc(help)}</small>` : ""}</span><input type="checkbox" name="${name}" ${S[name] ? "checked" : ""}></label>`;
}
function seg(name, opts) {
  return `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-seg="${name}" data-val="${v}" aria-pressed="${String(S[name]) === String(v)}">${l}</button>`).join("")}</div><input type="hidden" name="${name}" value="${esc(S[name])}">`;
}
function renderSettings() {
  const ev = SCHEMA.evidence || {};
  $("#settingsFields").innerHTML = `
    <div class="group">
      ${field("Watchlist", `<input class="input" name="watch" value="${esc(S.watch)}" autocomplete="off">`, "US tickers, comma-separated.")}
      ${field("Sector benchmark", seg("sector", [["SMH", "SMH"], ["SOXX", "SOXX"]]))}
      ${field("Refresh every", seg("refresh", [[30, "30 s"], [60, "60 s"], [120, "2 min"], [300, "5 min"]]))}
    </div>
    <div class="group">
      ${sw("long_only", "Long only", ev.shorts)}
      ${sw("require_sector", "Require SMH + QQQ above open and VWAP", ev.sector)}
      ${field("T212 round-trip spread (%)", `<input class="input" name="spread" type="number" min="0" max="2" step="0.05" value="${esc(S.spread)}">`, "Comes off every backtest and log result. Check the real spread in T212 for each stock.")}
      ${sw("show_orb", "Show experimental ORB-15 signal", ev.orb)}
    </div>
    <div class="group">
      ${field("Exit", `<select class="input" name="exit">${SCHEMA.exit_options.map((o) => `<option ${o === S.exit ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`, "The last 10 minutes moved 1.7× more than midday with no direction bias; exiting at 21:30 kept about 92% of the 15:40 result. When US and EU clocks change on different dates, every time is one hour earlier.")}
      ${field("CFD money (€)", `<input class="input" name="capital" type="number" min="100" step="100" value="${esc(S.capital)}">`)}
      ${field("Max risk per day (%)", `<input class="input" name="risk_day" type="number" min="0.1" max="5" step="0.1" value="${esc(S.risk_day)}">`, "One budget for the whole day: your semis move together, so 3 signals are closer to 1 bet than to 3.")}
      ${field("Stop (%)", `<input class="input" name="stop" type="number" min="0.5" max="10" step="0.5" value="${esc(S.stop)}">`)}
      ${field("When several signals fire", seg("size_mode", [["one", "One trade per day"], ["split", "Split the day's risk"]]), "One trade: the earliest signal, ties go to the calmest stock. Split: signals at the same time share the budget; later ones are skipped.")}
    </div>
    <div class="group">${sw("sound", "Sound when switching between CFD and Invest")}</div>
    <p class="muted" style="font-size:12px;margin:0">Signals are written to signal_log.csv next to the app. Not financial advice.</p>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-seg]");
  if (!b) return;
  const name = b.dataset.seg, grp = b.parentElement;
  grp.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  grp.nextElementSibling.value = b.dataset.val;
});

// ------------------------------------------------------------------ accounts (CFD / Invest), like T212
const ACCOUNTS = {
  cfd: [["live", "Live"], ["log", "Signal log"], ["spread", "Spread log"], ["backtest", "Backtest"], ["long", "2-year check"], ["guide", "Guide"]],
  invest: [["invest", "Trend"], ["invest-exits", "Exits"], ["invest-research", "Research"], ["invest-guide", "Guide"]],
};
const acctOf = (tab) => (ACCOUNTS.invest.some(([t]) => t === tab) ? "invest" : "cfd");
let currentAcct = null;
function renderTabs(acct) {
  if (acct === currentAcct) return;
  currentAcct = acct;
  $("#tabs").innerHTML = ACCOUNTS[acct].map(([t, l]) => `<a href="#${t}" data-tab="${t}">${l}</a>`).join("");
  document.body.dataset.acct = acct;
  document.querySelectorAll(".acct button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.acct === acct));
  placeAcctPill();
  try { localStorage.setItem("stdr.acct", acct); } catch (e) { /* ignore */ }
}
function placeAcctPill() {
  const pill = $(".acct-pill"), on = $(`.acct button[data-acct="${currentAcct}"]`);
  if (pill && on) { pill.style.left = `${on.offsetLeft}px`; pill.style.width = `${on.offsetWidth}px`; }
}

// the second part of semitrendaudio.mp3 (after the quiet dip at 0.96 s) plays on the account switch, softly
let sfx = null, sfxCtx = null;
async function playSwitch() {
  if (S.sound === false) return;
  try {
    sfxCtx = sfxCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (!sfx) sfx = await sfxCtx.decodeAudioData(await (await fetch("/web/sound/switch.mp3")).arrayBuffer());
    // second part: from the quiet dip at 0.96 s to the end (1.88 s), at about 35% volume
    const src = sfxCtx.createBufferSource(), g = sfxCtx.createGain(), t = sfxCtx.currentTime;
    const start = 0.96, len = Math.max(0.1, sfx.duration - start), vol = 0.35;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol, t + len - 0.12); g.gain.linearRampToValueAtTime(0, t + len);
    src.buffer = sfx; src.connect(g).connect(sfxCtx.destination); src.start(t, start, len);
  } catch (e) { /* sound is optional */ }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".acct button");
  if (!b || b.dataset.acct === currentAcct) return;
  playSwitch();
  let last = null;
  try { last = localStorage.getItem(`stdr.tab.${b.dataset.acct}`); } catch (er) { /* ignore */ }
  location.hash = "#" + (last && acctOf(last) === b.dataset.acct ? last : ACCOUNTS[b.dataset.acct][0][0]);
});

// ------------------------------------------------------------------ routing
let currentTab = "live";
const RENDER = { live: () => (liveData ? renderLive(liveData) : null, loadLive()), log: renderLog, spread: () => renderSpread(), backtest: renderBacktest, long: renderLong, guide: renderGuide,
  invest: () => { renderInvest(); loadInvest(); }, "invest-exits": () => renderExits(), "invest-research": renderInvestResearch, "invest-guide": renderInvestGuide };
function route() {
  const tab = (location.hash || "#live").slice(1);
  currentTab = RENDER[tab] ? tab : "live";
  renderTabs(acctOf(currentTab));
  try { localStorage.setItem(`stdr.tab.${currentAcct}`, currentTab); } catch (e) { /* ignore */ }
  document.querySelectorAll(".page").forEach((p) => (p.hidden = p.dataset.page !== currentTab));
  document.querySelectorAll(".tabs a").forEach((a) => (a.dataset.tab === currentTab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  movePill();
  if (currentTab === "live" && !liveData) $("#page-live").innerHTML = '<p class="loading">Loading live data…</p>';
  RENDER[currentTab]();
  window.scrollTo({ top: 0 });
}

// liquid-glass refraction filter: a displacement map that is neutral in the middle and bends at the rim
function injectRefraction() {
  if (document.getElementById("lg-defs")) return;
  const g = (id, x2, y2, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
  const mid = "rgb(128,128,128)";
  const map = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><defs>
    ${g("l", 1, 0, "rgb(0,128,128)", mid)}${g("r", 1, 0, mid, "rgb(255,128,128)")}
    ${g("t", 0, 1, "rgb(128,0,128)", mid)}${g("b", 0, 1, mid, "rgb(128,255,128)")}</defs>
    <rect width="100" height="100" fill="${mid}"/>
    <rect width="9" height="100" fill="url(#l)"/><rect x="91" width="9" height="100" fill="url(#r)"/>
    <rect width="100" height="9" fill="url(#t)"/><rect y="91" width="100" height="9" fill="url(#b)"/></svg>`;
  const href = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(map);
  // blur + bend + saturate all inside one SVG filter: Chrome drops CSS blur() chained after url()
  const f = (id, scale, blur, sat) => `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" edgeMode="duplicate" result="soft"/>
      <feImage href="${href}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map"/>
      <feDisplacementMap in="soft" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="bent"/>
      <feColorMatrix in="bent" type="saturate" values="${sat}"/></filter>`;
  const wrap = document.createElement("div");
  wrap.id = "lg-defs";
  wrap.setAttribute("aria-hidden", "true");
  wrap.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  wrap.innerHTML = `<svg width="0" height="0"><defs>${f("lg-refract", 26, 12, 1.75)}${f("lg-refract-strong", 40, 4, 1.9)}${f("lg-refract-hover", 26, 12, 1.75)}</defs></svg>`;
  document.body.prepend(wrap);
}

async function init() {
  injectRefraction();
  applyTheme(themeChoice);
  $("#themeBtn").onclick = () => {
    themeChoice = THEMES[(THEMES.indexOf(themeChoice) + 1) % THEMES.length];
    try { localStorage.setItem("stdr.theme", themeChoice); } catch (e) { /* ignore */ }
    applyTheme(themeChoice);
  };
  addEventListener("scroll", () => $("#nav").classList.toggle("scrolled", scrollY > 4), { passive: true });
  addEventListener("resize", () => { placeAcctPill(); movePill(); });
  try { SCHEMA = await api("/api/schema"); } catch (e) { /* defaults */ }
  try { LOGOS = await (await fetch("/web/logos/manifest.json")).json(); } catch (e) { LOGOS = {}; }
  if (!SCHEMA.exit_options.includes(S.exit)) S.exit = SCHEMA.exit_options[0] || "";
  const dlg = $("#drawer");
  $("#settingsBtn").onclick = () => { renderSettings(); dlg.showModal(); };
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  $("#resetSettings").onclick = () => { S = { ...DEFAULTS, exit: SCHEMA.exit_options[0] || "" }; renderSettings(); };
  $("#settingsForm").addEventListener("submit", (e) => {
    if (e.submitter && e.submitter.value === "cancel") return;
    const f = new FormData(e.target);
    S = { ...S, watch: f.get("watch") || DEFAULTS.watch, sector: f.get("sector"), refresh: Number(f.get("refresh")),
      long_only: f.has("long_only"), require_sector: f.has("require_sector"), spread: Number(f.get("spread")),
      show_orb: f.has("show_orb"), exit: f.get("exit"), capital: Number(f.get("capital")), risk_day: Number(f.get("risk_day")),
      stop: Number(f.get("stop")), size_mode: f.get("size_mode"), sound: f.has("sound") };
    save("stdr.settings", S);
    liveData = null; btCache = null;
    route();
  });
  addEventListener("hashchange", route);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && currentTab === "live") loadLive(); });
  if (!location.hash) { let a = null; try { a = localStorage.getItem("stdr.acct"); } catch (e) { /* ignore */ }
    if (a === "invest") location.hash = "#invest"; }
  route();
  if (currentTab !== "live") loadLive();   // keeps the status in the nav current on every tab
}
init();
