/**
 * `pnpm backtest:replay`: the DROPCON v3 calibration study. Replays hourly, as-of market reads
 * from the committed raw pulls (data/backtest/raw) through the Worker's own curve code
 * (`familyCurves` / `readCurve`), scores candidate formulas for
 *
 *   E(t, h) = some frontier lab has a text-output release event (OpenRouter, grouped and
 *             deduplicated by `releaseEvents`) whose first listing falls in (t, t + h]
 *
 * out of sample, and writes data/backtest/v3-replay.json. Everything above `main()` is pure and
 * deterministic for a given raw set; the output is formatted with oxfmt so `pnpm lint` stays clean.
 *
 * Leak control. The CLOB pull kept only the last 15 days of each rung (clobWindow in fetch.ts), so a
 * rung far from its deadline has prices only when it resolved YES early. A rung is therefore read at
 * t only when its deadline is within ADMIT_DAYS of t (the pull covers every rung there, whatever it
 * resolved) and on or before the pull (later rungs are in the raw set only if they already resolved
 * YES). A rung stops being read when its model launched (build.ts `settleTimes`).
 */
// @ts-ignore This app deliberately does not ship Node type declarations; this script runs in Node.
import { execFileSync } from 'node:child_process';
// @ts-ignore This app deliberately does not ship Node type declarations; this script runs in Node.
import { writeFile } from 'node:fs/promises';
import { toDrop } from '../../src/adapters/openrouter';
import { releaseEvents, type Drop } from '../../src/domain/drop';
import {
  anyReleaseProbability,
  isTextReleaseFamily,
  levelFromProbability,
  type ForecastConstants,
  type HorizonConstants,
  type ProbabilityLevel,
} from '../../src/domain/forecast';
import { FRONTIER_LABS, labForTitle, type LabId } from '../../src/domain/lab';
import {
  classifyMarket,
  familyCurves,
  isBucketTitle,
  outcomeDeadline,
  readCurve,
  type Market,
  type Outcome,
} from '../../src/domain/market';
import {
  announcementsByEvent,
  releaseRows,
  reliability,
  SCORE_FROM,
  settleTimes,
  type RawPulls,
  type ReliabilityBin,
} from './build';
import type { OpenRouterModel } from './events';
import { OUT_DIR, readRaw } from './io';
import { DAY, eventKind, HOUR, iso, parseRung, priceAt, round, seriesPoints, type Point } from './markets';

/** Bumped when the output shape or a metric's definition changes. */
export const REPLAY_VERSION = 1;
export const HORIZONS_H = [24, 72, 168] as const;
export type HorizonH = (typeof HORIZONS_H)[number];
/** The DROPCON v3 headline horizon. */
export const HEADLINE_H: HorizonH = 72;
/** The horizon of the lead score's main input, P7. */
export const LEAD_H: HorizonH = 168;
/** Train on the first 60% of hours, test on the rest (purged: train outcomes end before the test starts). */
export const TRAIN_FRACTION = 0.6;
/** Rolling-origin check: expanding train window, each fold tested up to the next origin. */
export const ROLLING_ORIGINS = [0.4, 0.55, 0.7, 0.85] as const;
/** The CLOB pull covers every rung for the 14 days before its deadline (15-day window ending a day after). */
export const ADMIT_DAYS = 14;
/** The v3 "trusted read" rule: the bracketing rung is within this many days of the horizon. */
export const TRUSTED_BRACKET_DAYS = 14;
export const SERIES_STEP_H = 3;
/** Circular block bootstrap over test hours: one-week blocks keep most of the autocorrelation inside a block. */
export const BOOTSTRAP = { resamples: 2000, blockH: 168, seed: 20_260_926 } as const;
/** Pre-registered reliability sanity check for the decision rule. */
export const SANITY = { maxMeanGap: 0.05, minBinHours: 100, maxBinGap: 0.2 } as const;
/** Pre-registered decision threshold: out-of-sample Brier skill at 72h vs the train base rate. */
export const DECISION_MIN_SKILL = 0.02;
/** Level bands sit at these train-period quantiles of the 72h headline, rounded to 0.05. */
export const LEVEL_QUANTILES = [0.3, 0.6, 0.85, 0.95] as const;

/**
 * OpenRouter ids of frontier-lab models whose output is not text only. The raw pull has no
 * modalities, so these were read from the live /api/v1/models `architecture.output_modalities`
 * on 2026-09-26; every other frontier id in the pull reported exactly ['text'] (the one id missing
 * from the live list, anthropic/claude-3-haiku, is a text model delisted after the pull).
 */
export const NON_TEXT_OUTPUT: Readonly<Record<string, readonly string[]>> = {
  'google/gemini-2.5-flash-image': ['image', 'text'],
  'openai/gpt-5-image': ['image', 'text'],
  'openai/gpt-5-image-mini': ['image', 'text'],
  'google/gemini-3-pro-image-preview': ['image', 'text'],
  'openai/gpt-audio-mini': ['text', 'audio'],
  'openai/gpt-audio': ['text', 'audio'],
  'google/gemini-3.1-flash-image-preview': ['image', 'text'],
  'google/lyria-3-clip-preview': ['text', 'audio'],
  'google/lyria-3-pro-preview': ['text', 'audio'],
  'openai/gpt-5.4-image-2': ['image', 'text'],
  'google/gemini-3-pro-image': ['image', 'text'],
  'google/gemini-3.1-flash-image': ['image', 'text'],
  'google/gemini-3.1-flash-lite-image': ['image', 'text'],
};

/**
 * Frontier-lab ids the live API scheduled for delisting (`expiration_date`) on 2026-09-26: the
 * next survivorship loss, used to count which scored release events it would erase.
 */
