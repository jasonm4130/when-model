import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assembleDashboard } from '../../src/domain/dashboard';
import type { SnapshotDatabase } from '../../src/infra/snapshot-store';

const mocks = vi.hoisted(() => ({
  build: vi.fn(),
  store: vi.fn(),
  writeScoreSeries: vi.fn(),
  backfillScoreSeries: vi.fn(),
  recordFirstSeen: vi.fn(),
}));
vi.mock('../../src/app/load-dashboard', () => ({ buildDashboard: mocks.build }));
vi.mock('../../src/infra/snapshot-store', () => ({
  storeSnapshot: mocks.store,
  writeScoreSeries: mocks.writeScoreSeries,
  backfillScoreSeries: mocks.backfillScoreSeries,
  recordFirstSeen: mocks.recordFirstSeen,
}));
import { captureHistory } from '../../src/app/capture-history';
import { SqliteD1 } from '../infra/sqlite-d1';

const now = Date.parse('2026-09-23T01:01:00Z');
const dashboard = assembleDashboard(
  {
    markets: { name: 'markets', ok: true, data: [] },
    drops: { name: 'drops', ok: true, data: [] },
    papers: { name: 'papers', ok: true, data: [] },
    trending: { name: 'trending', ok: true, data: [] },
    feeds: [],
  },
  now - 5000,
);
const database = {} as SnapshotDatabase;

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.build.mockReset().mockResolvedValue(dashboard);
  mocks.store.mockReset().mockResolvedValue({ stored: true });
  mocks.writeScoreSeries.mockReset().mockResolvedValue({ stored: true });
  mocks.backfillScoreSeries.mockReset().mockResolvedValue(undefined);
  mocks.recordFirstSeen.mockReset().mockResolvedValue([]);
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('captureHistory', () => {
  it('uses the scheduled quarter-hour and actual completion time independently', async () => {
    await captureHistory(database, now - 15_000);
    expect(mocks.build).toHaveBeenCalledOnce();
    // The capture's own binding backs the first-seen ledger and the repricing read.
    expect(mocks.build).toHaveBeenCalledWith(now, database);
    expect(mocks.store).toHaveBeenCalledWith(database, {
      scheduledSlot: '2026-09-23T01:00:00.000Z',
      observedAt: '2026-09-23T01:01:00.000Z',
      dashboard,
      now,
    });
  });
  it('fails visibly if storage is missing, over budget or unavailable', async () => {
    await expect(captureHistory(undefined as unknown as SnapshotDatabase, now)).rejects.toThrow('HISTORY_DB');
    expect(mocks.build).not.toHaveBeenCalled();
    mocks.store.mockRejectedValue(new Error('history capacity reached'));
    await expect(captureHistory(database, now)).rejects.toThrow('capacity');
  });
  it('writes the narrow score-series rollup alongside the snapshot', async () => {
    await captureHistory(database, now);
    expect(mocks.writeScoreSeries).toHaveBeenCalledWith(database, {
      slot: '2026-09-23T01:00:00.000Z',
      observedAt: '2026-09-23T01:01:00.000Z',
      algorithmVersion: dashboard.measurement.algorithmVersion,
      score: dashboard.dropcon.score,
      level: dashboard.dropcon.level,
      headlineP: dashboard.measurement.inputs.p7,
      degraded: dashboard.dropcon.degraded,
    });
  });
  it('records no headline probability when the odds source was down, rather than a placeholder 0', async () => {
    const offline = assembleDashboard(
      {
        markets: { name: 'markets', ok: false, error: 'timeout', data: [] },
        drops: { name: 'drops', ok: true, data: [] },
        papers: { name: 'papers', ok: true, data: [] },
        trending: { name: 'trending', ok: true, data: [] },
        feeds: [],
      },
      now - 5000,
    );
    expect(offline.measurement.inputs.p7).toBe(0);
    mocks.build.mockResolvedValue(offline);
    await captureHistory(database, now);
    expect(mocks.writeScoreSeries).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ headlineP: null, degraded: true }),
    );
  });
  it('catches up missing rollup rows after writing this slot, isolating a failure', async () => {
    mocks.backfillScoreSeries.mockRejectedValue(new Error('D1_ERROR'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(captureHistory(database, now)).resolves.toBeUndefined();
    expect(mocks.backfillScoreSeries).toHaveBeenCalledWith(database, '2026-09-23T01:01:00.000Z');
    expect(mocks.writeScoreSeries.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.backfillScoreSeries.mock.invocationCallOrder[0],
    );
    expect(err).toHaveBeenCalledWith('[history:score-backfill]', 'D1_ERROR');
  });
  it('writes the snapshot and its rollup row to real D1 tables in one capture', async () => {
    const actual = await vi.importActual<typeof import('../../src/infra/snapshot-store')>(
      '../../src/infra/snapshot-store',
    );
    mocks.store.mockImplementation(actual.storeSnapshot);
    mocks.writeScoreSeries.mockImplementation(actual.writeScoreSeries);
    mocks.backfillScoreSeries.mockImplementation(actual.backfillScoreSeries);
    const db = new SqliteD1();
    await captureHistory(db, now);
    await captureHistory(db, now);
    expect(db.sqlite.prepare('SELECT scheduled_slot FROM dashboard_snapshots').all()).toEqual([
      { scheduled_slot: '2026-09-23T01:00:00.000Z' },
    ]);
    expect(await actual.readScoreSeries(db, '2026-09-23T00:00:00.000Z')).toEqual([
      {
        slot: '2026-09-23T01:00:00.000Z',
        observedAt: '2026-09-23T01:01:00.000Z',
        algorithmVersion: dashboard.measurement.algorithmVersion,
        score: dashboard.dropcon.score,
        level: dashboard.dropcon.level,
        headlineP: 0,
        degraded: false,
      },
    ]);
  });
  it('never lets a score-series failure cost the slot', async () => {
    mocks.writeScoreSeries.mockRejectedValue(new Error('score series logical capacity reached'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(captureHistory(database, now)).resolves.toBeUndefined();
    expect(mocks.store).toHaveBeenCalledOnce();
    expect(err).toHaveBeenCalledWith('[history:score-series]', 'score series logical capacity reached');
  });
  it('runs first-seen hooks with the dashboard and observation time, isolating a failing one', async () => {
    const ok = vi.fn().mockResolvedValue(undefined);
    const failing = vi.fn().mockRejectedValue(new Error('endpoint unreachable'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await captureHistory(database, now, { firstSeenHooks: [ok, failing] });
    expect(ok).toHaveBeenCalledWith(database, dashboard, '2026-09-23T01:01:00.000Z');
    expect(failing).toHaveBeenCalledWith(database, dashboard, '2026-09-23T01:01:00.000Z');
    expect(err).toHaveBeenCalledWith('[history:first-seen]', 'endpoint unreachable');
    expect(mocks.store).toHaveBeenCalledOnce();
  });
  it('records first sightings by default, only for sources that were ok this capture', async () => {
    const sighted = assembleDashboard(
      {
        markets: { name: 'Polymarket', ok: true, data: [] },
        drops: {
          name: 'OpenRouter',
          ok: true,
          data: [
            {
              id: 'stealth/ox-alpha',
              name: 'Ox Alpha',
              lab: 'Stealth',
              createdAt: '2026-09-22T00:00:00.000Z',
              url: 'https://openrouter.ai/stealth/ox-alpha',
              free: true,
            },
          ],
        },
        papers: { name: 'HF papers', ok: true, data: [] },
        trending: { name: 'HF trending', ok: true, data: [] },
        feeds: [
          {
            name: 'Anthropic news',
            ok: true,
            data: [
              {
                source: 'anthropic',
                title: 'Introducing Claude Sonnet 5',
                url: 'https://www.anthropic.com/news/claude-sonnet-5',
                publishedAt: '2026-09-22T00:00:00.000Z',
                alert: true,
                precision: 'day',
              },
            ],
          },
        ],
        leaks: [
          {
            name: 'TestingCatalog',
            ok: false,
            error: 'timeout',
            source: 'testingcatalog',
            data: [],
          },
        ],
      },
      now - 5000,
    );
    mocks.build.mockResolvedValue(sighted);
    await captureHistory(database, now);
    const kinds = mocks.recordFirstSeen.mock.calls.map((c) => c[1]);
    expect(kinds).toEqual(['stealth', 'feed-day:anthropic']);
    expect(mocks.recordFirstSeen).toHaveBeenCalledWith(
      database,
      'stealth',
      'openrouter',
      [{ key: 'stealth/ox-alpha', meta: { name: 'Ox Alpha' } }],
      '2026-09-23T01:01:00.000Z',
    );
  });
  it('keeps recording the other kinds when one first-seen write fails', async () => {
    const actual = await vi.importActual<typeof import('../../src/app/capture-history')>(
      '../../src/app/capture-history',
    );
    mocks.recordFirstSeen.mockRejectedValueOnce(new Error('D1 busy'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const withTwo = {
      ...dashboard,
      earlyWarnings: {
        ...dashboard.earlyWarnings,
        stealth: {
          ...dashboard.earlyWarnings.stealth,
          ok: true,
          items: [{ id: 's', name: 'S', createdAt: '', daysInStealth: 0, claimsFrontier: false }],
        },
        architectures: {
          ...dashboard.earlyWarnings.architectures,
          ok: true,
          items: [
            {
              module: 'qwen9',
              labId: 'qwen' as const,
              since: '',
              sinceSource: 'detected' as const,
              daysPending: 0,
              pending: true,
              frontier: false,
            },
          ],
        },
      },
    };
    await actual.recordDashboardFirstSeen(database, withTwo, '2026-09-23T01:01:00.000Z');
    expect(mocks.recordFirstSeen.mock.calls.map((c) => c[1])).toEqual(['stealth', 'architecture']);
    expect(err).toHaveBeenCalledWith('[history:first-seen]', 'stealth', 'D1 busy');
  });
});
