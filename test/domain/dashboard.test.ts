import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  assembleDashboard,
  type DashboardInputs,
  type SourceResult,
} from '../../src/domain/dashboard';
import type { Drop } from '../../src/domain/drop';
import type { FeedItem } from '../../src/domain/feed';
import type { Market } from '../../src/domain/market';

const NOW = Date.parse('2026-09-19T12:00:00Z');
const ok = <T>(name: string, data: T): SourceResult<T> => ({ name, data, ok: true });
const failed = <T>(name: string, data: T): SourceResult<T> => ({ name, data, ok: false, error: 'boom' });

const drop = (labId: Drop['labId'], iso: string): Drop => ({
  id: `${labId}/x`,
  name: 'x',
  lab: 'x',
  labId,
  createdAt: iso,
  url: 'u',
  free: false,
});
const item = (title: string, iso: string, extra: Partial<FeedItem> = {}): FeedItem => ({
  source: 'hn',
  title,
  url: 'u',
  publishedAt: iso,
  alert: false,
  ...extra,
});

const empty = (): DashboardInputs => ({
  markets: ok('Polymarket', []),
  drops: ok('OpenRouter', []),
  trending: ok('HF trending', []),
  papers: ok('HF papers', []),
  feeds: [],
});

describe('assembleDashboard', () => {
  it('produces a quiet, healthy dashboard from empty inputs', () => {
    const d = assembleDashboard(empty(), NOW);
    expect(d.generatedAt).toBe('2026-09-19T12:00:00.000Z');
    expect(d.dropcon.level).toBe(5);
    expect(d.dropcon.degraded).toBe(false);
    expect(d.labs).toHaveLength(10);
    expect(d.sources.every((s) => s.ok)).toBe(true);
    expect(d.bestModelMarket).toBeUndefined();
  });

  it('marks DROPCON degraded and lists the failing source when Polymarket is down', () => {
    const inputs = { ...empty(), markets: failed('Polymarket', [] as Market[]) };
    const d = assembleDashboard(inputs, NOW);
    expect(d.dropcon.degraded).toBe(true);
    expect(d.sources.find((s) => s.name === 'Polymarket')).toEqual({
      name: 'Polymarket',
      ok: false,
      error: 'boom',
    });
  });

  it('ranks labs by heat, sorts markets by volume and caps every list', () => {
    const release: Market = {
      slug: 'a',
      title: 'Gemini 4 released by...?',
      url: 'u',
      vol24: 5,
      volume: 0,
      kind: 'release',
      labId: 'google',
      outcomes: [{ label: 'Sept 24', yes: 0.9, endDate: '2026-09-25T00:00:00Z', closed: false, vol24: 5 }],
    };
    const board: Market = {
      slug: 'b',
      title: 'Which company has the best AI model end of September?',
      url: 'u',
      vol24: 50,
      volume: 0,
      kind: 'leaderboard',
      outcomes: [{ label: 'Google', yes: 0.6, closed: false, vol24: 50 }],
    };
    const inputs: DashboardInputs = {
      ...empty(),
      markets: ok('Polymarket', [release, board]),
      drops: ok(
        'OpenRouter',
        Array.from({ length: 70 }, (_, i) =>
          drop('mistral', `2026-09-${String(1 + (i % 18)).padStart(2, '0')}T00:00:00Z`),
        ),
      ),
      feeds: [
        ok(
          'OpenAI news',
          Array.from({ length: 80 }, (_, i) =>
            item(`n${i}`, `2026-09-${String(1 + (i % 18)).padStart(2, '0')}T00:00:00Z`),
          ),
        ),
      ],
    };
    const d = assembleDashboard(inputs, NOW);
    expect(d.labs[0].id).toBe('google');
    expect(d.labs[0].leaderboardOdds).toBe(0.6);
    expect(d.markets.map((m) => m.slug)).toEqual(['b', 'a']);
    expect(d.bestModelMarket?.slug).toBe('b');
    expect(d.drops).toHaveLength(LIMITS.drops);
    expect(d.feed).toHaveLength(LIMITS.feed);
    expect(d.feed[0].publishedAt >= d.feed[1].publishedAt).toBe(true);
  });

  it('feeds DROPCON from frontier drops, hot HN stories and fresh alerts', () => {
    const inputs: DashboardInputs = {
      ...empty(),
      drops: ok('OpenRouter', [
        drop('openai', '2026-09-18T00:00:00Z'),
        drop('mistral', '2026-09-18T00:00:00Z'),
        drop('openai', '2026-09-01T00:00:00Z'),
      ]),
      feeds: [
        ok('Hacker News', [
          item('Introducing GPT-6', '2026-09-19T00:00:00Z', { score: 900, alert: true }),
          item('meh', '2026-09-19T00:00:00Z', { score: 10 }),
        ]),
        ok('OpenAI news', [
          item('Introducing something', '2026-09-10T00:00:00Z', { source: 'openai', alert: true }),
        ]),
      ],
    };
    const d = assembleDashboard(inputs, NOW);
    expect(d.dropcon.score).toBe(6 * 1 + 3 * 1 + 2 * 1);
  });
});
