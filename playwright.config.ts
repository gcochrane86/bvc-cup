import { defineConfig, devices } from '@playwright/test';

process.loadEnvFile('.env.local');

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // channel 'chrome': Playwright's bundled Chromium doesn't support macOS 13, so use the installed Chrome.
  use: { ...devices['Pixel 7'], channel: 'chrome', baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true },
});
