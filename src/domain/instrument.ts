/**
 * The DROPCON instrument: the level now and the week of lead scores that led to it, as one drawable
 * model. The trace is the same 0..100 score the level is banded from, so its right end is the live
 * reading the big number shows. Pure: points, the live reading, launches and `now` in; paths,
 * zones and a scrubber series out. No fetch, no `Date.now()`.
 *
 * Only the current algorithm version is drawn on the level axis. An older version's scores came
 * from another formula, so they are a hatched zone with their numbers in the scrubber and the
 * table, never a line: a v2 line at 88 beside a v3 reading of 53 reads as a fall from level 1 to 3
 * when it was a change of formula.
 */
import { levelForScore, type DropconLevel, type DropconState } from './dropcon';
import { stripDay, stripHour, type DisplayPoint } from './history';
import { labById, type LabId } from './lab';

const HOUR_MS = 3_600_000;

/**
 * The instrument's span: the level's own horizon (it reads 7-day odds), and LANDED's window, so
 * every frontier launch in it is on the page's dashboard and the launch marks are complete.
 */
export const INSTRUMENT_WINDOW_MS = 7 * 24 * HOUR_MS;
/** Width of the plot's coordinate space; heights are the 0..100 score itself. */
export const INSTRUMENT_WIDTH = 1000;
/** Hourly readings further apart than this are a gap in the record, not a line across it. */
export const INSTRUMENT_GAP_MS = 90 * 60_000;
/** A launch this close to the scrubbed time is listed beside it. */
export const LAUNCH_NEAR_MS = 3 * HOUR_MS;
/**
 * The time a launch's name label covers on a ~700px plot (about 150px of text in a week), and the
 * rows those labels stack in. A launch that finds no free row keeps its mark and loses its label.
 */
const LABEL_SPAN_MS = 36 * HOUR_MS;
export const LAUNCH_LABEL_ROWS = 3;
/** Past this x the label sits to the left of its line, so it never runs off the NOW edge. */
const LABEL_FLIP_X = 760;

export interface InstrumentLive {
  state: DropconState;
  score: number;
  level: DropconLevel;
  /** When the live reading was taken (the dashboard's `generatedAt`). */
  at: string;
}

export interface InstrumentLaunchInput {
  at: string;
  labId?: LabId;
  lab: string;
  name: string;
}

export interface InstrumentInput {
  /** `buildHistorySeries` output: hourly, hysteresis applied per version. */
  points: readonly DisplayPoint[];
  /** False when the series could not be read. */
  ok: boolean;
  now: number;
  currentVersion: number;
  live: InstrumentLive;
  launches: readonly InstrumentLaunchInput[];
}

/** A stretch of the window with no line on the level axis, and why. */
export interface InstrumentZone {
  kind: 'unrecorded' | 'old' | 'outage';
  /** Left edge and width in plot coordinates. */
  x: number;
  w: number;
  from: string;
  to: string;
  /** The old version's number, for `old`. */
  version?: number;
}

export interface InstrumentLaunch {
  x: number;
  at: string;
  labId?: LabId;
  lab: string;
  name: string;
  color: string;
  glyph: string;
  /** The label row (0 is the top), or undefined when no row was free. */
  row?: number;
  /** The label reads leftward from its line. */
  flip: boolean;
}

/**
 * One scrubbable reading, hour-bucketed like the series: it covers `[h, e)`. The live reading is
 * last, with `h === e`: `live` when measured, `outage` when it is a floor.
 */
export interface ScrubPoint {
  kind: 'current' | 'old' | 'outage' | 'live';
  /** Hour start and end (ms); for `live`, both are the live reading's time. */
  h: number;
  e: number;
  score: number;
  /** The displayed level (after hysteresis); absent for an old version's reading. */
  level?: DropconLevel;
  /** The display level differs from the score's own band: hysteresis held it. */
  held?: boolean;
  version: number;
}

