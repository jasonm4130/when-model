import { describe, expect, it } from 'vitest';
import { decodeEntities, isHttpUrl, toIso } from '../src/lib/fetch';
import { perMillion } from '../src/lib/format';
import { parseFeed } from '../src/lib/sources/feed';

describe('toIso', () => {
  it('never throws on junk', () => {
    expect(toIso('Foo 31, 2026')).toBeUndefined();
    expect(toIso(undefined)).toBeUndefined();
    expect(toIso('')).toBeUndefined();
    expect(toIso(Number.NaN)).toBeUndefined();
    expect(toIso('Thu, 17 Sep 2026 12:00:00 GMT')).toBe('2026-09-17T12:00:00.000Z');
    expect(toIso(1789821677000)).toBe('2026-09-19T12:41:17.000Z');
  });
});

describe('isHttpUrl', () => {
  it('rejects non-http schemes and junk', () => {
    expect(isHttpUrl('https://x.test/a?b=1')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('data:text/html,hi')).toBe(false);
    expect(isHttpUrl('https://x.test/a b')).toBe(false);
    expect(isHttpUrl(42)).toBe(false);
  });
});

describe('decodeEntities', () => {
  it('decodes without double-unescaping and survives bad code points', () => {
    expect(decodeEntities('<![CDATA[A &amp; B]]>')).toBe('A & B');
    expect(decodeEntities('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
    expect(decodeEntities('x &#99999999; y &#65; &#x42;')).toBe('x  y A B');
    expect(decodeEntities('<b>bold</b> &nbsp;text')).toBe('bold  text');
  });
});

describe('perMillion', () => {
  it('keeps integer zeros and trims only decimal zeros', () => {
    expect(perMillion(10)).toBe('$10');
    expect(perMillion(50)).toBe('$50');
    expect(perMillion(100)).toBe('$100');
    expect(perMillion(2.5)).toBe('$2.5');
    expect(perMillion(3)).toBe('$3');
    expect(perMillion(0.075)).toBe('$0.075');
    expect(perMillion(0.5)).toBe('$0.5');
  });
});

describe('parseFeed', () => {
  it('reads RSS and Atom and drops entries without a usable date or link', () => {
    const rss = `<rss><channel>
      <item><title><![CDATA[Introducing Foo 2]]></title><link>https://a.test/foo</link><pubDate>Thu, 17 Sep 2026 12:00:00 GMT</pubDate></item>
      <item><title>Undated</title><link>https://a.test/x</link><pubDate>not a date</pubDate></item>
      <item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>Thu, 17 Sep 2026 12:00:00 GMT</pubDate></item>
    </channel></rss>`;
    const out = parseFeed(rss, 'openai', 10);
    expect(out.map((f) => f.title)).toEqual(['Introducing Foo 2']);
    expect(out[0].alert).toBe(true);
    expect(out[0].publishedAt).toBe('2026-09-17T12:00:00.000Z');

    const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>Gemini update</title><link rel="alternate" href="https://b.test/g"/><published>2026-09-15T17:05:57Z</published></entry>
    </feed>`;
    const a = parseFeed(atom, 'deepmind', 10);
    expect(a).toHaveLength(1);
    expect(a[0].url).toBe('https://b.test/g');
    expect(a[0].alert).toBe(false);
  });
});
