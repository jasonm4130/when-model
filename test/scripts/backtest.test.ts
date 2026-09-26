import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  architectureRows,
  broadcastRows,
  buildBacktest,
  crossingSplits,
  marketForecast,
  primaryLead,
  releaseRows,
  reliability,
  snowflakeTime,
  TEASER,
  trapRows,
  type CrossingRow,
  type RawPulls,
  type ReleaseRow,
  type Rung2,
  type SeriesCrossings,
} from '../../scripts/backtest/build';
import { ARCHITECTURE, BROADCASTS, RELEASES, TIMESTAMP_TRAPS } from '../../scripts/backtest/curated';
import {
  availability,
  firstPartyStory,
  frontierListings,
  isFirstParty,
  listedWithin,
  type HnPull,
  type OpenRouterModel,
} from '../../scripts/backtest/events';
import {
  clobWindow,
  fetchGammaEvents,
  fetchHn,
  fetchOpenRouter,
  fetchSeries,
  isReleaseEvent,
} from '../../scripts/backtest/fetch';
import { readJson, readRaw } from '../../scripts/backtest/io';
import {
  compactPoints,
  DAY,
  etOffsetHours,
  etTime,
  eventKind,
  firstCrossing,
  firstHeldCrossing,
  HOUR,
  iso,
  normaliseTime,
  parseRung,
  peak,
  priceAt,
  round,
  seriesPoints,
  trimGammaEvent,
  type Point,
  type RawEvent,
} from '../../scripts/backtest/markets';
import { pct, signedHours, symlog, symlogScale, utcMinute } from '../../scripts/backtest/view';

const t = (value: string) => Date.parse(value) / 1000;

describe('markets: Gamma events and rung labels', () => {
  it('classifies ladders and day buckets by title', () => {
    expect(eventKind('GPT-5.5 released by...?')).toBe('by');
    expect(eventKind('Next Claude Opus released on...?')).toBe('on');
    expect(eventKind('Which company has the best AI model?')).toBeUndefined();
  });

  it('normalises Gamma closedTime and rejects junk', () => {
    expect(normaliseTime('2026-09-17 10:45:25+00')).toBe('2026-09-17T10:45:25Z');
    expect(normaliseTime('2026-09-17T10:45:25.000Z')).toBe('2026-09-17T10:45:25Z');
    expect(normaliseTime('not a date')).toBeUndefined();
    expect(normaliseTime(42)).toBeUndefined();
  });

  it('trims an event to the fields the backtest reads and reads resolutions', () => {
    const event = trimGammaEvent({
      id: 101,
      slug: 'gpt-x-released-by',
      title: 'GPT-X released by...?',
      createdAt: '2026-09-01T00:00:00Z',
      closed: true,
      markets: [
        {
          id: 1,
          groupItemTitle: 'September 24',
          outcomes: '["Yes","No"]',
          outcomePrices: '["1","0"]',
          clobTokenIds: '["tok-yes","tok-no"]',
          acceptingOrdersTimestamp: '2026-09-02T00:00:00Z',
          closedTime: '2026-09-24 20:00:00+00',
          endDate: '2026-09-25T00:00:00Z',
          closed: true,
        },
        {
          id: 2,
          question: 'September 20',
          outcomes: ['Yes', 'No'],
          outcomePrices: ['0', '1'],
          createdAt: '2026-09-02T00:00:00Z',
          closed: true,
        },
        {
          id: 3,
          groupItemTitle: 'Open rung',
          outcomes: 'garbage',
          createdAt: '2026-09-02T00:00:00Z',
          closed: false,
        },
        { id: 4, groupItemTitle: 'No open time' },
      ],
    });
    expect(event).toMatchObject({ id: '101', slug: 'gpt-x-released-by', closed: true });
    expect(event!.markets).toHaveLength(3);
    expect(event!.markets[0]).toEqual({
      id: '1',
      label: 'September 24',
      openedAt: '2026-09-02T00:00:00Z',
      closed: true,
      endDate: '2026-09-25T00:00:00Z',
      closedTime: '2026-09-24T20:00:00Z',
      yesToken: 'tok-yes',
      resolved: 'yes',
    });
    expect(event!.markets[1].resolved).toBe('no');
    expect(event!.markets[2].resolved).toBeUndefined();
    expect(trimGammaEvent({ id: 5 })).toBeUndefined();
  });

  it('switches New York offsets at 02:00 local on the 2026 DST boundaries', () => {
    expect(etOffsetHours(2026, 2, 8, 1)).toBe(-5);
    expect(etOffsetHours(2026, 2, 8, 2)).toBe(-4);
    expect(etOffsetHours(2026, 10, 1, 1)).toBe(-4);
    expect(etOffsetHours(2026, 10, 1, 2)).toBe(-5);
    expect(etOffsetHours(2026, 0, 15, 12)).toBe(-5);
    expect(etTime(2026, 8, 22)).toBe(t('2026-09-22T04:00:00Z'));
  });

  it('reads rung labels into 23:59:59 New York deadlines', () => {
    const end = '2026-09-30T00:00:00Z';
    expect(parseRung('September 24', 'by', end)).toEqual({
      kind: 'by',
      deadline: t('2026-09-25T03:59:59Z'),
      date: '2026-09-24',
    });
    expect(parseRung('September 22', 'on', end)).toEqual({
      kind: 'day',
      from: t('2026-09-22T04:00:00Z'),
      deadline: t('2026-09-23T03:59:59Z'),
      date: '2026-09-22',
    });
    expect(parseRung('On or prior to September 16', 'on', end)?.kind).toBe('by');
    expect(parseRung('August 31 or earlier', 'on', end)?.kind).toBe('by');
    expect(parseRung('July 31, 2026', 'by')?.date).toBe('2026-07-31');
    expect(parseRung('December 5', 'by', '2027-01-05T00:00:00Z')?.date).toBe('2026-12-05');
    expect(parseRung('January 5', 'by', '2026-12-20T00:00:00Z')?.date).toBe('2027-01-05');
    expect(parseRung('November 30', 'by', '2026-12-01T05:00:00Z')?.deadline).toBe(t('2026-12-01T04:59:59Z'));
    expect(parseRung('No release by September 30', 'by', end)).toBeUndefined();
    expect(parseRung('Grok 5', 'by', end)).toBeUndefined();
    expect(parseRung('September 24', 'by')).toBeUndefined();
  });
});

