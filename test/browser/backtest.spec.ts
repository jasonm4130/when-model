import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const REPLAY_CHART = /^Hourly replay from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/;

async function openBacktest(page: Page) {
  const response = await page.goto('/backtest', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'BACKTEST' })).toBeVisible();
}

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe('/backtest', () => {
  test('opens on the question, the verdict and every section heading', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBacktest(page);

    // First screen: the question, the method and the verdict, above the fold.
    for (const locator of [
      page.getByText('Can public signals see a frontier model launch coming?'),
      page.locator('.bt-method'),
      page.locator('.bt-verdict'),
    ]) {
      await expect(locator).toBeInViewport();
    }
    await expect(page.locator('.bt-verdict')).toContainText('not a probability');

    for (const name of [
      'HOW V3 WOULD HAVE READ',
      'RESULTS: FORECAST VS BASE RATE',
      'LEAD TIMES',
      'STEALTH REVEALS',
      "TESTED AND DIDN'T LEAD",
      'REPRODUCE IT',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name })).toHaveCount(1);
    }
    expect(await noSidewaysScroll(page)).toBe(true);
  });

  test('names the replay chart for assistive tech, with one layout per width and a table twin', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openBacktest(page);
    const chart = page.getByRole('img', { name: REPLAY_CHART });
    // The narrow layout is display:none on desktop, so only one chart is exposed.
    await expect(chart).toHaveCount(1);
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAttribute('aria-label', /held-out launches had their own lab's market/);
    await expect(page.locator('figure.replay svg.chart.wide')).toBeVisible();
    await expect(page.locator('figure.replay svg.chart.narrow')).toBeHidden();

    // The weekly table opens from the keyboard, with a visible focus ring.
    const summary = page.locator('.weeks summary');
    await summary.focus();
    const outline = await summary.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(page.locator('.weeks table')).toBeVisible();
    await expect(page.locator('.weeks tbody tr').first()).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('figure.replay svg.chart.narrow')).toBeVisible();
    await expect(page.locator('figure.replay svg.chart.wide')).toBeHidden();
    await expect(page.getByRole('img', { name: REPLAY_CHART })).toHaveCount(1);
  });

  test('has no horizontal page scroll at 390px, with tables scrolling inside their panels', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBacktest(page);
    expect(await noSidewaysScroll(page)).toBe(true);
    // Open every table twin: expanded content must not widen the page either.
    for (const summary of await page.locator('details > summary').all()) await summary.click();
    expect(await noSidewaysScroll(page)).toBe(true);
    // The verdict and the replay chart fit the phone width.
    for (const selector of ['.bt-verdict', 'figure.replay svg.chart.narrow', '#results .panel']) {
      const box = await page.locator(selector).first().boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }
  });

  test('keeps keyboard focus visible and unclipped inside scrolling tables', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBacktest(page);
    const link = page.locator('#stealth table a').first();
    await link.focus();
    const clipped = await link.evaluate((el) => {
      const style = getComputedStyle(el);
      const ring = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      const r = el.getBoundingClientRect();
      let box: DOMRect | null = null;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p);
        if (o.overflowX !== 'visible' || o.overflowY !== 'visible') {
          box = p.getBoundingClientRect();
          break;
        }
      }
      if (style.outlineStyle === 'none' || !(ring > 0)) return 'no outline';
      if (!box) return false;
      return r.left - ring < box.left - 0.5 ||
        r.right + ring > box.right + 0.5 ||
        r.top - ring < box.top - 0.5 ||
        r.bottom + ring > box.bottom + 0.5
        ? 'clipped'
        : false;
    });
    expect(clipped).toBe(false);
  });

  test('renders with reduced motion: nothing animates and the page still fits', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await openBacktest(page);
    const moving = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => a.playState === 'running' && Number(a.effect?.getComputedTiming().duration ?? 0) > 1)
          .length,
    );
    expect(moving).toBe(0);
    await expect(page.getByRole('img', { name: REPLAY_CHART })).toBeVisible();
    await expect(page.locator('.bt-verdict')).toBeInViewport();
    expect(await noSidewaysScroll(page)).toBe(true);
  });
});
