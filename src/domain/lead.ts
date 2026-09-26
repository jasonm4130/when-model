/**
 * WP-5 lead signals: shared types for the three new lead adapters (report §2 T1-3/T1-4/T1-5), plus
 * the two fetch entrypoints a later package wires into the dashboard.
 *
 * These fetchers are the one exception to "domain has no I/O": they exist so the next package can
 * call one function per signal without importing three adapters directly. They do nothing until
 * wired in — this package does not touch `load-dashboard.ts`.
 */
import {
  CHANNELS,
  broadcastCandidates,
  fetchScheduledStartTime,
  fetchYoutubeChannel,
} from '../adapters/youtube';
import {
  BASELINE,
  PENDING_SEED,
  fetchTransformersModules,
  pendingArchitectures,
} from '../adapters/transformers-arch';
import type { LabId } from './lab';

/** A YouTube upload that looks like an unannounced live broadcast (report T1-3). */
export interface BroadcastCandidate {
  videoId: string;
  /** Human channel label, e.g. "OpenAI". */
  channel: string;
  labId: LabId;
  title: string;
  url: string;
  publishedAt: string;
  views: number;
  /** From the optional watch-page probe; absent when it wasn't fetched or found nothing. */
  scheduledStartTime?: string;
}

/** A model architecture merged into `transformers` with no public listing yet (report T1-4). */
export interface PendingArchitecture {
  module: string;
  labId: LabId;
  /** Earliest evidence this module exists, from the best source available (see `sinceSource`). */
  since: string;
  sinceSource: 'seed' | 'first-seen' | 'detected';
  daysPending: number;
  /** False once a listing name matches the module's family — the flag has served its purpose. */
  pending: boolean;
}

/** A keynote-class event's active display window (report T1-5, display only). */
export interface EventWindow {
  id: string;
  label: string;
  labId: LabId;
  /** ISO keynote start time. */
  start: string;
  /** `start` − 72h. */
  windowStart: string;
  /** `start` + 24h. */
  windowEnd: string;
  source: string;
  /** Hours until `start`; negative once the keynote has begun. */
  hoursToStart: number;
}

const WINDOW_BEFORE_MS = 72 * 60 * 60 * 1000;
const WINDOW_AFTER_MS = 24 * 60 * 60 * 1000;

/** True when `now` falls in [start−72h, start+24h]. */
export function isWithinEventWindow(startIso: string, now: Date): boolean {
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return false;
  const nowMs = now.getTime();
  return nowMs >= startMs - WINDOW_BEFORE_MS && nowMs <= startMs + WINDOW_AFTER_MS;
}

/** A static event record → its display window at `now`. Pure. */
export function toEventWindow(
  event: { id: string; label: string; labId: LabId; start: string; source: string },
  now: Date,
): EventWindow {
  const startMs = Date.parse(event.start);
  return {
    id: event.id,
    label: event.label,
    labId: event.labId,
    start: event.start,
    windowStart: new Date(startMs - WINDOW_BEFORE_MS).toISOString(),
    windowEnd: new Date(startMs + WINDOW_AFTER_MS).toISOString(),
    source: event.source,
    hoursToStart: (startMs - now.getTime()) / (60 * 60 * 1000),
  };
}

/**
 * Every lab channel's Atom feed → broadcast candidates. Individual channel failures are logged and
 * skipped (never thrown) unless every channel fails. `firstSeen` and `probeSchedule` are optional
 * so a caller with no D1 state yet can still call this: without `firstSeen`, the two-poll gate in
 * `broadcastCandidates` is skipped and only its stateless 60-minute age floor applies; with
 * `probeSchedule: true`, each candidate's watch page (about 1.2 MB) is fetched, fail-soft, for a
 * `scheduledStartTime`.
 */
export async function fetchBroadcasts(
  now: Date = new Date(),
  options: { firstSeen?: ReadonlyMap<string, string>; probeSchedule?: boolean } = {},
): Promise<BroadcastCandidate[]> {
  const settled = await Promise.allSettled(CHANNELS.map((channel) => fetchYoutubeChannel(channel)));
  const failed = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed.length === settled.length)
    throw new Error(`all ${settled.length} YouTube channels failed: ${failed[0].reason}`);
  for (const f of failed) console.error('[source:YouTube broadcasts]', f.reason);

  const entries = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const candidates = broadcastCandidates(entries, now, options.firstSeen);
  if (!options.probeSchedule || candidates.length === 0) return candidates;

  const withSchedule = await Promise.all(
    candidates.map(async (c) => ({ ...c, scheduledStartTime: await fetchScheduledStartTime(c.videoId) })),
  );
  return withSchedule;
}

/**
 * The transformers module registry → pending architectures. `listings` and `firstSeen` are
 * optional passthroughs to `pendingArchitectures` for a caller that has real OpenRouter/Hugging
 * Face listings and D1 state; without them every novel or seeded module reads as still pending.
 */
export async function fetchArchitectures(
  listings: readonly { id: string; name: string }[] = [],
  now: Date = new Date(),
  firstSeen?: ReadonlyMap<string, string>,
): Promise<PendingArchitecture[]> {
  const modules = await fetchTransformersModules();
  return pendingArchitectures(modules, BASELINE, PENDING_SEED, listings, now, firstSeen);
}
