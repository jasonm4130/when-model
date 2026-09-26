/** Bounded D1 persistence for scheduled observations; it has no read endpoint. */

export const SNAPSHOT_INTERVAL_MS = 15 * 60_000;
export const RETENTION_MS = 90 * 24 * 60 * 60_000;
export const MAX_SNAPSHOT_BYTES = 32 * 1024;
export const MAX_SNAPSHOT_ROWS = 90 * 24 * 4;
export const MAX_TOTAL_PAYLOAD_BYTES = 128 * 1024 * 1024;
export const MAX_CLEANUP_ROWS = 96;
export const MAX_FIRST_SEEN_ROWS = 20_000;
export const MAX_FIRST_SEEN_CLEANUP_ROWS = 200;

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<{ meta: { changes?: number } }>;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}

export interface SnapshotDatabase {
  prepare(query: string): D1Statement;
}

type OddsReadLike = { p: number; trusted: boolean };

type DashboardLike = {
  generatedAt: string;
  measurement?: unknown;
  dropcon?: unknown;
  labs: Array<{
    id: string;
    heat: number;
    status: string;
    odds?: { family: string; p72: OddsReadLike; p7: OddsReadLike; p30: OddsReadLike };
    latest?: { id: string; name: string; createdAt: string };
  }>;
  drops: Array<{ id: string; name: string; labId?: string; createdAt: string; url: string }>;
  sources: Array<{ name: string; ok: boolean; error?: string }>;
};

/**
 * Most bytes any one string may take in the snapshot JSON, quotes and escapes included. Every
 * string is upstream-shaped (model names, market labels, error messages), so clipping by encoded
 * size is what makes the 32 KiB cap a bound rather than a hope: test/infra/snapshot-store.test.ts
 * builds the worst case (every list at its limit, every string multi-byte and over-long).
 */
export const MAX_SNAPSHOT_STRING_BYTES = 128;

export interface CompactSnapshot {
  generatedAt: string;
  measurement: unknown | null;
  dropcon: unknown | null;
  labs: Array<Record<string, unknown>>;
  drops: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
}

export interface StoreSnapshotInput {
  scheduledSlot: string;
  observedAt: string;
  dashboard: DashboardLike;
  /** Tests supply a fixed clock; production may omit it. */
  now?: number;
}

type Capacity = { row_count: number; total_payload_bytes: number };

function timestamp(value: string, field: string): number {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be an ISO timestamp`);
  if (new Date(parsed).toISOString() !== value) throw new Error(`${field} must be a canonical ISO timestamp`);
  return parsed;
}

function pick(object: object, fields: string[]): Record<string, unknown> {
  const values = object as Record<string, unknown>;
  return Object.fromEntries(fields.map((field) => [field, values[field] ?? null]));
}

/** Bytes a code point takes inside a JSON string literal. */
function jsonBytes(codePoint: number): number {
  if (codePoint === 0x22 || codePoint === 0x5c) return 2;
  // Control characters and lone surrogates are written as \uXXXX.
  if (codePoint < 0x20 || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return 6;
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  return codePoint < 0x10000 ? 3 : 4;
}

/** A string whose JSON encoding fits `MAX_SNAPSHOT_STRING_BYTES`, ending in "…" when clipped. */
export function clipString(value: string): string {
  const budget = MAX_SNAPSHOT_STRING_BYTES - 2;
  let used = 0;
  for (const ch of value) used += jsonBytes(ch.codePointAt(0)!);
  if (used <= budget) return value;
  let out = '';
  used = 3; // the ellipsis
  for (const ch of value) {
    const size = jsonBytes(ch.codePointAt(0)!);
    if (used + size > budget) break;
    out += ch;
    used += size;
  }
  return `${out}…`;
}

/** Every string clipped by `clipString`, recursively; other values unchanged. */
function clipStrings(value: unknown): unknown {
  if (typeof value === 'string') return clipString(value);
  if (Array.isArray(value)) return value.map(clipStrings);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clipStrings(v)]));
  return value;
}

/**
 * The level and the arithmetic behind it. The blurb, notes and base-rate line are fixed copy for a
 * level and algorithm version, so they are not stored with every slot.
 */
function compactDropcon(dropcon: unknown): unknown {
  if (!dropcon || typeof dropcon !== 'object') return null;
  const d = dropcon as Record<string, unknown>;
  return {
    ...pick(d, ['level', 'name', 'score', 'state', 'degraded', 'headline']),
    ...(Array.isArray(d.provenance)
      ? { provenance: d.provenance.map((row: object) => pick(row, ['term', 'points', 'detail'])) }
      : {}),
  };
}

/** The listing URL `toDrop` (src/adapters/openrouter.ts) builds from an OpenRouter id. */
function openRouterUrl(id: string): string {
  return `https://openrouter.ai/${String(id).split('/').map(encodeURIComponent).join('/')}`;
}

