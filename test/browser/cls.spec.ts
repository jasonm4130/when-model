import { expect, test } from '@playwright/test';

/**
 * The self-hosted VT323/Press Start 2P faces (src/styles/fonts.css) ship metric-matched local()
 * fallback faces specifically so a slow font fetch never reflows the page. Delaying /fonts/*
 * simulates that slow fetch; a real PerformanceObserver (not a synthetic estimate) measures the
 * layout-shift score the browser itself reports. Before this fix, the same instrument measured
 * CLS 0.7066 @1440x900 and 0.9541 @390x844 against the Google Fonts version of this page
 * (scratchpad/fontwork/cls-measure.mjs, MODE=google, run against an unmodified checkout).
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
