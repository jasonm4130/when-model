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
  /** Drop an entry that carries no category at all, when its title also matches. */
  noiseTitle?: RegExp;
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
      const noise =
        e.categories.some((c) => excluded.has(c.toLowerCase())) ||
        (e.categories.length === 0 && (window.noiseTitle?.test(e.title) ?? false));
      if (!noise) kept.push(e);
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

/**
 * OpenAI's customer-story posts ("Proaction boosts sales 60% and saves 75+ hours with Codex",
 * "1Password increases engineering productivity 21% with Codex", "How invideo improves color
 * grading 3x with GPT‑6 Astra") carry no `<category>` at all, so `excludeCategories` never
 * catches them: they are 121 of the live feed's 1,230 items (measured 2026-09-26), and fill the
 * 7-day window (3 of its 20 items today). Every one of the 56 launches in
 * test/fixtures/openai-rss-labelled.ts carries a category in the live feed, so gating this rule
 * on "no category at all" is safe by construction: this pattern only ever runs on an item
 * `excludeCategories` could never have reached anyway. It removes 70 of the 121 uncategorised
 * items feed-wide (all 3 of this week's), matching two shapes: a post that opens with "How …",
 * and a company crediting Codex, ChatGPT, OpenAI or a GPT model by name. "Building …" is
 * excluded up front: it is OpenAI's own opener for a launch post ("Building more with
 * GPT-5.1-Codex-Max"), the one title in the 150-row labelled fixture where "with <model>" names
 * the subject rather than a customer.
 */
export const OPENAI_NOISE_TITLE_SHAPE =
  /^(?!building\b)(?:how\s+[a-z]|[\s\S]*\b(?:with|using|powered by)\s+(?:codex|chatgpt(?:\s+(?:work|enterprise|business))?|openai(?:['’]s)?(?:\s+technology|\s+models?)?|gpt[\s-]?\d[\w.]*|gpt-realtime|gpt-image)\b)/i;

export async function fetchOpenAI(): Promise<FeedItem[]> {
  const xml = await cachedText('https://openai.com/news/rss.xml', { ttl: 900 });
  return parseFeed(xml, 'openai', 40, {
    now: Date.now(),
    days: 7,
    excludeCategories: OPENAI_NOISE_CATEGORIES,
    noiseTitle: OPENAI_NOISE_TITLE_SHAPE,
  });
}

export async function fetchDeepMind(): Promise<FeedItem[]> {
  return parseFeed(await cachedText('https://deepmind.google/blog/rss.xml', { ttl: 900 }), 'deepmind', 10);
}
