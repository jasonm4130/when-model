import { cachedJson, cachedText, decodeEntities, isHttpUrl, toIso } from '../fetch';

export interface FeedItem {
  source: 'hn' | 'openai' | 'deepmind' | 'anthropic' | 'github' | 'papers';
  title: string;
  url: string;
  publishedAt: string;
  score?: number;
  meta?: string;
  alert: boolean;
}

const MODEL_WORDS =
  /\b(gpt|openai|claude|anthropic|gemini|deepmind|gemma|grok|xai|deepseek|llama|meta ai|qwen|alibaba|mistral|kimi|moonshot|glm|z\.ai|minimax|llm|ai model|agi|frontier model|o\d|sora|veo|arena|benchmark|weights|open.?source model)\b/i;
/** Headlines shaped like a launch. Lab names alone do not count: Anthropic says "Claude" in every post. */
const RELEASE_WORDS =
  /\b(introducing|announcing|releas\w+|launch\w+|now available|new model|drops?|ships?|unveil\w*|preview|general availability|v?\d+(\.\d+)+)\b/i;

interface HnHit {
  title?: string;
  url?: string;
  points?: number;
  created_at?: string;
  objectID: string;
  num_comments?: number;
}

export async function fetchHackerNews(hours = 48, minPoints = 60): Promise<FeedItem[]> {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const q = `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=100&numericFilters=${encodeURIComponent(`points>${minPoints},created_at_i>${since}`)}`;
  const { hits } = await cachedJson<{ hits: HnHit[] }>(q, 300);
  const out: FeedItem[] = [];
  for (const h of hits ?? []) {
    const title = typeof h.title === 'string' ? h.title : '';
    const publishedAt = toIso(h.created_at);
    if (!title || !publishedAt || !MODEL_WORDS.test(title)) continue;
    const points = h.points ?? 0;
    out.push({
      source: 'hn',
      title,
      url: isHttpUrl(h.url)
        ? h.url
        : `https://news.ycombinator.com/item?id=${encodeURIComponent(h.objectID)}`,
      publishedAt,
      score: points,
      meta: `${points}▲ · ${h.num_comments ?? 0} comments`,
      alert: RELEASE_WORDS.test(title) && points >= 150,
    });
  }
  return out;
}

/** RSS 2.0 and Atom, regex-parsed: entries without a title, link and parseable date are dropped. */
export function parseFeed(xml: string, source: FeedItem['source'], limit: number): FeedItem[] {
  const out: FeedItem[] = [];
  for (const m of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const block = m[2];
    const pick = (tag: string) =>
      decodeEntities(block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? '');
    const title = pick('title');
    const link = pick('link') || block.match(/<link[^>]*href="([^"]+)"/)?.[1] || '';
    const publishedAt = toIso(pick('pubDate') || pick('dc:date') || pick('published') || pick('updated'));
    if (!title || !isHttpUrl(link) || !publishedAt) continue;
    out.push({ source, title, url: link, publishedAt, alert: RELEASE_WORDS.test(title) });
    if (out.length >= limit) break;
  }
  return out;
}

export async function fetchOpenAI(): Promise<FeedItem[]> {
  return parseFeed(await cachedText('https://openai.com/news/rss.xml', 900), 'openai', 12);
}

export async function fetchDeepMind(): Promise<FeedItem[]> {
  return parseFeed(await cachedText('https://deepmind.google/blog/rss.xml', 900), 'deepmind', 10);
}

const ANTHROPIC_CATEGORIES =
  /^(Announcements|Product|Policy|Research|Societal Impacts|Alignment|Interpretability|Education|Economic Research|Economic Index|Event|News|Case Study|Featured)\s*/i;
const CARD_DATE = /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}\s*/;

/** Anthropic publishes no RSS; scrape the news index. Cards without a parseable date are dropped. */
export async function fetchAnthropic(): Promise<FeedItem[]> {
  const html = await cachedText('https://www.anthropic.com/news', 900, { headers: { accept: 'text/html' } });
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const m of html.matchAll(/<a[^>]+href="(\/news\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const [, href, inner] = m;
    if (seen.has(href)) continue;
    const text = decodeEntities(inner.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    const dateM = text.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4})\b/);
    const publishedAt = toIso(dateM?.[1]);
    if (!publishedAt) continue;
    let title = text;
    for (let i = 0; i < 3; i++) title = title.replace(CARD_DATE, '').replace(ANTHROPIC_CATEGORIES, '').trim();
    title = title
      .replace(/(?<=[a-z0-9)])(On|In|Today|We|The|As|Our) [A-Z][a-z]+ \d{1,2},.*$/, '')
      .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}\b.*$/, '')
      .trim();
    if (title.length < 8) continue;
    seen.add(href);
    out.push({
      source: 'anthropic',
      title,
      url: `https://www.anthropic.com${href}`,
      publishedAt,
      alert: RELEASE_WORDS.test(title),
    });
    if (out.length >= 10) break;
  }
  return out;
}

interface GhRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
  body?: string;
  name?: string;
}
const SDK_REPOS = [
  ['anthropics/anthropic-sdk-python', 'Anthropic SDK'],
  ['openai/openai-python', 'OpenAI SDK'],
  ['googleapis/python-genai', 'Google GenAI SDK'],
  ['xai-org/xai-sdk-python', 'xAI SDK'],
] as const;

/** SDK releases: new model ids often land in changelogs before the blog post. Throws only if every repo fails. */
export async function fetchSdkReleases(): Promise<FeedItem[]> {
  const settled = await Promise.allSettled(
    SDK_REPOS.map(async ([repo, label]) => {
      const rel = await cachedJson<GhRelease[]>(
        `https://api.github.com/repos/${repo}/releases?per_page=2`,
        1800,
      );
      const out: FeedItem[] = [];
      for (const r of rel) {
        const publishedAt = toIso(r.published_at);
        if (!publishedAt || !isHttpUrl(r.html_url)) continue;
        const modelHint = (r.body ?? '').match(/\b(gpt|claude|gemini|grok)[-\w.]*\d[-\w.]*/i)?.[0];
        out.push({
          source: 'github',
          title: `${label} ${r.tag_name}${modelHint ? ` · mentions ${modelHint}` : ''}`,
          url: r.html_url,
          publishedAt,
          meta: repo,
          alert: !!modelHint,
        });
      }
      return out;
    }),
  );
  const failed = settled.filter((r) => r.status === 'rejected');
  if (failed.length === settled.length) {
    throw new Error(`all ${settled.length} repos failed: ${(failed[0] as PromiseRejectedResult).reason}`);
  }
  for (const f of failed) console.error('[source:github-sdks]', (f as PromiseRejectedResult).reason);
  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}
