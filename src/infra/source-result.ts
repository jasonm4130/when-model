import type { SourceResult } from '../domain/dashboard';

export const SOURCE_TIMEOUT_MS = 8000;

/**
 * Run one upstream source with a timeout. A failing source degrades to `fallback`; it never throws.
 * `ms` is its wall time, for the build log (on Workers the clock advances only across I/O, which is
 * exactly what this measures).
 */
export async function collect<T>(
  name: string,
  load: () => Promise<T>,
  fallback: T,
  timeoutMs = SOURCE_TIMEOUT_MS,
): Promise<SourceResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = Date.now();
  try {
    const data = await Promise.race([
      load(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return { name, data, ok: true, ms: Date.now() - started };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[source:${name}]`, error);
    return { name, data: fallback, ok: false, error, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
