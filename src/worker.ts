import server from '@astrojs/cloudflare/entrypoints/server';
import { captureHistory } from './app/capture-history';
import type { SnapshotDatabase } from './infra/snapshot-store';

/** Scheduled history is independent of visitor traffic and the per-colo dashboard cache. */
export default {
  ...server,
  async scheduled(controller: { scheduledTime: number }, env: { HISTORY_DB: SnapshotDatabase }) {
    await captureHistory(env.HISTORY_DB, controller.scheduledTime);
  },
};
