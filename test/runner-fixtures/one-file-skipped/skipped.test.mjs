/**
 * The file that ran nothing. See `carries.test.mjs` beside it.
 *
 * Nothing here is run by `npm run test:fast`, which collects `test/node/` only.
 */

import { test } from 'node:test';

import { MINIMUM_EXECUTED_TESTS_PER_FILE } from '../../../scripts/run-node-tests-core.mjs';

for (let index = 0; index < MINIMUM_EXECUTED_TESTS_PER_FILE + 2; index += 1) {
  test.skip(`a test that is skipped (${index})`, () => {});
}
