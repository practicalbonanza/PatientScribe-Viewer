/**
 * A file running one test fewer than a collected file may.
 *
 * The refusing half of the per-file floor's boundary, and the half a count that
 * had been inflated would clear: two tests counted twice are four, which is over
 * a floor of three. Nothing else is wrong with this tree — see
 * `carries.test.mjs` — so the exit code it produces is about this file and the
 * one test it is short by.
 *
 * Nothing here is run by `npm run test:fast`, which collects `test/node/` only.
 */

import { test } from 'node:test';

import { MINIMUM_EXECUTED_TESTS_PER_FILE } from '../../../scripts/run-node-tests-core.mjs';

for (let index = 0; index < MINIMUM_EXECUTED_TESTS_PER_FILE - 1; index += 1) {
  test(`a test that passes (${index})`, () => {});
}
