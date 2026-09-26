import { describe, expect, it } from 'vitest';
import {
  applyHysteresis,
  buildHistorySeries,
  downsampleHourly,
  splitByAlgorithmVersion,
  type ScorePoint,
} from '../../src/domain/history';

function point(overrides: Partial<ScorePoint> & Pick<ScorePoint, 'observedAt'>): ScorePoint {
  return {
    slot: overrides.observedAt,
    algorithmVersion: 2,
    score: 0,
    level: 5,
    degraded: false,
    ...overrides,
  };
}

describe('downsampleHourly', () => {
  it('keeps the latest reading observed in each UTC hour', () => {
    const points = [
      point({ observedAt: '2026-09-23T01:00:00.000Z', score: 10 }),
      point({ observedAt: '2026-09-23T01:45:00.000Z', score: 20 }),
      point({ observedAt: '2026-09-23T02:15:00.000Z', score: 30 }),
    ];
    expect(downsampleHourly(points).map((p) => p.score)).toEqual([20, 30]);
  });

  it('sorts out-of-order input before bucketing', () => {
    const points = [
      point({ observedAt: '2026-09-23T02:15:00.000Z', score: 30 }),
      point({ observedAt: '2026-09-23T01:00:00.000Z', score: 10 }),
      point({ observedAt: '2026-09-23T01:45:00.000Z', score: 20 }),
    ];
    expect(downsampleHourly(points).map((p) => p.observedAt)).toEqual([
      '2026-09-23T01:45:00.000Z',
      '2026-09-23T02:15:00.000Z',
    ]);
  });

  it('returns nothing for nothing', () => {
    expect(downsampleHourly([])).toEqual([]);
  });
});

describe('applyHysteresis', () => {
  it('trusts the first reading immediately', () => {
    const [first] = applyHysteresis([point({ observedAt: '2026-09-23T01:00:00.000Z', score: 64, level: 2 })]);
    expect(first.displayLevel).toBe(2);
  });

  it('suppresses a one-slot wobble that neither holds nor clears the boundary by 5', () => {
    // 55 is the level-2 boundary; level 3 -> 2 with score 58 clears by only 3, and the
    // very next slot falls back to level 3, so the wobble should not show.
    const points = [
      point({ observedAt: '2026-09-23T01:00:00.000Z', score: 40, level: 3 }),
      point({ observedAt: '2026-09-23T01:15:00.000Z', score: 58, level: 2 }),
      point({ observedAt: '2026-09-23T01:30:00.000Z', score: 40, level: 3 }),
    ];
    expect(applyHysteresis(points).map((p) => p.displayLevel)).toEqual([3, 3, 3]);
  });

  it('accepts a level change once it holds for a second slot', () => {
    const points = [
      point({ observedAt: '2026-09-23T01:00:00.000Z', score: 40, level: 3 }),
      point({ observedAt: '2026-09-23T01:15:00.000Z', score: 58, level: 2 }),
      point({ observedAt: '2026-09-23T01:30:00.000Z', score: 60, level: 2 }),
    ];
    expect(applyHysteresis(points).map((p) => p.displayLevel)).toEqual([3, 2, 2]);
  });

  it('accepts a level change immediately once the score clears the boundary by at least 5', () => {
    const points = [
      point({ observedAt: '2026-09-23T01:00:00.000Z', score: 40, level: 3 }),
      point({ observedAt: '2026-09-23T01:15:00.000Z', score: 61, level: 2 }),
      point({ observedAt: '2026-09-23T01:30:00.000Z', score: 40, level: 3 }),
    ];
    expect(applyHysteresis(points).map((p) => p.displayLevel)).toEqual([3, 2, 3]);
  });

  it('clears immediately in the downward direction too', () => {
    const points = [
      point({ observedAt: '2026-09-23T01:00:00.000Z', score: 60, level: 2 }),
      point({ observedAt: '2026-09-23T01:15:00.000Z', score: 49, level: 3 }),
    ];
    expect(applyHysteresis(points).map((p) => p.displayLevel)).toEqual([2, 3]);
  });

  it('does not chase every raw level while held back, once the boundary is finally cleared', () => {
    const points = [
      point({ observedAt: '2026-09-23T01:00:00.000Z', score: 40, level: 3 }),
      point({ observedAt: '2026-09-23T01:15:00.000Z', score: 58, level: 2 }), // wobble, held back at 3
      point({ observedAt: '2026-09-23T01:30:00.000Z', score: 80, level: 1 }), // clears 3->1 by 5+
    ];
    expect(applyHysteresis(points).map((p) => p.displayLevel)).toEqual([3, 3, 1]);
  });
});

