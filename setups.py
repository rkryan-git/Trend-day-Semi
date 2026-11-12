"""The two setups that held up in testing, the big-day radar, the signal log,
and the backtests that re-check them. No network calls here.

Sessions are regular-hours 5-minute bars (index in New York time), as produced
by metrics.split_sessions.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

import metrics as m

SETUP_A = "15:40 confirmed gap"
SETUP_B = "16:30 first-hour confirm"
SETUP_ORB = "ORB-15 + VWAP (experimental)"
MEMORY = ("MU", "SNDK", "WDC")

# What the research found (Nov 2026 chats). Shown next to live signals; the
# Backtest and 2-year tabs recompute fresh numbers from current data.
RESEARCH = {
    SETUP_A: {
        "rule": "Gap of 0.5%+ at the open, and by 15:40 the stock is 0.3%+ further the same way. Enter at 15:40, hold to the close.",
        "long": "LONG: 61 trades, 70% won, avg +0.90% (60 days Aug–Nov 2026, 7 semis). "
                "With SMH+QQQ above open and VWAP: 42 trades, 71%, +1.22%; without: 19 trades, +0.17%",
        "short": "SHORT: 71 trades, 56% won, avg +0.10% (≈ no edge)",
    },
    SETUP_B: {
        "rule": "Gap of 1%+, and the first hour (15:30–16:30) moves 3%+ the same way. Enter at 16:30, hold to the close.",
        "long": "LONG, 7 semis, Nov 2024–Nov 2026: 114 trades, 65% won, +0.78%. With SMH+QQQ up at 16:30: "
                "87 trades, 70%, +1.10%, positive in every half-year; without: 27 trades, 48%, −0.27%",
        "short": "SHORT: +0.62% avg, but almost all from the April 2025 crash; ≈0 in every other half-year",
        "against": "First hour 3%+ AGAINST the gap: rest of day continued only 40% → stay out",
    },
    SETUP_ORB: {
        "rule": "After 15:45, first 5-min close above the 15-min high and above VWAP. Exit on a 5-min close below VWAP or the range midpoint.",
        "long": "Tested Nov 2026 on 60 days: 189 trades, 29% won, −0.09% (−0.21% if held to the close). Not an edge.",
        "short": "Short version: 198 trades, 34% won, −0.17%.",
    },
}

# How the four filters from the Nov 2026 advice tested (shown in the app's help).
FILTER_EVIDENCE = {
    "sector": "SMH + QQQ above their open (and VWAP) at entry: confirmed. Helped both setups, in both halves and over 2 years.",
    "breadth": "MU+SNDK+WDC all above open: mixed. No difference over 60 days; small plus over 2 years. Shown, not required.",
    "atr": "Range already used (ATR consumption): NOT confirmed. Trades after a bigger early range did as well or better. Shown, not required.",
    "orb": "15-min opening-range breakout with a VWAP stop: lost money (29% won). Only in the backtest, off by default.",
    "shorts": "Shorts: no reliable edge in either setup. Long-only is the default.",
}

# Exit options: minutes before the 16:00 NY close (21:30 etc. in Amsterdam on normal weeks).
# Tested Nov 2026 (60 days): the last 10 minutes moved 1.7x more than midday 10-minute windows with no
# direction bias, and exiting 30 min early kept ~92% of the 15:40 setup's result.
EXIT_OPTIONS = {"30 min before close (21:30)": 30, "15 min before close (21:45)": 15,
                "5 min before close (21:55)": 5, "At the close (22:00)": 0}


def exit_index(session: pd.DataFrame, mins_before: int) -> int | None:
    """Index of the 5-min bar whose close is the exit price, or None if that bar hasn't happened yet."""
    target = 960 - mins_before - m.BAR_MINUTES          # start minute (NY) of the exit bar
    mins = session.index.hour * 60 + session.index.minute
    pos = np.where(mins == target)[0]
    return int(pos[0]) if len(pos) else None


# Chance of a ±7% close-to-close day, SNDK/MU/WDC, Nov 2024–Nov 2026 (1,422 stock-days; base 14.1%)
BIG_DAY_RATES = {
    "base": 14.1, "no warning": 5.3, "any warning": 22.5, "calm market": 5.3, "volatility rising": 23.9,
    "yesterday ±7%": 22.0, "Hynix ±3%": 20.5, "Hynix ±5%": 26.5, "gap ±3%": 33.7, "gap ±5%": 51.6,
}


# ----------------------------------------------------------------------------
# Live setup checks
# ----------------------------------------------------------------------------
@dataclass
class SetupState:
    setup: str
    state: str            # "waiting" | "triggered" | "no setup" | "stay out"
    direction: int        # +1 long, -1 short, 0 none
    entry: float | None
    entry_bar: int | None  # index of the bar whose close is the entry
    note: str


def _gap(session: pd.DataFrame, prev_close: float) -> float:
    return (float(session["Open"].iloc[0]) / prev_close - 1) * 100


