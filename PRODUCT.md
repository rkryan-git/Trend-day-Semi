# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
One user: the owner, a solo trader, on desktop, during US market hours (15:30–22:00 Amsterdam). Trades the
7 semiconductor stocks (MU, SNDK, WDC, LRCX, AMAT, ASML, AMD) by hand as Trading 212 CFDs. The app stays open
in a browser tab all session and is glanced at, not studied.

## Product Purpose
Tell the user fast whether today's setup signals are a TAKE or a skip, and with what size, stop and exit time;
warn about likely big-move days; and log every signal so the user builds an honest live track record.
Success means fewer bad trades, not more trades.

## Positioning
Only shows rules that held up in the owner's own testing (15:40 confirmed gap, 16:30 first-hour confirm, long
only, market filter), and is explicit about what failed and what is unproven. It is a decision aid with its
evidence attached, not a signal service.

## Operating Context
- Local Streamlit app on http://localhost:8501, refreshed every 60 s; Yahoo Finance data (free, sometimes
  delayed or patchy; pre-market only partly).
- Orders are placed manually in Trading 212; the app never trades.
- `signal_log.csv` and `spread_log.csv` are the user's private records and are never committed.
- New versions arrive as zips from another Claude chat; research notes live in RESEARCH_NOTES.md.

## Capabilities and Constraints
Tabs: Live, Signal log, Spread log, Backtest (60 days), 2-year check, How to read this. Sidebar settings for
direction, market filter, spread, CFD money, daily risk, stop, multi-signal rule and exit time. All of this
functionality must survive any redesign unchanged.

## Evidence on Hand
Backtest and 2-year results computed by the app itself; RESEARCH_NOTES.md. No external testimonials or claims
exist and none may be invented. Every chart must come from numbers the app computes.

## Product Principles
1. The day's decision comes before everything else on the screen.
2. Show the evidence and its limits next to every rule; never overstate an edge.
3. Calm over exciting: nothing should push the user into a trade.
4. Live refresh must stay fast.

## Accessibility & Inclusion
Gain/loss and TAKE/skip are never shown by colour alone (sign, arrow or word as well).
