import { describe, expect, it } from 'vitest';
import {
  MAX_CLEANUP_ROWS,
  MAX_TOTAL_PAYLOAD_BYTES,
  compactSnapshot,
  snapshotPayload,
  storeSnapshot,
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
