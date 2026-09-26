import { daysSince, monthlyHistogram, withinDays, type Drop, type ReleaseEvent } from './drop';
import { isTextReleaseFamily } from './forecast';
import type { Lab } from './lab';
import { modelFamily, releaseCurveForLab, type CurveBracket, type Market, type ModelFamily } from './market';

export type LabTemperature = 'QUIET' | 'WARM' | 'HOT' | 'SHIPPING';

/** A quoted rung, as the market labels it. */
export interface RungRef {
  label: string;
  deadline: string;
  /** P(released by the deadline) on the monotone curve. */
  p: number;
  /** The heaviest market's own mid at this deadline (1 − mid for "No release by"), before the fit. */
  quoted: number;
  /** That market. */
  url: string;
}

/** One horizon's read off a lab's family curve. */
export interface LabOddsRead {
  p: number;
  /**
   * False for a constant-hazard extrapolation from a rung more than 14 days past the horizon
   * (`isTrustedRead`): shown as "extrapolated", never scored and never in the forecast.
   */
  trusted: boolean;
  /** Read between quoted rungs, or between now and a near first rung. */
  interpolated: boolean;
  /** A floor: held at a rung, or set by day-bucket best bids. */
  lowerBound: boolean;
  /** A ceiling: cut to the sum of day-bucket asks, which the curve read exceeded. */
  upperBound: boolean;
  source: 'curve' | 'buckets';
  from?: RungRef;
  to?: RungRef;
  url: string;
}

/** A lab's strongest frontier text family, read at three horizons. */
export interface LabOdds {
  family: string;
  marketUrl: string;
  p72: LabOddsRead;
  p7: LabOddsRead;
  p30: LabOddsRead;
  /** Open cumulative outcomes left out because their book was thin (spread over 10¢ or one-sided). */
  thinExcluded: number;
  maxSpread?: number;
}

/** One lab card: release tempo, odds and a composite heat used to rank the cards. */
export interface LabStatus {
  id: Lab['id'];
  name: string;
  short: string;
  color: string;
  glyph: string;
  xHandles: string[];
  polymarketCompany: string;
  latest?: Drop;
  daysSince?: number;
  drops30d: number;
  /** Distinct launches in the last 30 days, twins and same-launch SKUs collapsed. */
  releases30d: number;
  histogram: number[];
  odds?: LabOdds;
  /** Families left out because their model listed on OpenRouter in the last 4 days: those markets trade near 1 until they resolve. */
  launchedFamilies: string[];
  /** Yes price for this lab in the best-model market, 0..1. */
  leaderboardOdds?: number;
  /** 0..100 composite. */
  heat: number;
  /** The heat split: trusted market reads, and recency as a burstiness prior. */
  heatParts: { market: number; recency: number };
  status: LabTemperature;
}

export const HISTOGRAM_MONTHS = 12;

/**
 * A launched model's markets keep trading near 1 for a median 2.6 hours and up to 63.3 hours before
 * they close (the calibration replay, 39 markets), so a family stays out for 4 days after its listing.
 */
export const LAUNCH_SETTLE_MS = 4 * 86_400_000;

/**
 * Does this listing name the model a family's markets are about? Every word of the family key must
 * appear ("claude sonnet" in "Claude Sonnet 5"); a versioned key needs the listing's first version
 * after that word to match it ("gpt-6" = 6, "grok 4.8+" ≥ 4.8, so Grok 4.7 does not close "Next Grok (4.8+)").
 */
export function familyMatchesModel(family: ModelFamily, modelName: string): boolean {
  const name = modelName.toLowerCase();
  const words = family.key.match(/[a-z]{2,}/g) ?? [];
  const first = words[0];
  if (!first) return false;
  const word = (w: string) => new RegExp(`(?<![a-z])${w}(?![a-z])`);
  if (!words.every((w) => word(w).test(name))) return false;
  const version = /(\d+(?:\.\d+)?)(\+)?/.exec(family.key);
  if (!version) return true;
  const after = name.slice(name.search(word(first)) + first.length);
  const found = /(?<![\d.])(\d+(?:\.\d+)?)(?![\d.])/.exec(after);
  if (!found) return false;
  const want = Number(version[1]);
  const got = Number(found[1]);
  return version[2] ? got >= want : got === want;
}

/** Family display names of `markets` whose model this lab listed in the settle window. */
export function launchedFamilies(
  markets: readonly Market[],
  events: readonly ReleaseEvent[],
  now: number,
): Set<string> {
  const recent = events.filter((e) => now - Date.parse(e.firstListedAt) <= LAUNCH_SETTLE_MS);
  const launched = new Set<string>();
  for (const market of markets) {
    const family = modelFamily(market.title);
    if (!family || launched.has(family.key)) continue;
    if (
      recent.some((e) => e.labId === market.labId && e.models.some((m) => familyMatchesModel(family, m.name)))
    )
      launched.add(family.key);
  }
  return launched;
}

const HEAT = {
  p72: 20,
  p7: 40,
  p30: 15,
  recency: 15,
  perRecentRelease: 10 / 3,
  maxRecentReleases: 3,
} as const;

