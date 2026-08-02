/**
 * Self-test for the fast-path runner.
 *
 * The runner decides whether a suite's result is reported as a pass. That makes
 * it the one part of this harness a test inside those suites cannot check: a
 * runner asked to judge itself gets to choose its own verdict. With a real
 * defect present, changing one `process.exitCode = 1` to `= 0` printed a summary
 * saying a test had failed and exited 0, and five other one-line edits did the
 * same. Every one of them left `npm run check` green.
 *
 * So the runner is spawned as a real child process, pointed at fixture trees
 * with known answers, and judged on the exit code it hands back to the shell —
 * which is the only thing `npm run check` reads.
 *
 * The claims tested here, and why each one exists:
 *
 *   - A tree of passing tests exits 0. Without it, a runner that refused
 *     everything would satisfy every other case below.
 *   - A tree with a deliberately failing test exits 1, and does so because a
 *     test failed rather than because the tree was too small to be a run: the
 *     fixture clears both floors, and the pass count in the output is checked
 *     against the floor to say so.
 *   - A tree of nothing but skipped tests exits 1. A skipped test arrives as a
 *     pass carrying a `skip` flag, so a count that read the event and not the
 *     flag called ten skipped tests a run of the suite — and skipping out a file
 *     is one line.
 *   - And a tree of nothing but pending tests exits 1, which is the same claim
 *     about the other flag. `todo` is what a test is marked with while it is
 *     being written, and until this tree existed the reading of that flag could
 *     be dropped with no fixture noticing.
 *   - An empty tree and an absent tree both exit 1. This is the failure the
 *     runner was written for in the first place: `node --test` with a pattern
 *     that matches nothing exits 0.
 *   - A command line that is neither of the two documented forms exits 1. A
 *     runner that shrugged at an unrecognised argument and ran its default would
 *     turn a mistyped suite name into a suite nobody ran.
 *   - Each named suite is where the runner looks for it, and is built from the
 *     files it is meant to be built from. Those assertions used to live in the
 *     files they are meant to detect the loss of, which is no assertion at all —
 *     deleting `test/node/core.test.mjs` deleted the check that would have
 *     noticed.
 *   - A tree whose smallest file sits exactly on the per-file floor is accepted
 *     and one a single test below it is refused. Every other tree here is
 *     nowhere near that edge, so the floor's constant was held and the
 *     comparison beside it was not.
 *   - The count the runner reports is the count the test reporter saw. Every
 *     floor is a lower bound, so a counter that counted twice would clear all of
 *     them and no tree could tell.
 *
 * Which suite a named argument selects is not asked here, and cannot be: this
 * file is part of one of the two suites, so a case that ran the other one would,
 * under the very edit it exists to catch, be running itself. It is asked from
 * `test/core.spec.js`, in the suite neither of them runs.
 *
 * The fixture trees live under `test/runner-fixtures/`, which no named suite
 * collects: `fast` collects `test/node/` and `self` collects `scripts/`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkRun,
  collectTestFiles,
  MINIMUM_EXECUTED_TESTS,
  MINIMUM_EXECUTED_TESTS_PER_FILE,
  MINIMUM_TEST_FILES,
  SUITES,
  treeSuite,
} from './run-node-tests-core.mjs';

const FIXTURES = fileURLToPath(new URL('../test/runner-fixtures/', import.meta.url));
const RUNNER = fileURLToPath(new URL('./run-node-tests.mjs', import.meta.url));

/**
 * @param {string} name
 * @returns {string}
 */
function fixtureDir(name) {
  return join(FIXTURES, name);
}

/**
 * One of the named suites, or a failure saying it is gone.
 *
 * @param {string} name
 * @returns {import('./run-node-tests-core.mjs').Suite}
 */
function namedSuite(name) {
  const suite = SUITES[name];
  assert.ok(suite !== undefined, `the runner no longer knows a suite called ${name}`);
  return suite;
}

