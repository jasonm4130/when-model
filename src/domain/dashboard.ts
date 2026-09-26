import type { Paper, TrendingRepo } from './community';
import { releaseEvents, type Drop } from './drop';
import {
  computeDropcon,
  DROPCON_ALGORITHM_VERSION,
  type Dropcon,
  type DropconInput,
  type MarketDriver,
} from './dropcon';
import { buildEarlyWarnings, type EarlyWarnings } from './early-warnings';
import { newestFirst, type FeedItem, type LeakItem } from './feed';
import { forecastSummary, type ForecastSummary } from './forecast';
import { FRONTIER_LABS, LABS } from './lab';
import { assessLab, trustedP, type LabOddsRead, type LabStatus } from './lab-status';
import { buildLanded, type Landed } from './landed';
import type { BroadcastCandidate, PendingArchitecture } from './lead';
import type { Ledger } from './ledger';
import { pickBestModelMarket, type Market } from './market';

/** What one upstream source produced, or why it didn't. */
export interface SourceResult<T> {
  name: string;
  data: T;
  ok: boolean;
  error?: string;
  /** Wall time of the fetch, for the build log; never part of the dashboard. */
  ms?: number;
}

export interface DashboardInputs {
  markets: SourceResult<Market[]>;
  drops: SourceResult<Drop[]>;
  trending: SourceResult<TrendingRepo[]>;
  papers: SourceResult<Paper[]>;
  feeds: SourceResult<FeedItem[]>[];
  /** Leak Wire sources (HN leak search, TestingCatalog), each tagged with its leak source. */
  leaks?: (SourceResult<LeakItem[]> & { source: LeakItem['source'] })[];
  /** Stateless YouTube candidates; `ok` is false when any channel failed. */
  broadcasts?: SourceResult<BroadcastCandidate[]>;
  /** Tracked transformers modules, already checked against listings. */
  architectures?: SourceResult<PendingArchitecture[]>;
  /** First-seen sightings and the day-old P7, read from D1. */
  ledger?: SourceResult<Ledger>;
}

export interface Dashboard {
  generatedAt: string;
  measurement: { schema: number; algorithmVersion: number; inputs: DropconInput };
  dropcon: Dropcon;
  /** P(any frontier text release within 72h): context for the base-rate line, never the level. */
  forecast: ForecastSummary;
  earlyWarnings: EarlyWarnings;
  landed: Landed;
  labs: LabStatus[];
  markets: Market[];
  bestModelMarket?: Market;
  drops: Drop[];
  trending: TrendingRepo[];
  papers: Paper[];
  feed: FeedItem[];
  /**
   * Every day-precision item fetched, uncapped: the first-seen ledger records these. `feed` is
   * capped at 60, so on a busy capture an older dated post falls off it, is missing from the
   * seeding baseline, and would later read as newly seen.
   */
  feedDay: Pick<FeedItem, 'source' | 'url' | 'title' | 'publishedAt'>[];
  sources: { name: string; ok: boolean; error?: string }[];
}

export const LIMITS = { markets: 60, drops: 40, feed: 60 } as const;

/**
 * Bump when the Dashboard shape changes. The memoised dashboard outlives a deploy by up to its TTL,
 * and a new render reading an old shape streams a blank page.
 */
export const DASHBOARD_SCHEMA = 4;

function driver(lab: LabStatus, read: LabOddsRead): MarketDriver {
  const quote = read.source === 'buckets' ? undefined : (read.from ?? read.to);
  return {
    labId: lab.id,
    lab: lab.name,
    family: lab.odds!.family,
    p: read.p,
    read: read.upperBound
      ? 'ceiling'
      : read.source === 'buckets'
        ? 'floor'
        : read.lowerBound
          ? 'held'
          : read.interpolated
            ? 'interpolated'
            : 'rung',
    ...(read.from ? { from: read.from.label } : {}),
    ...(read.to ? { to: read.to.label } : {}),
    ...(quote ? { quote: { label: quote.label, p: quote.quoted } } : {}),
    // Link the market the headline quotes, so the number on the page is the one on the link.
    url: quote?.url ?? read.url,
  };
}

