import { env } from 'cloudflare:workers';
import type { SnapshotDatabase } from './snapshot-store';

/**
 * The `HISTORY_DB` binding, or undefined when it is not configured. Astro v6 removed
 * `Astro.locals.runtime.env`; the Cloudflare adapter's own handler points at this import instead
 * (the module is declared once, in src/infra/cloudflare-env.d.ts).
 */
export function historyDatabase(): SnapshotDatabase | undefined {
  return env.HISTORY_DB as SnapshotDatabase | undefined;
}
