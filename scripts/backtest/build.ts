/**
 * The whole backtest as one pure function of the raw pulls: `buildBacktest(raw)` returns every
 * data/backtest/*.json document. No clock and no network, so the committed JSON can be checked by
 * re-running this against data/backtest/raw.
 */
import { FRONTIER_LABS, labById, labForTitle, type LabId } from '../../src/domain/lab';
import {
  ARCHITECTURE,
  ARCHITECTURE_MISSES,
  BROADCAST_MISSES,
  BROADCASTS,
  HER,
  NEGATIVE_RESULTS,
  RELEASES,
  TIMESTAMP_TRAPS,
  type ArchitectureMerge,
  type Broadcast,
  type CuratedRelease,
  type TimestampTrap,
} from './curated';
import {
  availability,
  firstPartyStory,
  frontierListings,
  listedWithin,
  type HnPull,
  type OpenRouterModel,
} from './events';
import {
  DAY,
  eventKind,
  firstCrossing,
  firstHeldCrossing,
  HOUR,
  iso,
  parseRung,
  peak,
  priceAt,
  round,
  seriesPoints,
  type Point,
  type RawEvent,
  type RawMarket,
  type RawSeries,
  type Rung,
} from './markets';

export interface RawPulls {
  pulledAt: string;
  events: RawEvent[];
  series: Record<string, RawSeries>;
  hn: Record<string, HnPull>;
  openrouter: OpenRouterModel[];
}

/** Bumped when an output's shape or a metric's definition changes. */
export const BACKTEST_VERSION = 1;
export const THRESHOLDS = [0.5, 0.7, 0.9] as const;
export const HORIZONS = [24, 72] as const;
/** Scored window for the Brier comparison: after OpenRouter's 2026-03-31 xAI purge, before outcomes are unknown. */
export const SCORE_FROM = Date.parse('2026-04-01T00:00:00Z') / 1000;
/** A launch teaser is not the launch ("will launch publicly this Thursday", "launching soon"). */
export const TEASER =
  /\b(soon|coming|tomorrow|will|livestream|leak|leaked|rumou?r|spotted|appeared|testing|this (mon|tues|wednes|thurs|fri|satur|sun)day)\b/i;

/** A rung joined to its event, parsed deadline and cleaned price series. */
export interface Rung2 {
  event: RawEvent;
  market: RawMarket;
  rung: Rung;
  labId?: LabId;
  points: Point[];
  opened: number;
  closed: number;
  /**
   * When the ladder's model launched (curated announcement, else its first YES resolution).
   * Prices after it are settlement, not forecast, so forecasts stop reading the rung here.
   */
  settled: number;
  /** The pull began after the book opened, so the start of the series is censored. */
  leftCensored: boolean;
  window: [number, number];
}

/** Forecast end per Gamma event: the linked launch's announcement, capped by the first YES resolution. */
export function settleTimes(raw: RawPulls, releases: readonly ReleaseRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const event of raw.events) {
    const kind = eventKind(event.title);
    let first = Infinity;
    for (const m of event.markets) {
      const rung = kind ? parseRung(m.label, kind, m.endDate) : undefined;
      if (rung && m.resolved === 'yes' && m.closedTime)
        first = Math.min(first, Date.parse(m.closedTime) / 1000);
    }
    const linked = RELEASES.find((r) => r.markets.includes(event.id));
    const announced = releases.find((r) => r.id === linked?.id)?.announcedAt;
    const at = announced ? Date.parse(announced) / 1000 : Infinity;
    const settled = Math.min(first, at);
    if (Number.isFinite(settled)) out.set(event.id, settled);
  }
  return out;
}

/** Announcement time per Gamma event linked to a curated launch, epoch seconds. */
export function announcementsByEvent(releases: readonly ReleaseRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of RELEASES) {
    const at = releases.find((x) => x.id === r.id)?.announcedAt;
    if (at) for (const id of r.markets) out.set(id, Date.parse(at) / 1000);
  }
  return out;
}

