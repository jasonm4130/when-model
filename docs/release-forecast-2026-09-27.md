# Release forecast: decisions and pre-registration, 27 September 2026

whenmodel should predict frontier model releases accurately. Beating Polymarket where a market exists is the floor, not the goal: 16 of the 25 releases in the v3 replay's test window had no market at all (Qwen 7, DeepSeek 4, Meta 4, small Google models), and DROPCON v3, which scores Polymarket odds only, can at best re-read the market.

This document records the decisions from the 27 September design review and fixes the evaluation rules before any forward data is collected. Its push time is the pre-registration time. A later change to a rule below is a new pre-registration, dated by its own commit, and does not rescue a forecast that failed the old one.

## Decisions

1. **A release is first public availability.** A model is released the first moment someone outside the lab can use it: through an API, an app, or a limited or paid preview. The time is our own first-seen time from polling, never a source's self-reported date (see `data/backtest/timestamp-traps.json`). An announcement without access is a leading signal, shown as "announced, not yet usable", not a release.
2. **Releases are tiered.** Each release is a flagship or a minor release, by a per-lab rule in the lab registry plus a manual override list. The rules are applied to the 45 releases of April to September 2026 and reviewed before they are used.
3. **DROPCON becomes a flagship forecast.** The headline is the probability that some frontier lab makes a flagship usable within 72 hours, shown as a level whose bands are set on the labelled history. A per-lab board shows 72-hour, 7-day and 30-day odds for flagship and minor releases, and names the next model where a market, leak or announcement names it.
4. **The new forecast runs in shadow first.** It is computed every 15 minutes next to v3, stored in D1 (one row per slot, every lab's odds in it) and shown only on `/backtest`. It replaces v3 on the hero in a single `DROPCON_ALGORITHM_VERSION` bump, at promotion.
5. **Promotion bar.** The shadow forecast is promoted when it beats v3 on the backtest and on at least eight weeks of forward data, compared on the same hours (paired), with a 95% cluster-bootstrap interval clear of zero and the replay's reliability check passing. The pre-registered judgement below keeps running after promotion and can reverse it.
6. **Keyless sources only.** OpenRouter (including stealth models), the chat.qwen.ai model list, lab feeds (adding Qwen, DeepSeek and Meta's newsroom), a watch on the public meta.ai page, Hacker News, Hugging Face organisation listings, and Polymarket odds and market creation. No lab API keys.
7. **X gets one capped backfill.** A keyword-filtered full-archive search over about ten teaser and leak accounts for April to September 2026, paid from $25 of prepaid pay-per-use credit with auto-recharge off, and stopped by a read counter at 4,500 posts. Live polling starts only if the backfill shows posts leading releases on their own timestamps.
8. **v3's flicker is fixed in the display, not the score.** The history chart plots each hour's median capture instead of its last one; the level hysteresis stays. The thin-market rule that causes the flicker is revisited in the shadow forecast, not in v3.
9. **The `transformers` track states its recency.** Its seven leads all date from March 2025 to February 2026; every dated case since then coincided or lagged.

## Evidence behind the decisions

From the 27 September signal sweep (two independent runs, 28 agents each):

- Polymarket leads where markets exist: 72-hour Brier skill against the base rate is +0.48 for Anthropic and +0.31 for OpenAI, but −0.71 for xAI, whose markets are mispriced rather than missing.
- Short-window price moves and volume add nothing beyond the odds level.
- A per-lab forecast built from the non-market signals with history (architecture merges, streams, keynote windows, leaks, stealth models) did not beat the base rate for the unpriced labs. Its apparent gains were a level effect: the unpriced 72-hour release rate rose from 0.131 in training to 0.514 in test.
- Qwen is the one unpriced lab with leading sources: Qwen's own announcements came 6 to 157 hours before the OpenRouter listing (5 cases, HN item times), and the chat.qwen.ai model list showed models 128 and 363 hours ahead (2 cases, Wayback captures on both sides). Nothing tested leads for DeepSeek, Meta, the small Google models or xAI.
- A new near-dated Polymarket market appeared 19 to 43 hours before release in 2 cases.
- With 25 test releases, absolute skill intervals are about ±0.4 wide; paired comparisons on the same hours are about ±0.01 to ±0.03. Evaluation is therefore paired.
- One finding is post-hoc and must not choose the method: market reads of 0.9 or more covered 252 test hours, of which 46.4% saw a release within 72 hours, and a cap at 0.6 would have scored +0.133. Any calibration of market reads is fitted on the training window (1 April to 16 July 2026) only.

## Pre-registered evaluation

- **Events.** Flagship and minor availability events under the rules and overrides as committed before the forward window starts. Relabelling after the fact requires a new pre-registration.
- **Forecasts compared.** The shadow forecast against v3's headline probability and, for each lab with a market, against the market-only read.
- **Metrics,** per lab and pooled:
  - paired Brier score at 72 hours (the headline), 7 days and 30 days, with 95% cluster-bootstrap intervals;
  - reliability, by the replay's worst-bin check;
  - lead time: for each release, how long before it the 72-hour flagship forecast first reached 0.5;
  - alert precision and recall at that threshold: false alarms per month, and the share of releases flagged ahead;
  - identification: the share of flagged releases whose model family was named correctly.
- **Signals.** A new signal enters the forecast only after it passes on forward data collected after it went live; until then it is an early warning with a track record, as today.
- **Dates.** The forward window starts when the shadow ledger ships. Promotion is reviewed after eight weeks. The pooled judgement is due on 31 January 2027 or after 40 forward releases, whichever is later; Qwen alone around April 2027; DeepSeek and Meta around September 2027.

## Build order

1. **Display and copy fixes** (small): hourly median on the history chart; the `transformers` track's recency; this document.
2. **Availability ledger** (medium): keyless pollers, the release-event detector, the flagship rule and the labelled history. It also produces the "announced, not yet usable" warning for every lab.
3. **Shadow forecast** (medium): per-lab and tiered, calibrated market reads plus per-lab base rates, the D1 ledger and a `/backtest` panel.
4. **New-market warning** (small): flag a new near-dated Polymarket market.
5. **X backfill** (medium, $25 cap): run once on Jason's account, then decide on live polling.
6. **Small-model benchmark** (deferred until prepaid credits are confirmed): classification of posts, model-family normalisation and codename-to-lab mapping, scored on titles collected after the current regex cues were frozen.
