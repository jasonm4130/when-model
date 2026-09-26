import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Dropcon from '../../src/components/Dropcon.astro';
import Drops from '../../src/components/Drops.astro';
import Feed from '../../src/components/Feed.astro';
import Header from '../../src/components/Header.astro';
import Labs from '../../src/components/Labs.astro';
import Markets from '../../src/components/Markets.astro';
import Signals from '../../src/components/Signals.astro';
import { assembleDashboard, type DashboardInputs } from '../../src/domain/dashboard';
import type { Drop } from '../../src/domain/drop';
import type { Market } from '../../src/domain/market';

const NOW = Date.parse('2026-09-19T12:00:00Z');

const fable: Drop = {
  id: 'anthropic/claude-fable-5.1',
  name: 'Claude Fable 5.1',
  lab: 'Anthropic',
  labId: 'anthropic',
  createdAt: '2026-09-18T12:00:00Z',
  context: 1_000_000,
  promptPerM: 10,
  completionPerM: 50,
  modality: 'text+image->text',
  url: 'https://openrouter.ai/anthropic/claude-fable-5.1',
  free: false,
};
const release: Market = {
  slug: 'gpt-6',
  title: 'GPT-6 released by...?',
  url: 'https://polymarket.com/event/gpt-6',
  vol24: 65_288,
  volume: 1e6,
  kind: 'release',
  labId: 'openai',
  outcomes: [
    {
      label: 'September 24',
      yes: 0.66,
      endDate: '2026-09-25T00:00:00Z',
      closed: false,
      vol24: 100,
      deadline: '2026-09-25T03:59:59.000Z',
      deadlineKind: 'by',
      bestBid: 0.655,
      bestAsk: 0.665,
      thin: false,
      liquidity: 1000,
    },
  ],
};
const board: Market = {
  slug: 'best',
  title: 'Which company has the best AI model end of September?',
  url: 'https://polymarket.com/event/best',
  vol24: 100_000,
  volume: 2e6,
  kind: 'leaderboard',
  outcomes: [
    { label: 'Google', yes: 0.61, closed: false, vol24: 1 },
    { label: 'Anthropic', yes: 0.3, closed: false, vol24: 1 },
    { label: 'Other', yes: 0.02, closed: false, vol24: 1 },
  ],
};

function dashboard(overrides: Partial<DashboardInputs> = {}) {
  return assembleDashboard(
    {
      markets: { name: 'Polymarket', data: [release, board], ok: true },
      drops: { name: 'OpenRouter', data: [fable], ok: true },
      trending: {
        name: 'HF trending',
        data: [
          {
            id: 'org/open-model',
            url: 'https://huggingface.co/org/open-model',
            likes: 1200,
            downloads: 50_000,
            createdAt: '2026-09-10T00:00:00Z',
            score: 9,
          },
        ],
        ok: true,
      },
      papers: {
        name: 'HF papers',
        data: [
          {
            id: 'p1',
            title: 'Scaling Laws Revisited',
            url: 'https://huggingface.co/papers/p1',
            upvotes: 42,
            publishedAt: '2026-09-18T00:00:00Z',
          },
        ],
        ok: true,
      },
      feeds: [
        {
          name: 'Hacker News',
          data: [
            {
              source: 'hn',
              title: 'Introducing <GPT-6> & friends',
              url: 'https://news.ycombinator.com/item?id=1',
              publishedAt: '2026-09-19T11:00:00Z',
              score: 900,
              alert: true,
            },
          ],
          ok: true,
        },
        { name: 'Anthropic news', data: [], ok: false, error: 'timeout' },
      ],
      ...overrides,
    },
    NOW,
  );
}

