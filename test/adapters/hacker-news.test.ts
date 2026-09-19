import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockUpstream } from './mock-cache';

afterEach(() => {
  vi.resetModules();
  vi.useRealTimers();
});

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

describe('fetchHackerNews', () => {
  it('encodes the numeric filters and maps hits', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-09-19T12:00:00Z') });
    const calls = mockUpstream({
      'https://hn.algolia.com/api/v1/search': {
        hits: [
          { objectID: '1', title: 'Gemini 4 launches', points: 200, created_at: '2026-09-19T01:00:00Z' },
        ],
      },
    });
    const { fetchHackerNews } = await import('../../src/adapters/hacker-news');
    const out = await fetchHackerNews(24, 60);
    expect(out).toHaveLength(1);
    const since = Math.floor(Date.parse('2026-09-19T12:00:00Z') / 1000) - 24 * 3600;
    expect(calls[0]).toContain(encodeURIComponent(`points>60,created_at_i>${since}`));
  });

  it('tolerates a body without hits', async () => {
    mockUpstream({ 'https://hn.algolia.com/api/v1/search': {} });
    const { fetchHackerNews } = await import('../../src/adapters/hacker-news');
    expect(await fetchHackerNews()).toEqual([]);
  });
});