export const SCHEDULED_EXPIRY: Readonly<Record<string, string>> = {
  'deepseek/deepseek-v3.2': '2026-09-28',
  'deepseek/deepseek-v3.2-exp': '2026-09-28',
  'deepseek/deepseek-v3.1-terminus': '2026-09-28',
  'deepseek/deepseek-r1-distill-llama-70b': '2026-09-28',
  'qwen/qwen3.6-max-preview': '2026-10-09',
  'qwen/qwen3-max-thinking': '2026-10-09',
  'qwen/qwen3-vl-32b-instruct': '2026-10-09',
  'qwen/qwen3-vl-8b-thinking': '2026-10-09',
  'qwen/qwen3-vl-8b-instruct': '2026-10-09',
  'qwen/qwen3-vl-30b-a3b-thinking': '2026-10-09',
  'qwen/qwen3-vl-235b-a22b-thinking': '2026-10-09',
  'qwen/qwen3-max': '2026-10-09',
  'qwen/qwen3-coder-plus': '2026-10-09',
  'qwen/qwen-plus-2025-07-28': '2026-10-09',
  'qwen/qwen3-30b-a3b-thinking-2507': '2026-10-09',
  'qwen/qwen3-235b-a22b-thinking-2507': '2026-10-09',
  'qwen/qwen3-8b': '2026-10-09',
  'qwen/qwen3-235b-a22b': '2026-10-09',
  'google/gemini-2.5-flash-lite': '2026-10-20',
  'google/gemini-2.5-flash': '2026-10-20',
  'google/gemini-2.5-pro': '2026-10-20',
};

const LABS = [...FRONTIER_LABS];

// ─────────────────────────────── outcome ───────────────────────────────

/** Raw OpenRouter rows as the Worker's `toDrop` sees them, with output modalities filled in. */
export function replayDrops(models: readonly OpenRouterModel[]): Drop[] {
  return models
    .map((m) =>
      toDrop({
        id: m.id,
        name: m.name,
        created: m.created,
        canonical_slug: m.canonical || undefined,
        architecture: { output_modalities: [...(NON_TEXT_OUTPUT[m.id] ?? ['text'])] },
      }),
    )
    .filter((d): d is Drop => d !== undefined);
}

export interface ReleaseMarker {
  /** First listing, epoch seconds. */
  t: number;
  labId: LabId;
  models: string[];
}

/** Frontier text release events up to `until` (epoch seconds), oldest first. */
export function frontierReleases(models: readonly OpenRouterModel[], until: number): ReleaseMarker[] {
  return releaseEvents(replayDrops(models), until * 1000)
    .filter((e) => e.frontier && e.labId)
    .map((e) => ({
      t: Date.parse(e.firstListedAt) / 1000,
      labId: e.labId!,
      models: e.models.map((m) => m.id),
    }))
    .sort((a, b) => a.t - b.t || a.labId.localeCompare(b.labId));
}

/** 1 when some time in the sorted list lands in (t, t + horizon]. */
export function releasedWithin(times: readonly number[], t: number, horizon: number): 0 | 1 {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo < times.length && times[lo] <= t + horizon ? 1 : 0;
}

// ─────────────────────────────── market reconstruction ───────────────────────────────

/** One Polymarket rung with what an as-of read needs. Times in epoch seconds. */
export interface ReplayRung {
  eventId: string;
  title: string;
  slug: string;
  labId: LabId;
  bucket: boolean;
  label: string;
  endDate?: string;
  /** The deadline the CLOB pull was windowed on (backtest `parseRung`). */
  pullDeadline: number;
  opened: number;
  /** The rung stops being read here: its close, or the launch of its model when known. */
  until: number;
  points: Point[];
  outcome: Pick<Outcome, 'deadline' | 'deadlineKind' | 'windowStart'>;
}

export interface RungOptions {
  /** Stop reading at the launch (true, the scored replay) or only at the market's close (the live-like check). */
  settle: boolean;
}

/** Frontier text-family rungs with a usable price series and a parseable deadline. */
export function replayRungs(raw: RawPulls, options: RungOptions = { settle: true }): ReplayRung[] {
  const settle = options.settle ? settleTimes(raw, releaseRows(raw)) : new Map<string, number>();
  const out: ReplayRung[] = [];
  for (const event of raw.events) {
    const kind = eventKind(event.title);
    const labId = labForTitle(event.title)?.id;
    if (!kind || !labId || !FRONTIER_LABS.has(labId) || !isTextReleaseFamily(event.title)) continue;
    if (classifyMarket(event.title) !== 'release') continue;
    const bucket = isBucketTitle(event.title);
    for (const market of event.markets) {
      const rung = parseRung(market.label, kind, market.endDate);
      const series = market.yesToken ? raw.series[market.yesToken] : undefined;
      const outcome = outcomeDeadline([market.label], { bucket, endDate: market.endDate });
      if (!rung || !series || !outcome) continue;
      const points = seriesPoints(series, market.openedAt);
      if (!points.length) continue;
      const closed = market.closedTime ? Date.parse(market.closedTime) / 1000 : rung.deadline + DAY;
      out.push({
        eventId: event.id,
        title: event.title,
        slug: event.slug,
        labId,
        bucket,
        label: market.label,
        endDate: market.endDate,
        pullDeadline: rung.deadline,
        opened: Date.parse(market.openedAt) / 1000,
        until: Math.min(closed, settle.get(event.id) ?? Infinity),
        points,
        outcome,
      });
    }
  }
  return out;
}

/** The rung's price at t, or undefined when an as-of reader could not (or, leak-free, may not) use it. */
export function admittedPrice(rung: ReplayRung, t: number, pulledAt: number): number | undefined {
  if (t < rung.opened + HOUR || t >= rung.until) return undefined;
  if (rung.pullDeadline - ADMIT_DAYS * DAY > t || rung.pullDeadline > pulledAt) return undefined;
  return priceAt(rung.points, t);
}

