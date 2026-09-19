import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('buildDashboard', () => {
  it('fans out to all nine sources, tolerates failures and memoises the result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const memo = vi.fn(async (_id: string, _ttl: number, build: () => Promise<unknown>) => build());
    vi.doMock('../../src/infra/edge-cache', () => ({ memoJson: memo }));
    vi.doMock('../../src/adapters/polymarket', () => ({ fetchMarkets: async () => [] }));
    vi.doMock('../../src/adapters/openrouter', () => ({
      fetchDrops: async () => [
        {
          id: 'openai/gpt-6',
          name: 'GPT-6',
          lab: 'OpenAI',
          labId: 'openai',
          createdAt: new Date().toISOString(),
          url: 'u',
          free: false,
        },
      ],
    }));
    vi.doMock('../../src/adapters/huggingface', () => ({
      fetchTrending: async () => [],
      fetchPapers: async () => [],
    }));
    vi.doMock('../../src/adapters/hacker-news', () => ({
      fetchHackerNews: async () => {
        throw new Error('algolia down');
      },
    }));
    vi.doMock('../../src/adapters/rss', () => ({
      fetchOpenAI: async () => [],
      fetchDeepMind: async () => [],
    }));
    vi.doMock('../../src/adapters/anthropic-news', () => ({ fetchAnthropic: async () => [] }));
    vi.doMock('../../src/adapters/github-releases', () => ({ fetchSdkReleases: async () => [] }));

    const { DASHBOARD_TTL_SECONDS, loadDashboard } = await import('../../src/app/load-dashboard');
    const d = await loadDashboard();
    expect(memo).toHaveBeenCalledWith('dashboard@v2', DASHBOARD_TTL_SECONDS, expect.any(Function));
    expect(d.sources).toHaveLength(9);
    expect(d.sources.find((s) => s.name === 'Hacker News')).toEqual({
      name: 'Hacker News',
      ok: false,
      error: 'algolia down',
    });
    expect(d.sources.filter((s) => s.ok)).toHaveLength(8);
    expect(d.labs.find((l) => l.id === 'openai')?.status).toBe('SHIPPING');
    expect(d.dropcon.degraded).toBe(false);
  });
});
