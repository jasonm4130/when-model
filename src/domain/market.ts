import type { LabId } from './lab';

/**
 * What an outcome's deadline means for "when does it ship?":
 * - `by`: cumulative, released on or before the deadline;
 * - `no-release`: the complement of `by`, so P(released by deadline) = 1 − price;
 * - `day` / `window`: one of a set of mutually exclusive day or multi-day buckets.
 */
export type DeadlineKind = 'by' | 'no-release' | 'day' | 'window';

/** One tradeable outcome of a Polymarket event, e.g. "released by September 30". */
export interface Outcome {
  label: string;
  /** Price of the Yes share, 0..1: the crowd's probability. */
  yes: number;
  /** When this outcome resolves, as Gamma reports it. Some ladders set it weeks late; curves read `deadline`. */
  endDate?: string;
  closed: boolean;
  vol24: number;
  /** Best bid for Yes, 0..1. Absent when nobody is bidding. */
  bestBid?: number;
  /** Best ask for Yes, 0..1. */
  bestAsk?: number;
  spread?: number;
  lastTradePrice?: number;
  /** 24h price move. A display hint only: one thin trade can drive it. */
  oneDayPriceChange?: number;
  /** USD resting on the book; weights the release curve. */
  liquidity?: number;
  /** CLOB token id of the Yes share, for price history. */
  clobTokenId?: string;
  /** Spread over 10¢ or a one-sided book: show it as a range, never count it as odds. */
  thin?: boolean;
  /** Release deadline read from the question or label: 23:59:59 New York time on the named day. */
  deadline?: string;
  deadlineKind?: DeadlineKind;
  /** First instant of a day or week bucket; absent for open-ended "prior to" buckets. */
  windowStart?: string;
}

export type MarketKind = 'release' | 'leaderboard' | 'other';

/** A Polymarket event, reduced to what the dashboard needs. */
export interface Market {
  slug: string;
  title: string;
  url: string;
  vol24: number;
  volume: number;
  kind: MarketKind;
  labId?: LabId;
  outcomes: Outcome[];
}

/** Best odds that a lab ships within a horizon, and which market said so. */
export interface ReleaseOdds {
  p: number;
  label: string;
  title: string;
  url: string;
  endDate: string;
}

const RELEASE_TITLE = /released (by|on)|release date|when will .* be released/i;
const LEADERBOARD_TITLE = /best .*model|#1 ai model|arena|livebench|humanity|leaderboard|score/i;
const MODEL_TITLE = /\b(model|agi|gpt|claude|gemini|grok|deepseek|llama|qwen|arena|open.?source)\b/i;
/** Service uptime books name a model but say nothing about releases. */
const OUTAGE_TITLE = /\b(outages?|uptime|downtime|go(?:es)? down)\b/i;
/** Polymarket pads multi-outcome events with unnamed "Company A" and "Placeholder 1" slots; they are never real odds. */
const UNNAMED_SLOT = /^(?:Company [A-Z]|Placeholder \d+)$/;
/** Events whose outcomes are mutually exclusive date buckets rather than a cumulative ladder. */
const BUCKET_TITLE = /released on\b|when will .* be released|release date/i;

export function classifyMarket(title: string): MarketKind {
  if (RELEASE_TITLE.test(title)) return 'release';
  if (LEADERBOARD_TITLE.test(title)) return 'leaderboard';
  return 'other';
}

/** True for "released on…?" and "When will…?" events, whose outcomes are date buckets. */
export function isBucketTitle(title: string): boolean {
  return BUCKET_TITLE.test(title);
}

/** Markets of kind "other" only earn a slot if they name a model or lab; outage books never do. */
export function isModelRelevant(market: Pick<Market, 'kind' | 'title'>): boolean {
  if (OUTAGE_TITLE.test(market.title)) return false;
  return market.kind !== 'other' || MODEL_TITLE.test(market.title);
}

export function isUnnamedSlot(label: string): boolean {
  return UNNAMED_SLOT.test(label);
}

/** "Other" and untouched 50/50 slots carry no information worth a row. */
export function isPlaceholderOutcome(outcome: Outcome): boolean {
  return outcome.label === 'Other' || (outcome.yes === 0.5 && outcome.vol24 === 0);
}

/**
 * Open outcomes worth showing: releases in deadline order, everything else by probability. Given
 * `asOf` (the build time), a release rung whose parsed deadline is already behind it is left out:
 * Polymarket can take hours to close it, and until then it sits at the head of the ladder as "0¢".
 */
