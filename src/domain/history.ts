/**
 * Pure shaping of the DROPCON score series read from D1 (src/infra/snapshot-store.ts) into
 * something a history strip can draw: hourly downsampling, hysteresis so single-slot
 * wobbles don't flip the displayed level, and a split wherever the scoring algorithm
 * changed underneath the numbers. No fetch, no `Date.now()`.
 */
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

/* ───────────── The history strip: a drawable view of `buildHistorySeries` ───────────── */

/** Width of the strip's coordinate space. Heights are the 0..100 score itself. */
export const STRIP_WIDTH = 1000;
const HOUR_MS = 3_600_000;
/** The strip never spans less than a day, so a first reading is not stretched across the width. */
export const STRIP_MIN_SPAN_MS = 24 * HOUR_MS;
/** Hourly points further apart than this are drawn as separate runs: no reading, no bar. */
const RUN_GAP_MS = 90 * 60_000;

export interface StripRun {
  algorithmVersion: number;
  /** The version the live level uses. Older versions are drawn dimmed: their scores are not comparable. */
  current: boolean;
  /** The display level every point shares (current version only); undefined for an outage or an old version. */
  level?: Level;
  /** Odds offline or no signal: drawn as a faint full-height band, not a score. */
  degraded: boolean;
  /** Start of the first point's hour, and end of the last point's hour (capped at now), ISO. */
  from: string;
  to: string;
  points: number;
  /** Lowest and highest score among the run's readings. */
  min: number;
  max: number;
  /** Step-area path in strip coordinates, and its top edge (empty for an outage). */
  area: string;
  edge: string;
  /** A short description of the run, for its hover title. */
  title: string;
}

export interface StripVersion {
  algorithmVersion: number;
  current: boolean;
  from: string;
  to: string;
  /** Left edge and width in strip coordinates. */
  x: number;
  w: number;
  /** Hourly readings, and those that were real measurements (not an outage). */
  points: number;
  measured: number;
  /** Score range of the measured readings; undefined when every reading was an outage. */
  min?: number;
  max?: number;
  /** Display-level range of the measured readings, 1 being the highest level. */
  levels?: [Level, Level];
  latest: DisplayPoint;
}