describe('markets: price series', () => {
  const points: Point[] = [
    [100, 0.2],
    [200, 0.2],
    [300, 0.6],
    [400, 0.6],
    [500, 0.4],
    [600, 0.4],
  ];

  it('compacts a step function without losing the last point', () => {
    expect(compactPoints([...points].reverse())).toEqual([100, 0.2, 300, 0.6, 500, 0.4, 600, 0.4]);
  });

  it('drops the first hour after the book opened', () => {
    const opened = '2026-09-01T00:00:00Z';
    const start = t(opened);
    const series = {
      startTs: start,
      endTs: start + DAY,
      fidelity: 60,
      points: [start + 60, 0.5, start + HOUR + 60, 0.3, start + 2 * HOUR, 0.4],
    };
    expect(seriesPoints(series, opened)).toEqual([
      [start + HOUR + 60, 0.3],
      [start + 2 * HOUR, 0.4],
    ]);
    expect(seriesPoints(undefined, opened)).toEqual([]);
  });

  it('reads the last price at or before a time', () => {
    expect(priceAt(points, 50)).toBeUndefined();
    expect(priceAt(points, 300)).toBe(0.6);
    expect(priceAt(points, 450)).toBe(0.6);
    expect(priceAt(points, 9999)).toBe(0.4);
  });

  it('separates a one-hour spike from a held crossing', () => {
    const hourly: Point[] = [
      [0, 0.3],
      [HOUR, 0.55],
      [2 * HOUR, 0.3],
      [3 * HOUR, 0.52],
      [4 * HOUR, 0.6],
      [5 * HOUR, 0.7],
      [6 * HOUR, 0.4],
    ];
    expect(firstCrossing(hourly, 0.5)).toEqual({ t: HOUR, p: 0.55, censored: false });
    expect(firstHeldCrossing(hourly, 0.5)).toEqual({ t: 3 * HOUR, p: 0.52, censored: false });
    expect(firstHeldCrossing(hourly, 0.9)).toBeUndefined();
    expect(firstCrossing(hourly, 0.3, true)?.censored).toBe(true);
    expect(firstCrossing(hourly, 0.9)).toBeUndefined();
    expect(peak(hourly)).toEqual({ t: 5 * HOUR, p: 0.7 });
    expect(peak([])).toBeUndefined();
  });

  it('formats times and rounds', () => {
    expect(iso(t('2026-09-22T16:27:30Z'))).toBe('2026-09-22T16:27:30Z');
    expect(round(1.26)).toBe(1.3);
    expect(round(0.12345, 3)).toBe(0.123);
  });
});

