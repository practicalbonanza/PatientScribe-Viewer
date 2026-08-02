/**
 * A fixture tree of nothing but skipped tests, which the fast-path runner must
 * report as a failure.
 *
 * A skipped test reaches the runner as a `test:pass` carrying a `skip` flag. A
 * count that took that event at face value counted these as a run of the fast
 * suite, so the whole of `test/node/` could be skipped out — one line at the top
 * of a file — and `npm run check` stayed green having executed none of it. That
 * is the same failure the floors were written for, arriving through the door
 * they left open.
 *
 * Two more than the floor, so this tree clears it under the naive count and
 * clears nothing under the honest one.
 *
 * Nothing here is run by `npm run test:fast`, which collects `test/node/` only.
 */

import { test } from 'node:test';

import { MINIMUM_EXECUTED_TESTS } from '../../../scripts/run-node-tests-core.mjs';

for (let index = 0; index < MINIMUM_EXECUTED_TESTS + 2; index += 1) {
  test.skip(`a test that is skipped (${index})`, () => {});
}
