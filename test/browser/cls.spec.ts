import { expect, test } from '@playwright/test';

/**
 * The self-hosted VT323/Press Start 2P faces (src/styles/fonts.css) ship metric-matched local()
 * fallback faces specifically so a slow font fetch never reflows the page. Delaying /fonts/*
 * simulates that slow fetch; a real PerformanceObserver (not a synthetic estimate) measures the
 * layout-shift score the browser itself reports. With Google Fonts (display=swap, no fallback
 * faces) the same measurement gave CLS 0.7066 @1440x900 and 0.9541 @390x844.
 */
async function measureCls(page: import('@playwright/test').Page, delayMs: number) {
  await page.route('**/fonts/*.woff2', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.continue();
  });
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        hadRecentInput?: boolean;
        value?: number;
      })[]) {
        if (!entry.hadRecentInput) {
          (window as unknown as { __cls: number }).__cls += entry.value ?? 0;
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/', { waitUntil: 'networkidle', timeout: 45_000 });
  await page.waitForTimeout(1500);
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

for (const [label, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
] as const) {
  test(`keeps CLS under 0.1 at ${label} when the fonts load slowly`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const cls = await measureCls(page, 350);
    expect(cls).toBeLessThan(0.1);
  });
}

/**
 * The CLS runs above only notice a fallback mismatch where this page's layout happens to be
 * sensitive to it, so pin the metric match itself: each fallback face must resolve to a local font
 * on this platform and set a sample as wide and tall as the webfont it stands in for.
 * geometricPrecision turns off hinting, which on Linux snaps some of the unhinted Press Start 2P
 * advances from 20px to 21px; the check is of the @font-face metrics, not the rasteriser.
 */
test('fallback faces lay text out like the webfonts they stand in for', async ({ page }) => {
  await page.goto('/');
  const pairs = await page.evaluate(async () => {
    const sample = 'WHENMODEL dropcon 0123456789 · 87% odds — 7 days…';
    const box = async (family: string) => {
      const loaded = await document.fonts.load(`20px '${family}'`, sample);
      const el = document.createElement('span');
      el.style.cssText = `position:absolute;white-space:pre;text-rendering:geometricPrecision;font:20px/normal '${family}'`;
      el.textContent = sample;
      document.body.append(el);
      const { width, height } = el.getBoundingClientRect();
      el.remove();
      return { loaded: loaded.length, width, height };
    };
    return Promise.all(
      [
        ['VT323', 'VT323 Fallback'],
        ['Press Start 2P', 'Press Start 2P Fallback'],
      ].map(async ([font, fallback]) => ({ font, real: await box(font), fallback: await box(fallback) })),
    );
  });
  for (const { font, real, fallback } of pairs) {
    expect(real.loaded, `${font} webfont loads`).toBe(1);
    expect(fallback.loaded, `${font} fallback resolves a local() font`).toBe(1);
    expect(Math.abs(fallback.width / real.width - 1), `${font} width`).toBeLessThan(0.01);
    expect(Math.abs(fallback.height - real.height), `${font} line box`).toBeLessThanOrEqual(1);
  }
});
