/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default getViteConfig(
  {
    test: {
      include: ['test/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/env.d.ts'],
        thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
      },
    },
  },
  {
    // The production entrypoint imports the app graph before V8 starts collecting test coverage.
    adapter: cloudflare({ configPath: './wrangler.vitest.jsonc', imageService: 'passthrough' }),
  },
);
