import { describe, expect, it } from 'vitest';
import {
  ago,
  ctx,
  daysLabel,
  monthInitials,
  num,
  pct,
  perMillion,
  shortDate,
  usd,
} from '../../src/ui/format';

const now = Date.parse('2026-09-19T12:00:00Z');

describe('format', () => {
  it('ago', () => {
    expect(ago('2026-09-19T11:59:40Z', now)).toBe('just now');
    expect(ago('2026-09-19T11:30:00Z', now)).toBe('30m ago');
    expect(ago('2026-09-19T09:00:00Z', now)).toBe('3h ago');
    expect(ago('2026-09-18T12:00:00Z', now)).toBe('1d ago');
    expect(ago('2026-09-10T12:00:00Z', now)).toBe('9d ago');
    expect(ago('2026-09-25T12:00:00Z', now)).toBe('just now');
  });

  it('pct, usd, num', () => {
    expect(pct(undefined)).toBe('—');
    expect(pct(0.666)).toBe('67%');
    expect(usd(12)).toBe('$12');
    expect(usd(65288)).toBe('$65k');
    expect(usd(2_400_000)).toBe('$2.4M');
    expect(num(999)).toBe('999');
    expect(num(65288)).toBe('65k');
    expect(num(2_400_000)).toBe('2.4M');
  });

  it('ctx', () => {
    expect(ctx(undefined)).toBe('—');
    expect(ctx(0)).toBe('—');
    expect(ctx(262144)).toBe('262k');
    expect(ctx(1_000_000)).toBe('1M');
    expect(ctx(1_048_576)).toBe('1.0M');
  });

  it('shortDate is UTC and upper-case', () => {
    expect(shortDate('2026-09-19T23:30:00Z')).toBe('19 SEPT');
  });

  it('perMillion keeps integer zeros and trims only decimal zeros', () => {
    expect(perMillion(10)).toBe('$10');
    expect(perMillion(50)).toBe('$50');
    expect(perMillion(100)).toBe('$100');
    expect(perMillion(2.5)).toBe('$2.5');
    expect(perMillion(3)).toBe('$3');
    expect(perMillion(0.075)).toBe('$0.075');
    expect(perMillion(0.5)).toBe('$0.5');
  });

  it('daysLabel', () => {
    expect(daysLabel(undefined)).toBe('—');
    expect(daysLabel(0)).toBe('TODAY');
    expect(daysLabel(12)).toBe('12d');
  });

  it('monthInitials ends with the current month', () => {
    expect(monthInitials(new Date('2026-09-19T00:00:00Z'), 3)).toEqual(['J', 'A', 'S']);
    expect(monthInitials(new Date('2026-01-05T00:00:00Z'), 2)).toEqual(['D', 'J']);
  });
});
