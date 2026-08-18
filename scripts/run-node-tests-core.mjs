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

/**
 * Where the one fixture tree that is also a named suite lives.
 *
 * A tree of nothing but skipped tests, which the runner must refuse. It is
 * driven by `run-node-tests-selftest.mjs` and by nothing else — `npm run check`
 * runs `fast` and `self`, and this is neither.
 *
 * It has a name because of what having one costs an attacker. Every other
 * fixture tree reaches the runner through `--tree`, which builds its suite at
 * run time, and the named suites are frozen objects built at module load: a
 * runner that behaves one way for the first and another way for the second is a
 * runner nothing outside it can see, because outside it is the self-test and the
 * self-test only ever drove trees. That was not hypothetical — recording skipped
 * tests only when the suite was one of the named ones left every fixture tree
 * answering exactly as before and the whole gate green. Naming a tree closes the
 * gap in the direction that matters: the same tree, with the same required
 * titles, is now run both ways and the two answers have to agree.
 */
export const SKIPPED_FIXTURE_DIRECTORY = fileURLToPath(
  new URL('../test/runner-fixtures/skipped/', import.meta.url),
);

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
 * How an executed test is named: its whole position — the file it is in and its
 * own title.
 *
 * The position rather than the title, for the reason the browser path's
 * `testKey` gives: a title is not an identity. A group written inside the same
 * file can register a test of any title it likes, and the reporter gives that
 * test's title as its own with the group appearing only as the thing it sits in
 * — so keyed by title alone, a two-line group beside a required test supplies
 * the identity of the one that was skipped out.
 *
 * The ancestry is not spelled into this key, and that is not a weaker reading
 * than the browser path's. It is the same reading in the vocabulary this event
 * stream has: `run-node-tests.mjs` records a test only when the event says it
 * sits at the top of its file, so a test inside a group never becomes a key
 * here at all. Where the browser path looks up a position whose group list is
 * empty, this one has a set that only ever admitted them.
 *
 * NUL as the separator, and the reason is the file name rather than the title.
 * A test title may contain a NUL — node accepts one and reports it back — so the
 * claim that neither half carries one is false of the half a reader would expect
 * it to be true of. What makes this key injective anyway is the other half: a
 * filesystem basename cannot contain a NUL, so the first NUL in a key is always
 * the separator, and the split is unambiguous however the title is spelled. A
 * title carrying one produces a key with two NULs in it and still names exactly
 * one position.
 *
 * @param {string} file The file's name, without its directory.
 * @param {string} title
 * @returns {string}
 */
export function testKey(file, title) {
  return [file, title].join('\u0000');
}

/**
 * The position an event may be recorded under, or `null` if it is not one the
 * required titles are read against.
 *
 * This is the reading `requiredTests` rests on, and it lives here rather than in
 * the runner so that it can be handed events and asked. In the runner it was
 * three conditions inside an event handler, which nothing could reach: deleting
 * the one that says "at the top of its file" left every check in this repository
 * passing, and turned the whole-position identity back into a title — so a group
 * registering a required title would again stand in for the test that had been
 * skipped out. The browser path keeps its equivalent reading in its own policy
 * module for the same reason, and its self-test hands it reports.
 *
 * Four questions, each answered fail-closed:
 *
 *   - Did it run? A skipped test arrives as a `test:pass` carrying a `skip`
 *     flag and a pending one carrying `todo`, and both otherwise look exactly
 *     like a test that ran. A position is a record that a question was asked, so
 *     a test whose body never ran has none.
 *   - Is it a leaf test? A group reports itself under the same event names its
 *     contents do, and a hook belonging to a file reports under no kind at all.
 *     Asked as "is it a test", so anything not saying it is one is not recorded.
 *   - Is it at the top of its file? `nesting` is zero for a test written at the
 *     top level, one for a test inside a `describe`, two inside a group inside a
 *     group. Only zero, at any depth, and that is what makes this a position
 *     rather than a title.
 *   - Does it say which file it is in? A record naming no file is not a position
 *     in one.
 *
 * The first question used to be the caller's, and this paragraph used to say so:
 * the flags decide whether a test ran at all, the counters in the runner make
 * that same judgement, and it was made once beside them. That was true and it
 * was not enough, because it left the whole required-title claim resting on
 * where one call sits inside one event handler — and where a call sits is a
 * thing an edit can condition on. A runner that recorded skipped tests only when
 * the suite was one of the named ones behaved identically on every fixture tree
 * the self-test drives, because the self-test drives trees and the condition was
 * on names; the whole gate stayed green, and a later `test.skip` on any required
 * test cashed it in. So the reading moved here, where it is a property of the
 * function rather than of a call site: recording a test that did not run is not
 * something a caller can choose to do, under any suite, from any branch. What
 * the runner's own guard still decides is the counts, which are lower bounds and
 * were never the thing a skip was borrowing.
 *
 * @param {{ name: string, nesting: number, file?: string, skip?: unknown, todo?: unknown, details?: { type?: string } }} event
 * @returns {string | null}
 */
