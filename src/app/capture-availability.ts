/**
 * The availability ledger's capture, run by the 15-minute cron after the snapshot (never by a page
 * render). It reuses the capture's dashboard inputs (the full OpenRouter list, the first-party feeds
 * and the Hacker News launch search), polls the cron-only sources, records each source's ids under
 * its own `first_seen` kind, and writes the new ones to the permanent `availability` and
 * `announcements` tables (migration 0003). Then it resolves open announcements against what is now
 * available. See `src/domain/availability.ts` for the rules.
 */
import {
  announcementBatches,
  availabilityBatches,
  AVAILABILITY_TOUCH_MS,
  ledgerWrites,
  resolveAnnouncements,
  type AnnouncementSource,
  type ChatModel,
  type HubRepo,
  type LabPost,
  type LedgerBatch,
} from '../domain/availability';
import type { DashboardInputs, SourceResult } from '../domain/dashboard';
import { LABS, type LabId } from '../domain/lab';
import { AVAILABILITY_SOURCE, hfOrgSource } from '../domain/sources';
import { fetchHfOrg } from '../adapters/huggingface';
import { fetchDeepSeekNews, fetchMetaNewsroom } from '../adapters/lab-feeds';
import { fetchQwenChatModels } from '../adapters/qwen-chat';
import { collect } from '../infra/source-result';
import {
  hasReleaseLedger,
  peekFirstSeen,
  readAvailability,
  readOpenAnnouncements,
  recordFirstSeen,
  updateAnnouncementsUsable,
  upsertAnnouncements,
  upsertAvailability,
  type SnapshotDatabase,
} from '../infra/snapshot-store';

/** The cron-only sources' results. */
export interface AvailabilityPoll {
  qwenChat: SourceResult<ChatModel[]>;
  huggingFace: (SourceResult<HubRepo[]> & { org: string })[];
  posts: (SourceResult<LabPost[]> & { source: AnnouncementSource; labId: LabId })[];
}

/** Every Hugging Face organisation a lab publishes under. */
export const HF_ORGS: readonly string[] = LABS.flatMap((lab) => lab.huggingFaceOrgs);

/** Poll every cron-only source at once, each in its own `collect()`: one failure costs only its kind. */
export async function pollAvailability(): Promise<AvailabilityPoll> {
  const [qwenChat, huggingFace, meta, deepseek] = await Promise.all([
    collect(AVAILABILITY_SOURCE.qwenChat, fetchQwenChatModels, [] as ChatModel[]),
    Promise.all(
      HF_ORGS.map(async (org) => ({
        ...(await collect(hfOrgSource(org), () => fetchHfOrg(org), [] as HubRepo[])),
        org,
      })),
    ),
    collect(AVAILABILITY_SOURCE.metaNewsroom, fetchMetaNewsroom, [] as LabPost[]),
    collect(AVAILABILITY_SOURCE.deepseekNews, fetchDeepSeekNews, [] as LabPost[]),
  ]);
  return {
    qwenChat,
    huggingFace,
    posts: [
      { ...meta, source: 'meta', labId: 'meta' },
      { ...deepseek, source: 'deepseek', labId: 'deepseek' },
    ],
  };
}

/** Ids per source the log line lists; the counts are always whole. */
const MAX_LOGGED_IDS = 20;

/** One source's line in the `[availability]` log. */
export interface AvailabilitySourceLog {
  name: string;
  ok: boolean;
  ms?: number;
  items: number;
  /** Its kind's first capture: every row it wrote is a baseline. */
  seeded?: boolean;
  /** `lab:sku` rows this capture wrote to `availability` or `announcements`, first `MAX_LOGGED_IDS`. */
  newSkus: string[];
  newSkuCount: number;
  /** New ids that named a listing or launch the canonicaliser could not place, first `MAX_LOGGED_IDS`. */
  dropped: string[];
  droppedCount: number;
  error?: string;
}

export interface AvailabilityCaptureLog {
  observedAt: string;
  sources: AvailabilitySourceLog[];
  /** Open announcements marked usable this capture. */
  resolved: number;
  error?: string;
}

