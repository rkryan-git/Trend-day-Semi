/* Invest → Exits: every stock you sold, followed as if you had kept it. Helpers from app.js / invest.js. */
"use strict";

function exitChart(ch, sellPx, until) {
  // price after the sale: green above your sell price, red below; dashed line = your sell price
  const c = ch.c.filter(isNum), n = c.length;
  if (n < 3) return `<p class="sub" style="font-size:12px;padding:24px 0">${until ? "Bought back within a day or two: too few closes to draw a chart." : "Sold very recently: the chart fills in as new closes come in."}</p>`;
  const W = 640, H = 120, lo = Math.min(...c, sellPx), hi = Math.max(...c, sellPx), sp = hi - lo || 1;
  const x = (i) => (i / (n - 1)) * W, y = (v) => 6 + (1 - (v - lo) / sp) * (H - 12);
  const by = y(sellPx).toFixed(1), d = c.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const id = `ex${++sparkId}`, area = `${d}L${W},${by}L0,${by}Z`;
  const ticks = [0, Math.round((n - 1) / 2), n - 1];
  return `<svg class="spark area-spark exit-chart has-tip" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"
      data-v='${JSON.stringify(c)}' data-t='${JSON.stringify(ch.t)}' data-lo="${lo}" data-hi="${hi}" data-h="${H}" data-pt="6" data-pb="6"
      data-ref="${sellPx}" data-ref-label="vs your sell price">
    <defs><clipPath id="${id}u"><rect x="0" y="0" width="${W}" height="${by}"/></clipPath><clipPath id="${id}d"><rect x="0" y="${by}" width="${W}" height="${H - by}"/></clipPath></defs>
    <line class="base" x1="0" x2="${W}" y1="${by}" y2="${by}" vector-effect="non-scaling-stroke"/>
    <path class="area up" d="${area}" clip-path="url(#${id}u)"/><path class="area dn" d="${area}" clip-path="url(#${id}d)"/>
    <path class="line up" d="${d}" clip-path="url(#${id}u)" vector-effect="non-scaling-stroke"/><path class="line dn" d="${d}" clip-path="url(#${id}d)" vector-effect="non-scaling-stroke"/></svg>
    <div class="chart-axis">${ticks.map((k) => `<span>${esc(ch.t[k] || "")}</span>`).join("")}</div>`;
}

