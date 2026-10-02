import { describe, expect, it } from 'vitest';
import { selectMarkets, type PolymarketEventDto } from '../../src/adapters/polymarket';
import { assembleDashboard, type DashboardInputs } from '../../src/domain/dashboard';
import type { Drop } from '../../src/domain/drop';
import type { FeedItem } from '../../src/domain/feed';
import { displayOutcomes, type Market } from '../../src/domain/market';
import { PAGE_PARTS, pageFingerprint, visibleContent } from '../../src/ui/fingerprint';
import { outcomeOdds } from '../../src/ui/odds';
import { PANEL_ROWS, releaseRows } from '../../src/ui/panels';
import type { PageView } from '../../src/ui/site';
// Live Gamma listing captured 2026-09-26T00:10Z: real ladders whose curve reads slide with the clock.
import releasesPage from '../fixtures/polymarket/ai-releases-keyset.json';

const NOW = Date.parse('2026-09-19T12:00:00Z');

const HOME: PageView = { page: 'home' };
const LABS: PageView = { page: 'labs' };
const MARKETS: PageView = { page: 'markets' };
const RADAR: PageView = { page: 'radar' };
const ABOUT: PageView = { page: 'about' };
const ANTHROPIC: PageView = { page: 'lab', lab: 'anthropic' };
const OPENAI: PageView = { page: 'lab', lab: 'openai' };
const VIEWS: readonly PageView[] = [HOME, LABS, MARKETS, RADAR, ABOUT, ANTHROPIC, OPENAI];

const drop: Drop = {
  id: 'anthropic/claude-fable-5.1',
  name: 'Claude Fable 5.1',
  lab: 'Anthropic',
  labId: 'anthropic',
  createdAt: '2026-09-18T12:00:00Z',
  context: 1_000_000,
  promptPerM: 10,
  completionPerM: 50,
  modality: 'text->text',
  url: 'https://openrouter.ai/anthropic/claude-fable-5.1',
  free: false,
};

const inputs: DashboardInputs = {
  markets: { name: 'Polymarket', data: [], ok: false, error: 'timeout' },
  drops: { name: 'OpenRouter', data: [drop], ok: true },
  trending: { name: 'HF trending', data: [], ok: true },
  papers: { name: 'HF papers', data: [], ok: true },
  feeds: [{ name: 'Hacker News', data: [], ok: true }],
};

const item = (title: string, url: string, at: string): FeedItem => ({
  source: 'hn',
  title,
  url,
  publishedAt: at,
  alert: false,
});

