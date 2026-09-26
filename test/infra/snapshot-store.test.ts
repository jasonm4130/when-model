import { describe, expect, it } from 'vitest';
import { LIMITS, assembleDashboard } from '../../src/domain/dashboard';
import { LABS } from '../../src/domain/lab';
import { SOURCE } from '../../src/domain/sources';
import {
  MAX_CLEANUP_ROWS,
  MAX_FIRST_SEEN_ROWS,
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_ROWS,
  MAX_SNAPSHOT_STRING_BYTES,
  MAX_TOTAL_PAYLOAD_BYTES,
  SNAPSHOT_INTERVAL_MS,
  backfillScoreSeries,
  clipString,
  compactSnapshot,
  readFirstSeen,
  readHeadlineNear,
  readScoreSeries,
  readSightings,
  recordFirstSeen,
  snapshotPayload,
  storeSnapshot,
  writeScoreSeries,
  type D1Statement,
  type ScoreSeriesInput,
  type SnapshotDatabase,
  type StoreSnapshotInput,
} from '../../src/infra/snapshot-store';
import { SqliteD1 } from './sqlite-d1';

const dashboard = {
  generatedAt: '2026-09-20T00:00:00.000Z',
  measurement: { schema: 4, algorithmVersion: 3, inputs: { p7: 0.123456, oddsAvailable: true } },
  dropcon: {
    score: 4,
    level: 5,
    name: 'QUIET ORBIT',
    state: 'ok',
    degraded: false,
    headline: 'h',
    blurb: 'fixed copy, not stored',
    provenance: [{ term: 'market-7d', tag: 'LEAD', label: 'dropped', detail: '80 × 0.05', points: 4 }],
  },
  labs: [
    {
      id: 'openai',
      heat: 2,
      status: 'QUIET',
      odds: {
        family: 'GPT-6',
        marketUrl: 'discarded',
        p72: { p: 0.012345, trusted: true, interpolated: true },
        p7: { p: 0.05, trusted: true },
        p30: { p: 0.2, trusted: false },
      },
      latest: { id: 'a', name: 'A', createdAt: '2026-09-19T00:00:00Z', url: 'discarded' },
      discarded: true,
    },
    { id: 'meta', heat: 0, status: 'QUIET' },
  ],
  drops: [
    {
      id: 'a',
      name: 'A',
      labId: 'openai',
      createdAt: '2026-09-19T00:00:00Z',
      url: 'https://example.test/a',
      free: true,
    },
  ],
  sources: [{ name: 'Polymarket', ok: false, error: 'timeout', data: [] }],
};

class FakeDatabase implements SnapshotDatabase {
  readonly calls: Array<{ query: string; values: unknown[] }> = [];
  constructor(private readonly changes = 1) {}
  prepare(query: string): D1Statement {
    const call = { query, values: [] as unknown[] };
    this.calls.push(call);
    return {
      bind: (...values) => {
        call.values = values;
        return this.prepareBound(call);
      },
      run: async () => ({ meta: { changes: query.startsWith('INSERT') ? this.changes : 1 } }),
      first: async <T>() =>
        query.startsWith('SELECT 1') ? null : ({ row_count: 0, total_payload_bytes: 0 } as T),
      all: async <T>() => ({ results: [] as T[] }),
    };
  }
  private prepareBound(call: { query: string; values: unknown[] }): D1Statement {
    return {
      bind: () => this.prepareBound(call),
      run: async () => ({ meta: { changes: call.query.startsWith('INSERT') ? this.changes : 1 } }),
      first: async <T>() =>
        call.query.startsWith('SELECT 1') ? null : ({ row_count: 0, total_payload_bytes: 0 } as T),
      all: async <T>() => ({ results: [] as T[] }),
    };
  }
}

