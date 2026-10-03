/**
 * The /backtest lead-time waterfall (`BacktestWaterfall.astro`): one row per hand-timed launch, its
 * market crossings and its OpenRouter listing on a symlog axis around the announcement, in a wide and
 * a narrow layout. Pure; every value comes from the committed backtest JSON the page passes in.
 */
import type { CrossingRow, ReleaseRow } from '../../scripts/backtest/build';
import { signedHours, symlogScale, utcMinute } from '../../scripts/backtest/view';

/** Hours relative to the announcement: 12 days before to 2 days after. */
export const WATERFALL_DOMAIN_H = [-288, 48] as const;

const THRESHOLD_CLASS: Record<number, string> = { 0.5: 't50', 0.7: 't70', 0.9: 't90' };

export const WATERFALL_TICKS = [
  { h: -240, label: '−10d' },
  { h: -72, label: '−3d' },
  { h: -24, label: '−1d' },
  { h: -6, label: '−6h' },
  { h: 0, label: '0' },
  { h: 6, label: '+6h' },
  { h: 24, label: '+1d' },
  { h: 48, label: '+2d' },
] as const;

/**
 * Two layouts of the same chart: labels beside each row on wide screens, labels above each row
 * on narrow ones, so the phone view needs no sideways scrolling. CSS shows one of them.
 */
const LAYOUTS = [
  {
    name: 'wide',
    W: 1000,
    left: 300,
    right: 24,
    top: 44,
    row: 30,
    bottom: 40,
    labelAbove: false,
    ticks: WATERFALL_TICKS,
  },
  {
    name: 'narrow',
    W: 380,
    left: 14,
    right: 14,
    top: 40,
    row: 46,
    bottom: 36,
    labelAbove: true,
    ticks: WATERFALL_TICKS.filter((t) => [-240, -24, 0, 24].includes(t.h)),
  },
];

/** Label size in chart units (the wide chart draws at about 1:1, so this is --t-sm). */
const LABEL_PX = 14;

/** A name that would not fit its column is cut with an ellipsis; the full name is its title. */
export function fitLabel(name: string, room: number): string {
  const max = Math.floor(room / (LABEL_PX * 0.6));
  return name.length <= max ? name : `${name.slice(0, max - 1).trimEnd()}…`;
}

/** Everything the component draws: both layouts and the chart's accessible summary. */
export function waterfallView(releases: readonly ReleaseRow[], crossings: readonly CrossingRow[]) {
  const [D0, D1] = WATERFALL_DOMAIN_H;
  const rows = [...releases]
    .filter((r) => r.announcedAt)
    .sort((a, b) => Date.parse(a.announcedAt!) - Date.parse(b.announcedAt!));

  const views = LAYOUTS.map((l) => {
    const x = symlogScale(D0, D1, l.left, l.W - l.right);
    const H = l.top + rows.length * l.row + l.bottom;
    const plotted = rows.map((release, i) => {
      const row = crossings.find((c) => c.id === release.id);
      const series = row?.primary ? row[row.primary] : null;
      const marks = (series?.crossings ?? [])
        .filter((c) => c.heldLeadH !== null)
        .map((c) => ({
          cls: THRESHOLD_CLASS[c.threshold],
          cx: x(-c.heldLeadH!),
          open: c.atOpen,
          title: `${release.model}: ${series!.kind === 'day' ? 'day market' : 'cumulative rung'} "${series!.label}" held ${c.threshold} from ${utcMinute(c.heldAt)}, ${signedHours(c.heldLeadH)} relative to the announcement (+ = before)${c.atOpen ? '; already above at its first usable price' : ''}`,
        }));
      const lead50 = series?.crossings.find((c) => c.threshold === 0.5)?.heldLeadH ?? null;
      const top = l.top + i * l.row;
      return {
        release,
        // Market marks sit just above the row's centre line and availability just below it, so a
        // listing at the same moment as a crossing never hides it.
        y: l.labelAbove ? top + l.row - 18 : top + l.row / 2 - 4,
        availY: l.labelAbove ? top + l.row - 7 : top + l.row / 2 + 6,
        labelY: l.labelAbove ? top + 13 : top + l.row / 2 + 5,
        marks,
        bar: lead50 !== null && lead50 > 0 ? { x1: x(-lead50), x2: x(0) } : null,
        note: !row || (!row.day && !row.by) ? 'no market' : !series ? 'no dated market' : null,
        available:
          release.availabilityLagH !== null
            ? {
                cx: x(release.availabilityLagH),
                title: `${release.model}: listed on OpenRouter ${utcMinute(release.availableAt)} (${release.availableId}), ${signedHours(release.availabilityLagH)} after the announcement`,
              }
            : null,
      };
    });
    return { ...l, x, H, plotted };
  });

  const primaries = crossings.filter((c) => c.primary);
  const ahead = (t: number) =>
    primaries.filter((c) => (c[c.primary!]?.crossings.find((k) => k.threshold === t)?.heldLeadH ?? -1) > 0)
      .length;
  const listedClose = rows.filter(
    (r) => r.availabilityLagH !== null && Math.abs(r.availabilityLagH) <= 1,
  ).length;
  const label = `Lead-time waterfall for ${rows.length} launches, on a compressed time axis from 12 days before to 2 days after each first-party announcement. Of ${primaries.length} launches with a dated market, the price held 0.5 before the announcement for ${ahead(0.5)} and held 0.9 before it for ${ahead(0.9)}. OpenRouter listed the model within an hour of the announcement for ${listedClose} of ${rows.length}. The table below has every value.`;

  return { views, label };
}
