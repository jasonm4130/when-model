import { describe, expect, it } from 'vitest';
import {
  MAX_CLEANUP_ROWS,
  MAX_SNAPSHOT_ROWS,
  MAX_TOTAL_PAYLOAD_BYTES,
  compactSnapshot,
  readFirstSeen,
  readScoreSeries,
  recordFirstSeen,
  snapshotPayload,
  storeSnapshot,
  writeScoreSeries,
  type D1Statement,
  type SnapshotDatabase,
} from '../../src/infra/snapshot-store';

const dashboard = {
  generatedAt: '2026-09-20T00:00:00.000Z',
  measurement: { schema: 3, algorithmVersion: 2, inputs: { maxWeekOdds: 0 } },
  dropcon: { score: 4, level: 5, extra: 'preserved' },
  labs: [
    {
      id: 'openai',
      heat: 2,
      status: 'QUIET',
      weekOdds: undefined,
      monthOdds: { p: 0.2 },
      latest: { id: 'a', name: 'A', createdAt: '2026-09-19T00:00:00Z', url: 'discarded' },
      discarded: true,
    },
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
      dropcon: dashboard.dropcon,
      labs: [
        {
          id: 'openai',
          heat: 2,
          status: 'QUIET',
          weekOdds: null,
          monthOdds: { p: 0.2 },
          latest: { id: 'a', name: 'A', createdAt: '2026-09-19T00:00:00Z' },
        },
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

/**
 * A small in-memory double for the `first_seen`/`score_series` tables, driven by matching
 * on the stable substrings of the queries `snapshot-store.ts` actually issues. It exists
 * to exercise the JS-side branching (seeding, new-key detection, capacity, narrow reads)
 * with a real round trip; the SQL itself (json_each, the capacity triggers) was proven
 * separately against a real local D1 (`wrangler d1 execute --local`, see migration 0002).
 */
class FakeHistoryDatabase implements SnapshotDatabase {
  firstSeen: Array<{
    kind: string;
    key: string;
    source: string;
    first_seen_at: string;
    last_seen_at: string;
    seeded: number;
    meta: string | null;
  }> = [];
  scoreSeries: Array<{
    slot: string;
    observed_at: string;
    algo_version: number;
    score: number;
    level: number;
    p7: number | null;
    degraded: number;
  }> = [];
  readonly calls: Array<{ query: string; values: unknown[] }> = [];

  prepare(query: string): D1Statement {
    return this.bound(query, []);
  }

  private bound(query: string, values: unknown[]): D1Statement {
    return {
      bind: (...next: unknown[]) => this.bound(query, next),
      run: async () => this.run(query, values),
      first: async <T>() => this.first<T>(query, values),
      all: async <T>() => this.all<T>(query, values),
    };
  }

  private async run(query: string, values: unknown[]): Promise<{ meta: { changes?: number } }> {
    this.calls.push({ query, values });
    if (query.includes('INSERT OR IGNORE INTO first_seen')) {
      const [kind, source, firstSeenAt, lastSeenAt, seeded, itemsJson] = values as [
        string,
        string,
        string,
        string,
        number,
        string,
      ];
      const items = JSON.parse(itemsJson) as Array<{ key: string; meta: unknown }>;
      let changes = 0;
      for (const item of items) {
        if (this.firstSeen.some((r) => r.kind === kind && r.key === item.key)) continue;
        this.firstSeen.push({
          kind,
          key: item.key,
          source,
          first_seen_at: firstSeenAt,
          last_seen_at: lastSeenAt,
          seeded,
          meta: item.meta == null ? null : JSON.stringify(item.meta),
        });
        changes++;
      }
      return { meta: { changes } };
    }
    if (query.includes('UPDATE first_seen SET last_seen_at')) {
      const [lastSeenAt, kind, itemsJson] = values as [string, string, string];
      const keys = new Set((JSON.parse(itemsJson) as Array<{ key: string }>).map((i) => i.key));
      let changes = 0;
      for (const row of this.firstSeen) {
        if (row.kind === kind && keys.has(row.key)) {
          row.last_seen_at = lastSeenAt;
          changes++;
        }
      }
      return { meta: { changes } };
    }
    if (query.includes('DELETE FROM first_seen')) {
      const [cutoff, limit] = values as [string, number];
      const stale = this.firstSeen
        .filter((r) => r.last_seen_at < cutoff)
        .sort((a, b) => a.last_seen_at.localeCompare(b.last_seen_at))
        .slice(0, limit);
      this.firstSeen = this.firstSeen.filter((r) => !stale.includes(r));
      return { meta: { changes: stale.length } };
    }
    if (query.includes('INSERT INTO score_series')) {
      const [slot, observedAt, algoVersion, score, level, p7, degraded, cap] = values as [
        string,
        string,
        number,
        number,
        number,
        number | null,
        number,
        number,
      ];
      if (this.scoreSeries.some((r) => r.slot === slot) || this.scoreSeries.length >= cap) {
        return { meta: { changes: 0 } };
      }
      this.scoreSeries.push({
        slot,
        observed_at: observedAt,
        algo_version: algoVersion,
        score,
        level,
        p7,
        degraded,
      });
      return { meta: { changes: 1 } };
    }
    if (query.includes('DELETE FROM score_series')) {
      const [cutoff, limit] = values as [string, number];
      const stale = this.scoreSeries
        .filter((r) => r.observed_at < cutoff)
        .sort((a, b) => a.observed_at.localeCompare(b.observed_at))
        .slice(0, limit);
      this.scoreSeries = this.scoreSeries.filter((r) => !stale.includes(r));
      return { meta: { changes: stale.length } };
    }
    throw new Error(`FakeHistoryDatabase: unhandled run() ${query}`);
  }

  private async first<T>(query: string, values: unknown[]): Promise<T | null> {
    this.calls.push({ query, values });
    if (query.includes('SELECT 1 AS present FROM first_seen')) {
      const [kind] = values as [string];
      return (this.firstSeen.some((r) => r.kind === kind) ? { present: 1 } : null) as T | null;
    }
    if (query.includes('SELECT 1 AS present FROM score_series')) {
      const [slot] = values as [string];
      return (this.scoreSeries.some((r) => r.slot === slot) ? { present: 1 } : null) as T | null;
    }
    if (query.includes('SELECT row_count FROM score_series_metadata')) {
      return { row_count: this.scoreSeries.length } as T;
    }
    throw new Error(`FakeHistoryDatabase: unhandled first() ${query}`);
  }

  private async all<T>(query: string, values: unknown[]): Promise<{ results: T[] }> {
    this.calls.push({ query, values });
    if (query.includes('SELECT key FROM first_seen')) {
      const [kind, firstSeenAt, itemsJson] = values as [string, string, string];
      const keys = new Set((JSON.parse(itemsJson) as Array<{ key: string }>).map((i) => i.key));
      const results = this.firstSeen
        .filter((r) => r.kind === kind && r.first_seen_at === firstSeenAt && keys.has(r.key))
        .map((r) => ({ key: r.key })) as T[];
      return { results };
    }
    if (
      query.includes('SELECT kind, key, source, first_seen_at, last_seen_at, seeded, meta FROM first_seen')
    ) {
      const [kind] = values as [string];
      const results = this.firstSeen
        .filter((r) => r.kind === kind)
        .sort((a, b) => a.first_seen_at.localeCompare(b.first_seen_at)) as T[];
      return { results };
    }
    if (
      query.includes('SELECT slot, observed_at, algo_version, score, level, p7, degraded FROM score_series')
    ) {
      const [sinceIso, limit] = values as [string, number];
      const results = this.scoreSeries
        .filter((r) => r.observed_at >= sinceIso)
        .sort((a, b) => a.observed_at.localeCompare(b.observed_at))
        .slice(0, limit) as T[];
      return { results };
    }
    throw new Error(`FakeHistoryDatabase: unhandled all() ${query}`);
  }
}

describe('recordFirstSeen / readFirstSeen', () => {
  it('seeds a kind with no prior rows as a baseline, reporting nothing as new', async () => {
    const db = new FakeHistoryDatabase();
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
    const db = new FakeHistoryDatabase();
    await recordFirstSeen(db, 'module', 'transformers', [{ key: 'qwen4_exp' }], '2026-09-23T01:00:00.000Z');
    const newKeys = await recordFirstSeen(
      db,
      'module',
      'transformers',
      [{ key: 'qwen4_exp' }, { key: 'glm5' }],
      '2026-09-23T01:15:00.000Z',
    );
    expect(newKeys).toEqual(['glm5']);
    const rows = await readFirstSeen(db, 'module');
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
  });

  it('does nothing for an empty item list, issuing no queries', async () => {
    const db = new FakeHistoryDatabase();
    expect(await recordFirstSeen(db, 'module', 'transformers', [], '2026-09-23T01:00:00.000Z')).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });

  it('prunes items unseen for over 90 days before writing', async () => {
    const db = new FakeHistoryDatabase();
    db.firstSeen.push({
      kind: 'stealth',
      key: 'old',
      source: 'openrouter',
      first_seen_at: '2026-01-01T00:00:00.000Z',
      last_seen_at: '2026-01-01T00:00:00.000Z',
      seeded: 1,
      meta: null,
    });
    await recordFirstSeen(db, 'module', 'transformers', [{ key: 'qwen4_exp' }], '2026-09-23T01:00:00.000Z');
    expect(await readFirstSeen(db, 'stealth')).toEqual([]);
  });

  it('reads an empty ledger for a kind with no rows', async () => {
    expect(await readFirstSeen(new FakeHistoryDatabase(), 'broadcast')).toEqual([]);
  });
});

describe('writeScoreSeries / readScoreSeries', () => {
  it('writes one slot at most once', async () => {
    const db = new FakeHistoryDatabase();
    expect(
      await writeScoreSeries(db, {
        slot: '2026-09-23T01:00:00.000Z',
        observedAt: '2026-09-23T01:00:47.000Z',
        algorithmVersion: 2,
        score: 64,
        level: 2,
        p7: 0.6,
        degraded: false,
      }),
    ).toEqual({ stored: true });
    expect(
      await writeScoreSeries(db, {
        slot: '2026-09-23T01:00:00.000Z',
        observedAt: '2026-09-23T01:00:48.000Z',
        algorithmVersion: 2,
        score: 65,
        level: 2,
        p7: 0.61,
        degraded: false,
      }),
    ).toEqual({ stored: false });
  });

  it('throws when logical capacity is reached, without writing', async () => {
    const db = new FakeHistoryDatabase();
    // Recent enough that pruning (retention: 90 days) evicts none of them before the
    // capacity check runs, so the fixture actually exercises the capacity path.
    for (let i = 0; i < MAX_SNAPSHOT_ROWS; i++) {
      db.scoreSeries.push({
        slot: `slot-${i}`,
        observed_at: '2026-09-22T00:00:00.000Z',
        algo_version: 2,
        score: 0,
        level: 5,
        p7: null,
        degraded: 0,
      });
    }
    await expect(
      writeScoreSeries(db, {
        slot: '2026-09-23T01:00:00.000Z',
        observedAt: '2026-09-23T01:00:00.000Z',
        algorithmVersion: 2,
        score: 1,
        level: 5,
        degraded: false,
      }),
    ).rejects.toThrow('capacity');
  });

  it('reads back narrow columns only, mapping snake_case, booleans and absent odds', async () => {
    const db = new FakeHistoryDatabase();
    await writeScoreSeries(db, {
      slot: '2026-09-23T01:00:00.000Z',
      observedAt: '2026-09-23T01:00:47.000Z',
      algorithmVersion: 2,
      score: 64,
      level: 2,
      p7: 0.6,
      degraded: false,
    });
    await writeScoreSeries(db, {
      slot: '2026-09-23T01:15:00.000Z',
      observedAt: '2026-09-23T01:15:52.000Z',
      algorithmVersion: 2,
      score: 10,
      level: 5,
      degraded: true,
    });
    const rows = await readScoreSeries(db, '2026-09-23T00:00:00.000Z');
    expect(rows).toEqual([
      {
        slot: '2026-09-23T01:00:00.000Z',
        observedAt: '2026-09-23T01:00:47.000Z',
        algorithmVersion: 2,
        score: 64,
        level: 2,
        p7: 0.6,
        degraded: false,
      },
      {
        slot: '2026-09-23T01:15:00.000Z',
        observedAt: '2026-09-23T01:15:52.000Z',
        algorithmVersion: 2,
        score: 10,
        level: 5,
        p7: undefined,
        degraded: true,
      },
    ]);
    const readQuery = db.calls.find((c) => c.query.includes('WHERE observed_at >='))?.query ?? '';
    expect(readQuery).not.toContain('payload_json');
    expect(readQuery).not.toMatch(/select \*/i);
  });

  it('excludes rows before sinceIso and respects the limit', async () => {
    const db = new FakeHistoryDatabase();
    await writeScoreSeries(db, {
      slot: '2026-09-22T00:00:00.000Z',
      observedAt: '2026-09-22T00:00:00.000Z',
      algorithmVersion: 2,
      score: 1,
      level: 5,
      degraded: false,
    });
    await writeScoreSeries(db, {
      slot: '2026-09-23T01:00:00.000Z',
      observedAt: '2026-09-23T01:00:00.000Z',
      algorithmVersion: 2,
      score: 2,
      level: 5,
      degraded: false,
    });
    expect(await readScoreSeries(db, '2026-09-23T00:00:00.000Z')).toHaveLength(1);
    expect(await readScoreSeries(db, '2026-01-01T00:00:00.000Z', 1)).toHaveLength(1);
  });
});
