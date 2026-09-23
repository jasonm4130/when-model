import type { Paper, TrendingRepo } from './community';
import { withinDays, type Drop } from './drop';
import { computeDropcon, DROPCON_ALGORITHM_VERSION, type Dropcon, type DropconInput } from './dropcon';
import { HN_ALERT_POINTS, newestFirst, type FeedItem } from './feed';
import { FRONTIER_LABS, LABS } from './lab';
import { assessLab, type LabStatus } from './lab-status';
import { pickBestModelMarket, type Market } from './market';

/** What one upstream source produced, or why it didn't. */
export interface SourceResult<T> {
  name: string;
  data: T;
  ok: boolean;
  error?: string;
}

export interface DashboardInputs {
  markets: SourceResult<Market[]>;
  drops: SourceResult<Drop[]>;
  trending: SourceResult<TrendingRepo[]>;
  papers: SourceResult<Paper[]>;
  feeds: SourceResult<FeedItem[]>[];
}

export interface Dashboard {
  generatedAt: string;
  measurement: { schema: number; algorithmVersion: number; inputs: DropconInput };
  dropcon: Dropcon;
  labs: LabStatus[];
  markets: Market[];
  bestModelMarket?: Market;
  drops: Drop[];
  trending: TrendingRepo[];
  papers: Paper[];
  feed: FeedItem[];
  sources: { name: string; ok: boolean; error?: string }[];
}

export const LIMITS = { markets: 60, drops: 40, feed: 60 } as const;

/**
 * Bump when the Dashboard shape changes. The memoised dashboard outlives a deploy by up to its TTL,
 * and a new render reading an old shape streams a blank page.
 */
export const DASHBOARD_SCHEMA = 3;

/** Pure assembly: fetched inputs in, rendered model out. All I/O lives in the adapters. */
export function assembleDashboard(inputs: DashboardInputs, now: number): Dashboard {
  const markets = [...inputs.markets.data].sort((a, b) => b.vol24 - a.vol24);
  const bestModelMarket = pickBestModelMarket(markets);
  const drops = inputs.drops.data;

  const labs = LABS.map((lab) => assessLab(lab, { drops, markets, bestModelMarket }, now)).sort(
    (a, b) => b.heat - a.heat,
  );

  const feed = newestFirst(inputs.feeds.flatMap((f) => f.data)).slice(0, LIMITS.feed);
  const hackerNews = inputs.feeds.find((f) => f.name === 'Hacker News')?.data ?? [];

  const scoreInputs: DropconInput = {
    maxWeekOdds: Math.max(0, ...labs.map((l) => l.weekOdds?.p ?? 0)),
    maxMonthOdds: Math.max(0, ...labs.map((l) => l.monthOdds?.p ?? 0)),
    frontierDrops7d: drops.filter(
      (d) => d.labId && FRONTIER_LABS.has(d.labId) && withinDays(d.createdAt, 7, now),
    ).length,
    frontierDrops48h: drops.filter(
      (d) => d.labId && FRONTIER_LABS.has(d.labId) && withinDays(d.createdAt, 2, now),
    ).length,
    hotStories: hackerNews.filter(
      (h) => (h.score ?? 0) >= HN_ALERT_POINTS && withinDays(h.publishedAt, 2, now),
    ).length,
    releaseAlerts: feed.filter((f) => f.alert && withinDays(f.publishedAt, 2, now)).length,
    oddsAvailable: inputs.markets.ok,
  };
  const dropcon = computeDropcon(scoreInputs);

  const sources = [inputs.markets, inputs.drops, inputs.trending, inputs.papers, ...inputs.feeds].map(
    ({ name, ok, error }) => ({ name, ok, error }),
  );

  return {
    generatedAt: new Date(now).toISOString(),
    measurement: {
      schema: DASHBOARD_SCHEMA,
      algorithmVersion: DROPCON_ALGORITHM_VERSION,
      inputs: scoreInputs,
    },
    dropcon,
    labs,
    markets: markets.slice(0, LIMITS.markets),
    bestModelMarket,
    drops: drops.slice(0, LIMITS.drops),
    trending: inputs.trending.data,
    papers: inputs.papers.data,
    feed,
    sources,
  };
}
