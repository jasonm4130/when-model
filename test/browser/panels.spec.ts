import { expect, test, type Locator, type Page } from '@playwright/test';

// Mirrors src/ui/panels.ts; the unit tests pin those constants to the rendered markup.
const MOBILE_MARKETS = 6;
const MOBILE_DROPS = 8;
const MOBILE_FEED = 12;

async function openDashboard(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'DROPCON LEVEL' })).toBeVisible();
}

const panel = (page: Page, heading: string) =>
  page
    .getByRole('heading', { name: heading })
    .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " panel ")][1]');

/** Rows a reader can see: a closed <details> hides its rows with content-visibility, not display. */
async function visibleCount(list: Locator): Promise<number> {
  return list.filter({ visible: true }).count();
}

test.describe('panels on a phone (UI-10)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page);
  });

  test('Fresh Drops stack into rows with a price, capped with an expander', async ({ page }) => {
    const drops = panel(page, 'FRESH DROPS');
    test.skip((await drops.locator('.drop-item').count()) === 0, 'OpenRouter returned no listings');
    await expect(drops.locator('table')).toBeHidden();
    const rows = drops.locator('.drop-item');
    const total = await rows.count();
    expect(await visibleCount(rows)).toBe(Math.min(total, MOBILE_DROPS));
    await expect(rows.first().locator('.di-meta')).toContainText(/\$|FREE|—/);
    if (total > MOBILE_DROPS) {
      const summary = drops.locator('.fold-summary');
      await expect(summary).toHaveText(new RegExp(`^${total - MOBILE_DROPS} MORE LISTINGS`));
      expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await summary.click();
      expect(await visibleCount(rows)).toBe(total);
    }
  });

  test('release markets show six rows, then an expander', async ({ page }) => {
    const markets = panel(page, 'RELEASE MARKETS');
    const rows = markets.locator('.mrow');
    const total = await rows.count();
    test.skip(total === 0, 'Polymarket returned no release markets');
    expect(await visibleCount(rows)).toBe(Math.min(total, MOBILE_MARKETS));
    if (total > MOBILE_MARKETS) {
      await markets.locator('.fold-summary').click();
      expect(await visibleCount(rows)).toBe(total);
    }
    // UI-12: the dot sits on the title's first line, never alone above it.
    const first = rows.first();
    const [dot, name] = await Promise.all([
      first.locator('.mdot').boundingBox(),
      first.locator('.mname').boundingBox(),
    ]);
    expect(dot!.y).toBeGreaterThanOrEqual(name!.y);
    expect(dot!.y + dot!.height).toBeLessThanOrEqual(name!.y + name!.height);
  });

  test('the feed drops its inner scroller and shows twelve reports, then an expander', async ({ page }) => {
    const feed = page.locator('[data-feed]');
    test.skip((await feed.count()) === 0, 'every feed is down');
    const scrolls = await feed.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(scrolls).toBe(false);
    await expect(feed).toHaveCSS('overflow-y', 'visible');
    const items = feed.locator('.item');
    const total = await items.count();
    expect(await visibleCount(items)).toBe(Math.min(total, MOBILE_FEED));
  });

  test('the auto-refresh pause is reachable with a 44px target and keeps its full name', async ({ page }) => {
    const toggle = page.getByRole('button', { name: 'PAUSE AUTO-REFRESH' });
    await expect(toggle).toBeVisible();
    const box = (await toggle.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await expect(toggle).toHaveText('PAUSE AUTO-REFRESH'); // the noun is visually hidden, not removed
    await toggle.click();
    await expect(page.getByRole('button', { name: 'RESUME AUTO-REFRESH' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('expanders open from the keyboard with a visible, unclipped focus ring', async ({ page }) => {
    const summary = panel(page, 'FRESH DROPS').locator('.fold-summary');
    test.skip((await summary.count()) === 0, 'not enough listings to fold');
    await summary.focus();
    await expect(summary).toBeFocused();
    await expect(summary).toHaveCSS('outline-style', 'solid');
    const box = (await summary.boundingBox())!;
    const clip = await summary.evaluate((el) => {
      // The ring (2px + 2px offset) must fit inside every clipping ancestor.
      const ring = el.getBoundingClientRect();
      for (let p = el.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const r = p.getBoundingClientRect();
        if (ring.left - 4 < r.left || ring.right + 4 > r.right) return p.className;
      }
      return null;
    });
    expect(clip).toBeNull();
    expect(box.x - 4).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Enter');
    await expect(summary.locator('xpath=..')).toHaveJSProperty('open', true);
  });

  test('stays inside 390px and 320px with every expander open', async ({ page }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const summary of await page.locator('details.fold > summary').all()) {
        if (
          (await summary.isVisible()) &&
          !(await summary.evaluate((s) => (s.parentElement as HTMLDetailsElement).open))
        )
          await summary.click();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  });
});

test.describe('panels on a desktop', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDashboard(page);
  });

  test('shows every row without expanders', async ({ page }) => {
    for (const summary of await page.locator('.fold-480 > .fold-summary, .fold-900 > .fold-summary').all()) {
      await expect(summary).toBeHidden();
    }
    const rows = panel(page, 'RELEASE MARKETS').locator('.mrow');
    expect(await visibleCount(rows)).toBe(await rows.count());
    // Rows past the phone cap live in a closed <details>; here they must still take keyboard focus.
    await rows.last().focus();
    await expect(rows.last()).toBeFocused();
    const items = page.locator('[data-feed] .item');
    expect(await visibleCount(items)).toBe(await items.count());
  });

  test('the feed fills its panel down to the watchlist beside it (UI-17)', async ({ page }) => {
    const feed = page.locator('[data-feed]');
    test.skip((await feed.count()) === 0, 'every feed is down');
    const feedPanel = panel(page, 'OSINT FEED');
    const watchPanel = panel(page, 'X WATCHLIST');
    const [f, fp, wp] = await Promise.all([
      feed.boundingBox(),
      feedPanel.boundingBox(),
      watchPanel.boundingBox(),
    ]);
    expect(f!.height).toBeGreaterThanOrEqual(640);
    expect(Math.abs(fp!.y + fp!.height - (wp!.y + wp!.height))).toBeLessThanOrEqual(2);
    // The scroller reaches the panel's padding, leaving no empty band under it.
    expect(fp!.y + fp!.height - (f!.y + f!.height)).toBeLessThanOrEqual(20);
  });

  test('each panel’s pill reads its own source’s health (UI-04)', async ({ page }) => {
    const body = (await (await page.request.get('/api/dashboard.json')).json()) as {
      sources: { name: string; ok: boolean }[];
    };
    const ok = (name: string) => body.sources.find((s) => s.name === name)?.ok;
    const cases: [string, string, string][] = [
      ['RELEASE MARKETS', 'Polymarket', 'POLYMARKET'],
      ['FRESH DROPS', 'OpenRouter', 'OPENROUTER'],
      ['OPEN WEIGHTS TRENDING', 'HF trending', 'HF TRENDING'],
    ];
    for (const [heading, source, label] of cases) {
      const pill = panel(page, heading).locator('[data-source-pill]').first();
      await expect(pill).toHaveText(ok(source) ? new RegExp(`^(LIVE|STALE) · ${label}$`) : `DOWN · ${label}`);
    }
    await expect(panel(page, 'OSINT FEED').locator('[data-source-pill]')).toHaveText(
      /^(LIVE · 6|PARTIAL · \d\/6|STALE · (\d\/)?6|DOWN · 6) FEEDS$/,
    );
  });

  test('a page left open turns its LIVE pills STALE', async ({ page }) => {
    await page.clock.install({ time: Date.now() });
    await openDashboard(page);
    const live = page.locator('[data-source-pill].live');
    test.skip((await live.count()) === 0, 'no source is live');
    const count = await live.count();
    await page.clock.fastForward(16 * 60_000);
    await expect(page.locator('[data-source-pill].live')).toHaveCount(0);
    await expect(page.locator('[data-source-pill].warn', { hasText: /^STALE · / })).toHaveCount(count);
  });
});

test('reduced motion leaves the feed rows static', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);
  const item = page.locator('[data-feed] .item').first();
  test.skip((await item.count()) === 0, 'every feed is down');
  const duration = await item.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
  expect(duration).toBeLessThan(0.01);
  const transition = await page
    .locator('.fold-summary')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
  expect(transition).toBeLessThan(0.01);
});
