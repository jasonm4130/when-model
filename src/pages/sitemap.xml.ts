import type { APIRoute } from 'astro';
import { LABS } from '../domain/lab';
import { labPath } from '../ui/site';

/** Every page, a lab's page for each lab in the registry. */
const PAGES: readonly [path: string, changefreq: string][] = [
  ['/', 'hourly'],
  ['/labs', 'hourly'],
  ...LABS.map((lab) => [labPath(lab.id), 'hourly'] as [string, string]),
  ['/markets', 'hourly'],
  ['/radar', 'hourly'],
  ['/about', 'daily'],
  ['/backtest', 'weekly'],
];

export const GET: APIRoute = () =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${PAGES.map(
      ([path, freq]) => `<url><loc>https://whenmodel.com${path}</loc><changefreq>${freq}</changefreq></url>`,
    ).join('')}</urlset>`,
    { headers: { 'content-type': 'application/xml' } },
  );
