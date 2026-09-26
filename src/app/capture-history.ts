import type { Dashboard } from '../domain/dashboard';
import { storeSnapshot, writeScoreSeries, type SnapshotDatabase } from '../infra/snapshot-store';
import { buildDashboard } from './load-dashboard';

/**
 * Records first-seen kinds (a stealth slot, a pending architecture module, a scheduled
 * broadcast, ...) from one capture's dashboard. None are wired yet: a later package
 * supplies these once the adapters that produce those candidates exist.
 */
export type FirstSeenHook = (
  database: SnapshotDatabase,
  dashboard: Dashboard,
  nowIso: string,
) => Promise<void>;

export interface CaptureHistoryOptions {
  firstSeenHooks?: readonly FirstSeenHook[];
}

/** Fetch fresh assembled inputs; stamp observation time only after every source has settled. */
export async function captureHistory(
  database: SnapshotDatabase,
  scheduledTime: number,
  options: CaptureHistoryOptions = {},
): Promise<void> {
  if (!database) throw new Error('HISTORY_DB binding is required for scheduled capture');
  const interval = 15 * 60_000;
  const scheduledSlot = new Date(Math.floor(scheduledTime / interval) * interval).toISOString();
  const dashboard = await buildDashboard();
  const now = Date.now();
  const observedAt = new Date(now).toISOString();
  const result = await storeSnapshot(database, {
    scheduledSlot,
    observedAt,
    dashboard,
    now,
  });
  // The snapshot above is the record of truth; a rollup or ledger failure here must
  // never cost the slot, so each is isolated in its own try/catch.
  try {
    await writeScoreSeries(database, {
      slot: scheduledSlot,
      observedAt,
      algorithmVersion: dashboard.measurement.algorithmVersion,
      score: dashboard.dropcon.score,
      level: dashboard.dropcon.level,
      p7: dashboard.measurement.inputs.maxWeekOdds,
      degraded: dashboard.dropcon.degraded,
    });
  } catch (e) {
    console.error('[history:score-series]', e instanceof Error ? e.message : e);
  }
  for (const hook of options.firstSeenHooks ?? []) {
    try {
      await hook(database, dashboard, observedAt);
    } catch (e) {
      console.error('[history:first-seen]', e instanceof Error ? e.message : e);
    }
  }
  console.log(
    '[history]',
    JSON.stringify({ scheduledSlot, stored: result.stored, generatedAt: dashboard.generatedAt }),
  );
}