describe('snapshot store', () => {
  it('keeps only the required collected fields, including degraded source quality and absent odds', () => {
    expect(compactSnapshot(dashboard)).toEqual({
      generatedAt: dashboard.generatedAt,
      measurement: dashboard.measurement,
      dropcon: {
        score: 4,
        level: 5,
        name: 'QUIET ORBIT',
        state: 'ok',
        degraded: false,
        headline: 'h',
        provenance: [{ term: 'market-7d', detail: '80 × 0.05', points: 4 }],
      },
      labs: [
        {
          id: 'openai',
          heat: 2,
          status: 'QUIET',
          odds: {
            family: 'GPT-6',
            p72: { p: 0.0123, trusted: true },
            p7: { p: 0.05, trusted: true },
            p30: { p: 0.2, trusted: false },
          },
          latest: { id: 'a', name: 'A', createdAt: '2026-09-19T00:00:00Z' },
        },
        { id: 'meta', heat: 0, status: 'QUIET', odds: null, latest: null },
      ],
      drops: [
        {
          id: 'a',
          name: 'A',
          labId: 'openai',
          createdAt: '2026-09-19T00:00:00Z',
          url: 'https://example.test/a',
        },
      ],
      sources: [{ name: 'Polymarket', ok: false, error: 'timeout' }],
    });
  });

  it('clips every string by its encoded size, escapes and multi-byte characters included', () => {
    const fits = (x: string) => new TextEncoder().encode(JSON.stringify(x)).byteLength;
    expect(clipString('short')).toBe('short');
    for (const long of [
      'a'.repeat(500),
      '漢'.repeat(500),
      '"'.repeat(500),
      '\u0001'.repeat(500),
      '😀'.repeat(500),
      '\ud800'.repeat(500),
    ]) {
      const clipped = clipString(long);
      expect(clipped.endsWith('…')).toBe(true);
      expect(fits(clipped)).toBeLessThanOrEqual(MAX_SNAPSHOT_STRING_BYTES);
    }
    // A string exactly at the budget is kept whole.
    const exact = 'a'.repeat(MAX_SNAPSHOT_STRING_BYTES - 2);
    expect(clipString(exact)).toBe(exact);
    expect(
      compactSnapshot({ ...dashboard, sources: [{ name: 'X', ok: false, error: 'e'.repeat(900) }] })
        .sources[0].error,
    ).toHaveLength(MAX_SNAPSHOT_STRING_BYTES - 2 - 2);
  });

  it('stays within the 32 KiB cap in the worst case: every list full, every string over-long and multi-byte', () => {
    const long = (seed: string) => `${seed}${'漢"'.repeat(400)}`;
    const driver = {
      labId: 'anthropic',
      lab: 'Anthropic',
      family: long('family'),
      p: 0.123456789,
      read: 'interpolated',
      from: long('from'),
      to: long('to'),
      quote: { label: long('label'), p: 0.987654321 },
      url: long('url'),
    };
    const read = {
      p: 0.123456789,
      trusted: true,
      interpolated: true,
      lowerBound: false,
      source: 'curve',
      url: long('u'),
    };
    const real = assembleDashboard(
      {
        markets: { name: 'Polymarket', ok: true, data: [] },
        drops: { name: 'OpenRouter', ok: true, data: [] },
        trending: { name: 'HF trending', ok: true, data: [] },
        papers: { name: 'HF papers', ok: true, data: [] },
        feeds: [],
      },
      Date.parse('2026-09-20T00:00:00.000Z'),
    );
    const worst = {
      ...real,
      measurement: {
        schema: 4,
        algorithmVersion: 3,
        inputs: {
          p7: 0.123456789,
          p30: 0.987654321,
          p7DayAgo: 0.123456789,
          oddsAvailable: true,
          listingsAvailable: true,
          top7: driver,
          top30: driver,
        },
      },
      dropcon: {
        ...real.dropcon,
        name: 'VAGUE-POSTING DETECTED',
        headline: long('headline'),
        provenance: ['market-7d', 'market-30d', 'repricing'].map((term) => ({
          term,
          tag: 'LEAD',
          label: long('l'),
          detail: long('d'),
          points: 100,
          url: long('u'),
        })),
      },
      // Ids, statuses, source names, terms and lab ids are this codebase's own enums; every
      // upstream-shaped string is over-long, multi-byte and full of characters JSON escapes.
      labs: LABS.map((lab) => ({
        id: lab.id,
        heat: 100,
        status: 'SHIPPING',
        odds: {
          family: long('family'),
          marketUrl: long('m'),
          // A read from another family carries its name; the snapshot leaves it out.
          p72: { ...read, family: long('family') },
          p7: read,
          p30: { ...read, family: long('family') },
          thinExcluded: 99,
        },
        latest: {
          id: long('id'),
          name: long('name'),
          createdAt: '2026-09-19T00:00:00.000Z',
          url: long('url'),
        },
      })),
      drops: Array.from({ length: LIMITS.drops }, (_, i) => ({
        id: long(`id${i}`),
        name: long('name'),
        labId: 'anthropic',
        createdAt: '2026-09-19T00:00:00.000Z',
        url: long('url'),
      })),
      sources: Object.values(SOURCE).map((name) => ({ name, ok: false, error: long('error') })),
    };
    expect(LABS.length).toBeGreaterThanOrEqual(10);
    expect(Object.values(SOURCE)).toHaveLength(16);
    const { byteCount, json } = snapshotPayload(worst as unknown as Parameters<typeof snapshotPayload>[0]);
    // 30,012 bytes with 16 sources: under the cap with about 8% to spare.
    expect(byteCount).toBeLessThanOrEqual(MAX_SNAPSHOT_BYTES);
    // A 72-hour or 30-day read's own family stays out: only the headline family is kept.
    const odds = (JSON.parse(json) as { labs: { odds: Record<string, unknown> }[] }).labs[0].odds;
    expect(Object.keys(odds.p72 as object).sort()).toEqual(['p', 'trusted']);
    expect(Object.keys(odds.p30 as object).sort()).toEqual(['p', 'trusted']);
  });

  it('keeps a real v3 dashboard well under the cap', () => {
    const real = assembleDashboard(
      {
        markets: { name: 'Polymarket', ok: true, data: [] },
        drops: { name: 'OpenRouter', ok: true, data: [] },
        trending: { name: 'HF trending', ok: true, data: [] },
        papers: { name: 'HF papers', ok: true, data: [] },
        feeds: [],
      },
      Date.parse('2026-09-20T00:00:00.000Z'),
    );
    const payload = JSON.parse(snapshotPayload(real).json);
    expect(payload.measurement.algorithmVersion).toBe(3);
    expect(payload.dropcon).toMatchObject({ level: 5, state: 'ok', degraded: false });
    expect(payload.dropcon.blurb).toBeUndefined();
  });

  it('uses SQL guards for duplicate slots and cached logical capacity, after bounded cleanup', async () => {
    const database = new FakeDatabase(0);
    const result = await storeSnapshot(database, {
      scheduledSlot: '2026-09-20T00:00:00.000Z',
      observedAt: '2026-09-20T00:01:00.000Z',
      dashboard,
      now: Date.parse('2026-09-20T00:01:00.000Z'),
    });
    expect(result).toEqual({ stored: false });
    expect(database.calls[0].values.at(-1)).toBe(MAX_CLEANUP_ROWS);
    expect(database.calls[3].query).toContain('ON CONFLICT(scheduled_slot) DO NOTHING');
    expect(database.calls[3].query).toContain('total_payload_bytes');
    expect(database.calls[3].values).toContain(MAX_TOTAL_PAYLOAD_BYTES);
  });

  it('reports an insert when D1 includes the metadata trigger in its change count', async () => {
    const result = await storeSnapshot(new FakeDatabase(2), {
      scheduledSlot: '2026-09-20T00:00:00.000Z',
      observedAt: '2026-09-20T00:01:00.000Z',
      dashboard,
      now: Date.parse('2026-09-20T00:01:00.000Z'),
    });
    expect(result.stored).toBe(true);
  });

  it('rejects future and oversized observations before D1 is called', async () => {
    const database = new FakeDatabase();
    await expect(
      storeSnapshot(database, {
        scheduledSlot: '2026-09-20T00:00:00.000Z',
        observedAt: '2026-09-20T00:01:00.000Z',
        dashboard: { ...dashboard, generatedAt: '2026-09-20T00:02:00.000Z' },
        now: Date.parse('2026-09-20T00:01:00.000Z'),
      }),
    ).rejects.toThrow('after observedAt');
    expect(() =>
      snapshotPayload({
        ...dashboard,
        drops: Array.from({ length: 1000 }, () => ({
          id: 'x'.repeat(100),
          name: 'x'.repeat(100),
          labId: 'openai',
          createdAt: dashboard.generatedAt,
          url: 'https://example.test',
        })),
      }),
    ).toThrow('byte cap');
    expect(database.calls).toHaveLength(0);
  });

  it('rejects non-canonical slots and slots after their observation', async () => {
    const database = new FakeDatabase();
    await expect(
      storeSnapshot(database, {
        scheduledSlot: '2026-09-20T00:00:00Z',
        observedAt: '2026-09-20T00:01:00.000Z',
        dashboard,
        now: Date.parse('2026-09-20T00:01:00.000Z'),
      }),
    ).rejects.toThrow('canonical');
    await expect(
      storeSnapshot(database, {
        scheduledSlot: '2026-09-20T00:15:00.000Z',
        observedAt: '2026-09-20T00:01:00.000Z',
        dashboard,
        now: Date.parse('2026-09-20T00:01:00.000Z'),
      }),
    ).rejects.toThrow('after observedAt');
  });
});

