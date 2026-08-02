import { defineConfig } from '@playwright/test';

/**
 * The passing tree, in one engine.
 *
 * Removing an engine from a harness configuration is a one-line edit, and the
 * suite that remains still passes — in one engine. This fixture is that edit,
 * made where it can be judged: the same spec files, enough of them to clear
 * every counting floor on their own, and only one engine to run them.
 *
 * The run is refused twice over, and both refusals are the same fact: no test
 * executed in the second engine, so the per-engine count is zero and every named
 * test is missing from it. Nothing else is wrong with the tree.
 */
export default defineConfig({
  testDir: '../passing',
  projects: [{ name: 'chromium' }],
});
