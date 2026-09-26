/**
 * Pure shaping of the DROPCON score series read from D1 (src/infra/snapshot-store.ts) into
 * something a history strip can draw: hourly downsampling, hysteresis so single-slot
 * wobbles don't flip the displayed level, and a split wherever the scoring algorithm
 * changed underneath the numbers. No fetch, no `Date.now()`.
 */
import { dayMonth } from './dates';
import { LEVEL_BANDS } from './dropcon';

/** One `score_series` row, already narrowed to display-relevant columns. */
export interface ScorePoint {
  /** The 15-minute scheduled slot this reading belongs to, ISO. */
  slot: string;
  observedAt: string;
  algorithmVersion: number;
  score: number;
  level: 1 | 2 | 3 | 4 | 5;
  /**
   * The probability the headline reads, 0..1: v3's P7 (best trusted frontier-family 7-day odds),
   * v2's max 7-day odds on backfilled rows. Absent when the odds source was down.
   */
  headlineP?: number;
  /** The reading was a floor or had no signal: it holds the previous display level. */
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
export function downsampleHourly<T extends ScorePoint>(points: readonly T[]): T[] {
  const sorted = [...points].sort(byObservedAtAsc);
  const buckets = new Map<string, T>();
  for (const point of sorted) {
    buckets.set(point.observedAt.slice(0, 13), point);
  }
  return [...buckets.values()];
}

/** The score bands `computeDropcon` uses, from their one definition in src/domain/dropcon.ts. */
const LEVEL_BOUNDARIES = LEVEL_BANDS;

export const HYSTERESIS_HOLD_SLOTS = 2;
export const HYSTERESIS_CLEAR_MARGIN = 5;

type Level = ScorePoint['level'];

/**
 * The level furthest from `from` toward `to` whose entry boundary `score` clears by
 * `HYSTERESIS_CLEAR_MARGIN`, or `from` when it clears none. A jump from level 3 to a
 * score of 76 clears 55 (level 2) by 21 but 75 (level 1) by only 1, so it shows level 2.
 */
function clearedLevel(score: number, from: Level, to: Level): Level {
  if (to < from) {
    for (let level = to; level < from; level++) {
      if (score - LEVEL_BOUNDARIES[level - 1] >= HYSTERESIS_CLEAR_MARGIN) return level as Level;
    }
  } else {
    for (let level = to; level > from; level--) {
      if (LEVEL_BOUNDARIES[level - 2] - score >= HYSTERESIS_CLEAR_MARGIN) return level as Level;
    }
  }
  return from;
}

/**
 * A level change is shown only once the new raw level holds for `HYSTERESIS_HOLD_SLOTS`
 * consecutive slots (shown from the first of them), or the score clears the crossed band
 * boundary by at least `HYSTERESIS_CLEAR_MARGIN` points. Everything else is a one-slot
 * wobble and stays at the previously displayed level. A degraded reading (odds offline, or
 * no signal) is an outage, not a move: it holds the previous display level and never counts
 * as the slot that confirms a change. Run it on 15-minute slots, before `downsampleHourly`:
 * "2 slots" means two captures, not two hours. Assumes `points` covers one algorithm
 * version; run `splitByAlgorithmVersion` first.
 */
export function applyHysteresis(points: readonly ScorePoint[]): DisplayPoint[] {
  const sorted = [...points].sort(byObservedAtAsc);
  const out: DisplayPoint[] = [];
  let current: Level | undefined;
  // Set by a real reading, not only by a degraded one a series happened to start with.
  let anchored = false;
  for (let i = 0; i < sorted.length; i++) {
    const point = sorted[i];
    if (current === undefined || (!anchored && !point.degraded)) {
      current = point.level;
      anchored = !point.degraded;
    } else if (!point.degraded && point.level !== current) {
      const next = sorted.slice(i + 1).find((p) => !p.degraded);
      const holds = next?.level === point.level;
      current = holds ? point.level : clearedLevel(point.score, current, point.level);
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

/**
 * Within each algorithm-version run: hysteresis over the raw 15-minute slots, then one
 * point per hour (the hour's latest reading and its display level). Flattened, oldest
 * first; a consumer draws a break wherever `algorithmVersion` changes between points.
 */
export function buildHistorySeries(points: readonly ScorePoint[]): DisplayPoint[] {
  return splitByAlgorithmVersion(points).flatMap((segment) => downsampleHourly(applyHysteresis(segment)));
}

/* ───────────── Window and date labels shared by the instrument and the history API ───────────── */

/** How far back the history is read: `/api/history.json` covers this; the instrument draws its last week. */
export const HISTORY_WINDOW_MS = 30 * 24 * 60 * 60_000;

/** "26 Sep", UTC (`dayMonth`, the page's one month spelling). */
export function stripDay(ms: number | string): string {
  return dayMonth(ms);
}

/** "26 Sep 04:00Z", UTC. */
export function stripHour(ms: number | string): string {
  const d = new Date(ms);
  return `${stripDay(ms)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}
