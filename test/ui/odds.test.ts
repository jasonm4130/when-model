import { describe, expect, it } from 'vitest';
import { FORECAST_CONSTANTS, forecastSummary } from '../../src/domain/forecast';
import type { LabOddsRead, LabStatus } from '../../src/domain/lab-status';
import {
  baseRateText,
  dropconName,
  dropconNumber,
  dropconPill,
  dropconTitle,
  forecastAnswer,
  histogramLabel,
  outcomeOdds,
  readBracket,
  readNote,
  readTrust,
  readValue,
  skillText,
  topReadText,
} from '../../src/ui/odds';

const rung = (label: string) => ({ label, deadline: '2026-09-30T03:59:59Z', p: 0.5, quoted: 0.5, url: 'u' });
const read = (over: Partial<LabOddsRead>): LabOddsRead => ({
  p: 0.42,
  trusted: true,
  interpolated: false,
  lowerBound: false,
  upperBound: false,
  source: 'curve',
  url: 'u',
  ...over,
});

describe('DROPCON face', () => {
  it('titles, numbers and pills each state', () => {
    const ok = { level: 3 as const, name: 'GPU FANS SPINNING', state: 'ok' as const };
    expect(dropconTitle(ok)).toBe('DROPCON 3 · GPU FANS SPINNING — whenmodel');
    expect(dropconNumber(ok)).toBe('3');
    expect(dropconPill(ok)).toEqual({ text: 'LIVE', tone: 'live' });
    const floor = { ...ok, level: 5 as const, state: 'floor' as const };
    expect(dropconTitle(floor)).toBe('DROPCON 5 · FLOOR (odds offline) — whenmodel');
    expect(dropconPill(floor)).toEqual({ text: 'FLOOR · ODDS OFFLINE', tone: 'err' });
    const dark = { ...ok, state: 'no-signal' as const };
    expect(dropconTitle(dark)).toBe('DROPCON — NO SIGNAL — whenmodel');
    expect(dropconNumber(dark)).toBe('?');
    expect(dropconPill(dark)).toEqual({ text: 'NO SIGNAL', tone: 'err' });
  });

  it("never names a floor after level 5's calm", () => {
    const floor = { level: 5 as const, name: 'QUIET ORBIT', state: 'floor' as const };
    expect(dropconName(floor)).toBe('FLOOR (ODDS OFFLINE)');
    expect(dropconName({ ...floor, state: 'ok' })).toBe('QUIET ORBIT');
    expect(dropconName({ ...floor, name: 'NO SIGNAL', state: 'no-signal' })).toBe('NO SIGNAL');
  });
});

describe('base rate and the forecast disclosure', () => {
  const f = forecastSummary([], true);
  const h72 = FORECAST_CONSTANTS.horizons.find((h) => h.horizonHours === 72)!;

  it('states both windows in plain words, every number from the replay constants', () => {
    const pct = (p: number) => `${Math.round(p * 100)}%`;
    expect(baseRateText(f)).toBe(
      `Base rate: some frontier lab listed a new text model in ${pct(h72.baseRate)} of 72-hour windows (1 Apr–16 Jul 2026), and in ${pct(h72.test.rate)} more recently (16 Jul–26 Sep 2026, the held-out test).`,
    );
    expect(baseRateText(f)).toContain('39% of 72-hour windows');
    expect(baseRateText(f)).toContain('63% more recently');
  });

  it('answers "is this a forecast?" with the held-out skill', () => {
    expect(skillText(h72.test.skill)).toBe('−0.002');
    expect(skillText(0.05)).toBe('+0.050');
    expect(forecastAnswer(f)).toBe(
      'A calibrated 72-hour probability was tested and did not beat that base rate on held-out data (Brier skill −0.002), so the level stays a hand-weighted lead score, not a probability.',
    );
  });
});

describe('odds reads', () => {
  it('marks an extrapolated read with a tilde', () => {
    expect(readValue(undefined)).toBe('—');
    expect(readValue(read({}))).toBe('42%');
    expect(readValue(read({ trusted: false }))).toBe('~42%');
  });

  it('says where each read comes from', () => {
    expect(readNote(undefined)).toBe('no market');
    expect(readNote(read({ trusted: false, interpolated: true, to: rung('November 30') }))).toBe(
      'extrapolated to Nov 30 · not scored',
    );
    expect(readNote(read({ trusted: false }))).toBe('extrapolated to a far rung · not scored');
    expect(readNote(read({ source: 'buckets', lowerBound: true }))).toBe('day-bucket floor');
    expect(readNote(read({ source: 'buckets', upperBound: true }))).toBe('at most · day-bucket asks');
    expect(readNote(read({ lowerBound: true, from: rung('September 24') }))).toBe(
      'at least · held at Sep 24',
    );
    expect(readNote(read({ lowerBound: true }))).toBe('at least · held at the last rung');
    expect(readNote(read({ interpolated: true, from: rung('September 24'), to: rung('October 31') }))).toBe(
      'Sep 24 → Oct 31',
    );
    expect(readNote(read({ interpolated: true, to: rung('October 31') }))).toBe('now → Oct 31');
    expect(readNote(read({ to: rung('September 30') }))).toBe('quoted Sep 30');
  });
});

