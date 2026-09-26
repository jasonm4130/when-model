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
    // Every card gets the same text, so the check does not depend on today's numbers.
    const write = (heat: string, launches: string) =>
      page.locator('.heat-line').evaluateAll(
        (lines, [h, l]) => {
          for (const line of lines) {
            line.children[0].textContent = h;
            line.children[1].textContent = l;
          }
        },
        [heat, launches],
      );
    // The line is a flex item (a block), so read its rows off its two phrases.
    const rows = () =>
      page
        .locator('.heat-line')
        .evaluateAll((els) =>
          els.map(
            (el) => new Set([...el.children].map((c) => Math.round(c.getBoundingClientRect().top))).size,
          ),
        );
    // Where the columns are widest for their count, a busy week's line fits on one row.
    if (width !== 1360) {
      await write('HEAT 80 ·', '3 LAUNCHES/30D');
      expect(new Set(await rows())).toEqual(new Set([1]));
    }
    // The widest line a card can carry (heat is capped at 100; no lab has listed a dozen text
    // models in 30 days) may take two rows, but only between its phrases.
    await write('HEAT 100 ·', '12 LAUNCHES/30D');
    // An inline box has one client rect per line it spans; neither phrase runs past its card.
    const phrases = await page.locator('.heat-line > span').evaluateAll((els) =>
      els.map((el) => ({
        lines: el.getClientRects().length,
        over: el.getBoundingClientRect().right - el.closest('.lab-foot')!.getBoundingClientRect().right,
      })),
    );
    expect(phrases.length).toBeGreaterThan(0);
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