export function joinRungs(raw: RawPulls, settle: ReadonlyMap<string, number> = new Map()): Rung2[] {
  const out: Rung2[] = [];
  for (const event of raw.events) {
    const kind = eventKind(event.title);
    if (!kind) continue;
    const labId = labForTitle(event.title)?.id;
    for (const market of event.markets) {
      const rung = parseRung(market.label, kind, market.endDate);
      if (!rung || !market.resolved || !market.yesToken) continue;
      const series = raw.series[market.yesToken];
      if (!series) continue;
      const opened = Date.parse(market.openedAt) / 1000;
      const closed = market.closedTime ? Date.parse(market.closedTime) / 1000 : rung.deadline + DAY;
      out.push({
        event,
        market,
        rung,
        labId,
        points: seriesPoints(series, market.openedAt),
        opened,
        closed,
        settled: Math.min(closed, settle.get(event.id) ?? Infinity),
        leftCensored: series.startTs > opened + 2 * HOUR,
        window: [series.startTs, series.endTs],
      });
    }
  }
  return out;
}

const hours = (seconds: number) => round(seconds / HOUR, 1);
const marketUrl = (event: RawEvent) => `https://polymarket.com/event/${event.slug}`;

// ─────────────────────────────── release events ───────────────────────────────

export interface ReleaseRow {
  id: string;
  labId: LabId;
  lab: string;
  model: string;
  announcedAt: string | null;
  announcement: { title: string; url: string; hn: string } | null;
  availableAt: string | null;
  availableId: string | null;
  /** availableAt − announcedAt, hours. Negative: OpenRouter's `created` precedes the announcement. */
  availabilityLagH: number | null;
  preAnnounced: boolean;
  precursor: CuratedRelease['precursor'];
  context: string;
  sources: CuratedRelease['sources'];
  /** Earlier first-party stories that were set aside by hand as not the launch, with the reason. */
  notLaunch: { title: string; hn: string; why: string }[];
}

export function releaseRows(raw: RawPulls, releases = RELEASES): ReleaseRow[] {
  return releases.map((r) => {
    const skip = new Map((r.notLaunch ?? []).map((n) => [n.story, n.why]));
    const hits = raw.hn[r.id]?.hits ?? [];
    const story = firstPartyStory(
      { ...raw.hn[r.id], hits: hits.filter((h) => !TEASER.test(h.title) && !skip.has(h.id)) },
      r.hosts,
      r.hn.title,
    );
    const listed = availability(raw.openrouter, r.openrouter);
    return {
      id: r.id,
      labId: r.labId,
      lab: labById(r.labId)?.name ?? r.labId,
      model: r.model,
      announcedAt: story ? iso(story.t) : null,
      announcement: story
        ? { title: story.title, url: story.url, hn: `https://news.ycombinator.com/item?id=${story.id}` }
        : null,
      availableAt: listed ? iso(listed.created) : null,
      availableId: listed?.id ?? null,
      availabilityLagH: story && listed ? hours(listed.created - story.t) : null,
      preAnnounced: r.precursor === 'announced',
      precursor: r.precursor,
      context: r.context,
      sources: r.sources,
      notLaunch: hits
        .filter((h) => skip.has(h.id))
        .map((h) => ({
          title: h.title,
          hn: `https://news.ycombinator.com/item?id=${h.id}`,
          why: skip.get(h.id)!,
        })),
    };
  });
}

// ─────────────────────────────── crossings ───────────────────────────────

export interface SeriesCrossings {
  event: string;
  label: string;
  url: string;
  /** CLOB Yes token, so any row can be re-pulled with one curl. */
  token: string;
  /** The window this series was pulled for, epoch seconds. */
  window: [number, number];
  deadline: string;
  kind: 'by' | 'day';
  /** Deadline − announcement, hours. A rung due weeks after the launch says little about its timing. */
  slackH: number | null;
  /** The rung was due within {@link DATED_SLACK_H} of the announcement, so a crossing dates the launch. */
  dated: boolean;
  /**
   * Hours before the announcement (positive = the market got there first). `held*` is the first
   * crossing the price then held for two hours; `touch*` is the first hourly snapshot at or above.
   * `atOpen` means the rung was already there at its first usable price: the lead is the rung's age.
   */
  crossings: {
    threshold: number;
    heldAt: string | null;
    heldLeadH: number | null;
    touchAt: string | null;
    touchLeadH: number | null;
    censored: boolean;
    atOpen: boolean;
  }[];
  peak: number;
}