const iso = (ms: number) => new Date(ms).toISOString();
const T0 = Date.parse('2026-09-23T01:00:00.000Z');
/** Captures land a few seconds after their slot; the delay varies run to run. */
const CAPTURE_DELAY_MS = 40_000;

/** Bulk-loads `count` consecutive slots straight into SQLite (through the real triggers). */
function fillSlots(db: SqliteD1, table: 'score_series' | 'dashboard_snapshots', from: number, count: number) {
  const insert =
    table === 'score_series'
      ? db.sqlite.prepare(
          'INSERT INTO score_series (slot, observed_at, algo_version, score, level, headline_p, degraded) VALUES (?, ?, 2, 10, 5, NULL, 0)',
        )
      : db.sqlite.prepare(
          "INSERT INTO dashboard_snapshots (scheduled_slot, observed_at, generated_at, payload_json, byte_count) VALUES (?, ?, ?, '{}', 2)",
        );
  db.sqlite.exec('BEGIN');
  for (let i = 0; i < count; i++) {
    const slot = from + i * SNAPSHOT_INTERVAL_MS;
    const args = [iso(slot), iso(slot + CAPTURE_DELAY_MS)];
    if (table === 'dashboard_snapshots') args.push(iso(slot + CAPTURE_DELAY_MS - 1000));
    insert.run(...args);
  }
  db.sqlite.exec('COMMIT');
}

