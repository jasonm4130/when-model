import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Layout from '../src/layouts/Layout.astro';
import NotFound from '../src/pages/404.astro';

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
  it('lists the dashboard', async () => {
    const { GET } = await import('../src/pages/sitemap.xml');
    const res = (GET as unknown as () => Response)();
    expect(res.headers.get('content-type')).toBe('application/xml');
    expect(await res.text()).toContain('<loc>https://whenmodel.com/</loc>');
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
    expect(html).toContain('href="/fonts/vt323.woff2"');
    expect(html).toContain('href="/fonts/press-start-2p.woff2"');
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

describe('GET /404', () => {
  it('marks the not-found page noindex', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(NotFound, {});
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain('404');
  });
});
