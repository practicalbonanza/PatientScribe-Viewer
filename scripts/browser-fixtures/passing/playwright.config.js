import { defineConfig } from '@playwright/test';

/**
 * A fixture configuration the browser-path runner must report as a pass.
 *
 * It is here so that the runner's other answers are answers rather than the only
 * thing it can say. A runner that exited 1 on everything would satisfy every
 * other case in `scripts/run-browser-tests-selftest.mjs`.
 *
 * Two engines, named the same as the real ones, and no browser is started: the
 * tests below never ask for a page, so what is exercised is the harness's
 * collection, execution and reporting — which is all the floors are read from.
 *
 * Nothing here is run by `npm run test:smoke`, which collects `test/` only. The
 * fixture corpus sits outside that directory rather than being excluded from it
 * by a rule, because a rule that can exclude a fixture is a rule that can
 * exclude a spec file.
 */
export default defineConfig({
  testDir: '.',
  projects: [{ name: 'chromium' }, { name: 'webkit' }],
});
