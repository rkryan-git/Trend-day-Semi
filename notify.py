"""Push notifications to your own devices (iPhone home-screen app, desktop browser).

Private files next to the app, all gitignored and never zipped:
  push_vapid.pem   signing key for push messages
  push_subs.json   your devices (push addresses Apple/Google gave the browser)
  push_state.json  what has already been sent, so nothing repeats

What triggers a notification:
  - a fresh TAKE signal (once per stock and direction per day)
  - breaking high-impact news on your semis (once per headline)
  - rule E switching a stock IN or OUT, checked once after each US close
  - after each US close: what your sells from the last 14 days gained or missed since (from Invest -> Exits)
"""
from __future__ import annotations

import asyncio
import base64
import json
import threading
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import engine

HERE = Path(__file__).parent
KEY_FILE = HERE / "push_vapid.pem"
SUBS_FILE = HERE / "push_subs.json"
STATE_FILE = HERE / "push_state.json"
NY = ZoneInfo("America/New_York")
CLAIMS_SUB = "mailto:noreply@example.com"      # required by the push services; deliberately not your address
_lock = threading.Lock()


# ---------------------------------------------------------------- storage
def _read(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write(p: Path, data) -> None:
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
    tmp.replace(p)


def _vapid():
    from py_vapid import Vapid
    if not KEY_FILE.exists():
        v = Vapid()
        v.generate_keys()
        v.save_key(str(KEY_FILE))
    return Vapid.from_file(str(KEY_FILE))


def public_key() -> str:
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    raw = _vapid().public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def subscribe(sub: dict, qs: str = "") -> dict:
    if not isinstance(sub, dict) or not str(sub.get("endpoint", "")).startswith("https://") or "keys" not in sub:
        raise ValueError("Not a valid push subscription.")
    with _lock:
        subs = [s for s in _read(SUBS_FILE, []) if s["sub"]["endpoint"] != sub["endpoint"]]
        subs.append({"sub": sub, "qs": qs[:2000], "added": datetime.now().isoformat(timespec="seconds")})
        _write(SUBS_FILE, subs)
    return {"ok": True, "devices": len(subs)}


def unsubscribe(endpoint: str) -> dict:
    with _lock:
        subs = [s for s in _read(SUBS_FILE, []) if s["sub"]["endpoint"] != endpoint]
        _write(SUBS_FILE, subs)
    return {"ok": True, "devices": len(subs)}


def status(endpoint: str = "") -> dict:
    subs = _read(SUBS_FILE, [])
    return {"devices": len(subs), "this_device": any(s["sub"]["endpoint"] == endpoint for s in subs)}


# ---------------------------------------------------------------- sending
def send(title: str, body: str, url: str = "/", tag: str = "") -> int:
    from pywebpush import WebPushException, webpush
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag or title})
    sent, keep = 0, []
    key = str(KEY_FILE) if KEY_FILE.exists() else (_vapid() and str(KEY_FILE))
    with _lock:
        subs = _read(SUBS_FILE, [])
    for s in subs:
        try:
            webpush(s["sub"], payload, vapid_private_key=key, vapid_claims={"sub": CLAIMS_SUB}, ttl=3600, timeout=15)
            sent += 1
            keep.append(s)
        except WebPushException as e:
            code = getattr(e.response, "status_code", None)
            if code not in (404, 410):          # 404/410 = device unsubscribed: drop it
                keep.append(s)
            print(f"[push] failed ({code}): {str(e)[:120]}")
        except Exception as e:
            keep.append(s)
            print(f"[push] failed: {str(e)[:120]}")
    if len(keep) != len(subs):
        with _lock:
            _write(SUBS_FILE, keep)
    return sent


def test() -> dict:
    n = send("Radar notifications are on", "You'll get TAKE signals, breaking news and rule E changes here.", "/#live", "test")
    return {"ok": n > 0, "sent": n}


# ---------------------------------------------------------------- checks
def _settings():
    from urllib.parse import parse_qs
    subs = _read(SUBS_FILE, [])
    qs = subs[-1].get("qs", "") if subs else ""
    q = {k: v[-1] for k, v in parse_qs(qs).items()}
    return engine.Settings.from_query(q)


