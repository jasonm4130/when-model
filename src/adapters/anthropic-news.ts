import { looksLikeRelease, type FeedItem } from '../domain/feed';
import { cachedText } from '../infra/edge-cache';
import { decodeEntities, toIso } from '../infra/text';

const NEWS_URL = 'https://www.anthropic.com/news';
const CARD_LINK = /<a[^>]+href="(\/news\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g;
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const CARD_DATE = new RegExp(`\\b(${MONTH} \\d{1,2}, \\d{4})\\b`);
const LEADING_DATE = new RegExp(`^${MONTH} \\d{1,2}, \\d{4}\\s*`);
const LEADING_CATEGORY =
  /^(Announcements|Product|Policy|Research|Societal Impacts|Alignment|Interpretability|Education|Economic Research|Economic Index|Event|News|Case Study|Featured)\s*/i;
/** Some cards glue the first sentence of the body onto the title ("…effortsOn July 30, we…"). */
const GLUED_BODY = /(?<=[a-z0-9)])(On|In|Today|We|The|As|Our) [A-Z][a-z]+ \d{1,2},.*$/;
const TRAILING_DATE = new RegExp(`\\b${MONTH} \\d{1,2}, \\d{4}\\b.*$`);

function cleanTitle(cardText: string): string {
  let title = cardText;
  for (let i = 0; i < 3; i++) title = title.replace(LEADING_DATE, '').replace(LEADING_CATEGORY, '').trim();
  return title.replace(GLUED_BODY, '').replace(TRAILING_DATE, '').trim();
}

/** Anthropic publishes no RSS; parse the newsroom index. Cards without a date are dropped. */
export function parseAnthropicNews(html: string, limit = 10): FeedItem[] {
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const [, href, inner] of html.matchAll(CARD_LINK)) {
    if (seen.has(href)) continue;
    const text = decodeEntities(inner.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    const cardDate = text.match(CARD_DATE)?.[1];
    // Card dates carry no zone; pin them to UTC so the render host's zone cannot shift the day.
    const publishedAt = cardDate ? toIso(`${cardDate} UTC`) : undefined;
    const title = cleanTitle(text);
    if (!publishedAt || title.length < 8) continue;
    seen.add(href);
    out.push({
      source: 'anthropic',
      title,
      url: `https://www.anthropic.com${href}`,
      publishedAt,
      alert: looksLikeRelease(title),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function fetchAnthropic(): Promise<FeedItem[]> {
  return parseAnthropicNews(await cachedText(NEWS_URL, { ttl: 900, headers: { accept: 'text/html' } }));
}
