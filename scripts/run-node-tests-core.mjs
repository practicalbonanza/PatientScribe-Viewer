/**
 * The fast test path — the policy.
 *
 * Which files are a suite, and what counts as having run one. No running, no
 * reporting, no exit codes: this module is importable from a test without
 * starting a test run, which it has to be, because the tests that check this
 * policy are among the files the policy is about. The runner is
 * `run-node-tests.mjs`, and it is a separate file for that reason.
 *
 * Why any of this exists: `node --test "<pattern>"` exits 0 when the pattern
 * matches nothing, and exits 0 when everything it matched was skipped. Renaming
 * a directory, moving a file, mistyping a glob or skipping out a file left
 * `npm run check` and CI green having executed none of the suite, and reported
 * it as a pass. That is true of every suite invoked that way, which is why the
 * self-tests are collected here too rather than named one by one on a command
 * line: a check whose own invocation is `node --test <file>` is a check that a
 * one-word edit can silence.
 *
 * Three counting floors per suite, because no two of them are enough. A file
 * count catches the directory going missing but not a file that quietly stopped
 * registering tests; a total executed count catches that but is satisfied by one
 * enormous file; and a total large enough to matter is still cleared by a suite
 * that lost one file's worth of tests to a single `.skip`, which is exactly the
 * edit these floors are here to refuse. So a third floor is per file: every file
 * collected has to have run something. All three are floors rather than exact
 * numbers, sitting below what each suite carries, so adding a test does not have
 * to touch them.
 *
 * And a list of files that must be there, because a count of two is satisfied by
 * two files of anything. The list names what each suite is built from, so losing
 * one of them is a failure rather than a smaller number that still clears a
 * floor.
 *
 * Executed means executed. A skipped test reaches the runner as a pass carrying
 * a `skip` flag, so a count that took the event at face value counted eight
 * skipped tests as a run of the suite — which is the one thing these floors
 * exist to refuse. The runner counts passes that were neither skipped nor
 * pending, and `run-node-tests-selftest.mjs` spawns it against a directory of
 * nothing but skipped tests to say so.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';

/** Where the fast tests live. */
export const TEST_DIRECTORY = fileURLToPath(new URL('../test/node/', import.meta.url));

/** Where the self-tests live. */
export const SELFTEST_DIRECTORY = fileURLToPath(new URL('./', import.meta.url));

/** @see MINIMUM_EXECUTED_TESTS */
export const MINIMUM_TEST_FILES = 1;

/**
 * The fewest tests that can be called a run of the fast suite, and the floor an
 * ad-hoc tree is judged against.
 *
 * @see MINIMUM_TEST_FILES
 */
export const MINIMUM_EXECUTED_TESTS = 15;

/**
 * The fewest tests any one collected file may run.
 *
 * A file whose tests were all skipped is a file that did not run, and a suite's
 * total will absorb that quietly: skipping out one of three self-tests left the
 * other two clearing the total between them. Counted per file, it cannot.
 */
export const MINIMUM_EXECUTED_TESTS_PER_FILE = 3;

/**
 * A suite: where its files are, what they are called, and what counts as having
 * run them.
 *
 * @typedef {object} Suite
 * @property {string} label How the suite is named in a failure.
 * @property {string} directory
 * @property {string} suffix What a file of this suite is called.
 * @property {number} minimumFiles
 * @property {number} minimumExecuted
 * @property {number} minimumExecutedPerFile
 * @property {readonly string[]} required File names that must be among them.
 */

/**
 * The suites this runner knows by name.
 *
 * Two, and they are different kinds of thing on purpose. `fast` is the corpus
 * against the viewer. `self` is every check that is about another check — the
 * sink scan's, this runner's, and the browser path's — collected by name rather
 * than invoked one at a time, so that losing one of them is a file count short
 * rather than a line quietly gone from the manifest.
 *
 * @type {Readonly<Record<string, Suite>>}
 */
