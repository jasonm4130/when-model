import { expect, test, type Page } from '@playwright/test';

/**
 * Layout and contrast rules that only matter on data the local Worker may not have today: a failed
 * source, an extrapolated read, crowded launch names on the instrument. Each test writes that state into the page
 * with the component's own scoped attribute, so the CSS under test is what styles it.
 */

async function openDashboard(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('heading', { name: 'DROPCON LEVEL' })).toBeVisible();
}

test('a failed source with a long, unbroken error stays inside SOURCE HEALTH on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // /about lists every source in full, unfolded.
  await page.goto('/about#health', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('#health ul.health')).toBeVisible();
  const fit = await page.locator('#health ul.health').evaluate((list) => {
    const li = list.querySelector('li')!.cloneNode(true) as HTMLElement;
    const muted = document.createElement('span');
    for (const a of li.attributes) if (a.name.startsWith('data-astro-cid')) muted.setAttribute(a.name, '');
    muted.className = 'muted';
    muted.textContent = ` — 503 https://hn.algolia.com/api/v1/search_by_date?query=${'leak%20'.repeat(80)}`;
    li.append(muted);
    list.append(li);
    return {
      page: document.documentElement.scrollWidth,
      overflow: li.scrollWidth - li.clientWidth,
      right: li.getBoundingClientRect().right,
    };
  });
  expect(fit.page).toBeLessThanOrEqual(390);
  expect(fit.overflow).toBeLessThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(390);
});

