"""Semi Trend-Day Radar: big-day warnings, the two confirmed-gap setups,
and a signal log for your semis.

Run:  streamlit run app.py
"""
from __future__ import annotations

from datetime import datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import data
import metrics as m
import setups as su
import ui

SETUP_COL_A = su.SETUP_A
SETUP_COL_B = su.SETUP_B
SETUP_COL_ORB = su.SETUP_ORB

AMS = ZoneInfo("Europe/Amsterdam")
NY = ZoneInfo("America/New_York")
HERE = Path(__file__).parent
LOG_PATH = HERE / "signal_log.csv"

DEFAULT_WATCH = ["MU", "SNDK", "WDC", "LRCX", "AMAT", "ASML", "AMD"]
MEMORY = {"MU", "SNDK", "WDC"}
SECTOR_REFS = ["SMH", "SOXX", "NVDA", "QQQ"]
OVERNIGHT = {"000660.KS": ("SK Hynix", "Asia/Seoul"), "005930.KS": ("Samsung", "Asia/Seoul"),
             "^KS11": ("KOSPI", "Asia/Seoul"), "^N225": ("Nikkei", "Asia/Tokyo"),
             "ASML.AS": ("ASML (Amsterdam)", "Europe/Amsterdam")}

HELP_TOP = '''
### Your day, step by step (Amsterdam time)
| When | Look at | What to do |
|---|---|---|
| Before 15:30 | **Overnight read** + **Big-day radar** | Low = probably a normal day, skip CFDs. Elevated/High = be at the screen; think about hedging your holdings. The radar says *how big*, not *which way*. |
| 15:30–15:40 | Watch only | Biggest candles of the day happen here, and spreads are widest. |
| 15:40 | **15:40 confirmed gap** + **market filter** | Take the LONG only if SMH and QQQ are both above their open and VWAP (60 days: +1.22% avg with the filter, +0.17% without). |
| 16:30 | **16:30 first-hour confirm** + **market filter** | LONG with SMH and QQQ up: 70% won, +1.10% avg over 2 years, positive in every half-year. Not aligned: −0.27%. |
| Until 21:30 | Hold to your exit time | 3% stop. Tight trailing stops and VWAP stops lost money in testing. |

### Sizing, exits and costs
- **One risk budget per DAY, not per trade.** Filtered signals bunched onto 11 days with 1–11 at once (60-day test). Taking all of them at 1% each gave a −3.7% worst day and −5.9% drawdown; one trade per day kept the worst day at −0.45%.
- **Position size = (CFD money × daily risk %) ÷ stop %**: €2,000 × 1% ÷ 3% ≈ €670 of exposure (~€135 margin at 5:1). The Live tab shows it per signal.
- **Exit 30 minutes before the close by default.** The last 10 minutes moved 1.7× more than midday with no direction bias; 21:30 kept ~92% of the result.
- A 0.25% round-trip spread on €670 costs ~€1.68, about 8% of a €20 risk budget. Set your real spread in the sidebar.

### The four filter ideas, tested on your data (Nov 2026)
'''

HELP_BOTTOM = '''

### Earlier research
- **Big days are predictable in size, not direction.** No warning → ~5% chance of a ±7% day; any warning (gap or Hynix ±3%) → ~22%; gap ±5% → ~52%.
- **Confirmation is the edge:** when the first 10 minutes or the first hour move the same way as the gap, *and the market agrees*, the move tended to continue.
- **What didn't work:** news direction at 15:25/15:30, chasing a fixed % from the open, fading the gap, picking the "strongest" stock, VWAP stretch fades, opening-range breakouts.

### Caveats
- 60 days of 5-minute data and 2 years of hourly data, mostly one huge memory bull run and its crash.
- Each filter makes the sample smaller. The 15:40 filter result rests on 11 vs 10 trading days.
- T212 spreads aren't in the data; the app subtracts your setting.
- The trend score in the Watchlist table is experimental.
'''

st.set_page_config(page_title="Semi Trend-Day Radar", page_icon=str(HERE / "static" / "favicon.svg"), layout="wide")
ui.inject_css()   # once per full run, outside the auto-refresh fragment

# ----------------------------------------------------------------------------
# Sidebar
# ----------------------------------------------------------------------------
st.sidebar.title("Settings")
watch_txt = st.sidebar.text_input("Watchlist (US tickers, comma-separated)", ", ".join(DEFAULT_WATCH))
WATCH = [t.strip().upper() for t in watch_txt.split(",") if t.strip()]
SECTOR = st.sidebar.selectbox("Sector benchmark", ["SMH", "SOXX"], index=0)
REFRESH = st.sidebar.select_slider("Auto-refresh every", options=[30, 60, 120, 300], value=60,
                                   format_func=lambda s: f"{s}s")
st.sidebar.subheader("Filters")
LONG_ONLY = st.sidebar.checkbox("Long only", value=True, help=su.FILTER_EVIDENCE["shorts"])
REQUIRE_SECTOR = st.sidebar.checkbox("Require SMH + QQQ above open and VWAP", value=True, help=su.FILTER_EVIDENCE["sector"])
SPREAD = st.sidebar.number_input("T212 round-trip spread (%)", min_value=0.0, max_value=2.0, value=0.25, step=0.05,
                                 help="Comes off every backtest and log result. Check the real spread in T212 for each stock.")