def setup_a(session: pd.DataFrame | None, prev_close: float | None) -> SetupState:
    """15:40 confirmed gap: gap ≥0.5% and the first 10 minutes ≥0.3% the same way."""
    if session is None or prev_close is None or len(session) < 2:
        return SetupState(SETUP_A, "waiting", 0, None, None, "Decides at 15:40 your time (after two 5-min candles)")
    gap = _gap(session, prev_close)
    o, e = float(session["Open"].iloc[0]), float(session["Close"].iloc[1])
    m10 = (e / o - 1) * 100
    note = f"gap {gap:+.2f}%, first 10 min {m10:+.2f}%"
    if abs(gap) >= 0.5 and abs(m10) >= 0.3 and np.sign(gap) == np.sign(m10):
        return SetupState(SETUP_A, "triggered", int(np.sign(gap)), e, 1, note)
    return SetupState(SETUP_A, "no setup", 0, None, None, note)


def setup_b(session: pd.DataFrame | None, prev_close: float | None) -> SetupState:
    """16:30 first-hour confirm: gap ≥1% and the first hour ≥3% the same way."""
    n = 60 // m.BAR_MINUTES
    if session is None or prev_close is None or len(session) < n:
        return SetupState(SETUP_B, "waiting", 0, None, None, "Decides at 16:30 your time (after the first hour)")
    gap = _gap(session, prev_close)
    o, e = float(session["Open"].iloc[0]), float(session["Close"].iloc[n - 1])
    fh = (e / o - 1) * 100
    note = f"gap {gap:+.2f}%, first hour {fh:+.2f}%"
    if abs(gap) >= 1 and abs(fh) >= 3:
        if np.sign(gap) == np.sign(fh):
            return SetupState(SETUP_B, "triggered", int(np.sign(fh)), e, n - 1, note)
        return SetupState(SETUP_B, "stay out", 0, None, None, note + " → first hour went against the gap")
    return SetupState(SETUP_B, "no setup", 0, None, None, note)


def setup_orb(session: pd.DataFrame | None, prev_close: float | None) -> SetupState:
    """Experimental: 15-min opening-range breakout above VWAP (long only)."""
    if session is None or len(session) < 4:
        return SetupState(SETUP_ORB, "waiting", 0, None, None, "Range forms 15:30–15:45; watches for a break after that")
    hi = float(session["High"].iloc[:3].max())
    lo = float(session["Low"].iloc[:3].min())
    vw = m.vwap(session)
    for j in range(3, len(session)):
        c = float(session["Close"].iloc[j])
        if c < lo and c < vw.iloc[j]:
            return SetupState(SETUP_ORB, "no setup", 0, None, None, "broke the 15-min low first")
        if c > hi and c > vw.iloc[j]:
            return SetupState(SETUP_ORB, "triggered", 1, c, j, f"broke 15-min high {hi:,.2f} above VWAP")
    return SetupState(SETUP_ORB, "no setup", 0, None, None, f"inside 15-min range {lo:,.2f}–{hi:,.2f}")


def orb_exit(state: SetupState, session: pd.DataFrame) -> float:
    """ORB exit: first 5-min close below VWAP or the 15-min midpoint, else the close."""
    hi = float(session["High"].iloc[:3].max())
    lo = float(session["Low"].iloc[:3].min())
    mid = (hi + lo) / 2
    vw = m.vwap(session)
    for j in range(state.entry_bar + 1, len(session)):
        c = float(session["Close"].iloc[j])
        if c < vw.iloc[j] or c < mid:
            return c
    return float(session["Close"].iloc[-1])


# ----------------------------------------------------------------------------
# Market context at the moment of entry (the filters)
# ----------------------------------------------------------------------------
@dataclass
class Context:
    sector_ok: bool | None       # SMH and QQQ both above their open AND VWAP (for longs; both below for shorts)
    sector_note: str
    breadth: int | None          # how many of MU/SNDK/WDC are above their open (direction-aware); memory names only
    atr_used: float | None       # today's range so far / 14-day ATR


def _state(sessions: dict, t: str, d, j: int):
    s = (sessions.get(t) or {}).get(d)
    if s is None or len(s) <= j:
        return None
    c, o = float(s["Close"].iloc[j]), float(s["Open"].iloc[0])
    vw = float(m.vwap(s.iloc[: j + 1]).iloc[-1])
    return c > o, c > vw, (c / o - 1) * 100


def context(sessions: dict, ticker: str, d, j: int, direction: int, atr_pct: float | None) -> Context:
    smh, qqq = _state(sessions, "SMH", d, j), _state(sessions, "QQQ", d, j)
    if smh and qqq:
        if direction >= 0:
            ok = smh[0] and smh[1] and qqq[0] and qqq[1]
        else:
            ok = (not smh[0]) and (not smh[1]) and (not qqq[0]) and (not qqq[1])
        note = (f"since today's open: SMH {smh[2]:+.2f}% ({'above' if smh[1] else 'below'} VWAP), "
                f"QQQ {qqq[2]:+.2f}% ({'above' if qqq[1] else 'below'} VWAP)")
    else:
        ok, note = None, "SMH/QQQ data missing"
    breadth = None
    if ticker in MEMORY:
        st_ = [_state(sessions, t, d, j) for t in MEMORY]
        if all(st_):
            breadth = sum(1 for x in st_ if (x[0] if direction >= 0 else not x[0]))
    atr_used = None
    s = (sessions.get(ticker) or {}).get(d)
    if s is not None and atr_pct and atr_pct > 0 and len(s) > j:
        rng = (float(s["High"].iloc[: j + 1].max()) - float(s["Low"].iloc[: j + 1].min())) / float(s["Open"].iloc[0]) * 100
        atr_used = rng / atr_pct
    return Context(ok, note, breadth, atr_used)


