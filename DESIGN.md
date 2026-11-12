---
name: Semi Trend-Day Radar
description: "A trader's live desk in two moods that follow the system setting. Dark is Framer: near-black canvas, charcoal cards lifted by surface tone, white ink, white 8px rounded buttons, blue only for links and focus, a tight geometric sans for headings. Light is Motion: warm paper canvas, white raised cards with a soft shadow, black ink, black pill buttons, a classic serif for headings. Both are monochrome first; colour is spent only on gain/loss and on the one decision that matters today (TAKE / skip). No gradients, no glow."
sources: design/reference/links.md
---

## 1. Principles
1. **The decision first.** Top of Live, in this order: one always-present decision block (section 6) → big-day
   radar → everything else, lower down and quieter. The Live tab is regrouped, not just reordered: supporting
   detail (overnight read, catalysts, sector tape, watchlist, per-ticker charts) sits below one divider.
2. **Monochrome, then meaning.** Ink and surfaces carry the page. Green/red only for gain/loss and TAKE/blocked.
   Primary action = white 8px button with black text (dark) / black pill with paper text (light). Blue `#0099FF` (dark)
   only for links and focus; never a fill. Selected tab = `#1C1C1C` lift (dark) / black pill (light).
3. **Big numbers, small labels.** Prices and % are the content; labels are small, muted, sentence case.
4. **Fewer boxes.** A card groups one idea. No card inside a card. Hairlines and space separate the rest.
5. **No effects.** No gradients, glow, blur, animated backgrounds or entrance animations (user: no neon, no slow).

## 2. Colour tokens

