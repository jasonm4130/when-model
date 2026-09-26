import { describe, expect, it } from 'vitest';
import {
  INSTRUMENT_WIDTH,
  INSTRUMENT_WINDOW_MS,
  LAUNCH_LABEL_ROWS,
  buildInstrument,
  type InstrumentInput,
} from '../../src/domain/instrument';
import { readings, series } from '../fixtures/history';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-26T12:00:00Z');
const FROM = NOW - INSTRUMENT_WINDOW_MS;
const x = (iso: string) =>
  Math.round(((Date.parse(iso) - FROM) / INSTRUMENT_WINDOW_MS) * INSTRUMENT_WIDTH * 100) / 100;
const live = { state: 'ok' as const, score: 53, level: 3 as const, at: '2026-09-26T11:55:00Z' };
const input = (overrides: Partial<InstrumentInput> = {}): InstrumentInput => ({
  points: [],
  ok: true,
  now: NOW,
  currentVersion: 3,
  live,
  launches: [],
  ...overrides,
});

// v2 for three days (19 Sep 18:00 to 22 Sep 18:00), then v3 from 25 Sep 11:00 to 26 Sep 12:00.
const v2 = readings('2026-09-19T18:00:00Z', 72, 2, () => 88);
const v3 = readings('2026-09-25T11:00:00Z', 25, 3, (i) => (i < 12 ? 40 : 60));

