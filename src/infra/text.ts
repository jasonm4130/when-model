/** Small, total functions for untrusted upstream text. None of these throw. */

/** ISO timestamp for a parseable date, else undefined. */
export function toIso(value: string | number | undefined | null): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const t = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/** Only http(s) URLs may become links. */
export function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(value);
}

/** Strip tags and decode the entities that show up in RSS titles. `&amp;` goes last so nothing double-decodes. */
export function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function codePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}
