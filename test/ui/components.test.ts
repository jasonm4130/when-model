import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Dropcon from '../../src/components/Dropcon.astro';
import Drops from '../../src/components/Drops.astro';
import Feed from '../../src/components/Feed.astro';
import Header from '../../src/components/Header.astro';
import Labs from '../../src/components/Labs.astro';
import Markets from '../../src/components/Markets.astro';
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
    { label: 'September 24', yes: 0.66, endDate: '2026-09-25T00:00:00Z', closed: false, vol24: 100 },
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

  it('Dropcon shows the level, LIVE pill and the hottest lab', async () => {
    const html = await container.renderToString(Dropcon, { props: { d } });
    expect(html).toContain(`DROPCON LEVEL`);
    expect(html).toContain(`>${d.dropcon.level}<`);
    expect(html).toContain('LIVE');
    expect(html).not.toContain('ODDS OFFLINE');
    expect(html).toContain(d.labs[0].name);
  });

  it('Dropcon flags degraded odds', async () => {
    const degraded = dashboard({ markets: { name: 'Polymarket', data: [], ok: false, error: 'down' } });
    const html = await container.renderToString(Dropcon, { props: { d: degraded } });
    expect(html).toContain('ODDS OFFLINE');
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

  it('Labs renders every lab with its status tag and histogram', async () => {
    const html = await container.renderToString(Labs, { props: { d } });
    for (const lab of d.labs) expect(html).toContain(lab.name);
    expect(html).toContain('SHIPPING');
    expect((html.match(/class="col"/g) ?? []).length).toBe(d.labs.length * 12);
  });

  it('Header reports status and exposes one accessible ticker with an explicit pause control', async () => {
    const html = await container.renderToString(Header, { props: { d } });
    expect(html).toContain('STATUS: DEGRADED');
    expect(html).toContain('NEW ON OPENROUTER: CLAUDE FABLE 5.1');
    expect(html).toContain('OPENAI: 66% ODDS OF A DROP BY SEPTEMBER 24');
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