const eurS = (x) => (isNum(x) ? (x >= 0 ? "+" : MINUS) + "€" + Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—");

async function renderExits(msg = "") {
  const p = $("#page-invest-exits");
  const upload = `<label class="btn btn-primary" for="exitsFile">${investExits && !investExits.empty ? "Add another export" : "Upload your T212 export"}</label>
    <input type="file" id="exitsFile" accept=".csv,text/csv" multiple hidden>
    ${investExits && !investExits.empty ? '<button class="btn btn-ghost" type="button" id="exitsClear">Remove all</button>' : ""}`;
  const how = `<ol class="steps"><li>In Trading 212, open your <b>Invest</b> account → <b>History</b> → the download icon → <b>Export CSV</b>.</li>
    <li>Tick <b>Orders</b> (dividends and deposits aren't needed). Pick up to 12 months; for older sells, add another export. They combine.</li>
    <li>Upload the file here. It stays on this computer as exits_trades.csv and is never added to git or a zip.</li></ol>`;
  if (!investExits) { p.innerHTML = '<p class="loading">Loading your exits…</p>'; try { investExits = await api("/api/exits"); } catch (e) { investExits = { empty: true, error: e.message }; } }
  const d = investExits;
  if (d.empty) {
    p.innerHTML = `${head("Exits", "Every stock you sold, followed as if you had kept it: what you missed, and what you avoided.")}
      <div class="glass block" style="max-width:760px"><span class="label">Get started</span>${how}<div class="form-row" style="margin-top:8px">${upload}</div>
      <p class="toast" id="exitsMsg" aria-live="polite">${msg}</p></div>`;
  } else {
    const net = d.net_eur, good = net <= 0;
    const cards = d.sells.map((s) => s.error ? `<article class="glass inv-card"><div class="inv-top"><span class="who">${logo(s.ticker)}<span><span class="tick-name">${esc(s.ticker)}</span><span class="co">${esc(s.name)}</span></span></span></div>
        <p class="sub">Sold ${esc(s.time)} at ${fmt(s.price)} ${esc(s.currency)}. ${esc(s.error)}</p></article>` : `
      <article class="glass lift inv-card">
        <div class="inv-top"><span class="who">${logo(s.ticker)}<span><span class="tick-name">${esc(s.ticker)}</span><span class="co">${esc(s.name)}</span></span></span>
          <span class="status-tag ${s.diff_eur > 0 ? "loss" : "gain"}"><i></i>${s.diff_eur > 0 ? "Missed" : "Avoided"} ${eurS(Math.abs(s.diff_eur || 0)).replace(/^[+−]/, "")}</span></div>
        <div class="inv-px"><span class="px">${fmt(s.now)} <span class="muted" style="font-size:13px">${esc(s.currency)}</span></span>
          <span class="muted">sold ${fmt(s.price)} on ${esc(s.time.slice(0, 11))}</span></div>
        ${exitChart(s.chart, s.ref_px || s.price, s.until)}
        <div class="chips">${s.spent_eur ? `<span class="chip chip-spent">Spent €${Math.round(s.spent_eur).toLocaleString("en-US")}</span>` : ""}<span class="chip">since you sold ${pct(s.chg_since, 1)}</span><span class="chip">best after ${pct(s.best_after, 0)}</span>
          <span class="chip">worst after ${pct(s.worst_after, 0)}</span>${isNum(s.smh_chg) ? `<span class="chip">SMH same period ${pct(s.smh_chg, 1)}</span>` : ""}</div>
        <p class="sub" style="font-size:12px">${s.foreign_listing ? `Price data from ${esc(s.symbol)} (another listing), measured from its close on the day you sold. ` : ""}${s.until ? `Followed until you bought back on ${esc(s.until)} at ${fmt(s.rebought_at)}. ` : ""}${s.rule_e_out === true ? "Rule E agreed with this sell: the stock and SMH were both below their 200-day average." : s.rule_e_out === false ? "Rule E would have kept holding." : ""}</p>
      </article>`).join("");
    p.innerHTML = `${head("Exits", "Every stock you sold, followed as if you had kept it.")}
      <section class="hero" data-tone="${good ? "gain" : "loss"}"><div class="glass hero-card">
        <div class="hero-meta"><span class="label">${d.count} sell${d.count === 1 ? "" : "s"}</span><span class="label">In euros at today's EUR/USD ${isNum(d.eurusd) ? d.eurusd.toFixed(4) : ""}</span></div>
        <h1 class="h-display"><span class="tone" aria-hidden="true"></span>${good ? "Your exits saved " + eurS(-net).replace(/^\+/, "") : "Holding would have made " + eurS(net)}</h1>
        <p class="hero-sub">Missed by selling: ${eurS(d.missed_eur)} · avoided by selling: ${eurS(d.avoided_eur).replace("+", "")}. ${d.e_known ? `Rule E agreed with ${d.e_agreed} of ${d.e_known} sells.` : ""}</p>
        <p class="sub" style="margin-top:10px;font-size:13px">Fair warning: this follows the stock only, not what you did with the cash. If you put the money into something else, that part isn't counted. A buy-back ends the comparison.</p>
        <div class="form-row" style="margin-top:20px">${upload}</div><p class="toast" id="exitsMsg" aria-live="polite">${msg}</p></div></section>
      ${spendHTML(d)}
      ${flowsHTML(d)}
      <section class="section"><div class="section-head"><h2 class="h-section">Every sell</h2>
        <div class="head-side"><p class="prose">Newest first. Each one follows the stock from the moment you sold, until today or until you bought it back.</p>
        ${viewSwitch("exits")}</div></div>
        ${d.sells.length ? sellsView(d.sells, cards) : '<p class="empty">No sells in this export.</p>'}</section>`;
  }
  const inp = $("#exitsFile");
  if (inp) inp.onchange = async () => {
    const files = [...inp.files];
    if (!files.length) return;
    $("#exitsMsg").textContent = "Reading your export and fetching prices…";
    try {
      for (const f of files) investExits = await api("/api/exits", { method: "POST", headers: { "Content-Type": "text/csv" }, body: await f.text() });
      renderExits(`Added ${files.map((f) => f.name).join(", ")}. Exports are combined; duplicates are skipped.`);
    } catch (e) { $("#exitsMsg").innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
  const clr = $("#exitsClear");
  if (clr) clr.onclick = async () => { investExits = await api("/api/exits", { method: "DELETE" }); renderExits("Removed. Nothing is stored now."); };
}
let investExits = null;

function cfdBalance() { try { const v = localStorage.getItem("stdr.cfdBalance"); return v === null ? null : Number(v); } catch (e) { return null; } }
function flowsHTML(d) {
  const f = d.flows;
  if (!f || !f.total) return "";
  const t = f.total, bal = cfdBalance();
  const result = isNum(bal) ? t.from_cfd + bal - t.to_cfd : null;
  const allIn = isNum(result) ? result - d.net_eur : null;
  const eu = (x) => "€" + Math.round(Math.abs(x)).toLocaleString("en-US");
  return `<section class="section" aria-labelledby="flows-h"><div class="section-head"><h2 class="h-section" id="flows-h">Where the money went</h2>
    <p class="prose">Withdrawals and deposits without a note look like transfers between your Invest and CFD accounts. That's an inference from the export (T212 doesn't label them), so check it matches what you remember. Bank details are never shown.</p></div>
    <div class="bento">
      <div class="glass block lift span-4"><span class="label">Sent to CFD</span><span class="big loss">−${eu(t.to_cfd)}</span><p class="sub">${f.count.to_cfd} transfers out of Invest.</p></div>
      <div class="glass block lift span-4"><span class="label">Came back from CFD</span><span class="big gain">+${eu(t.from_cfd)}</span><p class="sub">${f.count.from_cfd} transfers back into Invest.</p></div>
      <div class="glass block lift span-4"><span class="label">Your CFD account now</span>
        <form class="form-row" id="cfdBalForm" style="margin-top:4px"><label class="field" style="min-width:160px"><span class="muted" style="font-size:12px">Account value in T212 (€)</span>
          <input class="input" name="bal" type="number" step="0.01" min="0" inputmode="decimal" value="${isNum(bal) ? bal : ""}" placeholder="e.g. 3768.84"></label>
          <button class="btn btn-ghost btn-sm" type="submit">Use</button></form>
        <p class="sub">Stays in this browser only.</p></div>
    </div>
    ${isNum(result) ? `<div class="glass block" style="margin-top:16px"><span class="label">What the money did in CFDs</span>
      <span class="big ${result >= 0 ? "gain" : "loss"}">${result >= 0 ? "+" : "−"}${eu(result)}</span>
      <p class="sub">Came back ${eu(t.from_cfd)} + in the CFD account now ${eu(bal)} − sent ${eu(t.to_cfd)}. Next to the stocks: selling cost ${eu(d.missed_eur)} in missed gains and saved ${eu(d.avoided_eur)}.
      Taken together, CFD result minus what holding would have added: <b class="${allIn >= 0 ? "gain" : "loss"}">${allIn >= 0 ? "+" : "−"}${eu(allIn)}</b>. This assumes the CFD money came from these sells; some of it may have been new deposits.</p></div>` : ""}
  </section>`;
}
document.addEventListener("submit", (e) => {
  if (e.target.id !== "cfdBalForm") return;
  e.preventDefault();
  const v = Number(new FormData(e.target).get("bal"));
  try { if (isFinite(v) && v >= 0) localStorage.setItem("stdr.cfdBalance", String(v)); } catch (er) { /* ignore */ }
  renderExits("CFD balance updated.");
});

// ---------------------------------------------------------------- spending: money sent to your bank
const FV_RATE = 0.07, FV_YEARS = 10;           // illustration only: a long-run stock-market average, not a promise
function monthlyPay() { try { const v = Number(localStorage.getItem("stdr.pay")); return v > 0 ? v : null; } catch (e) { return null; } }
const eur0 = (x) => "€" + Math.round(Math.abs(x)).toLocaleString("en-US");
const hoursOf = (x, pay) => (pay ? Math.round(x / (pay / 173)) : null);      // 173 = average working hours a month at 40 h/week
const future = (x) => x * Math.pow(1 + FV_RATE, FV_YEARS);
function nudgeLine(x, pay, subject = "That") {
  const h = hoursOf(x, pay);
  return (h !== null ? `${subject} is about <b>${h.toLocaleString("en-US")} hours</b> of your work. ` : "") +
    `Left invested, it could be around <b>${eur0(future(x))}</b> in ${FV_YEARS} years.`;
}
function spendHTML(d) {
  const sp = d.spending;
  if (!sp || !sp.to_bank_count) return "";
  const pay = monthlyPay(), mx = Math.max(...sp.monthly.map((m) => m.eur), 1);
  const bars = sp.monthly.map((m) => `<div class="sp-bar" title="${esc(m.month)}: ${eur0(m.eur)}"><i style="height:${Math.max(3, (m.eur / mx) * 100)}%"></i>
    <span>${new Date(m.month + "-01").toLocaleDateString("en-GB", { month: "short" })}</span></div>`).join("");
  return `<section class="section" aria-labelledby="spend-h"><div class="section-head"><h2 class="h-section" id="spend-h">Taken out to spend</h2>
    <p class="prose">Money sent from Invest to your bank. A sell followed by a bank transfer within ${sp.days} days is marked <b>Spent</b>: that's a spending sale, not panic. The app can't see what the money was for; if some of it went to savings, it's still out of the market.</p></div>
    <div class="bento">
      <div class="glass block span-6"><span class="label">${sp.year} so far</span><span class="big">${eur0(sp.to_bank_year_eur)}</span>
        <p class="sub">${sp.to_bank_count} transfers to your bank this year. ${eur0(sp.from_sells_eur)} of it came straight from selling stocks (${sp.sells_spent} sells).</p>
        <p class="sub" style="margin-top:8px">${nudgeLine(sp.to_bank_year_eur, pay)}</p>
        <div class="sp-bars" aria-hidden="true">${bars}</div></div>
      <div class="glass block span-6"><span class="label">Thinking of taking money out?</span>
        <form class="form-row" id="spendForm" style="margin-top:6px">
          <label class="field" style="min-width:130px"><span class="muted" style="font-size:12px">Amount (€)</span>
            <input class="input" name="amt" type="number" min="1" step="1" inputmode="decimal" placeholder="300" required></label>
          <label class="field" style="min-width:150px"><span class="muted" style="font-size:12px">Your monthly pay (€)</span>
            <input class="input" name="pay" type="number" min="1" step="1" inputmode="decimal" value="${pay || ""}" placeholder="take-home"></label>
          <button class="btn btn-ghost btn-sm" type="submit">Show me</button></form>
        <div id="spendOut" aria-live="polite"></div>
        <p class="sub" style="font-size:12px;margin-top:8px">Pay stays in this browser only. The ${FV_YEARS}-year figure assumes ${Math.round(FV_RATE * 100)}% a year, a long-run stock average: an illustration, not a promise.</p></div>
    </div></section>`;
}
document.addEventListener("submit", (e) => {
  if (e.target.id !== "spendForm") return;
  e.preventDefault();
  const f = new FormData(e.target), amt = Number(f.get("amt")), pay = Number(f.get("pay"));
  try { if (pay > 0) localStorage.setItem("stdr.pay", String(pay)); } catch (er) { /* ignore */ }
  if (!(amt > 0)) return;
  $("#spendOut").innerHTML = `<p style="margin:12px 0 6px;font-size:15px">${nudgeLine(amt, pay > 0 ? pay : null, eur0(amt))}</p>
    <p class="sub">Most urges to spend fade within a couple of days. If you still need it in 48 hours, take it out then: no guilt.</p>
    <div class="form-row" style="margin-top:10px"><button class="btn btn-primary btn-sm" type="button" id="remind48" data-amt="${amt}">Remind me in 48 hours</button></div>
    <p class="toast" id="remindMsg" aria-live="polite"></p>`;
});
document.addEventListener("click", async (e) => {
  const b = e.target.closest("#remind48");
  if (!b) return;
  try {
    await api("/api/push/remind", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hours: 48, amount: Number(b.dataset.amt) }) });
    $("#remindMsg").textContent = "Done. You'll get a notification in 48 hours (turn notifications on in Settings if you haven't).";
  } catch (er) { $("#remindMsg").innerHTML = `<span class="err">${esc(er.message)}</span>`; }
});

