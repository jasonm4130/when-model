import { describe, expect, it } from 'vitest';
import {
  FLAG_MAX,
  INSTRUMENT_WIDTH,
  INSTRUMENT_WINDOW_MS,
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
    // The live reading is not a scrub point: it answers only at NOW (src/ui/readout.ts).
    expect(inst.scrub.every((p) => p.e > p.h)).toBe(true);
    expect(inst.scrub.at(-1)).toMatchObject({ kind: 'current', h: Date.parse('2026-09-26T11:00:00Z') });
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
    // The v3 callout sits where the line ends (its last reading, score 30), not at the live 53.
    expect(inst.current).toMatchObject({ count: 6, y: 70 });
    expect(inst.now.y).toBe(47);
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
    expect(inst.summary).toContain('1 hourly reading had the odds offline.');
    expect(inst.scrub.find((p) => p.kind === 'outage')?.h).toBe(Date.parse('2026-09-26T08:00:00Z'));
  });

  it('shows a floor at the bottom, unjoined, and leaves the record as it was', () => {
    const inst = buildInstrument(
      input({ points: series(v3), live: { ...live, state: 'floor', score: 0, level: 5 } }),
    );
    expect(inst.now).toMatchObject({ state: 'floor', score: 0, y: 100, joined: false });
    expect(inst.traces[0].line.endsWith(`H${INSTRUMENT_WIDTH}`)).toBe(true);
    expect(inst.scrub).toHaveLength(25);
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

  it('marks launches in the window in their lab colours, and flips labels near NOW', () => {
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
          launch('2026-09-26T10:00:00Z', 'Late'),
          launch('2026-09-01T00:00:00Z', 'Too old', 'qwen'),
          launch('2026-09-26T13:00:00Z', 'In the future', 'qwen'),
        ],
      }),
    );
    expect(inst.launches.map((l) => l.name)).toEqual(['Claude Opus 5.5', 'GPT-6 Sol', 'Late']);
    expect(inst.launches[0]).toMatchObject({
      color: '#ff7a1a',
      glyph: '✱',
      labId: 'anthropic',
      x: x('2026-09-22T16:32:00Z'),
      flip: false,
    });
    expect(inst.launches[2]).toMatchObject({ glyph: '▲', flip: true });
    expect(inst.launchesOk).toBe(true);
    expect(inst.summary).toContain(
      'Frontier launches in the window: Claude Opus 5.5 (Anthropic) 22 Sep 16:32Z;',
    );
  });

  it('says so when the launch listings could not be read, rather than implying none', () => {
    const inst = buildInstrument(input({ launchesOk: false }));
    expect(inst.launchesOk).toBe(false);
    expect(inst.summary).toContain('Launch listings could not be read, so launches are not marked.');
  });

  it("counts the current version's readings and calls a line that starts in the last quarter young", () => {
    const one = buildInstrument(
      input({
        points: series(
          v2,
          readings('2026-09-26T11:00:00Z', 1, 3, () => 53),
        ),
      }),
    );
    expect(one.current).toEqual({ x: x('2026-09-26T11:00:00Z'), count: 1, young: true, y: 47 });
    expect(one.summary).toContain('v3 from 26 Sep 11:00Z: 1 hourly reading, score 53;');
    const week = buildInstrument(
      input({ points: series(readings('2026-09-20T00:00:00Z', 156, 3, () => 50)) }),
    );
    expect(week.current).toMatchObject({ count: 156, young: false });
    expect(buildInstrument(input({ points: series(v2) })).current).toBeUndefined();
  });

  it('flags the level changes that held, latest first, never a one-hour wobble', () => {
    // Level 4 (score 30) to 19 Sep 18:00, up to level 2 (60) for a day, one hour at level 3 (45)
    // that does not hold, back to 2, then down to level 4 (25) from 26 Sep 00:00 to now.
    const score = (i: number) => {
      const t = Date.parse('2026-09-19T12:00:00Z') + i * HOUR;
      if (t < Date.parse('2026-09-21T00:00:00Z')) return 30;
      if (t < Date.parse('2026-09-23T00:00:00Z')) return t === Date.parse('2026-09-22T06:00:00Z') ? 45 : 60;
      if (t < Date.parse('2026-09-26T00:00:00Z')) return 60;
      return 25;
    };
    const inst = buildInstrument(input({ points: series(readings('2026-09-19T12:00:00Z', 168, 3, score)) }));
    expect(inst.changes.map((c) => c.text)).toEqual(['▲ L2 21 SEP 00:00Z', '▼ L4 26 SEP 00:00Z']);
    expect(inst.changes[0]).toMatchObject({ dir: 'up', from: 4, level: 2, y: 40, side: 'left' });
    expect(inst.changes[1]).toMatchObject({ dir: 'down', from: 2, level: 4, y: 75, side: 'left' });
    // A see-saw every 6 hours: every change holds, so the gap rule keeps at most FLAG_MAX, latest first.
    const saw = buildInstrument(
      input({
        points: series(readings('2026-09-19T12:00:00Z', 168, 3, (i) => (Math.floor(i / 6) % 2 ? 60 : 30))),
      }),
    );
    expect(saw.changes.length).toBeLessThanOrEqual(FLAG_MAX);
    expect(saw.changes.at(-1)!.at > saw.changes[0].at).toBe(true);
    for (let i = 1; i < saw.changes.length; i++)
      expect(saw.changes[i].x - saw.changes[i - 1].x).toBeGreaterThanOrEqual(120);
    // A change near the left edge puts its flag on the right of the step, inside the plot.
    const early = buildInstrument(
      input({
        points: series(readings('2026-09-19T12:00:00Z', 30, 3, (i) => (i < 12 ? 30 : 60))),
      }),
    );
    expect(early.changes).toHaveLength(1);
    expect(early.changes[0]).toMatchObject({ text: '▲ L2 20 SEP 00:00Z', side: 'right' });
  });
});
