import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEEPSEEK_NEWS_URL,
  META_NEWSROOM_URL,
  fetchDeepSeekNews,
  fetchMetaNewsroom,
  latestDeepSeekNewsPath,
  parseDeepSeekNews,
  parseMetaNewsroom,
} from '../../src/adapters/lab-feeds';
import { fixture } from '../fixtures/read';

const metaRss = fixture('meta-newsroom-rss.xml');
const deepseekHome = fixture('deepseek-docs-home.html.txt');
const deepseekPost = fixture('deepseek-news-post.html.txt');
const DEEPSEEK_POST_URL = 'https://api-docs.deepseek.com/news/news260910/';

afterEach(() => vi.unstubAllGlobals());

/** Serve bodies by URL through the real edge cache (no Cache API in Node); anything else is a 404. */
function serve(bodies: Record<string, string>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const text = bodies[url];
    return text === undefined ? new Response('not found', { status: 404 }) : new Response(text);
  });
  return calls;
}

describe('Meta newsroom', () => {
  it('reads the captured feed newest first', () => {
    const posts = parseMetaNewsroom(metaRss);
    expect(posts).toHaveLength(3);
    expect(posts[0]).toEqual({
      title: 'The Biggest News From Connect 2026',
      url: 'https://about.fb.com/news/2026/09/the-biggest-news-from-connect-2026/',
      publishedAt: '2026-09-24T21:15:55.000Z',
      precision: 'instant',
    });
  });

  it('throws on a body with no entries, such as a challenge page', () => {
    expect(() => parseMetaNewsroom('<html><body>Checking your browser</body></html>')).toThrow(
      'no readable entries',
    );
  });

  it('fetches the feed through the edge cache', async () => {
    const calls = serve({ [META_NEWSROOM_URL]: metaRss });
    expect(await fetchMetaNewsroom()).toHaveLength(3);
    expect(calls).toEqual([META_NEWSROOM_URL]);
  });
});

describe('DeepSeek news', () => {
  it('finds the newest post from the docs navbar', () => {
    expect(latestDeepSeekNewsPath(deepseekHome)).toBe('/news/news260910');
    expect(
      latestDeepSeekNewsPath('<html><nav><a href="/updates">Change Log</a></nav></html>'),
    ).toBeUndefined();
  });

  it('reads every dated post in the sidebar, newest first, at day precision', () => {
    const posts = parseDeepSeekNews(deepseekPost);
    expect(posts.slice(0, 3)).toEqual([
      {
        title: 'DeepSeek-V4.1-Flash Release',
        url: 'https://api-docs.deepseek.com/news/news260910',
        publishedAt: '2026-09-10T00:00:00.000Z',
        precision: 'day',
      },
      {
        title: 'DeepSeek-V4-Flash-Vision-Exp Release',
        url: 'https://api-docs.deepseek.com/news/news260821',
        publishedAt: '2026-08-21T00:00:00.000Z',
        precision: 'day',
      },
      {
        title: 'DeepSeek-V4-Pro GA Release',
        url: 'https://api-docs.deepseek.com/news/news260813',
        publishedAt: '2026-08-13T00:00:00.000Z',
        precision: 'day',
      },
    ]);
    // The navbar's undated "News" link is not a post.
    expect(posts.every((p) => p.title !== 'News')).toBe(true);
    expect(posts.at(-1)?.publishedAt).toBe('2024-07-25T00:00:00.000Z');
  });

  it('throws on a page with no dated posts', () => {
    expect(() => parseDeepSeekNews(deepseekHome)).toThrow('no dated posts');
  });

  it('fetches the docs page, then the newest post', async () => {
    const calls = serve({ [DEEPSEEK_NEWS_URL]: deepseekHome, [DEEPSEEK_POST_URL]: deepseekPost });
    const posts = await fetchDeepSeekNews();
    expect(posts[0].title).toBe('DeepSeek-V4.1-Flash Release');
    expect(calls).toEqual([DEEPSEEK_NEWS_URL, DEEPSEEK_POST_URL]);
  });

  it('throws when the docs page links no news post, without fetching further', async () => {
    const calls = serve({ [DEEPSEEK_NEWS_URL]: '<html><body>Just a moment...</body></html>' });
    await expect(fetchDeepSeekNews()).rejects.toThrow('failed validation');
    expect(calls).toEqual([DEEPSEEK_NEWS_URL]);
  });
});
