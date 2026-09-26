/**
 * Lead signals (report §2 T1-3/T1-4/T1-5): the shared types for scheduled broadcasts, pending
 * architectures and keynote windows, plus the pure keynote-window mapper. Pure: no fetch and no
 * clock; the fetchers live in `src/adapters/youtube.ts` and `src/adapters/transformers-arch.ts`,
 * and every caller passes `now`.
 */
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
