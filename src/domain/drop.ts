import type { LabId } from './lab';

/** A model listing on OpenRouter: the closest thing to a public release ledger. */
export interface Drop {
  id: string;
  name: string;
  /** Display name of the lab; falls back to the OpenRouter vendor prefix. */
  lab: string;
  labId?: LabId;
  createdAt: string;
  context?: number;
  /** USD per million tokens. */
  promptPerM?: number;
  completionPerM?: number;
  modality?: string;
  url: string;
  free: boolean;
}

/** Drops per calendar month (UTC) for the last `months`, oldest first, current month last. */
export function monthlyHistogram(drops: readonly Drop[], months: number, now: Date): number[] {
  const buckets = Array.from({ length: months }, () => 0);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  for (const drop of drops) {
    const t = new Date(drop.createdAt);
    const monthsAgo = (year - t.getUTCFullYear()) * 12 + (month - t.getUTCMonth());
    const index = months - 1 - monthsAgo;
    if (index >= 0 && index < months) buckets[index]++;
  }
  return buckets;
}

export function daysSince(iso: string, now: number): number {
  return Math.floor((now - Date.parse(iso)) / 86_400_000);
}

export function withinDays(iso: string, days: number, now: number): boolean {
  return now - Date.parse(iso) < days * 86_400_000;
}
