/**
 * The departure board: which lab's model departs next, when its boarding window opens, and what the
 * board says for a line it cannot time. Pure filters over the memoised dashboard, read the same way
 * by the server render and the refresh fingerprint (`fingerprint.ts`).
 *
 * The rules:
 * - Next departure: the lab with the highest TRUSTED 7-day read, the read DROPCON itself scores
 *   (`trustedP`). An extrapolated read is never a departure. Ties go to the higher trusted 30-day
 *   read, then the higher heat, then the dashboard's own order (heat), then the lab id.
 * - Boarding window: from the family's dated rungs (cumulative "released by" prices, and 1 − price
 *   for "no release by"; thin books are left out because they are not odds). It opens at the last
 *   rung below 50% and closes at the first at or above it; "by <date>" when the first rung is
 *   already there; no window when no rung reaches 50%.
 * - A line whose only 7-day read is extrapolated has its times unavailable; a line with no release
 *   market has no timetable; with Polymarket down every line's timetable is offline.
 */
import { monthName, weekdayName } from '../domain/dates';
import type { Dashboard } from '../domain/dashboard';
import { trustedP, type LabOddsRead, type LabStatus } from '../domain/lab-status';
import { modelFamily, type Market } from '../domain/market';
import { pct } from './format';
import { asOfMs } from './panels';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// ─── dates ────────────────────────────────────────────────────────────────────

/**
 * The calendar day a Polymarket deadline names, as midnight UTC of that day. Deadlines are 23:59:59
 * New York time (03:59 or 04:59 UTC the next day), so the UTC date of the deadline itself is a day
 * late; twelve hours earlier is always inside the named New York day.
 */