const oddsRead = (read: OddsReadLike | undefined) =>
  read ? { p: Math.round(read.p * 10_000) / 10_000, trusted: read.trusted } : null;

/**
 * Projects only collected values. It never derives or recomputes a release signal. A lab's odds
 * keep the family and each horizon's probability and trust flag; the brackets are on the page and
 * derivable from the markets, so they are left out to keep the row small.
 */
export function compactSnapshot(dashboard: DashboardLike): CompactSnapshot {
  timestamp(dashboard.generatedAt, 'dashboard.generatedAt');
  return clipStrings({
    generatedAt: dashboard.generatedAt,
    measurement: dashboard.measurement ?? null,
    dropcon: compactDropcon(dashboard.dropcon),
    labs: dashboard.labs.map((lab) => ({
      ...pick(lab, ['id', 'heat', 'status']),
      odds: lab.odds
        ? {
            family: lab.odds.family,
            p72: oddsRead(lab.odds.p72),
            p7: oddsRead(lab.odds.p7),
            p30: oddsRead(lab.odds.p30),
          }
        : null,
      latest:
        lab.latest && typeof lab.latest === 'object' ? pick(lab.latest, ['id', 'name', 'createdAt']) : null,
    })),
    drops: dashboard.drops.map((drop) => ({
      ...pick(drop, ['id', 'name', 'labId', 'createdAt']),
      // An OpenRouter listing's URL is its id under openrouter.ai; only a different one is kept.
      ...(drop.url !== openRouterUrl(drop.id) ? { url: drop.url ?? null } : {}),
    })),
    sources: dashboard.sources.map((source) => pick(source, ['name', 'ok', 'error'])),
  }) as CompactSnapshot;
}

export function snapshotPayload(dashboard: DashboardLike): { json: string; byteCount: number } {
  const json = JSON.stringify(compactSnapshot(dashboard));
  const byteCount = new TextEncoder().encode(json).byteLength;
  if (byteCount > MAX_SNAPSHOT_BYTES) {
    throw new Error(`snapshot payload exceeds ${MAX_SNAPSHOT_BYTES} byte cap`);
  }
  return { json, byteCount };
}

/**
 * Deletes at most one day of stale slots, keeping scheduled work bounded. Retention is by
 * scheduled slot, not observation time: 90 days of slots is exactly the 8,640-row cap, so
 * the slot 90 days before this one must go first. Pruning by `observed_at` kept it
 * whenever this capture ran as soon after its slot as that one did, and from day 90 on
 * those writes failed the capacity check.
 */
export async function cleanupSnapshots(database: SnapshotDatabase, observedAt: string): Promise<void> {
  const cutoff = new Date(timestamp(observedAt, 'observedAt') - RETENTION_MS).toISOString();
  await database
    .prepare(
      'DELETE FROM dashboard_snapshots WHERE scheduled_slot IN (SELECT scheduled_slot FROM dashboard_snapshots WHERE scheduled_slot <= ? ORDER BY scheduled_slot LIMIT ?)',
    )
    .bind(cutoff, MAX_CLEANUP_ROWS)
    .run();
}

async function capacity(database: SnapshotDatabase): Promise<Capacity> {
  const state = await database
    .prepare('SELECT row_count, total_payload_bytes FROM snapshot_store_metadata WHERE id = 1')
    .first<Capacity>();
  if (!state) throw new Error('snapshot store metadata is missing');
  return state;
}

async function slotExists(database: SnapshotDatabase, scheduledSlot: string): Promise<boolean> {
  const row = await database
    .prepare('SELECT 1 AS present FROM dashboard_snapshots WHERE scheduled_slot = ?')
    .bind(scheduledSlot)
    .first<{ present: number }>();
  return row?.present === 1;
}