function reading(slotMs: number, overrides: Partial<ScoreSeriesInput> = {}): ScoreSeriesInput {
  return {
    slot: iso(slotMs),
    observedAt: iso(slotMs + CAPTURE_DELAY_MS),
    algorithmVersion: 2,
    score: 64,
    level: 2,
    headlineP: 0.6,
    degraded: false,
    ...overrides,
  };
}

describe('retention at steady state (real SQLite, migrations applied)', () => {
  // 90 days of 15-minute slots is exactly the 8,640-row cap, so the slot 90 days before
  // the one being written must be evicted first or every write from day 90 on fails.
  it('keeps storing snapshots once 90 days of slots fill the table', async () => {
    const db = new SqliteD1();
    fillSlots(db, 'dashboard_snapshots', T0, MAX_SNAPSHOT_ROWS);
    const next = T0 + MAX_SNAPSHOT_ROWS * SNAPSHOT_INTERVAL_MS;
    const observedAt = iso(next + CAPTURE_DELAY_MS);
    const dashboard = { generatedAt: iso(next + 30_000), labs: [], drops: [], sources: [] };
    expect(
      await storeSnapshot(db, { scheduledSlot: iso(next), observedAt, dashboard, now: next + 60_000 }),
    ).toEqual({ stored: true });
    expect(db.sqlite.prepare('SELECT MIN(scheduled_slot) AS oldest FROM dashboard_snapshots').get()).toEqual({
      oldest: iso(T0 + SNAPSHOT_INTERVAL_MS),
    });
    expect(db.sqlite.prepare('SELECT row_count FROM snapshot_store_metadata').get()).toEqual({
      row_count: MAX_SNAPSHOT_ROWS,
    });
  });

  it('keeps writing the score series once 90 days of slots fill the table', async () => {
    const db = new SqliteD1();
    fillSlots(db, 'score_series', T0, MAX_SNAPSHOT_ROWS);
    const next = T0 + MAX_SNAPSHOT_ROWS * SNAPSHOT_INTERVAL_MS;
    expect(await writeScoreSeries(db, reading(next))).toEqual({ stored: true });
    expect(db.sqlite.prepare('SELECT row_count FROM score_series_metadata').get()).toEqual({
      row_count: MAX_SNAPSHOT_ROWS,
    });
  });

  it('still refuses to evict recent evidence when the table is full of it', async () => {
    const db = new SqliteD1();
    fillSlots(db, 'score_series', T0, MAX_SNAPSHOT_ROWS);
    // A slot just before the stored window: none of the stored slots is 90 days older.
    await expect(writeScoreSeries(db, reading(T0 - SNAPSHOT_INTERVAL_MS))).rejects.toThrow('capacity');
  });
});

