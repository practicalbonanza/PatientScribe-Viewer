import { defineConfig } from '@playwright/test';

/**
 * The passing tree, with two of its three spec files collected out.
 *
 * The pattern a harness collects by is a one-line edit too, and it is the
 * quieter of the two: the files are all still there, the run still matches
 * tests, and the harness still exits 0 having asked none of what the missing
 * files hold. This is that edit — two spec files present on disk and outside
 * what the run collects, the one standing in for the corpus among them.
 */
export default defineConfig({
  testDir: '../passing',
  testMatch: '**/smoke.spec.js',
  projects: [{ name: 'chromium' }, { name: 'webkit' }],
});
