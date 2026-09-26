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
          .filter(
            ({ left, right, element }) =>
              !element.includes('ticker') && (left < -1 || right > window.innerWidth + 1),
          )
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

test('pauses and resumes the ticker from the keyboard', async ({ page }) => {
  await openDashboard(page);

  const toggle = page.locator('[data-ticker-toggle]');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAccessibleName('RESUME TICKER');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-ticker]')).toHaveClass(/is-paused/);

  await page.keyboard.press('Space');
  await expect(toggle).toHaveAccessibleName('PAUSE TICKER');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-ticker]')).not.toHaveClass(/is-paused/);
});

test('uses static, readable ticker content and stable DROPCON segments with reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDashboard(page);

  await expect(page.locator('.ticker-controls')).toBeHidden();
  await expect(page.locator('.ticker-copy')).toBeHidden();
  await expect(page.locator('#ticker-track')).toHaveCSS('animation-name', 'none');
  // UI-05: reduced motion used to wrap the ticker onto many lines (~487px); it must now stay a single line.
  await expect(page.locator('#ticker-track')).toHaveCSS('white-space', 'nowrap');
  const trackBox = await page.locator('#ticker-track').boundingBox();
  expect(trackBox).not.toBeNull();
  expect(trackBox!.height).toBeLessThan(40);
  await expect(page.locator('.seg')).toHaveCount(5);
  expect(await page.locator('.seg.on').count()).toBe(1);
  expect(await page.locator('.seg.on').evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