describe('pageFingerprint', () => {
  it('matches between the rendered object and the JSON the API serves for it, on every page', () => {
    // The page fingerprints the assembled object (which can hold undefined fields); the browser
    // fingerprints the parsed /api/dashboard.json body. They must agree or every poll reads as new data.
    const rendered = assembleDashboard(inputs, NOW);
    const served = JSON.parse(JSON.stringify(rendered)) as object;
    for (const view of VIEWS) expect(pageFingerprint(served, view)).toBe(pageFingerprint(rendered, view));
  });

  it('ignores generatedAt, so a rebuild with the same content is not new data', () => {
    const first = assembleDashboard(inputs, NOW);
    const rebuilt = { ...first, generatedAt: '2026-09-19T12:02:00.000Z' };
    expect(rebuilt.generatedAt).not.toBe(first.generatedAt);
    for (const view of VIEWS) expect(pageFingerprint(rebuilt, view)).toBe(pageFingerprint(first, view));
  });

  it('changes when anything the reader of that page could see changes', () => {
    const before = assembleDashboard(inputs, NOW);
    const after = assembleDashboard(
      { ...inputs, drops: { name: 'OpenRouter', data: [{ ...drop, promptPerM: 8 }], ok: true } },
      NOW,
    );
    // A listing's price is printed on /radar's fresh drops, and nowhere on the home page.
    expect(pageFingerprint(after, RADAR)).not.toBe(pageFingerprint(before, RADAR));
    expect(pageFingerprint(after, HOME)).toBe(pageFingerprint(before, HOME));
  });

  it('is a short, fixed-width hex digest rather than the whole payload', () => {
    for (const view of VIEWS) {
      expect(pageFingerprint(assembleDashboard(inputs, NOW), view)).toMatch(/^[0-9a-f]{8}$/);
      expect(pageFingerprint({}, view)).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it('gives each page its own digest of its own slice', () => {
    const d = assembleDashboard(inputs, NOW);
    const prints = VIEWS.map((view) => pageFingerprint(d, view));
    expect(new Set(prints).size).toBe(VIEWS.length);
    expect(Object.keys(visibleContent(d, HOME) as object)).toEqual([...PAGE_PARTS.home]);
    expect(Object.keys(visibleContent(d, RADAR) as object)).toEqual([...PAGE_PARTS.radar]);
    expect(visibleContent(d, ANTHROPIC)).toMatchObject({ lab: 'anthropic' });
  });
});

describe('pageFingerprint covers only what the reader sees (UI-11)', () => {
  const LIVE_AT = Date.parse('2026-09-26T00:10:00Z');
  const markets = selectMarkets(releasesPage.events as PolymarketEventDto[]);
  const stealth: Drop = {
    id: 'stealth/space-bunny-alpha',
    name: 'Space Bunny Alpha',
    lab: 'Stealth',
    createdAt: '2026-09-23T14:48:04.000Z',
    context: 1_000_000,
    promptPerM: 0,
    completionPerM: 0,
    url: 'https://openrouter.ai/stealth/space-bunny-alpha',
    free: true,
    stealth: true,
  };
  const live: DashboardInputs = {
    ...inputs,
    markets: { name: 'Polymarket', data: markets, ok: true },
    drops: { name: 'OpenRouter', data: [stealth, drop], ok: true },
  };
  const withoutClock = (d: object) => JSON.stringify({ ...d, generatedAt: undefined });

  it('does not change when only the clock moved: generatedAt, curve drift, days in stealth', () => {
    const first = assembleDashboard(live, LIVE_AT);
    const later = assembleDashboard(live, LIVE_AT + 2 * 60_000);
    // The payload itself did move: the stealth clock and the interpolated 7-day reads slide with time.
    expect(later.earlyWarnings.stealth.items[0].daysInStealth).toBeGreaterThan(
      first.earlyWarnings.stealth.items[0].daysInStealth,
    );
    expect(later.measurement.inputs.p7).not.toBe(first.measurement.inputs.p7);
    expect(withoutClock(later)).not.toBe(withoutClock(first));
    // Nothing any page shows did, so no page offers NEW DATA.
    for (const view of VIEWS) expect(pageFingerprint(later, view)).toBe(pageFingerprint(first, view));
  });

  it('changes when a displayed market price changes, and not below the precision it is shown at', () => {
    const base = assembleDashboard(live, LIVE_AT);
    const shown = releaseRows(base)[0];
    const outcome = displayOutcomes(shown, PANEL_ROWS.releaseOutcomes).find(
      (o) => !o.thin && o.yes > 0.1 && o.yes < 0.9,
    )!;
    expect(outcome).toBeDefined();
    const reprice = (yes: number): Market[] =>
      markets.map((m) =>
        m.slug !== shown.slug
          ? m
          : { ...m, outcomes: m.outcomes.map((o) => (o === outcome ? { ...o, yes } : o)) },
      );
    const at = (yes: number) =>
      assembleDashboard({ ...live, markets: { name: 'Polymarket', data: reprice(yes), ok: true } }, LIVE_AT);

    const moved = at(outcome.yes + 0.05);
    expect(outcomeOdds({ ...outcome, yes: outcome.yes + 0.05 }).text).not.toBe(outcomeOdds(outcome).text);
    expect(pageFingerprint(moved, MARKETS)).not.toBe(pageFingerprint(base, MARKETS));
    // /radar prints no market price.
    expect(pageFingerprint(moved, RADAR)).toBe(pageFingerprint(base, RADAR));

    // Rounded to the same whole percent: the page would not change, so neither does the fingerprint.
    const nudge = Math.round(outcome.yes * 100) / 100 + 0.001 - outcome.yes;
    const nudged = at(outcome.yes + nudge);
    expect(outcomeOdds({ ...outcome, yes: outcome.yes + nudge }).text).toBe(outcomeOdds(outcome).text);
    expect(pageFingerprint(nudged, MARKETS)).toBe(pageFingerprint(base, MARKETS));
  });

  it('offers new data when a rung passes its deadline, because the page stops showing it', () => {
    const first = assembleDashboard(live, LIVE_AT);
    // Same body, built after the Sep 25 rungs' 03:59:59Z deadline: those rungs leave the panel.
    const later = { ...first, generatedAt: '2026-09-26T04:10:00.000Z' };
    const labels = (d: object) =>
      JSON.stringify((visibleContent(d, MARKETS) as { markets: { releases: unknown } }).markets.releases);
    expect(labels(first)).toContain('September 25');
    expect(labels(later)).not.toContain('September 25');
    expect(pageFingerprint(later, MARKETS)).not.toBe(pageFingerprint(first, MARKETS));
  });

  it('changes when the level, the headline, a listing or a feed item changes, on the page that shows it', () => {
    const base = assembleDashboard(live, LIVE_AT);
    const home = pageFingerprint(base, HOME);
    const radar = pageFingerprint(base, RADAR);
    expect(pageFingerprint({ ...base, dropcon: { ...base.dropcon, level: 1 } }, HOME)).not.toBe(home);
    expect(pageFingerprint({ ...base, dropcon: { ...base.dropcon, headline: 'x' } }, HOME)).not.toBe(home);
    expect(pageFingerprint({ ...base, dropcon: { ...base.dropcon, level: 1 } }, ABOUT)).not.toBe(
      pageFingerprint(base, ABOUT),
    );
    expect(pageFingerprint({ ...base, drops: base.drops.slice(1) }, RADAR)).not.toBe(radar);
    const withFeed = { ...base, feed: [item('t', 'https://example.com/1', base.generatedAt)] };
    expect(pageFingerprint(withFeed, RADAR)).not.toBe(radar);
    // A /radar change never offers NEW DATA on the home page.
    expect(pageFingerprint(withFeed, HOME)).toBe(home);
  });

  it('offers a lab page new data when an item names that lab, and not other labs', () => {
    const base = assembleDashboard(live, LIVE_AT);
    const named = {
      ...base,
      feed: [item('Claude Mythos 6 spotted in the wild', 'https://example.com/claude', base.generatedAt)],
    };
    expect(pageFingerprint(named, ANTHROPIC)).not.toBe(pageFingerprint(base, ANTHROPIC));
    expect(pageFingerprint(named, OPENAI)).toBe(pageFingerprint(base, OPENAI));
    expect(pageFingerprint(named, HOME)).toBe(pageFingerprint(base, HOME));
  });

  it('notices a new early warning of any kind, but not its clock', () => {
    const base = assembleDashboard(live, LIVE_AT);
    const w = base.earlyWarnings;
    const fp = pageFingerprint(base, RADAR);
    const withWarnings = (patch: Partial<typeof w>, view: PageView = RADAR) =>
      pageFingerprint({ ...base, earlyWarnings: { ...w, ...patch } }, view);
    const leak = {
      source: 'hn',
      title: 'GPT-7 spotted',
      url: 'https://example.com/leak',
      publishedAt: base.generatedAt,
      sourceName: 'HN',
      labId: 'openai',
    };
    const stream = { channel: 'OpenAI', title: 'DevDay', url: 'https://youtube.com/watch?v=x', videoId: 'x' };
    const module = { module: 'qwen4_exp', labId: 'qwen', daysPending: 31, frontier: true };
    expect(withWarnings({ leaks: { ...w.leaks, items: [leak] } } as never)).not.toBe(fp);
    expect(withWarnings({ broadcasts: { ...w.broadcasts, items: [stream] } } as never)).not.toBe(fp);
    expect(withWarnings({ architectures: { ...w.architectures, items: [module] } } as never)).not.toBe(fp);
    // The lab list flags each lab with its warnings, so it notices too.
    expect(withWarnings({ leaks: { ...w.leaks, items: [leak] } } as never, LABS)).not.toBe(
      pageFingerprint(base, LABS),
    );
    const older = w.stealth.items.map((x) => ({ ...x, daysInStealth: x.daysInStealth + 1 }));
    expect(withWarnings({ stealth: { ...w.stealth, items: older } })).toBe(fp);
  });

  it("hashes the race, the trending repos, the landed launches and a lab page's warnings where they are shown", () => {
    const base = assembleDashboard(live, LIVE_AT);
    const race = {
      slug: 'best',
      title: 'Which company has the best AI model end of September?',
      url: 'https://polymarket.com/event/best',
      vol24: 1,
      volume: 1,
      kind: 'leaderboard',
      outcomes: [
        { label: 'Google', yes: 0.61, closed: false, vol24: 1 },
        { label: 'Anthropic', yes: 0.3, closed: false, vol24: 1 },
      ],
    } as Market;
    const raced = { ...base, markets: [...base.markets, race] };
    const rerace = {
      ...base,
      markets: [
        ...base.markets,
        { ...race, outcomes: [{ ...race.outcomes[0], yes: 0.7 }, race.outcomes[1]] },
      ],
    };
    expect(pageFingerprint(rerace, MARKETS)).not.toBe(pageFingerprint(raced, MARKETS));
    expect(pageFingerprint(rerace, HOME)).toBe(pageFingerprint(raced, HOME));

    const repo = {
      id: 'org/m',
      url: 'https://huggingface.co/org/m',
      likes: 1,
      downloads: 1,
      createdAt: '',
      score: 1,
    };
    expect(pageFingerprint({ ...base, trending: [repo] }, RADAR)).not.toBe(pageFingerprint(base, RADAR));

    const release = { ...base.landed.releases[0], id: 'anthropic/claude-mythos-6', labId: 'anthropic' };
    const landed = { ...base, landed: { ...base.landed, releases: [release] } };
    expect(pageFingerprint(landed, RADAR)).not.toBe(pageFingerprint(base, RADAR));
    expect(pageFingerprint(landed, ANTHROPIC)).not.toBe(pageFingerprint(base, ANTHROPIC));

    const w = base.earlyWarnings;
    const qwen: PageView = { page: 'lab', lab: 'qwen' };
    const module = { module: 'qwen4_exp', labId: 'qwen', daysPending: 31, frontier: true };
    const flagged = {
      ...base,
      earlyWarnings: { ...w, architectures: { ...w.architectures, items: [module] } },
    };
    expect(pageFingerprint(flagged as never, qwen)).not.toBe(pageFingerprint(base, qwen));
    expect(pageFingerprint(flagged as never, ANTHROPIC)).toBe(pageFingerprint(base, ANTHROPIC));
  });

  it('hashes the departure board, the arrivals and the notice on the home page, and each line on the network', () => {
    const base = assembleDashboard(live, LIVE_AT);
    const home = pageFingerprint(base, HOME);
    const network = pageFingerprint(base, LABS);
    const lab = base.labs.find((l) => l.odds)!;
    // A line's 7-day odds as printed: a move below a whole percent is not new data, a whole point is.
    const nudge = (dp: number) => ({
      ...base,
      labs: base.labs.map((l) =>
        l === lab ? { ...l, odds: { ...l.odds!, p7: { ...l.odds!.p7, p: l.odds!.p7.p + dp } } } : l,
      ),
    });
    const shown = Math.round(lab.odds!.p7.p * 100);
    const tiny = Math.round((lab.odds!.p7.p + 0.001) * 100) === shown ? 0.001 : -0.001;
    expect(pageFingerprint(nudge(tiny), HOME)).toBe(home);
    if (lab.odds!.p7.trusted) {
      expect(pageFingerprint(nudge(0.05), HOME)).not.toBe(home);
      expect(pageFingerprint(nudge(0.05), LABS)).not.toBe(network);
    }
    // A line whose market thins out moves from a time to "times unavailable" on both pages.
    const thinned = {
      ...base,
      labs: base.labs.map((l) =>
        l === lab ? { ...l, odds: { ...l.odds!, p7: { ...l.odds!.p7, trusted: !l.odds!.p7.trusted } } } : l,
      ),
    };
    expect(pageFingerprint(thinned, HOME)).not.toBe(home);
    expect(pageFingerprint(thinned, LABS)).not.toBe(network);
    // A new arrival and a new unmarked train each show on the home page.
    const release = { ...base.landed.releases[0], id: 'anthropic@2026-09-30', labId: 'anthropic' };
    expect(pageFingerprint({ ...base, landed: { ...base.landed, releases: [release] } }, HOME)).not.toBe(
      home,
    );
    const w = base.earlyWarnings;
    const slot = { ...w.stealth.items[0], id: 'stealth/new-train' };
    expect(
      pageFingerprint({ ...base, earlyWarnings: { ...w, stealth: { ...w.stealth, items: [slot] } } }, HOME),
    ).not.toBe(home);
  });

  it('ignores fields the page never prints, such as source timings and raw inputs', () => {
    const base = assembleDashboard(live, LIVE_AT);
    const noisy = {
      ...base,
      measurement: { ...base.measurement, inputs: { ...base.measurement.inputs, p7: 0.123456 } },
      sources: base.sources.map((s) => ({ ...s, ms: 999 })),
    };
    for (const view of VIEWS) {
      expect(pageFingerprint(noisy, view)).toBe(pageFingerprint(base, view));
      expect(JSON.stringify(visibleContent(base, view))).not.toContain('generatedAt');
    }
    // A source going down is printed on /about's health list.
    const down = { ...base, sources: base.sources.map((s, i) => (i === 0 ? { ...s, ok: false } : s)) };
    expect(pageFingerprint(down, ABOUT)).not.toBe(pageFingerprint(base, ABOUT));
  });

  it('still fingerprints a body of another shape instead of throwing', () => {
    for (const view of VIEWS) {
      expect(pageFingerprint({ markets: 'not a list', generatedAt: 'x' }, view)).toMatch(/^[0-9a-f]{8}$/);
      expect(pageFingerprint({ markets: 'not a list', generatedAt: 'x' }, view)).toBe(
        pageFingerprint({ markets: 'not a list', generatedAt: 'y' }, view),
      );
    }
    // A selection that throws on an odd body falls back to the whole body minus its clock.
    const odd = { labs: [null], generatedAt: 'x' };
    expect(pageFingerprint(odd, LABS)).toBe(pageFingerprint({ ...odd, generatedAt: 'y' }, LABS));
    expect(pageFingerprint(odd, LABS)).not.toBe(pageFingerprint({ labs: [null, null] }, LABS));
  });
});
