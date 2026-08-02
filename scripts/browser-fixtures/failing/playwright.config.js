import { defineConfig } from '@playwright/test';

/**
 * A fixture configuration with one deliberately failing test.
 *
 * It clears both counting floors, so the exit code it produces is about the
 * failure rather than about the tree being too small to count as a run.
 */
export default defineConfig({
  testDir: '.',
  projects: [{ name: 'chromium' }, { name: 'webkit' }],
});
