# Semi Trend-Day Radar (v5)

A local dashboard for your semis (MU, SNDK, WDC, LRCX, AMAT, ASML, AMD). It warns you about likely big-move days, shows the two setups that held up in testing, and logs every signal so you build a real track record.

## Setup (once)

1. Install Python 3.11+ from python.org (on Windows, tick "Add Python to PATH").
2. Open a terminal in this folder and run:

```
python -m venv .venv
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # macOS / Linux
pip install -r requirements.txt
```

## Run

```
streamlit run app.py
```

It opens at http://localhost:8501 and refreshes itself every 60 s. Keep it open during US hours so the signal log fills up.

## Tabs

- **Live**
  - **Overnight read:** SK Hynix, Samsung, KOSPI, Nikkei and ASML Amsterdam, now using same-day prices (the old version could show yesterday's).
  - **Big-day radar:** per stock, the warnings that came before past ±7% days (gap or pre-market gap, Hynix overnight, rising volatility, a big day yesterday, scheduled catalysts). Shows a level (Low / Elevated / High) and the historical chance of a ±7% day.
  - **Setups:**
    - *15:40 confirmed gap:* the stock gaps 0.5%+ and the first 10 minutes move 0.3%+ the same way.
    - *16:30 first-hour confirm:* the stock gaps 1%+ and the first hour moves 3%+ the same way.
    - Both are held to the close.
  - **Sector tape, watchlist and detail charts:** entry markers appear on the charts. The trend score is experimental.
- **Signal log:** every setup signal, with entry, close and result. It's written to `signal_log.csv` in this folder.
- **Backtest (60 days):** re-runs both setups on the last 60 days of 5-minute data, split into two halves, next to a "buy at 15:40 every day" baseline.
- **2-year check:** re-runs the big-day warnings and the 16:30 rule on about 2 years of daily and hourly data.
- **How to read this:** the step-by-step day plan, sizing and caveats.

## New in v5: exit time and one risk budget per day

- **Exit setting** in the sidebar, defaulting to 30 minutes before the close (21:30). The last 10 minutes moved 1.7× more than midday, with no direction bias, and exiting at 21:30 kept about 92% of the 15:40 setup's result. On the weeks when the US and EU change clocks on different dates, every time is one hour earlier.
- **Sizing:**
  - Sidebar settings for CFD money, max risk per DAY (default 1%), stop (default 3%), and what to do when several signals fire: *one trade per day* (default: the earliest signal, ties go to the calmest stock) or *split the day's risk*.
  - **Live:** a "Today's plan" box shows the position in €, the margin at 5:1, the risk in €, the stop price and the exit time for each signal you'd take, and why the others are skipped.
- **Backtest:** an exit-time comparison, and an account-level simulation for each sizing rule (total, worst day, max drawdown, return per drawdown).
- **Signal log:** records the plan decision and exit time; results are filled in at your exit time.

## v4: the market filter

- **Sidebar filters:**
  - *Long only* (on by default). Shorts had no reliable edge in either setup.
  - *Require SMH + QQQ above open and VWAP* (on by default). Tested on your data, this is the filter that helped:
    - 15:40 longs: +1.22% average with it, +0.17% without (60 days).
    - 16:30 longs: +1.10% average with it, −0.27% without, positive in every half-year (2 years).
  - *T212 spread %:* comes off every backtest and log result.
  - *Show experimental ORB-15 signal* (off by default). It lost money when tested.
- **Live:** a market-filter banner (longs allowed or blocked). Each signal shows 🟢 TAKE or 🟡 skip, with its sector, memory-breadth and ATR-used readings.
- **Signal log:** also stores the filter state and whether the signal passed. Signals the filters rejected are logged too, so you can see live whether the filter really helps.
- **Backtest:** results with and without the market filter, after spread, plus a breakdown per filter for every setup, including ORB-15.
- **2-year check:** a filter breakdown for the 16:30 rule.

Memory breadth (3/3) and ATR consumption are shown but not required: in testing, breadth was mixed and ATR consumption didn't hold up.

## Updating from the previous version

Replace all files except `signal_log.csv` (if you have one) and `catalysts.csv` (if you edited it). `setups.py` is new.

## Limits

- Free Yahoo data can lag a few minutes.
- The research behind the setups covers one market period: the 2025–26 memory boom and its crash. The 16:30 rule didn't work from July to November 2026.
- Results are before T212's spread.

Not financial advice.
