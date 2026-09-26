import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Header from '../../src/components/Header.astro';
import { assembleDashboard, type DashboardInputs } from '../../src/domain/dashboard';
import type { Drop } from '../../src/domain/drop';
import type { Market } from '../../src/domain/market';

const NOW = Date.parse('2026-09-19T12:00:00Z');

const emptyInputs: DashboardInputs = {
  markets: { name: 'Polymarket', data: [], ok: true },
  drops: { name: 'OpenRouter', data: [], ok: true },
  trending: { name: 'HF trending', data: [], ok: true },
  papers: { name: 'HF papers', data: [], ok: true },
  feeds: [{ name: 'Hacker News', data: [], ok: true }],
};

function dashboard(overrides: Partial<DashboardInputs> = {}) {
  return assembleDashboard({ ...emptyInputs, ...overrides }, NOW);
}

describe('Header', async () => {
  const container = await AstroContainer.create();

  it('hides the ticker entirely when there is nothing to show (UI-04)', async () => {
    const html = await container.renderToString(Header, { props: { d: dashboard() } });
    expect(html).not.toContain('ticker-wrap');
    expect(html).not.toContain('data-ticker-toggle');
    expect(html).not.toContain('id="ticker-track"');
  });

  it('renders the ticker when there is at least one item', async () => {
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
    const html = await container.renderToString(Header, {
      props: { d: dashboard({ drops: { name: 'OpenRouter', data: [drop], ok: true } }) },
    });
    expect(html).toContain('class="ticker-wrap"');
    expect(html).toContain('NEW ON OPENROUTER: CLAUDE FABLE 5.1');
  });

  it('exposes a PAUSE AUTO-REFRESH toggle and an empty, live reload status region (UI-11)', async () => {
    const html = await container.renderToString(Header, { props: { d: dashboard() } });
    expect(html).toContain('data-refresh-toggle');
    expect(html).toContain('PAUSE AUTO-REFRESH');
    expect(html).toMatch(/data-refresh-toggle[^>]*aria-pressed="false"/);
    expect(html).toContain('<span class="refresh-status" aria-live="polite" data-reload-status');
    expect(html).toMatch(/<span class="refresh-status"[^>]*><\/span>/);
    expect(html).not.toContain('NEW DATA');
  });

  it('gives the statusbar the mobile-only hooks that hide everything but STATUS and the clock (UI-06)', async () => {
    const html = await container.renderToString(Header, { props: { d: dashboard() } });
    expect(html).toContain('class="tiny muted counts"');
    expect(html).toContain('class="tiny muted sync"');
    expect(html).toContain('class="tiny muted utc-label"');
  });

  it('still reports live status, labs and sources with an empty ticker', async () => {
    const release: Market = {
      slug: 'gpt-6',
      title: 'GPT-6 released by...?',
      url: 'https://polymarket.com/event/gpt-6',
      vol24: 1,
      volume: 1,
      kind: 'release',
      labId: 'openai',
      outcomes: [
        { label: 'September 24', yes: 0.5, endDate: '2026-09-25T00:00:00Z', closed: false, vol24: 1 },
      ],
    };
    const html = await container.renderToString(Header, {
      props: { d: dashboard({ markets: { name: 'Polymarket', data: [release], ok: false, error: 'down' } }) },
    });
    expect(html).toContain('STATUS: DEGRADED');
  });
});
