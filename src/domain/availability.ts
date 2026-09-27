/**
 * The availability ledger's domain side. A release is a model's first public availability, timed
 * by our own first sighting (docs/release-forecast-2026-09-27.md, decision 1); an announcement
 * with nothing usable yet is "announced, not yet usable", a lead and not a release. Pure: the
 * sources arrive as mapped results, the capture time is passed in, and the D1 statements live in
 * `src/infra/snapshot-store.ts`.
 *
 * Each source's native ids are recorded in `first_seen` under their own kind, so the existing
 * rules hold: a kind is written only when its source answered completely, and its first capture
 * is a baseline. The ids new to a kind are canonicalised to (lab, sku) and written to the
 * permanent `availability` and `announcements` tables, where the earliest sighting across every
 * source wins. Release events are not stored: `releaseEventsFromLedger` derives them from the rows
 * under `RELEASE_DETECTOR_VERSION`.
 */
import type { SourceResult } from './dashboard';
import { RELEASE_EVENT_WINDOW_MS, type Drop } from './drop';
import { isReleaseHeadline, modelIds, type FeedItem, type FeedPrecision, type FeedSource } from './feed';
import { FRONTIER_LABS, labForHost, tierMarks, tierOf, type LabId, type Tier, type TierModel } from './lab';
import { announcementKey } from './landed';
import { announceKind, availKind } from './ledger';
import { canonicalModel, satisfies, skuBase, type CanonicalModel } from './model-id';
import { FEED_SOURCE_NAME } from './sources';

/** Bumped when the rule that turns ledger rows into release events changes. */
export const RELEASE_DETECTOR_VERSION = 1;
/**
 * A new sku whose base first became available less than this long before is the same release (a
 * docs snapshot beside its launch-day alias); later, it is a revision release of its own
 * (deepseek-v4-flash-0731, three months after V4 Flash).
 */
export const REVISION_MIN_DAYS = 30;
/** An announcement still unusable after this long says nothing about next week. */
export const ANNOUNCED_WINDOW_DAYS = 14;
/**
 * Availability kinds bump `last_seen_at` at most this often. About 1,100 keys rewritten every 15
 * minutes, three index entries each, was most of the ledger's D1 writes; only the 90-day prune
 * reads the column for these kinds.
 */
