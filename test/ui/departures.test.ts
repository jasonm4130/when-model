import { describe, expect, it } from 'vitest';
import type { LabOddsRead, LabStatus } from '../../src/domain/lab-status';
import type { Market, Outcome } from '../../src/domain/market';
import {
  boardingWindow,
  datedRungs,
  dayLabel,
  deadlineDay,
  departureBoard,
  departureOrder,
  familyMarkets,
  isDeparture,
  nextDeparture,
  otherServices,
  readSentence,
  stripStops,
  timetableState,
  windowNote,
  windowText,
  type DatedRung,
} from '../../src/ui/departures';

const NOW = Date.parse('2026-10-02T10:00:00Z');
const AT = '2026-10-02T10:00:00.000Z';

const read = (p: number, trusted = true): LabOddsRead => ({
  p,
  trusted,
  interpolated: true,
  lowerBound: false,
  upperBound: false,
  source: 'curve',
  url: 'https://polymarket.com/event/x',
});

function lab(
  id: LabStatus['id'],
  p7?: LabOddsRead,
  extra: { p30?: LabOddsRead; heat?: number; family?: string; marketUrl?: string } = {},
): LabStatus {
  return {
    id,
    name: id,
    heat: extra.heat ?? 0,
    histogram: [],
    odds: p7 && {
      family: extra.family ?? `Next ${id} model`,
      marketUrl: extra.marketUrl ?? `https://polymarket.com/event/${id}`,
      p72: p7,
      p7,
      p30: extra.p30 ?? p7,
      thinExcluded: 0,
    },
  } as unknown as LabStatus;
}

/** A "released by" rung ending 23:59:59 New York time (EDT) on the given October day. */
const by = (day: number, yes: number, over: Partial<Outcome> = {}): Outcome => ({
  label: `October ${day}`,
  yes,
  closed: false,
  vol24: 1,
  deadline: new Date(Date.UTC(2026, 9, day + 1, 3, 59, 59)).toISOString(),
  deadlineKind: 'by',
  thin: false,
  ...over,
});

function market(title: string, outcomes: Outcome[], labId = 'anthropic', slug = title): Market {
  return {
    slug,
    title,
    url: `https://polymarket.com/event/${slug}`,
    vol24: 1,
    volume: 1,
    kind: 'release',
    labId,
    outcomes,
  } as Market;
}

const rung = (day: number, p: number): DatedRung => ({
  deadline: by(day, p).deadline!,
  day: Date.UTC(2026, 9, day),
  p,
  url: 'u',
});

const measurement = (oddsAvailable: boolean) => ({ inputs: { oddsAvailable } }) as never;

describe('deadlineDay and dayLabel', () => {
  it('reads a New York deadline as the day it names, in daylight and standard time', () => {
    expect(deadlineDay('2026-10-08T03:59:59.000Z')).toBe(Date.UTC(2026, 9, 7));
    expect(deadlineDay('2027-01-01T04:59:59.000Z')).toBe(Date.UTC(2026, 11, 31));
  });

  it('prints the weekday and month from the hand-spelled tables, and the year only when it differs', () => {
    expect(dayLabel(Date.UTC(2026, 9, 7), NOW)).toBe('Wed 7 Oct');
    expect(dayLabel(Date.UTC(2026, 8, 30), NOW)).toBe('Wed 30 Sep');
    expect(dayLabel(Date.UTC(2027, 2, 31), NOW)).toBe('Wed 31 Mar 2027');
    expect(dayLabel(Date.UTC(2026, 9, 7), NOW, false)).toBe('7 Oct');
  });
});

describe('datedRungs', () => {
  it('keeps open cumulative rungs in day order, reads "no release by" as its complement, and skips thin, past and bucket outcomes', () => {
    const ladder = market('Next Claude Haiku (4.6+) released by…?', [
      by(15, 0.745),
      by(7, 0.38),
      by(1, 0.2), // its deadline is behind the build
      by(10, 0.5, { thin: true }),
      by(12, 0.6, { closed: true }),
    ]);
    const buckets = market('Next Claude Haiku (4.6+) released on…?', [
      by(9, 0.05, { deadlineKind: 'day' }),
      by(31, 0.095, { label: 'No release by October 31', deadlineKind: 'no-release' }),
      by(7, 0.99), // the same day as the ladder's rung: the busier market's quote stands
    ]);
    const rungs = datedRungs([ladder, buckets], NOW);
    expect(rungs.map((r) => [new Date(r.day).getUTCDate(), r.p])).toEqual([
      [7, 0.38],
      [15, 0.745],
      [31, 1 - 0.095],
    ]);
    expect(rungs[0].url).toBe(ladder.url);
    // With no build time nothing is past.
    expect(datedRungs([ladder], undefined)).toHaveLength(3);
  });
});

