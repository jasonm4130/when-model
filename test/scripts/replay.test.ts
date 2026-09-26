import { beforeAll, describe, expect, it } from 'vitest';
import type { RawPulls } from '../../scripts/backtest/build';
import type { OpenRouterModel } from '../../scripts/backtest/events';
import { readJson, readRaw } from '../../scripts/backtest/io';
import { DAY, eventKind, HOUR, parseRung, round } from '../../scripts/backtest/markets';
import {
  ADMIT_DAYS,
  admittedPrice,
  bandEdges,
  bandLevels,
  brier,
  buildGrid,
  buildReplay,
  fitFormulas,
  fitLogistic,
  fitUnpriced,
  forecast,
  frontierReleases,
  HEADLINE_H,
  LEAD_H,
  labEventRates,
  levelTable,
  marketsAt,
  MAX_BAND_EDGE,
  monthlyReleases,
  mulberry32,
  noisyOr,
  PRICED_MIN,
  pricedEvents,
  READ_MIN,
  releasedWithin,
  replayDrops,
  sanity,
  settlementLags,
  sigmoid,
  skillInterval,
  splitRows,
  type Replay,
  type ReplayRung,
  type Row,
} from '../../scripts/backtest/replay';
import {
  anyReleaseProbability,
  FORECAST_CONSTANTS,
  LEAD_INPUT_SKILL_7D,
  PROBABILITY_LEVELS,
} from '../../src/domain/forecast';

const T0 = Date.parse('2026-09-01T00:00:00Z') / 1000;

describe('outcome: frontier text release events', () => {
  const model = (id: string, at: string, canonical = id): OpenRouterModel => ({
    id,
    name: id,
    created: Date.parse(at) / 1000,
    canonical,
  });

  it('groups, dedupes and filters listings the way the Worker does', () => {
    const models = [
      model('openai/gpt-x', '2026-09-01T10:00:00Z', 'openai/gpt-x-0901'),
      model('openai/gpt-x:batch', '2026-09-01T10:00:00Z', 'openai/gpt-x-0901'),
      model('openai/gpt-x-pro', '2026-09-01T11:00:00Z'),
      model('openai/gpt-y', '2026-09-01T13:30:00Z'),
      model('~openai/gpt-latest', '2026-09-01T12:00:00Z'),
      model('openai/gpt-5-image', '2026-09-03T00:00:00Z'),
      model('qwen/q', '2026-09-02T00:00:00Z', 'qwen/q-1'),
      model('qwen/q:free', '2026-09-01T23:00:00Z', 'qwen/q-1'),
      model('mistralai/m', '2026-09-02T00:00:00Z'),
      model('google/future', '2026-10-01T00:00:00Z'),
    ];
    expect(replayDrops(models).find((d) => d.id === 'openai/gpt-5-image')?.textOutput).toBe(false);
    const events = frontierReleases(models, Date.parse('2026-09-30T00:00:00Z') / 1000);
    expect(events).toEqual([
      {
        t: Date.parse('2026-09-01T10:00:00Z') / 1000,
        labId: 'openai',
        models: ['openai/gpt-x', 'openai/gpt-x-pro'],
      },
      { t: Date.parse('2026-09-01T13:30:00Z') / 1000, labId: 'openai', models: ['openai/gpt-y'] },
      // The :free twin is the earlier listing; the event keeps the paid id and the earlier time.
      { t: Date.parse('2026-09-01T23:00:00Z') / 1000, labId: 'qwen', models: ['qwen/q'] },
    ]);
  });

  it('counts a release in (t, t + h] only', () => {
    const times = [100, 200, 300];
    expect(releasedWithin(times, 99, 1)).toBe(1);
    expect(releasedWithin(times, 100, 99)).toBe(0);
    expect(releasedWithin(times, 100, 100)).toBe(1);
    expect(releasedWithin(times, 300, 1000)).toBe(0);
    expect(releasedWithin([], 0, 1000)).toBe(0);
  });
});