describe('lab card reads', () => {
  it('labels each read trusted or extrapolated, with its bracket on the curve', () => {
    expect(readTrust(undefined)).toBeUndefined();
    expect(readTrust(read({}))).toBe('trusted');
    expect(readTrust(read({ trusted: false }))).toBe('extrapolated');
    expect(readBracket(read({ trusted: false, to: rung('December 31') }))).toBe('from Dec 31');
    expect(readBracket(read({ trusted: false }))).toBe('from a far rung');
    expect(readBracket(read({ source: 'buckets', upperBound: true }))).toBe('at most: bucket asks');
    expect(readBracket(read({ source: 'buckets', lowerBound: true }))).toBe('at least: bucket bids');
    expect(readBracket(read({ lowerBound: true, from: rung('September 24') }))).toBe('at least, held Sep 24');
    expect(readBracket(read({ lowerBound: true }))).toBe('at least, held last rung');
    expect(
      readBracket(read({ interpolated: true, from: rung('September 30'), to: rung('October 15') })),
    ).toBe('Sep 30 → Oct 15');
    expect(readBracket(read({ interpolated: true, to: rung('September 30') }))).toBe('now → Sep 30');
    expect(readBracket(read({ to: rung('September 30') }))).toBe('quoted Sep 30');
  });

  it("sums up a lab by its family's 7-day read, else its last listing", () => {
    const lab = { daysSince: 3, latest: { name: 'Anthropic: Claude Opus 5.5' } } as unknown as LabStatus;
    const odds = { family: 'Next Claude Sonnet', p7: read({ p: 0.87 }) };
    expect(topReadText({ ...lab, odds } as LabStatus)).toBe('Next Claude Sonnet 87% within 7 days');
    expect(
      topReadText({ ...lab, odds: { ...odds, p7: read({ p: 0.12, trusted: false }) } } as LabStatus),
    ).toBe('Next Claude Sonnet ~12% within 7 days, extrapolated');
    expect(topReadText(lab)).toBe('no market; last listed Claude Opus 5.5 3d ago');
    expect(topReadText({ ...lab, daysSince: 0 })).toBe('no market; last listed Claude Opus 5.5 today');
    expect(topReadText({} as LabStatus)).toBe('no market and nothing listed');
  });

  it('spells the tempo histogram out month by month for its accessible name', () => {
    const label = histogramLabel([3, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2], new Date('2026-09-26T00:00:00Z'));
    expect(label).toBe(
      'Models listed on OpenRouter per month: Oct 2025 3, Nov 2025 0, Dec 2025 1, Jan 2026 0, Feb 2026 0, Mar 2026 0, Apr 2026 0, May 2026 0, Jun 2026 0, Jul 2026 0, Aug 2026 0, Sep 2026 2.',
    );
  });
});

describe('outcomeOdds', () => {
  it('shows a thin book as its bid-ask range, never one number', () => {
    const o = { label: 'September 28', yes: 0.555, closed: false, vol24: 1, bestBid: 0.27, bestAsk: 0.84 };
    // Live 2026-09-26: Sonnet's Sep 28 rung, 27¢ bid / 84¢ ask, had been shown as "56%" LIVE ODDS.
    expect(outcomeOdds({ ...o, thin: true })).toEqual({ text: '27–84¢', thin: true });
    expect(outcomeOdds({ ...o, thin: true, bestBid: undefined })).toEqual({ text: '0–84¢', thin: true });
    expect(outcomeOdds({ ...o, thin: false })).toEqual({ text: '56%', thin: false });
  });

  it('reads a book with no bid and a sub-cent ask as "<1¢", never "0–0¢"', () => {
    const o = { label: 'September 25', yes: 0.0015, closed: false, vol24: 1, thin: true };
    expect(outcomeOdds({ ...o, bestAsk: 0.003 })).toEqual({ text: '<1¢', thin: true });
    expect(outcomeOdds({ ...o, bestBid: 0.001, bestAsk: 0.004 })).toEqual({ text: '<1¢', thin: true });
    // One cent either side of the rounding still shows the range.
    expect(outcomeOdds({ ...o, bestAsk: 0.006 })).toEqual({ text: '0–1¢', thin: true });
  });
});
