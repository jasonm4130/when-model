import { describe, expect, it } from 'vitest';
import { monthlyHistogram, type Drop } from '../src/lib/sources/openrouter';

const drop = (iso: string): Drop => ({ id: 'x', name: 'x', createdAt: iso, url: 'u', free: false });

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
      ],
      12,
      now,
    );
    expect(h).toHaveLength(12);
    expect(h[11]).toBe(2); // September 2026
    expect(h[10]).toBe(1); // August 2026
    expect(h[0]).toBe(1); // October 2025 is the oldest bucket
    expect(h.reduce((a, b) => a + b, 0)).toBe(4); // September 2025 falls off
  });

  it('handles a January boundary', () => {
    const h = monthlyHistogram([drop('2025-12-15T00:00:00Z')], 3, new Date('2026-01-10T00:00:00Z'));
    expect(h).toEqual([0, 1, 0]);
  });
});
