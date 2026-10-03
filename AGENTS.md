<!-- codex-baseline:1 -->

# whenmodel

Astro 7 SSR on Cloudflare Workers, layered so the interesting code has no I/O:

- `src/domain` — pure types and rules: lab registry, market curves and trusted reads, drop/feed
  models, DROPCON v3 scoring, the forecast, lab heat, early warnings, landed, the first-seen
  ledger's read side, the availability ledger (`model-id.ts` canonicalises a model id across
  sources, `availability.ts` turns sightings into ledger rows and release events, and the lab
  registry holds the tier rules and `TIER_OVERRIDES`), and `assembleDashboard(inputs, now)`. No fetch, no `Date.now()`, fully
  unit-tested. `lead.ts` holds only pure rules; its fetchers live in the adapters.
- `src/adapters` — one module per upstream (Polymarket, OpenRouter, Hugging Face, Hacker News with
  its week-long launch search and its leak search, TestingCatalog, lab YouTube feeds, the `transformers` registry, RSS, Anthropic
  newsroom, xAI release notes, GitHub releases, and the cron-only chat.qwen.ai model list, Hugging
  Face org listings, Meta newsroom and DeepSeek news in `qwen-chat.ts`, `huggingface.ts` and
  `lab-feeds.ts`). Each exposes a pure `toX(dto)` mapper and a
  `fetchX()` that goes through the edge cache.
