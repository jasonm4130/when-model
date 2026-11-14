# Methodology review, 14 November 2026

**The verdict on `/backtest`, that a fitted market forecast does not beat the base rate, can't be trusted: the replay that produced it has defects that bias it against the markets.** The forward window hints that market prices carry information about when the next flagship ships, but the hint rests on three lab-days out of 329, and no primary interval clears zero. The confirmatory test, fixed by [the second pre-registration](release-forecast-2026-11-14.md), runs to 30 January 2027.

## Where things stood

The [27 September pre-registration](release-forecast-2026-09-27.md) planned a shadow forecast scored against v3 on eight weeks of forward data. The shadow forecast never shipped, so the forward clock never started. The availability ledger did ship, and it has run cleanly since 27 September, with a capture every 15 minutes and no missed day. An audit against OpenRouter, Hugging Face, xAI's release notes and the web found no missed release in the ledger.

The ledger records 15 frontier-lab releases from 27 Sep to 14 Nov. Ten are flagship once Jason's label calls are applied (`data/forward/label-decisions-2026-11-14.json`): Gemini 4's codename tiers and new Muse family names count as flagship.

D1 deletes snapshots after 90 days, and these snapshots are the only record of what the site read from the markets at each moment. All 4,984 of them are now committed (`data/forward/raw/`, with the compact series in `live-reads.json.gz`).

## Defects in the replay

Each of these was checked against the code; the two score figures marked below come from a scratch replay that was not rerun here. Taken together, they mean the 16 Jul–26 Sep "test" result should not be read as evidence either way about the markets.

1. **Day-bucket prices stood in for best bids.** `marketsAt` sets a bucket's best bid to its traded price (`scripts/backtest/replay.ts`, the `bestBid: yes` line). The live reader sums best bids precisely because summed midpoints reached 1.02–2.64 on the Grok ladder (`src/domain/market.ts`, `curveFor`).
   - In mid-September this pushed xAI's 72-hour read to about 1.0, against 0.3–0.6 without the buckets.
   - That fills most of the 0.9–1.0 reliability bin, and it likely explains xAI's −0.71 skill. So "xAI's markets are mispriced" is probably a replay artifact.
   - The `trusted` and `no-buckets` variants score about +0.19, not −0.002. This figure is from the critique's scratch replay and was not rerun here.
2. **Censored reads sat inside the test.** Rungs that hadn't resolved by the pull were never fetched, so the last 14 days of reads are too low. The replay's own limitations list says so. Stopping the test before that stretch also scores about +0.19 (also from the scratch replay).
3. **The pass/fail gate could not pass.** `sanity()` requires the mean forecast within 0.05 of the observed rate, during a stretch when the base rate itself moved from 0.39 to 0.63. The base rate fails that check at every horizon. Bins of 100+ hours hold 1–4 events each.
4. **The target was not what the markets price.** It was "any frontier listing within 72 h". 15 of the 25 test events were minor releases, mostly from unpriced labs (Qwen, DeepSeek, Meta), while markets price named flagships. At 7 days the base rate is 0.94, so that horizon is nearly uninformative.
5. **Hourly rows overlap.** One release sets y = 1 for 72 consecutive hours. The bootstrap used week blocks wrapped circularly, holding the fit fixed. The effective sample is the number of events, not the number of hours.
6. **Choices were made after seeing the test.** The reported formula was picked on test skill, from 5 formulas × 3 horizons × 5 variants × 4 folds, plus two 28-agent signal sweeps. That window is spent.
7. **Label timing.** OpenRouter's `created` ranges from 23 hours before to 26 hours after the announcement. The 2-hour grouping merged Gemini 3.5 Flash-Lite with 3.6 Flash. Muse Spark 1.0 is missing because it never listed on OpenRouter.

Not a defect, but a choice to revisit: the curve reader interpolates between rungs at constant hazard (`src/domain/market.ts`, `readPoints`), and holds a floor across gaps of more than 14 days. Constant hazard is the more aggressive rule. For a 1% rung followed by a 96% rung 15 days later, a read 6 days in gives 0.73 under constant hazard and 0.39 under linear interpolation. Most reads interpolate across a wide gap: 65% of 7-day reads cross more than 3 days. In the critique's scratch replay, linear scored slightly better in every window (7-day flagship Brier 0.085 against 0.090), and refusing to interpolate scored clearly worse. The effect is small and does not explain the old 7-day result.

## What changed

The second pre-registration (`651f10d`, pushed at 10:49 AEST) sets the rules below. The scoring code was written after that push, in the same Claude Code session (session link in the commits). The repo alone cannot prove that no forward score was seen before the freeze; the session transcript can.

- **Target:** whether a lab first ships a flagship on a given UTC day. Each lab-day is one row, so rows do not overlap.
- **Candidates:**
  - B0, a rolling 90-day rate per lab, pulled toward the all-lab rate;
  - C1, a pooled hazard on days since the lab's last flagship;
  - M0, the raw market read;
  - C2, a recalibrated market read;
  - C3, a blend of C1 and the market, which is the primary candidate.
- **Fitting:** every fitted candidate is refit each day on all earlier days. Priors are fixed and not tuned.
- **Primary metric:** the mean log-score gain over B0, with a bootstrap over calendar weeks.
- **Status of the windows:** the 28 Sep–13 Nov window is interim and descriptive only. The confirmatory window runs to 30 Jan 2027, or until 25 forward flagships, whichever is later.

## Interim results: descriptive, cannot decide anything

