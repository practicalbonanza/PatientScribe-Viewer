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
 * It also carries groups, in both arrangements, and that is what makes the two
 * counts of this tree disagree unless the runner reads what kind of thing each
 * event is about. A group reports itself under the same event name a test does,
 * so the empty ones below are events carrying no test that ran, and the tests
 * inside the group below are tests that ran and are not at the top of the file.
 * A count that took every event at face value read this tree as three tests more
 * than the reporter beside it did; a count that read only the top level read it
 * as three fewer.
 *
 * Nothing here is run by `npm run test:fast`, which collects `test/node/` only.
 */

import { describe, test } from 'node:test';

import { MINIMUM_EXECUTED_TESTS, MINIMUM_EXECUTED_TESTS_PER_FILE } from '../../../scripts/run-node-tests-core.mjs';

for (let index = 0; index < MINIMUM_EXECUTED_TESTS; index += 1) {
  test(`a test that passes (${index})`, () => {});
}

for (let index = 0; index < 2; index += 1) {
  describe(`a group holding no test (${index})`, () => {});
}

describe('a group holding tests that pass', () => {
  for (let index = 0; index < MINIMUM_EXECUTED_TESTS_PER_FILE; index += 1) {
    test(`a test that passes inside a group (${index})`, () => {});
  }
});
