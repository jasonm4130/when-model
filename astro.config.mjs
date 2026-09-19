// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://whenmodel.com',
  output: 'server',
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
  // Never inline component scripts: the CSP in src/middleware.ts allows 'self' only.
  vite: { build: { assetsInlineLimit: 0 } },
});
