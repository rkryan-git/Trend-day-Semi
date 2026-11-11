"""Pure metric + scoring logic. No network calls here, so it can be tested offline.

All intraday frames are regular-session 5-minute bars with columns
Open, High, Low, Close, Volume and a tz-aware DatetimeIndex (America/New_York).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

BAR_MINUTES = 5
OR_BARS = 30 // BAR_MINUTES          # opening range = first 30 minutes
RVOL_LOOKBACK = 10                   # sessions used for relative volume


# ----------------------------------------------------------------------------
# Session helpers
# ----------------------------------------------------------------------------
def split_sessions(df: pd.DataFrame) -> dict:
    """Split an intraday frame into {date: session_df}, dropping empty bars."""
    df = df.dropna(subset=["Close"])
    df = df[df["Volume"].fillna(0) >= 0]
    if df.empty:
        return {}
    return {d: g for d, g in df.groupby(df.index.date)}


def vwap(session: pd.DataFrame) -> pd.Series:
    tp = (session["High"] + session["Low"] + session["Close"]) / 3
    vol = session["Volume"].fillna(0)
    cum_vol = vol.cumsum().replace(0, np.nan)
    return (tp * vol).cumsum() / cum_vol


def daily_bars(sessions: dict) -> pd.DataFrame:
    rows = []
    for d, s in sessions.items():
        rows.append({"date": d, "Open": s["Open"].iloc[0], "High": s["High"].max(),
                     "Low": s["Low"].min(), "Close": s["Close"].iloc[-1],
                     "Volume": s["Volume"].sum()})
    return pd.DataFrame(rows).set_index("date").sort_index()


def atr(daily: pd.DataFrame, n: int = 14) -> float:
    """Average true range over the last n rows of a daily frame (needs n+1 rows)."""
    if len(daily) < 2:
        return float("nan")
    prev_close = daily["Close"].shift(1)
    tr = pd.concat([daily["High"] - daily["Low"],
                    (daily["High"] - prev_close).abs(),
                    (daily["Low"] - prev_close).abs()], axis=1).max(axis=1)
    return float(tr.iloc[1:].tail(n).mean())


# ----------------------------------------------------------------------------
# Snapshot of one ticker at one moment of the session
# ----------------------------------------------------------------------------
@dataclass
class Snapshot:
    ticker: str
    bars: int                      # 5m bars elapsed
    last: float
    prev_close: float
    chg: float                     # % vs previous close
    gap: float                     # % open vs previous close
    first30: float | None          # % first 30 min incl. overnight (Gao et al.)
    vwap: float
    vwap_dist: float               # % last vs VWAP
    vwap_side: float               # -1..1: share of bars above minus below VWAP
    or_high: float | None
    or_low: float | None
    or_break: int                  # +1 above OR, -1 below OR, 0 inside / too early
    rvol: float | None             # cum volume vs same-time average
    range_atr: float | None        # today's high-low / ATR
    range_pos: float               # 0 = at low of day, 1 = at high
    atr_pct: float | None
    day_high: float
    day_low: float
    extra: dict = field(default_factory=dict)


def snapshot(ticker: str, today: pd.DataFrame, prev_close: float,
             past_sessions: list, atr_value: float | None) -> Snapshot | None:
    """Metrics for `today` (bars so far) given previous close, prior sessions
    (oldest->newest, for RVOL) and a daily ATR value."""
    if today is None or today.empty or not prev_close or np.isnan(prev_close):
        return None
    n = len(today)
    last = float(today["Close"].iloc[-1])
    o = float(today["Open"].iloc[0])
    hi, lo = float(today["High"].max()), float(today["Low"].min())
    vw = vwap(today)
    vw_last = float(vw.iloc[-1]) if not np.isnan(vw.iloc[-1]) else last

    # share of bars (after the first 15 min, VWAP is noisy before) on each side
    start = min(3, n - 1)
    closes, vws = today["Close"].iloc[start:], vw.iloc[start:]
    if len(closes):
        above = float((closes > vws).mean())
        below = float((closes < vws).mean())
        side = above - below
    else:
        side = 0.0

    or_hi = or_lo = None
    or_break = 0
    first30 = None
    if n >= OR_BARS:
        or_hi = float(today["High"].iloc[:OR_BARS].max())
        or_lo = float(today["Low"].iloc[:OR_BARS].min())
        first30 = float(today["Close"].iloc[OR_BARS - 1] / prev_close - 1) * 100
        if n > OR_BARS:
            if last > or_hi:
                or_break = 1
            elif last < or_lo:
                or_break = -1

    # relative volume at the same time of day
    rvol = None
    cum_today = float(today["Volume"].fillna(0).sum())
    ref = [float(s["Volume"].fillna(0).iloc[:n].sum())
           for s in past_sessions[-RVOL_LOOKBACK:] if len(s) >= n]
    ref = [r for r in ref if r > 0]
    if ref:
        rvol = cum_today / float(np.mean(ref))

    atr_pct = range_atr = None
    if atr_value and not np.isnan(atr_value) and atr_value > 0:
        atr_pct = atr_value / prev_close * 100
        range_atr = (hi - lo) / atr_value

    return Snapshot(
        ticker=ticker, bars=n, last=last, prev_close=float(prev_close),
        chg=(last / prev_close - 1) * 100, gap=(o / prev_close - 1) * 100,
        first30=first30, vwap=vw_last, vwap_dist=(last / vw_last - 1) * 100,
        vwap_side=side, or_high=or_hi, or_low=or_lo, or_break=or_break,
        rvol=rvol, range_atr=range_atr,
        range_pos=(last - lo) / (hi - lo) if hi > lo else 0.5,
        atr_pct=atr_pct, day_high=hi, day_low=lo,
    )


# ----------------------------------------------------------------------------
# Trend-day score
# ----------------------------------------------------------------------------
WEIGHTS = {
    "move": 15,      # size of today's move relative to normal (ATR)
    "vwap": 20,      # which side of VWAP and how consistently
    "or": 15,        # broke and held outside the 30-min opening range
    "first30": 10,   # first 30 min agrees with the current direction
    "range_pos": 10, # sitting near the high/low of the day
    "sector": 15,    # SMH moving the same way
    "breadth": 15,   # how many semis move the same way
}


@dataclass
class Verdict:
    score: float              # -100 (strong down trend) .. +100 (strong up trend)
    label: str
    tone: str                 # "down" | "up" | "chop" | "wait"
    reasons: list
    parts: dict


def _clip(x: float) -> float:
    return float(max(-1.0, min(1.0, x)))


def trend_score(s: Snapshot, sector: Snapshot | None, breadth: float | None,
                catalyst_today: bool = False) -> Verdict:
    """breadth: (n_up - n_down) / n across the watchlist, -1..1."""
    parts, reasons = {}, []

    if s.bars < OR_BARS:
        return Verdict(0, "Too early: opening range still forming", "wait",
                       [f"Only {s.bars * BAR_MINUTES} min in. Wait for the first 30 min."], {})

    atr_pct = s.atr_pct or 3.0
    parts["move"] = _clip(s.chg / (0.6 * atr_pct))
    parts["vwap"] = _clip(np.sign(s.vwap_dist) * max(abs(s.vwap_side), 0.2)) if s.vwap_dist else 0.0
    parts["or"] = float(s.or_break)
    if s.first30 is not None and s.chg != 0:
        parts["first30"] = float(np.sign(s.first30)) if np.sign(s.first30) == np.sign(s.chg) else -0.5 * float(np.sign(s.chg))
    else:
        parts["first30"] = 0.0
    parts["range_pos"] = _clip((s.range_pos - 0.5) * 2)
    parts["sector"] = _clip(sector.chg / (0.6 * (sector.atr_pct or 2.0))) if sector else 0.0
    parts["breadth"] = _clip(breadth) if breadth is not None else 0.0

    total_w = sum(WEIGHTS[k] for k in parts)
    score = sum(WEIGHTS[k] * v for k, v in parts.items()) / total_w * 100
    d = "DOWN" if score < 0 else "UP"
    tone = d.lower()

    # --- human-readable reasons -------------------------------------------------
    side_word = "below" if s.vwap_dist < 0 else "above"
    reasons.append(f"Price {abs(s.vwap_dist):.2f}% {side_word} VWAP; "
                   f"{abs(s.vwap_side) * 100:.0f}% net of bars on one side")
    if s.or_break:
        reasons.append(f"Broke {'above' if s.or_break > 0 else 'below'} the 30-min opening range")
    else:
        reasons.append("Still inside the 30-min opening range")
    if s.rvol is not None:
        reasons.append(f"Relative volume {s.rvol:.2f}x normal for this time of day")
    if s.range_atr is not None:
        reasons.append(f"Day range is {s.range_atr:.2f}x its 14-day ATR")
    if sector:
        reasons.append(f"{sector.ticker} {sector.chg:+.2f}% today")
    if breadth is not None:
        reasons.append(f"Breadth across watchlist: {breadth:+.2f} (−1 all down, +1 all up)")
    if catalyst_today:
        reasons.append("Scheduled catalyst today: trend days are more common on news days")

    strong_vol = (s.rvol or 0) >= 1.3 or (s.range_atr or 0) >= 1.0
    a = abs(score)
    if a >= 60 and strong_vol:
        label = f"Trend day {d} likely"
    elif a >= 60:
        label = f"Leaning {d}, but volume is light"
    elif a >= 40:
        label = f"Leaning {d}: needs confirmation"
    else:
        label, tone = "Chop / range day: no edge in following", "chop"

    return Verdict(round(score, 1), label, tone, reasons, parts)


def breadth_of(snaps: list) -> float | None:
    snaps = [x for x in snaps if x is not None]
    if not snaps:
        return None
    up = sum(1 for x in snaps if x.chg > 0)
    down = sum(1 for x in snaps if x.chg < 0)
    return (up - down) / len(snaps)


# ----------------------------------------------------------------------------
# Backtest: score at a fixed time, then check what happened by the close
# ----------------------------------------------------------------------------
def backtest(intraday: dict, watchlist: list, sector_ticker: str,
             check_bar: int = 12) -> pd.DataFrame:
    """For every past session, compute the score after `check_bar` bars
    (12 = one hour after the open) and the return from then to the close.

    intraday: {ticker: full 5m frame (60d)}. Returns one row per ticker-day."""
    sess = {t: split_sessions(df) for t, df in intraday.items() if df is not None and not df.empty}
    daily = {t: daily_bars(s) for t, s in sess.items()}
    if sector_ticker not in sess:
        return pd.DataFrame()
    dates = sorted(sess[sector_ticker].keys())
    rows = []
    for i, d in enumerate(dates):
        if i < 15:          # need history for ATR + RVOL
            continue
        cut = {}
        for t in set(watchlist) | {sector_ticker}:
            if t not in sess or d not in sess[t]:
                continue
            days = sorted(k for k in sess[t] if k < d)
            if len(days) < 15:
                continue
            day_df = sess[t][d]
            if len(day_df) <= check_bar:
                continue
            prev_close = float(sess[t][days[-1]]["Close"].iloc[-1])
            a = atr(daily[t].loc[days[-15]:days[-1]])
            snap = snapshot(t, day_df.iloc[:check_bar], prev_close,
                            [sess[t][k] for k in days[-RVOL_LOOKBACK:]], a)
            cut[t] = (snap, day_df)
        if sector_ticker not in cut:
            continue
        b = breadth_of([cut[t][0] for t in watchlist if t in cut])
        for t in watchlist:
            if t not in cut or cut[t][0] is None:
                continue
            snap, day_df = cut[t]
            v = trend_score(snap, cut[sector_ticker][0], b)
            close = float(day_df["Close"].iloc[-1])
            fwd = (close / snap.last - 1) * 100
            rows.append({"date": d, "ticker": t, "score": v.score, "label": v.label,
                         "rvol": snap.rvol, "fwd_to_close_pct": fwd,
                         "followed_through": np.sign(fwd) == np.sign(v.score) if v.score else np.nan})
    return pd.DataFrame(rows)


def wilson(k: float, n: int, z: float = 1.96) -> tuple:
    """95% confidence range for a hit rate of k out of n (Wilson interval), in %."""
    if n == 0:
        return (np.nan, np.nan)
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (round((centre - half) * 100, 1), round((centre + half) * 100, 1))


def _stats(df: pd.DataFrame) -> dict:
    n = len(df)
    k = float(df["followed_through"].sum()) if n else 0.0
    lo, hi = wilson(k, n)
    signed = np.sign(df["score"]) * df["fwd_to_close_pct"]
    return {"cases": n,
            "followed_through_%": round(k / n * 100, 1) if n else np.nan,
            "95%_range": f"{lo}–{hi}%" if n else "—",
            "avg_move_in_signal_dir_%": round(float(signed.mean()), 2) if n else np.nan,
            "median_move_%": round(float(signed.median()), 2) if n else np.nan}


def ticker_summary(bt: pd.DataFrame, min_abs: float = 60) -> pd.DataFrame:
    """Per-ticker follow-through for strong signals, with a 95% range."""
    strong = bt[bt["score"].abs() >= min_abs]
    if strong.empty:
        return pd.DataFrame()
    return pd.DataFrame({t: _stats(g) for t, g in strong.groupby("ticker")}).T


def top_pick(bt: pd.DataFrame, min_abs: float = 60) -> tuple:
    """On each day with at least one strong signal, take the single stock with
    the most extreme score (ties: higher RVOL) and see what it did.

    Returns (summary table, one row per day)."""
    strong = bt[bt["score"].abs() >= min_abs].copy()
    if strong.empty:
        return pd.DataFrame(), pd.DataFrame()
    strong["abs_score"] = strong["score"].abs()
    strong["rvol_"] = strong["rvol"].fillna(0)
    strong = strong.sort_values(["date", "abs_score", "rvol_"], ascending=[True, False, False])
    top = strong.groupby("date").head(1)
    rest = strong.drop(top.index)
    rows = {
        "Strongest stock of the day": _stats(top),
        "  …on DOWN signals": _stats(top[top["score"] < 0]),
        "  …on UP signals": _stats(top[top["score"] > 0]),
        "Other 60+ stocks, same days": _stats(rest),
        "All 60+ cases": _stats(strong),
    }
    per_day = top[["date", "ticker", "score", "rvol", "fwd_to_close_pct", "followed_through"]]
    return pd.DataFrame(rows).T, per_day.sort_values("date", ascending=False)


def summarize_backtest(bt: pd.DataFrame) -> pd.DataFrame:
    if bt.empty:
        return bt
    bt = bt.copy()
    bt["bucket"] = pd.cut(bt["score"].abs(), [-0.1, 40, 60, 101],
                          labels=["|score| < 40 (chop)", "40–60 (leaning)", "≥ 60 (trend)"])
    # return in the direction the score pointed
    bt["signed_fwd"] = np.sign(bt["score"]) * bt["fwd_to_close_pct"]
    g = bt.groupby("bucket", observed=True)
    out = pd.DataFrame({
        "cases": g.size(),
        "followed_through_%": g["followed_through"].mean() * 100,
        "avg_move_in_signal_dir_%": g["signed_fwd"].mean(),
        "median_move_%": g["signed_fwd"].median(),
    })
    return out.round(2)
