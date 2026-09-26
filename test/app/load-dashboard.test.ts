import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BroadcastCandidate } from '../../src/domain/lead';
import { writeScoreSeries, type SnapshotDatabase } from '../../src/infra/snapshot-store';
import { SqliteD1 } from '../infra/sqlite-d1';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('cloudflare:workers');
  vi.restoreAllMocks();
});

const NOW = Date.parse('2026-09-20T00:00:00Z');

const candidate: BroadcastCandidate = {
  videoId: 'v1',
  channel: 'OpenAI',
  labId: 'openai',
  title: 'OpenAI DevDay livestream',
  url: 'https://www.youtube.com/watch?v=v1',
  publishedAt: '2026-09-19T20:00:00.000Z',
  views: 0,
};

interface Upstreams {
  database?: SnapshotDatabase;
  youtube?: () => Promise<{
    candidates: BroadcastCandidate[];
    failedChannels: string[];
    staleChannels?: string[];
  }>;
  modules?: () => Promise<string[]>;
  markets?: () => Promise<unknown[]>;
}

/** Every adapter mocked; Hacker News fails so one degraded source is always in the list. */
async function load(up: Upstreams = {}) {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const memo = vi.fn(async (_id: string, _ttl: number, build: () => Promise<unknown>) => build());
  vi.doMock('cloudflare:workers', () => ({ env: up.database ? { HISTORY_DB: up.database } : {} }));
  vi.doMock('../../src/infra/edge-cache', () => ({ memoJson: memo }));
  vi.doMock('../../src/adapters/polymarket', () => ({ fetchMarkets: up.markets ?? (async () => []) }));
  vi.doMock('../../src/adapters/openrouter', () => ({
    fetchDrops: async () => [
      {
        id: 'openai/gpt-6',
        name: 'GPT-6',
        lab: 'OpenAI',
        labId: 'openai',
        createdAt: new Date(NOW).toISOString(),
        url: 'u',
        free: false,
      },
      {
        id: 'qwen/qwen4-72b',
        name: 'Qwen4 72B',
        lab: 'Qwen',
        labId: 'qwen',
        createdAt: '2026-09-01T00:00:00.000Z',
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
    fetchHackerNewsLeaks: async () => [],
    fetchHackerNewsLaunches: async () => [],
  }));
  vi.doMock('../../src/adapters/testingcatalog', () => ({ fetchTestingCatalogLeaks: async () => [] }));
  vi.doMock('../../src/adapters/youtube', () => ({
    fetchBroadcasts: up.youtube ?? (async () => ({ candidates: [], failedChannels: [] })),
  }));
  vi.doMock('../../src/adapters/transformers-arch', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/adapters/transformers-arch')>()),
    fetchTransformersModules: up.modules ?? (async () => ['qwen9_next', 'qwen4_exp']),
  }));
  vi.doMock('../../src/adapters/rss', () => ({
    fetchOpenAI: async () => [],
    fetchDeepMind: async () => [],
  }));
  vi.doMock('../../src/adapters/xai-news', () => ({ fetchXaiNews: async () => [] }));
  vi.doMock('../../src/adapters/anthropic-news', () => ({ fetchAnthropic: async () => [] }));
  vi.doMock('../../src/adapters/github-releases', () => ({ fetchSdkReleases: async () => [] }));
  const mod = await import('../../src/app/load-dashboard');
  return { ...mod, memo, log };
}

