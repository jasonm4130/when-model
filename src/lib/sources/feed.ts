import { cachedJson, cachedText, decodeEntities } from '../fetch';

export interface FeedItem {
  source: 'hn' | 'openai' | 'deepmind' | 'anthropic' | 'github' | 'papers';
  title: string;
  url: string;
  publishedAt: string;
  score?: number;
  meta?: string;
  alert: boolean;
}

const MODEL_WORDS = /\b(gpt|openai|claude|anthropic|gemini|deepmind|gemma|grok|xai|deepseek|llama|meta ai|qwen|alibaba|mistral|kimi|moonshot|glm|z\.ai|minimax|llm|ai model|agi|frontier model|o\d|sora|veo|arena|benchmark|weights|open.?source model)\b/i;
const RELEASE_WORDS = /\b(introducing|announcing|releas\w+|launch\w+|now available|new model|drops?|ships?|unveil\w*|preview|v?\d+(\.\d+)+)\b/i;

interface HnHit { title: string; url?: string; points: number; created_at: string; objectID: string; num_comments: number }

export async function fetchHackerNews(hours = 48, minPoints = 60): Promise<FeedItem[]> {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const q = `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=100&numericFilters=${encodeURIComponent(`points>${minPoints},created_at_i>${since}`)}`;
  const { hits } = await cachedJson<{ hits: HnHit[] }>(q, 300);
  return hits
    .filter((h) => MODEL_WORDS.test(h.title))
    .map((h) => ({
      source: 'hn' as const,
      title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      publishedAt: h.created_at,
      score: h.points,
      meta: `${h.points}▲ · ${h.num_comments} comments`,
      alert: RELEASE_WORDS.test(h.title) && h.points >= 150,
    }));
}

function parseRss(xml: string, source: FeedItem['source'], limit: number): FeedItem[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit);
  return items.map((m) => {
    const block = m[1];
    const pick = (tag: string) => decodeEntities(block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? '');
    const title = pick('title');
    const date = pick('pubDate') || pick('dc:date');
    return {
      source,
      title,
      url: pick('link') || block.match(/<link[^>]*href="([^"]+)"/)?.[1] || '',
      publishedAt: new Date(date || Date.now()).toISOString(),
      alert: /\b(introducing|announcing|releas|launch|new model|gpt|gemini|claude|available)\w*/i.test(title),
    };
  });
}

export async function fetchOpenAI(): Promise<FeedItem[]> {
  return parseRss(await cachedText('https://openai.com/news/rss.xml', 900), 'openai', 12);
}

export async function fetchDeepMind(): Promise<FeedItem[]> {
  return parseRss(await cachedText('https://deepmind.google/blog/rss.xml', 900), 'deepmind', 10);
}

/** Anthropic publishes no RSS; scrape the news index for slugs + titles. Degrades to nothing. */
export async function fetchAnthropic(): Promise<FeedItem[]> {
  const html = await cachedText('https://www.anthropic.com/news', 900, { headers: { accept: 'text/html' } });
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const m of html.matchAll(/<a[^>]+href="(\/news\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const [, href, inner] = m;
    if (seen.has(href)) continue;
    const title = decodeEntities(inner.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')).replace(/\s+/g, ' ').trim();
    const dateM = inner.match(/\b(\w{3} \d{1,2}, \d{4})\b/);
    if (title.length < 8) continue;
    seen.add(href);
    const CATS = /^(Announcements|Product|Policy|Research|Societal Impacts|Alignment|Interpretability|Education|Economic Research|Economic Index|Event|News|Case Study|Featured)\s*/i;
    const DATE = /^\w{3} \d{1,2}, \d{4}\s*/;
    let clean = title;
    for (let i = 0; i < 3; i++) clean = clean.replace(DATE, '').replace(CATS, '').trim();
    clean = clean.replace(/(?<=[a-z0-9)])(On|In|Today|We|The|As|Our) [A-Z][a-z]+ \d{1,2},.*$/, '').replace(/\s*(Announcements|Product|Policy|Research|Societal Impacts|Alignment|Interpretability|Education)\s*$/i, '').replace(/\b\w{3} \d{1,2}, \d{4}\b.*$/, '').trim();
    out.push({
      source: 'anthropic',
      title: clean || title,
      url: `https://www.anthropic.com${href}`,
      publishedAt: dateM ? new Date(dateM[1]).toISOString() : new Date().toISOString(),
      alert: /claude|introducing|announc/i.test(clean),
    });
    if (out.length >= 10) break;
  }
  return out;
}

interface GhRelease { tag_name: string; html_url: string; published_at: string; body?: string; name?: string }
const SDK_REPOS = [
  ['anthropics/anthropic-sdk-python', 'Anthropic SDK'],
  ['openai/openai-python', 'OpenAI SDK'],
  ['googleapis/python-genai', 'Google GenAI SDK'],
  ['xai-org/xai-sdk-python', 'xAI SDK'],
] as const;

/** SDK releases: new model ids often land in changelogs before the blog post. */
export async function fetchSdkReleases(): Promise<FeedItem[]> {
  const all = await Promise.allSettled(
    SDK_REPOS.map(async ([repo, label]) => {
      const rel = await cachedJson<GhRelease[]>(`https://api.github.com/repos/${repo}/releases?per_page=2`, 1800);
      return rel.map((r) => {
        const body = (r.body ?? '').replace(/\r/g, '');
        const modelHint = body.match(/\b(gpt|claude|gemini|grok)[-\w.]*\d[-\w.]*/i)?.[0];
        return {
          source: 'github' as const,
          title: `${label} ${r.tag_name}${modelHint ? ` · mentions ${modelHint}` : ''}`,
          url: r.html_url,
          publishedAt: r.published_at,
          meta: repo,
          alert: !!modelHint,
        };
      });
    }),
  );
  return all.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}