describe('boardingWindow', () => {
  it('opens at the last rung below 50% and closes at the first at or above it', () => {
    const w = boardingWindow([rung(5, 0.22), rung(7, 0.38), rung(15, 0.75), rung(31, 0.93)]);
    expect(w).toMatchObject({ kind: 'window', from: { p: 0.38 }, to: { p: 0.75 } });
    expect(windowText(w, NOW)).toBe('Wed 7 – Thu 15 Oct');
    expect(windowText(w, NOW, true)).toBe('7 – 15 Oct');
    expect(windowNote(w, NOW)).toBe('38% by 7 Oct, 75% by 15 Oct on Polymarket');
  });

  it('counts exactly 50% as boarding', () => {
    expect(boardingWindow([rung(7, 0.4), rung(9, 0.5)])).toMatchObject({ kind: 'window', to: { p: 0.5 } });
  });

  it('names both months when the window spans two', () => {
    const w = boardingWindow([rung(0, 0.3), rung(15, 0.6)]);
    expect(windowText(w, NOW)).toBe('Wed 30 Sep – Thu 15 Oct');
    expect(windowText(w, NOW, true)).toBe('30 Sep – 15 Oct');
  });

  it('says "by <date>" when the first rung is already at even odds', () => {
    const w = boardingWindow([rung(9, 0.55), rung(15, 0.8)]);
    expect(w).toMatchObject({ kind: 'by', to: { p: 0.55 } });
    expect(windowText(w, NOW)).toBe('by Fri 9 Oct');
    expect(windowText(w, NOW, true)).toBe('by 9 Oct');
    expect(windowNote(w, NOW)).toBe('55% by 9 Oct on Polymarket, its first stop');
  });

  it('has no window when no rung reaches 50%, and says how far the last one got', () => {
    const w = boardingWindow([rung(9, 0.02), rung(23, 0.1)]);
    expect(w).toMatchObject({ kind: 'none', last: { p: 0.1 } });
    expect(windowText(w, NOW)).toBe('Not yet called');
    expect(windowText(w, NOW, true)).toBe('—');
    expect(windowNote(w, NOW)).toBe('No stop reaches even odds; the last is 10% by 23 Oct');
  });

  it('has no window and no last stop with no rungs at all', () => {
    const w = boardingWindow([]);
    expect(w).toEqual({ kind: 'none' });
    expect(windowNote(w, NOW)).toBe('No dated stop on a real book');
  });
});

describe('familyMarkets', () => {
  it("gathers every release market of the lab's headline family, and no other family or lab", () => {
    const ladder = market('Next Claude Haiku (4.6+) released by…?', [], 'anthropic', 'haiku-by');
    const buckets = market('Next Claude Haiku (4.6+) released on…?', [], 'anthropic', 'haiku-on');
    const opus = market('Next Claude Opus (5.6+) released by…?', [], 'anthropic', 'opus');
    const other = market('Next Claude Haiku (4.6+) released by…?', [], 'openai', 'wrong-lab');
    const l = lab('anthropic', read(0.46), {
      family: 'Next Claude Haiku (4.6+)',
      marketUrl: ladder.url,
    });
    expect(familyMarkets({ markets: [ladder, opus, buckets, other] }, l)).toEqual([ladder, buckets]);
    // The anchor market fell off the capped list: the family's own name finds the rest.
    const lost = lab('anthropic', read(0.46), { family: 'Next Claude Haiku (4.6+)', marketUrl: 'gone' });
    expect(familyMarkets({ markets: [opus, buckets] }, lost)).toEqual([buckets]);
    expect(familyMarkets({ markets: [ladder] }, lab('anthropic'))).toEqual([]);
    expect(familyMarkets({}, l)).toEqual([]);
  });
});

