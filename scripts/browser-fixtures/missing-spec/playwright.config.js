import { defineConfig } from '@playwright/test';

/**
 * The passing tree, with the file that carries most of it collected out.
 *
 * The pattern a harness collects by is a one-line edit too, and it is the
 * quieter of the two: the files are all still there, the run still matches
 * tests, and the harness still exits 0 having asked none of what the missing
 * file holds. This is that edit — the corpus file present on disk and outside
 * what the run collects.
 */
export default defineConfig({
  testDir: '../passing',
  testMatch: '**/smoke.spec.js',
  projects: [{ name: 'chromium' }, { name: 'webkit' }],
});
