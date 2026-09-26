import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_SCHEMA,
  LIMITS,
  assembleDashboard,
  type DashboardInputs,
  type SourceResult,
} from '../../src/domain/dashboard';
import type { Drop } from '../../src/domain/drop';
import type { FeedItem } from '../../src/domain/feed';
import type { LabId } from '../../src/domain/lab';
import { EMPTY_LEDGER } from '../../src/domain/ledger';
import type { Market, Outcome } from '../../src/domain/market';

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

/** A "released by" rung with a tight two-sided book around `mid`. */
const rung = (label: string, deadline: string, mid: number): Outcome => ({
  label,
  yes: mid,
  closed: false,
  vol24: 0,
  deadline,
  deadlineKind: 'by',
  bestBid: mid - 0.005,
  bestAsk: mid + 0.005,
  thin: false,
  liquidity: 1000,
});
const ladder = (labId: LabId, title: string, rungs: [string, string, number][]): Market => ({
  slug: `${labId}-${title}`,
  title,
  url: `https://polymarket.com/event/${labId}`,
  vol24: 0,
  volume: 0,
  kind: 'release',
  labId,
  outcomes: rungs.map(([label, deadline, mid]) => rung(label, deadline, mid)),
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
      url: 'https://polymarket.com/event/gemini-4',
      vol24: 5,
      volume: 0,
      kind: 'release',
      labId: 'google',
      outcomes: [rung('September 24', '2026-09-25T03:59:59Z', 0.9)],
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

  it('scores the best trusted frontier family, records the inputs and builds the headline from it', () => {
    const inputs: DashboardInputs = {
      ...empty(),
      markets: ok('Polymarket', [
        ladder('openai', 'GPT-6 released by...?', [['September 24', '2026-09-25T03:59:59Z', 0.6]]),
        ladder('anthropic', 'Next Claude Sonnet released by...?', [
          ['September 22', '2026-09-23T03:59:59Z', 0.8],
          ['October 31', '2026-11-01T03:59:59Z', 0.95],
        ]),
        // Mistral is not a frontier lab: it has a card but never drives the score.
        ladder('mistral', 'Mistral Large 4 released by...?', [
          ['September 20', '2026-09-21T03:59:59Z', 0.99],
        ]),
      ]),
    };
    const d = assembleDashboard(inputs, NOW);
    expect(d.measurement).toMatchObject({ schema: DASHBOARD_SCHEMA, algorithmVersion: 3 });
    expect(DASHBOARD_SCHEMA).toBe(4);
    const { inputs: rec } = d.measurement;
    expect(rec.top7).toMatchObject({
      labId: 'anthropic',
      family: 'Next Claude Sonnet',
      read: 'interpolated',
    });
    expect(rec.top7?.quote).toEqual({ label: 'September 22', p: 0.8 });
    expect(rec.p7).toBe(d.labs.find((l) => l.id === 'anthropic')!.odds!.p7.p);
    expect(rec.p30).toBeGreaterThanOrEqual(rec.p7);
    expect(rec.p7DayAgo).toBeNull();
    expect(d.dropcon.headline).toBe('Polymarket prices 80% that the next Claude Sonnet ships by Sep 22');
    expect(d.dropcon.score).toBe(d.dropcon.provenance.reduce((sum, r) => sum + r.points, 0));
    expect(d.dropcon.state).toBe('ok');
    // The forecast reads every trusted frontier 72h read and is context only.
    expect(d.forecast.labs.map((l) => l.labId).sort()).toEqual(['anthropic', 'openai']);
    expect(d.dropcon.baseRate).toMatch(/^Context, not the level/);
  });

  it("prices repricing from the ledger's day-old P7", () => {
    const inputs: DashboardInputs = {
      ...empty(),
      markets: ok('Polymarket', [
        ladder('openai', 'GPT-6 released by...?', [['September 24', '2026-09-25T03:59:59Z', 0.6]]),
      ]),
      ledger: ok('First-seen ledger', {
        ...EMPTY_LEDGER,
        headlineDayAgo: { p: 0.1, observedAt: '2026-09-18T12:00:00.000Z' },
      }),
    };
    const d = assembleDashboard(inputs, NOW);
    expect(d.measurement.inputs.p7DayAgo).toBe(0.1);
    expect(d.dropcon.provenance[2].points).toBeGreaterThan(0);
    expect(d.sources.find((s) => s.name === 'First-seen ledger')).toEqual({
      name: 'First-seen ledger',
      ok: true,
    });
  });

  it('never scores landed activity: frontier listings and hot HN stories leave the level alone', () => {
    const inputs: DashboardInputs = {
      ...empty(),
      drops: ok('OpenRouter', [
        drop('openai', '2026-09-18T00:00:00Z'),
        drop('mistral', '2026-09-18T00:00:00Z'),
      ]),
      feeds: [
        ok('Hacker News', [item('Introducing GPT-6', '2026-09-19T00:00:00Z', { score: 900, alert: true })]),
      ],
    };
    const d = assembleDashboard(inputs, NOW);
    expect(d.dropcon.score).toBe(0);
    expect(d.dropcon.level).toBe(5);
    expect(d.landed.releases.map((r) => r.labId)).toEqual(['openai']);
    expect(d.landed.banner).toBe(true);
    expect(d.landed.stories.map((s) => s.title)).toEqual(['Introducing GPT-6']);
    expect(d.earlyWarnings.scored).toBe(false);
  });

  it('has no signal with Polymarket and OpenRouter both down, and lists every source it was given', () => {
    const inputs: DashboardInputs = {
      ...empty(),
      markets: failed('Polymarket', [] as Market[]),
      drops: failed('OpenRouter', [] as Drop[]),
      leaks: [{ ...ok('HN leaks', []), source: 'hn' }],
      broadcasts: failed('YouTube broadcasts', []),
      architectures: ok('transformers registry', []),
    };
    const d = assembleDashboard(inputs, NOW);
    expect(d.dropcon.state).toBe('no-signal');
    expect(d.forecast.oddsAvailable).toBe(false);
    expect(d.sources.map((s) => s.name)).toEqual([
      'Polymarket',
      'OpenRouter',
      'HF trending',
      'HF papers',
      'HN leaks',
      'YouTube broadcasts',
      'transformers registry',
    ]);
  });
});