/** The frontier lab whose trusted read at `horizon` is highest, as a score driver. */
function topDriver(labs: readonly LabStatus[], horizon: 'p7' | 'p30'): MarketDriver | undefined {
  let best: LabStatus | undefined;
  for (const lab of labs) {
    const p = trustedP(lab.odds?.[horizon]);
    if (p > 0 && (!best || p > trustedP(best.odds?.[horizon]))) best = lab;
  }
  return best && driver(best, best.odds![horizon]);
}

/** Pure assembly: fetched inputs in, rendered model out. All I/O lives in the adapters. */
export function assembleDashboard(inputs: DashboardInputs, now: number): Dashboard {
  const markets = [...inputs.markets.data].sort((a, b) => b.vol24 - a.vol24);
  const bestModelMarket = pickBestModelMarket(markets);
  const drops = inputs.drops.data;
  const events = releaseEvents(drops, now);
  const ledger = inputs.ledger?.ok ? inputs.ledger.data : undefined;

  const labs = LABS.map((lab) => assessLab(lab, { drops, markets, bestModelMarket, events }, now)).sort(
    (a, b) => b.heat - a.heat,
  );
  const frontier = labs.filter((l) => FRONTIER_LABS.has(l.id));

  const oddsAvailable = inputs.markets.ok;
  const forecast = forecastSummary(
    frontier.filter((l) => l.odds?.p72.trusted).map((l) => ({ labId: l.id, p: l.odds!.p72.p })),
    oddsAvailable,
  );
  const top7 = topDriver(frontier, 'p7');
  const top30 = topDriver(frontier, 'p30');
  const scoreInputs: DropconInput = {
    p7: top7?.p ?? 0,
    p30: Math.max(top30?.p ?? 0, top7?.p ?? 0),
    p7DayAgo: ledger?.headlineDayAgo?.p ?? null,
    oddsAvailable,
    listingsAvailable: inputs.drops.ok,
    ...(top7 ? { top7 } : {}),
    ...(top30 ? { top30 } : {}),
  };
  const dropcon = computeDropcon(scoreInputs, forecast);

  const allFeed = inputs.feeds.flatMap((f) => f.data);
  const feed = newestFirst(allFeed).slice(0, LIMITS.feed);
  const feedDay = allFeed
    .filter((f) => f.precision === 'day')
    .map(({ source, url, title, publishedAt }) => ({ source, url, title, publishedAt }));

  const earlyWarnings = buildEarlyWarnings(
    {
      drops: inputs.drops,
      leaks: inputs.leaks ?? [],
      broadcasts: inputs.broadcasts,
      architectures: inputs.architectures,
      ledger,
    },
    now,
  );
  const landed = buildLanded({ drops, feed: allFeed, feedDaySeen: ledger?.feedDay }, now);

  const optional: (SourceResult<unknown> | undefined)[] = [
    inputs.broadcasts,
    inputs.architectures,
    inputs.ledger,
  ];
  const sources = [
    inputs.markets,
    inputs.drops,
    inputs.trending,
    inputs.papers,
    ...inputs.feeds,
    ...(inputs.leaks ?? []),
    ...optional.filter((s): s is SourceResult<unknown> => s !== undefined),
  ].map(({ name, ok, error }) => ({ name, ok, ...(error !== undefined ? { error } : {}) }));

  return {
    generatedAt: new Date(now).toISOString(),
    measurement: {
      schema: DASHBOARD_SCHEMA,
      algorithmVersion: DROPCON_ALGORITHM_VERSION,
      inputs: scoreInputs,
    },
    dropcon,
    forecast,
    earlyWarnings,
    landed,
    labs,
    markets: markets.slice(0, LIMITS.markets),
    bestModelMarket,
    drops: drops.slice(0, LIMITS.drops),
    trending: inputs.trending.data,
    papers: inputs.papers.data,
    feed,
    feedDay,
    sources,
  };
}
