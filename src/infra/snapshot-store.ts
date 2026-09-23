/** Bounded D1 persistence for scheduled observations; it has no read endpoint. */

export const SNAPSHOT_INTERVAL_MS = 15 * 60_000;
export const RETENTION_MS = 90 * 24 * 60 * 60_000;
export const MAX_SNAPSHOT_BYTES = 32 * 1024;
export const MAX_SNAPSHOT_ROWS = 90 * 24 * 4;
export const MAX_TOTAL_PAYLOAD_BYTES = 128 * 1024 * 1024;
export const MAX_CLEANUP_ROWS = 96;

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
