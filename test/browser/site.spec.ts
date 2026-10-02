import { expect, test, type Page } from '@playwright/test';
import { LABS } from '../../src/domain/lab';
import { LEGACY_HASHES, NAV } from '../../src/ui/site';

/** The multi-page site: the tab strip on every page, one page per lab, a real 404 and old links. */

const PAGES: [path: string, current: string, aria: 'page' | 'true'][] = [
  ['/', '/', 'page'],
  ['/labs', '/labs', 'page'],
  ['/labs/anthropic', '/labs', 'true'],
  ['/markets', '/markets', 'page'],
  ['/radar', '/radar', 'page'],
  ['/about', '/about', 'page'],
  ['/backtest', '/backtest', 'page'],
];

async function open(page: Page, path: string) {
  const res = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('main')).toBeVisible();
  return res;
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Site' });

for (const [path, current, aria] of PAGES) {
  test(`${path} carries the tab strip with its own tab marked current`, async ({ page }) => {
    await open(page, path);
    const links = nav(page).getByRole('link');
    await expect(links).toHaveCount(NAV.length);
    const marked = nav(page).locator('[aria-current]');
    await expect(marked).toHaveCount(1);
    await expect(marked).toHaveAttribute('href', current);
    await expect(marked).toHaveAttribute('aria-current', aria);
    // The current tab is printed, not only announced: heavier than the rest.
    const weight = (el: Element) => Number(getComputedStyle(el).fontWeight);
    const others = nav(page).locator('a:not([aria-current])').first();
    expect(await marked.evaluate(weight)).toBeGreaterThan(await others.evaluate(weight));
  });
}

test('the tabs are reachable in order from the keyboard, with a visible ring, and Enter follows one', async ({
  page,
}) => {
  await open(page, '/about');
  const first = nav(page).getByRole('link').first();
  await first.focus();
  const seen: string[] = [];
  for (let i = 0; i < NAV.length; i++) {
    const focused = page.locator(':focus');
    await expect(focused).toHaveCSS('outline-style', 'solid');
    seen.push((await focused.getAttribute('href')) ?? '');
    if (i < NAV.length - 1) await page.keyboard.press('Tab');
  }
  expect(seen).toEqual(NAV.map((n) => n.href));
  await nav(page).getByRole('link', { name: 'Radar' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/radar$/);
  await expect(nav(page).locator('[aria-current="page"]')).toHaveAttribute('href', '/radar');
});

for (const width of [390, 360, 320]) {
  test(`the tab strip is one row inside ${width}px, every tab a 44px target`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page, '/markets');
    // A phone keeps five tabs: Backtest is linked from the footer instead.
    await expect(nav(page).getByRole('link')).toHaveCount(NAV.length - 1);
    await expect(nav(page).locator('a[href="/backtest"]')).toBeHidden();
    const strip = (await nav(page).boundingBox())!;
    expect(strip.x).toBeGreaterThanOrEqual(0);
    expect(strip.x + strip.width).toBeLessThanOrEqual(width);
    const boxes = await nav(page)
      .getByRole('link')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
    for (const b of boxes) expect(b.height).toBeGreaterThanOrEqual(44);
    // One row at every width: where the tabs do not fit, the strip scrolls inside itself.
    expect(new Set(boxes.map((b) => Math.round(b.top))).size).toBe(1);
    const last = nav(page).getByRole('link').last();
    await last.scrollIntoViewIfNeeded();
    const lastBox = (await last.boundingBox())!;
    expect(lastBox.x + lastBox.width).toBeLessThanOrEqual(width + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

for (const lab of LABS) {
  test(`/labs/${lab.id} answers when ${lab.name} will ship`, async ({ page }) => {
    const res = await open(page, `/labs/${lab.id}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`When will ${lab.name} ship?`);
    await expect(page).toHaveTitle(`When will ${lab.name} ship? — whenmodel`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `https://whenmodel.com/labs/${lab.id}`,
    );
    // The next departure, or why there is none, heads the page under the line's sign.
    await expect(page.locator('#reads-title')).toBeVisible();
    await expect(page.locator('.line-name')).toHaveText(`${lab.name} line`);
    await expect(page.locator('[data-fingerprint]')).toHaveAttribute('data-fingerprint', /^[0-9a-f]{8}$/);
  });
}

test('an unknown lab is the site 404, with a 404 status', async ({ page }) => {
  const res = await page.goto('/labs/not-a-lab', { waitUntil: 'domcontentloaded' });
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Line not found');
  await expect(page).toHaveTitle('Line not found — whenmodel');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(nav(page).locator('[aria-current]')).toHaveCount(0);
});

test.describe('old single-page links', () => {
  const cases: [hash: string, to: string][] = [
    ['#lab-anthropic', '/labs/anthropic'],
    ['#lab-deepseek', '/labs/deepseek'],
    ['#markets', '/markets'],
    ['#ew-leaks', '/radar#ew-leaks'],
    ['#faq', '/about#faq-title'],
    ['#dc-adds', '/about#score'],
  ];
  for (const [hash, to] of cases) {
    test(`/${hash} moves on to ${to}`, async ({ page }) => {
      expect(LEGACY_HASHES[hash.slice(1)] ?? `/labs/${hash.slice(5)}`).toBe(to);
      await page.goto(`/${hash}`, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp(`${to.replace(/[/#]/g, '\\$&')}$`));
      await expect(page.locator('main')).toBeVisible();
      // A replace, not a push: Back leaves the site rather than bouncing through the redirect again.
      expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(2);
    });
  }

  test('a hash that still means something on / stays put', async ({ page }) => {
    await page.goto('/#main', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /^Service status: / })).toBeVisible();
    await page.waitForTimeout(300);
    expect(new URL(page.url()).pathname).toBe('/');
    expect(new URL(page.url()).hash).toBe('#main');
  });
});

test('every page reads its own slice: the fingerprints differ from page to page', async ({ page }) => {
  const prints = new Map<string, string>();
  for (const [path] of PAGES.filter(([p]) => p !== '/backtest')) {
    await open(page, path);
    prints.set(path, (await page.locator('[data-fingerprint]').getAttribute('data-fingerprint')) ?? '');
  }
  expect(new Set(prints.values()).size).toBe(prints.size);
});
