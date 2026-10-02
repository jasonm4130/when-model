import { expect, test, type Page } from '@playwright/test';

/**
 * The home page: the service status posts the level and the station sign names the next departure.
 * "Service history · last 7 days", the level's week, sits on /about under how the score adds up.
 * The plot is a server-rendered picture with a summary; the script makes it a slider whose readout
 * names each hour. The posted level is NOW, always: scrubbing writes to the readout, never to the
 * page's figure or its lit band.
 */
async function openDashboard(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('heading', { name: /^Service status: / })).toBeVisible();
  await expect(page.locator('.sc-plot')).toHaveCount(0);
}

const HISTORY_PATH = '/about';
/** /about's posted level: the lit band beside the arithmetic. */
const POSTED = '.bands li.on b';

async function openHistory(page: Page) {
  await page.goto(HISTORY_PATH, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('heading', { name: 'Service history · last 7 days' })).toBeVisible();
  await expect(page.locator('.sc-plot')).toHaveAttribute('role', 'slider');
}

/** Serve the page with its scrubber data edited, for states today's data may not show. */
async function withScopeData(
  page: Page,
  edit: (data: Record<string, unknown>) => void,
  html: (body: string) => string = (body) => body,
) {
  await page.route(
    (url) => url.pathname === HISTORY_PATH,
    async (route) => {
      const res = await route.fetch();
      const body = html(await res.text()).replace(/data-scope="([^"]*)"/, (_, raw: string) => {
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

/**
 * Serve the page as if the history read succeeded, whatever the Worker's D1 holds. CI's starts
 * empty, so its page arrives with the history offline and a card over the plot.
 */
const withRecordedHistory = (page: Page, edit: (data: Record<string, unknown>) => void = () => {}) =>
  withScopeData(
    page,
    (data) => {
      data.history = 'ok';
      delete data.recordFrom;
      edit(data);
    },
    (body) => body.replace(/<div class="sc-empty"[^>]*>[\s\S]*?<\/div>\s*<\/div>/, ''),
  );

const bottomOf = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${selector} has a box`).not.toBeNull();
  return box!.y + box!.height;
};

// What must be on the first screen: the answer. The service status (its name, phrase and level),
// the next departure's name, line and NOT A FORECAST, and with a departure its 7-day odds and boarding
// window. The week's chart sits below: a reader who wants the history scrolls to it.
const STATUS = ['.ss-name', '.ss-phrase', '.ss-num'];
const SIGN = ['#next-title', '.dep .svc', '.dep .plate'];
const ODDS = ['.dep .big', '.dep .win'];
for (const { width, height, parts } of [
  { width: 390, height: 844, parts: [...STATUS, ...SIGN, '.dep .big'] },
  { width: 1440, height: 900, parts: [...STATUS, ...SIGN, ...ODDS] },
  { width: 1366, height: 768, parts: [...STATUS, ...SIGN, ...ODDS] },
  { width: 1024, height: 768, parts: [...STATUS, ...SIGN, ...ODDS] },
]) {
  for (const motion of ['reduce', 'no-preference'] as const) {
    test(`puts the service status and the next departure on the first screen at ${width}x${height}, motion ${motion}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await page.setViewportSize({ width, height });
      await openDashboard(page);
      // Let the split-flap settle before measuring.
      await page.waitForTimeout(motion === 'reduce' ? 0 : 1500);
      const departing = (await page.locator('.dep .big').count()) > 0;
      for (const part of parts) {
        if (!departing && ODDS.includes(part)) continue;
        await expect(page.locator(part).first()).toBeVisible();
        expect(await bottomOf(page, part), `${part} on the first screen`).toBeLessThanOrEqual(height);
      }
      await expect(page.locator('.dep .plate')).toContainText('NOT A FORECAST');
      // The sign's destination and odds are the page's one bold moment: set larger than the status.
      const size = (sel: string) =>
        page
          .locator(sel)
          .first()
          .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
      const dest = await size('#next-title');
      for (const other of ['.ss-name', '.ss-phrase', '.dep .svc'])
        expect(dest, other).toBeGreaterThan(await size(other));
      if (departing)
        for (const other of ['.ss-name', '.ss-phrase'])
          expect(await size('.dep .big'), other).toBeGreaterThan(await size(other));
    });
  }
}