/**
 * The Polymarket events as the Worker would have mapped them at t. There is no historical order
 * book, so every quote counts as a tight book (`thin: false`, the thin gate cannot run) and a date
 * bucket's best bid is stood in for by its price.
 */
export function marketsAt(rungs: readonly ReplayRung[], t: number, pulledAt: number): Market[] {
  const byEvent = new Map<string, Market>();
  for (const rung of rungs) {
    const yes = admittedPrice(rung, t, pulledAt);
    if (yes === undefined) continue;
    let market = byEvent.get(rung.eventId);
    if (!market) {
      market = {
        slug: rung.slug,
        title: rung.title,
        url: `https://polymarket.com/event/${rung.slug}`,
        vol24: 0,
        volume: 0,
        kind: 'release',
        labId: rung.labId,
        outcomes: [],
      };
      byEvent.set(rung.eventId, market);
    }
    const bucket = rung.outcome.deadlineKind === 'day' || rung.outcome.deadlineKind === 'window';
    market.outcomes.push({
      label: rung.label,
      yes,
      endDate: rung.endDate,
      closed: false,
      vol24: 0,
      thin: false,
      ...(bucket ? { bestBid: yes } : {}),
      ...rung.outcome,
    });
  }
  return [...byEvent.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/** How a lab's market read is taken. `curve` is the Worker's rule; the others are sensitivity checks. */
export type ReadVariant = 'curve' | 'no-buckets' | 'trusted';
export const READ_VARIANTS: readonly ReadVariant[] = ['curve', 'no-buckets', 'trusted'];

/** Per-lab P(release in (t, t + h]) at each horizon: the best text family's curve read, 0 without one. */
export function labReadsAt(
  rungs: readonly ReplayRung[],
  t: number,
  pulledAt: number,
  horizons: readonly number[] = HORIZONS_H,
): Record<ReadVariant, number[][]> {
  const now = t * 1000;
  const curves = familyCurves(marketsAt(rungs, t, pulledAt), now);
  const out = Object.fromEntries(
    READ_VARIANTS.map((v) => [v, horizons.map(() => LABS.map(() => 0))]),
  ) as Record<ReadVariant, number[][]>;
  horizons.forEach((h, hi) => {
    const at = now + h * HOUR * 1000;
    for (const curve of curves) {
      const li = LABS.indexOf(curve.labId);
      const read = readCurve(curve, at, now);
      const plain = readCurve({ ...curve, floors: [], ceilings: [] }, at, now);
      // Trusted: the curve's own read (no bucket floor), only when a rung at or after the horizon brackets it.
      const trusted =
        plain?.to !== undefined && Date.parse(plain.to.deadline) - at <= TRUSTED_BRACKET_DAYS * DAY * 1000;
      const reads: Record<ReadVariant, number> = {
        curve: read?.p ?? 0,
        'no-buckets': plain?.p ?? 0,
        trusted: trusted ? plain!.p : 0,
      };
      for (const v of READ_VARIANTS) out[v][hi][li] = Math.max(out[v][hi][li], reads[v]);
    }
  });
  return out;
}

// ─────────────────────────────── formulas and fitting ───────────────────────────────

export type FormulaId = 'base' | 'max' | 'max-base' | 'noisy-or' | 'noisy-or-cal';
export const FORMULAS: readonly { id: FormulaId; name: string }[] = [
  { id: 'base', name: '(a) constant base rate' },
  { id: 'max', name: '(b) max over labs' },
  { id: 'max-base', name: '(c) max(market, base)' },
  { id: 'noisy-or', name: '(d) noisy-OR with unpriced rate u' },
  { id: 'noisy-or-cal', name: '(e) (d) + logistic recalibration' },
];

export interface Fit {
  base: number;
  /** "Unpriced release" probability within the horizon. */
  unpriced: number;
  /** Logistic recalibration of (d): p = σ(a + b·logit(p_d)). */
  a: number;
  b: number;
}

const EPS = 1e-3;
const clip = (p: number, eps = EPS) => Math.min(1 - eps, Math.max(eps, p));
export const logit = (p: number): number => Math.log(clip(p) / (1 - clip(p)));
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** P(at least one) for independent events. */
export function noisyOr(ps: readonly number[]): number {
  return 1 - ps.reduce((s, p) => s * (1 - Math.min(1, Math.max(0, p))), 1);
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
}

function logLoss(f: readonly number[], y: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < f.length; i++)
    sum -= y[i] ? Math.log(clip(f[i], 1e-6)) : Math.log(1 - clip(f[i], 1e-6));
  return sum / Math.max(f.length, 1);
}

export function brier(f: readonly number[], y: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < f.length; i++) sum += (f[i] - y[i]) ** 2;
  return sum / Math.max(f.length, 1);
}

/** Maximum-likelihood u for p = 1 − (1 − u)(1 − market). The log-likelihood is concave in 1 − u. */
export function fitUnpriced(market: readonly number[], y: readonly number[]): number {
  const ll = (u: number) =>
    -logLoss(
      market.map((m) => 1 - (1 - u) * (1 - m)),
      y,
    );
  let lo = 0;
  let hi = 0.999;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 200 && hi - lo > 1e-9; i++) {
    const c = hi - g * (hi - lo);
    const d = lo + g * (hi - lo);
    if (ll(c) >= ll(d)) hi = d;
    else lo = c;
  }
  return (lo + hi) / 2;
}

/** Bernoulli log-likelihood of σ(a + b·x), computed stably. */
function logisticLikelihood(x: readonly number[], y: readonly number[], a: number, b: number): number {
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    const z = a + b * x[i];
    // log σ(z) = −log(1 + e^−z); log(1 − σ(z)) = −log(1 + e^z).
    const softplus = (v: number) => (v > 0 ? v + Math.log1p(Math.exp(-v)) : Math.log1p(Math.exp(v)));
    sum -= y[i] ? softplus(-z) : softplus(z);
  }
  return sum;
}

