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
import { unmappedReleaseMarkets } from '../domain/lab';
import type { BroadcastCandidate, PendingArchitecture } from '../domain/lead';
import { EMPTY_LEDGER, LEDGER_KINDS, ledgerFromRows, type Ledger } from '../domain/ledger';
import { SOURCE } from '../domain/sources';
import { historyDatabase } from '../infra/bindings';
import { memoJson } from '../infra/edge-cache';
import {
  SIGHTING_LOOKBACK_MS,
  readHeadlineNear,
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
