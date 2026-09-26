import { describe, expect, it, vi } from 'vitest';
import {
  cacheKey,
  cachedJson,
  cachedText,
  cachedTextOrStale,
  defaultEdgeCache,
  memoJson,
} from '../../src/infra/edge-cache';
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

  it('does not store a freshly fetched body that fails validation, returning false', async () => {
    const cache = new FakeCache();
    const { fn } = fetchStub({ [URL_A]: '{"items":[]}' });
    const validate = vi.fn().mockReturnValue(false);
    await expect(cachedText(URL_A, { cache, fetch: fn, validate })).rejects.toThrow('failed validation');
    expect(validate).toHaveBeenCalledWith('{"items":[]}');
    expect(cache.puts).toBe(0);
  });

  it('propagates a thrown validation error unchanged, and does not store', async () => {
    const cache = new FakeCache();
    const { fn } = fetchStub({ [URL_A]: 'not xml' });
    const validate = vi.fn(() => {
      throw new Error('zero items parsed');
    });
    await expect(cachedText(URL_A, { cache, fetch: fn, validate })).rejects.toThrow('zero items parsed');
    expect(cache.puts).toBe(0);
  });

  it('stores a body that passes validation', async () => {
    const cache = new FakeCache();
    const { fn } = fetchStub({ [URL_A]: '{"items":[1]}' });
    expect(await cachedText(URL_A, { cache, fetch: fn, validate: (body) => body.includes('items') })).toBe(
      '{"items":[1]}',
    );
    expect(cache.puts).toBe(1);
  });

  it('never re-runs validate on a cache hit', async () => {
    const cache = new FakeCache();
    const { fn } = fetchStub({ [URL_A]: 'ok' });
    const validate = vi.fn().mockReturnValue(true);
    await cachedText(URL_A, { cache, fetch: fn, validate });
    await cachedText(URL_A, { cache, fetch: fn, validate });
    expect(validate).toHaveBeenCalledTimes(1);
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

describe('cachedTextOrStale', () => {
  const T0 = Date.parse('2026-09-26T12:00:00Z');
  const expire = (cache: FakeCache) => cache.store.delete(cacheKey('src', URL_A).url);

  it('keeps a last good copy of a fresh body, stamped with when it was fetched', async () => {
    vi.useFakeTimers({ now: T0 });
    try {
      const cache = new FakeCache();
      const { fn } = fetchStub({ [URL_A]: 'good' });
      expect(await cachedTextOrStale(URL_A, { cache, fetch: fn, ttl: 1800, staleTtl: 7200 })).toEqual({
        text: 'good',
      });
      const copy = cache.store.get(cacheKey('stale', URL_A).url);
      expect(copy?.body).toBe('good');
      expect(copy?.headers.get('cache-control')).toBe('public, max-age=7200');
      expect(copy?.headers.get('x-whenmodel-fetched-at')).toBe('2026-09-26T12:00:00.000Z');
      // A cache hit is not a fresh fetch: the copy keeps its original stamp.
      vi.setSystemTime(T0 + 60_000);
      await cachedTextOrStale(URL_A, { cache, fetch: fn, ttl: 1800, staleTtl: 7200 });
      expect(cache.puts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves the last good copy with its fetch time when the upstream fails', async () => {
    vi.useFakeTimers({ now: T0 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const cache = new FakeCache();
      await cachedTextOrStale(URL_A, { cache, fetch: fetchStub({ [URL_A]: 'good' }).fn, staleTtl: 7200 });
      expire(cache);
      vi.setSystemTime(T0 + 7200_000);
      const failing = fetchStub({ [URL_A]: { status: 404 } }).fn;
      expect(await cachedTextOrStale(URL_A, { cache, fetch: failing, staleTtl: 7200 })).toEqual({
        text: 'good',
        stale: { fetchedAt: '2026-09-26T12:00:00.000Z' },
      });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
  });

  it('serves the copy when a fresh body fails validation, and never keeps that body', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new FakeCache();
    const validate = (b: string) => {
      if (b !== 'good') throw new Error('not the feed');
      return true;
    };
    await cachedTextOrStale(URL_A, {
      cache,
      fetch: fetchStub({ [URL_A]: 'good' }).fn,
      validate,
      staleTtl: 60,
    });
    expire(cache);
    const junk = fetchStub({ [URL_A]: '<html>consent</html>' }).fn;
    const out = await cachedTextOrStale(URL_A, { cache, fetch: junk, validate, staleTtl: 60 });
    expect(out.text).toBe('good');
    expect(out.stale).toBeDefined();
    expect(cache.store.get(cacheKey('stale', URL_A).url)?.body).toBe('good');
    expect(cache.store.has(cacheKey('src', URL_A).url)).toBe(false);
    vi.restoreAllMocks();
  });

  it('rethrows the upstream error when the copy is older than staleTtl, or there is none', async () => {
    vi.useFakeTimers({ now: T0 });
    try {
      const cache = new FakeCache();
      const failing = fetchStub({ [URL_A]: { status: 503 } }).fn;
      await expect(cachedTextOrStale(URL_A, { cache, fetch: failing, staleTtl: 7200 })).rejects.toThrow(
        '503 https://upstream.test/a',
      );
      await cachedTextOrStale(URL_A, { cache, fetch: fetchStub({ [URL_A]: 'good' }).fn, staleTtl: 7200 });
      expire(cache);
      // The Cache API may keep an entry past max-age; the stamp, not the store, decides.
      vi.setSystemTime(T0 + 7200_001);
      await expect(cachedTextOrStale(URL_A, { cache, fetch: failing, staleTtl: 7200 })).rejects.toThrow(
        '503 https://upstream.test/a',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('rethrows when there is no cache at all', async () => {
    const failing = fetchStub({ [URL_A]: { status: 500 } }).fn;
    await expect(
      cachedTextOrStale(URL_A, { cache: undefined, fetch: failing, staleTtl: 60 }),
    ).rejects.toThrow('500');
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

  it('validates the raw body before parsing, not the parsed value', async () => {
    const cache = new FakeCache();
    const { fn } = fetchStub({ [URL_A]: '{"n":[]}' });
    await expect(
      cachedJson(URL_A, { cache, fetch: fn, validate: (body) => JSON.parse(body).n.length > 0 }),
    ).rejects.toThrow('failed validation');
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
