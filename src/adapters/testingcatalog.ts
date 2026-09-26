import { LEAK_WINDOW_DAYS, classifyLeak, type LeakItem } from '../domain/feed';
import { cachedText } from '../infra/edge-cache';
import { readFeedEntries } from './rss';

const FEED_URL = 'https://www.testingcatalog.com/rss/';

/**
 * TestingCatalog digs pre-release models out of app builds and posts them before launch
 * ("Anthropic tests Fable 5.2 and Opus 5.5 ahead of the release", 31 h before Opus 5.5).
 * It is one publisher, so every item keeps its source name and link. Sponsored posts are out.
 */
export function parseTestingCatalog(xml: string, now: number, days = LEAK_WINDOW_DAYS): LeakItem[] {
  const entries = readFeedEntries(xml);
  if (!entries.length) throw new Error('TestingCatalog feed has no readable entries');
  const since = now - days * 86_400_000;
  const out: LeakItem[] = [];
  for (const e of entries) {
    if (Date.parse(e.publishedAt) < since || e.categories.some((c) => /^sponsored$/i.test(c))) continue;
    const leak = classifyLeak(e.title);
    if (leak)
      out.push({ source: 'testingcatalog', title: e.title, url: e.url, publishedAt: e.publishedAt, ...leak });
  }
  return out;
}

export async function fetchTestingCatalogLeaks(): Promise<LeakItem[]> {
  return parseTestingCatalog(await cachedText(FEED_URL, { ttl: 1800 }), Date.now());
}
