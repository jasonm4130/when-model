import { fetchXaiNews } from '../adapters/xai-news';
import { fetchAnthropic } from '../adapters/anthropic-news';
import { fetchSdkReleases } from '../adapters/github-releases';
import { fetchHackerNews } from '../adapters/hacker-news';
import { fetchPapers, fetchTrending } from '../adapters/huggingface';
import { fetchDrops } from '../adapters/openrouter';
import { fetchMarkets } from '../adapters/polymarket';
import { fetchDeepMind, fetchOpenAI } from '../adapters/rss';
import {
  DASHBOARD_SCHEMA,
  assembleDashboard,
  type Dashboard,
  type DashboardInputs,
} from '../domain/dashboard';
import { memoJson } from '../infra/edge-cache';
import { collect } from '../infra/source-result';

/** How long one assembled dashboard is shared by every render in a colo. */
export const DASHBOARD_TTL_SECONDS = 120;

/** Fan out to every source, tolerate individual failures, assemble. */
export async function buildDashboard(now = Date.now()): Promise<Dashboard> {
  const [markets, drops, trending, papers, ...feeds] = await Promise.all([
    collect('Polymarket', fetchMarkets, []),
    collect('OpenRouter', fetchDrops, []),
    collect('HF trending', fetchTrending, []),
    collect('HF papers', fetchPapers, []),
    collect('Hacker News', fetchHackerNews, []),
    collect('OpenAI news', fetchOpenAI, []),
    collect('DeepMind blog', fetchDeepMind, []),
    collect('Anthropic news', fetchAnthropic, []),
    collect('xAI news', fetchXaiNews, []),
    collect('GitHub SDKs', fetchSdkReleases, []),
  ]);
  const inputs: DashboardInputs = { markets, drops, trending, papers, feeds };
  return assembleDashboard(inputs, now);
}

/** The dashboard every request renders: memoised at the edge. */
export function loadDashboard(): Promise<Dashboard> {
  return memoJson(`dashboard@v${DASHBOARD_SCHEMA}`, DASHBOARD_TTL_SECONDS, () => buildDashboard());
}
