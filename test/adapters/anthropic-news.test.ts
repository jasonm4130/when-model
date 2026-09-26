import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../fixtures/read';
import { mockUpstream } from './mock-cache';

afterEach(() => vi.resetModules());

const NEWSROOM = fixture('anthropic-news.html.txt');

const HTML = `
<a href="/news/claude-fable-5-1"><h3 class="PostCard__title">Introducing Claude Fable 5.1</h3><time>Sep 17, 2026</time></a>
<a href="/news/claude-fable-5-1"><h3>Introducing Claude Fable 5.1</h3><time>Sep 17, 2026</time></a>
<a href="https://www.anthropic.com/research/circuits"><span>Research</span><h3>Circuits in production models</h3><time>Sep 10, 2026</time></a>
<a href="https://evil.example/news/phish"><h3>Introducing Claude Opus 9</h3><time>Sep 18, 2026</time></a>
<a href="/news/undated"><h3>No date here at all</h3></a>
<a href="/news/short"><h3>Hi</h3><time>Sep 17, 2026</time></a>
<a href="/news/untitled"><time>Sep 17, 2026</time></a>
<script>{"publishedOn":"2026-09-17T00:00:00.000Z","slug":{"_type":"slug","current":"claude-fable-5-1"}}</script>
`;

describe('parseAnthropicNews', () => {
  it('reads the launch card at the site root from the real newsroom, with an exact time where the page has one', async () => {
    const { parseAnthropicNews } = await import('../../src/adapters/anthropic-news');
    const out = parseAnthropicNews(NEWSROOM);
    expect(out.map((f) => [f.title, f.precision, f.alert])).toEqual([
      ['Claude discovers a novel enzyme system with CRISPR-like repeats', 'instant', false],
      ['Introducing Claude Opus 5.5', 'day', true],
      ['The Situation Report', 'day', false],
      ['Partnering with Accenture on embedded evaluation', 'instant', false],
      ['Introducing the Life Sciences Verification Program', 'instant', false],
      ['Detecting and countering misuse of AI: September 2026', 'day', false],
      ['Developing Enterprise Frontier Safeguards with our customers', 'instant', false],
      ['Introducing Claude Fable 5.1 and Claude Mythos 5.1', 'day', true],
    ]);
    expect(out[1]).toEqual({
      source: 'anthropic',
      title: 'Introducing Claude Opus 5.5',
      url: 'https://www.anthropic.com/claude-opus-5-5',
      publishedAt: '2026-09-22T00:00:00.000Z',
      precision: 'day',
      alert: true,
    });
    expect(out[0].publishedAt).toBe('2026-09-23T16:06:00.000Z');
    expect(out[2].url).toBe('https://www.anthropic.com/features/ebola-response');
  });

  it('sorts before the limit, because the featured grid is out of date order', async () => {
    const { parseAnthropicNews } = await import('../../src/adapters/anthropic-news');
    expect(parseAnthropicNews(NEWSROOM, 3).map((f) => f.title)).toEqual([
      'Claude discovers a novel enzyme system with CRISPR-like repeats',
      'Introducing Claude Opus 5.5',
      'The Situation Report',
    ]);
  });

  it('dedupes cards and drops other origins, undated cards and tiny or missing titles', async () => {
    const { parseAnthropicNews } = await import('../../src/adapters/anthropic-news');
    const out = parseAnthropicNews(HTML);
    expect(out.map((f) => [f.title, f.url])).toEqual([
      ['Introducing Claude Fable 5.1', 'https://www.anthropic.com/news/claude-fable-5-1'],
      ['Circuits in production models', 'https://www.anthropic.com/research/circuits'],
    ]);
    // The page data has this post at 00:00:00Z, which is a date, so it stays `day`.
    expect(out[0]).toMatchObject({ publishedAt: '2026-09-17T00:00:00.000Z', precision: 'day', alert: true });
  });

  it('throws when the page has no dated cards, so a redesign shows as a failed source', async () => {
    const { parseAnthropicNews } = await import('../../src/adapters/anthropic-news');
    expect(() => parseAnthropicNews('<a href="/news/x"><h3>Something undated</h3></a>')).toThrow(
      /no dated cards/,
    );
  });
});

describe('fetchAnthropic', () => {
  it('scrapes the newsroom index', async () => {
    const calls = mockUpstream({ 'https://www.anthropic.com/news': NEWSROOM });
    const { fetchAnthropic } = await import('../../src/adapters/anthropic-news');
    expect(await fetchAnthropic()).toHaveLength(8);
    expect(calls).toEqual(['https://www.anthropic.com/news']);
  });
});
