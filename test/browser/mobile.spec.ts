import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function openDashboard(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'DROPCON LEVEL' })).toBeVisible();
}

/** Minimal, valid dashboard.json body; `body` differs only in a field the fingerprint doesn't ignore. */
function dashboardJson(marker: string) {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    measurement: { schema: 3, algorithmVersion: 2, inputs: {} },
    dropcon: { level: 3, name: marker, blurb: '', drivers: [] },
    labs: [],
    markets: [],
    drops: [],
    trending: [],
    papers: [],
    feed: [],
    sources: [],
  });
}

test.describe('mobile header (UI-05, UI-06)', () => {
  test('keeps DROPCON above the fold at 390x844 with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page);

    const num = page.locator('.dc-num');
    await expect(num).toBeVisible();
    const box = await num.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  });

  test('reduces the statusbar to STATUS and the clock, and hides the tag-line and brands, at 480px and below', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page);

    await expect(page.locator('.status-live')).toBeVisible();
    await expect(page.locator('.clock')).toBeVisible();
    await expect(page.locator('.counts')).toBeHidden();
    await expect(page.locator('.sync')).toBeHidden();
    await expect(page.locator('.utc-label')).toBeHidden();
    await expect(page.locator('.refresh-toggle')).toBeHidden();
    await expect(page.locator('.tag-line')).toBeHidden();
    await expect(page.locator('.brands')).toBeHidden();
  });

  test('keeps the full statusbar and brands above the 480px breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await openDashboard(page);

    await expect(page.locator('.counts')).toBeVisible();
    await expect(page.locator('.sync')).toBeVisible();
    await expect(page.locator('.tag-line')).toBeVisible();
    await expect(page.locator('.brands')).toBeVisible();
  });
});

/**
 * `location.reload` is a non-configurable own property in Chromium, so it can't be stubbed;
 * a real reload is instead observed as an extra `load` event on the same page.
 */
function countLoads(page: Page): () => number {
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });
  return () => loads;
}

async function mockDashboardJson(page: Page): Promise<() => void> {
  let calls = 0;
  await page.route('**/api/dashboard.json', async (route) => {
    calls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: dashboardJson(calls === 1 ? 'baseline' : 'changed'),
    });
  });
  return () => calls;
}

test.describe('polling refresh (UI-11)', () => {
  test('shows an aria-live NEW DATA pill once the polled fingerprint changes, and reloads on click', async ({
    page,
  }) => {
    const callCount = await mockDashboardJson(page);
    const loadCount = countLoads(page);
    await page.clock.install({ time: Date.now() });
    await page.setViewportSize({ width: 1280, height: 900 });
    await openDashboard(page);
    await page.waitForLoadState('load');
    expect(callCount()).toBe(1); // the baseline fetch fires once, right away
    expect(loadCount()).toBe(1);

    const status = page.locator('[data-reload-status]');
    await expect(status).toBeEmpty();

    await page.clock.fastForward(5 * 60_000); // the countdown reaches 0 and polls again, this time with new data

    const pill = page.locator('[data-reload-status] .pill');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText('NEW DATA · RELOAD');
    await expect(status).toHaveAttribute('aria-live', 'polite');

    await pill.click();
    await expect.poll(loadCount).toBe(2); // the manual click reloads immediately, idle or not
  });

  test('auto-reloads only once idle, and a PAUSE AUTO-REFRESH toggle blocks it', async ({ page }) => {
    await mockDashboardJson(page);
    const loadCount = countLoads(page);
    await page.clock.install({ time: Date.now() });
    await page.setViewportSize({ width: 1280, height: 900 });
    await openDashboard(page);

    const toggle = page.locator('[data-refresh-toggle]');
    await toggle.click(); // PAUSE AUTO-REFRESH
    await toggle.blur(); // clicking a button focuses it; blur so only the pause (not lingering focus) is under test
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await page.clock.fastForward(5 * 60_000); // new data arrives
    await expect(page.locator('[data-reload-status] .pill')).toBeVisible();

    await page.clock.fastForward(65_000); // well past the 60s idle threshold
    await page.waitForTimeout(500);
    expect(loadCount()).toBe(1); // paused: the pill is up, but it never reloads on its own

    await toggle.click(); // RESUME AUTO-REFRESH
    await toggle.blur();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await page.clock.fastForward(65_000);
    await expect.poll(loadCount).toBe(2); // idle again with nothing paused: it reloads on its own
  });

  test('does not auto-reload while a details panel is open or a control has focus', async ({ page }) => {
    await mockDashboardJson(page);
    const loadCount = countLoads(page);
    await page.clock.install({ time: Date.now() });
    await page.setViewportSize({ width: 1280, height: 900 });
    await openDashboard(page);

    await page.clock.fastForward(5 * 60_000); // new data arrives
    await expect(page.locator('[data-reload-status] .pill')).toBeVisible();

    const details = page.locator('details').first();
    await details.locator('summary').click();
    await expect(details).toHaveJSProperty('open', true);

    await page.clock.fastForward(65_000);
    await page.waitForTimeout(500);
    expect(loadCount()).toBe(1); // an open <details> blocks the automatic reload

    await details.locator('summary').click();
    await expect(details).toHaveJSProperty('open', false);
    await page.locator('[data-refresh-toggle]').focus(); // focus inside a control
    await page.clock.fastForward(65_000);
    await page.waitForTimeout(500);
    expect(loadCount()).toBe(1);

    await page.locator('[data-refresh-toggle]').blur();
    await page.keyboard.press('Escape'); // reset the idle clock without landing focus on a control
    await page.clock.fastForward(65_000);
    await expect.poll(loadCount).toBe(2);
  });
});
