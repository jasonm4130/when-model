import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Layout from '../src/layouts/Layout.astro';
import NotFound from '../src/pages/404.astro';
import { departureBoard, isDeparture } from '../src/ui/departures';

afterEach(() => vi.resetModules());

describe('GET /api/dashboard.json', () => {
  it('serves the memoised dashboard as CORS-open JSON', async () => {
    vi.doMock('../src/app/load-dashboard', () => ({
      loadDashboard: async () => ({ generatedAt: 'now', labs: [] }),
    }));
    const { GET } = await import('../src/pages/api/dashboard.json');
    const res = await (GET as unknown as () => Promise<Response>)();
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toContain('s-maxage=300');
    expect(await res.json()).toEqual({ generatedAt: 'now', labs: [] });
  });
});

describe('GET /sitemap.xml', () => {
  it('lists every page, and a page for each lab in the registry', async () => {
    const { GET } = await import('../src/pages/sitemap.xml');
    const res = (GET as unknown as () => Response)();
    expect(res.headers.get('content-type')).toBe('application/xml');
    const xml = await res.text();
    for (const path of ['/', '/labs', '/markets', '/radar', '/about', '/backtest'])
      expect(xml).toContain(`<loc>https://whenmodel.com${path}</loc>`);
    const { LABS } = await import('../src/domain/lab');
    for (const lab of LABS) expect(xml).toContain(`<loc>https://whenmodel.com/labs/${lab.id}</loc>`);
    expect(xml.match(/<url>/g)).toHaveLength(6 + LABS.length);
  });
});

describe('Layout head', () => {
  it('points OG and twitter tags at the evergreen, dimensioned card and self-hosts the fonts', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Layout, {
      props: { title: 'whenmodel', description: 'A test description.' },
      slots: { default: '<p>body</p>' },
    });
    expect(html).toContain('og:image" content="https://whenmodel.com/og-card-v2.png"');
    expect(html).toContain('og:image:width" content="1200"');
    expect(html).toContain('og:image:height" content="630"');
    expect(html).toContain('og:image:type" content="image/png"');
    expect(html).toContain('og:image:alt"');
    expect(html).toContain('og:site_name" content="whenmodel"');
    expect(html).toContain('twitter:card" content="summary_large_image"');
    expect(html).toContain('twitter:image" content="https://whenmodel.com/og-card-v2.png"');
    expect(html).toContain('twitter:image:alt"');
    // self-hosted, preloaded fonts, no Google Fonts left to strip from the CSP
    expect(html).toContain('href="/fonts/inter-tight.woff2"');
    expect(html).toContain('href="/fonts/geist-mono.woff2"');
    expect(html).toMatch(/rel="preload"[^>]*as="font"/);
    expect(html).toContain('crossorigin');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('fonts.gstatic.com');
    // icons
    expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"');
    expect(html).toContain('href="/favicon.ico"');
    expect(html).toContain('href="/favicon.svg"');
    // the static CRT sweep div is gone from the markup
    expect(html).not.toContain('crt-sweep');
    // no robots tag unless asked for one
    expect(html).not.toContain('name="robots"');
  });

  it('adds a noindex meta tag when the page asks for one', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Layout, {
      props: { title: 't', description: 'd', robots: 'noindex' },
      slots: { default: '<p>x</p>' },
    });
    expect(html).toContain('name="robots" content="noindex"');
  });
});

