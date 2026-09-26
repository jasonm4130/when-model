import { describe, expect, it } from 'vitest';
import { assembleDashboard, type DashboardInputs } from '../../src/domain/dashboard';
import {
  EMPTY_LEDGER,
  LEDGER_KINDS,
  feedDayKind,
  firstSeenBatches,
  leakKind,
  ledgerFromRows,
} from '../../src/domain/ledger';

const NOW = Date.parse('2026-09-26T03:00:00Z');

describe('ledger kinds', () => {
  it('keeps one kind per leak source and per feed', () => {
    expect(leakKind('testingcatalog')).toBe('leak:testingcatalog');
    expect(feedDayKind('openai')).toBe('feed-day:openai');
    expect(LEDGER_KINDS).toEqual(
      expect.arrayContaining(['stealth', 'broadcast', 'architecture', 'feed-day:anthropic', 'feed-day:xai']),
    );
    expect(EMPTY_LEDGER.stealth.size).toBe(0);
  });
});

describe('ledgerFromRows', () => {
  it('maps sightings by kind and leaves seeded feed-day rows out', () => {
    const ledger = ledgerFromRows(
      [
        { kind: 'stealth', key: 's', firstSeenAt: '2026-09-20T00:00:00.000Z', seeded: true },
        { kind: 'broadcast', key: 'v', firstSeenAt: '2026-09-25T00:00:00.000Z', seeded: false },
        { kind: 'architecture', key: 'm', firstSeenAt: '2026-09-21T00:00:00.000Z', seeded: false },
        { kind: 'feed-day:anthropic', key: 'new', firstSeenAt: '2026-09-25T17:45:00.000Z', seeded: false },
        { kind: 'feed-day:anthropic', key: 'old', firstSeenAt: '2026-09-01T00:00:00.000Z', seeded: true },
        { kind: 'leak:hn', key: 'l', firstSeenAt: '2026-09-25T00:00:00.000Z', seeded: false },
      ],
      { p: 0.4, observedAt: '2026-09-25T03:00:40.000Z' },
    );
    expect(ledger.stealth.get('s')).toBe('2026-09-20T00:00:00.000Z');
    expect(ledger.broadcast.get('v')).toBe('2026-09-25T00:00:00.000Z');
    expect(ledger.architecture.get('m')).toBe('2026-09-21T00:00:00.000Z');
    expect([...ledger.feedDay.keys()]).toEqual(['new']);
    expect(ledger.headlineDayAgo).toEqual({ p: 0.4, observedAt: '2026-09-25T03:00:40.000Z' });
    expect(ledgerFromRows([]).headlineDayAgo).toBeUndefined();
  });
});

describe('firstSeenBatches', () => {
  const inputs = (overrides: Partial<DashboardInputs> = {}): DashboardInputs => ({
    markets: { name: 'Polymarket', ok: true, data: [] },
    drops: {
      name: 'OpenRouter',
      ok: true,
      data: [
        {
          id: 'stealth/ox-alpha',
          name: 'Ox Alpha',
          lab: 'Stealth',
          createdAt: '2026-09-25T00:00:00.000Z',
          url: 'https://openrouter.ai/stealth/ox-alpha',
          free: true,
        },
      ],
    },
    trending: { name: 'HF trending', ok: true, data: [] },
    papers: { name: 'HF papers', ok: true, data: [] },
    feeds: [
      {
        name: 'Anthropic news',
        ok: true,
        data: [
          {
            source: 'anthropic',
            title: 'Day post',
            url: 'https://a.test/day',
            publishedAt: '2026-09-25T00:00:00.000Z',
            alert: false,
            precision: 'day',
          },
          {
            source: 'anthropic',
            title: 'Timed post',
            url: 'https://a.test/t',
            publishedAt: '2026-09-25T10:00:00.000Z',
            alert: false,
          },
        ],
      },
      { name: 'xAI news', ok: false, error: 'down', data: [] },
    ],
    leaks: [
      {
        name: 'HN leaks',
        ok: true,
        source: 'hn',
        data: [
          {
            source: 'hn',
            title: 'GPT-7 spotted',
            url: 'https://hn.test/1',
            publishedAt: '2026-09-25T00:00:00.000Z',
            modelIds: ['gpt-7'],
            cue: 'spotted',
          },
        ],
      },
      { name: 'TestingCatalog', ok: false, error: 'timeout', source: 'testingcatalog', data: [] },
    ],
    broadcasts: {
      name: 'YouTube broadcasts',
      ok: true,
      data: [
        {
          videoId: 'v1',
          channel: 'OpenAI',
          labId: 'openai',
          title: 'Live',
          url: 'u',
          publishedAt: '2026-09-25T00:00:00.000Z',
          views: 0,
        },
      ],
    },
    architectures: {
      name: 'transformers registry',
      ok: true,
      data: [
        {
          module: 'qwen9_next',
          labId: 'qwen',
          since: '2026-09-25T00:00:00.000Z',
          sinceSource: 'detected',
          daysPending: 1,
          pending: true,
        },
      ],
    },
    ...overrides,
  });

  it('records every kind whose source was ok, keyed as the read side reads it', () => {
    const batches = firstSeenBatches(assembleDashboard(inputs(), NOW));
    expect(batches.map((b) => [b.kind, b.source, b.items.map((i) => i.key)])).toEqual([
      ['stealth', 'openrouter', ['stealth/ox-alpha']],
      ['broadcast', 'youtube', ['v1']],
      ['architecture', 'transformers', ['qwen9_next']],
      ['leak:hn', 'hn', ['https://hn.test/1']],
      ['feed-day:anthropic', 'anthropic', ['https://a.test/day']],
    ]);
  });

  it('records nothing from a source that failed or returned a partial list', () => {
    const batches = firstSeenBatches(
      assembleDashboard(
        inputs({
          drops: { name: 'OpenRouter', ok: false, error: 'down', data: [] },
          broadcasts: { name: 'YouTube broadcasts', ok: false, error: 'Anthropic feed failed', data: [] },
          architectures: { name: 'transformers registry', ok: false, error: 'down', data: [] },
          leaks: [{ name: 'HN leaks', ok: false, error: 'down', source: 'hn', data: [] }],
        }),
        NOW,
      ),
    );
    expect(batches.map((b) => b.kind)).toEqual(['feed-day:anthropic']);
  });
});
