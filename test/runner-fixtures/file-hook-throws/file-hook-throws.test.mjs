/**
 * A fixture tree whose tests all pass and whose failure belongs to no group at
 * all.
 *
 * The sibling of `suite-throws/`, and the case that one cannot hold. A hook
 * written at the top of a file belongs to the file rather than to any group, so
 * when one throws, the failure is reported under the file's own name and carries
 * no kind whatsoever — not `test`, not `suite`, absent. A group's hook is not
 * this: that one reports its kind as a group, which is why the tree beside this
 * one stands for the group's body and the group's hook together and cannot stand
 * for this.
 *
 * What it is here to pin is which way round the runner's leaf test is written.
 * `is it a test` refuses an event carrying no kind; `is it not a suite` admits
 * one. Every other tree in this directory is read identically by both spellings,
 * because every event in them carries a kind — so the residual saying no fixture
 * could tell the two apart was true of every fixture that existed and false of
 * this one.
 *
 * Both spellings refuse this tree, which is the point rather than a weakness:
 * the strict one refuses it as a failure that was not a test, the loose one as a
 * failing test. What the strict one gets right is the count — the runner saw no
 * failing test here, and says so.
 *
 * Enough passing tests to clear both floors, so the exit code is about the hook
 * and not about the tree being too small to count as a run.
 *
 * Nothing here is run by `npm run test:fast`, which collects `test/node/` only.
 */

import { after, test } from 'node:test';

import { MINIMUM_EXECUTED_TESTS } from '../../../scripts/run-node-tests-core.mjs';

for (let index = 0; index < MINIMUM_EXECUTED_TESTS; index += 1) {
  test(`a test that passes (${index})`, () => {});
}

after(() => {
  throw new Error('this fixture throws in a hook belonging to the file, on purpose');
});