SHOW_ORB = st.sidebar.checkbox("Show experimental ORB-15 signal", value=False, help=su.FILTER_EVIDENCE["orb"])
st.sidebar.subheader("Exit and sizing")
EXIT_LABEL = st.sidebar.selectbox("Exit", list(su.EXIT_OPTIONS), index=0,
                                  help="The last 10 minutes moved 1.7× more than midday with no direction bias; exiting at "
                                       "21:30 kept ~92% of the 15:40 setup's result in testing. On the weeks when US and EU "
                                       "clocks change on different dates, every time is one hour earlier.")
EXIT_BEFORE = su.EXIT_OPTIONS[EXIT_LABEL]
CAPITAL = st.sidebar.number_input("CFD money (€)", min_value=100.0, value=2000.0, step=100.0)
RISK_DAY = st.sidebar.number_input("Max risk per DAY (%)", min_value=0.1, max_value=5.0, value=1.0, step=0.1,
                                   help="One budget for the whole day: your semis move together, so 3 signals are closer "
                                        "to 1 bet than to 3.")
STOP_PCT = st.sidebar.number_input("Stop (%)", min_value=0.5, max_value=10.0, value=3.0, step=0.5)
SIZE_MODE_LABEL = st.sidebar.radio("When several signals fire", ["One trade per day", "Split the day's risk"], index=0,
                                   help="One trade: the earliest signal, ties go to the calmest stock (lowest ATR). "
                                        "Split: signals at the same time share the budget; later ones are skipped.")
SIZE_MODE = "one" if SIZE_MODE_LABEL.startswith("One") else "split"
st.sidebar.caption("Data: Yahoo Finance via yfinance (free, can lag a few minutes). "
                   "Edit catalysts.csv to add your own events.")
st.sidebar.caption("Signals are written to signal_log.csv next to the app, so you build a real track "
                   "record without risking money.")
st.sidebar.caption("Not financial advice. Every number shown comes from past data; it can stop working.")


# ----------------------------------------------------------------------------
# Cached loaders
# ----------------------------------------------------------------------------
@st.cache_data(ttl=55, show_spinner=False)
def load_intraday(tickers: tuple, period: str = "15d", interval: str = "5m"):
    return data.intraday(list(tickers), period, interval)


@st.cache_data(ttl=3600, show_spinner=False)
def load_daily(tickers: tuple, period: str = "6mo"):
    return data.daily(list(tickers), period)


@st.cache_data(ttl=120, show_spinner=False)
def load_overnight():
    return data.overnight({t: tz for t, (_, tz) in OVERNIGHT.items()})


@st.cache_data(ttl=55, show_spinner=False)
def load_premarket(tickers: tuple):
    return data.premarket(list(tickers))


@st.cache_data(ttl=6 * 3600, show_spinner=False)
def load_earnings(tickers: tuple):
    return {t: data.earnings_date(t) for t in tickers}


@st.cache_data(ttl=600, show_spinner=False)
def load_news(ticker: str):
    return data.news(ticker)


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def market_status(now_ny: datetime) -> tuple:
    t, wd = now_ny.time(), now_ny.weekday()
    open_ams = datetime.combine(now_ny.date(), time(9, 30), NY).astimezone(AMS).strftime("%H:%M")
    if wd >= 5:
        return "weekend", "Weekend: US market closed", "gray"
    if time(9, 30) <= t < time(16, 0):
        return "open", "US market OPEN", "green"
    if t < time(9, 30):
        return "pre", f"Before the US open: regular session starts {open_ams} your time", "orange"
    return "closed", "US market closed: showing today's session", "gray"


def build_snapshots(sess_all: dict, daily_map: dict, tickers: list) -> dict:
    out = {}
    for t in tickers:
        sess = sess_all.get(t) or {}
        days = sorted(sess)
        if len(days) < 2:
            out[t] = None
            continue
        d, prev = days[-1], days[-2]
        prev_close = float(sess[prev]["Close"].iloc[-1])
        atr_v = None
        dd = daily_map.get(t)
        if dd is not None and not dd.empty:
            atr_v = m.atr(dd[[i < d for i in dd.index]].tail(15))
        snap = m.snapshot(t, sess[d], prev_close, [sess[k] for k in days[:-1]], atr_v)
        if snap:
            snap.extra.update(session=sess[d], date=d)
        out[t] = snap
    return out


def load_catalysts(watch: list) -> pd.DataFrame:
    try:
        cat = pd.read_csv(HERE / "catalysts.csv", dtype=str).fillna("")
        cat["date"] = pd.to_datetime(cat["date"]).dt.date
    except Exception:
        cat = pd.DataFrame(columns=["date", "time_cet", "event", "affects", "impact", "status", "note"])
    rows = []
    for t, d in load_earnings(tuple(sorted(set(watch) | {"NVDA", "TSM"}))).items():
        if not d:
            continue
        mine = cat["event"].str.contains(f"({t})", regex=False) & cat["event"].str.lower().str.contains("earnings")
        if mine.any():
            est = mine & (cat["status"].str.lower() == "estimated")
            cat.loc[est, "date"] = d
            cat.loc[est, "status"] = "Yahoo"
            continue
        rows.append({"date": d, "time_cet": "", "event": f"{t} earnings", "affects": t,
                     "impact": "Very high", "status": "Yahoo", "note": "Date from Yahoo Finance; verify on company IR"})
    if rows:
        cat = pd.concat([cat, pd.DataFrame(rows)], ignore_index=True)

    def reaction_day(r):
        d = r["date"]
        if "earnings" in str(r["event"]).lower():
            d = d + timedelta(days=1)
            while d.weekday() >= 5:
                d += timedelta(days=1)
        return d
    if not cat.empty:
        cat["reaction_day"] = cat.apply(reaction_day, axis=1)
    return cat.sort_values("date").drop_duplicates(subset=["date", "event"])


