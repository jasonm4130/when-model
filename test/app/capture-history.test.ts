import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assembleDashboard } from '../../src/domain/dashboard';
import type { SnapshotDatabase } from '../../src/infra/snapshot-store';

const mocks = vi.hoisted(() => ({ build: vi.fn(), store: vi.fn(), writeScoreSeries: vi.fn() }));
vi.mock('../../src/app/load-dashboard', () => ({ buildDashboard: mocks.build }));
vi.mock('../../src/infra/snapshot-store', () => ({
  storeSnapshot: mocks.store,
  writeScoreSeries: mocks.writeScoreSeries,
}));
import { captureHistory } from '../../src/app/capture-history';

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
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('captureHistory', () => {
  it('uses the scheduled quarter-hour and actual completion time independently', async () => {
    await captureHistory(database, now - 15_000);
    expect(mocks.build).toHaveBeenCalledOnce();
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
      p7: dashboard.measurement.inputs.maxWeekOdds,
      degraded: dashboard.dropcon.degraded,
    });
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
});