describe('events: announcements and availability', () => {
  it('matches first-party hosts, paths and official X accounts', () => {
    const hosts = ['anthropic.com', 'huggingface.co/deepseek-ai', 'twitter.com/openai/', 'x.com/openai/'];
    expect(isFirstParty('https://www.anthropic.com/news/claude-opus-5-5', hosts)).toBe(true);
    expect(isFirstParty('https://docs.anthropic.com/x', hosts)).toBe(true);
    expect(isFirstParty('https://notanthropic.com/', hosts)).toBe(false);
    expect(isFirstParty('https://huggingface.co/deepseek-ai/DeepSeek-V4', hosts)).toBe(true);
    expect(isFirstParty('https://huggingface.co/someone/DeepSeek-V4', hosts)).toBe(false);
    expect(isFirstParty('https://twitter.com/OpenAI/status/1', hosts)).toBe(true);
    expect(isFirstParty('https://twitter.com/OpenAIFan/status/1', hosts)).toBe(false);
    expect(isFirstParty('not a url', hosts)).toBe(false);
    expect(isFirstParty('', hosts)).toBe(false);
  });

  it('takes the earliest first-party story whose title names the model', () => {
    const pull: HnPull = {
      query: 'Opus',
      from: '',
      to: '',
      hits: [
        { id: '1', t: 1, title: 'Claude Opus 5.5 spotted', url: 'https://reddit.com/r/x', points: 3 },
        { id: '2', t: 2, title: 'Anthropic careers', url: 'https://anthropic.com/careers', points: 3 },
        {
          id: '3',
          t: 3,
          title: 'Claude Opus 5.5',
          url: 'https://www.anthropic.com/claude-opus-5-5',
          points: 900,
        },
      ],
    };
    expect(firstPartyStory(pull, ['anthropic.com'], /opus 5\.5/i)?.id).toBe('3');
    expect(firstPartyStory(pull, ['anthropic.com'])?.id).toBe('2');
    expect(firstPartyStory(undefined, ['anthropic.com'])).toBeUndefined();
  });

  it('treats teasers as not the launch', () => {
    for (const title of [
      'Grok 4.7 Launching Soon',
      'GPT-5.6 will launch publicly this Thursday',
      'Claude Fable 5, releasing tomorrow',
      'OpenAI GPT-5.6 livestream today',
    ]) {
      expect(TEASER.test(title)).toBe(true);
    }
    expect(TEASER.test('Claude Opus 5.5')).toBe(false);
    expect(TEASER.test('GPT-5.6 Is Live')).toBe(false);
  });

  const models: OpenRouterModel[] = [
    { id: 'anthropic/claude-opus-5.5', name: '', created: 300, canonical: '' },
    { id: 'anthropic/claude-opus-5.5:free', name: '', created: 100, canonical: '' },
    { id: '~anthropic/claude-opus-latest', name: '', created: 50, canonical: '' },
    { id: 'openai/gpt-6-sol', name: '', created: 200, canonical: '' },
    { id: 'openai/gpt-6-luna', name: '', created: 150, canonical: '' },
    { id: 'someone/tiny-model', name: '', created: 120, canonical: '' },
  ];

  it('takes availability as the earliest listed id', () => {
    expect(availability(models, ['openai/gpt-6-sol', 'openai/gpt-6-luna'])?.id).toBe('openai/gpt-6-luna');
    expect(availability(models, ['missing/model'])).toBeUndefined();
  });

  it('counts frontier listings without aliases or free twins', () => {
    expect(frontierListings(models).map((l) => l.t)).toEqual([150, 200, 300]);
    expect(frontierListings(models, 'anthropic')).toEqual([{ t: 300, lab: 'anthropic' }]);
  });

  it('asks whether a listing lands in (t, t + h]', () => {
    const times = [100, 200, 300];
    expect(listedWithin(times, 100, 50)).toBe(0);
    expect(listedWithin(times, 99, 1)).toBe(1);
    expect(listedWithin(times, 150, 50)).toBe(1);
    expect(listedWithin(times, 300, 1000)).toBe(0);
  });
});