describe('the pages', () => {
  const NOW = Date.parse('2026-09-19T12:00:00Z');
  /** One reading an hour ago: enough for the home page to draw the week. */
  const reading = () => {
    const at = new Date(Date.now() - 3_600_000).toISOString();
    return {
      slot: at,
      observedAt: at,
      algorithmVersion: 3,
      score: 10,
      level: 5,
      displayLevel: 5,
      degraded: false,
    };
  };
  async function render(
    path: string,
    params?: Record<string, string>,
    historyBody: () => { ok: boolean; points: unknown[] } = () => ({ ok: true, points: [reading()] }),
  ) {
    const { assembleDashboard } = await import('../src/domain/dashboard');
    const { warnings } = await import('./fixtures/warnings');
    const d = {
      ...assembleDashboard(
        {
          markets: { name: 'Polymarket', data: [], ok: true },
          drops: { name: 'OpenRouter', data: [], ok: true },
          trending: { name: 'HF trending', data: [], ok: true },
          papers: { name: 'HF papers', data: [], ok: true },
          feeds: [{ name: 'Hacker News', data: [], ok: true }],
        },
        NOW,
      ),
      earlyWarnings: warnings(),
    };
    const history = vi.fn(async () => historyBody());
    vi.doMock('../src/app/load-dashboard', () => ({
      loadDashboard: async () => d,
      loadHistoryForPage: history,
    }));
    const pages: Record<string, () => Promise<{ default: unknown }>> = {
      '/': () => import('../src/pages/index.astro'),
      '/labs': () => import('../src/pages/labs/index.astro'),
      '/labs/[id]': () => import('../src/pages/labs/[id].astro'),
      '/markets': () => import('../src/pages/markets.astro'),
      '/radar': () => import('../src/pages/radar.astro'),
      '/about': () => import('../src/pages/about.astro'),
    };
    const Page = (await pages[params ? '/labs/[id]' : path]()).default;
    const container = await AstroContainer.create();
    const url = params ? `/labs/${params.id}` : path;
    const res = await container.renderToResponse(Page as never, {
      params,
      request: new Request(`https://whenmodel.com${url}`),
    });
    return { res, html: await res.text(), d, history };
  }

  it('gives each page one h1, its own title and a canonical of its own path', async () => {
    const titles = new Set<string>();
    for (const path of ['/', '/labs', '/markets', '/radar', '/about']) {
      const { res, html } = await render(path);
      expect(res.status).toBe(200);
      expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
      expect(html).toContain(`<link rel="canonical" href="https://whenmodel.com${path}">`);
      titles.add(html.match(/<title>([^<]*)<\/title>/)![1]);
      vi.resetModules();
    }
    expect(titles.size).toBe(5);
  });

  it('reads the history only on the page that draws the chart: /about, not the home page', async () => {
    const about = await render('/about');
    expect(about.history).toHaveBeenCalledTimes(1);
    expect(about.html).toContain('data-plot');
    expect(about.html).toContain('id="service-history"');
    for (const path of ['/', '/labs', '/markets', '/radar']) {
      vi.resetModules();
      const page = await render(path);
      expect(page.history).not.toHaveBeenCalled();
      expect(page.html).not.toContain('data-plot');
    }
  });

  it('says in one line, with no chart, that the history is offline or has no readings yet', async () => {
    const off = await render('/about', undefined, () => ({ ok: false, points: [] }));
    expect(off.html).not.toContain('data-plot');
    expect(off.html).not.toContain('Service history · last 7 days');
    expect(off.html).toMatch(/class="history-off"[^>]*>\s*Service history is offline; the level is live\./);
    vi.resetModules();
    const empty = await render('/about', undefined, () => ({ ok: true, points: [] }));
    expect(empty.html).not.toContain('data-plot');
    expect(empty.html).toContain('Service history has no readings this week yet; the level is live.');
    expect(empty.html).toContain('href="#score"');
  });

  it('has the home page answer: the service status, the next departure, the other lines and the way on', async () => {
    const { html, d } = await render('/');
    // This fixture has no market, so nothing departs and every line is untimed: no timetable.
    const board = departureBoard(d);
    expect(isDeparture(board.next)).toBe(false);
    expect(html).toMatch(/<h2 id="status-title"[^>]*>/);
    expect(html).toMatch(/<h1 id="next-title"[^>]*data-flap[^>]*>No departures scheduled<\/h1>/);
    expect(board.untimed.length).toBe(d.labs.length);
    for (const l of board.untimed) expect(html).toContain(`href="/labs/${l.id}"`);
    expect(html).toContain('no timetable. Nobody is betting on these lines.');
    // One bold moment: the level's week is drawn on /about, not here.
    expect(html).not.toContain('Service history · last 7 days');
    for (const href of ['/labs', '/markets', '/radar', '/about#score'])
      expect(html).toContain(`href="${href}"`);
    // The rest of the old single page is gone from it.
    for (const gone of ['id="feed"', 'id="faq"', 'id="health"', 'class="network"'])
      expect(html).not.toContain(gone);
  });

  it("renders a lab's page with its question, its warnings and the tab it sits under", async () => {
    const { res, html } = await render('/labs/openai', { id: 'openai' });
    expect(res.status).toBe(200);
    expect(html).toMatch(/<h1[^>]*>When will OpenAI ship\?<\/h1>/);
    expect(html).toContain('<title>When will OpenAI ship? — whenmodel</title>');
    expect(html).toContain('<link rel="canonical" href="https://whenmodel.com/labs/openai">');
    expect(html).toMatch(/href="\/labs" aria-current="true"/);
    expect(html).toContain('GPT-6.1 spotted in the API');
    expect(html).toContain('x.com/sama');
  });
});

describe('GET /404', () => {
  it('marks the not-found page noindex', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(NotFound, {});
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain('404');
    expect(html).toMatch(/<h1[^>]*>Line not found<\/h1>/);
  });
});
