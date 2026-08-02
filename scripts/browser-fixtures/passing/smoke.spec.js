import { expect, test } from '@playwright/test';

import { REQUIRED_TESTS } from '../../run-browser-tests-core.mjs';

/** The second spec file, so the fixture clears the spec-file floor as well. */
test('a second file that passes', () => {
  expect(true).toBe(true);
});

/** And what the policy names in this file. See `core.spec.js` beside it. */
for (const title of REQUIRED_TESTS['smoke.spec.js'] ?? []) {
  test(title, () => {
    expect(title.length).toBeGreaterThan(0);
  });
}
