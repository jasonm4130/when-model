import type { LabId } from './lab';

/** One tradeable outcome of a Polymarket event, e.g. "released by September 30". */
export interface Outcome {
  label: string;
  /** Price of the Yes share, 0..1: the crowd's probability. */
  yes: number;
  /** When this outcome resolves; release markets use it as the deadline. */
  endDate?: string;
  closed: boolean;
  vol24: number;
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
/** Polymarket pads multi-outcome events with unnamed "Company A" slots; they are never real odds. */
const UNNAMED_SLOT = /^Company [A-Z]$/;

export function classifyMarket(title: string): MarketKind {
  if (RELEASE_TITLE.test(title)) return 'release';
  if (LEADERBOARD_TITLE.test(title)) return 'leaderboard';
  return 'other';
}

/** Markets of kind "other" only earn a slot if they name a model or lab. */
export function isModelRelevant(market: Pick<Market, 'kind' | 'title'>): boolean {
  return market.kind !== 'other' || MODEL_TITLE.test(market.title);
}

export function isUnnamedSlot(label: string): boolean {
  return UNNAMED_SLOT.test(label);
}

/** "Other" and untouched 50/50 slots carry no information worth a row. */
export function isPlaceholderOutcome(outcome: Outcome): boolean {
  return outcome.label === 'Other' || (outcome.yes === 0.5 && outcome.vol24 === 0);
}

/** Open outcomes worth showing: releases in deadline order, everything else by probability. */
export function displayOutcomes(market: Market, limit: number): Outcome[] {
  const live = market.outcomes.filter((o) => !o.closed && !isPlaceholderOutcome(o));
  if (market.kind === 'release') {
    return live
      .filter((o) => o.endDate)
      .sort((a, b) => Date.parse(a.endDate ?? '') - Date.parse(b.endDate ?? ''))
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
