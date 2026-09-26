import { describe, expect, it } from 'vitest';
import {
  FLAG_GAP,
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
      'v3 from the 25 Sep 11:00Z hour: 25 hourly readings in these 7 days, scores 40 to 60; latest recorded level 2 (score 60).',
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
    expect(one.summary).toContain(
      'v3 from the 26 Sep 11:00Z hour: 1 hourly reading in these 7 days, score 53;',
    );
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
    expect(inst.changes[0]).toMatchObject({
      dir: 'up',
      hang: 'above',
      from: 4,
      level: 2,
      y: 40,
      side: 'left',
    });
    expect(inst.changes[1]).toMatchObject({
      dir: 'down',
      hang: 'below',
      from: 2,
      level: 4,
      y: 75,
      side: 'left',
    });
    // A see-saw every 30 hours: every change holds and clears the gap, so FLAG_MAX, latest first.
    const saw30 = (i: number) => (Math.floor(i / 30) % 2 ? 60 : 30);
    const slow = buildInstrument(input({ points: series(readings('2026-09-19T12:00:00Z', 168, 3, saw30)) }));
    expect(slow.changes.map((c) => c.text)).toEqual([
      '▲ L2 20 SEP 18:00Z',
      '▼ L4 22 SEP 00:00Z',
      '▲ L2 23 SEP 06:00Z',
      '▼ L4 24 SEP 12:00Z',
      '▲ L2 25 SEP 18:00Z',
    ]);
    expect(slow.changes).toHaveLength(FLAG_MAX);
    // A see-saw every 6 hours: every change holds, but each is within the gap of the next, so
    // they fold together; what is left reads from the week's first level to its last.
    const saw6 = (i: number) => (Math.floor(i / 6) % 2 ? 60 : 30);
    const fast = buildInstrument(input({ points: series(readings('2026-09-19T12:00:00Z', 168, 3, saw6)) }));
    expect(fast.changes.map((c) => [c.from, c.level])).toEqual([[4, 2]]);
    // A change near the left edge puts its flag on the right of the step, inside the plot.
    const early = buildInstrument(
      input({
        points: series(readings('2026-09-19T12:00:00Z', 30, 3, (i) => (i < 12 ? 30 : 60))),
      }),
    );
    expect(early.changes).toHaveLength(1);
    expect(early.changes[0]).toMatchObject({ text: '▲ L2 20 SEP 00:00Z', side: 'right' });
  });
  it('never leaves two flags that contradict: a short excursion under the gap goes with its return', () => {
    // Level 4 (30) to 21 Sep, level 3 (45) after, a 5-hour spell at level 2 (60) on 25 Sep
    // 18:00-23:00 (it holds past FLAG_HOLD_MS but is under FLAG_GAP), then back to level 3.
    const score = (i: number) => {
      const t = Date.parse('2026-09-19T13:00:00Z') + i * HOUR;
      if (t < Date.parse('2026-09-21T00:00:00Z')) return 30;
      if (t >= Date.parse('2026-09-25T18:00:00Z') && t < Date.parse('2026-09-25T23:00:00Z')) return 60;
      return 45;
    };
    const inst = buildInstrument(input({ points: series(readings('2026-09-19T13:00:00Z', 167, 3, score)) }));
    // Not "▲ L3 21 SEP" then "▼ L3 25 SEP": the level-2 spell and its return fold away together.
    expect(inst.changes.map((c) => c.text)).toEqual(['▲ L3 21 SEP 00:00Z']);
  });

  it('folds a change the gap drops into the flag after it, so every flag reads on from the last', () => {
    // L4 to L3 on 20 Sep, L2 on 22 Sep 00:00, L3 at 10:00, L5 on 23 Sep 06:00, L4 at 10:00, L2 on 25 Sep.
    const plan: [string, number][] = [
      ['2026-09-19T12:00:00Z', 30],
      ['2026-09-20T02:00:00Z', 45],
      ['2026-09-22T00:00:00Z', 60],
      ['2026-09-22T10:00:00Z', 45],
      ['2026-09-23T06:00:00Z', 10],
      ['2026-09-23T10:00:00Z', 30],
      ['2026-09-25T11:00:00Z', 60],
    ];
    const score = (i: number) => {
      const t = Date.parse('2026-09-19T12:00:00Z') + i * HOUR;
      return plan.filter(([at]) => Date.parse(at) <= t).at(-1)![1];
    };
    const inst = buildInstrument(input({ points: series(readings('2026-09-19T12:00:00Z', 168, 3, score)) }));
    expect(inst.changes.map((c) => c.text)).toEqual([
      '▲ L3 20 SEP 02:00Z',
      // L3 -> L2 -> L3 -> L5 -> L4 within the gap: one flag where it settled, down from L3 to L4.
      '▼ L4 23 SEP 10:00Z',
      '▲ L2 25 SEP 11:00Z',
    ]);
    // That last step itself rose (L5 to L4), so its flag hangs above the corner, where the line was not.
    expect(inst.changes[1]).toMatchObject({ from: 3, level: 4, dir: 'down', hang: 'above' });
  });

  it('keeps every flag chained to the one before it, whatever the series', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let run = 0; run < 40; run++) {
      const hold = 1 + Math.floor(rand() * 30);
      const scores = Array.from({ length: 168 }, () => 0);
      let s = rand() * 100;
      for (let i = 0; i < 168; i++) {
        if (i % hold === 0) s = Math.min(100, Math.max(0, s + (rand() - 0.5) * 60));
        scores[i] = Math.round(s);
      }
      const inst = buildInstrument(
        input({ points: series(readings('2026-09-19T12:00:00Z', 168, 3, (i) => scores[i])) }),
      );
      expect(inst.changes.length).toBeLessThanOrEqual(FLAG_MAX);
      for (const [i, c] of inst.changes.entries()) {
        expect(c.from).not.toBe(c.level);
        expect(c.dir).toBe(c.level < c.from ? 'up' : 'down');
        const before = inst.changes[i - 1];
        if (!before) continue;
        expect(c.from, `${before.text} then ${c.text}`).toBe(before.level);
        expect(c.x - before.x).toBeGreaterThanOrEqual(FLAG_GAP);
      }
    }
  });

  it('draws only the last 7 days of the 30-day series it is given', () => {
    const month = readings('2026-08-27T12:00:00Z', 30 * 24, 3, () => 50);
    const inst = buildInstrument(input({ points: series(month) }));
    expect(inst.scrub).toHaveLength(168);
    expect(inst.scrub[0].h).toBe(FROM);
    expect(inst.scrub.every((p) => p.e > FROM && p.h < NOW)).toBe(true);
    expect(inst.zones).toEqual([]);
    expect(inst.traces).toHaveLength(1);
    expect(inst.traces[0].line.startsWith('M0 50')).toBe(true);
    expect(inst.summary).toContain('v3 (recorded since 27 Aug): 168 hourly readings in these 7 days');
    expect(inst.summary).not.toContain('Nothing recorded before');
    // The record started before the window: that start, and the current version's, are not in it.
    expect(inst.recordedFrom).toBe('2026-08-27T12:00:00.000Z');
    expect(inst.currentSince).toBe('2026-08-27T12:00:00.000Z');
    expect(inst.current).toMatchObject({ x: 0, young: false });
  });

  it('calls a gap at the left edge a capture gap, not the start of the record, when older readings exist', () => {
    // Captured since 26 Sep; the capture was down 12-14 Oct, across the window's left edge (13 Oct 12:00).
    const now = Date.parse('2026-10-20T12:00:00Z');
    const a = readings('2026-09-26T10:00:00Z', 16 * 24 + 14, 3, () => 50);
    const b = readings('2026-10-14T00:00:00Z', 6 * 24 + 12, 3, () => 50);
    const inst = buildInstrument(input({ now, points: series(a, b) }));
    expect(inst.zones[0]).toMatchObject({ kind: 'unrecorded', x: 0, to: '2026-10-14T00:00:00.000Z' });
    expect(inst.zones[0].start).toBeUndefined();
    expect(inst.recordedFrom).toBe('2026-09-26T10:00:00.000Z');
    expect(inst.current).toMatchObject({ x: 0, young: false });
    expect(inst.summary).not.toContain('14 Oct 00:00Z');
    // Where the record does begin in the window, the leading zone says so.
    const fresh = buildInstrument(input({ points: series(v3) }));
    expect(fresh.zones[0]).toMatchObject({ kind: 'unrecorded', x: 0, start: true });
  });

  it('says when the last reading was, rather than "none yet", when the whole record is older than the window', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    const inst = buildInstrument(
      input({ now, points: series(readings('2026-09-26T10:00:00Z', 120, 3, () => 50)) }),
    );
    expect(inst.state).toBe('empty');
    expect(inst.lastReading).toBe('2026-10-01T09:10:00.000Z');
    expect(inst.summary).toContain('No readings in these 7 days; the last was 1 Oct 09:10Z.');
    expect(inst.summary).not.toContain('recorded yet');
    expect(buildInstrument(input()).lastReading).toBeUndefined();
  });

  it('gives the hour two versions share to the new one, so the old zone never covers the new line', () => {
    const at = (iso: string, algorithmVersion: number, score: number) => ({
      slot: iso,
      observedAt: iso,
      algorithmVersion,
      score,
      level: algorithmVersion === 3 ? (3 as const) : (1 as const),
      degraded: false,
    });
    const inst = buildInstrument(
      input({
        points: series([
          at('2026-09-26T08:46:00.307Z', 2, 93),
          at('2026-09-26T09:01:00.757Z', 2, 93),
          at('2026-09-26T09:16:00.342Z', 2, 88),
          at('2026-09-26T09:31:00.569Z', 3, 53),
        ]),
      }),
    );
    const old = inst.zones.find((z) => z.kind === 'old')!;
    expect(old.to).toBe('2026-09-26T09:00:00.000Z');
    expect(old.x + old.w).toBeCloseTo(inst.current!.x, 6);
    expect(inst.currentSince).toBe('2026-09-26T09:00:00.000Z');
  });
});
