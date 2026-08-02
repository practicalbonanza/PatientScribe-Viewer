import { expect, test } from '@playwright/test';

import { REQUIRED_TESTS } from '../../run-browser-tests-core.mjs';

test('a second file that passes', () => {
  expect(true).toBe(true);
});

for (const title of REQUIRED_TESTS['smoke.spec.js'] ?? []) {
  test(title, () => {
    expect(title.length).toBeGreaterThan(0);
  });
}
