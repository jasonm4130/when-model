/** DROPCON: 5 = nothing cooking, 1 = a frontier model is about to land. Mirrors DEFCON/DOUGHCON. */
export interface DropconInput {
  /** Best "ships within 7 days" probability across labs, 0..1. */
  maxWeekOdds: number;
  /** Best "ships within 30 days" probability, 0..1. */
  maxMonthOdds: number;
  /** Frontier-lab drops on OpenRouter in the last 7 days. */
  frontierDrops7d: number;
  /** HN model stories over 150 points in the last 48h. */
  hotStories: number;
  /** Feed items flagged as release-shaped in the last 48h. */
  releaseAlerts: number;
}

export interface Dropcon {
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  blurb: string;
  score: number;
  drivers: string[];
}

const LEVELS: Record<number, { name: string; blurb: string }> = {
  5: { name: 'QUIET ORBIT', blurb: 'No credible drop signal. Labs are training, not shipping.' },
  4: { name: 'RUMOUR MILL', blurb: 'Chatter and long-dated odds. Something is cooking, nothing is plated.' },
  3: {
    name: 'GPU FANS SPINNING',
    blurb: 'Markets lean toward a release this month. Watch the SDK changelogs.',
  },
  2: {
    name: 'VAGUE-POSTING DETECTED',
    blurb: 'Odds of a drop this week are high. Clear your evals calendar.',
  },
  1: {
    name: 'DROP IMMINENT',
    blurb: 'A frontier model is landing. Refresh the changelog. Refresh it again.',
  },
};

export function computeDropcon(i: DropconInput): Dropcon {
  const drivers: string[] = [];
  let score = 0;
  score += i.maxWeekOdds * 45;
  if (i.maxWeekOdds >= 0.5)
    drivers.push(`${Math.round(i.maxWeekOdds * 100)}% odds of a frontier drop within 7 days`);
  score += i.maxMonthOdds * 20;
  if (i.maxMonthOdds >= 0.6 && i.maxWeekOdds < 0.5)
    drivers.push(`${Math.round(i.maxMonthOdds * 100)}% odds of a frontier drop within 30 days`);
  score += Math.min(i.frontierDrops7d, 4) * 6;
  if (i.frontierDrops7d)
    drivers.push(
      `${i.frontierDrops7d} frontier-lab model${i.frontierDrops7d === 1 ? '' : 's'} landed on OpenRouter this week`,
    );
  score += Math.min(i.hotStories, 4) * 3;
  if (i.hotStories >= 2) drivers.push(`${i.hotStories} model stories over 150 points on Hacker News`);
  score += Math.min(i.releaseAlerts, 5) * 2;
  if (i.releaseAlerts >= 2) drivers.push(`${i.releaseAlerts} release-shaped headlines in the feed`);
  score = Math.min(100, Math.round(score));
  const level: Dropcon['level'] = score >= 75 ? 1 : score >= 55 ? 2 : score >= 35 ? 3 : score >= 15 ? 4 : 5;
  if (!drivers.length) drivers.push('All quiet on the release front');
  return { level, score, drivers, ...LEVELS[level] };
}
