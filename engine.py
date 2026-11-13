"""Semi Trend-Day Radar engine: the same trading logic as app.py, returned as plain data for the web UI.

No rules, numbers or thresholds are defined here; everything comes from setups.py, metrics.py and data.py.
"""
from __future__ import annotations

import math
import threading
import time as _time
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

import data
import metrics as m
import setups as su

AMS = ZoneInfo("Europe/Amsterdam")
NY = ZoneInfo("America/New_York")
HERE = Path(__file__).parent
LOG_PATH = HERE / "signal_log.csv"
SPREAD_PATH = HERE / "spread_log.csv"

DEFAULT_WATCH = ["MU", "SNDK", "WDC", "LRCX", "AMAT", "ASML", "AMD"]
MEMORY = {"MU", "SNDK", "WDC"}
SECTOR_REFS = ["SMH", "SOXX", "NVDA", "QQQ"]
OVERNIGHT = {"000660.KS": ("SK Hynix", "Asia/Seoul"), "005930.KS": ("Samsung", "Asia/Seoul"),
             "^KS11": ("KOSPI", "Asia/Seoul"), "^N225": ("Nikkei", "Asia/Tokyo"),
             "ASML.AS": ("ASML (Amsterdam)", "Europe/Amsterdam")}
STATE_WORD = {"triggered": "Triggered", "waiting": "Waiting", "no setup": "No setup", "stay out": "Stay out"}


# ----------------------------------------------------------------------------
# Small TTL cache (replaces st.cache_data; same lifetimes as app.py)
# ----------------------------------------------------------------------------
_cache: dict = {}
_lock = threading.Lock()


def ttl_cache(seconds: int):
    def deco(fn):
        def wrapped(*args):
            key = (fn.__name__, args)
            now = _time.time()
            with _lock:
                hit = _cache.get(key)
                if hit and now - hit[0] < seconds:
                    return hit[1]
            val = fn(*args)
            with _lock:
                _cache[key] = (now, val)
            return val
        return wrapped
    return deco


@ttl_cache(55)
def load_intraday(tickers: tuple, period: str = "15d", interval: str = "5m"):
    return data.intraday(list(tickers), period, interval)


@ttl_cache(3600)
def load_daily(tickers: tuple, period: str = "6mo"):
    return data.daily(list(tickers), period)


@ttl_cache(120)
def load_overnight():
    return data.overnight({t: tz for t, (_, tz) in OVERNIGHT.items()})


@ttl_cache(55)
def load_premarket(tickers: tuple):
    return data.premarket(list(tickers))


@ttl_cache(6 * 3600)
def load_earnings(tickers: tuple):
    return {t: data.earnings_date(t) for t in tickers}


@ttl_cache(600)
def load_news(ticker: str):
    return data.news(ticker)


# ----------------------------------------------------------------------------
# Settings (the old sidebar)
# ----------------------------------------------------------------------------
@dataclass
class Settings:
    watch: list = field(default_factory=lambda: list(DEFAULT_WATCH))
    sector: str = "SMH"
    refresh: int = 60
    long_only: bool = True
    require_sector: bool = True
    spread: float = 0.25
    show_orb: bool = False
    exit_label: str = ""
    capital: float = 2000.0
    risk_day: float = 1.0
    stop_pct: float = 3.0
    size_mode: str = "one"

    @property
    def exit_before(self) -> int:
        return su.EXIT_OPTIONS.get(self.exit_label, list(su.EXIT_OPTIONS.values())[0])

    @property
    def exit_time(self) -> str:
        return self.exit_label.split("(")[-1].rstrip(")")

    @classmethod
    def from_query(cls, q) -> "Settings":
        def f(name, default, cast):
            try:
                return cast(q.get(name)) if q.get(name) not in (None, "") else default
            except Exception:
                return default
        b = lambda v: str(v).lower() in ("1", "true", "yes", "on")  # noqa: E731
        s = cls()
        w = q.get("watch")
        if w:
            s.watch = [t.strip().upper() for t in w.split(",") if t.strip()] or s.watch
        s.sector = q.get("sector") if q.get("sector") in ("SMH", "SOXX") else "SMH"
        s.refresh = f("refresh", 60, int)
        s.long_only = f("long_only", True, b)
        s.require_sector = f("require_sector", True, b)
        s.spread = min(max(f("spread", 0.25, float), 0.0), 2.0)
        s.show_orb = f("show_orb", False, b)
        labels = list(su.EXIT_OPTIONS)
        s.exit_label = q.get("exit") if q.get("exit") in labels else labels[0]
        s.capital = max(f("capital", 2000.0, float), 100.0)
        s.risk_day = min(max(f("risk_day", 1.0, float), 0.1), 5.0)
        s.stop_pct = min(max(f("stop", 3.0, float), 0.5), 10.0)
        s.size_mode = "split" if q.get("size_mode") == "split" else "one"
        return s


