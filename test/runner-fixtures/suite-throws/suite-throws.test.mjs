/**
 * A fixture tree whose tests all pass and whose run the fast-path runner must
 * still report as a failure.
 *
 * The failure that is not a failing test. A `describe` body is code, and code in
 * it runs while the file is being read rather than when anything is executed —
 * so a line that throws there reports a failure whose kind is a group and leaves
 * no failing test behind at all. The test reporter prints it, and prints
 * `fail 0` in the summary beside it, because the reporter counts leaf tests too.
 *
 * A runner that read the failure count through the same leaf test the pass count
 * is read through therefore saw nothing to refuse: this tree exited 0 with the
 * failure on the screen above the summary line. That is worse than a wrong
 * number, because everything the file did register ran and passed, so every
 * floor is clear and the whole of the disagreement is on the failing side.
 *
 * Enough passing tests to clear both floors, so the exit code this tree produces
 * is about the group and not about the tree being too small to count as a run.
 * A group whose hook throws rather than whose body does arrives identically —
 * same event, same kind, no test — so the one below stands for both.
 *
 * Nothing here is run by `npm run test:fast`, which collects `test/node/` only.
 */

import { describe, test } from 'node:test';

import { MINIMUM_EXECUTED_TESTS } from '../../../scripts/run-node-tests-core.mjs';

for (let index = 0; index < MINIMUM_EXECUTED_TESTS; index += 1) {
  test(`a test that passes (${index})`, () => {});
}

describe('a group whose body throws', () => {
  throw new Error('this fixture throws where a group is being built, on purpose');
});
