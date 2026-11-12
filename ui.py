"""Presentation helpers for the restyle (see DESIGN.md). No trading logic lives here."""
from __future__ import annotations

from datetime import time
from html import escape

import plotly.graph_objects as go
import streamlit as st

# Mode tokens (DESIGN.md section 2). Picked per run from st.context.theme.type, never hard-coded in app.py.
TOKENS = {
    "dark": dict(canvas="#090909", surface="#141414", surface2="#1C1C1C", hairline="#262626", ink="#FFFFFF",
                 muted="#999999", link="#0099FF", gain="#2EA043", loss="#F2555A", caution="#D29922",
                 btn="#FFFFFF", btn_ink="#000000"),
    "light": dict(canvas="#F9F8F4", surface="#FFFFFF", surface2="#F1F0EB", hairline="#DEDDD8", ink="#000000",
                  muted="#595853", link="#000000", gain="#1A7F37", loss="#C4302B", caution="#9A6700",
                  btn="#000000", btn_ink="#F9F8F4"),
}


def mode() -> str:
    try:
        return "dark" if st.context.theme.type == "dark" else "light"
    except Exception:
        return "dark"


def tok() -> dict:
    return TOKENS[mode()]


CSS = """
<style>
/* Colours switch instantly with the theme: Streamlit sets color-scheme on the app root, light-dark() follows it. */
body {
  --canvas: light-dark(#F9F8F4, #090909); --surface: light-dark(#FFFFFF, #141414); --surface2: light-dark(#F1F0EB, #1C1C1C);
  --hairline: light-dark(#DEDDD8, #262626); --ink: light-dark(#000000, #FFFFFF); --muted: light-dark(#595853, #999999);
  --gain: light-dark(#1A7F37, #2EA043); --loss: light-dark(#C4302B, #F2555A); --caution: light-dark(#9A6700, #D29922);
  --btn: light-dark(#000000, #FFFFFF); --btn_ink: light-dark(#F9F8F4, #000000);
  --card-shadow: 0 5px 20px light-dark(rgba(0,0,0,.094), rgba(0,0,0,0));
  font-variant-numeric: tabular-nums;
}
::selection { background: var(--ink); color: var(--canvas); }
h1, h2, h3, h4, h5, h6 { letter-spacing: -0.025em; }

/* wordmark and sidebar group labels (plain text, not headings) */
.stdr-word { margin:0; font: 500 17px/1.2 Geist, Inter, sans-serif; letter-spacing:-0.01em; color:var(--ink); }
@media (prefers-color-scheme: light) { .stdr-word { font: 400 20px/1.2 Newsreader, Georgia, serif; } }
body:has(.stdr-mode-light) .stdr-word { font: 400 20px/1.2 Newsreader, Georgia, serif; }
body:has(.stdr-mode-dark) .stdr-word { font: 500 17px/1.2 Geist, Inter, sans-serif; }
.stdr-group { margin:18px 0 2px; font-size:13px; font-weight:500; color:var(--muted); }
.stdr-status { font: 500 12px/1 Inter, sans-serif; letter-spacing:0.08em; text-transform:uppercase; color:var(--muted); }
.stdr-status b { color:var(--ink); font-weight:500; }

/* tabs: dark = 8px lifted tab, light = Motion outline pills */
.st-key-main_tabs [role="tablist"] { gap:6px; border:none; box-shadow:none; }
.st-key-main_tabs [role="tablist"]::after { display:none; }
.st-key-main_tabs .react-aria-SelectionIndicator { display:none; }
.st-key-main_tabs [role="tab"] { padding:6px 14px; color:var(--muted); background:transparent;
  border:1px solid light-dark(var(--hairline), transparent) !important; border-radius:8px; }
.st-key-main_tabs [role="tab"][aria-selected="true"] { background:light-dark(#000000, #1C1C1C); color:light-dark(#F9F8F4, #FFFFFF);
  border-color:light-dark(#000000, transparent) !important; }
.st-key-main_tabs [role="tab"] p { font-size:14px; font-weight:500; }
@media (prefers-color-scheme: light) { .st-key-main_tabs [role="tab"] { border-radius:999px; } }
body:has(.stdr-mode-light) .st-key-main_tabs [role="tab"] { border-radius:999px; }
body:has(.stdr-mode-dark) .st-key-main_tabs [role="tab"] { border-radius:8px; }

/* "Why" disclosure under the decision card: borderless, no box in a box */
.st-key-why_since_open details { border:none; background:transparent; }
.st-key-why_since_open summary { padding-left:4px; color:var(--muted); }
.st-key-why_since_open summary:hover { color:var(--ink); }

/* primary buttons: white on dark, black on paper (selection controls keep primaryColor) */
.st-key-run_bt button, .st-key-run_long button, .st-key-save_spread button {
  background:var(--btn); color:var(--btn_ink); border:1px solid var(--btn); }
.st-key-run_bt button:hover, .st-key-run_long button:hover, .st-key-save_spread button:hover { opacity:.86; }

/* decision card: a keyed native container, so its heading uses the theme's heading font */
.st-key-decision_card { container-type:inline-size; background:var(--surface); border-radius:20px; padding:28px 32px 26px; box-shadow:var(--card-shadow); gap:0; }
.st-key-decision_card h1 { font-size:52px; line-height:1.02; padding:0 0 6px; margin:0; letter-spacing:-0.03em; text-wrap:balance; }
.st-key-decision_card h1 a { display:none; }
.stdr-sub { margin:10px 0 0; font-size:17px; line-height:1.4; color:var(--muted); max-width:70ch; }
.stdr-lines { margin:18px 0 0; padding:16px 0 0; border-top:1px solid var(--hairline); display:grid; gap:8px; }
.stdr-line { display:flex; gap:10px; align-items:baseline; font-size:15px; line-height:1.4; color:var(--ink); }
.stdr-line .k { flex:0 0 112px; color:var(--muted); font-size:13px; }
.gain { color:var(--gain); } .loss { color:var(--loss); } .caution { color:var(--caution); } .muted { color:var(--muted); }
.stdr-take { display:grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap:14px 24px; margin:22px 0 0; }
@container (max-width: 560px) { .stdr-take { grid-template-columns: repeat(3, minmax(0,1fr)); } }
@container (max-width: 360px) { .stdr-take { grid-template-columns: repeat(2, minmax(0,1fr)); } }
.stdr-take .lbl { font-size:13px; color:var(--muted); }
.stdr-take .val { font-size:clamp(20px, 5cqi, 32px); line-height:1.1; font-weight:500; color:var(--ink); letter-spacing:-0.02em; white-space:nowrap; }
.stdr-take .who { grid-column:1/-1; font-size:13px; color:var(--muted); margin-top:6px; }
@media (max-width: 640px) {
  .st-key-decision_card { padding:22px 20px; }
  .st-key-decision_card h1 { font-size:34px; }
  .stdr-line { flex-direction:column; gap:2px; } .stdr-line .k { flex:none; }
}
</style>
"""