def settings_schema() -> dict:
    return {"exit_options": list(su.EXIT_OPTIONS), "default_watch": DEFAULT_WATCH,
            "evidence": su.FILTER_EVIDENCE}


# ----------------------------------------------------------------------------
# JSON helpers
# ----------------------------------------------------------------------------
def clean(v):
    if v is None:
        return None
    if isinstance(v, (np.floating, float)):
        return None if (math.isnan(v) or math.isinf(v)) else round(float(v), 4)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, (pd.Timestamp, datetime, date)):
        return str(v)
    return v


def table(df: pd.DataFrame | None, index: bool = True) -> dict:
    """DataFrame -> {columns, rows} with JSON-safe values. Keeps the index as the first column when it carries labels."""
    if df is None or df.empty:
        return {"columns": [], "rows": []}
    d = df.copy()
    if index and not isinstance(d.index, pd.RangeIndex):
        d = d.reset_index()
    cols = [str(c) for c in d.columns]
    rows = [[clean(v) for v in r] for r in d.itertuples(index=False, name=None)]
    return {"columns": cols, "rows": rows}


def market_status(now_ny: datetime) -> str:
    t, wd = now_ny.time(), now_ny.weekday()
    if wd >= 5:
        return "weekend"
    if time(9, 30) <= t < time(16, 0):
        return "open"
    if t < time(9, 30):
        return "pre"
    return "closed"


def bar_time_ams(session: pd.DataFrame, bar: int) -> str:
    return (session.index[bar] + pd.Timedelta(minutes=m.BAR_MINUTES)).tz_convert(AMS).strftime("%H:%M")


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


def series(session: pd.DataFrame | None, n: int = 80) -> list:
    """Intraday close path for sparklines."""
    if session is None or session.empty:
        return []
    c = session["Close"].dropna().astype(float).tolist()
    if len(c) > n:
        step = len(c) / n
        c = [c[int(i * step)] for i in range(n)] + [c[-1]]
    return [round(x, 4) for x in c]


