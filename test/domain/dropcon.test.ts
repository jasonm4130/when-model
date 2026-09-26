import { describe, expect, it } from 'vitest';
import {
  DROPCON_ALGORITHM_VERSION,
  LEVEL_BANDS,
  WEIGHTS,
  baseRateLine,
  computeDropcon,
  familyPhrase,
  headlineProbability,
  levelForScore,
  shortRung,
  type DropconInput,
  type MarketDriver,
} from '../../src/domain/dropcon';
import { forecastSummary } from '../../src/domain/forecast';

const quiet: DropconInput = {
  p7: 0,
  p30: 0,
  p7DayAgo: null,
  oddsAvailable: true,
  listingsAvailable: true,
};

const sonnet: MarketDriver = {
  labId: 'anthropic',
  lab: 'Anthropic',
  family: 'Next Claude Sonnet',
  p: 0.85,
  read: 'interpolated',
  from: 'September 29',
  to: 'September 30',
  quote: { label: 'September 29', p: 0.85 },
  url: 'https://polymarket.com/event/claude-sonnet',
};

const gpt6: MarketDriver = {
  labId: 'openai',
  lab: 'OpenAI',
  family: 'GPT-6',
  p: 0.6,
  read: 'rung',
  to: 'October 31',
  quote: { label: 'October 31', p: 0.6 },
  url: 'https://polymarket.com/event/gpt-6',
};

describe('levelForScore', () => {
  it('reads the bands top down and keeps level 1 reachable', () => {
    expect(LEVEL_BANDS).toEqual([75, 55, 35, 15]);
    expect(levelForScore(100)).toBe(1);
    expect(levelForScore(75)).toBe(1);
    expect(levelForScore(74)).toBe(2);
    expect(levelForScore(55)).toBe(2);
    expect(levelForScore(35)).toBe(3);
    expect(levelForScore(15)).toBe(4);
    expect(levelForScore(14)).toBe(5);
    // 80 × P7 alone crosses into level 1 at P7 ≈ 0.94: the §3 ceiling of 74.9 is gone.
    expect(computeDropcon({ ...quiet, p7: 0.94, p30: 0.94, top7: { ...sonnet, p: 0.94 } }).level).toBe(1);
  });
});

