import { describe, expect, it } from 'vitest';
import { EVENTS, activeEventWindows, hitRate } from '../../src/domain/lab-events';

describe('EVENTS', () => {
  it('has unique ids and a verifiable https source for every row', () => {
    const ids = EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of EVENTS) expect(e.source).toMatch(/^https:\/\//);
  });

  it('leaves the upcoming DevDay 2026 row without an outcome', () => {
    const devday2026 = EVENTS.find((e) => e.id === 'devday-2026');
    expect(devday2026).toMatchObject({ start: '2026-09-29T17:00:00Z', source: 'https://devday.openai.com/' });
    expect(devday2026?.outcome).toBeUndefined();
  });
});

describe('hitRate', () => {
  it('computes hits/weak/misses/total from whichever rows carry an outcome, not a hard-coded fraction', () => {
    const rate = hitRate();
    expect(rate.total).toBe(5); // every dated row except the still-upcoming DevDay 2026
    expect(rate.hits + rate.weak + rate.misses).toBe(rate.total);
    expect(rate.rate).toBe((rate.hits + rate.weak * 0.5) / rate.total);
  });

  it('returns a zero rate for an empty table instead of dividing by zero', () => {
    expect(hitRate([])).toEqual({ hits: 0, weak: 0, misses: 0, total: 0, rate: 0 });
  });

  it('treats a custom table on its own terms', () => {
    const table = [
      {
        id: 'a',
        label: 'A',
        labId: 'openai' as const,
        start: '2020-01-01T00:00:00Z',
        source: 'https://x.test',
        outcome: 'hit' as const,
      },
      {
        id: 'b',
        label: 'B',
        labId: 'openai' as const,
        start: '2020-02-01T00:00:00Z',
        source: 'https://x.test',
        outcome: 'miss' as const,
      },
    ];
    expect(hitRate(table)).toEqual({ hits: 1, weak: 0, misses: 1, total: 2, rate: 0.5 });
  });
});

describe('activeEventWindows', () => {
  it('is empty when now falls outside every event window', () => {
    expect(activeEventWindows(new Date('2026-01-01T00:00:00Z'))).toEqual([]);
  });

  it('surfaces DevDay 2026 once now enters its window, with the right bounds', () => {
    const windows = activeEventWindows(new Date('2026-09-27T00:00:00Z'));
    expect(windows).toEqual([
      {
        id: 'devday-2026',
        label: 'OpenAI DevDay 2026',
        labId: 'openai',
        start: '2026-09-29T17:00:00Z',
        windowStart: '2026-09-26T17:00:00.000Z',
        windowEnd: '2026-09-30T17:00:00.000Z',
        source: 'https://devday.openai.com/',
        hoursToStart: 65,
      },
    ]);
  });

  it('drops back out once now passes the window end', () => {
    expect(activeEventWindows(new Date('2026-09-30T17:00:01Z'))).toEqual([]);
  });
});