export const SUITES = Object.freeze({
  fast: Object.freeze({
    label: 'test/node/',
    directory: TEST_DIRECTORY,
    suffix: '.test.mjs',
    minimumFiles: MINIMUM_TEST_FILES,
    minimumExecuted: MINIMUM_EXECUTED_TESTS,
    minimumExecutedPerFile: MINIMUM_EXECUTED_TESTS_PER_FILE,
    required: Object.freeze(['core.test.mjs']),
  }),
  self: Object.freeze({
    label: 'scripts/',
    directory: SELFTEST_DIRECTORY,
    suffix: '-selftest.mjs',
    minimumFiles: 3,
    minimumExecuted: 20,
    minimumExecutedPerFile: MINIMUM_EXECUTED_TESTS_PER_FILE,
    required: Object.freeze([
      'check-sinks-selftest.mjs',
      'run-browser-tests-selftest.mjs',
      'run-node-tests-selftest.mjs',
    ]),
  }),
});

/**
 * An ad-hoc tree, judged against the default floors and required to hold
 * nothing in particular.
 *
 * Used only by the self-test, which points the runner at fixture directories
 * with known answers so its exit codes can be read from outside itself.
 *
 * @param {string} directory
 * @returns {Suite}
 */
export function treeSuite(directory) {
  return {
    label: directory,
    directory,
    suffix: '.test.mjs',
    minimumFiles: MINIMUM_TEST_FILES,
    minimumExecuted: MINIMUM_EXECUTED_TESTS,
    minimumExecutedPerFile: MINIMUM_EXECUTED_TESTS_PER_FILE,
    required: [],
  };
}

/**
 * The files of a suite, in a fixed order.
 *
 * Named explicitly rather than left to a glob the test runner expands, so that
 * "no files" is a value this program can look at rather than an empty argument
 * list a test runner shrugs at.
 *
 * @param {Suite} suite
 * @returns {string[]}
 */
export function collectTestFiles(suite) {
  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(suite.directory);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(suite.suffix))
    .sort()
    .map((name) => join(suite.directory, name));
}

/**
 * Was that a run of the suite?
 *
 * `passed` is tests that ran and passed. Skipped and pending tests are neither,
 * and must not be counted as either.
 *
 * @param {{ suite: Suite, files: readonly string[], passed: number, failed: number, executedByFile?: ReadonlyMap<string, number> }} run
 *   `executedByFile` is per collected file; a file absent from it ran nothing.
 * @returns {string[]} One line per reason it was not; empty means it was.
 */
export function checkRun(run) {
  /** @type {string[]} */
  const failures = [];

  if (run.files.length < run.suite.minimumFiles) {
    failures.push(
      `found ${run.files.length} test file(s) under ${run.suite.label}, and fewer than ${run.suite.minimumFiles} means the suite has moved or gone rather than passed`,
    );
  }

  const names = run.files.map((file) => basename(file));
  for (const required of run.suite.required) {
    if (!names.includes(required)) {
      failures.push(`${required} is not among the files ${run.suite.label} collects, so whatever it holds was not asked`);
    }
  }

  const executed = run.passed + run.failed;
  if (executed < run.suite.minimumExecuted) {
    failures.push(
      `executed ${executed} test(s), and fewer than ${run.suite.minimumExecuted} means the suite did not run rather than passed`,
    );
  }

  // And per file, which the total cannot say. A file whose tests were all
  // skipped contributes nothing and is invisible in a total the other files
  // clear on their own.
  if (run.executedByFile !== undefined) {
    for (const file of run.files) {
      const count = run.executedByFile.get(file) ?? 0;
      if (count < run.suite.minimumExecutedPerFile) {
        failures.push(
          `${basename(file)} executed ${count} test(s), and fewer than ${run.suite.minimumExecutedPerFile} means that file did not run rather than passed`,
        );
      }
    }
  }

  if (run.failed > 0) {
    failures.push(`${run.failed} test(s) failed`);
  }

  return failures;
}
