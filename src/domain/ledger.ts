/**
 * The first-seen ledger's domain side: which kinds whenmodel records, how D1 sightings become the
 * maps the lead signals read, and which of a capture's items may be recorded at all. Pure; the D1
 * statements live in `src/infra/snapshot-store.ts`.
 *
 * Every row is keyed by sighting time (the capture that first saw the key), never by an upstream
 * timestamp: OpenRouter rewrote space-bunny-alpha's `created` by 28 hours, and date-only feeds pin
 * posts to midnight.
 */
import type { Dashboard } from './dashboard';
import type { FeedSource, LeakSource } from './feed';
import { FEED_SOURCE_NAME, LEAK_SOURCE_RESULT } from './sources';

export const FIRST_SEEN_KIND = {
  stealth: 'stealth',
  broadcast: 'broadcast',
  architecture: 'architecture',
} as const;

const FEED_SOURCES: readonly FeedSource[] = ['hn', 'openai', 'deepmind', 'anthropic', 'github', 'xai'];
const LEAK_SOURCES: readonly LeakSource[] = ['hn', 'testingcatalog'];

/** One kind per leak source, so a source that was down on the first capture never inherits another's baseline. */
export function leakKind(source: LeakSource): string {
  return `leak:${source}`;
}

/** One kind per feed: the sighting time of an item whose source printed only a date. */
export function feedDayKind(source: FeedSource): string {
  return `feed-day:${source}`;
}

/** Every kind the dashboard reads back. */
export const LEDGER_KINDS: readonly string[] = [
  FIRST_SEEN_KIND.stealth,
  FIRST_SEEN_KIND.broadcast,
  FIRST_SEEN_KIND.architecture,
  ...FEED_SOURCES.map(feedDayKind),
];

/** One `first_seen` row as the read side needs it. */
export interface Sighting {
  kind: string;
  key: string;
  firstSeenAt: string;
  /** Recorded as its kind's first-capture baseline: seen by then, not first seen then. */
  seeded: boolean;
}

export interface Ledger {
  /** Stealth slot id → first sighting. */
  stealth: ReadonlyMap<string, string>;
  /** YouTube video id → first sighting (the report's two-poll rule reads it). */
  broadcast: ReadonlyMap<string, string>;
  /** transformers module → first sighting. */
  architecture: ReadonlyMap<string, string>;
  /**
   * Day-precision feed item URL → first sighting, baseline rows excluded: a post already in the
   * feed on the first capture was not first seen then, so it keeps its printed date.
   */
  feedDay: ReadonlyMap<string, string>;
  /** The DROPCON P7 about 24 hours earlier in this algorithm version, for the repricing term. */
  headlineDayAgo?: { p: number; observedAt: string };
}

export const EMPTY_LEDGER: Ledger = {
  stealth: new Map(),
  broadcast: new Map(),
  architecture: new Map(),
  feedDay: new Map(),
};

/** D1 sightings → the maps the lead signals read. */
export function ledgerFromRows(rows: readonly Sighting[], headlineDayAgo?: Ledger['headlineDayAgo']): Ledger {
  const stealth = new Map<string, string>();
  const broadcast = new Map<string, string>();
  const architecture = new Map<string, string>();
  const feedDay = new Map<string, string>();
  const feedKinds = new Set(FEED_SOURCES.map(feedDayKind));
  for (const row of rows) {
    if (row.kind === FIRST_SEEN_KIND.stealth) stealth.set(row.key, row.firstSeenAt);
    else if (row.kind === FIRST_SEEN_KIND.broadcast) broadcast.set(row.key, row.firstSeenAt);
    else if (row.kind === FIRST_SEEN_KIND.architecture) architecture.set(row.key, row.firstSeenAt);
    else if (feedKinds.has(row.kind) && !row.seeded) feedDay.set(row.key, row.firstSeenAt);
  }
  return { stealth, broadcast, architecture, feedDay, ...(headlineDayAgo ? { headlineDayAgo } : {}) };
}

export interface FirstSeenBatch {
  kind: string;
  source: string;
  items: { key: string; meta?: unknown }[];
}

function sourceOk(dashboard: Dashboard, name: string): boolean {
  return dashboard.sources.some((s) => s.name === name && s.ok);
}

/**
 * What one capture may record. A kind is recorded only when the source behind it produced a
 * complete list this capture: a partial list (one YouTube channel down, say) must never seed a
 * baseline, or the missing items would later read as new.
 */
export function firstSeenBatches(dashboard: Dashboard): FirstSeenBatch[] {
  const { stealth, leaks, broadcasts, architectures } = dashboard.earlyWarnings;
  const batches: FirstSeenBatch[] = [];
  if (stealth.ok)
    batches.push({
      kind: FIRST_SEEN_KIND.stealth,
      source: 'openrouter',
      items: stealth.items.map((s) => ({ key: s.id, meta: { name: s.name } })),
    });
  if (broadcasts.ok)
    batches.push({
      kind: FIRST_SEEN_KIND.broadcast,
      source: 'youtube',
      items: broadcasts.items.map((b) => ({
        key: b.videoId,
        meta: { channel: b.channel, title: b.title, publishedAt: b.publishedAt },
      })),
    });
  if (architectures.ok)
    batches.push({
      kind: FIRST_SEEN_KIND.architecture,
      source: 'transformers',
      items: architectures.items.map((a) => ({ key: a.module, meta: { labId: a.labId } })),
    });
  for (const source of LEAK_SOURCES) {
    if (!sourceOk(dashboard, LEAK_SOURCE_RESULT[source])) continue;
    batches.push({
      kind: leakKind(source),
      source,
      items: leaks.items
        .filter((l) => l.source === source)
        .map((l) => ({ key: l.url, meta: { title: l.title, publishedAt: l.publishedAt } })),
    });
  }
  for (const source of FEED_SOURCES) {
    if (!sourceOk(dashboard, FEED_SOURCE_NAME[source])) continue;
    batches.push({
      kind: feedDayKind(source),
      source,
      // The uncapped list landed reads, not the 60-item display feed (review RT-1).
      items: dashboard.feedDay
        .filter((f) => f.source === source)
        .map((f) => ({ key: f.url, meta: { title: f.title, publishedAt: f.publishedAt } })),
    });
  }
  return batches.filter((b) => b.items.length > 0);
}