/** A rung due more than two days after the launch is priced on "before the deadline", not on the day. */
export const DATED_SLACK_H = 48;

export interface CrossingRow {
  id: string;
  labId: LabId;
  model: string;
  precursor: CuratedRelease['precursor'];
  announcedAt: string | null;
  availabilityH: number | null;
  day: SeriesCrossings | null;
  by: SeriesCrossings | null;
  /**
   * The series the waterfall and the splits read: the day bucket when it is dated, else a dated
   * cumulative rung, else none. A day bucket dates the launch; a cumulative rung only bounds it.
   */
  primary: 'day' | 'by' | null;
}

function crossingsFor(r: Rung2, announced: number | undefined): SeriesCrossings {
  const slackH = announced === undefined ? null : hours(r.rung.deadline - announced);
  const first = r.points[0]?.[0];
  return {
    event: r.event.title,
    label: r.market.label,
    url: marketUrl(r.event),
    token: r.market.yesToken!,
    window: r.window,
    deadline: iso(r.rung.deadline),
    kind: r.rung.kind,
    slackH,
    dated: slackH !== null && slackH <= DATED_SLACK_H,
    crossings: THRESHOLDS.map((threshold) => {
      const touch = firstCrossing(r.points, threshold, r.leftCensored);
      const held = firstHeldCrossing(r.points, threshold, 2 * HOUR, r.leftCensored);
      const lead = (c: typeof touch) => (c && announced !== undefined ? hours(announced - c.t) : null);
      return {
        threshold,
        heldAt: held ? iso(held.t) : null,
        heldLeadH: lead(held),
        touchAt: touch ? iso(touch.t) : null,
        touchLeadH: lead(touch),
        censored: held?.censored ?? touch?.censored ?? false,
        atOpen: touch !== undefined && touch.t === first,
      };
    }),
    peak: round(peak(r.points)?.p ?? 0, 3),
  };
}

export function crossingRows(rungs: readonly Rung2[], releases: readonly ReleaseRow[]): CrossingRow[] {
  return RELEASES.flatMap((curated) => {
    const release = releases.find((r) => r.id === curated.id);
    if (!release || !curated.markets.length) return [];
    const announced = release.announcedAt ? Date.parse(release.announcedAt) / 1000 : undefined;
    const mine = rungs.filter((r) => curated.markets.includes(r.event.id) && r.market.resolved === 'yes');
    const earliest = (kind: 'by' | 'day') =>
      mine
        .filter((r) => r.rung.kind === kind && r.points.length)
        .sort((a, b) => a.rung.deadline - b.rung.deadline || a.event.id.localeCompare(b.event.id))[0];
    const day = earliest('day');
    const by = earliest('by');
    const dayRow = day ? crossingsFor(day, announced) : null;
    const byRow = by ? crossingsFor(by, announced) : null;
    return [
      {
        id: curated.id,
        labId: curated.labId,
        model: curated.model,
        precursor: curated.precursor,
        announcedAt: release.announcedAt,
        availabilityH: release.availabilityLagH,
        day: dayRow,
        by: byRow,
        primary: dayRow?.dated ? 'day' : byRow?.dated ? 'by' : null,
      },
    ];
  });
}

// ─────────────────────────────── false alarms ───────────────────────────────

export interface FalseAlarm {
  event: string;
  label: string;
  url: string;
  kind: 'by' | 'day';
  labId: LabId | null;
  deadline: string;
  peak: number;
  peakAt: string;
  /** Days from this deadline to the ladder's first YES deadline; null if the ladder never resolved YES. */
  slipDays: number | null;
  /**
   * The linked launch was announced inside this rung (before its deadline; on its day for a day
   * bucket), yet it resolved No under the market's own release rule, e.g. general availability.
   */
  announcedInTime: boolean;
}

export interface AlarmSummary {
  kind: 'by' | 'day';
  threshold: number;
  /** Rungs that resolved NO but traded at or above the threshold. */
  noCrossed: number;
  noTotal: number;
  noMarketDays: number;
  perMarketDay: number;
  /** Rungs that resolved YES and traded at or above the threshold before their model launched. */
  yesCrossed: number;
  yesTotal: number;
  /** Of rungs that crossed (pre-launch for YES), the share that resolved YES. */
  precision: number;
}

