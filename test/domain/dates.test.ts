import { describe, expect, it } from 'vitest';
import { dayMonth, monthName, rungLabel, weekdayName } from '../../src/domain/dates';

describe('dates', () => {
  it('spells months and weekdays by hand', () => {
    expect(monthName('2026-09-04T00:00:00Z')).toBe('Sep');
    expect(dayMonth('2026-10-07T12:00:00Z')).toBe('7 Oct');
    expect(weekdayName('2026-10-07T12:00:00Z')).toBe('Wed');
  });

  it("puts a market's rung labels in the site's day-month order", () => {
    expect(rungLabel('October 2')).toBe('2 Oct');
    expect(rungLabel('September 28–October 4')).toBe('28 Sep – 4 Oct');
    expect(rungLabel('Sept. 30')).toBe('30 Sep');
    expect(rungLabel('December 31, 2026')).toBe('31 Dec 2026');
    expect(rungLabel('by June 30th?')).toBe('by 30 Jun?');
    expect(rungLabel('Yes')).toBe('Yes');
    expect(rungLabel('Q4 2026')).toBe('Q4 2026');
  });
});