export function positionOf(event) {
  if (event.skip !== undefined || event.todo !== undefined) {
    return null;
  }
  if (event.details?.type !== 'test') {
    return null;
  }
  if (event.nesting !== 0) {
    return null;
  }
  if (event.file === undefined) {
    return null;
  }
  return testKey(basename(event.file), event.name);
}

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
 * @property {Readonly<Record<string, readonly string[]>>} requiredTests The
 *   tests each of those files is built from, by title. Every one of them has to
 *   have executed at the top level of the file it is listed under.
 */

/**
 * The suites this runner knows by name.
 *
 * Two, and they are different kinds of thing on purpose. `fast` is the corpus
 * against the viewer. `self` is every check that is about another check — the
 * sink scan's, this runner's, the browser path's, and the one on what a commit
 * message may say — collected by name rather than invoked one at a time, so that
 * losing one of them is a file count short rather than a line quietly gone from
 * the manifest.
 *
 * Each suite also names the tests it is built from, and that list is the one
 * thing here a count cannot stand in for. Every floor above is a number, and a
 * number cannot tell one test from another: with the fast suite's floor at 15
 * and its one file carrying 24, a `test.skip` on any single test left every
 * floor clear — the file count, the required file, the total, and the per-file
 * count all still passed — and took that test's question out of the run. The
 * route was demonstrated: skipping the name-pin on the ill-formed cases and
 * emptying those cases dropped the fast suite to 21 tests, still clear, and let
 * `fatal: false` back into the decoder with the whole gate green.
 *
 * Written as titles rather than a number, and as every test in each file rather
 * than a chosen few: this is the browser path's `REQUIRED_TESTS` on this
 * runner, and that list names every test in both of its spec files for the same
 * reason. Adding a test means adding a line here, which is a visible, reviewable
 * act; skipping one out is a failure that says which one.
 *
 * What pins these lists is not this file. Each suite's list is written out again
 * from outside the suite it describes, so emptying one here is an edit two files
 * disagree about: the `self` suite's titles are pinned by `test/node/core.test.mjs`,
 * which is the fast suite, and the `fast` suite's titles are pinned by
 * `scripts/run-node-tests-selftest.mjs`, which is the self suite. Neither can
 * quietly shorten its own list, because the file that checks it is in the other
 * one — the same arrangement the browser path has, where `REQUIRED_TESTS` is
 * pinned by a fast-suite test rather than by a test in the browser suite.
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
    // Pinned from outside by `scripts/run-node-tests-selftest.mjs`.
    requiredTests: Object.freeze({
      'core.test.mjs': Object.freeze([
        'the corpus holds',
        'what the driver is handed carries no expectations',
        'an observation reported under the wrong name is a failure',
        'an emptied corpus fails rather than passes',
        'a corpus that has lost one family of cases fails',
        'the cases that ask what the decoder does with ill-formed bytes are there, by name',
        'two cases with one name are a failure',
        'an observation carrying a field its case does not name is a failure',
        'the comparison separates values one serialisation spells the same way',
        'the confinement scan reaches a thrown value and a symbol-keyed one',
        'the stored key is watched, in every spelling the other secrets get',
        'the browser path is invoked through the runner that fails closed, and both engines are pinned',
        'the self suite is required to run every check that is about another check, by title',
        'the manifest check refuses each way a step can be silenced',
        'the canonical form is what the generator pinned, and the records carry what produces it',
        'the viewer never re-serialises anything',
        'the copy the viewer ships is the copy that was agreed',
        'the stylesheet the viewer ships is the stylesheet that was reviewed',
        'the expiry formatter writes one pattern, in whatever timezone the reader is in',
        'the encoder and the strict decoder are inverses',
        'the capability probe the viewer ships is the one the generator published',
        'every fixture uses its own nonces',
        'the interop vectors cover the shapes they are meant to',
        'every published derived key is the one its published inputs derive',
        'one fixture is changed by every repair that could change it',
        'every fixture is sealed over the canonical form of its authenticated data',
        'one fixture carries a surrogate pair in what the tag covers',
        'no object in the emitted vectors names a member twice',
      ]),
    }),
  }),
  self: Object.freeze({
    label: 'scripts/',
    directory: SELFTEST_DIRECTORY,
    suffix: '-selftest.mjs',
    minimumFiles: 4,
    minimumExecuted: 20,
    minimumExecutedPerFile: MINIMUM_EXECUTED_TESTS_PER_FILE,
    required: Object.freeze([
      'check-attribution-selftest.mjs',
      'check-sinks-selftest.mjs',
      'run-browser-tests-selftest.mjs',
      'run-node-tests-selftest.mjs',
    ]),
    // Pinned from outside by `test/node/core.test.mjs`.
    requiredTests: Object.freeze({
      'check-attribution-selftest.mjs': Object.freeze([
        'the rules are the rules this check is pinned to have',
        'each rule refuses a message that breaks only that rule, in each spelling it has',
        'a message with nothing to report is accepted',
        'a message that cannot be read, and a command line that is not one, are refused',
        'a history with commits in it is read, and read field by field',
        'a commit no branch points at is still read',
        'a commit merged in from a branch is still read',
        'the history this repository has is accepted, and an empty one is not',
        'the hook is on disk, executable, and refuses what it is for',
        'the workflow reads the whole history, and reads it with this check',
      ]),
      'check-sinks-selftest.mjs': Object.freeze([
        'the rule set matches the independently pinned list',
        'every rule fires on at least one violation fixture',
        'every alternative every rule names is refused',
        'each destination is admitted where it ends, and nothing longer is admitted at all',
        'no character carries an admitted destination on to somewhere else',
        'nothing in front of an admitted destination, and no seam inside one, carries it somewhere else',
        'nothing written inside the scheme of a destination stops this reading it as one',
        'every spelling of a typecheck suppression is refused',
        'every punctuation the code-execution rules name is refused',
        'the clean fixture produces no violations',
        'the documented known misses are still missed',
        'a tree with exactly one violation is a failure',
        'a violation is reported at the line and with the text it is on',
        'a violation on a line longer than the report is truncated to the reported width',
        'an empty tree cannot be scanned, and says so',
        'no module the checks are made of turns the type checker off',
        'markup rules reach every configured markup extension',
        'script rules reach .mjs, not only .js',
        'the scan reads every line of a file, and every extension it is handed',
        'a symlinked entry in the scanned tree fails the scan closed',
        'a symlinked scan root fails the scan closed',
        'the command line exits 1 and prints FAIL on a violations tree',
        'the command line exits 0 on a clean tree',
        'the command line exits 2 on a missing tree',
        'the invocation that names no tree scans the shipped one',
        'the two requests and the five destinations are where they are allowed to be',
        'each position the share API is admitted at is a position in one named file',
        'the command line still scans when reached through a symlinked path',
      ]),
      'run-browser-tests-selftest.mjs': Object.freeze([
        'a passing tree exits 0',
        'a tree with a failing test exits 1, and for that reason',
        'a tree of nothing but skipped tests exits 1',
        'a tree run in one engine exits 1',
        'a tree with the corpus collected out exits 1',
        'a tree with exactly one reason to be refused exits 1',
        'a default invocation that did not load this configuration exits 1',
        'an absent configuration exits 1',
        'a command line that is neither documented form exits 1',
        'the run policy answers the questions it is asked',
        'each counting floor refuses the count below it and admits the count at it',
        'what a run reported is counted exactly',
        'a test whose last attempt did not pass is a failure, whatever the outcome was called',
        'a test the harness ran again until it passed is not a test this suite reports',
        'a path that merely extends another is not that path',
        "a run that named no configuration must have loaded this repository's own",
        'a required test is the one this suite carries, not one of its name elsewhere',
        'a required test is the one at the top of its file, not one of its name inside a group',
        "the names a run reported are measured from this suite's own directory",
        'a run spawned where the manifest is wrong is refused, and names the step',
        'the default invocation this repository ships exits 0',
      ]),
      'run-node-tests-selftest.mjs': Object.freeze([
        'each suite is where the runner looks for it, and holds what it is built from',
        'the run policy answers the questions it is asked',
        'a tree of passing tests exits 0',
        'a tree with a failing test exits 1, and for that reason',
        'a tree whose every test passes and whose group body throws exits 1',
        'a tree whose every test passes and whose file-level hook throws exits 1',
        'a tree of nothing but skipped tests exits 1',
        'the same tree answers the same whether it is named or given as a tree',
        'a tree of nothing but pending tests exits 1',
        'a tree of nothing but empty groups exits 1',
        'a tree with one file skipped out exits 1',
        'a tree whose smallest file sits on the per-file floor is judged by which side of it',
        'the count the runner reports is the count the reporter saw',
        'an empty tree exits 1',
        'an absent tree exits 1',
        'a command line that names no suite exits 1',
        'a required test missing from a run is a failure that names it',
        'a run spawned where the manifest is wrong is refused, and names the step',
      ]),
    }),
  }),
  // The fixture tree, by name. Not a suite of this repository's checks and never
  // run by `npm run check`: it is here so that the self-test can drive a tree of
  // known answers through the selector the real suites go through, which is the
  // one branch of this runner that `--tree` cannot reach.
  //
  // Its floors are the ordinary ones and its required titles are the titles the
  // tree carries, every one of which is skipped. So the answer this suite must
  // give is a refusal naming all of them, and it is the same refusal the same
  // tree gives through `--tree` — which is the pin: two selectors, one answer.
  'skipped-fixture': Object.freeze({
    label: 'test/runner-fixtures/skipped/',
    directory: SKIPPED_FIXTURE_DIRECTORY,
    suffix: '.test.mjs',
    minimumFiles: MINIMUM_TEST_FILES,
    minimumExecuted: MINIMUM_EXECUTED_TESTS,
    minimumExecutedPerFile: MINIMUM_EXECUTED_TESTS_PER_FILE,
    required: Object.freeze(['skipped.test.mjs']),
    // Two of them rather than all seventeen: what this suite is for is the
    // selector, and a title that must be reported as not executed says that
    // whether it is named once or seventeen times. Written out here, like every
    // other list in this file, and pinned from outside by the self-test that
    // runs the tree — which builds the same two positions for its `--tree` run,
    // so a title edited here and not there is a disagreement between the two
    // runs rather than a quieter suite.
    requiredTests: Object.freeze({
      'skipped.test.mjs': Object.freeze([
        'a test that is skipped (0)',
        'a test that is skipped (1)',
      ]),
    }),
  }),
});

/**
 * What separates a file name from a title in a required position named on the
 * command line.
 *
 * Two colons rather than one, and the split is at the first occurrence: a file
 * name may contain a colon, and a title may contain anything at all, so the
 * separator has to be a sequence the left-hand side does not carry while the
 * right-hand side may. No fixture file name here carries `::`, and one that did
 * would be a name this reading could not take apart — which is a fixture nobody
 * has written rather than a hole in what is written here.
 */
