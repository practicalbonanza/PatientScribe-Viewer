import { expect, test } from '@playwright/test';

import { MINIMUM_EXECUTED_TESTS, REQUIRED_TESTS } from '../../run-browser-tests-core.mjs';

/** The corpus stand-in, whole. See `extra.spec.js` for the one thing wrong with this tree. */
for (let index = 0; index < MINIMUM_EXECUTED_TESTS; index += 1) {
  test(`a test that passes (${index})`, () => {
    expect(index).toBeGreaterThanOrEqual(0);
  });
}

for (const title of REQUIRED_TESTS['core.spec.js'] ?? []) {
  test(title, () => {
    expect(title.length).toBeGreaterThan(0);
  });
}