| Token | Dark (Framer) | Light (Motion) | Use |
|---|---|---|---|
| canvas | `#090909` | `#F9F8F4` | page background |
| surface | `#141414` | `#FFFFFF` | cards, inputs, tables (`secondaryBackgroundColor` in light = `#F1F0EB` for widget fills) |
| surface-2 | `#1C1C1C` | `#F1F0EB` | widget fills, table header, hover |
| hairline | `#262626` | `#DEDDD8` | borders, dividers, chart grid |
| ink | `#FFFFFF` | `#000000` | primary text, numbers |
| ink-muted | `#999999` | `#595853` | labels, captions, axis text |
| primary | `#FFFFFF` (text `#000000`) | `#000000` (text `#F9F8F4`) | primary button fill (white 8px button on dark, black pill on paper) |
| link / focus | `#0099FF` | `#000000` | links, focus ring, selected-row hint only; never a button or brand fill (framer.DESIGN.md Don'ts) |
| gain | `#2EA043` | `#1A7F37` | up %, TAKE, longs allowed |
| loss | `#F2555A` | `#C4302B` | down %, blocked, stop |
| caution | `#D29922` | `#9A6700` | the radar's "Elevated" and "High" levels (High = caution + bold; never loss red: the radar says how big, not which way). Skipped signals are ink-muted, not amber |

Validated with the dataviz validator: gain/loss pass lightness, chroma, normal-vision ΔE (28–33) and contrast
on both canvases; they **fail colour-blind separation (deutan ΔE 2–5)** as every red/green pair does, so gain/loss
is **never colour alone**: always a sign (+/−) and an arrow (▲/▼) or a word (TAKE / skip / blocked).

## 3. Typography
- **Body (both):** Inter 400/500, self-hosted (see Font loading), base 15px.
- **Headings, dark:** Geist 500 (substitute for Framer's GT Walsheim), letter-spacing −0.03em.
- **Headings, light:** Newsreader 400 (classic serif, substitute for Motion's serif headline), letter-spacing −0.02em.
- **Numbers:** metric values 2rem weight 500 in the body face; `font-variant-numeric: tabular-nums` on metrics,
  tables and every price / % so columns don't jitter on refresh.
- **Font loading:** self-hosted woff2 files in `static/fonts/` via `[[theme.fontFaces]]` and
  `server.enableStaticServing`, so a slow font fetch never drops to system fonts mid-session.
- **Decision line (the largest type on Live):** 52px heading face (about 34px below 640px wide, so "TAKE SNDK SHORT"
  never overflows), tight tracking, e.g. "TAKE MU" / "No signal
  yet". Size, stop and exit under it as 32px tabular numbers with 13px muted labels.
- **App name:** a small wordmark line (15px, weight 500, heading face), not an h1.
- **Heading sizes (sections):** h2 26px, h3 19px, h4 16px; never larger than the decision line. Sentence case
  everywhere; no all-caps headings.
- **One eyebrow only:** the live status line at the top ("LIVE · 15:42" / "PRE-MARKET" / "CLOSED"), 12px,
  uppercase, letter-spacing 0.08em, ink-muted (Motion's nav labels). No eyebrows on other sections.

## 4. Shape and space
- Card radius 20px (Framer cards, Motion prompt box). Inputs and tables 12px.
- Buttons: **dark = 8px rounded rectangles** (as in the user's framer-dark.png: "Sign up", "Get started for free");
  **light = full pills** (Motion). Set per mode with `buttonRadius` / `baseRadius`. Primary: dark = white fill, black
  text; light = black fill, paper text.
- Selection controls (checkbox tick, radio dot, toggle) in dark: if a white `primaryColor` makes them unreadable,
  use `#0099FF` for selection state (Framer's "selected" blue) and keep white button fills via keyed CSS. Checked in
  the browser at first-screen.
- Sidebar inputs must stand out from the surface-2 sidebar ground: sidebar `secondaryBackgroundColor` = surface
  (dark `#141414` on `#1C1C1C`; light `#FFFFFF` on `#F1F0EB`).
- Chips / pills (setup names, filter states): outline pill, 1px hairline, 13px ink-muted (Motion chips).
- Cards have **no border**. Dark: separated by surface lift (`#141414` card on `#090909` canvas; Framer). Light:
  white card on paper with Motion's shadow `0 5px 20px rgba(0,0,0,.094)`.
- **Tables** (`st.dataframe` draws its own canvas grid, unreachable by CSS): per-mode `dataframeBorderColor` set to
  the surface-2 tone so the grid fades back, `dataframeHeaderBackgroundColor` = surface, header text ink-muted;
  every table sized to its rows (`height` from row count) so there are no empty rows.
- Spacing on a 4/8 rhythm; 24px between cards, 48px before each major section.
- Page width: wide layout, content max about 1280px.

## 5. Mini charts (user's choice: sparklines, before/after bars, gauges)
All drawn from numbers the app already computes. Thin marks, 2px lines, no gradients, recessive grid,
values in ink (never in the series colour), sign + arrow on every %.
- **Sparklines** — today's intraday path: `LineChartColumn` in the watchlist table; `st.metric(chart_data=...)`
  for the sector-tape tiles. Single series, ink-muted line; no legend.
- **Before/after bars** — "with market filter vs without": two horizontal bars per setup,
  direct-labelled values, the "with" bar in gain/loss colour and the "without" bar in hairline grey.
  **Only on Backtest and 2-year check**, drawn from the results those tabs compute when their button is pressed.
  Every bar is labelled with its trade count ("n = 42").
  - **Backtest:** bars = average result per trade **after spread** (column named as in `summarize_setups`), from
    `summarize_setups(bt, SPREAD)` ("without") vs `summarize_setups(bt, SPREAD, filtered=True)` ("with"). No whisker.
  - **2-year check:** bars = **won %** with the Wilson 95% range from `res["filters"]["95%_range"]` (parsed from its
    string, never retyped) as a thin whisker, plus a dashed 50% coin-flip line. "Without" = row `all LONG signals`,
    "with" = row `SMH+QQQ up in the first hour` (`NOT both up` is the opposite case, not "without").
    `avg_rest_of_day_%` is shown as a number labelled "before spread", not as a bar.
  Not on Live (Live has no backtest numbers; no typed-in figures anywhere).
- **Gauges / meters** — big-day chance per ticker as a native `ProgressColumn` meter in the radar table (0–100%),
  plus **at most one** half-ring gauge for the highest-chance ticker today. Reference ticks are read from
  `su.BIG_DAY_RATES` at runtime (currently all days 14.1%, no warning 5.3%), never typed in. "Risk used today vs
  daily budget" is a linear meter in the decision block (split mode only). Fills: radar half-ring = ink, caution at
  Elevated/High (never loss red); risk-used meter = ink, loss only above budget. The radar table's `ProgressColumn`
  takes one colour per column, so it is ink only; the level is the word in the existing "Level" column. Track in
  hairline; the number big with its label under it.
- **Chart engine:** Plotly only (already loaded for the detail charts); no third engine. Every chart sets
  transparent backgrounds, theme ink/hairline colours and **no transition animation**, so a 60 s refresh never
  replays motion.
- **Mode-aware colours:** any colour outside config.toml (dataframe Styler gain/loss, Plotly traces, gauge fills)
  is picked from a small token dict switched on `st.context.theme.type`, never a hard-coded hex.

## 6. Components
- **Decision block** (always rendered, top of Live): one card that states today's answer in one line, then the
  detail. States, each with its own wording and icon:
  1. Market closed / weekend — "Market closed. Next session …"
  2. Before open — "Pre-market. Filter checks start 15:30." (+ big-day level)
  3. Waiting — "No signal yet. Next check 15:40" / "… 16:30"
  4. Longs blocked — "Longs blocked by the market filter" + SMH/QQQ reasons
  5. Signal, skip — "Signal on MU, skipped: <reason>"
  6. TAKE — "TAKE MU LONG" (side always shown; shorts possible when "Long only" is off) + one row per TAKE:
     size € · margin · risk € · stop · exit time. "Split the day's risk" can give several TAKEs: one row each, and
     the headline lists them compactly ("TAKE MU, WDC LONG"; 3+ → "3 TAKEs today").
     A risk-used meter appears **only in split mode** (in one-trade mode it would always read 100%; show the €
     risk figure instead).
  7. Done for the day — "No TAKE today" after 16:30 with no taken signal
  8. Stay out — the app's existing "stay out" state for a ticker/day, worded as "Stay out: <reason>"
  **Headline precedence** when several are true: closed > TAKE (first 10 min after the signal) > too late to enter > longs blocked > signal skipped > waiting > done.
  "Stay out" is a per-ticker state of the 16:30 setup, shown as a line under the headline ("Stay out: MU, WDC –
  first hour went against the gap"), never the day's headline.
  The decision block is the **only** place for size, margin, risk, stop and exit.
  The market-filter state is a line inside this block, not a separate banner. A **Very high catalyst today**
  (e.g. today's Nvidia CEO news) gets one line in this block too; the full catalyst list stays below the divider.
- **Signal cards (TAKE only)**: setup name as an outline chip, ticker big, entry · now % · filters. No size/stop/exit
  (those live in the decision block). **Skipped signals are quiet rows in one list** under the cards (ticker, setup,
  reason), not cards, so a busy day never shows 14 boxes.
- **Metric tiles**: label small muted, value big ink, delta as **plain coloured text** with sign + arrow (no tinted
  delta pill; `st.metric(delta_arrow=..., ...)` styled via keyed CSS so the pill background is transparent).
- **Tables**: words only in cells (e.g. "Elevated", "Waiting", "Stay out", "sector ok / not ok" instead of ✓/✗), never icons or emoji; meters via
  `ProgressColumn`. Material icons only inline in text elsewhere, never inside tables or tiles.
- **Tabs**: Streamlit `st.tabs` restyled via keyed CSS. Dark: muted text, selected = `#1C1C1C` 8px rounded tab with
  white text. Light: outline pills (Motion chips), selected = black pill with paper text.
- **Sidebar**: surface-2 ground; settings grouped under 13px ink-muted sentence-case group headings (no eyebrows).
- **Chrome**: `client.toolbarMode = "viewer"` (hides Deploy, keeps the menu with the System / Light / Dark switch;
  verified in the browser after the build);
  `page_icon` is a small monochrome SVG favicon in `static/`, not an emoji.

### One home per fact (Live tab)
| Fact | Today | After |
|---|---|---|
| Today's answer, size, stop, exit, why others are skipped | "Today's plan" list (only when a plan exists) | **Decision block** (always) |
| Market filter on/off + reason | st.success / st.warning banner | one line in the decision block |
| SMH / QQQ "Since the open" table | under the banner | directly **under** the decision card in a borderless "Why" disclosure (no box in a box) |
| Every triggered signal today (TAKE and skipped) | setups dataframe | **signal cards** below the decision block |
| Per-stock setup states (waiting / no setup / stay out), detail notes, filter details (sector, breadth, ATR used) | setups dataframe | kept as a quiet **"All setups today"** table in an expander directly under the signal cards (the Signal log only stores triggered signals) |
| Setup-rule caption, exit/risk/spread caption ("check T212's live spread before you enter"), "What the research says about these signals" | captions/expander around the setups | small ink-muted captions under the signal cards; the research text in its existing expander there |
| Radar caption (how likely a ±7% day is, not which way) | under the radar heading | stays under the radar heading, same wording |
| Big-day radar | dataframe | same table + ProgressColumn meter, one half-ring for the top ticker |
| Catalysts today / next 3 weeks, overnight read, sector tape, watchlist, per-ticker detail | top and middle | below the divider, in that order, each once |

## 7. Don'ts
No gradient tiles, no glow, no emoji anywhere (including the `📈` title), no emojis as status (replace 🟢/🟡/🔴/⏳/⛔ with words; inline Material icons only outside tables and tiles), no card in a card,
no dual-axis charts, no colour-only meaning, no new data or claims.

## 8. Housekeeping
- Custom CSS is injected once at the top of the script, outside the `@st.fragment(run_every=...)` block, so it is
  not re-sent every 60 s.
- `requirements.txt`: `streamlit>=1.67` (per-mode theme sections and fontFaces need it).
- Font files: Inter, Geist, Newsreader woff2 from Google Fonts (OFL), stored in `static/fonts/`.

## 9. Implementation (12 Nov 2026, after the user's "still looks very AI" feedback)
The look is no longer built on Streamlit widgets. `server.py` (Starlette, already installed with Streamlit) serves a
hand-built page in `web/` (index.html, app.css, app.js, self-hosted fonts) and JSON from `engine.py`, which runs the
unchanged trading logic in setups.py / metrics.py / data.py. Charts are hand-drawn SVG (gauge, sparklines, candles,
before/after bars). Type follows the user's saved reference pages: dark = Inter with optical sizing at weight 600 and
−0.045em tracking (Framer's Inter Display); light = Newsreader serif headlines with Geist Mono uppercase labels
(Motion's serif + mono). Dark canvas is pure #000 as on framer.com. Theme: system by default, a 3-way toggle in the nav.
The Streamlit app.py stays in the repo until the user approves the new UI.

## 10. Liquid glass + motion (12 Nov 2026, user request)
- Surfaces: translucent glass (`backdrop-filter: blur(22px) saturate(170%)`), 1px light edge, inset top highlight,
  a pointer-following sheen on hover, lift on hover. Light glass rgba(255,255,255,.58); dark rgba(24,24,27,.52).
- Behind the glass: three large, soft, slowly drifting colour fields (light: sand / sage / lilac; dark: low-alpha
  blue / green / violet). Low alpha, blurred: atmosphere, not neon.
- Layout: bento of glass blocks. Decision hero card, then one block per fact (filter, catalysts, stay out, also fired),
  a featured radar gauge plus one mini-gauge card per watchlist stock (click to feature it), signal cards, sector
  tiles, overnight cards, watchlist cards with an inline chart panel, calendar cards.
- Motion: first load only (reveal on scroll with stagger, count-up numbers, gauge sweep, sparkline draw, meter grow);
  the 60 s refresh never replays it. Liquid tab pill slides between tabs; page fade on tab switch; status dot pings.
  Everything is off under prefers-reduced-motion.