def drop_unfinished(sessions: dict, now) -> dict:
    """Remove a still-forming last 5-min candle from every session.

    Yahoo includes the current candle while it is building; its 'close' is just the latest price.
    Setups, the market filter and the log must only see finished candles (a 16:30 decision uses the
    candle that closes at 16:30, not a reading taken at 16:26). `now` is tz-aware."""
    out = {}
    for t, sess in sessions.items():
        out[t] = {}
        for d, s in (sess or {}).items():
            if len(s) and s.index[-1] + pd.Timedelta(minutes=m.BAR_MINUTES) > now:
                s = s.iloc[:-1]
            out[t][d] = s
    return out


def since_open_table(sessions: dict, tickers: list, d) -> pd.DataFrame:
    """Per ticker, today: % since the open, % over the last 10 minutes, % vs VWAP.
    For SMH/QQQ also how much they must climb to pass the market filter (above open AND VWAP).
    Uses 5-min bars, so 'last 10 min' = latest 5-min close vs the close two bars earlier."""
    rows = []
    for t in tickers:
        s = (sessions.get(t) or {}).get(d)
        if s is None or len(s) == 0:
            rows.append({"Ticker": t})
            continue
        last, o = float(s["Close"].iloc[-1]), float(s["Open"].iloc[0])
        vw = float(m.vwap(s).iloc[-1])
        ref10 = float(s["Close"].iloc[-3]) if len(s) >= 3 else o
        row = {"Ticker": t, "Last": round(last, 2), "Since open %": round((last / o - 1) * 100, 2),
               "Last 10 min %": round((last / ref10 - 1) * 100, 2), "vs VWAP %": round((last / vw - 1) * 100, 2)}
        if t in ("SMH", "QQQ"):
            need = max(o, vw)
            row["Climb needed for filter"] = "✓ passing" if last > need else f"+{(need / last - 1) * 100:.2f}% (to {need:,.2f})"
        rows.append(row)
    return pd.DataFrame(rows)


def atr_pct_before(daily: pd.DataFrame | None, d) -> float | None:
    """14-day ATR in % of the previous close, using only days before d."""
    if daily is None or daily.empty:
        return None
    hist = daily[[i < d for i in daily.index]].tail(15)
    if len(hist) < 15:
        return None
    a = m.atr(hist)
    return a / float(hist["Close"].iloc[-1]) * 100 if a and not np.isnan(a) else None


def result_so_far(state: SetupState, session: pd.DataFrame) -> float | None:
    if state.state != "triggered":
        return None
    return state.direction * (float(session["Close"].iloc[-1]) / state.entry - 1) * 100


# ----------------------------------------------------------------------------
# Big-day radar
# ----------------------------------------------------------------------------
@dataclass
class Radar:
    level: str            # "Low" | "Elevated" | "High"
    warnings: list
    gap: float | None
    hynix: float | None
    vol_ratio: float | None
    yesterday: float | None
    chance: float         # historical % chance of a ±7% day for the strongest warning present


def radar(daily_hist: pd.DataFrame | None, gap: float | None, hynix: float | None,
          catalyst: bool, memory_name: bool) -> Radar:
    """daily_hist: daily bars up to and including the last *completed* session."""
    warnings, rates = [], []
    vol_ratio = yesterday = None
    if daily_hist is not None and len(daily_hist) >= 22:
        rets = daily_hist["Close"].pct_change().dropna() * 100
        yesterday = float(rets.iloc[-1])
        v20 = float(rets.tail(20).std())
        v120 = float(rets.tail(120).std()) if len(rets) >= 60 else None
        if v120:
            vol_ratio = v20 / v120
            if vol_ratio > 1.3:
                warnings.append(f"volatility rising ({vol_ratio:.2f}× normal)")
                rates.append(BIG_DAY_RATES["volatility rising"])
        if abs(yesterday) >= 7:
            warnings.append(f"yesterday {yesterday:+.1f}%")
            rates.append(BIG_DAY_RATES["yesterday ±7%"])
    if gap is not None and abs(gap) >= 3:
        warnings.append(f"gap {gap:+.1f}%")
        rates.append(BIG_DAY_RATES["gap ±5%"] if abs(gap) >= 5 else BIG_DAY_RATES["gap ±3%"])
    if memory_name and hynix is not None and abs(hynix) >= 3:
        warnings.append(f"Hynix {hynix:+.1f}% overnight")
        rates.append(BIG_DAY_RATES["Hynix ±5%"] if abs(hynix) >= 5 else BIG_DAY_RATES["Hynix ±3%"])
    if catalyst:
        warnings.append("scheduled catalyst")
    strong = (gap is not None and abs(gap) >= 5) or len(warnings) >= 2
    if strong:
        level = "High"
    elif warnings:
        level = "Elevated"
    else:
        level = "Low"
    if rates:
        chance = max(rates)
    elif vol_ratio is not None and vol_ratio < 0.8:
        chance = BIG_DAY_RATES["calm market"]
    else:
        chance = BIG_DAY_RATES["no warning"] if not warnings else BIG_DAY_RATES["any warning"]
    return Radar(level, warnings, gap, hynix, vol_ratio, yesterday, chance)