/**
 * Writes one slot at most once. SQL checks cached counters within the INSERT statement,
 * then triggers update them atomically; a D1 failure intentionally reaches the caller.
 */
export async function storeSnapshot(
  database: SnapshotDatabase,
  input: StoreSnapshotInput,
): Promise<{ stored: boolean }> {
  const observed = timestamp(input.observedAt, 'observedAt');
  const slot = timestamp(input.scheduledSlot, 'scheduledSlot');
  const now = input.now ?? Date.now();
  if (observed > now) throw new Error('observedAt must not be in the future');
  if (slot % SNAPSHOT_INTERVAL_MS !== 0) throw new Error('scheduledSlot must be a 15-minute boundary');
  if (slot > observed) throw new Error('scheduledSlot must not be after observedAt');
  const { json, byteCount } = snapshotPayload(input.dashboard);
  if (timestamp(input.dashboard.generatedAt, 'dashboard.generatedAt') > observed) {
    throw new Error('dashboard.generatedAt must not be after observedAt');
  }
  await cleanupSnapshots(database, input.observedAt);
  if (await slotExists(database, input.scheduledSlot)) return { stored: false };
  const before = await capacity(database);
  if (
    before.row_count >= MAX_SNAPSHOT_ROWS ||
    before.total_payload_bytes + byteCount > MAX_TOTAL_PAYLOAD_BYTES
  ) {
    throw new Error('snapshot store logical capacity reached; recent evidence was not evicted');
  }
  const result = await database
    .prepare(
      `INSERT INTO dashboard_snapshots (scheduled_slot, observed_at, generated_at, payload_json, byte_count)
       SELECT ?, ?, ?, ?, ?
       WHERE (SELECT row_count FROM snapshot_store_metadata WHERE id = 1) < ?
         AND (SELECT total_payload_bytes FROM snapshot_store_metadata WHERE id = 1) + ? <= ?
       ON CONFLICT(scheduled_slot) DO NOTHING`,
    )
    .bind(
      input.scheduledSlot,
      input.observedAt,
      input.dashboard.generatedAt,
      json,
      byteCount,
      MAX_SNAPSHOT_ROWS,
      byteCount,
      MAX_TOTAL_PAYLOAD_BYTES,
    )
    .run();
  if (result.meta.changes === 0) {
    const after = await capacity(database);
    if (
      after.row_count >= MAX_SNAPSHOT_ROWS ||
      after.total_payload_bytes + byteCount > MAX_TOTAL_PAYLOAD_BYTES
    ) {
      throw new Error('snapshot store logical capacity reached; recent evidence was not evicted');
    }
  }
  // D1 includes trigger-maintained metadata changes in this count.
  return { stored: (result.meta.changes ?? 0) > 0 };
}

export interface FirstSeenItem {
  key: string;
  meta?: unknown;
}

export interface FirstSeenRow {
  kind: string;
  key: string;
  source: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** True when this row was created as a baseline for a `kind` with no prior rows: never "new". */
  seeded: boolean;
  meta: unknown | null;
}

async function kindHasRows(database: SnapshotDatabase, kind: string): Promise<boolean> {
  const row = await database
    .prepare('SELECT 1 AS present FROM first_seen WHERE kind = ? LIMIT 1')
    .bind(kind)
    .first<{ present: number }>();
  return row?.present === 1;
}

/** Deletes at most one batch of items not seen in the retention window, oldest first. */
async function pruneFirstSeen(database: SnapshotDatabase, nowIso: string): Promise<void> {
  const cutoff = new Date(timestamp(nowIso, 'nowIso') - RETENTION_MS).toISOString();
  await database
    .prepare(
      `DELETE FROM first_seen WHERE (kind, key) IN (
         SELECT kind, key FROM first_seen WHERE last_seen_at < ? ORDER BY last_seen_at LIMIT ?
       )`,
    )
    .bind(cutoff, MAX_FIRST_SEEN_CLEANUP_ROWS)
    .run();
}

/**
 * Records first-seen `items` for `kind` in one statement per direction, using
 * `json_each` so the bound-parameter count never depends on `items.length` (D1 caps a
 * statement at 100 bound parameters; a multi-VALUES insert of e.g. 519 transformers
 * modules would need thousands). A key already present keeps its original
 * `first_seen_at`; every key in `items` gets its `last_seen_at` bumped to `nowIso`
 * regardless. When `kind` has no rows yet, every inserted row is seeded (a baseline),
 * and this returns no keys — there is nothing to call "new" on a first capture.
 * `meta` is serialised here, not by SQLite: `json()` rejects a bare string and turns
 * `true` into `1`.
 */
