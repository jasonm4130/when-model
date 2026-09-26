/**
 * Pure Polymarket helpers for the backtest: trimming Gamma events to what the analysis reads,
 * turning rung labels into deadlines, and reading CLOB price series. No I/O, no clock.
 *
 * Times are epoch seconds throughout, because CLOB `prices-history` speaks seconds.
 */

export const HOUR = 3600;
export const DAY = 24 * HOUR;

/** A rung as stored in data/backtest/raw/gamma-events.json. */
export interface RawMarket {
  id: string;
  label: string;
  /** Gamma `endDate`; for xAI ladders it can sit a month after the label, so labels win. */
  endDate?: string;
  /** When the order book opened (`acceptingOrdersTimestamp`, else `createdAt`). */
  openedAt: string;
  /** When trading stopped and the market resolved. */
  closedTime?: string;
  closed: boolean;
  yesToken?: string;
  /** Resolution read from `outcomePrices` of a closed market. */
  resolved?: 'yes' | 'no';
}

export interface RawEvent {
  id: string;
  slug: string;
  title: string;
  createdAt: string;
  closed: boolean;
  markets: RawMarket[];
}

/** A CLOB `prices-history` pull: `points` is flat `[t0, p0, t1, p1, …]` so the committed JSON stays compact. */
export interface RawSeries {
  startTs: number;
  endTs: number;
  fidelity: number;
  points: number[];
}

export type EventKind = 'by' | 'on';

/** "…released by…?" ladders are cumulative; "…released on…?" events are one bucket per day. */
export function eventKind(title: string): EventKind | undefined {
  if (/\breleased\s+by\b/i.test(title)) return 'by';
  if (/\breleased\s+on\b/i.test(title)) return 'on';
  return undefined;
}

type GammaMarket = Record<string, unknown>;

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length ? value : undefined;
}

function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Gamma writes `closedTime` as "2026-09-17 10:45:25+00"; everything else is ISO. */
export function normaliseTime(value: unknown): string | undefined {
  const s = str(value);
  if (!s) return undefined;
  const t = Date.parse(s.replace(' ', 'T').replace(/\+00$/, 'Z'));
  return Number.isFinite(t) ? new Date(t).toISOString().replace('.000Z', 'Z') : undefined;
}

