import { describe, expect, it } from 'vitest';
import { selectMarkets, type PolymarketEventDto } from '../../src/adapters/polymarket';
import { assembleDashboard, type DashboardInputs } from '../../src/domain/dashboard';
import type { Drop } from '../../src/domain/drop';
import { displayOutcomes, type Market } from '../../src/domain/market';
import { dashboardFingerprint, visibleContent } from '../../src/ui/fingerprint';
import { outcomeOdds } from '../../src/ui/odds';
import { PANEL_ROWS, releaseRows } from '../../src/ui/panels';
// Live Gamma listing captured 2026-09-26T00:10Z: real ladders whose curve reads slide with the clock.
import releasesPage from '../fixtures/polymarket/ai-releases-keyset.json';

const NOW = Date.parse('2026-09-19T12:00:00Z');

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

describe('dashboardFingerprint', () => {
  it('matches between the rendered object and the JSON the API serves for it', () => {
    // The page fingerprints the assembled object (which can hold undefined fields); the browser
    // fingerprints the parsed /api/dashboard.json body. They must agree or every poll reads as new data.
    const rendered = assembleDashboard(inputs, NOW);
    const served = JSON.parse(JSON.stringify(rendered)) as object;
    expect(dashboardFingerprint(served)).toBe(dashboardFingerprint(rendered));
  });

  it('ignores generatedAt, so a rebuild with the same content is not new data', () => {
    const first = assembleDashboard(inputs, NOW);
    const rebuilt = { ...first, generatedAt: '2026-09-19T12:02:00.000Z' };
    expect(rebuilt.generatedAt).not.toBe(first.generatedAt);
    expect(dashboardFingerprint(rebuilt)).toBe(dashboardFingerprint(first));
  });

  it('changes when anything the reader could see changes', () => {
    const before = assembleDashboard(inputs, NOW);
    const after = assembleDashboard(
      { ...inputs, drops: { name: 'OpenRouter', data: [{ ...drop, promptPerM: 8 }], ok: true } },
      NOW,
    );
    expect(dashboardFingerprint(after)).not.toBe(dashboardFingerprint(before));
  });

  it('is a short, fixed-width hex digest rather than the whole payload', () => {
    expect(dashboardFingerprint(assembleDashboard(inputs, NOW))).toMatch(/^[0-9a-f]{8}$/);
    expect(dashboardFingerprint({})).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('dashboardFingerprint covers only what the reader sees (UI-11)', () => {
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
    // Nothing the page shows did, so there is no NEW DATA to offer.
    expect(dashboardFingerprint(later)).toBe(dashboardFingerprint(first));
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
    expect(dashboardFingerprint(moved)).not.toBe(dashboardFingerprint(base));

    // Rounded to the same whole percent: the page would not change, so neither does the fingerprint.
    const nudge = Math.round(outcome.yes * 100) / 100 + 0.001 - outcome.yes;
    const nudged = at(outcome.yes + nudge);
    expect(outcomeOdds({ ...outcome, yes: outcome.yes + nudge }).text).toBe(outcomeOdds(outcome).text);
    expect(dashboardFingerprint(nudged)).toBe(dashboardFingerprint(base));
  });

  it('changes when the level, the headline, a listing or a feed item changes', () => {
    const base = assembleDashboard(live, LIVE_AT);
    const fp = dashboardFingerprint(base);
    expect(dashboardFingerprint({ ...base, dropcon: { ...base.dropcon, level: 1 } })).not.toBe(fp);
    expect(dashboardFingerprint({ ...base, dropcon: { ...base.dropcon, headline: 'x' } })).not.toBe(fp);
    expect(dashboardFingerprint({ ...base, drops: base.drops.slice(1) })).not.toBe(fp);
    expect(
      dashboardFingerprint({
        ...base,
        feed: [
          {
            source: 'hn',
            title: 't',
            url: 'https://example.com/1',
            publishedAt: base.generatedAt,
            alert: false,
          },
        ],
      }),
    ).not.toBe(fp);
  });

  it('notices a new early warning of any kind, but not its clock', () => {
    const base = assembleDashboard(live, LIVE_AT);
    const w = base.earlyWarnings;
    const fp = dashboardFingerprint(base);
    const withWarnings = (patch: Partial<typeof w>) =>
      dashboardFingerprint({ ...base, earlyWarnings: { ...w, ...patch } });
    const leak = {
      source: 'hn',
      title: 'GPT-7 spotted',
      url: 'https://example.com/leak',
      publishedAt: base.generatedAt,
      sourceName: 'HN',
    };
    const stream = { channel: 'OpenAI', title: 'DevDay', url: 'https://youtube.com/watch?v=x', videoId: 'x' };
    const module = { module: 'qwen4_exp', labId: 'qwen', daysPending: 31, frontier: true };
    expect(withWarnings({ leaks: { ...w.leaks, items: [leak] } } as never)).not.toBe(fp);
    expect(withWarnings({ broadcasts: { ...w.broadcasts, items: [stream] } } as never)).not.toBe(fp);
    expect(withWarnings({ architectures: { ...w.architectures, items: [module] } } as never)).not.toBe(fp);
    const older = w.stealth.items.map((x) => ({ ...x, daysInStealth: x.daysInStealth + 1 }));
    expect(withWarnings({ stealth: { ...w.stealth, items: older } })).toBe(fp);
  });

  it('ignores fields the page never prints, such as source timings and raw inputs', () => {
    const base = assembleDashboard(live, LIVE_AT);
    const noisy = {
      ...base,
      measurement: { ...base.measurement, inputs: { ...base.measurement.inputs, p7: 0.123456 } },
      sources: base.sources.map((s) => ({ ...s, ms: 999 })),
    };
    expect(dashboardFingerprint(noisy)).toBe(dashboardFingerprint(base));
    expect(JSON.stringify(visibleContent(base))).not.toContain('generatedAt');
  });

  it('still fingerprints a body of another shape instead of throwing', () => {
    expect(dashboardFingerprint({ markets: 'not a list', generatedAt: 'x' })).toMatch(/^[0-9a-f]{8}$/);
    expect(dashboardFingerprint({ markets: 'not a list', generatedAt: 'x' })).toBe(
      dashboardFingerprint({ markets: 'not a list', generatedAt: 'y' }),
    );
  });
});