export interface HistoryStrip {
  /** `unavailable`: the series could not be read. `empty`: it was read and holds nothing yet. */
  state: 'ok' | 'empty' | 'unavailable';
  /** The drawn time domain, ISO; `to` is now. */
  from: string;
  to: string;
  runs: StripRun[];
  versions: StripVersion[];
  /** Every version change: its x in strip coordinates, when, and the version that starts there. */
  breaks: { x: number; at: string; algorithmVersion: number }[];
  currentVersion: number;
  /** When the current version's history starts: its first reading, or now when it has none yet. */
  currentSince: string;
  /** Whether `currentSince` is a recorded reading (false: the current version has none yet). */
  currentRecorded: boolean;
  /** The current version's latest reading at least 24 hours old, when there is one. */
  dayAgo?: DisplayPoint;
  /** One paragraph describing the series, for the strip's accessible name. */
  summary: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "26 Sep", UTC. Spelled out by hand: ICU writes "Sept" for en-GB, and runtimes differ. */
export function stripDay(ms: number | string): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "26 Sep 04:00Z", UTC. */
export function stripHour(ms: number | string): string {
  const d = new Date(ms);
  return `${stripDay(ms)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const hourStart = (iso: string) => Math.floor(Date.parse(iso) / HOUR_MS) * HOUR_MS;
const clampScore = (s: number) => Math.min(100, Math.max(0, s));
const range = (a: number, b: number) => (a === b ? `${a}` : `${a} to ${b}`);

/**
 * The strip's drawable model: one step-area run per stretch of hours sharing a version and a
 * display level (older versions and outages each as their own run), a break at every version
 * change, and a summary for its accessible name. `points` is `buildHistorySeries` output; `ok` is
 * false when the series could not be read. The domain runs from the first reading's hour (or a day
 * back, whichever is earlier) to `now`, so a short history fills the strip instead of sitting in a
 * corner of an empty 30 days.
 */
export function historyStrip(
  points: readonly DisplayPoint[],
  opts: { ok: boolean; now: number; currentVersion: number },
): HistoryStrip {
  const { now, currentVersion } = opts;
  const sorted = [...points].sort(byObservedAtAsc).filter((p) => Date.parse(p.observedAt) <= now);
  const first = sorted.length ? hourStart(sorted[0].observedAt) : now;
  const from = Math.min(first, now - STRIP_MIN_SPAN_MS);
  const span = now - from;
  const X = (t: number) => round2(((Math.min(Math.max(t, from), now) - from) / span) * STRIP_WIDTH);
  const Y = (score: number) => round2(100 - clampScore(score));
  const end = (p: DisplayPoint) => Math.min(hourStart(p.observedAt) + HOUR_MS, now);

  const runs: StripRun[] = [];
  let run: DisplayPoint[] = [];
  const flush = () => {
    if (!run.length) return;
    const head = run[0];
    const current = head.algorithmVersion === currentVersion;
    const scores = run.map((p) => p.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const x0 = X(hourStart(head.observedAt));
    const xEnd = X(end(run[run.length - 1]));
    let area: string;
    let edge = '';
    if (head.degraded) area = `M${x0} 100V0H${xEnd}V100Z`;
    else {
      const steps = run.map(
        (p, i) => `V${Y(p.score)}H${i + 1 < run.length ? X(hourStart(run[i + 1].observedAt)) : xEnd}`,
      );
      area = `M${x0} 100${steps.join('')}V100Z`;
      edge = `M${x0} ${Y(head.score)}${steps.join('').replace(/^V[\d.]+/, '')}`;
    }
    const fromIso = new Date(hourStart(head.observedAt)).toISOString();
    const toIso = new Date(end(run[run.length - 1])).toISOString();
    const when = `${stripHour(fromIso)}–${stripHour(toIso)}`;
    const what = head.degraded
      ? 'odds offline, level held'
      : current
        ? `level ${head.displayLevel} · score ${range(min, max)}`
        : `old scoring, not comparable · score ${range(min, max)}`;
    runs.push({
      algorithmVersion: head.algorithmVersion,
      current,
      ...(current && !head.degraded ? { level: head.displayLevel } : {}),
      degraded: head.degraded,
      from: fromIso,
      to: toIso,
      points: run.length,
      min,
      max,
      area,
      edge,
      title: `v${head.algorithmVersion} · ${when} · ${what}`,
    });
    run = [];
  };
  const key = (p: DisplayPoint) =>
    `${p.algorithmVersion}|${p.degraded ? 'x' : p.algorithmVersion === currentVersion ? p.displayLevel : '-'}`;
  for (const p of sorted) {
    const prev = run.at(-1);
    if (prev && (key(prev) !== key(p) || hourStart(p.observedAt) - hourStart(prev.observedAt) > RUN_GAP_MS))
      flush();
    run.push(p);
  }
  flush();

  const versions: StripVersion[] = splitByAlgorithmVersion(sorted).map((segment) => {
    const seg = segment as DisplayPoint[];
    const measured = seg.filter((p) => !p.degraded);
    const x = X(hourStart(seg[0].observedAt));
    const scores = measured.map((p) => p.score);
    const levels = measured.map((p) => p.displayLevel);
    return {
      algorithmVersion: seg[0].algorithmVersion,
      current: seg[0].algorithmVersion === currentVersion,
      from: new Date(hourStart(seg[0].observedAt)).toISOString(),
      to: new Date(end(seg[seg.length - 1])).toISOString(),
      x,
      w: round2(X(end(seg[seg.length - 1])) - x),
      points: seg.length,
      measured: measured.length,
      ...(measured.length
        ? {
            min: Math.min(...scores),
            max: Math.max(...scores),
            levels: [Math.min(...levels), Math.max(...levels)] as [Level, Level],
          }
        : {}),
      latest: seg[seg.length - 1],
    };
  });
  const breaks = versions.slice(1).map((v) => ({ x: v.x, at: v.from, algorithmVersion: v.algorithmVersion }));

  const currentPoints = sorted.filter((p) => p.algorithmVersion === currentVersion);
  const currentSince = currentPoints.length
    ? new Date(hourStart(currentPoints[0].observedAt)).toISOString()
    : new Date(now).toISOString();
  const dayAgo = currentPoints
    .filter((p) => !p.degraded && Date.parse(p.observedAt) <= now - 24 * HOUR_MS)
    .at(-1);

  const state: HistoryStrip['state'] = !opts.ok ? 'unavailable' : sorted.length ? 'ok' : 'empty';
  const startsLine = `v${currentVersion} history starts ${stripDay(currentSince)}.`;
  let summary: string;
  if (state === 'unavailable')
    summary = 'DROPCON history is unavailable: the score series could not be read. The level shown is live.';
  else if (state === 'empty') summary = `DROPCON history: no readings recorded yet. ${startsLine}`;
  else {
    const parts = versions.map((v) => {
      const scores = v.min !== undefined ? `, scores ${range(v.min, v.max!)}` : '';
      const outages = v.points - v.measured;
      const offline = outages ? `, ${outages} with the odds offline` : '';
      if (!v.current)
        return `v${v.algorithmVersion} (old scoring, not comparable), ${stripDay(v.from)} to ${stripDay(v.to)}: ${v.points} hourly readings${scores}${offline}.`;
      const latest = v.latest.degraded
        ? `latest reading had the odds offline`
        : `latest level ${v.latest.displayLevel} (score ${v.latest.score})`;
      return `v${v.algorithmVersion} from ${stripDay(v.from)}: ${v.points} hourly readings${scores}${offline}; ${latest}.`;
    });
    if (!currentPoints.length) parts.push(startsLine);
    summary = `DROPCON history, ${stripDay(from)} to ${stripDay(now)}, one bar per hour. ${parts.join(' ')}`;
  }

  return {
    state,
    from: new Date(from).toISOString(),
    to: new Date(now).toISOString(),
    runs,
    versions,
    breaks,
    currentVersion,
    currentSince,
    currentRecorded: currentPoints.length > 0,
    ...(dayAgo ? { dayAgo } : {}),
    summary,
  };
}