export async function recordFirstSeen(
  database: SnapshotDatabase,
  kind: string,
  source: string,
  items: readonly FirstSeenItem[],
  nowIso: string,
): Promise<string[]> {
  timestamp(nowIso, 'nowIso');
  if (items.length === 0) return [];
  await pruneFirstSeen(database, nowIso);
  const seeded = (await kindHasRows(database, kind)) ? 0 : 1;
  const itemsJson = JSON.stringify(
    items.map((item) => ({ key: item.key, meta: item.meta == null ? null : JSON.stringify(item.meta) })),
  );
  await database
    .prepare(
      `INSERT OR IGNORE INTO first_seen (kind, key, source, first_seen_at, last_seen_at, seeded, meta)
       SELECT ?, json_extract(value, '$.key'), ?, ?, ?, ?, json_extract(value, '$.meta')
       FROM json_each(?)`,
    )
    .bind(kind, source, nowIso, nowIso, seeded, itemsJson)
    .run();
  await database
    .prepare(
      `UPDATE first_seen SET last_seen_at = ?
       WHERE kind = ? AND key IN (SELECT json_extract(value, '$.key') FROM json_each(?))`,
    )
    .bind(nowIso, kind, itemsJson)
    .run();
  if (seeded) return [];
  const { results } = await database
    .prepare(
      `SELECT key FROM first_seen
       WHERE kind = ? AND first_seen_at = ?
         AND key IN (SELECT json_extract(value, '$.key') FROM json_each(?))`,
    )
    .bind(kind, nowIso, itemsJson)
    .all<{ key: string }>();
  return results.map((row) => row.key);
}

/** The read side's cap on sightings; a capture records a few dozen keys per kind at most. */
export const MAX_SIGHTING_ROWS = 5000;

/** How recently a key must have been seen for the dashboard to read its first sighting back. */
export const SIGHTING_LOOKBACK_MS = 2 * 24 * 60 * 60_000;

export interface SightingRow {
  kind: string;
  key: string;
  firstSeenAt: string;
  seeded: boolean;
}

/**
 * First sightings of `kinds` whose key was still being seen since `sinceIso` (anything the current
 * upstream lists is bumped every capture). Narrow columns, no `meta`, one statement: the kinds go
 * in as one JSON parameter so the bound-parameter count is fixed.
 */
export async function readSightings(
  database: SnapshotDatabase,
  kinds: readonly string[],
  sinceIso: string,
  limit = MAX_SIGHTING_ROWS,
): Promise<SightingRow[]> {
  timestamp(sinceIso, 'sinceIso');
  if (!kinds.length) return [];
  const { results } = await database
    .prepare(
      `SELECT kind, key, first_seen_at, seeded FROM first_seen
       WHERE kind IN (SELECT value FROM json_each(?)) AND last_seen_at >= ?
       ORDER BY last_seen_at DESC LIMIT ?`,
    )
    .bind(JSON.stringify(kinds), sinceIso, limit)
    .all<{ kind: string; key: string; first_seen_at: string; seeded: number }>();
  return results.map((row) => ({
    kind: row.kind,
    key: row.key,
    firstSeenAt: row.first_seen_at,
    seeded: row.seeded === 1,
  }));
}

/** How far from "24 hours ago" a reading may be and still count as the day-old headline. */
export const HEADLINE_LOOKBACK_TOLERANCE_MS = 2 * 60 * 60_000;

/**
 * The non-degraded `algorithmVersion` reading closest to `targetIso` within ±tolerance, with a
 * headline probability, or undefined. The repricing term's "24 hours ago".
 */
export async function readHeadlineNear(
  database: SnapshotDatabase,
  algorithmVersion: number,
  targetIso: string,
  toleranceMs = HEADLINE_LOOKBACK_TOLERANCE_MS,
): Promise<{ p: number; observedAt: string } | undefined> {
  const target = timestamp(targetIso, 'targetIso');
  const row = await database
    .prepare(
      `SELECT headline_p, observed_at FROM score_series
       WHERE algo_version = ? AND degraded = 0 AND headline_p IS NOT NULL
         AND observed_at BETWEEN ? AND ?
       ORDER BY ABS(julianday(observed_at) - julianday(?)) LIMIT 1`,
    )
    .bind(
      algorithmVersion,
      new Date(target - toleranceMs).toISOString(),
      new Date(target + toleranceMs).toISOString(),
      targetIso,
    )
    .first<{ headline_p: number; observed_at: string }>();
  return row ? { p: row.headline_p, observedAt: row.observed_at } : undefined;
}

