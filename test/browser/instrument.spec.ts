import { expect, test, type Page } from '@playwright/test';

/**
 * The DROPCON instrument's progressive enhancement: the plot is a server-rendered picture with a
 * summary; the script turns it into a slider whose readout moves the big number back in time.
 */
async function openDashboard(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('heading', { name: 'DROPCON LEVEL' })).toBeVisible();
  await expect(page.locator('.sc-plot')).toHaveAttribute('role', 'slider');
}

test('the line ends at the number: the NOW dot and the big number share one height', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDashboard(page);
  const dot = await page.locator('.sc-dot').boundingBox();
  const num = await page.locator('.dc-num').boundingBox();
  const plot = await page.locator('.sc-plot').boundingBox();
  test.skip(!dot, 'no live reading today: the NOW dot is not drawn');
  // The dot straddles the plot's right edge, and the number sits beside it, level with it.
  expect(Math.abs(dot!.x + dot!.width / 2 - (plot!.x + plot!.width))).toBeLessThanOrEqual(3);
  const dotY = dot!.y + dot!.height / 2;
  expect(dotY).toBeGreaterThanOrEqual(num!.y - 1);
  expect(dotY).toBeLessThanOrEqual(num!.y + num!.height + 26);
  expect(num!.x).toBeGreaterThan(plot!.x + plot!.width);
});

test('scrubs with the arrow keys, reads each hour out, and returns to NOW', async ({ page }) => {
  await openDashboard(page);
  const plot = page.locator('.sc-plot');
  const num = page.locator('.dc-num');
  const rest = await num.textContent();
  await plot.focus();
  await expect(page.locator('[data-now-label]')).toHaveText('NOW');
  await expect(plot).toHaveAttribute('aria-valuetext', /^\d+ [A-Z]{3} \d\d:\d\dZ: /);
  const max = Number(await plot.getAttribute('aria-valuemax'));
  expect(max).toBe(168);
  await page.keyboard.press('Home');
  await expect(plot).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('[data-now-label]')).not.toHaveText('NOW');
  await expect(page.locator('[data-cursor]')).toBeVisible();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(plot).toHaveAttribute('aria-valuenow', '24');
  await page.keyboard.press('ArrowRight');
  await expect(plot).toHaveAttribute('aria-valuenow', '25');
  await page.keyboard.press('End');
  await expect(plot).toHaveAttribute('aria-valuenow', String(max));
  await expect(page.locator('[data-now-label]')).toHaveText('NOW');
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-cursor]')).toBeHidden();
  await expect(num).toHaveText(rest!);
});

test('hovering a launch names it in the chip, with the time, and letting go restores NOW', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDashboard(page);
  const launch = await page.locator('[data-scope]').evaluate((el) => {
    const d = JSON.parse((el as HTMLElement).dataset.scope!) as {
      from: number;
      to: number;
      launches: [number, string][];
    };
    const l = d.launches[0];
    return l ? { x: (l[0] - d.from) / (d.to - d.from), name: l[1] } : null;
  });
  test.skip(!launch, 'no frontier launch in the last 7 days');
  const box = (await page.locator('.sc-plot').boundingBox())!;
  await page.mouse.move(box.x + box.width * launch!.x + 4, box.y + box.height * 0.6);
  await expect(page.locator('[data-chip-launches]')).toContainText(launch!.name);
  await expect(page.locator('[data-chip-time]')).toHaveText(/^\d+ [A-Z]{3} \d\d:\d\dZ$/);
  await page.mouse.move(box.x + box.width / 2, box.y - 60);
  await expect(page.locator('[data-cursor]')).toBeHidden();
  await expect(page.locator('[data-now-label]')).toHaveText('NOW');
});

test('with reduced motion the sweep is gone and nothing on the instrument animates', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDashboard(page);
  await expect(page.locator('.sc-sweep')).toBeHidden();
  for (const sel of ['.sc-ink', '.sc-dot', '.seg.on', '.sc-needle-col', '.dc-num']) {
    const el = page.locator(sel);
    if (!(await el.count())) continue;
    expect(await el.evaluate((e) => getComputedStyle(e).animationName), sel).toBe('none');
  }
  expect(
    await page
      .locator('.sc-dot')
      .evaluate((e) => getComputedStyle(e, '::after').animationName)
      .catch(() => 'none'),
  ).toBe('none');
});

for (const width of [360, 390]) {
  test(`fits the instrument on a ${width}px phone without horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openDashboard(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const plot = (await page.locator('.sc-plot').boundingBox())!;
    const num = (await page.locator('.dc-num').boundingBox())!;
    expect(plot.width).toBeGreaterThan(150);
    expect(num.x + num.width).toBeLessThanOrEqual(width);
  });
}
