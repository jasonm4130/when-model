/**
 * Early warnings: the lead signals, each shown with its measured track record. None of them moves
 * DROPCON. The calibration replay (data/backtest/v3-replay.json) scored market reads only, so there
 * is no evidence for a weight, and 7 of 12 stealth slots, most pending architectures and every
 * keynote so far were not frontier releases within a week. Pure: `now` is passed in.
 */
import { listingAliases, type Drop } from './drop';
import { LEAK_SOURCE_NAMES, unlistedLeaks, type LeakItem, type LeakSource } from './feed';
import { FRONTIER_LABS } from './lab';
import { EVENTS, activeEventWindows, hitRate } from './lab-events';
import type { BroadcastCandidate, EventWindow, PendingArchitecture } from './lead';
import type { Ledger } from './ledger';
import { REVEAL_STATS, stealthSlots, type StealthSlot } from './stealth';

/** What a signal has done before, in one line, with its sample size. */
export interface TrackRecord {
  summary: string;
  /** Resolved cases behind the numbers. */
  n: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Stealth slots: OpenRouter `created` of the slot to that of the official listing, verified reveals
 * only (src/domain/stealth.ts `REVEAL_STATS`; copy never counts `REVEALS.length`).
 */
export const STEALTH_TRACK: TrackRecord = {
  n: REVEAL_STATS.all.n,
  summary: `${REVEAL_STATS.all.n} revealed slots listed officially a median ${round1(REVEAL_STATS.all.medianDays)} days later; ${REVEAL_STATS.frontier.n} were frontier labs (median ${round1(REVEAL_STATS.frontier.medianDays)} days).`,
};

/**
 * Leak Wire, from the `classifyLeak` comment in src/domain/feed.ts and the labelled stories in
 * test/fixtures/leak-titles-labelled.ts (`LEAK_STORIES`; test/domain/early-warnings.test.ts
 * recomputes it): of 13 resolved, unlisted leaks, 10 were followed by an OpenRouter listing within
 * 14 days, median lead 1.625 days. One story per leak: the GPT-6 "Astra" sighting ran on
 * TestingCatalog and again on HN, and counts once. In-sample: the cues were written against these titles.
 */
export const LEAK_TRACK = {
  n: 13,
  launched: 10,
  precision: 10 / 13,
  medianLeadDays: 1.625,
  windowDays: 14,
} as const;

const LEAK_TRACK_RECORD: TrackRecord = {
  n: LEAK_TRACK.n,
  summary: `${LEAK_TRACK.launched} of ${LEAK_TRACK.n} resolved leaks listed on OpenRouter within ${LEAK_TRACK.windowDays} days (${Math.round(LEAK_TRACK.precision * 100)}%), a median ${round1(LEAK_TRACK.medianLeadDays)} days after the leak; in-sample.`,
};

/**
 * Scheduled broadcasts, from data/backtest/broadcasts.json (Wayback captures of OpenAI watch pages
 * while `isUpcoming`): 5 streams scheduled 2.2 to 44.2 hours ahead, median 4.9; no stream before
 * GPT-5.4, GPT-5.5, GPT-6 Astra or GPT-6 Sol/Luna, and Anthropic and DeepMind uploads trail.
 */
export const BROADCAST_TRACK = {
  n: 5,
  medianLeadHours: 4.9,
  minLeadHours: 2.2,
  maxLeadHours: 44.2,
  /** OpenAI launches checked that had no scheduled stream (broadcasts.json `misses`), named in the copy. */
  openAiMisses: ['GPT-5.4', 'GPT-5.5', 'GPT-6 Astra', 'GPT-6 Sol/Luna'],
} as const;

const BROADCAST_TRACK_RECORD: TrackRecord = {
  n: BROADCAST_TRACK.n,
  summary: `${BROADCAST_TRACK.n} OpenAI launch streams were scheduled ${BROADCAST_TRACK.minLeadHours}–${BROADCAST_TRACK.maxLeadHours} h ahead (median ${BROADCAST_TRACK.medianLeadHours} h); GPT-5.4, GPT-5.5 and both GPT-6 launches had none.`,
};

/**
 * Pending architectures, from data/backtest/architecture.json: of 16 dated merges, 7 led the first
 * HN story (median 166 hours, 6.9 days), 5 were coincident and 4 lagged. Qwen and Z.ai only.
 */
export const ARCHITECTURE_TRACK = { n: 16, leads: 7, coincident: 5, lags: 4, medianLeadDays: 6.9 } as const;

const ARCHITECTURE_TRACK_RECORD: TrackRecord = {
  n: ARCHITECTURE_TRACK.n,
  summary: `Led ${ARCHITECTURE_TRACK.leads} of ${ARCHITECTURE_TRACK.n} dated releases (median ${ARCHITECTURE_TRACK.medianLeadDays} days ahead, Qwen and Z.ai only); ${ARCHITECTURE_TRACK.coincident} coincided and ${ARCHITECTURE_TRACK.lags} lagged.`,
};

function eventTrack(): TrackRecord {
  const rate = hitRate(EVENTS);
  return {
    n: rate.total,
    summary: `${rate.hits} of ${rate.total} past keynotes debuted a frontier model${rate.weak ? ` (${rate.weak} weak)` : ''}. Markets already price known keynotes.`,
  };
}

/** Speech, OCR and vision-only encoder modules are not language-model releases. */
const NON_LLM_MODULE =
  /(?:^|_)(?:asr|ocr\d*|tts|speech\w*|audio\w*|whisper|siglip\d*|clip|vit|dinov\w*|vision_encoder|visual_encoder|encoder|embedding|reranker|tokenizer)(?:_|$)|(?:asr|ocr\d*|tts)$/i;

/** A transformers module name that is a language model, not a speech, OCR or encoder module. */
export function isLanguageModule(module: string): boolean {
  return !NON_LLM_MODULE.test(module);
}

export interface EarlyWarningGroup<T> {
  /** The source behind it produced a complete list this build. Only then is it recorded in the ledger. */
  ok: boolean;
  items: T[];
  track: TrackRecord;
}

export interface LeakWarning extends LeakItem {
  /** Attribution, shown beside the link. */
  sourceName: string;
}

export interface BroadcastWarning extends BroadcastCandidate {
  /** When whenmodel first saw it, from the ledger. */
  firstSeenAt?: string;
  /**
   * Seen on an earlier poll at least 15 minutes before this one (the report's two-poll rule).
   * Undefined when the ledger was unavailable, so only the stateless 60-minute floor applied.
   */
  confirmed?: boolean;
  /** Hours until `scheduledStartTime`; negative once it has started. */
  startsInHours?: number;
}

export interface ArchitectureWarning extends PendingArchitecture {
  frontier: boolean;
}

export interface EarlyWarnings {
  /** Always false: these are displayed with their record, never scored. */
  scored: false;
  stealth: EarlyWarningGroup<StealthSlot>;
  leaks: EarlyWarningGroup<LeakWarning> & {
    /** Per-source health, for attribution and the ledger. */
    sources: { source: LeakSource; ok: boolean }[];
    /** False when OpenRouter was down, so already-listed models could not be dropped. */
    checkedAgainstListings: boolean;
  };
  broadcasts: EarlyWarningGroup<BroadcastWarning>;
  architectures: EarlyWarningGroup<ArchitectureWarning> & { checkedAgainstListings: boolean };
  events: { items: EventWindow[]; track: TrackRecord };
}

interface Result<T> {
  ok: boolean;
  data: T;
}

export interface EarlyWarningInputs {
  drops: Result<readonly Drop[]>;
  leaks: readonly (Result<readonly LeakItem[]> & { source: LeakSource })[];
  broadcasts?: Result<readonly BroadcastCandidate[]>;
  architectures?: Result<readonly PendingArchitecture[]>;
  /** Absent when D1 was unreachable: first-seen gates fall back to their stateless rules. */
  ledger?: Ledger;
}

const MIN_SEEN_AGE_MS = 15 * 60_000;
const HOUR_MS = 3_600_000;

export function buildEarlyWarnings(input: EarlyWarningInputs, now: number): EarlyWarnings {
  const drops = input.drops.data;

  const leakItems = new Map<string, LeakWarning>();
  for (const result of input.leaks) {
    for (const leak of result.data) {
      if (!leakItems.has(leak.url))
        leakItems.set(leak.url, { ...leak, sourceName: LEAK_SOURCE_NAMES[leak.source] });
    }
  }
  const leaks = unlistedLeaks([...leakItems.values()], listingAliases(drops)) as LeakWarning[];
  leaks.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  const seen = input.ledger?.broadcast;
  const broadcasts: BroadcastWarning[] = (input.broadcasts?.data ?? []).map((b) => {
    const firstSeenAt = seen?.get(b.videoId);
    const start = b.scheduledStartTime ? Date.parse(b.scheduledStartTime) : Number.NaN;
    return {
      ...b,
      ...(firstSeenAt ? { firstSeenAt } : {}),
      ...(seen ? { confirmed: !!firstSeenAt && now - Date.parse(firstSeenAt) >= MIN_SEEN_AGE_MS } : {}),
      ...(Number.isFinite(start) ? { startsInHours: Math.round(((start - now) / HOUR_MS) * 10) / 10 } : {}),
    };
  });

  const architectures: ArchitectureWarning[] = (input.architectures?.data ?? [])
    .filter((a) => a.pending && isLanguageModule(a.module))
    .map((a) => ({ ...a, frontier: FRONTIER_LABS.has(a.labId) }))
    .sort((a, b) => Number(b.frontier) - Number(a.frontier) || b.daysPending - a.daysPending);

  return {
    scored: false,
    stealth: {
      ok: input.drops.ok,
      items: stealthSlots(drops, now, input.ledger?.stealth),
      track: STEALTH_TRACK,
    },
    leaks: {
      ok: input.leaks.length > 0 && input.leaks.every((l) => l.ok),
      items: leaks,
      track: LEAK_TRACK_RECORD,
      sources: input.leaks.map((l) => ({ source: l.source, ok: l.ok })),
      checkedAgainstListings: input.drops.ok,
    },
    broadcasts: {
      ok: input.broadcasts?.ok ?? false,
      items: broadcasts,
      track: BROADCAST_TRACK_RECORD,
    },
    architectures: {
      ok: input.architectures?.ok ?? false,
      items: architectures,
      track: ARCHITECTURE_TRACK_RECORD,
      checkedAgainstListings: input.drops.ok,
    },
    events: { items: activeEventWindows(new Date(now)), track: eventTrack() },
  };
}
