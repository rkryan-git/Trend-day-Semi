/* Invest → Exits: every stock you sold, followed as if you had kept it. Helpers from app.js / invest.js. */
"use strict";

function exitChart(ch, sellPx) {
  // price after the sale: green above your sell price, red below; dashed line = your sell price
  const c = ch.c.filter(isNum), n = c.length;
  if (n < 3) return '<p class="sub" style="font-size:12px;padding:24px 0">Sold very recently: the chart fills in as new closes come in.</p>';
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
        ${exitChart(s.chart, s.ref_px || s.price)}
        <div class="chips"><span class="chip">since you sold ${pct(s.chg_since, 1)}</span><span class="chip">best after ${pct(s.best_after, 0)}</span>
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
      ${flowsHTML(d)}
      <section class="section"><div class="section-head"><h2 class="h-section">Every sell</h2><p class="prose">Newest first. Each card follows the stock from the moment you sold, until today or until you bought it back.</p></div>
        <div class="inv-grid">${cards || '<p class="empty">No sells in this export.</p>'}</div></section>`;
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
