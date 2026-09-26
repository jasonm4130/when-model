import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeScoreSeries, type SnapshotDatabase } from '../../src/infra/snapshot-store';
import { FakeCache } from '../infra/fake-cache';
import { SqliteD1 } from '../infra/sqlite-d1';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('cloudflare:workers');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NOW = Date.parse('2026-09-26T00:30:00.000Z');
const SLOT = 15 * 60_000;

/** A D1 stand-in running the real migrations, holding 31 days of 15-minute readings. */
async function seededDatabase(): Promise<SqliteD1> {
  const db = new SqliteD1();
  const first = NOW - 31 * 24 * 60 * 60_000;
  db.sqlite.exec('BEGIN');
  const insert = db.sqlite.prepare(
    'INSERT INTO score_series (slot, observed_at, algo_version, score, level, headline_p, degraded) VALUES (?, ?, 2, 64, 2, 0.6, 0)',
  );
  for (let slot = first; slot < NOW - SLOT; slot += SLOT) {
    insert.run(new Date(slot).toISOString(), new Date(slot + 40_000).toISOString());
  }
  db.sqlite.exec('COMMIT');
  // The newest reading, through the production write path.
  await writeScoreSeries(db, {
    slot: new Date(NOW - SLOT).toISOString(),
    observedAt: new Date(NOW - SLOT + 40_000).toISOString(),
    algorithmVersion: 2,
    score: 95,
    level: 1,
    headlineP: 0.865,
    degraded: false,
  });
  return db;
}

async function loadRoute(database: SnapshotDatabase | undefined) {
  vi.doMock('cloudflare:workers', () => ({ env: database ? { HISTORY_DB: database } : {} }));
  return import('../../src/pages/api/history.json');
}

async function get(route: Awaited<ReturnType<typeof loadRoute>>): Promise<Response> {
  return (route.GET as unknown as () => Promise<Response>)();
}

describe('buildHistoryResponseBody', () => {
  it('degrades to no signal when the HISTORY_DB binding is absent', async () => {
    const { buildHistoryResponseBody } = await loadRoute(undefined);
    expect(await buildHistoryResponseBody(undefined)).toEqual({ ok: false, points: [] });
  });

  it('returns the last 30 days as hourly points, ending with the newest reading', async () => {
    const db = await seededDatabase();
    const { buildHistoryResponseBody, HISTORY_WINDOW_MS } = await loadRoute(db);
    const body = await buildHistoryResponseBody(db, NOW);
    expect(body.ok).toBe(true);
    // 30 days of hours, give or take the partial hour at each end of the window.
    expect(body.points.length).toBeGreaterThanOrEqual(30 * 24);
    expect(body.points.length).toBeLessThanOrEqual(30 * 24 + 1);
    expect(body.points[0].observedAt >= new Date(NOW - HISTORY_WINDOW_MS).toISOString()).toBe(true);
    expect(body.points.at(-1)).toEqual({
      slot: '2026-09-26T00:15:00.000Z',
      observedAt: '2026-09-26T00:15:40.000Z',
      algorithmVersion: 2,
      score: 95,
      level: 1,
      headlineP: 0.865,
      degraded: false,
      // 95 clears level 1's boundary by 20, so hysteresis shows it at once.
      displayLevel: 1,
    });
    const read = db.queries.find((q) => q.includes('FROM score_series WHERE observed_at'));
    expect(read).toBeDefined();
    expect(read).not.toContain('payload_json');
  });

  it('degrades to no signal, never throwing, when D1 itself fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = new SqliteD1([]); // no tables: every query errors like an unmigrated D1
    const { buildHistoryResponseBody } = await loadRoute(broken);
    await expect(buildHistoryResponseBody(broken, NOW)).resolves.toEqual({ ok: false, points: [] });
    expect(err).toHaveBeenCalledWith('[history-api]', expect.stringContaining('no such table: score_series'));
  });
});

describe('GET /api/history.json', () => {
  it('reads the D1 binding from the cloudflare:workers env, is CORS-open and cacheable for 15 minutes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const route = await loadRoute(await seededDatabase());
    const res = await get(route);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toContain(`s-maxage=${route.HISTORY_CACHE_TTL_SECONDS}`);
    const body = (await res.json()) as { ok: boolean; points: Array<{ score: number }> };
    expect(body.ok).toBe(true);
    expect(body.points.at(-1)?.score).toBe(95);
  });

  it('memoises a good read in the edge cache under one key', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const cache = new FakeCache();
    vi.stubGlobal('caches', { default: cache });
    const db = await seededDatabase();
    const route = await loadRoute(db);
    await get(route);
    const reads = db.queries.length;
    expect((await (await get(route)).json()).ok).toBe(true);
    expect(db.queries.length).toBe(reads);
    expect([...cache.store.keys()]).toEqual(['https://whenmodel.com/__cache/memo/history%40v4%4030d']);
  });

  it('serves a failed read uncached, so the next request after D1 recovers gets data', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const cache = new FakeCache();
    vi.stubGlobal('caches', { default: cache });
    const db = await seededDatabase();
    const route = await loadRoute(db);
    const prepare = vi.spyOn(db, 'prepare').mockImplementationOnce(() => {
      throw new Error('D1_ERROR: network connection lost');
    });
    const failed = await get(route);
    expect(await failed.json()).toEqual({ ok: false, points: [] });
    expect(failed.headers.get('cache-control')).toBe('no-store');
    expect(cache.puts).toBe(0);
    prepare.mockRestore();
    expect((await (await get(route)).json()).ok).toBe(true);
  });

  it('degrades cleanly when the binding is missing entirely', async () => {
    const route = await loadRoute(undefined);
    const res = await get(route);
    expect(await res.json()).toEqual({ ok: false, points: [] });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