describe('splitByAlgorithmVersion', () => {
  it('groups contiguous runs of one algorithm version, oldest first', () => {
    const points = [
      point({ observedAt: '2026-09-23T01:00:00.000Z', algorithmVersion: 2 }),
      point({ observedAt: '2026-09-23T01:15:00.000Z', algorithmVersion: 2 }),
      point({ observedAt: '2026-09-23T01:30:00.000Z', algorithmVersion: 3 }),
    ];
    const segments = splitByAlgorithmVersion(points);
    expect(segments.map((segment) => segment.map((p) => p.observedAt))).toEqual([
      ['2026-09-23T01:00:00.000Z', '2026-09-23T01:15:00.000Z'],
      ['2026-09-23T01:30:00.000Z'],
    ]);
  });

  it('sorts before splitting, so an out-of-order version bump is not mistaken for a second run', () => {
    const points = [
      point({ observedAt: '2026-09-23T01:30:00.000Z', algorithmVersion: 3 }),
      point({ observedAt: '2026-09-23T01:00:00.000Z', algorithmVersion: 2 }),
    ];
    expect(splitByAlgorithmVersion(points)).toHaveLength(2);
  });

  it('returns nothing for nothing', () => {
    expect(splitByAlgorithmVersion([])).toEqual([]);
  });
});

describe('buildHistorySeries', () => {
  it('never smooths or holds hysteresis across an algorithm-version break', () => {
    const points = [
      // v2: two readings in the same hour holding at level 2 would normally need the
      // second slot to confirm the change from a prior level 3 — but there is no prior
      // v2 reading here, so the very first v2 point is trusted immediately.
      point({ observedAt: '2026-09-23T00:59:00.000Z', algorithmVersion: 2, score: 60, level: 2 }),
      // v3 starts fresh: even though the last v2 reading was level 2, the first v3
      // reading is trusted immediately rather than needing to "hold" against it.
      point({ observedAt: '2026-09-23T01:01:00.000Z', algorithmVersion: 3, score: 20, level: 4 }),
    ];
    const series = buildHistorySeries(points);
    expect(
      series.map((p) => ({ algorithmVersion: p.algorithmVersion, displayLevel: p.displayLevel })),
    ).toEqual([
      { algorithmVersion: 2, displayLevel: 2 },
      { algorithmVersion: 3, displayLevel: 4 },
    ]);
  });

  it('downsamples within each version run before applying hysteresis', () => {
    const points = [
      point({ observedAt: '2026-09-23T01:00:00.000Z', algorithmVersion: 2, score: 40, level: 3 }),
      point({ observedAt: '2026-09-23T01:45:00.000Z', algorithmVersion: 2, score: 58, level: 2 }),
      point({ observedAt: '2026-09-23T02:15:00.000Z', algorithmVersion: 2, score: 40, level: 3 }),
    ];
    // Downsampled to one point per hour first (01:45 wins the 01:00 bucket), then
    // hysteresis sees only two slots: 2 then 3, with no third slot to hold the change.
    expect(buildHistorySeries(points).map((p) => p.displayLevel)).toEqual([2, 3]);
  });

  it('returns nothing for nothing', () => {
    expect(buildHistorySeries([])).toEqual([]);
  });
});
