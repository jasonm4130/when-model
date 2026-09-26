import {
  HN_ALERT_POINTS,
  LEAK_WINDOW_DAYS,
  classifyLeak,
  isReleaseHeadline,
  mentionsModel,
  type FeedItem,
  type LeakItem,
} from '../domain/feed';
import { cachedJson } from '../infra/edge-cache';
import { isHttpUrl, toIso } from '../infra/text';

export interface HnHitDto {
  objectID: string;
  title?: string;
  url?: string;
  points?: number;
  created_at?: string;
  num_comments?: number;
}

const ALGOLIA = 'https://hn.algolia.com/api/v1';

function storyUrl(hit: HnHitDto): string {
  return isHttpUrl(hit.url)
    ? hit.url
    : `https://news.ycombinator.com/item?id=${encodeURIComponent(hit.objectID)}`;
}

export function toFeedItem(hit: HnHitDto): FeedItem | undefined {
  const title = typeof hit.title === 'string' ? hit.title : '';
  const publishedAt = toIso(hit.created_at);
  if (!title || !publishedAt || !mentionsModel(title)) return undefined;
  const points = hit.points ?? 0;
  return {
    source: 'hn',
    title,
    url: storyUrl(hit),
    publishedAt,
    precision: 'instant',
    score: points,
    meta: `${points}▲ · ${hit.num_comments ?? 0} comments`,
    alert: isReleaseHeadline(title) && points >= HN_ALERT_POINTS,
  };
}

/**
 * Algolia's `since` bound, floored to a `bucketSeconds` bucket so every render inside the
 * edge-cache TTL builds the same URL. Per-second bounds made each request a cache miss, and a
 * bucket shorter than the TTL caps the effective TTL at the bucket.
 */
export function sinceBucket(nowMs: number, hours: number, bucketSeconds = 300): number {
  return Math.floor(nowMs / 1000 / bucketSeconds) * bucketSeconds - hours * 3600;
}

/** Lead adapters cache for 30 minutes: their signals run days ahead, and every cold fetch competes for the Worker's six connections. */
export const LEAK_TTL_SECONDS = 1800;

/** Model-related stories above `minPoints` from the last `hours`, via Algolia. */
export async function fetchHackerNews(hours = 48, minPoints = 60): Promise<FeedItem[]> {
  const filters = encodeURIComponent(`points>${minPoints},created_at_i>${sinceBucket(Date.now(), hours)}`);
  const url = `${ALGOLIA}/search?tags=story&hitsPerPage=100&numericFilters=${filters}`;
  const { hits } = await cachedJson<{ hits?: HnHitDto[] }>(url, { ttl: 300 });
  return (hits ?? []).map(toFeedItem).filter((f): f is FeedItem => f !== undefined);
}

/**
 * Words that match a leak cue in `classifyLeak`, sent as Algolia optional words (any one
 * matches). About 170 stories a week match, well under the 1,000-hit page.
 */
export const LEAK_QUERY =
  'leak leaked leaks spotted appeared appears testing tests soon imminent prepares preparing ahead outputs tomorrow will releasing arriving arrives internal';

export function toLeakItem(hit: HnHitDto): LeakItem | undefined {
  const title = typeof hit.title === 'string' ? hit.title : '';
  const publishedAt = toIso(hit.created_at);
  const leak = title && publishedAt ? classifyLeak(title) : undefined;
  if (!leak || !publishedAt) return undefined;
  return { source: 'hn', title, url: storyUrl(hit), publishedAt, ...leak };
}

/**
 * Leak-shaped stories at any point count: "GPT-6-sol appeared on OpenAI API" had 10 points
 * eleven days before Sol shipped, and "Grok 4.7 Launching Soon" had 1.
 */
export async function fetchHackerNewsLeaks(days = LEAK_WINDOW_DAYS): Promise<LeakItem[]> {
  const params = new URLSearchParams({
    query: LEAK_QUERY,
    optionalWords: LEAK_QUERY,
    tags: 'story',
    numericFilters: `created_at_i>${sinceBucket(Date.now(), days * 24, LEAK_TTL_SECONDS)}`,
    hitsPerPage: '1000',
    typoTolerance: 'false',
    restrictSearchableAttributes: 'title',
  });
  const { hits } = await cachedJson<{ hits?: HnHitDto[] }>(`${ALGOLIA}/search_by_date?${params}`, {
    ttl: LEAK_TTL_SECONDS,
  });
  if (!Array.isArray(hits)) throw new Error('Algolia leak search returned no hits array');
  return hits.map(toLeakItem).filter((l): l is LeakItem => l !== undefined);
}
