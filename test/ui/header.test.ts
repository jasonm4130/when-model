import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Header from '../../src/components/Header.astro';
import { assembleDashboard, type DashboardInputs } from '../../src/domain/dashboard';
import type { Drop } from '../../src/domain/drop';
import type { Market } from '../../src/domain/market';
import { dashboardFingerprint } from '../../src/ui/fingerprint';

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

  it('stamps the fingerprint of the data it rendered, as the browser will compute it from the API (UI-11)', async () => {
    const d = dashboard();
    const html = await container.renderToString(Header, { props: { d } });
    const stamped = html.match(/data-fingerprint="([0-9a-f]{8})"/)?.[1];
    expect(stamped).toBe(dashboardFingerprint(JSON.parse(JSON.stringify(d)) as object));
  });

  it('gives the statusbar the mobile-only hooks that hide everything but STATUS and the clock (UI-06)', async () => {
    const html = await container.renderToString(Header, { props: { d: dashboard() } });
    expect(html).toContain('class="tiny muted counts"');
    expect(html).toContain('class="tiny muted sync"');
    // The clock already ends in Z, so a separate UTC label only costs width.
    expect(html).toMatch(/data-clock[^>]*>\d{2}:\d{2}:\d{2}Z</);
    expect(html).not.toMatch(/>UTC</);
  });

  it('reports a degraded source in the status and keeps a ticker that has items', async () => {
    const release: Market = {
      slug: 'gpt-6',
      title: 'GPT-6 released by...?',
      url: 'https://polymarket.com/event/gpt-6',
      vol24: 1,
      volume: 1,
      kind: 'release',
      labId: 'openai',
      outcomes: [
        {
          label: 'September 24',
          yes: 0.5,
          endDate: '2026-09-25T00:00:00Z',
          closed: false,
          vol24: 1,
          deadline: '2026-09-25T03:59:59.000Z',
          deadlineKind: 'by',
          bestBid: 0.495,
          bestAsk: 0.505,
          thin: false,
          liquidity: 1000,
        },
      ],
    };
    const html = await container.renderToString(Header, {
      props: { d: dashboard({ markets: { name: 'Polymarket', data: [release], ok: false, error: 'down' } }) },
    });
    expect(html).toContain('STATUS: DEGRADED');
    // The release market's odds are a ticker item, so the ticker renders even with a source down.
    // Past its last rung the read is held there, a floor, and the ticker says so.
    expect(html).toContain('OPENAI: AT LEAST 50% ODDS GPT-6 SHIPS WITHIN 7 DAYS');
  });

  it('names a read between near rungs plainly and a bucket-capped read as a ceiling', async () => {
    const rung = (label: string, deadline: string, mid: number) => ({
      label,
      yes: mid,
      closed: false,
      vol24: 1,
      deadline,
      deadlineKind: 'by' as const,
      bestBid: mid - 0.005,
      bestAsk: mid + 0.005,
      thin: false,
      liquidity: 1000,
    });
    const ladder: Market = {
      slug: 'gpt-6',
      title: 'GPT-6 released by...?',
      url: 'https://polymarket.com/event/gpt-6',
      vol24: 1,
      volume: 1,
      kind: 'release',
      labId: 'openai',
      outcomes: [
        rung('September 24', '2026-09-25T03:59:59.000Z', 0.5),
        rung('October 1', '2026-10-02T03:59:59.000Z', 0.9),
      ],
    };
    const plain = await container.renderToString(Header, {
      props: { d: dashboard({ markets: { name: 'Polymarket', data: [ladder], ok: true } }) },
    });
    expect(plain).toMatch(/OPENAI: \d+% ODDS GPT-6 SHIPS WITHIN 7 DAYS/);
    const day = (d: number, ask: number) => ({
      label: `September ${d}`,
      yes: ask / 2,
      closed: false,
      vol24: 1,
      deadline: `2026-09-${d + 1}T03:59:59.000Z`,
      deadlineKind: 'day' as const,
      windowStart: `2026-09-${d}T04:00:00.000Z`,
      bestBid: 0.001,
      bestAsk: ask,
    });
    const buckets: Market = {
      ...ladder,
      slug: 'gpt-6-on',
      title: 'GPT-6 released on...?',
      outcomes: [19, 20, 21, 22, 23, 24, 25, 26].map((d) => day(d, 0.02)),
    };
    const capped = await container.renderToString(Header, {
      props: { d: dashboard({ markets: { name: 'Polymarket', data: [ladder, buckets], ok: true } }) },
    });
    expect(capped).toContain('OPENAI: AT MOST 16% ODDS GPT-6 SHIPS WITHIN 7 DAYS');
  });
});
