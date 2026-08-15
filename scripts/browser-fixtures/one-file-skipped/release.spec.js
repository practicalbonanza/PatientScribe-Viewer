import { expect, test } from '@playwright/test';

import { REQUIRED_TESTS } from '../../run-browser-tests-core.mjs';

/** The fourth required spec file, whole. See `extra.spec.js`. */
test('a fourth file that passes', () => {
  expect(true).toBe(true);
});

for (const title of REQUIRED_TESTS['release.spec.js'] ?? []) {
  test(title, () => {
    expect(title.length).toBeGreaterThan(0);
  });
}
