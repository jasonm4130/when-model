import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PolymarketEventDto } from '../../src/adapters/polymarket';
import { pickBestModelMarket } from '../../src/domain/market';
// Live Gamma responses captured 2026-09-26T00:10Z, trimmed to the fields the adapter reads.
import releasesPage from '../fixtures/polymarket/ai-releases-keyset.json';
import seriesPage from '../fixtures/polymarket/best-ai-company-keyset.json';
import grokLadder from '../fixtures/polymarket/grok-4pt7-ladder.json';
import { mockUpstream } from './mock-cache';

afterEach(() => vi.resetModules());

const opus: PolymarketEventDto = {
  slug: 'next-claude-opus-released-by',
  title: 'Next Claude Opus released by...?',
  volume24hr: 1200,
  volume: 90000,
  markets: [
    {
      question: 'By Sept 30?',
      groupItemTitle: 'September 30',
      outcomes: '["No","Yes"]',
      outcomePrices: '["0.23","0.77"]',
      endDate: '2026-10-01T03:59:00Z',
      volume24hr: 800,
    },
  ],
};

const live = releasesPage.events as PolymarketEventDto[];
const event = (title: string) => live.find((e) => e.title === title)!;

describe('toMarket', () => {
  it('reads the Yes price by outcome name, not position, and tidies the title', async () => {
    const { toMarket } = await import('../../src/adapters/polymarket');
    const m = toMarket(opus)!;
    expect(m.kind).toBe('release');
    expect(m.labId).toBe('anthropic');
    expect(m.outcomes[0]).toMatchObject({ label: 'September 30', yes: 0.77, closed: false, vol24: 800 });
    expect(m.title).toBe('Next Claude Opus released by…?');
    expect(m.url).toBe(
      'https://polymarket.com/event/next-claude-opus-released-by?utm_source=whenmodel.com&utm_medium=dashboard',
    );
  });

  it('drops unnamed "Company A" slots and survives malformed prices', async () => {
    const { toMarket } = await import('../../src/adapters/polymarket');
    const m = toMarket({
      slug: 'x',
      title: 'Which company has the best AI model end of October?',
      markets: [
        {
          question: 'q',
          groupItemTitle: 'Company A',
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.5","0.5"]',
        },
        { question: 'q', groupItemTitle: 'Anthropic', outcomes: '["Yes","No"]', outcomePrices: 'not json' },
        { question: 'Fallback question', outcomes: '["Yes"]', outcomePrices: '["abc"]' },
      ],
    })!;
    expect(m.kind).toBe('leaderboard');
    expect(m.outcomes.map((o) => o.label)).toEqual(['Anthropic', 'Fallback question']);
    expect(m.outcomes.map((o) => o.yes)).toEqual([0, 0]);
  });

  it('drops "Placeholder N" slots the same way', async () => {
    const { toMarket } = await import('../../src/adapters/polymarket');
    const naming = toMarket(event('What will the next Muse model family be named?'))!;
    expect(naming.labId).toBe('meta');
    expect(naming.outcomes.map((o) => o.label)).toEqual(['Muse Flame', 'Muse Blaze', 'Muse Flare']);
  });

  it('rejects events without slug or title and tolerates missing markets', async () => {
    const { toMarket } = await import('../../src/adapters/polymarket');
    expect(toMarket({ title: 'no slug' })).toBeUndefined();
    expect(toMarket({ slug: 'no-title' })).toBeUndefined();
    expect(toMarket({ slug: 's', title: 'GPT-6 released by...?' })?.outcomes).toEqual([]);
  });

  it('labels a single yes/no question "Yes" instead of repeating it', async () => {
    const { toMarket } = await import('../../src/adapters/polymarket');
    const social = toMarket(event('Will OpenAI release a social network in 2026?'))!;
    expect(social.outcomes.map((o) => o.label)).toEqual(['Yes']);
    // A lone outcome that has its own name keeps it.
    expect(toMarket(opus)!.outcomes[0].label).toBe('September 30');
    // Gamma sometimes copies the question into groupItemTitle; the answer is still "Yes".
    const echoed = event('Will OpenAI release a social network in 2026?');
    const copy = {
      ...echoed,
      markets: echoed.markets!.map((m) => ({ ...m, groupItemTitle: ` ${m.question} ` })),
    };
    expect(toMarket(copy)!.outcomes.map((o) => o.label)).toEqual(['Yes']);
  });
});