describe('recordFirstSeen / readFirstSeen (real SQLite, migrations applied)', () => {
  it('seeds a kind with no prior rows as a baseline, reporting nothing as new', async () => {
    const db = new SqliteD1();
    const newKeys = await recordFirstSeen(
      db,
      'module',
      'transformers',
      [{ key: 'qwen4_exp', meta: { pr: 48337 } }, { key: 'gemma4' }],
      '2026-09-23T01:00:00.000Z',
    );
    expect(newKeys).toEqual([]);
    expect(await readFirstSeen(db, 'module')).toEqual([
      {
        kind: 'module',
        key: 'qwen4_exp',
        source: 'transformers',
        firstSeenAt: '2026-09-23T01:00:00.000Z',
        lastSeenAt: '2026-09-23T01:00:00.000Z',
        seeded: true,
        meta: { pr: 48337 },
      },
      {
        kind: 'module',
        key: 'gemma4',
        source: 'transformers',
        firstSeenAt: '2026-09-23T01:00:00.000Z',
        lastSeenAt: '2026-09-23T01:00:00.000Z',
        seeded: true,
        meta: null,
      },
    ]);
  });

  it('reports only genuinely new keys once a kind has a baseline, and bumps last_seen_at for the rest', async () => {
    const db = new SqliteD1();
    await recordFirstSeen(db, 'module', 'transformers', [{ key: 'qwen4_exp' }], '2026-09-23T01:00:00.000Z');
    await recordFirstSeen(
      db,
      'stealth',
      'openrouter',
      [{ key: 'space-bunny-alpha' }],
      '2026-09-23T01:00:00.000Z',
    );
    const newKeys = await recordFirstSeen(
      db,
      'module',
      'transformers',
      [{ key: 'qwen4_exp' }, { key: 'glm5' }, { key: 'glm5' }],
      '2026-09-23T01:15:00.000Z',
    );
    expect(newKeys).toEqual(['glm5']);
    const rows = await readFirstSeen(db, 'module');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.key === 'qwen4_exp')).toMatchObject({
      firstSeenAt: '2026-09-23T01:00:00.000Z',
      lastSeenAt: '2026-09-23T01:15:00.000Z',
      seeded: true,
    });
    expect(rows.find((r) => r.key === 'glm5')).toMatchObject({
      firstSeenAt: '2026-09-23T01:15:00.000Z',
      lastSeenAt: '2026-09-23T01:15:00.000Z',
      seeded: false,
    });
    // Another kind's ledger is untouched.
    expect((await readFirstSeen(db, 'stealth'))[0].lastSeenAt).toBe('2026-09-23T01:00:00.000Z');
  });

  it('round-trips every JSON meta shape, including a bare string and a boolean', async () => {
    const db = new SqliteD1();
    await recordFirstSeen(db, 'stealth', 'openrouter', [{ key: 'baseline' }], '2026-09-23T01:00:00.000Z');
    const metas = {
      text: 'Cloaked model, 1M context',
      flag: true,
      count: 0,
      list: [1, 'a'],
      nested: { a: null },
    };
    const newKeys = await recordFirstSeen(
      db,
      'stealth',
      'openrouter',
      Object.entries(metas).map(([key, meta]) => ({ key, meta })),
      '2026-09-23T01:15:00.000Z',
    );
    expect(newKeys.sort()).toEqual(Object.keys(metas).sort());
    const rows = await readFirstSeen(db, 'stealth');
    expect(Object.fromEntries(rows.filter((r) => r.key !== 'baseline').map((r) => [r.key, r.meta]))).toEqual(
      metas,
    );
  });

  it('writes hundreds of keys in one statement per direction, far past D1s 100 bound parameters', async () => {
    const db = new SqliteD1();
    const modules = Array.from({ length: 519 }, (_, i) => ({ key: `module_${i}` }));
    await recordFirstSeen(db, 'module', 'transformers', modules, '2026-09-23T01:00:00.000Z');
    expect(await readFirstSeen(db, 'module')).toHaveLength(519);
    expect(db.queries.filter((q) => q.includes('INSERT OR IGNORE INTO first_seen'))).toHaveLength(1);
    expect(
      await recordFirstSeen(
        db,
        'module',
        'transformers',
        [...modules, { key: 'qwen4_exp' }],
        '2026-09-23T01:15:00.000Z',
      ),
    ).toEqual(['qwen4_exp']);
  });

  it('does nothing for an empty item list, issuing no queries', async () => {
    const db = new SqliteD1();
    expect(await recordFirstSeen(db, 'module', 'transformers', [], '2026-09-23T01:00:00.000Z')).toEqual([]);
    expect(db.queries).toHaveLength(0);
  });

  it('prunes items unseen for over 90 days, in every kind, before writing', async () => {
    const db = new SqliteD1();
    await recordFirstSeen(
      db,
      'stealth',
      'openrouter',
      [{ key: 'old' }, { key: 'kept' }],
      '2026-06-01T00:00:00.000Z',
    );
    await recordFirstSeen(db, 'stealth', 'openrouter', [{ key: 'kept' }], '2026-09-01T00:00:00.000Z');
    await recordFirstSeen(db, 'module', 'transformers', [{ key: 'qwen4_exp' }], '2026-09-23T01:00:00.000Z');
    expect((await readFirstSeen(db, 'stealth')).map((r) => r.key)).toEqual(['kept']);
    expect(db.sqlite.prepare('SELECT row_count FROM first_seen_metadata').get()).toEqual({ row_count: 2 });
  });

  it('fails loudly at logical capacity instead of dropping keys silently', async () => {
    const db = new SqliteD1();
    await recordFirstSeen(db, 'module', 'transformers', [{ key: 'a' }], '2026-09-23T01:00:00.000Z');
    db.sqlite.exec(`UPDATE first_seen_metadata SET row_count = ${MAX_FIRST_SEEN_ROWS}`);
    await expect(
      recordFirstSeen(db, 'module', 'transformers', [{ key: 'b' }], '2026-09-23T01:15:00.000Z'),
    ).rejects.toThrow('first_seen logical capacity reached');
  });

  it('reads an empty ledger for a kind with no rows', async () => {
    expect(await readFirstSeen(new SqliteD1(), 'broadcast')).toEqual([]);
  });
});

