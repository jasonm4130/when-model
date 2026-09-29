import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Header from '../../src/components/Header.astro';
import Labs from '../../src/components/Labs.astro';
import { assembleDashboard, type DashboardInputs } from '../../src/domain/dashboard';
import type { Drop } from '../../src/domain/drop';
import type { Market } from '../../src/domain/market';
import { pageFingerprint } from '../../src/ui/fingerprint';
import type { PageView } from '../../src/ui/site';

const NOW = Date.parse('2026-09-19T12:00:00Z');
const HOME: PageView = { page: 'home' };

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

  it('carries no ticker, even with a new listing to announce: the hero and the lab list say it once', async () => {
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
    for (const d of [dashboard(), dashboard({ drops: { name: 'OpenRouter', data: [drop], ok: true } })]) {
      const html = await container.renderToString(Header, { props: { d, view: HOME } });
      expect(html).not.toContain('ticker');
      expect(html).not.toContain('NEW ON OPENROUTER');
      // "model" prints twice, once as a pink plate out of register; the plate's copy is an attribute, read once.
      expect(html).toMatch(
        /<h1 class="wordmark"[^>]*>when<span class="m plate" data-plate="model"[^>]*>model<\/span>/,
      );
    }
  });

  it('exposes a PAUSE AUTO-REFRESH toggle and an empty, live reload status region (UI-11)', async () => {
    const html = await container.renderToString(Header, { props: { d: dashboard(), view: HOME } });
    expect(html).toContain('data-refresh-toggle');
    // Phones show only the verb; the noun stays in the accessible name, so it reads the same everywhere.
    const toggle = html.match(/<button[^>]*data-refresh-toggle[^>]*>(.*?)<\/button>/)?.[1] ?? '';
    expect(toggle.replace(/<[^>]+>/g, '')).toBe('PAUSE AUTO-REFRESH');
    expect(toggle).toMatch(/data-refresh-verb[^>]*>PAUSE</);
    expect(toggle).toMatch(/class="rt-noun"[^>]*> AUTO-REFRESH</);
    expect(html).toMatch(/data-refresh-toggle[^>]*aria-pressed="false"/);
    expect(html).toContain('<span class="refresh-status" aria-live="polite" data-reload-status');
    expect(html).toMatch(/<span class="refresh-status"[^>]*><\/span>/);
    expect(html).not.toContain('NEW DATA');
  });

  it('stamps the fingerprint of the data it rendered, as the browser will compute it from the API (UI-11)', async () => {
    const d = dashboard();
    const views: PageView[] = [HOME, { page: 'labs' }, { page: 'radar' }, { page: 'lab', lab: 'anthropic' }];
    for (const view of views) {
      const html = await container.renderToString(Header, { props: { d, view } });
      const stamped = html.match(/data-fingerprint="([0-9a-f]{8})"/)?.[1];
      expect(stamped).toBe(pageFingerprint(JSON.parse(JSON.stringify(d)) as object, view));
      // The browser reads which page it is on from the same element, so its poll hashes the same slice.
      const stampedView = html.match(/data-view="([^"]*)"/)?.[1] ?? '';
      expect(JSON.parse(stampedView.replace(/&quot;/g, '"').replace(/&#34;/g, '"'))).toEqual(view);
    }
  });

  it('names the site in an h1 only on the home page, and links home from every other page', async () => {
    const home = await container.renderToString(Header, { props: { d: dashboard(), view: HOME } });
    expect(home).toMatch(/<h1 class="wordmark"/);
    const labs = await container.renderToString(Header, {
      props: { d: dashboard(), view: { page: 'labs' } },
    });
    expect(labs).not.toContain('<h1');
    expect(labs).toMatch(/<a class="wordmark"[^>]*href="\/"/);
    expect(labs).toMatch(/<a class="tab on" href="\/labs" aria-current="page"/);
    // A lab's page sits in the Labs section: marked current, but not as the page itself.
    const lab = await container.renderToString(Header, {
      props: { d: dashboard(), view: { page: 'lab', lab: 'anthropic' } },
    });
    expect(lab).toMatch(/<a class="tab on" href="\/labs" aria-current="true"/);
  });

  it('draws no status bar or refresh poll on a page with no dashboard (backtest, 404)', async () => {
    for (const view of [{ page: 'backtest' }, { page: 'not-found' }] as const) {
      const html = await container.renderToString(Header, { props: { view } });
      expect(html).not.toContain('data-fingerprint');
      expect(html).not.toContain('STATUS:');
      expect(html).toContain('aria-label="Site"');
    }
    const backtest = await container.renderToString(Header, { props: { view: { page: 'backtest' } } });
    expect(backtest).toMatch(/href="\/backtest" aria-current="page"/);
    const missing = await container.renderToString(Header, { props: { view: { page: 'not-found' } } });
    expect(missing).not.toContain('aria-current');
  });

  it('gives the statusbar the mobile-only hooks that hide everything but STATUS and the clock (UI-06)', async () => {
    const html = await container.renderToString(Header, { props: { d: dashboard(), view: HOME } });
    expect(html).toContain('class="tiny muted counts"');
    expect(html).toContain('class="tiny muted sync"');
    // The clock already ends in Z, so a separate UTC label only costs width.
    expect(html).toMatch(/data-clock[^>]*>\d{2}:\d{2}:\d{2}Z</);
    expect(html).not.toMatch(/>UTC</);
  });

  it('reports a degraded source in the status', async () => {
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
      props: {
        d: dashboard({ markets: { name: 'Polymarket', data: [release], ok: false, error: 'down' } }),
        view: HOME,
      },
    });
    expect(html).toContain('STATUS: DEGRADED');
    expect(html).toMatch(/status-live warn/);
    // Past its last rung the read is held there, a floor, and the lab list says so where the ticker used to.
    const labs = await container.renderToString(Labs, {
      props: { d: dashboard({ markets: { name: 'Polymarket', data: [release], ok: false, error: 'down' } }) },
    });
    expect(labs).toMatch(/class="bracket"[^>]*>at least, held Sep 24</);
  });

  it('counts a YouTube outage but keeps the status OPERATIONAL, since the feeds are best-effort', async () => {
    const youtubeDown = { name: 'YouTube broadcasts', data: [], ok: false, error: '404' };
    const html = await container.renderToString(Header, {
      props: { d: dashboard({ broadcasts: youtubeDown }), view: HOME },
    });
    expect(html).toContain('STATUS: OPERATIONAL');
    expect(html).toMatch(/5\/6(?:<!--[^>]*-->)?\s*SOURCES/);
    const bothDown = dashboard({
      broadcasts: youtubeDown,
      drops: { name: 'OpenRouter', data: [], ok: false, error: 'down' },
    });
    expect(await container.renderToString(Header, { props: { d: bothDown, view: HOME } })).toContain(
      'STATUS: DEGRADED',
    );
  });

  it('has the lab list name a read between near rungs plainly and a bucket-capped read as a ceiling', async () => {
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
    const plain = await container.renderToString(Labs, {
      props: { d: dashboard({ markets: { name: 'Polymarket', data: [ladder], ok: true } }) },
    });
    expect(plain).toMatch(/class="bracket"[^>]*>Sep 24 → Oct 1</);
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
    const capped = await container.renderToString(Labs, {
      props: { d: dashboard({ markets: { name: 'Polymarket', data: [ladder, buckets], ok: true } }) },
    });
    expect(capped).toContain('at most: bucket asks');
    expect(capped).toMatch(/lab-odds[\s\S]*?16%/);
  });
});