/** All rows for `kind`, oldest first. There is no upper bound: a kind's cardinality is small. */
export async function readFirstSeen(database: SnapshotDatabase, kind: string): Promise<FirstSeenRow[]> {
  const { results } = await database
    .prepare(
      'SELECT kind, key, source, first_seen_at, last_seen_at, seeded, meta FROM first_seen WHERE kind = ? ORDER BY first_seen_at ASC',
    )
    .bind(kind)
    .all<{
      kind: string;
      key: string;
      source: string;
      first_seen_at: string;
      last_seen_at: string;
      seeded: number;
      meta: string | null;
    }>();
  return results.map((row) => ({
    kind: row.kind,
    key: row.key,
    source: row.source,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    seeded: row.seeded === 1,
    meta: row.meta == null ? null : JSON.parse(row.meta),
  }));
}

export interface ScoreSeriesInput {
  /** The 15-minute scheduled slot this reading belongs to, ISO; primary key. */
  slot: string;
  observedAt: string;
  algorithmVersion: number;
  score: number;
  level: number;
  /**
   * The probability the headline reads (v3: P7, the best trusted frontier-family 7-day odds),
   * 0..1. Null when the odds source was down: a 0 there would read as a real price and fake a
   * full repricing once odds return. `headlineProbability` in src/domain/dropcon.ts is the rule.
   */
  headlineP?: number | null;
  degraded: boolean;
}

export interface ScoreSeriesRow {
  slot: string;
  observedAt: string;
  algorithmVersion: number;
  score: number;
  level: 1 | 2 | 3 | 4 | 5;
  headlineP?: number;
  degraded: boolean;
}

async function scoreSeriesRowCount(database: SnapshotDatabase): Promise<number> {
  const state = await database
    .prepare('SELECT row_count FROM score_series_metadata WHERE id = 1')
    .first<{ row_count: number }>();
  if (!state) throw new Error('score series metadata is missing');
  return state.row_count;
}

async function scoreSeriesSlotExists(database: SnapshotDatabase, slot: string): Promise<boolean> {
  const row = await database
    .prepare('SELECT 1 AS present FROM score_series WHERE slot = ?')
    .bind(slot)
    .first<{ present: number }>();
  return row?.present === 1;
}

/**
 * Deletes at most one batch of slots outside the 90-day retention window, oldest first.
 * By slot, like `cleanupSnapshots`, so a full table always has room for the next slot.
 */
async function pruneScoreSeries(database: SnapshotDatabase, observedAtIso: string): Promise<void> {
  const cutoff = new Date(timestamp(observedAtIso, 'observedAt') - RETENTION_MS).toISOString();
  await database
    .prepare(
      'DELETE FROM score_series WHERE slot IN (SELECT slot FROM score_series WHERE slot <= ? ORDER BY slot LIMIT ?)',
    )
    .bind(cutoff, MAX_CLEANUP_ROWS)
    .run();
}

/**
 * Writes one slot at most once, mirroring `storeSnapshot`. Never write `payload_json`
 * here: at ~11.6 KB per snapshot, an unbounded 90-day read of that column would
 * approach the 128 MB isolate cap on its own, which is exactly what
 * `readScoreSeries` exists to avoid.
 */
export async function writeScoreSeries(
  database: SnapshotDatabase,
  input: ScoreSeriesInput,
): Promise<{ stored: boolean }> {
  timestamp(input.slot, 'slot');
  timestamp(input.observedAt, 'observedAt');
  await pruneScoreSeries(database, input.observedAt);
  if (await scoreSeriesSlotExists(database, input.slot)) return { stored: false };
  if ((await scoreSeriesRowCount(database)) >= MAX_SNAPSHOT_ROWS) {
    throw new Error('score series logical capacity reached; recent evidence was not evicted');
  }
  const result = await database
    .prepare(
      `INSERT INTO score_series (slot, observed_at, algo_version, score, level, headline_p, degraded)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT row_count FROM score_series_metadata WHERE id = 1) < ?
       ON CONFLICT(slot) DO NOTHING`,
    )
    .bind(
      input.slot,
      input.observedAt,
      input.algorithmVersion,
      input.score,
      input.level,
      input.headlineP ?? null,
      input.degraded ? 1 : 0,
      MAX_SNAPSHOT_ROWS,
    )
    .run();
  return { stored: (result.meta.changes ?? 0) > 0 };
}