describe('writeScoreSeries / readScoreSeries (real SQLite, migrations applied)', () => {
  it('writes one slot at most once', async () => {
    const db = new SqliteD1();
    expect(await writeScoreSeries(db, reading(T0))).toEqual({ stored: true });
    expect(await writeScoreSeries(db, reading(T0, { score: 65, observedAt: iso(T0 + 50_000) }))).toEqual({
      stored: false,
    });
    expect((await readScoreSeries(db, iso(T0))).map((r) => r.score)).toEqual([64]);
  });

  it('reads back narrow columns only, mapping snake_case, booleans and absent odds', async () => {
    const db = new SqliteD1();
    await writeScoreSeries(db, reading(T0));
    await writeScoreSeries(
      db,
      reading(T0 + SNAPSHOT_INTERVAL_MS, { score: 10, level: 5, headlineP: null, degraded: true }),
    );
    expect(await readScoreSeries(db, iso(T0 - 60_000))).toEqual([
      {
        slot: '2026-09-23T01:00:00.000Z',
        observedAt: '2026-09-23T01:00:40.000Z',
        algorithmVersion: 2,
        score: 64,
        level: 2,
        headlineP: 0.6,
        degraded: false,
      },
      {
        slot: '2026-09-23T01:15:00.000Z',
        observedAt: '2026-09-23T01:15:40.000Z',
        algorithmVersion: 2,
        score: 10,
        level: 5,
        headlineP: undefined,
        degraded: true,
      },
    ]);
    const readQuery = db.queries.find((q) => q.includes('WHERE observed_at >=')) ?? '';
    expect(readQuery).not.toContain('payload_json');
    expect(readQuery).not.toMatch(/select \*/i);
  });

  it('excludes rows before sinceIso and, over the limit, keeps the newest rows in ascending order', async () => {
    const db = new SqliteD1();
    for (let i = 0; i < 5; i++)
      await writeScoreSeries(db, reading(T0 + i * SNAPSHOT_INTERVAL_MS, { score: i }));
    expect((await readScoreSeries(db, iso(T0 + 2 * SNAPSHOT_INTERVAL_MS))).map((r) => r.score)).toEqual([
      2, 3, 4,
    ]);
    expect((await readScoreSeries(db, iso(T0), 3)).map((r) => r.score)).toEqual([2, 3, 4]);
  });
});