# ----------------------------------------------------------------------------
# Live
# ----------------------------------------------------------------------------
def live(s: Settings) -> dict:
    now_ams = datetime.now(AMS)
    now_ny = now_ams.astimezone(NY)
    phase = market_status(now_ny)
    today_ny = now_ny.date()
    today = now_ams.date()
    WATCH = s.watch
    out: dict = {"phase": phase, "updated": now_ams.strftime("%H:%M:%S"), "refresh": s.refresh}

    # catalysts
    cat = load_catalysts(WATCH)
    cat_today = cat[(cat["date"] == today) | (cat.get("reaction_day", cat["date"]) == today)] if not cat.empty else cat
    upcoming = cat[(cat["date"] > today) & (cat["date"] <= today + timedelta(days=21))] if not cat.empty else cat
    catalyst_today = bool(len(cat_today[cat_today["impact"].isin(["High", "Very high"])])) if not cat_today.empty else False
    out["catalysts"] = {
        "today": [{"event": r["event"], "time": r["time_cet"], "affects": r["affects"], "impact": r["impact"],
                   "status": r["status"]} for _, r in cat_today.iterrows()],
        "upcoming": [{"date": str(r["date"]), "time": r["time_cet"], "event": r["event"], "impact": r["impact"],
                      "status": r["status"]} for _, r in upcoming.iterrows()],
    }

    # data
    all_us = tuple(sorted(set(WATCH) | set(SECTOR_REFS)))
    intra = load_intraday(all_us)
    dly = load_daily(all_us)
    ovn = load_overnight()
    pre = load_premarket(all_us) if phase == "pre" else {}
    sess_all = {t: m.split_sessions(df) for t, df in intra.items() if df is not None and not df.empty}
    sess_done = su.drop_unfinished(sess_all, now_ny)
    snaps = build_snapshots(sess_all, dly, list(all_us))
    sector_snap = snaps.get(s.sector)
    breadth = m.breadth_of([snaps.get(t) for t in WATCH])

    # overnight
    hynix_today = None
    ov = []
    for tk, (name, _) in OVERNIGHT.items():
        o = ovn.get(tk)
        if not o:
            ov.append({"name": name, "last": None, "chg": None})
            continue
        stale = o["date"] != today_ny
        ov.append({"name": name, "last": clean(o["last"]), "chg": clean(o["chg"]), "stale": stale,
                   "session": f"{o['date']:%a %d %b}", "as_of": f"{o['as_of']:%H:%M}"})
        if tk == "000660.KS" and not stale:
            hynix_today = o["chg"]
    out["overnight"] = ov

    # big-day radar
    radar_rows = []
    for t in WATCH:
        sess = sess_all.get(t) or {}
        days = sorted(sess)
        if not days:
            radar_rows.append({"ticker": t, "level": None})
            continue
        last_d = days[-1]
        if last_d == today_ny and len(days) >= 2:
            prev_close = float(sess[days[-2]]["Close"].iloc[-1])
            gap = (float(sess[last_d]["Open"].iloc[0]) / prev_close - 1) * 100
            hist_until, gap_label = days[-2], "gap"
        else:
            prev_close = float(sess[last_d]["Close"].iloc[-1])
            p = pre.get(t)
            gap = (p / prev_close - 1) * 100 if p else None
            hist_until, gap_label = last_d, "pre-market"
        dd = dly.get(t)
        hist = dd[[i <= hist_until for i in dd.index]] if dd is not None and not dd.empty else None
        r = su.radar(hist, gap, hynix_today, catalyst_today, t in MEMORY)
        vol = None if r.vol_ratio is None else (
            "rising" if r.vol_ratio > 1.3 else "calm" if r.vol_ratio < 0.8 else "normal")
        radar_rows.append({"ticker": t, "level": r.level, "chance": clean(r.chance), "gap": clean(r.gap),
                           "gap_label": gap_label, "hynix": clean(r.hynix) if t in MEMORY else None,
                           "memory": t in MEMORY, "vol": vol, "vol_ratio": clean(r.vol_ratio),
                           "yesterday": clean(r.yesterday), "warnings": r.warnings})
    out["radar"] = {"rows": radar_rows, "rates": su.BIG_DAY_RATES}

    # market filter
    filt = None
    mk_sess = sess_done.get("SMH") or {}
    mk_days = sorted(mk_sess)
    if mk_days and mk_days[-1] == today_ny and len(mk_sess[mk_days[-1]]) > 0:
        j_now = len(mk_sess[mk_days[-1]]) - 1
        now_ctx = su.context(sess_done, "SMH", today_ny, j_now, 1, None)
        if now_ctx.sector_ok is not None:
            gap_fade = now_ctx.sector_ok is False and bool(
                (snaps.get("SMH") and snaps["SMH"].chg > 0 and "SMH -" in now_ctx.sector_note) or
                (snaps.get("QQQ") and snaps["QQQ"].chg > 0 and "QQQ -" in now_ctx.sector_note))
            so = su.since_open_table(sess_all, ["SMH", "QQQ"], today_ny).set_index("Ticker")

            def open_pct(tk):
                try:
                    return clean(float(so.loc[tk, "Since open %"]))
                except Exception:
                    return None
            filt = {"ok": bool(now_ctx.sector_ok), "note": now_ctx.sector_note,
                    "smh_open": open_pct("SMH"), "qqq_open": open_pct("QQQ"),
                    "smh_day": clean(snaps["SMH"].chg) if snaps.get("SMH") else None,
                    "qqq_day": clean(snaps["QQQ"].chg) if snaps.get("QQQ") else None,
                    "fade": gap_fade}
    out["filter"] = filt

    # since the open
    if any(sorted(sess_all.get(t) or {})[-1:] == [today_ny] for t in WATCH):
        mv = su.since_open_table(sess_all, ["SMH", "QQQ"] + [t for t in WATCH if t not in ("SMH", "QQQ")], today_ny)
        out["since_open"] = table(mv, index=False)
    else:
        out["since_open"] = None

    # setups
    cols_setups = [(su.SETUP_A, su.setup_a), (su.SETUP_B, su.setup_b)] + ([(su.SETUP_ORB, su.setup_orb)] if s.show_orb else [])
    setup_rows, triggered, marks, takes, stay_out, fired = [], [], {}, [], [], []
    for t in WATCH:
        sess = sess_done.get(t) or {}
        days = sorted(sess)
        if not days or days[-1] != today_ny or len(days) < 2 or len(sess[days[-1]]) == 0:
            setup_rows.append({"ticker": t, "cells": [{"setup": c, "state": "Waiting for today's open"} for c, _ in cols_setups]})
            continue
        sx = sess[days[-1]]
        pc = float(sess[days[-2]]["Close"].iloc[-1])
        atr_pct = su.atr_pct_before(dly.get(t), today_ny)
        cells = []
        for col, fn in cols_setups:
            st_ = fn(sx, pc)
            cell = {"setup": col, "state": STATE_WORD[st_.state], "detail": st_.note}
            if st_.state == "stay out" and t not in stay_out:
                stay_out.append(t)
            if st_.state == "triggered":
                ctx = su.context(sess_done, t, today_ny, st_.entry_bar, st_.direction, atr_pct)
                side = "LONG" if st_.direction > 0 else "SHORT"
                blocked = []
                if s.long_only and st_.direction < 0:
                    blocked.append("long-only")
                if s.require_sector and ctx.sector_ok is not True:
                    blocked.append("SMH/QQQ not aligned")
                passed = not blocked
                now_r = su.result_so_far(st_, sx)
                cell.update({"side": side, "entry": clean(st_.entry), "now": clean(now_r), "passed": passed,
                             "blocked": blocked, "time": bar_time_ams(sx, st_.entry_bar),
                             "filters": {"sector": ctx.sector_ok, "breadth": ctx.breadth, "atr_used": clean(ctx.atr_used)}})
                fired.append({"ticker": t, "setup": st_.setup, "side": side, "blocked": blocked, "taken": False,
                              "entry": clean(st_.entry), "now": clean(now_r), "time": bar_time_ams(sx, st_.entry_bar),
                              "filters": cell["filters"]})
                triggered.append([today_ny, t, st_, bar_time_ams(sx, st_.entry_bar), ctx, passed, "", ", ".join(blocked)])
                marks.setdefault(t, []).append(st_)
                if passed:
                    takes.append({"ticker": t, "setup": st_.setup, "direction": st_.direction, "entry": st_.entry,
                                  "entry_bar": st_.entry_bar, "atr_pct": atr_pct,
                                  "entry_time": bar_time_ams(sx, st_.entry_bar),
                                  "signal_at": sx.index[st_.entry_bar] + pd.Timedelta(minutes=m.BAR_MINUTES),
                                  "now": now_r})
            cells.append(cell)
        setup_rows.append({"ticker": t, "cells": cells})

    plan = su.plan_day(takes, s.capital, s.risk_day, s.stop_pct, s.size_mode)
    for item in triggered:
        match = next((p_ for p_ in plan if p_["ticker"] == item[1] and p_["setup"] == item[2].setup), None)
        if match:
            item[6] = match["action"]
    for f_ in fired:
        f_["taken"] = any(p_["ticker"] == f_["ticker"] and p_["setup"] == f_["setup"] and p_["action"] == "take" for p_ in plan)
        if not f_["blocked"] and not f_["taken"]:
            f_["blocked"] = [next((p_["action"] for p_ in plan if p_["ticker"] == f_["ticker"]
                                   and p_["setup"] == f_["setup"]), "not in today's plan")]
    research = []
    shown = set()
    for item in triggered:
        st_ = item[2]
        key = (st_.setup, st_.direction)
        if key not in shown:
            shown.add(key)
            research.append(f"{st_.setup} · {su.RESEARCH[st_.setup]['long' if st_.direction > 0 else 'short']}")
    out["setups"] = {"columns": [c for c, _ in cols_setups], "rows": setup_rows,
                     "rules": {su.SETUP_A: su.RESEARCH[su.SETUP_A]["rule"], su.SETUP_B: su.RESEARCH[su.SETUP_B]["rule"]},
                     "fired": fired, "research": research}

    # log (side effect, exactly as the old app)
    try:
        su.update_log(LOG_PATH, [tuple(x) for x in triggered], sess_done, s.exit_before)
        out["log_error"] = None
    except Exception as e:
        out["log_error"] = str(e)

    # decision
    logged_today = []
    try:
        lg = su.read_log(LOG_PATH)
        lg = lg[(lg["date"].astype(str) == str(today_ny)) & (lg["plan"].astype(str) == "take")]
        logged_today = [f"TAKE {r_['ticker']} {r_['direction']} at {r_['entry_time_ams']}" for _, r_ in lg.iterrows()]
    except Exception:
        pass
    vh = [str(r_["event"]) for _, r_ in cat_today.iterrows() if r_["impact"] == "Very high"] if not cat_today.empty else []
    out["decision"] = decide(phase, now_ny, plan, fired, filt, s, stay_out, vh, logged_today)

    # sector tape
    tape = []
    for tk in SECTOR_REFS:
        sn = snaps.get(tk)
        if sn is None:
            tape.append({"ticker": tk, "last": None})
            continue
        p = pre.get(tk)
        tape.append({"ticker": tk, "last": clean(sn.last), "chg": clean(sn.chg), "vwap_dist": clean(sn.vwap_dist),
                     "pre": clean(p), "pre_chg": clean((p / sn.last - 1) * 100) if p else None,
                     "spark": series(sn.extra.get("session")), "prev_close": clean(sn.prev_close)})
    out["tape"] = {"items": tape, "breadth": clean(breadth)}

    # watchlist
    any_snap = next((x for x in snaps.values() if x is not None), None)
    wl = []
    for t in WATCH:
        sn = snaps.get(t)
        if sn is None:
            wl.append({"ticker": t, "verdict": "No data"})
            continue
        v = m.trend_score(sn, sector_snap if t != s.sector else None, breadth, catalyst_today)
        detail_marks = [{"setup": x.setup, "side": "LONG" if x.direction > 0 else "SHORT", "bar": x.entry_bar,
                         "entry": clean(x.entry)} for x in marks.get(t, [])]
        sess_df = sn.extra["session"]
        vw = m.vwap(sess_df)
        wl.append({
            "ticker": t, "last": clean(sn.last), "chg": clean(sn.chg),
            "pre": clean(pre.get(t)), "pre_chg": clean((pre[t] / sn.last - 1) * 100) if pre.get(t) else None,
            "gap": clean(sn.gap), "first30": clean(sn.first30), "vwap_dist": clean(sn.vwap_dist),
            "vwap_side": clean(sn.vwap_side),
            "or": ({1: "Above", -1: "Below", 0: "Inside"}[sn.or_break] if sn.or_high else "Forming"),
            "rvol": clean(sn.rvol), "range_atr": clean(sn.range_atr), "score": clean(v.score), "verdict": v.label,
            "reasons": v.reasons, "spark": series(sess_df), "prev_close": clean(sn.prev_close),
            "candles": {"t": [x.tz_convert(AMS).strftime("%H:%M") for x in sess_df.index],
                        "o": [clean(x) for x in sess_df["Open"]], "h": [clean(x) for x in sess_df["High"]],
                        "l": [clean(x) for x in sess_df["Low"]], "c": [clean(x) for x in sess_df["Close"]],
                        "vwap": [clean(x) for x in vw]},
            "marks": detail_marks,
        })
    out["watchlist"] = {"rows": wl,
                        "session": f"{any_snap.extra['date']:%a %d %b}" if any_snap is not None else None,
                        "minutes": any_snap.bars * m.BAR_MINUTES if any_snap is not None else None}
    out["exit_label"] = s.exit_label
    out["caption"] = {"stop": s.stop_pct, "risk_day": s.risk_day, "capital": s.capital, "spread": s.spread}
    return out


