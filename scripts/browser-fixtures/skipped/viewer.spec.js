import { expect, test } from '@playwright/test';

import { REQUIRED_TESTS } from '../../run-browser-tests-core.mjs';

test.skip('a third file that is skipped', () => {
  expect(true).toBe(false);
});

for (const title of REQUIRED_TESTS['viewer.spec.js'] ?? []) {
  test.skip(title, () => {
    expect(title.length).toBe(-1);
  });
}