/**
 * Maximum-likelihood logistic regression of y on x (two parameters): Newton's method from the
 * identity (a = 0, b = 1), halving any step that does not raise the likelihood.
 */
export function fitLogistic(x: readonly number[], y: readonly number[]): { a: number; b: number } {
  let a = 0;
  let b = 1;
  let ll = logisticLikelihood(x, y, a, b);
  for (let iter = 0; iter < 100; iter++) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 1e-9;
    let h01 = 0;
    let h11 = 1e-9;
    for (let i = 0; i < x.length; i++) {
      const p = sigmoid(a + b * x[i]);
      const w = p * (1 - p);
      g0 += y[i] - p;
      g1 += (y[i] - p) * x[i];
      h00 += w;
      h01 += w * x[i];
      h11 += w * x[i] * x[i];
    }
    const det = h00 * h11 - h01 * h01;
    if (!(det > 1e-12)) break;
    const da = (h11 * g0 - h01 * g1) / det;
    const db = (h00 * g1 - h01 * g0) / det;
    let step = 1;
    let next = logisticLikelihood(x, y, a + da, b + db);
    while (next < ll && step > 1e-6) {
      step /= 2;
      next = logisticLikelihood(x, y, a + step * da, b + step * db);
    }
    if (next < ll) break;
    a += step * da;
    b += step * db;
    const gain = next - ll;
    ll = next;
    if (gain < 1e-12) break;
  }
  return { a, b };
}

/** Fitted values are rounded before use, so the scored forecast is exactly what ships. */
export function fitFormulas(labP: readonly (readonly number[])[], y: readonly number[]): Fit {
  const base = round(mean(y), 4);
  const market = labP.map(noisyOr);
  const unpriced = round(fitUnpriced(market, y), 4);
  const d = market.map((m) => 1 - (1 - unpriced) * (1 - m));
  const { a, b } = fitLogistic(d.map(logit), y);
  return { base, unpriced, a: round(a, 4), b: round(b, 4) };
}

export function forecast(id: FormulaId, labP: readonly number[], fit: Fit): number {
  const max = Math.max(0, ...labP);
  switch (id) {
    case 'base':
      return fit.base;
    case 'max':
      return max;
    case 'max-base':
      return Math.max(max, fit.base);
    case 'noisy-or':
      return 1 - (1 - fit.unpriced) * (1 - noisyOr(labP));
    case 'noisy-or-cal':
      return sigmoid(fit.a + fit.b * logit(1 - (1 - fit.unpriced) * (1 - noisyOr(labP))));
  }
}

// ─────────────────────────────── scoring ───────────────────────────────

/** Deterministic PRNG (mulberry32) for the bootstrap. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 95% circular-block-bootstrap interval for Brier skill of `f` against `ref` over the same rows. */
export function skillInterval(
  f: readonly number[],
  ref: readonly number[],
  y: readonly number[],
  options: { resamples: number; blockH: number; seed: number } = BOOTSTRAP,
): [number, number] {
  const n = y.length;
  if (!n) return [0, 0];
  const rand = mulberry32(options.seed);
  const block = Math.min(options.blockH, n);
  const skills: number[] = [];
  for (let r = 0; r < options.resamples; r++) {
    let bf = 0;
    let br = 0;
    for (let taken = 0; taken < n;) {
      const start = Math.floor(rand() * n);
      for (let k = 0; k < block && taken < n; k++, taken++) {
        const i = (start + k) % n;
        bf += (f[i] - y[i]) ** 2;
        br += (ref[i] - y[i]) ** 2;
      }
    }
    skills.push(br > 0 ? 1 - bf / br : 0);
  }
  skills.sort((a, b) => a - b);
  const at = (q: number) => round(skills[Math.round(q * (skills.length - 1))], 3);
  return [at(0.025), at(0.975)];
}

export interface Sanity {
  meanForecast: number;
  observed: number;
  /** Every bin with at least SANITY.minBinHours hours within SANITY.maxBinGap, and the mean within SANITY.maxMeanGap. */
  sane: boolean;
  worstBinGap: number;
}

export function sanity(f: readonly number[], y: readonly number[], bins: readonly ReliabilityBin[]): Sanity {
  const meanForecast = mean(f);
  const observed = mean(y);
  const gaps = bins
    .filter((b) => b.n >= SANITY.minBinHours)
    .map((b) => Math.abs(b.observed - b.meanForecast));
  const worstBinGap = gaps.length ? Math.max(...gaps) : 0;
  return {
    meanForecast: round(meanForecast, 3),
    observed: round(observed, 3),
    worstBinGap: round(worstBinGap, 3),
    sane: Math.abs(meanForecast - observed) <= SANITY.maxMeanGap && worstBinGap <= SANITY.maxBinGap,
  };
}

// ─────────────────────────────── assembly ───────────────────────────────

export interface Row {
  t: number;
  y: 0 | 1;
  labP: number[];
}

export interface Grid {
  from: number;
  until: number;
  pulledAt: number;
  split: number;
  releases: ReleaseMarker[];
  /** rows[variant][horizon] — hourly, t from `from` while t + h ≤ until. */
  rows: Record<string, Record<HorizonH, Row[]>>;
  /**
   * Headline reads for every hour to `until` (no outcome needed), with the level's main input: the
   * best 7-day read across labs (formula (b) at 7 days, the shape of DROPCON's P7).
   */
  headline: { t: number; labP: number[]; lead7: number }[];
}

const floorHour = (t: number) => Math.floor(t / HOUR) * HOUR;

