import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockUpstream } from './mock-cache';

afterEach(() => vi.resetModules());

const HTML = `
<a href="/news/claude-fable-5-1"><div><span>Announcements</span><h3>Introducing Claude Fable 5.1</h3><time>Sep 17, 2026</time></div></a>
<a href="/news/claude-fable-5-1"><h3>Introducing Claude Fable 5.1</h3><time>Sep 17, 2026</time></a>
<a href="/news/policy-update"><span>Policy</span>Our approach to safety effortsOn July 30, we published a thing. Jul 30, 2026</a>
<a href="/news/undated"><h3>No date here at all</h3></a>
<a href="/news/short">Sep 17, 2026 Hi</a>
<a href="/news/scripted"><script>var x = 1;</script>Research Circuits in production models Sep 10, 2026</a>
`;

describe('parseAnthropicNews', () => {
  it('dedupes cards, strips categories and glued body text, drops undated and tiny titles', async () => {
    const { parseAnthropicNews } = await import('../../src/adapters/anthropic-news');
    const out = parseAnthropicNews(HTML);
    expect(out.map((f) => f.title)).toEqual([
      'Introducing Claude Fable 5.1',
      'Our approach to safety efforts',
      'Circuits in production models',
    ]);
    expect(out[0]).toMatchObject({
      source: 'anthropic',
      url: 'https://www.anthropic.com/news/claude-fable-5-1',
      publishedAt: '2026-09-17T00:00:00.000Z',
      alert: true,
    });
    expect(out[1].alert).toBe(false);
  });

  it('honours the limit', async () => {
    const { parseAnthropicNews } = await import('../../src/adapters/anthropic-news');
    expect(parseAnthropicNews(HTML, 1)).toHaveLength(1);
  });
});

describe('fetchAnthropic', () => {
  it('scrapes the newsroom index', async () => {
    const calls = mockUpstream({ 'https://www.anthropic.com/news': HTML });
    const { fetchAnthropic } = await import('../../src/adapters/anthropic-news');
    expect(await fetchAnthropic()).toHaveLength(3);
    expect(calls).toEqual(['https://www.anthropic.com/news']);
  });
});
