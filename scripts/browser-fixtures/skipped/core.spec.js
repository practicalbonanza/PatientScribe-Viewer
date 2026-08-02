import { expect, test } from '@playwright/test';

import { MINIMUM_EXECUTED_TESTS, REQUIRED_TESTS } from '../../run-browser-tests-core.mjs';

for (let index = 0; index < MINIMUM_EXECUTED_TESTS; index += 1) {
  test.skip(`a test that is skipped (${index})`, () => {
    expect(index).toBe(-1);
  });
}

// The named tests, registered and skipped: this tree is what a suite looks like
// when every question in it is still written down and none of them is asked.
for (const title of REQUIRED_TESTS['core.spec.js'] ?? []) {
  test.skip(title, () => {
    expect(title.length).toBe(-1);
  });
}
