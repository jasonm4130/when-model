import type { APIRoute } from 'astro';
import { HISTORY_CACHE_TTL_SECONDS, loadHistory } from '../../app/load-dashboard';

// The series is built and memoised in src/app/load-dashboard.ts, which the page's DROPCON instrument
// shares; these re-exports keep the endpoint's contract importable from the route.
export {
  HISTORY_CACHE_TTL_SECONDS,
  HISTORY_MAX_ROWS,
  HISTORY_MEMO_KEY,
  HISTORY_WINDOW_MS,
  buildHistoryResponseBody,
  type HistoryResponseBody,
} from '../../app/load-dashboard';

export const GET: APIRoute = async () => {
  const body = await loadHistory();
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