describe('market reconstruction', () => {
  const deadline = T0 + 20 * DAY;
  const rung = (over: Partial<ReplayRung> = {}): ReplayRung => ({
    eventId: 'e1',
    title: 'Next Claude Opus released by...?',
    slug: 'next-claude-opus',
    labId: 'anthropic',
    bucket: false,
    label: 'September 21',
    pullDeadline: deadline,
    opened: T0,
    until: deadline,
    points: [
      [T0 + 2 * HOUR, 0.2],
      [T0 + 10 * DAY, 0.4],
    ],
    outcome: { deadline: new Date(deadline * 1000).toISOString(), deadlineKind: 'by' },
    ...over,
  });

  it('admits a rung only inside the window every pull covers, and only before it settles', () => {
    const pulledAt = deadline + DAY;
    const r = rung();
    const inWindow = deadline - ADMIT_DAYS * DAY;
    expect(admittedPrice(r, inWindow - 1, pulledAt)).toBeUndefined();
    expect(admittedPrice(r, inWindow, pulledAt)).toBe(0.2);
    expect(admittedPrice(r, T0 + 10 * DAY, pulledAt)).toBe(0.4);
    expect(admittedPrice(r, deadline, pulledAt)).toBeUndefined();
    expect(admittedPrice(rung({ opened: inWindow }), inWindow + 30 * 60, pulledAt)).toBeUndefined();
    // Due after the pull: only rungs that already resolved YES would be in the raw set.
    expect(admittedPrice(r, inWindow, deadline - 1)).toBeUndefined();
    expect(admittedPrice(rung({ points: [[deadline, 0.9]] }), inWindow, pulledAt)).toBeUndefined();
  });

  it('maps admitted rungs to Worker markets: tight books, bucket prices standing in for bids', () => {
    const t = deadline - 5 * DAY;
    const day = deadline + 2 * DAY;
    const markets = marketsAt(
      [
        rung(),
        rung({
          eventId: 'e2',
          slug: 'claude-opus-on',
          title: 'Next Claude Opus released on...?',
          label: 'September 23',
          bucket: true,
          pullDeadline: day,
          until: day,
          outcome: {
            deadline: new Date(day * 1000).toISOString(),
            deadlineKind: 'day',
            windowStart: new Date((day - DAY) * 1000).toISOString(),
          },
        }),
        rung({ eventId: 'e3', slug: 'skipped', until: t }),
      ],
      t,
      deadline + 30 * DAY,
    );
    expect(markets.map((m) => m.slug)).toEqual(['claude-opus-on', 'next-claude-opus']);
    const [bucket, ladder] = markets;
    expect(bucket.outcomes[0]).toMatchObject({ yes: 0.4, bestBid: 0.4, thin: false, deadlineKind: 'day' });
    expect(ladder.outcomes[0]).toMatchObject({ yes: 0.4, thin: false, deadlineKind: 'by', closed: false });
    expect(ladder.outcomes[0].bestBid).toBeUndefined();
    expect(ladder).toMatchObject({ kind: 'release', labId: 'anthropic' });
  });
});

