import { describe, expect, it } from 'vitest';
import type { Drop } from '../../src/domain/drop';
import { labById } from '../../src/domain/lab';
import { assessLab, computeHeat, temperatureFor } from '../../src/domain/lab-status';
import type { Market } from '../../src/domain/market';

const NOW = Date.parse('2026-09-19T12:00:00Z');
const openai = labById('openai')!;

const drop = (iso: string, labId: Drop['labId'] = 'openai'): Drop => ({
  id: `${labId}/m`,
  name: 'm',
  lab: 'OpenAI',
  labId,
  createdAt: iso,
  url: 'u',
  free: false,
});

describe('computeHeat', () => {
  it('is zero with nothing and 100 at saturation', () => {
    expect(computeHeat({ drops30d: 0 })).toBe(0);
    expect(computeHeat({ weekOdds: 1, monthOdds: 1, daysSince: 0, drops30d: 9 })).toBe(100);
  });

  it('weights week odds far above everything else', () => {
    const odds = computeHeat({ weekOdds: 0.5, drops30d: 0 });
    const shipping = computeHeat({ daysSince: 0, drops30d: 3 });
    expect(odds).toBe(28);
    expect(shipping).toBe(25);
  });

  it('recency decays to nothing after 30 days', () => {
    expect(computeHeat({ daysSince: 30, drops30d: 0 })).toBe(0);
    expect(computeHeat({ daysSince: 90, drops30d: 0 })).toBe(0);
  });
});

describe('temperatureFor', () => {
  it('SHIPPING overrides heat; otherwise thresholds at 60 and 25', () => {
    expect(temperatureFor(0, 2)).toBe('SHIPPING');
    expect(temperatureFor(0, 3)).toBe('QUIET');
    expect(temperatureFor(25, undefined)).toBe('WARM');
    expect(temperatureFor(60, 10)).toBe('HOT');
  });
});

describe('assessLab', () => {
  const market: Market = {
    slug: 's',
    title: 'GPT-6 released by...?',
    url: 'u',
    vol24: 0,
    volume: 0,
    kind: 'release',
    labId: 'openai',
    outcomes: [{ label: 'Sept 24', yes: 0.7, endDate: '2026-09-25T00:00:00Z', closed: false, vol24: 0 }],
  };
  const best: Market = {
    ...market,
    kind: 'leaderboard',
    labId: undefined,
    outcomes: [{ label: 'OpenAI', yes: 0.31, closed: false, vol24: 1 }],
  };

  it('combines drops, odds and the best-model market for one lab', () => {
    const drops = [
      drop('2026-09-18T00:00:00Z'),
      drop('2026-08-01T00:00:00Z'),
      drop('2026-09-18T00:00:00Z', 'google'),
    ];
    const s = assessLab(openai, { drops, markets: [market], bestModelMarket: best }, NOW);
    expect(s.latest?.createdAt).toBe('2026-09-18T00:00:00Z');
    expect(s.daysSince).toBe(1);
    expect(s.drops30d).toBe(1);
    expect(s.weekOdds?.p).toBe(0.7);
    expect(s.monthOdds?.p).toBe(0.7);
    expect(s.leaderboardOdds).toBe(0.31);
    expect(s.status).toBe('SHIPPING');
    expect(s.histogram).toHaveLength(12);
    expect(s.histogram.at(-1)).toBe(1);
    expect(s.xHandles).toEqual(openai.xHandles);
  });

  it('is QUIET with no drops and no markets', () => {
    const s = assessLab(openai, { drops: [], markets: [] }, NOW);
    expect(s.latest).toBeUndefined();
    expect(s.daysSince).toBeUndefined();
    expect(s.heat).toBe(0);
    expect(s.status).toBe('QUIET');
    expect(s.leaderboardOdds).toBeUndefined();
  });
});