describe('order book fields', () => {
  it('maps bid, ask, spread, last trade, 24h move, liquidity and the Yes token', async () => {
    const { toMarket } = await import('../../src/adapters/polymarket');
    const sonnet = toMarket(event('Next Claude Sonnet released by...?'))!;
    expect(sonnet.outcomes.find((o) => o.label === 'September 29')).toMatchObject({
      yes: 0.865,
      bestBid: 0.86,
      bestAsk: 0.87,
      spread: 0.01,
      lastTradePrice: 0.75,
      oneDayPriceChange: 0.545,
      liquidity: 2549.3982,
      clobTokenId: '41841440035680071122113863271133962582769808013542699326073757794207051942317',
      thin: false,
    });
  });

  it('marks a wide or one-sided book thin and keeps its range', async () => {
    const { toMarket } = await import('../../src/adapters/polymarket');
    const qwen = toMarket(event('Next Alibaba Qwen Max (3.9+) released by...?'))!;
    // The "41%" the lab card used to show: a 2¢ bid under a 80¢ ask.
    expect(qwen.outcomes.find((o) => o.label === 'September 30')).toMatchObject({
      yes: 0.41,
      bestBid: 0.02,
      bestAsk: 0.8,
      thin: true,
    });
    const sonnetDays = toMarket(event('Next Claude Sonnet released on...?'))!;
    const noBids = sonnetDays.outcomes.find((o) => o.label === 'September 30')!;
    expect(noBids.bestBid).toBeUndefined();
    expect(noBids.thin).toBe(true);
  });

  it('keeps no book for closed outcomes or when Yes is not the first outcome', async () => {
    const { toMarket } = await import('../../src/adapters/polymarket');
    const gemini = toMarket(event('Next Google Gemini Pro Model released by...?'))!;
    const closed = gemini.outcomes.find((o) => o.closed)!;
    expect(closed.bestAsk).toBeUndefined();
    expect(closed.thin).toBeUndefined();
    const flipped = toMarket({
      ...opus,
      markets: [
        { ...opus.markets![0], bestBid: 0.2, bestAsk: 0.25, clobTokenIds: '["no-token","yes-token"]' },
      ],
    })!.outcomes[0];
    expect(flipped).toMatchObject({ thin: true, clobTokenId: 'yes-token' });
    expect(flipped.bestBid).toBeUndefined();
  });

  it('ignores unusable numbers and token lists', async () => {
    const { toMarket } = await import('../../src/adapters/polymarket');
    const [o] = toMarket({
      slug: 's',
      title: 'GPT-7 released by...?',
      markets: [
        {
          groupItemTitle: 'December 31',
          outcomes: '["Yes","No"]',
          outcomePrices: '["0.4","0.6"]',
          liquidity: '',
          clobTokenIds: 'nope',
        },
      ],
    })!.outcomes;
    expect(o.liquidity).toBeUndefined();
    expect(o.clobTokenId).toBeUndefined();
    expect(o.thin).toBe(true);
  });
});

