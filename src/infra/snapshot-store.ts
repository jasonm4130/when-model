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

type DashboardLike = {
  generatedAt: string;
  measurement?: unknown;
  dropcon?: unknown;
  labs: Array<{
    id: string;
    heat: number;
    status: string;
    weekOdds?: unknown;
    monthOdds?: unknown;
    latest?: { id: string; name: string; createdAt: string };
  }>;
  drops: Array<{ id: string; name: string; labId?: string; createdAt: string; url: string }>;
  sources: Array<{ name: string; ok: boolean; error?: string }>;
};

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

/** Projects only collected values. It never derives or recomputes a release signal. */
export function compactSnapshot(dashboard: DashboardLike): CompactSnapshot {
  timestamp(dashboard.generatedAt, 'dashboard.generatedAt');
  return {
    generatedAt: dashboard.generatedAt,
    measurement: dashboard.measurement ?? null,
    dropcon: dashboard.dropcon ?? null,
    labs: dashboard.labs.map((lab) => ({
      ...pick(lab, ['id', 'heat', 'status', 'weekOdds', 'monthOdds']),
      latest:
        lab.latest && typeof lab.latest === 'object' ? pick(lab.latest, ['id', 'name', 'createdAt']) : null,
    })),
    drops: dashboard.drops.map((drop) => pick(drop, ['id', 'name', 'labId', 'createdAt', 'url'])),
    sources: dashboard.sources.map((source) => pick(source, ['name', 'ok', 'error'])),
  };
}

export function snapshotPayload(dashboard: DashboardLike): { json: string; byteCount: number } {
  const json = JSON.stringify(compactSnapshot(dashboard));
  const byteCount = new TextEncoder().encode(json).byteLength;
  if (byteCount > MAX_SNAPSHOT_BYTES) {
    throw new Error(`snapshot payload exceeds ${MAX_SNAPSHOT_BYTES} byte cap`);
  }
  return { json, byteCount };
}

/** Deletes at most one day of stale slots, keeping scheduled work bounded. */
export async function cleanupSnapshots(database: SnapshotDatabase, observedAt: string): Promise<void> {
  const cutoff = new Date(timestamp(observedAt, 'observedAt') - RETENTION_MS).toISOString();
  await database
    .prepare(
      'DELETE FROM dashboard_snapshots WHERE scheduled_slot IN (SELECT scheduled_slot FROM dashboard_snapshots WHERE observed_at < ? ORDER BY observed_at LIMIT ?)',
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
  const itemsJson = JSON.stringify(items.map((item) => ({ key: item.key, meta: item.meta ?? null })));
  await database
    .prepare(
      `INSERT OR IGNORE INTO first_seen (kind, key, source, first_seen_at, last_seen_at, seeded, meta)
       SELECT ?, json_extract(value, '$.key'), ?, ?, ?, ?, json(json_extract(value, '$.meta'))
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
  /** "Ships within 7 days" odds behind the score, 0..1; omit when the odds source was down. */
  p7?: number | null;
  degraded: boolean;
}

export interface ScoreSeriesRow {
  slot: string;
  observedAt: string;
  algorithmVersion: number;
  score: number;
  level: 1 | 2 | 3 | 4 | 5;
  p7?: number;
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

/** Deletes at most one batch of slots outside the 90-day retention window, oldest first. */
async function pruneScoreSeries(database: SnapshotDatabase, observedAtIso: string): Promise<void> {
  const cutoff = new Date(timestamp(observedAtIso, 'observedAt') - RETENTION_MS).toISOString();
  await database
    .prepare(
      'DELETE FROM score_series WHERE slot IN (SELECT slot FROM score_series WHERE observed_at < ? ORDER BY observed_at LIMIT ?)',
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
      `INSERT INTO score_series (slot, observed_at, algo_version, score, level, p7, degraded)
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
      input.p7 ?? null,
      input.degraded ? 1 : 0,
      MAX_SNAPSHOT_ROWS,
    )
    .run();
  return { stored: (result.meta.changes ?? 0) > 0 };
}

/** Narrow columns only, oldest first: never `SELECT *`, and never `payload_json`. */
export async function readScoreSeries(
  database: SnapshotDatabase,
  sinceIso: string,
  limit = MAX_SNAPSHOT_ROWS,
): Promise<ScoreSeriesRow[]> {
  timestamp(sinceIso, 'sinceIso');
  const { results } = await database
    .prepare(
      'SELECT slot, observed_at, algo_version, score, level, p7, degraded FROM score_series WHERE observed_at >= ? ORDER BY observed_at ASC LIMIT ?',
    )
    .bind(sinceIso, limit)
    .all<{
      slot: string;
      observed_at: string;
      algo_version: number;
      score: number;
      level: number;
      p7: number | null;
      degraded: number;
    }>();
  return results.map((row) => ({
    slot: row.slot,
    observedAt: row.observed_at,
    algorithmVersion: row.algo_version,
    score: row.score,
    level: row.level as ScoreSeriesRow['level'],
    p7: row.p7 ?? undefined,
    degraded: row.degraded === 1,
  }));
}
