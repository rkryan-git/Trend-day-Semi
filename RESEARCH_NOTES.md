# Research notes (running memory for this project)

Last updated: 12 Nov 2026. Stocks: MU, SNDK, WDC, LRCX, AMAT, ASML, AMD. Market check: SMH, QQQ.
All times Amsterdam. Results are before T212's spread unless stated.

## What works (so far)
- **16:30 first-hour confirm, long only, market filter passed** (gap 1%+, first hour 3%+ same way; SMH and QQQ
  above today's open): 87 trades / 46 days over 2 years, 70% won, +1.10% avg. Filter failed: 27 trades, 48%, -0.27%.
- **15:40 confirmed gap, long only, market filter passed** (gap 0.5%+, first 10 min 0.3%+ same way): 42 trades /
  11 days in 60 days, 71% won, +1.22%. Filter failed: 19 trades, +0.17%. Thin sample.
- Exit 21:30 keeps ~92% of the result; last 10 minutes are 1.7x noisier than midday.
- One risk budget per day (signals cluster: 1-11 on the same day).
- Big-day radar: +/-7% day on ~5% of days without a warning, ~22% with one, ~52% after a 5%+ gap. Size only, not direction.

## What did not work
News direction at 15:25/15:30, chasing a fixed % from the open, fading the gap, strongest stock of the day,
VWAP-stretch fades, 15-min opening-range breakout with VWAP stop, tight trailing stops, shorts,
ATR-exhaustion filter, memory-breadth filter (mixed).

## Microstructure ideas (12 Nov 2026)
| Idea | Status | Why |
|---|---|---|
| Relative strength vs SMH in the first 2-5 minutes ("coiled spring") | Tested, not supported | 20 days of 1-min data. Stock holding while SMH fell 0.3%+: 5-13 cases on 2-6 days; at 5 min only 15% closed higher (-2.79% avg). Strongest third by relative strength did worse than the weakest third. |
| Dealer gamma (GEX) | Blocked on data | Yahoo's free option chains had almost no open interest pre-market (QQQ: 2,072 contracts in total across 8 expiries). Needs a real options-data source. No history either, so it can only be logged forward. |
| Order-flow imbalance (OFI) | Blocked on data | Needs live quotes/trades. Free: Alpaca IEX feed (~2.5% of US volume). Full market: about $99/month. T212 CFD prices are T212's own quotes, so exchange order flow is one step removed. |
| Real T212 spread by time of day | Built: Spread log tab | T212's public API covers Invest and ISA accounts only, not CFD, so readings are typed in by hand. |

## Known issues / decisions
- v5.3: setups, filter and log use finished 5-min candles only.
- 11 Nov log rows for the 16:30 signals were recorded mid-candle (correct entries: MU 806.31, SNDK 986.69).
- Git repo not reachable yet; this file travels in the zip until it is.
