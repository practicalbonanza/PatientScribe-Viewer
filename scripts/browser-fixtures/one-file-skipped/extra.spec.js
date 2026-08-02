import { expect, test } from '@playwright/test';

/**
 * The one thing wrong with this tree: a third spec file, collected, running
 * nothing.
 *
 * The harness reports that as a success, because nothing failed. The per-file
 * floor is what refuses it, and it is the only reason this tree is refused —
 * every other floor is satisfied by the two files beside this one. So the run
 * comes back with exactly one reason, which is the count the runner's own
 * "anything to report?" comparison has an edge at.
 */
test.skip('a test that is skipped out', () => {
  expect(true).toBe(false);
});

test.skip('another test that is skipped out', () => {
  expect(true).toBe(false);
});
