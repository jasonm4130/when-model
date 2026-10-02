/**
 * The transit palette, one job per colour. `src/styles/global.css` declares the same values as CSS
 * tokens (test/ui/palette.test.ts holds the two together), so the contrast tests read real numbers.
 *
 * - paper, ink, ink-2: the page and its words. ink-2 is the quiet line, still 7.9:1 on paper.
 * - sign, sign-ink, sign-ink-2: the black station sign and the type on it.
 * - notice: the yellow of service status and service notices, and nothing else.
 * A level-1 surge is the sign black with the notice yellow's platform-edge stripe: no status colour
 * may be mistaken for a line's.
 * - rule-soft: hairlines between rows.
 * Line colours (identity, never status) live with the bullets in `lines.ts`.
 */
export const PALETTE = {
  paper: '#f4f2ec',
  'paper-2': '#ebe8df',
  ink: '#111111',
  'ink-2': '#4a4a4a',
  'rule-soft': '#d9d5cb',
  sign: '#141414',
  'sign-ink': '#ffffff',
  'sign-ink-2': '#b8b8b8',
  notice: '#fccc0a',
} as const;

export type PaletteToken = keyof typeof PALETTE;