// ---------------------------------------------------------------- view switcher: cards / mini charts / list (remembered per section)
const VIEWS = [["cards", "Cards", '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'],
  ["mini", "Mini charts", '<path d="M4 7h4M4 12h4M4 17h4"/><path d="M11 8l3-2 3 2 3-3M11 13l3-1 3 1 3-2M11 18l3-2 3 1 3-1"/>'],
  ["list", "List", '<path d="M4 6h16M4 12h16M4 18h16"/>']];
function getView(key) { try { return localStorage.getItem("stdr.view." + key) || "cards"; } catch (e) { return "cards"; } }
function viewSwitch(key) {
  const cur = getView(key);
  return `<div class="view-switch" role="group" aria-label="Show as">${VIEWS.map(([v, l, ic]) =>
    `<button type="button" data-view-key="${key}" data-view="${v}" aria-pressed="${v === cur}" aria-label="${l}" title="${l}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg></button>`).join("")}</div>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-view-key]");
  if (!b) return;
  try { localStorage.setItem("stdr.view." + b.dataset.viewKey, b.dataset.view); } catch (er) { /* ignore */ }
  if (b.dataset.viewKey === "exits") renderExits();
});
function miniSpark(c, ref) {
  const v = (c || []).filter(isNum);
  if (v.length < 2) return '<span class="mini-spark"></span>';
  const W = 120, H = 32, lo = Math.min(...v, ref), hi = Math.max(...v, ref), sp = hi - lo || 1;
  const y = (x) => 2 + (1 - (x - lo) / sp) * (H - 4);
  const d = v.map((x, i) => `${i ? "L" : "M"}${((i / (v.length - 1)) * W).toFixed(1)},${y(x).toFixed(1)}`).join("");
  const up = v[v.length - 1] >= ref;
  return `<svg class="mini-spark ${up ? "up" : "dn"}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2="${W}" y1="${y(ref).toFixed(1)}" y2="${y(ref).toFixed(1)}" vector-effect="non-scaling-stroke"/><path d="${d}" vector-effect="non-scaling-stroke"/></svg>`;
}
function sellsView(sells, cardsHTML) {
  const mode = getView("exits");
  if (mode === "cards") return `<div class="inv-grid">${cardsHTML}</div>`;
  const rows = sells.map((s) => {
    const tag = s.error ? `<span class="muted">${esc(s.error)}</span>` :
      `<span class="${s.diff_eur > 0 ? "loss" : "gain"}">${s.diff_eur > 0 ? "Missed" : "Avoided"} €${Math.round(Math.abs(s.diff_eur || 0)).toLocaleString("en-US")}</span>`;
    return `<div class="row-item">
      <span class="who">${logo(s.ticker)}<span><span class="tick-name">${esc(s.ticker)}</span><span class="co">${esc(s.time.slice(0, 11))}</span></span></span>
      ${mode === "mini" ? (s.error ? '<span class="mini-spark"></span>' : miniSpark(s.chart && s.chart.c, s.ref_px || s.price)) : ""}
      <span class="num">sold ${fmt(s.price)}</span>
      <span class="num">${s.error ? "" : pct(s.chg_since, 1)}</span>
      <span class="num">${tag}${s.spent_eur ? ' <span class="chip chip-spent">Spent</span>' : ""}</span></div>`;
  }).join("");
  return `<div class="glass row-list mode-${mode}">${rows}</div>`;
}
