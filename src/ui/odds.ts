/** Presentation of DROPCON states and lab odds reads. Pure; safe to unit test. */
import { shortRung, type Dropcon } from '../domain/dropcon';
import type { LabOddsRead } from '../domain/lab-status';
import { pct } from './format';

type DropconFace = Pick<Dropcon, 'level' | 'name' | 'state'>;

/** The page title: a floor says so, and no signal has no level to show. */
export function dropconTitle(c: DropconFace): string {
  if (c.state === 'no-signal') return 'DROPCON — NO SIGNAL — whenmodel';
  if (c.state === 'floor') return `DROPCON ${c.level} · FLOOR (odds offline) — whenmodel`;
  return `DROPCON ${c.level} · ${c.name} — whenmodel`;
}

/** The big number: "?" when there is no signal at all. */
export function dropconNumber(c: DropconFace): string {
  return c.state === 'no-signal' ? '?' : String(c.level);
}

/** The status pill beside the level. */
export function dropconPill(c: DropconFace): { text: string; tone: 'live' | 'err' } {
  if (c.state === 'no-signal') return { text: 'NO SIGNAL', tone: 'err' };
  if (c.state === 'floor') return { text: 'FLOOR · ODDS OFFLINE', tone: 'err' };
  return { text: 'LIVE', tone: 'live' };
}

/** A read's probability; an extrapolated one is marked "~" because it is shown but never scored. */
export function readValue(read: LabOddsRead | undefined): string {
  if (!read) return '—';
  return read.trusted ? pct(read.p) : `~${pct(read.p)}`;
}

/** Where a read comes from on the family's curve, in a few words. */
export function readNote(read: LabOddsRead | undefined): string {
  if (!read) return 'no market';
  const to = read.to && shortRung(read.to.label);
  const from = read.from && shortRung(read.from.label);
  if (!read.trusted) return `extrapolated to ${to ?? 'a far rung'} · not scored`;
  if (read.upperBound) return 'at most · day-bucket asks';
  if (read.source === 'buckets') return 'day-bucket floor';
  if (read.lowerBound) return `at least · held at ${from ?? 'the last rung'}`;
  if (read.interpolated) return from ? `${from} → ${to}` : `now → ${to}`;
  return `quoted ${to ?? from}`;
}