def bar_time_ams(session: pd.DataFrame, bar: int) -> str:
    """Time the bar closes, in Amsterdam time."""
    return (session.index[bar] + pd.Timedelta(minutes=m.BAR_MINUTES)).tz_convert(AMS).strftime("%H:%M")


STATE_WORD = {"triggered": "Triggered", "waiting": "Waiting", "no setup": "No setup", "stay out": "Stay out"}
LEVEL_WORD = {"High": "High", "Elevated": "Elevated", "Low": "Low"}


def price_chart(snap: m.Snapshot, marks: list) -> go.Figure:
    s = snap.extra["session"]
    x = s.index.tz_convert(AMS)
    vw = m.vwap(s)
    fig = go.Figure()
    fig.add_trace(go.Candlestick(x=x, open=s["Open"], high=s["High"], low=s["Low"], close=s["Close"],
                                 name=snap.ticker, increasing_line_color="#2e9e5b",
                                 decreasing_line_color="#d64545", showlegend=False))
    fig.add_trace(go.Scatter(x=x, y=vw, name="VWAP", line=dict(color="#4c6ef5", width=2)))
    fig.add_hline(y=snap.prev_close, line_dash="dash", line_color="#c68a1a", annotation_text="prev close")
    for st_ in marks:
        fig.add_trace(go.Scatter(x=[x[st_.entry_bar]], y=[st_.entry], mode="markers+text",
                                 marker=dict(size=12, symbol="triangle-up" if st_.direction > 0 else "triangle-down",
                                             color="#2e9e5b" if st_.direction > 0 else "#d64545"),
                                 text=[st_.setup.split()[0]], textposition="top center", name=st_.setup))
    fig.update_layout(height=360, margin=dict(l=10, r=10, t=30, b=10), xaxis_rangeslider_visible=False,
                      legend=dict(orientation="h", y=1.08), title=f"{snap.ticker} 5-min (your time)")
    return fig


def pct(x, d=2):
    return "—" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x:+.{d}f}%"


# ----------------------------------------------------------------------------
# Page
# ----------------------------------------------------------------------------
ui.wordmark()
tab_live, tab_log, tab_spread, tab_bt, tab_long, tab_help = st.tabs(
    ["Live", "Signal log", "Spread log", "Backtest (60 days)", "2-year check", "How to read this"], key="main_tabs")
SPREAD_PATH = HERE / "spread_log.csv"


