/**
 * The file that carries the tree's total, beside one that runs exactly the
 * fewest tests a collected file may run.
 *
 * See `exact.test.mjs`. The pair is one half of a boundary: this tree must be
 * accepted, and `one-file-below-the-floor/` next to it must not, and the two
 * differ by one test.
 *
 * Nothing here is run by `npm run test:fast`, which collects `test/node/` only.
 */

import { test } from 'node:test';

import { MINIMUM_EXECUTED_TESTS } from '../../../scripts/run-node-tests-core.mjs';

for (let index = 0; index < MINIMUM_EXECUTED_TESTS; index += 1) {
  test(`a test that passes (${index})`, () => {});
}
