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
 *   - A tree whose tests all pass and whose group body throws exits 1. That is
 *     a failure with no failing test in it — the reporter prints it and says
 *     `fail 0` in the same breath — so a runner that read the failure count
 *     through the same leaf test the pass count is read through exited 0 with
 *     the failure on the screen.
 *   - A tree whose tests all pass and whose file-level hook throws exits 1, and
 *     is refused as a failure that was not a test rather than as a failing one.
 *     A hook at the top of a file belongs to the file rather than to a group, so
 *     its failure carries no kind at all — not `test`, not `suite`, absent — and
 *     it is the one tree that tells `is it a test` from `is it not a suite`.
 *     Every other tree here is read identically by both spellings.
 *   - A required test that did not run at the top of the file it is listed under
 *     refuses the run, by name. Every floor above is a lower bound sitting under
 *     what each suite carries, so a `test.skip` on any single test cleared all
 *     of them and took that test's question out of the run.
 *   - And the other direction of that claim, over a tree the runner is really
 *     spawned against: a test that did not run must not satisfy a required
 *     title. The policy half was pinned against sets built here by hand, which
 *     is the one instrument that cannot see the line the claim actually rests
 *     on — the call in `run-node-tests.mjs` that records a test sits inside the
 *     guard deciding whether the test ran. Moved out of that guard, a skipped
 *     test became a test that ran, and a suite with a required test skipped out
 *     passed every floor and every title. The trees below are named required
 *     titles on the command line so that a run has something to be wrong about.
 *   - A tree of nothing but skipped tests exits 1. A skipped test arrives as a
 *     pass carrying a `skip` flag, so a count that read the event and not the
 *     flag called ten skipped tests a run of the suite — and skipping out a file
 *     is one line.
 *   - And a tree of nothing but pending tests exits 1, which is the same claim
 *     about the other flag. `todo` is what a test is marked with while it is
 *     being written, and until this tree existed the reading of that flag could
 *     be dropped with no fixture noticing.
 *   - And a tree of nothing but empty groups exits 1, which is the same claim
 *     about a difference that is not a flag at all. A group of tests reports
 *     itself under the same event name a test does, so a file whose tests have
 *     been wrapped and then emptied arrived as one event per group and ran
 *     nothing — counted at face value, that was a run of the suite, and no flag
 *     on anything says otherwise.
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
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHECK_COMMANDS, CHECK_CONFIGS, CHECK_FILES, CHECK_STEPS } from './check-manifest-core.mjs';
import {
  checkRun,
  collectTestFiles,
  MINIMUM_EXECUTED_TESTS,
  MINIMUM_EXECUTED_TESTS_PER_FILE,
  MINIMUM_TEST_FILES,
  positionOf,
  SUITES,
  testKey,
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
  return spawnRunner(RUNNER, args);
}

/**
 * Run a runner as a child process, the way a shell does.
 *
 * The program is an argument rather than this repository's own for one case
 * below, which spawns a copy of it from a tree whose manifest is wrong. Every
 * other call is `runRunner` above.
 *
 * @param {string} runner
 * @param {string[]} args
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function spawnRunner(runner, args) {
  // This file is itself run by the runner, which marks its children so that a
  // nested test run refuses to execute any files. The child here is a test run,
  // and the whole point is that it executes some, so the mark is removed. Left
  // in place, every tree below reported zero tests and the exit codes said
  // nothing about the trees at all.
  const environment = { ...process.env };
  delete environment['NODE_TEST_CONTEXT'];

  const result = spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', env: environment });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * A tree that is a repository as far as the manifest check is concerned, with
 * one runner of this repository's own copied into it.
 *
 * Everything `checkManifest` reads is written here and is what the pins say,
 * except for whatever the caller substitutes: the chain and every step's
 * command, every file a step names — as an empty placeholder where the file's
 * contents do not matter, because what is read is whether it is there — and both
 * typecheck configurations.
 *
 * The runner is copied rather than rewritten, and copied at the moment the case
 * runs, so it is this repository's runner rather than a stand-in for it: an edit
 * to the file in `scripts/` is an edit to what this spawns. Its own root is the
 * directory it sits in, so a copy in a scratch tree is a runner whose manifest is
 * the one written here.
 *
 * @param {readonly string[]} programs Names under `scripts/` to copy in. The
 *   first is the runner to spawn.
 * @param {{ substitutions?: Record<string, string>, checkJs?: boolean, absent?: string }} [damage]
 *   `substitutions` names steps to give a command other than the pinned one,
 *   `checkJs` writes the typecheck configuration with that setting, and `absent`
 *   is a file a step names to leave off the disk.
 * @returns {{ root: string, runner: string }}
 */
