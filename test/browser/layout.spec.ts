import { expect, test, type Page } from '@playwright/test';

/** Integration checks across the panels: grids that end on a full row, and pills that share one vocabulary. */

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('main')).toBeVisible();
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
    for (const [path, grid] of [['/about', '.timeline']]) {
      await open(page, path);
      const shape = await emptyCells(page, grid);
      expect(shape.empty, `${grid} at ${width}px: ${JSON.stringify(shape)}`).toBe(0);
    }
  });
}

for (const width of [1440, 1366, 1024]) {
  test(`keeps the network's odds, timetable and last arrival in aligned columns at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, '/labs');
    // Every row gets the longest text a cell can carry, so the check does not depend on today's numbers.
    await page.locator('.lrow').evaluateAll((rows) => {
      for (const row of rows) {
        const odds = row.querySelector('.odds')!;
        odds.textContent = odds.classList.contains('quiet') ? 'times unavailable' : '100%';
        row.querySelector('.win')!.textContent = '29 Sep – 30 Sep';
        row.querySelector('.last')!.textContent = 'none listed · 12/30d';
      }
    });
    for (const cell of ['.odds', '.win', '.last']) {
      const boxes = await page.locator(`.lrow ${cell}`).evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          const row = e.closest('.lrow')!.getBoundingClientRect();
          return {
            right: Math.round(r.right),
            over: r.right - row.right,
            lines: Math.round(r.height / parseFloat(getComputedStyle(e).lineHeight)),
          };
        }),
      );
      expect(new Set(boxes.map((b) => b.right)).size, `${cell} aligned`).toBe(1);
      for (const b of boxes) {
        expect(b.over, `${cell} inside its row`).toBeLessThanOrEqual(0.5);
        expect(b.lines, `${cell} on one line`).toBe(1);
      }
    }
  });
}

test('every source status pill reads LIVE, PARTIAL, DOWN or STALE with what it covers', async ({ page }) => {
  // DROPCON on /, the release markets on /markets, and on /radar early warnings, landed, fresh
  // drops, trending, papers and the feed.
  const texts: string[] = [];
  for (const path of ['/', '/markets', '/radar', '/labs/anthropic']) {
    await open(page, path);
    texts.push(...(await page.locator('[data-source-pill]').allInnerTexts()));
  }
  expect(texts.length).toBeGreaterThanOrEqual(9);
  for (const text of texts) expect(text).toMatch(/^(LIVE|PARTIAL|DOWN|STALE) · \S/);
});