describe('computeDropcon', () => {
  it('is QUIET ORBIT with nothing priced, and says so in the headline', () => {
    const d = computeDropcon(quiet);
    expect(d).toMatchObject({ level: 5, score: 0, state: 'ok', degraded: false, name: 'QUIET ORBIT' });
    expect(d.headline).toBe('No Polymarket market prices a named frontier text release in the next 30 days');
  });

  it('builds the headline from the real top driver, quoting the market rung', () => {
    const d = computeDropcon({ ...quiet, p7: 0.85, p30: 0.9, top7: sonnet, top30: sonnet });
    expect(d.headline).toBe('Polymarket prices 85% that the next Claude Sonnet ships by Sep 29');
    expect(d.headline).not.toMatch(/odds of a frontier drop/i);
    expect(d.level).toBe(2);
  });

  it('states the scored read beside the quoted rung when they round apart, and names a bucket ceiling', () => {
    const between = { ...sonnet, p: 0.31, quote: { label: 'September 30', p: 0.14 } };
    expect(computeDropcon({ ...quiet, p7: 0.31, p30: 0.31, top7: between }).headline).toBe(
      'Polymarket prices 14% that the next Claude Sonnet ships by Sep 30 (31% within 7 days on its curve)',
    );
    const capped: MarketDriver = { ...sonnet, p: 0.184, read: 'ceiling', quote: undefined };
    const d = computeDropcon({ ...quiet, p7: 0.184, p30: 0.184, top7: capped });
    expect(d.headline).toBe("Polymarket's day buckets cap the next Claude Sonnet at 18% within 7 days");
    expect(d.provenance[0].label).toBe(
      'Next Claude Sonnet (Anthropic) · 18% within 7 days, at most, capped by day-bucket asks',
    );
  });

  it('describes a curve read without a quoted rung, and a day-bucket floor', () => {
    const curve = computeDropcon({
      ...quiet,
      p7: 0.5,
      p30: 0.5,
      top7: { ...sonnet, p: 0.5, quote: undefined },
    });
    expect(curve.headline).toBe(
      "Polymarket's curve puts 50% on the next Claude Sonnet shipping within 7 days",
    );
    const floor = computeDropcon({ ...quiet, p7: 0.4, p30: 0.4, top7: { ...gpt6, p: 0.4, read: 'floor' } });
    expect(floor.headline).toBe("Polymarket's day buckets put at least 40% on GPT-6 shipping within 7 days");
    expect(floor.provenance[0].label).toContain('day-bucket best bids');
  });

  it('leads with the 30-day increment when it outscores the 7-day term', () => {
    const d = computeDropcon({
      ...quiet,
      p7: 0.05,
      p30: 0.9,
      top7: { ...gpt6, p: 0.05 },
      top30: { ...gpt6, p: 0.9, quote: { label: 'October 31', p: 0.9 } },
    });
    expect(d.provenance.map((r) => r.points)).toEqual([4, 9, 0]);
    expect(d.headline).toBe('Polymarket prices 90% that GPT-6 ships by Oct 31, but only 5% within 7 days');
  });

  it('names both families when the 30-day and 7-day reads come from different ones', () => {
    const haiku: MarketDriver = { ...sonnet, family: 'Next Claude Haiku', p: 0.92, quote: undefined };
    const muse: MarketDriver = {
      ...gpt6,
      labId: 'meta',
      lab: 'Meta',
      family: 'Next Muse Spark (1.4+)',
      p: 0.31,
    };
    const d = computeDropcon({ ...quiet, p7: 0.31, p30: 0.92, top7: muse, top30: haiku });
    expect(d.provenance[1].label).toBe(
      'Next Claude Haiku (Anthropic) · 92% within 30 days, 61% above the best 7-day read (Next Muse Spark (1.4+), Meta)',
    );
    const same = computeDropcon({ ...quiet, p7: 0.85, p30: 0.9, top7: sonnet, top30: { ...sonnet, p: 0.9 } });
    expect(same.provenance[1].label).toBe(
      'Next Claude Sonnet (Anthropic) · 90% within 30 days, 5% beyond the 7-day term',
    );
  });

  it('adds up: the provenance rows sum to the score, each rounded on its own', () => {
    const d = computeDropcon({ ...quiet, p7: 0.666, p30: 0.9, p7DayAgo: 0.5, top7: sonnet, top30: sonnet });
    const rows = d.provenance.map((r) => r.points);
    expect(rows).toEqual([53, 2, 6]);
    expect(d.score).toBe(rows.reduce((a, b) => a + b, 0));
    expect(d.provenance.every((r) => r.tag === 'LEAD')).toBe(true);
    expect(d.provenance[0]).toMatchObject({ term: 'market-7d', detail: '80 × 0.67', url: sonnet.url });
    expect(d.provenance[2]).toMatchObject({ term: 'repricing', url: '/api/history.json' });
  });

  it('scores repricing from the day-old P7, saturating at +30 points and ignoring falls', () => {
    const up = computeDropcon({ ...quiet, p7: 0.6, p30: 0.6, p7DayAgo: 0.2, top7: sonnet });
    expect(up.provenance[2].points).toBe(WEIGHTS.repricing);
    expect(up.provenance[2].label).toBe('Best 7-day odds moved +40 pts in 24 hours (full marks at +30)');
    const down = computeDropcon({ ...quiet, p7: 0.2, p30: 0.2, p7DayAgo: 0.6, top7: sonnet });
    expect(down.provenance[2].points).toBe(0);
    expect(down.provenance[2].label).toContain('−40 pts');
    const none = computeDropcon({ ...quiet, p7: 0.2, p30: 0.2, top7: sonnet });
    expect(none.provenance[2].label).toBe('Repricing: no reading from 24 hours ago yet');
  });

  it('mentions a real repricing in the headline, never as its lead: 10 × ΔP7/0.3 cannot beat 80 × P7', () => {
    const d = computeDropcon({ ...quiet, p7: 0.85, p30: 0.9, p7DayAgo: 0.6, top7: sonnet, top30: sonnet });
    expect(d.provenance.map((r) => r.points)).toEqual([68, 1, 8]);
    expect(d.headline).toBe(
      'Polymarket prices 85% that the next Claude Sonnet ships by Sep 29, up 25 pts in 24 hours',
    );
    const small = computeDropcon({
      ...quiet,
      p7: 0.85,
      p30: 0.9,
      p7DayAgo: 0.82,
      top7: sonnet,
      top30: sonnet,
    });
    expect(small.headline).toBe('Polymarket prices 85% that the next Claude Sonnet ships by Sep 29');
    const rise = (dayAgo: number) =>
      computeDropcon({ ...quiet, p7: 0.5, p30: 0.6, p7DayAgo: dayAgo, top7: { ...sonnet, p: 0.5 } }).headline;
    expect(rise(0.44)).toContain(', up 6 pts in 24 hours');
    expect(rise(0.46)).not.toContain('in 24 hours');
  });

  it('describes P7 in the blurb and says what lifted the level above it', () => {
    const at = (p7: number) => ({ ...gpt6, p: p7, quote: { label: 'October 2', p: p7 } });
    // P7 0.79 after a 30-point rise reaches level 1, but 79% is not "near-certain".
    const surge = computeDropcon({
      ...quiet,
      p7: 0.79,
      p30: 0.95,
      p7DayAgo: 0.49,
      top7: at(0.79),
      top30: at(0.95),
    });
    expect([surge.score, surge.level]).toEqual([75, 1]);
    expect(surge.blurb).toBe(
      'Markets price a named frontier release as likely within 7 days. The level is lifted by the 30-day odds and a 24-hour rise in the 7-day odds. Not a launch countdown.',
    );
    // P7 0.36 reaches level 3 on the 30-day term alone; 36% is a minority chance, not even odds.
    const even = computeDropcon({ ...quiet, p7: 0.36, p30: 0.95, top7: at(0.36), top30: at(0.95) });
    expect([even.score, even.level]).toEqual([35, 3]);
    expect(even.blurb).toBe(
      'A market gives a named frontier release a real but minority chance within 7 days. The level is lifted by the 30-day odds.',
    );
    // When P7 alone sets the level, the blurb is just its band.
    const likely = computeDropcon({ ...quiet, p7: 0.94, p30: 0.94, top7: at(0.94) });
    expect(likely.blurb).toBe(
      'Markets price a named frontier release as near-certain within 7 days. Not a launch countdown.',
    );
  });

  it('is a floor with the odds offline: every term reads 0 and the copy says so', () => {
    const d = computeDropcon({
      ...quiet,
      p7: 0.9,
      p30: 0.9,
      p7DayAgo: 0.1,
      oddsAvailable: false,
      top7: sonnet,
    });
    expect(d).toMatchObject({ level: 5, score: 0, state: 'floor', degraded: true });
    expect(d.headline).toMatch(/^Prediction-market odds are offline/);
    expect(d.blurb).toMatch(/floor, not a measurement/);
  });

  it('has no signal when Polymarket and OpenRouter are both down', () => {
    const d = computeDropcon({ ...quiet, oddsAvailable: false, listingsAvailable: false });
    expect(d).toMatchObject({ state: 'no-signal', degraded: true, name: 'NO SIGNAL', score: 0 });
    expect(d.headline).toBe('Polymarket and OpenRouter are both unreachable: no signal');
  });

  it('carries the base-rate line when given the forecast, and the version in its notes', () => {
    const f = forecastSummary([{ labId: 'anthropic', p: 0.5 }], true);
    const d = computeDropcon({ ...quiet, p7: 0.5, p30: 0.5, top7: sonnet }, f);
    expect(d.baseRate).toBe(baseRateLine(f));
    expect(d.baseRate).toMatch(
      /^Context, not the level: \d+% that some frontier lab lists a text model within 72h/,
    );
    expect(d.baseRate).toContain('Brier skill −0.002');
    expect(d.notes[0]).toContain(`v${DROPCON_ALGORITHM_VERSION}`);
    expect(d.notes[0]).not.toContain('/backtest shows');
    expect(d.notes[0]).toContain('never fitted, and the level itself has not been tested');
    expect(d.notes[0]).toContain('Brier skill of −1.48 (95% interval −3.36 to −0.28)');
    expect(computeDropcon(quiet).baseRate).toBe('');
  });
});

describe('baseRateLine', () => {
  it('drops the market read when the odds are offline', () => {
    const line = baseRateLine(forecastSummary([], false));
    expect(line).toMatch(
      /^Base rate: a frontier lab listed a text model within 72h in 39% of hours \(1 Apr–16 Jul 2026\) and in 63% of held-out hours \(16 Jul–26 Sep 2026\)\./,
    );
    expect(line).toMatch(/Odds are offline, so there is no market read\.$/);
  });
});

describe('headlineProbability', () => {
  it('is P7 while the odds are live and null (never a placeholder 0) when they are down', () => {
    expect(headlineProbability({ p7: 0.42, oddsAvailable: true })).toBe(0.42);
    expect(headlineProbability({ p7: 0, oddsAvailable: false })).toBeNull();
  });
});

describe('copy helpers', () => {
  it('phrases families and shortens month rungs', () => {
    expect(familyPhrase('Next Claude Sonnet')).toBe('the next Claude Sonnet');
    expect(familyPhrase('GPT-6')).toBe('GPT-6');
    expect(shortRung('September 29')).toBe('Sep 29');
    expect(shortRung('Q4 2026')).toBe('Q4 2026');
  });
});
