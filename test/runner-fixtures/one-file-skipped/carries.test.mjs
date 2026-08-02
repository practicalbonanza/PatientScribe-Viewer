/**
 * The file that carries the tree's whole total, beside one that carries none.
 *
 * Together with `skipped.test.mjs` this is the tree a suite total cannot judge:
 * enough tests run here to clear every floor counted across the tree, while the
 * file next to it ran nothing at all. Skipping out one file of a suite is one
 * word, and it is what this pair is for.
 *
 * Nothing here is run by `npm run test:fast`, which collects `test/node/` only.
 */

import { test } from 'node:test';

import { MINIMUM_EXECUTED_TESTS } from '../../../scripts/run-node-tests-core.mjs';

for (let index = 0; index < MINIMUM_EXECUTED_TESTS; index += 1) {
  test(`a test that passes (${index})`, () => {});
}
