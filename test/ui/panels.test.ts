import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Drops from '../../src/components/Drops.astro';
import Feed from '../../src/components/Feed.astro';
import Footer from '../../src/components/Footer.astro';
import Markets from '../../src/components/Markets.astro';
import { assembleDashboard, type DashboardInputs } from '../../src/domain/dashboard';
import type { Drop } from '../../src/domain/drop';
import type { FeedItem, FeedSource } from '../../src/domain/feed';
import { LABS } from '../../src/domain/lab';
import type { Market } from '../../src/domain/market';
import { FEED_SOURCE_NAME, SOURCE } from '../../src/domain/sources';
import {
  FEED_LABELS,
  MOBILE_DROPS,
  MOBILE_FEED,
  MOBILE_MARKETS,
  PANEL_ROWS,
  STALE_AFTER_MS,
  dropPrice,
  feedColour,
  otherRows,
  releaseRows,
  sourcePill,
  stealthIds,
} from '../../src/ui/panels';

const NOW = Date.parse('2026-09-19T12:00:00Z');
const GENERATED = new Date(NOW).toISOString();

const release = (n: number, overrides: Partial<Market> = {}): Market => ({
  slug: `release-${n}`,
  title: `Model ${n} released by...?`,
  url: `https://polymarket.com/event/release-${n}`,
  vol24: 10_000 - n,
  volume: 1e6,
  kind: 'release',
  labId: 'openai',
  outcomes: [
    {
      label: 'September 30',
      yes: 0.4,
      endDate: '2026-10-01T00:00:00Z',
      closed: false,
      vol24: 100,
      deadline: '2026-10-01T03:59:59.000Z',
      deadlineKind: 'by',
      bestBid: 0.39,
      bestAsk: 0.41,
      thin: false,
    },
  ],
  ...overrides,
});
const other = (n: number): Market => ({
  slug: `other-${n}`,
  title: `Will model ${n} top the arena?`,
  url: `https://polymarket.com/event/other-${n}`,
  vol24: 500 - n,
  volume: 1e5,
  kind: 'other',
  outcomes: [{ label: 'Yes', yes: 0.37, closed: false, vol24: 5, bestBid: 0.36, bestAsk: 0.38, thin: false }],
});
const listing = (n: number, overrides: Partial<Drop> = {}): Drop => ({
  id: `vendor/model-${n}`,
  name: `Model ${n}`,
  lab: 'Vendor',
  createdAt: new Date(NOW - n * 86_400_000).toISOString(),
  context: 131_072,
  promptPerM: 1,
  completionPerM: 4,
  url: `https://openrouter.ai/vendor/model-${n}`,
  free: false,
  ...overrides,
});
const stealthSlot = listing(0, {
  id: 'stealth/space-bunny-alpha',
  name: 'Space Bunny Alpha',
  lab: 'Stealth',
  promptPerM: 0,
  completionPerM: 0,
  free: true,
  stealth: true,
});
const SOURCES: FeedSource[] = ['hn', 'openai', 'deepmind', 'anthropic', 'xai', 'github'];
const story = (n: number): FeedItem => ({
  source: SOURCES[n % SOURCES.length],
  title: `Story ${n}`,
  url: `https://example.com/story-${n}`,
  publishedAt: new Date(NOW - (n + 1) * 60_000).toISOString(),
  alert: n === 0,
});

function inputs(overrides: Partial<DashboardInputs> = {}): DashboardInputs {
  const feed = Array.from({ length: 20 }, (_, n) => story(n));
  return {
    markets: {
      name: SOURCE.polymarket,
      data: [
        ...Array.from({ length: 9 }, (_, n) => release(n + 1)),
        ...Array.from({ length: 8 }, (_, n) => other(n + 1)),
      ],
      ok: true,
    },
    drops: {
      name: SOURCE.openrouter,
      data: [stealthSlot, ...Array.from({ length: 11 }, (_, n) => listing(n + 1))],
      ok: true,
    },
    trending: { name: SOURCE.hfTrending, data: [], ok: true },
    papers: { name: SOURCE.hfPapers, data: [], ok: true },
    feeds: (Object.keys(FEED_SOURCE_NAME) as FeedSource[]).map((source) => ({
      name: FEED_SOURCE_NAME[source],
      data: feed.filter((f) => f.source === source),
      ok: true,
    })),
    ...overrides,
  };
}
const dashboard = (overrides: Partial<DashboardInputs> = {}) => assembleDashboard(inputs(overrides), NOW);

