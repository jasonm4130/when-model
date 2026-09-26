/**
 * The DROPCON instrument's readout: what the scrubber says about the hour under the cursor, and
 * what it says at rest (NOW). Shared by the server render (the readout's first paint, the slider's
 * value text) and the browser (every hour the cursor visits), so the two cannot drift apart.
 *
 * Pure. It imports only the date and level-name modules, so the browser bundle carries no scoring
 * code. The live reading answers only at NOW itself: an hour back from NOW is that hour's record,
 * or no reading, never the live score with an earlier time on it.
 */
import { dayMonth, MONTHS } from '../domain/dates';
import { LEVEL_NAMES } from '../domain/levels';

const HOUR_MS = 3_600_000;
export const NEAR_MAX = 3;

/** A reading of the current version, an older version's reading, or an hour the odds were offline. */
export type ScrubKind = 'c' | 'o' | 'x';
/** One hourly reading: [kind, hour start ms, hour end ms, score, display level (0 when old), held 0|1, version]. */
export type ScrubPoint = [
  kind: ScrubKind,
  h: number,
  e: number,
  score: number,
  level: number,
  held: 0 | 1,
  version: number,
];
/** One frontier launch: [first listed ms, name, lab, glyph, colour]. */
export type ScrubLaunch = [t: number, name: string, lab: string, glyph: string, color: string];

export interface ScrubLive {
  state: 'ok' | 'floor' | 'no-signal';
  /** When the live reading was taken, ms. */
  at: number;
  score: number;
  level: number;
}

/** Everything the browser scrubber needs, embedded on the instrument as JSON. */
export interface ScrubData {
  /** The window, ms; `to` is NOW. */
  from: number;
  to: number;
  version: number;
  history: 'ok' | 'empty' | 'unavailable';
  /** False when the launch listings could not be read, so no marks does not mean no launches. */
  launchesOk: boolean;
  /** The first hour in the record, when there is one (it may be before the window). */
  recordFrom?: number;
  /** The latest reading, when the record has one but none of it is in the window. */
  last?: number;
  /** Launches this close to the cursor (ms) are named. */
  near: number;
  pts: ScrubPoint[];
  launches: ScrubLaunch[];
  live: ScrubLive;
}

export type ReadoutTone = 'ok' | 'old' | 'outage' | 'none';

