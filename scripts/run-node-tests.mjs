/**
 * The fast test path — the runner.
 *
 * Usage:
 *   node scripts/run-node-tests.mjs <suite>       runs a named suite — `fast` is
 *                                                 the corpus, `self` is every
 *                                                 check that is about another
 *                                                 check
 *   node scripts/run-node-tests.mjs --tree <dir>  runs <dir> — used by the
 *                                                 self-test to exercise this
 *                                                 file against fixture trees
 *                                                 with known answers
 *
 * Exit codes: 0 = the suite ran and passed, 1 = it did not.
 *
 * This replaces `node --test <file-or-pattern>`, which exits 0 when the pattern
 * matches nothing and exits 0 when everything it matched was skipped — so a
 * renamed directory, a moved file, or a one-word edit to a test left the whole
 * check green having run none of it. The files are collected here, by name, and
 * the run is judged against the floors in `run-node-tests-core.mjs`: enough
 * files, the ones the suite is built from among them, and enough tests actually
 * executed.
 *
 * Actually executed, and that word is doing work. A skipped test arrives as a
 * `test:pass` carrying a `skip` flag, and a pending one as a `test:pass`
 * carrying `todo`; counting the event rather than reading the flags made a
 * directory of nothing but skipped tests a run of the suite. Only passes that
 * are neither are counted.
 *
 * The manifest is checked from here as well, and that is not a stray concern:
 * this program and the browser path's runner are the two things `npm run check`
 * invokes that can read anything, so between them they are where a step of that
 * chain being replaced by something that does nothing is noticed. Silencing this
 * one leaves the browser path's runner asking, and silencing that one leaves
 * this one asking.
 *
 * Nothing in the suites this runs checks this file, and nothing can: this is
 * what decides whether their results are reported as a pass, so a test inside
 * one of them is a test whose own result this file gets to choose. Five one-line
 * edits here turned a failing run into an exit of 0. What checks it is
 * `run-node-tests-selftest.mjs`, which spawns this file as a child process
 * against fixture directories and reads the exit code from outside.
 *
 * Like the sink check, this file does its work on import and has no "am I the
 * entry module?" guard. The policy lives in the core module so that a test can
 * import it without starting a test run.
 */

import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { resolve } from 'node:path';

import { checkManifest, readManifest } from './check-manifest-core.mjs';
import { checkRun, collectTestFiles, SUITES, treeSuite } from './run-node-tests-core.mjs';

/**
 * @returns {import('./run-node-tests-core.mjs').Suite | null} The suite named on
 *   the command line, or `null` if it is not one of the two documented forms.
 */
function selectedSuite() {
  const args = process.argv.slice(2);
  const [first, second] = args;
  if (args.length === 1 && first !== undefined && Object.prototype.hasOwnProperty.call(SUITES, first)) {
    return SUITES[first] ?? null;
  }
  if (args.length === 2 && first === '--tree' && second !== undefined && second.length > 0) {
    return treeSuite(resolve(second));
  }
  return null;
}

const suite = selectedSuite();
if (suite === null) {
  process.stderr.write(`test:node — usage: run-node-tests.mjs <${Object.keys(SUITES).join('|')}> | --tree <dir>\n`);
  process.exit(1);
}

const files = collectTestFiles(suite);

let passed = 0;
let failed = 0;
/** @type {Map<string, number>} */
const executedByFile = new Map();

/** @param {string | undefined} file */
const countFor = (file) => {
  if (file !== undefined) {
    executedByFile.set(file, (executedByFile.get(file) ?? 0) + 1);
  }
};

const stream = run({ files, concurrency: 1 });
stream.on('test:pass', (event) => {
  // A skipped or pending test is not a test that ran. Both arrive here.
  if (event.skip === undefined && event.todo === undefined) {
    passed += 1;
    countFor(event.file);
  }
});
stream.on('test:fail', (event) => {
  failed += 1;
  countFor(event.file);
});

const reporter = new spec();
stream.compose(reporter).pipe(process.stdout);

stream.on('end', () => {
  const failures = [
    ...checkManifest(readManifest()),
    ...checkRun({ suite, files, passed, failed, executedByFile }),
  ];
  if (failures.length === 0) {
    process.stdout.write(`test:node — ${passed} test(s) in ${files.length} file(s) under ${suite.label}\n`);
    return;
  }
  process.exitCode = 1;
  for (const failure of failures) {
    process.stderr.write(`test:node — ${failure}\n`);
  }
});