describe('sourcePill (UI-04)', () => {
  const health = [
    { name: 'Polymarket', ok: true },
    { name: 'Hacker News', ok: true },
    { name: 'Anthropic news', ok: false, error: 'timeout' },
  ];

  it('reads LIVE with the source name while the source answered and the data is fresh', () => {
    const pill = sourcePill(health, ['Polymarket'], GENERATED, NOW + 60_000);
    expect(pill).toMatchObject({ state: 'live', text: 'LIVE · POLYMARKET', tone: 'live' });
    expect(pill.staleAt).toBe(new Date(NOW + STALE_AFTER_MS).toISOString());
    expect(pill.staleText).toBe('STALE · POLYMARKET');
  });

  it('reads STALE once the data is STALE_AFTER_MS old, and DOWN when the source failed, however fresh', () => {
    expect(sourcePill(health, ['Polymarket'], GENERATED, NOW + STALE_AFTER_MS)).toMatchObject({
      state: 'stale',
      text: 'STALE · POLYMARKET',
      tone: 'warn',
    });
    expect(sourcePill(health, ['Anthropic news'], GENERATED, NOW)).toMatchObject({
      state: 'down',
      text: 'DOWN · ANTHROPIC NEWS',
      tone: 'err',
      title: 'Anthropic news: timeout',
    });
    // A source missing from the results never reads as live.
    expect(sourcePill(health, ['OpenRouter'], GENERATED, NOW).state).toBe('down');
  });

  it('counts the sources behind a panel: PARTIAL when some failed, DOWN when all did', () => {
    const feeds = ['Hacker News', 'Anthropic news'];
    expect(sourcePill(health, feeds, GENERATED, NOW, 'FEEDS')).toMatchObject({
      state: 'partial',
      text: 'PARTIAL · 1/2 FEEDS',
      tone: 'warn',
    });
    expect(sourcePill(health, ['Hacker News'], GENERATED, NOW, 'FEEDS').text).toBe('LIVE · FEEDS');
    expect(sourcePill(health, ['Anthropic news', 'OpenRouter'], GENERATED, NOW, 'FEEDS').text).toBe(
      'DOWN · 2 FEEDS',
    );
  });
});

describe('panel selections', () => {
  it('skips release markets with nothing open to show, and caps each list', () => {
    const empty = release(99, { outcomes: [{ ...release(0).outcomes[0], closed: true }] });
    const d = { markets: [empty, ...Array.from({ length: 20 }, (_, n) => release(n))] };
    expect(releaseRows(d).map((m) => m.slug)).not.toContain('release-99');
    expect(releaseRows(d)).toHaveLength(PANEL_ROWS.releases);
    expect(otherRows({ markets: Array.from({ length: 20 }, (_, n) => other(n)) })).toHaveLength(10);
  });

  it('flags stealth slots from the listing itself and from early warnings', () => {
    const d = dashboard();
    expect(stealthIds(d)).toEqual(new Set(['stealth/space-bunny-alpha']));
    expect(stealthIds({ drops: [], earlyWarnings: d.earlyWarnings })).toContain('stealth/space-bunny-alpha');
  });

  it('prices a listing as FREE, a dash, or in and out per million', () => {
    expect(dropPrice(stealthSlot)).toBe('FREE');
    expect(dropPrice(listing(1, { promptPerM: undefined }))).toBe('—');
    expect(dropPrice(listing(1))).toBe('$1 / $4');
  });

  it('colours a lab’s own feed from LABS, and Hacker News apart from every lab (UI-15)', () => {
    const color = (id: string) => LABS.find((l) => l.id === id)!.color;
    expect(feedColour('openai')).toBe(color('openai'));
    expect(feedColour('deepmind')).toBe(color('google'));
    expect(feedColour('anthropic')).toBe(color('anthropic'));
    expect(feedColour('xai')).toBe(color('xai'));
    expect(feedColour('hn')).toBe('var(--yellow)');
    expect(feedColour('hn')).not.toBe(feedColour('anthropic'));
    for (const source of SOURCES) expect(FEED_LABELS[source]).toBeTruthy();
  });
});

