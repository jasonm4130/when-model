/**
 * The DROPCON instrument: the level now and the week of lead scores that led to it, as one drawable
 * model. The trace is the same 0..100 score the level is banded from, so its right end is the live
 * reading the big number shows. Pure: points, the live reading, launches and `now` in; paths,
 * zones and a scrubber series out. No fetch, no `Date.now()`.
 *
 * Only the current algorithm version is drawn on the level axis. An older version's scores came
 * from another formula, so they are a hatched zone with their numbers only in the data table, never
 * a line or the readout: a v2 line at 88 beside a v3 reading of 53 reads as a fall from level 1 to 3
 * when it was a change of formula.
 *
 * The replayed 7-day term (data/backtest/v3-replay.json) is not joined on before the first live
 * reading: its last 14 days are censored low (the replay reads 0 from 25 Sep 09:00Z while the first
 * live 7-day read was 0.62 at 26 Sep 09:31Z), so a join would draw a jump that never happened.
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
/** Past this x a label reads leftward from its line, so it never runs off the NOW edge. */
export const LABEL_FLIP_X = 760;
/** Before this x a level-change flag hangs right of its step, so it stays on the plot. */
export const CHANGE_RIGHT_X = 180;
/** While the current version's line starts later than this x, it is too short to explain itself. */
export const YOUNG_X = 750;
/**
 * Level-change flags mark the line's story, not every wobble: a change must hold this long (or be
 * the latest), flags sit at least this far apart in plot units (120 of 1000 is about 20 hours),
 * and there are at most this many, the latest kept first.
 */
export const FLAG_HOLD_MS = 3 * HOUR_MS;
export const FLAG_GAP = 120;
export const FLAG_MAX = 5;

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
  /** False when the launch listings could not be read: no marks then says nothing about launches. */
  launchesOk?: boolean;
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
  /** The label reads leftward from its line. */
  flip: boolean;
}

/** Where the displayed level changed on the current version's line, and held. */
export interface InstrumentChange {
  x: number;
  /** The score's height at the change, 0 (top) to 100. */
  y: number;
  at: string;
  level: DropconLevel;
  from: DropconLevel;
  /** Up is hotter: toward level 1. */
  dir: 'up' | 'down';
  /** "▲ L2 25 SEP 18:00Z". */
  text: string;
  /**
   * The flag hangs left of the step, where the line was not (above the corner for a rise, below
   * it for a fall); right of it only near the plot's left edge.
   */
  side: 'left' | 'right';
}

/**
 * One scrubbable reading, hour-bucketed like the series: it covers `[h, e)`. The live reading is not
 * one of them: it answers only at NOW (`src/ui/readout.ts`).
 */
export interface ScrubPoint {
  kind: 'current' | 'old' | 'outage';
  /** Hour start and end (ms). */
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
  /** False when the launch listings could not be read. */
  launchesOk: boolean;
  /** Level changes on the current version's line worth a flag, oldest first. */
  changes: InstrumentChange[];
  /** UTC midnights inside the window. */
  ticks: { x: number; label: string }[];
  /** The NOW marker: the live reading's height, and whether the line runs into it. */
  now: { state: DropconState; score: number; level: DropconLevel; y: number; joined: boolean };
  scrub: ScrubPoint[];
  currentVersion: number;
  /** The current version's first reading in the record, when it has one. */
  currentSince?: string;
  /**
   * Where the current version's record starts on the plot and how many hourly readings it has;
   * `young` while it starts in the last quarter of the window, too short to explain itself; `y` is
   * the height its line ends at.
   */
  current?: { x: number; count: number; young: boolean; y: number };
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
  const current = sorted.filter((p) => kind(p) === 'current');
  const firstCurrent = sorted.find((p) => p.algorithmVersion === currentVersion);
  const currentCount = sorted.filter((p) => p.algorithmVersion === currentVersion).length;
  const state: Instrument['state'] = !input.ok ? 'unavailable' : sorted.length ? 'ok' : 'empty';
  const currentX = firstCurrent ? X(hourStart(firstCurrent.observedAt)) : undefined;

