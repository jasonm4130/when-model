import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assembleDashboard } from '../../src/domain/dashboard';
import type { SnapshotDatabase } from '../../src/infra/snapshot-store';

const mocks = vi.hoisted(() => ({ build: vi.fn(), store: vi.fn() }));
vi.mock('../../src/app/load-dashboard', () => ({ buildDashboard: mocks.build }));
vi.mock('../../src/infra/snapshot-store', () => ({ storeSnapshot: mocks.store }));
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
});
