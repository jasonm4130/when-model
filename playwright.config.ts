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
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec wrangler dev --local --ip 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
