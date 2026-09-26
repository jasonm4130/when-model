import { describe, expect, it } from 'vitest';
import { releaseEvents, type Drop, type ReleaseEvent } from '../../src/domain/drop';
import { labById } from '../../src/domain/lab';
import {
  LAUNCH_SETTLE_MS,
  assessLab,
  computeHeat,
  familyMatchesModel,
  launchedFamilies,
  temperatureFor,
  trustedP,
} from '../../src/domain/lab-status';
import { modelFamily, type Market, type Outcome } from '../../src/domain/market';

const NOW = Date.parse('2026-09-19T12:00:00Z');
const openai = labById('openai')!;

const drop = (iso: string, labId: Drop['labId'] = 'openai'): Drop => ({
  id: `${labId}/m`,
  name: 'm',
  lab: 'OpenAI',
  labId,
  createdAt: iso,
  url: 'u',
  free: false,
});

describe('computeHeat', () => {
  it('is zero with nothing and 100 at saturation', () => {
    expect(computeHeat({ releases30d: 0 })).toEqual({ heat: 0, market: 0, recency: 0 });
    expect(computeHeat({ p72: 1, p7: 1, p30: 1, daysSince: 0, releases30d: 9 })).toEqual({
      heat: 100,
      market: 75,
      recency: 25,
    });
  });

  it('weights the 7-day read far above recency, and splits the two', () => {
    expect(computeHeat({ p7: 0.5, releases30d: 0 })).toEqual({ heat: 20, market: 20, recency: 0 });
    expect(computeHeat({ daysSince: 0, releases30d: 3 })).toEqual({ heat: 25, market: 0, recency: 25 });
  });

  it('recency decays to nothing after 30 days', () => {
    expect(computeHeat({ daysSince: 30, releases30d: 0 }).heat).toBe(0);
    expect(computeHeat({ daysSince: 90, releases30d: 0 }).heat).toBe(0);
  });
});

describe('familyMatchesModel', () => {
  const family = (title: string) => modelFamily(title)!;

  it('needs every word of the family key and an equal version', () => {
    expect(familyMatchesModel(family('GPT-6 released by...?'), 'OpenAI: GPT-6 Sol')).toBe(true);
    expect(familyMatchesModel(family('GPT-6 released by...?'), 'OpenAI: GPT-6.5')).toBe(false);
    expect(familyMatchesModel(family('GPT-6 released by...?'), 'OpenAI: GPT-5')).toBe(false);
    expect(familyMatchesModel(family('GPT-6 released by...?'), 'OpenAI: gpt-oss')).toBe(false);
    expect(
      familyMatchesModel(family('Next Claude Sonnet released by...?'), 'Anthropic: Claude Sonnet 5'),
    ).toBe(true);
    expect(familyMatchesModel(family('Next Claude Sonnet released by...?'), 'Anthropic: Claude Opus 5')).toBe(
      false,
    );
  });

  it('reads an "N+" key as at least N', () => {
    const grok = family('Next Grok (4.8+) released by...?');
    expect(familyMatchesModel(grok, 'xAI: Grok 4.8')).toBe(true);
    expect(familyMatchesModel(grok, 'xAI: Grok 5')).toBe(true);
    expect(familyMatchesModel(grok, 'xAI: Grok 4.7')).toBe(false);
    expect(familyMatchesModel(grok, 'xAI: Grok Code Fast')).toBe(false);
  });

  it('never matches a key with no words', () => {
    expect(familyMatchesModel({ key: '5', name: '5' }, 'anything 5')).toBe(false);
  });
});

describe('launchedFamilies', () => {
  const gpt6: Market = {
    slug: 'g',
    title: 'GPT-6 released by...?',
    url: 'u',
    vol24: 0,
    volume: 0,
    kind: 'release',
    labId: 'openai',
    outcomes: [],
  };
  const event = (firstListedAt: string, name: string): ReleaseEvent => ({
    id: `openai@${firstListedAt}`,
    lab: 'OpenAI',
    labId: 'openai',
    frontier: true,
    firstListedAt,
    models: [{ id: 'openai/x', name, createdAt: firstListedAt }] as ReleaseEvent['models'],
  });

  it('holds a family out for 4 days after its model lists', () => {
    const listed = new Date(NOW - LAUNCH_SETTLE_MS + 60_000).toISOString();
    expect([...launchedFamilies([gpt6], [event(listed, 'OpenAI: GPT-6 Sol')], NOW)]).toEqual(['gpt-6']);
    const stale = new Date(NOW - LAUNCH_SETTLE_MS - 60_000).toISOString();
    expect(launchedFamilies([gpt6], [event(stale, 'OpenAI: GPT-6 Sol')], NOW).size).toBe(0);
    expect(launchedFamilies([gpt6], [event(listed, 'OpenAI: GPT-5.9')], NOW).size).toBe(0);
  });
});

describe('temperatureFor', () => {
  it('SHIPPING overrides heat; otherwise thresholds at 60 and 25', () => {
    expect(temperatureFor(0, 2)).toBe('SHIPPING');
    expect(temperatureFor(0, 3)).toBe('QUIET');
    expect(temperatureFor(25, undefined)).toBe('WARM');
    expect(temperatureFor(60, 10)).toBe('HOT');
  });
});

