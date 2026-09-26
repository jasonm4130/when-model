import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScoreSeriesRow, SnapshotDatabase } from '../../src/infra/snapshot-store';

const mocks = vi.hoisted(() => ({ memoJson: vi.fn(), readScoreSeries: vi.fn() }));
vi.mock('../../src/infra/edge-cache', () => ({ memoJson: mocks.memoJson }));
vi.mock('../../src/infra/snapshot-store', () => ({ readScoreSeries: mocks.readScoreSeries }));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('cloudflare:workers');
});

const rows: ScoreSeriesRow[] = [
  {
    slot: '2026-09-23T01:00:00.000Z',
    observedAt: '2026-09-23T01:00:47.000Z',
    algorithmVersion: 2,
    score: 64,
    level: 2,
    p7: 0.6,
    degraded: false,
  },
];

async function loadRoute() {
  return import('../../src/pages/api/history.json');
}

describe('buildHistoryResponseBody', () => {
  it('degrades to no signal when the HISTORY_DB binding is absent', async () => {
    vi.doMock('cloudflare:workers', () => ({ env: {} }));
    const { buildHistoryResponseBody } = await loadRoute();
    expect(await buildHistoryResponseBody(undefined)).toEqual({ ok: false, points: [] });
    expect(mocks.readScoreSeries).not.toHaveBeenCalled();
  });

  it('reads the last 30 days and returns the built history series', async () => {
    vi.doMock('cloudflare:workers', () => ({ env: {} }));
    mocks.readScoreSeries.mockReset().mockResolvedValue(rows);
    const { buildHistoryResponseBody, HISTORY_WINDOW_MS, HISTORY_MAX_ROWS } = await loadRoute();
    const now = Date.parse('2026-09-26T00:00:00.000Z');
    const database = {} as SnapshotDatabase;
    const body = await buildHistoryResponseBody(database, now);
    expect(mocks.readScoreSeries).toHaveBeenCalledWith(
      database,
      new Date(now - HISTORY_WINDOW_MS).toISOString(),
      HISTORY_MAX_ROWS,
    );
    expect(body).toEqual({ ok: true, points: [{ ...rows[0], displayLevel: 2 }] });
  });

  it('degrades to no signal, never throwing, when D1 itself fails', async () => {
    vi.doMock('cloudflare:workers', () => ({ env: {} }));
    mocks.readScoreSeries.mockReset().mockRejectedValue(new Error('D1_ERROR'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { buildHistoryResponseBody } = await loadRoute();
    await expect(buildHistoryResponseBody({} as SnapshotDatabase)).resolves.toEqual({
      ok: false,
      points: [],
    });
    expect(err).toHaveBeenCalledWith('[history-api]', 'D1_ERROR');
  });
});

describe('GET /api/history.json', () => {
  it('reads the D1 binding from the cloudflare:workers env, memoises for 15 minutes, and is CORS-open', async () => {
    const database = {} as SnapshotDatabase;
    vi.doMock('cloudflare:workers', () => ({ env: { HISTORY_DB: database } }));
    mocks.memoJson.mockReset().mockImplementation(async (_key, _ttl, build) => build());
    mocks.readScoreSeries.mockReset().mockResolvedValue(rows);
    const { GET, HISTORY_CACHE_TTL_SECONDS } = await loadRoute();
    const res = await (GET as unknown as () => Promise<Response>)();
    expect(mocks.memoJson).toHaveBeenCalledWith(
      'history@30d',
      HISTORY_CACHE_TTL_SECONDS,
      expect.any(Function),
    );
    expect(mocks.readScoreSeries).toHaveBeenCalledWith(database, expect.any(String), expect.any(Number));
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toContain(`s-maxage=${HISTORY_CACHE_TTL_SECONDS}`);
    expect(await res.json()).toEqual({ ok: true, points: [{ ...rows[0], displayLevel: 2 }] });
  });

  it('degrades cleanly when the binding is missing entirely', async () => {
    vi.doMock('cloudflare:workers', () => ({ env: {} }));
    mocks.memoJson.mockReset().mockImplementation(async (_key, _ttl, build) => build());
    const { GET } = await loadRoute();
    const res = await (GET as unknown as () => Promise<Response>)();
    expect(await res.json()).toEqual({ ok: false, points: [] });
  });
});
