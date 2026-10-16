import { describe, expect, it } from 'vitest';
import {
  launchLine,
  launchesNear,
  NEAR_MAX,
  nearLine,
  nowReadout,
  pointAt,
  readout,
  readoutText,
  timeText,
  type ScrubData,
} from '../../src/ui/readout';

const HOUR = 3_600_000;
const TO = Date.parse('2026-09-26T12:00:00Z');
const FROM = TO - 168 * HOUR;
const h = (iso: string) => Date.parse(iso);

const data = (overrides: Partial<ScrubData> = {}): ScrubData => ({
  from: FROM,
  to: TO,
  version: 3,
  history: 'ok',
  launchesOk: true,
  recordFrom: h('2026-09-23T01:00:00Z'),
  near: 3 * HOUR,
  pts: [
    ['o', h('2026-09-26T08:00:00Z'), h('2026-09-26T09:00:00Z'), 88, 0, 0, 2],
    // The hour the version changed holds both; the current one answers.
    ['o', h('2026-09-26T09:00:00Z'), h('2026-09-26T10:00:00Z'), 77, 0, 0, 2],
    ['c', h('2026-09-26T09:00:00Z'), h('2026-09-26T10:00:00Z'), 53, 3, 0, 3],
    ['x', h('2026-09-26T10:00:00Z'), h('2026-09-26T11:00:00Z'), 0, 3, 0, 3],
    ['c', h('2026-09-26T11:00:00Z'), h('2026-09-26T12:00:00Z'), 52, 2, 1, 3],
  ],
  launches: [
    [h('2026-09-22T16:32:00Z'), 'Claude Opus 5.5', 'Anthropic', '✱', '#ff7a1a'],
    [h('2026-09-22T18:12:00Z'), 'GPT-6 Sol', 'OpenAI', '◉', '#00ff9c'],
  ],
  live: { state: 'ok', at: h('2026-09-26T11:58:00Z'), score: 61, level: 2 },
  ...overrides,
});