describe('fetch: network half, against a stubbed fetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('walks Gamma keyset pages with after_cursor and stops on a repeated page', async () => {
    const page = Array.from({ length: 50 }, (_, i) => ({ id: i }));
    const fetchMock = vi.fn(async () => json({ events: page, next_cursor: 'abc' }));
    vi.stubGlobal('fetch', fetchMock);
    const events = await fetchGammaEvents('tag_slug=ai&closed=true');
    expect(events).toHaveLength(50);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls[0]).toContain('limit=50');
    expect(urls[1]).toContain('after_cursor=abc');
  });

  it('stops on a short page', async () => {
    const fetchMock = vi.fn(async () => json({ events: [{ id: 1 }], next_cursor: 'abc' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchGammaEvents('q')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps model-release ladders and drops apps and non-release markets', () => {
    const event = (title: string): RawEvent => ({
      id: '1',
      slug: 's',
      title,
      createdAt: '',
      closed: true,
      markets: [],
    });
    expect(isReleaseEvent(event('GPT-5.5 released by...?'), new Set())).toBe(true);
    expect(isReleaseEvent(event('ChatGPT app released by...?'), new Set())).toBe(false);
    expect(isReleaseEvent(event('Which company has the best AI model?'), new Set())).toBe(false);
    expect(isReleaseEvent(event('Anything'), new Set(['1']))).toBe(true);
  });

  it('pulls at most 15 days per rung, ending at the rung close', () => {
    const market = {
      id: '1',
      label: 'September 24',
      openedAt: '2026-08-01T00:00:00Z',
      closedTime: '2026-09-24T20:00:00Z',
      endDate: '2026-09-25T00:00:00Z',
      closed: true,
      yesToken: 'tok',
      resolved: 'yes' as const,
    };
    const [start, end] = clobWindow(market, 'by')!;
    expect(end).toBe(t('2026-09-24T20:00:00Z'));
    expect(end - start).toBe(15 * DAY);
    expect(clobWindow({ ...market, resolved: undefined }, 'by')).toBeUndefined();
    expect(
      clobWindow(
        { ...market, label: 'September 24', endDate: '2026-01-10T00:00:00Z', closedTime: undefined },
        'by',
      ),
    ).toBeUndefined();
  });

  it('pulls CLOB series at fidelity 60 and stores them compacted', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        history: [
          { t: 10, p: 0.1 },
          { t: 20, p: 0.1 },
          { t: 30, p: 0.4 },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const events: RawEvent[] = [
      {
        id: '1',
        slug: 's',
        title: 'GPT-5.5 released by...?',
        createdAt: '',
        closed: true,
        markets: [
          {
            id: 'm',
            label: 'September 24',
            endDate: '2026-09-25T00:00:00Z',
            openedAt: '2026-09-20T00:00:00Z',
            closedTime: '2026-09-24T20:00:00Z',
            closed: true,
            yesToken: 'tok',
            resolved: 'yes',
          },
        ],
      },
    ];
    const series = await fetchSeries(events);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('fidelity=60');
    expect(series.tok.points).toEqual([10, 0.1, 30, 0.4]);
  });

  it('maps HN hits and OpenRouter models into sorted raw rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('algolia')
          ? json({
              hits: [
                { objectID: '2', created_at_i: 20, title: 'b', url: 'https://x.ai/b', points: 5 },
                { objectID: '1', created_at_i: 10, title: 'a' },
              ],
            })
          : json({
              data: [
                { id: 'b/m', created: 20 },
                { id: 'a/m', created: 10, name: 'A', canonical_slug: 'a/m-1' },
                { id: 'bad', created: 'x' },
              ],
            }),
      ),
    );
    const hn = await fetchHn([
      { id: 'r', query: 'Grok', from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' },
    ]);
    expect(hn.r.hits.map((h) => h.id)).toEqual(['1', '2']);
    expect(hn.r.hits[0].url).toBe('');
    const models = await fetchOpenRouter();
    expect(models.map((m) => m.id)).toEqual(['a/m', 'b/m']);
  });
});

