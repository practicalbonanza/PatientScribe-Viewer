/**
 * The fast test path — the runner.
 *
 * Usage:
 *   node scripts/run-node-tests.mjs <suite>       runs a named suite — `fast` is
 *                                                 the corpus, `self` is every
 *                                                 check that is about another
 *                                                 check
 *   node scripts/run-node-tests.mjs --tree <dir> [<file>::<title> ...]
 *                                                 runs <dir> — used by the
 *                                                 self-test to exercise this
 *                                                 file against fixture trees
 *                                                 with known answers. Each
 *                                                 trailing argument names a test
 *                                                 that must have executed at the
 *                                                 top level of that file, which
 *                                                 is what puts a fixture tree
 *                                                 through the required-title
 *                                                 path below.
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
 * And tests, which is the other word doing work. The stream carries two kinds of
 * thing under the same event name: a test that ran, and a group of tests that
 * finished. A `describe` block reports itself as a pass when everything in it
 * passed and as a failure when something in it did not, so an event stream
 * counted at face value counts a suite as a test — a file of nothing but empty
 * `describe` blocks reported as many tests as it had blocks and none of them ran
 * anything, and a single failing test inside one group was counted as two
 * failures. Both counters read the kind the event carries and count only leaf
 * tests, and the self-test compares the pass count against the reporter's own
 * total.
 *
 * The pass count, and only that one. The leaf failure count and the reporter's
 * failure total are not the same number and are not asserted to be: a failing
 * test inside a group is one failing leaf and two failure events, and a hook at
 * the top of a file that throws is a failure the reporter counts as one while
 * the leaf count here stays at zero. Where they agree is a run whose failures
 * were all failing tests, which is the ordinary case and not a property of the
 * counters.
 *
 * That reading is a counting rule and it is not a rule about what fails the run,
 * and conflating the two silenced a whole class of failure. A `describe` body
 * that throws, or a hook belonging to one, reports a failure whose kind is a
 * suite and produces no failing test at all — the reporter prints it and says
 * `fail 0` beside it. A hook at the top of a file rather than inside a group is
 * the same failure again with even less on it: it belongs to the file, so its
 * failure is reported under the file's name and carries no kind at all. So a run
 * judged on the leaf count alone exited 0 with the failure on the screen. The
 * two are separate here: every failure event refuses the run, and the leaf count
 * is kept only so that it can be compared against the reporter's, which is the
 * one thing it is for.
 *
 * And which tests ran, which no count can say. Each suite names the tests it is
 * built from in `run-node-tests-core.mjs`, and a title that did not execute at
 * the top level of its file refuses the run — the floors are all lower bounds,
 * so a `test.skip` on any single test cleared every one of them.
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
 *
 * What all of this defends against, and what it does not, is written down once
 * in `CONTRIBUTING.md` under "What the checks defend against". The short of it:
 * this gate catches silent defeats of shipped behaviour, because those leave the
 * suite intact and an intact suite refuses them. It does not defend against an
 * author who edits the suite itself — a skipped test, a renamed one, an emptied
 * list — because every such edit is a change to a public, reviewed file and
 * shows in the diff, and because a check that guarded the suite would itself be
 * a file in it. The required titles below close the case where the two
 * overlapped — a skip that also hid a hole in shipped code — and they close it
 * on one condition, which is worth stating because it is a line of this file
 * rather than an argument: a test that did not run must not be recorded as one.
 *
 * That condition used to be a placement — where `recordTest` sits in the handler
 * below, and nothing else. It is not a placement any more, and the reason is
 * worth having in front of the code it is about. A placement is a thing an edit
 * can add a second copy of. Recording under a condition on *which suite is
 * running* left the `--tree` path byte-identical, and `--tree` is the only way
 * anything outside this file drives it: every fixture tree still reported every
 * skipped title as not executed, the self-test read the exit codes it expected,
 * and the whole gate stayed green with the named suites quietly recording tests
 * that had not run. The next `test.skip` on a required test would have cashed
 * that in. So the reading moved into `positionOf`, in the policy module, where
 * an event that says it did not run has no position at all — under any suite,
 * from any branch, however many times it is called. The guard below now decides
 * the counts, which are lower bounds, and `recordTest` reports any event it is
 * offered that did not run, so an edit that moves or duplicates the call refuses
 * the run instead of waiting.
 *
 * And the fixture trees are no longer driven only through `--tree`:
 * `run-node-tests-selftest.mjs` runs one of them through the named-suite
 * selector as well and requires the two runs to answer the same, which is what
 * makes "the runner does not behave differently depending on which suite it was
 * asked for" a thing something checks rather than a thing nobody looked at. The
 * rest is review's, deliberately.
 */

