/* Semi Trend-Day Radar front end. Plain JS, no build step. All numbers come from /api (engine.py). */
"use strict";

// ------------------------------------------------------------------ helpers
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MINUS = "−";
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
  require_sector: true, spread: 0.25, show_orb: false, exit: "", capital: 2000, risk_day: 1, stop: 3, size_mode: "one" };
let S = load("stdr.settings", DEFAULTS);
let SCHEMA = { exit_options: [], evidence: {} };
function load(k, d) { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || "{}") }; } catch (e) { return { ...d }; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
function qs(extra = {}) {
  const p = new URLSearchParams({ ...S, ...extra });
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

// ------------------------------------------------------------------ charts (SVG)
function spark(values, base, chg) {
  if (!values || values.length < 2) return '<svg class="spark" aria-hidden="true"></svg>';
  const w = 200, h = 40, all = values.concat(isNum(base) ? [base] : []);
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const x = (i) => (i / (values.length - 1)) * w, y = (v) => h - ((v - lo) / span) * h;
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const by = isNum(base) ? y(base).toFixed(1) : null;
  const col = chg > 0 ? "var(--gain)" : chg < 0 ? "var(--loss)" : "var(--muted)";
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    ${by ? `<line class="base" x1="0" x2="${w}" y1="${by}" y2="${by}" vector-effect="non-scaling-stroke"/>` : ""}
    <path d="${d}" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(values.length - 1)}" cy="${y(values[values.length - 1])}" r="2.6" fill="${col}"/></svg>`;
}

function gauge(chance, level, rates) {
  const top = Math.max(60, chance || 0), cx = 150, cy = 150, r = 118, sw = 18;
  const ang = (v) => Math.PI * (1 - Math.min(v, top) / top);
  const pt = (v, rr) => [cx + rr * Math.cos(ang(v)), cy - rr * Math.sin(ang(v))];
  const arc = (a, b) => { const [x1, y1] = pt(a, r), [x2, y2] = pt(b, r); return `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}`; };
  const ticks = [rates["no warning"], rates.base, rates["any warning"], rates["gap ±5%"]];
  const tickSvg = ticks.map((v) => {
    const [a1, b1] = pt(v, r - sw / 2 - 1), [a2, b2] = pt(v, r + sw / 2 + 1), [lx, ly] = pt(v, r + sw / 2 + 14);
    return `<line class="tick" x1="${a1.toFixed(1)}" y1="${b1.toFixed(1)}" x2="${a2.toFixed(1)}" y2="${b2.toFixed(1)}"/>
      <text class="tick-lbl" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${v}</text>`;
  }).join("");
  const hot = level === "High" || level === "Elevated" ? " hot" : "";
  return `<svg class="gauge" viewBox="0 0 300 168" role="img" aria-label="Chance of a 7 percent day: ${Math.round(chance)} percent">
    <path class="track" d="${arc(0, top)}" stroke-width="${sw}" fill="none" stroke-linecap="butt"/>
    <path class="fill${hot}" d="${arc(0, chance)}" stroke-width="${sw}" fill="none" stroke-linecap="butt"/>
    ${tickSvg}</svg>`;
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
  c.t.forEach((t, i) => { if (t.endsWith(":30") || t.endsWith(":00")) { if (i % Math.ceil(n / 7) === 0) labels += `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${t}</text>`; } });
  const mk = (marks || []).map((m) => {
    if (!isNum(m.bar) || m.bar >= n) return "";
    const xx = x(m.bar), yy = y(m.entry), up = m.side === "LONG";
    const p = up ? `${xx - 6},${yy + 14} ${xx + 6},${yy + 14} ${xx},${yy + 4}` : `${xx - 6},${yy - 14} ${xx + 6},${yy - 14} ${xx},${yy - 4}`;
    return `<polygon class="mark" points="${p}"><title>${esc(m.setup)} ${m.side} at ${fmt(m.entry)}</title></polygon>`;
  }).join("");
  return `<svg class="candles" viewBox="0 0 ${W} ${H}" role="img" aria-label="5-minute candles with VWAP and yesterday's close">${g}${pv}${body}<path class="vwap" d="${vw}"/>${mk}${labels}</svg>`;
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
let liveTimer = null, liveData = null, openTickers = new Set();
const phaseWord = { open: "US market open", pre: "Pre-market", closed: "US market closed", weekend: "Weekend" };

async function loadLive() {
  try {
    liveData = await api("/api/live?" + qs());
    renderLive(liveData);
  } catch (e) {
    if (!liveData) $("#page-live").innerHTML = `<p class="loading err">Couldn't load live data: ${esc(e.message)}. Retrying.</p>`;
    setStatus("closed", "Connection problem");
  }
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { if (currentTab === "live") loadLive(); }, (Number(S.refresh) || 60) * 1000);
}

function setStatus(phase, text) {
  const el = $("#status");
  el.dataset.phase = phase;
  el.querySelector("span").textContent = text;
}

function renderLive(d) {
  setStatus(d.phase, `${phaseWord[d.phase]} · ${d.updated.slice(0, 5)}`);
  const D = d.decision;
  const today = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  // decision
  const tickets = (D.takes || []).map((p) => `
    <div class="ticket"><div class="ticket-row">
      <div><span class="label">Position</span><span class="val">${eur(p.position_eur)}</span></div>
      <div><span class="label">Margin 5:1</span><span class="val">${eur(p.margin_eur_5to1)}</span></div>
      <div><span class="label">Risk</span><span class="val">${eur(p.risk_eur, 2)}</span></div>
      <div><span class="label">Stop</span><span class="val">${fmt(p.stop_price)}</span></div>
      <div><span class="label">Exit</span><span class="val">${esc(D.exit)}</span></div>
    </div><div class="ticket-who">${esc(p.ticker)} ${p.side} · ${esc(p.setup)} · entry ${fmt(p.entry)} at ${esc(p.entry_time)}</div></div>`).join("");

  const facts = [];
  if (D.filter) {
    const f = D.filter;
    facts.push(["Market filter", `<span class="${f.ok ? "gain" : "loss"}">${f.ok ? "Longs allowed" : "Longs blocked"}</span>
      <span class="muted"> · ${esc(String(f.note || "").replace(/^since today's open: /, "").replace(/-(\d)/g, MINUS + "$1"))} since the open</span>
      ${f.fade ? '<br><span class="muted">Up on the day but fading since the open: the gap-up-and-fade case the filter is built to catch.</span>' : ""}`]);
  }
  if (D.size_mode === "split" && D.takes.length) {
    const used = D.takes.reduce((a, p) => a + (p.risk_eur || 0), 0);
    facts.push(["Risk used", `<span class="num">${eur(used, 2)} of ${eur(D.budget, 2)}</span> today`]);
  }
  if (D.catalysts.length) facts.push(["Catalysts today", `${D.catalysts.map(esc).join(" · ")} <span class="muted">(very high impact)</span>`]);
  if (D.stay_out.length) facts.push(["Stay out", `${D.stay_out.map(esc).join(", ")} <span class="muted">· first hour went against the gap</span>`]);
  if (D.also.length) facts.push(["Also fired", D.also.map((a) => `${esc(a.ticker)} <span class="muted">(${esc((a.blocked || []).join(", ") || "not in plan")})</span>`).join(", ")]);

  let why = "";
  if (d.since_open) {
    const f = D.filter;
    why = disclose("why-open", "Why: SMH, QQQ and your stocks since the open", dataTable(d.since_open) +
      (f ? `<p class="prose">Versus yesterday's close: SMH ${pctHtml(f.smh_day)}, QQQ ${pctHtml(f.qqq_day)}. The filter looks at the move since the 15:30 open, not the day.</p>` : "") +
      `<p class="prose">Last 10 min = latest 5-min close vs two candles earlier; the newest candle may still be forming.</p>`);
  }

  const hero = `<section class="hero" data-tone="${D.tone}" aria-labelledby="decision">
    <div class="hero-meta"><span class="label">${esc(today)}</span><span class="label">${esc(phaseWord[d.phase])}</span><span class="label">Updated ${esc(d.updated)}</span></div>
    <h1 class="h-display" id="decision"><span class="tone" aria-hidden="true"></span>${esc(D.head)}</h1>
    <p class="hero-sub">${esc(D.sub)}</p>
    ${tickets}
    ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt class="label">${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` : ""}
    ${why}
  </section>`;

  // radar
  const rows = d.radar.rows.filter((r) => r.level);
  const topRow = rows.slice().sort((a, b) => b.chance - a.chance)[0];
  const rates = d.radar.rates;
  const radar = `<section class="section" aria-labelledby="h-radar">
    <div class="section-head"><h2 class="h-section" id="h-radar">Big-day radar</h2>
      <p class="prose">How likely a ±7% day is, from the warnings that came before past big days (SNDK/MU/WDC, Nov 2024 to Nov 2026). It tells you how big the day may get, not which way.</p></div>
    <div class="radar">
      ${topRow ? `<div class="card gauge-card"><span class="label">${esc(topRow.ticker)} · chance of a ±7% day</span>${gauge(topRow.chance, topRow.level, rates)}
        <div class="gauge-num">${Math.round(topRow.chance)}%</div>
        <p class="gauge-key">Marks: ${rates["no warning"]}% with no warning · ${rates.base}% on all days · ${rates["any warning"]}% with any warning · ${rates["gap ±5%"]}% after a 5%+ gap.</p></div>` : ""}
      <div class="rows" role="table" aria-label="Big-day radar per stock">
        <div class="row radar-row radar-head" role="row"><span class="label" role="columnheader">Stock</span><span class="label" role="columnheader">Level</span><span class="label" role="columnheader">Chance</span><span class="label" role="columnheader">Gap</span><span class="label hide-sm" role="columnheader">Warnings</span></div>
        ${d.radar.rows.map((r) => r.level ? `<div class="row radar-row" role="row">
          <span class="tick-name" role="cell">${esc(r.ticker)}</span>
          <span class="level-${r.level}" role="cell">${r.level}</span>
          <span class="meter" role="cell"><span class="meter-track"><span class="meter-fill" style="width:${Math.min(100, r.chance)}%"></span></span><span class="num">${Math.round(r.chance)}%</span></span>
          <span role="cell">${pctHtml(r.gap, 1)}<br><span class="muted" style="font-size:12px">${r.gap_label}</span></span>
          <span class="warn" role="cell">${esc((r.warnings || []).join(" · ").replace(/-(\d)/g, MINUS + "$1")) || "No warnings"}${r.vol ? ` · volatility ${r.vol}` : ""}${r.memory && isNum(r.hynix) ? ` · Hynix ${pct(r.hynix, 1)}` : ""}</span>
        </div>` : `<div class="row radar-row" role="row"><span class="tick-name">${esc(r.ticker)}</span><span class="muted">No data</span></div>`).join("")}
      </div>
    </div></section>`;

  // signals
  const fired = d.setups.fired;
  const setupCols = d.setups.columns;
  const allSetups = {
    columns: ["Stock", ...setupCols.flatMap((c) => [c, `${c} detail`])],
    rows: d.setups.rows.map((r) => [r.ticker, ...r.cells.flatMap((c) => [
      c.side ? `${c.passed ? "TAKE" : "Skip"} ${c.side} @ ${fmt(c.entry)} · now ${pct(c.now)}` : c.state,
      [c.detail, c.filters ? `sector ${c.filters.sector ? "ok" : "not ok"}${c.filters.breadth != null ? ` · breadth ${c.filters.breadth}/3` : ""}${isNum(c.filters.atr_used) ? ` · ATR used ${fmt(c.filters.atr_used)}` : ""}` : ""].filter(Boolean).join(" · ")])]),
  };
  const signals = `<section class="section" aria-labelledby="h-sig">
    <div class="section-head"><h2 class="h-section" id="h-sig">Signals today</h2>
      <p class="prose"><strong>${esc(setupCols[0])}:</strong> ${esc(d.setups.rules[setupCols[0]])} <strong>${esc(setupCols[1])}:</strong> ${esc(d.setups.rules[setupCols[1]])}</p></div>
    ${fired.length ? `<div class="rows">
      <div class="row sig-row radar-head"><span class="label">Stock</span><span class="label">Setup</span><span class="label">Decision</span><span class="label hide-sm">Entry</span><span class="label hide-sm">Now</span><span class="label hide-sm">Filters</span></div>
      ${fired.map((f) => `<div class="row sig-row">
        <span class="tick-name">${esc(f.ticker)}</span><span><span class="chip">${esc(f.setup)}</span> <span class="muted">${esc(f.time)}</span></span>
        <span class="badge ${f.taken ? "gain" : "muted"}">${f.taken ? "TAKE" : "Skip"} ${f.side}</span>
        <span class="num hide-sm">${fmt(f.entry)}</span><span class="hide-sm">${pctHtml(f.now)}</span>
        <span class="warn hide-sm">${f.taken ? "" : esc((f.blocked || []).join(", ")) + " · "}sector ${f.filters.sector ? "ok" : "not ok"}${f.filters.breadth != null ? ` · breadth ${f.filters.breadth}/3` : ""}</span>
      </div>`).join("")}</div>` : `<p class="empty">No setup has fired today.</p>`}
    ${d.setups.research.length ? `<ul class="list" style="margin-top:20px">${d.setups.research.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    <p class="prose" style="font-size:13px;margin-top:16px">Exit: ${esc(d.exit_label.toLowerCase())}, ${d.caption.stop}% stop (tight trailing stops ruined these setups in every test). Risk budget: ${d.caption.risk_day}% of ${eur(d.caption.capital)} for the whole day. Your ${fmt(d.caption.spread)}% spread setting comes off every result; check T212's live spread before you enter.</p>
    ${disclose("all-setups", "All setups today, per stock", dataTable(allSetups))}
    ${d.log_error ? `<p class="err">Couldn't update signal_log.csv: ${esc(d.log_error)}</p>` : ""}
  </section>`;

  // market
  const tape = d.tape.items.map((t) => t.last == null ? `<div class="card tile"><span class="label">${t.ticker}</span><span class="fig-val">—</span></div>` : `
    <div class="card tile"><span class="label">${t.ticker}</span><span class="fig-val">${fmt(t.last)}</span>
      <span class="chg">${pctHtml(t.chg)} <span class="muted">· ${t.vwap_dist > 0 ? "above" : "below"} VWAP</span></span>
      ${isNum(t.pre) ? `<span class="pre">Pre-market ${fmt(t.pre)} ${pctHtml(t.pre_chg)}</span>` : ""}
      ${spark(t.spark, t.prev_close, t.chg)}</div>`).join("");
  const breadth = `<div class="card tile"><span class="label">Watchlist breadth</span><span class="fig-val">${isNum(d.tape.breadth) ? (d.tape.breadth > 0 ? "+" : d.tape.breadth < 0 ? MINUS : "") + Math.abs(d.tape.breadth).toFixed(2) : "—"}</span>
    <span class="pre">(up − down) / total. Near ±1, the whole group moves together.</span></div>`;
  const ov = d.overnight.map((o) => `<div><span class="label">${esc(o.name)}</span><span class="fig-val">${isNum(o.last) ? fmt(o.last, 0) : "—"}</span>
    <span class="chg">${pctHtml(o.chg)}${o.stale ? ' <span class="muted">· not today</span>' : ""}</span></div>`).join("");
  const market = `<section class="section" aria-labelledby="h-mkt">
    <div class="section-head"><h2 class="h-section" id="h-mkt">Sector tape</h2><p class="prose">Versus yesterday's close. The thin dotted line in each chart is yesterday's close.</p></div>
    <div class="tiles">${tape}${breadth}</div>
    <div class="section-head" style="margin-top:48px"><h3 class="h-sub">Overnight read</h3><p class="prose">Korea and Japan close 07:30 your time. When SK Hynix moved 3%+, MU/SNDK/WDC gapped the same way 77% of the time (60-day test).</p></div>
    <div class="figs">${ov}</div></section>`;

  // watchlist
  const wl = d.watchlist;
  const wlRows = wl.rows.map((r) => {
    if (r.last == null) return `<div class="row wl-row"><span class="tick-name">${esc(r.ticker)}</span><span class="muted">No data</span></div>`;
    const open = openTickers.has(r.ticker);
    return `<div class="row wl-row" role="button" tabindex="0" aria-expanded="${open}" data-ticker="${esc(r.ticker)}">
      <span class="tick-name">${esc(r.ticker)}</span><span class="hide-sm">${spark(r.spark, r.prev_close, r.chg)}</span>
      <span class="num">${fmt(r.last)}</span><span>${pctHtml(r.chg)}</span>
      <span class="hide-sm">${pctHtml(isNum(r.pre_chg) ? r.pre_chg : r.gap)}</span><span class="hide-sm hide-md">${pctHtml(r.first30)}</span>
      <span class="hide-sm">${pctHtml(r.vwap_dist)}</span><span class="hide-sm hide-md">${esc(r.or)}</span>
      <span class="num hide-sm hide-md">${isNum(r.rvol) ? fmt(r.rvol) : "—"}</span>
      <span class="hide-sm">${esc(r.verdict)} <span class="muted num">${isNum(r.score) ? "· " + fmt(r.score, 0) : ""}</span></span>${chev}</div>
      <div class="wl-detail" id="wl-${esc(r.ticker)}" ${open ? "" : "hidden"}>
        <div>${candles(r.candles, r.prev_close, r.marks)}
          <div class="legend"><span><i></i>VWAP</span><span><i class="prev"></i>Yesterday's close</span><span>▲ ▼ setup entries</span></div></div>
        <div><h3 class="h-sub">Why the score</h3><ul class="list" style="margin:12px 0 24px">${(r.reasons || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          <h3 class="h-sub">Headlines</h3><ul class="list news" data-news="${esc(r.ticker)}" style="margin-top:12px"><li class="muted">Loading…</li></ul></div>
      </div>`;
  }).join("");
  const anyPre = wl.rows.some((r) => isNum(r.pre_chg));
  const watch = `<section class="section" aria-labelledby="h-wl">
    <div class="section-head"><h2 class="h-section" id="h-wl">Watchlist</h2>
      <p class="prose">${wl.session ? `Session of ${esc(wl.session)} · ${wl.minutes} min of trading. ` : ""}Open a row for the 5-minute chart, the score reasons and headlines. The trend score is experimental: a simplified version didn't hold up in testing.</p></div>
    <div class="rows">
      <div class="row wl-row head"><span class="label">Stock</span><span class="label hide-sm">Today</span><span class="label">Last</span><span class="label">Change</span>
        <span class="label hide-sm">${anyPre ? "Pre-mkt" : "Gap"}</span><span class="label hide-sm hide-md">First 30m</span><span class="label hide-sm">vs VWAP</span>
        <span class="label hide-sm hide-md">Range</span><span class="label hide-sm hide-md">RVOL</span><span class="label hide-sm">Score</span><span></span></div>
      ${wlRows}</div></section>`;

  // calendar
  const ct = d.catalysts.today, up = d.catalysts.upcoming;
  const cal = `<section class="section" aria-labelledby="h-cal">
    <div class="section-head"><h2 class="h-section" id="h-cal">Calendar</h2><p class="prose">From catalysts.csv plus earnings dates from Yahoo. Add your own events to catalysts.csv.</p></div>
    <div class="cal"><div><h3 class="h-sub" style="margin-bottom:12px">Today</h3>${ct.length ? ct.map((c) => `<div class="cal-item"><span class="label">${esc(c.time || "All day")}</span><span>${esc(c.event)}<br><span class="muted" style="font-size:13px">${esc(c.affects)}</span></span><span class="${c.impact === "Very high" ? "" : "muted"}" style="font-size:13px">${esc(c.impact)}</span></div>`).join("") : '<p class="empty">Nothing scheduled.</p>'}</div>
      <div><h3 class="h-sub" style="margin-bottom:12px">Next 3 weeks</h3>${up.length ? up.map((c) => `<div class="cal-item"><span class="label">${esc(new Date(c.date + "T12:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }))}${c.time ? " · " + esc(c.time) : ""}</span><span>${esc(c.event)}</span><span class="muted" style="font-size:13px">${esc(c.impact)} · ${esc(c.status)}</span></div>`).join("") : '<p class="empty">Nothing on the calendar.</p>'}</div></div></section>`;

  const page = $("#page-live");
  page.innerHTML = hero + radar + signals + `<hr class="rule">` + market + watch + cal;
  restoreOpen(page);
  openTickers.forEach((t) => loadNews(t));
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

function toggleRow(row) {
  const t = row.dataset.ticker, panel = document.getElementById(`wl-${t}`), open = row.getAttribute("aria-expanded") !== "true";
  row.setAttribute("aria-expanded", open);
  panel.hidden = !open;
  open ? (openTickers.add(t), loadNews(t)) : openTickers.delete(t);
}
document.addEventListener("click", (e) => { const r = e.target.closest(".wl-row[data-ticker]"); if (r && !e.target.closest("a")) toggleRow(r); });
document.addEventListener("keydown", (e) => { const r = e.target.closest?.(".wl-row[data-ticker]"); if (r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleRow(r); } });

// ------------------------------------------------------------------ Signal log
async function renderLog() {
  const p = $("#page-log");
  p.innerHTML = head("Signal log", "Every setup signal is written to signal_log.csv with its entry price and the filter state at that moment, then filled in with the close at your exit time. Rejected signals are logged too, so you can see live whether the filters help. After 30+ signals per line, trust these numbers over the research.") + '<p class="loading">Loading…</p>';
  try {
    const d = await api("/api/log?" + qs());
    p.innerHTML = head("Signal log", "Every setup signal is written to signal_log.csv with its entry price and the filter state at that moment, then filled in with the close at your exit time. Rejected signals are logged too, so you can see live whether the filters help. After 30+ signals per line, trust these numbers over the research.") +
      (d.count ? `<section class="section" style="padding-top:0"><div class="section-head"><h2 class="h-section">Results so far</h2><p class="prose">Closed signals. Results are % moves from entry to the close; after spread subtracts your ${fmt(Number(S.spread))}% setting. The log doesn't apply the 3% stop.</p></div>${dataTable(d.stats, { empty: "No closed signals yet." })}</section>
      <section class="section"><div class="section-head"><h2 class="h-section">All signals</h2><a class="btn btn-ghost btn-sm" href="/api/log.csv" download>Download CSV</a></div>${dataTable(d.rows)}</section>`
        : '<p class="empty">No signals logged yet. Keep the app open during US hours, from 15:30 your time.</p>');
  } catch (e) { p.insertAdjacentHTML("beforeend", `<p class="err">${esc(e.message)}</p>`); }
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
    <p class="muted" style="font-size:12px;margin:0">Signals are written to signal_log.csv next to the app. Not financial advice.</p>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-seg]");
  if (!b) return;
  const name = b.dataset.seg, grp = b.parentElement;
  grp.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  grp.nextElementSibling.value = b.dataset.val;
});

// ------------------------------------------------------------------ routing
let currentTab = "live";
const RENDER = { live: () => (liveData ? renderLive(liveData) : null, loadLive()), log: renderLog, spread: () => renderSpread(), backtest: renderBacktest, long: renderLong, guide: renderGuide };
function route() {
  const tab = (location.hash || "#live").slice(1);
  currentTab = RENDER[tab] ? tab : "live";
  document.querySelectorAll(".page").forEach((p) => (p.hidden = p.dataset.page !== currentTab));
  document.querySelectorAll(".tabs a").forEach((a) => (a.dataset.tab === currentTab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  if (currentTab === "live" && !liveData) $("#page-live").innerHTML = '<p class="loading">Loading live data…</p>';
  RENDER[currentTab]();
  window.scrollTo({ top: 0 });
}

async function init() {
  applyTheme(themeChoice);
  $("#themeBtn").onclick = () => {
    themeChoice = THEMES[(THEMES.indexOf(themeChoice) + 1) % THEMES.length];
    try { localStorage.setItem("stdr.theme", themeChoice); } catch (e) { /* ignore */ }
    applyTheme(themeChoice);
  };
  addEventListener("scroll", () => $("#nav").classList.toggle("scrolled", scrollY > 4), { passive: true });
  try { SCHEMA = await api("/api/schema"); } catch (e) { /* defaults */ }
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
      stop: Number(f.get("stop")), size_mode: f.get("size_mode") };
    save("stdr.settings", S);
    liveData = null; btCache = null;
    route();
  });
  addEventListener("hashchange", route);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && currentTab === "live") loadLive(); });
  route();
  if (currentTab !== "live") loadLive();   // keeps the status in the nav current on every tab
}
init();
