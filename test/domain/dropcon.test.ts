import { describe, expect, it } from 'vitest';
import { computeDropcon, type DropconInput } from '../../src/domain/dropcon';

const quiet: DropconInput = {
  maxWeekOdds: 0,
  maxMonthOdds: 0,
  frontierDrops7d: 0,
  hotStories: 0,
  releaseAlerts: 0,
};

describe('computeDropcon', () => {
  it('is QUIET ORBIT with no signal', () => {
    const d = computeDropcon(quiet);
    expect(d.level).toBe(5);
    expect(d.score).toBe(0);
    expect(d.degraded).toBe(false);
  });

  it('week odds dominate: a 90% week market alone reaches level 3', () => {
    const d = computeDropcon({ ...quiet, maxWeekOdds: 0.9 });
    expect(d.score).toBeGreaterThanOrEqual(35);
    expect(d.level).toBeLessThanOrEqual(3);
  });

  it('saturates at level 1 when everything fires', () => {
    const d = computeDropcon({
      maxWeekOdds: 1,
      maxMonthOdds: 1,
      frontierDrops7d: 10,
      hotStories: 10,
      releaseAlerts: 10,
    });
    expect(d.level).toBe(1);
    expect(d.score).toBe(100);
  });

  it('caps each non-market driver so noise cannot fake a drop', () => {
    const d = computeDropcon({ ...quiet, hotStories: 100, releaseAlerts: 100 });
    expect(d.score).toBe(3 * 4 + 2 * 5);
  });

  it('flags degraded when odds are unavailable and says so first', () => {
    const d = computeDropcon({ ...quiet, oddsAvailable: false });
    expect(d.degraded).toBe(true);
    expect(d.drivers[0]).toMatch(/odds unavailable/i);
  });

  it('names the week odds driver above 50% and the month driver only when the week is quiet', () => {
    expect(computeDropcon({ ...quiet, maxWeekOdds: 0.6 }).drivers[0]).toMatch(/60% odds .* 7 days/);
    expect(computeDropcon({ ...quiet, maxMonthOdds: 0.7 }).drivers[0]).toMatch(/70% odds .* 30 days/);
    expect(computeDropcon({ ...quiet, maxWeekOdds: 0.6, maxMonthOdds: 0.7 }).drivers).toHaveLength(1);
  });

  it('describes fresh listings as completed activity at any level without boosting the score', () => {
    const before = computeDropcon({ ...quiet, frontierDrops7d: 1 });
    const fresh = computeDropcon({ ...quiet, frontierDrops7d: 1, frontierDrops48h: 1 });
    expect(fresh.score).toBe(before.score);
    expect(fresh.level).toBe(5);
    expect(fresh.name).toBe('MODELS JUST LANDED');
    expect(fresh.blurb).toContain('not a prediction');
    expect(before.blurb).toContain('seven days');
    expect(computeDropcon({ ...quiet, oddsAvailable: false }).blurb).toContain('unavailable');
  });

  it('lists the drivers that contributed', () => {
    const d = computeDropcon({ ...quiet, frontierDrops7d: 2 });
    expect(d.drivers.some((s) => /frontier/i.test(s))).toBe(true);
  });
});
