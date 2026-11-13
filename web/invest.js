/* Invest account: rule E risk meter, research and guide. Uses helpers from app.js (loaded after this file). */
"use strict";

let investData = null, investResearch = null, investTimer = null;

function trendChart(ch, up) {
  // price line coloured green above its 200-day average and red below; dashed line = 200-day average
  const c = ch.c, m = ch.ma, n = c.length;
  if (n < 2) return "";
  const W = 640, H = 170, vals = c.concat(m.filter(isNum)).filter(isNum);
  const lo = Math.min(...vals), hi = Math.max(...vals), sp = hi - lo || 1;
  const x = (i) => (i / (n - 1)) * W, y = (v) => 8 + (1 - (v - lo) / sp) * (H - 16);
  let segs = "", cur = null, d = "";
  for (let i = 0; i < n; i++) {
    if (!isNum(c[i])) continue;
    const above = !isNum(m[i]) || c[i] >= m[i];
    const pt = `${x(i).toFixed(1)},${y(c[i]).toFixed(1)}`;
    if (cur === null) { cur = above; d = `M${pt}`; continue; }
    d += `L${pt}`;
    if (above !== cur) { segs += `<path class="seg ${cur ? "up" : "dn"}" d="${d}"/>`; d = `M${pt}`; cur = above; }
  }
  segs += `<path class="seg ${cur ? "up" : "dn"}" d="${d}"/>`;
  const ma = m.map((v, i) => (isNum(v) ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : null)).filter(Boolean);
  const maPath = ma.length ? `<path class="ma" d="M${ma.join("L")}"/>` : "";
  return `<svg class="trend-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="One year of closes with the 200-day average">
    ${maPath}${segs}</svg>
    <div class="trend-axis"><span>${esc(ch.t[0] || "")}</span><span>200-day average dashed</span><span>${esc(ch.t[n - 1] || "")}</span></div>`;
}

