import { leadInputSkillText, type ForecastSummary } from './forecast';
import type { LabId } from './lab';

/**
 * DROPCON v3: a hand-weighted lead score, 0..100, from forward-looking market reads only.
 *
 * The calibration replay (data/backtest/v3-replay.json) tested the alternative, a calibrated
 * P(frontier release within 72h), and it failed its pre-registered bar: out-of-sample Brier skill
 * −0.002 at 72h, against a required +0.02. So the level stays the report's §3 lead score and the
 * probability is shown only as context (the base-rate line, /backtest). Lead events (stealth,
 * broadcasts, architectures) and landed launches are displayed but never scored, because nothing
 * measured justifies a weight for them. The 10 points §3 gave lead events move to the 7-day term,
 * which also makes level 1 reachable (the critic found 74.9 was the ceiling under §3's weights).
 */
export const DROPCON_ALGORITHM_VERSION = 3;

/** Lowest score at levels 1..4, level 1 first; below the last is level 5. `history.ts` imports these. */
export const LEVEL_BANDS = [75, 55, 35, 15] as const;

export type DropconLevel = 1 | 2 | 3 | 4 | 5;

export function levelForScore(score: number): DropconLevel {
  const i = LEVEL_BANDS.findIndex((min) => score >= min);
  return (i === -1 ? 5 : i + 1) as DropconLevel;
}

export const WEIGHTS = {
  /** × P7, the best trusted frontier-family P(release within 7 days). */
  market7d: 80,
  /** × max(0, P30 − P7): only probability the 7-day term does not already hold. */
  market30dIncrement: 10,
  /** × clamp(ΔP7 over 24 hours / 0.30, 0, 1), from the D1 series. */
  repricing: 10,
  repricingFullDelta: 0.3,
} as const;

/** The market read behind a term, for its headline and provenance row. */
export interface MarketDriver {
  labId: LabId;
  lab: string;
  family: string;
  p: number;
  /**
   * At a quoted rung; between rungs (or from now to a near first rung); held at a rung (a lower
   * bound: past the last rung, or short of one more than 14 days out); a floor of day-bucket best
   * bids; or a ceiling of day-bucket asks the curve read exceeded.
   */
  read: 'rung' | 'interpolated' | 'held' | 'floor' | 'ceiling';
  /** The bracketing rungs' labels, e.g. "September 30" → "October 15". */
  from?: string;
  to?: string;
  /**
   * The quoted rung the headline cites: the one at or before the horizon, else the near one after
   * it. Its price is the heaviest market's own mid at that rung (1 − mid for "No release by"), not
   * the fitted curve; `url` is that market.
   */
  quote?: { label: string; p: number };
  url: string;
}

/** Exact inputs of one score, recorded with every capture. */
export interface DropconInput {
  /** Best trusted P(release within 7 days) across frontier text families, 0..1. */
  p7: number;
  /** Best trusted P(release within 30 days) across frontier text families. */
  p30: number;
  /** P7 about 24 hours earlier in the D1 series (same algorithm version); null until one exists. */
  p7DayAgo: number | null;
  /** False when Polymarket failed: every term is then 0 and the reading is a floor. */
  oddsAvailable: boolean;
  /** False when OpenRouter failed; with the odds also down there is no signal at all. */
  listingsAvailable: boolean;
  top7?: MarketDriver;
  top30?: MarketDriver;
}

export type DropconState = 'ok' | 'floor' | 'no-signal';

/** One scored term. Rows' points add up to the score. */
export interface ProvenanceRow {
  term: 'market-7d' | 'market-30d' | 'repricing';
  /** Every scored term is forward-looking; landed launches are listed separately and score nothing. */
  tag: 'LEAD';
  label: string;
  /** The arithmetic, e.g. "80 × 0.85". */
  detail: string;
  points: number;
  url?: string;
}

export interface Dropcon {
  level: DropconLevel;
  name: string;
  blurb: string;
  score: number;
  state: DropconState;
  /** `state !== 'ok'`: the history rollup reads it. */
  degraded: boolean;
  /** One sentence built from the top-scoring term. */
  headline: string;
  provenance: ProvenanceRow[];
  /** The calibrated probability and base rate, as context rather than the level. */
  baseRate: string;
  notes: string[];
}

/**
 * Each level's name, and what the market says when 80 × P7 alone lands in that band. The blurb
 * describes P7, not the score: the 30-day and repricing terms can lift the level above what P7
 * says (P7 0.79 after a 30-point rise reaches level 1), so the blurb is picked by P7's own band
 * and says what lifted the level.
 */
const LEVELS: Record<DropconLevel, { name: string; market: string }> = {
  5: {
    name: 'QUIET ORBIT',
    market:
      'No market prices a named frontier release as likely this week. Unannounced releases remain possible.',
  },
  4: {
    name: 'RUMOUR MILL',
    market: 'A market gives a named frontier release a real but minority chance within 7 days.',
  },
  3: {
    name: 'GPU FANS SPINNING',
    market: 'Markets put a named frontier release at roughly even odds within 7 days.',
  },
  2: {
    name: 'VAGUE-POSTING DETECTED',
    market: 'Markets price a named frontier release as likely within 7 days.',
  },
  1: {
    name: 'RELEASE SURGE',
    market: 'Markets price a named frontier release as near-certain within 7 days.',
  },
};

