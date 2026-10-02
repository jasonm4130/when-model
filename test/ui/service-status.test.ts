import { describe, expect, it } from 'vitest';
import type { DropconLevel } from '../../src/domain/dropcon';
import { LEVEL_NAMES } from '../../src/domain/levels';
import { contrastRatio } from '../../src/ui/contrast';
import {
  LADDER,
  LEVEL_TREATMENT,
  SERVICE_PHRASES,
  STATUS_COLOURS,
  serviceStatus,
  type StatusTreatment,
} from '../../src/ui/service-status';

const reading = (level: DropconLevel, score = 42) =>
  serviceStatus({ level, state: 'ok', score, blurb: `blurb ${level}` });

describe('serviceStatus', () => {
  for (const level of [5, 4, 3, 2, 1] as const) {
    it(`posts level ${level} as ${LEVEL_NAMES[level]} with its own line`, () => {
      const s = reading(level, 60);
      expect(s).toEqual({
        level,
        name: LEVEL_NAMES[level],
        phrase: SERVICE_PHRASES[level],
        detail: `blurb ${level}`,
        treatment: LEVEL_TREATMENT[level],
        score: 60,
      });
    });
  }

  it('escalates: calm at 5 and 4, the notice yellow at 3, inverted at 2, the platform-edge alert at 1', () => {
    expect([5, 4, 3, 2, 1].map((l) => reading(l as DropconLevel).treatment)).toEqual([
      'calm',
      'calm',
      'notice',
      'inverted',
      'alert',
    ]);
  });

  it('gives every level a different line, in the deadpan voice of a station', () => {
    const lines = Object.values(SERVICE_PHRASES);
    expect(new Set(lines).size).toBe(5);
    for (const line of lines) expect(line).toMatch(/^[A-Z].*\.$/);
    expect(SERVICE_PHRASES[5]).toBe('Good service.');
    expect(SERVICE_PHRASES[1]).toBe('Stand clear of the closing doors.');
  });

  it('calls a floor a signal failure, keeps its level for the ladder, and never names level 5', () => {
    const s = serviceStatus({ level: 5, state: 'floor', score: 0, blurb: 'x' });
    expect(s).toMatchObject({
      level: 5,
      name: 'SIGNAL FAILURE',
      phrase: 'Odds offline.',
      treatment: 'offline',
    });
    expect(s.detail).toMatch(/not a measurement/);
    expect(s.name).not.toBe(LEVEL_NAMES[5]);
    expect(s.score).toBeUndefined();
  });

  it('has no level at all with no signal', () => {
    const s = serviceStatus({ level: 5, state: 'no-signal', score: 0, blurb: 'x' });
    expect(s.level).toBeUndefined();
    expect(s).toMatchObject({
      name: 'NO SIGNAL',
      phrase: 'Service information unavailable.',
      treatment: 'offline',
    });
  });

  for (const [treatment, c] of Object.entries(STATUS_COLOURS) as [
    StatusTreatment,
    { ground: string; text: string },
  ][]) {
    it(`sets the ${treatment} strip's text at 7:1 or better on its ground`, () => {
      expect(contrastRatio(c.text, c.ground)).toBeGreaterThanOrEqual(7);
    });
  }

  it('prints the ladder 5 to 1, quiet to surge', () => {
    expect(LADDER).toEqual([5, 4, 3, 2, 1]);
  });
});
