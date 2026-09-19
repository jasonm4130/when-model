/** Edge-cached fetch helpers. Falls back to plain fetch when the Cache API is absent (dev). */

const UA = 'whenmodel.com/1.0 (+https://whenmodel.com; signal dashboard)';

async function cachedResponse(url: string, ttl: number, init?: RequestInit): Promise<Response> {
  const req = new Request(url, { ...init, headers: { 'user-agent': UA, accept: 'application/json, application/xml, text/xml, text/html;q=0.9, */*;q=0.8', ...(init?.headers as Record<string, string> | undefined) } });
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
  if (cache) {
    const hit = await cache.match(req);
    if (hit) return hit;
  }
  const res = await fetch(req, { cf: { cacheTtl: ttl, cacheEverything: true } } as RequestInit);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  if (cache) {
    const copy = new Response(res.clone().body, res);
    copy.headers.set('cache-control', `public, max-age=${ttl}`);
    await cache.put(req, copy).catch(() => {});
  }
  return res;
}

export async function cachedJson<T>(url: string, ttl = 300, init?: RequestInit): Promise<T> {
  const res = await cachedResponse(url, ttl, init);
  return (await res.json()) as T;
}

export async function cachedText(url: string, ttl = 600, init?: RequestInit): Promise<string> {
  const res = await cachedResponse(url, ttl, init);
  return res.text();
}

/** Run a source with a timeout; a failing source never takes the page down. */
export async function safe<T>(label: string, fn: () => Promise<T>, fallback: T, ms = 8000): Promise<{ data: T; ok: boolean; error?: string }> {
  try {
    const data = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
    ]);
    return { data, ok: true };
  } catch (e) {
    console.error(`[source:${label}]`, e instanceof Error ? e.message : e);
    return { data: fallback, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/<[^>]+>/g, '').trim();
}
