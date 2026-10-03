import { defineConfig, devices } from '@playwright/test';

process.loadEnvFile('.env.local');
// Lets the test see (and block) requests the service worker makes.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

// Checks the service worker, which only runs in a built app: build with the dev project's keys, then preview.
// Run: npx playwright test -c tests/sw/playwright.sw.config.ts
export default defineConfig({
  testDir: '.',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: { ...devices['Pixel 7'], channel: 'chrome', baseURL: 'http://localhost:4173', serviceWorkers: 'allow' },
  webServer: { command: 'npm run build && npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 180_000 },
});
