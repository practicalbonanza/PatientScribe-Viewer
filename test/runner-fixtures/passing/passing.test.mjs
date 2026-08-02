/**
 * A fixture tree the fast-path runner must report as a pass.
 *
 * It is here so that the runner's other answers are answers rather than the only
 * thing it can say. A runner that exited 1 on everything would satisfy every
 * other case in `scripts/run-node-tests-selftest.mjs`.
 *
 * The count comes from the floor rather than from a number typed beside it, so
 * raising the floor cannot leave this tree quietly under it.
 *
 * Nothing here is run by `npm run test:fast`, which collects `test/node/` only.
 */

import { test } from 'node:test';

import { MINIMUM_EXECUTED_TESTS } from '../../../scripts/run-node-tests-core.mjs';

for (let index = 0; index < MINIMUM_EXECUTED_TESTS; index += 1) {
  test(`a test that passes (${index})`, () => {});
}
