import { describe, expect, it } from 'vitest';
import { daysSince, monthlyHistogram, withinDays, type Drop } from '../../src/domain/drop';

const drop = (iso: string): Drop => ({ id: 'x', name: 'x', lab: 'x', createdAt: iso, url: 'u', free: false });

describe('monthlyHistogram', () => {
  it('buckets by UTC month with the current month last', () => {
    const now = new Date('2026-09-19T12:00:00Z');
    const h = monthlyHistogram(
      [
        drop('2026-09-01T00:00:00Z'),
        drop('2026-09-30T23:59:59Z'),
        drop('2026-08-31T23:59:59Z'),
        drop('2025-10-01T00:00:00Z'),
        drop('2025-09-30T00:00:00Z'),
        drop('2027-01-01T00:00:00Z'),
      ],
      12,
      now,
    );
    expect(h).toHaveLength(12);
    expect(h[11]).toBe(1);
    expect(h[10]).toBe(1);
    expect(h[0]).toBe(1);
    expect(h.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('handles a January boundary', () => {
    const h = monthlyHistogram([drop('2025-12-15T00:00:00Z')], 3, new Date('2026-01-10T00:00:00Z'));
    expect(h).toEqual([0, 1, 0]);
  });
});

describe('time helpers', () => {
  const now = Date.parse('2026-09-19T12:00:00Z');
  it('daysSince floors to whole days', () => {
    expect(daysSince('2026-09-19T01:00:00Z', now)).toBe(0);
    expect(daysSince('2026-09-17T13:00:00Z', now)).toBe(1);
  });
  it('withinDays is exclusive at the boundary', () => {
    expect(withinDays('2026-09-13T12:00:01Z', 6, now)).toBe(true);
    expect(withinDays('2026-09-13T12:00:00Z', 6, now)).toBe(false);
  });
  it('does not count future or invalid timestamps as past releases', () => {
    for (const iso of ['2026-09-19T12:00:01Z', '2026-09-20T12:00:00Z', 'invalid']) {
      expect(withinDays(iso, 7, now)).toBe(false);
      expect(daysSince(iso, now)).toBeUndefined();
    }
    expect(withinDays(new Date(now).toISOString(), 7, now)).toBe(true);
    expect(daysSince(new Date(now).toISOString(), now)).toBe(0);
  });
});
