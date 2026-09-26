import { expect, test, type Page } from '@playwright/test';

/**
 * The DROPCON hero: the level now and its week as one instrument. The plot is a server-rendered
 * picture with a summary; the script makes it a slider whose readout names each hour. The big
 * number is NOW, always: scrubbing writes to the readout, never to the number.
 */
async function openDashboard(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('heading', { name: 'DROPCON LEVEL' })).toBeVisible();
  await expect(page.locator('.sc-plot')).toHaveAttribute('role', 'slider');
}

/** Serve the page with its scrubber data edited, for states today's data may not show. */
async function withScopeData(page: Page, edit: (data: Record<string, unknown>) => void) {
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const res = await route.fetch();
      const body = (await res.text()).replace(/data-scope="([^"]*)"/, (_, raw: string) => {
        const data = JSON.parse(
          raw
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&'),
        );
        edit(data);
        return `data-scope="${JSON.stringify(data).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
      });
      await route.fulfill({ response: res, body });
    },
  );
}

const bottomOf = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${selector} has a box`).not.toBeNull();
  return box!.y + box!.height;
};

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`puts the number, what it is, the plot and "not a forecast" on the first screen at ${viewport.width}x${viewport.height} with reduced motion`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(viewport);
    await openDashboard(page);
    for (const part of [
      '.dc-num',
      '.dc-name',
      '.sc-eq',
      '.dc-headline',
      '.sc-readout',
      '.dc-scale',
      '.sc-plot',
      '.dc-what',
      '.dc-what .nf',
    ]) {
      await expect(page.locator(part).first()).toBeVisible();
      expect(await bottomOf(page, part), `${part} on the first screen`).toBeLessThanOrEqual(viewport.height);
    }
    await expect(page.locator('.dc-what .nf')).toHaveText('NOT A FORECAST');
  });
}

test('the line ends at the number: on a wide screen the number sits level with the NOW dot', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDashboard(page);
  const dot = await page.locator('.sc-dot').boundingBox();
  test.skip(!dot, 'no live reading today: the NOW dot is not drawn');
  const num = (await page.locator('.dc-num').boundingBox())!;
  const plot = (await page.locator('.sc-plot').boundingBox())!;
  expect(Math.abs(dot!.x + dot!.width / 2 - (plot.x + plot.width))).toBeLessThanOrEqual(3);
  const dotY = dot!.y + dot!.height / 2;
  expect(dotY).toBeGreaterThanOrEqual(num.y - 1);
  expect(dotY).toBeLessThanOrEqual(num.y + num.height + 1);
  expect(num.x).toBeGreaterThan(plot.x + plot.width);
  await expect(page.locator('.sc-nowtag')).toBeHidden();
});

test('on a phone the number goes above the plot, which takes the width, and a NOW tag marks the edge', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDashboard(page);
  const num = (await page.locator('.dc-num').boundingBox())!;
  const plot = (await page.locator('.sc-plot').boundingBox())!;
  expect(num.y + num.height).toBeLessThan(plot.y);
  expect(plot.width).toBeGreaterThan(390 * 0.7);
  const dot = await page.locator('.sc-dot').boundingBox();
  test.skip(!dot, 'no live reading today');
  const tag = (await page.locator('.sc-nowtag').boundingBox())!;
  await expect(page.locator('.sc-nowtag')).toHaveText(/^NOW \d$/);
  expect(tag.x + tag.width).toBeLessThanOrEqual(plot.x + plot.width);
  expect(Math.abs(tag.x + tag.width - (dot!.x + dot!.width / 2))).toBeLessThan(24);
});

