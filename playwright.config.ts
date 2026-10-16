import { defineConfig, devices } from '@playwright/test';

const env = (globalThis as { process?: { env?: { CI?: string; E2E_PORT?: string } } }).process?.env;
const isCI = Boolean(env?.CI);
/** Parallel worktrees each need their own Worker; reusing another checkout's server tests the wrong code. */
const port = Number(env?.E2E_PORT ?? 8787);

export default defineConfig({
  testDir: './test/browser',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: isCI ? 1 : 0,
  reporter: isCI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // Keep evidence from the first failing attempt too: a flake that fails once and passes on the
    // retry (the intermittent `browser` failure that could not be reproduced) otherwise leaves nothing.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // The Worker's local D1 gets the schema and a seeded week of readings first, so the home page
  // draws its service history from a real read (test/browser/fixtures/seed-history.sql). CI=1 keeps
  // the migration step from asking for confirmation.
  webServer: {
    command: [
      'CI=1 pnpm exec wrangler d1 migrations apply whenmodel-history --local',
      'pnpm exec wrangler d1 execute whenmodel-history --local --file test/browser/fixtures/seed-history.sql',
      `pnpm exec wrangler dev --local --ip 127.0.0.1 --port ${port}`,
    ].join(' && '),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