  return {
    state,
    from,
    to: now,
    traces,
    zones,
    launches,
    launchesOk: input.launchesOk ?? true,
    changes: levelChanges(current, now, X, Y),
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
    ...(currentX !== undefined
      ? {
          current: {
            x: currentX,
            count: currentCount,
            young: currentX > YOUNG_X,
            // Where the current line ends: at the live reading when it runs into it, else its last reading.
            y: joined ? Y(live.score) : Y((current.at(-1) ?? firstCurrent!).score),
          },
        }
      : {}),
    ...(sorted.length ? { recordedFrom: new Date(hourStart(sorted[0].observedAt)).toISOString() } : {}),
    summary: instrumentSummary({
      state,
      from,
      now,
      sorted,
      current,
      launches,
      launchesOk: input.launchesOk ?? true,
      live,
      currentVersion,
      kind,
    }),
  };
}

/**
 * The line's story: every change of displayed level on the current version's measured readings,
 * kept when the new level held `FLAG_HOLD_MS` (or is the latest); a short-lived change and its
 * return to the level before it are both dropped. Latest first wins: at most `FLAG_MAX`, none
 * within `FLAG_GAP` of a later one. Oldest first out.
 */
function levelChanges(
  current: readonly DisplayPoint[],
  now: number,
  X: (t: number) => number,
  Y: (score: number) => number,
): InstrumentChange[] {
  const raw: (InstrumentChange & { held: number })[] = [];
  let shown: DropconLevel | undefined;
  for (const p of current) {
    if (p.degraded) continue;
    if (shown !== undefined && p.displayLevel !== shown) {
      const t = hourStart(p.observedAt);
      const at = new Date(t).toISOString();
      const dir = p.displayLevel < shown ? 'up' : 'down';
      const last = raw.at(-1);
      if (last) last.held = t - Date.parse(last.at);
      raw.push({
        x: X(t),
        y: Y(p.score),
        at,
        level: p.displayLevel,
        from: shown,
        dir,
        text: `${dir === 'up' ? '▲' : '▼'} L${p.displayLevel} ${stripHour(at).toUpperCase()}`,
        side: X(t) < CHANGE_RIGHT_X ? 'right' : 'left',
        held: now - t,
      });
    }
    shown = p.displayLevel;
  }
  const beats: typeof raw = [];
  for (let i = 0; i < raw.length; i++) {
    const next = raw[i + 1];
    if (next && raw[i].held < FLAG_HOLD_MS) {
      if (next.level === raw[i].from) i++;
      continue;
    }
    beats.push(raw[i]);
  }
  const out: InstrumentChange[] = [];
  for (const { held: _held, ...c } of beats.reverse()) {
    if (out.length >= FLAG_MAX) break;
    if (out.length && out[0].x - c.x < FLAG_GAP) continue;
    out.unshift(c);
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function instrumentSummary(a: {
  state: Instrument['state'];
  from: number;
  now: number;
  sorted: DisplayPoint[];
  current: DisplayPoint[];
  launches: InstrumentLaunch[];
  launchesOk: boolean;
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
        `v${a.currentVersion} from ${stripHour(new Date(hourStart(a.current[0].observedAt)).toISOString())}: ${plural(a.current.length, 'hourly reading')}, ${a.current.length === 1 ? `score ${s[0]}` : `scores ${range(Math.min(...s), Math.max(...s))}`}; latest recorded level ${latest.displayLevel} (score ${latest.score}).`,
      );
    } else parts.push(`No v${a.currentVersion} readings recorded yet.`);
    const old = a.sorted.filter((p) => a.kind(p) === 'old');
    if (old.length) {
      const versions = [...new Set(old.map((p) => `v${p.algorithmVersion}`))].join(', ');
      parts.push(
        `Before that, ${versions} (old scoring, not comparable, not drawn): ${plural(old.length, 'hourly reading')}, ${stripDay(old[0].observedAt)} to ${stripDay(old.at(-1)!.observedAt)}.`,
      );
    }
    const outages = a.sorted.filter((p) => a.kind(p) === 'outage').length;
    if (outages) parts.push(`${plural(outages, 'hourly reading')} had the odds offline.`);
    parts.push(
      `Nothing recorded before ${stripHour(new Date(hourStart(a.sorted[0].observedAt)).toISOString())}.`,
    );
  }
  parts.push(nowText);
  if (!a.launchesOk) parts.push('Launch listings could not be read, so launches are not marked.');
  else if (a.launches.length)
    parts.push(
      `Frontier launches in the window: ${a.launches.map((l) => `${l.name} (${l.lab}) ${stripHour(l.at)}`).join('; ')}.`,
    );
  return parts.join(' ');
}
