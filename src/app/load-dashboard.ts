import { fetchXaiNews } from '../adapters/xai-news';
import { fetchAnthropic } from '../adapters/anthropic-news';
import { fetchSdkReleases } from '../adapters/github-releases';
import { fetchHackerNews, fetchHackerNewsLeaks } from '../adapters/hacker-news';
import { fetchPapers, fetchTrending } from '../adapters/huggingface';
import { fetchDrops } from '../adapters/openrouter';
import { fetchMarkets } from '../adapters/polymarket';
import { fetchDeepMind, fetchOpenAI } from '../adapters/rss';
import { fetchTestingCatalogLeaks } from '../adapters/testingcatalog';
import {
  BASELINE,
  PENDING_SEED,
  fetchTransformersModules,
  pendingArchitectures,
} from '../adapters/transformers-arch';
import { fetchBroadcasts, type BroadcastFetch } from '../adapters/youtube';
import {
  DASHBOARD_SCHEMA,
  assembleDashboard,
  type Dashboard,
  type DashboardInputs,
  type SourceResult,
} from '../domain/dashboard';
import { listingAliases } from '../domain/drop';
import { DROPCON_ALGORITHM_VERSION } from '../domain/dropcon';
import type { LeakItem, LeakSource } from '../domain/feed';
import { buildHistorySeries, type DisplayPoint } from '../domain/history';
import { unmappedReleaseMarkets } from '../domain/lab';
import type { BroadcastCandidate, PendingArchitecture } from '../domain/lead';
import { EMPTY_LEDGER, LEDGER_KINDS, ledgerFromRows, type Ledger } from '../domain/ledger';
import { SOURCE } from '../domain/sources';
import { historyDatabase } from '../infra/bindings';
import { cacheKey, defaultEdgeCache, memoJson, type EdgeCache } from '../infra/edge-cache';
import {
  SIGHTING_LOOKBACK_MS,
  readHeadlineNear,
  readScoreSeries,
  readSightings,
  type SnapshotDatabase,
} from '../infra/snapshot-store';
import { collect } from '../infra/source-result';

/** How long one assembled dashboard is shared by every render in a colo. */
export const DASHBOARD_TTL_SECONDS = 120;

const DAY_MS = 86_400_000;

/**
 * First sightings still in view and the P7 about 24 hours ago, from D1. Throws without a binding
 * so `collect` marks the ledger down and every lead signal falls back to its stateless rule.
 */
export async function readLedger(database: SnapshotDatabase | undefined, now: number): Promise<Ledger> {
  if (!database) throw new Error('HISTORY_DB binding is not configured');
  const [rows, headlineDayAgo] = await Promise.all([
    readSightings(database, LEDGER_KINDS, new Date(now - SIGHTING_LOOKBACK_MS).toISOString()),
    readHeadlineNear(database, DROPCON_ALGORITHM_VERSION, new Date(now - DAY_MS).toISOString()),
  ]);
  return ledgerFromRows(rows, headlineDayAgo);
}

/** A leak source's result, tagged with the leak source it feeds. */
async function leakSource(
  source: LeakSource,
  name: string,
  load: () => Promise<LeakItem[]>,
): Promise<SourceResult<LeakItem[]> & { source: LeakSource }> {
  return { ...(await collect(name, load, [])), source };
}

/** A poll with a failed channel is shown but is not ok: a partial list must never seed the ledger. */
export function broadcastResult(fetched: SourceResult<BroadcastFetch>): SourceResult<BroadcastCandidate[]> {
  const { failedChannels, candidates } = fetched.data;
  const partial = fetched.ok && failedChannels.length > 0;
  return {
    name: fetched.name,
    data: candidates,
    ok: fetched.ok && !partial,
    ...(partial
      ? { error: `${failedChannels.join(', ')} feed${failedChannels.length === 1 ? '' : 's'} failed` }
      : fetched.error !== undefined
        ? { error: fetched.error }
        : {}),
    ...(fetched.ms !== undefined ? { ms: fetched.ms } : {}),
  };
}

/** Log one line per build: total and per-source wall time, and release markets with no lab. */
function logBuild(dashboard: Dashboard, results: readonly SourceResult<unknown>[], ms: number): void {
  console.log(
    '[dashboard:build]',
    JSON.stringify({ ms, sources: Object.fromEntries(results.map((r) => [r.name, r.ms ?? null])) }),
  );
  const unmapped = unmappedReleaseMarkets(dashboard.markets);
  if (unmapped.length)
    console.log(
      '[diagnostic:unmapped-release-markets]',
      JSON.stringify({ count: unmapped.length, titles: unmapped.map((m) => m.title) }),
    );
}

/**
 * Fan out to every source, tolerate individual failures, assemble. `database` backs the
 * first-seen ledger and the repricing term; without it both read as unavailable.
 */