describe('panels render', async () => {
  const container = await AstroContainer.create();
  const d = dashboard();
  // Components stamp their pills against the wall clock: pin it a minute after the build.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW + 60_000);
  });
  afterAll(() => vi.useRealTimers());

  it('Markets derives its pill from Polymarket and folds rows past the phone cap (UI-04, UI-10)', async () => {
    const html = await container.renderToString(Markets, { props: { d } });
    expect(html).toMatch(/class="pill live"[^>]*data-source-pill[^>]*>LIVE · POLYMARKET</);
    const [before, folded] = html.split('<details class="fold fold-480"');
    expect(before.match(/Model \d+ released by/g)).toHaveLength(MOBILE_MARKETS);
    expect(folded).toContain(`${9 - MOBILE_MARKETS} MORE RELEASE MARKETS`);
    expect(html).toContain(`${8 - MOBILE_MARKETS} MORE MARKETS`);
    // A single yes/no market answers "Yes" instead of repeating its question (UI-12).
    expect(html).toMatch(/<b class="glow-c"[^>]*>37%<\/b> Yes/);
    // The title row is a grid: dot, title, volume, whatever wraps.
    expect(html).toMatch(
      /class="mtitle"[^>]*><span class="mdot"[^>]*aria-hidden="true"[^>]*><\/span><span class="mname"/,
    );
  });

  it('Markets says the source is down, or that there is simply nothing, from the source result', async () => {
    const down = dashboard({ markets: { name: SOURCE.polymarket, data: [], ok: false, error: 'HTTP 503' } });
    const downHtml = await container.renderToString(Markets, { props: { d: down } });
    expect(downHtml).toContain('DOWN · POLYMARKET');
    expect(downHtml).toContain('Polymarket unreachable');
    const quiet = dashboard({ markets: { name: SOURCE.polymarket, data: [], ok: true } });
    const quietHtml = await container.renderToString(Markets, { props: { d: quiet } });
    expect(quietHtml).toContain('LIVE · POLYMARKET');
    expect(quietHtml).toContain('No open release market right now.');
    expect(quietHtml).not.toContain('unreachable');
  });

  it('Drops badges stealth slots, keeps dates on one line and stacks phone rows with a price (UI-10)', async () => {
    const html = await container.renderToString(Drops, { props: { d } });
    expect(html).toMatch(/class="pill live"[^>]*>LIVE · OPENROUTER</);
    expect(html).toMatch(/Space Bunny Alpha<\/a><span class="tag stealth"[^>]*>STEALTH</);
    expect(html.match(/class="tag stealth"/g)).toHaveLength(2); // table row and phone row
    expect(html.match(/STEALTH</g)).toHaveLength(2);
    expect(html).toMatch(/<td class="muted landed"/);
    const stack = html.slice(html.indexOf('class="drop-stack"'));
    const [shown, folded] = stack.split('<details class="fold"');
    expect(shown.match(/class="drop-item/g)).toHaveLength(MOBILE_DROPS);
    expect(folded).toContain(`${12 - MOBILE_DROPS} MORE LISTINGS`);
    expect(folded.match(/class="drop-item/g)).toHaveLength(12 - MOBILE_DROPS);
    expect(shown).toContain('$1 / $4');
  });

  it('a page rendered from an old build says STALE, and a fresh one tells the browser when it will be', async () => {
    const fresh = await container.renderToString(Drops, { props: { d } });
    expect(fresh).toContain(`data-stale-at="${new Date(NOW + STALE_AFTER_MS).toISOString()}"`);
    expect(fresh).toContain('data-stale-text="STALE · OPENROUTER"');
    vi.setSystemTime(NOW + STALE_AFTER_MS + 1);
    try {
      const old = await container.renderToString(Drops, { props: { d } });
      expect(old).toMatch(/class="pill warn"[^>]*>STALE · OPENROUTER</);
      expect(old).not.toContain('LIVE · OPENROUTER');
    } finally {
      vi.setSystemTime(NOW + 60_000);
    }
  });

  it('Drops shows each Hugging Face panel’s own health', async () => {
    const html = await container.renderToString(Drops, {
      props: {
        d: dashboard({
          trending: { name: SOURCE.hfTrending, data: [], ok: false, error: 'timeout' },
          papers: { name: SOURCE.hfPapers, data: [], ok: false, error: 'timeout' },
        }),
      },
    });
    expect(html).toContain('DOWN · HF TRENDING');
    expect(html).toContain('Hugging Face unreachable.');
    expect(html).toContain('DOWN · HF PAPERS');
    expect(html).toContain('Hugging Face papers unreachable.');
  });

  it('Feed colours sources from LABS, shows MOBILE_FEED items, then folds the rest (UI-10, UI-15)', async () => {
    const html = await container.renderToString(Feed, { props: { d } });
    expect(html).toMatch(/class="pill live"[^>]*>LIVE · 6 FEEDS</);
    const anthropic = LABS.find((l) => l.id === 'anthropic')!.color;
    expect(html).toContain(`style="color:${anthropic}"`);
    expect(html).toMatch(/style="color:var\(--yellow\)"[^>]*>HN</);
    const [shown, folded] = html.split('<details class="fold fold-900"');
    expect(shown.match(/class="row item/g)).toHaveLength(MOBILE_FEED);
    expect(folded).toContain(`${20 - MOBILE_FEED} MORE REPORTS`);
    expect(folded.match(/class="row item/g)).toHaveLength(20 - MOBILE_FEED);
    expect(html).toContain('<span class="sr-only"');
  });

  it('Feed reads PARTIAL with one feed down, and says every feed is down only when they all are', async () => {
    const partial = inputs();
    partial.feeds[3] = { name: FEED_SOURCE_NAME.anthropic, data: [], ok: false, error: 'timeout' };
    const html = await container.renderToString(Feed, { props: { d: assembleDashboard(partial, NOW) } });
    expect(html).toContain('PARTIAL · 5/6 FEEDS');

    const dark = inputs();
    dark.feeds = dark.feeds.map((f) => ({ ...f, data: [], ok: false, error: 'down' }));
    const darkHtml = await container.renderToString(Feed, { props: { d: assembleDashboard(dark, NOW) } });
    expect(darkHtml).toContain('DOWN · 6 FEEDS');
    expect(darkHtml).toContain('Every feed is down.');
  });

  it('Footer lists every upstream named in SOURCE, and the backtest variant links home and to the rebuild', async () => {
    const html = await container.renderToString(Footer, { props: { generatedAt: GENERATED } });
    for (const [key, name] of Object.entries(SOURCE)) {
      if (key === 'ledger') expect(html).not.toContain(`>${name}<`);
      else expect(html).toContain(`>${name}</a>`);
    }
    expect(html).toContain('GENERATED 2026-09-19 12:00:00Z');
    expect(html).toContain('href="/backtest"');

    const bt = await container.renderToString(Footer, {
      props: { generatedAt: GENERATED, variant: 'backtest' },
    });
    expect(bt).toContain('href="/"');
    expect(bt).toContain('DATA PULLED 2026-09-19 12:00Z');
    expect(bt).toMatch(/href="#reproduce"[^>]*><code[^>]*>pnpm backtest</);
    expect(bt).not.toContain('EDGE-CACHED');
    expect(bt).toContain('OPERATIONAL DISCLAIMER');
  });
});
