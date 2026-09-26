import { expect, test, type Page } from '@playwright/test';

async function openDashboard(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'DROPCON LEVEL' })).toBeVisible();
}

/** The bottom edge of an element, in CSS pixels from the top of the page as first shown. */
async function bottom(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${selector} has a box`).not.toBeNull();
  return box!.y + box!.height;
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`shows the level, its name, the headline and the scale on the first screen at ${viewport.width}x${viewport.height} with reduced motion`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(viewport);
    await openDashboard(page);
    for (const part of ['.dc-num', '.dc-name', '.dc-headline', '.dc-scale', '.sc-plot', '.dc-key']) {
      await expect(page.locator(part)).toBeVisible();
      expect(await bottom(page, part), `${part} on the first screen`).toBeLessThanOrEqual(viewport.height);
    }
  });
}

test('has no horizontal overflow at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('makes the history a keyboard slider whose description summarises the series', async ({ page }) => {
  await openDashboard(page);
  const plot = page.locator('.sc-plot');
  await expect(plot).toHaveAttribute('role', 'slider');
  await expect(plot).toHaveAccessibleName(/^DROPCON history/);
  await expect(plot).toHaveAccessibleDescription(/^DROPCON history, the lead score over the last 7 days/);
  // The hottest-lab line under the level links to that lab's card.
  const hot = page.locator('a.dc-hot');
  if (await hot.count()) {
    const href = await hot.getAttribute('href');
    expect(href).toMatch(/^#lab-/);
    await expect(page.locator(href!)).toHaveCount(1);
  }
});

test('uses the compact lab card on phones and five columns on wide screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);
  const card = page.locator('.lab').first();
  await expect(card.locator('.hist')).toBeHidden();
  await expect(card.locator('.tempo')).toBeHidden();
  await expect(card.locator('.reads, .reads-fam').first()).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  // Shown again on desktop, the histogram reads out month by month.
  await expect(card.locator('.hist')).toHaveAttribute('role', 'img');
  await expect(card.locator('.hist')).toHaveAccessibleName(/^Models listed on OpenRouter per month: /);
  const columns = await page
    .locator('.labs-grid')
    .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(5);
});

test('keeps relative ages on one line and focus rings unclipped', async ({ page }) => {
  await openDashboard(page);
  const whens = page.locator('.sig-when');
  if (await whens.count()) await expect(whens.first()).toHaveCSS('white-space', 'nowrap');
  // The LATEST line wraps rather than clipping, so its ring keeps the default offset; the
  // unclipped check itself is in robustness.spec.ts.
  const latest = page.locator('.lab .latest a').first();
  if (await latest.count()) {
    await latest.focus();
    await expect(latest).toHaveCSS('outline-style', 'solid');
    await expect(page.locator('.lab .latest').first()).toHaveCSS('overflow', 'visible');
  }
});
