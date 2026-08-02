import { defineConfig } from '@playwright/test';

/**
 * The passing tree, plus one spec file that was collected and ran nothing.
 *
 * Everything the policy asks is satisfied here except one thing, and that is the
 * whole point of the tree: it is the smallest run the runner must refuse, so the
 * runner's own comparison between "no reasons to refuse" and "some" is put to
 * the boundary rather than only to a run with several reasons. A gate written as
 * "at most one reason is still a pass" reports this tree as a pass.
 */
export default defineConfig({
  testDir: '.',
  projects: [{ name: 'chromium' }, { name: 'webkit' }],
});
