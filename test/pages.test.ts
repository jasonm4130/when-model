import { afterEach, describe, expect, it, vi } from 'vitest';

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
