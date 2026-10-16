/**
 * Label placement for the DROPCON instrument's plot, shared by the server render (estimated
 * widths on a reference plot) and the browser (measured boxes on the real one). Pure: boxes in,
 * choices out. No DOM.
 *
 * Labels are placed in priority order. Each has one or more candidate boxes (a launch name has
 * one per row); it takes the first candidate that stays inside the plot and clears every label
 * already placed, or is left out. A label is never clipped mid-word: it shows whole or not at all.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Room kept between two labels, in the boxes' units. */
export const LABEL_GAP = 3;

export function overlaps(a: Box, b: Box, gap = LABEL_GAP): boolean {
  return a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
}

export function inside(box: Box, bounds: Box): boolean {
  return (
    box.left >= bounds.left - 0.5 &&
    box.right <= bounds.right + 0.5 &&
    box.top >= bounds.top - 0.5 &&
    box.bottom <= bounds.bottom + 0.5
  );
}

/**
 * For each label, in priority order, the index of the candidate box it takes, or undefined when
 * none fits. `taken` holds boxes already on the plot that every label must clear.
 */
export function placeLabels(
  labels: readonly (readonly Box[])[],
  bounds: Box,
  taken: readonly Box[] = [],
): (number | undefined)[] {
  const kept = [...taken];
  return labels.map((candidates) => {
    const i = candidates.findIndex((b) => inside(b, bounds) && !kept.some((k) => overlaps(k, b)));
    if (i === -1) return undefined;
    kept.push(candidates[i]);
    return i;
  });
}

/** The rows a launch name can sit in, stacked down from the plot's top edge. */
export const FLAG_ROWS = 3;
/** Top of the first row, and the pitch between rows, in CSS pixels. */
export const FLAG_TOP = 6;
export const FLAG_PITCH = 22;
export const FLAG_HEIGHT = 18;

/**
 * A launch name's candidate boxes, one per row: it hangs right of its line, or left of it when
 * `flip` (near the NOW edge), `width` wide.
 */
export function flagCandidates(x: number, width: number, flip: boolean): Box[] {
  const left = flip ? x - width : x;
  return Array.from({ length: FLAG_ROWS }, (_, row) => ({
    left,
    right: left + width,
    top: FLAG_TOP + row * FLAG_PITCH,
    bottom: FLAG_TOP + row * FLAG_PITCH + FLAG_HEIGHT,
  }));
}

/**
 * A server-side guess at a label's width in CSS pixels, for the first paint and for pages without
 * the script: VT323 at the plot's 16px advances about 6.4px a character, plus the glyph and padding.
 * The browser measures the real width and places the labels again.
 */
export function estimateFlagWidth(text: string): number {
  return Math.ceil(text.length * 6.4 + 26);
}