for (const width of [390, 1024, 1440]) {
  test(`the plot takes the width, and a NOW tag marks the edge (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openHistory(page);
    const plot = (await page.locator('.sc-plot').boundingBox())!;
    expect(plot.width).toBeGreaterThan(width * 0.7);
    const dot = await page.locator('.sc-dot').boundingBox();
    test.skip(!dot, 'no live reading today');
    const tag = (await page.locator('.sc-nowtag').boundingBox())!;
    await expect(page.locator('.sc-nowtag')).toHaveText(/^NOW \d$/);
    await expect(page.locator('.sc-nowtag b')).toHaveText((await page.locator(POSTED).textContent())!);
    expect(tag.x + tag.width).toBeLessThanOrEqual(plot.x + plot.width);
    expect(Math.abs(tag.x + tag.width - (dot!.x + dot!.width / 2))).toBeLessThan(24);
  });
}

test('scrubs with the keys, reads each hour into the readout, and never touches the posted level', async ({
  page,
}) => {
  await openHistory(page);
  const plot = page.locator('.sc-plot');
  const num = page.locator(POSTED);
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
  await openHistory(page);
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
    await openHistory(page);
    await page.locator('.sc-plot').scrollIntoViewIfNeeded();
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
  await openHistory(page);
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
  await page.locator('.sc-plot').scrollIntoViewIfNeeded();
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
  await withRecordedHistory(page, (data) => {
    const d = data as { to: number; pts: unknown[][] };
    const h = Math.floor((d.to - 30 * 3_600_000) / 3_600_000) * 3_600_000;
    d.pts = [['o', h, h + 3_600_000, 88, 0, 0, 2], ...d.pts.filter((p) => (p[1] as number) !== h)];
  });
  await openHistory(page);
  const rest = await page.locator(POSTED).textContent();
  const eq = await page.locator('.ph-fig').textContent();
  const plot = page.locator('.sc-plot');
  await plot.focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-r-what]')).toHaveText('v2 · old scale, not comparable');
  await expect(plot).not.toHaveAttribute('aria-valuetext', /88/);
  await expect(page.locator(POSTED)).toHaveText(rest!);
  await expect(page.locator('.ph-fig')).toHaveText(eq!);
  await expect(page.locator('.sc-readout')).toHaveAttribute('data-tone', 'old');
});

test('names the chart for assistive tech, describes it once, and keeps a table of every reading', async ({
  page,
}) => {
  await openHistory(page);
  const plot = page.locator('.sc-plot');
  await expect(plot).toHaveAccessibleName(/^DROPCON history, last 7 days/);
  await expect(plot).toHaveAccessibleDescription(/^DROPCON history, the lead score over the last 7 days/);
  // The summary is the slider's description only: its paragraph is out of the reading order.
  const id = (await plot.getAttribute('aria-describedby'))!;
  await expect(page.locator(`#${id}`)).toBeHidden();
  await expect(page.locator('.sc-plot[aria-label^="DROPCON history, the lead score"]')).toHaveCount(0);
  await expect(page.locator('.sc-table table').first()).toHaveCount(1);
});

test('with reduced motion the sweep and the split-flap are gone and nothing animates', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = async (sels: string[]) => {
    for (const sel of sels) {
      const el = page.locator(sel).first();
      if (!(await el.count())) continue;
      expect(await el.evaluate((e) => getComputedStyle(e).animationName), sel).toBe('none');
    }
  };
  await openDashboard(page);
  // The destination is never split into letters to turn over: it is the server's text, whole.
  await page.waitForTimeout(800);
  await expect(page.locator('#next-title .c')).toHaveCount(0);
  await still(['.ss', '.ss-num', '#next-title']);
  await openHistory(page);
  await expect(page.locator('.sc-sweep')).toBeHidden();
  await still(['.sc-ink', '.sc-dot', '.seg.on', '.sc-v3']);
  expect(
    await page
      .locator('.sc-dot')
      .evaluate((e) => getComputedStyle(e, '::after').animationName)
      .catch(() => 'none'),
  ).toBe('none');
});

