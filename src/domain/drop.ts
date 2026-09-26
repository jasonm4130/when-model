import { FRONTIER_LABS, type LabId } from './lab';

/** A model listing on OpenRouter: the closest thing to a public release ledger. */
export interface Drop {
  id: string;
  name: string;
  /** Display name of the lab; falls back to the "Vendor:" name prefix, then the id prefix. */
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
  /** OpenRouter's dated slug, shared by a listing and its `:free` and `:batch` twins. */
  canonicalSlug?: string;
  /** What the model emits, e.g. `['text']` or `['image', 'text']`. */
  outputModalities?: string[];
  /** Emits text only: image, audio and video generators are not language-model releases. */
  textOutput?: boolean;
  /** An anonymous pre-launch slot (see `isStealthSlot`), never attributed to a lab. */
  stealth?: boolean;
  /** Kept for stealth slots only, whose name says nothing about the model. */
  description?: string;
  /** OpenRouter's `hugging_face_id`: the name a pre-release leak used before the listing did. */
  huggingFaceId?: string;
}

/** A listing inside a release event. */
export type ReleaseModel = Pick<Drop, 'id' | 'name' | 'url' | 'createdAt'>;

/** One launch as OpenRouter saw it: a lab's listings close together, twins collapsed. */
export interface ReleaseEvent {
  /** `<lab>@<firstListedAt>`, stable while the listings are. */
  id: string;
  lab: string;
  labId?: LabId;
  /** The lab is one whose releases move DROPCON. */
  frontier: boolean;
  /**
   * OpenRouter `created` of the earliest listing: availability, not announcement. It ran from 14 min
   * to 5.6 h ahead of the first public appearance in the research sample.
   */
  firstListedAt: string;
  /** Oldest first. */
  models: ReleaseModel[];
}

/** Same-lab listings this soon after an event's first listing join it. GPT-6 Sol/Luna listed 4 SKUs in 16 s. */
export const RELEASE_EVENT_WINDOW_MS = 2 * 3_600_000;

/** `:free` twins share the paid listing's canonical slug; older rows without one key by id. */
function twinKey(drop: Drop): string {
  return (drop.canonicalSlug ?? drop.id).replace(/:free$/, '');
}

/**
 * Distinct launches, newest first: listings deduplicated by canonical slug and `:free` twin, then
 * grouped per lab within `RELEASE_EVENT_WINDOW_MS` of the event's first listing. Stealth slots,
 * non-text generators and listings dated after `now` are left out. The window is anchored to the
 * first listing so a busy lab never chains separate launches into one event.
 */
export function releaseEvents(drops: readonly Drop[], now: number): ReleaseEvent[] {
  const listings = new Map<string, Drop>();
  for (const drop of drops) {
    if (drop.stealth || drop.textOutput === false || !(Date.parse(drop.createdAt) <= now)) continue;
    const key = twinKey(drop);
    const twin = listings.get(key);
    if (!twin) {
      listings.set(key, drop);
      continue;
    }
    const keep = twin.id.endsWith(':free') ? drop : twin;
    const earliest = Date.parse(drop.createdAt) < Date.parse(twin.createdAt) ? drop : twin;
    listings.set(key, { ...keep, createdAt: earliest.createdAt });
  }

  const byLab = new Map<string, Drop[]>();
  for (const drop of listings.values()) {
    const lab = drop.labId ?? drop.id.split('/')[0];
    const labDrops = byLab.get(lab);
    if (labDrops) labDrops.push(drop);
    else byLab.set(lab, [drop]);
  }

  const events: ReleaseEvent[] = [];
  for (const [lab, labDrops] of byLab) {
    labDrops.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    let current: ReleaseEvent | undefined;
    for (const drop of labDrops) {
      if (
        !current ||
        Date.parse(drop.createdAt) - Date.parse(current.firstListedAt) > RELEASE_EVENT_WINDOW_MS
      ) {
        current = {
          id: `${lab}@${drop.createdAt}`,
          lab: drop.lab,
          labId: drop.labId,
          frontier: drop.labId !== undefined && FRONTIER_LABS.has(drop.labId),
          firstListedAt: drop.createdAt,
          models: [],
        };
        events.push(current);
      }
      current.models.push({ id: drop.id, name: drop.name, url: drop.url, createdAt: drop.createdAt });
    }
  }
  return events.sort((a, b) => Date.parse(b.firstListedAt) - Date.parse(a.firstListedAt));
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

/**
 * Every drop's OpenRouter id, plus a second row keyed by its Hugging Face id when it has one, so
 * `unlistedLeaks` (feed.ts) matches a leak that only ever named the model that way. Live 2026-09-26:
 * `qwen/qwen3.8-flash` carries `hugging_face_id: "Qwen/Qwen3.8-Flash-Next"`, the exact spelling
 * HN's leak used ("Qwen 3.8-Flash-Next releasing tomorrow"); 177 of 458 live listings carry one.
 */
export function listingAliases(drops: readonly Drop[]): { id: string; name: string }[] {
  const rows: { id: string; name: string }[] = [];
  for (const drop of drops) {
    rows.push({ id: drop.id, name: drop.name });
    if (drop.huggingFaceId) rows.push({ id: drop.huggingFaceId, name: drop.name });
  }
  return rows;
}
