import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000, toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.02 } },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  webServer: {
    command: 'node tests/e2e/server.mjs',
    port: 4173,
    reuseExistingServer: true,
  },
});
