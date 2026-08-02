import { expect, test } from '@playwright/test';

import { REQUIRED_TESTS } from '../../run-browser-tests-core.mjs';

/** The second required spec file, whole. See `extra.spec.js`. */
test('a second file that passes', () => {
  expect(true).toBe(true);
});

for (const title of REQUIRED_TESTS['smoke.spec.js'] ?? []) {
  test(title, () => {
    expect(title.length).toBeGreaterThan(0);
  });
}