/**
 * Narrow columns only, never `SELECT *` and never `payload_json`; returned oldest first.
 * When more than `limit` rows match, the newest `limit` are kept: the latest reading is
 * the one a history strip can least afford to lose.
 */
export async function readScoreSeries(
  database: SnapshotDatabase,
  sinceIso: string,
  limit = MAX_SNAPSHOT_ROWS,
): Promise<ScoreSeriesRow[]> {
  timestamp(sinceIso, 'sinceIso');
  const { results } = await database
    .prepare(
      'SELECT slot, observed_at, algo_version, score, level, headline_p, degraded FROM score_series WHERE observed_at >= ? ORDER BY observed_at DESC LIMIT ?',
    )
    .bind(sinceIso, limit)
    .all<{
      slot: string;
      observed_at: string;
      algo_version: number;
      score: number;
      level: number;
      headline_p: number | null;
      degraded: number;
    }>();
  return results.reverse().map((row) => ({
    slot: row.slot,
    observedAt: row.observed_at,
    algorithmVersion: row.algo_version,
    score: row.score,
    level: row.level as ScoreSeriesRow['level'],
    headlineP: row.headline_p ?? undefined,
    degraded: row.degraded === 1,
  }));
}

/**
 * Fills `score_series` from `dashboard_snapshots` for retained slots that have a snapshot
 * but no rollup row, newest first, at most `MAX_CLEANUP_ROWS` per call. Migration 0002
 * backfills once, when it is applied; slots captured between then and the deploy that
 * starts calling `writeScoreSeries` (or any slot whose rollup write failed) are caught up
 * here. The JSON is read inside D1, so no payload ever reaches the isolate, and the
 * projection must stay identical to the one in migrations/0002_first_seen.sql. Snapshots
 * from before `measurement`/`dropcon` existed are skipped, not faked.
 */
export async function backfillScoreSeries(database: SnapshotDatabase, observedAtIso: string): Promise<void> {
  const cutoff = new Date(timestamp(observedAtIso, 'observedAt') - RETENTION_MS).toISOString();
  await database
    .prepare(
      `INSERT OR IGNORE INTO score_series (slot, observed_at, algo_version, score, level, headline_p, degraded)
       SELECT
         d.scheduled_slot,
         d.observed_at,
         CAST(json_extract(d.payload_json, '$.measurement.algorithmVersion') AS INTEGER),
         CAST(json_extract(d.payload_json, '$.dropcon.score') AS INTEGER),
         CAST(json_extract(d.payload_json, '$.dropcon.level') AS INTEGER),
         CASE WHEN json_extract(d.payload_json, '$.measurement.inputs.oddsAvailable') = 0 THEN NULL
              ELSE CAST(COALESCE(json_extract(d.payload_json, '$.measurement.inputs.p7'),
                                 json_extract(d.payload_json, '$.measurement.inputs.maxWeekOdds')) AS REAL) END,
         CASE WHEN json_extract(d.payload_json, '$.dropcon.degraded') THEN 1 ELSE 0 END
       FROM (
         SELECT s.scheduled_slot FROM dashboard_snapshots s
         WHERE s.scheduled_slot > ?
           AND NOT EXISTS (SELECT 1 FROM score_series r WHERE r.slot = s.scheduled_slot)
         ORDER BY s.scheduled_slot DESC LIMIT ?
       ) AS missing
       JOIN dashboard_snapshots d ON d.scheduled_slot = missing.scheduled_slot
       WHERE json_extract(d.payload_json, '$.dropcon.score') IS NOT NULL
         AND json_extract(d.payload_json, '$.dropcon.level') IS NOT NULL
         AND json_extract(d.payload_json, '$.measurement.algorithmVersion') IS NOT NULL`,
    )
    .bind(cutoff, MAX_CLEANUP_ROWS)
    .run();
}
