/**
 * Renders the site's icons and social card from the HTML templates beside this script, in the
 * self-hosted fonts, so they match the pages: `pnpm brand`. favicon.svg is hand-drawn; this writes
 * the raster set. Run it after a change to the templates or to LINE_BULLETS.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { LABS } from '../../src/domain/lab.ts';
import { lineBullet } from '../../src/ui/lines.ts';

const here = (f) => pathToFileURL(fileURLToPath(new URL(f, import.meta.url))).href;
const out = (f) => fileURLToPath(new URL(`../../public/${f}`, import.meta.url));

/** An .ico holding one PNG, which every current browser reads. */
function ico(png, size) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(1, 4); // one image
  head.writeUInt8(size % 256, 6);
  head.writeUInt8(size % 256, 7);
  head.writeUInt8(0, 8); // no palette
  head.writeUInt8(0, 9);
  head.writeUInt16LE(1, 10); // planes
  head.writeUInt16LE(32, 12); // bits per pixel
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18); // offset of the PNG
  return Buffer.concat([head, png]);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const icon = async (size) => {
    await page.setViewportSize({ width: size, height: size });
    await page.goto(`${here('icon.html')}?size=${size}`);
    return page.locator('#icon').screenshot();
  };
  await writeFile(out('apple-touch-icon.png'), await icon(180));
  await writeFile(out('favicon.ico'), ico(await icon(48), 48));

  const bullets = LABS.map((l) => lineBullet(l.id));
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.goto(`${here('og-card.html')}?bullets=${encodeURIComponent(JSON.stringify(bullets))}`);
  await page.evaluate(() => document.fonts.ready);
  await writeFile(out('og-card-v3.png'), await page.screenshot());
} finally {
  await browser.close();
}
