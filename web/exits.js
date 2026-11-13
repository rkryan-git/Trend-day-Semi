/* Invest → Exits: every stock you sold, followed as if you had kept it. Helpers from app.js / invest.js. */
"use strict";

function exitChart(ch, sellPx) {
  // price after the sale: green above your sell price, red below; dashed line = your sell price
  const c = ch.c.filter(isNum), n = c.length;
  if (n < 2) return "";
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
  const upload = `<label class="btn btn-primary" for="exitsFile">${investExits && !investExits.empty ? "Upload a newer export" : "Upload your T212 export"}</label>
    <input type="file" id="exitsFile" accept=".csv,text/csv" hidden>`;
  const how = `<ol class="steps"><li>In Trading 212, open your <b>Invest</b> account → <b>History</b> → the download icon → <b>Export CSV</b>.</li>
    <li>Pick a range that covers your sells (up to 12 months per export; add older ones later).</li>
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
        ${exitChart(s.chart, s.price)}
        <div class="chips"><span class="chip">since you sold ${pct(s.chg_since, 1)}</span><span class="chip">best after ${pct(s.best_after, 0)}</span>
          <span class="chip">worst after ${pct(s.worst_after, 0)}</span>${isNum(s.smh_chg) ? `<span class="chip">SMH same period ${pct(s.smh_chg, 1)}</span>` : ""}</div>
        <p class="sub" style="font-size:12px">${s.until ? `Followed until you bought back on ${esc(s.until)} at ${fmt(s.rebought_at)}. ` : ""}${s.rule_e_out === true ? "Rule E agreed with this sell: the stock and SMH were both below their 200-day average." : s.rule_e_out === false ? "Rule E would have kept holding." : ""}</p>
      </article>`).join("");
    p.innerHTML = `${head("Exits", "Every stock you sold, followed as if you had kept it.")}
      <section class="hero" data-tone="${good ? "gain" : "loss"}"><div class="glass hero-card">
        <div class="hero-meta"><span class="label">${d.count} sell${d.count === 1 ? "" : "s"}</span><span class="label">In euros at today's EUR/USD ${isNum(d.eurusd) ? d.eurusd.toFixed(4) : ""}</span></div>
        <h1 class="h-display"><span class="tone" aria-hidden="true"></span>${good ? "Your exits saved " + eurS(-net).replace(/^\+/, "") : "Holding would have made " + eurS(net)}</h1>
        <p class="hero-sub">Missed by selling: ${eurS(d.missed_eur)} · avoided by selling: ${eurS(d.avoided_eur).replace("+", "")}. ${d.e_known ? `Rule E agreed with ${d.e_agreed} of ${d.e_known} sells.` : ""}</p>
        <p class="sub" style="margin-top:10px;font-size:13px">Fair warning: this follows the stock only, not what you did with the cash. If you put the money into something else, that part isn't counted. A buy-back ends the comparison.</p>
        <div class="form-row" style="margin-top:20px">${upload}</div><p class="toast" id="exitsMsg" aria-live="polite">${msg}</p></div></section>
      <section class="section"><div class="inv-grid">${cards || '<p class="empty">No sells in this export.</p>'}</div></section>`;
  }
  const inp = $("#exitsFile");
  if (inp) inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    $("#exitsMsg").textContent = "Reading your export and fetching prices…";
    try { investExits = await api("/api/exits", { method: "POST", headers: { "Content-Type": "text/csv" }, body: await f.text() }); renderExits(`Loaded ${f.name}.`); }
    catch (e) { $("#exitsMsg").innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
}
let investExits = null;