export function deadlineDay(deadline: string | number): number {
  const t = new Date(typeof deadline === 'number' ? deadline : Date.parse(deadline)).getTime() - 12 * HOUR_MS;
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** "Wed 7 Oct", with the year when it is not `now`'s ("Wed 31 Mar 2027"). */
export function dayLabel(day: number, now: number, weekday = true): string {
  const d = new Date(day);
  const year = d.getUTCFullYear() !== new Date(now).getUTCFullYear() ? ` ${d.getUTCFullYear()}` : '';
  return `${weekday ? `${weekdayName(d)} ` : ''}${d.getUTCDate()} ${monthName(d)}${year}`;
}

// ─── rungs ────────────────────────────────────────────────────────────────────

/** One dated stop on a family's timetable: the chance it has shipped by the end of `day`. */
export interface DatedRung {
  /** ISO deadline, as the market sets it. */
  deadline: string;
  /** The New York day it names, midnight UTC (`deadlineDay`). */
  day: number;
  /** P(released by the deadline): the Yes price, or 1 − price for "no release by". */
  p: number;
  /** The market that quoted it. */
  url: string;
}

/** The release markets of a lab's headline family, busiest first as the dashboard lists them. */
export function familyMarkets(
  d: Partial<Pick<Dashboard, 'markets'>>,
  lab: Pick<LabStatus, 'id' | 'odds'>,
): Market[] {
  const odds = lab.odds;
  if (!odds) return [];
  const mine = (d.markets ?? []).filter((m) => m.kind === 'release' && m.labId === lab.id);
  const anchor = mine.find((m) => m.url === odds.marketUrl);
  const key = modelFamily(anchor?.title ?? `${odds.family} released by`)?.key;
  return key ? mine.filter((m) => modelFamily(m.title)?.key === key) : [];
}

/**
 * The dated rungs of some markets, earliest first: open cumulative outcomes whose deadline is not
 * behind `asOf`, with a real book. One rung per day; the busiest market's quote wins.
 */
export function datedRungs(markets: readonly Market[], asOf: number | undefined): DatedRung[] {
  const byDay = new Map<number, DatedRung>();
  for (const m of markets)
    for (const o of m.outcomes) {
      if (o.closed || o.thin || !o.deadline) continue;
      if (o.deadlineKind !== 'by' && o.deadlineKind !== 'no-release') continue;
      if (asOf !== undefined && Date.parse(o.deadline) < asOf) continue;
      const day = deadlineDay(o.deadline);
      if (byDay.has(day)) continue;
      byDay.set(day, {
        deadline: o.deadline,
        day,
        p: o.deadlineKind === 'by' ? o.yes : 1 - o.yes,
        url: m.url,
      });
    }
  return [...byDay.values()].sort((a, b) => a.day - b.day);
}

// ─── boarding window ─────────────────────────────────────────────────────────

export type BoardingWindow =
  | { kind: 'window'; from: DatedRung; to: DatedRung }
  | { kind: 'by'; to: DatedRung }
  /** No rung reaches 50%; `last` is the furthest stop, when there is one. */
  | { kind: 'none'; last?: DatedRung };

/** The threshold the window crosses: even odds. */
export const BOARDING_P = 0.5;

export function boardingWindow(rungs: readonly DatedRung[]): BoardingWindow {
  const i = rungs.findIndex((r) => r.p >= BOARDING_P);
  if (i === -1) return { kind: 'none', ...(rungs.length ? { last: rungs[rungs.length - 1] } : {}) };
  if (i === 0) return { kind: 'by', to: rungs[0] };
  return { kind: 'window', from: rungs[i - 1], to: rungs[i] };
}

/**
 * The window as the board prints it: "Wed 7 – Thu 15 Oct", "Wed 30 Sep – Thu 15 Oct", "by Fri
 * 9 Oct", or "Not yet called". `short` drops the weekdays, for a row: "7 – 15 Oct".
 */
export function windowText(w: BoardingWindow, now: number, short = false): string {
  const wd = !short;
  if (w.kind === 'none') return short ? '—' : 'Not yet called';
  if (w.kind === 'by') return `by ${dayLabel(w.to.day, now, wd)}`;
  const a = new Date(w.from.day);
  const b = new Date(w.to.day);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  const from = sameMonth
    ? `${wd ? `${weekdayName(a)} ` : ''}${a.getUTCDate()}`
    : dayLabel(w.from.day, now, wd);
  return `${from} – ${dayLabel(w.to.day, now, wd)}`;
}

/** The line under the window: which stops set it, at what prices. */
export function windowNote(w: BoardingWindow, now: number): string {
  const at = (r: DatedRung) => `${pct(r.p)} by ${dayLabel(r.day, now, false)}`;
  if (w.kind === 'window') return `${at(w.from)}, ${at(w.to)} on Polymarket`;
  if (w.kind === 'by') return `${at(w.to)} on Polymarket, its first stop`;
  if (w.last) return `No stop reaches even odds; the last is ${at(w.last)}`;
  return 'No dated stop on a real book';
}

// ─── lines ──────────────────────────────────────────────────────────────────

/**
 * What the board can say about a line's next 7 days: a time it trusts, a time it will not print
 * (extrapolated only), no timetable (no release market), or offline (Polymarket down).
 */
export type TimetableState = 'scheduled' | 'times-unavailable' | 'no-timetable' | 'offline';

export function timetableState(lab: Pick<LabStatus, 'odds'>, oddsAvailable: boolean): TimetableState {
  if (lab.odds) return lab.odds.p7.trusted ? 'scheduled' : 'times-unavailable';
  return oddsAvailable ? 'no-timetable' : 'offline';
}

/** Board order: trusted 7-day read, trusted 30-day read, heat, dashboard order, id. */
export function departureOrder(labs: readonly LabStatus[]): LabStatus[] {
  return labs
    .map((l, i) => ({ l, i }))
    .sort(
      (a, b) =>
        trustedP(b.l.odds?.p7) - trustedP(a.l.odds?.p7) ||
        trustedP(b.l.odds?.p30) - trustedP(a.l.odds?.p30) ||
        b.l.heat - a.l.heat ||
        a.i - b.i ||
        (a.l.id < b.l.id ? -1 : 1),
    )
    .map(({ l }) => l);
}

/** One scheduled departure: a line with a trusted 7-day read, its service and its window. */
export interface Departure {
  lab: LabStatus;
  /** The market family, e.g. "Next Claude Haiku (4.6+)". */
  family: string;
  /** Trusted P(released within 7 days). */
  p7: number;
  rungs: DatedRung[];
  window: BoardingWindow;
}

type BoardInput = Partial<Pick<Dashboard, 'labs' | 'markets' | 'generatedAt' | 'measurement'>>;

function departure(d: BoardInput, lab: LabStatus): Departure {
  const rungs = datedRungs(familyMarkets(d, lab), asOfMs(d));
  return { lab, family: lab.odds!.family, p7: lab.odds!.p7.p, rungs, window: boardingWindow(rungs) };
}

const oddsUp = (d: BoardInput) => d.measurement?.inputs?.oddsAvailable ?? true;

/** Why no departure is scheduled: the odds are offline, or no line has a trusted 7-day read. */
export type NoDeparture = { reason: 'offline' | 'untrusted' };

/**
 * The next model departing (see the rules at the top), or why there is none. A read of exactly 0
 * is still a trusted read, but it is not a departure.
 */
export function nextDeparture(d: BoardInput): Departure | NoDeparture {
  const first = departureOrder(d.labs ?? []).find((l) => trustedP(l.odds?.p7) > 0);
  if (first) return departure(d, first);
  return { reason: oddsUp(d) ? 'untrusted' : 'offline' };
}

export function isDeparture(x: Departure | NoDeparture): x is Departure {
  return 'lab' in x;
}

/** The whole board: the next departure, then every other timed line, then the lines it cannot time. */
export interface Board {
  next: Departure | NoDeparture;
  later: Departure[];
  /** Lines with an extrapolated 7-day read only: "times unavailable". */
  unavailable: LabStatus[];
  /** Lines with no release market, or every line without odds when Polymarket is down. */
  untimed: LabStatus[];
  /** Polymarket was down: `untimed` is "offline", not "no timetable". */
  offline: boolean;
}

export function departureBoard(d: BoardInput): Board {
  const offline = !oddsUp(d);
  const ordered = departureOrder(d.labs ?? []);
  const next = nextDeparture(d);
  const timed = ordered.filter((l) => trustedP(l.odds?.p7) > 0 || l.odds?.p7.trusted);
  return {
    next,
    later: timed.filter((l) => !isDeparture(next) || l !== next.lab).map((l) => departure(d, l)),
    unavailable: ordered.filter((l) => timetableState(l, !offline) === 'times-unavailable'),
    untimed: ordered.filter((l) => {
      const s = timetableState(l, !offline);
      return s === 'no-timetable' || s === 'offline';
    }),
    offline,
  };
}

// ─── a line's strip map ──────────────────────────────────────────────────────

/**
 * Where a lab's 7-day read sits on its family's curve, in one sentence. Dates are the days the
 * rungs name. An extrapolated read says so: it is shown, never scored.
 */
export function readSentence(read: LabOddsRead, now: number): string {
  const day = (r: { deadline: string } | undefined) => r && dayLabel(deadlineDay(r.deadline), now, false);
  const from = day(read.from);
  const to = day(read.to);
  if (!read.trusted)
    return `Extrapolated from now to its ${to ?? 'far'} stop, too far out to trust; not scored.`;
  if (read.upperBound) return "At most: capped by the day buckets' asks.";
  if (read.source === 'buckets') return "At least: the day buckets' best bids.";
  if (read.lowerBound) return `At least: held at its ${from ?? 'last'} stop.`;
  if (read.interpolated)
    return from
      ? `Read off the market's curve between its ${from} and ${to} stops.`
      : `Read off the market's curve from now to its ${to} stop.`;
  return `Quoted at its ${to ?? from} stop.`;
}

/** A stop on a line's strip map. */
export interface StripStop {
  kind: 'now' | 'rung' | 'tick';
  /** The instant it stands for: now, a rung's deadline, or now plus the horizon. */
  at: number;
  /** The day it prints, midnight UTC. */
  day: number;
  /** P(departed by then); absent for now and the 7-day tick (the page's big number). */
  p?: number;
  /** For a tick: "72 hours", "7 days", "30 days"; for a rung, the horizon it stands in for. */
  horizon?: string;
}

/** Market rungs a strip shows, nearest first; the curve's horizon ticks join them in time order. */
export const STRIP_RUNGS = 5;

const HORIZONS = [
  { key: 'p72', hours: 72, label: '72 hours' },
  { key: 'p7', hours: 168, label: '7 days' },
  { key: 'p30', hours: 720, label: '30 days' },
] as const;

const utcDay = (t: number) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/**
 * The stops of a line's strip map: now, the family's next dated rungs, and the 72-hour, 7-day and
 * 30-day reads where each is trusted and read off this same family (a read borrowed from another
 * family belongs on that family's map, not this one).
 */
export function stripStops(
  lab: Pick<LabStatus, 'odds'>,
  rungs: readonly DatedRung[],
  now: number,
): StripStop[] {
  const stops: StripStop[] = rungs
    .slice(0, STRIP_RUNGS)
    .map((r) => ({ kind: 'rung', at: Date.parse(r.deadline), day: r.day, p: r.p }));
  const odds = lab.odds;
  if (odds)
    for (const h of HORIZONS) {
      const read = odds[h.key];
      if (!read.trusted || read.family) continue;
      const at = now + h.hours * HOUR_MS;
      const day = utcDay(at);
      // A 72-hour or 30-day read within a day of a market stop, at the same printed odds, says
      // nothing that stop does not: the stop carries the horizon's name instead of a twin beside it.
      const near =
        h.key === 'p7'
          ? undefined
          : stops.find(
              (s) => s.kind === 'rung' && Math.abs(s.day - day) <= DAY_MS && pct(s.p) === pct(read.p),
            );
      if (near) near.horizon ??= h.label;
      else stops.push({ kind: 'tick', at, day, horizon: h.label, ...(h.key === 'p7' ? {} : { p: read.p }) });
    }
  stops.sort((a, b) => a.at - b.at);
  return [{ kind: 'now', at: now, day: utcDay(now) }, ...stops];
}

/** Another family a line runs: its name, busiest market and the stop the board quotes. */
export interface OtherService {
  family: string;
  url: string;
  /** The first stop at even odds or better, else the furthest stop; absent with no dated rung. */
  stop?: DatedRung;
}

/**
 * A line's other services: every release family of the lab but its headline one, in the dashboard's
 * (busiest-first) order, each quoted at the stop that answers "by when?": the first at 50% or more,
 * else the furthest it has.
 */
export function otherServices(
  d: Partial<Pick<Dashboard, 'markets' | 'generatedAt'>>,
  lab: Pick<LabStatus, 'id' | 'odds'>,
): OtherService[] {
  const headline = new Set(familyMarkets(d, lab));
  const groups = new Map<string, { family: string; markets: Market[] }>();
  for (const m of d.markets ?? []) {
    if (m.kind !== 'release' || m.labId !== lab.id || headline.has(m)) continue;
    const f = modelFamily(m.title);
    if (!f) continue;
    const g = groups.get(f.key);
    if (g) g.markets.push(m);
    else groups.set(f.key, { family: f.name, markets: [m] });
  }
  const asOf = asOfMs(d);
  return [...groups.values()].map(({ family, markets }) => {
    const w = boardingWindow(datedRungs(markets, asOf));
    const stop = w.kind === 'none' ? w.last : w.to;
    return { family, url: markets[0].url, ...(stop ? { stop } : {}) };
  });
}