export interface Instrument {
  state: 'ok' | 'empty' | 'unavailable';
  from: number;
  to: number;
  /** One continuous step line (and the area under it) per unbroken stretch of current readings. */
  traces: { line: string; area: string }[];
  zones: InstrumentZone[];
  launches: InstrumentLaunch[];
  /** UTC midnights inside the window. */
  ticks: { x: number; label: string }[];
  /** The NOW marker: the live reading's height, and whether the line runs into it. */
  now: { state: DropconState; score: number; level: DropconLevel; y: number; joined: boolean };
  scrub: ScrubPoint[];
  currentVersion: number;
  /** The current version's first reading in the record, when it has one. */
  currentSince?: string;
  /** The current version's latest measured reading at least 24 hours old. */
  dayAgo?: DisplayPoint;
  /** Score range of the current version's measured readings in the window. */
  range?: [number, number];
  /** Where the record starts in the window, when readings exist: the first hour captured. */
  recordedFrom?: string;
  /** One paragraph describing the instrument, for screen readers. */
  summary: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const hourStart = (iso: string) => Math.floor(Date.parse(iso) / HOUR_MS) * HOUR_MS;
const clampScore = (s: number) => Math.min(100, Math.max(0, s));
const byTime = (a: DisplayPoint, b: DisplayPoint) =>
  a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0;
const range = (a: number, b: number) => (a === b ? `${a}` : `${a} to ${b}`);

export function buildInstrument(input: InstrumentInput): Instrument {
  const { now, currentVersion, live } = input;
  const from = now - INSTRUMENT_WINDOW_MS;
  const span = now - from;
  const X = (t: number) => round2(((Math.min(Math.max(t, from), now) - from) / span) * INSTRUMENT_WIDTH);
  const Y = (score: number) => round2(100 - clampScore(score));
  const end = (p: DisplayPoint) => Math.min(hourStart(p.observedAt) + HOUR_MS, now);

  const sorted = input.ok
    ? [...input.points]
        .filter((p) => {
          const t = Date.parse(p.observedAt);
          return t <= now && t > from;
        })
        .sort(byTime)
    : [];
  const kind = (p: DisplayPoint): ScrubPoint['kind'] =>
    p.algorithmVersion !== currentVersion ? 'old' : p.degraded ? 'outage' : 'current';

  // Zones: before the first reading, every gap, every old-version and outage stretch.
  const zones: InstrumentZone[] = [];
  const zone = (k: InstrumentZone['kind'], a: number, b: number, version?: number) => {
    if (b <= a) return;
    const x = X(a);
    zones.push({
      kind: k,
      x,
      w: round2(X(b) - x),
      from: new Date(a).toISOString(),
      to: new Date(b).toISOString(),
      ...(version !== undefined ? { version } : {}),
    });
  };
  if (sorted.length) zone('unrecorded', from, hourStart(sorted[0].observedAt));
  let open: { k: ScrubPoint['kind']; v: number; a: number; b: number } | undefined;
  const closeZone = () => {
    if (open && open.k !== 'current')
      zone(open.k as 'old' | 'outage', open.a, open.b, open.k === 'old' ? open.v : undefined);
    open = undefined;
  };
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const prev = sorted[i - 1];
    const k = kind(p);
    if (prev && hourStart(p.observedAt) - hourStart(prev.observedAt) > INSTRUMENT_GAP_MS) {
      closeZone();
      zone('unrecorded', end(prev), hourStart(p.observedAt));
    }
    if (open && (open.k !== k || open.v !== p.algorithmVersion)) closeZone();
    if (!open) open = { k, v: p.algorithmVersion, a: hourStart(p.observedAt), b: end(p) };
    else open.b = end(p);
  }
  closeZone();
  const last = sorted.at(-1);
  // The record stopped well before now (the capture is down): say so up to the NOW edge.
  if (last && now - Date.parse(last.observedAt) > INSTRUMENT_GAP_MS) zone('unrecorded', end(last), now);