describe('buildDashboard', () => {
  it('fans out to all sixteen sources, tolerates failures and memoises the result under the schema', async () => {
    const { DASHBOARD_TTL_SECONDS, loadDashboard, memo } = await load({ database: new SqliteD1() });
    const d = await loadDashboard();
    expect(memo).toHaveBeenCalledWith('dashboard@v4', DASHBOARD_TTL_SECONDS, expect.any(Function));
    expect(d.sources.map((s) => s.name)).toEqual([
      'Polymarket',
      'OpenRouter',
      'HF trending',
      'HF papers',
      'Hacker News',
      'OpenAI news',
      'DeepMind blog',
      'Anthropic news',
      'xAI news',
      'GitHub SDKs',
      'HN leaks',
      'TestingCatalog',
      'HN launch stories',
      'YouTube broadcasts',
      'transformers registry',
      'First-seen ledger',
    ]);
    expect(d.sources.find((s) => s.name === 'Hacker News')).toEqual({
      name: 'Hacker News',
      ok: false,
      error: 'algolia down',
    });
    expect(d.sources.filter((s) => s.ok)).toHaveLength(15);
    expect(d.labs.find((l) => l.id === 'openai')?.status).toBe('SHIPPING');
    expect(d.dropcon.degraded).toBe(false);
    // Build-time wall clock never leaks into the dashboard.
    expect(JSON.stringify(d.sources)).not.toContain('"ms"');
  });

  it('logs one build line with per-source timings and the unmapped release markets', async () => {
    const orphan = {
      slug: 'o',
      title: 'Next Mystery Model released by...?',
      url: 'u',
      vol24: 0,
      volume: 0,
      kind: 'release',
      outcomes: [{ label: 'October 31', yes: 0.2, closed: false, vol24: 0 }],
    };
    const { buildDashboard, log } = await load({ markets: async () => [orphan] });
    await buildDashboard(NOW, undefined);
    const build = log.mock.calls.find((c) => c[0] === '[dashboard:build]');
    const parsed = JSON.parse(String(build?.[1]));
    expect(parsed.ms).toBe(0);
    expect(Object.keys(parsed.sources)).toHaveLength(16);
    const unmapped = log.mock.calls.find((c) => c[0] === '[diagnostic:unmapped-release-markets]');
    expect(JSON.parse(String(unmapped?.[1]))).toEqual({
      count: 1,
      titles: ['Next Mystery Model released by...?'],
    });
  });

  it('shows a partial YouTube poll but marks it not ok, so it can never seed the ledger', async () => {
    const { buildDashboard } = await load({
      youtube: async () => ({ candidates: [candidate], failedChannels: ['Anthropic'] }),
    });
    const d = await buildDashboard(NOW, undefined);
    expect(d.sources.find((s) => s.name === 'YouTube broadcasts')).toEqual({
      name: 'YouTube broadcasts',
      ok: false,
      error: 'Anthropic feed failed',
    });
    expect(d.earlyWarnings.broadcasts.ok).toBe(false);
    expect(d.earlyWarnings.broadcasts.items.map((b) => b.videoId)).toEqual(['v1']);
  });

  it('counts a channel read from its last good copy as complete, so the poll stays ok', async () => {
    const { buildDashboard } = await load({
      youtube: async () => ({ candidates: [candidate], failedChannels: [], staleChannels: ['Anthropic'] }),
    });
    const d = await buildDashboard(NOW, undefined);
    expect(d.sources.find((s) => s.name === 'YouTube broadcasts')).toEqual({
      name: 'YouTube broadcasts',
      ok: true,
    });
    expect(d.earlyWarnings.broadcasts.ok).toBe(true);
  });

  it('degrades the ledger to empty without a binding, and every lead signal still renders', async () => {
    const { buildDashboard } = await load({
      youtube: async () => {
        throw new Error('all 4 YouTube channels failed');
      },
    });
    const d = await buildDashboard(NOW, undefined);
    expect(d.sources.find((s) => s.name === 'First-seen ledger')).toEqual({
      name: 'First-seen ledger',
      ok: false,
      error: 'HISTORY_DB binding is not configured',
    });
    expect(d.sources.find((s) => s.name === 'YouTube broadcasts')?.ok).toBe(false);
    expect(d.measurement.inputs.p7DayAgo).toBeNull();
    // qwen4_exp is seeded and listed (Qwen4 72B); qwen9_next is new to the baseline and unlisted.
    expect(d.earlyWarnings.architectures.ok).toBe(true);
    expect(d.earlyWarnings.architectures.items.map((a) => [a.module, a.sinceSource])).toEqual([
      ['qwen9_next', 'detected'],
    ]);
  });

  it('reads first sightings and the day-old P7 from D1', async () => {
    const db = new SqliteD1();
    await writeScoreSeries(db, {
      slot: '2026-09-19T00:00:00.000Z',
      observedAt: '2026-09-19T00:00:40.000Z',
      algorithmVersion: 3,
      score: 20,
      level: 4,
      headlineP: 0.25,
      degraded: false,
    });
    const { recordFirstSeen } = await import('../../src/infra/snapshot-store');
    await recordFirstSeen(
      db,
      'architecture',
      'transformers',
      [{ key: 'qwen9_next' }],
      '2026-09-18T00:00:00.000Z',
    );
    const { buildDashboard } = await load({ database: db });
    const d = await buildDashboard(NOW, db);
    expect(d.sources.find((s) => s.name === 'First-seen ledger')?.ok).toBe(true);
    expect(d.measurement.inputs.p7DayAgo).toBe(0.25);
    expect(d.earlyWarnings.architectures.items[0]).toMatchObject({
      module: 'qwen9_next',
      since: '2026-09-18T00:00:00.000Z',
      sinceSource: 'first-seen',
    });
  });

  it('marks the architectures down with the registry, keeping its error', async () => {
    const { buildDashboard } = await load({
      modules: async () => {
        throw new Error('both mirrors failed');
      },
    });
    const d = await buildDashboard(NOW, undefined);
    expect(d.sources.find((s) => s.name === 'transformers registry')).toEqual({
      name: 'transformers registry',
      ok: false,
      error: 'both mirrors failed',
    });
    expect(d.earlyWarnings.architectures.items).toEqual([]);
  });
});
