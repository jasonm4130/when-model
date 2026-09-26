import { describe, expect, it } from 'vitest';
import { LEVEL_BANDS } from '../../src/domain/dropcon';
import {
  HISTORY_WINDOW_MS,
  HYSTERESIS_CLEAR_MARGIN,
  applyHysteresis,
  buildHistorySeries,
  downsampleHourly,
  splitByAlgorithmVersion,
  stripDay,
  stripHour,
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

  it('on a multi-level jump, shows the furthest band the score clears by 5, not none of them', () => {
    const up = [
      point({ observedAt: '2026-09-23T01:00:00.000Z', score: 50, level: 3 }),
      // 76 clears level 2's 55 by 21 but level 1's 75 by only 1.
      point({ observedAt: '2026-09-23T01:15:00.000Z', score: 76, level: 1 }),
      point({ observedAt: '2026-09-23T01:30:00.000Z', score: 50, level: 3 }),
    ];
    expect(applyHysteresis(up).map((p) => p.displayLevel)).toEqual([3, 2, 3]);
    const down = [
      point({ observedAt: '2026-09-23T01:00:00.000Z', score: 80, level: 1 }),
      // 54 is 21 under level 1's 75 but only 1 under level 2's 55.
      point({ observedAt: '2026-09-23T01:15:00.000Z', score: 54, level: 3 }),
      point({ observedAt: '2026-09-23T01:30:00.000Z', score: 80, level: 1 }),
    ];
    expect(applyHysteresis(down).map((p) => p.displayLevel)).toEqual([1, 2, 1]);
  });
});

describe('applyHysteresis with degraded readings', () => {
  it('holds the display level through an outage: a floor is not a move to level 5', () => {
    const points = [
      point({ observedAt: '2026-09-23T01:00:00.000Z', score: 64, level: 2 }),
      point({ observedAt: '2026-09-23T01:15:00.000Z', score: 0, level: 5, degraded: true }),
      point({ observedAt: '2026-09-23T01:30:00.000Z', score: 0, level: 5, degraded: true }),
      point({ observedAt: '2026-09-23T01:45:00.000Z', score: 64, level: 2 }),
    ];
    expect(applyHysteresis(points).map((p) => p.displayLevel)).toEqual([2, 2, 2, 2]);
  });

  it('confirms a change on the next real reading, skipping the outage between them', () => {
    const points = [
      point({ observedAt: '2026-09-23T01:00:00.000Z', score: 40, level: 3 }),
      point({ observedAt: '2026-09-23T01:15:00.000Z', score: 58, level: 2 }),
      point({ observedAt: '2026-09-23T01:30:00.000Z', score: 0, level: 5, degraded: true }),
      point({ observedAt: '2026-09-23T01:45:00.000Z', score: 58, level: 2 }),
    ];
    expect(applyHysteresis(points).map((p) => p.displayLevel)).toEqual([3, 2, 2, 2]);
  });

  it('lets the first real reading set the level when the series opens on an outage', () => {
    const points = [
      point({ observedAt: '2026-09-23T01:00:00.000Z', score: 0, level: 5, degraded: true }),
      point({ observedAt: '2026-09-23T01:15:00.000Z', score: 58, level: 2 }),
      // A one-slot wobble 3 under level 2's band: held against the anchored level 2, not level 5.
      point({ observedAt: '2026-09-23T01:30:00.000Z', score: 52, level: 3 }),
    ];
    expect(applyHysteresis(points).map((p) => p.displayLevel)).toEqual([5, 2, 2]);
  });

  it('reads its bands from DROPCON itself, not a copy', () => {
    // 75 is level 1's band in src/domain/dropcon.ts: 80 clears it by 5 and shows at once.
    const points = [
      point({ observedAt: '2026-09-23T01:00:00.000Z', score: 60, level: 2 }),
      point({ observedAt: '2026-09-23T01:15:00.000Z', score: 80, level: 1 }),
      point({ observedAt: '2026-09-23T01:30:00.000Z', score: 60, level: 2 }),
    ];
    expect(LEVEL_BANDS[0]).toBe(75);
    expect(applyHysteresis(points).map((p) => p.displayLevel)).toEqual([2, 1, 2]);
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

  it("applies hysteresis over the 15-minute slots, then keeps each hour's latest reading", () => {
    const points = [
      point({ observedAt: '2026-09-23T00:45:40.000Z', score: 40, level: 3 }),
      // Level 2 holds for three consecutive slots: a real change, even though it never
      // clears 55 by 5 and the next hour is back at level 3.
      point({ observedAt: '2026-09-23T01:15:40.000Z', score: 58, level: 2 }),
      point({ observedAt: '2026-09-23T01:30:40.000Z', score: 58, level: 2 }),
      point({ observedAt: '2026-09-23T01:45:40.000Z', score: 58, level: 2 }),
      point({ observedAt: '2026-09-23T02:45:40.000Z', score: 40, level: 3 }),
    ];
    expect(
      buildHistorySeries(points).map((p) => [p.observedAt.slice(11, 16), p.level, p.displayLevel]),
    ).toEqual([
      ['00:45', 3, 3],
      ['01:45', 2, 2],
      ['02:45', 3, 3],
    ]);
  });

  it('hides a one-slot wobble inside an hour that the hourly point happens to land on', () => {
    const points = [
      point({ observedAt: '2026-09-23T00:45:40.000Z', score: 40, level: 3 }),
      point({ observedAt: '2026-09-23T01:30:40.000Z', score: 40, level: 3 }),
      point({ observedAt: '2026-09-23T01:45:40.000Z', score: 58, level: 2 }),
      point({ observedAt: '2026-09-23T02:00:40.000Z', score: 40, level: 3 }),
    ];
    expect(buildHistorySeries(points).map((p) => [p.level, p.displayLevel])).toEqual([
      [3, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('returns nothing for nothing', () => {
    expect(buildHistorySeries([])).toEqual([]);
  });
});

describe('date labels', () => {
  it('formats days and hours in UTC without ICU month spellings', () => {
    expect(stripDay('2026-09-06T23:59:00Z')).toBe('6 Sep');
    expect(stripHour('2026-09-06T04:05:00Z')).toBe('6 Sep 04:05Z');
    expect(HYSTERESIS_CLEAR_MARGIN).toBe(5);
    expect(HISTORY_WINDOW_MS).toBe(30 * 24 * 3_600_000);
  });
});