export interface Readout {
  now: boolean;
  /** "NOW · 26 SEP 10:18Z", or the hour: "25 SEP 14:00Z". */
  when: string;
  /** What was read, as printed: "score 53 → level 3", or why there is no reading. */
  what: string;
  /** The same for a screen reader: no arrows, full words. */
  spoken: string;
  tone: ReadoutTone;
  level?: number;
  /** The level's name, for a measured reading. */
  name?: string;
  /** The score, for a measured reading: where the probe sits. */
  score?: number;
  /** Hysteresis held the level away from the score's own band. */
  held?: boolean;
  /** Launches near the cursor, nearest first. */
  near: ScrubLaunch[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "26 SEP 10:18Z", UTC, with the page's own month spelling. */
export function timeText(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].toUpperCase()} ${hh}:${mm}Z`;
}

const levelName = (level: number): string | undefined => LEVEL_NAMES[level as keyof typeof LEVEL_NAMES];

/**
 * The reading whose hour covers `t`. Where two versions share the hour they changed in, the later
 * (current) one answers.
 */
export function pointAt(data: ScrubData, t: number): ScrubPoint | undefined {
  return data.pts.findLast((p) => t >= p[1] && t < p[2]);
}

/** Up to `NEAR_MAX` launches within `data.near` of `t` (inclusive), nearest first. */
export function launchesNear(data: ScrubData, t: number): ScrubLaunch[] {
  return data.launches
    .filter((l) => Math.abs(l[0] - t) <= data.near)
    .sort((a, b) => Math.abs(a[0] - t) - Math.abs(b[0] - t))
    .slice(0, NEAR_MAX);
}

/** The readout at rest: the live reading, which the big number shows. */
export function nowReadout(data: ScrubData): Readout {
  const { live } = data;
  const when = `NOW · ${timeText(live.at)}`;
  const near = launchesNear(data, data.to);
  if (live.state === 'no-signal') {
    const what = 'no signal · odds and listings down';
    return { now: true, when, what, spoken: what.replace(' · ', ': '), tone: 'none', near };
  }
  if (live.state === 'floor') {
    const what = 'floor · odds offline, not measured';
    return {
      now: true,
      when,
      what,
      spoken: what.replace(' · ', ': '),
      tone: 'outage',
      level: live.level,
      near,
    };
  }
  const name = levelName(live.level);
  return {
    now: true,
    when,
    what: `score ${live.score} → level ${live.level}`,
    spoken: `score ${live.score}, level ${live.level}`,
    tone: 'ok',
    level: live.level,
    ...(name ? { name } : {}),
    score: live.score,
    near,
  };
}

/** The readout for the cursor at `t`. `t` at or past NOW is the live reading; anything earlier is the record. */
export function readout(data: ScrubData, t: number): Readout {
  if (t >= data.to) return nowReadout(data);
  const near = launchesNear(data, t);
  const hour = Math.floor(t / HOUR_MS) * HOUR_MS;
  const none = (what: string): Readout => ({
    now: false,
    when: timeText(hour),
    what,
    spoken: what.replace(' · ', ': '),
    tone: 'none',
    near,
  });
  if (data.history === 'unavailable') return none('history offline · log unreadable');
  if (data.history === 'empty')
    return none(
      data.last !== undefined ? `no reading · last one ${timeText(data.last)}` : 'no readings recorded yet',
    );
  const p = pointAt(data, t);
  if (!p) {
    if (data.recordFrom !== undefined && t < data.recordFrom)
      return none(`no record · log starts ${dayMonth(data.recordFrom)}`);
    return none('no reading this hour');
  }
  const [kind, h, , score, level, held, version] = p;
  const when = timeText(h);
  if (kind === 'o') {
    // An older formula's number is not on this scale, so it is never printed beside the level.
    const what = `v${version} · old scale, not comparable`;
    return { now: false, when, what, spoken: what.replace(' · ', ': '), tone: 'old', near };
  }
  if (kind === 'x') {
    const what = `odds offline · level ${level} held`;
    return { now: false, when, what, spoken: what.replace(' · ', ': '), tone: 'outage', level, near };
  }
  const name = levelName(level);
  return {
    now: false,
    when,
    what: `score ${score} → level ${level}${held ? ' (held)' : ''}`,
    spoken: `score ${score}, level ${level}`,
    tone: 'ok',
    level,
    ...(name ? { name } : {}),
    score,
    ...(held ? { held: true } : {}),
    near,
  };
}

const launchText = (l: ScrubLaunch) => `${l[3]} ${l[1]} (${l[2]}) ${timeText(l[0])}`;

/** The readout's second line while scrubbing: the launches near the cursor, or that there are none. */
export function nearLine(data: ScrubData, r: Readout): string {
  if (!data.launchesOk) return 'launch listings offline';
  if (!r.near.length) return `no frontier launch within ${Math.round(data.near / HOUR_MS)}h`;
  return `near: ${r.near.map(launchText).join(' · ')}`;
}

/** The readout's second line at rest: this week's launches, and the latest. */
export function launchLine(data: ScrubData): string {
  if (!data.launchesOk) return 'Launch listings offline: OpenRouter unreachable, launches not marked';
  const latest = data.launches.at(-1);
  if (!latest) return 'No frontier launches listed in these 7 days';
  return `${plural(data.launches.length, 'frontier launch', 'frontier launches')} in 7 days · latest ${latest[3]} ${latest[1]} (${latest[2]}), ${dayMonth(latest[0])}`;
}

/** One sentence for the slider's `aria-valuetext`. */
export function readoutText(r: Readout): string {
  const name = r.name ? `, ${r.name}` : '';
  const held = r.held ? ', held by hysteresis' : '';
  const near = r.near.length ? `. Launches near: ${r.near.map((l) => `${l[1]} (${l[2]})`).join(', ')}` : '';
  return `${r.now ? r.when.replace(' · ', ', ') : r.when}: ${r.spoken}${name}${held}${near}`;
}