export function displayOutcomes(market: Market, limit: number, asOf?: number): Outcome[] {
  const live = market.outcomes.filter((o) => !o.closed && !isPlaceholderOutcome(o));
  if (market.kind === 'release') {
    const due = (o: Outcome) => Date.parse(o.deadline ?? o.endDate ?? '');
    const past = (o: Outcome) =>
      asOf !== undefined && o.deadline !== undefined && Date.parse(o.deadline) < asOf;
    return live
      .filter((o) => (o.deadline ?? o.endDate) && !past(o))
      .sort((a, b) => due(a) - due(b))
      .slice(0, limit);
  }
  return live.sort((a, b) => b.yes - a.yes).slice(0, limit);
}

/** Probability that a lab ships within `horizonDays`, read from its release markets. */
export function releaseOddsForLab(
  markets: readonly Market[],
  labId: LabId,
  horizonDays: number,
  now: number,
): ReleaseOdds | undefined {
  const horizon = now + horizonDays * 86_400_000;
  let best: ReleaseOdds | undefined;
  for (const market of markets) {
    // Date buckets and negative outcomes are not cumulative release-by probabilities.
    if (market.labId !== labId || market.kind !== 'release' || !/released by\b/i.test(market.title)) continue;
    for (const outcome of market.outcomes) {
      if (
        outcome.closed ||
        !outcome.endDate ||
        isPlaceholderOutcome(outcome) ||
        /\b(no release|not released|after|never)\b/i.test(outcome.label)
      )
        continue;
      if (!Number.isFinite(outcome.yes) || outcome.yes < 0 || outcome.yes > 1) continue;
      const end = Date.parse(outcome.endDate);
      if (Number.isNaN(end) || end < now || end > horizon) continue;
      if (!best || outcome.yes > best.p) {
        best = {
          p: outcome.yes,
          label: outcome.label,
          title: market.title,
          url: market.url,
          endDate: outcome.endDate,
        };
      }
    }
  }
  return best;
}

const BEST_MODEL_TITLE = /which company has the best ai model/i;
const BENCHMARK_SPECIFIC = /arena|livebench|code|math/i;

/** The headline "which company has the best AI model" market: highest 24h volume wins. */
export function pickBestModelMarket(markets: readonly Market[]): Market | undefined {
  const boards = markets.filter((m) => m.kind === 'leaderboard');
  const byVolume = (a: Market, b: Market) => b.vol24 - a.vol24;
  return (
    boards.filter((m) => BEST_MODEL_TITLE.test(m.title)).sort(byVolume)[0] ??
    boards
      .filter((m) => /best ai model/i.test(m.title) && !BENCHMARK_SPECIFIC.test(m.title))
      .sort(byVolume)[0]
  );
}

// ---------------------------------------------------------------------------------------------
// Order books

/** Polymarket stops quoting the midpoint once the spread passes 10¢; so do we. */
export const THIN_SPREAD = 0.1;

/** A book is thin when it is one-sided, crossed, or wider than 10¢. */
export function isThinBook(bid: number | undefined, ask: number | undefined): boolean {
  if (bid === undefined || ask === undefined || !(bid > 0) || !(ask > 0) || ask < bid) return true;
  return Math.round((ask - bid) * 1e6) > Math.round(THIN_SPREAD * 1e6);
}

/** The [bid, ask] range to show for a thin outcome instead of one misleading number. */
export function oddsRange(outcome: Outcome): [number, number] | undefined {
  if (!outcome.thin || outcome.bestAsk === undefined) return undefined;
  return [outcome.bestBid ?? 0, outcome.bestAsk];
}

// ---------------------------------------------------------------------------------------------
// Deadlines

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function nthSunday(year: number, month: number, n: number): number {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - firstWeekday) % 7) + 7 * (n - 1);
}

/**
 * The UTC instant of a New York wall-clock time (`month` is 0-based). US rules since 2007: daylight
 * time runs from 02:00 on the second Sunday of March to 02:00 on the first Sunday of November.
 * Plain arithmetic, so it needs no time-zone database.
 */
export function newYorkTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const wall = Date.UTC(year, month, day, hour, minute, second);
  const dstStart = Date.UTC(year, 2, nthSunday(year, 2, 2), 2);
  const dstEnd = Date.UTC(year, 10, nthSunday(year, 10, 1), 2);
  return wall + (wall >= dstStart && wall < dstEnd ? 4 : 5) * HOUR_MS;
}

interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

const endOfDay = (d: CalendarDay) => newYorkTime(d.year, d.month, d.day, 23, 59, 59);
const startOfDay = (d: CalendarDay) => newYorkTime(d.year, d.month, d.day);

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const DAY = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
const YEAR = String.raw`(?:,?\s+(\d{4}))?`;
/** Three groups: month, day, optional year. */
const DATE = String.raw`\b${MONTH}\s+${DAY}${YEAR}\b`;
const rx = (source: string) => new RegExp(source, 'i');