with tab_live:
    @st.fragment(run_every=REFRESH)
    def live():
        now_ams = datetime.now(AMS)
        now_ny = now_ams.astimezone(NY)
        phase, status, color = market_status(now_ny)
        today_ny = now_ny.date()
        _word = {"open": "Live", "pre": "Pre-market", "closed": "Closed", "weekend": "Weekend"}[phase]
        st.html(f'<div class="stdr-top {ui.mode_marker()}"><span class="stdr-status"><b>{_word}</b> · '
                f'updated {now_ams:%H:%M:%S} Amsterdam</span></div>')
        decision_slot = st.container()     # filled after the setups are computed (DESIGN.md: decision first)
        with decision_slot:
            card_slot, why_slot = st.container(), st.container()
        radar_slot = st.container()
        st.divider()

        # ---- catalysts ---------------------------------------------------------
        cat = load_catalysts(WATCH)
        today = now_ams.date()
        cat_today = cat[(cat["date"] == today) | (cat.get("reaction_day", cat["date"]) == today)] if not cat.empty else cat
        upcoming = cat[(cat["date"] > today) & (cat["date"] <= today + timedelta(days=21))] if not cat.empty else cat
        catalyst_today = bool(len(cat_today[cat_today["impact"].isin(["High", "Very high"])])) if not cat_today.empty else False

        c1, c2 = st.columns([1, 1])
        with c1:
            st.subheader("Catalysts today")
            if cat_today.empty:
                st.caption("Nothing scheduled.")
            for _, r in cat_today.iterrows():
                st.markdown(f"🔔 **{r['event']}** {r['time_cet'] or ''} · {r['affects']} · *{r['impact']}* ({r['status']})")
        with c2:
            st.subheader("Next 3 weeks")
            if upcoming.empty:
                st.caption("Nothing on the calendar.")
            else:
                st.dataframe(upcoming[["date", "time_cet", "event", "impact", "status"]],
                             hide_index=True, width="stretch", height=210)

        # ---- data -------------------------------------------------------------
        all_us = tuple(sorted(set(WATCH) | set(SECTOR_REFS)))
        with st.spinner("Loading prices..."):
            intra = load_intraday(all_us)
            dly = load_daily(all_us)
            ovn = load_overnight()
            pre = load_premarket(all_us) if phase == "pre" else {}
        sess_all = {t: m.split_sessions(df) for t, df in intra.items() if df is not None and not df.empty}
        sess_done = su.drop_unfinished(sess_all, now_ny)   # finished candles only: setups, filter, log
        snaps = build_snapshots(sess_all, dly, list(all_us))
        sector_snap = snaps.get(SECTOR)
        breadth = m.breadth_of([snaps.get(t) for t in WATCH])

        # ---- overnight ---------------------------------------------------------
        st.subheader("Overnight read")
        st.caption("Korea closes 07:30 your time, Japan 07:30, Amsterdam trades from 09:00. "
                   "When SK Hynix moved 3%+, MU/SNDK/WDC gapped the same way 77% of the time (60-day test).")
        cols = st.columns(len(OVERNIGHT))
        hynix_today = None
        for col, (tk, (name, _)) in zip(cols, OVERNIGHT.items()):
            o = ovn.get(tk)
            if not o:
                col.metric(name, "—")
                continue
            stale = o["date"] != today_ny
            col.metric(name, f"{o['last']:,.0f}", f"{o['chg']:+.2f}%",
                       help=f"Session {o['date']:%a %d %b}" + (" (not today)" if stale else "") +
                            f", last price {o['as_of']:%H:%M} local")
            if tk == "000660.KS" and not stale:
                hynix_today = o["chg"]

        with radar_slot:
            # ---- big-day radar ---------------------------------------------------
            st.subheader("Big-day radar")
            st.caption("How likely a ±7% day is, from the warnings that came before past big days "
                       f"(SNDK/MU/WDC, Nov 2024–Nov 2026: normally {su.BIG_DAY_RATES['base']}% of days; "
                       f"{su.BIG_DAY_RATES['no warning']}% with no warning, {su.BIG_DAY_RATES['any warning']}% with one). "
                       "It tells you how big the day may get, not which way.")
            radar_rows = []
            for t in WATCH:
                sess = sess_all.get(t) or {}
                days = sorted(sess)
                if not days:
                    radar_rows.append({"Ticker": t, "Level": "—"})
                    continue
                last_d = days[-1]
                if last_d == today_ny and len(days) >= 2:      # today's session exists
                    prev_close = float(sess[days[-2]]["Close"].iloc[-1])
                    gap = (float(sess[last_d]["Open"].iloc[0]) / prev_close - 1) * 100
                    hist_until = days[-2]
                    gap_label = "gap"
                else:                                           # before the open: use pre-market
                    prev_close = float(sess[last_d]["Close"].iloc[-1])
                    p = pre.get(t)
                    gap = (p / prev_close - 1) * 100 if p else None
                    hist_until = last_d
                    gap_label = "pre-market"
                dd = dly.get(t)
                hist = dd[[i <= hist_until for i in dd.index]] if dd is not None and not dd.empty else None
                r = su.radar(hist, gap, hynix_today, catalyst_today, t in MEMORY)
                radar_rows.append({
                    "Ticker": t, "Level": LEVEL_WORD[r.level], "Chance of ±7% day": float(r.chance),
                    "Gap / pre-mkt": pct(r.gap, 1) + ("" if r.gap is None else f" ({gap_label})"),
                    "Hynix": pct(r.hynix, 1) if t in MEMORY else "n/a",
                    "Volatility": "—" if r.vol_ratio is None else
                        (f"rising {r.vol_ratio:.2f}×" if r.vol_ratio > 1.3 else f"calm {r.vol_ratio:.2f}×" if r.vol_ratio < 0.8 else f"normal {r.vol_ratio:.2f}×"),
                    "Yesterday": pct(r.yesterday, 1),
                    "Warnings": ", ".join(r.warnings) or "none",
                })
            radar_df = pd.DataFrame(radar_rows)
            st.dataframe(radar_df, hide_index=True, width="stretch", height=38 + 35 * len(radar_df),
                         column_config={"Chance of ±7% day": st.column_config.ProgressColumn(
                             "Chance of ±7% day", min_value=0, max_value=100, format="%.0f%%", color=ui.tok()["ink"])})

        # ---- setups -----------------------------------------------------------
        st.subheader("Setups")
        st.caption(f"**{su.SETUP_A}:** {su.RESEARCH[su.SETUP_A]['rule']}  \n"
                   f"**{su.SETUP_B}:** {su.RESEARCH[su.SETUP_B]['rule']}")

        # market filter right now: SMH and QQQ vs their open and VWAP (shown in the decision block)
        filt = None
        mk_sess = sess_done.get("SMH") or {}
        mk_days = sorted(mk_sess)
        if mk_days and mk_days[-1] == today_ny and len(mk_sess[mk_days[-1]]) > 0:
            j_now = len(mk_sess[mk_days[-1]]) - 1
            now_ctx = su.context(sess_done, "SMH", today_ny, j_now, 1, None)
            day = ""
            if snaps.get("SMH") and snaps.get("QQQ"):
                day = f" · vs yesterday's close (what the Sector tape shows): SMH {snaps['SMH'].chg:+.2f}%, QQQ {snaps['QQQ'].chg:+.2f}%"
            if now_ctx.sector_ok is not None:
                gap_fade = now_ctx.sector_ok is False and bool(
                    (snaps.get("SMH") and snaps["SMH"].chg > 0 and "SMH -" in now_ctx.sector_note) or
                    (snaps.get("QQQ") and snaps["QQQ"].chg > 0 and "QQQ -" in now_ctx.sector_note))
                _so = su.since_open_table(sess_all, ["SMH", "QQQ"], today_ny).set_index("Ticker")

                def _open_pct(tk):
                    try:
                        return float(_so.loc[tk, "Since open %"])
                    except Exception:
                        return None
                filt = {"ok": bool(now_ctx.sector_ok), "note": now_ctx.sector_note,
                        "smh_open": _open_pct("SMH"), "qqq_open": _open_pct("QQQ"),
                        "smh_day": snaps["SMH"].chg if snaps.get("SMH") else None,
                        "qqq_day": snaps["QQQ"].chg if snaps.get("QQQ") else None,
                        "extra": "Up on the day but fading since the open: the gap-up-and-fade case the filter is built to catch."
                                 if gap_fade else ""}

        # ---- since the open / last 10 minutes ------------------------------------
        if any(sorted(sess_all.get(t) or {})[-1:] == [today_ny] for t in WATCH):
            mv = su.since_open_table(sess_all, ["SMH", "QQQ"] + [t for t in WATCH if t not in ("SMH", "QQQ")], today_ny)
            _tk = ui.tok()

            def _clr(v):
                if not isinstance(v, (int, float)) or pd.isna(v):
                    return ""
                return f"color: {_tk['loss']}" if v < 0 else f"color: {_tk['gain']}"
            num = [c for c in ["Since open %", "Last 10 min %", "vs VWAP %"] if c in mv]
            with why_slot:
                why = st.expander("Why: since the open", key="why_since_open")
                with why:
                    st.dataframe(mv.style.map(_clr, subset=num).format(precision=2, na_rep="—"), hide_index=True,
                                 width="stretch", height=38 + 35 * len(mv))
                    st.caption("Since open = vs today's 15:30 opening price (what the filter uses), not vs yesterday's close. "
                               "Last 10 min = latest 5-min close vs two candles earlier; the newest candle may still be forming.")

        cols_setups = [(SETUP_COL_A, su.setup_a), (SETUP_COL_B, su.setup_b)] + ([(SETUP_COL_ORB, su.setup_orb)] if SHOW_ORB else [])
        setup_rows, triggered, marks, takes = [], [], {}, []
        stay_out, fired = [], []
        for t in WATCH:
            sess = sess_done.get(t) or {}
            days = sorted(sess)
            if not days or days[-1] != today_ny or len(days) < 2 or len(sess[days[-1]]) == 0:
                setup_rows.append({"Ticker": t, **{c: "Waiting for today's open" for c, _ in cols_setups}})
                continue
            s = sess[days[-1]]
            pc = float(sess[days[-2]]["Close"].iloc[-1])
            atr_pct = su.atr_pct_before(dly.get(t), today_ny)
            row = {"Ticker": t}
            for col, fn in cols_setups:
                st_ = fn(s, pc)
                txt = STATE_WORD[st_.state]
                if st_.state == "stay out" and t not in stay_out:
                    stay_out.append(t)
                if st_.state == "triggered":
                    ctx = su.context(sess_done, t, today_ny, st_.entry_bar, st_.direction, atr_pct)
                    side = "LONG" if st_.direction > 0 else "SHORT"
                    blocked = []
                    if LONG_ONLY and st_.direction < 0:
                        blocked.append("long-only")
                    if REQUIRE_SECTOR and ctx.sector_ok is not True:
                        blocked.append("SMH/QQQ not aligned")
                    passed = not blocked
                    verdict = f"TAKE {side}" if passed else f"{side} signal, skip ({', '.join(blocked)})"
                    fired.append({"ticker": t, "setup": st_.setup, "blocked": blocked, "taken": False})
                    txt = f"{verdict} @ {st_.entry:,.2f} · now {pct(su.result_so_far(st_, s))}"
                    row[col + " filters"] = (f"sector {'ok' if ctx.sector_ok else 'not ok'}"
                                             + (f" · breadth {ctx.breadth}/3" if ctx.breadth is not None else "")
                                             + (f" · ATR used {ctx.atr_used:.2f}" if ctx.atr_used is not None else ""))
                    triggered.append([today_ny, t, st_, bar_time_ams(s, st_.entry_bar), ctx, passed, ""])
                    marks.setdefault(t, []).append(st_)
                    if passed:
                        takes.append({"ticker": t, "setup": st_.setup, "direction": st_.direction, "entry": st_.entry,
                                      "entry_bar": st_.entry_bar, "atr_pct": atr_pct,
                                      "entry_time": bar_time_ams(s, st_.entry_bar)})
                row[col] = txt
                row[col + " detail"] = st_.note
            setup_rows.append(row)
        st.dataframe(pd.DataFrame(setup_rows), hide_index=True, width="stretch")

        # ---- today's plan: one risk budget for the whole day --------------------
        plan = su.plan_day(takes, CAPITAL, RISK_DAY, STOP_PCT, SIZE_MODE)
        exit_t = EXIT_LABEL.split("(")[-1].rstrip(")")
        for p_ in plan:
            p_["exit_t"] = exit_t
        for item in triggered:      # record the plan decision in the log
            match = next((p_ for p_ in plan if p_["ticker"] == item[1] and p_["setup"] == item[2].setup), None)
            if match:
                item[6] = match["action"]
        for f_ in fired:
            f_["taken"] = any(p_["ticker"] == f_["ticker"] and p_["setup"] == f_["setup"] and p_["action"] == "take"
                              for p_ in plan)
            if not f_["blocked"] and not f_["taken"]:
                f_["blocked"] = [next((p_["action"] for p_ in plan if p_["ticker"] == f_["ticker"]
                                       and p_["setup"] == f_["setup"]), "not in today's plan")]
        cat_lines = []
        if not cat_today.empty:
            for _, r_ in cat_today[cat_today["impact"] == "Very high"].iterrows():
                cat_lines.append(str(r_["event"]))
        logged_today = []
        try:
            _lg = su.read_log(LOG_PATH) if hasattr(su, "read_log") else pd.read_csv(LOG_PATH)
            _lg = _lg[(_lg["date"].astype(str) == str(today_ny)) & (_lg["plan"].astype(str) == "take")]
            logged_today = [f"TAKE {r_['ticker']} {r_['direction']} at {r_['entry_time_ams']}" for _, r_ in _lg.iterrows()]
        except Exception:
            pass
        decision = ui.decide(phase, now_ny, plan, fired, filt, REQUIRE_SECTOR, stay_out, cat_lines, exit_t,
                             SIZE_MODE, CAPITAL, RISK_DAY, logged_today)
        with card_slot:
            ui.render_decision(decision)
        if triggered:
            st.markdown("**What the research says about these signals:**")
            shown = set()
            for item in triggered:
                st_ = item[2]
                key = (st_.setup, st_.direction)
                if key in shown:
                    continue
                shown.add(key)
                st.markdown(f"- {st_.setup} · {su.RESEARCH[st_.setup]['long' if st_.direction > 0 else 'short']}")
        st.caption(f"Exit: {EXIT_LABEL.lower()}, {STOP_PCT:.1f}% stop (tight trailing stops ruined these setups in every test). "
                   f"Risk budget: {RISK_DAY:.1f}% of €{CAPITAL:,.0f} for the whole day. Your spread setting "
                   f"({SPREAD:.2f}% round trip) comes off every result; check T212's live spread before you enter.")

        # ---- signal log ---------------------------------------------------------
        try:
            su.update_log(LOG_PATH, [tuple(x) for x in triggered], sess_done, EXIT_BEFORE)
        except Exception as e:  # never break the live view over the log
            st.caption(f"Couldn't update signal_log.csv: {e}")

        # ---- sector -----------------------------------------------------------
        st.subheader("Sector tape")
        cols = st.columns(len(SECTOR_REFS) + 1)
        for col, tk in zip(cols, SECTOR_REFS):
            s = snaps.get(tk)
            if s is None:
                col.metric(tk, "—")
                continue
            col.metric(tk, f"{s.last:,.2f}", f"{s.chg:+.2f}%",
                       help=f"{'Above' if s.vwap_dist > 0 else 'Below'} VWAP by {abs(s.vwap_dist):.2f}%")
            p = pre.get(tk)
            if p:
                pc = (p / s.last - 1) * 100
                col.caption(f"Pre-market **{p:,.2f}** :{'green' if pc >= 0 else 'red'}[{pc:+.2f}%]")
        cols[-1].metric("Watchlist breadth", "—" if breadth is None else f"{breadth:+.2f}",
                        help="(stocks up − stocks down) / total. Near ±1 means the whole group moves together.")

        # ---- watchlist table -------------------------------------------------
        st.subheader("Watchlist")
        any_snap = next((s for s in snaps.values() if s is not None), None)
        if any_snap is not None:
            st.caption(f"Session of {any_snap.extra['date']:%a %d %b} · {any_snap.bars * m.BAR_MINUTES} min of trading. "
                       "The trend score is experimental: a simplified version didn't hold up in testing.")
        rows, verdicts = [], {}
        for t in WATCH:
            s = snaps.get(t)
            if s is None:
                rows.append({"Ticker": t, "Verdict": "No data"})
                continue
            v = m.trend_score(s, sector_snap if t != SECTOR else None, breadth, catalyst_today)
            verdicts[t] = v
            rows.append({
                "Ticker": t, "Last": round(s.last, 2), "Chg %": round(s.chg, 2),
                **({"Pre-mkt": round(pre[t], 2), "Pre-mkt %": round((pre[t] / s.last - 1) * 100, 2)} if pre.get(t) else {}),
                "Gap %": round(s.gap, 2),
                "First 30m %": None if s.first30 is None else round(s.first30, 2),
                "vs VWAP %": round(s.vwap_dist, 2), "VWAP side": round(s.vwap_side, 2),
                "Opening range": {1: "Above ↑", -1: "Below ↓", 0: "Inside"}[s.or_break] if s.or_high else "Forming",
                "RVOL": None if s.rvol is None else round(s.rvol, 2),
                "Range/ATR": None if s.range_atr is None else round(s.range_atr, 2),
                "Score (exp.)": v.score, "Verdict": v.label,
            })
        table = pd.DataFrame(rows)

        def color_pct(val):
            if not isinstance(val, (int, float)) or pd.isna(val):
                return ""
            return "color: #d64545" if val < 0 else "color: #2e9e5b"

        pct_cols = [c for c in ["Chg %", "Pre-mkt %", "Gap %", "First 30m %", "vs VWAP %"] if c in table]
        st.dataframe(table.style.map(color_pct, subset=pct_cols).format(precision=2, na_rep="—"),
                     hide_index=True, width="stretch")

        # ---- per-ticker detail -----------------------------------------------
        st.subheader("Detail")
        for t in WATCH:
            s, v = snaps.get(t), verdicts.get(t)
            if s is None or v is None:
                continue
            tag = " · " + ", ".join(f"{x.setup.split()[0]} {'LONG' if x.direction > 0 else 'SHORT'}" for x in marks.get(t, [])) if marks.get(t) else ""
            with st.expander(f"{t}: {s.chg:+.2f}% today{tag}"):
                a, b = st.columns([2, 1])
                with a:
                    st.plotly_chart(price_chart(s, marks.get(t, [])), width="stretch", key=f"chart_{t}")
                with b:
                    for r in v.reasons:
                        st.markdown(f"- {r}")
                    st.markdown("**Headlines**")
                    items = load_news(t)
                    if not items:
                        st.caption("No headlines from Yahoo.")
                    for n in items:
                        src = f" · {n['source']}" if n.get("source") else ""
                        st.markdown(f"- [{n['title']}]({n['url']}){src}" if n.get("url") else f"- {n['title']}{src}")

    live()


