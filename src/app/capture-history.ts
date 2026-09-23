import { buildDashboard } from './load-dashboard';
import { storeSnapshot, type SnapshotDatabase } from '../infra/snapshot-store';

/** Fetch fresh assembled inputs; stamp observation time only after every source has settled. */
export async function captureHistory(database: SnapshotDatabase, scheduledTime: number): Promise<void> {
  if (!database) throw new Error('HISTORY_DB binding is required for scheduled capture');
  const interval = 15 * 60_000;
  const scheduledSlot = new Date(Math.floor(scheduledTime / interval) * interval).toISOString();
  const dashboard = await buildDashboard();
  const now = Date.now();
  const result = await storeSnapshot(database, {
    scheduledSlot,
    observedAt: new Date(now).toISOString(),
    dashboard,
    now,
  });
  console.log(
    '[history]',
    JSON.stringify({ scheduledSlot, stored: result.stored, generatedAt: dashboard.generatedAt }),
  );
}