- `src/infra` — `edge-cache.ts` (Workers Cache API wrapper), `source-result.ts` (`collect`:
  timeout + degrade-to-fallback + timing), `snapshot-store.ts` (D1 snapshots, `score_series`,
  `first_seen`, and the release ledger's `availability` and `announcements`), `bindings.ts` (`HISTORY_DB`), `text.ts` (safe parsing helpers).
- `src/app/load-dashboard.ts` — fans out to every source, logs per-source timings, and memoises
  the assembled dashboard. It also owns the 30-day history read (`loadHistory`, one edge memo
  shared by `/api/history.json` and the page's DROPCON instrument; `loadHistoryForPage` adds the
  page's 2 s timeout and a 60 s skip after a failure; the body's type, `HistoryResponseBody`, lives in
  `src/domain/history.ts`). `src/app/capture-history.ts` is the 15-minute cron (`src/worker.ts`):
  snapshot, score rollup and first-seen writes, then `src/app/capture-availability.ts`, the
  availability ledger, from the build's own source results (`buildCapture`) plus the cron-only
  sources. A page render never polls those: `test/app/load-dashboard.test.ts` pins its fetch count.
- `src/domain/instrument.ts` draws "Service history · last 7 days" on /about, under how the score
  adds up (the home page keeps one bold moment, the departure sign): `buildInstrument` turns the history, the live level
  and LANDED's launches into the 7-day trace, zones, level-change flags and scrubber data
  `DropconScope.astro` renders (`scopeView` in `src/ui/scope.ts` works out everything it draws). It draws the last 7 days but reads the record's start, the current
  version's first hour and the last reading from the whole 30-day series it is given, so never
  filter the input to the window first. Only the current algorithm version is inked on the level
  axis; an older one is a hatched zone. Level names live in `src/domain/levels.ts`. `src/ui/readout.ts`
  (the scrubber's readout text) and `src/ui/labels.ts` (whole-or-nothing label placement) are pure
  and run both in the server render and in the component's browser script. The readout never
  gives a past hour the live reading, and scrubbing never changes the posted level.
- Pages: `/` (the service status, the next departure, the departure board and arrivals), `/labs`, `/labs/[id]` (one per registry lab; an unknown id
  renders the 404 with a 404 status and no fetch), `/markets`, `/radar`, `/about` (the arithmetic, then
  the week's chart, drawn only when the week has a reading, else one quiet line), `/backtest`. Every
  page reads the one memoised `loadDashboard()`; only `/about` calls `loadHistoryForPage`, and
  `test/app/load-dashboard.test.ts` renders each page and pins its fetch count. `src/ui/site.ts` holds
  the tab strip (`NAV`), page titles (`pageMeta`) and the old single-page anchors `/` redirects
  (`LEGACY_HASHES`); `src/ui/lab-page.ts` is a lab page's pure selection (`labPage`).
- The visual design is a transit network (see the README's Design section). Its rules are pure and
  tested: `src/ui/departures.ts` (next departure, boarding window, timetable state, strip map, read
  sentences), `src/ui/service-status.ts` (each level's phrase and treatment), `src/ui/lines.ts` (each
  lab's fixed bullet letter and colour; a new registry lab needs one) and `src/ui/palette.ts`, which
  mirrors the tokens on `:root` in `global.css` and is checked for contrast (status text 7:1, bullet
  letters 4.5:1). Say each fact once per page; untrusted odds are never printed large. Fonts are
  self-hosted Inter Tight and Geist Mono (`src/styles/fonts.css`, licences in `public/fonts/`); a
  change to them re-measures the fallback faces and keeps `test/browser/cls.spec.ts` passing. The icons and
  social card are rendered by `pnpm brand` (`scripts/brand/`); rerun it after changing a line's bullet.
- `src/ui` + `src/components` — formatting and Astro markup (`src/ui/signals.ts` builds the
  early-warning track lines and per-lab lead flags; `src/ui/panels.ts` builds every panel's
  source pill and /markets' line groups). View logic lives in pure, tested `src/ui` helpers, not in
  component frontmatter, which keeps to prop destructuring and calls. Neither imports from `src/adapters`,
  `src/infra` or `src/app`: a type they need from there moves to `src/domain`. Browser code is limited to the clock, refresh countdown, relative timestamps,
  source pills aging to STALE, the 5-minute poll-and-offer reload, the next departure's
  split-flap turn, and the instrument's scrubber and label fitting (progressive enhancement: the server render reads NOW without it).
  The server render reads the clock once per page: the page takes `const now = Date.now()` and passes
  `now` to every panel as a required prop, so a component's frontmatter never reads the clock itself.

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
- The availability ledger is cron-only. A source it adds is named once in `AVAILABILITY_SOURCE`
  (or `hfOrgSource`) in `src/domain/sources.ts`, not `SOURCE`, wrapped in `collect()` inside
  `pollAvailability`, and never fetched by `buildDashboard`; its health goes to the `[availability]`
  log line, not the page. Each source records its ids under its own `avail:`/`announce:` kind, kept
  out of `LEDGER_KINDS`; only a source that answered completely is recorded, and a kind's first
  capture writes `baseline` rows that never form a release. `availability` and `announcements`
  are never pruned: the earliest sighting of a (lab, sku) wins. A batch's ledger rows are written
  before its keys are recorded (`peekFirstSeen`, then `recordFirstSeen`), so a D1 failure between
  the two is retried next capture; keep that order. A change to how rows become
  release events bumps `RELEASE_DETECTOR_VERSION`; a tier decision the rules get wrong goes in
  `TIER_OVERRIDES` with its reason, and `data/backtest/labelled-releases.json` (regenerated by
  `pnpm backtest:replay`) must still match the review in `scripts/backtest/tier-review.ts`.
- DROPCON scores Polymarket odds only. A new signal goes into early warnings with a track record
  until `pnpm backtest:replay` shows it adds out-of-sample skill. Any scoring change bumps
  `DROPCON_ALGORITHM_VERSION`: history breaks its series at a version change and the repricing
  term reads only same-version rows.
- What the markets, drops and feed panels show comes from `src/ui/panels.ts`, and the refresh fingerprint
  (`src/ui/fingerprint.ts`) reads the same selections. The fingerprint is per page: `PAGE_PARTS` lists
  the slices each page shows (a lab page hashes its `labPage` selection), and the header stamps the view
  in `data-view` so the browser's poll hashes the same slice. A panel that starts printing a new field
  (or moves to another page) updates its part and `PAGE_PARTS` at its displayed precision; never hash raw
  floats or anything that moves with the clock, or every poll offers NEW DATA. A panel's status pill comes from `sourcePill`, never a literal "LIVE".
- A number on `/backtest` comes from `data/backtest/*.json` or a domain constant, never typed
  into markup (what the page and its charts derive from them is in `src/ui/backtest-page.ts`,
  `backtest-replay.ts` and `backtest-waterfall.ts`), and `test/ui/backtest.test.ts` pins it against that source. Regenerate the JSON
  only through `pnpm backtest` or `pnpm backtest:replay`.
- Changing the `Dashboard` shape? Bump `DASHBOARD_SCHEMA`. The memoised dashboard outlives a
  deploy by up to its TTL and a new render reading an old shape streams a blank page. The
  compact D1 snapshot must stay under 32 KiB (`MAX_SNAPSHOT_BYTES`); the worst-case test in
  `test/infra/snapshot-store.test.ts` enforces it, so clip new strings and lists there.
- D1 migrations in `migrations/` apply to the remote `whenmodel-history` before the code that
  needs them merges (command under the README's Point-in-time review); 0003 (the release ledger)
  goes before the availability-ledger branch. Never edit a migration that has run remotely.
- Shared CSS (tokens, panels, metrics, rows, motion) lives in `src/styles/global.css`;
  component `<style>` blocks hold presentation specific to that component. Font sizes use the `--t-*`
  scale and colours the `:root` tokens; a size off the scale keeps its px value with a one-line comment saying why. Every animation is
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
  Its webServer first applies the D1 migrations locally and seeds a week of history
  (`test/browser/fixtures/seed-history.sql`); a server you start yourself needs the same.
  Restart a running `wrangler dev` after `pnpm build`: its reload can keep serving the old server
  bundle (seen as HTML linking an `/_astro/*.css` that 404s), and the tests then pass or fail on old code.
  A browser test for a state today's data may not show (a failed source, an extrapolated read, a
  long launch label on the instrument) writes that state into the page with the component's `data-astro-cid-*`
  attribute, as `test/browser/robustness.spec.ts` does, so it does not depend on the day's data.
- Month names come from `src/domain/dates.ts` ("SEP", never ICU's en-GB "Sept"); do not format
  months with `toLocaleDateString`.
