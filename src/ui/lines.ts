/**
 * Every lab is a line on the network, with a fixed bullet: a letter in a disc of the line's colour.
 * Display only, and identity only: a bullet never changes with a lab's odds, heat or status, so the
 * colour can never be read as a signal. Pure.
 *
 * Letters are the lab's initial where it is free; Meta keeps M, so Mistral takes W (its "wind"),
 * and Moonshot rides as K for its Kimi models. Each bullet's letter colour clears 4.5:1 on its fill
 * (test/ui/lines.test.ts): Anthropic's orange, OpenAI's green and Mistral's red are set a step darker
 * than their brands so a white letter reads; Meta's blue, Z.ai's green and Moonshot's grey are too
 * light for white and carry an ink letter instead.
 */
import type { LabId } from '../domain/lab';
import { PALETTE } from './palette';

export interface LineBullet {
  letter: string;
  /** The disc. */
  fill: string;
  /** The letter, ≥ 4.5:1 on `fill`. */
  ink: string;
}

const WHITE = '#ffffff';
const INK = PALETTE.ink;

export const LINE_BULLETS: Readonly<Record<LabId, LineBullet>> = {
  anthropic: { letter: 'A', fill: '#c8460f', ink: WHITE },
  google: { letter: 'G', fill: '#0039a6', ink: WHITE },
  openai: { letter: 'O', fill: '#00843d', ink: WHITE },
  xai: { letter: 'X', fill: '#141414', ink: WHITE },
  qwen: { letter: 'Q', fill: '#b933ad', ink: WHITE },
  meta: { letter: 'M', fill: '#00a1de', ink: INK },
  zai: { letter: 'Z', fill: '#6cbe45', ink: INK },
  deepseek: { letter: 'D', fill: '#996633', ink: WHITE },
  mistral: { letter: 'W', fill: '#d52b1e', ink: WHITE },
  moonshot: { letter: 'K', fill: '#a7a9ac', ink: INK },
};

/** A lab's bullet; an id outside the registry gets a plain ink disc with its first letter. */
export function lineBullet(id: string): LineBullet {
  return (
    (LINE_BULLETS as Record<string, LineBullet>)[id] ?? {
      letter: (id[0] ?? '?').toUpperCase(),
      fill: INK,
      ink: WHITE,
    }
  );
}

/** "Anthropic line". */
export function lineName(labName: string): string {
  return `${labName} line`;
}

/**
 * The service a market family names, as a departure board would print it: the family without its
 * "Next" and without the version floor in brackets. "Next Claude Haiku (4.6+)" is "Claude Haiku";
 * "Gemini 4.0" and "GPT Astra 6.1+" stay as they are.
 */
export function serviceName(family: string): string {
  const name = family
    .replace(/^\s*next\s+/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
  return name || family.trim();
}
