# Release forecast: labelling releases after 14 November 2026

This adds to [the 14 November pre-registration](release-forecast-2026-11-14.md). It was committed on the same day, before any ledger row after 2026-11-14T00:30Z was looked at. It fixes how releases in the rest of the confirmatory window (to 30 Jan 2027) are labelled, because the interim showed that label calls can flip the result.

- **Source and timing.** Releases come from the production availability ledger, through `releaseEventsFromLedger`, at the detector version current on 14 Nov. Each is timed by our own first sighting, which is decision 1 of the 27 Sep pre-registration.
- **Tiers.** Each release is tiered by the registry rules and `TIER_OVERRIDES` as of commit `651f10d`, plus the two rules in `data/forward/label-decisions-2026-11-14.json`:
  - every Gemini 4 codename tier is flagship;
  - a new top-line Muse family name is flagship, with Muse Glimmer staying minor.
- **Restricted access.** A model available only to approved or verified customers is an announcement, not a release.
- **Ambiguous calls.** These are settled by Jason and committed to a dated `data/forward/label-decisions-<date>.json` before the confirmatory scoring runs. They are made from the release list alone, with no forecast, score or market read in view. Until the confirmatory result is in, no candidate's forecast is shown to whoever labels, and that includes `/backtest`.
- **Completeness.** Each export of the ledger is audited against OpenRouter's model list, the labs' Hugging Face organisations and xAI's release notes. A release found missing is added with its outside source's time and marked as such. The primary result is reported both with and without these additions.