def check_live() -> None:
    if not _read(SUBS_FILE, []):
        return
    st = _read(STATE_FILE, {})
    sent = set(st.get("sent", []))
    d = engine.live(_settings())
    dec = d.get("decision", {}) or {}
    today = datetime.now(NY).strftime("%Y-%m-%d")
    if dec.get("state") == "take":
        for p in dec.get("takes", []):
            if p.get("late"):
                continue
            k = f"take:{today}:{p.get('ticker')}:{p.get('side')}"
            if k in sent:
                continue
            side = str(p.get("side", "")).lower()
            body = f"{p.get('ticker')} {side} near {p.get('entry')}. Enter within ~10 min, check T212's spread first. Exit {dec.get('exit', '')}."
            if send(f"TAKE {p.get('ticker')} {side}", body, "/#live", k):
                sent.add(k)
    mine = {t.upper() for t in _settings().watch}
    for n in dec.get("breaking", []) or []:
        k = "news:" + (n.get("url") or n.get("headline", ""))[:300]
        if k in sent or not (set(n.get("symbols") or []) & mine):    # only news on stocks you trade
            continue
        who = ", ".join(n.get("symbols") or []) or "Semis"
        if send(f"Breaking: {who}", n.get("headline", "")[:180], "/#live", k):
            sent.add(k)
    st["sent"] = sorted(sent)[-500:]
    _write(STATE_FILE, st)


def check_invest() -> None:
    if not _read(SUBS_FILE, []):
        return
    st = _read(STATE_FILE, {})
    day = datetime.now(NY).strftime("%Y-%m-%d")
    if st.get("invest_day") == day:
        return
    d = engine.invest(engine.Settings())
    if d.get("error"):
        return
    now = {x["ticker"]: x.get("rule_e") for x in d.get("stocks", []) if x.get("rule_e")}
    before = st.get("rule_e", {})
    if before:                                   # first run only records, so you don't get 7 alerts at once
        for t, v in now.items():
            if before.get(t) and before[t] != v:
                msg = (f"{t} is back above its 200-day average or SMH is: rule E says IN again." if v == "IN" else
                       f"{t} and SMH are both below their 200-day average: rule E says OUT.")
                send(f"Rule E: {t} {v}", msg, "/#invest", f"rulee:{day}:{t}")
    st["rule_e"], st["invest_day"] = now, day
    _write(STATE_FILE, st)


def check_exits() -> None:
    """Once after each US close: what your recent sells (last 14 days) did since, in euros.
    Uses your uploaded T212 export (Invest -> Exits); new sells show up after you upload a newer export."""
    if not _read(SUBS_FILE, []) or not engine.EXITS_FILE.exists():
        return
    st = _read(STATE_FILE, {})
    day = datetime.now(NY).strftime("%Y-%m-%d")
    if st.get("exits_day") == day:
        return
    st["exits_day"] = day
    _write(STATE_FILE, st)
    d = engine.exits()
    if d.get("empty"):
        return
    cutoff = (datetime.now(NY) - __import__("datetime").timedelta(days=14)).strftime("%Y-%m-%d")
    recent = [x for x in d.get("sells", []) if not x.get("error") and x.get("date", "") >= cutoff and x.get("diff_eur") is not None]
    if not recent:
        return
    by = {}
    for x in recent:                                      # one line per stock
        by.setdefault(x["ticker"], []).append(x)
    rows, tot = [], 0.0
    for t, xs in by.items():
        v = sum(x["diff_eur"] for x in xs)
        tot += v
        extra = f" ({xs[0]['chg_since']:+.1f}% since you sold)" if len(xs) == 1 and xs[0].get("chg_since") is not None else f" ({len(xs)} sells)"
        rows.append((abs(v), f"{t} {'missed' if v > 0 else 'avoided'} €{abs(v):,.0f}{extra}"))
    rows.sort(reverse=True)
    parts = [r[1] for r in rows[:4]] + ([f"+{len(rows) - 4} more"] if len(rows) > 4 else [])
    head = (f"Holding your last sells would have made €{tot:,.0f}" if tot > 0 else f"Your last sells saved €{abs(tot):,.0f}")
    send(f"Exits: {head}", "; ".join(parts)[:220] + ". Last 14 days.", "/#invest-exits", f"exits:{day}")


async def loop() -> None:
    """Every minute in US trading hours, every 15 minutes otherwise; rule E once after the close."""
    await asyncio.sleep(20)
    while True:
        ny = datetime.now(NY)
        open_hours = ny.weekday() < 5 and (9, 25) <= (ny.hour, ny.minute) <= (16, 5)
        try:
            await asyncio.to_thread(check_live)
        except Exception as e:
            print(f"[push] live check failed: {str(e)[:160]}")
        if ny.weekday() < 5 and (ny.hour, ny.minute) >= (16, 20):
            try:
                await asyncio.to_thread(check_invest)
            except Exception as e:
                print(f"[push] invest check failed: {str(e)[:160]}")
            try:
                await asyncio.to_thread(check_exits)
            except Exception as e:
                print(f"[push] exits check failed: {str(e)[:160]}")
        await asyncio.sleep(60 if open_hours else 900)
