/**
 * Edge-cached fetch helpers built on the Workers Cache API (per-colo).
 *
 * Bodies are buffered to text before caching: streaming a `Response.clone()` branch into
 * `cache.put` while parsing the other truncated bodies at the tee boundary in production
 * ("Unterminated string in JSON at position ~3000").
 */

const UA = 'whenmodel.com/1.0 (+https://whenmodel.com; signal dashboard)';

function edgeCache(): Cache | undefined {
  return typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
}

/** Fetch a URL as text, serving from the edge cache for `ttl` seconds when possible. */
export async function cachedText(url: string, ttl = 600, init?: RequestInit): Promise<string> {
  const req = new Request(url, {
    ...init,
    headers: { 'user-agent': UA, accept: 'application/json, application/xml, text/xml, text/html;q=0.9, */*;q=0.8', ...(init?.headers as Record<string, string> | undefined) },
  });
  const cache = edgeCache();
  if (cache) {
    const hit = await cache.match(req);
    if (hit) return hit.text();
  }
  const res = await fetch(req);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  if (cache) {
    const copy = new Response(text, {
      headers: {
        'content-type': res.headers.get('content-type') ?? 'text/plain; charset=utf-8',
        'cache-control': `public, max-age=${ttl}`,
      },
    });
    await cache.put(req, copy).catch(() => {});
  }
  return text;
}

export async function cachedJson<T>(url: string, ttl = 300, init?: RequestInit): Promise<T> {
  return JSON.parse(await cachedText(url, ttl, init)) as T;
}

/**
 * Memoise an assembled value at the edge under a synthetic key. Used for the whole
 * dashboard so concurrent renders in a colo share one upstream pass.
 */
export async function memoJson<T>(key: string, ttl: number, build: () => Promise<T>): Promise<T> {
  const cache = edgeCache();
  const req = new Request(`https://whenmodel.com/__memo/${key}`);
  if (cache) {
    const hit = await cache.match(req);
    if (hit) {
      try { return (await hit.json()) as T; } catch { /* rebuild below */ }
    }
  }
  const value = await build();
  if (cache) {
    await cache
      .put(req, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } }))
      .catch(() => {});
  }
  return value;
}

/** Run a source with a timeout; a failing source never takes the page down. */
export async function safe<T>(label: string, fn: () => Promise<T>, fallback: T, ms = 8000): Promise<{ data: T; ok: boolean; error?: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const data = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); }),
    ]);
    return { data, ok: true };
  } catch (e) {
    console.error(`[source:${label}]`, e instanceof Error ? e.message : e);
    return { data: fallback, ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/<[^>]+>/g, '').trim();
}
