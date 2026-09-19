# whenmodel

Astro 7 SSR on Cloudflare Workers, layered so the interesting code has no I/O:

- `src/domain` — pure types and rules: lab registry, market/drop/feed models, DROPCON scoring,
  lab heat, and `assembleDashboard(inputs, now)`. No fetch, no `Date.now()`, fully unit-tested.
- `src/adapters` — one module per upstream (Polymarket, OpenRouter, Hugging Face, Hacker News,
  RSS, Anthropic newsroom, GitHub releases). Each exposes a pure `toX(dto)` mapper and a
  `fetchX()` that goes through the edge cache.
- `src/infra` — `edge-cache.ts` (Workers Cache API wrapper), `source-result.ts` (`collect`:
  timeout + degrade-to-fallback), `text.ts` (safe parsing helpers).
- `src/app/load-dashboard.ts` — fans out to every adapter and memoises the assembled dashboard.
- `src/ui` + `src/components` — formatting and Astro markup. Nothing runs in the browser except
  the clock, the refresh countdown, relative timestamps and the 5-minute reload.

Rules of the house:

- Run the real Worker locally with `pnpm build && pnpm exec wrangler dev`; `pnpm dev` is fine
  for markup but the Cache API code paths only execute under wrangler.
- Every upstream call goes through `cachedText`/`cachedJson`. Buffer bodies; never stream a
  `Response.clone()` into the cache (it truncated in production).
- A source must degrade to empty data, never throw out of `buildDashboard`. Wrap it in
  `collect()`; the health list is derived from the results automatically.
- Changing the `Dashboard` shape? Bump `DASHBOARD_SCHEMA`. The memoised dashboard outlives a
  deploy by up to its TTL and a new render reading an old shape streams a blank page.
- Shared CSS (tokens, panels, metrics, rows, motion) lives in `src/styles/global.css`;
  component `<style>` blocks hold only layout specific to that component. Every animation
  is gated by `prefers-reduced-motion`.
- Deploy is `op run --env-file .env.op -- pnpm deploy`. Custom domains are attached at the
  account level; do not add `routes` to `wrangler.jsonc` (see README).
- Tests: `pnpm test` (vitest, `test/` mirrors `src/`; components render through
  `experimental_AstroContainer`). Coverage thresholds live in `vitest.config.ts`.
  Lint and format: `pnpm lint` (oxlint + oxfmt --check), `pnpm format` (oxfmt).
