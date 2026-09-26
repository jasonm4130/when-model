import type { APIRoute } from 'astro';
export const GET: APIRoute = () =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://whenmodel.com/</loc><changefreq>hourly</changefreq></url><url><loc>https://whenmodel.com/backtest</loc><changefreq>weekly</changefreq></url></urlset>`,
    { headers: { 'content-type': 'application/xml' } },
  );