export async function buildDashboard(
  now = Date.now(),
  database: SnapshotDatabase | undefined = historyDatabase(),
): Promise<Dashboard> {
  const started = Date.now();
  const at = new Date(now);
  const [markets, drops, trending, papers, feeds, leaks, ledger, modules, broadcastFetch] = await Promise.all(
    [
      collect(SOURCE.polymarket, fetchMarkets, []),
      collect(SOURCE.openrouter, fetchDrops, []),
      collect(SOURCE.hfTrending, fetchTrending, []),
      collect(SOURCE.hfPapers, fetchPapers, []),
      Promise.all([
        collect(SOURCE.hackerNews, fetchHackerNews, []),
        collect(SOURCE.openai, fetchOpenAI, []),
        collect(SOURCE.deepmind, fetchDeepMind, []),
        collect(SOURCE.anthropic, fetchAnthropic, []),
        collect(SOURCE.xai, fetchXaiNews, []),
        collect(SOURCE.github, fetchSdkReleases, []),
      ]),
      Promise.all([
        leakSource('hn', SOURCE.hnLeaks, () => fetchHackerNewsLeaks()),
        leakSource('testingcatalog', SOURCE.testingCatalog, fetchTestingCatalogLeaks),
      ]),
      collect(SOURCE.ledger, () => readLedger(database, now), EMPTY_LEDGER),
      collect(SOURCE.transformers, fetchTransformersModules, [] as string[]),
      collect(SOURCE.youtube, () => fetchBroadcasts(at, { probeSchedule: true }), {
        candidates: [],
        failedChannels: [],
      } as BroadcastFetch),
    ],
  );

  const broadcasts = broadcastResult(broadcastFetch);
  const architectures: SourceResult<PendingArchitecture[]> = {
    ...modules,
    data: modules.ok
      ? pendingArchitectures(
          modules.data,
          BASELINE,
          PENDING_SEED,
          listingAliases(drops.data),
          at,
          ledger.ok ? ledger.data.architecture : undefined,
        )
      : [],
  };

  const inputs: DashboardInputs = {
    markets,
    drops,
    trending,
    papers,
    feeds,
    leaks,
    broadcasts,
    architectures,
    ledger,
  };
  const dashboard = assembleDashboard(inputs, now);
  logBuild(
    dashboard,
    [markets, drops, trending, papers, ...feeds, ...leaks, ledger, modules, broadcastFetch],
    Date.now() - started,
  );
  return dashboard;
}

/** The dashboard every request renders: memoised at the edge. */
export function loadDashboard(): Promise<Dashboard> {
  return memoJson(`dashboard@v${DASHBOARD_SCHEMA}`, DASHBOARD_TTL_SECONDS, () => buildDashboard());
}

/* ───────────── DROPCON history: /api/history.json and the page's strip share one memo ───────────── */

export const HISTORY_WINDOW_MS = 30 * 24 * 60 * 60_000;
export const HISTORY_CACHE_TTL_SECONDS = 15 * 60;
/** 30 days of 15-minute slots; a stricter cap than `readScoreSeries`'s own default. */
export const HISTORY_MAX_ROWS = 30 * 24 * 4;
/** The page waits this long for history, then renders the strip's unavailable state. */
export const HISTORY_PAGE_TIMEOUT_MS = 2000;

export interface HistoryResponseBody {
  ok: boolean;
  points: DisplayPoint[];
}

/** Everything that can fail here degrades to `{ ok: false, points: [] }`; this never throws. */
export async function buildHistoryResponseBody(
  database: SnapshotDatabase | undefined,
  now = Date.now(),
): Promise<HistoryResponseBody> {
  if (!database) return { ok: false, points: [] };
  try {
    const since = new Date(now - HISTORY_WINDOW_MS).toISOString();
    const rows = await readScoreSeries(database, since, HISTORY_MAX_ROWS);
    return { ok: true, points: buildHistorySeries(rows) };
  } catch (e) {
    console.error('[history-api]', e instanceof Error ? e.message : e);
    return { ok: false, points: [] };
  }
}

/** Versioned with the dashboard: a deploy that changes the point shape must not serve the old one. */
export const HISTORY_MEMO_KEY = `history@v${DASHBOARD_SCHEMA}@30d`;

const HISTORY_UNAVAILABLE: HistoryResponseBody = { ok: false, points: [] };

/**
 * The 30-day DROPCON series, memoised at the edge for 15 minutes under `HISTORY_MEMO_KEY`: the
 * JSON endpoint and the page's history strip read the same entry, so the strip costs a request no
 * upstream call and at most one D1 read per colo per 15 minutes. A failed read is served but never
 * memoised: one D1 blip must not blank the strip for the next 15 minutes. Never throws.
 */
export async function loadHistory(): Promise<HistoryResponseBody> {
  try {
    return await memoJson(HISTORY_MEMO_KEY, HISTORY_CACHE_TTL_SECONDS, async () => {
      const body = await buildHistoryResponseBody(historyDatabase());
      if (!body.ok) throw new Error('history unavailable');
      return body;
    });
  } catch {
    return HISTORY_UNAVAILABLE;
  }
}

/** After a failed or slow read, page renders skip D1 for this long (the JSON endpoint still retries). */
export const HISTORY_DOWN_TTL_SECONDS = 60;
const HISTORY_DOWN_KEY = `${HISTORY_MEMO_KEY}:down`;

/**
 * `loadHistory` for the page render, which must never wait long on D1: a read that fails or takes
 * longer than `HISTORY_PAGE_TIMEOUT_MS` renders the strip's unavailable state, and for the next
 * `HISTORY_DOWN_TTL_SECONDS` renders in this colo go straight to that state instead of each
 * paying the timeout again. Never throws.
 */
export async function loadHistoryForPage(
  timeoutMs = HISTORY_PAGE_TIMEOUT_MS,
  cache: EdgeCache | undefined = defaultEdgeCache(),
): Promise<HistoryResponseBody> {
  const down = cacheKey('memo', HISTORY_DOWN_KEY);
  if (await cache?.match(down).catch(() => undefined)) return HISTORY_UNAVAILABLE;
  const result = await collect('DROPCON history', loadHistory, HISTORY_UNAVAILABLE, timeoutMs);
  if (!result.ok || !result.data.ok)
    await cache
      ?.put(
        down,
        new Response('down', { headers: { 'cache-control': `public, max-age=${HISTORY_DOWN_TTL_SECONDS}` } }),
      )
      .catch(() => undefined);
  return result.data;
}
