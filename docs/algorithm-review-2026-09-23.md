# DROPCON review — 23 September 2026

DROPCON currently measures a mixture of release expectations and completed release activity. We cannot establish its pre-launch hit rate for this week's releases: the repository and Worker configuration retained no historical readings. Today's saved dashboard proves detection after launch, not advance warning.

## Observed release coverage

The live dashboard generated at 2026-09-23T00:18:20.813Z showed level 1, score 76, and all nine configured sources healthy. The later full response in [the evidence archive](evidence/2026-09-23/) preserves a separately timestamped observation; these are not pre-launch snapshots.

| Lab       | Recent release   | OpenRouter listing timestamp (UTC) | Evidence available today                                                       | Pre-launch performance |
| --------- | ---------------- | ---------------------------------- | ------------------------------------------------------------------------------ | ---------------------- |
| xAI       | Grok 4.7         | September 21, 16:19:01             | OpenRouter listing; HN story dated September 21, 15:50:15                      | Unobserved             |
| Anthropic | Claude Opus 5.5  | September 22, 16:32:12             | OpenRouter listing; HN stories; SDK release dated 16:25:23                     | Unobserved             |
| OpenAI    | GPT-6 Sol / Luna | September 22, 18:12:55–18:13:11    | Four OpenRouter listings; official RSS dated 18:00; SDK release dated 18:25:48 | Unobserved             |

These timestamps come from source metadata present in the current dashboard. They are neither our first-observed times nor, for OpenRouter, necessarily official launch times. Current HN scores cannot be projected backwards to story publication. Anthropic's healthy newsroom source did not contain the new Opus announcement in this observation, despite the listing and other sources detecting it.

