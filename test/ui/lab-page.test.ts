import { describe, expect, it } from 'vitest';
import type { FeedItem } from '../../src/domain/feed';
import type { LabOddsRead, LabStatus } from '../../src/domain/lab-status';
import type { Landed } from '../../src/domain/landed';
import type { Market } from '../../src/domain/market';
import { LAB_PAGE_ROWS, labFeed, labPage, labWarningCount, topLabs } from '../../src/ui/lab-page';
import { warnings } from '../fixtures/warnings';

const AT = '2026-09-19T12:00:00.000Z';

const read = (p: number, trusted = true): LabOddsRead => ({
  p,
  trusted,
  interpolated: true,
  lowerBound: false,
  upperBound: false,
  source: 'curve',
  url: 'https://polymarket.com/event/x',
});

function status(
  id: LabStatus['id'],
  p7?: LabOddsRead,
  marketUrl = `https://polymarket.com/event/${id}`,
): LabStatus {
  return {
    id,
    name: id,
    short: id,
    color: '#000',
    glyph: '*',
    xHandles: [],
    polymarketCompany: id,
    drops30d: 0,
    releases30d: 0,
    histogram: [],
    odds: p7 && { family: `${id} next`, marketUrl, p72: p7, p7, p30: p7, thinExcluded: 0 },
  } as unknown as LabStatus;
}

const item = (title: string, url: string, source: FeedItem['source'] = 'hn'): FeedItem => ({
  source,
  title,
  url,
  publishedAt: AT,
  alert: false,
});

function market(slug: string, labId: string | undefined, deadline = '2026-10-01T03:59:59.000Z'): Market {
  return {
    slug,
    title: `${slug} released by...?`,
    url: `https://polymarket.com/event/${slug}`,
    vol24: 1,
    volume: 1,
    kind: 'release',
    labId,
    outcomes: [
      {
        label: 'September 30',
        yes: 0.4,
        closed: false,
        vol24: 1,
        deadline,
        deadlineKind: 'by',
        bestBid: 0.395,
        bestAsk: 0.405,
        thin: false,
        liquidity: 1000,
      },
    ],
  } as Market;
}

describe('labFeed', () => {
  it("takes every post from a lab's own feed, and a headline elsewhere only when it names the lab's models", () => {
    const feed = [
      item('Claude Mythos 6 spotted', 'https://e.com/1'),
      item('Our research update', 'https://anthropic.com/1', 'anthropic'),
      item('GPT-7 in the API', 'https://e.com/2'),
      // An OpenAI blog post that mentions Claude is OpenAI's, not Anthropic's.
      item('How we compare with Claude', 'https://openai.com/1', 'openai'),
    ];
    expect(labFeed(feed, 'anthropic').map((f) => f.url)).toEqual([
      'https://e.com/1',
      'https://anthropic.com/1',
    ]);
    expect(labFeed(feed, 'openai').map((f) => f.url)).toEqual(['https://e.com/2', 'https://openai.com/1']);
    expect(labFeed(feed, 'nope' as never)).toEqual([]);
  });
});

describe('topLabs', () => {
  it('ranks trusted 7-day reads first, an extrapolated read after, and labs with no market last in heat order', () => {
    const labs = [
      status('meta'),
      status('xai', read(0.9, false)),
      status('google', read(0.3)),
      status('anthropic', read(0.6)),
      status('openai'),
    ];
    expect(topLabs(labs).map((l) => l.id)).toEqual(['anthropic', 'google', 'xai']);
    expect(topLabs(labs, 5).map((l) => l.id)).toEqual(['anthropic', 'google', 'xai', 'meta', 'openai']);
    // With the odds offline it is the heat ranking the list already has.
    expect(topLabs([status('meta'), status('openai'), status('qwen')]).map((l) => l.id)).toEqual([
      'meta',
      'openai',
      'qwen',
    ]);
  });
});

describe('labPage', () => {
  const landed = {
    bannerText: null,
    releases: [
      { id: 'anthropic/claude-mythos-6', labId: 'anthropic' },
      { id: 'openai/gpt-7', labId: 'openai' },
    ],
    announcements: [
      {
        source: 'anthropic',
        title: 'Introducing Claude Mythos 6',
        url: 'https://anthropic.com/news/mythos-6',
        publishedAt: AT,
        seenAt: AT,
        precision: 'day',
        modelIds: [],
      },
    ],
    stories: [],
  } as unknown as Landed;

  it('is undefined for an id outside the registry', () => {
    expect(labPage({}, 'nope')).toBeUndefined();
  });

  it("gathers one lab's reads, open markets, warnings, launches and headlines, and no other lab's", () => {
    const busy = market('claude-busy', 'anthropic');
    const named = market('claude-named', 'anthropic');
    const closed = market('claude-closed', 'anthropic', '2026-09-01T03:59:59.000Z');
    const feed = [
      // The launch post is in the landed section; it is not repeated as a headline.
      item('Introducing Claude Mythos 6', 'https://anthropic.com/news/mythos-6', 'anthropic'),
      ...Array.from({ length: 12 }, (_, i) => item(`Claude tip ${i}`, `https://e.com/${i}`)),
      item('GPT-7 in the API', 'https://e.com/gpt'),
    ];
    const p = labPage(
      {
        generatedAt: AT,
        labs: [status('openai', read(0.2)), status('anthropic', read(0.5), named.url)],
        markets: [busy, named, closed, market('gpt-7', 'openai')],
        earlyWarnings: warnings(),
        landed,
        feed,
      },
      'anthropic',
    )!;
    expect(p.lab.id).toBe('anthropic');
    expect(p.status?.id).toBe('anthropic');
    // A market whose rungs have all passed has nothing to show.
    expect(p.markets.map((m) => m.slug)).toEqual(['claude-busy', 'claude-named']);
    // Its next named market is the one behind its headline read, not merely the busiest.
    expect(p.next?.slug).toBe('claude-named');
    expect(p.landed.map((r) => r.id)).toEqual(['anthropic/claude-mythos-6']);
    expect(p.announcements.map((a) => a.url)).toEqual(['https://anthropic.com/news/mythos-6']);
    expect(p.feed).toHaveLength(LAB_PAGE_ROWS.feed);
    expect(p.feed.map((f) => f.url)).not.toContain('https://anthropic.com/news/mythos-6');
    expect(p.feed.every((f) => f.title.startsWith('Claude'))).toBe(true);
    // The fixture's warnings name OpenAI and Qwen, never Anthropic; a stealth slot names no lab.
    expect(labWarningCount(p)).toBe(0);
  });

  it('puts every warning that names the lab on its page', () => {
    const openai = labPage({ earlyWarnings: warnings() }, 'openai')!;
    expect(openai.leaks).toHaveLength(2);
    expect(openai.streams).toHaveLength(1);
    expect(openai.events).toHaveLength(1);
    expect(labWarningCount(openai)).toBe(4);
    expect(labWarningCount(labPage({ earlyWarnings: warnings() }, 'qwen')!)).toBe(1);
  });

  it('falls back to the busiest market, and copes with an empty body', () => {
    const p = labPage(
      { generatedAt: AT, labs: [status('anthropic')], markets: [market('c', 'anthropic')] },
      'anthropic',
    )!;
    expect(p.next?.slug).toBe('c');
    const empty = labPage({}, 'mistral')!;
    expect(empty).toMatchObject({ markets: [], leaks: [], landed: [], announcements: [], feed: [] });
    expect(empty.status).toBeUndefined();
    expect(empty.next).toBeUndefined();
  });
});
