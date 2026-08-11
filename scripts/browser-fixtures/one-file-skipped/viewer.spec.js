import { expect, test } from '@playwright/test';

import { REQUIRED_TESTS } from '../../run-browser-tests-core.mjs';

/** The third required spec file, whole. See `extra.spec.js`. */
test('a third file that passes', () => {
  expect(true).toBe(true);
});

for (const title of REQUIRED_TESTS['viewer.spec.js'] ?? []) {
  test(title, () => {
    expect(title.length).toBeGreaterThan(0);
  });
}
