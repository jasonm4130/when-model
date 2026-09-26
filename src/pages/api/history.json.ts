import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { buildHistorySeries, type DisplayPoint } from '../../domain/history';
import { memoJson } from '../../infra/edge-cache';
import { readScoreSeries, type SnapshotDatabase } from '../../infra/snapshot-store';

export const HISTORY_WINDOW_MS = 30 * 24 * 60 * 60_000;
export const HISTORY_CACHE_TTL_SECONDS = 15 * 60;
/** 30 days of 15-minute slots; a stricter cap than `readScoreSeries`'s own default. */
export const HISTORY_MAX_ROWS = 30 * 24 * 4;

export interface HistoryResponseBody {
  ok: boolean;
  points: DisplayPoint[];
}

/** Everything that can fail here degrades to `{ ok: false, points: [] }`; this never throws. */
export async function buildHistoryResponseBody(
  database: SnapshotDatabase | undefined,
  now = Date.now(),
): Promise<HistoryResponseBody> {
  if (!database) return { ok: false, points: [] };
  try {
    const since = new Date(now - HISTORY_WINDOW_MS).toISOString();
    const rows = await readScoreSeries(database, since, HISTORY_MAX_ROWS);
    return { ok: true, points: buildHistorySeries(rows) };
  } catch (e) {
    console.error('[history-api]', e instanceof Error ? e.message : e);
    return { ok: false, points: [] };
  }
}

/**
 * Astro v6 removed `Astro.locals.runtime.env`; the Cloudflare adapter's own handler now
 * points at this import instead (see src/infra/cloudflare-env.d.ts).
 */
function historyDatabase(): SnapshotDatabase | undefined {
  return env.HISTORY_DB as SnapshotDatabase | undefined;
}

export const GET: APIRoute = async () => {
  const body = await memoJson('history@30d', HISTORY_CACHE_TTL_SECONDS, () =>
    buildHistoryResponseBody(historyDatabase()),
  );
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=60, s-maxage=${HISTORY_CACHE_TTL_SECONDS}, stale-while-revalidate=600`,
      'access-control-allow-origin': '*',
    },
  });
};
