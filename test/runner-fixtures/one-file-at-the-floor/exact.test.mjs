/**
 * A file running exactly the fewest tests a collected file may run.
 *
 * The accepting half of the per-file floor's boundary. A floor is a constant and
 * a comparison, and every other fixture here puts counts to it that are nowhere
 * near the edge — either far above it or zero — so the constant was pinned and
 * the comparison was not. Read as "fewer than or equal to", this file is a file
 * that did not run.
 *
 * Nothing here is run by `npm run test:fast`, which collects `test/node/` only.
 */

import { test } from 'node:test';

import { MINIMUM_EXECUTED_TESTS_PER_FILE } from '../../../scripts/run-node-tests-core.mjs';

for (let index = 0; index < MINIMUM_EXECUTED_TESTS_PER_FILE; index += 1) {
  test(`a test that passes (${index})`, () => {});
}
