import { expect, test, type Page } from '@playwright/test';

async function openDashboard(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Service status: / })).toBeVisible();
}

test('has no horizontal overflow at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

async function openLabs(page: Page) {
  await page.goto('/labs', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'The network' })).toBeVisible();
}

test("links the next departure's line to that line's page", async ({ page }) => {
  await openDashboard(page);
  const line = page.locator('.dep .svc a');
  test.skip(!(await line.count()), 'no departure scheduled today');
  const href = await line.getAttribute('href');
  expect(href).toMatch(/^\/labs\/[a-z]+$/);
  // The bullet beside the destination goes to the same page.
  await expect(page.locator('.dep .dest a.b')).toHaveAttribute('href', href!);
  await line.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.getByRole('heading', { level: 1, name: /^When will .+ ship\?$/ })).toBeVisible();
});

test('lists every line as one row at every width, each linking to its page, with its tempo there', async ({
  page,
}) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openLabs(page);
    const rows = page.locator('li.line');
    expect(await rows.count()).toBe(10);
    // One row each, stacked: every row starts below the one before it.
    const tops = await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
    for (let i = 1; i < tops.length; i++)
      expect(tops[i].top, `${width}px row ${i}`).toBeGreaterThanOrEqual(tops[i - 1].bottom - 0.5);
    const first = rows.first();
    await expect(first.locator('.odds')).toBeVisible();
    await expect(first.locator('.lab-name')).toHaveText(/ line$/);
    await expect(first.locator('a.lrow')).toHaveAttribute('href', /^\/labs\/[a-z]+$/);
  }
  // The tempo histogram is on the line's own page, read out month by month.
  await page.locator('a.lrow').first().click();
  const hist = page.locator('.hist');
  await expect(hist).toBeVisible();
  await expect(hist).toHaveAttribute('role', 'img');
  await expect(hist).toHaveAccessibleName(/^Models listed on OpenRouter per month: /);
});

test('keeps relative ages on one line and focus rings unclipped', async ({ page }) => {
  await page.goto('/radar', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const whens = page.locator('.sig-when');
  if (await whens.count()) await expect(whens.first()).toHaveCSS('white-space', 'nowrap');
  await openLabs(page);
  // A row is a link; its ring is drawn, and the list does not clip it.
  const row = page.locator('a.lrow').first();
  await row.focus();
  await expect(row).toHaveCSS('outline-style', 'solid');
  await expect(page.locator('ol.lines')).toHaveCSS('overflow', 'visible');
});
