/**
 * Pure shaping of the DROPCON score series read from D1 (src/infra/snapshot-store.ts) into
 * something a history strip can draw: hourly downsampling, hysteresis so single-slot
 * wobbles don't flip the displayed level, and a split wherever the scoring algorithm
 * changed underneath the numbers. No fetch, no `Date.now()`.
 */

/** One `score_series` row, already narrowed to display-relevant columns. */
export interface ScorePoint {
  /** The 15-minute scheduled slot this reading belongs to, ISO. */
  slot: string;
  observedAt: string;
  algorithmVersion: number;
  score: number;
  level: 1 | 2 | 3 | 4 | 5;
  /** "Ships within 7 days" odds behind the score, 0..1; absent on legacy rows. */
  p7?: number;
  degraded: boolean;
}

export interface DisplayPoint extends ScorePoint {
  /** The level to render: `level` after hysteresis has been applied. */
  displayLevel: 1 | 2 | 3 | 4 | 5;
}

function byObservedAtAsc(a: ScorePoint, b: ScorePoint): number {
  return a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0;
}

/** One point per UTC hour: the latest reading observed in that hour. */
export function downsampleHourly(points: readonly ScorePoint[]): ScorePoint[] {
  const sorted = [...points].sort(byObservedAtAsc);
  const buckets = new Map<string, ScorePoint>();
  for (const point of sorted) {
    buckets.set(point.observedAt.slice(0, 13), point);
  }
  return [...buckets.values()];
}

/**
 * The same score bands `computeDropcon` uses (src/domain/dropcon.ts). Kept here rather
 * than imported so this package never needs to touch that file; a later package updates
 * both together if v3 rescales the bands (see the report's Critic section, "v3 level 1
 * is effectively unreachable").
 */
const LEVEL_BOUNDARIES = [75, 55, 35, 15] as const;

/**
 * How far `score` sits past the boundary it had to cross to move from `fromLevel` to
 * `toLevel`, in the direction of travel. Zero or negative means it hasn't cleared yet.
 */
function marginBeyondBoundary(score: number, fromLevel: number, toLevel: number): number {
  if (toLevel === fromLevel) return 0;
  if (toLevel < fromLevel) return score - LEVEL_BOUNDARIES[toLevel - 1];
  return LEVEL_BOUNDARIES[fromLevel - 1] - score;
}

export const HYSTERESIS_HOLD_SLOTS = 2;
export const HYSTERESIS_CLEAR_MARGIN = 5;

/**
 * A level change is shown only once the new raw level holds for `HYSTERESIS_HOLD_SLOTS`
 * consecutive slots, or the score clears the crossed band boundary by at least
 * `HYSTERESIS_CLEAR_MARGIN` points. Everything else is a one-slot wobble and stays at the
 * previously displayed level. Assumes `points` covers one algorithm version; run
 * `splitByAlgorithmVersion` first.
 */
export function applyHysteresis(points: readonly ScorePoint[]): DisplayPoint[] {
  const sorted = [...points].sort(byObservedAtAsc);
  const out: DisplayPoint[] = [];
  let current: ScorePoint['level'] | undefined;
  for (let i = 0; i < sorted.length; i++) {
    const point = sorted[i];
    if (current === undefined) {
      current = point.level;
    } else if (point.level !== current) {
      const margin = marginBeyondBoundary(point.score, current, point.level);
      const holds = sorted[i + 1]?.level === point.level;
      if (margin >= HYSTERESIS_CLEAR_MARGIN || holds) current = point.level;
    }
    out.push({ ...point, displayLevel: current });
  }
  return out;
}

/**
 * Contiguous runs sharing one `algorithmVersion`, oldest run first. Scores and levels
 * from different versions are not comparable, so a history strip draws a visible break
 * between runs rather than a continuous line.
 */
export function splitByAlgorithmVersion(points: readonly ScorePoint[]): ScorePoint[][] {
  const sorted = [...points].sort(byObservedAtAsc);
  const segments: ScorePoint[][] = [];
  for (const point of sorted) {
    const current = segments.at(-1);
    if (current && current[0].algorithmVersion === point.algorithmVersion) current.push(point);
    else segments.push([point]);
  }
  return segments;
}

/** Split, downsample and apply hysteresis within each algorithm-version run, then flatten. */
export function buildHistorySeries(points: readonly ScorePoint[]): DisplayPoint[] {
  return splitByAlgorithmVersion(points).flatMap((segment) => applyHysteresis(downsampleHourly(segment)));
}
