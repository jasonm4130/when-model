import { describe, expect, it } from 'vitest';
import { decodeEntities, isHttpUrl, toIso } from '../../src/infra/text';

describe('toIso', () => {
  it('never throws on junk', () => {
    expect(toIso('Foo 31, 2026')).toBeUndefined();
    expect(toIso(undefined)).toBeUndefined();
    expect(toIso(null)).toBeUndefined();
    expect(toIso('')).toBeUndefined();
    expect(toIso(Number.NaN)).toBeUndefined();
    expect(toIso('Thu, 17 Sep 2026 12:00:00 GMT')).toBe('2026-09-17T12:00:00.000Z');
    expect(toIso(1789821677000)).toBe('2026-09-19T12:41:17.000Z');
  });
});

describe('isHttpUrl', () => {
  it('rejects non-http schemes and junk', () => {
    expect(isHttpUrl('https://x.test/a?b=1')).toBe(true);
    expect(isHttpUrl('HTTP://x.test')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('data:text/html,hi')).toBe(false);
    expect(isHttpUrl('https://x.test/a b')).toBe(false);
    expect(isHttpUrl('https://x.test/"onclick')).toBe(false);
    expect(isHttpUrl(42)).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
  });
});

describe('decodeEntities', () => {
  it('decodes without double-unescaping and survives bad code points', () => {
    expect(decodeEntities('<![CDATA[A &amp; B]]>')).toBe('A & B');
    expect(decodeEntities('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
    expect(decodeEntities('x &#99999999; y &#65; &#x42;')).toBe('x  y A B');
    expect(decodeEntities('<b>bold</b> &nbsp;text')).toBe('bold  text');
    expect(decodeEntities('it&#39;s &apos;quoted&apos; &quot;twice&quot;')).toBe(`it's 'quoted' "twice"`);
  });
});
