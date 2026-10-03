import { describe, expect, it } from 'vitest';
import type { Backtest, CrossingRow, ReleaseRow } from '../../scripts/backtest/build';
import {
  WATERFALL_DOMAIN_H,
  WATERFALL_TICKS,
  fitLabel,
  waterfallView,
} from '../../src/ui/backtest-waterfall';
import releaseJson from '../../data/backtest/release-events.json';
import marketsJson from '../../data/backtest/markets.json';

const events = releaseJson as unknown as Backtest['release-events'];
const markets = marketsJson as unknown as Backtest['markets'];

describe('fitLabel', () => {
  it('keeps a name that fits and cuts one that does not, with an ellipsis', () => {
    expect(fitLabel('GPT-6', 100)).toBe('GPT-6');
    // 84 units hold 10 characters at 14px.
    expect(fitLabel('Claude Opus 5.5 Thinking', 84)).toBe('Claude Op…');
    // A cut never leaves a space before the ellipsis.
    expect(fitLabel('Gemini 3 Ultra Pro', 84)).toBe('Gemini 3…');
  });
});

describe('waterfallView', () => {
  const view = waterfallView(events.releases, markets.crossings);
  const announced = events.releases.filter((r) => r.announcedAt);

  it('plots every announced launch, in date order, in a wide and a narrow layout', () => {
    expect(view.views.map((v) => v.name)).toEqual(['wide', 'narrow']);
    for (const v of view.views) {
      expect(v.plotted).toHaveLength(announced.length);
      const times = v.plotted.map((p) => Date.parse(p.release.announcedAt!));
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(v.x(WATERFALL_DOMAIN_H[0])).toBe(v.left);
      expect(v.x(WATERFALL_DOMAIN_H[1])).toBe(v.W - v.right);
      expect(v.H).toBe(v.top + announced.length * v.row + v.bottom);
    }
    expect(view.views[0].ticks).toEqual(WATERFALL_TICKS);
    expect(view.views[1].ticks.map((t) => t.h)).toEqual([-240, -24, 0, 24]);
  });

  it('summarises the chart from the data', () => {
    const primaries = markets.crossings.filter((c) => c.primary).length;
    expect(view.label).toContain(`Lead-time waterfall for ${announced.length} launches`);
    expect(view.label).toContain(`Of ${primaries} launches with a dated market`);
  });

  it('marks crossings, the 50% lead bar, the listing, and says when a launch had no market', () => {
    const marks = view.views[0].plotted.flatMap((p) => p.marks);
    expect(marks.length).toBeGreaterThan(0);
    for (const m of marks) expect(['t50', 't70', 't90']).toContain(m.cls);
    expect(view.views[0].plotted.some((p) => p.bar)).toBe(true);
    expect(view.views[0].plotted.some((p) => p.available)).toBe(true);

    const release = { ...announced[0], id: 'x', model: 'X', availabilityLagH: null } as ReleaseRow;
    const none = waterfallView([release], []);
    expect(none.views[0].plotted[0]).toMatchObject({
      note: 'no market',
      marks: [],
      bar: null,
      available: null,
    });
    const undated = waterfallView(
      [release],
      [{ id: 'x', primary: null, day: null, by: { crossings: [] } } as unknown as CrossingRow],
    );
    expect(undated.views[0].plotted[0].note).toBe('no dated market');
    expect(none.label).toContain('within an hour of the announcement for 0 of 1');
  });
});
