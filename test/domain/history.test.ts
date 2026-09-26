import { describe, expect, it } from 'vitest';
import { LEVEL_BANDS } from '../../src/domain/dropcon';
import {
  HISTORY_WINDOW_MS,
  HYSTERESIS_CLEAR_MARGIN,
  STRIP_MIN_SPAN_MS,
  applyHysteresis,
  buildHistorySeries,
  downsampleHourly,
  historyStrip,
  splitByAlgorithmVersion,
  stripDay,
  stripSpanText,
  stripHour,
  type ScorePoint,
} from '../../src/domain/history';
import { readings, series } from '../fixtures/history';

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

describe('historyStrip', () => {
  const NOW = Date.parse('2026-09-27T06:30:00Z');
  const opts = { ok: true, now: NOW, currentVersion: 3 };
  // v2 backfill for three days, then v3: level 2, a drop to level 4, one outage, then level 1.
  const v2 = readings('2026-09-23T00:00:00Z', 72, 2, (i) => (i < 24 ? 90 : 64));
  const v3 = readings(
    '2026-09-26T00:00:00Z',
    30,
    3,
    (i) => (i < 10 ? 60 : i < 20 ? 30 : 80),
    (i) => i === 20,
  );

  it('says the series is unavailable, and draws nothing, when it could not be read', () => {
    const strip = historyStrip([], { ...opts, ok: false });
    expect(strip.state).toBe('unavailable');
    expect(strip.runs).toEqual([]);
    expect(strip.summary).toBe(
      'DROPCON history is unavailable: the score series could not be read. The level shown is live.',
    );
    expect(Date.parse(strip.to) - Date.parse(strip.from)).toBe(STRIP_MIN_SPAN_MS);
  });

  it('makes an empty series look intentional: the current version starts today', () => {
    const strip = historyStrip([], opts);
    expect(strip.state).toBe('empty');
    expect(strip.currentRecorded).toBe(false);
    expect(strip.currentSince).toBe(new Date(NOW).toISOString());
    expect(strip.summary).toBe('DROPCON history: no readings recorded yet. v3 history starts 27 Sep.');
  });

  it('draws an old version dimmed, with no break, and says when the current one starts', () => {
    const strip = historyStrip(series(v2), opts);
    expect(strip.state).toBe('ok');
    expect(strip.runs.every((r) => !r.current && r.level === undefined)).toBe(true);
    expect(strip.breaks).toEqual([]);
    expect(strip.versions.map((v) => [v.algorithmVersion, v.current, v.points])).toEqual([[2, false, 72]]);
    expect(strip.summary).toBe(
      'DROPCON history, 23 Sep to 27 Sep, one bar per hour. v2 (old scoring, not comparable), 23 Sep to 26 Sep: 72 hourly readings, scores 64 to 90. v3 history starts 27 Sep.',
    );
  });

  it('breaks the strip where the algorithm changes and colours only the current version by level', () => {
    const strip = historyStrip(series(v2, v3), opts);
    // 72 of the 102.5 hours drawn: the break sits 72/102.5 of the way across.
    expect(strip.breaks).toEqual([{ x: 702.44, at: '2026-09-26T00:00:00.000Z', algorithmVersion: 3 }]);
    expect(strip.versions.map((v) => [v.algorithmVersion, v.current, v.points, v.measured])).toEqual([
      [2, false, 72, 72],
      [3, true, 30, 29],
    ]);
    expect(strip.runs.map((r) => [r.algorithmVersion, r.level, r.degraded, r.points])).toEqual([
      [2, undefined, false, 72],
      [3, 2, false, 10],
      [3, 4, false, 10],
      [3, undefined, true, 1],
      [3, 1, false, 9],
    ]);
    expect(strip.runs[0].title).toBe(
      'v2 · 23 Sep 00:00Z–26 Sep 00:00Z · old scoring, not comparable · score 64 to 90',
    );
    expect(strip.runs[3].title).toBe('v3 · 26 Sep 20:00Z–26 Sep 21:00Z · odds offline, level held');
    expect(strip.runs[3].area).toMatch(/V0H[\d.]+V100Z$/);
    expect(strip.runs[3].edge).toBe('');
    expect(strip.currentSince).toBe('2026-09-26T00:00:00.000Z');
    expect(strip.dayAgo?.observedAt).toBe('2026-09-26T06:10:00.000Z');
    expect(strip.summary).toBe(
      'DROPCON history, 23 Sep to 27 Sep, one bar per hour. v2 (old scoring, not comparable), 23 Sep to 26 Sep: 72 hourly readings, scores 64 to 90. v3 from 26 Sep: 30 hourly readings, scores 30 to 80, 1 with the odds offline; latest level 1 (score 80).',
    );
  });

  it('draws each run as a step area with its top edge, hour by hour', () => {
    const now = Date.parse('2026-09-27T00:00:00Z');
    const strip = historyStrip(series(readings('2026-09-26T00:00:00Z', 2, 3, (i) => [60, 70][i])), {
      ...opts,
      now,
    });
    expect(strip.runs).toHaveLength(1);
    expect(strip.runs[0].area).toBe('M0 100V40H41.67V30H83.33V100Z');
    expect(strip.runs[0].edge).toBe('M0 40H41.67V30H83.33');
  });

  it('splits a run at a gap in the readings and ignores readings after now', () => {
    const now = Date.parse('2026-09-26T05:00:00Z');
    const points = series([
      ...readings('2026-09-26T00:00:00Z', 1, 3, () => 60),
      ...readings('2026-09-26T03:00:00Z', 1, 3, () => 60),
      ...readings('2026-09-26T06:00:00Z', 1, 3, () => 60),
    ]);
    const strip = historyStrip(points, { ...opts, now });
    expect(strip.runs.map((r) => r.from)).toEqual(['2026-09-26T00:00:00.000Z', '2026-09-26T03:00:00.000Z']);
    expect(strip.versions[0].points).toBe(2);
  });

  it('reports an old version whose every reading was an outage without a score range', () => {
    const strip = historyStrip(
      series(
        readings(
          '2026-09-26T00:00:00Z',
          2,
          2,
          () => 0,
          () => true,
        ),
      ),
      opts,
    );
    expect(strip.versions[0].min).toBeUndefined();
    expect(strip.summary).toContain(
      'v2 (old scoring, not comparable), 26 Sep to 26 Sep: 2 hourly readings, 2 with the odds offline.',
    );
  });

  it('says so when the latest current reading was an outage', () => {
    const strip = historyStrip(
      series(
        readings(
          '2026-09-27T00:00:00Z',
          2,
          3,
          () => 60,
          (i) => i === 1,
        ),
      ),
      opts,
    );
    expect(strip.summary).toContain('latest reading had the odds offline');
    expect(strip.dayAgo).toBeUndefined();
  });

  it('names a version whose readings all share one score by that score, not "a to a"', () => {
    const strip = historyStrip(series(readings('2026-09-27T00:00:00Z', 3, 3, () => 42)), opts);
    expect(strip.summary).toContain(
      'v3 from 27 Sep: 3 hourly readings, scores 42; latest level 3 (score 42).',
    );
    expect(strip.summary).not.toContain('42 to 42');
    expect(strip.runs[0].title).toMatch(/score 42$/);
  });

  it('describes the span it draws: since its first day until it covers the whole window', () => {
    // A day of readings: the strip spans its one-day minimum, so the pill says since when.
    const day = historyStrip(series(readings('2026-09-27T00:00:00Z', 6, 3, () => 60)), opts);
    expect(stripSpanText(day, HISTORY_WINDOW_MS)).toBe('SINCE 26 SEP');
    // Four days of readings: still since its first day, never "last 30 days".
    expect(stripSpanText(historyStrip(series(v2, v3), opts), HISTORY_WINDOW_MS)).toBe('SINCE 23 SEP');
    // A series reaching back to the start of the window reads as the window.
    const month = historyStrip(
      series(readings(new Date(NOW - HISTORY_WINDOW_MS + 3_600_000).toISOString(), 24 * 29, 3, () => 60)),
      opts,
    );
    expect(stripSpanText(month, HISTORY_WINDOW_MS)).toBe('LAST 30 DAYS');
    expect(HISTORY_WINDOW_MS).toBe(30 * 24 * 3_600_000);
  });

  it('formats days and hours in UTC without ICU month spellings', () => {
    expect(stripDay('2026-09-06T23:59:00Z')).toBe('6 Sep');
    expect(stripHour('2026-09-06T04:05:00Z')).toBe('6 Sep 04:05Z');
    expect(HYSTERESIS_CLEAR_MARGIN).toBe(5);
  });
});
