import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('isWithinEventWindow / toEventWindow', () => {
  const start = '2026-09-29T17:00:00Z';

  it('is true from 72h before start through 24h after, inclusive', async () => {
    const { isWithinEventWindow } = await import('../../src/domain/lead');
    expect(isWithinEventWindow(start, new Date('2026-09-26T16:59:00Z'))).toBe(false);
    expect(isWithinEventWindow(start, new Date('2026-09-26T17:00:00Z'))).toBe(true);
    expect(isWithinEventWindow(start, new Date('2026-09-30T17:00:00Z'))).toBe(true);
    expect(isWithinEventWindow(start, new Date('2026-09-30T17:01:00Z'))).toBe(false);
  });

  it('rejects an unparseable start', async () => {
    const { isWithinEventWindow } = await import('../../src/domain/lead');
    expect(isWithinEventWindow('not-a-date', new Date())).toBe(false);
  });

  it('builds the window bounds and signed hoursToStart', async () => {
    const { toEventWindow } = await import('../../src/domain/lead');
    const event = {
      id: 'e1',
      label: 'DevDay 2026',
      labId: 'openai' as const,
      start,
      source: 'https://x.test',
    };
    const w = toEventWindow(event, new Date('2026-09-27T00:00:00Z'));
    expect(w).toEqual({
      id: 'e1',
      label: 'DevDay 2026',
      labId: 'openai',
      start,
      windowStart: '2026-09-26T17:00:00.000Z',
      windowEnd: '2026-09-30T17:00:00.000Z',
      source: 'https://x.test',
      hoursToStart: 65,
    });
  });
});