  // Traces: unbroken stretches of current, measured readings; the last one runs into the live
  // reading when that reading is recent and measured, so the line ends at the number.
  const joined =
    live.state === 'ok' &&
    !!last &&
    kind(last) === 'current' &&
    now - Date.parse(last.observedAt) <= INSTRUMENT_GAP_MS;
  const runs: DisplayPoint[][] = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const prev = sorted[i - 1];
    if (kind(p) !== 'current') continue;
    const run = runs.at(-1);
    const contiguous =
      run &&
      prev &&
      run.at(-1) === prev &&
      hourStart(p.observedAt) - hourStart(prev.observedAt) <= INSTRUMENT_GAP_MS;
    if (contiguous) run.push(p);
    else runs.push([p]);
  }
  const traces = runs.map((run, r) => {
    const x0 = X(hourStart(run[0].observedAt));
    const steps = run
      .slice(1)
      .map((p) => `H${X(hourStart(p.observedAt))}V${Y(p.score)}`)
      .join('');
    const isLast = r === runs.length - 1 && run.at(-1) === last;
    const tail = isLast && joined ? `H${INSTRUMENT_WIDTH}V${Y(live.score)}` : `H${X(end(run.at(-1)!))}`;
    const line = `M${x0} ${Y(run[0].score)}${steps}${tail}`;
    return { line, area: `${line}V100H${x0}Z` };
  });

  const launches: InstrumentLaunch[] = input.launches
    .filter((l) => {
      const t = Date.parse(l.at);
      return t > from && t <= now;
    })
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .map((l) => {
      const lab = labById(l.labId);
      return {
        x: X(Date.parse(l.at)),
        at: l.at,
        ...(l.labId ? { labId: l.labId } : {}),
        lab: l.lab,
        name: l.name,
        color: lab?.color ?? '#dcd8ff',
        glyph: lab?.glyph ?? '▲',
        flip: X(Date.parse(l.at)) > LABEL_FLIP_X,
      };
    });
  // Greedy rows: each label takes the first row whose labels it does not overlap in time.
  const taken: [number, number][][] = Array.from({ length: LAUNCH_LABEL_ROWS }, () => []);
  for (const l of launches) {
    const t = Date.parse(l.at);
    const extent: [number, number] = l.flip ? [t - LABEL_SPAN_MS, t] : [t, t + LABEL_SPAN_MS];
    const row = taken.findIndex((r) => r.every(([a, b]) => extent[1] <= a || extent[0] >= b));
    if (row === -1) continue;
    taken[row].push(extent);
    l.row = row;
  }

  const ticks: Instrument['ticks'] = [];
  for (let t = Math.ceil(from / (24 * HOUR_MS)) * 24 * HOUR_MS; t < now; t += 24 * HOUR_MS)
    ticks.push({ x: X(t), label: stripDay(t).toUpperCase() });

  const scrub: ScrubPoint[] = sorted.map((p) => {
    const k = kind(p);
    return {
      kind: k,
      h: hourStart(p.observedAt),
      e: end(p),
      score: p.score,
      ...(k === 'old' ? {} : { level: p.displayLevel }),
      ...(k === 'current' && p.displayLevel !== levelForScore(p.score) ? { held: true } : {}),
      version: p.algorithmVersion,
    };
  });
  // The live reading closes the series as a zero-width point: measured, or a floor (an outage).
  const liveAt = Date.parse(live.at);
  if (live.state === 'ok')
    scrub.push({
      kind: 'live',
      h: liveAt,
      e: liveAt,
      score: live.score,
      level: live.level,
      version: currentVersion,
    });
  else if (live.state === 'floor')
    scrub.push({
      kind: 'outage',
      h: liveAt,
      e: liveAt,
      score: 0,
      level: live.level,
      version: currentVersion,
    });

  const current = sorted.filter((p) => kind(p) === 'current');
  const scores = current.map((p) => p.score);
  const dayAgo = current.filter((p) => Date.parse(p.observedAt) <= now - 24 * HOUR_MS).at(-1);
  const firstCurrent = sorted.find((p) => p.algorithmVersion === currentVersion);
  const state: Instrument['state'] = !input.ok ? 'unavailable' : sorted.length ? 'ok' : 'empty';

  return {
    state,
    from,
    to: now,
    traces,
    zones,
    launches,
    ticks,
    now: {
      state: live.state,
      score: live.state === 'ok' ? live.score : 0,
      level: live.level,
      y: live.state === 'ok' ? Y(live.score) : 100,
      joined,
    },
    scrub,
    currentVersion,
    ...(firstCurrent ? { currentSince: new Date(hourStart(firstCurrent.observedAt)).toISOString() } : {}),
    ...(dayAgo ? { dayAgo } : {}),
    ...(scores.length ? { range: [Math.min(...scores), Math.max(...scores)] as [number, number] } : {}),
    ...(sorted.length ? { recordedFrom: new Date(hourStart(sorted[0].observedAt)).toISOString() } : {}),
    summary: instrumentSummary({ state, from, now, sorted, current, launches, live, currentVersion, kind }),
  };
}

function instrumentSummary(a: {
  state: Instrument['state'];
  from: number;
  now: number;
  sorted: DisplayPoint[];
  current: DisplayPoint[];
  launches: InstrumentLaunch[];
  live: InstrumentLive;
  currentVersion: number;
  kind: (p: DisplayPoint) => ScrubPoint['kind'];
}): string {
  const head = `DROPCON history, the lead score over the last 7 days (${stripDay(a.from)} to ${stripDay(a.now)}).`;
  const nowText =
    a.live.state === 'ok'
      ? `Now: level ${a.live.level}, score ${a.live.score} of 100.`
      : a.live.state === 'floor'
        ? 'Now: a floor, the odds are offline.'
        : 'Now: no signal.';
  const parts: string[] = [head];
  if (a.state === 'unavailable') parts.push('The score series could not be read; the level shown is live.');
  else if (a.state === 'empty') parts.push(`No v${a.currentVersion} readings recorded yet.`);
  else {
    if (a.current.length) {
      const s = a.current.map((p) => p.score);
      const latest = a.current.at(-1)!;
      parts.push(
        `v${a.currentVersion} from ${stripHour(new Date(hourStart(a.current[0].observedAt)).toISOString())}: ${a.current.length} hourly readings, scores ${range(Math.min(...s), Math.max(...s))}; latest recorded level ${latest.displayLevel} (score ${latest.score}).`,
      );
    } else parts.push(`No v${a.currentVersion} readings recorded yet.`);
    const old = a.sorted.filter((p) => a.kind(p) === 'old');
    if (old.length) {
      const versions = [...new Set(old.map((p) => `v${p.algorithmVersion}`))].join(', ');
      parts.push(
        `Before that, ${versions} (old scoring, not comparable, not drawn): ${old.length} hourly readings, ${stripDay(old[0].observedAt)} to ${stripDay(old.at(-1)!.observedAt)}.`,
      );
    }
    const outages = a.sorted.filter((p) => a.kind(p) === 'outage').length;
    if (outages) parts.push(`${outages} hourly readings had the odds offline.`);
    parts.push(
      `Nothing recorded before ${stripHour(new Date(hourStart(a.sorted[0].observedAt)).toISOString())}.`,
    );
  }
  parts.push(nowText);
  if (a.launches.length)
    parts.push(
      `Frontier launches in the window: ${a.launches.map((l) => `${l.name} (${l.lab}) ${stripHour(l.at)}`).join('; ')}.`,
    );
  return parts.join(' ');
}
