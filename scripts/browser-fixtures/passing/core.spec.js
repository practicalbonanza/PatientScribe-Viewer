import { expect, test } from '@playwright/test';

import { MINIMUM_EXECUTED_TESTS, REQUIRED_TESTS } from '../../run-browser-tests-core.mjs';

/**
 * Enough passing tests for one engine alone to clear the total floor, so a run
 * that lost an engine is refused for having lost the engine rather than for
 * being short. The count comes from the floor rather than from a number typed
 * beside it, so raising the floor cannot leave this tree quietly under it.
 */
for (let index = 0; index < MINIMUM_EXECUTED_TESTS; index += 1) {
  test(`a test that passes (${index})`, () => {
    expect(index).toBeGreaterThanOrEqual(0);
  });
}

/**
 * And the tests the policy names, under the names it names them by.
 *
 * Read from the policy rather than typed out beside it, for the same reason the
 * count above is: a test added to the real suite's list is one this tree carries
 * too, rather than one that leaves this fixture failing for a reason it was
 * never about. The whole tree is a stand-in for the real suite, down to the spec
 * file names, and what pins the titles themselves is `test/node/core.test.mjs`,
 * outside both.
 */
for (const title of REQUIRED_TESTS['core.spec.js'] ?? []) {
  test(title, () => {
    expect(title.length).toBeGreaterThan(0);
  });
}