const fmtDate = (s) => (s ? new Date(s + "T12:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

async function loadInvest() {
  try {
    const [d, r] = await Promise.all([api("/api/invest?" + qs()), investResearch ? Promise.resolve(investResearch) : fetch("/web/invest_research.json").then((x) => x.json())]);
    investData = d; investResearch = r;
    if (currentTab === "invest") renderInvest();
  } catch (e) {
    if (!investData) $("#page-invest").innerHTML = `<p class="loading err">Couldn't load the Invest data: ${esc(e.message)}.</p>`;
  }
  clearTimeout(investTimer);
  investTimer = setTimeout(() => { if (currentTab === "invest") loadInvest(); }, 5 * 60 * 1000);
}

function renderInvest() {
  const d = investData, R = investResearch;
  if (!d || !R) { $("#page-invest").innerHTML = '<p class="loading">Loading the trend data…</p>'; return; }
  if (d.error) { $("#page-invest").innerHTML = `<p class="loading err">${esc(d.error)}</p>`; return; }
  const m = d.market, out = d.out, live = d.stocks.filter((x) => x.enough_history);
  const inn = live.filter((x) => x.rule_in).map((x) => x.ticker);
  const head = m.up ? "Semis in an uptrend" : "Semis below their 200-day average";
  const sub = `SMH closed at ${fmt(m.close)}, ${pct(m.dist, 1)} ${m.up ? "above" : "versus"} its 200-day average (${fmt(m.ma200)}), ${m.up ? "above" : "below"} it since ${fmtDate(m.since)}. It is ${pct(m.drawdown, 1)} from its 1-year high on ${fmtDate(m.high_date)}.${m.partial ? " Today's bar is still forming; rule E decides at the close." : ""}`;
  const verdict = out.length
    ? `Rule E: <b class="loss">${out.length} of ${live.length} OUT</b> (${out.map(esc).join(", ")}). ${inn.length ? `${inn.map(esc).join(" and ")} stay${inn.length === 1 ? "s" : ""} IN on ${inn.length === 1 ? "its" : "their"} own trend.` : ""}`
    : `Rule E: <b class="gain">all ${live.length} IN</b>.`;
  const p = R.periods;
  const cards = d.stocks.map((s) => {
    if (s.error || !s.enough_history) return `<div class="glass inv-card"><span class="who">${logo(s.ticker)}<span class="tick-name">${esc(s.ticker)}</span></span><p class="sub">Not enough history for a 200-day average yet.</p></div>`;
    return `<article class="glass lift inv-card">
      <div class="inv-top"><span class="who">${logo(s.ticker)}<span><span class="tick-name">${esc(s.ticker)}</span><span class="co">${esc(coName(s.ticker))}</span></span></span>
        <span class="status-tag ${s.rule_in ? "gain" : "loss"}"><i></i>${s.rule_in ? "IN" : "OUT"}</span></div>
      <div class="inv-px"><span class="px">${fmt(s.close)}</span><span class="muted">${s.rule_in ? "in" : "out"} since ${fmtDate(s.since)}</span></div>
      ${trendChart(s.chart, s.own_up)}
      <div class="chips"><span class="chip">vs 200-day ${pct(s.dist, 1)}</span><span class="chip">from 1y high ${pct(s.drawdown, 1)}</span><span class="chip">1 year ${pct(s.chg_1y, 0)}</span></div>
      <p class="sub" style="font-size:12px">${s.own_up ? "Above its own 200-day average, so it stays in whatever SMH does." : m.up ? "Below its own average, but SMH is still above its average, so it stays in." : "Both the stock and SMH are below their averages: rule E steps out."}</p>
    </article>`;
  }).join("");
  const cyc = R.cycles.map((c) => `<div class="cal-item"><span class="label">${esc(c.peak)} → ${esc(c.low)}</span><span><b class="loss">${c.drop}%</b></span><span class="muted" style="font-size:13px">back at the high ${esc(c.recovered)} (${c.months} months)</span></div>`).join("")
    + `<div class="cal-item"><span class="label">${fmtDate(m.high_date)} → now</span><span><b class="loss">${pct(m.drawdown, 0)}</b></span><span class="muted" style="font-size:13px">not yet</span></div>`;
  $("#page-invest").innerHTML = `
    <section class="hero" data-tone="${m.up ? "gain" : "loss"}" aria-labelledby="inv-h">
      <div class="glass hero-card">
        <div class="hero-meta"><span class="label">Invest</span><span class="label">Rule E · as of the ${fmtDate(m.date)} close</span><span class="label">Updated ${esc(d.updated)}</span></div>
        <h1 class="h-display" id="inv-h"><span class="tone" aria-hidden="true"></span>${esc(head)}</h1>
        <p class="hero-sub">${esc(sub)}</p>
        <p class="inv-verdict">${verdict}</p>
        <div class="inv-smh"><div class="tile-top"><span class="who">${logo("SMH", "sm")}<span class="label">SMH, one year</span></span><span class="muted" style="font-size:12px">green above / red below the 200-day average</span></div>${trendChart(m.chart, m.up)}</div>
      </div>
    </section>
    <div class="bento" style="margin-top:16px">
      <div class="glass block lift span-4"><span class="label">What rule E does</span><span class="big">Steps out of a stock only when the stock and SMH are both below their 200-day average.</span><p class="sub">Back in as soon as either one closes above it again. It's a risk meter for your holdings, not a trading signal.</p></div>
      <div class="glass block lift span-4"><span class="label">What it costs and saves</span><span class="big">Worst drop ${p[0].e_dd}% instead of ${p[0].hold_dd}%</span><p class="sub">2014–2024: ${p[0].e_cagr}% a year instead of ${p[0].hold_cagr}%. In the April 2025 crash: ${R.crash_2025.e}% instead of ${R.crash_2025.hold}%. Protection costs some return; no rule beat holding on return in every period.</p></div>
      <div class="glass block lift span-4"><span class="label">Live track record</span><span class="big">${isNum(d.logged) ? d.logged : esc(String(d.logged))} stock-days logged</span><p class="sub">Every completed session is written to invest_log.csv, so rule E gets judged on days nobody had seen when it was chosen.</p></div>
    </div>
    <section class="section" aria-labelledby="inv-stocks"><div class="section-head"><h2 class="h-section" id="inv-stocks">Your stocks</h2>
      <p class="prose">Each stock's last year against its own 200-day average. IN means rule E would hold it; OUT means both keys have failed.</p></div>
      <div class="inv-grid">${cards}</div></section>
    <section class="section" aria-labelledby="inv-cyc"><div class="section-head"><h2 class="h-section" id="inv-cyc">The cycle inside the uptrend</h2>
      <p class="prose">SMH's big drops since 2001 and how long the recovery to the old high took. ${esc(R.best_near_worst)} That's why selling in a crash usually means missing the bounce.</p></div>
      <div class="cal"><div class="glass">${cyc}</div>
        <div class="glass block"><span class="label">How to use this</span><span class="big">Size so you could sit through −40% to −50% without being forced out.</span><p class="sub">Adding a fixed amount every month keeps buying through the down-phase. Rule E is there for the rare cycle that turns into a long winter, like 2001–2008.</p></div></div></section>`;
}

function renderInvestResearch() {
  const go = (R) => {
    $("#page-invest-research").innerHTML = `${head("Invest research", R.tested)}
      <div class="table-wrap"><table class="data"><thead><tr><th>Period</th><th class="n">Hold, a year</th><th class="n">Rule E, a year</th><th class="n">Hold, worst drop</th><th class="n">Rule E, worst drop</th><th>Note</th></tr></thead>
      <tbody>${R.periods.map((p) => `<tr><td>${esc(p.name)}</td><td class="n">${p.hold_cagr}%</td><td class="n">${p.e_cagr}%</td><td class="n"><span class="loss">${p.hold_dd}%</span></td><td class="n"><span class="loss">${p.e_dd}%</span></td><td>${esc(p.note)}</td></tr>`).join("")}</tbody></table></div>
      <section class="section"><div class="section-head"><h2 class="h-section">Files</h2><p class="prose">Each test was written down before it ran. Plans and results are in Downloads\\semi-trend-day-data.</p></div>
      <ul class="list">${R.files.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></section>`;
  };
  if (investResearch) go(investResearch);
  else fetch("/web/invest_research.json").then((x) => x.json()).then((r) => { investResearch = r; go(r); });
}

function renderInvestGuide() {
  $("#page-invest-guide").innerHTML = head("Invest guide", "How to read the Invest side, and what it can and can't do.") + `<div class="guide">
    <h3>Two accounts, two jobs</h3><ul>
      <li><b>CFD</b> is the day-trading desk: same-day setups, sizing, stops and the 21:30 exit.</li>
      <li><b>Invest</b> is about the stocks you hold for months or years: is the sector in its uptrend or in a cycle low?</li></ul>
    <h3>Rule E in one line</h3><p>Step out of a stock only when both SMH and that stock close below their own 200-day average. Step back in as soon as either closes above it.</p>
    <h3>What the tests found</h3><ul>
      <li>It cut the worst drops (−43% instead of −54% in 2014–2024; −7% instead of −35% in the April 2025 crash).</li>
      <li>It cost return in most periods: protection isn't free in a sector that bounces this fast.</li>
      <li>It reacts late to a decline that starts at a peak, like June 2026: it stepped out on 2 Nov.</li></ul>
    <h3>Caveats</h3><ul>
      <li>A 200-day rule is decided at the close; a reading during the day can still change.</li>
      <li>Yahoo's daily data can be late or patchy. Splits are handled through adjusted closes.</li>
      <li>Not financial advice. Past cycles don't promise the next one ends the same way.</li></ul></div>`;
}