def inject_css() -> None:
    """Call once per full run, outside the auto-refresh fragment."""
    st.html(CSS)


def wordmark() -> None:
    st.html('<p class="stdr-word">Semi Trend-Day Radar</p>')


def group(label: str) -> None:
    """Sidebar group label: 13px muted sentence case, not a heading (DESIGN 6)."""
    st.sidebar.html(f'<p class="stdr-group">{escape(label)}</p>')


def gauge(ticker: str, chance: float, level: str, rates: dict) -> go.Figure:
    """One half-ring for the highest-chance ticker. Ticks are read from su.BIG_DAY_RATES, never typed."""
    t = tok()
    ticks = sorted({rates["no warning"], rates["base"], rates["any warning"], rates["gap ±5%"]})
    top = max(60.0, chance)
    fill = t["caution"] if level in ("Elevated", "High") else t["ink"]
    fig = go.Figure(go.Indicator(
        mode="gauge+number", value=chance,
        number={"suffix": "%", "valueformat": ".0f", "font": {"size": 44, "color": t["ink"]}},
        title={"text": f"{ticker} · chance of a ±7% day", "font": {"size": 13, "color": t["muted"]}},
        gauge={"shape": "angular", "bgcolor": t["surface2"], "borderwidth": 0,
               "axis": {"range": [0, top], "tickvals": ticks, "ticktext": [f"{v:g}" for v in ticks],
                        "tickcolor": t["hairline"], "tickfont": {"color": t["muted"], "size": 11}},
               "bar": {"color": fill, "thickness": 0.32},
               "threshold": {"line": {"color": t["muted"], "width": 2}, "thickness": 0.95, "value": rates["base"]}}))
    fig.update_layout(height=230, margin=dict(l=28, r=28, t=48, b=4), paper_bgcolor="rgba(0,0,0,0)",
                      font=dict(family="Inter, sans-serif"), transition={"duration": 0})
    return fig


def mode_marker() -> str:
    """Class carried by HTML rendered inside the fragment, so CSS follows the active theme."""
    return f"stdr-mode-{mode()}"


def pct_html(x: float | None, d: int = 2) -> str:
    if x is None:
        return "—"
    cls, arrow = ("gain", "▲") if x >= 0 else ("loss", "▼")
    return f'<span class="{cls}">{arrow} {x:+.{d}f}%</span>'


