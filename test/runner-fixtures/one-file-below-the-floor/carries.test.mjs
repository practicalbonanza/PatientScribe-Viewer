/**
 * The file that carries the tree's total, beside one that runs one test fewer
 * than a collected file may.
 *
 * See `short.test.mjs`. This tree clears every count there is across it, so the
 * exit code it produces is about the one file rather than about the tree.
 *
 * Nothing here is run by `npm run test:fast`, which collects `test/node/` only.
 */

import { test } from 'node:test';

import { MINIMUM_EXECUTED_TESTS } from '../../../scripts/run-node-tests-core.mjs';

for (let index = 0; index < MINIMUM_EXECUTED_TESTS; index += 1) {
  test(`a test that passes (${index})`, () => {});
}