describe('timetableState', () => {
  it('times a trusted read, refuses an extrapolated one, and tells no market from odds offline', () => {
    expect(timetableState(lab('google', read(0.2)), true)).toBe('scheduled');
    expect(timetableState(lab('zai', read(0.36, false)), true)).toBe('times-unavailable');
    expect(timetableState(lab('deepseek'), true)).toBe('no-timetable');
    expect(timetableState(lab('deepseek'), false)).toBe('offline');
  });
});

describe('nextDeparture', () => {
  it('picks the highest trusted 7-day read, never a higher extrapolated one', () => {
    const labs = [
      lab('meta', read(0.9, false), { heat: 90 }),
      lab('google', read(0.2), { heat: 50 }),
      lab('anthropic', read(0.46), { heat: 10, family: 'Next Claude Haiku (4.6+)' }),
    ];
    const ladder = market('Next Claude Haiku (4.6+) released by…?', [by(7, 0.38), by(15, 0.745)]);
    const next = nextDeparture({ labs, markets: [ladder], generatedAt: AT });
    expect(isDeparture(next)).toBe(true);
    if (!isDeparture(next)) return;
    expect(next.lab.id).toBe('anthropic');
    expect(next.family).toBe('Next Claude Haiku (4.6+)');
    expect(next.p7).toBe(0.46);
    expect(next.window).toMatchObject({ kind: 'window', from: { p: 0.38 }, to: { p: 0.745 } });
  });

  it('breaks a tie on the trusted 30-day read, then heat, then the dashboard order, then the id', () => {
    const p = read(0.4);
    const pick = (labs: LabStatus[]) => {
      const n = nextDeparture({ labs });
      return isDeparture(n) ? n.lab.id : n.reason;
    };
    expect(pick([lab('google', p, { p30: read(0.5) }), lab('openai', p, { p30: read(0.7) })])).toBe('openai');
    // An extrapolated 30-day read counts as nothing.
    expect(pick([lab('google', p, { p30: read(0.5) }), lab('openai', p, { p30: read(0.9, false) })])).toBe(
      'google',
    );
    expect(pick([lab('google', p, { heat: 10 }), lab('openai', p, { heat: 30 })])).toBe('openai');
    expect(pick([lab('openai', p), lab('google', p)])).toBe('openai');
    expect(departureOrder([lab('openai', p), lab('google', p)]).map((l) => l.id)).toEqual([
      'openai',
      'google',
    ]);
  });

  it('schedules nothing when every read is extrapolated or zero, and says the odds are offline when they are', () => {
    expect(nextDeparture({ labs: [lab('zai', read(0.36, false)), lab('openai', read(0))] })).toEqual({
      reason: 'untrusted',
    });
    expect(nextDeparture({ labs: [] })).toEqual({ reason: 'untrusted' });
    expect(nextDeparture({ labs: [lab('deepseek')], measurement: measurement(false) })).toEqual({
      reason: 'offline',
    });
  });
});

describe('departureBoard', () => {
  it('lists the next departure once, the other timed lines after it, then the lines it cannot time', () => {
    const labs = [
      lab('zai', read(0.36, false), { heat: 31 }),
      lab('openai', read(0.015), { heat: 28 }),
      lab('google', read(0.197), { heat: 25 }),
      lab('anthropic', read(0.46), { heat: 57 }),
      lab('deepseek', undefined, { heat: 7 }),
      lab('mistral', read(0), { heat: 0 }),
    ];
    const b = departureBoard({ labs });
    expect(isDeparture(b.next) && b.next.lab.id).toBe('anthropic');
    expect(b.later.map((x) => x.lab.id)).toEqual(['google', 'openai', 'mistral']);
    expect(b.unavailable.map((l) => l.id)).toEqual(['zai']);
    expect(b.untimed.map((l) => l.id)).toEqual(['deepseek']);
    expect(b.offline).toBe(false);
  });

  it('with the odds offline, every line is untimed and nothing departs', () => {
    const b = departureBoard({ labs: [lab('anthropic'), lab('google')], measurement: measurement(false) });
    expect(b.next).toEqual({ reason: 'offline' });
    expect(b.later).toEqual([]);
    expect(b.untimed.map((l) => l.id)).toEqual(['anthropic', 'google']);
    expect(b.offline).toBe(true);
  });
});

