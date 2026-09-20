import { describe, expect, it, vi } from 'vitest';
import { cacheKey, cachedJson, cachedText, defaultEdgeCache, memoJson } from '../../src/infra/edge-cache';
import { FakeCache, fetchStub } from './fake-cache';

const URL_A = 'https://upstream.test/a';

describe('cacheKey', () => {
  it('namespaces by kind under our own origin and encodes the id', () => {
    expect(cacheKey('src', 'https://x.test/?a=1&b=2').url).toBe(
      'https://whenmodel.com/__cache/src/https%3A%2F%2Fx.test%2F%3Fa%3D1%26b%3D2',
    );
    expect(cacheKey('memo', 'dashboard').url).toBe('https://whenmodel.com/__cache/memo/dashboard');
  });
});

describe('cachedText', () => {
  it('fetches once, stores the body, then serves from cache', async () => {
    const cache = new FakeCache();
    const { fn, calls } = fetchStub({ [URL_A]: '{"ok":1}' });
    expect(await cachedText(URL_A, { cache, fetch: fn })).toBe('{"ok":1}');
    expect(await cachedText(URL_A, { cache, fetch: fn })).toBe('{"ok":1}');
    expect(calls).toHaveLength(1);
    expect(cache.puts).toBe(1);
    expect(cache.store.get(cacheKey('src', URL_A).url)?.headers.get('cache-control')).toBe(
      'public, max-age=600',
    );
  });

  it('honours ttl and extra headers and identifies itself', async () => {
    const cache = new FakeCache();
    let seen: RequestInit | undefined;
    const fn = (async (_: RequestInfo | URL, init?: RequestInit) => {
      seen = init;
      return new Response('x');
    }) as typeof fetch;
    await cachedText(URL_A, { cache, fetch: fn, ttl: 42, headers: { accept: 'text/html' } });
    const headers = seen?.headers as Record<string, string>;
    expect(headers.accept).toBe('text/html');
    expect(headers['user-agent']).toContain('whenmodel.com');
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    expect(cache.store.get(cacheKey('src', URL_A).url)?.headers.get('cache-control')).toBe(
      'public, max-age=42',
    );
  });

  it('throws on non-2xx and caches nothing', async () => {
    const cache = new FakeCache();
    const { fn } = fetchStub({ [URL_A]: { status: 503 } });
    await expect(cachedText(URL_A, { cache, fetch: fn })).rejects.toThrow('503 https://upstream.test/a');
    expect(cache.puts).toBe(0);
  });

  it('works without any cache at all', async () => {
    const { fn, calls } = fetchStub({ [URL_A]: 'hi' });
    expect(await cachedText(URL_A, { cache: undefined, fetch: fn })).toBe('hi');
    expect(calls).toHaveLength(1);
  });

  it('survives a cache that refuses writes', async () => {
    const cache = new FakeCache();
    cache.put = async () => {
      throw new Error('quota');
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fn } = fetchStub({ [URL_A]: 'hi' });
    expect(await cachedText(URL_A, { cache, fetch: fn })).toBe('hi');
    expect(err).toHaveBeenCalledWith('[cache:put]', expect.stringContaining('__cache/src/'), 'quota');
    err.mockRestore();
  });
});

describe('cachedJson', () => {
  it('parses and defaults to a 5 minute ttl', async () => {
    const cache = new FakeCache();
    const { fn } = fetchStub({ [URL_A]: '{"n":[1,2]}' });
    expect(await cachedJson<{ n: number[] }>(URL_A, { cache, fetch: fn })).toEqual({ n: [1, 2] });
    expect(cache.store.get(cacheKey('src', URL_A).url)?.headers.get('cache-control')).toBe(
      'public, max-age=300',
    );
  });
});

describe('memoJson', () => {
  it('coalesces concurrent cold requests, then rebuilds after expiry', async () => {
    const cache = new FakeCache();
    const build = vi.fn(async () => ({ at: 1 }));
    const results = await Promise.all(Array.from({ length: 3 }, () => memoJson('shared', 60, build, cache)));
    expect(results).toEqual([{ at: 1 }, { at: 1 }, { at: 1 }]);
    expect(build).toHaveBeenCalledTimes(1);
    expect(cache.puts).toBe(1);
    cache.store.clear();
    await memoJson('shared', 60, build, cache);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('releases failed builds so a later request can retry', async () => {
    const cache = new FakeCache();
    const build = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true });
    const results = await Promise.allSettled([
      memoJson('retry', 60, build, cache),
      memoJson('retry', 60, build, cache),
    ]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(build).toHaveBeenCalledTimes(1);
    expect(cache.puts).toBe(0);
    expect(await memoJson('retry', 60, build, cache)).toEqual({ ok: true });
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('isolates distinct keys and cache instances', async () => {
    const first = new FakeCache();
    const second = new FakeCache();
    expect(
      await Promise.all([
        memoJson('a', 60, async () => 1, first),
        memoJson('b', 60, async () => 2, first),
        memoJson('a', 60, async () => 3, second),
      ]),
    ).toEqual([1, 2, 3]);
    expect(first.puts).toBe(2);
    expect(second.puts).toBe(1);
  });

  it('builds once per key and replays the stored value', async () => {
    const cache = new FakeCache();
    const build = vi.fn(async () => ({ at: 1 }));
    expect(await memoJson('k', 60, build, cache)).toEqual({ at: 1 });
    expect(await memoJson('k', 60, build, cache)).toEqual({ at: 1 });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('rebuilds when the cached entry is corrupt', async () => {
    const cache = new FakeCache();
    cache.store.set(cacheKey('memo', 'k').url, { body: '{"trunc', headers: new Headers() });
    const build = vi.fn(async () => ({ fresh: true }));
    expect(await memoJson('k', 60, build, cache)).toEqual({ fresh: true });
    expect(build).toHaveBeenCalledTimes(1);
    expect(cache.store.get(cacheKey('memo', 'k').url)?.body).toBe('{"fresh":true}');
  });

  it('just builds when no cache is available', async () => {
    expect(await memoJson('k', 60, async () => 7, undefined)).toBe(7);
  });
});

describe('defaultEdgeCache', () => {
  it('is undefined outside Workers and picks caches.default inside', () => {
    const original = globalThis.caches;
    vi.stubGlobal('caches', undefined);
    expect(defaultEdgeCache()).toBeUndefined();
    const fake = new FakeCache();
    vi.stubGlobal('caches', { default: fake });
    expect(defaultEdgeCache()).toBe(fake);
    vi.stubGlobal('caches', original);
  });
});
