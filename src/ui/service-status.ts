/**
 * The DROPCON level as a transit service-status notice: the level's name, one deadpan line a
 * station would post, and a treatment that escalates with the level. Calm at 5 and 4 (ink on
 * paper), the notice yellow at 3, inverted (yellow on black) at 2 and the alert red at 1. A floor
 * (odds offline) and no signal are not readings, so they get the calm treatment with their own
 * words. Every treatment's text clears 7:1 on its ground (test/ui/service-status.test.ts). Pure.
 */
import type { Dropcon, DropconLevel } from '../domain/dropcon';
import { LEVEL_NAMES } from '../domain/levels';
import { PALETTE } from './palette';

export type StatusTreatment = 'calm' | 'notice' | 'inverted' | 'alert' | 'offline';

/** The posted line for each level, quietest to loudest. */
export const SERVICE_PHRASES: Readonly<Record<DropconLevel, string>> = {
  5: 'Good service.',
  4: 'Good service. Rumours on some lines.',
  3: 'Expect departures.',
  2: 'Now boarding.',
  1: 'Stand clear of the closing doors.',
};

/** The ground and text colour of each treatment. */
export const STATUS_COLOURS: Readonly<Record<StatusTreatment, { ground: string; text: string }>> = {
  calm: { ground: PALETTE.paper, text: PALETTE.ink },
  offline: { ground: PALETTE.paper, text: PALETTE['ink-2'] },
  notice: { ground: PALETTE.notice, text: PALETTE.ink },
  inverted: { ground: PALETTE.sign, text: PALETTE.notice },
  alert: { ground: PALETTE.alert, text: '#ffffff' },
};

export const LEVEL_TREATMENT: Readonly<Record<DropconLevel, StatusTreatment>> = {
  5: 'calm',
  4: 'calm',
  3: 'notice',
  2: 'inverted',
  1: 'alert',
};

export interface ServiceStatus {
  /** The level shown on the ladder, or undefined with no signal. */
  level?: DropconLevel;
  /** The strip's heading: the level's name, or what stopped the reading. */
  name: string;
  /** The posted line. */
  phrase: string;
  /** The sentence after it: what the markets say, or why there is no reading. */
  detail: string;
  treatment: StatusTreatment;
  /** The lead score, for a reading only. */
  score?: number;
}

type StatusInput = Pick<Dropcon, 'level' | 'state' | 'score' | 'blurb'>;

export function serviceStatus(c: StatusInput): ServiceStatus {
  if (c.state === 'no-signal')
    return {
      name: 'NO SIGNAL',
      phrase: 'Service information unavailable.',
      detail: 'Polymarket and OpenRouter are both unreachable, so there is no reading.',
      treatment: 'offline',
    };
  if (c.state === 'floor')
    return {
      level: c.level,
      name: 'SIGNAL FAILURE',
      phrase: 'Odds offline.',
      detail: 'Polymarket is unreachable. The level holds a floor; it is not a measurement.',
      treatment: 'offline',
    };
  return {
    level: c.level,
    name: LEVEL_NAMES[c.level],
    phrase: SERVICE_PHRASES[c.level],
    detail: c.blurb,
    treatment: LEVEL_TREATMENT[c.level],
    score: c.score,
  };
}

/** The ladder, 5 (quiet) to 1 (surge), as the strip prints it left to right. */
export const LADDER: readonly DropconLevel[] = [5, 4, 3, 2, 1];