test('an extrapolated lab read is muted at full opacity, with AA contrast', async ({ page }) => {
  await page.goto('/labs', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const read = await page
    .locator('.lab .metric-value')
    .first()
    .evaluate((el) => {
      el.classList.add('extrap');
      const s = getComputedStyle(el);
      const rgb = (c: string) => (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
      const lum = ([r, g, b]: number[]) =>
        [r, g, b]
          .map((v) => v / 255)
          .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      // Lab rows sit straight on the paper background (#f1eee6).
      const text = lum(rgb(s.color));
      const bg = lum([241, 238, 230]);
      const probe = document.createElement('span');
      probe.style.color = 'var(--muted)';
      document.body.append(probe);
      const muted = getComputedStyle(probe).color;
      probe.remove();
      return {
        opacity: s.opacity,
        color: s.color,
        muted,
        ratio: (Math.max(text, bg) + 0.05) / (Math.min(text, bg) + 0.05),
      };
    });
  expect(read.opacity).toBe('1');
  expect(read.color).toBe(read.muted);
  expect(read.ratio).toBeGreaterThanOrEqual(4.5);
});

test('the instrument strokes its trace and never fills it', async ({ page }) => {
  await openDashboard(page);
  const lines = await page.locator('.sc-ink svg').evaluate((svg) => {
    const cid = [...svg.attributes].find((a) => a.name.startsWith('data-astro-cid'))!;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('class', 'sc-line');
    line.setAttribute(cid.name, '');
    line.setAttribute('d', 'M0 90H500V20H1000V60');
    svg.append(line);
    const s = getComputedStyle(line);
    return { fill: s.fill, stroke: s.stroke };
  });
  expect(lines.fill).toBe('none');
  expect(lines.stroke).toMatch(/url\("?#sc-level-ink"?\)/);
});

for (const width of [390, 1024, 1440]) {
  test(`crowded launch names are placed whole, inside the plot and clear of each other, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openDashboard(page);
    await page.waitForFunction(() => document.querySelector('.scope.fitted') !== null);
    // Six long names a few hours apart near the NOW edge, where labels read leftward.
    await page.locator('.sc-plot').evaluate((el) => {
      const cid = [...el.attributes].find((a) => a.name.startsWith('data-astro-cid'))!.name;
      for (let i = 0; i < 6; i++) {
        const f = document.createElement('span');
        f.setAttribute(cid, '');
        f.setAttribute('data-label', 'flag');
        f.className = `sc-flag${i > 2 ? ' flip' : ''}`;
        f.style.cssText = `left:${80 + i * 3}%; --row:0; --lab:#ff7a1a`;
        f.textContent = `✱ A very long frontier launch name ${i}`;
        el.append(f);
      }
    });
    // Any change to the plot's size makes the script place every label again, the injected ones
    // included: narrow the plot by a pixel.
    await page.locator('.sc-plot').evaluate((el) => ((el as HTMLElement).style.right = '1px'));
    await page.waitForTimeout(250);
    const placed = await page.locator('.sc-plot').evaluate((plot) => {
      const P = plot.getBoundingClientRect();
      return [...plot.querySelectorAll('.sc-flag')]
        .filter((f) => getComputedStyle(f).display !== 'none' && getComputedStyle(f).visibility !== 'hidden')
        .map((f) => {
          const r = f.getBoundingClientRect();
          return { left: r.left - P.left, right: r.right - P.left, top: r.top, bottom: r.bottom, w: P.width };
        });
    });
    for (const f of placed) {
      expect(f.left).toBeGreaterThanOrEqual(-0.5);
      expect(f.right).toBeLessThanOrEqual(f.w + 0.5);
    }
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        expect(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom).toBe(false);
      }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });

  test(`the scrubber's time tag stays on the day axis at the NOW edge at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openDashboard(page);
    // The instrument sits under the answer strip: bring it into view before aiming at it.
    await page.locator('.sc-plot').scrollIntoViewIfNeeded();
    const box = (await page.locator('.sc-plot').boundingBox())!;
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
    const tag = (await page.locator('[data-ctag]').boundingBox())!;
    const days = (await page.locator('.sc-days').boundingBox())!;
    expect(tag.x).toBeGreaterThanOrEqual(days.x - 0.5);
    expect(tag.x + tag.width).toBeLessThanOrEqual(days.x + days.width + 0.5);
    await expect(page.locator('[data-ctag]')).toHaveText('NOW');
  });
}

for (const width of [390, 360, 320]) {
  test(`the masthead fits: the wordmark on one line, the dateline inside the page, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 740 });
    await openDashboard(page);
    const mark = page.locator('header .wordmark');
    // "when" and "model" share a line top; the screen-reader tail is clipped away, so it is left out.
    const lines = await mark.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el.firstChild!);
      const tops = [...range.getClientRects(), ...el.querySelector('.m')!.getClientRects()].map((r) =>
        Math.round(r.top),
      );
      return new Set(tops).size;
    });
    expect(lines).toBe(1);
    for (const sel of ['.status-live', '.clock', '.refresh-toggle', '.wordmark']) {
      const box = (await page.locator(`header ${sel}`).boundingBox())!;
      expect(box.x, sel).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, sel).toBeLessThanOrEqual(width);
    }
    // The pause stays a 44px target however narrow the phone.
    expect((await page.locator('header .refresh-toggle').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('focus rings inside the feed and an opened lab row are unclipped', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const cases: [string, string][] = [
    ['/radar', '[data-feed] a'],
    ['/labs', '.lab .latest a'],
  ];
  for (const [path, selector] of cases) {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    // A lab's LATEST link is inside its fold: open it from the keyboard.
    if (path === '/labs') {
      await page.locator('.lab summary.lab-row').first().focus();
      await page.keyboard.press('Enter');
    }
    const link = page.locator(selector).first();
    if (!(await link.count())) continue;
    await link.focus();
    const clipped = await link.evaluate((el) => {
      const style = getComputedStyle(el);
      const ring = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      if (style.outlineStyle === 'none' || !(parseFloat(style.outlineWidth) > 0)) return 'no outline';
      const r = el.getBoundingClientRect();
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p);
        if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
        const box = p.getBoundingClientRect();
        if (
          r.left - ring < box.left - 0.5 ||
          r.right + ring > box.right + 0.5 ||
          r.top - ring < box.top - 0.5 ||
          r.bottom + ring > box.bottom + 0.5
        )
          return `clipped by ${p.className}`;
      }
      return false;
    });
    expect(clipped, selector).toBe(false);
  }
});

test('every scrolling table on /backtest is a named, focusable region with a scroll edge', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/backtest', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const scrollers = await page.locator('.table-scroll').evaluateAll((els) =>
    els.map((el) => ({
      role: el.getAttribute('role'),
      tabindex: el.getAttribute('tabindex'),
      label: el.getAttribute('aria-label') ?? '',
      layers: getComputedStyle(el).backgroundImage.split('linear-gradient').length - 1,
    })),
  );
  expect(scrollers.length).toBeGreaterThan(10);
  for (const s of scrollers) {
    expect(s).toMatchObject({ role: 'region', tabindex: '0' });
    expect(s.label.length).toBeGreaterThan(3);
    expect(s.layers).toBe(4);
  }
});
