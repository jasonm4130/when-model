import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockUpstream } from './mock-cache';

afterEach(() => {
  vi.resetModules();
  vi.useRealTimers();
});

const NOW = Date.parse('2026-09-19T12:03:41Z');

describe('toFeedItem', () => {
  it('keeps model stories, links to HN when the url is unusable, alerts only on hot launches', async () => {
    const { toFeedItem } = await import('../../src/adapters/hacker-news');
    const hot = toFeedItem({
      objectID: '1',
      title: 'Introducing GPT-6',
      url: 'https://openai.com/gpt-6',
      points: 900,
      num_comments: 400,
      created_at: '2026-09-19T01:00:00Z',
    })!;
    expect(hot).toMatchObject({
      source: 'hn',
      url: 'https://openai.com/gpt-6',
      score: 900,
      precision: 'instant',
      alert: true,
      meta: '900▲ · 400 comments',
    });

    const lukewarm = toFeedItem({
      objectID: '2',
      title: 'Introducing GPT-6',
      points: 80,
      created_at: '2026-09-19T01:00:00Z',
    })!;
    expect(lukewarm.alert).toBe(false);
    expect(lukewarm.url).toBe('https://news.ycombinator.com/item?id=2');

    const review = toFeedItem({
      objectID: '6',
      title: 'Opus 5.5 is good at explainer videos',
      points: 700,
      created_at: '2026-09-19T01:00:00Z',
    })!;
    expect(review.alert).toBe(false);

    expect(
      toFeedItem({
        objectID: '3',
        title: 'Rust 2.0 released',
        points: 500,
        created_at: '2026-09-19T01:00:00Z',
      }),
    ).toBeUndefined();
    expect(toFeedItem({ objectID: '4', title: 'Claude thing', created_at: 'garbage' })).toBeUndefined();
    expect(toFeedItem({ objectID: '5', created_at: '2026-09-19T01:00:00Z' })).toBeUndefined();
  });
});

describe('sinceBucket', () => {
  it('floors to a five-minute bucket so renders inside the cache TTL share one URL', async () => {
    const { sinceBucket } = await import('../../src/adapters/hacker-news');
    const bucket = Date.parse('2026-09-19T12:00:00Z') / 1000;
    expect(sinceBucket(NOW, 24)).toBe(bucket - 24 * 3600);
    expect(sinceBucket(NOW + 60_000, 24)).toBe(sinceBucket(NOW, 24));
    expect(sinceBucket(Date.parse('2026-09-19T12:05:00Z'), 0)).toBe(bucket + 300);
  });
});

describe('fetchHackerNews', () => {
  it('encodes the bucketed numeric filters and maps hits', async () => {
    vi.useFakeTimers({ now: NOW });
    const calls = mockUpstream({
      'https://hn.algolia.com/api/v1/search?': {
        hits: [
          { objectID: '1', title: 'Gemini 4 launches', points: 200, created_at: '2026-09-19T01:00:00Z' },
        ],
      },
    });
    const { fetchHackerNews } = await import('../../src/adapters/hacker-news');
    const out = await fetchHackerNews(24, 60);
    expect(out).toHaveLength(1);
    expect(out[0].alert).toBe(true);
    const since = Date.parse('2026-09-19T12:00:00Z') / 1000 - 24 * 3600;
    expect(calls[0]).toContain(encodeURIComponent(`points>60,created_at_i>${since}`));
  });

  it('tolerates a body without hits', async () => {
    mockUpstream({ 'https://hn.algolia.com/api/v1/search?': {} });
    const { fetchHackerNews } = await import('../../src/adapters/hacker-news');
    expect(await fetchHackerNews()).toEqual([]);
  });
});

describe('Leak Wire on Hacker News', () => {
  it('toLeakItem keeps leak-shaped titles at any point count', async () => {
    const { toLeakItem } = await import('../../src/adapters/hacker-news');
    expect(
      toLeakItem({
        objectID: '9',
        title: 'GPT-6-sol appeared on OpenAI API',
        points: 10,
        created_at: '2026-09-11T20:43:00Z',
      }),
    ).toEqual({
      source: 'hn',
      title: 'GPT-6-sol appeared on OpenAI API',
      url: 'https://news.ycombinator.com/item?id=9',
      publishedAt: '2026-09-11T20:43:00.000Z',
      modelIds: ['gpt-6-sol'],
      cue: 'appeared',
      labId: 'openai',
    });
    expect(
      toLeakItem({ objectID: '1', title: 'Grok 4.7', created_at: '2026-09-18T06:42:00Z' }),
    ).toBeUndefined();
    expect(
      toLeakItem({ objectID: '1', title: 'Grok 4.7 Launching Soon', created_at: 'nope' }),
    ).toBeUndefined();
    expect(toLeakItem({ objectID: '1', created_at: '2026-09-18T06:42:00Z' })).toBeUndefined();
  });

  it('fetchHackerNewsLeaks searches titles by date over 14 days with optional leak words', async () => {
    vi.useFakeTimers({ now: NOW });
    const calls = mockUpstream({
      'https://hn.algolia.com/api/v1/search_by_date?': {
        hits: [
          {
            objectID: '1',
            title: 'Grok 4.7 Launching Soon',
            url: 'https://x.test/g',
            points: 1,
            created_at: '2026-09-18T06:42:00Z',
          },
          {
            objectID: '2',
            title: 'Rust 2.0 will release tomorrow',
            points: 90,
            created_at: '2026-09-18T07:00:00Z',
          },
        ],
      },
    });
    const { LEAK_QUERY, fetchHackerNewsLeaks } = await import('../../src/adapters/hacker-news');
    const out = await fetchHackerNewsLeaks();
    expect(out.map((l) => [l.title, l.url, l.cue, l.labId])).toEqual([
      ['Grok 4.7 Launching Soon', 'https://x.test/g', 'launching soon', 'xai'],
    ]);
    const params = new URL(calls[0]).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      query: LEAK_QUERY,
      optionalWords: LEAK_QUERY,
      tags: 'story',
      numericFilters: `created_at_i>${Date.parse('2026-09-19T12:00:00Z') / 1000 - 14 * 86_400}`,
      hitsPerPage: '1000',
      typoTolerance: 'false',
      restrictSearchableAttributes: 'title',
    });
  });

  it('fetchHackerNewsLeaks throws on a body without hits so the source shows as failed', async () => {
    mockUpstream({ 'https://hn.algolia.com/api/v1/search_by_date?': { message: 'rate limited' } });
    const { fetchHackerNewsLeaks } = await import('../../src/adapters/hacker-news');
    await expect(fetchHackerNewsLeaks()).rejects.toThrow(/no hits array/);
  });
});
