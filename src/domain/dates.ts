/**
 * Month names for every date the page prints, spelled out by hand: ICU writes "Sept" for en-GB, and
 * runtimes differ, so the history strip read "4 Sep" beside a lab card's "22 SEPT". Pure.
 */
export const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** A UTC month's three-letter name, e.g. "Sep". */
export function monthName(ms: number | string | Date): string {
  return MONTHS[new Date(ms).getUTCMonth()];
}

/** "26 Sep", UTC. */
export function dayMonth(ms: number | string | Date): string {
  return `${new Date(ms).getUTCDate()} ${monthName(ms)}`;
}

/** Weekday names, Sunday first as `getUTCDay` counts them, spelled by hand for the same reason. */
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** A UTC weekday's three-letter name, e.g. "Wed". */
export function weekdayName(ms: number | string | Date): string {
  return WEEKDAYS[new Date(ms).getUTCDay()];
}

const MONTH_DAY =
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/gi;

/**
 * A market's rung label in the site's own order: "October 2" → "2 Oct", "September 28–October 4" →
 * "28 Sep – 4 Oct", "December 31, 2026" → "31 Dec 2026". Text that names no month and day is left
 * as the market wrote it.
 */
export function rungLabel(label: string): string {
  return label
    .replace(MONTH_DAY, (_, m: string, day: string, year?: string) => {
      const mon = MONTHS.find((x) => x.toLowerCase() === m.slice(0, 3).toLowerCase()) ?? m;
      return `${Number(day)} ${mon}${year ? ` ${year}` : ''}`;
    })
    .replace(/(\d{1,2} [A-Z][a-z]{2}(?: \d{4})?)\s*[–-]\s*(?=\d{1,2} [A-Z][a-z]{2})/g, '$1 – ');
}