describe('buildInstrument', () => {
  it('spans the last 7 days, with a tick at every UTC midnight in them', () => {
    const inst = buildInstrument(input({ points: series(v3) }));
    expect(inst.to - inst.from).toBe(7 * 24 * HOUR);
    expect(inst.ticks.map((t) => t.label)).toEqual([
      '20 SEP',
      '21 SEP',
      '22 SEP',
      '23 SEP',
      '24 SEP',
      '25 SEP',
      '26 SEP',
    ]);
    expect(inst.ticks[0].x).toBe(x('2026-09-20T00:00:00Z'));
  });

  it('draws an old version as a hatched zone, never as a line on the level axis', () => {
    const inst = buildInstrument(input({ points: series(v2, v3) }));
    const old = inst.zones.find((z) => z.kind === 'old')!;
    expect(old).toMatchObject({ version: 2, x: x('2026-09-19T18:00:00Z'), from: '2026-09-19T18:00:00.000Z' });
    expect(old.to).toBe('2026-09-22T18:00:00.000Z');
    // Only the v3 stretch is inked: one trace, starting where v3 starts.
    expect(inst.traces).toHaveLength(1);
    expect(inst.traces[0].line.startsWith(`M${x('2026-09-25T11:00:00Z')} 60`)).toBe(true);
    // Before the record, and the three days between v2 and v3, are unrecorded.
    expect(inst.zones.filter((z) => z.kind === 'unrecorded').map((z) => [z.from, z.to])).toEqual([
      [new Date(FROM).toISOString(), '2026-09-19T18:00:00.000Z'],
      ['2026-09-22T18:00:00.000Z', '2026-09-25T11:00:00.000Z'],
    ]);
    expect(inst.summary).toContain(
      'Before that, v2 (old scoring, not comparable, not drawn): 72 hourly readings',
    );
    // The scrubber still has the old numbers, flagged old and without a level.
    expect(inst.scrub.find((p) => p.kind === 'old')).toEqual(
      expect.objectContaining({ score: 88, version: 2 }),
    );
    expect(inst.scrub.find((p) => p.kind === 'old')?.level).toBeUndefined();
  });

  it('runs the line into the live reading, so it ends at the number', () => {
    const inst = buildInstrument(input({ points: series(v3) }));
    expect(inst.now).toEqual({ state: 'ok', score: 53, level: 3, y: 47, joined: true });
    // Step up from 40 to 60 at 25 Sep 23:00, hold to the NOW edge, then step to the live 53.
    expect(inst.traces[0].line).toContain(`H${x('2026-09-25T23:00:00Z')}V40`);
    expect(inst.traces[0].line.endsWith(`H${INSTRUMENT_WIDTH}V47`)).toBe(true);
    expect(inst.traces[0].area.endsWith(`V47V100H${x('2026-09-25T11:00:00Z')}Z`)).toBe(true);
    expect(inst.range).toEqual([40, 60]);
    // The latest reading at least a day old: 25 Sep 11:10.
    expect(inst.dayAgo).toMatchObject({ score: 40, observedAt: '2026-09-25T11:10:00.000Z' });
    expect(inst.scrub.at(-1)).toEqual({
      kind: 'live',
      h: Date.parse(live.at),
      e: Date.parse(live.at),
      score: 53,
      level: 3,
      version: 3,
    });
    expect(inst.summary).toContain(
      'v3 from 25 Sep 11:00Z: 25 hourly readings, scores 40 to 60; latest recorded level 2 (score 60).',
    );
    expect(inst.summary).toContain('Now: level 3, score 53 of 100.');
  });

  it('leaves the NOW dot alone, and marks the gap, when the record stopped well before now', () => {
    const stale = readings('2026-09-25T00:00:00Z', 6, 3, () => 30);
    const inst = buildInstrument(input({ points: series(stale) }));
    expect(inst.now.joined).toBe(false);
    expect(inst.traces[0].line.endsWith(`H${x('2026-09-25T06:00:00Z')}`)).toBe(true);
    expect(inst.zones.at(-1)).toMatchObject({ kind: 'unrecorded', to: new Date(NOW).toISOString() });
  });

  it('breaks the line at a gap in the record and at an outage', () => {
    const early = readings('2026-09-24T00:00:00Z', 4, 3, () => 30);
    const late = readings(
      '2026-09-26T06:00:00Z',
      6,
      3,
      () => 30,
      (i) => i === 2,
    );
    const inst = buildInstrument(input({ points: series(early, late) }));
    expect(inst.traces).toHaveLength(3);
    expect(inst.zones.map((z) => z.kind)).toEqual(['unrecorded', 'unrecorded', 'outage']);
    expect(inst.zones[2]).toMatchObject({ from: '2026-09-26T08:00:00.000Z', to: '2026-09-26T09:00:00.000Z' });
    expect(inst.summary).toContain('1 hourly readings had the odds offline.');
    expect(inst.scrub.find((p) => p.kind === 'outage')?.h).toBe(Date.parse('2026-09-26T08:00:00Z'));
  });

  it('shows a floor at the bottom, unjoined, and ends the scrubber on it as an outage', () => {
    const inst = buildInstrument(
      input({ points: series(v3), live: { ...live, state: 'floor', score: 0, level: 5 } }),
    );
    expect(inst.now).toMatchObject({ state: 'floor', score: 0, y: 100, joined: false });
    expect(inst.scrub.at(-1)).toMatchObject({
      kind: 'outage',
      h: Date.parse(live.at),
      e: Date.parse(live.at),
    });
    expect(inst.summary).toContain('Now: a floor, the odds are offline.');
    const dark = buildInstrument(
      input({ points: series(v3), live: { ...live, state: 'no-signal', score: 0, level: 5 } }),
    );
    expect(dark.scrub.every((p) => p.e > p.h)).toBe(true);
    expect(dark.summary).toContain('Now: no signal.');
  });

  it('says the series is unavailable or empty, and draws nothing', () => {
    const down = buildInstrument(input({ points: series(v3), ok: false }));
    expect(down).toMatchObject({ state: 'unavailable', traces: [], zones: [] });
    expect(down.summary).toContain('The score series could not be read; the level shown is live.');
    const empty = buildInstrument(input());
    expect(empty.state).toBe('empty');
    expect(empty.summary).toContain('No v3 readings recorded yet.');
    expect(empty.recordedFrom).toBeUndefined();
  });

  it('flags a reading whose level hysteresis held away from its own band', () => {
    // 60 (level 2), then a one-slot dip to 52 that neither holds nor clears 55 by 5.
    const wobble = readings('2026-09-26T08:00:00Z', 3, 3, (i) => (i === 1 ? 52 : 60));
    const inst = buildInstrument(input({ points: series(wobble) }));
    const held = inst.scrub.filter((p) => p.held);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ score: 52, level: 2 });
  });

  it('marks launches in the window in their lab colours, stacking close labels in rows', () => {
    const launch = (at: string, name: string, labId?: 'anthropic' | 'openai' | 'qwen' | 'xai') => ({
      at,
      name,
      lab: labId
        ? { anthropic: 'Anthropic', openai: 'OpenAI', qwen: 'Alibaba Qwen', xai: 'xAI' }[labId]
        : 'Unknown',
      ...(labId ? { labId } : {}),
    });
    const inst = buildInstrument(
      input({
        launches: [
          launch('2026-09-22T18:12:00Z', 'GPT-6 Sol', 'openai'),
          launch('2026-09-22T16:32:00Z', 'Claude Opus 5.5', 'anthropic'),
          launch('2026-09-22T20:00:00Z', 'Third', 'qwen'),
          launch('2026-09-22T21:00:00Z', 'Fourth', 'xai'),
          launch('2026-09-26T10:00:00Z', 'Late'),
          launch('2026-09-01T00:00:00Z', 'Too old', 'qwen'),
          launch('2026-09-26T13:00:00Z', 'In the future', 'qwen'),
        ],
      }),
    );
    expect(inst.launches.map((l) => l.name)).toEqual([
      'Claude Opus 5.5',
      'GPT-6 Sol',
      'Third',
      'Fourth',
      'Late',
    ]);
    expect(inst.launches[0]).toMatchObject({
      color: '#ff7a1a',
      glyph: '✱',
      labId: 'anthropic',
      x: x('2026-09-22T16:32:00Z'),
    });
    expect(inst.launches[4]).toMatchObject({ glyph: '▲', flip: true });
    // Three rows: the fourth launch within 36 hours of the other three keeps its mark but no label.
    expect(LAUNCH_LABEL_ROWS).toBe(3);
    expect(inst.launches.map((l) => l.row)).toEqual([0, 1, 2, undefined, 0]);
    expect(inst.summary).toContain(
      'Frontier launches in the window: Claude Opus 5.5 (Anthropic) 22 Sep 16:32Z;',
    );
  });
});
