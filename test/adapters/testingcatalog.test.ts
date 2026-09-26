import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../fixtures/read';
import { mockUpstream } from './mock-cache';

afterEach(() => {
  vi.resetModules();
  vi.useRealTimers();
});

const FEED = fixture('testingcatalog-rss.xml');
const NOW = Date.parse('2026-09-26T00:00:00Z');

describe('parseTestingCatalog', () => {
  it('keeps pre-release reports from the last 14 days with their attribution, and skips launches', async () => {
    const { parseTestingCatalog } = await import('../../src/adapters/testingcatalog');
    const out = parseTestingCatalog(FEED, NOW);
    expect(out.map((l) => [l.title, l.modelIds, l.cue, l.labId])).toEqual([
      ['Google tests new Gemini 4 Pro checkpoints, early outputs', ['gemini-4-pro'], 'tests', 'google'],
      // Sibling expansion: "Sol and Luna" now yields both ids, not just gpt-6-sol.
      [
        'OpenAI prepares to launch GPT-6 Sol and Luna models today',
        ['gpt-6-sol', 'gpt-6-luna'],
        'prepares',
        'openai',
      ],
      [
        'Anthropic tests Fable 5.2 and Opus 5.5 ahead of the release',
        ['fable-5.2', 'opus-5.5'],
        'tests',
        'anthropic',
      ],
    ]);
    expect(out[2]).toMatchObject({
      source: 'testingcatalog',
      url: 'https://www.testingcatalog.com/anthropic-tests-fable-5-2-and-opus-5-5-ahead-of-the-release/',
      publishedAt: '2026-09-21T08:45:15.000Z',
    });
  });

  it('reaches back further with a wider window', async () => {
    const { parseTestingCatalog } = await import('../../src/adapters/testingcatalog');
    expect(parseTestingCatalog(FEED, NOW, 60).at(-1)?.title).toBe(
      'First outputs from GPT-6 "Astra" model from OpenAI',
    );
  });

  it('drops sponsored posts and throws on a feed with no readable entries', async () => {
    const { parseTestingCatalog } = await import('../../src/adapters/testingcatalog');
    const item = (category: string) =>
      `<item><title>Grok 4.9 spotted in the xAI console</title><link>https://www.testingcatalog.com/g/</link><category><![CDATA[ ${category} ]]></category><pubDate>Fri, 25 Sep 2026 10:00:00 +0000</pubDate></item>`;
    expect(parseTestingCatalog(`<rss>${item('SPACEXAI')}</rss>`, NOW)).toHaveLength(1);
    expect(parseTestingCatalog(`<rss>${item('Sponsored')}</rss>`, NOW)).toEqual([]);
    expect(() => parseTestingCatalog('<html>Access denied</html>', NOW)).toThrow(/no readable entries/);
  });
});

describe('fetchTestingCatalogLeaks', () => {
  it('reads the feed through the edge cache', async () => {
    vi.useFakeTimers({ now: NOW });
    const calls = mockUpstream({ 'https://www.testingcatalog.com/rss/': FEED });
    const { fetchTestingCatalogLeaks } = await import('../../src/adapters/testingcatalog');
    expect(await fetchTestingCatalogLeaks()).toHaveLength(3);
    expect(calls).toEqual(['https://www.testingcatalog.com/rss/']);
  });
});
