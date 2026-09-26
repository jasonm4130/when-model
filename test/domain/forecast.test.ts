import { describe, expect, it } from 'vitest';
import {
  anyReleaseProbability,
  FORECAST_CONSTANTS,
  isTextReleaseFamily,
  levelFromProbability,
  PROBABILITY_LEVELS,
  type ForecastConstants,
  type HorizonConstants,
} from '../../src/domain/forecast';

const test0: HorizonConstants['test'] = {
  hours: 0,
  rate: 0,
  brier: 0,
  skill: 0,
  skillCi95: [0, 0],
  sane: false,
};

function constants(horizons: Partial<HorizonConstants>[]): ForecastConstants {
  return {
    ...FORECAST_CONSTANTS,
    horizons: horizons.map((h) => ({
      horizonHours: 72,
      unpriced: 0.2,
      calibration: { a: 0, b: 1 },
      baseRate: 0.4,
      test: test0,
      ...h,
    })),
  };
}

describe('anyReleaseProbability', () => {
  const flat = constants([{ horizonHours: 72, unpriced: 0.2 }]);

  it('is the unpriced rate alone when no lab is priced', () => {
    const f = anyReleaseProbability([], 72, flat);
    expect(f.p).toBeCloseTo(0.2, 12);
    expect(f.unpriced).toBeCloseTo(0.2, 12);
    expect(f.components).toEqual({ market: 0, combined: f.p, fittedHorizonHours: 72, labs: [] });
  });

  it('combines labs and the unpriced term by noisy-OR', () => {
    const f = anyReleaseProbability(
      [
        { labId: 'openai', p: 0.5 },
        { labId: 'anthropic', p: 0.5 },
      ],
      72,
      flat,
    );
    expect(f.components.market).toBeCloseTo(0.75, 12);
    // 1 − 0.8 · 0.25
    expect(f.p).toBeCloseTo(0.8, 12);
    expect(f.components.combined).toBe(f.p);
  });

  it('never goes below the strongest single lab or the unpriced term', () => {
    const labs = [
      { labId: 'xai' as const, p: 0.62 },
      { labId: 'qwen' as const, p: 0.1 },
    ];
    const f = anyReleaseProbability(labs, 72, flat);
    expect(f.p).toBeGreaterThanOrEqual(0.62);
    expect(f.p).toBeGreaterThanOrEqual(f.unpriced);
    expect(f.p).toBeLessThanOrEqual(1);
  });

  it('sorts lab components highest first and breaks ties by id', () => {
    const f = anyReleaseProbability(
      [
        { labId: 'qwen', p: 0.1 },
        { labId: 'meta', p: 0.3 },
        { labId: 'google', p: 0.3 },
      ],
      72,
      flat,
    );
    expect(f.components.labs.map((l) => l.labId)).toEqual(['google', 'meta', 'qwen']);
  });

  it('clamps out-of-range and non-finite reads instead of trusting them', () => {
    const f = anyReleaseProbability(
      [
        { labId: 'openai', p: 1.7 },
        { labId: 'google', p: -0.4 },
        { labId: 'meta', p: Number.NaN },
      ],
      72,
      flat,
    );
    expect(f.components.labs).toEqual([
      { labId: 'openai', p: 1 },
      { labId: 'google', p: 0 },
      { labId: 'meta', p: 0 },
    ]);
    expect(f.p).toBe(1);
  });

  it('uses the nearest fitted horizon on a log scale and rescales u at constant hazard', () => {
    const three = constants([
      { horizonHours: 24, unpriced: 0.1 },
      { horizonHours: 72, unpriced: 0.3 },
      { horizonHours: 168, unpriced: 0.5 },
    ]);
    expect(anyReleaseProbability([], 24, three).unpriced).toBeCloseTo(0.1, 12);
    expect(anyReleaseProbability([], 168, three).unpriced).toBeCloseTo(0.5, 12);
    // 48h is closer to 72h than to 24h in log terms (ln 1.5 < ln 2).
    const at48 = anyReleaseProbability([], 48, three);
    expect(at48.components.fittedHorizonHours).toBe(72);
    expect(at48.unpriced).toBeCloseTo(1 - 0.7 ** (48 / 72), 12);
    // 12h and 400h fall outside the fitted range and borrow the end points.
    expect(anyReleaseProbability([], 12, three).components.fittedHorizonHours).toBe(24);
    expect(anyReleaseProbability([], 400, three).unpriced).toBeCloseTo(1 - 0.5 ** (400 / 168), 12);
  });

  it('applies a logistic recalibration when one is fitted', () => {
    const cal = constants([{ horizonHours: 72, unpriced: 0.2, calibration: { a: -0.5, b: 0.5 } }]);
    const f = anyReleaseProbability([{ labId: 'openai', p: 0.5 }], 72, cal);
    const combined = 1 - 0.8 * 0.5;
    expect(f.components.combined).toBeCloseTo(combined, 12);
    expect(f.p).toBeCloseTo(1 / (1 + Math.exp(-(-0.5 + 0.5 * Math.log(combined / (1 - combined))))), 12);
    // A certain read is clipped before the logit, so the result stays finite and below 1.
    const certain = anyReleaseProbability([{ labId: 'openai', p: 1 }], 72, cal);
    expect(Number.isFinite(certain.p)).toBe(true);
    expect(certain.p).toBeLessThan(1);
  });

  it('forecasts nothing for a non-positive horizon or missing constants', () => {
    const empty = { labId: 'openai' as const, p: 0.9 };
    for (const h of [0, -5, Number.NaN]) {
      const f = anyReleaseProbability([empty], h, flat);
      expect(f.p).toBe(0);
      expect(f.unpriced).toBe(0);
      expect(f.components.labs).toEqual([empty]);
    }
    expect(anyReleaseProbability([empty], 72, constants([])).p).toBe(0);
  });

  it('defaults to the shipped constants', () => {
    const f = anyReleaseProbability([], 72);
    expect(f.unpriced).toBe(FORECAST_CONSTANTS.horizons.find((h) => h.horizonHours === 72)!.unpriced);
    expect(f.p).toBeCloseTo(f.unpriced, 12);
  });
});