const NO_RELEASE = rx(String.raw`\b(?:no\b.*?\breleased?|not\s+(?:be\s+)?released)\s+by\s+${DATE}`);
const BETWEEN = rx(String.raw`\bbetween\s+${DATE}\s+and\s+${DATE}`);
/** The end day must not be the hour of a clock time: "September 30, 2026 - 11:59 PM" is no range. */
const RANGE = rx(String.raw`${DATE}\s*[–—-]\s*(?:${MONTH}\s+)?${DAY}${YEAR}(?![\d:])`);
const ON_OR_BEFORE = rx(String.raw`\bon\s+or\s+(?:prior\s+to|before)\s+${DATE}`);
const BEFORE = rx(String.raw`\b(?:prior\s+to|before)\s+${DATE}`);
const ON = rx(String.raw`\bon\s+${DATE}`);
const BY = rx(String.raw`\bby\s+${DATE}`);
const BARE = rx(String.raw`^\s*${DATE}\s*\??\s*$`);
/** Open-ended tails and negatives never become a "released by" deadline. */
const OPEN_TAIL = /\b(after|never)\b/i;
const NEGATIVE = /\b(no|not)\b.*\breleas/i;

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase());
}

/** A calendar day; without a year, the one closest to `near` (the outcome's endDate). */
function calendarDay(
  monthName: string,
  dayText: string,
  year: number | undefined,
  near: number | undefined,
): CalendarDay | undefined {
  const month = monthIndex(monthName);
  const day = Number(dayText);
  const valid = (y: number): CalendarDay | undefined =>
    new Date(Date.UTC(y, month, day)).getUTCMonth() === month ? { year: y, month, day } : undefined;
  if (year !== undefined) return valid(year);
  if (near === undefined) return undefined;
  const base = new Date(near).getUTCFullYear();
  let best: CalendarDay | undefined;
  for (const y of [base - 1, base, base + 1]) {
    const candidate = valid(y);
    if (candidate && (!best || Math.abs(endOfDay(candidate) - near) < Math.abs(endOfDay(best) - near))) {
      best = candidate;
    }
  }
  return best;
}

function dateAt(match: RegExpExecArray, i: number, near: number | undefined): CalendarDay | undefined {
  return calendarDay(match[i], match[i + 1], match[i + 2] ? Number(match[i + 2]) : undefined, near);
}

/** "September 21–27, 2026": the first day borrows the last day's year, a year earlier across New Year. */
function dateRange(
  first: [string, string, string | undefined],
  last: [string, string, string | undefined],
  near: number | undefined,
): [CalendarDay, CalendarDay] | undefined {
  const end = calendarDay(last[0], last[1], last[2] ? Number(last[2]) : undefined, near);
  if (!end) return undefined;
  const year = first[2] ? Number(first[2]) : monthIndex(first[0]) > end.month ? end.year - 1 : end.year;
  const start = calendarDay(first[0], first[1], year, undefined);
  return start && [start, end];
}

export interface ParsedDeadline {
  kind: DeadlineKind;
  /** Epoch ms: the last instant that still counts. */
  deadline: number;
  /** Epoch ms: the first instant of a bucket. */
  start?: number;
}

/**
 * Read a release deadline from a Polymarket question or outcome label: "by September 30, 2026",
 * "No release by Oct 15", "released on Sep 22", "between September 21 and September 27, 2026",
 * "On or prior to October 1", "before Nov 1". A named day ends at 23:59:59 New York time.
 * `bucket` says the event is a set of date buckets, so a bare "September 25" is a day, not a ladder rung.
 * `near` (the outcome's endDate) picks the year when the text has none.
 */