LATE_MIN = 10   # minutes after the signal candle closes; after that the tested entry is gone


def decide(phase, now_ny, plan, fired, filt, s: Settings, stay_out, catalysts, logged_today) -> dict:
    """Headline precedence (DESIGN.md): closed > TAKE > too late > longs blocked > signal skipped > waiting > done.

    A TAKE is only actionable for LATE_MIN minutes after its signal candle closes. After that the
    headline says the signal has passed: buying later is a different, untested trade (other price,
    other distance to the stop), and a headline that keeps saying "Take" all afternoon invites it."""
    takes = [dict(p) for p in plan if p.get("action") == "take"]
    for p in takes:
        p["side"] = "LONG" if p["direction"] > 0 else "SHORT"
        at = p.pop("signal_at", None)
        age = (now_ny - at).total_seconds() / 60 if at is not None else 0.0
        p["age_min"] = int(max(age, 0))
        p["late"] = age > LATE_MIN
        for k in ("entry", "position_eur", "margin_eur_5to1", "risk_eur", "stop_price", "now"):
            if k in p:
                p[k] = clean(p[k])
        p.pop("atr_pct", None)
        p.pop("entry_bar", None)
    fresh = [p for p in takes if not p["late"]]
    t = now_ny.time()
    d = {"state": "", "head": "", "tone": "", "sub": "", "takes": takes, "exit": s.exit_time,
         "size_mode": s.size_mode, "budget": round(s.capital * s.risk_day / 100, 2),
         "filter": filt, "catalysts": catalysts, "stay_out": stay_out,
         "also": [f for f in fired if not f["taken"]] if takes else []}
    if phase in ("weekend", "closed"):
        d.update(state="closed", head="Market closed", tone="muted",
                 sub=("Weekend. The next session opens Monday at 15:30 your time." if phase == "weekend" else
                      f"Today's session is over: {', '.join(logged_today) if logged_today else 'no TAKE today'}. "
                      "The next session opens at 15:30 your time."))
    elif fresh:
        sides = sorted({p["side"] for p in fresh})
        names = [p["ticker"] for p in fresh]
        left = max(LATE_MIN - min(p["age_min"] for p in fresh), 0)
        head = f"{len(fresh)} TAKEs now" if len(fresh) >= 3 else f"Take {' & '.join(names)} {'/'.join(sides).lower()}"
        d.update(state="take", head=head, tone="gain",
                 sub=f"Enter within about {left} min at a price near the entry below, then hold to your exit at "
                     f"{s.exit_time}. Check T212's live spread first.")
    elif takes:
        p = takes[0]
        moved = f", now {p['now']:+.2f}% from there" if p.get("now") is not None else ""
        d.update(state="late", head=f"{p['ticker']} signal was at {p['entry_time']}: too late to enter", tone="muted",
                 sub=f"The tested entry was {p['entry']:,.2f} at {p['entry_time']}{moved}. Buying now is a different, "
                     f"untested trade: another price and another distance to the stop. Already in? Keep the stop at "
                     f"{p['stop_price']:,.2f} and exit at {s.exit_time}.")
    elif filt is not None and filt.get("ok") is False and s.require_sector:
        d.update(state="blocked", head="Longs blocked", tone="loss",
                 sub="SMH and QQQ must both be above today's open and VWAP before a long counts.")
    elif fired:
        first = fired[0]
        d.update(state="skipped", head=f"{first['ticker']} fired, skipped", tone="muted",
                 sub=f"Reason: {', '.join(first.get('blocked') or ['outside today’s plan'])}.")
    elif phase == "pre":
        d.update(state="pre", head="Pre-market", tone="muted",
                 sub="Market filter checks start at 15:30. The first setup check is 15:40.")
    elif t < time(9, 40):
        d.update(state="waiting", head="No signal yet", sub="Next check 15:40, the confirmed-gap setup.")
    elif t < time(10, 30):
        d.update(state="waiting", head="No signal yet", sub="Next check 16:30, the first-hour confirm.")
    else:
        d.update(state="done", head="No trade today", tone="muted",
                 sub="Both setup checks have passed without a signal you'd take. Nothing to do.")
    return d