/**
 * Heat: mostly what trusted market reads say about the next 72 hours, 7 and 30 days, plus recency.
 * Recency is a burstiness prior, not a forecast: labs that shipped recently shipped again more often
 * (21-28% within 7 days) than "overdue" labs (11%, below the 20% base rate) in the cadence backtest.
 */
export function computeHeat(input: {
  p72?: number;
  p7?: number;
  p30?: number;
  daysSince?: number;
  releases30d: number;
}): { heat: number; market: number; recency: number } {
  const recencyShare =
    input.daysSince === undefined ? 0 : Math.max(0, 30 - Math.min(input.daysSince, 30)) / 30;
  const market = (input.p72 ?? 0) * HEAT.p72 + (input.p7 ?? 0) * HEAT.p7 + (input.p30 ?? 0) * HEAT.p30;
  const recency =
    recencyShare * HEAT.recency + Math.min(input.releases30d, HEAT.maxRecentReleases) * HEAT.perRecentRelease;
  // Each part is rounded and the heat is their sum, so the split shown on a card adds up.
  const parts = { market: Math.round(market), recency: Math.round(recency) };
  return { heat: Math.min(100, parts.market + parts.recency), ...parts };
}

export function temperatureFor(heat: number, daysSinceDrop: number | undefined): LabTemperature {
  if (daysSinceDrop !== undefined && daysSinceDrop <= 2) return 'SHIPPING';
  if (heat >= 60) return 'HOT';
  if (heat >= 25) return 'WARM';
  return 'QUIET';
}

function toRead(p: number, bracket: CurveBracket, trusted: boolean): LabOddsRead {
  const rung = (point: NonNullable<CurveBracket['from']>): RungRef => ({
    label: point.label,
    deadline: point.deadline,
    p: point.p,
    quoted: point.quoted,
    url: point.url,
  });
  return {
    p,
    trusted,
    interpolated: bracket.interpolated,
    lowerBound: bracket.lowerBound,
    upperBound: bracket.upperBound,
    source: bracket.source,
    ...(bracket.from ? { from: rung(bracket.from) } : {}),
    ...(bracket.to ? { to: rung(bracket.to) } : {}),
    url: bracket.url,
  };
}

/** A trusted read's probability, 0 for an extrapolated one: what heat, the score and the forecast use. */
export function trustedP(read: LabOddsRead | undefined): number {
  return read?.trusted ? read.p : 0;
}

export function assessLab(
  lab: Lab,
  context: {
    drops: readonly Drop[];
    markets: readonly Market[];
    bestModelMarket?: Market;
    /** `releaseEvents` over every listing: recency and the launched-family filter read them. */
    events?: readonly ReleaseEvent[];
  },
  now: number,
): LabStatus {
  const mine = context.drops.filter((d) => d.labId === lab.id && Date.parse(d.createdAt) <= now);
  const latest = mine[0];
  const days = latest ? daysSince(latest.createdAt, now) : undefined;
  const drops30d = mine.filter((d) => withinDays(d.createdAt, 30, now)).length;
  const events = (context.events ?? []).filter((e) => e.labId === lab.id);
  const releases30d = events.filter((e) => withinDays(e.firstListedAt, 30, now)).length;

  const labMarkets = context.markets.filter((m) => m.labId === lab.id && isTextReleaseFamily(m.title));
  const launched = launchedFamilies(labMarkets, events, now);
  const curve = releaseCurveForLab(
    labMarkets.filter((m) => !launched.has(modelFamily(m.title)?.key ?? '')),
    lab.id,
    now,
  );
  const odds: LabOdds | undefined = curve && {
    family: curve.family,
    marketUrl: curve.marketUrl,
    p72: toRead(curve.p72, curve.bracket72, curve.trusted72),
    p7: toRead(curve.p7, curve.bracket7, curve.trusted7),
    p30: toRead(curve.p30, curve.bracket30, curve.trusted30),
    thinExcluded: curve.thinExcluded,
    ...(curve.maxSpread !== undefined ? { maxSpread: curve.maxSpread } : {}),
  };
  const leaderboardOdds = context.bestModelMarket?.outcomes.find(
    (o) => o.label === lab.polymarketCompany,
  )?.yes;
  const { heat, market, recency } = computeHeat({
    p72: trustedP(odds?.p72),
    p7: trustedP(odds?.p7),
    p30: trustedP(odds?.p30),
    daysSince: days,
    releases30d,
  });
  const launchedNames = labMarkets
    .map((m) => modelFamily(m.title))
    .filter((f): f is ModelFamily => !!f && launched.has(f.key))
    .map((f) => f.name);
  return {
    id: lab.id,
    name: lab.name,
    short: lab.short,
    color: lab.color,
    glyph: lab.glyph,
    xHandles: lab.xHandles,
    polymarketCompany: lab.polymarketCompany,
    latest,
    daysSince: days,
    drops30d,
    releases30d,
    histogram: monthlyHistogram(mine, HISTOGRAM_MONTHS, new Date(now)),
    ...(odds ? { odds } : {}),
    launchedFamilies: [...new Set(launchedNames)],
    leaderboardOdds,
    heat,
    heatParts: { market, recency },
    status: temperatureFor(heat, days),
  };
}