describe('build: pure metrics', () => {
  it('decodes tweet ids (Snowflake) to times', () => {
    expect(iso(Math.floor(snowflakeTime('1790075827666796666')))).toBe('2024-05-13T17:45:09Z');
  });

  it('bins forecasts for a reliability plot', () => {
    const bins = reliability([0.05, 0.05, 0.95, 1], [0, 1, 1, 1], 10);
    expect(bins).toEqual([
      { from: 0, to: 0.1, n: 2, meanForecast: 0.05, observed: 0.5 },
      { from: 0.9, to: 1, n: 2, meanForecast: 0.975, observed: 1 },
    ]);
  });

  it('reads the market forecast only from rungs trading, unsettled and due inside the window', () => {
    const rung = (deadline: number, p: number, over: Partial<Rung2> = {}): Rung2 => ({
      event: { id: 'e', slug: 's', title: 'GPT-X released by...?', createdAt: '', closed: true, markets: [] },
      market: { id: 'm', label: '', openedAt: '', closed: true, resolved: 'yes' },
      rung: { kind: 'by', deadline, date: '' },
      labId: 'openai',
      points: [[0, p]],
      opened: -10 * HOUR,
      closed: deadline,
      settled: Infinity,
      leftCensored: false,
      window: [0, deadline],
      ...over,
    });
    const now = 100 * HOUR;
    const rungs = [
      rung(now + 10 * HOUR, 0.4),
      rung(now + 30 * HOUR, 0.9),
      rung(now + 5 * HOUR, 0.8, { settled: now - HOUR }),
      rung(now + 5 * HOUR, 0.7, { labId: 'anthropic', opened: now - 60 }),
    ];
    expect(marketForecast(rungs, now, 24 * HOUR)).toBe(0.4);
    expect(marketForecast(rungs, now, 48 * HOUR)).toBe(0.9);
    expect(marketForecast(rungs, now, 24 * HOUR, 'anthropic')).toBe(0);
  });

  const series = (
    kind: 'by' | 'day',
    leads: [number | null, number | null, number | null],
    dated = true,
  ): SeriesCrossings => ({
    event: 'e',
    label: 'September 22',
    url: '',
    token: 't',
    window: [0, 1],
    deadline: '',
    kind,
    slackH: dated ? 10 : 400,
    dated,
    crossings: [0.5, 0.7, 0.9].map((threshold, i) => ({
      threshold,
      heldAt: null,
      heldLeadH: leads[i],
      touchAt: null,
      touchLeadH: leads[i],
      censored: false,
      atOpen: false,
    })),
    peak: 1,
  });
  const row = (
    id: string,
    precursor: CrossingRow['precursor'],
    day: SeriesCrossings | null,
    by: SeriesCrossings | null,
  ): CrossingRow => ({
    id,
    labId: 'openai',
    model: id,
    precursor,
    announcedAt: null,
    availabilityH: null,
    day,
    by,
    primary: day?.dated ? 'day' : by?.dated ? 'by' : null,
  });

  it('reads leads from the primary series and splits them', () => {
    const rows = [
      row('a', 'leak', series('day', [30, 20, 5]), series('by', [300, 200, 50])),
      row('b', 'none', null, series('by', [-1, -1, -2])),
      row('c', 'announced', null, series('by', [500, 400, 300], false)),
    ];
    expect(primaryLead(rows[0], 0.9)).toBe(5);
    expect(primaryLead(rows[2], 0.5)).toBeNull();
    const splits = crossingSplits(rows);
    expect(splits.byPrecursor).toEqual([
      { group: 'announced', events: 0, undated: 1, ahead50: 0, ahead90: 0, medianLead50H: null },
      { group: 'leak', events: 1, undated: 0, ahead50: 1, ahead90: 1, medianLead50H: 30 },
      { group: 'none', events: 1, undated: 0, ahead50: 0, ahead90: 0, medianLead50H: -1 },
    ]);
    expect(splits.byLab).toEqual([
      { group: 'OpenAI', events: 2, undated: 1, ahead50: 1, ahead90: 1, medianLead50H: 14.5 },
    ]);
  });

  it('classifies architecture merges and links release rows', () => {
    const releases = [
      {
        id: 'qwen3.5',
        announcedAt: '2026-02-16T09:32:21Z',
        announcement: { title: '', url: '', hn: 'https://news.ycombinator.com/item?id=47032876' },
      },
    ] as ReleaseRow[];
    const rows = architectureRows('2026-09-26T00:00:00Z', releases, [
      {
        family: 'Lead',
        lab: 'Qwen',
        module: 'a',
        pr: 1,
        mergedAt: '2026-02-09T11:21:25Z',
        announcedAt: null,
        story: null,
        release: 'qwen3.5',
      },
      {
        family: 'Same',
        lab: 'Z',
        module: 'b',
        pr: 2,
        mergedAt: '2026-01-01T00:00:00Z',
        announcedAt: '2026-01-01T05:00:00Z',
        story: 3,
      },
      {
        family: 'Late',
        lab: 'Z',
        module: 'c',
        pr: 4,
        mergedAt: '2026-01-02T00:00:00Z',
        announcedAt: '2026-01-01T00:00:00Z',
        story: 5,
      },
      {
        family: 'Pending',
        lab: 'Qwen',
        module: 'd',
        pr: 6,
        mergedAt: '2026-08-26T12:03:40Z',
        announcedAt: null,
        story: null,
      },
    ]);
    expect(rows.map((r) => r.verdict)).toEqual(['leads', 'coincident', 'lags', 'pending']);
    expect(rows[0]).toMatchObject({ story: 47032876, leadH: 166.2, announcedAt: '2026-02-16T09:32:21Z' });
    expect(rows[3].pendingDays).toBe(30);
    expect(rows[1].prUrl).toBe('https://github.com/huggingface/transformers/pull/2');
  });

  it('computes broadcast warning from the archived schedule', () => {
    const rows = broadcastRows(BROADCASTS);
    expect(rows.find((b) => b.model === 'GPT-5')).toMatchObject({
      leadH: 4.9,
      captureUrl: expect.stringContaining('web.archive.org/web/20250807160625'),
    });
    expect(rows.every((b) => b.leadH > 0)).toBe(true);
  });

  it('corrects the "her" story from the tweet id', () => {
    const traps = trapRows([], TIMESTAMP_TRAPS);
    const her = traps.find((x) => x.id === 'her');
    expect(her?.example).toContain('17 minutes after');
    expect(her?.example).toContain('2024-05-13T17:45:09Z');
    expect(traps.find((x) => x.id === 'openrouter-created')?.fakeLeadH).toBeNull();
  });

  it('takes the announcement from the first non-teaser first-party story', () => {
    const raw: RawPulls = {
      pulledAt: '2026-09-26T00:00:00Z',
      events: [],
      series: {},
      hn: {
        'claude-opus-5.5': {
          query: 'Opus 5.5',
          from: '',
          to: '',
          hits: [
            {
              id: '1',
              t: t('2026-09-21T08:00:00Z'),
              title: 'Claude Opus 5.5 coming soon',
              url: 'https://www.anthropic.com/x',
              points: 1,
            },
            {
              id: '2',
              t: t('2026-09-22T16:27:30Z'),
              title: 'Claude Opus 5.5',
              url: 'https://www.anthropic.com/claude-opus-5-5',
              points: 800,
            },
          ],
        },
      },
      openrouter: [
        { id: 'anthropic/claude-opus-5.5', name: '', created: t('2026-09-22T16:33:30Z'), canonical: '' },
      ],
    };
    const [row] = releaseRows(
      raw,
      RELEASES.filter((r) => r.id === 'claude-opus-5.5'),
    );
    expect(row).toMatchObject({
      announcedAt: '2026-09-22T16:27:30Z',
      availableAt: '2026-09-22T16:33:30Z',
      availabilityLagH: 0.1,
      preAnnounced: false,
      precursor: 'leak',
    });
  });
});

