import {
  isReleaseHeadline,
  precisionOf,
  type FeedItem,
  type FeedPrecision,
  type FeedSource,
} from '../domain/feed';
import { cachedText } from '../infra/edge-cache';
import { decodeEntities, isHttpUrl, toIso } from '../infra/text';

/** One RSS item or Atom entry with a title, an http link and a parseable date. */
export interface FeedEntry {
  title: string;
  url: string;
  publishedAt: string;
  precision: FeedPrecision;
  categories: string[];
}

function* entries(xml: string): Generator<FeedEntry> {
  for (const m of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const block = m[2];
    const pick = (tag: string) =>
      decodeEntities(block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? '');
    const title = pick('title');
    const link = pick('link') || block.match(/<link[^>]*href="([^"]+)"/)?.[1] || '';
    const rawDate = pick('pubDate') || pick('dc:date') || pick('published') || pick('updated');
    const publishedAt = toIso(rawDate);
    if (!title || !isHttpUrl(link) || !publishedAt) continue;
    const categories = [...block.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/g)].map((c) =>
      decodeEntities(c[1]),
    );
    yield { title, url: link, publishedAt, precision: precisionOf(rawDate), categories };
  }
}

/** RSS 2.0 and Atom by regex. Entries without a title, http link and parseable date are dropped. */
export function readFeedEntries(xml: string): FeedEntry[] {
  return [...entries(xml)];
}

/** OpenAI's 1,230-item feed parses in ~5 ms whole; stop after this many consecutive out-of-window entries. */
const STALE_RUN = 10;

export interface FeedWindow {
  /** Keep entries newer than `days` before `now`, newest first. */
  now: number;
  days: number;
  /** Case-insensitive category names to drop, e.g. customer stories. */
  excludeCategories?: readonly string[];
}

/**
 * Parse a feed into items. Throws when the document yields no entries at all, so a challenge
 * page or a changed format turns the source's health dot red instead of going quietly empty.
 * With a window, only recent entries count and an empty week is a legitimate empty result.
 */
export function parseFeed(xml: string, source: FeedSource, limit: number, window?: FeedWindow): FeedItem[] {
  const kept: FeedEntry[] = [];
  let read = 0;
  if (!window) {
    for (const e of entries(xml)) {
      read++;
      if (kept.push(e) >= limit) break;
    }
  } else {
    const since = window.now - window.days * 86_400_000;
    const excluded = new Set((window.excludeCategories ?? []).map((c) => c.toLowerCase()));
    let stale = 0;
    for (const e of entries(xml)) {
      read++;
      if (Date.parse(e.publishedAt) < since) {
        // Feeds run newest first with small reorderings; a run of old entries means we are done.
        if (++stale >= STALE_RUN) break;
        continue;
      }
      stale = 0;
      if (!e.categories.some((c) => excluded.has(c.toLowerCase()))) kept.push(e);
    }
    kept.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  }
  if (!read) throw new Error(`${source} feed has no readable entries`);
  return kept.slice(0, limit).map((e) => ({
    source,
    title: e.title,
    url: e.url,
    publishedAt: e.publishedAt,
    precision: e.precision,
    alert: isReleaseHeadline(e.title),
  }));
}

/**
 * OpenAI's own filing for posts that never announce a model: customer stories, policy,
 * education and events. A launch week publishes ~20 posts, so a fixed 12-item cap pushed
 * "Introducing GPT-6 Sol and Luna" off the feed within four days; read a week instead.
 */
export const OPENAI_NOISE_CATEGORIES = [
  'Startup',
  'Story',
  'AI Adoption',
  'Applied AI',
  'OpenAI Academy',
  'Global Affairs',
  'Webinar',
  'Guides',
] as const;

export async function fetchOpenAI(): Promise<FeedItem[]> {
  const xml = await cachedText('https://openai.com/news/rss.xml', { ttl: 900 });
  return parseFeed(xml, 'openai', 40, {
    now: Date.now(),
    days: 7,
    excludeCategories: OPENAI_NOISE_CATEGORIES,
  });
}

export async function fetchDeepMind(): Promise<FeedItem[]> {
  return parseFeed(await cachedText('https://deepmind.google/blog/rss.xml', { ttl: 900 }), 'deepmind', 10);
}