describe('deadlines', () => {
  it('reads the Grok ladder deadline from the label, not its month-late endDate', async () => {
    const { toMarket } = await import('../../src/adapters/polymarket');
    const ladder = toMarket(grokLadder as PolymarketEventDto)!;
    expect(ladder.outcomes.map((o) => [o.label, o.endDate, o.deadline, o.deadlineKind])).toEqual([
      ['September 12', '2026-10-12T23:59:00Z', '2026-09-13T03:59:59.000Z', 'by'],
      ['September 14', '2026-10-14T23:59:00Z', '2026-09-15T03:59:59.000Z', 'by'],
      ['September 18', '2026-10-18T23:59:00Z', '2026-09-19T03:59:59.000Z', 'by'],
    ]);
  });

  it('does the same for a live open outcome whose endDate runs a week late', async () => {
    const { toMarket } = await import('../../src/adapters/polymarket');
    const gemini = toMarket(event('Next Google Gemini Pro Model released by...?'))!;
    expect(gemini.outcomes.find((o) => o.label === 'October 9')).toMatchObject({
      endDate: '2026-10-16T03:59:00Z',
      deadline: '2026-10-10T03:59:59.000Z',
    });
  });

  it('reads day buckets, week buckets and "No release by" outcomes', async () => {
    const { toMarket } = await import('../../src/adapters/polymarket');
    const days = toMarket(event('Next Claude Sonnet released on...?'))!;
    expect(days.outcomes.find((o) => o.label === 'September 25')).toMatchObject({
      deadlineKind: 'day',
      windowStart: '2026-09-25T04:00:00.000Z',
      deadline: '2026-09-26T03:59:59.000Z',
    });
    const weeks = toMarket(event('When will the next Google Gemini Pro model be released?'))!;
    const byLabel = (label: string) => weeks.outcomes.find((o) => o.label === label);
    expect(byLabel('Prior to August 31')).toMatchObject({
      deadlineKind: 'window',
      deadline: '2026-08-31T03:59:59.000Z',
    });
    expect(byLabel('Prior to August 31')?.windowStart).toBeUndefined();
    // Gamma ends week buckets at 23:59 UTC; the question means the end of the New York day.
    expect(byLabel('September 28–October 4')).toMatchObject({
      endDate: '2026-10-04T23:59:00Z',
      windowStart: '2026-09-28T04:00:00.000Z',
      deadline: '2026-10-05T03:59:59.000Z',
    });
    // November 1 2026 is the day daylight time ends, so its last second is 04:59:59Z.
    expect(byLabel('No release by November 1')).toMatchObject({
      deadlineKind: 'no-release',
      deadline: '2026-11-02T04:59:59.000Z',
    });
  });

  it('leaves non-release markets without deadlines', async () => {
    const { toMarket } = await import('../../src/adapters/polymarket');
    const arena = toMarket(event('Next Claude Opus Model: Text Arena Debut?'))!;
    expect(arena.kind).toBe('leaderboard');
    expect(arena.outcomes.every((o) => o.deadline === undefined)).toBe(true);
  });
});

describe('selectMarkets', () => {
  it('dedupes across tags, skips closed events and irrelevant "other" markets', async () => {
    const { selectMarkets } = await import('../../src/adapters/polymarket');
    const out = selectMarkets([
      opus,
      opus,
      { ...opus, slug: 'closed', closed: true },
      { slug: 'nvda', title: 'Will Nvidia hit $5T?' },
      { slug: 'agi', title: 'Will an AI model pass the bar exam?' },
    ]);
    expect(out.map((m) => m.slug)).toEqual(['next-claude-opus-released-by', 'agi']);
  });

  it('filters uptime and outage books but keeps price-debut markets', async () => {
    const { selectMarkets } = await import('../../src/adapters/polymarket');
    const out = selectMarkets([
      { slug: 'down', title: 'Will Claude go down on __ days in September?' },
      { slug: 'outage', title: '# of ChatGPT Outage Days in September 2026?' },
      event('Claude Opus 5.6+: Output Token Price Debut?'),
    ]);
    expect(out.map((m) => m.slug)).toEqual(['claude-opus-5pt6-output-token-price-debut']);
  });

  it('keeps the page’s best-model market when reading the best-ai-company series', async () => {
    const { selectMarkets } = await import('../../src/adapters/polymarket');
    const boards = selectMarkets(seriesPage.events as PolymarketEventDto[]);
    expect(boards.map((m) => m.title)).toContain('Which company has the best AI model end of September?');
    expect(pickBestModelMarket(boards)?.slug).toBe(
      'which-company-has-the-best-ai-model-end-of-september-20260717143435868',
    );
  });
});

const RELEASES =
  'https://gamma-api.polymarket.com/events/keyset?tag_slug=ai-releases&active=true&closed=false&order=volume24hr&ascending=false&limit=50';
const SERIES =
  'https://gamma-api.polymarket.com/events/keyset?series_slug=best-ai-company&active=true&closed=false&order=volume24hr&ascending=false&limit=50';

