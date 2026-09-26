import { isReleaseHeadline, precisionOf, type FeedItem } from '../domain/feed';
import { cachedText } from '../infra/edge-cache';
import { decodeEntities, toIso } from '../infra/text';

const ORIGIN = 'https://www.anthropic.com';
const NEWS_URL = `${ORIGIN}/news`;
/**
 * Launch posts live at the site root (`/claude-opus-5-5`), features one level down, and some
 * cards link absolutely; the v2 scraper only took `/news/<slug>` and never saw a launch.
 */
const CARD_LINK =
  /<a[^>]+href="(?:https:\/\/www\.anthropic\.com)?(\/(?:[a-z0-9-]+\/)?[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g;
const TIME_EL = /<time\b[^>]*>([\s\S]*?)<\/time>/;
const TITLE_EL =
  /<(h[1-6]|span|p|div)\b[^>]*class="[^"]*__(?:title|featuredTitle)\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/;
const HEADING = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/;
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const CARD_DATE = new RegExp(`\\b(${MONTH} \\d{1,2}, \\d{4})\\b`);
/** The page's embedded post list (escaped JSON inside a script) carries exact publish times. */
const PUBLISHED_ON =
  /publishedOn\\?":\\?"([^"\\]+)\\?",\\?"slug\\?":\{\\?"_type\\?":\\?"slug\\?",\\?"current\\?":\\?"([a-z0-9-]+)/g;

function text(html: string): string {
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** slug → exact ISO publish time, from the page data. Featured launch cards are not in it. */
function publishTimes(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, at, slug] of html.matchAll(PUBLISHED_ON)) {
    const iso = toIso(at);
    if (iso && !out.has(slug)) out.set(slug, iso);
  }
  return out;
}

/**
 * Anthropic publishes no RSS; parse the newsroom index. A card needs a `<time>` and a title
 * element. Cards are sorted newest first before the limit, because the featured grid (where
 * launches sit) is out of date order. Exact times come from the page data where it has the
 * slug; otherwise the card date is pinned to 00:00Z with `day` precision.
 */
export function parseAnthropicNews(html: string, limit = 10): FeedItem[] {
  const exact = publishTimes(html);
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const [, path, inner] of html.matchAll(CARD_LINK)) {
    const time = inner.match(TIME_EL);
    const cardDate = time ? text(time[1]).match(CARD_DATE)?.[1] : undefined;
    const titleEl = inner.match(TITLE_EL) ?? inner.match(HEADING);
    const title = titleEl ? text(titleEl[2]) : '';
    const at = exact.get(path.split('/').pop() ?? '');
    // Card dates carry no zone; pin them to UTC so the render host's zone cannot shift the day.
    const publishedAt = cardDate ? (at ?? toIso(`${cardDate} UTC`)) : undefined;
    if (seen.has(path) || !publishedAt || title.length < 8) continue;
    seen.add(path);
    out.push({
      source: 'anthropic',
      title,
      url: `${ORIGIN}${path}`,
      publishedAt,
      // 13 of 263 page-data times sit at 00:00:00Z: a date, not a moment.
      precision: at ? precisionOf(at) : 'day',
      alert: isReleaseHeadline(title),
    });
  }
  if (!out.length) throw new Error('Anthropic newsroom has no dated cards');
  return out.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, limit);
}

export async function fetchAnthropic(): Promise<FeedItem[]> {
  return parseAnthropicNews(await cachedText(NEWS_URL, { ttl: 900, headers: { accept: 'text/html' } }));
}
