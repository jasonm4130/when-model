import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PolymarketEventDto } from '../../src/adapters/polymarket';
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

  it('rejects events without slug or title and tolerates missing markets', async () => {
    const { toMarket } = await import('../../src/adapters/polymarket');
    expect(toMarket({ title: 'no slug' })).toBeUndefined();
    expect(toMarket({ slug: 'no-title' })).toBeUndefined();
    expect(toMarket({ slug: 's', title: 'GPT-6 released by...?' })?.outcomes).toEqual([]);
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
});

describe('fetchMarkets', () => {
  it('queries both tags and merges', async () => {
    const calls = mockUpstream({
      'https://gamma-api.polymarket.com/events?tag_slug=ai-releases': [opus],
      'https://gamma-api.polymarket.com/events?tag_slug=ai&': [
        { ...opus, slug: 'gpt-6', title: 'GPT-6 released by...?' },
      ],
    });
    const { fetchMarkets } = await import('../../src/adapters/polymarket');
    const out = await fetchMarkets();
    expect(calls).toHaveLength(2);
    expect(out.map((m) => m.labId)).toEqual(['anthropic', 'openai']);
  });

  it('treats a null body as no events', async () => {
    mockUpstream({ 'https://gamma-api.polymarket.com/events': null });
    const { fetchMarkets } = await import('../../src/adapters/polymarket');
    expect(await fetchMarkets()).toEqual([]);
  });
});