test('scrubs with the keys, reads each hour into the readout, and never touches the number', async ({
  page,
}) => {
  await openDashboard(page);
  const plot = page.locator('.sc-plot');
  const num = page.locator('.dc-num');
  const when = page.locator('[data-r-when]');
  const rest = await num.textContent();
  await plot.focus();
  await expect(when).toHaveText(/^NOW · \d+ [A-Z]{3} \d\d:\d\dZ$/);
  await expect(plot).toHaveAttribute('aria-valuetext', /^NOW, \d+ [A-Z]{3} \d\d:\d\dZ: /);
  const max = Number(await plot.getAttribute('aria-valuemax'));
  expect(max).toBe(168);
  await page.keyboard.press('ArrowLeft');
  await expect(plot).toHaveAttribute('aria-valuenow', String(max - 1));
  await expect(plot).toHaveAttribute('aria-valuetext', /^\d+ [A-Z]{3} \d\d:00Z: /);
  await expect(when).toHaveText(/^\d+ [A-Z]{3} \d\d:00Z$/);
  await expect(page.locator('.sc-readout')).toHaveClass(/is-scrub/);
  await expect(num).toHaveText(rest!);
  await page.keyboard.press('Home');
  await expect(plot).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('[data-cursor]')).toBeVisible();
  await expect(page.locator('[data-ctag]')).toBeVisible();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(plot).toHaveAttribute('aria-valuenow', '24');
  await page.keyboard.press('ArrowRight');
  await expect(plot).toHaveAttribute('aria-valuenow', '25');
  await expect(num).toHaveText(rest!);
  await page.keyboard.press('Escape');
  await expect(plot).toHaveAttribute('aria-valuenow', String(max));
  await expect(when).toHaveText(/^NOW · /);
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await expect(when).toHaveText(/^NOW · /);
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-cursor]')).toBeHidden();
  await expect(when).toHaveText(/^NOW · /);
  await expect(num).toHaveText(rest!);
});

test('ArrowLeft from NOW with the history offline does not report a score', async ({ page }) => {
  await withScopeData(page, (data) => {
    data.history = 'unavailable';
    data.pts = [];
    delete data.recordFrom;
  });
  await openDashboard(page);
  const plot = page.locator('.sc-plot');
  await plot.focus();
  await expect(plot).toHaveAttribute('aria-valuetext', /^NOW, /);
  await page.keyboard.press('ArrowLeft');
  await expect(plot).toHaveAttribute(
    'aria-valuetext',
    /^\d+ [A-Z]{3} \d\d:00Z: history offline: log unreadable/,
  );
  const said = await plot.getAttribute('aria-valuetext');
  expect(said).not.toMatch(/score|level \d/);
  await expect(page.locator('[data-r-what]')).toHaveText('history offline · log unreadable');
  await expect(page.locator('[data-probe]')).toBeHidden();
});

for (const width of [1440, 390]) {
  test(`hovering or tapping the NOW edge reads the live reading at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openDashboard(page);
    const box = (await page.locator('.sc-plot').boundingBox())!;
    const y = box.y + box.height / 2;
    // The NOW dot and leader sit over the edge but never take the pointer.
    const hit = await page.evaluate(
      ([x, yy]) => document.elementFromPoint(x, yy)?.closest('.sc-plot') !== null,
      [box.x + box.width - 3, y],
    );
    expect(hit).toBe(true);
    if (width < 640) await page.touchscreen?.tap(box.x + box.width - 2, y).catch(() => {});
    await page.mouse.move(box.x + box.width - 2, y);
    await expect(page.locator('[data-r-when]')).toHaveText(/^NOW · /);
    await expect(page.locator('.sc-plot')).toHaveAttribute('aria-valuetext', /^NOW, /);
    // A little further in is the record, not the live reading.
    await page.mouse.move(box.x + box.width - 40, y);
    await expect(page.locator('[data-r-when]')).not.toHaveText(/^NOW/);
  });
}

test('hovering a launch names it in the readout and lights its mark; leaving restores NOW', async ({
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
  await page.mouse.move(box.x + box.width * launch!.x + 3, box.y + box.height * 0.6);
  await expect(page.locator('[data-r-near]')).toContainText(`near: `);
  await expect(page.locator('[data-r-near]')).toContainText(launch!.name);
  await expect(page.locator('.sc-mark[data-launch="0"]')).toHaveClass(/is-near/);
  await expect(page.locator('[data-r-when]')).toHaveText(/^\d+ [A-Z]{3} \d\d:00Z$/);
  await page.mouse.move(box.x + box.width / 2, box.y - 120);
  await expect(page.locator('[data-cursor]')).toBeHidden();
  await expect(page.locator('[data-r-when]')).toHaveText(/^NOW · /);
  await expect(page.locator('.sc-mark[data-launch="0"]')).not.toHaveClass(/is-near/);
});

test("an older version's hour reads as old scale, never as a number in the hero", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await withScopeData(page, (data) => {
    const d = data as { to: number; pts: unknown[][] };
    const h = Math.floor((d.to - 30 * 3_600_000) / 3_600_000) * 3_600_000;
    d.pts = [['o', h, h + 3_600_000, 88, 0, 0, 2], ...d.pts.filter((p) => (p[1] as number) !== h)];
  });
  await openDashboard(page);
  const rest = await page.locator('.dc-num').textContent();
  const eq = await page.locator('.sc-eq').textContent();
  const plot = page.locator('.sc-plot');
  await plot.focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-r-what]')).toHaveText('v2 · old scale, not comparable');
  await expect(plot).not.toHaveAttribute('aria-valuetext', /88/);
  await expect(page.locator('.dc-num')).toHaveText(rest!);
  await expect(page.locator('.sc-eq')).toHaveText(eq!);
  await expect(page.locator('.sc-readout')).toHaveAttribute('data-tone', 'old');
});

test('names the chart for assistive tech, describes it once, and keeps a table of every reading', async ({
  page,
}) => {
  await openDashboard(page);
  const plot = page.locator('.sc-plot');
  await expect(plot).toHaveAccessibleName(/^DROPCON history, last 7 days/);
  await expect(plot).toHaveAccessibleDescription(/^DROPCON history, the lead score over the last 7 days/);
  // The summary is the slider's description only: its paragraph is out of the reading order.
  const id = (await plot.getAttribute('aria-describedby'))!;
  await expect(page.locator(`#${id}`)).toBeHidden();
  await expect(page.locator('.sc-plot[aria-label^="DROPCON history, the lead score"]')).toHaveCount(0);
  await expect(page.locator('.sc-table table').first()).toHaveCount(1);
});

