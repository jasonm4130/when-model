/**
 * Every DROPCON level's name, 1 (hottest) to 5. Its own module with no imports, so the hero's
 * browser scrubber can name a level without bundling the scoring code.
 */
export const LEVEL_NAMES = {
  1: 'RELEASE SURGE',
  // Named for what it reads: the level reads market odds, never posts (there is no X feed).
  2: 'MARKETS SMELL A DROP',
  3: 'GPU FANS SPINNING',
  4: 'RUMOUR MILL',
  5: 'QUIET ORBIT',
} as const;