export function buildGrid(raw: RawPulls): Grid {
  const pulledAt = Date.parse(raw.pulledAt) / 1000;
  const until = floorHour(pulledAt);
  const from = SCORE_FROM;
  const split = from + Math.round(((until - from) * TRAIN_FRACTION) / HOUR) * HOUR;
  const releases = frontierReleases(raw.openrouter, until);
  const times = releases.map((r) => r.t);
  const settled = replayRungs(raw, { settle: true });
  const live = replayRungs(raw, { settle: false });
  const rows: Grid['rows'] = {};
  const init = () => Object.fromEntries(HORIZONS_H.map((h) => [h, [] as Row[]])) as Record<HorizonH, Row[]>;
  for (const v of [...READ_VARIANTS, 'no-settle']) rows[v] = init();
  const headline: Grid['headline'] = [];
  for (let t = from; t <= until; t += HOUR) {
    const reads = labReadsAt(settled, t, pulledAt);
    const liveReads = labReadsAt(live, t, pulledAt).curve;
    headline.push({
      t,
      labP: reads.curve[HORIZONS_H.indexOf(HEADLINE_H)],
      lead7: Math.max(0, ...reads.curve[HORIZONS_H.indexOf(LEAD_H)]),
    });
    HORIZONS_H.forEach((h, hi) => {
      if (t + h * HOUR > until) return;
      const y = releasedWithin(times, t, h * HOUR);
      for (const v of READ_VARIANTS) rows[v][h].push({ t, y, labP: reads[v][hi] });
      rows['no-settle'][h].push({ t, y, labP: liveReads[hi] });
    });
  }
  return { from, until, pulledAt, split, releases, rows, headline };
}

export interface FormulaScore {
  id: FormulaId;
  name: string;
  brier: number;
  logLoss: number;
  /** vs (a), the constant fitted on train: the pre-registered decision reference. */
  skill: number;
  /** vs the test period's own release rate, which no forecaster could have known in advance. */
  skillVsClimatology: number;
  skillCi95: [number, number];
  sanity: Sanity;
  reliability: ReliabilityBin[];
}

interface Split {
  train: Row[];
  test: Row[];
}

/** Purged split at `origin`: train outcomes all resolve before the test starts. */
export function splitRows(rows: readonly Row[], origin: number, end: number, horizonH: number): Split {
  return {
    train: rows.filter((r) => r.t + horizonH * HOUR <= origin),
    test: rows.filter((r) => r.t >= origin && r.t < end),
  };
}

export function scoreSplit(split: Split, withIntervals = true): { fit: Fit; scores: FormulaScore[] } {
  const fit = fitFormulas(
    split.train.map((r) => r.labP),
    split.train.map((r) => r.y),
  );
  const y = split.test.map((r) => r.y);
  const baseF = split.test.map(() => fit.base);
  const climatology = mean(y);
  const refBrier = brier(baseF, y);
  const climBrier = brier(
    y.map(() => climatology),
    y,
  );
  const scores = FORMULAS.map(({ id, name }) => {
    const f = split.test.map((r) => forecast(id, r.labP, fit));
    const b = brier(f, y);
    const bins = reliability(f, y);
    return {
      id,
      name,
      brier: round(b, 4),
      logLoss: round(logLoss(f, y), 4),
      skill: round(refBrier > 0 ? 1 - b / refBrier : 0, 3),
      skillVsClimatology: round(climBrier > 0 ? 1 - b / climBrier : 0, 3),
      skillCi95: withIntervals ? skillInterval(f, baseF, y) : ([0, 0] as [number, number]),
      sanity: sanity(f, y, bins),
      reliability: bins,
    };
  });
  return { fit, scores };
}

/** Distinct release events whose first listing falls in (from, to]. */
export function eventsIn(releases: readonly ReleaseMarker[], from: number, to: number): number {
  return releases.filter((r) => r.t > from && r.t <= to).length;
}

export interface LevelRow {
  level: 1 | 2 | 3 | 4 | 5;
  hours: number;
  share: number;
  meanP: number | null;
  /** Share of those hours in which a frontier release did land within 72h. */
  observed: number | null;
  /** Distinct release events landing within 72h of any hour at this level. */
  events: number;
}

export function levelTable(
  rows: readonly Row[],
  p: readonly number[],
  releases: readonly ReleaseMarker[],
  levels: readonly ProbabilityLevel[],
): LevelRow[] {
  return ([1, 2, 3, 4, 5] as const).map((level) => {
    const idx = rows.map((_, i) => i).filter((i) => levelFromProbability(p[i], levels) === level);
    const hit = new Set<number>();
    for (const i of idx)
      for (const r of releases) if (r.t > rows[i].t && r.t <= rows[i].t + HEADLINE_H * HOUR) hit.add(r.t);
    return {
      level,
      hours: idx.length,
      share: round(idx.length / Math.max(rows.length, 1), 3),
      meanP: idx.length ? round(mean(idx.map((i) => p[i])), 3) : null,
      observed: idx.length ? round(mean(idx.map((i) => rows[i].y)), 3) : null,
      events: hit.size,
    };
  });
}

/** Highest band edge: a band that needs p ≥ 1 is not a level. */
export const MAX_BAND_EDGE = 0.95;

/**
 * Round-number band edges at the pre-registered train quantiles of the headline: each rounded to
 * 0.05, capped at MAX_BAND_EDGE, and bumped by 0.05 when it would not rise above the previous edge.
 */
export function bandEdges(trainP: readonly number[]): number[] {
  const sorted = [...trainP].sort((a, b) => a - b);
  const edges: number[] = [];
  for (const q of LEVEL_QUANTILES) {
    const v = sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    let edge = Math.min(MAX_BAND_EDGE, round(Math.round(v * 20) / 20, 2));
    if (edges.length && edge <= edges[edges.length - 1]) edge = round(edges[edges.length - 1] + 0.05, 2);
    edges.push(edge);
  }
  return edges;
}

