import { describe, expect, it } from 'vitest';
import { computeDropcon } from '../src/lib/dropcon';

const quiet = { maxWeekOdds: 0, maxMonthOdds: 0, frontierDrops7d: 0, hotStories: 0, releaseAlerts: 0 };

describe('computeDropcon', () => {
  it('is level 5 with no signal', () => {
    const d = computeDropcon(quiet);
    expect(d.level).toBe(5);
    expect(d.score).toBe(0);
    expect(d.drivers).toEqual(['All quiet on the release front']);
  });

  it('reaches level 1 when a drop is priced as near-certain this week', () => {
    const d = computeDropcon({ ...quiet, maxWeekOdds: 0.95, maxMonthOdds: 0.99, frontierDrops7d: 2 });
    expect(d.level).toBe(1);
    expect(d.name).toBe('DROP IMMINENT');
  });

  it('weights 7-day odds above everything else', () => {
    const week = computeDropcon({ ...quiet, maxWeekOdds: 0.7, maxMonthOdds: 0.7 });
    const month = computeDropcon({ ...quiet, maxMonthOdds: 0.99 });
    expect(week.score).toBeGreaterThan(month.score);
    expect(week.level).toBeLessThan(month.level);
  });

  it('caps the minor signals so noise alone cannot reach level 2', () => {
    const d = computeDropcon({ ...quiet, frontierDrops7d: 40, hotStories: 40, releaseAlerts: 40 });
    expect(d.score).toBe(4 * 6 + 4 * 3 + 5 * 2);
    expect(d.level).toBe(3);
  });

  it('never exceeds 100', () => {
    expect(
      computeDropcon({ maxWeekOdds: 1, maxMonthOdds: 1, frontierDrops7d: 9, hotStories: 9, releaseAlerts: 9 })
        .score,
    ).toBe(100);
  });
});
