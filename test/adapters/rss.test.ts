import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../fixtures/read';
import { mockUpstream } from './mock-cache';

afterEach(() => {
  vi.resetModules();
  vi.useRealTimers();
});

const OPENAI = fixture('openai-rss.xml');

const RSS = `<rss><channel>
  <item><title><![CDATA[Introducing Foo 2]]></title><link>https://a.test/foo</link><pubDate>Thu, 17 Sep 2026 12:00:00 GMT</pubDate></item>
  <item><title>Undated</title><link>https://a.test/x</link><pubDate>not a date</pubDate></item>
  <item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>Thu, 17 Sep 2026 12:00:00 GMT</pubDate></item>
  <item><link>https://a.test/untitled</link><pubDate>Thu, 17 Sep 2026 12:00:00 GMT</pubDate></item>
  <item><title>Introducing GPT-7</title><link>https://a.test/3</link><dc:date>2026-09-16</dc:date><category>Product</category></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title>Gemini update</title><link rel="alternate" href="https://b.test/g"/><published>2026-09-15T17:05:57Z</published></entry>
  <entry><title>Only updated</title><link href="https://b.test/u"/><updated>2026-09-14T00:00:00Z</updated></entry>
</feed>`;

/** An RSS feed of `n` hourly items counting back from `newest`. */
function hourly(newest: string, n: number, extra = ''): string {
  const items = Array.from({ length: n }, (_, i) => {
    const at = new Date(Date.parse(newest) - i * 3_600_000).toUTCString();
    return `<item><title>Post ${i}</title><link>https://a.test/${i}</link><pubDate>${at}</pubDate></item>`;
  });
  return `<rss><channel>${items.join('')}${extra}</channel></rss>`;
}

describe('readFeedEntries', () => {
  it('drops entries without a usable title, link or date and records categories and precision', async () => {
    const { readFeedEntries } = await import('../../src/adapters/rss');
    expect(readFeedEntries(RSS)).toEqual([
      {
        title: 'Introducing Foo 2',
        url: 'https://a.test/foo',
        publishedAt: '2026-09-17T12:00:00.000Z',
        precision: 'instant',
        categories: [],
      },
      {
        title: 'Introducing GPT-7',
        url: 'https://a.test/3',
        publishedAt: '2026-09-16T00:00:00.000Z',
        precision: 'day',
        categories: ['Product'],
      },
    ]);
  });
});

describe('parseFeed', () => {
  it('keeps document order and the limit without a window; alerts only on a versioned launch', async () => {
    const { parseFeed } = await import('../../src/adapters/rss');
    const out = parseFeed(RSS, 'openai', 10);
    expect(out.map((f) => [f.title, f.alert, f.precision])).toEqual([
      ['Introducing Foo 2', false, 'instant'],
      ['Introducing GPT-7', true, 'day'],
    ]);
    expect(out[0]).toMatchObject({ source: 'openai', publishedAt: '2026-09-17T12:00:00.000Z' });
    expect(parseFeed(RSS, 'openai', 1)).toHaveLength(1);
  });

  it('reads Atom links from href and falls back to updated', async () => {
    const { parseFeed } = await import('../../src/adapters/rss');
    const out = parseFeed(ATOM, 'deepmind', 10);
    expect(out.map((f) => f.url)).toEqual(['https://b.test/g', 'https://b.test/u']);
    expect(out[1].publishedAt).toBe('2026-09-14T00:00:00.000Z');
  });

  it('throws when a document yields no entries, but an empty window is a legitimate empty result', async () => {
    const { parseFeed } = await import('../../src/adapters/rss');
    expect(() => parseFeed('<html>Just a moment...</html>', 'openai', 10)).toThrow(
      'openai feed has no readable entries',
    );
    expect(parseFeed(ATOM, 'deepmind', 10, { now: Date.parse('2026-10-15T00:00:00Z'), days: 7 })).toEqual([]);
  });

  it('stops reading after ten consecutive entries older than the window', async () => {
    const { parseFeed } = await import('../../src/adapters/rss');
    const late = `<item><title>Late</title><link>https://a.test/late</link><pubDate>Thu, 17 Sep 2026 00:00:00 GMT</pubDate></item>`;
    const window = { now: Date.parse('2026-09-17T12:00:00Z'), days: 1 };
    // 25 hourly posts inside the day, then stale ones: a fresh post after 9 stale entries still
    // counts; after 10 the parser has stopped reading.
    expect(parseFeed(hourly('2026-09-17T12:00:00Z', 34, late), 'openai', 99, window)).toHaveLength(26);
    expect(parseFeed(hourly('2026-09-17T12:00:00Z', 35, late), 'openai', 99, window)).toHaveLength(25);
  });
});

