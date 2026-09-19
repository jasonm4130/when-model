import type { EdgeCache } from '../../src/infra/edge-cache';

/** In-memory stand-in for the Workers Cache API. Stores response bodies as text. */
export class FakeCache implements EdgeCache {
  readonly store = new Map<string, { body: string; headers: Headers }>();
  puts = 0;

  async match(key: Request): Promise<Response | undefined> {
    const hit = this.store.get(key.url);
    return hit ? new Response(hit.body, { headers: hit.headers }) : undefined;
  }

  async put(key: Request, value: Response): Promise<void> {
    this.puts++;
    this.store.set(key.url, { body: await value.text(), headers: value.headers });
  }
}

export function fetchStub(
  responses: Record<string, string | { status: number; body?: string; type?: string }>,
) {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const r = responses[url];
    if (r === undefined) return new Response('not found', { status: 404 });
    if (typeof r === 'string') return new Response(r, { headers: { 'content-type': 'application/json' } });
    return new Response(r.body ?? '', {
      status: r.status,
      headers: { 'content-type': r.type ?? 'text/plain' },
    });
  }) as typeof fetch;
  return { fn, calls };
}
