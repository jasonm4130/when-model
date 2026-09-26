import type { Dashboard } from '../domain/dashboard';
import { headlineProbability } from '../domain/dropcon';
import { firstSeenBatches } from '../domain/ledger';
import {
  backfillScoreSeries,
  recordFirstSeen,
  storeSnapshot,
  writeScoreSeries,
  type SnapshotDatabase,
} from '../infra/snapshot-store';
import { buildDashboard } from './load-dashboard';

/**
 * Records first-seen kinds (a stealth slot, a pending architecture module, a scheduled
 * broadcast, ...) from one capture's dashboard, keyed by `nowIso`, the capture's sighting time.
 */
export type FirstSeenHook = (
  database: SnapshotDatabase,
  dashboard: Dashboard,
  nowIso: string,
) => Promise<void>;

/**
 * The default hook: every kind in `firstSeenBatches`, which leaves out any source whose
 * `collect()` was not ok this capture. One kind failing does not stop the others.
 */
export const recordDashboardFirstSeen: FirstSeenHook = async (database, dashboard, nowIso) => {
  for (const batch of firstSeenBatches(dashboard)) {
    try {
      await recordFirstSeen(database, batch.kind, batch.source, batch.items, nowIso);
    } catch (e) {
      console.error('[history:first-seen]', batch.kind, e instanceof Error ? e.message : e);
    }
  }
};

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
  const dashboard = await buildDashboard(Date.now(), database);
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
  const { inputs } = dashboard.measurement;
  try {
    await writeScoreSeries(database, {
      slot: scheduledSlot,
      observedAt,
      algorithmVersion: dashboard.measurement.algorithmVersion,
      score: dashboard.dropcon.score,
      level: dashboard.dropcon.level,
      // With the odds source down P7 is a placeholder 0, not a price.
      headlineP: headlineProbability(inputs),
      degraded: dashboard.dropcon.degraded,
    });
  } catch (e) {
    console.error('[history:score-series]', e instanceof Error ? e.message : e);
  }
  try {
    await backfillScoreSeries(database, observedAt);
  } catch (e) {
    console.error('[history:score-backfill]', e instanceof Error ? e.message : e);
  }
  for (const hook of options.firstSeenHooks ?? [recordDashboardFirstSeen]) {
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