describe('OpenAI window', () => {
  const now = Date.parse('2026-09-26T00:00:00Z');

  it('reads the last 7 days newest first, drops customer-story and policy categories, alerts on the launch', async () => {
    const { OPENAI_NOISE_CATEGORIES, parseFeed } = await import('../../src/adapters/rss');
    const out = parseFeed(OPENAI, 'openai', 40, { now, days: 7, excludeCategories: OPENAI_NOISE_CATEGORIES });
    expect(out).toHaveLength(12);
    expect(out.every((f) => Date.parse(f.publishedAt) >= now - 7 * 86_400_000)).toBe(true);
    expect(out.map((f) => f.publishedAt)).toEqual(
      out
        .map((f) => f.publishedAt)
        .sort()
        .reverse(),
    );
    expect(out.map((f) => f.title)).not.toContain(
      'Harvey turns legal context into stronger drafts with GPT-6 Astra',
    );
    expect(out.map((f) => f.title)).not.toContain(
      'Sam Altman’s remarks at the United Nations Security Council',
    );
    expect(out.filter((f) => f.alert).map((f) => f.title)).toEqual(['Introducing GPT-6 Sol and Luna']);
    const precision = (title: string) => out.find((f) => f.title === title)?.precision;
    expect(precision('Introducing GPT-6 Sol and Luna')).toBe('instant');
    // Stamped "Tue, 22 Sep 2026 00:00:00 GMT": a date-only post, not a midnight one.
    expect(precision('Priorities and principles for effective third party assessments')).toBe('day');
  });

  it('keeps the launch visible a week on, where the v2 12-item cap had lost it by the capture', async () => {
    const { OPENAI_NOISE_CATEGORIES, parseFeed } = await import('../../src/adapters/rss');
    const weekOn = parseFeed(OPENAI, 'openai', 40, {
      now: Date.parse('2026-09-29T12:00:00Z'),
      days: 7,
      excludeCategories: OPENAI_NOISE_CATEGORIES,
    });
    expect(weekOn.map((f) => f.title)).toContain('Introducing GPT-6 Sol and Luna');
    expect(parseFeed(OPENAI, 'openai', 12).map((f) => f.title)).not.toContain(
      'Introducing GPT-6 Sol and Luna',
    );
  });
});

describe('OPENAI_NOISE_TITLE_SHAPE', () => {
  it('matches the uncategorised customer-story titles that fill the live feed', async () => {
    const { OPENAI_NOISE_TITLE_SHAPE } = await import('../../src/adapters/rss');
    for (const title of [
      'Proaction boosts sales 60% and saves 75+ hours with Codex',
      '1Password increases engineering productivity 21% with Codex',
      'Asana completed a years-long code migration in 2 weeks with Codex',
      'NTT DATA Group cuts incident analysis to 30 minutes with Codex',
      'How invideo improves color grading 3x with GPT‑6 Astra',
      'How Cooley is accelerating IPO work with ChatGPT',
      'Ringg’s AI agents resolve up to 65% of customer calls with OpenAI',
      'Stampli cuts launch hours by 68% using ChatGPT Work',
    ]) {
      expect(OPENAI_NOISE_TITLE_SHAPE.test(title), title).toBe(true);
    }
  });

  it('does not match launch or non-story titles', async () => {
    const { OPENAI_NOISE_TITLE_SHAPE } = await import('../../src/adapters/rss');
    for (const title of [
      'Introducing GPT-6 Sol and Luna',
      'GPT-5.6: Frontier intelligence that scales with your ambition',
      'Advancing voice intelligence with new models in the API',
      'Introducing the OpenAI Partner Network',
      'Building more with GPT-5.1-Codex-Max',
    ]) {
      expect(OPENAI_NOISE_TITLE_SHAPE.test(title), title).toBe(false);
    }
  });

  it('removes 3 of the fixture week’s 12 items and keeps the launch, matching the live count of 70/121', async () => {
    const { OPENAI_NOISE_CATEGORIES, OPENAI_NOISE_TITLE_SHAPE, parseFeed } =
      await import('../../src/adapters/rss');
    const window = { now: Date.parse('2026-09-26T00:00:00Z'), days: 7 };
    const categoryOnly = parseFeed(OPENAI, 'openai', 40, {
      ...window,
      excludeCategories: OPENAI_NOISE_CATEGORIES,
    });
    const withNoiseTitle = parseFeed(OPENAI, 'openai', 40, {
      ...window,
      excludeCategories: OPENAI_NOISE_CATEGORIES,
      noiseTitle: OPENAI_NOISE_TITLE_SHAPE,
    });
    expect(categoryOnly).toHaveLength(12);
    expect(withNoiseTitle).toHaveLength(9);
    expect(withNoiseTitle.map((f) => f.title)).not.toEqual(
      expect.arrayContaining([
        'Proaction boosts sales 60% and saves 75+ hours with Codex',
        'How invideo improves color grading 3x with GPT‑6 Astra',
        'Ringg’s AI agents resolve up to 65% of customer calls with OpenAI',
      ]),
    );
    expect(withNoiseTitle.map((f) => f.title)).toContain('Introducing GPT-6 Sol and Luna');
  });

  it('drops no launch from the labelled fixture: every title it would remove is labelled false', async () => {
    const { OPENAI_NOISE_TITLE_SHAPE } = await import('../../src/adapters/rss');
    const { OPENAI_RSS_LABELLED } = await import('../fixtures/openai-rss-labelled');
    for (const [title, launch] of OPENAI_RSS_LABELLED) {
      if (OPENAI_NOISE_TITLE_SHAPE.test(title)) expect(launch, title).toBe(false);
    }
  });
});

describe('fetchers', () => {
  it('hit the right feeds with the right source labels', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-09-26T00:00:00Z') });
    const calls = mockUpstream({
      'https://openai.com/news/rss.xml': OPENAI,
      'https://deepmind.google/blog/rss.xml': ATOM,
    });
    const { fetchDeepMind, fetchOpenAI } = await import('../../src/adapters/rss');
    const openai = await fetchOpenAI();
    // 12 pass the category filter; the noise-title rule then drops 3 uncategorised customer stories.
    expect(openai).toHaveLength(9);
    expect(openai[0].source).toBe('openai');
    expect((await fetchDeepMind())[0].source).toBe('deepmind');
    expect(calls).toEqual(['https://openai.com/news/rss.xml', 'https://deepmind.google/blog/rss.xml']);
  });
});