export const AVAILABILITY_TOUCH_MS = 6 * 3_600_000;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * What a sighting says: the model is usable (`availability`), a lab says it is coming or has it
 * listed but switched off (`announcement`), an anonymous OpenRouter slot (`stealth`, a precursor
 * that never forms a release, as in the replay), or a post that names no model (`post`, recorded
 * only so its feed's kind seeds on the first capture).
 */
export type SightingRole = 'availability' | 'announcement' | 'stealth' | 'post';

/** A post's source: a lab's own feed, or a Hacker News launch story linking the lab's own site. */
export type AnnouncementSource = 'openai' | 'deepmind' | 'anthropic' | 'xai' | 'meta' | 'deepseek' | 'hn';

/** The `first_seen` meta of one sighting: what `ledgerWrites` needs to write its rows. */
export interface SightingMeta {
  role: SightingRole;
  /** The listing's display name, or the post's title. */
  name: string;
  labId?: LabId;
  /** Canonical skus: one for a listing, every model a launch post names. Absent when none placed. */
  skus?: string[];
  url?: string;
  publishedAt?: string;
  /** chat.qwen.ai's `is_visitor_active`: usable without signing in. */
  visitorActive?: boolean;
}

export interface LedgerItem {
  key: string;
  meta: SightingMeta;
}

export interface LedgerBatch {
  kind: string;
  /** The health name of the source result behind the batch, for the `[availability]` log. */
  name: string;
  /** The `source` column of every row the batch writes: `openrouter`, `qwen-chat`, `hf:Qwen`, `meta` … */
  source: string;
  items: LedgerItem[];
}

/** One chat.qwen.ai model. `active` false is listed but switched off: announced, not usable. */
export interface ChatModel {
  id: string;
  name: string;
  active: boolean;
  visitorActive?: boolean;
}

/** One public Hugging Face repo from an organisation listing. */
export interface HubRepo {
  id: string;
  /** Absent when the Hub has none: a text model is then judged by its name. */
  pipelineTag?: string;
}

/** One post from a lab's own site. */
export interface LabPost {
  title: string;
  url: string;
  publishedAt: string;
  precision: FeedPrecision;
}

// ─── Sightings ───────────────────────────────────────────────────────────────

function modelMeta(model: CanonicalModel | undefined): Pick<SightingMeta, 'labId' | 'skus'> {
  return model ? { labId: model.labId, skus: [model.sku] } : {};
}

/**
 * Every OpenRouter text listing, keyed by its id without `:free` or `:batch` (one model, one key).
 * The full list, not the 40 the dashboard keeps. Stealth slots are sighted but never placed.
 */
export function openRouterSightings(drops: readonly Drop[]): LedgerItem[] {
  const items = new Map<string, LedgerItem>();
  for (const drop of drops) {
    if (drop.textOutput === false) continue;
    const key = drop.id.replace(/:(?:free|batch)$/, '');
    if (items.has(key)) continue;
    const role: SightingRole = drop.stealth ? 'stealth' : 'availability';
    const model = drop.stealth
      ? undefined
      : canonicalModel(drop.id, { source: 'openrouter', name: drop.name });
    items.set(key, { key, meta: { role, name: drop.name, ...modelMeta(model) } });
  }
  return [...items.values()];
}

/**
 * chat.qwen.ai's model list: an active model is usable, an inactive one is listed but announced
 * only. An inactive model is keyed `<id>#inactive`, so when it is switched on its plain id is new to
 * the kind and becomes an availability row.
 */
export function qwenChatSightings(models: readonly ChatModel[]): LedgerItem[] {
  return models.map((m) => ({
    key: m.active ? m.id : `${m.id}#inactive`,
    meta: {
      role: m.active ? 'availability' : 'announcement',
      name: m.name,
      ...modelMeta(canonicalModel(m.id, { source: 'id', labId: 'qwen', name: m.name })),
      ...(m.visitorActive !== undefined ? { visitorActive: m.visitorActive } : {}),
      ...(m.active ? {} : { url: 'https://chat.qwen.ai/' }),
    },
  }));
}

/**
 * One organisation's public repos. A repo with no pipeline tag counts only when its name is a
 * versioned model: an untagged `SAE-Res-Qwen3-8B-Base-W64K` is a research artefact, not a release.
 */
export function huggingFaceSightings(repos: readonly HubRepo[]): LedgerItem[] {
  return repos.map((repo) => {
    const model = canonicalModel(repo.id, { source: 'huggingface' });
    const placed = model && (repo.pipelineTag !== undefined || !model.unversioned) ? model : undefined;
    return { key: repo.id, meta: { role: 'availability', name: repo.id, ...modelMeta(placed) } };
  });
}

/**
 * A lab's posts, keyed by `announcementKey`. Only a launch-shaped title (`isReleaseHeadline`) whose
 * model ids canonicalise to this lab is an announcement; every other post is kept as a `post` so the
 * feed's kind seeds on its first capture, whatever that day's posts say.
 */
export function postSightings(posts: readonly LabPost[], labId: LabId): LedgerItem[] {
  const items = new Map<string, LedgerItem>();
  for (const post of posts) {
    const key = announcementKey(post.url);
    if (items.has(key)) continue;
    const launch = isReleaseHeadline(post.title);
    const skus = launch
      ? [
          ...new Set(
            modelIds(post.title)
              .map((id) => canonicalModel(id, { source: 'title', labId }))
              .filter((m): m is CanonicalModel => m?.labId === labId)
              .map((m) => m.sku),
          ),
        ]
      : [];
    items.set(key, {
      key,
      meta: {
        role: launch ? 'announcement' : 'post',
        name: post.title,
        url: post.url,
        publishedAt: post.publishedAt,
        ...(launch ? { labId, ...(skus.length ? { skus } : {}) } : {}),
      },
    });
  }
  return [...items.values()];
}

/**
 * Hacker News launch stories. A story is the lab's announcement only when it links the lab's own
 * site (qwen.ai, deepseek.com, ai.meta.com …); every story is kept as a key so the kind seeds.
 */
export function launchStorySightings(stories: readonly FeedItem[]): LedgerItem[] {
  const items = new Map<string, LedgerItem>();
  for (const story of stories) {
    const lab = labForHost(story.url);
    const post: LabPost = {
      title: story.title,
      url: story.url,
      publishedAt: story.publishedAt,
      precision: story.precision ?? 'instant',
    };
    const [item] = lab
      ? postSightings([post], lab.id)
      : [
          {
            key: announcementKey(story.url),
            meta: { role: 'post' as const, name: story.title, url: story.url },
          },
        ];
    if (!items.has(item.key)) items.set(item.key, item);
  }
  return [...items.values()];
}

// ─── Batches ─────────────────────────────────────────────────────────────────

export interface AvailabilityResults {
  openrouter: SourceResult<Drop[]>;
  qwenChat?: SourceResult<ChatModel[]>;
  huggingFace?: readonly (SourceResult<HubRepo[]> & { org: string })[];
}

/**
 * One batch per availability source that answered completely this capture: a source that is not
 * ok gets no batch, so a partial poll never seeds a baseline and never ages a key. Each Hugging
 * Face organisation is its own kind, so one failed org skips only itself.
 */
export function availabilityBatches(results: AvailabilityResults): LedgerBatch[] {
  const batches: LedgerBatch[] = [];
  if (results.openrouter.ok)
    batches.push({
      kind: availKind('openrouter'),
      name: results.openrouter.name,
      source: 'openrouter',
      items: openRouterSightings(results.openrouter.data),
    });
  if (results.qwenChat?.ok)
    batches.push({
      kind: availKind('qwen-chat'),
      name: results.qwenChat.name,
      source: 'qwen-chat',
      items: qwenChatSightings(results.qwenChat.data),
    });
  for (const org of results.huggingFace ?? []) {
    if (!org.ok) continue;
    batches.push({
      kind: availKind(`hf:${org.org}`),
      name: org.name,
      source: `hf:${org.org}`,
      items: huggingFaceSightings(org.data),
    });
  }
  return batches.filter((b) => b.items.length > 0);
}

/** First-party feeds already on the dashboard, and the lab each one speaks for. */
const LAB_FEED_LAB: Partial<Record<FeedSource, LabId>> = {
  openai: 'openai',
  deepmind: 'google',
  anthropic: 'anthropic',
  xai: 'xai',
};

export interface AnnouncementResults {
  /** The dashboard's feed results, reused: GitHub SDKs and the HN feed are not first-party posts. */
  feeds: readonly SourceResult<FeedItem[]>[];
  /** The dashboard's Hacker News launch search. */
  launchStories?: SourceResult<FeedItem[]>;
  /** Cron-only lab sites (Meta's newsroom, DeepSeek's news), each tagged with its lab. */
  posts?: readonly (SourceResult<LabPost[]> & { source: AnnouncementSource; labId: LabId })[];
}

/** One `announce:<feed>` batch per announcing source that answered this capture. */
export function announcementBatches(results: AnnouncementResults): LedgerBatch[] {
  const batches: LedgerBatch[] = [];
  for (const result of results.feeds) {
    const source = (Object.keys(FEED_SOURCE_NAME) as FeedSource[]).find(
      (s) => FEED_SOURCE_NAME[s] === result.name,
    );
    const labId = source && LAB_FEED_LAB[source];
    if (!source || !labId || !result.ok) continue;
    batches.push({
      kind: announceKind(source),
      name: result.name,
      source,
      items: postSightings(
        result.data.map((f) => ({
          title: f.title,
          url: f.url,
          publishedAt: f.publishedAt,
          precision: f.precision ?? 'instant',
        })),
        labId,
      ),
    });
  }
  if (results.launchStories?.ok)
    batches.push({
      kind: announceKind('hn'),
      name: results.launchStories.name,
      source: 'hn',
      items: launchStorySightings(results.launchStories.data),
    });
  for (const posts of results.posts ?? []) {
    if (!posts.ok) continue;
    batches.push({
      kind: announceKind(posts.source),
      name: posts.name,
      source: posts.source,
      items: postSightings(posts.data, posts.labId),
    });
  }
  return batches.filter((b) => b.items.length > 0);
}

// ─── Ledger rows ─────────────────────────────────────────────────────────────

/** One model's first public availability: the earliest sighting across every source. */
export interface AvailabilityRow {
  labId: LabId;
  sku: string;
  name: string;
  firstAvailableAt: string;
  /** The batch source that saw it first: `openrouter`, `qwen-chat`, `hf:Qwen` … */
  source: string;
  /** Its id at that source. */
  sourceKey: string;
  /** Seen on its kind's first capture: available by then, not first available then. */
  baseline: boolean;
  snapshot?: string;
}

/** A lab's announcement of one sku, and when a matching sku became usable. */
export interface AnnouncementRow {
  labId: LabId;
  sku: string;
  firstSeenAt: string;
  source: string;
  url: string;
  title: string;
  publishedAt?: string;
  baseline: boolean;
  usableAt?: string;
  usableSku?: string;
}

export interface LedgerWrites {
  availability: AvailabilityRow[];
  announcements: AnnouncementRow[];
  /** New keys that named a listing or launch we could not place (no lab, no model), for the log. */
  dropped: string[];
}

/**
 * The rows one recorded batch writes. Only keys new to the kind become rows, or every key when this
 * capture seeded the kind, and then as baseline rows. Times are the capture's `observedAt`, stamped
 * after every source settled; the tables' `INSERT OR IGNORE` keeps the earliest sighting of a sku.
 */
export function ledgerWrites(
  batch: LedgerBatch,
  recorded: { newKeys: readonly string[]; seeded: boolean },
  observedAt: string,
): LedgerWrites {
  const fresh = new Set(recorded.newKeys);
  const out: LedgerWrites = { availability: [], announcements: [], dropped: [] };
  for (const { key, meta } of batch.items) {
    if (!recorded.seeded && !fresh.has(key)) continue;
    if (meta.role === 'stealth' || meta.role === 'post') continue;
    if (!meta.labId || !meta.skus?.length) {
      out.dropped.push(key);
      continue;
    }
    for (const sku of meta.skus) {
      if (meta.role === 'availability') {
        const snapshot = sku.split('@')[1];
        out.availability.push({
          labId: meta.labId,
          sku,
          name: meta.name,
          firstAvailableAt: observedAt,
          source: batch.source,
          sourceKey: key,
          baseline: recorded.seeded,
          ...(snapshot ? { snapshot } : {}),
        });
      } else {
        out.announcements.push({
          labId: meta.labId,
          sku,
          firstSeenAt: observedAt,
          source: batch.source,
          url: meta.url ?? key,
          title: meta.name,
          ...(meta.publishedAt ? { publishedAt: meta.publishedAt } : {}),
          baseline: recorded.seeded,
        });
      }
    }
  }
  return out;
}

// ─── Release events ──────────────────────────────────────────────────────────

/** One release as the ledger saw it: a lab's skus first available close together. */
export interface LedgerReleaseEvent {
  /** `<lab>@<firstAvailableAt>`. */
  id: string;
  labId: LabId;
  frontier: boolean;
  tier: Tier;
  /** The tier rules (or `override`) that decided. */
  rules: string[];
  /** The earliest first availability among the skus: the release time. */
  firstAvailableAt: string;
  firstAvailableSource: string;
  /** Oldest first; a snapshot of a base that shipped within `REVISION_MIN_DAYS` is listed with it. */
  skus: string[];
  /** The earliest non-baseline announcement a sku of this release satisfied, when it came first. */
  announcedAt?: string;
  /** Hours from `announcedAt` to `firstAvailableAt`. */
  leadH?: number;
}

type EventRow = Pick<AvailabilityRow, 'labId' | 'sku' | 'firstAvailableAt' | 'source' | 'baseline'>;

function tierModel(row: EventRow): TierModel {
  const [base, snapshot] = row.sku.split('@');
  return { sku: row.sku, base, ...(snapshot ? { snapshot } : {}) };
}

/**
 * Release events from availability rows, newest first. Baseline rows never form an event, but they
 * mark what a lab had shipped for the tier rules and count as old for the revision rule. A new sku
 * whose base (another snapshot, or the base itself) first became available under
 * `REVISION_MIN_DAYS` earlier joins that release; otherwise it is a release of its own. Rows are
 * grouped per lab within `RELEASE_EVENT_WINDOW_MS` of the event's first row, the window drop.ts and
 * the 45-release replay use, anchored so a busy lab never chains launches together. Each sku's time
 * is already its earliest across sources, so a chat.qwen.ai sighting days before OpenRouter sets
 * the release time and the OpenRouter listing adds nothing. Each event is tiered by `tierOf` with
 * the marks of every row before it.
 */
export function releaseEventsFromLedger(
  rows: readonly EventRow[],
  now: number,
  announcements: readonly Pick<AnnouncementRow, 'firstSeenAt' | 'baseline' | 'usableSku'>[] = [],
): LedgerReleaseEvent[] {
  const byLab = new Map<LabId, EventRow[]>();
  for (const row of rows) {
    if (!(Date.parse(row.firstAvailableAt) <= now)) continue;
    const labRows = byLab.get(row.labId);
    if (labRows) labRows.push(row);
    else byLab.set(row.labId, [row]);
  }

  const events: LedgerReleaseEvent[] = [];
  for (const [labId, labRows] of byLab) {
    const t = (r: EventRow) => Date.parse(r.firstAvailableAt);
    labRows.sort((a, b) => t(a) - t(b) || a.sku.localeCompare(b.sku));
    // Per base, the row that last started or joined a release, and that release.
    const lastOfBase = new Map<string, { row: EventRow; group?: EventRow[] }>();
    const groups: EventRow[][] = [];
    for (const row of labRows) {
      const base = skuBase(row.sku);
      const prior = lastOfBase.get(base);
      if (row.baseline) {
        if (!prior) lastOfBase.set(base, { row });
        continue;
      }
      if (prior?.group && t(row) - t(prior.row) < REVISION_MIN_DAYS * DAY_MS) {
        prior.group.push(row);
        continue;
      }
      const current = groups.at(-1);
      if (current && t(row) - t(current[0]) <= RELEASE_EVENT_WINDOW_MS) current.push(row);
      else groups.push([row]);
      lastOfBase.set(base, { row, group: groups.at(-1) });
    }

    // Tier in time order: each event sees the marks of every row before its first.
    const seen = new Set<string>();
    let marked = 0;
    for (const group of groups) {
      const start = t(group[0]);
      for (; marked < labRows.length && t(labRows[marked]) < start; marked++)
        for (const key of tierMarks(labId, tierModel(labRows[marked]))) seen.add(key);
      const { tier, rules } = tierOf(labId, group.map(tierModel), seen);
      const skus = group.map((r) => r.sku);
      const announced = announcements
        .filter(
          (a) =>
            !a.baseline && a.usableSku && skus.includes(a.usableSku) && Date.parse(a.firstSeenAt) <= start,
        )
        .map((a) => a.firstSeenAt)
        .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
      events.push({
        id: `${labId}@${group[0].firstAvailableAt}`,
        labId,
        frontier: FRONTIER_LABS.has(labId),
        tier,
        rules,
        firstAvailableAt: group[0].firstAvailableAt,
        firstAvailableSource: group[0].source,
        skus,
        ...(announced
          ? {
              announcedAt: announced,
              leadH: Math.round(((start - Date.parse(announced)) / HOUR_MS) * 10) / 10,
            }
          : {}),
      });
    }
  }
  return events.sort((a, b) => Date.parse(b.firstAvailableAt) - Date.parse(a.firstAvailableAt));
}

// ─── Announced, not yet usable ───────────────────────────────────────────────

/** An open announcement a sku now satisfies. Generic over the lab id so D1's string rows resolve too. */
export interface AnnouncementUpdate<L extends string = LabId> {
  labId: L;
  sku: string;
  usableAt: string;
  usableSku: string;
}

/**
 * Open announcements that a sku in the same lab now satisfies (`satisfies`: `gpt-6` by
 * `gpt-6-sol`), with the earliest satisfying sku's first availability. An announcement of a model
 * that was already usable resolves to a time before its own sighting: a lagging post, never a lead.
 */
export function resolveAnnouncements<L extends string>(
  open: readonly { labId: L; sku: string; usableAt?: string }[],
  available: readonly { labId: string; sku: string; firstAvailableAt: string }[],
): AnnouncementUpdate<L>[] {
  const updates: AnnouncementUpdate<L>[] = [];
  for (const a of open) {
    if (a.usableAt) continue;
    const match = available
      .filter((row) => row.labId === a.labId && satisfies(a.sku, row.sku))
      .sort(
        (x, y) =>
          Date.parse(x.firstAvailableAt) - Date.parse(y.firstAvailableAt) || x.sku.localeCompare(y.sku),
      )[0];
    if (match)
      updates.push({ labId: a.labId, sku: a.sku, usableAt: match.firstAvailableAt, usableSku: match.sku });
  }
  return updates;
}

export interface AnnouncedWarning {
  labId: LabId;
  sku: string;
  title: string;
  url: string;
  source: string;
  seenAt: string;
  hoursSince: number;
  /** Seen on its feed's first capture: true about the present, but no lead-time evidence. */
  baseline: boolean;
}

/** Announcements still unusable and first seen within `ANNOUNCED_WINDOW_DAYS`, newest first. */
export function announcedNotUsable(rows: readonly AnnouncementRow[], now: number): AnnouncedWarning[] {
  return rows
    .filter((r) => {
      const age = now - Date.parse(r.firstSeenAt);
      return !r.usableAt && age >= 0 && age < ANNOUNCED_WINDOW_DAYS * DAY_MS;
    })
    .sort((a, b) => Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt))
    .map((r) => ({
      labId: r.labId,
      sku: r.sku,
      title: r.title,
      url: r.url,
      source: r.source,
      seenAt: r.firstSeenAt,
      hoursSince: Math.round(((now - Date.parse(r.firstSeenAt)) / HOUR_MS) * 10) / 10,
      baseline: r.baseline,
    }));
}