with tab_log:
    st.markdown("Every setup signal the app sees is written to **signal_log.csv** with its entry price and the filter "
                "state at that moment, and filled in with the close once the day ends. Signals the filters rejected are "
                "logged too, so you can see live whether the filters really help. After 30+ signals per line, trust "
                "these numbers over the research.")
    log = su.read_log(LOG_PATH)
    if log.empty:
        st.caption("No signals logged yet. Keep the app open during US hours (from 15:30 your time).")
    else:
        stats = su.log_stats(log, SPREAD)
        if not stats.empty:
            st.subheader("Results so far (closed signals)")
            st.dataframe(stats, width="stretch")
        st.subheader("All signals")
        st.dataframe(log.sort_values(["date", "ticker"], ascending=[False, True]), hide_index=True, width="stretch")
        st.download_button("Download signal_log.csv", log.to_csv(index=False), "signal_log.csv", "text/csv")
    st.caption("Results are % moves of the stock from entry to the close; 'after spread' subtracts your spread setting. "
               "The log doesn't apply the 3% stop.")


with tab_spread:
    st.markdown("Measures what T212 really charges you. Every result in this app subtracts one fixed spread "
                f"(**{SPREAD:.2f}%** in the sidebar), but the real CFD spread changes during the day and is usually widest "
                "right at the open. T212 offers no CFD data feed, so type the **Sell (bid)** and **Buy (ask)** prices "
                "from the T212 order screen. A few readings at 15:30, 15:40, 16:30 and 21:30 over a week is enough.")
    with st.form("spread_form", clear_on_submit=True):
        c1, c2, c3 = st.columns(3)
        sp_t = c1.selectbox("Stock", WATCH)
        sp_bid = c2.number_input("Sell price (bid)", min_value=0.0, value=0.0, step=0.01, format="%.2f")
        sp_ask = c3.number_input("Buy price (ask)", min_value=0.0, value=0.0, step=0.01, format="%.2f")
        if st.form_submit_button("Save reading", key="save_spread"):
            try:
                _now = datetime.now(AMS)
                su.add_spread(SPREAD_PATH, sp_t, sp_bid, sp_ask, _now, _now.astimezone(NY))
                st.success(f"Saved: {sp_t} spread {(sp_ask - sp_bid) / ((sp_ask + sp_bid) / 2) * 100:.3f}%")
            except ValueError as e:
                st.error(str(e))
    spreads = su.read_spreads(SPREAD_PATH)
    if spreads.empty:
        st.caption("No readings yet.")
    else:
        summ = su.spread_summary(spreads)
        st.subheader("Average round-trip spread (%) by time of day")
        st.dataframe(summ, width="stretch")
        worst = float(spreads["spread_pct"].mean())
        verdict = ("🟢 Your readings average **{:.2f}%**, at or below your {:.2f}% setting: the backtest costs are realistic."
                   if worst <= SPREAD + 0.02 else
                   "🔴 Your readings average **{:.2f}%**, above your {:.2f}% setting: results in this app are too rosy. "
                   "Raise the spread setting in the sidebar to match.").format(worst, SPREAD)
        st.markdown(verdict)
        st.caption("For comparison, the tested edges were about +1.1 to +1.2% per trade before costs.")
        with st.expander("All readings"):
            st.dataframe(spreads.sort_values("time_ams", ascending=False), hide_index=True, width="stretch")


