import { describe, expect, it } from 'vitest';
import {
  auc,
  b0,
  calibration,
  dailyFromP72,
  DAY,
  fitMap,
  isoWeek,
  logScore,
  sigmoid,
  solve,
  weekBootstrap,
  type LabDay,
} from '../../scripts/forecast/models';
import { readJson } from '../../scripts/backtest/io';

describe('forecast models', () => {
  it('solves a small linear system', () => {
    expect(
      solve(
        [
          [2, 1],
          [1, 3],
        ],
        [3, 5],
      ).map((v) => Math.round(v * 1e9) / 1e9),
    ).toEqual([0.8, 1.4]);
  });

  it('recovers a logistic intercept from data under a weak prior', () => {
    const y = Array.from({ length: 1000 }, (_, i) => (i % 10 === 0 ? 1 : 0));
    const [a] = fitMap(
      y.map(() => [1]),
      y,
      [{ mean: 0, sd: 100 }],
    );
    expect(sigmoid(a)).toBeCloseTo(0.1, 6);
  });

  it('shrinks toward the prior when data are scarce', () => {
    const [a] = fitMap([[1]], [1], [{ mean: -4, sd: 0.1 }]);
    expect(a).toBeGreaterThan(-4);
    expect(a).toBeLessThan(-3.9);
  });

  it('turns a 72-hour probability into a daily hazard', () => {
    expect(1 - (1 - dailyFromP72(0.5)) ** 3).toBeCloseTo(0.5, 12);
  });

  it('B0 shrinks a lab rate toward the pooled trailing rate', () => {
    const t0 = 1_000 * DAY;
    const train: LabDay[] = Array.from({ length: 90 }, (_, i) => [
      { t: t0 + i * DAY, labId: 'a', y: (i < 9 ? 1 : 0) as 0 | 1, d: 0, marketFit: true },
      { t: t0 + i * DAY, labId: 'b', y: 0 as const, d: 0, marketFit: true },
    ]).flat();
    const [h] = b0().forecast(train, [{ t: t0 + 90 * DAY, labId: 'a', d: 0, marketFit: true }]);
    // own 9/90, pooled 9/180: (9 + 90 · 0.05) / (90 + 90)
    expect(h).toBeCloseTo((9 + 4.5) / 180, 12);
  });

  it('scores, clips and ranks', () => {
    expect(logScore(0, 1)).toBeCloseTo(Math.log(0.001), 12);
    expect(auc([0.9, 0.1, 0.5], [1, 0, 0])).toBe(1);
    expect(isoWeek(Date.parse('2026-11-14T00:00:00Z') / 1000)).toBe('2026-11-09');
  });

  it('a calibrated forecaster has intercept near 0 and slope near 1', () => {
    const h = Array.from({ length: 4000 }, (_, i) => 0.05 + 0.4 * ((i % 100) / 100));
    const y = h.map((p, i) => (((i * 7919) % 1000) / 1000 < p ? 1 : 0));
    const { intercept, slope } = calibration(h, y);
    expect(Math.abs(intercept)).toBeLessThan(0.15);
    expect(Math.abs(slope - 1)).toBeLessThan(0.2);
  });

  it('bootstraps whole weeks and is deterministic for a seed', () => {
    const rows = Array.from({ length: 28 }, (_, i) => ({ t: 1_789_000_000 + i * DAY, v: i % 7 }));
    const a = weekBootstrap(rows, 500, 1);
    expect(a).toEqual(weekBootstrap(rows, 500, 1));
    expect(a.mean).toBe(3);
    expect(a.lo).toBeLessThanOrEqual(3);
    expect(a.hi).toBeGreaterThanOrEqual(3);
  });

  it('the committed interim result matches its spec', async () => {
    const out = await readJson<{
      primary: { meta: { spec: string; labDays: number; flagshipDays: number } };
    }>('data/forward/interim-2026-11-14.json');
    expect(out.primary.meta).toMatchObject({
      spec: 'docs/release-forecast-2026-11-14.md',
      labDays: 47 * 7,
      flagshipDays: 10,
    });
  });
});