function frontier(r: Rung2): boolean {
  return Boolean(r.labId && FRONTIER_LABS.has(r.labId));
}

/** Points a forecast could have read: before the launch for YES rungs, everything for NO rungs. */
function forecastPoints(r: Rung2): Point[] {
  return r.market.resolved === 'yes' ? r.points.filter(([t]) => t < r.settled) : r.points;
}

/**
 * `announced` maps a Gamma event id to its linked launch's announcement (epoch seconds), so a No
 * rung the launch was announced inside can be told apart from a market that was simply early.
 */
export function falseAlarms(
  rungs: readonly Rung2[],
  announced: ReadonlyMap<string, number> = new Map(),
): { summary: AlarmSummary[]; worst: FalseAlarm[] } {
  const scored = rungs.filter((r) => frontier(r) && r.points.length);
  const summary = (['by', 'day'] as const).flatMap((kind) => {
    const mine = scored.filter((r) => r.rung.kind === kind);
    const no = mine.filter((r) => r.market.resolved === 'no');
    const yes = mine.filter((r) => r.market.resolved === 'yes');
    const days = no.reduce((sum, r) => sum + (r.points.at(-1)![0] - r.points[0][0]) / DAY, 0);
    return THRESHOLDS.map((threshold) => {
      const noCrossed = no.filter((r) => r.points.some(([, p]) => p >= threshold)).length;
      const yesCrossed = yes.filter((r) => forecastPoints(r).some(([, p]) => p >= threshold)).length;
      return {
        kind,
        threshold,
        noCrossed,
        noTotal: no.length,
        noMarketDays: round(days, 0),
        perMarketDay: round(noCrossed / Math.max(days, 1), 4),
        yesCrossed,
        yesTotal: yes.length,
        precision: round(yesCrossed / Math.max(yesCrossed + noCrossed, 1), 3),
      };
    });
  });
  const firstYes = new Map<string, number>();
  for (const r of rungs)
    if (r.market.resolved === 'yes')
      firstYes.set(r.event.id, Math.min(firstYes.get(r.event.id) ?? Infinity, r.rung.deadline));
  const worst = scored
    .filter((r) => r.market.resolved === 'no')
    .map((r) => ({ r, top: peak(r.points)! }))
    .filter(({ top }) => top.p >= THRESHOLDS[0])
    .sort((a, b) => b.top.p - a.top.p || a.r.rung.deadline - b.r.rung.deadline)
    .map(({ r, top }) => {
      const yesAt = firstYes.get(r.event.id);
      const at = announced.get(r.event.id);
      return {
        event: r.event.title,
        label: r.market.label,
        url: marketUrl(r.event),
        kind: r.rung.kind,
        labId: r.labId ?? null,
        deadline: iso(r.rung.deadline),
        peak: round(top.p, 3),
        peakAt: iso(top.t),
        slipDays: yesAt === undefined ? null : round((yesAt - r.rung.deadline) / DAY, 1),
        announcedInTime: at !== undefined && at <= r.rung.deadline && at >= (r.rung.from ?? -Infinity),
      };
    });
  return { summary, worst };
}

// ─────────────────────────────── calibration ───────────────────────────────

export interface Score {
  forecast: string;
  brier: number;
  /** 1 − brier / brier(base rate). Positive beats the base rate. */
  skill: number;
}

export interface ReliabilityBin {
  from: number;
  to: number;
  n: number;
  meanForecast: number;
  observed: number;
}

export interface HorizonScore {
  horizonH: number;
  samples: number;
  baseRate: number;
  scores: Score[];
  reliability: ReliabilityBin[];
  byLab: { labId: LabId; baseRate: number; market: Score; samples: number; hoursWithOdds: number }[];
  /**
   * Where the market forecast misses: hours with any frontier rung due inside the window, hours
   * in which a listing did land, and how many of those the market had at no price or under 10%.
   */
  coverage: { hoursWithOdds: number; listedHours: number; listedNoOdds: number; listedUnder10: number };
}

