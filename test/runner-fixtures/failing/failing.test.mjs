/**
 * A fixture tree the fast-path runner must report as a failure.
 *
 * Enough passing tests to clear both floors, and one that fails. That is the
 * point of the arrangement: the run is refused because a test failed and for no
 * other reason, so the case pins the branch that reads the failure count rather
 * than being satisfied by a tree that was too small to count as a run.
 *
 * The failing test fails on an assertion rather than by throwing at import time,
 * because a file that will not load is a different thing to report.
 *
 * It fails inside a group, and that is what makes the two counts of this tree
 * disagree unless the runner reads what kind of thing each event is about. A
 * group that holds a failing test fails too, and reports it under the same event
 * name the test does — so one wrong answer arrives as two failure events, and a
 * count that took both at face value reported twice as many failures as the
 * reporter beside it did. One test gave one wrong answer, and that is the number
 * this tree is here to have reported.
 *
 * Nothing here is run by `npm run test:fast`, which collects `test/node/` only.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { MINIMUM_EXECUTED_TESTS } from '../../../scripts/run-node-tests-core.mjs';

for (let index = 0; index < MINIMUM_EXECUTED_TESTS; index += 1) {
  test(`a test that passes (${index})`, () => {});
}

describe('a group holding the test that fails', () => {
  test('a test that fails on purpose', () => {
    assert.equal('this fixture fails', 'on purpose, and this is how');
  });
});
