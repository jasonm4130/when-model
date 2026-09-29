import { expect, test } from '@playwright/test';

async function openDashboard(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'DROPCON LEVEL' })).toBeVisible();
}

async function overflowingElements(page: import('@playwright/test').Page) {
  return page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth
      ? []
      : Array.from(document.querySelectorAll<HTMLElement>('body *'))
          .map((element) => {
            const box = element.getBoundingClientRect();
            return {
              element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.className ? `.${String(element.className).replaceAll(' ', '.')}` : ''}`,
              left: Math.round(box.left),
              right: Math.round(box.right),
              width: Math.round(box.width),
            };
          })
          .filter(({ left, right }) => left < -1 || right > window.innerWidth + 1)
          .slice(0, 10),
  );
}

test('keeps the wide dashboard, FAQ and footer aligned to the shared container', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openDashboard(page);

  const faq = page
    .getByRole('heading', { name: 'FREQUENTLY ASKED QUESTIONS' })
    .locator('xpath=ancestor::section');
  const [faqBox, footerBox] = await Promise.all([
    faq.boundingBox(),
    page.locator('footer.wrap').boundingBox(),
  ]);
  expect(faqBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(faqBox!.width).toBeLessThanOrEqual(1400);
  expect(Math.abs(faqBox!.x - footerBox!.x)).toBeLessThanOrEqual(1);
  await expect(faq).toBeVisible();
  await expect(page.locator('footer')).toContainText('OPERATIONAL DISCLAIMER');
});

test('does not create horizontal overflow on narrow screens', async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await openDashboard(page);
    const overflow = await overflowingElements(page);
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(
      documentWidth,
      `overflow at ${width}px (document width ${documentWidth}px): ${JSON.stringify(overflow)}`,
    ).toBeLessThanOrEqual(width);
  }
});

test('pauses and resumes auto-refresh from the keyboard, and there is no ticker to pause', async ({
  page,
}) => {
  await openDashboard(page);
  await expect(page.locator('[data-ticker], #ticker-track')).toHaveCount(0);

  const toggle = page.locator('[data-refresh-toggle]');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAccessibleName('RESUME AUTO-REFRESH');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Space');
  await expect(toggle).toHaveAccessibleName('PAUSE AUTO-REFRESH');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('opens a folded list from the keyboard, and keeps DROPCON segments stable with reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDashboard(page);

  // Secondary detail waits behind a summary; Enter on it opens the fold and shows what it held.
  const fold = page.locator('details.fold.dc-adds');
  await expect(fold.locator('.dc-drivers')).toBeHidden();
  await fold.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(fold).toHaveAttribute('open', '');
  await expect(fold.locator('.dc-drivers')).toBeVisible();
  await expect(page.locator('.seg')).toHaveCount(5);
  expect(await page.locator('.seg.on').count()).toBe(1);
  expect(await page.locator('.seg.on').evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