function scratchRepository(programs, damage = {}) {
  const root = mkdtempSync(join(tmpdir(), 'runner-manifest-'));

  for (const files of Object.values(CHECK_FILES)) {
    for (const file of files) {
      if (file === damage.absent) {
        continue;
      }
      const target = join(root, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, '');
    }
  }
  for (const [file, config] of Object.entries(CHECK_CONFIGS)) {
    const written = JSON.parse(JSON.stringify(config));
    if (file === 'jsconfig.json' && damage.checkJs !== undefined) {
      written.compilerOptions.checkJs = damage.checkJs;
    }
    writeFileSync(join(root, file), JSON.stringify(written, null, 2));
  }
  for (const program of programs) {
    copyFileSync(fileURLToPath(new URL(`./${program}`, import.meta.url)), join(root, 'scripts', program));
  }

  const scripts = { check: CHECK_STEPS.join(' && '), ...CHECK_COMMANDS, ...(damage.substitutions ?? {}) };
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts }, null, 2));

  return { root, runner: join(root, 'scripts', programs[0] ?? '') };
}

/**
 * @param {string} target
 * @param {readonly string[]} [requiredPositions] Each `<file>::<title>`, naming a
 *   test that must have executed at the top level of that file.
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runTree(target, requiredPositions = []) {
  return runRunner(['--tree', target, ...requiredPositions]);
}

/**
 * A required position, spelled the way the runner's command line spells one.
 *
 * @param {string} file
 * @param {string} title
 * @returns {string}
 */
function position(file, title) {
  return `${file}::${title}`;
}

/**
 * How many required titles a run reported as not executed.
 *
 * Counted rather than searched for, so a case can say that the run reported
 * exactly the titles it named and no others — which is the difference between a
 * run that read the list and one that refused everything in it.
 *
 * @param {string} stderr
 * @returns {number}
 */
function missingTitles(stderr) {
  return stderr.split('\n').filter((line) => line.includes('did not execute at the top level')).length;
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

/**
 * The set a healthy run of a suite hands back: every required title, at the top
 * of the file it is listed under.
 *
 * @param {import('./run-node-tests-core.mjs').Suite} suite
 * @returns {Set<string>}
 */
function everyRequiredTest(suite) {
  /** @type {Set<string>} */
  const executed = new Set();
  for (const [file, titles] of Object.entries(suite.requiredTests)) {
    for (const title of titles) {
      executed.add(testKey(file, title));
    }
  }
  return executed;
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

  // And the tests the fast suite is built from, by title, written out here
  // rather than read off the policy. This is the outside half of a pair: the
  // fast suite's titles are pinned from the self suite, and the self suite's
  // titles are pinned from `test/node/core.test.mjs`, which is the fast suite.
  // Neither list can be shortened where it lives, because the file that checks
  // it is in the other suite — the arrangement the browser path already has,
  // where its required titles are pinned by a fast-suite test rather than by one
  // of its own.
  //
  // Every test in the file rather than a chosen few, for the reason the browser
  // path lists every test in both of its spec files: a list of the load-bearing
  // ones is a judgement somebody has to keep making, and the judgement that a
  // test is not load-bearing is exactly the judgement a skip is trying to
  // borrow. Adding a test to the fast suite means adding a line here.
  assert.deepEqual(Object.keys(namedSuite('fast').requiredTests), ['core.test.mjs']);
  assert.deepEqual(
    [...(namedSuite('fast').requiredTests['core.test.mjs'] ?? [])].sort(),
    [
      'a corpus that has lost one family of cases fails',
      'an emptied corpus fails rather than passes',
      'an observation carrying a field its case does not name is a failure',
      'an observation reported under the wrong name is a failure',
      'both render functions are gated on the clear',
      'every fixture is sealed over the canonical form of its authenticated data',
      'every fixture uses its own nonces',
      'every published derived key is the one its published inputs derive',
      'no object in the emitted vectors names a member twice',
      'one fixture carries a surrogate pair in what the tag covers',
      'one fixture is changed by every repair that could change it',
      'the browser path is invoked through the runner that fails closed, and both engines are pinned',
      'the canonical form is what the generator pinned, and the records carry what produces it',
      'the cases that ask what the decoder does with ill-formed bytes are there, by name',
      'the comparison separates values one serialisation spells the same way',
      'the confinement scan reaches a thrown value and a symbol-keyed one',
      'the corpus holds',
      'the interop vectors cover the shapes they are meant to',
      'the manifest check refuses each way a step can be silenced',
      'the self suite is required to run every check that is about another check, by title',
      'the stored key is watched, in every spelling the other secrets get',
      'the viewer never re-serialises anything',
      'two cases with one name are a failure',
      'what the driver is handed carries no expectations',
    ],
    'the fast suite no longer requires the tests it is built from',
  );

  // And a list that is there is not the same as a list that is asked. An emptied
  // list satisfies every loop over it, so the count is required to be one no
  // shortened list could reach.
  assert.ok(
    (namedSuite('fast').requiredTests['core.test.mjs'] ?? []).length >= 24,
    'the fast suite requires fewer tests than it is built from',
  );
  for (const [name, suite] of Object.entries(SUITES)) {
    for (const file of suite.required) {
      assert.ok(
        (suite.requiredTests[file] ?? []).length > 0,
        `the ${name} suite requires ${file} and names no test in it, so skipping every test in that file would clear this`,
      );
    }
  }
});

