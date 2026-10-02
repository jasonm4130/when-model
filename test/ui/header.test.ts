import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Header from '../../src/components/Header.astro';
import Footer from '../../src/components/Footer.astro';
import LabDetail from '../../src/components/LabDetail.astro';
import { labPage } from '../../src/ui/lab-page';
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
      // The wordmark is one word, a link home; every page's h1 is on its own sign, never here.
      expect(html).toMatch(/<a class="wordmark"[^>]*href="\/"[^>]*>whenmodel</);
      expect(html).not.toContain('<h1');
    }
  });

  it('keeps the clock in the header and puts the PAUSE AUTO-REFRESH toggle in the footer (UI-11)', async () => {
    const d = dashboard();
    const html = await container.renderToString(Header, { props: { d, view: HOME } });
    // The header carries the clock, an empty live region for NEW DATA, and no control.
    expect(html).toContain('data-clock');
    expect(html).not.toContain('data-refresh-toggle');
    expect(html).toContain('<span class="refresh-status" aria-live="polite" data-reload-status');
    expect(html).toMatch(/<span class="refresh-status"[^>]*><\/span>/);
    expect(html).not.toContain('NEW DATA');
    // The toggle sits on the footer's "Updated · next check" line, the refresh it pauses.
    const foot = await container.renderToString(Footer, { props: { d, generatedAt: d.generatedAt } });
    const toggle = foot.match(/<button[^>]*data-refresh-toggle[^>]*>(.*?)<\/button>/)?.[1] ?? '';
    expect(toggle.replace(/<[^>]+>/g, '')).toBe('PAUSE AUTO-REFRESH');
    expect(toggle).toMatch(/data-refresh-verb[^>]*>PAUSE</);
    expect(foot).toMatch(/data-refresh-toggle[^>]*aria-pressed="false"/);
    // A page with no dashboard (/backtest, the 404) has nothing to refresh, so no toggle.
    const bare = await container.renderToString(Footer, { props: { generatedAt: d.generatedAt } });
    expect(bare).not.toContain('data-refresh-toggle');
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

  it("never takes the h1 (each page's sign holds it), and links home from every page", async () => {
    const home = await container.renderToString(Header, { props: { d: dashboard(), view: HOME } });
    expect(home).not.toContain('<h1');
    expect(home).toMatch(/<a class="tab on" href="\/" aria-current="page"[^>]*>Departures</);
    const labs = await container.renderToString(Header, {
      props: { d: dashboard(), view: { page: 'labs' } },
    });
    expect(labs).not.toContain('<h1');
    expect(labs).toMatch(/<a class="wordmark"[^>]*href="\/"/);
    expect(labs).toMatch(/<a class="tab on" href="\/labs" aria-current="page"/);
    // A line's page sits in the Lines section: marked current, but not as the page itself.
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

  it('keeps the header to the clock, and moves the counts and the refresh countdown to the footer (UI-06)', async () => {
    const d = dashboard();
    const html = await container.renderToString(Header, { props: { d, view: HOME } });
    expect(html).not.toContain('counts');
    expect(html).not.toContain('data-refresh=');
    // The clock already ends in Z, so a separate UTC label only costs width; the day hides on narrow screens.
    expect(html).toMatch(/data-clock[^>]*>\d{2}:\d{2}Z</);
    expect(html).toMatch(/class="day"[^>]*>Sat 19 Sep · </);
    expect(html).not.toMatch(/>UTC</);
    const foot = await container.renderToString(Footer, { props: { d, generatedAt: d.generatedAt } });
    expect(foot).toMatch(/class="foot-meta mono counts"[^>]*>\d+ lines · \d+\/\d+ sources · \d+ markets</);
    expect(foot).toMatch(/data-synced="2026-09-19T12:00:00/);
    expect(foot).toMatch(/data-refresh="300"[^>]*>5:00</);
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
    expect(html).toMatch(/status-live warn[^>]*>(?:<span[^>]*>Sources <\/span>)?DEGRADED</);
    // Past its last rung the read is held there, a floor, and the line's page says so under its odds.
    const held = dashboard({ markets: { name: 'Polymarket', data: [release], ok: false, error: 'down' } });
    const page = await container.renderToString(LabDetail, {
      props: { d: held, p: labPage(held, 'openai')! },
    });
    expect(page).toContain('At least: held at its 24 Sep stop.');
  });

  it('counts a YouTube outage but keeps the status OPERATIONAL, since the feeds are best-effort', async () => {
    const youtubeDown = { name: 'YouTube broadcasts', data: [], ok: false, error: '404' };
    const html = await container.renderToString(Header, {
      props: { d: dashboard({ broadcasts: youtubeDown }), view: HOME },
    });
    // All is well with the core sources, so the header says nothing about them.
    expect(html).not.toContain('status-live');
    const d = dashboard({ broadcasts: youtubeDown });
    const foot = await container.renderToString(Footer, { props: { d, generatedAt: d.generatedAt } });
    expect(foot).toMatch(/5\/6(?:<!--[^>]*-->)?\s*sources/);
    const bothDown = dashboard({
      broadcasts: youtubeDown,
      drops: { name: 'OpenRouter', data: [], ok: false, error: 'down' },
    });
    expect(await container.renderToString(Header, { props: { d: bothDown, view: HOME } })).toMatch(
      /status-live warn[^>]*>(?:<span[^>]*>Sources <\/span>)?DEGRADED</,
    );
  });

  it("has a line's page name a read between near rungs plainly and a bucket-capped read as a ceiling", async () => {
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
    const one = dashboard({ markets: { name: 'Polymarket', data: [ladder], ok: true } });
    const plain = await container.renderToString(LabDetail, {
      props: { d: one, p: labPage(one, 'openai')! },
    });
    expect(plain.replace(/&#39;/g, "'")).toContain(
      "Read off the market's curve between its 24 Sep and 1 Oct stops.",
    );
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
    const two = dashboard({ markets: { name: 'Polymarket', data: [ladder, buckets], ok: true } });
    const capped = await container.renderToString(LabDetail, {
      props: { d: two, p: labPage(two, 'openai')! },
    });
    expect(capped.replace(/&#39;/g, "'")).toContain("At most: capped by the day buckets' asks.");
    expect(capped).toMatch(/class="big"[^>]*>(?:<span[^>]*>)?16<small/);
  });
});
