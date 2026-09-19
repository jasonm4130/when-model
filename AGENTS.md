# whenmodel

Astro 7 SSR on Cloudflare Workers. `src/lib` fetches and assembles the data (`dashboard.ts`
is the entry point, `dropcon.ts` the scoring); `src/components` renders it; nothing runs in
the browser except the clock, relative timestamps and the 5-minute reload.

- Run the real Worker locally with `pnpm build && pnpm exec wrangler dev`; `pnpm dev` is fine
  for markup but the Cache API code paths only execute under wrangler.
- Every upstream call goes through `cachedText`/`cachedJson` in `src/lib/fetch.ts`. Buffer
  bodies; never stream a `Response.clone()` into the cache (it truncated in production).
- A source must degrade to empty data, never throw out of `buildDashboard`. Wrap it in
  `safe()` and add a row to `sources` so the health list shows it.
- Deploy is `op run --env-file .env.op -- pnpm deploy`. Custom domains are attached at the
  account level; do not add `routes` to `wrangler.jsonc` (see README).
- Tests: `pnpm test` (vitest, `test/`). Lint and format: `pnpm lint` (oxlint + oxfmt --check), `pnpm format` (oxfmt).