function brier(forecasts: readonly number[], outcomes: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < forecasts.length; i++) sum += (forecasts[i] - outcomes[i]) ** 2;
  return sum / Math.max(forecasts.length, 1);
}

function score(name: string, f: readonly number[], y: readonly number[], base: number): Score {
  const b = brier(f, y);
  const ref = brier(
    y.map(() => base),
    y,
  );
  return { forecast: name, brier: round(b, 4), skill: round(ref > 0 ? 1 - b / ref : 0, 3) };
}

export function reliability(f: readonly number[], y: readonly number[], bins = 10): ReliabilityBin[] {
  const out: ReliabilityBin[] = [];
  for (let i = 0; i < bins; i++) {
    const from = i / bins;
    const to = (i + 1) / bins;
    let n = 0;
    let fs = 0;
    let ys = 0;
    for (let j = 0; j < f.length; j++) {
      if (f[j] >= from && (f[j] < to || (i === bins - 1 && f[j] <= to))) {
        n++;
        fs += f[j];
        ys += y[j];
      }
    }
    if (n) out.push({ from, to, n, meanForecast: round(fs / n, 3), observed: round(ys / n, 3) });
  }
  return out;
}

/**
 * The market forecast for "a frontier lab lists a model within h" at t: the highest price among
 * frontier-lab rungs that are trading at t and whose window ends within h. It is the live
 * site's "max of outcomes ending within the window" rule read at 24h and 72h.
 */
export function marketForecast(rungs: readonly Rung2[], t: number, horizon: number, lab?: LabId): number {
  let best = 0;
  for (const r of rungs) {
    if (lab && r.labId !== lab) continue;
    if (r.rung.deadline <= t || r.rung.deadline > t + horizon) continue;
    if (t < r.opened + HOUR || t >= r.settled) continue;
    const p = priceAt(r.points, t);
    if (p !== undefined && p > best) best = p;
  }
  return best;
}

export function calibration(raw: RawPulls, rungs: readonly Rung2[]): HorizonScore[] {
  const scoredRungs = rungs.filter(frontier);
  const until = Math.floor(Date.parse(raw.pulledAt) / 1000 / HOUR) * HOUR;
  const listings = frontierListings(raw.openrouter);
  return HORIZONS.map((h) => {
    const horizon = h * HOUR;
    const grid: number[] = [];
    for (let t = SCORE_FROM; t + horizon <= until; t += HOUR) grid.push(t);
    const times = listings.map((l) => l.t);
    const y = grid.map((t) => listedWithin(times, t, horizon));
    const market = grid.map((t) => marketForecast(scoredRungs, t, horizon));
    const base = y.reduce<number>((a, b) => a + b, 0) / Math.max(y.length, 1);
    const blended = market.map((p) => Math.max(p, base));
    const byLab = [...FRONTIER_LABS].map((labId) => {
      const labTimes = frontierListings(raw.openrouter, labId).map((l) => l.t);
      const ly = grid.map((t) => listedWithin(labTimes, t, horizon));
      const lf = grid.map((t) => marketForecast(scoredRungs, t, horizon, labId));
      const lb = ly.reduce<number>((a, b) => a + b, 0) / Math.max(ly.length, 1);
      return {
        labId,
        baseRate: round(lb, 3),
        market: score('market', lf, ly, lb),
        samples: grid.length,
        hoursWithOdds: lf.filter((p) => p > 0).length,
      };
    });
    return {
      horizonH: h,
      samples: grid.length,
      baseRate: round(base, 3),
      scores: [
        score(
          'base rate',
          y.map(() => base),
          y,
          base,
        ),
        score('market max', market, y, base),
        score('max(market, base rate)', blended, y, base),
      ],
      reliability: reliability(market, y),
      byLab,
      coverage: {
        hoursWithOdds: market.filter((p) => p > 0).length,
        listedHours: y.filter((v) => v === 1).length,
        listedNoOdds: y.filter((v, i) => v === 1 && market[i] === 0).length,
        listedUnder10: y.filter((v, i) => v === 1 && market[i] < 0.1).length,
      },
    };
  });
}

