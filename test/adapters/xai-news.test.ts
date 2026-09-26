import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockUpstream } from './mock-cache';

afterEach(() => vi.resetModules());

const HTML = `
<script type="application/ld+json">{"@type":"Article","dateModified":"2026-09-21T00:00:00Z","datePublished":"2026-09-21T00:00:00Z"}</script>
<h2 id="september"><a href="#september">September</a></h2>
<div class="relative mt-12 grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-x-6"><div class="text-muted top-(--topbar-height) sticky"><div class="relative">September 21<span aria-hidden="true"></span></div></div><div class="min-w-0"><span class="not-prose"><h3 id="grok-47"><a class="not-prose" href="#grok-47">Grok 4.7</a></h3></span><p>Grok 4.7, SpaceXAI&#x27;s frontier model for coding, agentic tasks, and knowledge work, is now available on the xAI API as <code>grok-4.7</code>. See the <a href="https://x.ai/news/grok-4-7">announcement</a>.</p></div></div>
<h2 id="august"><a href="#august">August</a></h2>
<div class="relative mt-12 grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-x-6"><div class="text-muted top-(--topbar-height) sticky"><div class="relative">August 21<span aria-hidden="true"></span></div></div><div class="min-w-0"><span class="not-prose"><h3 id="grok-46-eu"><a class="not-prose" href="#grok-46-eu">Grok 4.6 available in the EU</a></h3></span><p>Grok 4.6 is now available in the EU.</p></div></div>
<div class="relative mt-12 grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-x-6"><div class="text-muted top-(--topbar-height) sticky"><div class="relative">August 20<span aria-hidden="true"></span></div></div><div class="min-w-0"><span class="not-prose"><h3 id="grok-46-ga"><a class="not-prose" href="#grok-46-ga">Grok 4.6 is now generally available</a></h3></span><p>No longer in beta.</p></div></div>
<div class="relative mt-12 grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-x-6"><div class="text-muted top-(--topbar-height) sticky"><div class="relative">August 12<span aria-hidden="true"></span></div></div><div class="min-w-0"><span class="not-prose"><h3 id="grok-46"><a class="not-prose" href="#grok-46">Grok 4.6</a></h3></span><p>Grok 4.6 is now available on the xAI API.</p></div></div>
<div class="relative mt-12 grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-x-6"><div class="text-muted top-(--topbar-height) sticky"><div class="relative">August 11<span aria-hidden="true"></span></div></div><div class="min-w-0"><span class="not-prose"><h3 id="grok-bot"><a class="not-prose" href="#grok-bot">Grok Bot</a></h3></span><p>Grok Bot is now available.</p></div></div>
<h2 id="december-2025"><a href="#december-2025">December 2025</a></h2>
<div class="relative mt-12 grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-x-6"><div class="text-muted top-(--topbar-height) sticky"><div class="relative">December 22<span aria-hidden="true"></span></div></div><div class="min-w-0"><span class="not-prose"><h3 id="grok-collections"><a class="not-prose" href="#grok-collections">Grok Collections API</a></h3></span><p>Grok Collections API is now available.</p></div></div>
`;

describe('parseXaiNews', () => {
  it('reads dated sections at day precision and alerts only on the first launch-shaped entry per model', async () => {
    const { parseXaiNews } = await import('../../src/adapters/xai-news');
    const items = parseXaiNews(HTML);

    expect(items.map((f) => [f.title, f.publishedAt, f.alert])).toEqual([
      ['Grok 4.7', '2026-09-21T00:00:00.000Z', true],
      ['Grok 4.6 available in the EU', '2026-08-21T00:00:00.000Z', false],
      ['Grok 4.6 is now generally available', '2026-08-20T00:00:00.000Z', false],
      ['Grok 4.6', '2026-08-12T00:00:00.000Z', true],
      ['Grok Bot', '2026-08-11T00:00:00.000Z', false],
      ['Grok Collections API', '2025-12-22T00:00:00.000Z', false],
    ]);
    expect(items[0]).toEqual({
      source: 'xai',
      title: 'Grok 4.7',
      url: 'https://docs.x.ai/developers/release-notes#grok-47',
      publishedAt: '2026-09-21T00:00:00.000Z',
      precision: 'day',
      alert: true,
    });
    expect(items.every((f) => f.precision === 'day')).toBe(true);
  });

  it('honours the item limit after judging launches over every entry', async () => {
    const { parseXaiNews } = await import('../../src/adapters/xai-news');
    expect(parseXaiNews(HTML, 1)).toHaveLength(1);
    expect(parseXaiNews(HTML, 4).map((f) => f.alert)).toEqual([true, false, false, true]);
  });

  it('fails loudly when release-note structure or dated entries disappear', async () => {
    const { parseXaiNews } = await import('../../src/adapters/xai-news');
    expect(() => parseXaiNews('<h1>Release Notes</h1>')).toThrow(/publication year metadata/);
    expect(() =>
      parseXaiNews('<script>{"datePublished":"2026-01-01"}</script><h1>Release Notes</h1>'),
    ).toThrow(/month sections/);
    expect(() =>
      parseXaiNews('<script>{"datePublished":"2026-01-01"}</script><h2><a>September</a></h2>'),
    ).toThrow(/dated entries/);
  });
});

describe('fetchXaiNews', () => {
  it('fetches official release notes through the edge cache', async () => {
    const calls = mockUpstream({ 'https://docs.x.ai/developers/release-notes': HTML });
    const { fetchXaiNews } = await import('../../src/adapters/xai-news');
    expect(await fetchXaiNews()).toHaveLength(6);
    expect(calls).toEqual(['https://docs.x.ai/developers/release-notes']);
  });
});
