/**
 * What `DropconScope.astro` draws, worked out from the dashboard, the 30-day history and the page's
 * clock: the instrument (src/domain/instrument.ts), the level bands beside it, each zone's text, the
 * scrubber's data and first readout, and the first-paint placement of launch names. Pure; the
 * component only renders it.
 */
import type { Dashboard } from '../domain/dashboard';
import { LEVEL_BANDS, type DropconLevel } from '../domain/dropcon';
import type { DisplayPoint } from '../domain/history';
import { stripDay, stripHour } from '../domain/history';
import {
  INSTRUMENT_WIDTH,
  LAUNCH_NEAR_MS,
  buildInstrument,
  type Instrument,
  type InstrumentZone,
  type ScrubPoint,
} from '../domain/instrument';
import { SOURCE } from '../domain/sources';
import { estimateFlagWidth, flagCandidates, placeLabels, type Box } from './labels';
import { lineBullet } from './lines';
import { nowReadout, type ScrubData, type ScrubKind } from './readout';

/** One level's band on the scale, top to bottom in score. */
export interface ScopeBand {
  level: DropconLevel;
  top: number;
  bottom: number;
}

/** Band edges top to bottom: 100–75 is level 1, …, 15–0 is level 5. */
export const SCOPE_EDGES: readonly number[] = [100, ...LEVEL_BANDS, 0];

export const SCOPE_BANDS: readonly ScopeBand[] = SCOPE_EDGES.slice(0, -1).map((top, i) => ({
  level: (i + 1) as DropconLevel,
  top,
  bottom: SCOPE_EDGES[i + 1],
}));

/** An x in instrument units as a CSS percentage of the plot's width. */
export const widthPct = (x: number): string => `${(x / INSTRUMENT_WIDTH) * 100}%`;

/** A band's score range in words: "75+", "45–59", "below 15". */
export const bandRange = (b: { top: number; bottom: number }): string =>
  b.top === 100 ? `${b.bottom}+` : b.bottom === 0 ? `below ${b.top}` : `${b.bottom}–${b.top - 1}`;

/** The scale segment's class for level `n`: lit at the live level, dimmed with no odds. */
export function segClass(c: Pick<Dashboard['dropcon'], 'state' | 'level'>, n: number): string {
  if (c.state === 'no-signal') return 'seg dim';
  if (c.state === 'floor') return `seg dim${n === c.level ? ' floor' : ''}`;
  return `seg${n === c.level ? ' on' : ''}`;
}

/** The scale's accessible name. */
export function scaleLabel(c: Pick<Dashboard['dropcon'], 'state' | 'level'>): string {
  return c.state === 'no-signal'
    ? 'DROPCON: no signal'
    : c.state === 'floor'
      ? `DROPCON floor: ${c.level} of 5 with the odds offline`
      : `DROPCON ${c.level} of 5`;
}

/** What each hatched or empty stretch says, at three widths: the plot picks the one that fits whole. */
export function zoneText(z: InstrumentZone): { head: string; sub: string; min: string } {
  return z.kind === 'old'
    ? { head: `v${z.version} · OLD SCALE`, sub: 'another formula, not comparable', min: `v${z.version}` }
    : z.kind === 'outage'
      ? { head: 'ODDS OFFLINE', sub: 'level held, not measured', min: '✕' }
      : { head: 'NO RECORD', sub: z.start ? `captures start ${stripDay(z.to)}` : 'no captures', min: '' };
}

const SCRUB_KIND: Record<ScrubPoint['kind'], ScrubKind> = { current: 'c', old: 'o', outage: 'x' };

/** First paint places launch names on a reference 1000 x 236 px plot with estimated widths. */
const REF: Box = { left: 0, top: 0, right: INSTRUMENT_WIDTH, bottom: 236 };
/** The "▲ 1 · RELEASE SURGE" direction label in the plot's top left, which a flag must not cover. */
const DIR_TOP: Box = { left: 0, top: 0, right: 180, bottom: 24 };

/** A launch flag's text: its line's letter, then the model. */
const flagText = (l: Instrument['launches'][number]) => `${lineBullet(l.labId ?? '').letter} ${l.name}`;

/**
 * Everything the component reads. `history` is `/api/history.json`'s body (missing is the same as
 * unreadable); `now` is the page's one clock read.
 */
export function scopeView(
  d: Dashboard,
  history: { ok: boolean; points: DisplayPoint[] } | undefined,
  now: number,
) {
  const c = d.dropcon;
  const launchesOk = d.sources.find((s) => s.name === SOURCE.openrouter)?.ok ?? false;
  const inst = buildInstrument({
    points: history?.points ?? [],
    ok: history?.ok ?? false,
    now,
    currentVersion: d.measurement.algorithmVersion,
    live: { state: c.state, score: c.score, level: c.level, at: d.generatedAt },
    launches: d.landed.releases.map((r) => ({
      at: r.firstListedAt,
      labId: r.labId,
      lab: r.lab,
      name: r.name,
    })),
    launchesOk,
  });

  // The scrubber's data and the readout it starts from (the same functions the browser runs).
  const data: ScrubData = {
    from: inst.from,
    to: inst.to,
    version: inst.currentVersion,
    history: inst.state,
    launchesOk: inst.launchesOk,
    ...(inst.recordedFrom ? { recordFrom: Date.parse(inst.recordedFrom) } : {}),
    ...(inst.lastReading ? { last: Date.parse(inst.lastReading) } : {}),
    near: LAUNCH_NEAR_MS,
    pts: inst.scrub.map((p) => [
      SCRUB_KIND[p.kind],
      p.h,
      p.e,
      p.score,
      p.level ?? 0,
      p.held ? 1 : 0,
      p.version,
    ]),
    // A launch carries its line's bullet: the letter in the readout, the fill on the flag.
    launches: inst.launches.map((l) => {
      const b = lineBullet(l.labId ?? '');
      return [Date.parse(l.at), l.name, l.lab, b.letter, b.fill];
    }),
    live: { state: c.state, at: Date.parse(d.generatedAt), score: c.score, level: c.level },
  };

  // The current version's start: a quiet tag once its line explains itself, a callout while it is young.
  const cur = inst.current;

  return {
    c,
    inst,
    ok: c.state === 'ok',
    data,
    rest: nowReadout(data),
    cur,
    v3: cur && cur.x > INSTRUMENT_WIDTH * 0.03 ? cur : undefined,
    readings: cur ? `${cur.count} hourly reading${cur.count === 1 ? '' : 's'}` : '',
    youngBelow: (cur?.y ?? inst.now.y) < 58,
    // The series is hourly, and the hour a version changed in holds both: its start is an hour, not a minute.
    hhmm: inst.currentSince ? stripHour(inst.currentSince).slice(-6) : '',
    // The script measures the real plot and places the names again (src/ui/labels.ts either way).
    rows: placeLabels(
      inst.launches.map((l) => flagCandidates(l.x, estimateFlagWidth(flagText(l)), l.flip)),
      REF,
      [DIR_TOP],
    ),
    tableRows: inst.scrub.slice().reverse(),
  };
}