describe('formulas and fitting', () => {
  it('combines labs by noisy-OR, clamping junk', () => {
    expect(noisyOr([])).toBe(0);
    expect(noisyOr([0.5, 0.5])).toBeCloseTo(0.75, 12);
    expect(noisyOr([2, -1])).toBe(1);
  });

  it('recovers a known unpriced rate by maximum likelihood', () => {
    // u = 0.25: 25/100 releases with no market, 125/200 with a 0.5 market (1 − 0.75·0.5 = 0.625).
    const market = [...Array<number>(100).fill(0), ...Array<number>(200).fill(0.5)];
    const y = [
      ...Array.from({ length: 100 }, (_, i) => (i < 25 ? 1 : 0)),
      ...Array.from({ length: 200 }, (_, i) => (i < 125 ? 1 : 0)),
    ];
    expect(fitUnpriced(market, y)).toBeCloseTo(0.25, 5);
    expect(fitUnpriced([0, 0], [0, 0])).toBeLessThan(1e-6);
  });

  it('recovers a known logistic recalibration', () => {
    const x: number[] = [];
    const y: number[] = [];
    for (const xi of [-2, -1, 0, 1, 2]) {
      const hits = Math.round(10_000 * sigmoid(-0.5 + 0.8 * xi));
      for (let i = 0; i < 10_000; i++) {
        x.push(xi);
        y.push(i < hits ? 1 : 0);
      }
    }
    const { a, b } = fitLogistic(x, y);
    expect(a).toBeCloseTo(-0.5, 3);
    expect(b).toBeCloseTo(0.8, 3);
  });

  it('stays at the identity when the data cannot move it', () => {
    expect(fitLogistic([], [])).toEqual({ a: 0, b: 1 });
  });

  it('fits on train rows and rounds what it ships', () => {
    const labP = [[0], [0], [0.5], [0.5]];
    const fit = fitFormulas(labP, [0, 1, 1, 1]);
    expect(fit.base).toBe(0.75);
    for (const v of Object.values(fit)) expect(Math.round(v * 1e4) / 1e4).toBe(v);
  });

  it('scores each candidate formula from lab reads', () => {
    const fit = { base: 0.4, unpriced: 0.2, a: 0.1, b: 0.5 };
    const labs = [0.3, 0.6];
    expect(forecast('base', labs, fit)).toBe(0.4);
    expect(forecast('max', labs, fit)).toBe(0.6);
    expect(forecast('max', [], fit)).toBe(0);
    expect(forecast('max-base', [0.1], fit)).toBe(0.4);
    const d = 1 - 0.8 * (1 - noisyOr(labs));
    expect(forecast('noisy-or', labs, fit)).toBeCloseTo(d, 12);
    expect(forecast('noisy-or-cal', labs, fit)).toBeCloseTo(sigmoid(0.1 + 0.5 * Math.log(d / (1 - d))), 12);
  });

  it('matches the domain function for the shipped formula', () => {
    const labs = [0.3, 0, 0.9, 0, 0.05, 0, 0];
    const h = FORECAST_CONSTANTS.horizons.find((x) => x.horizonHours === HEADLINE_H)!;
    const ids = ['openai', 'anthropic', 'google', 'xai', 'deepseek', 'qwen', 'meta'] as const;
    const domain = anyReleaseProbability(
      labs.map((p, i) => ({ labId: ids[i], p })),
      HEADLINE_H,
    ).p;
    const fit = { base: h.baseRate, unpriced: h.unpriced, a: h.calibration.a, b: h.calibration.b };
    expect(domain).toBeCloseTo(forecast(FORECAST_CONSTANTS.formula, labs, fit), 12);
  });
});