/**
 * Run the runner as a child process, the way a shell does.
 *
 * @param {string[]} args
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runRunner(args) {
  // This file is itself run by the runner, which marks its children so that a
  // nested test run refuses to execute any files. The child here is a test run,
  // and the whole point is that it executes some, so the mark is removed. Left
  // in place, every tree below reported zero tests and the exit codes said
  // nothing about the trees at all.
  const environment = { ...process.env };
  delete environment['NODE_TEST_CONTEXT'];

  const result = spawnSync(process.execPath, [RUNNER, ...args], { encoding: 'utf8', env: environment });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * @param {string} target
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runTree(target) {
  return runRunner(['--tree', target]);
}

/**
 * A count out of the reporter's own summary, so a fixture's adequacy is read
 * back rather than assumed.
 *
 * @param {string} output
 * @param {string} label
 * @returns {number}
 */
function reported(output, label) {
  const match = output.match(new RegExp(`${label} (\\d+)`));
  assert.ok(match !== null, `the run reported no ${label} count:\n${output}`);
  return Number(match[1]);
}

test('each suite is where the runner looks for it, and holds what it is built from', () => {
  // Outside the files it is about, on purpose. Renaming or deleting one of them
  // takes every assertion inside it along, and this is the assertion that is
  // supposed to notice.
  for (const [name, suite] of Object.entries(SUITES)) {
    const files = collectTestFiles(suite);
    assert.ok(files.length >= suite.minimumFiles, `the ${name} suite is ${files.length} file(s)`);

    const names = files.map((file) => basename(file));
    for (const required of suite.required) {
      assert.ok(names.includes(required), `${required} is not among the files the ${name} suite collects`);
    }
  }

  // And the two are different sets of files, so neither is quietly standing in
  // for the other.
  const fast = collectTestFiles(namedSuite('fast'));
  const self = collectTestFiles(namedSuite('self'));
  assert.equal(fast.filter((file) => self.includes(file)).length, 0);
});

test('the run policy answers the questions it is asked', () => {
  const suite = treeSuite(FIXTURES);
  const files = collectTestFiles(namedSuite('fast'));

  assert.deepEqual(checkRun({ suite, files, passed: MINIMUM_EXECUTED_TESTS, failed: 0 }), []);
  assert.ok(
    checkRun({ suite, files: [], passed: MINIMUM_EXECUTED_TESTS, failed: 0 }).some((line) => line.includes('test file')),
  );
  assert.ok(checkRun({ suite, files, passed: 0, failed: 0 }).some((line) => line.includes('did not run')));
  assert.ok(
    checkRun({ suite, files, passed: MINIMUM_EXECUTED_TESTS - 1, failed: 0 }).some((line) => line.includes('did not run')),
  );
  assert.ok(checkRun({ suite, files, passed: MINIMUM_EXECUTED_TESTS, failed: 1 }).some((line) => line.includes('failed')));

  // The per-file floor, which is the one a total is blind to: every file here
  // ran nothing, and the total says the suite ran.
  assert.ok(
    checkRun({
      suite,
      files,
      passed: MINIMUM_EXECUTED_TESTS,
      failed: 0,
      executedByFile: new Map(),
    }).some((line) => line.includes('that file did not run')),
  );
  assert.deepEqual(
    checkRun({
      suite,
      files,
      passed: MINIMUM_EXECUTED_TESTS,
      failed: 0,
      executedByFile: new Map(files.map((file) => [file, MINIMUM_EXECUTED_TESTS_PER_FILE])),
    }),
    [],
  );
  // And the count immediately below it, because a floor is a constant and a
  // comparison and the two cases above are nowhere near the edge: zero and
  // exactly the floor leave `fewer than the floor` and `fewer than one` telling
  // the same story. One short is where they part.
  assert.ok(
    checkRun({
      suite,
      files,
      passed: MINIMUM_EXECUTED_TESTS,
      failed: 0,
      executedByFile: new Map(files.map((file) => [file, MINIMUM_EXECUTED_TESTS_PER_FILE - 1])),
    }).some((line) => line.includes('that file did not run')),
    'a file one test short of the per-file floor was accepted',
  );

  // And the list of files a suite is built from is a floor of its own: a run of
  // enough files that are not those files is not a run of the suite.
  assert.ok(
    checkRun({
      suite: namedSuite('fast'),
      files: Array.from({ length: MINIMUM_TEST_FILES }, (_unused, index) => `/somewhere/else-${index}.test.mjs`),
      passed: MINIMUM_EXECUTED_TESTS,
      failed: 0,
    }).some((line) => line.includes('core.test.mjs')),
  );
});

