import type { SourceResult } from '../domain/dashboard';

export const SOURCE_TIMEOUT_MS = 8000;

/** Run one upstream source with a timeout. A failing source degrades to `fallback`; it never throws. */
export async function collect<T>(
  name: string,
  load: () => Promise<T>,
  fallback: T,
  timeoutMs = SOURCE_TIMEOUT_MS,
): Promise<SourceResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const data = await Promise.race([
      load(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return { name, data, ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[source:${name}]`, error);
    return { name, data: fallback, ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}
