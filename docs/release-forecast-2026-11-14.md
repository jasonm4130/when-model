# Release forecast: second pre-registration, 14 November 2026

This replaces the evaluation part of [the 27 September pre-registration](release-forecast-2026-09-27.md). That evaluation never started, because the shadow forecast (its build step 3) never shipped. Decisions 1, 2 and 6 to 9 there still stand. Decisions 3 to 5 are replaced below. The push time of this file is its pre-registration time. A later change to a rule here is a new, dated pre-registration, and it cannot rescue a forecast that failed this one. The reasons for each change are in [the methodology review](methodology-review-2026-11-14.md), published with the interim results.

## What was seen before this was frozen

- The forward release list for 27 Sep to 14 Nov, from the production ledger (`data/forward/forward-releases.json`), and the label calls Jason made on it (`data/forward/label-decisions-2026-11-14.json`). These were made with the events visible but no forecast or score joined to them.
- One live snapshot's reads (14 Nov 00:30Z: OpenAI P72 0.037, P7 0.557) and the row counts of the exported tables.
- The burnt 16 Jul to 26 Sep replay results, which are public on `/backtest`.

Nobody has computed any candidate below on any forward day. The forward data is frozen by these SHA-256 hashes:

```
8d8e9009a89d74a57854432853bcd21faa030e26dff717bbb870f015cd179006  data/forward/announcements.json
4fc3e24d71610bd9aeaaef1dfe1142ab953d49fbdb6d57ae41bcebd36f0bd16b  data/forward/availability.json
afa6a6785978fd4924a2cb8fe7ef16daafd89b0d5cbe82eb84528870a43451b5  data/forward/first-seen-kinds.json
0b9b664277301f95b2e52b3343d7876f49a8c56416252f39837f3d4a1e63d0a0  data/forward/forward-releases.json
7788f7f6f43b7d030ac2a0591ab3a44f1d3e7630b85721f851c246a8d5089e5a  data/forward/label-decisions-2026-11-14.json
59d1e7bd3a1c6580d066416e4181faff305eed002fdcbfde7072ca9389f14754  data/forward/labelled-forward.json
5fbf5a308537149d51b74e559caf696fecb23e9a13a7201c18cfe976e4a1071a  data/forward/score-series.json
beb64c8742f5165cb9f8b61f5ca60c712b5343a8158c1ada267ca09ad86ffc3b  data/forward/live-reads.json.gz
5a51beac7d8fdc1dea34b20fb9cd089a489292c54e9350e7822c299261582aa1  data/forward/raw/d1-snapshots-2026-11-14.tar.gz
```

## Target

- **Unit:** a lab-day. The labs are the seven `FRONTIER_LABS` (OpenAI, Anthropic, Google, xAI, DeepSeek, Qwen, Meta). A day is a UTC calendar day D.
- **Outcome:** y = 1 when a flagship release of that lab is first seen in [D 00:00Z, D+1 00:00Z).
  - In training (1 Apr to 26 Sep), the labels are `data/backtest/labelled-releases.json`, timed by OpenRouter `created`.
  - In the forward window, the labels are `forward-releases.json`, timed by our own first sighting, which is decision 1.
- **Decision time:** D 00:00Z. A forecast uses only information available before that moment. Forward market reads come from the `score_series` / snapshot slot `D 00:00Z`.
- **Forecast:** h, the probability that the lab first ships a flagship on day D. Longer horizons are derived from h.

Days that hold no release are counted as lab-days with y = 0. Minor releases are not outcomes, and they do not reset the "days since" clock.

## Features (all as of D 00:00Z)

- **d:** days since the lab's last flagship release, capped at 365. At 1 Apr it is seeded from OpenRouter's full history, tiered by the registry's rules. The pre-April tiers are unreviewed and are used only for this seed.
- **Market hazard h_mkt:** the lab's trusted 72-hour read p72, converted to a daily hazard as `1 − (1 − p72)^(1/3)`. A lab has a market on D when a trusted p72 of at least 0.001 exists.
  - Forward, the read is the live snapshot's `labs[].odds.p72` where `trusted` is true.
  - In training, it is the replay's `trusted` read variant (`labReadsAt` in `scripts/backtest/replay.ts`, settled rungs) at D 00:00Z. Market rows exist only for D ≤ 12 Sep, because the replay censors rungs in the last 14 days before the 26 Sep pull. Lab-days from 13 Sep to the first live v3 snapshot are left out of market-parameter fits.
  - **Declared skew:** replay reads have no bid/ask, so the thin-book gate and the bucket caps can't be replayed, and the training reads come from rungs within 14 days of their deadline. Live reads have all of these. M0 below has no market parameters, so this skew cannot affect it.

