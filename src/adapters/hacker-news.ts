import { HN_ALERT_POINTS, looksLikeRelease, mentionsModel, type FeedItem } from '../domain/feed';
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

export function toFeedItem(hit: HnHitDto): FeedItem | undefined {
  const title = typeof hit.title === 'string' ? hit.title : '';
  const publishedAt = toIso(hit.created_at);
  if (!title || !publishedAt || !mentionsModel(title)) return undefined;
  const points = hit.points ?? 0;
  return {
    source: 'hn',
    title,
    url: isHttpUrl(hit.url)
      ? hit.url
      : `https://news.ycombinator.com/item?id=${encodeURIComponent(hit.objectID)}`,
    publishedAt,
    score: points,
    meta: `${points}▲ · ${hit.num_comments ?? 0} comments`,
    alert: looksLikeRelease(title) && points >= HN_ALERT_POINTS,
  };
}

/** Model-related stories above `minPoints` from the last `hours`, via Algolia. */
export async function fetchHackerNews(hours = 48, minPoints = 60): Promise<FeedItem[]> {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const filters = encodeURIComponent(`points>${minPoints},created_at_i>${since}`);
  const url = `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=100&numericFilters=${filters}`;
  const { hits } = await cachedJson<{ hits?: HnHitDto[] }>(url, { ttl: 300 });
  return (hits ?? []).map(toFeedItem).filter((f): f is FeedItem => f !== undefined);
}