describe('scoring', () => {
  it('computes Brier scores', () => {
    expect(brier([1, 0], [1, 0])).toBe(0);
    expect(brier([0.5, 0.5], [1, 0])).toBe(0.25);
    expect(brier([], [])).toBe(0);
  });

  it('bootstraps deterministically from a seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const draws = Array.from({ length: 5 }, () => a());
    expect(draws).toEqual(Array.from({ length: 5 }, () => b()));
    for (const d of draws) expect(d >= 0 && d < 1).toBe(true);
    const y = [1, 0, 1, 0, 0, 1];
    const options = { resamples: 50, blockH: 2, seed: 1 };
    expect(skillInterval(y, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], y, options)).toEqual([1, 1]);
    const f = [0.8, 0.3, 0.6, 0.2, 0.4, 0.7];
    expect(
      skillInterval(
        f,
        y.map(() => 0.5),
        y,
        options,
      ),
    ).toEqual(
      skillInterval(
        f,
        y.map(() => 0.5),
        y,
        options,
      ),
    );
    expect(skillInterval([], [], [], options)).toEqual([0, 0]);
  });

  it('flags reliability that is off in the large or in a populated bin', () => {
    const bin = (n: number, meanForecast: number, observed: number) => ({
      from: 0,
      to: 1,
      n,
      meanForecast,
      observed,
    });
    const f = Array<number>(200).fill(0.5);
    const half = Array.from({ length: 200 }, (_, i) => (i % 2) as 0 | 1);
    expect(sanity(f, half, [bin(200, 0.5, 0.5)]).sane).toBe(true);
    // A thin bin may be off; a populated one may not.
    expect(sanity(f, half, [bin(200, 0.5, 0.5), bin(20, 0.9, 0.1)]).sane).toBe(true);
    expect(sanity(f, half, [bin(150, 0.9, 0.5)])).toMatchObject({ sane: false, worstBinGap: 0.4 });
    expect(sanity(f, Array<number>(200).fill(1), []).sane).toBe(false);
  });

  it('splits with a purge so no train outcome reaches into the test window', () => {
    const rows: Row[] = Array.from({ length: 10 }, (_, i) => ({ t: i * HOUR, y: 0, labP: [] }));
    const { train, test } = splitRows(rows, 5 * HOUR, 9 * HOUR, 2);
    expect(train.map((r) => r.t / HOUR)).toEqual([0, 1, 2, 3]);
    expect(test.map((r) => r.t / HOUR)).toEqual([5, 6, 7, 8]);
  });
});

describe('levels', () => {
  it('puts band edges at rounded train quantiles, capped and strictly rising', () => {
    const p = Array.from({ length: 100 }, (_, i) => i / 100);
    expect(bandEdges(p)).toEqual([0.3, 0.6, 0.85, 0.95]);
    expect(bandEdges(Array<number>(10).fill(0.99))).toEqual([MAX_BAND_EDGE, 1, 1.05, 1.1]);
    expect(bandEdges(Array<number>(10).fill(0.42))).toEqual([0.4, 0.45, 0.5, 0.55]);
  });

  it('labels the bands from the edges', () => {
    expect(bandLevels([0.3, 0.45, 0.7, 0.95])).toEqual(PROBABILITY_LEVELS);
  });

  it('tabulates hours, forecasts, outcomes and distinct events per level', () => {
    const rows: Row[] = [
      { t: 0, y: 1, labP: [] },
      { t: HOUR, y: 1, labP: [] },
      { t: 2 * HOUR, y: 0, labP: [] },
    ];
    const releases = [{ t: 10 * HOUR, labId: 'openai' as const, models: ['openai/x'] }];
    const table = levelTable(rows, [0.99, 0.5, 0.1], releases, PROBABILITY_LEVELS);
    expect(table.map((r) => [r.level, r.hours, r.observed, r.events])).toEqual([
      [1, 1, 1, 1],
      [2, 0, null, 0],
      [3, 1, 1, 1],
      [4, 0, null, 0],
      [5, 1, 0, 1],
    ]);
  });
});

describe('survivorship and coverage helpers', () => {
  it('counts release events per UTC month', () => {
    const at = (iso: string) => ({ t: Date.parse(iso) / 1000, labId: 'qwen' as const, models: [] });
    expect(
      monthlyReleases([at('2026-08-31T23:00:00Z'), at('2026-09-01T00:00:00Z'), at('2026-09-20T00:00:00Z')]),
    ).toEqual([
      { month: '2026-08', events: 1 },
      { month: '2026-09', events: 2 },
    ]);
  });

  it('rates each lab per 30 days before and inside the window', () => {
    const r = (d: number, labId: 'xai' | 'qwen') => ({ t: T0 + d * DAY, labId, models: [] });
    const rates = labEventRates(
      [r(-10, 'qwen'), r(5, 'qwen'), r(10, 'qwen'), r(20, 'xai')],
      [T0 - 30 * DAY, T0],
      [T0, T0 + 60 * DAY],
    );
    expect(rates.find((x) => x.labId === 'qwen')).toEqual({ labId: 'qwen', before: 1, window: 1 });
    expect(rates.find((x) => x.labId === 'xai')).toEqual({ labId: 'xai', before: 0, window: 0.5 });
    expect(rates).toHaveLength(7);
  });

  it('reads the highest 72h lab read in the 72 hours before each listing', () => {
    const release = {
      t: T0 + 100 * HOUR,
      labId: 'anthropic' as const,
      models: ['anthropic/a', 'b', 'c', 'd'],
    };
    const headline = [
      { t: T0, labP: [0, 0.99, 0, 0, 0, 0, 0] },
      { t: T0 + 50 * HOUR, labP: [0, 0.6, 0, 0, 0, 0, 0] },
      { t: T0 + 100 * HOUR, labP: [0, 1, 0, 0, 0, 0, 0] },
    ];
    expect(pricedEvents([release], headline, T0, T0 + 200 * HOUR)).toEqual([
      {
        at: '2026-09-05T04:00:00Z',
        labId: 'anthropic',
        models: ['anthropic/a', 'b', 'c'],
        maxLabP72: 0.6,
        priced: true,
      },
    ]);
  });
});

