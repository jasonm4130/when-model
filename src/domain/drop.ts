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
    if (t.getTime() > now.getTime()) continue;
    const monthsAgo = (year - t.getUTCFullYear()) * 12 + (month - t.getUTCMonth());
    const index = months - 1 - monthsAgo;
    if (index >= 0 && index < months) buckets[index]++;
  }
  return buckets;
}

/** Future or invalid timestamps are not evidence of a completed release. */
export function daysSince(iso: string, now: number): number | undefined {
  const age = now - Date.parse(iso);
  return Number.isFinite(age) && age >= 0 ? Math.floor(age / 86_400_000) : undefined;
}

export function withinDays(iso: string, days: number, now: number): boolean {
  const age = now - Date.parse(iso);
  return age >= 0 && age < days * 86_400_000;
}
