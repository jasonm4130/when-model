import { daysSince, monthlyHistogram, withinDays, type Drop } from './drop';
import type { Lab } from './lab';
import { releaseOddsForLab, type Market, type ReleaseOdds } from './market';

export type LabTemperature = 'QUIET' | 'WARM' | 'HOT' | 'SHIPPING';

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
  histogram: number[];
  weekOdds?: ReleaseOdds;
  monthOdds?: ReleaseOdds;
  /** Yes price for this lab in the best-model market, 0..1. */
  leaderboardOdds?: number;
  /** 0..100 composite. */
  heat: number;
  status: LabTemperature;
}

export const HISTOGRAM_MONTHS = 12;

const HEAT = { weekOdds: 55, monthOdds: 20, recency: 15, perRecentDrop: 3.3, maxRecentDrops: 3 } as const;

/** Heat: mostly what the market says, nudged by how recently and how often the lab has shipped. */
export function computeHeat(input: {
  weekOdds?: number;
  monthOdds?: number;
  daysSince?: number;
  drops30d: number;
}): number {
  const recency = input.daysSince === undefined ? 0 : Math.max(0, 30 - Math.min(input.daysSince, 30)) / 30;
  const heat =
    (input.weekOdds ?? 0) * HEAT.weekOdds +
    (input.monthOdds ?? 0) * HEAT.monthOdds +
    recency * HEAT.recency +
    Math.min(input.drops30d, HEAT.maxRecentDrops) * HEAT.perRecentDrop;
  return Math.round(Math.min(100, heat));
}

export function temperatureFor(heat: number, daysSinceDrop: number | undefined): LabTemperature {
  if (daysSinceDrop !== undefined && daysSinceDrop <= 2) return 'SHIPPING';
  if (heat >= 60) return 'HOT';
  if (heat >= 25) return 'WARM';
  return 'QUIET';
}

export function assessLab(
  lab: Lab,
  context: { drops: readonly Drop[]; markets: readonly Market[]; bestModelMarket?: Market },
  now: number,
): LabStatus {
  const mine = context.drops.filter((d) => d.labId === lab.id && Date.parse(d.createdAt) <= now);
  const latest = mine[0];
  const days = latest ? daysSince(latest.createdAt, now) : undefined;
  const drops30d = mine.filter((d) => withinDays(d.createdAt, 30, now)).length;
  const weekOdds = releaseOddsForLab(context.markets, lab.id, 7, now);
  const monthOdds = releaseOddsForLab(context.markets, lab.id, 31, now);
  const leaderboardOdds = context.bestModelMarket?.outcomes.find(
    (o) => o.label === lab.polymarketCompany,
  )?.yes;
  const heat = computeHeat({ weekOdds: weekOdds?.p, monthOdds: monthOdds?.p, daysSince: days, drops30d });
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
    histogram: monthlyHistogram(mine, HISTOGRAM_MONTHS, new Date(now)),
    weekOdds,
    monthOdds,
    leaderboardOdds,
    heat,
    status: temperatureFor(heat, days),
  };
}