/** Ascending edges [e4→5, e3→4, e2→3, e1→2] as the level table, level 1 first. */
export function bandLevels(edges: readonly number[]): ProbabilityLevel[] {
  const n = (v: number) => Math.round(v * 100);
  const [e5, e4, e3, e2] = edges;
  return [
    { level: 1, min: e2, label: `≥${n(e2)}%` },
    { level: 2, min: e3, label: `${n(e3)}–${n(e2)}%` },
    { level: 3, min: e4, label: `${n(e4)}–${n(e3)}%` },
    { level: 4, min: e5, label: `${n(e5)}–${n(e4)}%` },
    { level: 5, min: 0, label: `<${n(e5)}%` },
  ];
}

/** Release events per 30 days for each frontier lab, before the scored window and inside it. */
export function labEventRates(
  releases: readonly ReleaseMarker[],
  before: [number, number],
  window: [number, number],
) {
  const per30 = (labId: LabId, [a, b]: [number, number]) =>
    round((releases.filter((r) => r.labId === labId && r.t > a && r.t <= b).length / (b - a)) * 30 * DAY, 2);
  return LABS.map((labId) => ({ labId, before: per30(labId, before), window: per30(labId, window) }));
}

/** Monthly count of frontier text release events: where delistings thin the record out. */
export function monthlyReleases(releases: readonly ReleaseMarker[]): { month: string; events: number }[] {
  const counts = new Map<string, number>();
  for (const r of releases) {
    const month = iso(r.t).slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, events]) => ({ month, events }));
}

function scoreMap(scores: readonly FormulaScore[]) {
  return Object.fromEntries(
    scores.map((s) => [s.id, { skill: s.skill, skillCi95: s.skillCi95, sane: s.sanity.sane }]),
  ) as Record<FormulaId, { skill: number; skillCi95: [number, number]; sane: boolean }>;
}

/** The formula the API ships: the better of (d) and (e) at the headline horizon (the API is noisy-OR shaped). */
export type ShippedFormula = Extract<FormulaId, 'noisy-or' | 'noisy-or-cal'>;

function horizonConstants(
  fit: Fit,
  h: HorizonH,
  formula: ShippedFormula,
  test: HorizonConstants['test'],
): HorizonConstants {
  return {
    horizonHours: h,
    unpriced: fit.unpriced,
    calibration: formula === 'noisy-or-cal' ? { a: fit.a, b: fit.b } : { a: 0, b: 1 },
    baseRate: fit.base,
    test,
  };
}

/** A launch counts as priced when its own lab's 72h read reached this in the 72 hours before it listed. */
export const PRICED_MIN = 0.5;
/** The per-lab table counts an hour as having a read when the lab's 72h read is above this. */
export const READ_MIN = 0.05;

/** Per test event: the highest 72h read its own lab had in the 72 hours before it listed. */
export function pricedEvents(
  releases: readonly ReleaseMarker[],
  headline: readonly { t: number; labP: readonly number[] }[],
  from: number,
  to: number,
) {
  return releases
    .filter((r) => r.t > from && r.t <= to)
    .map((r) => {
      const li = LABS.indexOf(r.labId);
      let max = 0;
      for (const row of headline)
        if (row.t < r.t && row.t >= r.t - HEADLINE_H * HOUR) max = Math.max(max, row.labP[li]);
      return {
        at: iso(r.t),
        labId: r.labId,
        models: r.models.slice(0, 3),
        maxLabP72: round(max, 3),
        priced: max >= PRICED_MIN,
      };
    });
}

/** Per-lab 72h reads against that lab's own releases, on the test window, vs the lab's train rate. */
export function labTable(
  rows: readonly Row[],
  releases: readonly ReleaseMarker[],
  split: number,
  until: number,
) {
  return LABS.map((labId, li) => {
    const times = releases.filter((r) => r.labId === labId).map((r) => r.t);
    const { train, test } = splitRows(rows, split, until, HEADLINE_H);
    const ty = train.map((r) => releasedWithin(times, r.t, HEADLINE_H * HOUR));
    const y = test.map((r) => releasedWithin(times, r.t, HEADLINE_H * HOUR));
    const base = mean(ty);
    const f = test.map((r) => r.labP[li]);
    const ref = brier(
      y.map(() => base),
      y,
    );
    return {
      labId,
      trainRate: round(base, 3),
      testRate: round(mean(y), 3),
      testEvents: eventsIn(
        releases.filter((r) => r.labId === labId),
        split,
        until,
      ),
      hoursWithRead: f.filter((p) => p > READ_MIN).length,
      brier: round(brier(f, y), 4),
      skill: round(ref > 0 ? 1 - brier(f, y) / ref : 0, 3),
    };
  });
}

/**
 * Hours from a launch's announcement to the first YES rung of its market closing: how long a live
 * reader without a launch guard would keep reading the launched family near 1.
 */
export function settlementLags(raw: RawPulls): { events: number; medianH: number; maxH: number } {
  const announced = announcementsByEvent(releaseRows(raw));
  const lags: number[] = [];
  for (const event of raw.events) {
    const at = announced.get(event.id);
    const closes = event.markets
      .filter((m) => m.resolved === 'yes' && m.closedTime)
      .map((m) => Date.parse(m.closedTime!) / 1000);
    if (at !== undefined && closes.length) lags.push((Math.min(...closes) - at) / HOUR);
  }
  lags.sort((a, b) => a - b);
  const mid = lags.length >> 1;
  const median = lags.length % 2 ? lags[mid] : (lags[mid - 1] + lags[mid]) / 2;
  return {
    events: lags.length,
    medianH: lags.length ? round(median, 1) : 0,
    maxH: lags.length ? round(lags[lags.length - 1], 1) : 0,
  };
}