The new xAI adapter reads [official developer release notes](https://docs.x.ai/developers/release-notes), which are directly fetchable; the newsroom and its linked API changelog were blocked. This adds launch detection, not a proven advance-warning signal.

Official announcement references: [Grok 4.7](https://x.ai/news/grok-4-7), [Claude Opus 5.5](https://www.anthropic.com/claude-opus-5-5), [GPT-6 Sol and Luna](https://openai.com/index/introducing-gpt-6-sol-and-luna/). The xAI announcement is dated September 21; a date without a time must not become a fabricated precise launch timestamp for lead-time evaluation.

## Scoring defects and interpretation

1. **Negative odds counted positively.** Google's “released on” market had a 91.5% “No release by September 30” outcome. The existing reader selected it as 30-day release odds. The dashboard rounded that to a 92% positive driver. A regression test reproduced the defect before the fix.
2. **Date buckets treated as cumulative probabilities.** “On September 24” and “during a particular week” are not “by September 24.” The fix conservatively uses only cumulative `released by` markets and excludes negative and placeholder outcomes. Date-bucket markets remain visible but do not drive release odds until their semantics can be modeled correctly.
3. **Post-release activity presented as imminence.** Seven recent frontier listings, eight hot HN stories and eight release-shaped headlines contributed the maximum 46 non-market points. Together with 26% week odds and 91.5% month odds, that produced 76. Old copy said “DROP IMMINENT” after the models had already shipped.
4. **Window inconsistencies.** The month reader used 31 days despite displaying 30. HN age filtering depended solely on the adapter rather than the deterministic assembly clock. Both are corrected.

The weights and numeric level thresholds remain unchanged. Algorithm version 2 records exact score inputs and changes the top label to “RELEASE SURGE.” A listing within 48 hours produces “MODELS JUST LANDED”; older listings explain their seven-day contribution. Low activity no longer asserts that labs are not shipping. These are interpretation and correctness changes, not evidence of improved predictive accuracy.

The score is not a probability. Its maxima can come from different labs and different named models. An OpenAI-wide heat score cannot establish that a specific GPT variant was predicted. Missing release markets are missing coverage, not a zero-probability forecast.

## Signals worth adding

| Priority | Signal                                                 | Role                                                        | Limitation                                                                                                                                                                 |
| -------- | ------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First    | xAI official release notes / newsroom                  | Confirm announced Grok releases independently of OpenRouter | The newsroom blocks direct fetches; the official developer release notes are fetchable and now have a tested adapter. Dates are day precision, represented as UTC midnight |
| Next     | First-seen changes in official public model catalogs   | Confirm availability and measure listing lag                | Product entitlements, aliases, provider rollout and catalog edits are not all new model launches; authenticated xAI catalogs are account-specific                          |
| Next     | Official API changelogs across labs                    | Cover API launches missing from curated newsroom pages      | Date precision varies; updates can describe product features rather than new models                                                                                        |
| Evaluate | SDK model-ID additions and anonymous evaluation models | Possible advance signals                                    | Existing SDK watch reads only two releases per repository; old IDs and compatibility updates generate false positives; anonymous models have uncertain attribution         |
| Lower    | Social announcements / rumors                          | Potential lead time                                         | No working free ingestion is configured; do not infer missing pre-launch evidence from today's posts                                                                       |

[GitHub's Grok 4.7 availability announcement](https://github.blog/changelog/2026-09-21-grok-4-7-is-now-available-in-github-copilot/) is another first-party availability source, but partner rollout is not the model's original launch. Deduplication across HN, official news and SDK mentions, and grouping OpenRouter variants into release events, should precede weight calibration. Current title-only release flags also catch policy and customer announcements.

## Measurement requirements

Record observation time separately from source timestamps, algorithm/schema versions, global score inputs and output, each lab's heat/status and named market odds, source health, and listing IDs. Preserve the full response when possible. The response caps markets, feed items and listings, so it is not a complete upstream archive and cannot replay every hypothetical future algorithm.

For each independently sourced release event, compare only observations collected strictly before the release. Report the latest observation within 24-hour, 72-hour and seven-day lead-up windows, its actual lead time, and coverage gaps. These are windows, not exact T-minus readings. Report first observed post-release detection separately. No observations means unobserved, not a miss; a gap limits the precision of detection latency.

After sufficient prospective history, measure per-lab warning precision, recall, false-alarm duration, and lead time using fixed thresholds and explicit release-event definitions. Do not optimize against three retrospectively selected launches. Treat market calibration separately: DROPCON and lab heat are not calibrated probability forecasts.

## Storage choice

Workers Analytics Engine fits aggregate trends, but [sampling](https://developers.cloudflare.com/analytics/analytics-engine/sampling/) cannot guarantee individual records or exact event sequences, and [retention](https://developers.cloudflare.com/analytics/analytics-engine/limits/) is three months. D1 is the recommended source of truth for exact snapshots collected independently of visitor traffic.

At 15-minute intervals, a 30-day month has 2,880 captures. Today's approximately 119 KB response implies about 344 MB/month, or 1.03 GB for 90 days, before database overhead. D1's included quotas cover this workload assuming other account usage leaves capacity; Analytics Engine would also be within its published allowances at 31,680 points/month (overall plus ten labs). Expected incremental storage/analytics cost is $0, not a verified account bill. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [Analytics Engine pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/).

D1 Free limits each database to 500 MB, so the 90-day full-response design assumes Workers Paid. A free deployment can retain compact metrics and a shorter full-response window. Workers Paid has a $5/month account minimum; this is not an extra per-database charge. Account plan and remaining shared allowances have not been verified. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) · [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## Selected D1 implementation and budget

The user selected D1 on the existing Workers Paid account. Live checks on September 23 found six existing databases using 14,929,920 bytes; analytics for August 24–September 23 reported 1,285,602 rows read and 21,214 written. That is a recent usage window, not a verified billing-cycle statement. The new `whenmodel-history` database was created afterward; production capture still requires migration and deployment.

The implementation captures compact, exact observations rather than the full 119 KB dashboard: original score inputs/output, per-lab heat/status and named market odds, latest listings, the returned listing IDs/times, and source health. The existing response measured 11,636 bytes after projection, before the new measurement fields. At that size, 90 days is about 100.5 MB of JSON. Fixed limits are 32 KiB per payload, 8,640 records, 128 MiB total JSON payload and up to 90 days of retention. SQLite pages and indexes consume additional space. There is no public history query endpoint or visitor-triggered capture.

One scheduled call every 15 minutes yields 2,880 captures per 30-day month. Each uses a small indexed set of D1 reads/writes; expiration work is limited to 96 records per invocation. SQL enforces capacity and immutable slot keys, so concurrent retries cannot bypass the storage budget. Hitting capacity fails visibly instead of overwriting recent evidence. Expected incremental D1 cost is $0 given the verified account headroom. These are application limits, not a Cloudflare account billing cap: unrelated databases and workloads share the account allowances.

## Local runtime evidence

The built Worker fetched the official xAI release notes successfully and returned Grok 4.7 as an alert. At 2026-09-23T00:38:17.946Z, the local live-input dashboard reported level 2, score 74, “MODELS JUST LANDED,” with week odds 0.26 and month odds 0.835. This is a fresh reading, not a replay of the earlier production observation.

A local scheduled run stored one D1 row with slot 00:30 UTC, dashboard generation 00:38:39.360 UTC, actual observation 00:38:40.109 UTC, algorithm version 2 and score 74. Its compact payload was 11,632 bytes. Repeating the scheduled call in the same slot preserved one row. Export and checksum-verified archive readback preserved the observation timestamp and score. Independent SQLite checks verified duplicate keys, insert/delete counter maintenance and both capacity guards. These checks prove local behavior; they do not claim production collection is active.

Final automated validation passed: `pnpm validate` (127 tests, typecheck, coverage thresholds and build) and `pnpm test:e2e` (four desktop/mobile/keyboard/reduced-motion checks). Statement coverage was 97.42%; branch coverage was 91.17%. A test-only Wrangler configuration keeps the production scheduled entrypoint from preloading modules before V8 coverage starts; thresholds and source inclusion remain unchanged.