/** Keep only the fields the backtest reads. Gamma pages run to 2.5 MB; this keeps the raw pull reviewable. */
export function trimGammaEvent(event: Record<string, unknown>): RawEvent | undefined {
  const id = str(String(event.id ?? ''));
  const title = str(event.title);
  if (!id || !title) return undefined;
  const markets: RawMarket[] = [];
  for (const m of (Array.isArray(event.markets) ? event.markets : []) as GammaMarket[]) {
    const outcomes = jsonArray(m.outcomes).map((o) => String(o).toLowerCase());
    const prices = jsonArray(m.outcomePrices).map((p) => String(p));
    const tokens = jsonArray(m.clobTokenIds).map((t) => String(t));
    const yes = outcomes.indexOf('yes') >= 0 ? outcomes.indexOf('yes') : 0;
    const closed = m.closed === true;
    const openedAt = normaliseTime(m.acceptingOrdersTimestamp) ?? normaliseTime(m.createdAt);
    if (!openedAt) continue;
    const market: RawMarket = {
      id: String(m.id ?? ''),
      label: str(m.groupItemTitle) ?? str(m.question) ?? '',
      openedAt,
      closed,
    };
    const endDate = normaliseTime(m.endDate);
    if (endDate) market.endDate = endDate;
    const closedTime = normaliseTime(m.closedTime);
    if (closedTime) market.closedTime = closedTime;
    if (tokens[yes]) market.yesToken = tokens[yes];
    if (closed && prices[yes] === '1') market.resolved = 'yes';
    else if (closed && prices[yes] === '0') market.resolved = 'no';
    markets.push(market);
  }
  return {
    id,
    slug: str(event.slug) ?? id,
    title,
    createdAt: normaliseTime(event.createdAt) ?? '',
    closed: event.closed === true,
    markets,
  };
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const DATE = String.raw`(${MONTHS.join('|')})\s+(\d{1,2})(?:,\s*(\d{4}))?`;

/** Second Sunday of March and first Sunday of November, the US DST boundaries (day of month). */
function nthSunday(year: number, month: number, n: number): number {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
}

/** America/New_York UTC offset in hours at a local wall-clock time. DST switches at 02:00 local. */
export function etOffsetHours(year: number, month: number, day: number, hour: number): number {
  const start = nthSunday(year, 2, 2);
  const end = nthSunday(year, 10, 1);
  const afterStart = month > 2 || (month === 2 && (day > start || (day === start && hour >= 2)));
  const beforeEnd = month < 10 || (month === 10 && (day < end || (day === end && hour < 2)));
  return afterStart && beforeEnd ? -4 : -5;
}

/** Epoch seconds for a New York wall-clock time. */
export function etTime(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const offset = etOffsetHours(year, month, day, hour);
  return Date.UTC(year, month, day, hour, minute, second) / 1000 - offset * HOUR;
}

export type RungKind = 'by' | 'day';

export interface Rung {
  kind: RungKind;
  /** Start of the day bucket (ET midnight); for cumulative rungs, undefined. */
  from?: number;
  /** The deadline: 23:59:59 ET on the labelled date. */
  deadline: number;
  /** ISO date of the labelled day, for display. */
  date: string;
}

/**
 * Reads a rung label ("September 24", "July 31, 2026", "On or prior to September 16") into its
 * deadline. The year comes from the label, else from the market's endDate. "No release by…"
 * rungs are the complement of the ladder and are skipped.
 */
export function parseRung(label: string, kind: EventKind, endDate?: string): Rung | undefined {
  const text = label.trim().toLowerCase();
  if (/^(no release|not released)/.test(text)) return undefined;
  const cumulative =
    new RegExp(`^(?:on or prior to|prior to|before|by)\\s+${DATE}$`).exec(text) ??
    new RegExp(`^${DATE}\\s+or\\s+(?:earlier|prior|before)$`).exec(text);
  const plain = new RegExp(`^${DATE}$`).exec(text);
  const match = cumulative ?? plain;
  if (!match) return undefined;
  const month = MONTHS.indexOf(match[1]);
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : inferYear(month, day, endDate);
  if (year === undefined) return undefined;
  const deadline = etTime(year, month, day, 23, 59, 59);
  const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (cumulative || kind === 'by') return { kind: 'by', deadline, date };
  return { kind: 'day', from: etTime(year, month, day), deadline, date };
}

function inferYear(month: number, day: number, endDate?: string): number | undefined {
  const end = endDate ? Date.parse(endDate) / 1000 : Number.NaN;
  if (!Number.isFinite(end)) return undefined;
  const y = new Date(end * 1000).getUTCFullYear();
  return [y - 1, y, y + 1].reduce((best, candidate) =>
    Math.abs(etTime(candidate, month, day) - end) < Math.abs(etTime(best, month, day) - end)
      ? candidate
      : best,
  );
}

export type Point = readonly [t: number, p: number];

/**
 * Packs CLOB points flat and drops repeats: a price series is a step function, so a point that
 * repeats the previous price carries no information. The last point is always kept so the
 * series end stays visible.
 */
export function compactPoints(points: readonly Point[]): number[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const out: number[] = [];
  sorted.forEach(([t, p], i) => {
    if (i === 0 || i === sorted.length - 1 || p !== sorted[i - 1][1]) out.push(t, p);
  });
  return out;
}

/** Unpacks a flat CLOB pull into sorted points, dropping anything inside the first hour after the book opened. */
export function seriesPoints(series: RawSeries | undefined, openedAt: string): Point[] {
  if (!series) return [];
  const settle = Date.parse(openedAt) / 1000 + HOUR;
  const points: Point[] = [];
  for (let i = 0; i + 1 < series.points.length; i += 2) {
    const t = series.points[i];
    const p = series.points[i + 1];
    if (t >= settle && Number.isFinite(p)) points.push([t, p]);
  }
  return points.sort((a, b) => a[0] - b[0]);
}

/** Last traded/mid price at or before `t`, or undefined before the first point. */
export function priceAt(points: readonly Point[], t: number): number | undefined {
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 ? points[found][1] : undefined;
}

export interface Crossing {
  /** Epoch seconds of the first point at or above the threshold. */
  t: number;
  p: number;
  /**
   * True when the pull started after the book opened and the series already sat above the
   * threshold at its first point: the real crossing is at or before `t`.
   */
  censored: boolean;
}

/** First point at or above `threshold`. `leftCensored` says the pull began after the market opened. */
export function firstCrossing(
  points: readonly Point[],
  threshold: number,
  leftCensored = false,
): Crossing | undefined {
  const index = points.findIndex(([, p]) => p >= threshold);
  if (index < 0) return undefined;
  return { t: points[index][0], p: points[index][1], censored: index === 0 && leftCensored };
}

/**
 * First point at or above `threshold` that the price then held for `hold` seconds. Hourly CLOB
 * snapshots spike for a single hour on thin books (the Opus 5.5 "Sep 22" bucket touched 0.545 for
 * one hour three days early), so the waterfall plots held crossings and keeps first touches alongside.
 */
export function firstHeldCrossing(
  points: readonly Point[],
  threshold: number,
  hold = 2 * HOUR,
  leftCensored = false,
): Crossing | undefined {
  for (let i = 0; i < points.length; i++) {
    const [t, p] = points[i];
    if (p < threshold) continue;
    let held = true;
    for (let j = i + 1; j < points.length && points[j][0] <= t + hold; j++) {
      if (points[j][1] < threshold) {
        held = false;
        break;
      }
    }
    if (held) return { t, p, censored: i === 0 && leftCensored };
  }
  return undefined;
}

/** Highest price and when it happened. */
export function peak(points: readonly Point[]): { t: number; p: number } | undefined {
  let best: { t: number; p: number } | undefined;
  for (const [t, p] of points) if (!best || p > best.p) best = { t, p };
  return best;
}

export function iso(t: number): string {
  return new Date(t * 1000).toISOString().replace('.000Z', 'Z');
}

export function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