export function buildReplay(raw: RawPulls) {
  const grid = buildGrid(raw);
  const { from, until, split, releases } = grid;
  const primary = grid.rows.curve;
  const origin = (q: number) => from + Math.round(((until - from) * q) / HOUR) * HOUR;

  const horizons = HORIZONS_H.map((h) => {
    const rows = primary[h];
    const main = splitRows(rows, split, until, h);
    const { fit, scores } = scoreSplit(main);
    const rolling = ROLLING_ORIGINS.map((q, k) => {
      const start = origin(q);
      const next = k + 1 < ROLLING_ORIGINS.length ? origin(ROLLING_ORIGINS[k + 1]) : until;
      const fold = splitRows(rows, start, next, h);
      const scored = scoreSplit(fold, false);
      return {
        origin: iso(start),
        testTo: iso(next),
        trainHours: fold.train.length,
        testHours: fold.test.length,
        testEvents: eventsIn(releases, start, Math.min(until, next - HOUR + h * HOUR)),
        testRate: round(mean(fold.test.map((r) => r.y)), 3),
        fit: scored.fit,
        skill: Object.fromEntries(scored.scores.map((s) => [s.id, s.skill])) as Record<FormulaId, number>,
      };
    });
    const variants = ['no-buckets', 'trusted', 'no-settle', 'uncensored'] as const;
    const sensitivity = variants.map((variant) => {
      const vrows = variant === 'uncensored' ? rows : grid.rows[variant][h];
      const end = variant === 'uncensored' ? floorHour(grid.pulledAt) - ADMIT_DAYS * DAY : until;
      const vsplit = splitRows(vrows, split, end, h);
      const scored = scoreSplit(vsplit);
      return { variant, testHours: vsplit.test.length, fit: scored.fit, formulas: scoreMap(scored.scores) };
    });
    const coverage = {
      hoursMarket10: main.test.filter((r) => noisyOr(r.labP) >= 0.1).length,
      listedHours: main.test.filter((r) => r.y === 1).length,
      listedMarketUnder10: main.test.filter((r) => r.y === 1 && noisyOr(r.labP) < 0.1).length,
      quietMarketOver50: main.test.filter((r) => r.y === 0 && noisyOr(r.labP) >= 0.5).length,
    };
    return {
      horizonH: h,
      train: {
        from: iso(from),
        to: iso(split),
        hours: main.train.length,
        events: eventsIn(releases, from, split),
        rate: round(mean(main.train.map((r) => r.y)), 3),
      },
      test: {
        from: iso(split),
        to: iso(until),
        hours: main.test.length,
        events: eventsIn(releases, split, until),
        rate: round(mean(main.test.map((r) => r.y)), 3),
      },
      fit,
      formulas: scores,
      coverage,
      rolling,
      sensitivity,
    };
  });

  // Decision: the best market formula at the headline horizon, out of sample, pre-registered rule.
  const head = horizons.find((x) => x.horizonH === HEADLINE_H)!;
  const best = head.formulas.filter((f) => f.id !== 'base').reduce((a, b) => (b.skill > a.skill ? b : a));
  const probability = best.skill > DECISION_MIN_SKILL && best.sanity.sane;
  const skillOf = (id: FormulaId) => head.formulas.find((f) => f.id === id)!;
  const formula: ShippedFormula =
    skillOf('noisy-or-cal').skill > skillOf('noisy-or').skill ? 'noisy-or-cal' : 'noisy-or';

  // What ships: per-horizon constants fitted on train, with the shipped formula's test metrics.
  const constants: ForecastConstants = {
    version: REPLAY_VERSION,
    formula,
    recommendation: probability ? 'probability' : 'lead-score',
    fittedOn: { from: iso(from), to: iso(split), events: eventsIn(releases, from, split) },
    testedOn: { from: iso(split), to: iso(until), events: eventsIn(releases, split, until) },
    horizons: horizons.map((x) => {
      const s = x.formulas.find((f) => f.id === formula)!;
      return horizonConstants(x.fit, x.horizonH, formula, {
        hours: x.test.hours,
        rate: x.test.rate,
        brier: s.brier,
        skill: s.skill,
        skillCi95: s.skillCi95,
        sane: s.sanity.sane,
      });
    }),
  };

  // The page's numbers come from the domain function run on these constants, not a re-implementation.
  const shipped = (labP: readonly number[]) =>
    anyReleaseProbability(
      labP.map((p, i) => ({ labId: LABS[i], p })),
      HEADLINE_H,
      constants,
    ).p;
  const { train: trainRows, test: testRows } = splitRows(primary[HEADLINE_H], split, until, HEADLINE_H);
  const trainP = trainRows.map((r) => shipped(r.labP));
  const edges = bandEdges(trainP);
  const bands = bandLevels(edges);
  const testP = testRows.map((r) => shipped(r.labP));
  const allRows = primary[HEADLINE_H];
  const allP = allRows.map((r) => shipped(r.labP));

  const series = grid.headline.filter((_, i) => i % SERIES_STEP_H === 0);
  const seriesP = series.map((r) => shipped(r.labP));

  const inWindow = releases.filter((r) => r.t > from && r.t <= until);
  const erased = inWindow.filter((r) => r.models.every((id) => SCHEDULED_EXPIRY[id]));
  const curated = releaseRows(raw).filter(
    (r) => FRONTIER_LABS.has(r.labId) && r.announcedAt && Date.parse(r.announcedAt) / 1000 > from,
  );
  const priced = pricedEvents(releases, grid.headline, from, until);
  const testPriced = priced.filter((e) => Date.parse(e.at) / 1000 > split);
  const lag = settlementLags(raw);

  return {
    meta: {
      version: REPLAY_VERSION,
      pulledAt: raw.pulledAt,
      window: { from: iso(from), until: iso(until) },
      split: { at: iso(split), trainFraction: TRAIN_FRACTION, purged: true },
      horizonsH: HORIZONS_H,
      headlineH: HEADLINE_H,
      event:
        'E(t,h): a frontier lab (FRONTIER_LABS) has a text-output OpenRouter release event (releaseEvents: canonical-slug and :free twins collapsed, same-lab listings within 2h grouped) whose first listing falls in (t, t+h].',
      marketRead:
        'Per lab, the best text family: familyCurves/readCurve at t+h over the Polymarket rungs an as-of reader could see at t. Labs combine by noisy-OR (the cross-lab clustering test found no dependence beyond a shuffled baseline).',
      protocol: {
        admitDays: ADMIT_DAYS,
        trustedBracketDays: TRUSTED_BRACKET_DAYS,
        rollingOrigins: ROLLING_ORIGINS,
        bootstrap: BOOTSTRAP,
        sanity: SANITY,
        decisionMinSkill: DECISION_MIN_SKILL,
        levelQuantiles: LEVEL_QUANTILES,
        pricedMin: PRICED_MIN,
        readMin: READ_MIN,
        formulasTried: FORMULAS.length,
        readVariants: ['curve (primary)', 'no-buckets', 'trusted', 'no-settle', 'uncensored'],
      },
      limitations: [
        'Hourly rows are heavily autocorrelated: one release event sets y=1 for h consecutive hours, so the effective sample size is the number of distinct release events (test: tens), not the number of hours (thousands).',
        `The release rate is not stationary: the ${HEADLINE_H}h rate was ${head.train.rate} in the train window and ${head.test.rate} in the test window, so every constant fitted on train is miscalibrated on test.`,
        'No historical bid/ask: every quote is treated as a tight book, so the live thin-book gate (spread > 10¢) cannot be replayed; date-bucket floors use the price in place of the best bid (an upper bound on the live floor; no-buckets is the lower bound). PAV weights are uniform (no historical liquidity).',
        'The CLOB pull kept the last 15 days of each rung, so a rung is admitted only within 14 days of its deadline. The live trusted-read rule mainly guards reads extrapolated from rungs further out; those cannot be replayed without leaking outcomes, so the trusted variant here only drops lower-bound and bucket-floor reads.',
        'Rungs due after the pull are missing (unresolved rungs were not pulled), so market reads in the last 14 days are censored low; the uncensored variant stops the test there.',
        'OpenRouter survivorship: the outcome counts only models OpenRouter still lists (see survivorship).',
        `Markets are read only until their model launched (announcement, else first YES resolution). Live markets keep trading near 1 until they resolve (median ${lag.medianH}h after the announcement, up to ${lag.maxH}h, over ${lag.events} markets); the no-settle variant scores an unguarded reader.`,
      ],
    },
    releases: {
      inWindow: inWindow.length,
      markers: inWindow.map((r) => ({ at: iso(r.t), labId: r.labId, models: r.models })),
    },
    survivorship: {
      monthly: monthlyReleases(releases.filter((r) => r.t > Date.parse('2025-01-01T00:00:00Z') / 1000)),
      perLab30d: labEventRates(releases, [Date.parse('2025-07-01T00:00:00Z') / 1000, from], [from, until]),
      curatedFrontierLaunches: curated.length,
      curatedStillListed: curated.filter((r) => r.availableId).length,
      delistedSincePull: ['anthropic/claude-3-haiku'],
      scheduledExpiry: {
        probedAt: '2026-09-26',
        frontierIds: Object.keys(SCHEDULED_EXPIRY).length,
        inWindowEventsErased: erased.length,
      },
      note: 'Every xAI listing before 2026-03-31 is gone, so the window starts 2026-04-01. Inside it, a release event disappears only when all of its listings are delisted.',
    },
    horizons,
    pricedEvents: {
      test: testPriced.length,
      testPriced: testPriced.filter((e) => e.priced).length,
      events: priced,
    },
    byLab: labTable(primary[HEADLINE_H], releases, split, until),
    settlementLag: lag,
    decision: {
      rule: `PROBABILITY design when the best market formula's out-of-sample Brier skill at ${HEADLINE_H}h vs the train base rate exceeds ${DECISION_MIN_SKILL} with sane reliability; otherwise keep the lead score.`,
      bestFormula: best.id,
      skill: best.skill,
      skillCi95: best.skillCi95,
      sane: best.sanity.sane,
      worstBinGap: best.sanity.worstBinGap,
      rollingSkill: head.rolling.map((r) => r.skill[best.id]),
      recommendation: constants.recommendation,
    },
    constants,
    levels: {
      edges,
      bands,
      train: levelTable(trainRows, trainP, releases, bands),
      test: levelTable(testRows, testP, releases, bands),
      all: levelTable(allRows, allP, releases, bands),
    },
    series: {
      from: iso(series[0].t),
      stepH: SERIES_STEP_H,
      p: seriesP.map((p) => round(p, 3)),
      market: series.map((r) => round(noisyOr(r.labP), 3)),
      level: seriesP.map((p) => levelFromProbability(p, bands)),
      /** Best 7-day read across labs (formula (b) at 7 days): the replayable shape of the level's P7. */
      lead7: series.map((r) => round(r.lead7, 3)),
    },
  };
}

export type Replay = ReturnType<typeof buildReplay>;

async function main(): Promise<void> {
  const out = `${OUT_DIR}/v3-replay.json`;
  await writeFile(out, `${JSON.stringify(buildReplay(await readRaw()), null, 2)}\n`);
  execFileSync('pnpm', ['exec', 'oxfmt', out], { stdio: 'inherit' });
  console.log(`wrote ${out}`);
}

const argv = (globalThis as { process?: { argv?: string[] } }).process?.argv ?? [];
if (argv[1] && import.meta.url.endsWith(argv[1].replace(/^\.\//, ''))) await main();
