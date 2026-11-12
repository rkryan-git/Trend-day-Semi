# Semi Trend-Day Radar: web UI (v7, redesign branch)

The trading logic is unchanged (setups.py, metrics.py, data.py, catalysts.csv). The Streamlit screen is replaced by a
hand-built web page:

- `server.py`  Starlette server Run: `python server.py` (http://127.0.0.1:8765)
               or `python server.py --port 9000`. Needs starlette + uvicorn (in requirements.txt).
- `engine.py`  Runs the same live logic as app.py and returns JSON: decision, market filter, radar per stock, setups,
               plan, signal-log update, sector tape, overnight, watchlist, calendar; plus backtest, 2-year check,
               signal log and spread log endpoints.
- `web/`       index.html, app.css, glass.css (liquid glass + motion layer), app.js (plain JS, hand-drawn SVG charts),
               self-hosted fonts (Inter variable, Newsreader, Geist Mono).
- `DESIGN.md`  Visual contract: dark = Framer, light = Motion, glass layer, motion rules. `design/BRIEF.md` = the
               owner's words. `PRODUCT.md` = product record.
- `app.py`     Old Streamlit UI, kept until the web UI is approved.

Personal files (signal_log.csv, spread_log.csv) are not included.
