import { describe, expect, it } from 'vitest';
import { parseEvent, releaseOddsForLab, type Market } from '../src/lib/sources/polymarket';

const NOW = Date.parse('2026-09-19T12:00:00Z');

function market(labId: string, outcomes: Market['outcomes']): Market {
  return { slug: 's', title: 't', url: 'u', vol24: 0, volume: 0, kind: 'release', labId, outcomes };
}

describe('parseEvent', () => {
  it('reads the Yes price by outcome name, not position', () => {
    const m = parseEvent({
      id: '1',
      slug: 'next-claude-opus-released-by',
      title: 'Next Claude Opus released by...?',
      markets: [
        {
          question: 'By Sept 30?',
          groupItemTitle: 'September 30',
          outcomes: '["No","Yes"]',
          outcomePrices: '["0.23","0.77"]',
          endDate: '2026-10-01T03:59:00Z',
        },
      ],
    });
    expect(m.kind).toBe('release');
    expect(m.labId).toBe('anthropic');
    expect(m.outcomes[0].yes).toBeCloseTo(0.77);
    expect(m.title.endsWith('…?')).toBe(true);
  });

  it('drops Polymarket placeholder outcomes and survives malformed prices', () => {
    const m = parseEvent({
      id: '1',
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
      ],
    });
    expect(m.kind).toBe('leaderboard');
    expect(m.outcomes.map((o) => o.label)).toEqual(['Anthropic']);
    expect(m.outcomes[0].yes).toBe(0);
  });
});

describe('releaseOddsForLab', () => {
  it('picks the highest open Yes price whose deadline is inside the horizon', () => {
    const m = market('openai', [
      { label: 'Sept 20', yes: 0.01, endDate: '2026-09-21T03:59:00Z', closed: false, vol24: 0 },
      { label: 'Sept 24', yes: 0.66, endDate: '2026-09-25T03:59:00Z', closed: false, vol24: 0 },
      { label: 'Oct 31', yes: 0.98, endDate: '2026-11-01T03:59:00Z', closed: false, vol24: 0 },
      { label: 'Sept 17', yes: 1, endDate: '2026-09-18T03:59:00Z', closed: true, vol24: 0 },
    ]);
    expect(releaseOddsForLab([m], 'openai', 7, NOW)?.label).toBe('Sept 24');
    expect(releaseOddsForLab([m], 'openai', 60, NOW)?.label).toBe('Oct 31');
    expect(releaseOddsForLab([m], 'anthropic', 60, NOW)).toBeUndefined();
  });

  it('ignores outcomes whose deadline has already passed', () => {
    const m = market('xai', [
      { label: 'old', yes: 0.9, endDate: '2026-09-01T00:00:00Z', closed: false, vol24: 0 },
    ]);
    expect(releaseOddsForLab([m], 'xai', 30, NOW)).toBeUndefined();
  });
});
