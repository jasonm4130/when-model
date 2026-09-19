import { LABS } from './labs';
import { safe } from './fetch';
import { fetchMarkets, releaseOddsForLab, type Market } from './sources/polymarket';
import { fetchDrops, monthlyHistogram, type Drop } from './sources/openrouter';
import { fetchTrending, fetchPapers, type Trending, type Paper } from './sources/huggingface';
import { fetchHackerNews, fetchOpenAI, fetchDeepMind, fetchAnthropic, fetchSdkReleases, type FeedItem } from './sources/feed';
import { computeDropcon, type Dropcon } from './dropcon';

export interface LabStatus {
  id: string;
  name: string;
  short: string;
  color: string;
  glyph: string;
  x: string[];
  pmCompany: string;
  latest?: Drop;
  daysSince?: number;
  drops30d: number;
  histogram: number[];
  weekOdds?: ReturnType<typeof releaseOddsForLab>;
  monthOdds?: ReturnType<typeof releaseOddsForLab>;
  leaderboardOdds?: number;
  /** 0..100 composite heat */
  heat: number;
  status: 'QUIET' | 'WARM' | 'HOT' | 'SHIPPING';
}

export interface Dashboard {
  generatedAt: string;
  dropcon: Dropcon;
  labs: LabStatus[];
  markets: Market[];
  bestModelMarket?: Market;
  drops: Drop[];
  trending: Trending[];
  papers: Paper[];
  feed: FeedItem[];
  sources: { name: string; ok: boolean; error?: string }[];
}

export async function buildDashboard(): Promise<Dashboard> {
  const now = Date.now();
  const [markets, drops, trending, papers, hn, openai, deepmind, anthropic, sdk] = await Promise.all([
    safe('polymarket', fetchMarkets, [] as Market[]),
    safe('openrouter', fetchDrops, [] as Drop[]),
    safe('hf-trending', fetchTrending, [] as Trending[]),
    safe('hf-papers', fetchPapers, [] as Paper[]),
    safe('hackernews', fetchHackerNews, [] as FeedItem[]),
    safe('openai-rss', fetchOpenAI, [] as FeedItem[]),
    safe('deepmind-rss', fetchDeepMind, [] as FeedItem[]),
    safe('anthropic-news', fetchAnthropic, [] as FeedItem[]),
    safe('github-sdks', fetchSdkReleases, [] as FeedItem[]),
  ]);

  const bestModelMarket = markets.data
    .filter((m) => /which company has the best ai model end of/i.test(m.title))
    .sort((a, b) => b.vol24 - a.vol24)[0];

  const labs: LabStatus[] = LABS.map((lab) => {
    const mine = drops.data.filter((d) => d.labId === lab.id);
    const latest = mine[0];
    const daysSince = latest ? Math.floor((now - Date.parse(latest.createdAt)) / 86400_000) : undefined;
    const drops30d = mine.filter((d) => now - Date.parse(d.createdAt) < 30 * 86400_000).length;
    const weekOdds = releaseOddsForLab(markets.data, lab.id, 7, now);
    const monthOdds = releaseOddsForLab(markets.data, lab.id, 31, now);
    const leaderboardOdds = bestModelMarket?.outcomes.find((o) => o.label === lab.pmCompany)?.yes;
    const recency = daysSince === undefined ? 0 : Math.max(0, 30 - Math.min(daysSince, 30)) / 30;
    const heat = Math.round(Math.min(100, (weekOdds?.p ?? 0) * 55 + (monthOdds?.p ?? 0) * 20 + recency * 15 + Math.min(drops30d, 3) * 3.3));
    const status: LabStatus['status'] = daysSince !== undefined && daysSince <= 2 ? 'SHIPPING' : heat >= 60 ? 'HOT' : heat >= 25 ? 'WARM' : 'QUIET';
    return {
      id: lab.id, name: lab.name, short: lab.short, color: lab.color, glyph: lab.glyph, x: lab.x, pmCompany: lab.pmCompany,
      latest, daysSince, drops30d, histogram: monthlyHistogram(mine, 12, new Date(now)),
      weekOdds, monthOdds, leaderboardOdds, heat, status,
    };
  }).sort((a, b) => b.heat - a.heat);

  const feed = [...hn.data, ...openai.data, ...deepmind.data, ...anthropic.data, ...sdk.data]
    .filter((f) => f.title && f.url)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 60);

  const frontierIds = new Set(['openai', 'anthropic', 'google', 'xai', 'deepseek', 'qwen', 'meta']);
  const dropcon = computeDropcon({
    maxWeekOdds: Math.max(0, ...labs.map((l) => l.weekOdds?.p ?? 0)),
    maxMonthOdds: Math.max(0, ...labs.map((l) => l.monthOdds?.p ?? 0)),
    frontierDrops7d: drops.data.filter((d) => d.labId && frontierIds.has(d.labId) && now - Date.parse(d.createdAt) < 7 * 86400_000).length,
    hotStories: hn.data.filter((h) => (h.score ?? 0) >= 150).length,
    releaseAlerts: feed.filter((f) => f.alert && now - Date.parse(f.publishedAt) < 48 * 3600_000).length,
  });

  return {
    generatedAt: new Date(now).toISOString(),
    dropcon,
    labs,
    markets: markets.data.sort((a, b) => b.vol24 - a.vol24),
    bestModelMarket,
    drops: drops.data.slice(0, 40),
    trending: trending.data,
    papers: papers.data,
    feed,
    sources: [
      { name: 'Polymarket', ...markets }, { name: 'OpenRouter', ...drops }, { name: 'HF trending', ...trending },
      { name: 'HF papers', ...papers }, { name: 'Hacker News', ...hn }, { name: 'OpenAI news', ...openai },
      { name: 'DeepMind blog', ...deepmind }, { name: 'Anthropic news', ...anthropic }, { name: 'GitHub SDKs', ...sdk },
    ].map(({ name, ok, error }) => ({ name, ok, error })),
  };
}