test('a tree of passing tests exits 0', () => {
  const result = runTree(fixtureDir('passing'));

  assert.equal(result.status, 0, `the passing tree did not exit 0:\n${result.stdout}\n${result.stderr}`);
  assert.ok(result.stdout.includes('test:node — '), 'the passing run printed no summary line');
  assert.ok(reported(result.stdout, 'pass') >= MINIMUM_EXECUTED_TESTS);
});

test('a tree with a failing test exits 1, and for that reason', () => {
  const result = runTree(fixtureDir('failing'));

  assert.equal(result.status, 1, 'a failing test did not fail the run');
  assert.ok(result.stderr.includes('test(s) failed'), `the failing run gave a different reason:\n${result.stderr}`);

  // And it cleared both floors, so the exit code is about the failure rather
  // than about the tree being too small to count as a run.
  assert.ok(
    reported(result.stdout, 'pass') >= MINIMUM_EXECUTED_TESTS,
    'the failing fixture no longer clears the executed-test floor, so its exit code proves less than it should',
  );
  assert.ok(!result.stderr.includes('did not run'));
});

test('a tree of nothing but skipped tests exits 1', () => {
  const result = runTree(fixtureDir('skipped'));

  assert.equal(result.status, 1, 'a tree of skipped tests was accepted as a run of the suite');
  assert.ok(result.stderr.includes('did not run'), `the skipped run gave a different reason:\n${result.stderr}`);

  // And there were enough of them to satisfy a count that did not read the flag,
  // which is the count this case exists to refuse.
  assert.ok(
    reported(result.stdout, 'skipped') >= MINIMUM_EXECUTED_TESTS,
    'the skipped fixture no longer carries enough tests to clear the floor under a naive count',
  );
});

test('a tree of nothing but pending tests exits 1', () => {
  // The other half of a claim the counter already makes. A skipped test arrives
  // as a pass carrying a `skip` flag and a pending one as a pass carrying
  // `todo`, and the counter reads both — but every tree here was skipped rather
  // than pending, so the second reading could be dropped with nothing to notice.
  // `todo` is the mark a test acquires while it is being written, which makes a
  // suite of nothing but pending tests exactly the state a suite passes through.
  const result = runTree(fixtureDir('pending'));

  assert.equal(result.status, 1, 'a tree of pending tests was accepted as a run of the suite');
  assert.ok(result.stderr.includes('did not run'), `the pending run gave a different reason:\n${result.stderr}`);

  // And there were enough of them to satisfy a count that read the event and not
  // the flag, which is the count this case exists to refuse.
  assert.ok(
    reported(result.stdout, 'todo') >= MINIMUM_EXECUTED_TESTS,
    'the pending fixture no longer carries enough tests to clear the floor under a naive count',
  );
  assert.equal(reported(result.stdout, 'pass'), 0, 'a pending test was reported as a pass');
});

test('a tree with one file skipped out exits 1', () => {
  // The floor a total cannot hold. One file of this tree clears every count
  // there is across the tree, and the other ran nothing — which is what skipping
  // out one file of a suite looks like, and it is one word.
  const result = runTree(fixtureDir('one-file-skipped'));

  assert.equal(result.status, 1, 'a suite with one file skipped out was accepted as a run of it');
  assert.ok(
    result.stderr.includes('that file did not run'),
    `the part-skipped run gave a different reason:\n${result.stderr}`,
  );
  // And the tree cleared the total, so the exit code is about the file rather
  // than about the tree being short.
  assert.ok(reported(result.stdout, 'pass') >= MINIMUM_EXECUTED_TESTS);
  assert.ok(!result.stderr.includes('means the suite did not run'));
});

