/**
 * A fixture tree of nothing but empty groups, which the fast-path runner must
 * report as a failure.
 *
 * A group of tests reports itself to the runner under the same event name a test
 * does: it passes when everything inside it passed, and a group with nothing
 * inside it passes trivially. A count that took the event at face value therefore
 * counted this file as one test per group while it ran nothing at all, which is
 * the same failure the skipped and pending trees describe arriving through a
 * third door — and this one needs no flag on anything, only a file whose tests
 * have been wrapped and then emptied.
 *
 * Two more than the floor, so this tree clears it under a count that reads the
 * event and not the kind, and clears nothing under the honest one.
 *
 * Nothing here is run by `npm run test:fast`, which collects `test/node/` only.
 */

import { describe } from 'node:test';

import { MINIMUM_EXECUTED_TESTS } from '../../../scripts/run-node-tests-core.mjs';

for (let index = 0; index < MINIMUM_EXECUTED_TESTS + 2; index += 1) {
  describe(`a group holding no test (${index})`, () => {});
}