export function parseDeadline(
  text: string,
  context: { bucket?: boolean; near?: number } = {},
): ParsedDeadline | undefined {
  const { bucket = false, near } = context;
  if (OPEN_TAIL.test(text)) return undefined;
  const single = (pattern: RegExp) => {
    const m = pattern.exec(text);
    return m ? { day: dateAt(m, 1, near) } : undefined;
  };

  const negative = single(NO_RELEASE);
  if (negative) return negative.day && { kind: 'no-release', deadline: endOfDay(negative.day) };

  // Both patterns put the last day in groups 4-6; "October 5–11" leaves its month (group 4) empty.
  const window = BETWEEN.exec(text) ?? RANGE.exec(text);
  if (window) {
    const span = dateRange(
      [window[1], window[2], window[3]],
      [window[4] ?? window[1], window[5], window[6]],
      near,
    );
    return span && { kind: 'window', start: startOfDay(span[0]), deadline: endOfDay(span[1]) };
  }

  // Like "before": an open-ended bucket among date buckets, a cumulative rung on a ladder. Read as a
  // bucket, a ladder's overlapping rungs would have their bids summed into the floor.
  const onOrBefore = single(ON_OR_BEFORE);
  if (onOrBefore)
    return onOrBefore.day && { kind: bucket ? 'window' : 'by', deadline: endOfDay(onOrBefore.day) };

  const before = single(BEFORE);
  if (before)
    return before.day && { kind: bucket ? 'window' : 'by', deadline: startOfDay(before.day) - 1000 };

  const on = single(ON);
  if (on) return on.day && { kind: 'day', start: startOfDay(on.day), deadline: endOfDay(on.day) };

  const by = single(BY);
  if (by) return by.day && { kind: 'by', deadline: endOfDay(by.day) };

  const bare = single(BARE);
  if (bare?.day) {
    return bucket
      ? { kind: 'day', start: startOfDay(bare.day), deadline: endOfDay(bare.day) }
      : { kind: 'by', deadline: endOfDay(bare.day) };
  }
  return undefined;
}

export type OutcomeDeadline = Required<Pick<Outcome, 'deadline' | 'deadlineKind'>> &
  Pick<Outcome, 'windowStart'>;

/**
 * An outcome's deadline from its question, then its label. `endDate` only fills in a missing year,
 * or stands in for a dateless ladder rung; it never wins over a date in the text, because some
 * ladders carry an endDate a month after the date they name.
 */
export function outcomeDeadline(
  texts: readonly (string | undefined)[],
  context: { bucket: boolean; endDate?: string },
): OutcomeDeadline | undefined {
  const end = context.endDate ? Date.parse(context.endDate) : Number.NaN;
  const near = Number.isFinite(end) ? end : undefined;
  for (const text of texts) {
    const parsed = text ? parseDeadline(text, { bucket: context.bucket, near }) : undefined;
    if (!parsed) continue;
    const deadline: OutcomeDeadline = {
      deadline: new Date(parsed.deadline).toISOString(),
      deadlineKind: parsed.kind,
    };
    if (parsed.start !== undefined) deadline.windowStart = new Date(parsed.start).toISOString();
    return deadline;
  }
  const dateless = texts.every((t) => !t || (!NEGATIVE.test(t) && !OPEN_TAIL.test(t)));
  if (context.bucket || near === undefined || !dateless) return undefined;
  return { deadline: new Date(near).toISOString(), deadlineKind: 'by' };
}

// ---------------------------------------------------------------------------------------------
// Model families

/** A named model line whose markets share one release curve, e.g. "Next Claude Sonnet" or "Grok 5". */
export interface ModelFamily {
  /** Grouping key: lower case, without "next", "model" or the lab's brand. */
  key: string;
  /** Display name taken from the event title. */
  name: string;
}

const RELEASE_SUFFIX = /\s+(?:(?:be\s+)?released\s+(?:by|on)|release\s+date)\b.*$/i;
const WHEN_RELEASED = /^when will (?:the )?(.+?) be released\b/i;
const FAMILY_NOISE = /\b(?:next|new|the|model|google|alibaba|openai|anthropic|meta|xai|z\.ai)\b/g;