export interface CaptureAvailabilityOptions {
  /** The cron-only sources; tests pass a stub. */
  poll?: () => Promise<AvailabilityPoll>;
  now?: () => number;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function sourceLog(result: SourceResult<readonly unknown[]>): AvailabilitySourceLog {
  return {
    name: result.name,
    ok: result.ok,
    ...(result.ms !== undefined ? { ms: result.ms } : {}),
    items: result.data.length,
    newSkus: [],
    newSkuCount: 0,
    dropped: [],
    droppedCount: 0,
    ...(result.error ? { error: result.error } : {}),
  };
}

/**
 * Write the ledger rows of one batch's keys new to its kind, then record the keys in `first_seen`.
 * In that order, so a D1 failure between the two leaves the keys new and the next capture writes
 * the rows again (the tables keep the earliest), instead of recording keys whose rows never landed.
 */
async function recordBatch(
  database: SnapshotDatabase,
  batch: LedgerBatch,
  observedAt: string,
  log: AvailabilitySourceLog | undefined,
): Promise<void> {
  const recorded = await peekFirstSeen(database, batch.kind, batch.items);
  const writes = ledgerWrites(batch, recorded, observedAt);
  const written = [
    ...(await upsertAvailability(database, writes.availability)),
    ...(await upsertAnnouncements(database, writes.announcements)),
  ];
  await recordFirstSeen(database, batch.kind, batch.source, batch.items, observedAt, {
    touchAfterMs: AVAILABILITY_TOUCH_MS,
  });
  if (!log) return;
  if (recorded.seeded) log.seeded = true;
  log.newSkus.push(...written.slice(0, MAX_LOGGED_IDS - log.newSkus.length));
  log.newSkuCount += written.length;
  log.dropped.push(...writes.dropped.slice(0, MAX_LOGGED_IDS - log.dropped.length));
  log.droppedCount += writes.dropped.length;
}

/**
 * One capture of the availability ledger. `inputs` are the dashboard build's source results, so
 * the only fetches here are the cron-only sources. Each batch, and the resolve step, is isolated:
 * a D1 failure costs that kind this capture and nothing else. Logs one `[availability]` line.
 */
export async function captureAvailability(
  database: SnapshotDatabase,
  inputs: DashboardInputs,
  options: CaptureAvailabilityOptions = {},
): Promise<AvailabilityCaptureLog> {
  const poll = await (options.poll ?? pollAvailability)();
  // Stamped once every source has settled, like the snapshot's observedAt.
  const observedAt = new Date((options.now ?? Date.now)()).toISOString();

  const batches = [
    ...availabilityBatches({
      openrouter: inputs.drops,
      qwenChat: poll.qwenChat,
      huggingFace: poll.huggingFace,
    }),
    ...announcementBatches({ feeds: inputs.feeds, launchStories: inputs.launchStories, posts: poll.posts }),
  ];
  const results: SourceResult<readonly unknown[]>[] = [
    inputs.drops,
    poll.qwenChat,
    ...poll.huggingFace,
    ...inputs.feeds,
    ...(inputs.launchStories ? [inputs.launchStories] : []),
    ...poll.posts,
  ];
  const logs = new Map(results.map((r) => [r.name, sourceLog(r)]));
  const summary: AvailabilityCaptureLog = { observedAt, sources: [...logs.values()], resolved: 0 };

  // Without migration 0003, recording the kinds would seed them with no baseline rows behind them.
  if (!(await hasReleaseLedger(database))) {
    summary.error = 'release ledger tables missing (apply migration 0003)';
    console.error('[availability]', summary.error);
    console.log('[availability]', JSON.stringify(summary));
    return summary;
  }

  for (const batch of batches) {
    try {
      await recordBatch(database, batch, observedAt, logs.get(batch.name));
    } catch (e) {
      console.error('[availability]', batch.kind, message(e));
      const log = logs.get(batch.name);
      if (log) log.error = message(e);
    }
  }

  try {
    const open = await readOpenAnnouncements(database);
    const labs = [...new Set(open.map((a) => a.labId))];
    const updates = resolveAnnouncements(open, await readAvailability(database, labs));
    await updateAnnouncementsUsable(database, updates);
    summary.resolved = updates.length;
  } catch (e) {
    summary.error = message(e);
  }
  console.log('[availability]', JSON.stringify(summary));
  return summary;
}