def news(ticker: str) -> list:
    return load_news(ticker.upper()) or []


# ----------------------------------------------------------------------------
# Signal log, spread log
# ----------------------------------------------------------------------------
def signal_log(s: Settings) -> dict:
    log = su.read_log(LOG_PATH)
    if log.empty:
        return {"stats": table(None), "rows": table(None), "count": 0}
    stats = su.log_stats(log, s.spread)
    return {"stats": table(stats), "count": int(len(log)),
            "rows": table(log.sort_values(["date", "ticker"], ascending=[False, True]), index=False)}


def signal_log_csv() -> str:
    return su.read_log(LOG_PATH).to_csv(index=False)


def spread_log(s: Settings) -> dict:
    sp = su.read_spreads(SPREAD_PATH)
    if sp.empty:
        return {"summary": table(None), "rows": table(None), "average": None, "setting": s.spread}
    return {"summary": table(su.spread_summary(sp)), "average": clean(float(sp["spread_pct"].mean())),
            "setting": s.spread, "rows": table(sp.sort_values("time_ams", ascending=False), index=False)}


def add_spread(ticker: str, bid: float, ask: float) -> dict:
    now = datetime.now(AMS)
    su.add_spread(SPREAD_PATH, ticker, bid, ask, now, now.astimezone(NY))
    return {"saved": ticker, "spread_pct": round((ask - bid) / ((ask + bid) / 2) * 100, 3)}


