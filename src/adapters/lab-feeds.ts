/**
 * Lab sites the availability ledger reads for announcements, from the 15-minute cron only: they
 * are not in the dashboard's feed. Meta's newsroom has RSS; DeepSeek's API docs keep a news
 * section whose sidebar lists every post with its date. Qwen's blog (qwen.ai) renders client-side,
 * and x.ai/news and meta.ai answer 403, so none of those is read (see the README).
 */
import type { LabPost } from '../domain/availability';
import { cachedText } from '../infra/edge-cache';
import { decodeEntities } from '../infra/text';
import { readFeedEntries } from './rss';

export const META_NEWSROOM_URL = 'https://about.fb.com/news/feed/';
const DEEPSEEK_ORIGIN = 'https://api-docs.deepseek.com';
export const DEEPSEEK_NEWS_URL = `${DEEPSEEK_ORIGIN}/news/`;
/** Shorter than the cron's 15 minutes, so each capture reads a fresh page. */
const TTL_SECONDS = 300;
const MAX_POSTS = 30;

/** Meta's newsroom, newest first. Throws when the feed has no readable entries (a challenge page). */
export function parseMetaNewsroom(xml: string): LabPost[] {
  const entries = readFeedEntries(xml);
  if (!entries.length) throw new Error('Meta newsroom feed has no readable entries');
  return entries
    .slice(0, MAX_POSTS)
    .map(({ title, url, publishedAt, precision }) => ({ title, url, publishedAt, precision }));
}

export async function fetchMetaNewsroom(): Promise<LabPost[]> {
  return parseMetaNewsroom(await cachedText(META_NEWSROOM_URL, { ttl: TTL_SECONDS }));
}

const NEWS_LINK = /<a\b[^>]*href="(\/news\/news\d+)\/?"[^>]*>([\s\S]*?)<\/a>/g;
/** A sidebar entry ends with its date: "DeepSeek-V4.1-Flash Release 2026/09/10". */
const DATED_TITLE = /^(.+?)\s+(\d{4})\/(\d{2})\/(\d{2})$/;

/** The newest news post's path, from any docs page's navbar ("News" links to the latest post). */
export function latestDeepSeekNewsPath(html: string): string | undefined {
  return [...html.matchAll(NEWS_LINK)][0]?.[1];
}

/**
 * Every post in a news page's sidebar, newest first. The sidebar prints dates, not times, so each
 * is pinned to 00:00Z with `day` precision. Throws when the page lists none.
 */
export function parseDeepSeekNews(html: string): LabPost[] {
  const posts = new Map<string, LabPost>();
  for (const [, path, inner] of html.matchAll(NEWS_LINK)) {
    const dated = DATED_TITLE.exec(decodeEntities(inner).replace(/\s+/g, ' ').trim());
    if (!dated || posts.has(path)) continue;
    const [, title, y, m, d] = dated;
    posts.set(path, {
      title,
      url: `${DEEPSEEK_ORIGIN}${path}`,
      publishedAt: `${y}-${m}-${d}T00:00:00.000Z`,
      precision: 'day',
    });
  }
  if (!posts.size) throw new Error('DeepSeek news lists no dated posts');
  return [...posts.values()]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, MAX_POSTS);
}

/**
 * DeepSeek's news: `/news/` serves the docs home, whose navbar links the newest post; that post's
 * page lists them all. Two fetches, both through the edge cache.
 */
export async function fetchDeepSeekNews(): Promise<LabPost[]> {
  const home = await cachedText(DEEPSEEK_NEWS_URL, {
    ttl: TTL_SECONDS,
    validate: (body) => latestDeepSeekNewsPath(body) !== undefined,
  });
  const latest = latestDeepSeekNewsPath(home);
  if (!latest) throw new Error('DeepSeek docs link no news post');
  return parseDeepSeekNews(await cachedText(`${DEEPSEEK_ORIGIN}${latest}/`, { ttl: TTL_SECONDS }));
}