test('a tree whose smallest file sits on the per-file floor is judged by which side of it', () => {
  // The same boundary, through the runner rather than through the policy, so
  // what is held is the count the runner keeps as well as the comparison the
  // policy makes. The two trees differ by one test in one file, and every other
  // count in both of them is clear.
  //
  // The refusing half is also what an inflated count would clear: two tests
  // counted twice are four, which is over a floor of three, and no other fixture
  // here would notice — every floor is a lower bound, so counting twice only
  // ever helps.
  const accepted = runTree(fixtureDir('one-file-at-the-floor'));
  assert.equal(
    accepted.status,
    0,
    `a file running exactly the fewest tests allowed was refused:\n${accepted.stdout}\n${accepted.stderr}`,
  );

  const refused = runTree(fixtureDir('one-file-below-the-floor'));
  assert.equal(refused.status, 1, 'a file one test short of the per-file floor was accepted');
  assert.ok(
    refused.stderr.includes('that file did not run'),
    `the short-file run gave a different reason:\n${refused.stderr}`,
  );
  assert.ok(refused.stderr.includes('short.test.mjs'), 'the short file was not the one named');
  // And the tree cleared the total, so the exit code is about the file.
  assert.ok(!refused.stderr.includes('means the suite did not run'));
});

test('the count the runner reports is the count the reporter saw', () => {
  // Every floor is a lower bound, so a counter that counted each test twice
  // clears all of them twice over and no tree here says a word. The runner's own
  // summary is compared against the count the test reporter printed beside it —
  // two readings of the same run, one made by the thing being checked and one
  // not.
  const passing = runTree(fixtureDir('passing'));
  assert.equal(passing.status, 0, `${passing.stdout}\n${passing.stderr}`);

  const summarised = passing.stdout.match(/test:node — (\d+) test\(s\)/);
  assert.ok(summarised !== null, `the passing run printed no summary line:\n${passing.stdout}`);
  assert.equal(
    Number(summarised[1]),
    reported(passing.stdout, 'pass'),
    'the runner counted a different number of tests than the reporter did',
  );

  // And the failure counter, which is a second counter and has the same edge.
  const failing = runTree(fixtureDir('failing'));
  assert.equal(failing.status, 1);
  const counted = failing.stderr.match(/test:node — (\d+) test\(s\) failed/);
  assert.ok(counted !== null, `the failing run printed no failure count:\n${failing.stderr}`);
  assert.equal(
    Number(counted[1]),
    reported(failing.stdout, 'fail'),
    'the runner counted a different number of failures than the reporter did',
  );
});

test('an empty tree exits 1', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fast-path-selftest-'));
  try {
    const result = runTree(directory);

    assert.equal(result.status, 1, 'an empty tree was accepted as a run of the suite');
    assert.ok(result.stderr.includes('test file'), `the empty run gave a different reason:\n${result.stderr}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an absent tree exits 1', () => {
  // The original failure, and the reason the runner exists: `node --test` with a
  // pattern that matches nothing exits 0, so a renamed directory left the whole
  // command green having run none of it.
  const result = runTree(fixtureDir('does-not-exist'));

  assert.equal(result.status, 1, 'an absent tree was accepted as a run of the suite');
  assert.ok(result.stderr.includes('test file'), `the absent run gave a different reason:\n${result.stderr}`);
});

test('a command line that names no suite exits 1', () => {
  // A runner that fell back to a default when it did not recognise its argument
  // would turn a mistyped suite name into a suite nobody ran, reported as a
  // pass of whatever it ran instead.
  for (const args of [[], ['not-a-suite'], ['--tree'], ['fast', 'self'], ['--tree', '']]) {
    const result = runRunner(args);
    assert.equal(result.status, 1, `the runner accepted ${JSON.stringify(args)}`);
    assert.ok(result.stderr.includes('usage'), `the runner gave a different reason for ${JSON.stringify(args)}`);
  }
});