with tab_bt:
    st.markdown("Re-runs the setups on the last ~60 days of 5-minute data (the most Yahoo gives for free), split into "
                "first and second half, and shows how each one did **with and without each filter**. A real edge should "
                "be positive in both halves and after spread.")
    if st.button("Run setup backtest", type="primary", key="run_bt"):
        with st.spinner("Downloading 60 days of 5-min data..."):
            tks = tuple(sorted(set(WATCH) | {"SMH", "QQQ"} | set(MEMORY)))
            intra60 = load_intraday(tks, "60d")
            dly6 = load_daily(tks, "6mo")
            bt = su.backtest_setups(intra60, WATCH, dly6, stop=STOP_PCT, exit_before=EXIT_BEFORE)
        if bt.empty:
            st.warning("Not enough data to backtest.")
        else:
            st.subheader("All signals")
            st.dataframe(su.summarize_setups(bt, SPREAD), width="stretch")
            st.subheader("Only when SMH + QQQ were above their open and VWAP at entry")
            st.dataframe(su.summarize_setups(bt, SPREAD, filtered=True), width="stretch")
            st.caption(f"after_spread_% subtracts your {SPREAD:.2f}% spread setting. won_% = share of trades that ended "
                       "in profit. 95%_range = where the true win rate plausibly lies; if it includes 50%, it could be a coin flip.")
            st.subheader("Exit time")
            st.dataframe(su.exit_compare(bt), width="stretch")
            st.caption("Average result (before spread) if you exit at each time. The rest of this tab uses your exit setting.")

            st.subheader("Account result by sizing rule")
            sims = {}
            for mode_name, mode in (("Every signal at full risk", "every signal at full risk"),
                                    ("One trade per day", "one"), ("Split the day's risk", "split")):
                sims[mode_name] = su.simulate(bt, mode, RISK_DAY, STOP_PCT, SPREAD, aligned_only=REQUIRE_SECTOR,
                                              long_only=LONG_ONLY)
            st.dataframe(pd.DataFrame(sims).T, width="stretch")
            st.caption(f"15:40 + 16:30 signals with your filters, {RISK_DAY:.1f}% risk, {STOP_PCT:.1f}% stop, your exit and spread. "
                       "'Every signal at full risk' stacks correlated positions: the bigger total comes with bigger "
                       "drawdowns, not more edge. Compare return_per_drawdown.")

            st.subheader("Filter breakdown")
            for setup in (su.SETUP_A, su.SETUP_B, su.SETUP_ORB):
                for side in ("LONG", "SHORT"):
                    fb = su.filter_breakdown(bt, setup, side, SPREAD)
                    if not fb.empty:
                        with st.expander(f"{setup} · {side}"):
                            st.dataframe(fb, width="stretch")
            with st.expander("All trades"):
                st.dataframe(bt.sort_values(["date", "ticker"], ascending=[False, True]), hide_index=True, width="stretch")

    with st.expander("Experimental: trend-score backtest"):
        st.caption("The original trend score. In a separate test a simplified version of it lost money, so treat it with care.")
        check_min = st.select_slider("Score the day after", options=[45, 60, 90, 120], value=60,
                                     format_func=lambda x: f"{x} min")
        if st.button("Run trend-score backtest"):
            with st.spinner("Running..."):
                tk = tuple(sorted(set(WATCH) | {SECTOR}))
                bt2 = m.backtest(load_intraday(tk, "60d"), WATCH, SECTOR, check_bar=check_min // m.BAR_MINUTES)
            if bt2.empty:
                st.warning("Not enough data.")
            else:
                st.dataframe(m.summarize_backtest(bt2), width="stretch")
                ts, _ = m.top_pick(bt2)
                if not ts.empty:
                    st.dataframe(ts, width="stretch")


with tab_long:
    st.markdown("Checks the big-day warnings and the 16:30 first-hour rule on about **2 years** of daily and "
                "hourly data (Yahoo's limit for hourly bars). Use it every month or two to see whether the "
                "patterns still hold.")
    long_watch = st.multiselect("Stocks", WATCH, default=[t for t in WATCH if t in MEMORY] or WATCH[:3])
    if st.button("Run 2-year check", type="primary", key="run_long") and long_watch:
        with st.spinner("Downloading ~2 years of daily and hourly data..."):
            dd = load_daily(tuple(sorted(long_watch)), "2y")
            hh = load_intraday(tuple(sorted(set(long_watch) | {"SMH", "QQQ"} | set(MEMORY))), "730d", "1h")
            hy = load_daily(("000660.KS",), "2y").get("000660.KS")
            res = su.long_study(dd, hh, hy, long_watch)
        if not res:
            st.warning("Not enough data.")
        else:
            st.caption(f"{res['stock_days']} stock-days, {res['span']}. A ±7% day happened on {res['base']}% of them.")
            st.subheader("Warnings before big days")
            st.dataframe(res["warnings"], width="stretch")
            st.subheader("16:30 first-hour rule")
            st.dataframe(res["first_hour"], width="stretch")
            st.subheader("Filters on the LONG side of the 16:30 rule")
            st.caption("Sector = SMH and QQQ both up in the first hour. On hourly data VWAP isn't available, so this "
                       "uses 'above the open' only.")
            st.dataframe(res["filters"], width="stretch")
            st.caption("Several stocks on the same day count separately, so the real sample is smaller than 'days' suggests.")


with tab_help:
    st.markdown(HELP_TOP + "\n".join(f"- {v}" for v in su.FILTER_EVIDENCE.values()) + HELP_BOTTOM)