`pnpm exec tsx scripts/forecast/interim.ts` writes `data/forward/interim-2026-11-14.json`. It covers 329 lab-days (47 days × 7 labs) with 10 flagship days and 7 week-blocks. Training was 1,246 lab-days with 24 flagships.

Mean log-score gain per lab-day over B0, with 95% week-bootstrap intervals:

| Candidate              | Gain over B0 | 95% interval     | Holm p |
| ---------------------- | ------------ | ---------------- | ------ |
| **C3 blend (primary)** | +0.009       | −0.007 to +0.023 | —      |
| C2 recalibrated market | +0.019       | +0.002 to +0.038 | 0.13   |
| M0 raw market          | +0.021       | −0.006 to +0.051 | 0.17   |
| C1 hazard, no market   | −0.007       | −0.015 to −0.000 | 0.17   |

7-day Brier: B0 0.125, C1 0.127, M0 0.128, C2 0.121, C3 0.125.

Calibration slope, with 95% week-bootstrap intervals: M0 0.87 (0.42 to 1.65), C2 0.84 (0.44 to 1.49), C3 0.75 (0.31 to 1.35), B0 0.23 (−0.90 to 4.50), C1 −0.29 (−0.90 to 1.04). The market candidates separate event days from quiet ones; the two models without a market cannot be told apart from noise. The intercepts all span zero.

As a ranker, DROPCON v3 scored an AUC of 0.59 for "some frontier flagship within 7 days" over 41 days.

What the run suggests, all of it subject to that small sample:

- **The market gain comes from three days.** On the days of Sonnet 5.5, Gemini 4 Argon and Gemini 4 Carbon, the raw market read was in that lab's top 2–4% of days. B0 put the same days at its 49th, 11th and 89th percentiles. Those three lab-days give C3 +6.2 log units over B0. The whole window nets +3.0, so the other 326 lab-days cost it 3.2.
- **New family names slip past the markets.** Muse Ember had no market of its own: Meta's read came from the "Next Muse Spark (1.4+)" ladder at 0.003, the worst single score in the run. Gemini 4 Hydrogen did have a market ("Gemini Hydrogen"), which priced 2.6% at 72 hours and 52% at 7 days on the day it listed. So that one was a timing miss, not a missing market.
- **Days since the last flagship adds nothing.** C1 is a little worse than the rolling rate. Its fitted coefficient on log(1 + d) is positive (+0.24 to +0.42 across refits): the longer since the last flagship, the higher the hazard, but too weakly to beat a rolling rate.
- **The blend under-uses the market.** On event days C3 sits well below C2, though both train on the same 465 replay market rows (censored reads are excluded from both). C2's fitted slope is about 1.17; C3's market weight δ is about 0.91. The likely cause is C3's zero-centred priors on η and δ: η fits at +2.5, two and a half prior sds from its mean. This is suspected, not tested; no refit with wider priors was run.
- **The result depends on two label calls.** With Argon and Carbon timed at their limited-access dates (30 Sep and 28 Oct), every market candidate's gain falls to about zero. With Hydrogen left out, C3's interval clears zero (+0.016, +0.006 to +0.028). Any-tier scoring also favours C3 (+0.019). Markets price public availability, so the release definition and the market's resolution rule need to match.

## Next steps

1. **Ship the shadow forecast.** This is the 27 Sep plan's step 3, now built from `scripts/forecast/models.ts`: compute B0, C2 and C3 at every 00:00Z capture, store them in D1, and show them only on `/backtest`. That makes the confirmatory window real-time rather than a reconstruction.
2. **Export the ledger and snapshots at least monthly** until 30 Jan, before D1's 90-day pruning. The next deadline is 22 December.
3. **Collect bid/ask history going forward.** The live snapshots should keep each rung's bid and ask, so a future refit trains on the same kind of read it serves. It is a change to the snapshot schema (`MAX_SNAPSHOT_BYTES` limits it).
4. **Next pre-registration: interpolation and priors.** Fix linear interpolation between rungs as a rule, chosen on reasoning rather than tuned. Give the market recalibration one pooled term for bracket width (logit p′ = a + b·logit p + c·log(1 + gap days)). Centre the blend's market weight on the recalibration's evidence rather than on zero.
5. **Mark when a lab's new family name has no market.** Wherever a flagship can be a new family name, the per-lab read should say so rather than read the old family's ladder as the lab's odds.
6. **Leave `/backtest` and its JSON alone** until the confirmatory result. Then replace its verdict with this pre-registration's result, rather than re-running the burnt window with the fixes above.

## Deviations from the pre-registration

All of these were made before any result was seen, while writing the script.

- Training lab-days end on 25 Sep, the last complete day before the 26 Sep 00:46Z pull. The text said 26 Sep. 26 and 27 Sep are in neither training nor the forward window, because neither label source covers them in full. No release announcement was found in that gap.
- h_mkt is clipped to [1e-4, 1 − 1e-4] before its logit. The text did not say.
- The Holm p-values use a normal approximation to each comparison's week-bootstrap interval. The text did not name a method.
- The 7-day projection holds day D's market read fixed while d advances.
- The limited-access sensitivity uses 12:00Z on the stated dates, which are only known to the day.
- In the any-tier sensitivity, "days since" at 1 Apr is seeded from flagships only.
- Forward market reads come from the 00:00Z slot, observed 28–78 s after midnight. The earliest forward release on any day came at 01:15Z.
- The calibration intervals were missing from the first commit of the results and were added after the Fable review. Their 2,000 resamples drop the few draws with no events (6 of them).
- The live market read is used only when the snapshot's state is `ok`. All 47 midnight slots were `ok`, so this filter had no effect.