/** A keyset page of `count` release events with ids from `first`. */
const page = (first: number, count: number, cursor?: string) => ({
  events: Array.from({ length: count }, (_, i) => ({
    id: String(first + i),
    slug: `gpt-${first + i}`,
    title: `GPT-${first + i} released by...?`,
  })),
  ...(cursor && { next_cursor: cursor }),
});

describe('fetchMarkets', () => {
  it('reads the ai-releases and best-ai-company listings and merges them', async () => {
    const calls = mockUpstream({
      [RELEASES]: { events: [opus] },
      [SERIES]: { events: seriesPage.events.slice(1, 2) },
    });
    const { fetchMarkets } = await import('../../src/adapters/polymarket');
    const out = await fetchMarkets();
    expect(calls).toEqual([RELEASES, SERIES]);
    expect(out.map((m) => m.kind)).toEqual(['release', 'leaderboard']);
  });

  it('follows after_cursor past a full page and stops on the empty page after it', async () => {
    const calls = mockUpstream({
      [`${RELEASES}&after_cursor=p2`]: { events: [] },
      [RELEASES]: page(1, 50, 'p2'),
      [SERIES]: { events: [] },
    });
    const { fetchMarkets } = await import('../../src/adapters/polymarket');
    expect(await fetchMarkets()).toHaveLength(50);
    expect(calls).toEqual([RELEASES, SERIES, `${RELEASES}&after_cursor=p2`]);
  });

  it('stops on a short page without asking for another', async () => {
    const calls = mockUpstream({ [RELEASES]: page(1, 49, 'p2'), [SERIES]: { events: [] } });
    const { fetchMarkets } = await import('../../src/adapters/polymarket');
    expect(await fetchMarkets()).toHaveLength(49);
    expect(calls).toEqual([RELEASES, SERIES]);
  });

  it('escapes the infinite-cursor trap: a repeated page ends the walk', async () => {
    // Gamma ignores an unknown cursor parameter and serves page 1 again, cursor and all.
    const calls = mockUpstream({
      [`${RELEASES}&after_cursor=p2`]: page(1, 50, 'p2'),
      [RELEASES]: page(1, 50, 'p2'),
      [SERIES]: { events: [] },
    });
    const { fetchMarkets } = await import('../../src/adapters/polymarket');
    expect(await fetchMarkets()).toHaveLength(50);
    expect(calls.filter((u) => u.startsWith(RELEASES))).toHaveLength(2);
  });

  it('stops at three pages however many full pages Gamma offers', async () => {
    const calls = mockUpstream({
      [`${RELEASES}&after_cursor=p2`]: page(51, 50, 'p3'),
      [`${RELEASES}&after_cursor=p3`]: page(101, 50, 'p4'),
      [`${RELEASES}&after_cursor=p4`]: page(151, 50, 'p5'),
      [RELEASES]: page(1, 50, 'p2'),
      [SERIES]: { events: [] },
    });
    const { fetchMarkets } = await import('../../src/adapters/polymarket');
    expect(await fetchMarkets()).toHaveLength(150);
    expect(calls.filter((u) => u.startsWith(RELEASES))).toHaveLength(3);
  });

  it('stops when a full page carries no cursor', async () => {
    const calls = mockUpstream({ [RELEASES]: page(1, 50), [SERIES]: { events: [] } });
    const { fetchMarkets } = await import('../../src/adapters/polymarket');
    expect(await fetchMarkets()).toHaveLength(50);
    expect(calls).toEqual([RELEASES, SERIES]);
  });

  it('treats a null body as no events', async () => {
    mockUpstream({ 'https://gamma-api.polymarket.com/events': null });
    const { fetchMarkets } = await import('../../src/adapters/polymarket');
    expect(await fetchMarkets()).toEqual([]);
  });

  it('lets an upstream failure throw so collect() can degrade the source', async () => {
    mockUpstream({ [SERIES]: { events: [] } });
    const { fetchMarkets } = await import('../../src/adapters/polymarket');
    await expect(fetchMarkets()).rejects.toThrow(/404/);
  });
});
