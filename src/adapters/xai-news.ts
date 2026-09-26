import { isReleaseHeadline, modelIds, type FeedItem } from '../domain/feed';
import { cachedText } from '../infra/edge-cache';
import { decodeEntities, toIso } from '../infra/text';

const RELEASE_NOTES_URL = 'https://docs.x.ai/developers/release-notes';
const MONTHS = new Map([
  ['january', 0],
  ['february', 1],
  ['march', 2],
  ['april', 3],
  ['may', 4],
  ['june', 5],
  ['july', 6],
  ['august', 7],
  ['september', 8],
  ['october', 9],
  ['november', 10],
  ['december', 11],
]);
const MONTH_HEADING = /<h2\b[^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi;
const ENTRY =
  /<div class="relative mt-12 grid[^"]*">([\s\S]*?)(?=<div class="relative mt-12 grid[^"]*">|$)/gi;

function plainText(html: string): string {
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function pageYear(html: string): number | undefined {
  const published = html.match(/"datePublished"\s*:\s*"(\d{4})-/)?.[1];
  return published ? Number(published) : undefined;
}

function headingMonth(heading: string): { month: string; year?: number } | undefined {
  const label = plainText(heading).toLowerCase();
  const match = label.match(/^([a-z]+)(?:\s+(\d{4}))?$/);
  if (!match || !MONTHS.has(match[1])) return undefined;
  return { month: match[1], year: match[2] ? Number(match[2]) : undefined };
}

function entryDate(block: string, month: string, year: number): string | undefined {
  const raw = block.match(/<div class="text-muted[^"]*"[^>]*>[\s\S]*?<div class="relative">([^<]+)/i)?.[1];
  const match = raw?.trim().match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (!match || match[1].toLowerCase() !== month) return undefined;
  return toIso(`${match[1]} ${match[2]}, ${year} UTC`);
}

/**
 * Mark the launch entry of each model. The notes come newest first and a model reappears in
 * follow-ups ("Grok 4.5 available in the EU" nine days after "Grok 4.5"), so only the oldest
 * entry naming a model may alert, and only when its title is launch-shaped.
 */
function markLaunches(items: FeedItem[]): FeedItem[] {
  const named = new Set<string>();
  for (let i = items.length - 1; i >= 0; i--) {
    const ids = modelIds(items[i].title);
    const first = ids.some((id) => !named.has(id));
    for (const id of ids) named.add(id);
    items[i].alert = first && isReleaseHeadline(items[i].title);
  }
  return items;
}

/**
 * Parse dated model notes from xAI's official developer release notes page. Entries carry a
 * date but no time, so every item is `day` precision, pinned to 00:00Z.
 */
export function parseXaiNews(html: string, limit = 12): FeedItem[] {
  const defaultYear = pageYear(html);
  if (!defaultYear) throw new Error('xAI release notes have no publication year metadata');

  const headings = [...html.matchAll(MONTH_HEADING)];
  const months = headings
    .map((match, index) => ({ match, index }))
    .map(({ match, index }) => ({
      start: match.index ?? 0,
      end: headings[index + 1]?.index ?? html.length,
      date: headingMonth(match[1]),
    }))
    .filter(
      (section): section is { start: number; end: number; date: NonNullable<typeof section.date> } =>
        section.date !== undefined,
    );
  if (!months.length) throw new Error('xAI release notes have no recognizable month sections');

  const items: FeedItem[] = [];
  const seen = new Set<string>();
  for (const section of months) {
    const body = html.slice(section.start, section.end);
    const year = section.date.year ?? defaultYear;
    for (const match of body.matchAll(ENTRY)) {
      const block = match[1];
      const heading = block.match(/<h3\b[^>]*\bid="([a-z0-9][a-z0-9-]*)"[^>]*>([\s\S]*?)<\/h3>/i);
      const title = heading ? plainText(heading[2]) : '';
      const publishedAt = entryDate(block, section.date.month, year);
      if (!heading || !title || !publishedAt) continue;

      const url = `${RELEASE_NOTES_URL}#${encodeURIComponent(heading[1])}`;
      if (seen.has(url)) continue;
      seen.add(url);
      items.push({ source: 'xai', title, url, publishedAt, precision: 'day', alert: false });
    }
  }

  if (!items.length) throw new Error('xAI release notes have no recognizable dated entries');
  return markLaunches(items).slice(0, limit);
}

export async function fetchXaiNews(): Promise<FeedItem[]> {
  return parseXaiNews(await cachedText(RELEASE_NOTES_URL, { ttl: 900, headers: { accept: 'text/html' } }));
}
