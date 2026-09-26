import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function openDashboard(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'DROPCON LEVEL' })).toBeVisible();
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

  test('keeps the DROPCON number above the fold on a ~664px-tall Safari viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await openDashboard(page);

    const box = await page.locator('.dc-num').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(664);
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
    await expect(page.locator('.clock')).toHaveText(/^\d{2}:\d{2}:\d{2}Z$/);
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

/** Serve the Worker's real dashboard.json with one visible field changed: data this page never rendered. */
async function serveChangedDashboard(page: Page): Promise<() => number> {
  let calls = 0;
  await page.route('**/api/dashboard.json', async (route) => {
    calls += 1;
    const body = (await (await route.fetch()).json()) as { dropcon: { name: string } };
    body.dropcon.name = `CHANGED ${calls}`;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return () => calls;
}

/** Advance past one 5-minute poll and wait for its response, so the assertion after it isn't a race. */
async function pollOnce(page: Page) {
  const response = page.waitForResponse('**/api/dashboard.json');
  await page.clock.fastForward(5 * 60_000);
  await response;
}

/**
 * Open with a fake clock, then pause it: a running clock lets the page's 5-second idle check fire on
 * its own between two steps of a test, which would make "has it reloaded yet?" a race.
 */
async function openWithClock(page: Page) {
  await page.clock.install({ time: Date.now() });
  await page.setViewportSize({ width: 1280, height: 900 });
  await openDashboard(page);
  await page.waitForLoadState('load');
  await page.clock.pauseAt(Date.now() + 1_000);
}

test.describe('polling refresh (UI-11)', () => {
  test('stays quiet when the served data is what the page rendered', async ({ page }) => {
    // Unmocked: the Worker's own fingerprint of the render has to match the browser's fingerprint of
    // /api/dashboard.json, or every visitor would see NEW DATA five minutes in.
    await openWithClock(page);
    await expect(page.locator('[data-reload-status]')).toHaveAttribute('data-fingerprint', /^[0-9a-f]{8}$/);

    await pollOnce(page);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-reload-status] .pill')).toHaveCount(0);
  });

  test('shows an aria-live NEW DATA pill once the polled fingerprint changes, and reloads on click', async ({
    page,
  }) => {
    const callCount = await serveChangedDashboard(page);
    const loadCount = countLoads(page);
    await openWithClock(page);
    expect(callCount()).toBe(0); // the page carries its own fingerprint, so there is no poll at load
    expect(loadCount()).toBe(1);

    const status = page.locator('[data-reload-status]');
    await expect(status).toBeEmpty();

    await pollOnce(page);

    const pill = page.locator('[data-reload-status] .pill');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText('NEW DATA · RELOAD');
    await expect(status).toHaveAttribute('aria-live', 'polite');

    await pill.click();
    await expect.poll(loadCount).toBe(2); // the manual click reloads immediately, idle or not
  });

  test('offers data that changed while a background tab was hidden, as soon as it is shown', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      let state: DocumentVisibilityState = 'hidden';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      (window as unknown as { showTab: () => void }).showTab = () => {
        state = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));
      };
    });
    const callCount = await serveChangedDashboard(page);
    await openWithClock(page);

    await page.clock.fastForward(20 * 60_000); // opened with cmd-click and left behind other tabs
    expect(callCount()).toBe(0); // no polling while hidden

    const response = page.waitForResponse('**/api/dashboard.json');
    await page.evaluate(() => (window as unknown as { showTab: () => void }).showTab());
    await response;
    await expect(page.locator('[data-reload-status] .pill')).toBeVisible();
  });

  test('waits for a full minute without input before reloading on its own', async ({ page }) => {
    await serveChangedDashboard(page);
    const loadCount = countLoads(page);
    await openWithClock(page);

    await pollOnce(page);
    await expect(page.locator('[data-reload-status] .pill')).toBeVisible();

    await page.keyboard.press('Shift'); // the reader is still here
    await page.clock.fastForward(30_000);
    await page.waitForTimeout(500);
    expect(loadCount()).toBe(1);

    await page.clock.fastForward(35_000); // now more than 60s since that key press
    await expect.poll(loadCount).toBe(2);
  });

  test('auto-reloads only once idle, and a PAUSE AUTO-REFRESH toggle blocks it', async ({ page }) => {
    await serveChangedDashboard(page);
    const loadCount = countLoads(page);
    await openWithClock(page);

    const toggle = page.locator('[data-refresh-toggle]');
    await toggle.click(); // PAUSE AUTO-REFRESH
    await toggle.blur(); // clicking a button focuses it; blur so only the pause (not lingering focus) is under test
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('whenmodel:autoRefreshPaused'))).toBe('true');

    await pollOnce(page); // new data arrives
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
    await serveChangedDashboard(page);
    const loadCount = countLoads(page);
    await openWithClock(page);

    await pollOnce(page); // new data arrives
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
