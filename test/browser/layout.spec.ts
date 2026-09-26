import { expect, test, type Page } from '@playwright/test';

/** Integration checks across the panels: grids that end on a full row, and pills that share one vocabulary. */

async function openDashboard(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('heading', { name: 'DROPCON LEVEL' })).toBeVisible();
}

/** How many cells a grid's last row leaves empty. */
async function emptyCells(
  page: Page,
  selector: string,
): Promise<{ columns: number; items: number; empty: number }> {
  return page.locator(selector).evaluate((grid) => {
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const items = grid.children.length;
    return { columns, items, empty: (columns - (items % columns)) % columns };
  });
}

for (const width of [1440, 1280, 1024, 768, 390]) {
  test(`leaves no orphaned grid cells at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openDashboard(page);
    for (const grid of ['.labs-grid', '.timeline']) {
      const shape = await emptyCells(page, grid);
      expect(shape.empty, `${grid} at ${width}px: ${JSON.stringify(shape)}`).toBe(0);
    }
  });
}

for (const width of [1440, 1360, 1024]) {
  test(`breaks a lab card's heat line only between its phrases at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openDashboard(page);
    // An inline box has one client rect per line it spans; neither phrase runs past its card.
    const phrases = await page.locator('.heat-line > span').evaluateAll((els) =>
      els.map((el) => ({
        lines: el.getClientRects().length,
        over: el.getBoundingClientRect().right - el.closest('.lab-foot')!.getBoundingClientRect().right,
      })),
    );
    expect(phrases.length).toBeGreaterThan(0);
    // Where the columns are widest for their count, the whole line fits on one row.
    if (width !== 1360) {
      // The line is a flex item (a block), so read the rows off its two phrases.
      const rows = await page
        .locator('.heat-line')
        .evaluateAll((els) =>
          els.map(
            (el) => new Set([...el.children].map((c) => Math.round(c.getBoundingClientRect().top))).size,
          ),
        );
      expect(new Set(rows)).toEqual(new Set([1]));
    }
    for (const p of phrases) {
      expect(p.lines).toBe(1);
      expect(p.over).toBeLessThanOrEqual(0.5);
    }
  });
}

test('every source status pill reads LIVE, PARTIAL, DOWN or STALE with what it covers', async ({ page }) => {
  await openDashboard(page);
  const texts = await page.locator('[data-source-pill]').allInnerTexts();
  // DROPCON, early warnings, landed, release markets, fresh drops, trending, papers and the feed.
  expect(texts.length).toBeGreaterThanOrEqual(8);
  for (const text of texts) expect(text).toMatch(/^(LIVE|PARTIAL|DOWN|STALE) · \S/);
});
