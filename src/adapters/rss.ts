import { looksLikeRelease, type FeedItem, type FeedSource } from '../domain/feed';
import { cachedText } from '../infra/edge-cache';
import { decodeEntities, isHttpUrl, toIso } from '../infra/text';

/** RSS 2.0 and Atom by regex. Entries without a title, http link and parseable date are dropped. */
export function parseFeed(xml: string, source: FeedSource, limit: number): FeedItem[] {
  const out: FeedItem[] = [];
  for (const m of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const block = m[2];
    const pick = (tag: string) =>
      decodeEntities(block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? '');
    const title = pick('title');
    const link = pick('link') || block.match(/<link[^>]*href="([^"]+)"/)?.[1] || '';
    const publishedAt = toIso(pick('pubDate') || pick('dc:date') || pick('published') || pick('updated'));
    if (!title || !isHttpUrl(link) || !publishedAt) continue;
    out.push({ source, title, url: link, publishedAt, alert: looksLikeRelease(title) });
    if (out.length >= limit) break;
  }
  return out;
}

export async function fetchOpenAI(): Promise<FeedItem[]> {
  return parseFeed(await cachedText('https://openai.com/news/rss.xml', { ttl: 900 }), 'openai', 12);
}

export async function fetchDeepMind(): Promise<FeedItem[]> {
  return parseFeed(await cachedText('https://deepmind.google/blog/rss.xml', { ttl: 900 }), 'deepmind', 10);
}
