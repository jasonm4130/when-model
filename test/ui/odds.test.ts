import { describe, expect, it } from 'vitest';
import type { LabOddsRead } from '../../src/domain/lab-status';
import {
  dropconNumber,
  dropconPill,
  dropconTitle,
  outcomeOdds,
  readNote,
  readValue,
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

describe('outcomeOdds', () => {
  it('shows a thin book as its bid-ask range, never one number', () => {
    const o = { label: 'September 28', yes: 0.555, closed: false, vol24: 1, bestBid: 0.27, bestAsk: 0.84 };
    // Live 2026-09-26: Sonnet's Sep 28 rung, 27¢ bid / 84¢ ask, had been shown as "56%" LIVE ODDS.
    expect(outcomeOdds({ ...o, thin: true })).toEqual({ text: '27–84¢', thin: true });
    expect(outcomeOdds({ ...o, thin: true, bestBid: undefined })).toEqual({ text: '0–84¢', thin: true });
    expect(outcomeOdds({ ...o, thin: false })).toEqual({ text: '56%', thin: false });
  });
});