# ----------------------------------------------------------------------------
# Backtest (60 days) and 2-year check
# ----------------------------------------------------------------------------
def backtest(s: Settings) -> dict:
    tks = tuple(sorted(set(s.watch) | {"SMH", "QQQ"} | set(MEMORY)))
    intra60 = load_intraday(tks, "60d")
    dly6 = load_daily(tks, "6mo")
    bt = su.backtest_setups(intra60, s.watch, dly6, stop=s.stop_pct, exit_before=s.exit_before)
    if bt.empty:
        return {"empty": True}
    sims = {}
    for name, mode in (("Every signal at full risk", "every signal at full risk"),
                       ("One trade per day", "one"), ("Split the day's risk", "split")):
        sims[name] = su.simulate(bt, mode, s.risk_day, s.stop_pct, s.spread, aligned_only=s.require_sector,
                                 long_only=s.long_only)
    breakdown = []
    for setup in (su.SETUP_A, su.SETUP_B, su.SETUP_ORB):
        for side in ("LONG", "SHORT"):
            fb = su.filter_breakdown(bt, setup, side, s.spread)
            if not fb.empty:
                breakdown.append({"title": f"{setup} · {side}", "table": table(fb)})
    return {"empty": False, "spread": s.spread,
            "all": table(su.summarize_setups(bt, s.spread)),
            "filtered": table(su.summarize_setups(bt, s.spread, filtered=True)),
            "exit": table(su.exit_compare(bt)), "sims": table(pd.DataFrame(sims).T),
            "breakdown": breakdown,
            "trades": table(bt.sort_values(["date", "ticker"], ascending=[False, True]), index=False),
            "risk_day": s.risk_day, "stop": s.stop_pct}


def trend_backtest(s: Settings, check_min: int) -> dict:
    tk = tuple(sorted(set(s.watch) | {s.sector}))
    bt2 = m.backtest(load_intraday(tk, "60d"), s.watch, s.sector, check_bar=check_min // m.BAR_MINUTES)
    if bt2.empty:
        return {"empty": True}
    ts, _ = m.top_pick(bt2)
    return {"empty": False, "summary": table(m.summarize_backtest(bt2)), "top": table(ts)}


def long_check(stocks: list) -> dict:
    dd = load_daily(tuple(sorted(stocks)), "2y")
    hh = load_intraday(tuple(sorted(set(stocks) | {"SMH", "QQQ"} | set(MEMORY))), "730d", "1h")
    hy = load_daily(("000660.KS",), "2y").get("000660.KS")
    res = su.long_study(dd, hh, hy, stocks)
    if not res:
        return {"empty": True}
    return {"empty": False, "stock_days": clean(res["stock_days"]), "span": res["span"], "base": clean(res["base"]),
            "warnings": table(res["warnings"]), "first_hour": table(res["first_hour"]), "filters": table(res["filters"])}
