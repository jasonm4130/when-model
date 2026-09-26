import { describe, expect, it } from 'vitest';
import {
  FLAG_PITCH,
  FLAG_ROWS,
  FLAG_TOP,
  estimateFlagWidth,
  flagCandidates,
  inside,
  overlaps,
  placeLabels,
  type Box,
} from '../../src/ui/labels';

const box = (left: number, top: number, width: number, height = 18): Box => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});
const PLOT: Box = { left: 0, top: 0, right: 300, bottom: 140 };

describe('plot labels', () => {
  it('treats boxes closer than the gap as overlapping', () => {
    expect(overlaps(box(0, 0, 50), box(52, 0, 50))).toBe(true);
    expect(overlaps(box(0, 0, 50), box(54, 0, 50))).toBe(false);
    expect(overlaps(box(0, 0, 50), box(0, 30, 50))).toBe(false);
    expect(inside(box(-2, 0, 50), PLOT)).toBe(false);
    expect(inside(box(250, 0, 50), PLOT)).toBe(true);
  });

  it('stacks launch names down the rows and drops one that fits nowhere, whole', () => {
    const flags = [10, 40, 70, 100].map((x) => flagCandidates(x, 120, false));
    expect(flags[0]).toHaveLength(FLAG_ROWS);
    expect(flags[0][1].top).toBe(FLAG_TOP + FLAG_PITCH);
    // The direction label holds the top-left corner, so the first name starts a row down.
    const choice = placeLabels(flags, PLOT, [box(0, 0, 60, 20)]);
    expect(choice).toEqual([1, 2, 0, undefined]);
  });

  it('keeps a name that would run off the plot out, and flips one near the right edge inside', () => {
    expect(placeLabels([flagCandidates(250, 120, false)], PLOT)).toEqual([undefined]);
    const flipped = flagCandidates(290, 120, true);
    expect(flipped[0]).toMatchObject({ left: 170, right: 290 });
    expect(placeLabels([flipped], PLOT)).toEqual([0]);
  });

  it('places fixed labels in priority order: a later one that collides is left out', () => {
    expect(placeLabels([[box(0, 100, 100)], [box(50, 100, 100)], [box(160, 100, 100)]], PLOT)).toEqual([
      0,
      undefined,
      0,
    ]);
  });

  it('estimates a VT323 name at about 6.4px a character plus the glyph and padding', () => {
    expect(estimateFlagWidth('✱ Claude Opus 5.5')).toBe(135);
  });
});