test('the run policy answers the questions it is asked', () => {
  const suite = treeSuite(FIXTURES);
  assert.ok(suite !== null, 'a tree named with no required positions is not a suite');
  const files = collectTestFiles(namedSuite('fast'));

  // A tree carries the required titles its caller names, and a position that is
  // not one is not a suite at all. The runner turns that `null` into the usage
  // failure every unrecognised command line gets, which is asserted below over
  // the real command line; here it is the reading itself.
  assert.deepEqual(treeSuite(FIXTURES, ['a.test.mjs::one', 'a.test.mjs::two', 'b.test.mjs::three'])?.requiredTests, {
    'a.test.mjs': ['one', 'two'],
    'b.test.mjs': ['three'],
  });
  // A title may contain the separator; a file name is what comes before the
  // first one. Written down because the split is at the first occurrence and
  // that is the whole of why a title is free to carry it.
  assert.deepEqual(treeSuite(FIXTURES, ['a.test.mjs::a::b'])?.requiredTests, { 'a.test.mjs': ['a::b'] });
  // And a file half naming a path rather than a file. This is the same failure
  // as an empty half and it does not look like one: `positionOf` records a test
  // under its file's basename, so a required title whose file half carries a
  // directory is a title no run can satisfy — accepted here, it would be a run
  // refused for a reason that says nothing about the tree, which is the state
  // this reading exists to prevent. Both separators, because what is refused is
  // the spelling `positionOf` cannot produce rather than this platform's idea of
  // a path.
  for (const notAPosition of [
    'no-separator',
    '::a title',
    'a.test.mjs::',
    '::',
    '',
    'subdir/a.test.mjs::a title',
    'subdir\\a.test.mjs::a title',
  ]) {
    assert.equal(
      treeSuite(FIXTURES, [notAPosition]),
      null,
      `${JSON.stringify(notAPosition)} was read as a required position`,
    );
  }

  assert.deepEqual(checkRun({ suite, files, passed: MINIMUM_EXECUTED_TESTS, failed: 0 }), []);
  assert.ok(
    checkRun({ suite, files: [], passed: MINIMUM_EXECUTED_TESTS, failed: 0 }).some((line) => line.includes('test file')),
  );
  assert.ok(checkRun({ suite, files, passed: 0, failed: 0 }).some((line) => line.includes('did not run')));
  assert.ok(
    checkRun({ suite, files, passed: MINIMUM_EXECUTED_TESTS - 1, failed: 0 }).some((line) => line.includes('did not run')),
  );
  assert.ok(checkRun({ suite, files, passed: MINIMUM_EXECUTED_TESTS, failed: 1 }).some((line) => line.includes('failed')));

  // And a failure that was not a failing test, which is the count the line above
  // cannot see. A group whose body throws reports one of these and no failing
  // test, so a policy that read only `failed` called that run a pass.
  assert.ok(
    checkRun({ suite, files, passed: MINIMUM_EXECUTED_TESTS, failed: 0, failureEvents: 1 }).some((line) =>
      line.includes('none of them was a test'),
    ),
    'a run reporting a failure that was not a failing test was judged a pass',
  );
  // And where tests did fail, the line that names them is still the line, so the
  // count the self-test reads back against the reporter's is unchanged by the
  // counter beside it. A failing test inside a group reports two failures for
  // one wrong answer, which is this pair of numbers exactly.
  assert.deepEqual(checkRun({ suite, files, passed: MINIMUM_EXECUTED_TESTS, failed: 1, failureEvents: 2 }), [
    '1 test(s) failed',
  ]);
  assert.deepEqual(checkRun({ suite, files, passed: MINIMUM_EXECUTED_TESTS, failed: 0, failureEvents: 0 }), []);

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
      // A complete set, so what this case reports is the missing file rather
      // than the required titles that file would have carried.
      executedTests: everyRequiredTest(namedSuite('fast')),
    }).some((line) => line.includes('is not among the files')),
  );
});

