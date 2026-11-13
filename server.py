"""Semi Trend-Day Radar web app.

Run:  python server.py            (opens on http://127.0.0.1:8765)
      python server.py --port 9000
"""
from __future__ import annotations

import argparse
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from starlette.applications import Starlette
from starlette.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

import engine
import notify

WEB = Path(__file__).parent / "web"


async def run(fn, *args):
    """Data work is blocking (yfinance, pandas): keep it off the event loop."""
    return await asyncio.to_thread(fn, *args)


def err(e: Exception, status: int = 500) -> JSONResponse:
    return JSONResponse({"error": str(e)}, status_code=status)


async def index(request):
    return FileResponse(WEB / "index.html", headers={"Cache-Control": "no-store"})


async def api_live(request):
    try:
        return JSONResponse(await run(engine.live, engine.Settings.from_query(request.query_params)))
    except Exception as e:
        return err(e)


async def api_schema(request):
    return JSONResponse(engine.settings_schema())


async def api_news(request):
    try:
        return JSONResponse(await run(engine.news, request.path_params["ticker"]))
    except Exception as e:
        return err(e)


async def api_invest(request):
    try:
        return JSONResponse(await run(engine.invest, engine.Settings.from_query(request.query_params)))
    except Exception as e:
        return err(e)


async def api_exits(request):
    try:
        if request.method == "POST":
            raw = await request.body()
            if len(raw) > 5_000_000:
                return err(ValueError("File too large."), 400)
            return JSONResponse(await run(engine.save_exits, raw.decode("utf-8-sig", errors="replace")))
        if request.method == "DELETE":
            return JSONResponse(await run(engine.clear_exits))
        return JSONResponse(await run(engine.exits))
    except ValueError as e:
        return err(e, 400)
    except Exception as e:
        return err(e)


async def api_log(request):
    try:
        return JSONResponse(await run(engine.signal_log, engine.Settings.from_query(request.query_params)))
    except Exception as e:
        return err(e)


async def api_log_csv(request):
    csv = await run(engine.signal_log_csv)
    return PlainTextResponse(csv, media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=signal_log.csv"})


async def api_spread(request):
    try:
        if request.method == "POST":
            body = await request.json()
            await run(engine.add_spread, str(body["ticker"]).upper(), float(body["bid"]), float(body["ask"]))
        return JSONResponse(await run(engine.spread_log, engine.Settings.from_query(request.query_params)))
    except ValueError as e:
        return err(e, 400)
    except Exception as e:
        return err(e)


async def api_backtest(request):
    try:
        return JSONResponse(await run(engine.backtest, engine.Settings.from_query(request.query_params)))
    except Exception as e:
        return err(e)


async def api_trend(request):
    try:
        mins = int(request.query_params.get("check_min", 60))
        return JSONResponse(await run(engine.trend_backtest, engine.Settings.from_query(request.query_params), mins))
    except Exception as e:
        return err(e)


async def api_long(request):
    try:
        stocks = [t.strip().upper() for t in request.query_params.get("stocks", "").split(",") if t.strip()]
        if not stocks:
            return err(ValueError("Pick at least one stock."), 400)
        return JSONResponse(await run(engine.long_check, stocks))
    except Exception as e:
        return err(e)


async def sw(request):
    return FileResponse(WEB / "sw.js", media_type="application/javascript",
                        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})


async def api_push(request):
    try:
        part = request.path_params["part"]
        if part == "key":
            return JSONResponse({"key": await run(notify.public_key)})
        if part == "status":
            return JSONResponse(notify.status(request.query_params.get("endpoint", "")))
        if part == "test" and request.method == "POST":
            return JSONResponse(await run(notify.test))
        if part == "subscribe":
            body = await request.json()
            if request.method == "DELETE":
                return JSONResponse(notify.unsubscribe(str(body.get("endpoint", ""))))
            return JSONResponse(notify.subscribe(body.get("sub"), str(body.get("qs", ""))))
        return err(ValueError("Unknown push action."), 404)
    except ValueError as e:
        return err(e, 400)
    except Exception as e:
        return err(e)


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(notify.loop())
    yield
    task.cancel()


app = Starlette(lifespan=lifespan, routes=[
    Route("/", index),
    Route("/sw.js", sw),
    Route("/api/push/{part}", api_push, methods=["GET", "POST", "DELETE"]),
    Route("/api/live", api_live),
    Route("/api/schema", api_schema),
    Route("/api/news/{ticker}", api_news),
    Route("/api/invest", api_invest),
    Route("/api/exits", api_exits, methods=["GET", "POST", "DELETE"]),
    Route("/api/log", api_log),
    Route("/api/log.csv", api_log_csv),
    Route("/api/spread", api_spread, methods=["GET", "POST"]),
    Route("/api/backtest", api_backtest),
    Route("/api/trend", api_trend),
    Route("/api/long", api_long),
    Mount("/web", StaticFiles(directory=WEB), name="web"),
])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    print(f"Semi Trend-Day Radar on http://{a.host}:{a.port}")
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")