import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { resolve } from 'node:path';

import { checkManifest, readManifest } from './check-manifest-core.mjs';
import { checkRun, collectTestFiles, positionOf, SUITES, treeSuite } from './run-node-tests-core.mjs';

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
  // Two arguments or more: the tree, and then any number of required positions.
  // `treeSuite` answers `null` for a position that is not one, which lands in
  // the same usage failure a wholly unrecognised command line does — so a
  // mistyped position is a run that did not happen rather than a run judged
  // against a title nothing could satisfy.
  if (args.length >= 2 && first === '--tree' && second !== undefined && second.length > 0) {
    return treeSuite(resolve(second), args.slice(2));
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
let failureEvents = 0;
/**
 * How many events that said they did not run were offered to `recordTest`.
 *
 * Zero on every honest run. See the note in `recordTest`, and the comparison in
 * `checkRun` that reads it.
 */
let recordedWithoutRunning = 0;
/** @type {Map<string, number>} */
const executedByFile = new Map();

/** @param {string | undefined} file */
const countFor = (file) => {
  if (file !== undefined) {
    executedByFile.set(file, (executedByFile.get(file) ?? 0) + 1);
  }
};

/**
 * Which tests ran, by whole position — the file's own name and the test's
 * title.
 *
 * @type {Set<string>}
 */
const executedTests = new Set();

/**
 * Record a test that ran at the top of its file.
 *
 * Which events those are is `positionOf`, in the policy module, so that the
 * reading can be handed events and asked rather than living where nothing can
 * reach it. See the note on it: an event handler is not a testable place to
 * decide what a test's identity is, and deleting one line of that decision here
 * left every check in this repository green.
 *
 * What `positionOf` does not decide, and cannot, is whether the test ran. A
 * skipped test and a pending one both arrive as a `test:pass` carrying a leaf
 * kind, a nesting of zero and a file, so `positionOf` accepts both and answers
 * with a perfectly good position. The only thing that keeps them out of the set
 * is the guard this call sits inside, below — which makes the call site, rather
 * than this function, the thing that has to be pinned. It was not, for as long
 * as the fixture trees the self-test spawns carried no required title: moving
 * this call out of the guard recorded seventeen skipped tests as seventeen tests
 * that ran, and a suite with a required test skipped out passed every floor and
 * every title with the reporter printing `skipped 1` beside it.
 *
 * @param {{ name: string, nesting: number, file?: string, skip?: unknown, todo?: unknown, details?: { type?: string } }} event
 */
const recordTest = (event) => {
  // Offered an event that says it did not run. `positionOf` answers `null` for
  // one whatever else it carries, so nothing is recorded either way and no
  // required title can be satisfied by a test whose body never ran — that is the
  // part of this that no branch anywhere can reach around.
  //
  // What this counter adds is narrower than it used to be written here, and the
  // difference is worth stating rather than smoothing over. An edit that moves
  // this call out of the guard below offers every skipped and pending event to
  // it, so the fixture trees of nothing but skipped and nothing but pending
  // tests refuse the run at once: that edit is loud.
  //
  // An edit that adds a *second* call under a condition of its own is not. Two
  // spellings were tried — a recorder conditioned on which entry of `SUITES` is
  // running, and one conditioned on the suite's label — and each of them exits 0
  // on its own and prints nothing, because no tree the self-test drives has a
  // skipped or pending test in it while that condition is true. What the counter
  // does to those edits is take the payoff away rather than announce them: the
  // moment such a run has a test skipped out, the extra call fires and the run is
  // refused, so the disarming never cashes in. That is the protection, and it is
  // a real one — but it is not a run refused at the moment the line is written.
  if (event.skip !== undefined || event.todo !== undefined) {
    recordedWithoutRunning += 1;
    return;
  }
  const position = positionOf(event);
  if (position !== null) {
    executedTests.add(position);
  }
};

/**
 * Is this event a leaf test rather than a group of them?
 *
 * A `describe` block reports itself under the same two event names its contents
 * do — a pass when everything inside it passed, a failure when something inside
 * it did not — and the only thing telling the two apart is the kind the event
 * carries. Counted without asking, a file of nothing but empty groups reported
 * one test per group and ran none, and one failing test inside one group was two
 * failures.
 *
 * Read as "is it a test", not as "is it not a suite", so an event that says
 * nothing about its kind is not counted. That is the fail-closed direction: an
 * uncounted test is a floor unmet, which is loud, while an uncounted suite
 * counted anyway is exactly the quiet arithmetic this is here to stop.
 *
 * Which of the two ways round it is written is a real difference, and a fixture
 * does close it. Not every event carries a kind: a hook at the top of a file
 * belongs to the file rather than to any group, and when one throws, the failure
 * is reported under the file's own name with no kind on it at all — not `test`,
 * not `suite`, absent. So `is it a test` refuses that event and `is it not a
 * suite` admits it, and they part on exactly the tree
 * `test/runner-fixtures/file-hook-throws/` carries a file of. That tree is its
 * own directory rather than part of `suite-throws/`, which holds the group case:
 * a group's body and a group's hook both report their kind as a suite, and a
 * hook belonging to the file reports none, so the two trees are two cases and
 * neither stands for the other.
 *
 * The strict spelling is the one written because it fails closed, and the
 * fixture pins that it does. Under `is it a test`, a root hook's failure is not
 * a leaf, so `failed` stays zero and the run is refused by the failure-event
 * count instead — the line naming a failure that was not a test. Under `is it
 * not a suite` it would be counted as a failing test and the run refused as `1
 * test(s) failed`. Both refuse the run, which is why this is a counting rule and
 * not a hole; what the fixture holds is that the count says the true thing about
 * what the runner actually saw.
 *
 * This decides what a count means and never whether the run failed. Every
 * failure event refuses the run whatever kind it says it is; see the handler
 * below and `checkRun`.
 *
 * @param {{ details: { type?: 'suite' | 'test' } }} event
 * @returns {boolean}
 */
const isLeafTest = (event) => event.details.type === 'test';

const stream = run({ files, concurrency: 1 });
stream.on('test:pass', (event) => {
  // A skipped or pending test is not a test that ran, and a group of tests is
  // not one either. All three arrive here.
  //
  // `recordTest` is inside this guard and that is load-bearing rather than
  // incidental: outside it, a skipped test becomes a position in
  // `executedTests`, which is to say a required title satisfied by a test whose
  // body never ran. The counts alone do not catch that — they are lower bounds
  // and a suite one skip short still clears them. What catches it is the pair of
  // fixture trees the self-test spawns with required titles named on the command
  // line, `skipped/` and `pending/`, both of which must report every title as
  // not executed.
  if (event.skip === undefined && event.todo === undefined && isLeafTest(event)) {
    passed += 1;
    countFor(event.file);
    recordTest(event);
  }
});
stream.on('test:fail', (event) => {
  // Every failure, whatever kind it says it is. This is the counter the run is
  // judged on, and it is separate from the one below because the two answer
  // different questions. A `describe` body that throws, and a hook belonging to
  // one, report a failure whose kind is a suite and leave no failing test
  // behind: read through the leaf test alone, the run exited 0 with the failure
  // printed above the summary.
  failureEvents += 1;

  // And the leaf count, which exists so that it can be compared against the
  // reporter's own — the reporter counts leaf tests too, so a counter that had
  // drifted is visible as a disagreement rather than as a number nothing sits
  // beside. A failing test inside a group produces a failure for the test and a
  // failure for the group, and counting both made one wrong answer read as two.
  if (!isLeafTest(event)) {
    return;
  }
  failed += 1;
  countFor(event.file);
  // A test that ran and failed is still a test that ran. Which of them failed is
  // the count above; what this records is that the question was asked at all.
  recordTest(event);
});

const reporter = new spec();
stream.compose(reporter).pipe(process.stdout);

stream.on('end', () => {
  const failures = [
    ...checkManifest(readManifest()),
    ...checkRun({ suite, files, passed, failed, failureEvents, executedByFile, executedTests, recordedWithoutRunning }),
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