describe('view helpers', () => {
  it('formats signed durations, times and percentages', () => {
    expect(signedHours(31)).toBe('+31.0h');
    expect(signedHours(-0.5)).toBe('−0.5h');
    expect(signedHours(0)).toBe('0.0h');
    expect(signedHours(254)).toBe('+10.6d');
    expect(signedHours(null)).toBe('—');
    expect(utcMinute('2026-09-22T16:27:30Z')).toBe('2026-09-22 16:27Z');
    expect(utcMinute(null)).toBe('—');
    expect(pct(0.772)).toBe('77%');
    expect(pct(undefined)).toBe('—');
  });

  it('maps the symmetric log scale monotonically and clamps', () => {
    expect(symlog(0)).toBe(0);
    expect(symlog(-3)).toBeCloseTo(-Math.log10(2));
    const x = symlogScale(-288, 48, 0, 100);
    expect(x(-288)).toBe(0);
    expect(x(48)).toBe(100);
    expect(x(-1000)).toBe(0);
    expect(x(-24)).toBeLessThan(x(-6));
    expect(x(-6)).toBeLessThan(x(0));
  });
});

describe('curated inputs', () => {
  it('has at least 15 releases, unique ids, and keeps Astra apart from Sol/Luna', () => {
    expect(RELEASES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(RELEASES.map((r) => r.id)).size).toBe(RELEASES.length);
    const astra = RELEASES.find((r) => r.id === 'gpt-6-astra')!;
    const sol = RELEASES.find((r) => r.id === 'gpt-6-sol-luna')!;
    expect(astra.markets.filter((m) => sol.markets.includes(m))).toEqual([]);
    expect(new Set(RELEASES.flatMap((r) => r.markets)).size).toBe(RELEASES.flatMap((r) => r.markets).length);
  });

  it('lists architecture merges with 7 leads out of about 15, not 7 of 7', () => {
    expect(ARCHITECTURE.length).toBeGreaterThanOrEqual(15);
    expect(ARCHITECTURE.find((a) => a.module === 'qwen4_exp')).toMatchObject({
      announcedAt: null,
      mergedAt: '2026-08-26T12:03:40Z',
    });
  });
});

describe('committed data', () => {
  it('matches a rebuild from the committed raw pulls, and every curated pointer resolves', async () => {
    const raw = await readRaw();
    const events = new Set(raw.events.map((e) => e.id));
    const listed = new Set(raw.openrouter.map((m) => m.id));
    for (const r of RELEASES) {
      expect(raw.hn[r.id], `${r.id} HN pull`).toBeDefined();
      expect(
        r.openrouter.some((id) => listed.has(id)),
        `${r.id} OpenRouter id`,
      ).toBe(true);
      for (const m of r.markets) expect(events.has(m), `${r.id} market ${m}`).toBe(true);
    }
    const built = JSON.parse(JSON.stringify(buildBacktest(raw))) as Record<string, unknown>;
    for (const [name, value] of Object.entries(built)) {
      expect(await readJson(`data/backtest/${name}.json`), `${name}.json`).toEqual(value);
    }
    const releases = built['release-events'] as { releases: ReleaseRow[] };
    expect(releases.releases.every((r) => r.announcedAt && r.availableAt)).toBe(true);
  }, 60_000);
});
