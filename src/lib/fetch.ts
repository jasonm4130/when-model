/**
 * Edge-cached fetch helpers built on the Workers Cache API (per-colo).
 *
 * Bodies are buffered to text before caching: streaming a `Response.clone()` branch into
 * `cache.put` while parsing the other truncated bodies at the tee boundary in production
 * ("Unterminated string in JSON at position ~3000").
 */

const UA = 'whenmodel.com/1.0 (+https://whenmodel.com; signal dashboard)';
/** Upstream fetches abort after this long so a slow source cannot orphan a cache write. */
const UPSTREAM_TIMEOUT_MS = 6500;

function edgeCache(): Cache | undefined {
  return typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
}

/** Cache keys live under our own origin so we never depend on cross-origin key semantics. */
function cacheKey(kind: string, id: string): Request {
  return new Request(`https://whenmodel.com/__cache/${kind}/${encodeURIComponent(id)}`);
}

async function cachePut(key: Request, body: string, contentType: string, ttl: number): Promise<void> {
  const cache = edgeCache();
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

/** Fetch a URL as text, serving from the edge cache for `ttl` seconds when possible. */
export async function cachedText(url: string, ttl = 600, init?: RequestInit): Promise<string> {
  const key = cacheKey('src', url);
  const cache = edgeCache();
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit.text();
  }
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: {
      'user-agent': UA,
      accept: 'application/json, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const text = await res.text();
  await cachePut(key, text, res.headers.get('content-type') ?? 'text/plain; charset=utf-8', ttl);
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
  const req = cacheKey('memo', key);
  const cache = edgeCache();
  if (cache) {
    const hit = await cache.match(req);
    if (hit) {
      try {
        return (await hit.json()) as T;
      } catch {
        /* rebuild below */
      }
    }
  }
  const value = await build();
  await cachePut(req, JSON.stringify(value), 'application/json', ttl);
  return value;
}

/** Run a source with a timeout; a failing source never takes the page down. */
export async function safe<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T,
  ms = 8000,
): Promise<{ data: T; ok: boolean; error?: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const data = await Promise.race([
      fn(),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error('timeout')), ms);
      }),
    ]);
    return { data, ok: true };
  } catch (e) {
    console.error(`[source:${label}]`, e instanceof Error ? e.message : e);
    return { data: fallback, ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** ISO timestamp for a parseable date string, else undefined. Never throws. */
export function toIso(s: string | number | undefined | null): string | undefined {
  if (s === undefined || s === null || s === '') return undefined;
  const t = typeof s === 'number' ? s : Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/** Only http(s) URLs may become links; upstream data is untrusted. */
export function isHttpUrl(u: unknown): u is string {
  return typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u);
}

export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => cp(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function cp(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}
