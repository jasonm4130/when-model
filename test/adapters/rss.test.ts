import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockUpstream } from './mock-cache';

afterEach(() => vi.resetModules());

const RSS = `<rss><channel>
  <item><title><![CDATA[Introducing Foo 2]]></title><link>https://a.test/foo</link><pubDate>Thu, 17 Sep 2026 12:00:00 GMT</pubDate></item>
  <item><title>Undated</title><link>https://a.test/x</link><pubDate>not a date</pubDate></item>
  <item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>Thu, 17 Sep 2026 12:00:00 GMT</pubDate></item>
  <item><link>https://a.test/untitled</link><pubDate>Thu, 17 Sep 2026 12:00:00 GMT</pubDate></item>
  <item><title>Third</title><link>https://a.test/3</link><dc:date>2026-09-16T00:00:00Z</dc:date></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title>Gemini update</title><link rel="alternate" href="https://b.test/g"/><published>2026-09-15T17:05:57Z</published></entry>
  <entry><title>Only updated</title><link href="https://b.test/u"/><updated>2026-09-14T00:00:00Z</updated></entry>
</feed>`;

describe('parseFeed', () => {
  it('reads RSS, drops entries without a usable title, link or date, honours the limit', async () => {
    const { parseFeed } = await import('../../src/adapters/rss');
    const out = parseFeed(RSS, 'openai', 10);
    expect(out.map((f) => f.title)).toEqual(['Introducing Foo 2', 'Third']);
    expect(out[0]).toMatchObject({ source: 'openai', alert: true, publishedAt: '2026-09-17T12:00:00.000Z' });
    expect(out[1].alert).toBe(false);
    expect(parseFeed(RSS, 'openai', 1)).toHaveLength(1);
  });

  it('reads Atom links from href and falls back to updated', async () => {
    const { parseFeed } = await import('../../src/adapters/rss');
    const out = parseFeed(ATOM, 'deepmind', 10);
    expect(out.map((f) => f.url)).toEqual(['https://b.test/g', 'https://b.test/u']);
    expect(out[1].publishedAt).toBe('2026-09-14T00:00:00.000Z');
  });
});

describe('fetchers', () => {
  it('hit the right feeds with the right source labels', async () => {
    const calls = mockUpstream({
      'https://openai.com/news/rss.xml': RSS,
      'https://deepmind.google/blog/rss.xml': ATOM,
    });
    const { fetchDeepMind, fetchOpenAI } = await import('../../src/adapters/rss');
    expect((await fetchOpenAI())[0].source).toBe('openai');
    expect((await fetchDeepMind())[0].source).toBe('deepmind');
    expect(calls).toEqual(['https://openai.com/news/rss.xml', 'https://deepmind.google/blog/rss.xml']);
  });
});
