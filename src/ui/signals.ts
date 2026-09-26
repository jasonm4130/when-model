/**
 * Presentation of the lead signals: per-lab flags, one-sentence track records built from the
 * measured constants, and the sources each panel's pill reads (`sourcePill` in `panels.ts` builds
 * the pill). Pure; safe to unit test.
 */
import {
  ARCHITECTURE_TRACK,
  BROADCAST_TRACK,
  LEAK_TRACK,
  type EarlyWarnings,
} from '../domain/early-warnings';
import { hitRate } from '../domain/lab-events';
import type { LabId } from '../domain/lab';
import { SOURCE } from '../domain/sources';
import { REVEAL_STATS } from '../domain/stealth';

const round1 = (x: number) => Math.round(x * 10) / 10;
/** "a, b and c". */
const andList = (items: readonly string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** One short sentence per signal, every number from its track-record constant. */
export const TRACK_LINES = {
  stealth: `${REVEAL_STATS.all.n} revealed slots listed officially a median ${round1(REVEAL_STATS.all.medianDays)} days later.`,
  leaks: `${LEAK_TRACK.launched} of ${LEAK_TRACK.n} leaks listed within ${LEAK_TRACK.windowDays} days, a median ${round1(LEAK_TRACK.medianLeadDays)} days later (in-sample).`,
  // The misses are part of the record: a stream list without them read as "OpenAI always streams first".
  broadcasts: `Streams went up ahead of ${BROADCAST_TRACK.n} of ${BROADCAST_TRACK.n + BROADCAST_TRACK.openAiMisses.length} OpenAI launches checked, a median ${BROADCAST_TRACK.medianLeadHours} h ahead (${BROADCAST_TRACK.minLeadHours}–${BROADCAST_TRACK.maxLeadHours} h); none before ${andList(BROADCAST_TRACK.openAiMisses)}.`,
  architectures: `Led ${ARCHITECTURE_TRACK.leads} of ${ARCHITECTURE_TRACK.n} dated releases, a median ${ARCHITECTURE_TRACK.medianLeadDays} days ahead (Qwen and Z.ai only).`,
  events: (() => {
    const rate = hitRate();
    return `${rate.hits} of ${rate.total} past keynotes debuted a frontier model.`;
  })(),
} as const;

export interface LeadFlag {
  kind: 'leak' | 'stream' | 'arch' | 'keynote';
  /** Short tag text, e.g. "LEAK ×2" or "STREAM 5H". */
  label: string;
  /** What raised it, for the hover title. */
  detail: string;
  /** The early-warnings subsection that lists it. */
  href: string;
}

const hours = (h: number) => `${Math.max(0, Math.round(h))}H`;
const count = (n: number) => (n > 1 ? ` ×${n}` : '');

/**
 * The lead signals that name this lab: unlisted leaks, scheduled streams, pending architectures
 * and keynote windows. Stealth slots are anonymous by design, so no card ever carries one.
 */
export function leadFlags(w: EarlyWarnings, labId: LabId): LeadFlag[] {
  const flags: LeadFlag[] = [];
  const leaks = w.leaks.items.filter((l) => l.labId === labId);
  if (leaks.length)
    flags.push({
      kind: 'leak',
      label: `LEAK${count(leaks.length)}`,
      detail: leaks.map((l) => `${l.title} (${l.sourceName})`).join('; '),
      href: '#ew-leaks',
    });
  const streams = w.broadcasts.items.filter((b) => b.labId === labId);
  if (streams.length) {
    const next = streams
      .map((b) => b.startsInHours)
      .filter((h): h is number => h !== undefined && h >= 0)
      .sort((a, b) => a - b)[0];
    flags.push({
      kind: 'stream',
      label: `STREAM${next !== undefined ? ` ${hours(next)}` : count(streams.length)}`,
      detail: streams.map((b) => `${b.channel}: ${b.title}`).join('; '),
      href: '#ew-streams',
    });
  }
  const archs = w.architectures.items.filter((a) => a.labId === labId);
  if (archs.length)
    flags.push({
      kind: 'arch',
      label: `ARCH${count(archs.length)}`,
      detail: archs.map((a) => `${a.module}, ${Math.round(a.daysPending)}d pending`).join('; '),
      href: '#ew-arch',
    });
  const events = w.events.items.filter((e) => e.labId === labId);
  if (events.length) {
    const e = events[0];
    flags.push({
      kind: 'keynote',
      label: e.hoursToStart >= 0 ? `KEYNOTE ${hours(e.hoursToStart)}` : 'KEYNOTE LIVE',
      detail: events.map((x) => x.label).join('; '),
      href: '#ew-events',
    });
  }
  return flags;
}

/** The sources each signals panel reads. */
export const EARLY_WARNING_SOURCES = [
  SOURCE.openrouter,
  SOURCE.hnLeaks,
  SOURCE.testingCatalog,
  SOURCE.youtube,
  SOURCE.transformers,
] as const;
/** The labs' own feeds LANDED reads announcements from, named so no check depends on list order. */
export const LANDED_LAB_FEEDS = [SOURCE.openai, SOURCE.deepmind, SOURCE.anthropic, SOURCE.xai] as const;
export const LANDED_SOURCES = [SOURCE.openrouter, SOURCE.hnLaunches, ...LANDED_LAB_FEEDS] as const;

/** "5h ago" / "3d ago" from fractional hours, for rows that carry an age rather than a timestamp. */
export function hoursAgo(h: number): string {
  return h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
}

/** "2.6d" under ten days, whole days above. */
export function daysShort(n: number): string {
  return `${n < 10 ? n.toFixed(1) : Math.round(n)}d`;
}