describe('committed replay', () => {
  let raw: RawPulls;
  let replay: Replay;

  beforeAll(async () => {
    raw = await readRaw();
    replay = JSON.parse(JSON.stringify(buildReplay(raw))) as Replay;
  }, 120_000);

  it('matches a rebuild from the committed raw pulls', async () => {
    expect(await readJson('data/backtest/v3-replay.json')).toEqual(replay);
  });

  it('is what src/domain/forecast.ts ships', () => {
    expect(replay.constants).toEqual(JSON.parse(JSON.stringify(FORECAST_CONSTANTS)));
    expect(replay.levels.bands).toEqual(PROBABILITY_LEVELS);
    const week = replay.horizons.find((h) => h.horizonH === 168)!;
    const max = week.formulas.find((f) => f.id === 'max')!;
    expect({ skill: max.skill, skillCi95: max.skillCi95 }).toEqual(LEAD_INPUT_SKILL_7D);
    expect(week.sensitivity.every((v) => v.formulas.max.skillCi95[1] < 0)).toBe(true);
  });

  it('measures how long launched markets keep trading before they resolve', () => {
    expect(replay.settlementLag).toEqual(settlementLags(raw));
    expect(replay.settlementLag.events).toBeGreaterThan(20);
    expect(replay.settlementLag.medianH).toBeLessThan(replay.settlementLag.maxH);
    expect(settlementLags({ ...raw, events: [] })).toEqual({ events: 0, medianH: 0, maxH: 0 });
  });

  it('stays small enough to import into a page', async () => {
    // @ts-ignore This app deliberately does not ship Node type declarations; vitest runs in Node.
    const { stat } = await import('node:fs/promises');
    expect((await stat('data/backtest/v3-replay.json')).size).toBeLessThan(300_000);
  });

  it('applies the pre-registered decision rule to the numbers it reports', () => {
    const head = replay.horizons.find((h) => h.horizonH === HEADLINE_H)!;
    const best = head.formulas.filter((f) => f.id !== 'base').sort((a, b) => b.skill - a.skill)[0];
    expect(replay.decision.bestFormula).toBe(best.id);
    const probability = best.skill > replay.meta.protocol.decisionMinSkill && best.sanity.sane;
    expect(replay.decision.recommendation).toBe(probability ? 'probability' : 'lead-score');
    expect(replay.constants.recommendation).toBe(replay.decision.recommendation);
  });

  it('scores every formula on one purged split per horizon, reporting the effective sample', () => {
    for (const h of replay.horizons) {
      expect(h.formulas.map((f) => f.id)).toEqual(['base', 'max', 'max-base', 'noisy-or', 'noisy-or-cal']);
      expect(h.train.to).toBe(replay.meta.split.at);
      expect(h.test.from).toBe(replay.meta.split.at);
      expect(h.test.events).toBe(replay.constants.testedOn.events);
      expect(h.rolling).toHaveLength(replay.meta.protocol.rollingOrigins.length);
      for (const f of h.formulas) expect(f.skillCi95[0]).toBeLessThanOrEqual(f.skillCi95[1]);
    }
  });

  it('downsamples the headline series to at most 3-hourly over the window', () => {
    const { series, meta } = replay;
    expect(series.stepH).toBeGreaterThanOrEqual(3);
    expect(series.from).toBe(meta.window.from);
    const hours = (Date.parse(meta.window.until) - Date.parse(meta.window.from)) / 3_600_000;
    expect(series.p).toHaveLength(Math.floor(hours / series.stepH) + 1);
    expect(series.level).toHaveLength(series.p.length);
    expect(series.market).toHaveLength(series.p.length);
    expect(series.lead7).toHaveLength(series.p.length);
  });

  it("adds the level's main input to the series: formula (b) at 7 days, the shape LEAD_INPUT_SKILL_7D scored", () => {
    const grid = buildGrid(raw);
    const week = grid.rows.curve[LEAD_H];
    const unused = { base: 0, unpriced: 0, a: 0, b: 1 };
    const byT = new Map(week.map((r) => [r.t, forecast('max', r.labP, unused)]));
    const from = Date.parse(replay.series.from) / 1000;
    let compared = 0;
    replay.series.lead7.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      const expected = byT.get(from + i * replay.series.stepH * HOUR);
      if (expected === undefined) return; // the last 7 days have no outcome row, but still a read
      expect(v).toBe(round(expected, 3));
      compared++;
    });
    expect(compared).toBeGreaterThan(replay.series.lead7.length * 0.9);
    // The Grok 4.7 week of false confidence pins P7's shape at 1 too, a week before anything listed.
    const at = (iso: string) => (Date.parse(iso) / 1000 - from) / HOUR / replay.series.stepH;
    expect(replay.series.lead7[at('2026-09-14T00:00:00Z')]).toBeGreaterThan(0.95);
  });

  it('records the thresholds the page quotes, and applies them', () => {
    expect(replay.meta.protocol.pricedMin).toBe(PRICED_MIN);
    expect(replay.meta.protocol.readMin).toBe(READ_MIN);
    for (const e of replay.pricedEvents.events) expect(e.priced).toBe(e.maxLabP72 >= PRICED_MIN);
  });

  it('reproduces the documented episodes: Opus 5.5 priced ahead, the Grok 4.7 week of false confidence', () => {
    const at = (iso: string) =>
      (Date.parse(iso) - Date.parse(replay.series.from)) / 3_600_000 / replay.series.stepH;
    expect(replay.series.p[at('2026-09-22T06:00:00Z')]).toBeGreaterThan(0.95);
    // Grok 4.7's day buckets summed to ~1 from Sep 12 to 16; nothing frontier listed until Sep 21.
    expect(replay.series.p[at('2026-09-14T00:00:00Z')]).toBeGreaterThan(0.95);
    const markers = replay.releases.markers.map((m) => m.at);
    expect(markers.some((m) => m > '2026-09-10T07:00:00Z' && m < '2026-09-21T00:00:00Z')).toBe(false);
  });

  it('rests on an admission rule the CLOB pull honours for every rung, whatever it resolved', () => {
    // Leak check: every pulled series starts by max(opened, deadline − 14d), so presence of a price
    // at an admitted hour never depends on the outcome.
    let checked = 0;
    for (const event of raw.events) {
      const kind = eventKind(event.title);
      for (const m of event.markets) {
        const rung = kind ? parseRung(m.label, kind, m.endDate) : undefined;
        const series = m.yesToken ? raw.series[m.yesToken] : undefined;
        if (!rung || !series) continue;
        checked++;
        const admitFrom = Math.max(Date.parse(m.openedAt) / 1000, rung.deadline - ADMIT_DAYS * DAY);
        expect(series.startTs, `${event.id} ${m.label}`).toBeLessThanOrEqual(admitFrom + 60);
      }
    }
    expect(checked).toBeGreaterThan(300);
  });
});
