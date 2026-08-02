/**
 * A fixture tree of nothing but pending tests, which the fast-path runner must
 * report as a failure.
 *
 * The other half of a claim the runner already makes and only half of which was
 * asked for. A skipped test reaches the runner as a `test:pass` carrying a
 * `skip` flag and a pending one as a `test:pass` carrying `todo`, and the
 * counter reads both flags — but every tree here was skipped rather than
 * pending, so dropping the second half of that reading changed nothing any
 * fixture could see, and a suite of nothing but pending tests was a run of it.
 *
 * `todo` is what a test written but not yet made to work is marked with, which
 * is exactly the mark a suite acquires while it is being changed. Two more than
 * the floor, so this tree clears it under a count that reads only the first flag
 * and clears nothing under the honest one.
 *
 * Nothing here is run by `npm run test:fast`, which collects `test/node/` only.
 */

import { test } from 'node:test';

import { MINIMUM_EXECUTED_TESTS } from '../../../scripts/run-node-tests-core.mjs';

for (let index = 0; index < MINIMUM_EXECUTED_TESTS + 2; index += 1) {
  test.todo(`a test that is pending (${index})`, () => {});
}