describe('score_series backfill (real SQLite, real snapshot payloads)', () => {
  const quiet = {
    markets: { name: 'Polymarket', ok: true, data: [] },
    drops: { name: 'OpenRouter', ok: true, data: [] },
    trending: { name: 'HF trending', ok: true, data: [] },
    papers: { name: 'HF papers', ok: true, data: [] },
    feeds: [],
  };
  /** Live /api/dashboard.json at 2026-09-26T00:43:46Z, trimmed to what the rollup reads. */
  function liveDashboard(generatedAt: string) {
    return {
      ...assembleDashboard(quiet, Date.parse(generatedAt)),
      measurement: {
        schema: 3,
        algorithmVersion: 2,
        inputs: {
          maxWeekOdds: 0.865,
          maxMonthOdds: 0.9,
          frontierDrops7d: 8,
          frontierDrops48h: 0,
          hotStories: 5,
          releaseAlerts: 1,
          oddsAvailable: true,
        },
      },
      dropcon: {
        level: 1 as const,
        score: 95,
        drivers: ['87% odds of a frontier drop within 7 days'],
        degraded: false,
        name: 'RELEASE SURGE',
        blurb: 'Recent OpenRouter listings still contribute to this level for seven days.',
      },
    };
  }
  /** A v3 capture with live odds: headline_p is its measurement's P7. */
  function v3Dashboard(generatedAt: string) {
    const d = assembleDashboard(quiet, Date.parse(generatedAt));
    return { ...d, measurement: { ...d.measurement, inputs: { ...d.measurement.inputs, p7: 0.42 } } };
  }
  /** The real degraded path: Polymarket down, so P7 is a placeholder 0. */
  function oddsOfflineDashboard(generatedAt: string) {
    return assembleDashboard(
      { ...quiet, markets: { name: 'Polymarket', ok: false, error: 'timeout', data: [] } },
      Date.parse(generatedAt),
    );
  }

  async function capture(db: SqliteD1, slotMs: number, dashboard: StoreSnapshotInput['dashboard']) {
    await storeSnapshot(db, {
      scheduledSlot: iso(slotMs),
      observedAt: iso(slotMs + CAPTURE_DELAY_MS),
      dashboard,
      now: slotMs + CAPTURE_DELAY_MS,
    });
  }
  const at = (slotMs: number) => iso(slotMs + CAPTURE_DELAY_MS - 5000);
  const allRows = (db: SqliteD1) =>
    db.sqlite
      .prepare(
        'SELECT slot, observed_at, algo_version, score, level, headline_p, degraded FROM score_series ORDER BY slot',
      )
      .all();

  it('migration 0002 backfills v2 and v3 snapshots into headline_p, null when odds were offline, skipping legacy rows', async () => {
    const db = new SqliteD1(['0001_snapshots.sql']);
    await capture(db, T0, liveDashboard(at(T0)));
    await capture(db, T0 + SNAPSHOT_INTERVAL_MS, oddsOfflineDashboard(at(T0 + SNAPSHOT_INTERVAL_MS)));
    // A row from before `measurement`/`dropcon` were captured.
    await capture(db, T0 + 2 * SNAPSHOT_INTERVAL_MS, {
      generatedAt: at(T0 + 2 * SNAPSHOT_INTERVAL_MS),
      labs: [],
      drops: [],
      sources: [],
    });
    await capture(db, T0 + 3 * SNAPSHOT_INTERVAL_MS, v3Dashboard(at(T0 + 3 * SNAPSHOT_INTERVAL_MS)));
    db.migrate('0002_first_seen.sql');
    expect(allRows(db)).toEqual([
      {
        slot: '2026-09-23T01:00:00.000Z',
        observed_at: '2026-09-23T01:00:40.000Z',
        algo_version: 2,
        score: 95,
        level: 1,
        // v2: the max 7-day odds.
        headline_p: 0.865,
        degraded: 0,
      },
      {
        slot: '2026-09-23T01:15:00.000Z',
        observed_at: '2026-09-23T01:15:40.000Z',
        algo_version: 3,
        score: 0,
        level: 5,
        headline_p: null,
        degraded: 1,
      },
      {
        slot: '2026-09-23T01:45:00.000Z',
        observed_at: '2026-09-23T01:45:40.000Z',
        algo_version: 3,
        score: 0,
        level: 5,
        // v3: P7.
        headline_p: 0.42,
        degraded: 0,
      },
    ]);
    expect(db.sqlite.prepare('SELECT row_count FROM score_series_metadata').get()).toEqual({ row_count: 3 });
  });

  it('catches up slots captured between applying the migration and deploying the writer, identically', async () => {
    // Reference: the migration's own projection over the same snapshots.
    const reference = new SqliteD1(['0001_snapshots.sql']);
    const gap = new SqliteD1();
    for (const db of [reference, gap]) {
      await capture(db, T0, liveDashboard(at(T0)));
      await capture(db, T0 + SNAPSHOT_INTERVAL_MS, oddsOfflineDashboard(at(T0 + SNAPSHOT_INTERVAL_MS)));
      await capture(db, T0 + 2 * SNAPSHOT_INTERVAL_MS, v3Dashboard(at(T0 + 2 * SNAPSHOT_INTERVAL_MS)));
    }
    reference.migrate('0002_first_seen.sql');
    // The migration already ran on `gap` (empty then); the old Worker kept writing snapshots.
    expect(allRows(gap)).toEqual([]);
    await backfillScoreSeries(gap, iso(T0 + 3 * SNAPSHOT_INTERVAL_MS));
    expect(allRows(reference)).toHaveLength(3);
    expect(allRows(gap)).toEqual(allRows(reference));
  });

  it('fills at most one batch per call, newest first, and ignores slots past retention', async () => {
    const db = new SqliteD1();
    const count = MAX_CLEANUP_ROWS + 4;
    for (let i = 0; i < count; i++) {
      const slot = T0 + i * SNAPSHOT_INTERVAL_MS;
      await capture(db, slot, liveDashboard(at(slot)));
    }
    const after = T0 + count * SNAPSHOT_INTERVAL_MS;
    await backfillScoreSeries(db, iso(after));
    const rows = allRows(db) as Array<{ slot: string }>;
    expect(rows).toHaveLength(MAX_CLEANUP_ROWS);
    expect(rows[0].slot).toBe(iso(T0 + 4 * SNAPSHOT_INTERVAL_MS));
    await backfillScoreSeries(db, iso(after));
    expect(allRows(db)).toHaveLength(count);
    // 90 days on, every one of those slots is outside retention: nothing to re-insert.
    db.sqlite.exec('DELETE FROM score_series');
    await backfillScoreSeries(db, iso(after + 90 * 24 * 60 * 60_000));
    expect(allRows(db)).toEqual([]);
  });
});