# ----------------------------------------------------------------------------
# Signal log (CSV next to the app)
# ----------------------------------------------------------------------------
LOG_COLS = ["date", "ticker", "setup", "direction", "entry_time_ams", "entry", "sector_ok", "breadth",
            "atr_used", "passed_filters", "plan", "exit_mins_before_close", "close", "result_pct", "status"]


def read_log(path: Path) -> pd.DataFrame:
    try:
        df = pd.read_csv(path, dtype={"date": str})
        for c in LOG_COLS:
            if c not in df:
                df[c] = np.nan
        return df[LOG_COLS]
    except Exception:
        return pd.DataFrame(columns=LOG_COLS)


def update_log(path: Path, triggered: list, sessions: dict, exit_before: int = 0) -> pd.DataFrame:
    """triggered: [(date, ticker, SetupState, entry_time_ams_str, Context|None, passed_filters: bool)].
    Every triggered signal is logged, including ones the filters rejected, so the filters
    themselves get a live track record. Closes are filled once the day is complete."""
    log = read_log(path)
    keys = set(zip(log["date"].astype(str), log["ticker"], log["setup"]))
    new = []
    for item in triggered:
        d, tk, st_, when = item[:4]
        ctx = item[4] if len(item) > 4 else None
        passed = item[5] if len(item) > 5 else True
        plan = item[6] if len(item) > 6 else ""
        if (str(d), tk, st_.setup) in keys:
            continue
        new.append({"date": str(d), "ticker": tk, "setup": st_.setup, "direction": "LONG" if st_.direction > 0 else "SHORT",
                    "entry_time_ams": when, "entry": round(st_.entry, 4),
                    "sector_ok": None if ctx is None else ctx.sector_ok,
                    "breadth": None if ctx is None or ctx.breadth is None else f"{ctx.breadth}/3",
                    "atr_used": None if ctx is None or ctx.atr_used is None else round(ctx.atr_used, 2),
                    "passed_filters": passed, "plan": plan, "exit_mins_before_close": exit_before,
                    "close": np.nan, "result_pct": np.nan, "status": "open"})
    if new:
        log = pd.concat([log, pd.DataFrame(new)], ignore_index=True)
    for i, r in log[log["status"] == "open"].iterrows():
        s = sessions.get(r["ticker"], {}).get(pd.Timestamp(r["date"]).date())
        if s is None or len(s) == 0:
            continue
        mb = int(r["exit_mins_before_close"]) if pd.notna(r["exit_mins_before_close"]) else 0
        xi = exit_index(s, mb)
        if xi is not None:                                  # the exit bar has happened
            d = 1 if r["direction"] == "LONG" else -1
            if r["setup"] == SETUP_ORB:
                st_ = setup_orb(s, None)
                close = orb_exit(st_, s) if st_.state == "triggered" else float(s["Close"].iloc[xi])
            else:
                close = float(s["Close"].iloc[xi])
            log.loc[i, "close"] = round(close, 4)
            log.loc[i, "result_pct"] = round(d * (close / float(r["entry"]) - 1) * 100, 3)
            log.loc[i, "status"] = "closed"
    if new or (log["status"] == "closed").any():
        log.to_csv(path, index=False)
    return log


def log_stats(log: pd.DataFrame, spread: float = 0.0) -> pd.DataFrame:
    c = log[log["status"] == "closed"].copy()
    if c.empty:
        return pd.DataFrame()
    c["result_pct"] = c["result_pct"].astype(float)
    c["passed"] = c["passed_filters"].astype(str).str.lower().isin(["true", "1"])
    rows = {}
    for (s, d, p), g in c.groupby(["setup", "direction", "passed"]):
        r = g["result_pct"]
        lo, hi = m.wilson(int((r > 0).sum()), len(r))
        rows[f"{s} · {d} · {'passed filters' if p else 'filtered out'}"] = {
            "signals": len(r), "won_%": round((r > 0).mean() * 100, 1), "95%_range": f"{lo}–{hi}%",
            "avg_%": round(r.mean(), 2), "avg_after_spread_%": round(r.mean() - spread, 2),
            "median_%": round(r.median(), 2), "total_%": round(r.sum(), 2)}
    return pd.DataFrame(rows).T


