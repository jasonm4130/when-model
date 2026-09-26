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