describe('readSightings / readHeadlineNear (real SQLite, migrations applied)', () => {
  it('reads first sightings of the asked kinds still seen since the cutoff, seeded flag included', async () => {
    const db = new SqliteD1();
    await recordFirstSeen(db, 'stealth', 'openrouter', [{ key: 'a' }], iso(T0));
    await recordFirstSeen(db, 'stealth', 'openrouter', [{ key: 'a' }, { key: 'b' }], iso(T0 + 3_600_000));
    await recordFirstSeen(db, 'broadcast', 'youtube', [{ key: 'v' }], iso(T0 - 5 * 86_400_000));
    await recordFirstSeen(db, 'other', 'x', [{ key: 'z' }], iso(T0));
    const rows = await readSightings(db, ['stealth', 'broadcast'], iso(T0 - 86_400_000));
    expect(rows.sort((x, y) => x.key.localeCompare(y.key))).toEqual([
      { kind: 'stealth', key: 'a', firstSeenAt: iso(T0), seeded: true },
      { kind: 'stealth', key: 'b', firstSeenAt: iso(T0 + 3_600_000), seeded: false },
    ]);
    expect(await readSightings(db, [], iso(T0))).toEqual([]);
    const query = db.queries.find((q) => q.includes('FROM first_seen') && q.includes('json_each')) ?? '';
    expect(query).not.toContain('meta');
  });

  it('finds the non-degraded headline probability closest to the target within the tolerance', async () => {
    const db = new SqliteD1();
    const target = T0 + 24 * 3_600_000;
    await writeScoreSeries(
      db,
      reading(target - 3 * SNAPSHOT_INTERVAL_MS, { algorithmVersion: 3, headlineP: 0.3 }),
    );
    await writeScoreSeries(db, reading(target, { algorithmVersion: 3, headlineP: null, degraded: true }));
    await writeScoreSeries(
      db,
      reading(target + SNAPSHOT_INTERVAL_MS, { algorithmVersion: 2, headlineP: 0.9 }),
    );
    await writeScoreSeries(
      db,
      reading(target + 2 * SNAPSHOT_INTERVAL_MS, { algorithmVersion: 3, headlineP: 0.5 }),
    );
    expect(await readHeadlineNear(db, 3, iso(target))).toEqual({
      p: 0.5,
      observedAt: iso(target + 2 * SNAPSHOT_INTERVAL_MS + CAPTURE_DELAY_MS),
    });
    expect(await readHeadlineNear(db, 3, iso(target + 10 * 3_600_000))).toBeUndefined();
  });
});