test('with reduced motion the sweep is gone and nothing on the instrument animates', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDashboard(page);
  await expect(page.locator('.sc-sweep')).toBeHidden();
  for (const sel of ['.sc-ink', '.sc-dot', '.seg.on', '.sc-needle-col', '.dc-num', '.sc-change', '.sc-v3']) {
    const el = page.locator(sel).first();
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

for (const width of [360, 390, 1024, 1440]) {
  test(`fits the instrument at ${width}px: no page scroll, no label clipped or overlapping`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openDashboard(page);
    await page.waitForFunction(() => document.querySelector('.scope.fitted') !== null);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const report = await page.locator('.sc-plot').evaluate((plot) => {
      const P = plot.getBoundingClientRect();
      const visible = (el: Element) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0;
      };
      // Zone labels: the variant shown fits its zone whole.
      const zones = [...plot.querySelectorAll('.sc-zone')].flatMap((z) => {
        const zr = z.getBoundingClientRect();
        return [...z.querySelectorAll('.sc-zlabel > *')]
          .filter(visible)
          .map((l) => ({ text: l.textContent, over: l.getBoundingClientRect().right - zr.right }));
      });
      // Every label on the plot: inside it, and clear of the others.
      const labels = [...plot.querySelectorAll('[data-label="fixed"], [data-label="flag"], .sc-zlabel > *')]
        .filter(visible)
        .map((el) => ({ text: el.textContent!.trim(), r: el.getBoundingClientRect() }));
      const tag = document.querySelector('.sc-nowtag');
      if (tag && visible(tag)) labels.push({ text: 'NOW tag', r: tag.getBoundingClientRect() });
      const outside = labels
        .filter(
          (l) =>
            l.r.left < P.left - 1 ||
            l.r.right > P.right + 1 ||
            l.r.top < P.top - 1 ||
            l.r.bottom > P.bottom + 1,
        )
        .map((l) => l.text);
      const clash: string[] = [];
      for (let i = 0; i < labels.length; i++)
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i].r;
          const b = labels[j].r;
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
            clash.push(`${labels[i].text} × ${labels[j].text}`);
        }
      return { zones, outside, clash, plotWidth: P.width };
    });
    for (const z of report.zones)
      expect(z.over, `zone label "${z.text}" fits its zone`).toBeLessThanOrEqual(0.5);
    expect(report.outside).toEqual([]);
    expect(report.clash).toEqual([]);
    if (width <= 390) expect(report.plotWidth).toBeGreaterThan(width * 0.7);
  });
}
