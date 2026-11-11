"""Data fetching via yfinance (free Yahoo Finance data, ~real-time for US stocks,
may lag a few minutes). Everything network-related lives here."""
from __future__ import annotations

from datetime import date, datetime

import pandas as pd
import yfinance as yf

NY = "America/New_York"


def _split_download(raw: pd.DataFrame, tickers: list) -> dict:
    out = {}
    if raw is None or raw.empty:
        return {t: None for t in tickers}
    if isinstance(raw.columns, pd.MultiIndex):
        lvl0 = set(raw.columns.get_level_values(0))
        for t in tickers:
            if t in lvl0:
                df = raw[t].dropna(how="all")
                out[t] = df if not df.empty else None
            else:
                out[t] = None
    else:  # single ticker
        out[tickers[0]] = raw.dropna(how="all")
    return out


def intraday(tickers: list, period: str = "15d", interval: str = "5m") -> dict:
    """Regular-session bars (5m by default; 1h works up to 730d), index in New York time."""
    raw = yf.download(tickers, period=period, interval=interval, group_by="ticker",
                      auto_adjust=False, prepost=False, threads=True, progress=False)
    out = _split_download(raw, tickers)
    for t, df in out.items():
        if df is None:
            continue
        idx = df.index
        df.index = idx.tz_convert(NY) if idx.tz is not None else idx.tz_localize("UTC").tz_convert(NY)
        out[t] = df
    return out


def daily(tickers: list, period: str = "6mo") -> dict:
    raw = yf.download(tickers, period=period, interval="1d", group_by="ticker",
                      auto_adjust=False, threads=True, progress=False)
    out = _split_download(raw, tickers)
    for t, df in out.items():
        if df is not None:
            df.index = pd.to_datetime(df.index).date
    return out


def overnight(tz_by_ticker: dict) -> dict:
    """Latest price and change vs the previous session for non-US markets (Korea, Japan,
    Amsterdam). Uses intraday bars for today's price, because Yahoo's daily bar for
    these exchanges can lag a full day, and daily history for the previous close.

    Returns {ticker: {"last", "chg", "date", "as_of"} or None}."""
    out = {}
    for t, tz in tz_by_ticker.items():
        try:
            tk = yf.Ticker(t)
            intra = tk.history(period="5d", interval="30m", auto_adjust=False).dropna(subset=["Close"])
            dly = tk.history(period="1mo", interval="1d", auto_adjust=False).dropna(subset=["Close"])
            if intra.empty:
                out[t] = None
                continue
            intra.index = intra.index.tz_convert(tz)
            last_date = intra.index[-1].date()
            last = float(intra["Close"].iloc[-1])
            dly_dates = pd.to_datetime(dly.index).tz_localize(None).date if len(dly) else []
            prev = [float(c) for d, c in zip(dly_dates, dly["Close"]) if d < last_date]
            if prev:
                prev_close = prev[-1]
            else:  # fall back to the previous intraday session
                earlier = intra[intra.index.date < last_date]
                if earlier.empty:
                    out[t] = None
                    continue
                prev_close = float(earlier["Close"].iloc[-1])
            out[t] = {"last": last, "chg": (last / prev_close - 1) * 100, "date": last_date,
                      "as_of": intra.index[-1]}
        except Exception:
            out[t] = None
    return out


def premarket(tickers: list) -> dict:
    """Latest US pre-market price per ticker today (None if there is none yet)."""
    out = {t: None for t in tickers}
    try:
        raw = yf.download(tickers, period="1d", interval="5m", group_by="ticker",
                          auto_adjust=False, prepost=True, threads=True, progress=False)
        for t, df in _split_download(raw, tickers).items():
            if df is None or df.empty:
                continue
            idx = df.index.tz_convert(NY) if df.index.tz is not None else df.index.tz_localize("UTC").tz_convert(NY)
            df = df.set_axis(idx).dropna(subset=["Close"])
            mins = df.index.hour * 60 + df.index.minute
            pre = df[(mins < 570) & (df.index.date == pd.Timestamp.now(tz=NY).date())]
            if not pre.empty:
                out[t] = float(pre["Close"].iloc[-1])
    except Exception:
        pass
    return out


def earnings_date(ticker: str) -> date | None:
    """Next earnings date from Yahoo, if it has one."""
    try:
        cal = yf.Ticker(ticker).calendar
        if isinstance(cal, dict):
            ed = cal.get("Earnings Date")
            if ed:
                d = ed[0] if isinstance(ed, (list, tuple)) else ed
                return pd.Timestamp(d).date()
        elif isinstance(cal, pd.DataFrame) and "Earnings Date" in cal.index:
            return pd.Timestamp(cal.loc["Earnings Date"].iloc[0]).date()
    except Exception:
        pass
    return None


def news(ticker: str, limit: int = 6) -> list:
    """Latest headlines. Handles both old and new yfinance news formats."""
    items = []
    try:
        for n in (yf.Ticker(ticker).news or [])[:limit]:
            c = n.get("content", n)
            title = c.get("title")
            link = (c.get("canonicalUrl") or {}).get("url") if isinstance(c.get("canonicalUrl"), dict) else c.get("link")
            provider = (c.get("provider") or {}).get("displayName") if isinstance(c.get("provider"), dict) else c.get("publisher")
            when = c.get("pubDate") or c.get("providerPublishTime")
            if isinstance(when, (int, float)):
                when = datetime.utcfromtimestamp(when).isoformat()
            if title:
                items.append({"title": title, "url": link, "source": provider, "time": when})
    except Exception:
        pass
    return items