# ----------------------------------------------------------------------------
# 60-day backtest of the setups (5-min data), with the filter context of every trade
# ----------------------------------------------------------------------------
def backtest_setups(intraday: dict, tickers: list, daily: dict | None = None, stop: float = 3.0,
                    include_orb: bool = True, exit_before: int = 0) -> pd.DataFrame:
    sess_all = {t: m.split_sessions(df) for t, df in intraday.items() if df is not None and not df.empty}
    rows = []
    for t in tickers:
        sess = sess_all.get(t)
        if not sess:
            continue
        days = sorted(sess)
        for i in range(1, len(days)):
            s, ps = sess[days[i]], sess[days[i - 1]]
            if len(s) < 70 or len(ps) < 70:
                continue
            pc = float(ps["Close"].iloc[-1])
            close = float(s["Close"].iloc[-1])
            atr_pct = atr_pct_before((daily or {}).get(t), days[i])
            base = {"date": days[i], "ticker": t}
            rows.append({**base, "setup": "Baseline: buy at 15:40 every day", "direction": "LONG",
                         "result_pct": (close / float(s["Close"].iloc[1]) - 1) * 100, "result_stop_pct": np.nan,
                         "sector_ok": None, "breadth": None, "atr_used": None})
            fns = (setup_a, setup_b, setup_orb) if include_orb else (setup_a, setup_b)
            for fn in fns:
                st_ = fn(s, pc)
                if st_.state != "triggered":
                    continue
                d = st_.direction
                exits = {}
                for mb in EXIT_OPTIONS.values():
                    xi = exit_index(s, mb)
                    exits[f"exit_{mb}"] = d * (float(s["Close"].iloc[xi]) / st_.entry - 1) * 100 if xi is not None else np.nan
                xi = exit_index(s, exit_before)
                last = xi if xi is not None else len(s) - 1
                exit_px = orb_exit(st_, s) if st_.setup == SETUP_ORB else float(s["Close"].iloc[last])
                res = d * (exit_px / st_.entry - 1) * 100
                res_stop = res
                for _, b in s.iloc[st_.entry_bar + 1:last + 1].iterrows():
                    adverse = -d * ((b["Low"] if d > 0 else b["High"]) / st_.entry - 1) * 100
                    if adverse >= stop:
                        res_stop = -stop
                        break
                ctx = context(sess_all, t, days[i], st_.entry_bar, d, atr_pct)
                rows.append({**base, "setup": st_.setup, "direction": "LONG" if d > 0 else "SHORT",
                             "result_pct": res, "result_stop_pct": res_stop, "entry_bar": st_.entry_bar,
                             "atr_pct": atr_pct, **exits,
                             "sector_ok": ctx.sector_ok, "breadth": ctx.breadth, "atr_used": ctx.atr_used})
    out = pd.DataFrame(rows)
    if not out.empty:
        dates = sorted(out["date"].unique())
        mid = dates[len(dates) // 2]
        out["half"] = np.where(out["date"] < mid, "first half", "second half")
    return out


def _row(g: pd.DataFrame, spread: float) -> dict:
    r = g["result_pct"]
    if r.empty:
        return {"trades": 0}
    lo, hi = m.wilson(int((r > 0).sum()), len(r))
    h = {k: round(v["result_pct"].mean(), 2) for k, v in g.groupby("half")} if "half" in g else {}
    return {"trades": len(r), "days": g["date"].nunique(), "won_%": round((r > 0).mean() * 100, 1),
            "95%_range": f"{lo}–{hi}%", "avg_%": round(r.mean(), 2), "after_spread_%": round(r.mean() - spread, 2),
            "median_%": round(r.median(), 2),
            "avg_with_3%_stop": round(g["result_stop_pct"].mean(), 2) if g["result_stop_pct"].notna().any() else np.nan,
            "1st_half_avg": h.get("first half", np.nan), "2nd_half_avg": h.get("second half", np.nan)}


def summarize_setups(bt: pd.DataFrame, spread: float = 0.0, filtered: bool = False) -> pd.DataFrame:
    """filtered=True keeps only trades with SMH+QQQ aligned (baseline untouched)."""
    if bt.empty:
        return pd.DataFrame()
    rows = {}
    for (s, d), g in bt.groupby(["setup", "direction"]):
        if filtered and not s.startswith("Baseline"):
            g = g[g["sector_ok"] == True]  # noqa: E712
        rows[f"{s} · {d}"] = _row(g, spread)
    return pd.DataFrame(rows).T


def filter_breakdown(bt: pd.DataFrame, setup: str, direction: str, spread: float = 0.0) -> pd.DataFrame:
    """How one setup did with and without each filter."""
    g = bt[(bt["setup"] == setup) & (bt["direction"] == direction)]
    if g.empty:
        return pd.DataFrame()
    au = pd.to_numeric(g["atr_used"], errors="coerce")
    parts = {
        "all trades": g,
        "SMH+QQQ aligned": g[g["sector_ok"] == True],  # noqa: E712
        "SMH+QQQ NOT aligned": g[g["sector_ok"] == False],  # noqa: E712
        "memory breadth 3/3": g[g["breadth"] == 3],
        "memory breadth ≤2/3": g[g["breadth"].notna() & (g["breadth"] < 3)],
        "ATR used < 0.5": g[au < 0.5],
        "ATR used 0.5–0.8": g[(au >= 0.5) & (au <= 0.8)],
        "ATR used > 0.8": g[au > 0.8],
    }
    return pd.DataFrame({k: _row(v, spread) for k, v in parts.items()}).T


def exit_compare(bt: pd.DataFrame) -> pd.DataFrame:
    """Average result at each exit time, for the two main setups' LONG signals."""
    rows = {}
    for setup in (SETUP_A, SETUP_B):
        for label, f in (("all", lambda g: g), ("SMH+QQQ aligned", lambda g: g[g["sector_ok"] == True])):  # noqa: E712
            g = f(bt[(bt["setup"] == setup) & (bt["direction"] == "LONG")])
            if g.empty:
                continue
            row = {"trades": len(g)}
            for name, mb in EXIT_OPTIONS.items():
                col = g[f"exit_{mb}"].dropna()
                row[name.split(" (")[0] + " avg %"] = round(col.mean(), 2) if len(col) else np.nan
            rows[f"{setup} · LONG · {label}"] = row
    return pd.DataFrame(rows).T


def plan_day(signals: list, capital: float, risk_pct: float, stop_pct: float, mode: str) -> list:
    """Turn the day's filter-passing signals into sized trades under ONE daily risk budget.

    signals: dicts with ticker, setup, direction, entry, entry_bar, atr_pct.
    mode "one": only the first signal of the day (earliest; ties → calmest stock, lowest ATR).
    mode "split": signals at the first entry time share the budget equally; later ones are skipped.
    Correlated semis can't be treated as separate bets: on the 60-day data, taking every
    filtered signal at full risk meant up to 11 positions on one day."""
    order = sorted(signals, key=lambda x: (x["entry_bar"], x.get("atr_pct") or 99))
    if not order:
        return []
    first_bar = order[0]["entry_bar"]
    if mode == "one":
        alloc = [risk_pct if k == 0 else 0.0 for k in range(len(order))]
    else:
        group = [k for k, x in enumerate(order) if x["entry_bar"] == first_bar]
        alloc = [risk_pct / len(group) if k in group else 0.0 for k in range(len(order))]
    out = []
    for x, r in zip(order, alloc):
        if r <= 0:
            out.append({**x, "action": "skip: today's risk already used", "risk_pct": 0.0})
            continue
        pos = capital * r / 100 / (stop_pct / 100)
        out.append({**x, "action": "take", "risk_pct": r, "risk_eur": round(capital * r / 100, 2),
                    "position_eur": round(pos, 0), "margin_eur_5to1": round(pos / 5, 0),
                    "stop_price": round(x["entry"] * (1 - x["direction"] * stop_pct / 100), 2)})
    return out


def simulate(bt: pd.DataFrame, mode: str, risk_pct: float, stop_pct: float, spread: float,
             aligned_only: bool = True, long_only: bool = True) -> dict:
    """Account-level result of the 15:40 + 16:30 signals under a sizing mode.
    mode: "every signal at full risk" | "one" | "split". Uses result_stop_pct (stop + chosen exit)."""
    g = bt[bt["setup"].isin([SETUP_A, SETUP_B])].copy()
    if long_only:
        g = g[g["direction"] == "LONG"]
    if aligned_only:
        g = g[g["sector_ok"] == True]  # noqa: E712
    if g.empty:
        return {"trades": 0}
    daily, n = [], 0
    for d, day in g.groupby("date"):
        sig = [{"ticker": r.ticker, "setup": r.setup, "direction": 1 if r.direction == "LONG" else -1, "entry": 100.0,
                "entry_bar": int(r.entry_bar), "atr_pct": r.atr_pct, "res": r.result_stop_pct} for r in day.itertuples()]
        if mode == "every signal at full risk":
            taken = [(x, risk_pct) for x in sig]
        else:
            taken = [(p, p["risk_pct"]) for p in plan_day(sig, 100.0, risk_pct, stop_pct, mode) if p["action"] == "take"]
        r = sum(rp / stop_pct * (x["res"] - spread) for x, rp in taken)
        n += len(taken)
        daily.append(r)
    eq = np.cumsum(daily)
    dd = float((eq - np.maximum.accumulate(np.r_[0, eq])[1:]).min())
    total = float(eq[-1])
    return {"trades": n, "days_traded": len(daily), "total_%_of_account": round(total, 2),
            "worst_day_%": round(min(daily), 2), "max_drawdown_%": round(min(dd, 0), 2),
            "return_per_drawdown": round(total / abs(dd), 2) if dd < 0 else np.nan}


# ----------------------------------------------------------------------------
# 2-year study: big-day warnings + first-hour rule (daily + hourly data)
# ----------------------------------------------------------------------------
def _first_hours(h: pd.DataFrame | None) -> dict:
    """{date: (open, high, low, close)} of the 9:30-10:30 NY hourly bar."""
    out = {}
    if h is None or h.empty:
        return out
    hh = h.dropna(subset=["Close"])
    for ts, r in hh[(hh.index.hour == 9) & (hh.index.minute == 30)].iterrows():
        out[ts.date()] = (float(r["Open"]), float(r["High"]), float(r["Low"]), float(r["Close"]))
    return out


def long_study(daily: dict, hourly: dict, hynix: pd.DataFrame | None, tickers: list) -> dict:
    """hourly should also contain SMH and QQQ (and MU/SNDK/WDC) for the filter tables."""
    hy = None
    if hynix is not None and not hynix.empty:
        hy = (hynix["Close"].pct_change() * 100).dropna()
        hy.index = [pd.Timestamp(i).date() for i in hy.index]
    smh_f, qqq_f = _first_hours(hourly.get("SMH")), _first_hours(hourly.get("QQQ"))
    mem_f = {x: _first_hours(hourly.get(x)) for x in MEMORY}
    rows = []
    for t in tickers:
        d = daily.get(t)
        if d is None or len(d) < 30:
            continue
        d = d.dropna(subset=["Close", "Open"])
        first = _first_hours(hourly.get(t))
        rets = d["Close"].pct_change() * 100
        prev_c = d["Close"].shift(1)
        tr = pd.concat([d["High"] - d["Low"], (d["High"] - prev_c).abs(), (d["Low"] - prev_c).abs()], axis=1).max(axis=1) / prev_c * 100
        idx = list(d.index)
        for i in range(21, len(idx)):
            k, p = idx[i], idx[i - 1]
            o, c, pc = float(d["Open"].iloc[i]), float(d["Close"].iloc[i]), float(d["Close"].iloc[i - 1])
            past = rets.iloc[max(1, i - 20):i]
            longp = rets.iloc[max(1, i - 120):i]
            vr = float(past.std() / longp.std()) if len(longp) >= 60 and longp.std() > 0 else np.nan
            f = first.get(k)
            fc = f[3] if f else None
            atr_pct = float(tr.iloc[i - 14:i].mean()) if i >= 15 else np.nan
            fh = (fc / o - 1) * 100 if fc else np.nan
            direction = 1 if fh > 0 else -1
            sm, qq = smh_f.get(k), qqq_f.get(k)
            sector_ok = (all(direction * (z[3] - z[0]) > 0 for z in (sm, qq)) if sm and qq else None)
            mem = [mem_f[x].get(k) for x in MEMORY] if t in MEMORY else []
            breadth = sum(1 for z in mem if z and direction * (z[3] - z[0]) > 0) if mem and all(mem) else None
            atr_used = ((max(f[1], o) - min(f[2], o)) / o * 100 / atr_pct) if f and atr_pct and atr_pct > 0 else np.nan
            rows.append({"ticker": t, "date": k, "c2c": float(rets.iloc[i]), "gap": (o / pc - 1) * 100, "o2c": (c / o - 1) * 100,
                         "prev": float(rets.iloc[i - 1]), "vol_ratio": vr,
                         "hynix": float(hy.get(k)) if hy is not None and k in hy.index else np.nan,
                         "fh": fh, "rest": (c / fc - 1) * 100 if fc else np.nan,
                         "sector_ok": sector_ok, "breadth": breadth, "atr_used": atr_used})
    R = pd.DataFrame(rows)
    if R.empty:
        return {}
    big = R["c2c"].abs() >= 7
    base = big.mean() * 100

    def rate(label, mask):
        n = int(mask.sum())
        r = big[mask].mean() * 100 if n else np.nan
        return {"condition": label, "days": n, "chance_of_±7%_day": round(r, 1), "vs_normal": f"×{r / base:.1f}" if n else "—"}

    warn = (R["gap"].abs() >= 3) | (R["hynix"].abs() >= 3)
    warnings = pd.DataFrame([
        rate("all days", R["c2c"].notna()),
        rate("market calm (20d vol < 0.8× normal)", R["vol_ratio"] < 0.8),
        rate("volatility rising (> 1.3× normal)", R["vol_ratio"] > 1.3),
        rate("yesterday moved ±7%+", R["prev"].abs() >= 7),
        rate("Hynix ±3%+ overnight", R["hynix"].abs() >= 3),
        rate("Hynix ±5%+ overnight", R["hynix"].abs() >= 5),
        rate("gap ±3%+", R["gap"].abs() >= 3),
        rate("gap ±5%+", R["gap"].abs() >= 5),
        rate("any warning by 15:30 (gap or Hynix ±3%)", warn),
        rate("no warning", ~warn),
    ]).set_index("condition")

    F = R.dropna(subset=["fh", "rest"])
    with_gap = (F["fh"].abs() >= 3) & (F["gap"].abs() >= 1) & (np.sign(F["fh"]) == np.sign(F["gap"]))
    against = (F["fh"].abs() >= 3) & (F["gap"].abs() >= 1) & (np.sign(F["fh"]) != np.sign(F["gap"]))

    def fh_row(label, mask):
        X = F[mask]
        if X.empty:
            return {"case": label, "days": 0}
        cont = np.sign(X["rest"]) == np.sign(X["fh"])
        lo, hi = m.wilson(int(cont.sum()), len(X))
        return {"case": label, "days": len(X), "rest_of_day_continued_%": round(cont.mean() * 100, 1),
                "95%_range": f"{lo}–{hi}%", "avg_rest_of_day_%": round(float((np.sign(X["fh"]) * X["rest"]).mean()), 2)}

    fh_rows = [fh_row("first hour 3%+ WITH a 1%+ gap", with_gap),
               fh_row("  …up days", with_gap & (F["fh"] > 0)),
               fh_row("  …down days", with_gap & (F["fh"] < 0)),
               fh_row("first hour 3%+ AGAINST the gap", against),
               fh_row("all days (first hour any size)", F["fh"].notna())]
    # stability: by half-year
    F2 = F.assign(period=[f"{d.year}-H{1 if d.month <= 6 else 2}" for d in F["date"]])
    for p in sorted(F2["period"].unique()):
        fh_rows.append(fh_row(f"WITH-gap rule, {p}", with_gap & (F2["period"] == p)))
    # filters on the LONG side of the rule (the side that held up)
    L = F[with_gap & (F["fh"] > 0)].copy()
    L["period"] = [f"{d.year}-H{1 if d.month <= 6 else 2}" for d in L["date"]]

    def lrow(label, X):
        if X.empty:
            return {"case": label, "trades": 0}
        r = X["rest"]
        lo, hi = m.wilson(int((r > 0).sum()), len(X))
        return {"case": label, "trades": len(X), "days": X["date"].nunique(), "won_%": round((r > 0).mean() * 100, 1),
                "95%_range": f"{lo}–{hi}%", "avg_rest_of_day_%": round(float(r.mean()), 2)}

    au = pd.to_numeric(L["atr_used"], errors="coerce")
    filt_rows = [lrow("all LONG signals", L),
                 lrow("SMH+QQQ up in the first hour", L[L["sector_ok"] == True]),  # noqa: E712
                 lrow("SMH+QQQ NOT both up", L[L["sector_ok"] == False]),  # noqa: E712
                 lrow("memory breadth 3/3", L[L["breadth"] == 3]),
                 lrow("memory breadth ≤2/3", L[L["breadth"].notna() & (L["breadth"] < 3)]),
                 lrow("ATR used < 0.8", L[au < 0.8]),
                 lrow("ATR used ≥ 0.8", L[au >= 0.8])]
    for p in sorted(L["period"].unique()):
        filt_rows.append(lrow(f"sector-aligned, {p}", L[(L["period"] == p) & (L["sector_ok"] == True)]))  # noqa: E712
        filt_rows.append(lrow(f"not aligned, {p}", L[(L["period"] == p) & (L["sector_ok"] == False)]))  # noqa: E712
    return {"warnings": warnings, "first_hour": pd.DataFrame(fh_rows).set_index("case"),
            "filters": pd.DataFrame(filt_rows).set_index("case"),
            "span": f"{R['date'].min()} → {R['date'].max()}", "stock_days": len(R), "base": round(base, 1)}


# ----------------------------------------------------------------------------
# Spread log: T212's real CFD spread by time of day (typed in by hand; T212's API has no CFD access)
# ----------------------------------------------------------------------------
SPREAD_COLS = ["time_ams", "ticker", "bid", "ask", "spread_pct", "window"]
SPREAD_WINDOWS = ["15:30–15:40 (first 10 min)", "15:40–16:30", "16:30–21:30", "21:30–22:00 (last 30 min)", "outside US hours"]


def spread_window(now_ny) -> str:
    mins = now_ny.hour * 60 + now_ny.minute - 570
    if now_ny.weekday() >= 5 or mins < 0 or mins >= 390:
        return SPREAD_WINDOWS[4]
    if mins < 10:
        return SPREAD_WINDOWS[0]
    if mins < 60:
        return SPREAD_WINDOWS[1]
    if mins < 360:
        return SPREAD_WINDOWS[2]
    return SPREAD_WINDOWS[3]


def read_spreads(path: Path) -> pd.DataFrame:
    try:
        return pd.read_csv(path)[SPREAD_COLS]
    except Exception:
        return pd.DataFrame(columns=SPREAD_COLS)


def add_spread(path: Path, ticker: str, bid: float, ask: float, now_ams, now_ny) -> pd.DataFrame:
    if not (bid > 0 and ask > bid):
        raise ValueError("Ask must be higher than bid, and both above zero.")
    mid = (bid + ask) / 2
    row = {"time_ams": now_ams.strftime("%Y-%m-%d %H:%M:%S"), "ticker": ticker, "bid": bid, "ask": ask,
           "spread_pct": round((ask - bid) / mid * 100, 4), "window": spread_window(now_ny)}
    df = pd.concat([read_spreads(path), pd.DataFrame([row])], ignore_index=True)
    df.to_csv(path, index=False)
    return df


def spread_summary(df: pd.DataFrame) -> pd.DataFrame:
    """Average spread % per ticker and time window. Buying at the ask and selling at the bid
    costs the full spread once per round trip, so spread_pct is the round-trip cost."""
    if df.empty:
        return pd.DataFrame()
    t = df.pivot_table(index="ticker", columns="window", values="spread_pct", aggfunc="mean").round(3)
    t = t[[w for w in SPREAD_WINDOWS if w in t.columns]]
    t["readings"] = df.groupby("ticker").size()
    return t