def decide(phase: str, now_ny, plan: list, triggered: list, filt: dict | None, require_sector: bool,
           stay_out: list, catalysts: list, exit_t: str, size_mode: str, capital: float, risk_day: float,
           today_takes_logged: list) -> dict:
    """Pick the headline by DESIGN.md precedence: closed > TAKE > longs blocked > signal skipped > waiting > done."""
    takes = [p for p in plan if p.get("action") == "take"]
    t = now_ny.time()
    out = {"head": "", "head_cls": "", "sub": "", "takes": [], "lines": []}

    if phase in ("weekend", "closed"):
        out["head"] = "Market closed"
        out["head_cls"] = "muted"
        if phase == "weekend":
            out["sub"] = "Weekend. The next session opens Monday at 15:30 your time."
        else:
            done = ", ".join(today_takes_logged) if today_takes_logged else "no TAKE today"
            out["sub"] = f"Today's session is over: {done}. The next session opens at 15:30 your time."
    elif takes:
        sides = {("LONG" if p["direction"] > 0 else "SHORT") for p in takes}
        names = [p["ticker"] for p in takes]
        if len(takes) >= 3:
            out["head"] = f"{len(takes)} TAKEs today"
        else:
            out["head"] = f"TAKE {', '.join(names)} {'/'.join(sorted(sides))}"
        out["head_cls"] = "gain"
        out["sub"] = f"Hold to your exit at {exit_t}. Check T212's live spread before you enter."
        out["takes"] = takes
    elif filt is not None and filt.get("ok") is False and require_sector:
        out["head"] = "Longs blocked"
        out["head_cls"] = "loss"
        out["sub"] = "SMH and QQQ must both be above today's open and VWAP before a long counts."
    elif triggered:
        first = triggered[0]
        reason = ", ".join(first.get("blocked") or []) or "outside today's plan"
        out["head"] = f"Signal on {first['ticker']}, skipped"
        out["head_cls"] = "muted"
        out["sub"] = f"Reason: {reason}."
    elif phase == "pre":
        out["head"] = "Pre-market"
        out["head_cls"] = "muted"
        out["sub"] = "Market filter checks start at 15:30. The first setup check is 15:40."
    elif t < time(9, 40):
        out["head"] = "No signal yet"
        out["sub"] = "Next check 15:40 (confirmed gap)."
    elif t < time(10, 30):
        out["head"] = "No signal yet"
        out["sub"] = "Next check 16:30 (first-hour confirm)."
    else:
        out["head"] = "No TAKE today"
        out["head_cls"] = "muted"
        out["sub"] = "Both setup checks have passed without a signal you'd take. Nothing to do."

    # supporting lines (each fact once)
    if filt is not None:
        word = '<span class="gain">Longs allowed</span>' if filt["ok"] else '<span class="loss">Longs blocked</span>'
        out["lines"].append(("Market filter", f"{word}"
                             f'<span class="muted"> · SMH {pct_html(filt["smh_open"])}, QQQ {pct_html(filt["qqq_open"])} since the open</span>'
                             + (f'<br><span class="muted">{escape(filt["extra"])}</span>' if filt.get("extra") else "")))
    if catalysts:
        out["lines"].append(("Catalysts today", escape(" · ".join(catalysts)) + ' <span class="muted">(very high impact)</span>'))
    if stay_out:
        out["lines"].append(("Stay out", escape(", ".join(stay_out)) + ' <span class="muted">· first hour went against the gap</span>'))
    skipped = [x for x in triggered if not x.get("taken")]
    if takes and skipped:
        out["lines"].append(("Also fired", escape("; ".join(f"{x['ticker']} ({', '.join(x.get('blocked') or ['not in plan'])})" for x in skipped))))
    out["size_mode"] = size_mode
    out["budget"] = capital * risk_day / 100
    return out


def render_decision(d: dict) -> None:
    colour = {"gain": "green", "loss": "red", "muted": "gray"}.get(d["head_cls"])
    head = d["head"].replace("*", "").replace("_", " ")
    html = [f'<div class="{mode_marker()}"><p class="stdr-sub">{escape(d["sub"])}</p>']
    for p in d["takes"]:
        side = "LONG" if p["direction"] > 0 else "SHORT"
        html.append('<div class="stdr-take">'
                    f'<div><div class="lbl">Position</div><div class="val">€{p["position_eur"]:,.0f}</div></div>'
                    f'<div><div class="lbl">Margin 5:1</div><div class="val">€{p["margin_eur_5to1"]:,.0f}</div></div>'
                    f'<div><div class="lbl">Risk</div><div class="val">€{p["risk_eur"]:,.2f}</div></div>'
                    f'<div><div class="lbl">Stop</div><div class="val">{p["stop_price"]:,.2f}</div></div>'
                    f'<div><div class="lbl">Exit</div><div class="val">{escape(p.get("exit_t", ""))}</div></div>'
                    f'<div class="who">{escape(p["ticker"])} {side} · {escape(p["setup"])} · entry {p["entry"]:,.2f} at {escape(p["entry_time"])}</div>'
                    '</div>')
    if d["takes"] and d["size_mode"] == "split":
        used = sum(p["risk_eur"] for p in d["takes"])
        html.append(f'<div class="stdr-lines"><div class="stdr-line"><span class="k">Risk used</span>'
                    f'€{used:,.2f} of €{d["budget"]:,.2f} today</div></div>')
    if d["lines"]:
        html.append('<div class="stdr-lines">')
        for k, v in d["lines"]:
            html.append(f'<div class="stdr-line"><span class="k">{escape(k)}</span><span>{v}</span></div>')
        html.append("</div>")
    html.append("</div>")
    with st.container(key="decision_card"):
        st.markdown(f"# :{colour}[{head}]" if colour else f"# {head}")
        st.html("".join(html))