/** Price `h` hours before each rung's deadline against how the rung resolved: Polymarket's own calibration. */
export function rungCalibration(rungs: readonly Rung2[]) {
  return HORIZONS.map((h) => {
    const pairs = rungs
      .filter(frontier)
      .map((r) => {
        const t = r.rung.deadline - h * HOUR;
        const p = t >= r.opened + HOUR && t < r.settled ? priceAt(r.points, t) : undefined;
        return p === undefined ? undefined : { p, y: r.market.resolved === 'yes' ? 1 : 0 };
      })
      .filter((x): x is { p: number; y: number } => Boolean(x));
    const f = pairs.map((x) => x.p);
    const y = pairs.map((x) => x.y);
    const base = y.reduce((a, b) => a + b, 0) / Math.max(y.length, 1);
    return {
      horizonH: h,
      rungs: pairs.length,
      yesRate: round(base, 3),
      market: score('market price', f, y, base),
      reliability: reliability(f, y, 5),
    };
  });
}

// ─────────────────────────────── the 11/24 claim ───────────────────────────────

/**
 * The research note said "7-day odds above 50% with at least 24h to spare resolved on time 11
 * of 24; near launch 33 of 46". Its script was not kept, so this counts the plainest readings:
 * cumulative frontier rungs that traded above 0.5 inside their last 7 days, split by whether the
 * reading had at least 24h to spare, counting only readings taken before the model launched.
 * `perRung` counts every rung; `perLadder` counts only the first rung in each ladder to fire,
 * because neighbouring rungs of one ladder move together.
 */
export function sevenDayClaim(rungs: readonly Rung2[]) {
  const byRungs = rungs
    .filter((r) => frontier(r) && r.rung.kind === 'by')
    .sort((a, b) => a.rung.deadline - b.rung.deadline || a.market.id.localeCompare(b.market.id));
  const fired = (r: Rung2, spare: 'ahead' | 'near') =>
    r.points.some(([t, p]) => {
      const left = r.rung.deadline - t;
      const inWindow = spare === 'ahead' ? left >= DAY && left <= 7 * DAY : left > 0 && left < DAY;
      return inWindow && p > 0.5 && t < r.settled;
    });
  const tally = (list: readonly Rung2[]) => {
    const yes = list.filter((r) => r.market.resolved === 'yes').length;
    return { resolvedYes: yes, fired: list.length, rate: round(yes / Math.max(list.length, 1), 3) };
  };
  const firstPerLadder = (spare: 'ahead' | 'near') => {
    const seen = new Set<string>();
    return byRungs.filter((r) => {
      if (seen.has(r.event.id) || !fired(r, spare)) return false;
      seen.add(r.event.id);
      return true;
    });
  };
  return {
    claim: { ahead: { resolvedYes: 11, fired: 24 }, near: { resolvedYes: 33, fired: 46 } },
    perRung: {
      ahead: tally(byRungs.filter((r) => fired(r, 'ahead'))),
      near: tally(byRungs.filter((r) => fired(r, 'near'))),
    },
    perLadder: { ahead: tally(firstPerLadder('ahead')), near: tally(firstPerLadder('near')) },
    rungs: byRungs.length,
    ladders: new Set(byRungs.map((r) => r.event.id)).size,
  };
}

// ─────────────────────────────── splits ───────────────────────────────

/** Hours the primary series' held crossing of `threshold` came before the announcement. */
export function primaryLead(row: CrossingRow, threshold: number): number | null {
  const series = row.primary ? row[row.primary] : null;
  return series?.crossings.find((c) => c.threshold === threshold)?.heldLeadH ?? null;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2, 1);
}

export interface Split {
  group: string;
  /** Events with a dated market series. */
  events: number;
  /** Events priced only on rungs due long after the launch. */
  undated: number;
  /** Events whose primary series held 0.5 (0.9) for 2h before the announcement. */
  ahead50: number;
  ahead90: number;
  medianLead50H: number | null;
}

