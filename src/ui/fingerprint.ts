/**
 * Content fingerprint of a dashboard, shared by the server render and the browser's refresh poll.
 * Pure; safe to unit test.
 *
 * `generatedAt` is left out because every rebuild stamps a new time, so including it would announce
 * "new data" on every poll even when nothing moved. The rendered page carries its own fingerprint, so a
 * tab that was opened in the background and read later still notices the data it has never shown.
 */
export function dashboardFingerprint(dashboard: object): string {
  const { generatedAt: _generatedAt, ...content } = dashboard as Record<string, unknown>;
  return fnv1a(JSON.stringify(content));
}

/** 32-bit FNV-1a over UTF-16 code units: identical in the Worker and every browser, no async crypto. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
