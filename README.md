# whenmodel.com

**Frontier AI model release intelligence.** One page, one number: **DROPCON**, from 5 (quiet orbit) to 1 (release surge), read off prediction markets, model registries, lab blogs, SDK changelogs and Hacker News. Built in the spirit of [pizzint.watch](https://www.pizzint.watch), with an 80s CRT skin.

Live at **https://whenmodel.com** · JSON at `/api/dashboard.json`

![whenmodel dashboard](docs/screenshot.jpeg)

## What it watches

| Source                                                                    | Feeds                                                          | Edge cache |
| ------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------- |
| [Polymarket](https://polymarket.com) gamma API (`ai-releases`, `ai` tags) | per-lab "released by" odds, best-model race, benchmark markets | 5 min      |
| [OpenRouter](https://openrouter.ai) models API                            | newest listings, per-lab release tempo, days since last drop   | 10 min     |
| [Hugging Face](https://huggingface.co)                                    | trending text-generation repos, daily papers                   | 15–30 min  |
| Hacker News via Algolia                                                   | model stories over 60 points in the last 48 h                  | 5 min      |
| OpenAI RSS, DeepMind RSS, Anthropic newsroom, xAI developer release notes | lab announcements                                              | 15 min     |
| GitHub releases for the Anthropic, OpenAI, Google and xAI SDKs            | changelog leaks of new model ids                               | 30 min     |

X/Twitter has no free read API and the mirrors are gone, so the page links a watchlist of accounts instead of ingesting posts.

### DROPCON

Scored 0–100 in `src/domain/dropcon.ts` and bucketed into five levels:

| Signal                                             | Weight        |
| -------------------------------------------------- | ------------- |
| best "ships within 7 days" probability across labs | × 45          |
| best "ships within 30 days" probability            | × 20          |
| frontier-lab models listed on OpenRouter this week | 6 each, max 4 |
| Hacker News model stories over 150 points in 48 h  | 3 each, max 4 |
| release-shaped headlines in the feed               | 2 each, max 5 |

Only cumulative “released by” markets contribute odds; negative outcomes and date-bucket markets do not. The score measures activity, not a calibrated release probability. Models listed in the last 48 hours get “MODELS JUST LANDED” copy, and listings keep contributing to the score for seven days.

Levels: 5 below 15, 4 below 35, 3 below 55, 2 below 75, 1 at 75 and above. Odds dominate on purpose: a market is already an aggregate of every rumour, so the other signals only nudge.

Each lab card also carries a **heat** score (7-day odds, 30-day odds, recency of last drop, drops in the last 30 days) used to rank the cards and pick the "hottest lab".

### Point-in-time review

The JSON response includes `measurement.schema`, `measurement.algorithmVersion`, and the exact score inputs. [The September 2026 review](docs/algorithm-review-2026-09-23.md) records the discovered odds bug, recent release coverage and historical-evidence limits.

Capture a manual immutable observation and evaluate an exported archive:

```sh
node scripts/capture-dashboard.mjs --dir /tmp/whenmodel-archive
node scripts/evaluate-dashboard.mjs --archive /tmp/whenmodel-archive --releases /tmp/releases.json
```

Release events are a JSON array of `{ "labId": "xai", "model": "grok-4.7", "releasedAt": "<verified UTC launch timestamp>", "sourceUrl": "<official announcement URL>" }`. Use a precise sourced time; a date-only announcement cannot establish an exact lead time. `model` exactly matches the listing ID, ID suffix, name or URL within that lab; variants are separate events.

The report selects the latest observation collected strictly before release within each 24-hour, 72-hour and seven-day lead-up window. It reports collection time and actual lead time, and labels absent history `unobserved`. First post-release listing detection is separate from the listing's own timestamp. The collector revision identifies the collector checkout, not the deployed Worker revision. These commands do not schedule collection. The Worker cron records observations independently of visitors using `HISTORY_DB`. History retains up to 90 days, 8,640 records and 128 MiB of JSON payload. Each payload is capped at 32 KiB. Database overhead is additional. Expiration deletes at most 96 old records per run; capacity errors stop new writes without evicting recent evidence. Retries use the scheduled quarter-hour as an immutable key.

The D1 migration must precede deployment:

```sh
pnpm exec wrangler d1 migrations apply whenmodel-history --local
op run --env-file .env.op -- pnpm exec wrangler d1 migrations apply whenmodel-history --remote
```

To export the latest 96 observations for evaluation:

```sh
op run --env-file .env.op -- pnpm exec wrangler d1 execute whenmodel-history --remote --json --command 'SELECT scheduled_slot, observed_at, payload_json FROM dashboard_snapshots ORDER BY scheduled_slot DESC LIMIT 96' > /tmp/whenmodel-history.json
node scripts/export-d1-history.mjs /tmp/whenmodel-history.json /tmp/whenmodel-archive
```

For older pages, add `WHERE scheduled_slot < '<last exported slot>'`. Export preserves the original observation time; it does not backdate a new fetch. The [review](docs/algorithm-review-2026-09-23.md) documents cost assumptions and the existing-history gap.

## How it runs

Astro 7 renders on demand on a Cloudflare Worker via `@astrojs/cloudflare`. A separate 15-minute scheduled handler records compact observations in D1; page requests do not write history:

- every upstream call goes through `cachedText` / `cachedJson` in `src/infra/edge-cache.ts`, which buffers the body and stores it in the Workers Cache API for the TTL above;
- the assembled dashboard is memoised in the same cache for 2 minutes. Concurrent requests within one Worker instance share an in-flight build; separate instances can still build independently;
- a source that fails or times out (8 s) degrades to empty data and shows up in the **Source health** list rather than taking the page down;
- the browser reloads the page every 5 minutes while visible.

The Cache API is per Cloudflare colo, so the first visitor in a region pays one cold build (about a second). A KV-backed global snapshot would remove that; it hasn't been needed.

### Code layout

| Directory        | Holds                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| `src/domain`     | Pure rules: labs, markets, drops, feed, DROPCON, lab heat, `assembleDashboard`. No I/O. |
| `src/adapters`   | One module per upstream: a pure DTO→domain mapper plus a cached `fetch*()`.             |
| `src/infra`      | Edge cache wrapper, `collect()` (timeout + degrade), text helpers.                      |
| `src/app`        | `loadDashboard()`: fan out, collect, assemble, memoise.                                 |
| `src/ui`         | Presentation formatting.                                                                |
| `src/components` | Astro markup; shared styling in `src/styles/global.css`.                                |

`test/` mirrors `src/`. Domain and infra are tested directly, adapters against fixtures with the cache mocked, and components through Astro's container API. Run `pnpm test --coverage` to enforce the thresholds in `vitest.config.ts`; plain `pnpm test` omits the coverage gate.

Coverage measures TypeScript modules, not Astro markup, CSS or browser scripts. Component tests check rendered HTML. Playwright checks the built Worker in Chromium for desktop alignment, narrow-screen overflow, keyboard ticker controls and reduced motion.

## Develop

```sh
pnpm install
pnpm dev                              # Astro dev server (no Cache API)
pnpm build && pnpm exec wrangler dev  # the real Worker, locally
pnpm test --coverage                  # vitest plus the configured coverage thresholds
pnpm lint                             # oxlint + oxfmt --check
pnpm check                            # astro check (TypeScript 6 is pinned; 7 lacks the API astro check needs)
pnpm validate                         # lint, types, coverage and production build
pnpm exec playwright install chromium # once, for local browser tests
pnpm build && pnpm test:e2e            # starts the real Worker and checks browser behavior
```

GitHub CI runs on pull requests and pushes to `main`. The `check` job runs lint, types, coverage and build; the `browser` job runs the Chromium checks against the real Worker. Both checks must pass before merging to `main`.

## Deploy

Cloudflare Builds deploys `main` to the existing `whenmodel` Worker. Preview builds are disabled. Its build command is `pnpm validate`, followed by `pnpm exec wrangler deploy`; the build environment uses `NODE_VERSION=24` and `PNPM_VERSION=11.22.0`. GitHub's required checks protect merges, and Cloudflare repeats validation before uploading the Worker.

For a manual deploy, secrets come from 1Password via [`op run`](https://developer.1password.com/docs/cli/reference/commands/run/); `.env.op` holds only `op://` references. Run `pnpm validate` first.

```sh
op run --env-file .env.op -- pnpm deploy
```

`whenmodel.com` and `www.whenmodel.com` are attached to the Worker as account-level custom domains and are deliberately **not** declared as `routes` in `wrangler.jsonc`: the deploy token cannot read zone routes for this zone, and declaring them made every deploy fail after upload.

To run your own copy: change `name` in `wrangler.jsonc`, drop or replace the Skopia analytics `<script>` in `src/layouts/Layout.astro`, and `wrangler deploy`. Nothing else is account-specific.

## Contributing

Issues and pull requests are welcome. Good first contributions: a new free signal source (add an adapter under `src/adapters/` with a pure `toX(dto)` mapper, wire it with `collect()` in `src/app/load-dashboard.ts`; the health list picks it up), a new lab in `src/domain/lab.ts`, or a better DROPCON weighting with the reasoning in the pull request. Keep sources free and unauthenticated; the point is that anyone can deploy this.

## License

[MIT](LICENSE). Not affiliated with any lab, with Polymarket, or with pizzint.watch. Odds are crowd opinion, not roadmaps.
