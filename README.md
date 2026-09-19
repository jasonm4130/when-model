# whenmodel.com

Frontier AI model release intelligence, in the spirit of [pizzint.watch](https://www.pizzint.watch). One page, one number: **DROPCON**, 5 (quiet) to 1 (drop imminent).

## Signals

| Source | What it feeds | Cache |
|---|---|---|
| Polymarket gamma API (`ai-releases`, `ai` tags) | release odds per lab, best-model race, benchmark markets | 5 min |
| OpenRouter models API | newest listings, per-lab release tempo, days since last drop | 10 min |
| Hugging Face | trending text-generation repos, daily papers | 15–30 min |
| Hacker News (Algolia) | model stories over 60 points in the last 48 h | 5 min |
| OpenAI RSS, DeepMind RSS, Anthropic newsroom (scraped) | lab announcements | 15 min |
| GitHub releases (Anthropic, OpenAI, Google, xAI SDKs) | changelog leaks of new model ids | 30 min |

X has no free read API. The dashboard links a watchlist instead.

DROPCON weights: 7-day release odds (45), 30-day odds (20), frontier-lab drops this week (6 each, max 4), hot HN stories (3 each, max 4), release-shaped headlines (2 each, max 5). See `src/lib/dropcon.ts`.

## Stack

Astro 7 (SSR) on Cloudflare Workers via `@astrojs/cloudflare`. Every upstream fetch goes through the Workers Cache API; the page itself is edge-cached for 5 minutes and reloads itself every 5 minutes in the browser. `/api/dashboard.json` exposes the assembled payload.

## Develop

```sh
pnpm install
pnpm dev                 # astro dev
pnpm build && pnpm exec wrangler dev   # run the real worker locally
pnpm check               # astro check (TypeScript 6 pinned; 7 lacks the API)
```

## Deploy

Secrets come from 1Password:

```sh
op run --env-file .env.op -- pnpm deploy
```

The `cloudflare-api` token can upload the Worker but not read zone routes for this zone, so the custom domains are attached at the account level (Workers Domains API) and deliberately not declared as `routes` in `wrangler.jsonc`. `whenmodel.com` is not yet managed in the `jasonm4130-cf` Terraform repo.

## Analytics

[Skopia](https://app.skopia.dev) via the snippet in `src/layouts/Layout.astro` (`data-site="whenmodel"`). The site row lives in Skopia's D1 with an origin allowlist of `https://whenmodel.com,https://www.whenmodel.com`.