describe('components', async () => {
  const container = await AstroContainer.create();
  const d = dashboard();

  it('Dropcon shows the level, the headline, a provenance that adds up and the hottest lab', async () => {
    const html = await container.renderToString(Dropcon, { props: { d } });
    expect(html).toContain(`DROPCON LEVEL`);
    expect(html).toContain(`>${d.dropcon.level}<`);
    expect(html).toContain('LIVE');
    expect(html).not.toContain('ODDS OFFLINE');
    expect(d.dropcon.headline).toBe('Polymarket prices 66% that GPT-6 ships by Sep 24');
    expect(html).toContain(d.dropcon.headline);
    const pts = [...html.matchAll(/<span class="pts"[^>]*>(\d+)<\/span>/g)].map((m) => Number(m[1]));
    expect(pts).toEqual([...d.dropcon.provenance.map((r) => r.points), d.dropcon.score]);
    expect(pts.slice(0, -1).reduce((a, b) => a + b, 0)).toBe(d.dropcon.score);
    expect(html).toContain('href="https://polymarket.com/event/gpt-6"');
    expect(html).toContain('Context, not the level');
    expect(html).toContain(d.labs[0].name);
    // A frontier listing under 48 hours old raises the banner, which is never scored.
    expect(html).toContain('MODELS JUST LANDED');
    expect(html).toContain('shown, not scored');
  });

  it('Dropcon flags a floor when the odds are offline', async () => {
    const degraded = dashboard({ markets: { name: 'Polymarket', data: [], ok: false, error: 'down' } });
    const html = await container.renderToString(Dropcon, { props: { d: degraded } });
    expect(html).toContain('FLOOR · ODDS OFFLINE');
  });

  it('Dropcon shows a question mark and no lit segment with no signal at all', async () => {
    const dark = dashboard({
      markets: { name: 'Polymarket', data: [], ok: false, error: 'down' },
      drops: { name: 'OpenRouter', data: [], ok: false, error: 'down' },
    });
    const html = await container.renderToString(Dropcon, { props: { d: dark } });
    expect(html).toContain('>?<');
    expect(html).toContain('NO SIGNAL');
    expect(html).not.toMatch(/class="seg on/);
    expect(html).toContain('aria-label="DROPCON: no signal"');
  });

  it('Signals lists early warnings with their track record and landed launches, neither scored', async () => {
    const html = await container.renderToString(Signals, { props: { d } });
    expect(html).toContain('EARLY WARNINGS');
    expect(html).toContain('NOT SCORED');
    expect(html).toContain(d.earlyWarnings.stealth.track.summary);
    expect(html).toContain('10 of 13 resolved leaks');
    expect(html).toContain(d.earlyWarnings.broadcasts.track.summary);
    expect(html).toContain(d.earlyWarnings.architectures.track.summary);
    expect(html).toContain('LANDED');
    expect(html).toContain('Claude Fable 5.1');
    expect(html).toContain('HACKER NEWS LAUNCH STORIES');
  });

  it('Drops renders integer prices without stripping zeros and marks vision models', async () => {
    const html = await container.renderToString(Drops, { props: { d } });
    expect(html).toContain('$10 / $50');
    expect(html).toContain('Claude Fable 5.1');
    expect(html).toContain('VIS');
    expect(html).toContain('org/open-model');
    expect(html).toContain('Scaling Laws Revisited');
  });

  it('Markets renders release odds and the best-model race with lab colours', async () => {
    const html = await container.renderToString(Markets, { props: { d } });
    expect(html).toContain('GPT-6 released by...?');
    expect(html).toContain('66%');
    expect(html).toContain('$65k');
    expect(html).toContain('Google');
    expect(html).not.toMatch(/race-name[^>]*>Other</);
  });

  it('Feed escapes untrusted titles and lists failing sources', async () => {
    const html = await container.renderToString(Feed, { props: { d } });
    expect(html).toContain('Introducing &lt;GPT-6&gt; &amp; friends');
    expect(html).not.toContain('<GPT-6>');
    expect(html).toContain('Anthropic news');
    expect(html).toContain('timeout');
    expect(html).toContain('x.com/sama');
  });

  it('Labs renders every lab with its status tag, histogram and 72h/7d/30d reads', async () => {
    const html = await container.renderToString(Labs, { props: { d } });
    for (const lab of d.labs) expect(html).toContain(lab.name);
    expect(html).toContain('SHIPPING');
    expect((html.match(/class="col"/g) ?? []).length).toBe(d.labs.length * 12);
    expect(html).toContain('DROP ≤72H');
    expect(html).toContain('GPT-6 on Polymarket');
    expect(html).toContain('burstiness prior');
  });

  it('Labs marks an extrapolated read with a tilde and keeps it dim', async () => {
    const far: Market = {
      ...release,
      slug: 'flash',
      title: 'Next Gemini Flash released by...?',
      labId: 'google',
      outcomes: [{ ...release.outcomes[0], label: 'November 30', deadline: '2026-12-01T04:59:59.000Z' }],
    };
    const html = await container.renderToString(Labs, {
      props: { d: dashboard({ markets: { name: 'Polymarket', data: [far], ok: true } }) },
    });
    expect(html).toMatch(/metric-value glow-y extrap"[^>]*>~\d+%/);
    expect(html).toContain('extrapolated to Nov 30 · not scored');
  });

  it('Header reports status and exposes one accessible ticker with an explicit pause control', async () => {
    const html = await container.renderToString(Header, { props: { d } });
    expect(html).toContain('STATUS: DEGRADED');
    expect(html).toContain('NEW ON OPENROUTER: CLAUDE FABLE 5.1');
    expect(html).toContain('OPENAI: AT LEAST 66% ODDS GPT-6 SHIPS WITHIN 7 DAYS');
    expect(html).toContain('data-ticker-toggle');
    expect(html).toContain('PAUSE TICKER');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-controls="ticker-track"');
    expect(html).toContain('class="sr-only"');
    expect(html).toContain('aria-hidden="true"');
    expect(html.match(/class="ticker-group/g) ?? []).toHaveLength(2);
    expect(html).toContain('class="ticker-group ticker-copy"');
  });
});
