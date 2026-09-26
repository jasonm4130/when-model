import { levelForScore } from '../../src/domain/dropcon';
import { buildHistorySeries, type DisplayPoint, type ScorePoint } from '../../src/domain/history';

const HOUR = 3_600_000;

/**
 * One reading ten minutes past each hour from `start` for `hours` hours, under one algorithm
 * version, scored by `score(i)`; `degraded(i)` marks outages.
 */
export function readings(
  start: string,
  hours: number,
  algorithmVersion: number,
  score: (i: number) => number,
  degraded: (i: number) => boolean = () => false,
): ScorePoint[] {
  const t0 = Date.parse(start);
  return Array.from({ length: hours }, (_, i) => {
    const slot = new Date(t0 + i * HOUR + 10 * 60_000).toISOString();
    const s = degraded(i) ? 0 : score(i);
    return {
      slot,
      observedAt: slot,
      algorithmVersion,
      score: s,
      level: degraded(i) ? 5 : levelForScore(s),
      degraded: degraded(i),
      ...(degraded(i) ? {} : { headlineP: s / 80 }),
    };
  });
}

/** The same readings as `/api/history.json` serves them: hysteresis per version, then hourly. */
export function series(...runs: ScorePoint[][]): DisplayPoint[] {
  return buildHistorySeries(runs.flat());
}
