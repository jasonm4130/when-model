import type { APIRoute } from 'astro';
import { DASHBOARD_SCHEMA } from '../../domain/dashboard';
import { buildHistorySeries, type DisplayPoint } from '../../domain/history';
import { historyDatabase } from '../../infra/bindings';
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

/** Versioned with the dashboard: a deploy that changes the point shape must not serve the old one. */
export const HISTORY_MEMO_KEY = `history@v${DASHBOARD_SCHEMA}@30d`;

const UNAVAILABLE: HistoryResponseBody = { ok: false, points: [] };

/**
 * A failed read is served but never memoised or cached downstream: one D1 blip must not
 * blank the history strip for the next 15 minutes.
 */
async function historyBody(): Promise<HistoryResponseBody> {
  try {
    return await memoJson(HISTORY_MEMO_KEY, HISTORY_CACHE_TTL_SECONDS, async () => {
      const body = await buildHistoryResponseBody(historyDatabase());
      if (!body.ok) throw new Error('history unavailable');
      return body;
    });
  } catch {
    return UNAVAILABLE;
  }
}

export const GET: APIRoute = async () => {
  const body = await historyBody();
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': body.ok
        ? `public, max-age=60, s-maxage=${HISTORY_CACHE_TTL_SECONDS}, stale-while-revalidate=600`
        : 'no-store',
      'access-control-allow-origin': '*',
    },
  });
};
