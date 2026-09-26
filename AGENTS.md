<!-- codex-baseline:1 -->

# whenmodel

Astro 7 SSR on Cloudflare Workers, layered so the interesting code has no I/O:

- `src/domain` — pure types and rules: lab registry, market curves and trusted reads, drop/feed
  models, DROPCON v3 scoring, the forecast, lab heat, early warnings, landed, the first-seen
  ledger's read side, and `assembleDashboard(inputs, now)`. No fetch, no `Date.now()`, fully
  unit-tested. `lead.ts` holds only pure rules; its fetchers live in the adapters.
- `src/adapters` — one module per upstream (Polymarket, OpenRouter, Hugging Face, Hacker News with
  its week-long launch search and its leak search, TestingCatalog, lab YouTube feeds, the `transformers` registry, RSS, Anthropic
  newsroom, xAI release notes, GitHub releases). Each exposes a pure `toX(dto)` mapper and a
  `fetchX()` that goes through the edge cache.
- `src/infra` — `edge-cache.ts` (Workers Cache API wrapper), `source-result.ts` (`collect`:
  timeout + degrade-to-fallback + timing), `snapshot-store.ts` (D1 snapshots, `score_series`,
  `first_seen`), `bindings.ts` (`HISTORY_DB`), `text.ts` (safe parsing helpers).
- `src/app/load-dashboard.ts` — fans out to every source, logs per-source timings, and memoises
  the assembled dashboard. It also owns the 30-day history read (`loadHistory`, one edge memo
  shared by `/api/history.json` and the page's DROPCON instrument; `loadHistoryForPage` adds the
  page's 2 s timeout and a 60 s skip after a failure). `src/app/capture-history.ts` is the 15-minute cron (`src/worker.ts`):
  snapshot, score rollup and first-seen writes.
- `src/domain/instrument.ts` draws the hero: `buildInstrument` turns the history, the live level
  and LANDED's launches into the 7-day trace, zones, level-change flags and scrubber data
  `DropconScope.astro` renders. It draws the last 7 days but reads the record's start, the current
  version's first hour and the last reading from the whole 30-day series it is given, so never
  filter the input to the window first. Only the current algorithm version is inked on the level
  axis; an older one is a hatched zone. Level names live in `src/domain/levels.ts`. `src/ui/readout.ts`
  (the scrubber's readout text) and `src/ui/labels.ts` (whole-or-nothing label placement) are pure
  and run both in the server render and in the component's browser script. The readout never
  gives a past hour the live reading, and scrubbing never changes the big number.
- `src/ui` + `src/components` — formatting and Astro markup (`src/ui/signals.ts` builds the
  early-warning track lines and per-lab lead flags; `src/ui/panels.ts` builds every panel's
  source pill). Browser code is limited to the clock, refresh countdown, relative timestamps,
  source pills aging to STALE, ticker behavior, the 5-minute poll-and-offer reload, and the hero's
  scrubber and label fitting (progressive enhancement: the server render reads NOW without it).

Rules of the house:

- Run the real Worker locally with `pnpm build && pnpm exec wrangler dev`; `pnpm dev` is fine
  for markup but the Cache API code paths only execute under wrangler.
- Every upstream call goes through `cachedText`/`cachedJson` (or `cachedTextOrStale`, which
  keeps a last good copy under its own cache key). Buffer bodies; never stream a
  `Response.clone()` into the cache (it truncated in production).
- A source must degrade to empty data, never throw out of `buildDashboard`. Name it once in
  `src/domain/sources.ts` and wrap it in `collect()`; the health list is derived from the results
  automatically. The first-seen ledger records a source's sightings only when its result is `ok`,
  so a partial poll must report not ok. A YouTube channel read from its last good copy (at most
  a day old) counts as complete; one with neither a fresh feed nor that copy does not. YouTube is
  in `BEST_EFFORT_SOURCES`: the health list shows its outages, the header status ignores them.
- DROPCON scores Polymarket odds only. A new signal goes into early warnings with a track record
  until `pnpm backtest:replay` shows it adds out-of-sample skill. Any scoring change bumps
  `DROPCON_ALGORITHM_VERSION`: history breaks its series at a version change and the repricing
  term reads only same-version rows.
- What the markets, drops and feed panels show comes from `src/ui/panels.ts`, and the refresh fingerprint
  (`src/ui/fingerprint.ts`) reads the same selections. A panel that starts printing a new field adds it to
  `visibleContent` at its displayed precision; never hash raw floats or anything that moves with the clock,
  or every poll offers NEW DATA. A panel's status pill comes from `sourcePill`, never a literal "LIVE".
- A number on `/backtest` comes from `data/backtest/*.json` or a domain constant, never typed
  into markup, and `test/ui/backtest.test.ts` pins it against that source. Regenerate the JSON
  only through `pnpm backtest` or `pnpm backtest:replay`.
- Changing the `Dashboard` shape? Bump `DASHBOARD_SCHEMA`. The memoised dashboard outlives a
  deploy by up to its TTL and a new render reading an old shape streams a blank page. The
  compact D1 snapshot must stay under 32 KiB (`MAX_SNAPSHOT_BYTES`); the worst-case test in
  `test/infra/snapshot-store.test.ts` enforces it, so clip new strings and lists there.
- D1 migrations in `migrations/` apply to the remote `whenmodel-history` before the code that
  needs them merges (command under the README's Point-in-time review). Never edit a migration that has run
  remotely.
- Shared CSS (tokens, panels, metrics, rows, motion) lives in `src/styles/global.css`;
  component `<style>` blocks hold presentation specific to that component. Every animation is
  gated by `prefers-reduced-motion`.
- Cloudflare Builds deploys `main` after `pnpm validate`; GitHub requires `check` and `browser`
  before merging. Manual deploy is `op run --env-file .env.op -- pnpm deploy`. Custom domains are attached at the
  account level; do not add `routes` to `wrangler.jsonc` (see README). Keep `workers_dev: false`
  and an explicit `preview_urls`: the scoped deploy token cannot read the account's workers.dev
  subdomain, so enabling workers.dev breaks `wrangler deploy`.
- Tests: `pnpm test --coverage` (vitest, `test/` mirrors `src/`; components render through
  `experimental_AstroContainer`). Coverage thresholds live in `vitest.config.ts` and are enforced
  by the coverage invocation.
  Lint and format: `pnpm lint` (oxlint + oxfmt --check), `pnpm format` (oxfmt).
  Before delivery, run `pnpm validate` (lint, types, coverage and build).
  For UI changes, run `pnpm test:e2e` against the built Worker for desktop, narrow mobile,
  keyboard controls and reduced motion. Install Chromium first with `pnpm exec playwright install chromium`. Set `E2E_PORT` when another
  checkout's Worker already holds 8787; locally Playwright reuses whatever server answers on the port.
  Restart a running `wrangler dev` after `pnpm build`: its reload can keep serving the old server
  bundle (seen as HTML linking an `/_astro/*.css` that 404s), and the tests then pass or fail on old code.
  A browser test for a state today's data may not show (a failed source, an extrapolated read, a
  long launch label on the instrument) writes that state into the page with the component's `data-astro-cid-*`
  attribute, as `test/browser/robustness.spec.ts` does, so it does not depend on the day's data.
- Month names come from `src/domain/dates.ts` ("SEP", never ICU's en-GB "Sept"); do not format
  months with `toLocaleDateString`.
