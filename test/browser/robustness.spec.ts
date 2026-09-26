import { expect, test, type Page } from '@playwright/test';

/**
 * Layout and contrast rules that only matter on data the local Worker may not have today: a failed
 * source, an extrapolated read, a filled-in history strip. Each test writes that state into the page
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
  await openDashboard(page);
  const fit = await page
    .getByRole('heading', { name: 'SOURCE HEALTH' })
    .locator('xpath=ancestor::div[1]/following-sibling::ul[1]')
    .evaluate((list) => {
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
  await openDashboard(page);
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
      // The darkest a lab card gets: the page background under the panel's 86% tint.
      const text = lum(rgb(s.color));
      const bg = lum([13, 11, 29]);
      const probe = document.createElement('span');
      probe.style.color = 'var(--muted)';
      document.body.append(probe);
      const muted = getComputedStyle(probe).color;
      probe.remove();
      return { opacity: s.opacity, color: s.color, muted, ratio: (text + 0.05) / (bg + 0.05) };
    });
  expect(read.opacity).toBe('1');
  expect(read.color).toBe(read.muted);
  expect(read.ratio).toBeGreaterThanOrEqual(4.5);
});

test('the history strip strokes its edge lines and never fills them', async ({ page }) => {
  await openDashboard(page);
  const edges = await page.locator('.hstrip svg').evaluate((svg) => {
    const cid = [...svg.querySelector('rect.hband')!.attributes].find((a) =>
      a.name.startsWith('data-astro-cid'),
    )!;
    return [1, 2, 3, 4, 5].map((level) => {
      const edge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      edge.setAttribute('class', `hedge l${level}`);
      edge.setAttribute(cid.name, '');
      edge.setAttribute('d', 'M0 90 L500 20 L1000 60');
      svg.append(edge);
      const s = getComputedStyle(edge);
      return { level, fill: s.fill, stroke: s.stroke };
    });
  });
  for (const e of edges) {
    expect(e.fill, `hedge l${e.level}`).toBe('none');
    expect(e.stroke, `hedge l${e.level}`).toMatch(/^rgb/);
  }
});

for (const width of [390, 1024, 1440]) {
  test(`an old version's strip label never runs under the current one at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openDashboard(page);
    // v2 fills the first 8 of 30 days, as on the reviewer's seeded strip; v3 starts where it ends.
    const labels = await page.locator('.hstrip .hlevels').evaluate((levels) => {
      const plot = levels.parentElement!;
      const cid = [...levels.attributes].find((a) => a.name.startsWith('data-astro-cid'))!.name;
      const tag = (el: Element) => {
        el.setAttribute(cid, '');
        for (const child of el.children) tag(child);
        return el;
      };
      const make = (html: string) => {
        const box = document.createElement('div');
        box.innerHTML = html;
        return tag(box.firstElementChild!) as HTMLElement;
      };
      // The parts on the label's one visible line; anything that wrapped sits below it, clipped.
      const shown = (label: HTMLElement) => {
        const box = label.getBoundingClientRect();
        return [...label.querySelectorAll('span')]
          .filter((s) => s.getBoundingClientRect().top < box.bottom - 1)
          .map((s) => ({
            text: s.textContent,
            right: s.getBoundingClientRect().right,
            cut: s.getBoundingClientRect().right > box.right + 0.5,
          }));
      };
      const old = (maxWidth: string) =>
        make(
          `<span class="hver old" style="left:0%; max-width:${maxWidth}"><i></i><span>v2</span><span> · OLD SCORING</span></span>`,
        );
      const narrow = old('calc(26.667% - 6px)');
      const current = make('<span class="hver" style="left:26.667%">v3</span>');
      const wide = old('calc(80% - 6px)');
      // Narrower than "v2" itself, and a sliver as v2 ages out of the window.
      const tiny = old('14px');
      const sliver = old('calc(1% - 6px)');
      plot.append(narrow, current, wide, tiny, sliver);
      return {
        narrow: shown(narrow),
        currentLeft: current.getBoundingClientRect().left,
        wide: shown(wide)
          .map((s) => s.text)
          .join(''),
        tiny: shown(tiny).map((s) => s.text),
        sliver: shown(sliver).map((s) => s.text),
      };
    });
    for (const part of labels.narrow) {
      expect(part.right, part.text!).toBeLessThanOrEqual(labels.currentLeft);
      expect(part.cut, part.text!).toBe(false);
    }
    expect(labels.narrow[0]?.text).toBe('v2');
    expect(labels.wide).toBe('v2 · OLD SCORING');
    expect(labels.tiny).toEqual([]);
    expect(labels.sliver).toEqual([]);
  });
}

for (const width of [390, 360, 320]) {
  test(`keeps the title's bars on their words, and drops them below 380px, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 740 });
    await openDashboard(page);
    const line = page.locator('header .tiny.glow-m');
    const parts = await line.locator('.nw').evaluateAll((els) =>
      // A nested span splits an inline box into fragments on one line, so count distinct line tops.
      els.map((el) => ({
        text: (el as HTMLElement).innerText,
        lines: new Set([...el.getClientRects()].map((r) => Math.round(r.top))).size,
      })),
    );
    for (const p of parts) expect(p.lines, p.text).toBe(1);
    const bars = await line
      .locator('.bars')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).display));
    if (width >= 380) {
      expect(parts.map((p) => p.text)).toEqual(['▌▌ FRONTIER', 'INTELLIGENCE ▐▐']);
    } else {
      expect(bars).toEqual(['none', 'none']);
      expect(parts.map((p) => p.text)).toEqual(['FRONTIER', 'INTELLIGENCE']);
    }
    // At 360 the words fit on one row once the bars are gone.
    if (width === 360) {
      const tops = await line
        .locator('.nw')
        .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
      expect(new Set(tops).size).toBe(1);
    }
  });
}

test('focus rings inside the feed scroller and a lab card are unclipped', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDashboard(page);
  for (const selector of ['.feed.scroll-y a', '.lab .latest a']) {
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
