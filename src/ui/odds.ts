/** Presentation of DROPCON states and lab odds reads. Pure; safe to unit test. */
import { monthName } from '../domain/dates';
import { shortRung, type Dropcon } from '../domain/dropcon';
import { FORECAST_CONSTANTS, type ForecastConstants, type ForecastSummary } from '../domain/forecast';
import { stripDay } from '../domain/history';
import type { LabOddsRead, LabStatus } from '../domain/lab-status';
import { oddsRange, type Outcome } from '../domain/market';
import { daysLabel, pct } from './format';

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

/**
 * The name under the number. A floor is not a level reading, so it never wears level 5's name
 * ("QUIET ORBIT" under a muted 5 would read as calm when the odds are simply missing).
 */
export function dropconName(c: DropconFace): string {
  return c.state === 'floor' ? 'FLOOR (ODDS OFFLINE)' : c.name;
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

/** Where a read comes from on the family's curve, in a few words, naming its family when it is not the card's. */
export function readNote(read: LabOddsRead | undefined): string {
  if (!read) return 'no market';
  const { family, ...rest } = read;
  if (family) return `${family}: ${readNote(rest)}`;
  const to = read.to && shortRung(read.to.label);
  const from = read.from && shortRung(read.from.label);
  if (!read.trusted) return `extrapolated to ${to ?? 'a far rung'} · not scored`;
  if (read.upperBound) return 'at most · day-bucket asks';
  if (read.source === 'buckets') return 'day-bucket floor';
  if (read.lowerBound) return `at least · held at ${from ?? 'the last rung'}`;
  if (read.interpolated) return from ? `${from} → ${to}` : `now → ${to}`;
  return `quoted ${to ?? from}`;
}

/**
 * An outcome's price as the markets panel shows it. A thin book (spread over 10¢ or one-sided) is
 * never a single number: it shows its bid–ask range in cents, e.g. "27–84¢", and is muted. A range
 * whose ends round to the same cent (no bid, an ask under half a cent) reads "<1¢", never "0–0¢".
 */
export function outcomeOdds(outcome: Outcome): { text: string; thin: boolean } {
  const range = oddsRange(outcome);
  if (!range) return { text: pct(outcome.yes), thin: false };
  const [lo, hi] = range.map((p) => Math.round(p * 100));
  if (hi <= lo) return { text: hi <= 0 ? '<1¢' : `${hi}¢`, thin: true };
  return { text: `${lo}–${hi}¢`, thin: true };
}

/** A read's horizon label and whether it is scored, e.g. "trusted" or "extrapolated". */
export function readTrust(read: LabOddsRead | undefined): 'trusted' | 'extrapolated' | undefined {
  if (!read) return undefined;
  return read.trusted ? 'trusted' : 'extrapolated';
}

/**
 * Where on the curve a read sits, without the trust verdict: "Sep 30 → Oct 15", "quoted Sep 30",
 * "from Dec 31" (extrapolated from a rung over 14 days out). `readTrust` carries the verdict beside it.
 */
export function readBracket(read: LabOddsRead): string {
  const to = read.to && shortRung(read.to.label);
  const from = read.from && shortRung(read.from.label);
  if (!read.trusted) return `from ${to ?? 'a far rung'}`;
  if (read.upperBound) return 'at most: bucket asks';
  if (read.source === 'buckets') return 'at least: bucket bids';
  if (read.lowerBound) return `at least, held ${from ?? 'last rung'}`;
  if (read.interpolated) return from ? `${from} → ${to}` : `now → ${to}`;
  return `quoted ${to ?? from}`;
}

/**
 * What a lab card says in place of its reads. With Polymarket unreachable, a lab has no odds because
 * the odds are offline, not because no market exists: "no market" there contradicted the markets
 * panel and the DROPCON pill on the same page.
 */
export function noOddsText(oddsAvailable: boolean): string {
  return oddsAvailable ? 'NO POLYMARKET RELEASE MARKET' : 'ODDS OFFLINE · POLYMARKET UNREACHABLE';
}

/**
 * A lab's headline read for one-line summaries: its family's 7-day odds, or its last listing.
 * `oddsAvailable` false (Polymarket down) says "odds offline" rather than "no market".
 */
export function topReadText(lab: LabStatus, oddsAvailable = true): string {
  if (lab.odds) {
    const trust = lab.odds.p7.trusted ? '' : ', extrapolated';
    return `${lab.odds.family} ${readValue(lab.odds.p7)} within 7 days${trust}`;
  }
  const none = oddsAvailable ? 'no market' : 'odds offline';
  if (lab.latest)
    return `${none}; last listed ${lab.latest.name.replace(/^[^:]+:\s*/, '')} ${lab.daysSince ? `${daysLabel(lab.daysSince)} ago` : 'today'}`;
  return `${none} and nothing listed`;
}

const span = (w: { from: string; to: string }) => `${stripDay(w.from)}–${stripDay(w.to)} ${w.to.slice(0, 4)}`;

/**
 * The base rate in plain words, both windows: the rate is not stationary, so the fitted window
 * alone would make a normal recent week look busy. Numbers come from the replay's constants.
 */
export function baseRateText(f: ForecastSummary): string {
  return `Base rate: some frontier lab listed a new text model in ${pct(f.baseRate)} of ${f.horizonHours}-hour windows (${span(f.trainWindow)}), and in ${pct(f.testRate)} more recently (${span(f.testWindow)}, the held-out test).`;
}

/** The level's own horizon: DROPCON's main term reads 7-day odds. */
export const LEVEL_HORIZON_HOURS = 168;

/**
 * The base rate at the level's horizon, beside the level: how often some frontier lab listed a text
 * model within 7 days, fitted and held out. Set next to "88% within 7 days", the 72-hour rate made a
 * typical week look unusual, when the held-out 7-day rate was higher still.
 */
export function levelBaseRateText(constants: ForecastConstants = FORECAST_CONSTANTS): string {
  const h = constants.horizons.find((x) => x.horizonHours === LEVEL_HORIZON_HOURS);
  if (!h) return '';
  return `Base rate at the level's horizon: some frontier lab listed a new text model within 7 days in ${pct(h.baseRate)} of hours (${span(constants.fittedOn)}) and in ${pct(h.test.rate)} of held-out hours (${span(constants.testedOn)}). DROPCON reads only the named families markets price, so a high level is not unusual by itself.`;
}

/** Brier skill as the page prints it, e.g. "−0.002". */
export function skillText(skill: number): string {
  return `${skill < 0 ? '−' : '+'}${Math.abs(skill).toFixed(3)}`;
}

/** Why the level is not a probability, from the replay's result, with the base rate it was scored against. */
export function forecastAnswer(f: ForecastSummary): string {
  return `A fitted ${f.horizonHours}-hour probability was tested and did not beat the ${f.horizonHours}-hour base rate on held-out data (Brier skill ${skillText(f.skill)}), so the level stays a hand-weighted lead score, not a probability. ${baseRateText(f)}`;
}

/**
 * The release-tempo histogram as text, month by month and oldest first, for its accessible name:
 * "Models listed on OpenRouter per month: Oct 2025 3, Nov 2025 0, …, Sep 2026 2."
 */
export function histogramLabel(histogram: readonly number[], now: Date): string {
  const months = histogram.map((count, i) => {
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (histogram.length - 1 - i), 1));
    return `${monthName(t)} ${t.getUTCFullYear()} ${count}`;
  });
  return `Models listed on OpenRouter per month: ${months.join(', ')}.`;
}
