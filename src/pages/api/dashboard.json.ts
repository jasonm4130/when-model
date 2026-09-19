import type { APIRoute } from 'astro';
import { buildDashboard } from '../../lib/dashboard';

export const GET: APIRoute = async () => {
  const data = await buildDashboard();
  return new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      'access-control-allow-origin': '*',
    },
  });
};
