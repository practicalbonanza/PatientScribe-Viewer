import { expect, test } from '@playwright/test';

import { REQUIRED_TESTS } from '../../run-browser-tests-core.mjs';

/**
 * The fourth required spec file's stand-in.
 *
 * Read from the policy rather than typed out beside it, like the other three:
 * a title added to the real suite's list is one this tree carries too, rather
 * than one that leaves this fixture failing for a reason it was never about.
 */
for (const title of REQUIRED_TESTS['release.spec.js'] ?? []) {
  test(title, () => {
    expect(title.length).toBeGreaterThan(0);
  });
}
