/**
 * Upstream fetches and memoisation on the Workers Cache API (per colo).
 *
 * Bodies are buffered to text before caching. Streaming a `Response.clone()` branch into
 * `cache.put` while parsing the other truncated JSON at the tee boundary in production.
 */

const USER_AGENT = 'whenmodel.com/1.0 (+https://whenmodel.com; signal dashboard)';
/** A slow upstream aborts here so it can never orphan a cache write. */
export const UPSTREAM_TIMEOUT_MS = 6500;

export interface EdgeCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, value: Response): Promise<void>;
}

/** The default cache when running on Workers; undefined under `astro dev` and in unit tests. */
export function defaultEdgeCache(): EdgeCache | undefined {
  return typeof caches !== 'undefined' ? (caches as unknown as { default?: EdgeCache }).default : undefined;
}

/** Keys live under our own origin so we never depend on cross-origin key semantics. */
export function cacheKey(kind: 'src' | 'memo', id: string): Request {
  return new Request(`https://whenmodel.com/__cache/${kind}/${encodeURIComponent(id)}`);
}

async function store(
  cache: EdgeCache | undefined,
  key: Request,
  body: string,
  contentType: string,
  ttl: number,
) {
  if (!cache) return;
  try {
    await cache.put(
      key,
      new Response(body, {
        headers: { 'content-type': contentType, 'cache-control': `public, max-age=${ttl}` },
      }),
    );
  } catch (e) {
    console.error('[cache:put]', key.url, e instanceof Error ? e.message : e);
  }
}

export interface FetchOptions {
  ttl?: number;
  headers?: Record<string, string>;
  cache?: EdgeCache;
  fetch?: typeof fetch;
}

/** Fetch a URL as text, serving from the edge cache for `ttl` seconds when possible. */
export async function cachedText(url: string, options: FetchOptions = {}): Promise<string> {
  const ttl = options.ttl ?? 600;
  const cache = options.cache ?? defaultEdgeCache();
  const key = cacheKey('src', url);
  const hit = await cache?.match(key);
  if (hit) return hit.text();

  const doFetch = options.fetch ?? fetch;
  const res = await doFetch(url, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  await store(cache, key, text, res.headers.get('content-type') ?? 'text/plain; charset=utf-8', ttl);
  return text;
}

export async function cachedJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  return JSON.parse(await cachedText(url, { ttl: 300, ...options })) as T;
}

/** Memoise an assembled value so concurrent renders in a colo share one upstream pass. */
export async function memoJson<T>(
  id: string,
  ttl: number,
  build: () => Promise<T>,
  cache: EdgeCache | undefined = defaultEdgeCache(),
): Promise<T> {
  const key = cacheKey('memo', id);
  const hit = await cache?.match(key);
  if (hit) {
    try {
      return (await hit.json()) as T;
    } catch {
      /* corrupt entry: rebuild below */
    }
  }
  const value = await build();
  await store(cache, key, JSON.stringify(value), 'application/json', ttl);
  return value;
}
