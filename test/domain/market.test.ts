import { describe, expect, it } from 'vitest';
import {
  classifyMarket,
  displayOutcomes,
  isModelRelevant,
  isPlaceholderOutcome,
  pickBestModelMarket,
  releaseOddsForLab,
  type Market,
  type Outcome,
} from '../../src/domain/market';

const NOW = Date.parse('2026-09-19T12:00:00Z');

const outcome = (o: Partial<Outcome>): Outcome => ({ label: 'x', yes: 0, closed: false, vol24: 0, ...o });
const market = (m: Partial<Market>): Market => ({
  slug: 's',
  title: 't',
  url: 'u',
  vol24: 0,
  volume: 0,
  kind: 'release',
  outcomes: [],
  ...m,
});

describe('classifyMarket', () => {
  it('recognises release, leaderboard and other', () => {
    expect(classifyMarket('Next Claude Opus released by...?')).toBe('release');
    expect(classifyMarket('When will GPT-6 be released?')).toBe('release');
    expect(classifyMarket('Which company has the best AI model end of October?')).toBe('leaderboard');
    expect(classifyMarket('Top AI model on LMArena Dec 31?')).toBe('leaderboard');
    expect(classifyMarket('Will OpenAI IPO in 2026?')).toBe('other');
  });
});

describe('isModelRelevant', () => {
  it('lets releases and leaderboards through, gates "other" on model words', () => {
    expect(isModelRelevant({ kind: 'release', title: 'anything' })).toBe(true);
    expect(isModelRelevant({ kind: 'other', title: 'Will an AI model pass the bar?' })).toBe(true);
    expect(isModelRelevant({ kind: 'other', title: 'Will Nvidia hit $5T?' })).toBe(false);
  });
});

describe('placeholders', () => {
  it('treats Other and untouched 50/50 slots as placeholders', () => {
    expect(isPlaceholderOutcome(outcome({ label: 'Other', yes: 0.02 }))).toBe(true);
    expect(isPlaceholderOutcome(outcome({ label: 'Company X', yes: 0.5, vol24: 0 }))).toBe(true);
    expect(isPlaceholderOutcome(outcome({ label: 'Anthropic', yes: 0.5, vol24: 120 }))).toBe(false);
    expect(isPlaceholderOutcome(outcome({ label: 'Anthropic', yes: 0.4 }))).toBe(false);
  });
});

describe('displayOutcomes', () => {
  it('orders release outcomes by deadline and others by probability', () => {
    const release = market({
      outcomes: [
        outcome({ label: 'Oct 31', yes: 0.9, endDate: '2026-11-01T00:00:00Z' }),
        outcome({ label: 'Sep 30', yes: 0.4, endDate: '2026-10-01T00:00:00Z' }),
        outcome({ label: 'closed', yes: 1, endDate: '2026-09-01T00:00:00Z', closed: true }),
        outcome({ label: 'no date', yes: 0.5, vol24: 10 }),
      ],
    });
    expect(displayOutcomes(release, 4).map((o) => o.label)).toEqual(['Sep 30', 'Oct 31']);

    const board = market({
      kind: 'leaderboard',
      outcomes: [
        outcome({ label: 'Google', yes: 0.6, vol24: 1 }),
        outcome({ label: 'Other', yes: 0.9 }),
        outcome({ label: 'OpenAI', yes: 0.3, vol24: 1 }),
      ],
    });
    expect(displayOutcomes(board, 1).map((o) => o.label)).toEqual(['Google']);
  });
});

describe('releaseOddsForLab', () => {
  const m = market({
    labId: 'openai',
    title: 'GPT-6 released by...?',
    outcomes: [
      outcome({ label: 'Sept 20', yes: 0.01, endDate: '2026-09-21T03:59:00Z' }),
      outcome({ label: 'Sept 24', yes: 0.66, endDate: '2026-09-25T03:59:00Z' }),
      outcome({ label: 'Oct 31', yes: 0.98, endDate: '2026-11-01T03:59:00Z' }),
      outcome({ label: 'Sept 17', yes: 1, endDate: '2026-09-18T03:59:00Z', closed: true }),
    ],
  });

  it('picks the highest open Yes price whose deadline is inside the horizon', () => {
    expect(releaseOddsForLab([m], 'openai', 7, NOW)?.label).toBe('Sept 24');
    expect(releaseOddsForLab([m], 'openai', 60, NOW)?.label).toBe('Oct 31');
    expect(releaseOddsForLab([m], 'anthropic', 60, NOW)).toBeUndefined();
  });

  it('ignores passed deadlines, bad dates and non-release markets', () => {
    const stale = market({
      labId: 'xai',
      outcomes: [
        outcome({ label: 'old', yes: 0.9, endDate: '2026-09-01T00:00:00Z' }),
        outcome({ label: 'junk', yes: 0.9, endDate: 'not a date' }),
      ],
    });
    expect(releaseOddsForLab([stale], 'xai', 30, NOW)).toBeUndefined();
    expect(releaseOddsForLab([{ ...m, kind: 'other' }], 'openai', 60, NOW)).toBeUndefined();
  });
});

describe('pickBestModelMarket', () => {
  it('prefers the canonical "which company" market by 24h volume, then any non-benchmark best-model board', () => {
    const canonical = market({
      slug: 'a',
      kind: 'leaderboard',
      vol24: 10,
      title: 'Which company has the best AI model end of October?',
    });
    const bigger = market({
      slug: 'b',
      kind: 'leaderboard',
      vol24: 99,
      title: 'Which company has the best AI model end of September?',
    });
    const arena = market({
      slug: 'c',
      kind: 'leaderboard',
      vol24: 500,
      title: 'Best AI model on Arena Dec 31?',
    });
    const fallback = market({
      slug: 'd',
      kind: 'leaderboard',
      vol24: 5,
      title: 'Best AI model at year end?',
    });
    expect(pickBestModelMarket([canonical, bigger, arena])?.slug).toBe('b');
    expect(pickBestModelMarket([arena, fallback])?.slug).toBe('d');
    expect(pickBestModelMarket([arena])).toBeUndefined();
    expect(pickBestModelMarket([])).toBeUndefined();
  });
});