/** Crossing leads split by lab and by what was public beforehand. Only events with a market count. */
export function crossingSplits(rows: readonly CrossingRow[]): { byLab: Split[]; byPrecursor: Split[] } {
  const split = (group: string, all: readonly CrossingRow[]): Split => {
    const list = all.filter((r) => r.primary);
    const lead50 = list.map((r) => primaryLead(r, 0.5)).filter((h): h is number => h !== null);
    const lead90 = list.map((r) => primaryLead(r, 0.9)).filter((h): h is number => h !== null);
    return {
      group,
      events: list.length,
      undated: all.length - list.length,
      ahead50: lead50.filter((h) => h > 0).length,
      ahead90: lead90.filter((h) => h > 0).length,
      medianLead50H: median(lead50),
    };
  };
  const priced = rows.filter((r) => r.day || r.by);
  const labs = [...new Set(priced.map((r) => r.labId))];
  return {
    byLab: labs.map((lab) =>
      split(
        labById(lab)?.name ?? lab,
        priced.filter((r) => r.labId === lab),
      ),
    ),
    byPrecursor: (['announced', 'leak', 'none'] as const).map((p) =>
      split(
        p,
        priced.filter((r) => r.precursor === p),
      ),
    ),
  };
}

// ─────────────────────────────── broadcasts ───────────────────────────────

export interface BroadcastRow extends Broadcast {
  url: string;
  captureUrl: string | null;
  leadH: number;
}

export function broadcastRows(list: readonly Broadcast[] = BROADCASTS): BroadcastRow[] {
  return list.map((b) => ({
    ...b,
    url: `https://www.youtube.com/watch?v=${b.video}`,
    captureUrl: b.capture
      ? `https://web.archive.org/web/${b.capture}/https://www.youtube.com/watch?v=${b.video}`
      : null,
    leadH: hours((Date.parse(b.startsAt) - Date.parse(b.publishedAt)) / 1000),
  }));
}

// ─────────────────────────────── architecture ───────────────────────────────

export type ArchitectureVerdict = 'leads' | 'coincident' | 'lags' | 'pending';

export interface ArchitectureRow extends ArchitectureMerge {
  prUrl: string;
  storyUrl: string | null;
  /** announcedAt − mergedAt; positive means the merge came first. */
  leadH: number | null;
  verdict: ArchitectureVerdict;
  /** Days since the merge at pull time, for unshipped modules. */
  pendingDays: number | null;
}

/** Inside ±6h the merge and the launch are the same event. */
export const COINCIDENT_H = 6;

export function architectureRows(
  pulledAt: string,
  releases: readonly ReleaseRow[],
  list: readonly ArchitectureMerge[] = ARCHITECTURE,
): ArchitectureRow[] {
  return list.map((a) => {
    const release = a.release ? releases.find((r) => r.id === a.release) : undefined;
    const announcedAt = release ? release.announcedAt : a.announcedAt;
    const hnUrl = release?.announcement?.hn;
    const story = release ? (hnUrl ? Number(new URL(hnUrl).searchParams.get('id')) : null) : a.story;
    const merged = Date.parse(a.mergedAt) / 1000;
    const leadH = announcedAt ? hours(Date.parse(announcedAt) / 1000 - merged) : null;
    const verdict: ArchitectureVerdict =
      leadH === null
        ? 'pending'
        : leadH >= COINCIDENT_H
          ? 'leads'
          : leadH <= -COINCIDENT_H
            ? 'lags'
            : 'coincident';
    return {
      ...a,
      announcedAt,
      story,
      prUrl: `https://github.com/huggingface/transformers/pull/${a.pr}`,
      storyUrl: story ? `https://news.ycombinator.com/item?id=${story}` : null,
      leadH,
      verdict,
      pendingDays: leadH === null ? round((Date.parse(pulledAt) / 1000 - merged) / DAY, 0) : null,
    };
  });
}

// ─────────────────────────────── timestamp traps ───────────────────────────────

/** Epoch seconds encoded in a tweet id (Twitter Snowflake: ms since 2010-11-04T01:42:54.657Z in the top 42 bits). */
export function snowflakeTime(id: string): number {
  return Number((BigInt(id) >> 22n) + 1288834974657n) / 1000;
}

export interface TrapRow extends TimestampTrap {
  id: string;
}