## Candidates

All fitted candidates are refit every day on an expanding window: every lab-day before D whose outcome is known, starting 1 Apr. Each is a MAP fit by Newton's method, with a log score clipped to [0.001, 0.999]. The priors are fixed here and are not tuned.

| id     | candidate              | definition                                                                                                                                                                           |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **B0** | baseline: rolling rate | h = (k_lab + m · r_pool) / (n_lab + m) over the trailing 90 days, where m = 90 lab-days, k is the lab's flagship days, n its lab-days, and r_pool the seven labs' pooled 90-day rate |
| **C1** | pooled hazard          | logit h = α + u_lab + β · log(1 + d); u_lab ~ N(0, 1), α ~ N(−4, 2²), β ~ N(0, 1)                                                                                                    |
| **M0** | raw market             | h_mkt where a market exists, else C1 (no market parameters)                                                                                                                          |
| **C2** | recalibrated market    | logit h = a + b · logit h_mkt where a market exists, else C1; a ~ N(0, 1), b ~ N(1, 0.5²)                                                                                            |
| **C3** | blend (primary)        | logit h = α + u_lab + β · log(1 + d) + 1[market] · (η + δ · logit h_mkt); C1's priors plus η ~ N(0, 1), δ ~ N(0, 1)                                                                  |

DROPCON v3 is not a probability. It is reported only as a ranker: the AUC of the daily 00:00Z score against "some frontier lab ships a flagship within 7 days", for descriptive use.

There is no gradient-boosted model, and no LLM forecaster in this round. About 34 flagship events cannot support the first, and the second can't be backtested without leaking information, because no news snapshots were frozen ahead of each forecast. An LLM forecaster can enter only as a forward-only candidate in a later pre-registration.

## Metrics

- **Primary:** the mean, over forward lab-days, of the log-score difference: `ℓ(C3) − ℓ(B0)`, where `ℓ = y·ln h + (1−y)·ln(1−h)`. Its 95% interval comes from a block bootstrap that resamples ISO calendar weeks, all labs together: 10,000 resamples, seed 20261114. Only complete weeks inside the window count as blocks, and partial weeks at either end are kept as their own blocks.
- **Secondary**, with Holm correction across three comparisons: C1, C2 and M0, each against B0 on the same metric.
- **Descriptive:**
  - the 7-day Brier score, using the projection `1 − ∏(1 − h_{D+i})` that assumes no release in between, with d advancing;
  - calibration intercept and slope, each with a bootstrap interval;
  - reliability in at most 5 quantile bins with their event counts;
  - per-lab log-score differences;
  - for each flagship event, every candidate's forecast on its day, as a percentile of that lab's forward forecasts;
  - the v3 AUC.
- **Sensitivity (descriptive):**
  - Gemini 4 Argon and Carbon timed at their limited-access dates (30 Sep and 28 Oct);
  - Gemini 4 Hydrogen excluded;
  - any-tier releases as the outcome.

## Windows and the decision

- **Interim (descriptive):** forward lab-days from 28 Sep to 13 Nov 2026, which is 47 days × 7 labs with 10 flagship events. It is reported in full, and it cannot promote, reject or change anything below.
- **Confirmatory:** lab-days from 28 Sep 2026 to 30 Jan 2027, or until 25 forward flagship events, whichever comes later, under this exact spec. C3 is promoted to the shadow forecast's headline if the lower end of the primary interval is above 0. If not, the result is reported as "no evidence C3 beats the rolling rate", and B0 is what the shadow forecast shows.
- **Data:** the confirmatory run needs the ledger and snapshots through its end date, exported before D1's 90-day pruning reaches them. Snapshots from 23 Sep are pruned from 22 Dec 2026, so they are exported at least monthly.

## Implementation

The fitting and scoring live in `scripts/forecast/`, written after this commit. They import the curve and replay code unchanged and never edit `data/backtest/*.json`. Any departure from this text is listed as a deviation in the results, with its reason.
