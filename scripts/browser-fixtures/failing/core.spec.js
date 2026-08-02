import { expect, test } from '@playwright/test';

import { MINIMUM_EXECUTED_TESTS, REQUIRED_TESTS } from '../../run-browser-tests-core.mjs';

for (let index = 0; index < MINIMUM_EXECUTED_TESTS; index += 1) {
  test(`a test that passes (${index})`, () => {
    expect(index).toBeGreaterThanOrEqual(0);
  });
}

// The tests the policy names, so this tree is refused for the failure below and
// for nothing else. See `../passing/core.spec.js`.
for (const title of REQUIRED_TESTS['core.spec.js'] ?? []) {
  test(title, () => {
    expect(title.length).toBeGreaterThan(0);
  });
}

test('a test that fails', () => {
  expect(1).toBe(2);
});
