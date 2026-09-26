import { describe, expect, it } from 'vitest';
import { selectMarkets, toMarket, type PolymarketEventDto } from '../../src/adapters/polymarket';
import {
  classifyMarket,
  displayOutcomes,
  familyCurves,
  isBucketTitle,
  isModelRelevant,
  isPlaceholderOutcome,
  isThinBook,
  isUnnamedSlot,
  modelFamily,
  newYorkTime,
  oddsRange,
  outcomeDeadline,
  parseDeadline,
  pickBestModelMarket,
  poolAdjacentViolators,
  readCurve,
  TRUSTED_BRACKET_DAYS,
  isTrustedRead,
  bucketCeiling,
  releaseCurveForLab,
  releaseOddsForLab,
  type FamilyCurve,
  type Market,
  type Outcome,
} from '../../src/domain/market';
// Live Gamma responses captured 2026-09-26T00:10:54Z, trimmed to the fields the adapter reads.
import releasesPage from '../fixtures/polymarket/ai-releases-keyset.json';
import grokLadder from '../fixtures/polymarket/grok-4pt7-ladder.json';

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

  it('never treats no-release or date-bucket outcomes as cumulative release odds', () => {
    const negative = {
      ...m,
      outcomes: [
        outcome({ label: 'No release by September 30', yes: 0.915, endDate: '2026-10-01T00:00:00Z' }),
      ],
    };
    expect(releaseOddsForLab([negative], 'openai', 30, NOW)).toBeUndefined();
    for (const title of ['Next GPT released on…?', 'When will GPT be released?']) {
      expect(releaseOddsForLab([{ ...m, title }], 'openai', 30, NOW)).toBeUndefined();
    }
    const placeholder = {
      ...m,
      outcomes: [outcome({ label: 'September 24', yes: 0.5, endDate: '2026-09-25T00:00:00Z' })],
    };
    expect(releaseOddsForLab([placeholder], 'openai', 7, NOW)).toBeUndefined();
  });

  it('ignores passed deadlines, bad dates and non-release markets', () => {
    const stale = market({
      labId: 'xai',
      title: 'Grok released by…?',
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

describe('filters', () => {
  it('drops uptime and outage books, keeps price debuts', () => {
    expect(isModelRelevant({ kind: 'other', title: 'Will Claude go down on __ days in September?' })).toBe(
      false,
    );
    expect(isModelRelevant({ kind: 'other', title: 'ChatGPT Full Outage by...?' })).toBe(false);
    expect(isModelRelevant({ kind: 'other', title: 'Claude Opus 5.6+: Output Token Price Debut?' })).toBe(
      true,
    );
  });

  it('treats "Placeholder N" like "Company A"', () => {
    expect(isUnnamedSlot('Placeholder 12')).toBe(true);
    expect(isUnnamedSlot('Placeholder')).toBe(false);
  });

  it('knows date-bucket events from ladders', () => {
    expect(isBucketTitle('Next Claude Sonnet released on...?')).toBe(true);
    expect(isBucketTitle('When will the next Google Gemini Pro model be released?')).toBe(true);
    expect(isBucketTitle('Next Claude Sonnet released by...?')).toBe(false);
  });
});

describe('thin books', () => {
  it('gates at a 10¢ spread and on one-sided or crossed books', () => {
    expect(isThinBook(0.86, 0.87)).toBe(false);
    expect(isThinBook(0.3, 0.4)).toBe(false);
    expect(isThinBook(0.3, 0.41)).toBe(true);
    expect(isThinBook(0.02, 0.8)).toBe(true);
    expect(isThinBook(undefined, 0.3)).toBe(true);
    expect(isThinBook(0, 0.3)).toBe(true);
    expect(isThinBook(0.5, 0.4)).toBe(true);
  });

  it('exposes a thin outcome as its bid-ask range', () => {
    expect(oddsRange(outcome({ thin: true, bestBid: 0.02, bestAsk: 0.8 }))).toEqual([0.02, 0.8]);
    expect(oddsRange(outcome({ thin: true, bestAsk: 0.3 }))).toEqual([0, 0.3]);
    expect(oddsRange(outcome({ thin: true }))).toBeUndefined();
    expect(oddsRange(outcome({ thin: false, bestBid: 0.4, bestAsk: 0.45 }))).toBeUndefined();
  });
});

const iso = (t: number | undefined) => (t === undefined ? undefined : new Date(t).toISOString());

describe('newYorkTime', () => {
  it('follows US daylight time: second Sunday of March to first Sunday of November', () => {
    // 2026-03-08 and 2026-11-01 are the switch days.
    expect(iso(newYorkTime(2026, 2, 7, 23, 59, 59))).toBe('2026-03-08T04:59:59.000Z');
    expect(iso(newYorkTime(2026, 2, 8))).toBe('2026-03-08T05:00:00.000Z');
    expect(iso(newYorkTime(2026, 2, 8, 23, 59, 59))).toBe('2026-03-09T03:59:59.000Z');
    expect(iso(newYorkTime(2026, 10, 1))).toBe('2026-11-01T04:00:00.000Z');
    expect(iso(newYorkTime(2026, 10, 1, 23, 59, 59))).toBe('2026-11-02T04:59:59.000Z');
    // Gamma's own endDates for "by September 30" and "by December 31", to the minute.
    expect(iso(newYorkTime(2026, 8, 30, 23, 59, 59))).toBe('2026-10-01T03:59:59.000Z');
    expect(iso(newYorkTime(2026, 11, 31, 23, 59, 59))).toBe('2027-01-01T04:59:59.000Z');
    expect(iso(newYorkTime(2027, 2, 14, 12))).toBe('2027-03-14T16:00:00.000Z');
  });
});

describe('parseDeadline', () => {
  const near = Date.parse('2026-10-01T03:59:00Z');
  const read = (text: string, context?: Parameters<typeof parseDeadline>[1]) => {
    const d = parseDeadline(text, context);
    return d && { kind: d.kind, start: iso(d.start), deadline: iso(d.deadline) };
  };

  it('reads "by" dates as the last second of that New York day', () => {
    expect(read('Will the next Claude Sonnet model be released by September 30, 2026?')).toEqual({
      kind: 'by',
      start: undefined,
      deadline: '2026-10-01T03:59:59.000Z',
    });
    expect(read('by Sep 30', { near })?.deadline).toBe('2026-10-01T03:59:59.000Z');
    expect(read('Released by Sept. 30th?', { near })?.deadline).toBe('2026-10-01T03:59:59.000Z');
    expect(read('September 30', { near })).toMatchObject({
      kind: 'by',
      deadline: '2026-10-01T03:59:59.000Z',
    });
  });

  it('takes the year nearest the endDate when the text has none', () => {
    const newYear = Date.parse('2027-01-02T04:59:00Z');
    expect(read('December 31', { near: newYear })?.deadline).toBe('2027-01-01T04:59:59.000Z');
    expect(read('January 1', { near: Date.parse('2026-12-20T00:00:00Z') })?.deadline).toBe(
      '2027-01-02T04:59:59.000Z',
    );
    expect(read('by Sep 30')).toBeUndefined();
  });

  it('reads "before" as the end of the previous day', () => {
    expect(read('released before November 1, 2026?')).toEqual({
      kind: 'by',
      start: undefined,
      deadline: '2026-11-01T03:59:59.000Z',
    });
    expect(read('Prior to August 31', { bucket: true, near })).toMatchObject({
      kind: 'window',
      deadline: '2026-08-31T03:59:59.000Z',
    });
  });

  it('reads day buckets', () => {
    expect(read('Will Grok be released on Sep 22, 2026?')).toEqual({
      kind: 'day',
      start: '2026-09-22T04:00:00.000Z',
      deadline: '2026-09-23T03:59:59.000Z',
    });
    expect(read('September 25', { bucket: true, near })).toMatchObject({ kind: 'day' });
    expect(read('On or prior to October 1', { bucket: true, near })).toEqual({
      kind: 'window',
      start: undefined,
      deadline: '2026-10-02T03:59:59.000Z',
    });
  });

  it('reads week buckets, across a month and a year end', () => {
    expect(read('Will it be released between September 21 and September 27, 2026?')).toEqual({
      kind: 'window',
      start: '2026-09-21T04:00:00.000Z',
      deadline: '2026-09-28T03:59:59.000Z',
    });
    expect(read('between December 28 and January 3, 2027')).toMatchObject({
      start: '2026-12-28T05:00:00.000Z',
      deadline: '2027-01-04T04:59:59.000Z',
    });
    expect(read('October 5–11', { bucket: true, near })).toMatchObject({
      start: '2026-10-05T04:00:00.000Z',
      deadline: '2026-10-12T03:59:59.000Z',
    });
    expect(read('Sep 28 - Oct 4', { bucket: true, near })?.deadline).toBe('2026-10-05T03:59:59.000Z');
  });

  it('never reads a clock time as the end of a range', () => {
    for (const text of [
      'Will GPT-6 be released by September 30, 2026 - 11:59 PM ET?',
      'Will GPT-6 be released by October 1, 2026 - 11:59 PM ET?',
    ]) {
      expect(read(text, { near })).toMatchObject({ kind: 'by', start: undefined });
    }
  });

  it('reads "on or before" as a cumulative rung outside bucket events', () => {
    expect(read('Will GPT-6 be released on or before October 1, 2026?')).toEqual({
      kind: 'by',
      start: undefined,
      deadline: '2026-10-02T03:59:59.000Z',
    });
  });

  it('reads "No release by" as the complement', () => {
    expect(read('No release by October 15', { near })).toMatchObject({
      kind: 'no-release',
      deadline: '2026-10-16T03:59:59.000Z',
    });
    expect(read('Will there be no next Claude Sonnet model release by October 15, 2026?')?.kind).toBe(
      'no-release',
    );
    expect(read('Will GPT-7 not be released by December 31, 2026?')?.kind).toBe('no-release');
  });

  it('refuses tails, impossible days and text without a date', () => {
    expect(read('After October 31', { near })).toBeUndefined();
    expect(read('by February 30, 2026')).toBeUndefined();
    expect(read('between February 30 and March 3, 2026')).toBeUndefined();
    expect(read('No release by February 30, 2026')).toBeUndefined();
    expect(read('Will GPT-6 be released in 2026?')).toBeUndefined();
  });
});

describe('outcomeDeadline', () => {
  it('prefers the question, then the label, and never the later endDate', () => {
    expect(
      outcomeDeadline(['Next Grok Model (4.7+) released by September 12, 2026?', 'September 12'], {
        bucket: false,
        endDate: '2026-10-12T23:59:00Z',
      }),
    ).toEqual({ deadline: '2026-09-13T03:59:59.000Z', deadlineKind: 'by' });
    expect(
      outcomeDeadline(['Will it ship?', 'September 30'], { bucket: false, endDate: '2026-10-01T03:59:00Z' }),
    ).toEqual({ deadline: '2026-10-01T03:59:59.000Z', deadlineKind: 'by' });
  });

  it('keeps the bucket start', () => {
    expect(
      outcomeDeadline([undefined, 'October 2'], { bucket: true, endDate: '2026-10-02T23:59:00Z' }),
    ).toEqual({
      deadline: '2026-10-03T03:59:59.000Z',
      deadlineKind: 'day',
      windowStart: '2026-10-02T04:00:00.000Z',
    });
  });

  it('falls back to endDate only for a dateless ladder rung', () => {
    const endDate = '2027-01-01T04:59:00Z';
    expect(outcomeDeadline(['Will GPT-6 be released in 2026?'], { bucket: false, endDate })).toEqual({
      deadline: '2027-01-01T04:59:00.000Z',
      deadlineKind: 'by',
    });
    expect(outcomeDeadline(['Other'], { bucket: true, endDate })).toBeUndefined();
    expect(outcomeDeadline(['No release in 2026'], { bucket: false, endDate })).toBeUndefined();
    expect(outcomeDeadline(['After 2026'], { bucket: false, endDate })).toBeUndefined();
    expect(outcomeDeadline(['Will GPT-6 be released in 2026?'], { bucket: false })).toBeUndefined();
    expect(
      outcomeDeadline(['Will GPT-6 be released in 2026?'], { bucket: false, endDate: 'soon' }),
    ).toBeUndefined();
  });
});

describe('modelFamily', () => {
  it('names the family from the event title', () => {
    expect(modelFamily('Next Claude Sonnet released by…?')).toEqual({
      key: 'claude sonnet',
      name: 'Next Claude Sonnet',
    });
    expect(modelFamily('GPT-6 released by…?')).toEqual({ key: 'gpt-6', name: 'GPT-6' });
    expect(modelFamily('Grok 5 released by…?')?.key).toBe('grok 5');
    expect(modelFamily('Next Grok Model (4.8+) released by…?')).toEqual({
      key: 'grok 4.8+',
      name: 'Next Grok (4.8+)',
    });
    expect(modelFamily('Gemini 4 Pro release date?')?.name).toBe('Gemini 4 Pro');
    expect(modelFamily('Next Muse Spark (1.4+) released by…?')?.key).toBe('muse spark 1.4+');
    expect(modelFamily('Meta\'s "Watermelon" model released by…?')?.key).toBe('watermelon');
    expect(modelFamily('Next Z.ai GLM (5.4+) released by…?')?.key).toBe('glm 5.4+');
  });

  it('gives ladders and bucket events of one family the same key', () => {
    const key = (t: string) => modelFamily(t)?.key;
    expect(key('Next Google Gemini Pro Model released by…?')).toBe('gemini pro');
    expect(key('Next Gemini Pro Model released on…?')).toBe('gemini pro');
    expect(modelFamily('When will the next Google Gemini Pro model be released?')).toEqual({
      key: 'gemini pro',
      name: 'Next Google Gemini Pro',
    });
    expect(key('Next Muse Spark Model (1.4+) released on…?')).toBe(
      key('Next Muse Spark (1.4+) released by…?'),
    );
    expect(key('Next Claude Opus released by…?')).not.toBe(key('Next Claude Sonnet released by…?'));
  });

  it('ignores titles that are not release questions', () => {
    expect(modelFamily('Which company has the best AI model end of September?')).toBeUndefined();
    expect(modelFamily('Next released by…?')).toBeUndefined();
  });
});

describe('poolAdjacentViolators', () => {
  it('pools a violating pair to its weighted mean', () => {
    // The live Sonnet pair: Sep 29 at 0.865 ($2,549) above Sep 30 at 0.84 ($4,689).
    const [a, b] = poolAdjacentViolators([0.865, 0.84], [2549.3982, 4689.1712]);
    expect(a).toBeCloseTo(0.8488, 4);
    expect(b).toBe(a);
  });

  it('leaves a monotone curve alone and cascades pools backwards', () => {
    expect(poolAdjacentViolators([0.1, 0.2, 0.3], [1, 1, 1])).toEqual([0.1, 0.2, 0.3]);
    expect(poolAdjacentViolators([0.3, 0.5, 0.2, 0.1], [1, 1, 1, 1])).toEqual([0.275, 0.275, 0.275, 0.275]);
    expect(poolAdjacentViolators([], [])).toEqual([]);
  });
});

const DAY = 86_400_000;
const at = (s: string) => Date.parse(s);

/** A release outcome with a two-sided book around `mid`. */
const quote = (label: string, deadline: string, mid: number, extra: Partial<Outcome> = {}): Outcome =>
  outcome({
    label,
    yes: mid,
    deadline,
    deadlineKind: 'by',
    bestBid: mid - 0.005,
    bestAsk: mid + 0.005,
    thin: false,
    liquidity: 1000,
    ...extra,
  });

describe('readCurve', () => {
  const now = at('2026-09-01T00:00:00Z');
  const curve = familyCurves(
    [
      market({
        labId: 'openai',
        title: 'GPT-6 released by…?',
        url: 'gpt6',
        outcomes: [
          quote('Sep 11', '2026-09-11T00:00:00Z', 0.19),
          quote('Sep 21', '2026-09-21T00:00:00Z', 0.64),
        ],
      }),
    ],
    now,
  )[0];

  it('interpolates at constant hazard from now to the first deadline', () => {
    const r = readCurve(curve, now + 5 * DAY, now)!;
    // S(t) = 0.81^(5/10) = 0.9
    expect(r.p).toBeCloseTo(0.1, 6);
    expect(r).toMatchObject({ interpolated: true, lowerBound: false, source: 'curve', url: 'gpt6' });
    expect(r.from).toBeUndefined();
    expect(r.to?.label).toBe('Sep 11');
  });

  it('interpolates at constant hazard between deadlines', () => {
    const r = readCurve(curve, now + 15 * DAY, now)!;
    // S = 0.81 · (0.36/0.81)^(1/2) = 0.54
    expect(r.p).toBeCloseTo(0.46, 6);
    expect([r.from?.label, r.to?.label]).toEqual(['Sep 11', 'Sep 21']);
  });

  it('holds the rung before a read whose next rung is more than 14 days past it', () => {
    // Live 2026-09-26: Flash-Lite read 15.6% at 7 days across a 61-day gap, 7.5% (Sep 30) to 94.5% (Nov 30).
    const now = at('2026-09-26T03:22:00Z');
    const [gap] = familyCurves(
      [
        market({
          labId: 'google',
          title: 'Next Google Gemini Flash-Lite Model (3.6+) released by…?',
          url: 'flash-lite',
          outcomes: [
            quote('September 30', '2026-10-01T03:59:59.000Z', 0.075),
            quote('November 30', '2026-12-01T04:59:59.000Z', 0.945),
          ],
        }),
      ],
      now,
    );
    const r7 = readCurve(gap, now + 7 * DAY, now)!;
    expect(r7).toMatchObject({ p: 0.075, interpolated: false, lowerBound: true, upperBound: false });
    expect([r7.from?.label, r7.to?.label]).toEqual(['September 30', 'November 30']);
    expect(isTrustedRead(r7, now + 7 * DAY)).toBe(true);
    // 14 days short of the next rung, constant hazard is back.
    const near = at('2026-11-17T04:59:59.000Z');
    expect(readCurve(gap, near, now)).toMatchObject({ interpolated: true, lowerBound: false });
    expect(readCurve(gap, near - 1000, now)).toMatchObject({ p: 0.075, lowerBound: true });
  });

  it('reads a quoted deadline exactly and holds the last point as a floor beyond it', () => {
    expect(readCurve(curve, at('2026-09-21T00:00:00Z'), now)).toMatchObject({ p: 0.64, interpolated: false });
    const beyond = readCurve(curve, now + 40 * DAY, now)!;
    expect(beyond).toMatchObject({ p: 0.64, interpolated: false, lowerBound: true });
    expect(beyond.to).toBeUndefined();
  });

  it('reads a certain release as certain from then on', () => {
    const done = familyCurves(
      [
        market({
          labId: 'openai',
          title: 'GPT-6 released by…?',
          outcomes: [
            quote('a', '2026-09-05T00:00:00Z', 1, { bestBid: 1, bestAsk: 1 }),
            quote('b', '2026-09-09T00:00:00Z', 1, { bestBid: 1, bestAsk: 1 }),
          ],
        }),
      ],
      now,
    )[0];
    expect(readCurve(done, at('2026-09-07T00:00:00Z'), now)?.p).toBe(1);
  });

  it('returns nothing for a family with no usable quotes', () => {
    const empty: FamilyCurve = { ...curve, points: [], floors: [] };
    expect(readCurve(empty, now + DAY, now)).toBeUndefined();
  });
});

describe('familyCurves', () => {
  const now = at('2026-09-01T00:00:00Z');

  it('turns "No release by" into release odds: 91.5% no becomes 8.5% yes', () => {
    const [curve] = familyCurves(
      [
        market({
          labId: 'google',
          title: 'When will the next Google Gemini Pro model be released?',
          outcomes: [
            outcome({
              label: 'No release by September 30',
              yes: 0.915,
              deadline: '2026-10-01T03:59:59.000Z',
              deadlineKind: 'no-release',
              bestBid: 0.91,
              bestAsk: 0.92,
              thin: false,
            }),
          ],
        }),
      ],
      now,
    );
    expect(curve.points[0]).toMatchObject({ label: 'September 30', deadline: '2026-10-01T03:59:59.000Z' });
    expect(curve.points[0].p).toBeCloseTo(0.085, 6);
  });

  it('lifts the curve to the best-bid floor of its day buckets, never their midpoints', () => {
    const buckets = market({
      labId: 'xai',
      title: 'Grok 5 released on…?',
      url: 'days',
      outcomes: ['2026-09-02', '2026-09-03', '2026-09-04'].map((d) =>
        outcome({
          label: d,
          // Midpoints would sum to 1.2; the bids sum to 0.3.
          yes: 0.4,
          bestBid: 0.1,
          bestAsk: 0.7,
          thin: true,
          deadline: `${d}T23:00:00.000Z`,
          deadlineKind: 'day',
        }),
      ),
    });
    const ladder = market({
      labId: 'xai',
      title: 'Grok 5 released by…?',
      url: 'ladder',
      outcomes: [quote('Oct 31', '2026-11-01T03:59:59.000Z', 0.2)],
    });
    const [curve] = familyCurves([buckets, ladder], now);
    expect(curve.family).toBe('Grok 5');
    expect(curve.floors[0].steps.map((s) => s.p)).toEqual([0.1, 0.2, 0.30000000000000004]);
    const r = readCurve(curve, now + 7 * DAY, now)!;
    expect(r).toMatchObject({ source: 'buckets', lowerBound: true, interpolated: false, url: 'days' });
    expect(r.p).toBeCloseTo(0.3, 9);
    // With no ladder, the floor alone answers, and it is zero before any bucket closes.
    const [bucketsOnly] = familyCurves([buckets], now);
    expect(readCurve(bucketsOnly, now + 7 * DAY, now)?.p).toBeCloseTo(0.3, 9);
    expect(readCurve(bucketsOnly, now + 12 * 3_600_000, now)).toMatchObject({ p: 0, source: 'buckets' });
  });

  it("caps the curve at the sum of the day buckets' asks when they cover the horizon", () => {
    // Live 2026-09-26T03:22Z, Muse Spark: the ladder read 31% at 7 days between Sep 30 (14%) and
    // Oct 16 (85.5%), while buying every bucket up to Oct 2 cost 0.12 + 0.064.
    const now = at('2026-09-26T03:22:04Z');
    const bucket = (label: string, deadline: string, bid: number, ask: number, windowStart?: string) =>
      outcome({
        label,
        yes: (bid + ask) / 2,
        bestBid: bid,
        bestAsk: ask,
        deadline,
        deadlineKind: windowStart ? 'day' : 'window',
        ...(windowStart ? { windowStart } : {}),
      });
    const days = market({
      labId: 'meta',
      title: 'Next Muse Spark Model (1.4+) released on…?',
      url: 'muse-on',
      outcomes: [
        bucket('On or prior to October 1', '2026-10-02T03:59:59.000Z', 0.1, 0.12),
        bucket('October 2', '2026-10-03T03:59:59.000Z', 0.002, 0.064, '2026-10-02T04:00:00.000Z'),
        bucket('October 3', '2026-10-04T03:59:59.000Z', 0.002, 0.063, '2026-10-03T04:00:00.000Z'),
      ],
    });
    const ladder = market({
      labId: 'meta',
      title: 'Next Muse Spark (1.4+) released by…?',
      url: 'muse-by',
      outcomes: [
        quote('September 30', '2026-10-01T03:59:59.000Z', 0.14),
        quote('October 9', '2026-10-10T03:59:59.000Z', 0.855),
      ],
    });
    const [curve] = familyCurves([days, ladder], now);
    expect(curve.ceilings).toHaveLength(1);
    const at7 = now + 7 * DAY;
    const uncapped = readCurve({ ...curve, ceilings: [] }, at7, now)!;
    expect(uncapped.p).toBeGreaterThan(0.3);
    const r = readCurve(curve, at7, now)!;
    expect(r).toMatchObject({
      p: 0.184,
      upperBound: true,
      lowerBound: false,
      interpolated: false,
      source: 'buckets',
      url: 'muse-on',
    });
    expect(isTrustedRead(r, at7)).toBe(true);
    // Below the ceiling the curve read stands.
    expect(readCurve(curve, now + 3 * DAY, now)).toMatchObject({ upperBound: false, source: 'curve' });
  });

  it('only caps when open buckets with asks cover now through the horizon', () => {
    const now = at('2026-09-26T12:00:00Z');
    const day = (d: number, ask?: number) => ({
      start: `2026-09-${d}T04:00:00.000Z`,
      deadline: `2026-09-${d + 1}T03:59:59.000Z`,
      ...(ask !== undefined ? { ask } : {}),
    });
    const ceiling = (buckets: ReturnType<typeof day>[]) => ({ url: 'u', buckets });
    const horizon = at('2026-09-28T12:00:00Z');
    expect(
      bucketCeiling(ceiling([day(26, 0.1), day(27, 0.2), day(28, 0.3), day(29, 0.4)]), horizon, now),
    ).toBe(0.6);
    // An open-ended first bucket covers everything before its deadline.
    const prior = { deadline: '2026-09-27T03:59:59.000Z', ask: 0.05 };
    expect(bucketCeiling({ url: 'u', buckets: [prior, day(27, 0.2), day(28, 0.3)] }, horizon, now)).toBe(
      0.55,
    );
    // A missing day, a bucket nobody offers, buckets that start after now or stop short: no cap.
    expect(bucketCeiling(ceiling([day(26, 0.1), day(28, 0.3)]), horizon, now)).toBeUndefined();
    expect(bucketCeiling(ceiling([day(26, 0.1), day(27), day(28, 0.3)]), horizon, now)).toBeUndefined();
    expect(bucketCeiling(ceiling([day(27, 0.2), day(28, 0.3)]), horizon, now)).toBeUndefined();
    expect(bucketCeiling(ceiling([day(26, 0.1), day(27, 0.2)]), horizon, now)).toBeUndefined();
    expect(bucketCeiling(ceiling([]), horizon, now)).toBeUndefined();
    // Asks can sum past 1; the cap never does.
    expect(bucketCeiling(ceiling([day(26, 0.5), day(27, 0.5), day(28, 0.5)]), horizon, now)).toBe(1);
  });

  it('keeps an "on or before" ladder cumulative instead of summing its rungs as buckets', () => {
    const rung = (day: number, p: number) => ({
      question: `Will GPT-6 be released on or before October ${day}, 2026?`,
      groupItemTitle: `October ${day}`,
      outcomes: '["Yes","No"]',
      outcomePrices: `["${p}","${1 - p}"]`,
      bestBid: p - 0.01,
      bestAsk: p + 0.01,
      endDate: `2026-10-${day}T23:59:00Z`,
    });
    const ladder = toMarket({
      slug: 'gpt-6',
      title: 'GPT-6 released by...?',
      markets: [rung(1, 0.3), rung(5, 0.6), rung(20, 0.7)],
    })!;
    const now = at('2026-09-28T00:00:00Z');
    const [curve] = familyCurves([ladder], now);
    expect(curve.floors).toEqual([]);
    expect(curve.ceilings).toEqual([]);
    expect(curve.points.map((p) => p.p)).toEqual([0.3, 0.6, 0.7]);
    // Summed as buckets, the bids would have claimed a certain release by October 20.
    expect(readCurve(curve, at('2026-10-21T12:00:00Z'), now)).toMatchObject({ p: 0.7, lowerBound: true });
  });

  it('skips closed, past, dateless and unpriceable outcomes, and counts thin ones', () => {
    const [curve] = familyCurves(
      [
        market({
          labId: 'openai',
          title: 'GPT-6 released by…?',
          outcomes: [
            quote('closed', '2026-09-20T00:00:00Z', 0.5, { closed: true }),
            quote('past', '2026-08-20T00:00:00Z', 0.5),
            quote('dateless', '', 0.5, { deadline: undefined }),
            quote('junk', 'not a date', 0.5),
            quote('broken', '2026-09-20T00:00:00Z', 0.5, { bestBid: undefined, bestAsk: undefined, yes: 2 }),
            quote('thin', '2026-09-20T00:00:00Z', 0.5, { thin: true }),
            quote('legacy', '2026-09-20T00:00:00Z', 0.5, {
              thin: undefined,
              bestBid: undefined,
              bestAsk: undefined,
            }),
            quote('kept', '2026-09-25T00:00:00Z', 0.6, { bestBid: undefined, bestAsk: undefined }),
          ],
        }),
      ],
      now,
    );
    expect(curve.points.map((p) => p.label)).toEqual(['kept']);
    expect(curve.points[0]).toMatchObject({ p: 0.6, spread: 0 });
    expect(curve.thinExcluded).toBe(2);
  });

  it('drops families with nothing open and markets without a lab or family', () => {
    expect(
      familyCurves(
        [
          market({
            labId: 'openai',
            title: 'GPT-6 released by…?',
            outcomes: [quote('x', '2026-09-20T00:00:00Z', 0.5, { closed: true })],
          }),
          market({
            title: 'SSI public model released by…?',
            outcomes: [quote('x', '2026-09-20T00:00:00Z', 0.5)],
          }),
          market({
            labId: 'openai',
            kind: 'leaderboard',
            title: 'Best AI model?',
            outcomes: [quote('x', '2026-09-20T00:00:00Z', 0.5)],
          }),
          market({
            labId: 'openai',
            title: 'Will GPT-6 ship?',
            outcomes: [quote('x', '2026-09-20T00:00:00Z', 0.5)],
          }),
        ],
        now,
      ),
    ).toEqual([]);
  });
});

describe('release curves on live markets', () => {
  const NOW = at('2026-09-26T00:10:54Z');
  const markets = selectMarkets(releasesPage.events as PolymarketEventDto[]);
  const curves = familyCurves(markets, NOW);
  const curve = (labId: string, key: string) => curves.find((c) => c.labId === labId && c.key === key)!;

  it('keeps every curve monotone', () => {
    for (const c of curves) {
      const ps = c.points.map((p) => p.p);
      expect(ps).toEqual([...ps].sort((a, b) => a - b));
    }
  });

  it('pools the non-monotone Sonnet Sep 29/30 pair', () => {
    const sonnet = curve('anthropic', 'claude sonnet');
    const pair = sonnet.points.filter((p) => ['September 29', 'September 30'].includes(p.label));
    expect(pair.map((p) => p.quoted)).toEqual([0.865, 0.84]);
    expect(pair[0].p).toBeCloseTo(0.8488, 4);
    expect(pair[1].p).toBe(pair[0].p);
    // The day-bucket event joins the same family as a floor.
    expect(sonnet.floors).toHaveLength(1);
    expect(sonnet.thinExcluded).toBe(1);
  });

  it('never pools two families, even for one lab', () => {
    expect(curves.filter((c) => c.labId === 'xai').map((c) => c.family)).toEqual([
      'Grok 5',
      'Next Grok (4.8+)',
    ]);
    expect(curve('xai', 'grok 5').points[0].p).toBe(0.045);
  });

  it('files Muse Spark under Meta, ladder and day buckets together', () => {
    const muse = curve('meta', 'muse spark 1.4+');
    expect(muse.family).toBe('Next Muse Spark (1.4+)');
    expect(muse.points.map((p) => p.label)).toEqual([
      'September 25',
      'September 30',
      'October 16',
      'October 31',
    ]);
    expect(muse.floors).toHaveLength(1);
  });

  it('reads Google\'s live "No release by September 30" at 97.55% as 2.45% release odds', () => {
    const gemini = curve('google', 'gemini pro');
    const sep30 = gemini.points.find((p) => p.deadline === '2026-10-01T03:59:59.000Z')!;
    // The fit pools it with the ladder's own Sep 30 rung (2.65%), weighted by liquidity; the quote
    // the headline cites stays the heaviest market's own mid.
    expect(sep30.pooled).toBeCloseTo(0.0253, 4);
    expect(sep30.quoted).toBeCloseTo(0.0245, 6);
    const noRelease = toMarket(
      releasesPage.events.find(
        (e) => e.title === 'Next Google Gemini Pro Model released on...?',
      ) as PolymarketEventDto,
    )!.outcomes.find((o) => o.label === 'No release by September 30')!;
    expect(1 - (noRelease.bestBid! + noRelease.bestAsk!) / 2).toBeCloseTo(0.0245, 6);
    expect(gemini.points.find((p) => p.label === 'October 9')?.deadline).toBe('2026-10-10T03:59:59.000Z');
  });

  it('leaves a family with only thin books without a curve', () => {
    const qwenMax = curve('qwen', 'qwen max 3.9+');
    expect(qwenMax.points).toEqual([]);
    expect(qwenMax.thinExcluded).toBe(2);
    expect(qwenMax.maxSpread).toBeUndefined();
  });

  it("picks each lab's strongest family at now+7d and now+30d", () => {
    const sonnet = releaseCurveForLab(markets, 'anthropic', NOW)!;
    expect(sonnet).toMatchObject({
      family: 'Next Claude Sonnet',
      interpolated: true,
      thinExcluded: 1,
      maxSpread: 0.024,
    });
    expect(sonnet.p7).toBeCloseTo(0.8543, 4);
    expect(sonnet.p30).toBeCloseTo(0.9362, 4);
    expect([sonnet.bracket7.from?.label, sonnet.bracket7.to?.label]).toEqual(['September 30', 'October 15']);
    expect(sonnet.marketUrl).toContain('next-claude-sonnet-released-by');

    // xAI had no odds at all while its outcomes' endDates were trusted.
    expect(releaseOddsForLab(markets, 'xai', 7, NOW)).toBeUndefined();
    const grok = releaseCurveForLab(markets, 'xai', NOW)!;
    expect(grok.family).toBe('Next Grok (4.8+)');
    expect(grok.p7).toBeCloseTo(0.1206, 4);
    expect(grok.bracket7.from).toBeUndefined();

    // Qwen's card read 41% off a 2¢/80¢ book; the curve reads the one quoted rung it has.
    expect(releaseOddsForLab(markets, 'qwen', 7, NOW)?.p).toBe(0.41);
    const qwen = releaseCurveForLab(markets, 'qwen', NOW)!;
    expect(qwen.family).toBe('Next Alibaba Qwen Plus (3.8+)');
    expect(qwen.p7).toBeLessThan(0.1);

    // At 72 hours the Sep 27 → Sep 29 interpolation read 55%; the "released on" buckets up to Sep 28
    // cost 0.47 in all, so the read is capped there.
    expect(sonnet.bracket72).toMatchObject({ upperBound: true, source: 'buckets' });
    expect(sonnet.bracket72.url).toContain('next-claude-sonnet-released-on');
    expect(sonnet.p72).toBeCloseTo(0.47, 6);

    // Muse Spark's next rung after Sep 30 is Oct 16, over 14 days past the 7-day horizon: held at 14%.
    const muse = releaseCurveForLab(markets, 'meta', NOW)!;
    expect(muse.family).toBe('Next Muse Spark (1.4+)');
    expect(muse.bracket7).toMatchObject({ lowerBound: true, interpolated: false });
    expect(muse.p7).toBe(0.14);
    expect(muse.trusted7).toBe(true);
    expect(releaseCurveForLab(markets, 'google', NOW)?.p7).toBeCloseTo(0.0368, 4);
    expect(releaseCurveForLab(markets, 'openai', NOW)).toBeUndefined();
  });

  it('reads the Grok 4.7 ladder by its labels, a month before its endDates', () => {
    // Structure and dates from the live (now resolved) ladder; prices set as of Sep 10.
    const prices: Record<string, number> = {
      'September 12': 0.2,
      'September 14': 0.4,
      'September 18': 0.855,
    };
    const ladder = toMarket(grokLadder as PolymarketEventDto)!;
    const open = {
      ...ladder,
      outcomes: ladder.outcomes.map((o) => ({
        ...o,
        closed: false,
        yes: prices[o.label],
        bestBid: prices[o.label] - 0.005,
        bestAsk: prices[o.label] + 0.005,
        thin: false,
        liquidity: 1000,
      })),
    };
    const sep10 = at('2026-09-10T12:00:00Z');
    expect(releaseOddsForLab([open], 'xai', 7, sep10)).toBeUndefined();
    const r = releaseCurveForLab([open], 'xai', sep10)!;
    expect([r.bracket7.from?.label, r.bracket7.to?.label]).toEqual(['September 14', 'September 18']);
    expect(r.p7).toBeGreaterThan(0.4);
    expect(r.p7).toBeLessThan(0.855);
    expect(r.bracket30).toMatchObject({ lowerBound: true });
    expect(r.p30).toBe(0.855);
  });

  it('breaks a P7 tie on P30', () => {
    const now = at('2026-09-01T00:00:00Z');
    const flat = (title: string, p30: number) =>
      market({
        labId: 'openai',
        title,
        outcomes: [quote('a', '2026-09-08T00:00:00Z', 0.5), quote('b', '2026-10-01T00:00:00Z', p30)],
      });
    expect(
      releaseCurveForLab([flat('GPT-6 released by…?', 0.6), flat('GPT-7 released by…?', 0.7)], 'openai', now)
        ?.family,
    ).toBe('GPT-7');
    expect(
      releaseCurveForLab([flat('GPT-6 released by…?', 0.7), flat('GPT-7 released by…?', 0.6)], 'openai', now)
        ?.family,
    ).toBe('GPT-6');
  });
});

describe('displayOutcomes with parsed deadlines', () => {
  it("orders by the label deadline where Gamma's endDate runs late", () => {
    const m = market({
      outcomes: [
        outcome({
          label: 'October 15',
          yes: 0.37,
          endDate: '2026-10-16T03:59:00Z',
          deadline: '2026-10-16T03:59:59.000Z',
        }),
        outcome({
          label: 'October 9',
          yes: 0.08,
          endDate: '2026-10-16T03:59:00Z',
          deadline: '2026-10-10T03:59:59.000Z',
        }),
      ],
    });
    expect(displayOutcomes(m, 2).map((o) => o.label)).toEqual(['October 9', 'October 15']);
  });

  it('drops a rung whose deadline is behind the build, before Polymarket closes it', () => {
    // Live 2026-09-26 05:15Z: Sonnet's "September 25" rung, due 03:59:59Z, was still open at "0–0¢".
    const m = market({
      outcomes: [
        outcome({ label: 'September 25', yes: 0.001, deadline: '2026-09-26T03:59:59.000Z' }),
        outcome({ label: 'September 27', yes: 0.01, deadline: '2026-09-28T03:59:59.000Z' }),
        // No parsed deadline: the Gamma endDate runs late, so it never hides a rung by itself.
        outcome({ label: 'Some day', yes: 0.2, endDate: '2026-09-20T00:00:00Z' }),
      ],
    });
    const at = Date.parse('2026-09-26T05:15:00Z');
    expect(displayOutcomes(m, 4, at).map((o) => o.label)).toEqual(['Some day', 'September 27']);
    expect(displayOutcomes(m, 4).map((o) => o.label)).toEqual(['Some day', 'September 25', 'September 27']);
    // At the deadline itself the rung still stands.
    expect(displayOutcomes(m, 4, Date.parse('2026-09-26T03:59:59.000Z')).map((o) => o.label)).toContain(
      'September 25',
    );
  });
});

describe('isTrustedRead', () => {
  const to = (deadline: string) => ({
    deadline,
    p: 0.5,
    quoted: 0.5,
    pooled: 0.5,
    label: 'x',
    url: 'u',
    spread: 0.01,
  });
  const at7 = at('2026-09-08T00:00:00Z');
  it('distrusts only a constant-hazard stretch to a first rung more than 14 days past the horizon', () => {
    const base = { interpolated: true, lowerBound: false, upperBound: false, url: 'u' } as const;
    expect(isTrustedRead({ ...base, source: 'curve', to: to('2026-09-22T00:00:00Z') }, at7)).toBe(true);
    expect(isTrustedRead({ ...base, source: 'curve', to: to('2026-09-22T00:00:01Z') }, at7)).toBe(false);
    expect(
      isTrustedRead(
        { ...base, source: 'curve', from: to('2026-09-01T00:00:00Z'), to: to('2026-12-01T00:00:00Z') },
        at7,
      ),
    ).toBe(true);
    expect(isTrustedRead({ ...base, source: 'buckets', to: to('2026-12-01T00:00:00Z') }, at7)).toBe(true);
    expect(
      isTrustedRead({ ...base, source: 'curve', lowerBound: true, from: to('2026-09-01T00:00:00Z') }, at7),
    ).toBe(true);
    expect(TRUSTED_BRACKET_DAYS).toBe(14);
  });

  it('ranks a trusted 7-day read above a higher extrapolated one', () => {
    const now = at('2026-09-01T00:00:00Z');
    const markets = [
      // Oct 10 is 32 days past the 7-day horizon (extrapolated) but 9 past the 30-day one (trusted).
      market({
        labId: 'google',
        title: 'Next Gemini Flash released by…?',
        url: 'flash',
        outcomes: [quote('Oct 10', '2026-10-10T00:00:00Z', 0.9)],
      }),
      market({
        labId: 'google',
        title: 'Gemini 4 released by…?',
        url: 'g4',
        outcomes: [quote('Sep 10', '2026-09-10T00:00:00Z', 0.2)],
      }),
    ];
    const best = releaseCurveForLab(markets, 'google', now)!;
    expect(best.family).toBe('Gemini 4');
    expect(best.trusted7).toBe(true);
    const alone = releaseCurveForLab([markets[0]], 'google', now)!;
    expect(alone).toMatchObject({ family: 'Next Gemini Flash', trusted7: false, trusted30: true });
    expect(alone.p7).toBeGreaterThan(best.p7);
  });
});
