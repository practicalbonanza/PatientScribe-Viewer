import { defineConfig } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Browser test harness.
 *
 * Both engines run from the start. The pair is not a convenience — a viewer that
 * behaves in one engine and not the other is a viewer that has not been tested,
 * and the behavioural checks this harness will carry are exactly the kind that
 * differ between engines.
 */
export default defineConfig({
  testDir: './test',
  // Scoped so the sink-check fixture corpus under test/ is never mistaken for a
  // browser test. Those files exist to be read as text, not run.
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: true,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
  },
  webServer: {
    command: `node scripts/serve.mjs ${PORT}`,
    url: `${BASE_URL}/index.html`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