const REQUIRED_POSITION_SEPARATOR = '::';

/**
 * An ad-hoc tree, judged against the default floors and against whatever
 * required titles its caller names.
 *
 * Used only by the self-test, which points the runner at fixture directories
 * with known answers so its exit codes can be read from outside itself.
 *
 * `requiredTests` used to be hardcoded empty here, and that one word was the
 * reason the whole required-title path had never been exercised by a real run.
 * `positionOf` and the loop in `checkRun` that reads it were both pinned, but
 * only against event objects and sets a test built by hand — and the wiring
 * between them, the line in the runner that decides which events become
 * positions at all, was pinned in one direction only. A real run fails if
 * nothing is recorded; nothing anywhere failed if too much was. Moving that one
 * line out of the guard it sits in, so that a skipped test is recorded as a test
 * that ran, left `npm run check` exiting 0 with a required test skipped out — and
 * with the shipped decoder's ill-formed-byte refusal turned back over on top of
 * it. It was unobservable because `--tree` is the only way the self-test drives
 * the real runner and no tree it drove had a required title to miss.
 *
 * So the titles come from the caller. They are named on the command line rather
 * than read out of the tree because a title is a claim about a tree rather than
 * a property of one: the self-test is where that claim can be written down beside
 * the case that makes it, in the same arrangement every suite above already has,
 * where the list a suite is judged against lives in a file the suite does not
 * contain.
 *
 * A position that is not one returns `null`, which the runner reports as a usage
 * failure — the same answer it gives any command line it does not recognise, so
 * a mistyped position is a run that did not happen rather than a run judged
 * against nothing.
 *
 * @param {string} directory
 * @param {readonly string[]} [requiredPositions] Each `<file>::<title>`, naming a
 *   test that must have executed at the top level of that file.
 * @returns {Suite | null} `null` if any position is not one.
 */