describe('the instrument readout', () => {
  it('prints times in UTC with the page month spelling', () => {
    expect(timeText(h('2026-09-06T04:05:00Z'))).toBe('6 SEP 04:05Z');
  });

  it('reads NOW only at NOW, with the live score and the level name', () => {
    const r = nowReadout(data());
    expect(r).toMatchObject({
      now: true,
      when: 'NOW · 26 SEP 11:58Z',
      what: 'score 61 → level 2',
      tone: 'ok',
    });
    expect(r.name).toBe('MARKETS SMELL A DROP');
    expect(readout(data(), TO)).toEqual(r);
    expect(readoutText(r)).toBe('NOW, 26 SEP 11:58Z: score 61, level 2, MARKETS SMELL A DROP');
  });

  it('never gives an hour back from NOW the live reading: it is that hour, or no reading', () => {
    // One step left of NOW lands in the 11:00 hour: the recorded 52, held, not the live 61.
    const back = readout(data(), TO - HOUR + 1);
    expect(back).toMatchObject({ now: false, when: '26 SEP 11:00Z', score: 52, level: 2, held: true });
    expect(back.what).toBe('score 52 → level 2 (held)');
    expect(readoutText(back)).toBe(
      '26 SEP 11:00Z: score 52, level 2, MARKETS SMELL A DROP, held by hysteresis',
    );
    // With the history offline, the same step reports no score at all.
    const offline = readout(data({ history: 'unavailable', pts: [] }), TO - HOUR);
    expect(offline).toMatchObject({ now: false, tone: 'none', what: 'history offline · log unreadable' });
    expect(offline.score).toBeUndefined();
    expect(readoutText(offline)).not.toMatch(/score|level/);
    expect(readout(data({ history: 'empty', pts: [] }), TO - HOUR).what).toBe('no readings recorded yet');
    // A record that stopped more than 7 days ago is not "none yet": it says when the last one was.
    expect(
      readout(data({ history: 'empty', pts: [], last: h('2026-09-18T09:10:00Z') }), TO - HOUR).what,
    ).toBe('no reading · last one 18 SEP 09:10Z');
  });

  it("names an older version's hour without its number, and an outage as held", () => {
    const old = readout(data(), h('2026-09-26T08:30:00Z'));
    expect(old).toMatchObject({ tone: 'old', what: 'v2 · old scale, not comparable' });
    expect(old.score).toBeUndefined();
    expect(readoutText(old)).not.toContain('88');
    // The hour both versions share reads the current one.
    expect(pointAt(data(), h('2026-09-26T09:30:00Z'))?.[6]).toBe(3);
    expect(readout(data(), h('2026-09-26T10:30:00Z'))).toMatchObject({
      tone: 'outage',
      what: 'odds offline · level 3 held',
      level: 3,
    });
  });

  it('tells a gap in the record from the time before it started', () => {
    expect(readout(data(), h('2026-09-21T00:00:00Z')).what).toBe('no record · log starts 23 Sep');
    expect(readout(data(), h('2026-09-24T00:00:00Z')).what).toBe('no reading this hour');
  });

  it('names launches near the cursor, nearest first, and says when there are none', () => {
    const d = data();
    const r = readout(d, h('2026-09-22T18:00:00Z'));
    expect(launchesNear(d, h('2026-09-22T18:00:00Z')).map((l) => l[1])).toEqual([
      'GPT-6 Sol',
      'Claude Opus 5.5',
    ]);
    expect(nearLine(d, r)).toBe(
      'near: ◉ GPT-6 Sol (OpenAI) 22 SEP 18:12Z · ✱ Claude Opus 5.5 (Anthropic) 22 SEP 16:32Z',
    );
    expect(readoutText(r)).toContain('Launches near: GPT-6 Sol (OpenAI), Claude Opus 5.5 (Anthropic)');
    expect(nearLine(d, readout(d, h('2026-09-24T00:00:00Z')))).toBe('no frontier launch within 3h');
    expect(nearLine(data({ launchesOk: false }), r)).toBe('launch listings offline');
  });

  it(`names at most ${NEAR_MAX} launches, and counts one exactly 3 hours away as near`, () => {
    const t = h('2026-09-24T12:00:00Z');
    const launch = (min: number, name: string): ScrubData['launches'][number] => [
      t + min * 60_000,
      name,
      'Lab',
      '▲',
      '#fff',
    ];
    const d = data({
      launches: [
        launch(-180, 'edge'),
        launch(-181, 'past'),
        launch(30, 'a'),
        launch(-60, 'b'),
        launch(90, 'c'),
        launch(120, 'd'),
      ],
    });
    expect(launchesNear(d, t).map((l) => l[1])).toEqual(['a', 'b', 'c']);
    expect(
      launchesNear(data({ launches: [launch(-180, 'edge'), launch(181, 'past')] }), t).map((l) => l[1]),
    ).toEqual(['edge']);
  });

  it("sums up the week's launches at rest, in the singular for one, and says when listings are down", () => {
    expect(launchLine(data())).toBe('2 frontier launches in 7 days · latest ◉ GPT-6 Sol (OpenAI), 22 Sep');
    expect(launchLine(data({ launches: [data().launches[0]] }))).toMatch(/^1 frontier launch in 7 days · /);
    expect(launchLine(data({ launches: [] }))).toBe('No frontier launches listed in these 7 days');
    expect(launchLine(data({ launchesOk: false }))).toBe(
      'Launch listings offline: OpenRouter unreachable, launches not marked',
    );
  });

  it('reads a floor and no signal at NOW without a score', () => {
    const floor = nowReadout(data({ live: { state: 'floor', at: TO, score: 0, level: 5 } }));
    expect(floor).toMatchObject({ tone: 'outage', what: 'floor · odds offline, not measured', level: 5 });
    expect(floor.score).toBeUndefined();
    const dark = nowReadout(data({ live: { state: 'no-signal', at: TO, score: 0, level: 5 } }));
    expect(dark).toMatchObject({ tone: 'none', what: 'no signal · odds and listings down' });
    expect(readoutText(dark)).toBe('NOW, 26 SEP 12:00Z: no signal: odds and listings down');
  });
});