describe('assessLab', () => {
  /** A release outcome with a two-sided book around `mid`, deadline at the end of the day in New York. */
  const rung = (label: string, deadline: string, mid: number): Outcome => ({
    label,
    yes: mid,
    closed: false,
    vol24: 0,
    deadline,
    deadlineKind: 'by',
    bestBid: mid - 0.005,
    bestAsk: mid + 0.005,
    thin: false,
    liquidity: 1000,
  });
  const market: Market = {
    slug: 's',
    title: 'GPT-6 released by...?',
    url: 'https://polymarket.com/event/gpt-6',
    vol24: 0,
    volume: 0,
    kind: 'release',
    labId: 'openai',
    outcomes: [
      rung('September 24', '2026-09-25T03:59:59Z', 0.7),
      rung('October 31', '2026-11-01T03:59:59Z', 0.9),
    ],
  };
  const best: Market = {
    ...market,
    kind: 'leaderboard',
    labId: undefined,
    outcomes: [{ label: 'OpenAI', yes: 0.31, closed: false, vol24: 1 }],
  };

  it('combines drops, the family curve and the best-model market for one lab', () => {
    const drops = [
      drop('2026-09-18T00:00:00Z'),
      drop('2026-08-01T00:00:00Z'),
      drop('2026-09-18T00:00:00Z', 'google'),
    ];
    const s = assessLab(openai, { drops, markets: [market], bestModelMarket: best }, NOW);
    expect(s.latest?.createdAt).toBe('2026-09-18T00:00:00Z');
    expect(s.daysSince).toBe(1);
    expect(s.drops30d).toBe(1);
    expect(s.odds).toMatchObject({ family: 'GPT-6', marketUrl: market.url, thinExcluded: 0 });
    // 72h: constant hazard from now to the Sep 24 rung, 2.6 days past the horizon, so trusted.
    expect(s.odds?.p72).toMatchObject({ trusted: true, interpolated: true, to: { label: 'September 24' } });
    expect(s.odds?.p72.from).toBeUndefined();
    // 7d and 30d sit between the two rungs.
    expect(s.odds?.p7).toMatchObject({
      trusted: true,
      interpolated: true,
      from: { label: 'September 24', quoted: 0.7 },
    });
    expect(s.odds?.p7.p).toBeGreaterThan(0.7);
    expect(s.odds?.p30.p).toBeLessThan(0.9);
    expect(s.leaderboardOdds).toBe(0.31);
    expect(s.status).toBe('SHIPPING');
    expect(s.heat).toBe(s.heatParts.market + s.heatParts.recency);
    expect(s.histogram).toHaveLength(12);
    expect(s.histogram.at(-1)).toBe(1);
    expect(s.xHandles).toEqual(openai.xHandles);
    expect(s.launchedFamilies).toEqual([]);
  });

  it('marks a read off a lone far rung as extrapolated and keeps it out of heat', () => {
    const far: Market = {
      ...market,
      title: 'Next Gemini Flash released by...?',
      labId: 'google',
      outcomes: [rung('November 30', '2026-12-01T04:59:59Z', 0.6)],
    };
    const s = assessLab(labById('google')!, { drops: [], markets: [far] }, NOW);
    expect(s.odds?.p7).toMatchObject({ trusted: false, interpolated: true });
    expect(s.odds?.p7.p).toBeGreaterThan(0);
    expect(trustedP(s.odds?.p7)).toBe(0);
    expect(s.heatParts.market).toBe(Math.round(trustedP(s.odds?.p30) * 15));
  });

  it('reads only frontier text families: image and video markets are left out', () => {
    const image: Market = { ...market, title: 'GPT Image 2 released by...?' };
    expect(assessLab(openai, { drops: [], markets: [image] }, NOW).odds).toBeUndefined();
  });

  it('leaves out a family whose model just listed, and says which', () => {
    const listed = drop('2026-09-18T00:00:00Z');
    const launched = { ...listed, id: 'openai/gpt-6-sol', name: 'OpenAI: GPT-6 Sol' };
    const events = releaseEvents([launched], NOW);
    const s = assessLab(openai, { drops: [launched], markets: [market], events }, NOW);
    expect(s.odds).toBeUndefined();
    expect(s.launchedFamilies).toEqual(['GPT-6']);
    expect(s.releases30d).toBe(1);
  });

  it('is QUIET with no drops and no markets', () => {
    const s = assessLab(openai, { drops: [], markets: [] }, NOW);
    expect(s.latest).toBeUndefined();
    expect(s.daysSince).toBeUndefined();
    expect(s.heat).toBe(0);
    expect(s.status).toBe('QUIET');
    expect(s.leaderboardOdds).toBeUndefined();
    expect(s.odds).toBeUndefined();
  });

  it('ignores future listings when choosing the latest release and calculating heat', () => {
    const future = drop('2026-09-20T00:00:00Z');
    const past = drop('2026-08-01T00:00:00Z');
    const s = assessLab(openai, { drops: [future, past], markets: [] }, NOW);
    expect(s.latest).toBe(past);
    expect(s.drops30d).toBe(0);
    expect(s.histogram.at(-1)).toBe(0);
    expect(s.heat).toBe(0);
    expect(s.status).toBe('QUIET');
    const onlyFuture = assessLab(openai, { drops: [future], markets: [] }, NOW);
    expect(onlyFuture.latest).toBeUndefined();
    expect(onlyFuture.daysSince).toBeUndefined();
    expect(onlyFuture.status).toBe('QUIET');
  });
});