export function treeSuite(directory, requiredPositions = []) {
  /** @type {Record<string, string[]>} */
  const requiredTests = {};
  for (const position of requiredPositions) {
    const at = position.indexOf(REQUIRED_POSITION_SEPARATOR);
    // A separator at the front leaves no file, a separator at the end leaves no
    // title, and no separator at all leaves neither. All three are refused
    // rather than read as a position with an empty half, because an empty half
    // is a required title nothing can ever satisfy — a run refused for a reason
    // that says nothing about the tree.
    if (at <= 0 || at + REQUIRED_POSITION_SEPARATOR.length >= position.length) {
      return null;
    }
    const file = position.slice(0, at);
    // And a file half that names a path rather than a file, which is the same
    // failure in a shape the emptiness test does not see. `positionOf` records a
    // test under its file's basename — that is what makes a position a position
    // and not a path — so `subdir/passing.test.mjs::a title` is a required title
    // no run can ever satisfy, whatever the tree holds. Accepting it would be a
    // run refused for a reason that says nothing about the tree, which is the
    // exact state the paragraph above says must not happen; refusing it here is
    // the usage failure a mistyped position already gets. Both separators, so a
    // position spelled the way this platform does not write paths is refused
    // too: what is being matched is the reading `positionOf` cannot do, not the
    // conventions of a filesystem.
    if (file.includes('/') || file.includes('\\')) {
      return null;
    }
    const title = position.slice(at + REQUIRED_POSITION_SEPARATOR.length);
    const titles = requiredTests[file] ?? [];
    titles.push(title);
    requiredTests[file] = titles;
  }

  return {
    label: directory,
    directory,
    suffix: '.test.mjs',
    minimumFiles: MINIMUM_TEST_FILES,
    minimumExecuted: MINIMUM_EXECUTED_TESTS,
    minimumExecutedPerFile: MINIMUM_EXECUTED_TESTS_PER_FILE,
    // Still nothing in particular: which files a fixture tree is built from is
    // the self-test's business rather than this policy's, and naming a required
    // title in a file already fails when that file ran nothing.
    required: [],
    requiredTests,
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
 * @param {{ suite: Suite, files: readonly string[], passed: number, failed: number, failureEvents?: number, executedByFile?: ReadonlyMap<string, number>, executedTests?: ReadonlySet<string>, recordedWithoutRunning?: number }} run
 *   `executedByFile` is per collected file; a file absent from it ran nothing.
 *   `failed` is failing leaf tests; `failureEvents` is every failure reported,
 *   which is more of them — see the two comparisons at the end of this function.
 *   `executedTests` holds a `testKey` for every test that ran at the top level
 *   of its file; absent is read as none, so a runner that stopped reporting them
 *   fails every required title rather than silently checking nothing.
 *   `recordedWithoutRunning` is how many events the runner offered its recorder
 *   that said they did not run; see the comparison it is read by, below.
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

  // The floor no count can be: each named test, at the top level of the file it
  // is listed under. A `test.skip` on any one test leaves every total above
  // clear — the fast suite carries 24 against a floor of 15 — and takes that
  // test's question out of the run, which is how a name-pin and the cases it
  // pins went missing together with the whole gate green. A group registering a
  // test of the same title in the same file leaves the title clear too, so what
  // is looked up is the position: the runner records a test only when the event
  // says it sits at the top of its file, and a test inside a group is therefore
  // absent from this set rather than standing in for the one that is.
  //
  // Absent is read as none rather than as nothing to check. A runner that
  // stopped passing this set would otherwise silence every line below it.
  const executedTests = run.executedTests ?? new Set();
  for (const [file, titles] of Object.entries(run.suite.requiredTests)) {
    for (const title of titles) {
      if (!executedTests.has(testKey(file, title))) {
        failures.push(
          `${file} › ${title} did not execute at the top level of that file, so what it holds was not asked`,
        );
      }
    }
  }

  // And the other half of the required-title claim, which `positionOf` makes
  // impossible to break and this makes impossible to attempt quietly. A test
  // that did not run has no position, so offering one to the recorder changes
  // nothing about what was recorded — but a runner whose guard has gone offers
  // them, and a runner whose guard is where it says it is never does. Silently
  // ignoring the offer would leave that edit sitting in the file doing nothing
  // until somebody skipped a test out, which is the shape this whole path exists
  // to refuse: a disarming that waits.
  //
  // Zero on every honest run, of any suite, so this line only ever speaks about
  // an edit to the runner.
  if ((run.recordedWithoutRunning ?? 0) > 0) {
    failures.push(
      `${run.recordedWithoutRunning} test(s) that did not run were offered to the recorder, so the guard that keeps a skipped test out of the required titles is not where this file says it is`,
    );
  }

  // A run is refused for any failure that was reported, and the number in the
  // line is the number of failing tests, which is not the same count.
  //
  // Counting only the tests was a hole rather than a nicety. A `describe` body
  // that throws, and a hook belonging to one, report a failure whose kind is a
  // group and produce no failing test at all — so a run judged on the test count
  // exited 0 while the reporter printed the failure and said `fail 0` beside it.
  // A file whose groups have grown a throwing line is then a file that ran and
  // reported nothing about it.
  //
  // A hook at the top of a file rather than inside a group is the same hole
  // again, and it does not belong to a group at all: it belongs to the file, and
  // its failure is reported under the file's own name carrying no kind
  // whatsoever — not `test`, not `suite`, absent. So it is not a failing test by
  // either reading, and this second line is what refuses it. There is a fixture
  // tree for each rather than one carrying both: `test/runner-fixtures/suite-throws/`
  // holds a group whose body throws, and `test/runner-fixtures/file-hook-throws/`
  // holds a hook belonging to the file. They are two directories because they
  // report two different things — a kind of `suite` and no kind at all — and it
  // is the second that tells the two readings apart.
  //
  // Two comparisons rather than one, because the first line is the one the
  // self-test reads back against the reporter's own failure count and it has to
  // keep saying what it says. Where tests failed, that is the count; where the
  // only failures were somewhere else, the second line is what refuses the run
  // and it says where to look.
  if (run.failed > 0) {
    failures.push(`${run.failed} test(s) failed`);
  } else if ((run.failureEvents ?? 0) > 0) {
    failures.push(
      `${run.failureEvents} failure(s) were reported and none of them was a test, which is what a group whose body throws, a hook belonging to one, and a hook belonging to the file all look like`,
    );
  }

  return failures;
}