test('a required test missing from a run is a failure that names it', () => {
  // What the runner records, asked directly. The three conditions deciding a
  // test's identity used to sit inside an event handler, where nothing could
  // reach them: deleting the one that says "at the top of its file" left every
  // check in this repository green and turned the position back into a title,
  // which is the substitution the position exists to refuse. So they are asked
  // here, event by event.
  const leaf = { name: 'a test', nesting: 0, file: '/somewhere/core.test.mjs', details: { type: 'test' } };
  assert.equal(positionOf(leaf), testKey('core.test.mjs', 'a test'));

  // Named by the file rather than by the path it was reached through, so the
  // required lists can be written the way a reader writes a file name.
  assert.equal(
    positionOf({ ...leaf, file: '/elsewhere/entirely/core.test.mjs' }),
    positionOf(leaf),
    'the same test in the same file read through a different path was a different position',
  );

  // And every event that is not a test at the top of a file, refused. A group
  // one level down, a group two levels down, a group finishing, a hook belonging
  // to a file — which reports no kind at all — and a record naming no file.
  assert.equal(positionOf({ ...leaf, nesting: 1 }), null, 'a test inside a group was recorded as one at the top');
  assert.equal(positionOf({ ...leaf, nesting: 2 }), null, 'a test two groups down was recorded as one at the top');
  assert.equal(positionOf({ ...leaf, details: { type: 'suite' } }), null, 'a group was recorded as a test');
  assert.equal(positionOf({ name: 'x', nesting: 0, file: '/a/b.test.mjs', details: {} }), null, 'an event carrying no kind was recorded as a test');
  assert.equal(positionOf({ ...leaf, file: undefined }), null, 'an event naming no file was recorded as a position in one');

  // And the question this function did not used to ask, which was the caller's
  // and is now its own. A skipped test and a pending one arrive as passes
  // carrying a flag and are otherwise indistinguishable from a test that ran, so
  // for as long as the reading lived in the runner's event handler the whole
  // required-title claim rested on where one call sat — and a call site is a
  // thing an edit can add a second, conditional copy of. Asked here, a test that
  // did not run has no position under any suite, from any branch.
  //
  // Every falsy spelling a flag arrives in as well as `true`: node reports
  // `skip: true` for a bare `test.skip` and the string a caller passed when one
  // was given a reason, and a reading that tested the value rather than its
  // presence would admit `skip: ''` and `skip: false`.
  for (const flag of ['skip', 'todo']) {
    for (const value of [true, false, '', 'a reason', 0]) {
      assert.equal(
        positionOf({ ...leaf, [flag]: value }),
        null,
        `a test carrying ${flag}: ${JSON.stringify(value)} was recorded as one that ran`,
      );
    }
  }
  assert.equal(positionOf(leaf), testKey('core.test.mjs', 'a test'), 'a test that ran was not recorded');

  // And the counter that makes offering one loud rather than merely useless.
  // Nothing is recorded either way, so without this a runner whose guard had
  // moved would sit in the tree unchanged until somebody skipped a test out.
  const clean = {
    suite: namedSuite('fast'),
    files: collectTestFiles(namedSuite('fast')),
    passed: MINIMUM_EXECUTED_TESTS,
    failed: 0,
    executedByFile: new Map(
      collectTestFiles(namedSuite('fast')).map((file) => [file, MINIMUM_EXECUTED_TESTS_PER_FILE]),
    ),
    executedTests: everyRequiredTest(namedSuite('fast')),
  };
  assert.deepEqual(checkRun({ ...clean, recordedWithoutRunning: 0 }), []);
  assert.ok(
    checkRun({ ...clean, recordedWithoutRunning: 1 }).some((line) => line.includes('offered to the recorder')),
    'a run that offered the recorder a test that did not run was accepted',
  );

  // The floor no count is. Every floor above is a lower bound sitting under what
  // each suite carries — the fast suite's is 15 against 24 — so a `test.skip` on
  // any single test cleared all of them and took that test's question out of the
  // run. The route was not hypothetical: skipping the name-pin on the ill-formed
  // cases and emptying those cases dropped the fast suite to 21 executed tests,
  // still clear of every floor, and let a repaired decode back in with the whole
  // gate green.
  for (const name of Object.keys(SUITES)) {
    const suite = namedSuite(name);
    const files = collectTestFiles(suite);
    const whole = everyRequiredTest(suite);
    const complete = {
      suite,
      files,
      passed: Math.max(MINIMUM_EXECUTED_TESTS, whole.size),
      failed: 0,
      executedByFile: new Map(files.map((file) => [file, MINIMUM_EXECUTED_TESTS_PER_FILE])),
      executedTests: whole,
    };

    // A run that asked everything is a run of the suite.
    assert.deepEqual(checkRun(complete), [], `a complete run of the ${name} suite was refused`);

    // And each required title in turn, absent, with every count left clear — so
    // what refuses the run is the identity rather than the run having become too
    // small to be one.
    for (const [file, titles] of Object.entries(suite.requiredTests)) {
      for (const title of titles) {
        const without = new Set(whole);
        without.delete(testKey(file, title));
        const failures = checkRun({ ...complete, executedTests: without });
        assert.ok(
          failures.some((line) => line.includes(title) && line.includes('did not execute')),
          `${file} › ${title} was skipped out of the ${name} suite and nothing noticed`,
        );
        // The floors' own wording rather than a fragment of it, so this stays a
        // reading of the counting lines and not of any test title that happens
        // to contain the same few words.
        assert.ok(
          !failures.some((line) => line.includes('did not run rather than passed')),
          `the totals were meant to stay clear when ${title} was skipped out`,
        );
      }
    }
  }

  // A title is not an identity, and this is the substitution the position is
  // read for. A group written inside the same file can register a test of any
  // title it likes; the runner records a test only when the event says it sits
  // at the top of its file, so a grouped test never reaches this set and the
  // required title stays missing however many times the group ran it.
  //
  // Written as the set the runner would hand back in that case: the required
  // test skipped out, and nothing added, because a test inside a group adds
  // nothing here. That is the whole of the defence and it is worth saying in a
  // case rather than only in a comment.
  const fast = namedSuite('fast');
  const fastFiles = collectTestFiles(fast);
  const [firstFile, firstTitles] = Object.entries(fast.requiredTests)[0] ?? ['core.test.mjs', []];
  const grouped = new Set(everyRequiredTest(fast));
  const movedInside = firstTitles[0];
  assert.ok(movedInside !== undefined, 'the fast suite requires no test, so this case holds nothing');
  grouped.delete(testKey(firstFile, movedInside));
  const groupedFailures = checkRun({
    suite: fast,
    files: fastFiles,
    passed: Math.max(MINIMUM_EXECUTED_TESTS, grouped.size),
    failed: 0,
    executedByFile: new Map(fastFiles.map((file) => [file, MINIMUM_EXECUTED_TESTS_PER_FILE])),
    executedTests: grouped,
  });
  assert.ok(
    groupedFailures.some((line) => line.includes(movedInside) && line.includes('did not execute')),
    'a required test moved inside a group was accepted',
  );

  // And a run that reported no positions at all is refused rather than admitted.
  // Absent has to read as none: a runner that stopped handing this set back
  // would otherwise silence every line above it, which is the shape of every
  // defect this file exists to catch.
  const silent = checkRun({
    suite: fast,
    files: fastFiles,
    passed: MINIMUM_EXECUTED_TESTS,
    failed: 0,
    executedByFile: new Map(fastFiles.map((file) => [file, MINIMUM_EXECUTED_TESTS_PER_FILE])),
  });
  for (const title of firstTitles) {
    assert.ok(
      silent.some((line) => line.includes(title) && line.includes('did not execute')),
      `a run reporting no positions at all did not report ${title} as missing`,
    );
  }

  // And now the same claim through the real runner, over trees it spawns, which
  // is the half of this that everything above cannot reach.
  //
  // Everything above hands `checkRun` a set built here by hand. That pins the
  // policy — which titles refuse a run — and pins nothing at all about how a set
  // comes to hold what it holds, which is a line in `run-node-tests.mjs`: the
  // call that records a test sits inside the guard deciding whether the test
  // ran. A hand-built set is exactly the instrument that cannot see that line,
  // and it is why the following went unnoticed. Moving the call one line up, out
  // of the guard, changing nothing else, made a skipped test a test that ran:
  // `npm run check` exited 0 with a required test skipped out of the fast suite,
  // the reporter printing `skipped 1` beside a summary of 23 tests where the
  // suite carries 24, and the shipped
  // decoder's ill-formed-byte refusal turned back over underneath it.
  //
  // Nothing could see it because `--tree` is the only way this file drives the
  // real runner and every tree it drove was judged on the floors alone. The
  // trees below are the ones that were already here; what is new is that they
  // are named a title to require, so that the run has something to be wrong
  // about.
  //
  // Both directions, because only one of them is the defect. A tree whose tests
  // ran must have its titles satisfied, or this is a runner that records nothing
  // and every case below passes for the wrong reason.
  const satisfied = runTree(fixtureDir('passing'), [
    position('passing.test.mjs', 'a test that passes (0)'),
    position('passing.test.mjs', `a test that passes (${MINIMUM_EXECUTED_TESTS - 1})`),
  ]);
  assert.equal(
    satisfied.status,
    0,
    `a tree whose required titles all ran was refused:\n${satisfied.stdout}\n${satisfied.stderr}`,
  );
  assert.equal(missingTitles(satisfied.stderr), 0, 'a title carried by a test that ran was reported as missing');

  // And a title the run cannot satisfy, over the same tree, so what the case
  // above shows is a reading rather than a runner that reports nothing.
  const absent = runTree(fixtureDir('passing'), [position('passing.test.mjs', 'a test nobody wrote')]);
  assert.equal(absent.status, 1, 'a required title no test carries was accepted');
  assert.equal(missingTitles(absent.stderr), 1, `the missing title was not reported once:\n${absent.stderr}`);

  // The position rather than the title, through the runner. This title belongs
  // to a test that really does run in this tree — inside a group — so a run keyed
  // by title alone satisfies it and a run keyed by position does not. The policy
  // half of this is asserted above against a set built by hand; this is the
  // event stream saying the same thing.
  const insideAGroup = runTree(fixtureDir('passing'), [
    position('passing.test.mjs', 'a test that passes inside a group (0)'),
  ]);
  assert.equal(insideAGroup.status, 1, 'a required title carried only by a test inside a group was accepted');
  assert.equal(
    missingTitles(insideAGroup.stderr),
    1,
    `a test inside a group stood in for one at the top of the file:\n${insideAGroup.stderr}`,
  );

  // And the direction that had no observer at all: a test that did not run must
  // not be recorded as one. Both flags, because they are two readings and the
  // runner makes them in one place — and both trees are refused by the floors as
  // well, which is why the assertion is on the reason rather than on the exit
  // code. Under the moved line these trees still exit 1, still say `did not
  // run`, and say nothing whatsoever about the titles.
  for (const [tree, file, what] of /** @type {[string, string, string][]} */ ([
    ['skipped', 'skipped.test.mjs', 'a test that is skipped'],
    ['pending', 'pending.test.mjs', 'a test that is pending'],
  ])) {
    const titles = [`${what} (0)`, `${what} (1)`];
    const result = runTree(
      fixtureDir(tree),
      titles.map((title) => position(file, title)),
    );

    assert.equal(result.status, 1, `the ${tree} tree was accepted as a run of the suite`);
    assert.equal(
      missingTitles(result.stderr),
      titles.length,
      `a test in the ${tree} tree was recorded as a test that ran:\n${result.stderr}`,
    );
    for (const title of titles) {
      assert.ok(
        result.stderr.includes(title),
        `the ${tree} tree did not report ${title} as not executed:\n${result.stderr}`,
      );
    }
  }
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

test('a tree whose every test passes and whose group body throws exits 1', () => {
  // The failure that is not a failing test, and the one every other tree here
  // was blind to. A `describe` body runs while the file is being read, so a line
  // that throws in one reports a failure whose kind is a group and leaves no
  // failing test behind — the reporter prints the failure and says `fail 0`
  // beside it. Read through the leaf test, as the pass count is, there was
  // nothing to refuse: this tree exited 0 with the failure on the screen.
  const result = runTree(fixtureDir('suite-throws'));

  assert.equal(result.status, 1, 'a run reporting a failure that was not a failing test exited 0');
  assert.ok(
    result.stderr.includes('none of them was a test'),
    `the throwing-group run gave a different reason:\n${result.stderr}`,
  );

  // And the tree is otherwise a run of the suite, so the exit code is about the
  // failure rather than about a floor: every test in it passed, there are enough
  // of them, and the reporter counted no failing test at all.
  assert.ok(reported(result.stdout, 'pass') >= MINIMUM_EXECUTED_TESTS);
  assert.ok(!result.stderr.includes('did not run'));
  assert.equal(
    reported(result.stdout, 'fail'),
    0,
    'the throwing-group fixture registered a failing test, so it no longer holds the case it is for',
  );
});

test('a tree whose every test passes and whose file-level hook throws exits 1', () => {
  // The sibling of the tree above, and the one that decides which way round the
  // runner's leaf test is written. A hook at the top of a file belongs to the
  // file rather than to a group, so its failure is reported under the file's own
  // name carrying no kind at all — not `test`, not `suite`, absent. Every other
  // tree here is read the same way by `is it a test` and by `is it not a suite`,
  // because every event in them says which it is; this is the tree they part on.
  const result = runTree(fixtureDir('file-hook-throws'));

  assert.equal(result.status, 1, 'a run whose file-level hook threw exited 0');

  // The strict spelling's answer, in the words only it produces. Written as both
  // halves — the line that must be there and the line that must not — because
  // both spellings refuse this tree and the reason is the whole difference
  // between them. `is it not a suite` would count the kindless failure as a
  // failing test and refuse this run as `1 test(s) failed`; `is it a test` does
  // not count it, so the run is refused by the failure-event line instead and
  // the leaf count stays honest about what the runner actually saw.
  assert.ok(
    result.stderr.includes('none of them was a test'),
    `the file-level hook run gave a different reason:\n${result.stderr}`,
  );
  assert.ok(
    !result.stderr.includes('test(s) failed'),
    `the file-level hook's failure was counted as a failing test:\n${result.stderr}`,
  );

  // And the disagreement that makes the point readable: the reporter counts this
  // failure and the runner's own leaf count does not. Those two numbers are not
  // asserted to be equal anywhere, and this is the tree that shows why not.
  assert.ok(reported(result.stdout, 'pass') >= MINIMUM_EXECUTED_TESTS);
  assert.equal(
    reported(result.stdout, 'fail'),
    1,
    'the file-level-hook fixture reported no failure, so it no longer holds the case it is for',
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

test('the same tree answers the same whether it is named or given as a tree', () => {
  // What every other case in this file cannot ask. The runner is driven from
  // outside itself exactly once, here, and until now always through `--tree` —
  // so anything it does conditioned on *which suite it was asked for* was
  // invisible to all of it. That is not a theoretical gap: recording skipped
  // tests only when the suite was one of the frozen named ones left every
  // fixture tree above byte-identical, left `npm run check` at exit 0, and armed
  // the next `test.skip` on a required test to pass unnoticed. The observed path
  // and the load-bearing path were different paths.
  //
  // So one tree is also a named suite, and it is run both ways with the same
  // required titles and required to answer the same. The tree is nothing but
  // skipped tests — which is the one shape where "was it recorded as having run"
  // is a question with two possible answers.
  //
  // The titles are written out here rather than read off the suite, which is
  // where this used to take them. The comment on that suite says its list is
  // pinned from outside by this case, and it was not: both runs took their
  // titles from the same list, so emptying it made both runs ask nothing and
  // agree about it, and the equality at the end of this case is satisfied by two
  // runs that were each handed no question. Written here, the list is a claim
  // this file makes about that tree, and a suite that has quietly shortened its
  // own is a disagreement.
  const suite = namedSuite('skipped-fixture');
  const titles = ['a test that is skipped (0)', 'a test that is skipped (1)'];
  assert.deepEqual(
    [...(suite.requiredTests['skipped.test.mjs'] ?? [])],
    titles,
    'the named fixture suite requires different titles from the ones this case is written about',
  );

  const named = runRunner(['skipped-fixture']);
  const tree = runTree(fixtureDir('skipped'), titles.map((title) => position('skipped.test.mjs', title)));

  /** @param {string} stderr */
  const titleLines = (stderr) =>
    stderr
      .split('\n')
      .filter((line) => line.includes('did not execute at the top level'))
      .sort()
      .join('\n');

  for (const [how, result] of /** @type {[string, typeof named][]} */ ([['named', named], ['tree', tree]])) {
    assert.equal(result.status, 1, `the ${how} run accepted a tree of skipped tests as a run of the suite`);
    assert.equal(
      missingTitles(result.stderr),
      titles.length,
      `the ${how} run did not report every skipped title as one that did not execute:\n${result.stderr}`,
    );
    // And the recorder was never offered one of them, which is the difference
    // between a guard that is where this runner says it is and one that has been
    // moved, duplicated, or made conditional. A run that offers them records
    // nothing either way — `positionOf` sees to that — so without this line the
    // edit would sit in the file doing nothing until somebody skipped a test out.
    assert.ok(
      !result.stderr.includes('offered to the recorder'),
      `the ${how} run offered a test that did not run to the recorder:\n${result.stderr}`,
    );
  }

  // And the two answers are the same answer, rather than two runs that each
  // happened to be refused. This is the whole claim in one line: which selector
  // was used is not something this runner's recording behaviour reads.
  assert.equal(
    titleLines(named.stderr),
    titleLines(tree.stderr),
    'the named run and the tree run of one tree disagreed about which tests executed',
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

test('a tree of nothing but empty groups exits 1', () => {
  // The third door into the same room, and the one that needs no flag on
  // anything. A group of tests reports itself to the runner under the same event
  // name a test does — a pass when everything inside it passed, and a group with
  // nothing inside it passes trivially — so a file whose tests have been wrapped
  // and then emptied arrived as one event per group having run none of them.
  // Counted at face value that was a run of the suite, with every floor clear.
  const result = runTree(fixtureDir('only-suites'));

  assert.equal(result.status, 1, 'a tree of nothing but empty groups was accepted as a run of the suite');
  assert.ok(result.stderr.includes('did not run'), `the empty-group run gave a different reason:\n${result.stderr}`);

  // And there were enough of them to satisfy a count that read the event and not
  // the kind, which is the count this case exists to refuse. The reporter counts
  // groups separately from tests, and its two numbers are what say the tree is
  // the shape this case needs: many groups, no test.
  assert.ok(
    reported(result.stdout, 'suites') >= MINIMUM_EXECUTED_TESTS,
    'the empty-group fixture no longer carries enough groups to clear the floor under a naive count',
  );
  assert.equal(reported(result.stdout, 'tests'), 0, 'the empty-group fixture registered a test');
  assert.equal(reported(result.stdout, 'pass'), 0, 'a group was reported as a passing test');
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
  //
  // Both trees carry groups, and until they did this comparison was two readings
  // that could not disagree. Every test in both of them sat at the top of its
  // file, where a group and a test are the same shape of event and counting one
  // as the other costs nothing — so the pin held a counter that was already
  // wrong. `passing` now carries two empty groups and one holding tests, and
  // `failing` fails inside a group, so a count that reads the event and not the
  // kind is three too many on one side and twice too many on the other.
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
  // The trailing arguments of the tree form too, which are required positions.
  // A position that is not one has to be a command line the runner refuses
  // rather than a title nothing can satisfy: the second is a run refused for a
  // reason that says nothing about the tree, and it would read exactly like the
  // defect these positions exist to catch.
  const tree = fixtureDir('passing');
  for (const args of [
    [],
    ['not-a-suite'],
    ['--tree'],
    ['fast', 'self'],
    ['--tree', ''],
    ['--tree', tree, 'no-separator'],
    ['--tree', tree, position('subdir/passing.test.mjs', 'a test that passes (0)')],
    ['--tree', tree, '::a test that passes (0)'],
    ['--tree', tree, 'passing.test.mjs::'],
    ['--tree', tree, position('passing.test.mjs', 'a test that passes (0)'), 'no-separator'],
  ]) {
    const result = runRunner(args);
    assert.equal(result.status, 1, `the runner accepted ${JSON.stringify(args)}`);
    assert.ok(result.stderr.includes('usage'), `the runner gave a different reason for ${JSON.stringify(args)}`);
  }
});

test('a run spawned where the manifest is wrong is refused, and names the step', () => {
  // That this runner *calls* the manifest check, which is a different question
  // from what that check answers and was asked nowhere. Every case for the
  // reading itself is in `test/node/core.test.mjs`, which hands the two readers a
  // tree written to be wrong and requires the refusals; none of it observes that
  // any program invokes them. Deleting `checkManifest(readManifest())` from this
  // runner and from the browser one left the whole gate exiting 0 with everything
  // else pristine, because the manifest this repository actually has is sound in
  // every spawn the suite makes, so the call contributes no failure whether it is
  // there or not.
  //
  // So the tree the runner is spawned from is one whose manifest is wrong. A copy
  // of the runner in that tree is a runner whose root is that tree, which is what
  // makes the manifest it reads a thing this case can choose — and a copy taken
  // from `scripts/` as the case runs is this repository's runner rather than a
  // second harness written to resemble it.
  //
  // The substituted step is deliberately not one of this runner's own. What is
  // being shown is that the runner reads the whole manifest, so the step it names
  // is the browser one, which nothing about a node test run needs.
  // Three damages rather than one, because `checkManifest` reaches the disk three
  // ways and only one of them is the manifest. Its `fileExists` and `readConfig`
  // arguments both have defaults, every case that drives those branches hands an
  // injected function instead, and the calls that take the defaults are all made
  // against this repository, where nothing is wrong — so a default replaced by
  // one that answers without reading left every one of them green. A tree written
  // to be wrong in each of the three ways is where the defaults are the thing
  // being asked.
  const programs = ['run-node-tests.mjs', 'run-node-tests-core.mjs', 'check-manifest-core.mjs'];
  /** @type {[string, Parameters<typeof scratchRepository>[1], string][]} */
  const damages = [
    ['a step silenced in the manifest', { substitutions: { 'test:smoke': 'true' } }, '`test:smoke` runs "true"'],
    ['the typecheck configuration turned off', { checkJs: false }, 'jsconfig.json sets compilerOptions'],
    ['a file a step names taken off the disk', { absent: 'playwright.config.js' }, 'playwright.config.js, which is not there'],
  ];

  const sound = scratchRepository(programs);
  try {
    const result = spawnRunner(sound.runner, ['--tree', fixtureDir('passing')]);
    assert.equal(result.status, 0, `a copy of the runner beside a sound repository was refused:\n${result.stderr}`);
  } finally {
    rmSync(sound.root, { recursive: true, force: true });
  }

  for (const [what, damage, reason] of damages) {
    const tree = scratchRepository(programs, damage);
    try {
      const result = spawnRunner(tree.runner, ['--tree', fixtureDir('passing')]);
      assert.equal(result.status, 1, `a tree of passing tests beside ${what} was accepted`);
      assert.ok(
        result.stderr.includes(reason),
        `the run did not report ${what}:\n${result.stderr}`,
      );
    } finally {
      rmSync(tree.root, { recursive: true, force: true });
    }
  }
});