/** Every label on the plot inside it and clear of the others, and the day axis clear of itself. */
async function labelReport(page: Page) {
  return page.locator('.sc-plot').evaluate((plot) => {
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
    const clashes = (list: { text: string; r: DOMRect }[]) => {
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i].r;
          const b = list[j].r;
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
            clash.push(`${list[i].text} × ${list[j].text}`);
        }
    };
    clashes(labels);
    const days = [...document.querySelectorAll('.sc-daylabel')]
      .filter(visible)
      .map((el) => ({ text: el.textContent!.trim(), r: el.getBoundingClientRect() }));
    clashes(days);
    const flags = [...plot.querySelectorAll('[data-label="flag"]')].filter(visible).length;
    return { zones, outside, clash, plotWidth: P.width, days: days.length, flags };
  });
}

for (const width of [360, 390, 700, 768, 1024, 1440]) {
  test(`fits the instrument at ${width}px: no page scroll, no label clipped or overlapping`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openHistory(page);
    await page.waitForFunction(() => document.querySelector('.scope.fitted') !== null);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const report = await labelReport(page);
    for (const z of report.zones)
      expect(z.over, `zone label "${z.text}" fits its zone`).toBeLessThanOrEqual(0.5);
    expect(report.outside).toEqual([]);
    expect(report.clash).toEqual([]);
    if (width <= 390) expect(report.plotWidth).toBeGreaterThan(width * 0.7);
  });
}

test.describe('at 200% zoom (1440x900 is 720x450 CSS pixels)', () => {
  test.use({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });
  test('the day axis and the plot labels do not collide, and the reading is whole', async ({ page }) => {
    await openHistory(page);
    await page.waitForFunction(() => document.querySelector('.scope.fitted') !== null);
    const report = await labelReport(page);
    expect(report.clash).toEqual([]);
    expect(report.days).toBeGreaterThanOrEqual(6);
    const what = page.locator('.sc-what');
    expect(await what.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
  });
});

// The Header reloads the page every 5 minutes; by then the fonts are cached, the ResizeObserver and
// document.fonts.ready land in one frame, and the label fitting runs once, not twice. Hold
// fonts.ready so that one fit is all there is, then reload with the fonts warm.
for (const width of [360, 390]) {
  test(`a reload with the fonts cached still places every launch name at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // With the history offline, a phone's card fills the plot and the names give way to it.
    await withRecordedHistory(page);
    await openHistory(page);
    await page.addInitScript(() => {
      Object.defineProperty(FontFaceSet.prototype, 'ready', { get: () => new Promise(() => {}) });
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('.scope.fitted') !== null);
    await page.waitForTimeout(300);
    const report = await labelReport(page);
    expect(report.clash).toEqual([]);
    expect(report.outside).toEqual([]);
    // Placed, not merely hidden: with launches in the week, at least one name fits on the plot.
    const launches = await page
      .locator('[data-scope]')
      .evaluate(
        (el) => (JSON.parse((el as HTMLElement).dataset.scope!) as { launches: unknown[] }).launches.length,
      );
    test.skip(!launches, 'no frontier launch in the last 7 days');
    expect(report.flags).toBeGreaterThan(0);
  });
}

for (const width of [768, 1024, 1280]) {
  test(`the readout shows the reading whole at ${width}px; the hint gives way`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openHistory(page);
    const what = page.locator('.sc-what');
    const clipped = () => what.evaluate((e) => e.scrollWidth - e.clientWidth);
    expect(await clipped()).toBeLessThanOrEqual(1);
    // The hint shows whole or not at all: never cut mid-word.
    const hint = await page.locator('[data-hint]').evaluate((h) => {
      const r1 = h.parentElement!.getBoundingClientRect();
      const b = h.getBoundingClientRect();
      return { onRow: b.top < r1.bottom - 1, whole: b.right <= r1.right + 1 };
    });
    if (hint.onRow) expect(hint.whole).toBe(true);
    await page.locator('.sc-plot').focus();
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowLeft');
    expect(await clipped()).toBeLessThanOrEqual(1);
  });
}

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('the readout carries a tap hint, gone after the first tap', async ({ page }) => {
    await openHistory(page);
    const hint = page.locator('[data-hint]');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(/TAP OR DRAG/);
    await page.locator('.sc-plot').scrollIntoViewIfNeeded();
    const box = (await page.locator('.sc-plot').boundingBox())!;
    await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await expect(page.locator('[data-r-when]')).not.toHaveText(/^NOW/);
    await expect(hint).toBeHidden();
  });
});
