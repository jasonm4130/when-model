import { describe, expect, it } from 'vitest';
import { assembleDashboard, type Dashboard, type DashboardInputs } from '../../src/domain/dashboard';
import type { Drop } from '../../src/domain/drop';
import { LEVEL_BANDS } from '../../src/domain/dropcon';
import { INSTRUMENT_WIDTH, LAUNCH_NEAR_MS, type InstrumentZone } from '../../src/domain/instrument';
import { SOURCE } from '../../src/domain/sources';
import { lineBullet } from '../../src/ui/lines';
import {
  SCOPE_BANDS,
  SCOPE_EDGES,
  bandRange,
  scaleLabel,
  scopeView,
  segClass,
  widthPct,
  zoneText,
} from '../../src/ui/scope';
import { readings, series } from '../fixtures/history';

const NOW = Date.parse('2026-09-26T12:00:00Z');

const opus: Drop = {
  id: 'anthropic/claude-opus-5.5',
  name: 'Anthropic: Claude Opus 5.5',
  lab: 'Anthropic',
  labId: 'anthropic',
  createdAt: '2026-09-22T12:00:00Z',
  url: 'https://openrouter.ai/anthropic/claude-opus-5.5',
  free: false,
  textOutput: true,
};

function dashboard(overrides: Partial<DashboardInputs> = {}): Dashboard {
  return assembleDashboard(
    {
      markets: { name: SOURCE.polymarket, data: [], ok: true },
      drops: { name: SOURCE.openrouter, data: [opus], ok: true },
      trending: { name: SOURCE.hfTrending, data: [], ok: true },
      papers: { name: SOURCE.hfPapers, data: [], ok: true },
      feeds: [{ name: SOURCE.hackerNews, data: [], ok: true }],
      ...overrides,
    },
    NOW,
  );
}

describe('the level scale', () => {
  it('runs five bands from 100 to 0 on the DROPCON level edges', () => {
    expect(SCOPE_EDGES).toEqual([100, ...LEVEL_BANDS, 0]);
    expect(SCOPE_BANDS.map((b) => b.level)).toEqual([1, 2, 3, 4, 5]);
    expect(SCOPE_BANDS[0]).toEqual({ level: 1, top: 100, bottom: LEVEL_BANDS[0] });
    expect(SCOPE_BANDS[4].bottom).toBe(0);
  });

  it('names a band by its score range', () => {
    expect(bandRange({ top: 100, bottom: 75 })).toBe('75+');
    expect(bandRange({ top: 60, bottom: 45 })).toBe('45–59');
    expect(bandRange({ top: 15, bottom: 0 })).toBe('below 15');
  });

  it('lights the live level, marks a floor, and dims everything with no signal', () => {
    expect(segClass({ state: 'ok', level: 2 }, 2)).toBe('seg on');
    expect(segClass({ state: 'ok', level: 2 }, 3)).toBe('seg');
    expect(segClass({ state: 'floor', level: 5 }, 5)).toBe('seg dim floor');
    expect(segClass({ state: 'floor', level: 5 }, 4)).toBe('seg dim');
    expect(segClass({ state: 'no-signal', level: 5 }, 5)).toBe('seg dim');
  });

  it('labels the scale for each state', () => {
    expect(scaleLabel({ state: 'ok', level: 3 })).toBe('DROPCON 3 of 5');
    expect(scaleLabel({ state: 'floor', level: 5 })).toBe('DROPCON floor: 5 of 5 with the odds offline');
    expect(scaleLabel({ state: 'no-signal', level: 5 })).toBe('DROPCON: no signal');
  });

  it('places an instrument x as a share of the plot width', () => {
    expect(widthPct(0)).toBe('0%');
    expect(widthPct(INSTRUMENT_WIDTH / 2)).toBe('50%');
  });
});

describe('zone text', () => {
  const zone = (z: Partial<InstrumentZone>): InstrumentZone => ({
    kind: 'unrecorded',
    x: 0,
    w: 10,
    from: '2026-09-19T12:00:00.000Z',
    to: '2026-09-23T00:00:00.000Z',
    ...z,
  });

  it('says an older stretch was another formula', () => {
    expect(zoneText(zone({ kind: 'old', version: 2 }))).toEqual({
      head: 'v2 · OLD SCALE',
      sub: 'another formula, not comparable',
      min: 'v2',
    });
  });

  it('says an outage held the level', () => {
    expect(zoneText(zone({ kind: 'outage' }))).toEqual({
      head: 'ODDS OFFLINE',
      sub: 'level held, not measured',
      min: '✕',
    });
  });

  it('dates the start of the record, or says there were no captures', () => {
    expect(zoneText(zone({ start: true })).sub).toMatch(/^captures start \S/);
    expect(zoneText(zone({}))).toEqual({ head: 'NO RECORD', sub: 'no captures', min: '' });
  });
});

