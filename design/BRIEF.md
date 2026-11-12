# Brief: Semi Trend-Day Radar restyle

## What it is
A personal, local Streamlit dashboard (http://localhost:8501) that one trader keeps open during US hours
(15:30–22:00 Amsterdam). It watches 7 semiconductor stocks (MU, SNDK, WDC, LRCX, AMAT, ASML, AMD), warns about
likely big-move days, shows two tested setups (15:40 confirmed gap, 16:30 first-hour confirm) with a
TAKE / skip decision, sizes the trade, and logs every signal. Tabs: Live, Signal log, Spread log,
Backtest (60 days), 2-year check, How to read this.

Not a business site: there is no visitor, sale or booking. The "main action" is **reading today's decision
fast**: is the market filter allowing longs, is there a TAKE signal, what size, what stop, what exit time.

## The user's words
- "I would like to change the ui a bit almost like i would for my webdesign"
- "everything still needs the same functionality"
- "i need it to look like the apple/framer website https://www.framer.com/ and then the light version needs to
  look like this https://motion.so/"
- "maybe also add mini charts that give analysis to certain stuff something that fits psychological marketing
  visualizations" → chosen: **sparklines, before/after bars, gauges / meters**
- Default theme: **follow my system** (dark = Framer, light = Motion), with the toggle kept.
- Must avoid: **neon / glow, slow loading, clutter**.
- Pre-market price next to the regular price "to whatever is usual for a model like this" (done before the
  restyle, commit cba98ae).

## Must keep
Every existing feature, setting, number, tab, form, log write, backtest and the 60 s live refresh.
Caveats and "not financial advice" text stay. No invented numbers: every mini chart is drawn from data the app
already computes.

## Must avoid
- Framer's magenta/violet/orange gradient spotlight tiles and any glow (user: no neon).
- Heavy CSS or JS effects that slow the 60 s refresh; no animated backgrounds.
- More boxes than today: the restyle should remove clutter, not add it.
- Generic default-Streamlit look.

## Constraints
- Streamlit 1.67: theme via `.streamlit/config.toml` with `[theme.light]` / `[theme.dark]` (per-mode colours and
  heading font). Minimal CSS only where config cannot reach (the user asked for a web-design-level restyle).
- Built in a separate git worktree (`semi-trend-day-redesign`, branch `redesign`) so the live trading app on
  :8501 is never disturbed; merged only when the user approves.

## Still needed from the user
Nothing blocking.
