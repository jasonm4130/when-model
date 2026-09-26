import { vi } from 'vitest';

/** A body `cachedTextOrStale` serves from its last good copy, fetched at `fetchedAt`. */
export class StaleBody {
  constructor(
    readonly text: string,
    readonly fetchedAt: string,
  ) {}
}

/**
 * Replace the edge-cache module with a lookup table: URL → parsed body (JSON) or raw text.
 * Adapters never touch the network in tests.
 */
export function mockUpstream(responses: Record<string, unknown>) {
  const calls: string[] = [];
  const lookup = (url: string) => {
    calls.push(url);
    const hit = Object.entries(responses).find(([k]) => url.startsWith(k));
    if (!hit) throw new Error(`404 ${url}`);
    return hit[1];
  };
  vi.doMock('../../src/infra/edge-cache', () => ({
    cachedJson: vi.fn(async (url: string) => lookup(url)),
    cachedText: vi.fn(async (url: string) => String(lookup(url))),
    cachedTextOrStale: vi.fn(async (url: string) => {
      const body = lookup(url);
      return body instanceof StaleBody
        ? { text: body.text, stale: { fetchedAt: body.fetchedAt } }
        : { text: String(body) };
    }),
    memoJson: vi.fn(async (_: string, __: number, build: () => Promise<unknown>) => build()),
  }));
  return calls;
}