export function trapRows(
  releases: readonly ReleaseRow[],
  list: readonly TimestampTrap[] = TIMESTAMP_TRAPS,
): TrapRow[] {
  const early = releases
    .filter((r) => r.availabilityLagH !== null && r.availabilityLagH < 0)
    .sort((a, b) => a.availabilityLagH! - b.availabilityLagH!);
  const tweetAt = snowflakeTime(HER.tweet);
  const storyAt = Date.parse(HER.storyAt) / 1000;
  const after = Math.round((tweetAt - storyAt) / 60);
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  return [
    ...list.map((t) => ({ id: slug(t.trap), ...t })),
    {
      id: 'openrouter-created',
      trap: 'OpenRouter created before the announcement',
      example: `${early.length ? `Listed before the announcement: ${early.map((r) => `${r.model} ${r.availabilityLagH}h`).join(', ')}. ` : ''}OpenRouter also rewrites it: Space Bunny Alpha moved from 2026-09-22 10:58Z to 2026-09-23 14:48Z.`,
      fakeLeadH: early.length ? -early[0].availabilityLagH! : null,
      fix: 'Use it as availability, measured against the announcement, never as a lead.',
      source: { label: 'OpenRouter models API', url: 'https://openrouter.ai/api/v1/models' },
    },
    {
      id: 'her',
      trap: 'This site’s own "her" story',
      example: `The History timeline said Altman posted "her" the night before GPT-4o. The tweet id decodes to ${iso(Math.floor(tweetAt))}; the GPT-4o announcement hit HN at ${iso(storyAt)}, so the tweet came ${after} minutes after it.`,
      fakeLeadH: null,
      fix: 'Decode the tweet id rather than trusting a remembered order.',
      source: { label: 'sama/status/1790075827666796666', url: HER.tweetUrl },
    },
  ];
}

// ─────────────────────────────── assembly ───────────────────────────────

export function buildBacktest(raw: RawPulls) {
  const releases = releaseRows(raw);
  const rungs = joinRungs(raw, settleTimes(raw, releases));
  const crossings = crossingRows(rungs, releases);
  const alarms = falseAlarms(rungs, announcementsByEvent(releases));
  const meta = {
    version: BACKTEST_VERSION,
    pulledAt: raw.pulledAt,
    rawEvents: raw.events.length,
    rawSeries: Object.keys(raw.series).length,
    scoredRungs: rungs.filter(frontier).length,
  };
  const architecture = architectureRows(raw.pulledAt, releases);
  const count = (verdict: ArchitectureVerdict) => architecture.filter((a) => a.verdict === verdict).length;
  return {
    'release-events': {
      meta,
      summary: {
        releases: releases.length,
        announced: releases.filter((r) => r.precursor === 'announced').length,
        leaked: releases.filter((r) => r.precursor === 'leak').length,
        surprise: releases.filter((r) => r.precursor === 'none').length,
        medianAvailabilityLagH: median(
          releases.map((r) => r.availabilityLagH).filter((h): h is number => h !== null),
        ),
      },
      releases,
    },
    markets: {
      meta: {
        ...meta,
        scoreFrom: iso(SCORE_FROM),
        thresholds: THRESHOLDS,
        horizonsH: HORIZONS,
      },
      crossings,
      splits: crossingSplits(crossings),
      falseAlarms: alarms,
      calibration: calibration(raw, rungs),
      rungCalibration: rungCalibration(rungs),
      sevenDayClaim: sevenDayClaim(rungs),
    },
    broadcasts: { meta, broadcasts: broadcastRows(), misses: BROADCAST_MISSES },
    architecture: {
      meta,
      summary: {
        leads: count('leads'),
        coincident: count('coincident'),
        lags: count('lags'),
        pending: count('pending'),
        coincidentWithinH: COINCIDENT_H,
      },
      architecture,
      misses: ARCHITECTURE_MISSES,
    },
    'negative-results': {
      meta,
      provenance:
        'Findings from the 2026-09-26 research pass. pnpm backtest carries them with their sources; it does not recompute them.',
      results: NEGATIVE_RESULTS,
    },
    'timestamp-traps': { meta, traps: trapRows(releases) },
  };
}

/** Every data/backtest/*.json document, keyed by file name. The page reads these types. */
export type Backtest = ReturnType<typeof buildBacktest>;
