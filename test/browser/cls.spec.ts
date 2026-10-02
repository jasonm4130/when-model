import { expect, test } from '@playwright/test';

/**
 * The self-hosted Inter Tight and Geist Mono faces (src/styles/fonts.css) ship metric-matched local()
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
 * on this platform and set a sample as wide and tall as the webfont it stands in for, in the weight,
 * width and case the page sets it in. Inter Tight is narrower than Arial by a different amount at each
 * weight, so its fallback is one face per weight band and each band is checked at the weight the page
 * uses. geometricPrecision turns off hinting; the check is of the @font-face metrics, not the rasteriser.
 */
test('fallback faces lay text out like the webfonts they stand in for', async ({ page }) => {
  await page.goto('/');
  const pairs = await page.evaluate(async () => {
    const box = async (family: string, style: string, sample: string) => {
      const loaded = await document.fonts.load(`${style} 20px '${family}'`, sample);
      const el = document.createElement('span');
      el.style.cssText = `position:absolute;white-space:pre;text-rendering:geometricPrecision;font:${style} 20px/normal '${family}'`;
      el.textContent = sample;
      document.body.append(el);
      const { width, height } = el.getBoundingClientRect();
      el.remove();
      return { loaded: loaded.length, width, height };
    };
    // Inter Tight's fallback is matched on mixed case: a title and a running sentence at each weight.
    // Arial's capitals run 2 to 6% wider than Inter Tight's, which no single scale can also match;
    // the CLS runs above measure what that costs the page.
    const TITLE = 'Claude Haiku · Anthropic line · Next Gemini Flash-Lite released';
    const SENTENCE = 'Markets put a named frontier release at roughly even odds within 7 days.';
    const cases: [string, string, string, string][] = [
      ['Inter Tight', 'Inter Tight Fallback', '400', TITLE],
      ['Inter Tight', 'Inter Tight Fallback', '400', SENTENCE],
      ['Inter Tight', 'Inter Tight Fallback', '500', TITLE],
      ['Inter Tight', 'Inter Tight Fallback', '500', SENTENCE],
      ['Inter Tight', 'Inter Tight Fallback', '600', TITLE],
      ['Inter Tight', 'Inter Tight Fallback', '600', SENTENCE],
      ['Inter Tight', 'Inter Tight Fallback', '700', TITLE],
      ['Inter Tight', 'Inter Tight Fallback', '700', SENTENCE],
      ['Inter Tight', 'Inter Tight Fallback', '800', TITLE],
      ['Inter Tight', 'Inter Tight Fallback', '800', SENTENCE],
      ['Geist Mono', 'Geist Mono Fallback', '400', '30 Sep – 2 Oct · 11:01Z · LIVE · POLYMARKET 0123456789'],
      ['Geist Mono', 'Geist Mono Fallback', '600', 'NOT A FORECAST · 46% · 42/100'],
    ];
    return Promise.all(
      cases.map(async ([font, fallback, style, sample]) => ({
        font: `${font} ${style} "${sample.slice(0, 12)}…"`,
        real: await box(font, style, sample),
        fallback: await box(fallback, style, sample),
      })),
    );
  });
  for (const { font, real, fallback } of pairs) {
    expect(real.loaded, `${font} webfont loads`).toBe(1);
    expect(fallback.loaded, `${font} fallback resolves a local() font`).toBe(1);
    expect(Math.abs(fallback.width / real.width - 1), `${font} width`).toBeLessThan(0.01);
    expect(Math.abs(fallback.height - real.height), `${font} line box`).toBeLessThanOrEqual(1);
  }
});
