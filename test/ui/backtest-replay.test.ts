import { describe, expect, it } from 'vitest';
import type { Replay } from '../../scripts/backtest/replay';
import { FORECAST_CONSTANTS } from '../../src/domain/forecast';
import {
  labName,
  replayPath,
  replayView,
  utcDay,
  utcMonth,
  utcShortDate,
} from '../../src/ui/backtest-replay';
import replayJson from '../../data/backtest/v3-replay.json';

const replay = replayJson as unknown as Replay;

describe('replay formatting', () => {
  const t = Date.parse('2026-04-01T13:00:00Z');

  it('dates in UTC', () => {
    expect(utcDay(t)).toBe('2026-04-01');
    expect(utcShortDate(t)).toBe('1 Apr');
    expect(utcShortDate(Date.parse('2026-04-12T00:00:00Z'))).toBe('12 Apr');
    expect(utcMonth(t)).toBe('Apr');
  });

  it('names a lab from the registry, or falls back to its id', () => {
    expect(labName('anthropic')).toBe('Anthropic');
    expect(labName('nobody' as never)).toBe('nobody');
  });

  it('draws a series as relative steps in data units, clamped to 0..1', () => {
    expect(replayPath([0.5, 0.25, 1.2, -1])).toBe('M0 1000V500l1 250l1 -750l1 1000V1000');
  });
});

describe('replayView', () => {
  const view = replayView(replay, FORECAST_CONSTANTS);
  const { meta, series } = replay;

  it('reads the window, the split and the headline horizon from the replay', () => {
    expect(view.meta).toBe(meta);
    expect(view.t1).toBe(Date.parse(meta.window.until));
    expect(view.split).toBe(Date.parse(meta.split.at));
    expect(view.last).toBe(series.p.length - 1);
    expect(view.timeAt(0)).toBe(Date.parse(series.from));
    expect(view.timeAt(1) - view.timeAt(0)).toBe(series.stepH * 3_600_000);
    expect(view.h72.horizonHours).toBe(meta.headlineH);
    expect(view.pricedBar).toBe(`≥${Math.round(meta.protocol.pricedMin * 100)}%`);
  });

  it('counts held-out launches and those their own lab priced', () => {
    const heldOut = replay.releases.markers.filter((m) => Date.parse(m.at) > view.split);
    expect(view.heldOut).toHaveLength(heldOut.length);
    expect(view.heldPriced).toBeLessThanOrEqual(view.heldOut.length);
    expect(view.heldPriced).toBe(view.heldOut.filter((l) => l.priced).length);
  });

  it('draws two panels in a wide and a narrow layout, launches stacked into lanes', () => {
    expect(view.panels.map((p) => p.id)).toEqual(['p72', 'lead7']);
    expect(view.views.map((v) => v.name)).toEqual(['wide', 'narrow']);
    for (const v of view.views) {
      expect(v.panels).toHaveLength(2);
      expect(v.marks).toHaveLength(replay.releases.markers.length);
      expect(v.x(Date.parse(series.from))).toBe(v.left);
      expect(v.x(view.t1)).toBe(v.left + v.plotW);
      expect(v.H).toBeGreaterThan(v.stripTop + v.strip);
    }
    for (const m of view.months) expect(new Date(m).getUTCDate()).toBe(1);
  });

  it('names the longest false alarm and summarises the chart', () => {
    expect(view.falseAlarm).not.toBeNull();
    expect(view.alarmDays).toBeGreaterThan(0);
    expect(view.label).toContain(`The forecast held 90% or more for ${view.alarmDays.toFixed(1)} days`);
    expect(view.label).toContain(`Only ${view.heldPriced} of the ${view.heldOut.length} held-out launches`);
  });

  it('has a weekly table twin over the whole series', () => {
    expect(view.weeks[0].from).toBe(Date.parse(series.from));
    expect(view.weeks[0].window).toBe('fit');
    expect(view.weeks.at(-1)!.window).toBe('held out');
    expect(view.weeks.some((w) => w.window === 'fit / held out')).toBe(true);
    const launches = view.weeks.reduce((n, w) => n + w.launches.length, 0);
    expect(launches).toBeLessThanOrEqual(replay.releases.markers.length);
  });

  it('marks a launch unpriced when no priced event matches it, and survives a series with no false alarm', () => {
    const quiet = replayView(
      {
        ...replay,
        series: { ...series, p: series.p.map(() => 0.1) },
        pricedEvents: { ...replay.pricedEvents, events: [] },
        releases: {
          ...replay.releases,
          markers: [{ ...replay.releases.markers[0], models: ['a/one', 'b/two', 'c/three'] }],
        },
      },
      FORECAST_CONSTANTS,
    );
    expect(quiet.falseAlarm).toBeNull();
    expect(quiet.alarmDays).toBe(0);
    expect(quiet.label).not.toContain('The forecast held 90%');
    const [mark] = quiet.views[0].marks;
    expect(mark.priced).toBe(false);
    expect(mark.shown).toBe('one, two +1');
    expect(mark.title).toContain('(not priced ≥');
  });
});
