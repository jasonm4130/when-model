import { expect, test, type Page } from '@playwright/test';

/**
 * Layout and contrast rules that only matter on data the local Worker may not have today: a failed
 * source, a line with no times, each service level, crowded launch names on the instrument. Each test writes that state into the page
 * with the component's own scoped attribute, so the CSS under test is what styles it.
 */

async function openDashboard(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('heading', { name: /^Service status: / })).toBeVisible();
}

/** The level's week, drawn on /about under how the score adds up. */
async function openHistory(page: Page) {
  await page.goto('/about', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('heading', { name: 'Service history · last 7 days' })).toBeVisible();
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

type Contrast = (fg: string, bg: string) => number;
/** Installs `window.contrast(fg, bg)`: the WCAG ratio of two computed colours, read in the page. */
function installContrast() {
  const rgb = (c: string) => (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  const lum = ([r, g, b]: number[]) =>
    [r, g, b]
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  (window as unknown as { contrast: Contrast }).contrast = (fg, bg) => {
    const [x, y] = [lum(rgb(fg)), lum(rgb(bg))];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
}

test('a line with no times says so quietly, at full opacity and AA contrast, never as odds', async ({
  page,
}) => {
  for (const [path, sel, cls, text] of [
    ['/labs', '.lrow .odds', 'quiet', 'times unavailable'],
    ['/labs/anthropic', '.next .big', 'none-word', 'Times unavailable'],
  ] as const) {
    await page.addInitScript(installContrast);
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const read = await page
      .locator(sel)
      .first()
      .evaluate(
        (el, [c, t]) => {
          el.classList.add(c);
          el.textContent = t;
          const ratio = (window as unknown as { contrast: Contrast }).contrast;
          const s = getComputedStyle(el);
          const probe = document.createElement('span');
          probe.style.color = 'var(--ink-2)';
          document.body.append(probe);
          const ink2 = getComputedStyle(probe).color;
          probe.remove();
          return {
            opacity: s.opacity,
            color: s.color,
            ink2,
            ratio: ratio(s.color, getComputedStyle(document.body).backgroundColor),
          };
        },
        [cls, text] as const,
      );
    expect(read.opacity, path).toBe('1');
    expect(read.color, path).toBe(read.ink2);
    expect(read.ratio, path).toBeGreaterThanOrEqual(4.5);
  }
});

// Today's data shows one level; each treatment is written into the status strip with its own class.
for (const [level, treatment, name] of [
  [1, 'alert', 'RELEASE SURGE'],
  [3, 'notice', 'GPU FANS SPINNING'],
  [5, 'calm', 'QUIET ORBIT'],
] as const) {
  test(`posts level ${level} on its ${treatment} treatment with 7:1 text and one lit rung`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.addInitScript(installContrast);
    await openDashboard(page);
    const out = await page.locator('section.ss').evaluate(
      (ss, [lvl, cls, nm]) => {
        ss.setAttribute('class', ss.getAttribute('class')!.replace(/is-[a-z]+/, `is-${cls}`));
        ss.querySelector('.ss-name')!.lastChild!.textContent = nm;
        ss.querySelector('.ss-num')!.textContent = String(lvl);
        for (const r of ss.querySelectorAll('.rung')) r.classList.toggle('on', r.textContent === String(lvl));
        for (const r of ss.querySelectorAll('.rung')) r.classList.remove('held');
        const ratio = (window as unknown as { contrast: Contrast }).contrast;
        const ground = getComputedStyle(ss).backgroundColor;
        const of = (sel: string) => ratio(getComputedStyle(ss.querySelector(sel)!).color, ground);
        const on = ss.querySelector('.rung.on')!;
        const r = getComputedStyle(on);
        return {
          ground,
          name: of('.ss-name'),
          phrase: of('.ss-phrase'),
          detail: of('.ss-detail'),
          meta: of('.ss-meta'),
          rung: ratio(r.color, r.backgroundColor),
          lit: ss.querySelectorAll('.rung.on').length,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      },
      [level, treatment, name] as const,
    );
    for (const k of ['name', 'phrase', 'detail', 'meta'] as const)
      expect(out[k], k).toBeGreaterThanOrEqual(7);
    expect(out.rung).toBeGreaterThanOrEqual(4.5);
    expect(out.lit).toBe(1);
    expect(out.overflow).toBeLessThanOrEqual(0);
    // Every level is a board of its own, never the page's paper: the calm one is paper-2, so level 5
    // does not read as part of the header.
    expect(out.ground).not.toBe(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
    if (treatment === 'calm') expect(out.ground).toBe('rgb(235, 232, 223)');
  });
}

test('the instrument strokes its trace and never fills it', async ({ page }) => {
  await openHistory(page);
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
  // One ink at every level: the band tints carry the level, the NOW tag is the one yellow mark.
  expect(lines.stroke).toBe('rgb(17, 17, 17)');
});

for (const width of [390, 1024, 1440]) {
  test(`crowded launch names are placed whole, inside the plot and clear of each other, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openHistory(page);
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
        f.textContent = `A very long frontier launch name ${i}`;
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
    await openHistory(page);
    // The instrument sits under the arithmetic: bring it into view before aiming at it.
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
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    });
    expect(lines).toBe(1);
    for (const sel of ['.clock', '.wordmark']) {
      const box = (await page.locator(`header ${sel}`).boundingBox())!;
      expect(box.x, sel).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, sel).toBeLessThanOrEqual(width);
    }
    // The pause, in the footer, stays a 44px target however narrow the phone.
    expect((await page.locator('footer .refresh-toggle').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test("focus rings inside the feed, the network and a line's announcements are unclipped", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const cases: [string, string][] = [
    ['/radar', '[data-feed] a'],
    ['/labs', 'a.lrow'],
    ['/labs/anthropic', '.ann a'],
  ];
  for (const [path, selector] of cases) {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
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

test('every table on /backtest is a named, focusable region: stacked on a phone, or scrolling with an edge', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/backtest', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  // Open every fold, so the tables lay out as a reader would see them.
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  const scrollers = await page.locator('.table-scroll').evaluateAll((els) =>
    els.map((el) => ({
      role: el.getAttribute('role'),
      tabindex: el.getAttribute('tabindex'),
      label: el.getAttribute('aria-label') ?? '',
      stacked: el.classList.contains('stacked'),
      fits: el.scrollWidth <= el.clientWidth + 1,
      layers: getComputedStyle(el).backgroundImage.split('linear-gradient').length - 1,
    })),
  );
  expect(scrollers.length).toBeGreaterThan(10);
  for (const s of scrollers) {
    expect(s).toMatchObject({ role: 'region', tabindex: '0' });
    expect(s.label.length).toBeGreaterThan(3);
    // A table stacked into rows on a phone has nothing to scroll; one that still scrolls shows its edge.
    if (s.stacked) expect(s.fits, s.label).toBe(true);
    else expect(s.layers, s.label).toBe(4);
  }
});
