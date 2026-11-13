# Full audit, round 1: DRIFTING ("looks buggy")
Fixed before round 2:
1. Breaking box: own full-width row (span-12), max 2 headlines (was squeezed into 1 column and overflowing).
2. Market filter card no longer repeats "Longs blocked" when the hero already says it.
3. Signal cards only for TAKE; other signals in one compact list that still shows LONG/SHORT and the reason
   (owner asked to see short vs long clearly, so the side stays visible).
4. Breaking headlines are not repeated in the News radar list.
5. Data tables: nowrap cells with horizontal scroll (Signal log clipping).
6. Mini gauges: round caps, muted fill for Low (no white square stub).
7. Phone nav: tabs on their own scrollable row with an edge fade under 720px.
8. Watchlist chips in one wrapping row; ambient colour fields static; tab pill without overshoot; no label above the radar feature heading.
Also added (owner request): liquid-glass refraction on the existing glass surfaces (refract.css + SVG filter).