/** The model family a release event is about, or undefined when the title is not release-shaped. */
export function modelFamily(title: string): ModelFamily | undefined {
  const trimmed = title.trim();
  const when = WHEN_RELEASED.exec(trimmed);
  const base = when ? when[1] : trimmed.replace(RELEASE_SUFFIX, '');
  if (base === trimmed) return undefined;
  const name = base
    .replace(/\s+model\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const key = name
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[“”"‘’()]/g, ' ')
    .replace(FAMILY_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return key ? { key, name: name.charAt(0).toUpperCase() + name.slice(1) } : undefined;
}

// ---------------------------------------------------------------------------------------------
// Release curves

/** A cumulative point on a family's curve. */
export interface CurvePoint {
  /** ISO deadline. */
  deadline: string;
  /** P(released by deadline) after the monotone fit. */
  p: number;
  /**
   * The heaviest quote at this deadline, as its own market shows it: the mid, or 1 − mid for
   * "No release by". `label` and `url` are that market's; the headline cites this number.
   */
  quoted: number;
  /** Every quote at this deadline, weighted by liquidity: the fit's input. */
  pooled: number;
  label: string;
  url: string;
  /** Widest spread among the quotes pooled into this point. */
  spread: number;
}

/** One bucket event's running sum of best bids: a floor under P(released by deadline). */
export interface BucketFloor {
  url: string;
  steps: { deadline: string; p: number }[];
}

/** One open date bucket's span and best ask, for the no-arbitrage ceiling. */
export interface BucketAsk {
  /** First instant of the bucket; absent for an open-ended "on or prior to" bucket. */
  start?: string;
  /** Last instant of the bucket. */
  deadline: string;
  /** Absent when nobody is offering Yes, which leaves every horizon from here on uncapped. */
  ask?: number;
}

/** One bucket event's open buckets in start order: their asks cap P(released by deadline). */
export interface BucketCeiling {
  url: string;
  buckets: BucketAsk[];
}

export interface FamilyCurve {
  labId: LabId;
  /** Display name, e.g. "Next Claude Sonnet". */
  family: string;
  key: string;
  /** Monotone cumulative points after now, in deadline order. */
  points: CurvePoint[];
  floors: BucketFloor[];
  ceilings: BucketCeiling[];
  /** Open cumulative outcomes left out because their book was thin. */
  thinExcluded: number;
  /** Widest spread among the quotes on the curve. */
  maxSpread?: number;
  /** The family's busiest market. */
  marketUrl: string;
}

/** Which points surround a read, and how much to trust it. */
export interface CurveBracket {
  /** The curve point at or before the read; absent before the first deadline, where the curve starts from now. */
  from?: CurvePoint;
  /** The curve point at or after the read; absent past the last deadline. */
  to?: CurvePoint;
  /** Read between quoted deadlines (or between now and the first one) rather than at one. */
  interpolated: boolean;
  /** A floor, not an estimate: past the last deadline, or set by day-bucket best bids. */
  lowerBound: boolean;
  /**
   * A ceiling, not an estimate: the curve read more than the day buckets' asks allow, so it was
   * cut to their sum (`bucketCeiling`).
   */
  upperBound: boolean;
  source: 'curve' | 'buckets';
  /** The market the number came from. */
  url: string;
}

export interface CurveRead extends CurveBracket {
  p: number;
}

/** A lab's family curves read at now+72h, now+7d and now+30d. */
export interface ReleaseCurve {
  labId: LabId;
  /** The headline family: the best trusted 7-day read (then the highest 7-day, then 30-day read). */
  family: string;
  /**
   * The family the 72-hour and 30-day reads came from. Each horizon takes the lab's best trusted
   * read across its families, as P7 does, and as the replay read labs: Google's 30 days were once
   * Flash-Lite's 8% while its trusted Gemini 4.0 read was 70%. With no trusted read at a horizon,
   * the headline family's read stands.
   */
  family72: string;
  family30: string;
  /** P(released within 72 hours): the horizon the release forecast was calibrated on. */
  p72: number;
  p7: number;
  p30: number;
  bracket72: CurveBracket;
  bracket7: CurveBracket;
  bracket30: CurveBracket;
  /** `isTrustedRead` for each horizon. An untrusted read is shown as extrapolated and never scored. */
  trusted72: boolean;
  trusted7: boolean;
  trusted30: boolean;
  interpolated: boolean;
  thinExcluded: number;
  maxSpread?: number;
  marketUrl: string;
}

/**
 * How far past a read the rung it runs towards may lie. A constant-hazard stretch to a rung
 * further out is never used: between rungs the read holds the rung before it (a floor, see
 * `readPoints`), and from now to a far first rung it is shown but not trusted.
 */
export const TRUSTED_BRACKET_DAYS = 14;

/**
 * A read is trusted when it sits at a quoted rung, between two rungs no more than
 * `TRUSTED_BRACKET_DAYS` past it, on a day-bucket floor (real bids) or ask ceiling, or is held at
 * a rung (a floor), or when the first rung it is extrapolated towards lies within
 * `TRUSTED_BRACKET_DAYS` of the horizon. What fails is the constant-hazard stretch from now to a
 * distant first rung: "Next Gemini Flash" read 25.7% at 7 days off a lone Nov 30 rung (WP-1).
 */
export function isTrustedRead(read: CurveBracket, at: number): boolean {
  if (read.source === 'buckets' || read.from || !read.to) return true;
  return Date.parse(read.to.deadline) - at <= TRUSTED_BRACKET_DAYS * DAY_MS;
}

interface Quote {
  t: number;
  p: number;
  weight: number;
  label: string;
  url: string;
  spread: number;
}

function outcomeSpread(o: Outcome): number {
  if (o.bestBid !== undefined && o.bestAsk !== undefined)
    return Math.round((o.bestAsk - o.bestBid) * 1e6) / 1e6;
  return o.spread ?? 0;
}

/**
 * Weighted pool-adjacent-violators: the closest non-decreasing sequence. Sorted input;
 * one entry per distinct deadline.
 */
export function poolAdjacentViolators(values: readonly number[], weights: readonly number[]): number[] {
  const blocks: { value: number; weight: number; size: number }[] = [];
  values.forEach((value, i) => {
    blocks.push({ value, weight: weights[i], size: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].value > blocks[blocks.length - 1].value) {
      const b = blocks.pop()!;
      const a = blocks.pop()!;
      const weight = a.weight + b.weight;
      blocks.push({
        value: (a.value * a.weight + b.value * b.weight) / weight,
        weight,
        size: a.size + b.size,
      });
    }
  });
  return blocks.flatMap((b) => Array<number>(b.size).fill(b.value));
}

function fitCurve(quotes: Quote[]): CurvePoint[] {
  const byTime = new Map<number, Quote[]>();
  for (const q of quotes) byTime.set(q.t, [...(byTime.get(q.t) ?? []), q]);
  const merged = [...byTime.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, group]) => {
      const weight = group.reduce((sum, q) => sum + q.weight, 0);
      const heaviest = group.reduce((a, b) => (b.weight > a.weight ? b : a));
      return {
        t,
        weight,
        pooled: group.reduce((sum, q) => sum + q.p * q.weight, 0) / weight,
        quoted: heaviest.p,
        label: heaviest.label,
        url: heaviest.url,
        spread: Math.max(...group.map((q) => q.spread)),
      };
    });
  const fitted = poolAdjacentViolators(
    merged.map((m) => m.pooled),
    merged.map((m) => m.weight),
  );
  return merged.map((m, i) => ({
    deadline: new Date(m.t).toISOString(),
    p: fitted[i],
    quoted: m.quoted,
    pooled: m.pooled,
    label: m.label,
    url: m.url,
    spread: m.spread,
  }));
}

function bucketFloor(url: string, buckets: { t: number; bid: number }[]): BucketFloor {
  let sum = 0;
  const steps: BucketFloor['steps'] = [];
  for (const b of [...buckets].sort((x, y) => x.t - y.t)) {
    sum = Math.min(1, sum + b.bid);
    const deadline = new Date(b.t).toISOString();
    if (steps.at(-1)?.deadline === deadline) steps[steps.length - 1].p = sum;
    else steps.push({ deadline, p: sum });
  }
  return { url, steps };
}

const startOf = (b: BucketAsk) => (b.start ? Date.parse(b.start) : Number.NEGATIVE_INFINITY);
const byStart = (a: BucketAsk, b: BucketAsk) =>
  startOf(a) - startOf(b) || Date.parse(a.deadline) - Date.parse(b.deadline);

/** Day buckets end at 23:59:59 and the next starts at 00:00:00: a second apart is no gap. */
const BUCKET_GAP_MS = 1000;

/**
 * The no-arbitrage ceiling one bucket event puts on P(released by `at`): buying Yes on every open
 * bucket that could hold a release by `at` costs the sum of their asks and pays 1 if it happens,
 * so no read above that sum is consistent with the book. Only defined when the open buckets cover
 * now..`at` without a gap and each of them has an ask; otherwise undefined (no cap).
 * Live 2026-09-26: Muse Spark's "on or prior to October 1" (ask 0.12) and "October 2" (0.064)
 * capped P7 at 0.184 while constant-hazard interpolation between rungs read 0.31.
 */
export function bucketCeiling(ceiling: BucketCeiling, at: number, now: number): number | undefined {
  let sum = 0;
  let reach: number | undefined;
  for (const b of ceiling.buckets) {
    const start = startOf(b);
    if (start > at) break;
    if (reach === undefined ? start > now : start > reach + BUCKET_GAP_MS) return undefined;
    if (b.ask === undefined) return undefined;
    sum += b.ask;
    reach = Math.max(reach ?? Number.NEGATIVE_INFINITY, Date.parse(b.deadline));
  }
  if (reach === undefined || reach < at) return undefined;
  return Math.min(1, Math.round(sum * 1e6) / 1e6);
}

function curveFor(labId: LabId, family: ModelFamily, markets: readonly Market[], now: number): FamilyCurve {
  const quotes: Quote[] = [];
  const floors: BucketFloor[] = [];
  const ceilings: BucketCeiling[] = [];
  let thinExcluded = 0;
  for (const market of markets) {
    const buckets: { t: number; bid: number }[] = [];
    const asks: BucketAsk[] = [];
    for (const o of market.outcomes) {
      const t = o.closed || !o.deadline || !o.deadlineKind ? Number.NaN : Date.parse(o.deadline);
      if (!Number.isFinite(t)) continue;
      if (o.deadlineKind === 'day' || o.deadlineKind === 'window') {
        // Buckets only ever add their best bid: midpoint sums ran to 1.02-2.64 on the Grok ladder.
        buckets.push({ t, bid: Math.min(1, Math.max(0, o.bestBid ?? 0)) });
        // Any ask caps the price, thin book or not: it is an offer someone will fill.
        const ask = o.bestAsk !== undefined && o.bestAsk >= 0 && o.bestAsk <= 1 ? o.bestAsk : undefined;
        asks.push({
          ...(o.windowStart ? { start: o.windowStart } : {}),
          deadline: o.deadline!,
          ...(ask !== undefined ? { ask } : {}),
        });
        continue;
      }
      if (t <= now) continue;
      if (o.thin ?? isThinBook(o.bestBid, o.bestAsk)) {
        thinExcluded++;
        continue;
      }
      const mid = o.bestBid !== undefined && o.bestAsk !== undefined ? (o.bestBid + o.bestAsk) / 2 : o.yes;
      if (!(mid >= 0 && mid <= 1)) continue;
      const negative = o.deadlineKind === 'no-release';
      quotes.push({
        t,
        p: negative ? 1 - mid : mid,
        weight: Math.max(1, o.liquidity ?? 0),
        // The point is a "released by" probability, so "No release by Oct 15" reads as "Oct 15".
        label: negative ? o.label.replace(/^no release by\s+/i, '') : o.label,
        url: market.url,
        spread: outcomeSpread(o),
      });
    }
    if (buckets.length) floors.push(bucketFloor(market.url, buckets));
    if (asks.length) ceilings.push({ url: market.url, buckets: asks.sort(byStart) });
  }
  const points = fitCurve(quotes);
  const busiest = markets.reduce((a, b) => (b.vol24 > a.vol24 ? b : a));
  return {
    labId,
    family: family.name,
    key: family.key,
    points,
    floors,
    ceilings,
    thinExcluded,
    maxSpread: points.length ? Math.max(...points.map((p) => p.spread)) : undefined,
    marketUrl: busiest.url,
  };
}

/**
 * One monotone "released by" curve per lab and model family, from every open release market.
 * Families are never pooled: Grok 5 at 4.5% would drag a "next Grok" curve down.
 */
export function familyCurves(markets: readonly Market[], now: number): FamilyCurve[] {
  const groups = new Map<string, { labId: LabId; family: ModelFamily; markets: Market[]; ladder: boolean }>();
  for (const market of markets) {
    const family = market.kind === 'release' && market.labId ? modelFamily(market.title) : undefined;
    if (!family || !market.labId) continue;
    const id = `${market.labId}:${family.key}`;
    const ladder = market.outcomes.some((o) => o.deadlineKind === 'by');
    const group = groups.get(id);
    if (!group) groups.set(id, { labId: market.labId, family, markets: [market], ladder });
    else {
      group.markets.push(market);
      // A "released by" ladder names the family more plainly than a date-bucket event.
      if (ladder && !group.ladder) Object.assign(group, { family, ladder });
    }
  }
  return [...groups.values()]
    .map((g) => curveFor(g.labId, g.family, g.markets, now))
    .filter((c) => c.points.length || c.floors.length || c.thinExcluded);
}

function readPoints(
  points: readonly CurvePoint[],
  at: number,
  now: number,
): Omit<CurveRead, 'source' | 'url' | 'upperBound'> | undefined {
  if (!points.length) return undefined;
  const times = points.map((p) => Date.parse(p.deadline));
  if (at < times[0]) {
    // Constant hazard from now (survival 1) to the first deadline.
    const exponent = Math.max(0, at - now) / (times[0] - now);
    return { p: 1 - (1 - points[0].p) ** exponent, to: points[0], interpolated: true, lowerBound: false };
  }
  for (let i = 0; i < points.length; i++) {
    if (at === times[i])
      return { p: points[i].p, from: points[i], to: points[i], interpolated: false, lowerBound: false };
    if (i + 1 < points.length && at < times[i + 1]) {
      // The next rung is too far past the read to interpolate towards: hold the rung before it, a
      // floor the market quoted (a monotone curve never falls). Flash-Lite read 15.6% at 7 days
      // across a 61-day gap from 7.5% (Sep 30) to 94.5% (Nov 30).
      if (times[i + 1] - at > TRUSTED_BRACKET_DAYS * DAY_MS)
        return { p: points[i].p, from: points[i], to: points[i + 1], interpolated: false, lowerBound: true };
      // Constant hazard between the two deadlines: S(t) = S1 · (S2/S1)^((t − d1)/(d2 − d1)).
      const s1 = 1 - points[i].p;
      const s2 = 1 - points[i + 1].p;
      const s = s1 <= 0 ? 0 : s1 * (s2 / s1) ** ((at - times[i]) / (times[i + 1] - times[i]));
      return { p: 1 - s, from: points[i], to: points[i + 1], interpolated: true, lowerBound: false };
    }
  }
  const last = points[points.length - 1];
  return { p: last.p, from: last, interpolated: false, lowerBound: true };
}

/**
 * P(released by `at`) on a family curve: the constant-hazard reading of the cumulative points, or
 * the best-bid floor of its date buckets, whichever is higher, then cut to the lowest ask ceiling
 * of its date buckets (`bucketCeiling`) when one covers the horizon.
 */
export function readCurve(curve: FamilyCurve, at: number, now: number): CurveRead | undefined {
  const read = readPoints(curve.points, at, now);
  let floor: { p: number; url: string } | undefined;
  for (const f of curve.floors) {
    const p = f.steps.filter((s) => Date.parse(s.deadline) <= at).at(-1)?.p ?? 0;
    if (!floor || p > floor.p) floor = { p, url: f.url };
  }
  let best: CurveRead | undefined;
  if (read && (!floor || read.p >= floor.p)) {
    best = {
      ...read,
      upperBound: false,
      source: 'curve',
      url: (read.to ?? read.from)?.url ?? curve.marketUrl,
    };
  } else if (floor) {
    best = {
      p: floor.p,
      from: read?.from,
      to: read?.to,
      interpolated: false,
      lowerBound: true,
      upperBound: false,
      source: 'buckets',
      url: floor.url,
    };
  }
  if (!best) return undefined;
  let cap: { p: number; url: string } | undefined;
  for (const c of curve.ceilings) {
    const p = bucketCeiling(c, at, now);
    if (p !== undefined && (!cap || p < cap.p)) cap = { p, url: c.url };
  }
  if (!cap || best.p <= cap.p) return best;
  return {
    ...best,
    p: cap.p,
    interpolated: false,
    lowerBound: false,
    upperBound: true,
    source: 'buckets',
    url: cap.url,
  };
}

/**
 * A lab's release odds at now+72h, now+7d and now+30d from its strongest model family: a trusted
 * 7-day read beats an extrapolated one, then the highest P7, then P30. The caller chooses which
 * markets count (DROPCON v3 passes frontier text families that have not just launched).
 */
export function releaseCurveForLab(
  markets: readonly Market[],
  labId: LabId,
  now: number,
): ReleaseCurve | undefined {
  const at = { p72: now + 3 * DAY_MS, p7: now + 7 * DAY_MS, p30: now + 30 * DAY_MS } as const;
  type Horizon = keyof typeof at;
  type FamilyRead = { family: FamilyCurve; read: CurveRead; trusted: boolean };
  const families: Record<Horizon, FamilyRead>[] = [];
  for (const family of familyCurves(
    markets.filter((m) => m.labId === labId),
    now,
  )) {
    const reads: Partial<Record<Horizon, FamilyRead>> = {};
    for (const h of ['p72', 'p7', 'p30'] as const) {
      const read = readCurve(family, at[h], now);
      if (read) reads[h] = { family, read, trusted: isTrustedRead(read, at[h]) };
    }
    if (reads.p72 && reads.p7 && reads.p30) families.push(reads as Record<Horizon, FamilyRead>);
  }
  if (!families.length) return undefined;
  const better = (a: FamilyRead, b: FamilyRead) =>
    Number(a.trusted) - Number(b.trusted) || a.read.p - b.read.p;
  // The headline family: best trusted P7, then the highest P7, then the highest P30; the first wins a tie.
  const head = families.reduce((best, f) =>
    (better(f.p7, best.p7) || f.p30.read.p - best.p30.read.p) > 0 ? f : best,
  );
  // Every other horizon: the best trusted read across families, the headline family's on a tie or when none is trusted.
  const bestAt = (h: Horizon): FamilyRead =>
    families.reduce((best, f) => (f[h].trusted && better(f[h], best) > 0 ? f[h] : best), head[h]);
  const r72 = bestAt('p72');
  const r7 = head.p7;
  const r30 = bestAt('p30');
  const { p: p72, ...bracket72 } = r72.read;
  const { p: p7, ...bracket7 } = r7.read;
  const { p: p30, ...bracket30 } = r30.read;
  return {
    labId,
    family: r7.family.family,
    family72: r72.family.family,
    family30: r30.family.family,
    p72,
    p7,
    p30,
    bracket72,
    bracket7,
    bracket30,
    trusted72: r72.trusted,
    trusted7: r7.trusted,
    trusted30: r30.trusted,
    interpolated: r7.read.interpolated || r30.read.interpolated,
    thinExcluded: r7.family.thinExcluded,
    maxSpread: r7.family.maxSpread,
    marketUrl: r7.read.url,
  };
}
