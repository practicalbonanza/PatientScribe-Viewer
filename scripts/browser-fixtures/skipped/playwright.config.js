import { defineConfig } from '@playwright/test';

/**
 * A fixture configuration whose every test is skipped.
 *
 * The harness reports a run of this as a success — nothing failed — which is
 * exactly the answer the floors exist to refuse. There are enough tests here to
 * satisfy a count that took the report at face value without reading each
 * test's outcome.
 */
export default defineConfig({
  testDir: '.',
  projects: [{ name: 'chromium' }, { name: 'webkit' }],
});