describe('scopeView', () => {
  const v2 = readings('2026-09-23T00:00:00Z', 72, 2, (i) => (i < 24 ? 90 : 64));
  const v3 = readings('2026-09-26T00:00:00Z', 12, 3, (i) => (i < 6 ? 60 : 30));

  it('draws a young current version with a callout and its readings so far', () => {
    const d = dashboard();
    const view = scopeView(d, { ok: true, points: series(v2, v3) }, NOW);
    expect(view.c).toBe(d.dropcon);
    expect(view.ok).toBe(d.dropcon.state === 'ok');
    expect(view.inst.state).toBe('ok');
    expect(view.v3).toBe(view.cur);
    expect(view.readings).toBe(`${view.cur!.count} hourly readings`);
    expect(view.hhmm).toMatch(/^\d\d:\d\dZ$/);
    // The table is the scrubber's hours, newest first.
    expect(view.tableRows).toEqual([...view.inst.scrub].reverse());
  });

  it('hands the scrubber its points, launches and live reading, and starts the readout from them', () => {
    const d = dashboard();
    const view = scopeView(d, { ok: true, points: series(v2, v3) }, NOW);
    expect(view.data.near).toBe(LAUNCH_NEAR_MS);
    expect(view.data.live).toEqual({
      state: d.dropcon.state,
      at: Date.parse(d.generatedAt),
      score: d.dropcon.score,
      level: d.dropcon.level,
    });
    expect(new Set(view.data.pts.map((p) => p[0]))).toEqual(new Set(['o', 'c']));
    const b = lineBullet('anthropic');
    expect(view.data.launches).toEqual(
      view.inst.launches.map((l) => [Date.parse(l.at), l.name, l.lab, b.letter, b.fill]),
    );
    expect(view.data.recordFrom).toBeTypeOf('number');
    // A last reading is named only when the week has none.
    expect(view.data).not.toHaveProperty('last');
    expect(view.rest.when).toBeTruthy();
    // Every launch gets a first-paint row or is left unplaced.
    expect(view.rows).toHaveLength(view.inst.launches.length);
  });

  it('reads a single reading as one', () => {
    const one = readings('2026-09-26T11:00:00Z', 1, 3, () => 90);
    const view = scopeView(dashboard(), { ok: true, points: series(v2, one) }, NOW);
    expect(view.readings).toBe('1 hourly reading');
    expect(view.youngBelow).toBe(view.cur!.y < 58);
  });

  it('names the last reading when the week has none', () => {
    const old = readings('2026-09-10T00:00:00Z', 24, 3, () => 40);
    const view = scopeView(dashboard(), { ok: true, points: series(old) }, NOW);
    expect(view.inst.state).toBe('empty');
    expect(view.data.last).toBe(Date.parse(view.inst.lastReading!));
  });

  it('keeps no version tag when the current version fills the week', () => {
    const week = readings('2026-09-19T00:00:00Z', 7 * 24 + 12, 3, () => 40);
    const view = scopeView(dashboard(), { ok: true, points: series(week) }, NOW);
    expect(view.cur).toBeDefined();
    expect(view.v3).toBeUndefined();
  });

  it('treats a missing history as unreadable, with no current version and nothing in the table', () => {
    const down = dashboard({ drops: { name: SOURCE.openrouter, data: [], ok: false, error: 'down' } });
    const view = scopeView(down, undefined, NOW);
    expect(view.inst.state).toBe('unavailable');
    expect(view.inst.launchesOk).toBe(false);
    expect(view.data.launchesOk).toBe(false);
    expect(view.data).not.toHaveProperty('recordFrom');
    expect(view.data).not.toHaveProperty('last');
    expect(view.cur).toBeUndefined();
    expect(view.readings).toBe('');
    expect(view.hhmm).toBe('');
    expect(view.tableRows).toEqual([]);
  });
});