describe('readSentence', () => {
  const r = (over: Partial<LabOddsRead>): LabOddsRead => ({ ...read(0.4), ...over });
  const from = { label: 'October 7', deadline: by(7, 0.3).deadline! } as LabOddsRead['from'];
  const to = { label: 'October 15', deadline: by(15, 0.7).deadline! } as LabOddsRead['to'];
  it('says how each kind of read was taken, with the days its stops name', () => {
    expect(readSentence(r({ from, to }), NOW)).toBe(
      "Read off the market's curve between its 7 Oct and 15 Oct stops.",
    );
    expect(readSentence(r({ to }), NOW)).toBe("Read off the market's curve from now to its 15 Oct stop.");
    expect(readSentence(r({ lowerBound: true, interpolated: false, from }), NOW)).toBe(
      'At least: held at its 7 Oct stop.',
    );
    expect(readSentence(r({ upperBound: true }), NOW)).toBe("At most: capped by the day buckets' asks.");
    expect(readSentence(r({ source: 'buckets' }), NOW)).toBe("At least: the day buckets' best bids.");
    expect(readSentence(r({ interpolated: false, to }), NOW)).toBe('Quoted at its 15 Oct stop.');
    expect(readSentence(r({ trusted: false, to }), NOW)).toBe(
      'Extrapolated from now to its 15 Oct stop, too far out to trust; not scored.',
    );
  });
});

describe('stripStops', () => {
  it('runs from now through the dated stops, with the trusted horizons in time order', () => {
    const l = lab('anthropic', read(0.46), {});
    l.odds!.p72 = read(0.22);
    l.odds!.p30 = read(0.93);
    const stops = stripStops(l, [rung(7, 0.38), rung(15, 0.75), rung(31, 0.93)], NOW);
    expect(stops.map((s) => [s.kind, s.horizon ?? null, s.p ?? null])).toEqual([
      ['now', null, null],
      ['tick', '72 hours', 0.22],
      ['rung', null, 0.38],
      // The 7-day tick prints no odds of its own: that is the page's big number.
      ['tick', '7 days', null],
      ['rung', null, 0.75],
      // The 30-day read lands on 1 Nov, a day from the 31 Oct stop at the same 93%: one stop, named for both.
      ['rung', '30 days', 0.93],
    ]);
  });

  it('keeps a horizon twin apart when its odds differ, drops untrusted or borrowed reads, and caps the rungs', () => {
    const l = lab('anthropic', read(0.46));
    l.odds!.p72 = read(0.3, false);
    l.odds!.p30 = { ...read(0.9), family: 'Claude 6' };
    const rungs = [5, 6, 7, 8, 9, 10, 11].map((d) => rung(d, d / 20));
    const stops = stripStops(l, rungs, NOW);
    expect(stops.filter((s) => s.kind === 'rung')).toHaveLength(5);
    expect(stops.some((s) => s.horizon === '72 hours' || s.horizon === '30 days')).toBe(false);
    const twin = lab('anthropic', read(0.46));
    twin.odds!.p30 = read(0.95);
    const kept = stripStops(twin, [rung(31, 0.93)], NOW);
    expect(kept.filter((s) => s.horizon === '30 days').map((s) => s.kind)).toEqual(['tick']);
  });
});

describe('otherServices', () => {
  it("lists a line's other families, each at its first stop at even odds, else its furthest", () => {
    const head = market(
      'Next Claude Haiku (4.6+) released by...?',
      [by(7, 0.38), by(15, 0.75)],
      'anthropic',
      'haiku',
    );
    const fable = market(
      'Next Fable Model (5.2+) released by...?',
      [by(20, 0.4), by(31, 0.87)],
      'anthropic',
      'fable',
    );
    const opus = market(
      'Next Claude Opus (5.6+) released by...?',
      [by(20, 0.1), by(30, 0.3)],
      'anthropic',
      'opus',
    );
    const other = market('GPT-7 released by...?', [by(9, 0.6)], 'openai', 'gpt');
    const l = lab('anthropic', read(0.46), { family: 'Next Claude Haiku (4.6+)', marketUrl: head.url });
    const out = otherServices({ markets: [head, fable, opus, other], generatedAt: AT }, l);
    expect(out.map((o) => [o.family, o.stop?.p ?? null])).toEqual([
      ['Next Fable (5.2+)', 0.87],
      ['Next Claude Opus (5.6+)', 0.3],
    ]);
    expect(out[0].url).toBe(fable.url);
  });
});