/** The level's blurb: P7's own band in words, what else lifted the level, and level 1's caveat. */
function levelBlurb(level: DropconLevel, provenance: readonly ProvenanceRow[]): string {
  const band = levelForScore(provenance[0].points);
  const lifts = [
    provenance[1].points > 0 ? 'the 30-day odds' : '',
    provenance[2].points > 0 ? 'a 24-hour rise in the 7-day odds' : '',
  ].filter(Boolean);
  const lifted = level < band && lifts.length ? ` The level is lifted by ${lifts.join(' and ')}.` : '';
  return `${LEVELS[band].market}${lifted}${level === 1 ? ' Not a launch countdown.' : ''}`;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** "Next Claude Sonnet" → "the next Claude Sonnet"; "GPT-6" stays "GPT-6". */
export function familyPhrase(family: string): string {
  return family.replace(/^next\s+/i, 'the next ');
}

const MONTH = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+/i;

/** "September 29" → "Sep 29"; anything else as the market wrote it. */
export function shortRung(label: string): string {
  return label.replace(
    MONTH,
    (_, m: string) => `${m.charAt(0).toUpperCase()}${m.slice(1, 3).toLowerCase()} `,
  );
}

/**
 * The market read in words. It quotes a rung the market shows, and whenever the scored read rounds
 * to a different number it says so, so the headline never hides the number the level used.
 */
function marketSentence(d: MarketDriver, horizon: string): string {
  const who = familyPhrase(d.family);
  if (d.read === 'floor')
    return `Polymarket's day buckets put at least ${pct(d.p)} on ${who} shipping ${horizon}`;
  if (d.read === 'ceiling') return `Polymarket's day buckets cap ${who} at ${pct(d.p)} ${horizon}`;
  if (d.quote) {
    const quoted = `Polymarket prices ${pct(d.quote.p)} that ${who} ships by ${shortRung(d.quote.label)}`;
    return pct(d.quote.p) === pct(d.p) ? quoted : `${quoted} (${pct(d.p)} ${horizon} on its curve)`;
  }
  return `Polymarket's curve puts ${pct(d.p)} on ${who} shipping ${horizon}`;
}

function bracketText(d: MarketDriver): string {
  if (d.read === 'rung') return `quoted at ${d.to}`;
  if (d.read === 'floor') return 'day-bucket best bids';
  if (d.read === 'ceiling') return 'at most, capped by day-bucket asks';
  if (d.read === 'held') return `at least, held at ${d.from}`;
  if (d.from && d.to) return `interpolated ${d.from} → ${d.to}`;
  return d.to ? `constant hazard from now to ${d.to}` : `held at ${d.from ?? 'the last rung'}`;
}

const signedPp = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))} pts`;

/** A 24-hour rise in P7 this large is worth a clause in the headline. */
const REPRICING_MENTION = 0.05;

export function computeDropcon(i: DropconInput, forecast?: ForecastSummary): Dropcon {
  const state: DropconState = i.oddsAvailable ? 'ok' : i.listingsAvailable ? 'floor' : 'no-signal';
  const p7 = i.oddsAvailable ? i.p7 : 0;
  const p30 = i.oddsAvailable ? i.p30 : 0;
  const increment = Math.max(0, p30 - p7);
  const delta = i.oddsAvailable && i.p7DayAgo !== null ? p7 - i.p7DayAgo : undefined;
  const repriced =
    delta === undefined
      ? 0
      : Math.min(1, Math.max(0, delta / WEIGHTS.repricingFullDelta)) * WEIGHTS.repricing;

  const provenance: ProvenanceRow[] = [
    {
      term: 'market-7d',
      tag: 'LEAD',
      label: i.top7
        ? `${i.top7.family} (${i.top7.lab}) · ${pct(p7)} within 7 days, ${bracketText(i.top7)}`
        : 'No trusted frontier market read within 7 days',
      detail: `${WEIGHTS.market7d} × ${p7.toFixed(2)}`,
      points: Math.round(WEIGHTS.market7d * p7),
      ...(i.top7 ? { url: i.top7.url } : {}),
    },
    {
      term: 'market-30d',
      tag: 'LEAD',
      label: i.top30
        ? `${i.top30.family} (${i.top30.lab}) · ${pct(p30)} within 30 days, ${
            i.top7 && (i.top7.labId !== i.top30.labId || i.top7.family !== i.top30.family)
              ? // P7 and P30 are each the best across labs, so they can come from different families.
                `${pct(increment)} above the best 7-day read (${i.top7.family}, ${i.top7.lab})`
              : `${pct(increment)} beyond the 7-day term`
          }`
        : 'No trusted frontier market read within 30 days',
      detail: `${WEIGHTS.market30dIncrement} × max(0, ${p30.toFixed(2)} − ${p7.toFixed(2)})`,
      points: Math.round(WEIGHTS.market30dIncrement * increment),
      ...(i.top30 ? { url: i.top30.url } : {}),
    },
    {
      term: 'repricing',
      tag: 'LEAD',
      label:
        delta === undefined
          ? 'Repricing: no reading from 24 hours ago yet'
          : `Best 7-day odds moved ${signedPp(delta)} in 24 hours (full marks at +30)`,
      detail:
        delta === undefined
          ? `${WEIGHTS.repricing} × 0`
          : `${WEIGHTS.repricing} × clamp(${delta.toFixed(2)} / ${WEIGHTS.repricingFullDelta}, 0, 1)`,
      points: Math.round(repriced),
      url: '/api/history.json',
    },
  ];
  const score = Math.min(
    100,
    provenance.reduce((sum, row) => sum + row.points, 0),
  );
  const level = state === 'ok' ? levelForScore(score) : 5;

  // Repricing can never be the top term: its 10 × min(1, ΔP7 / 0.3) is below 80 × P7 for any
  // P7 ≥ ΔP7. So the headline names the market read and appends a real move when there is one.
  const top = provenance[0].points >= provenance[1].points ? provenance[0] : provenance[1];
  const moved =
    delta !== undefined && delta >= REPRICING_MENTION ? `, up ${signedPp(delta).slice(1)} in 24 hours` : '';
  let headline: string;
  if (state === 'no-signal') headline = 'Polymarket and OpenRouter are both unreachable: no signal';
  else if (state === 'floor')
    headline = 'Prediction-market odds are offline: this reading is a floor, not a measurement';
  else if (top.points === 0 || !i.top7)
    headline = 'No Polymarket market prices a named frontier text release in the next 30 days';
  else if (top.term === 'market-30d' && i.top30)
    headline = `${marketSentence(i.top30, 'within 30 days')}, but only ${pct(p7)} within 7 days${moved}`;
  else headline = `${marketSentence(i.top7, 'within 7 days')}${moved}`;

  const copy =
    state === 'no-signal'
      ? {
          name: 'NO SIGNAL',
          blurb: 'Polymarket and OpenRouter are both unreachable, so there is nothing to read.',
        }
      : { name: LEVELS[level].name, blurb: levelBlurb(level, provenance) };
  if (state === 'floor')
    copy.blurb = `Prediction-market odds are offline, so every term reads 0: a floor, not a measurement.`;

  return {
    level,
    name: copy.name,
    blurb: copy.blurb,
    score,
    state,
    degraded: state !== 'ok',
    headline,
    provenance,
    baseRate: forecast ? baseRateLine(forecast) : '',
    notes: [
      `Hand-set weights (v${DROPCON_ALGORITHM_VERSION}): ${WEIGHTS.market7d} × P7 + ${WEIGHTS.market30dIncrement} × (P30 − P7) + ${WEIGHTS.repricing} × repricing. They were never fitted, and the level itself has not been tested; in the replay, P7's form (the best read across labs) scored a Brier skill of ${leadInputSkillText()} against the base rate at 7 days.`,
      'P7 is the single strongest frontier text family, so it is a lower bound on any frontier release.',
      'Early warnings and landed launches are listed with their track record; they do not move the level.',
    ],
  };
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "16 Jul", in UTC. Spelled out by hand: ICU writes "Sept" for en-GB, and runtimes differ. */
const monthDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}`;
};

const span = (w: { from: string; to: string }) => `${monthDay(w.from)}–${monthDay(w.to)} ${w.to.slice(0, 4)}`;

/**
 * The base-rate line: the calibrated probability as context, next to the rate it failed to beat
 * and the rate in the held-out window, so a typical recent forecast does not read as a surge.
 */
export function baseRateLine(f: ForecastSummary): string {
  const base = `a frontier lab listed a text model within ${f.horizonHours}h in ${pct(f.baseRate)} of hours (${span(f.trainWindow)}) and in ${pct(f.testRate)} of held-out hours (${span(f.testWindow)})`;
  if (!f.oddsAvailable) return `Base rate: ${base}. Odds are offline, so there is no market read.`;
  const skill = `${f.skill < 0 ? '−' : '+'}${Math.abs(f.skill).toFixed(3)}`;
  return `Context, not the level: ${pct(f.p)} that some frontier lab lists a text model within ${f.horizonHours}h (market reads plus a ${pct(f.unpriced)} unpriced rate). Base rate: ${base}. Out of sample it did not beat the base rate (Brier skill ${skill}).`;
}

/** The probability a score-series row records: P7 when the odds were live, else nothing. */
export function headlineProbability(i: Pick<DropconInput, 'p7' | 'oddsAvailable'>): number | null {
  return i.oddsAvailable ? i.p7 : null;
}
