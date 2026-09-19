import { describe, expect, it } from 'vitest';
import { ago, ctx, pct, usd } from '../src/lib/format';

describe('format', () => {
  const now = Date.parse('2026-09-19T12:00:00Z');
  it('ago', () => {
    expect(ago('2026-09-19T11:59:40Z', now)).toBe('just now');
    expect(ago('2026-09-19T11:30:00Z', now)).toBe('30m ago');
    expect(ago('2026-09-18T12:00:00Z', now)).toBe('1d ago');
    expect(ago('2026-09-25T12:00:00Z', now)).toBe('just now'); // future never goes negative
  });
  it('pct and usd', () => {
    expect(pct(undefined)).toBe('—');
    expect(pct(0.666)).toBe('67%');
    expect(usd(65288)).toBe('$65k');
    expect(usd(2_400_000)).toBe('$2.4M');
  });
  it('ctx', () => {
    expect(ctx(undefined)).toBe('—');
    expect(ctx(262144)).toBe('262k');
    expect(ctx(1_000_000)).toBe('1M');
    expect(ctx(1_048_576)).toBe('1.0M');
  });
});
