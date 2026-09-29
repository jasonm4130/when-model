import { expect, test, type Page } from '@playwright/test';

async function openDashboard(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'DROPCON LEVEL' })).toBeVisible();
}

test('has no horizontal overflow at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

async function openLabs(page: Page) {
  await page.goto('/labs', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Lab Watch' })).toBeVisible();
}

test("links the hottest-lab line under the level to that lab's page", async ({ page }) => {
  await openDashboard(page);
  const hot = page.locator('a.dc-hot');
  if (await hot.count()) {
    const href = await hot.getAttribute('href');
    expect(href).toMatch(/^\/labs\/[a-z]+$/);
    await hot.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole('heading', { level: 1, name: /^When will .+ ship\?$/ })).toBeVisible();
  }
});

test('ranks labs one per line, each closed until opened, at every width', async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openLabs(page);
    const columns = await page
      .locator('.labs-grid')
      .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    expect(columns, `${width}px`).toBe(1);
    const card = page.locator('.lab').first();
    // Closed, a row is its rank, name, the 7-day odds and heat: the reads and the tempo wait inside.
    await expect(card.locator('.lab-odds .metric-value')).toBeVisible();
    await expect(card.locator('.heat-line')).toBeVisible();
    await expect(card.locator('.hist')).toBeHidden();
    await expect(card.locator('.reads, .reads-fam').first()).toBeHidden();
    await card.locator('summary.lab-row').click();
    await expect(card.locator('details.lab-fold')).toHaveAttribute('open', '');
    await expect(card.locator('.reads, .reads-fam').first()).toBeVisible();
    // Opened, the histogram shows and reads out month by month.
    await expect(card.locator('.hist')).toBeVisible();
    await expect(card.locator('.hist')).toHaveAttribute('role', 'img');
    await expect(card.locator('.hist')).toHaveAccessibleName(/^Models listed on OpenRouter per month: /);
  }
});

test('keeps relative ages on one line and focus rings unclipped', async ({ page }) => {
  await page.goto('/radar', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const whens = page.locator('.sig-when');
  if (await whens.count()) await expect(whens.first()).toHaveCSS('white-space', 'nowrap');
  await openLabs(page);
  // The LATEST line wraps rather than clipping, so its ring keeps the default offset; the
  // unclipped check itself is in robustness.spec.ts.
  const latest = page.locator('.lab .latest a').first();
  if (await latest.count()) {
    // The LATEST line lives inside the lab's fold: open it from the keyboard, as a keyboard reader would.
    await page.locator('.lab summary.lab-row').first().focus();
    await page.keyboard.press('Enter');
    await latest.focus();
    await expect(latest).toHaveCSS('outline-style', 'solid');
    await expect(page.locator('.lab .latest').first()).toHaveCSS('overflow', 'visible');
  }
});