describe('FORECAST_CONSTANTS', () => {
  it('records the study verdict, its windows and the effective sample size', () => {
    expect(FORECAST_CONSTANTS.recommendation).toBe('lead-score');
    expect(Date.parse(FORECAST_CONSTANTS.fittedOn.to)).toBe(Date.parse(FORECAST_CONSTANTS.testedOn.from));
    expect(FORECAST_CONSTANTS.fittedOn.events).toBeGreaterThan(0);
    expect(FORECAST_CONSTANTS.testedOn.events).toBeGreaterThan(0);
  });

  it('holds one fit per horizon, ascending, with probabilities in range', () => {
    const hours = FORECAST_CONSTANTS.horizons.map((h) => h.horizonHours);
    expect(hours).toEqual([24, 72, 168]);
    for (const h of FORECAST_CONSTANTS.horizons) {
      for (const v of [h.unpriced, h.baseRate, h.test.rate]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(h.test.skillCi95[0]).toBeLessThanOrEqual(h.test.skill);
      expect(h.test.skillCi95[1]).toBeGreaterThanOrEqual(h.test.skill);
    }
    // Unpriced releases pile up with the horizon.
    const u = FORECAST_CONSTANTS.horizons.map((h) => h.unpriced);
    expect(u).toEqual([...u].sort((a, b) => a - b));
  });

  it('matches its stated formula: noisy-OR ships with the identity calibration', () => {
    if (FORECAST_CONSTANTS.formula === 'noisy-or')
      for (const h of FORECAST_CONSTANTS.horizons) expect(h.calibration).toEqual({ a: 0, b: 1 });
  });
});

describe('levelFromProbability', () => {
  it('maps each band edge to its own level and just below it to the next', () => {
    for (const band of PROBABILITY_LEVELS) {
      expect(levelFromProbability(band.min)).toBe(band.level);
      if (band.min > 0) expect(levelFromProbability(band.min - 1e-9)).toBe(band.level + 1);
    }
  });

  it('covers [0, 1] with five contiguous bands, highest first', () => {
    expect(PROBABILITY_LEVELS.map((l) => l.level)).toEqual([1, 2, 3, 4, 5]);
    const mins = PROBABILITY_LEVELS.map((l) => l.min);
    expect(mins).toEqual([...mins].sort((a, b) => b - a));
    expect(mins.at(-1)).toBe(0);
    expect(levelFromProbability(1)).toBe(1);
    expect(levelFromProbability(0)).toBe(5);
  });

  it('treats junk as zero and clamps values above one', () => {
    expect(levelFromProbability(Number.NaN)).toBe(5);
    expect(levelFromProbability(-1)).toBe(5);
    expect(levelFromProbability(7)).toBe(1);
  });

  it('accepts another band table, falling back to its last level', () => {
    const two = [
      { level: 1 as const, min: 0.5, label: 'hi' },
      { level: 3 as const, min: 0.2, label: 'lo' },
    ];
    expect(levelFromProbability(0.6, two)).toBe(1);
    expect(levelFromProbability(0.3, two)).toBe(3);
    expect(levelFromProbability(0.1, two)).toBe(3);
  });

  it('labels every band', () => {
    expect(PROBABILITY_LEVELS.map((l) => l.label)).toEqual(['≥95%', '70–95%', '45–70%', '30–45%', '<30%']);
  });
});

describe('isTextReleaseFamily', () => {
  it('keeps language-model families', () => {
    for (const title of [
      'Next Claude Opus released by...?',
      'Next OpenAI GPT Sol (5.7+) released by...?',
      'Grok 4.6 released on...?',
      'Next Alibaba Qwen Flash (3.8+) released by...?',
    ])
      expect(isTextReleaseFamily(title), title).toBe(true);
  });

  it('drops image, video, audio and voice generators', () => {
    for (const title of [
      'Nano Banana 3 released by...?',
      'Veo 4 released by...?',
      'Sora 3 released by...?',
      'Next Google image model released by...?',
      'GPT Audio 2 released by...?',
      'Lyria 4 released by...?',
    ])
      expect(isTextReleaseFamily(title), title).toBe(false);
  });
});

describe('forecastSummary', () => {
  it('summarises the 72h read with the fit behind it, and drops market reads when odds are offline', async () => {
    const { forecastSummary, FORECAST_CONSTANTS: C } = await import('../../src/domain/forecast');
    const live = forecastSummary([{ labId: 'openai', p: 0.5 }], true);
    expect(live).toMatchObject({ horizonHours: 72, oddsAvailable: true, recommendation: 'lead-score' });
    expect(live.market).toBeCloseTo(0.5, 10);
    expect(live.p).toBeGreaterThan(live.market);
    expect(live.labs.map((l) => l.labId)).toEqual(['openai']);
    expect(live.baseRate).toBeCloseTo(0.3904, 4);
    expect(live.skill).toBeCloseTo(-0.002, 3);
    expect(live.trainWindow).toEqual({ from: C.fittedOn.from, to: C.fittedOn.to });
    const offline = forecastSummary([{ labId: 'openai', p: 0.5 }], false);
    expect(offline.labs).toEqual([]);
    expect(offline.p).toBeCloseTo(offline.unpriced, 10);
    const bare = forecastSummary([], true, 72, { ...C, horizons: [] });
    expect([bare.baseRate, bare.skill, bare.skillCi95]).toEqual([0, 0, [0, 0]]);
  });
});
