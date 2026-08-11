/**
 * Self-test for the browser-path runner.
 *
 * The runner decides whether the browser suite's result is reported as a pass,
 * which makes it the one part of that path a test inside the suite cannot check:
 * a runner asked to judge itself gets to choose its own verdict, and neutering
 * one `process.exitCode = 1` is a one-character edit that every test it runs
 * would keep passing through.
 *
 * So it is spawned as a real child process, pointed at fixture configurations
 * with known answers, and judged on the exit code it hands back to the shell —
 * which is the only thing `npm run check` reads.
 *
 * The claims tested here, and why each one exists:
 *
 *   - A passing tree exits 0. Without it, a runner that refused everything would
 *     satisfy every other case below.
 *   - A tree with a failing test exits 1, and for that reason rather than for
 *     being too small to count as a run.
 *   - A tree of nothing but skipped tests exits 1. The harness reports that as a
 *     success, because nothing failed, and skipping out a file is one line.
 *   - A tree run in one engine exits 1. Both engines are a stated property of
 *     this suite, and dropping one from a configuration is a one-line edit that
 *     leaves a suite which still passes — in one engine. The fixture clears
 *     every other floor on its own, so the engine is the only thing wrong with
 *     it.
 *   - A run that lost one named test is refused, in either engine, with every
 *     total still clear. That is the quietest edit of the lot — one `.skip` on
 *     the test that carries the corpus — and it is put to the policy directly,
 *     from a report built here, because a fixture tree cannot be the real
 *     suite's corpus going missing.
 *   - A tree with the corpus file collected out exits 1. The quieter of the two
 *     ways to lose a spec file: the file is still there, the run still matches
 *     tests, and the harness still exits 0 having asked none of what that file
 *     holds.
 *   - A run of this repository's own configuration that collected from anywhere
 *     but `test/` is refused. Every other claim above is read from a file name
 *     the harness reports relative to whatever directory it was pointed at, so
 *     redirecting `testDir` at the fixture tree below satisfied all of them with
 *     a suite that is not this one. Put to the policy directly, because the
 *     fixture trees are exactly the runs that are allowed to collect elsewhere.
 *   - A test whose attempts failed while the harness called the outcome expected
 *     is a failure. `test.fail()` over a failing assertion is reported that way,
 *     and it is a test that ran and gave the wrong answer. Every other way an
 *     attempt can end is asked about too, so what is held is the comparison and
 *     not the one status that one fixture happens to produce.
 *   - A tree with exactly one reason to be refused exits 1. Every other fixture
 *     here is refused for several reasons at once, so a gate that tolerated one
 *     reason would still refuse all of them and look correct.
 *   - A default invocation — no configuration named, which is what `npm run
 *     check` makes — fails closed unless the harness demonstrably loaded this
 *     repository's own configuration. The harness picks one when it is not given
 *     one and prefers a `.ts` file to the `.js` file beside it. That branch of
 *     the command-line reading is also the one no other case here takes.
 *   - A required test is identified by its whole reported name for a run of this
 *     repository's configuration, so a spec file in a subdirectory of `test/`
 *     cannot supply the identity of one that was skipped out.
 *   - And by its whole position inside that file, so a group written in the
 *     genuine file cannot supply it either. That is the one route no directory
 *     comparison and no file-name comparison can reach, because everything about
 *     it is where it is supposed to be except the test.
 *   - The names a run reported are measured from this suite's own directory. The
 *     root a run resolves is a different field from a project's collection
 *     directory and can be a different directory, and it is the one every file
 *     name in the report is relative to.
 *   - A path that ends in a separator this platform does not use is not the same
 *     path with the separator removed: on a system whose separator is `/`, a
 *     backslash is an ordinary character a directory name may end in.
 *   - Each counting floor refuses the count below it and admits the count at it,
 *     and every counter is read back against a report of known size. A floor is
 *     a constant and a comparison, and a run nowhere near the boundary holds
 *     only the constant.
 *   - A path that merely extends another is not that path, in both the directory
 *     comparison and the configuration one.
 *   - An absent configuration exits 1, and a command line that is neither
 *     documented form exits 1.
 *
 * The fixture corpus lives under `scripts/browser-fixtures/`, outside the
 * directory the real harness collects from, so the real run can never pick it up
 * and no ignore rule is needed to keep it out. An ignore rule would be one more
 * place a spec file could be excluded from.
 *
 * No browser is started by any of it: the fixture tests never ask for a page, so
 * what is exercised is collection, execution and reporting — which is all the
 * floors are read from.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHECK_COMMANDS, CHECK_CONFIGS, CHECK_FILES, CHECK_STEPS } from './check-manifest-core.mjs';
import {
  checkBrowserRun,
  MINIMUM_EXECUTED_TESTS,
  MINIMUM_EXECUTED_TESTS_PER_ENGINE,
  MINIMUM_EXECUTED_TESTS_PER_SPEC_FILE,
  MINIMUM_SPEC_FILES,
  REQUIRED_CONFIG_FILE,
  REQUIRED_ENGINES,
  REQUIRED_SPEC_FILES,
  REQUIRED_TEST_DIR,
  REQUIRED_TESTS,
  summariseRun,
} from './run-browser-tests-core.mjs';

const FIXTURES = fileURLToPath(new URL('./browser-fixtures/', import.meta.url));
const RUNNER = fileURLToPath(new URL('./run-browser-tests.mjs', import.meta.url));

/**
 * @param {string} name
 * @returns {string}
 */
function fixtureConfig(name) {
  return join(FIXTURES, name, 'playwright.config.js');
}

/**
 * Run the runner as a child process, the way a shell does.
 *
 * @param {string[]} args
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runRunner(args) {
  return runRunnerAt(RUNNER, args);
}

/**
 * Run a runner as a child process, the way a shell does.
 *
 * The program and the directory it is run from are arguments for two cases at
 * the end of this file: one spawns a copy of the runner from a tree whose
 * manifest is wrong, and one runs this repository's own runner with no
 * configuration named, which is the shape `npm run check` uses and is the one
 * that has to be run from this repository to mean anything. Every other call is
 * `runRunner` above.
 *
 * @param {string} runner
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runRunnerAt(runner, args, cwd = undefined) {
  // This file is run by the fast-path runner, which marks its children so that a
  // nested test run refuses to execute any files. The child here is not a node
  // test run, but its own children are node processes and the mark travels.
  const environment = { ...process.env };
  delete environment['NODE_TEST_CONTEXT'];

  const result = spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', env: environment, cwd });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * @param {string} name
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runFixture(name) {
  return runRunner(['--config', fixtureConfig(name)]);
}

/**
 * The configuration a report says was loaded, or `null`.
 *
 * @param {unknown} report
 * @returns {string | null}
 */
function configFileOf(report) {
  if (report === null || typeof report !== 'object') {
    return null;
  }
  const config = /** @type {Record<string, unknown>} */ (report)['config'];
  if (config === null || typeof config !== 'object') {
    return null;
  }
  const named = /** @type {Record<string, unknown>} */ (config)['configFile'];
  return typeof named === 'string' ? named : null;
}

/**
 * Put a run to the policy the way the runner does.
 *
 * A run carries which configuration the command line named as well as which one
 * the harness loaded, and the two are different questions: the first says
 * whether anybody chose, the second says what was chosen. Unless a case says
 * otherwise it stands for one of this file's own fixture invocations, which name
 * the configuration they are pointed at — so the name defaults to what the
 * report says was loaded. The cases that are about the default invocation, which
 * names nothing and lets the harness choose, pass `configArgument: null` for
 * themselves.
 *
 * @param {{ report: unknown, exitCode: number | null, configArgument?: string | null }} run
 * @returns {string[]}
 */
function judge(run) {
  return checkBrowserRun({
    report: run.report,
    exitCode: run.exitCode,
    configArgument: 'configArgument' in run ? (run.configArgument ?? null) : configFileOf(run.report),
  });
}

/**
 * The lines the runner reported as reasons to refuse a run.
 *
 * Every one of them is written with the same prefix, so counting them is
 * counting the reasons rather than counting whatever else reached this stream.
 *
 * @param {string} stderr
 * @returns {string[]}
 */
function reasons(stderr) {
  return stderr.split('\n').filter((line) => line.startsWith('test:smoke — '));
}

test('a passing tree exits 0', () => {
  const result = runFixture('passing');

  assert.equal(result.status, 0, `the passing tree did not exit 0:\n${result.stdout}\n${result.stderr}`);
  assert.ok(result.stdout.includes('test:smoke — '), 'the passing run printed no summary line');
  for (const engine of REQUIRED_ENGINES) {
    assert.ok(result.stdout.includes(`in ${engine}`), `the passing run reported nothing for ${engine}`);
  }
});

test('a tree with a failing test exits 1, and for that reason', () => {
  const result = runFixture('failing');

  assert.equal(result.status, 1, 'a failing test did not fail the run');
  assert.ok(result.stderr.includes('test(s) failed'), `the failing run gave a different reason:\n${result.stderr}`);
  assert.ok(!result.stderr.includes('did not run'), 'the failing fixture no longer clears the executed-test floor');
});

test('a tree of nothing but skipped tests exits 1', () => {
  const result = runFixture('skipped');

  assert.equal(result.status, 1, 'a tree of skipped tests was accepted as a run of the suite');
  assert.ok(result.stderr.includes('did not run'), `the skipped run gave a different reason:\n${result.stderr}`);
});

test('a tree run in one engine exits 1', () => {
  const result = runFixture('one-engine');

  assert.equal(result.status, 1, 'a run in one engine was accepted as a run of the suite');
  assert.ok(
    result.stderr.includes('one engine rather than both'),
    `the one-engine run gave a different reason:\n${result.stderr}`,
  );
  // And nothing else was wrong with it, so the engine is what the exit code is
  // about rather than a tree that was short anyway. The named tests are missing
  // from the engine that never ran, which is the same fact said the other way.
  assert.ok(!result.stderr.includes('did not run'));
  assert.ok(!result.stderr.includes('spec file(s)'));
});

test('a tree with the corpus collected out exits 1', () => {
  const result = runFixture('missing-spec');

  assert.equal(result.status, 1, 'a run that collected out the corpus was accepted as a run of the suite');
  assert.ok(
    result.stderr.includes('core.spec.js ran no test'),
    `the collected-out run gave a different reason:\n${result.stderr}`,
  );
});

test('a tree with exactly one reason to be refused exits 1', () => {
  // The boundary the runner's own gate has, and the one every fixture above is
  // too broken to reach. Each of those is refused for several reasons at once —
  // a failing tree exits non-zero and reports a failure, a skipped tree misses
  // every named test and every count — so a gate written as "one reason is still
  // a pass" reports all of them as failures anyway and looks correct. This tree
  // is refused for exactly one reason, and it is the smallest thing that must
  // not be reported as a pass.
  const result = runFixture('one-file-skipped');

  assert.equal(result.status, 1, 'a run with one reason to be refused was reported as a pass');
  const lines = reasons(result.stderr);
  assert.equal(lines.length, 1, `the tree was meant to give exactly one reason:\n${result.stderr}`);
  assert.ok(
    lines[0]?.includes('extra.spec.js executed 0 test(s)'),
    `the one reason was not the one the tree is for:\n${result.stderr}`,
  );
});

test('a default invocation that did not load this configuration exits 1', () => {
  // The branch of the command-line reading that no other case here reaches.
  // Every fixture above names its configuration, so the branch that adds no
  // arguments — the one `npm run check` takes — was never taken by anything that
  // could judge the result, and a default branch that had quietly grown a
  // configuration of its own would have been invisible.
  //
  // Run from a directory carrying no configuration, so the harness has none to
  // find. What must come back is a refusal that says the harness did not run,
  // and that is the part a redirected default branch cannot produce: pointed at
  // a fixture tree, the harness runs it and exits 0.
  const directory = mkdtempSync(join(tmpdir(), 'browser-path-selftest-'));
  try {
    const environment = { ...process.env };
    delete environment['NODE_TEST_CONTEXT'];
    const spawned = spawnSync(process.execPath, [RUNNER], {
      encoding: 'utf8',
      env: environment,
      cwd: directory,
    });
    const result = { status: spawned.status, stderr: spawned.stderr ?? '' };

    assert.equal(result.status, 1, 'a default invocation with no configuration to find was accepted');
    assert.ok(
      result.stderr.includes('the browser harness exited'),
      `the default invocation did not report the harness having failed:\n${result.stderr}`,
    );
    // And the other half of the same claim: a run nobody pointed anywhere is
    // held to this repository's own configuration rather than to whatever the
    // harness happened to load.
    assert.ok(
      result.stderr.includes('nothing pointed this run at a configuration'),
      `the default invocation was not held to this repository's configuration:\n${result.stderr}`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an absent configuration exits 1', () => {
  const result = runFixture('does-not-exist');

  assert.equal(result.status, 1, 'an absent configuration was accepted as a run of the suite');
});

test('a command line that is neither documented form exits 1', () => {
  for (const args of [['--config'], ['--config', ''], ['passing'], ['--config', fixtureConfig('passing'), 'extra']]) {
    const result = runRunner(args);
    assert.equal(result.status, 1, `the runner accepted ${JSON.stringify(args)}`);
    assert.ok(result.stderr.includes('usage'), `the runner gave a different reason for ${JSON.stringify(args)}`);
  }
});

/**
 * One entry of a built report: a test, where it lived, which engine ran it, what
 * the harness called the outcome, and what its attempts did.
 *
 * `groups` is the other half of where it lived — the titles of the groups
 * enclosing it inside its spec file, outermost first. Absent means a test at the
 * top level of its file, which is what every test the suite is built from is.
 *
 * @typedef {{ file: string, title: string, engine: string, status: string, results?: { status: string }[], groups?: string[] }} Reported
 */

/**
 * What a test's attempts did, for a case that has not written them out.
 *
 * The two are different things and the policy reads both: an outcome the harness
 * classified, and what the attempts behind it actually did. A case that names
 * only the classification gets the attempts that ordinarily produce it, so the
 * cases about the floors stay about the floors.
 *
 * @param {string} status
 * @returns {{ status: string }[]}
 */
function attemptsFor(status) {
  if (status === 'expected') {
    return [{ status: 'passed' }];
  }
  if (status === 'flaky') {
    return [{ status: 'failed' }, { status: 'passed' }];
  }
  if (status === 'skipped') {
    return [{ status: 'skipped' }];
  }
  return [{ status: 'failed' }];
}

/**
 * A harness report, built here rather than produced by a run, so each floor can
 * be shown to bite on its own.
 *
 * @param {Reported[]} tests
 * @param {{ configFile?: string, directories?: string[], rootDir?: string | null }} [where]
 *   Which configuration the run loaded, where it collected from, and what the
 *   names it reported are relative to. The default is a configuration that is
 *   not this repository's, so the cases that name none of them are about the
 *   floor each of them names and nothing else. The root defaults to the first
 *   collection directory, which is what the harness reports whenever every
 *   project collects from one tree — so a case that is not about the root gets
 *   the root a real run of that shape would have had. `null` leaves the field
 *   out of the report altogether, which is the shape a run that said nothing
 *   about it has.
 * @returns {unknown}
 */
function reportOf(tests, where = {}) {
  const directories = where.directories ?? ['/elsewhere'];
  const rootDir = where.rootDir === undefined ? directories[0] ?? '/elsewhere' : where.rootDir;
  return {
    config: {
      configFile: where.configFile ?? '/elsewhere/playwright.config.js',
      ...(rootDir === null ? {} : { rootDir }),
      projects: directories.map((testDir) => ({ testDir })),
    },
    suites: tests.map((one) => {
      const spec = {
        file: one.file,
        title: one.title,
        tests: [
          {
            projectName: one.engine,
            status: one.status,
            results: one.results ?? attemptsFor(one.status),
          },
        ],
      };
      const groups = one.groups ?? [];
      if (groups.length === 0) {
        // The shape the harness reports for a test written at the top of its
        // file: one suite for the file, carrying the spec directly.
        return { title: one.file, specs: [spec] };
      }
      // And for one written inside groups: the spec sits in the innermost group,
      // each group is a suite inside the one above it, and the file is still the
      // suite at the top.
      /** @type {Record<string, unknown>} */
      let node = { title: groups[groups.length - 1], specs: [spec] };
      for (let index = groups.length - 2; index >= 0; index -= 1) {
        node = { title: groups[index], specs: [], suites: [node] };
      }
      return { title: one.file, specs: [], suites: [node] };
    }),
  };
}

/**
 * A run with nothing wrong with it: every named test in every engine, every
 * count comfortably clear.
 *
 * The starting point for the cases that damage one thing at a time, so what each
 * of them shows is the damage rather than the tree.
 *
 * @returns {Reported[]}
 */
function wholeRun() {
  /** @type {Reported[]} */
  const whole = [];
  for (const engine of REQUIRED_ENGINES) {
    for (const [file, titles] of Object.entries(REQUIRED_TESTS)) {
      for (const title of titles) {
        whole.push({ file, title, engine, status: 'expected' });
      }
    }
    for (let index = 0; index < MINIMUM_EXECUTED_TESTS; index += 1) {
      whole.push({ file: 'core.spec.js', title: `filler (${index})`, engine, status: 'expected' });
    }
    whole.push({ file: 'smoke.spec.js', title: 'filler', engine, status: 'expected' });
  }
  return whole;
}

test('the run policy answers the questions it is asked', () => {
  const whole = wholeRun();

  assert.deepEqual(judge({ report: reportOf(whole), exitCode: 0 }), []);
  assert.ok(judge({ report: reportOf(whole), exitCode: 1 }).some((line) => line.includes('exited 1')));
  assert.ok(judge({ report: null, exitCode: 0 }).some((line) => line.includes('did not run')));

  const oneFile = whole.filter((one) => one.file === 'core.spec.js');
  const oneFileFailures = judge({ report: reportOf(oneFile), exitCode: 0 });
  assert.ok(oneFileFailures.some((line) => line.includes('spec file(s)')));
  assert.ok(oneFileFailures.some((line) => line.includes('smoke.spec.js ran no test')));

  const oneEngine = whole.filter((one) => one.engine === REQUIRED_ENGINES[0]);
  assert.ok(
    judge({ report: reportOf(oneEngine), exitCode: 0 }).some((line) =>
      line.includes('one engine rather than both'),
    ),
  );

  const allSkipped = whole.map((one) => ({ ...one, status: 'skipped' }));
  assert.ok(judge({ report: reportOf(allSkipped), exitCode: 0 }).some((line) => line.includes('did not run')));
  assert.equal(summariseRun(reportOf(allSkipped)).executed, 0);
  assert.equal(summariseRun(reportOf(allSkipped)).skipped, whole.length);

  const oneFailed = [
    ...whole,
    { file: 'core.spec.js', title: 'one more', engine: 'chromium', status: 'unexpected' },
  ];
  assert.ok(judge({ report: reportOf(oneFailed), exitCode: 0 }).some((line) => line.includes('test(s) failed')));

  // One named test skipped out, in one engine, with every total still clear.
  // This is the edit the counts above cannot see: two spec files still ran, both
  // required, and the per-engine floor is met several times over.
  for (const [file, titles] of Object.entries(REQUIRED_TESTS)) {
    for (const title of titles) {
      for (const engine of REQUIRED_ENGINES) {
        const lost = whole.map((one) =>
          one.file === file && one.title === title && one.engine === engine ? { ...one, status: 'skipped' } : one,
        );
        const failures = judge({ report: reportOf(lost), exitCode: 0 });
        assert.ok(
          failures.some((line) => line.includes(title) && line.includes(engine)),
          `${title} skipped out of ${engine} was not noticed: ${JSON.stringify(failures)}`,
        );
        assert.ok(!failures.some((line) => line.includes('did not run')), 'the totals were meant to stay clear');
      }
    }
  }

  // And a spec file that was collected and executed nothing, which the total is
  // blind to for the same reason the fast path's total was: the other file
  // clears it on its own.
  const thirdFileRanNothing = [
    ...whole,
    { file: 'extra.spec.js', title: 'a test that was skipped out', engine: 'chromium', status: 'skipped' },
  ];
  assert.ok(
    judge({ report: reportOf(thirdFileRanNothing), exitCode: 0 }).some((line) =>
      line.includes('extra.spec.js executed 0 test(s)'),
    ),
  );

  // Where the run collected from. Every claim above is read from a file name the
  // harness reports relative to the directory it was pointed at, so all of them
  // are satisfied by a suite of the same file names somewhere else — which is
  // what one line of the harness configuration produces.
  const own = { configFile: REQUIRED_CONFIG_FILE, directories: [REQUIRED_TEST_DIR] };
  assert.deepEqual(judge({ report: reportOf(whole, own), exitCode: 0 }), []);

  const redirected = { configFile: REQUIRED_CONFIG_FILE, directories: ['/elsewhere/browser-fixtures/passing'] };
  assert.ok(
    judge({ report: reportOf(whole, redirected), exitCode: 0 }).some(
      (line) => line.includes('/elsewhere/browser-fixtures/passing') && line.includes(REQUIRED_TEST_DIR),
    ),
    'a run of this configuration that collected from another tree was accepted',
  );

  // One engine redirected and the other not, which is two suites rather than
  // one, and is why every directory the run named is compared rather than one.
  assert.ok(
    judge({
      report: reportOf(whole, { configFile: REQUIRED_CONFIG_FILE, directories: [REQUIRED_TEST_DIR, '/elsewhere'] }),
      exitCode: 0,
    }).some((line) => line.includes('/elsewhere')),
  );

  assert.ok(
    judge({
      report: reportOf(whole, { configFile: REQUIRED_CONFIG_FILE, directories: [] }),
      exitCode: 0,
    }).some((line) => line.includes('named no directory')),
  );

  // And the fixture trees, which are the runs that are allowed to collect from
  // somewhere else and are the reason this is asked of one configuration rather
  // than of every run.
  assert.deepEqual(
    judge({
      report: reportOf(whole, { configFile: '/elsewhere/playwright.config.js', directories: ['/elsewhere'] }),
      exitCode: 0,
    }),
    [],
  );

  // A test that ran and gave the wrong answer, wearing the outcome of a test
  // that did what it said it would. `test.fail()` over a failing assertion is
  // reported as an expected outcome over a failed attempt, and the outcome is
  // what used to be counted.
  const declaredFailing = [
    ...whole,
    {
      file: 'core.spec.js',
      title: 'one that says it will fail',
      engine: 'chromium',
      status: 'expected',
      results: [{ status: 'failed' }],
    },
  ];
  assert.ok(
    judge({ report: reportOf(declaredFailing), exitCode: 0 }).some((line) => line.includes('test(s) failed')),
    'a failed attempt reported as an expected outcome was counted as a pass',
  );
  assert.equal(summariseRun(reportOf(declaredFailing)).failed, 1);

  // And the other direction, so this is a reading of the attempts rather than a
  // refusal of everything: attempts that end in a pass are a pass.
  //
  // Written under the classification a test declared to fail produces rather
  // than under the one the harness gives a retried test, and that is a change of
  // example rather than of the property. This used to be the retried case, and
  // it used to assert that such a run was accepted — which was true of the
  // policy and was the hole the case below this file's counting floors is now
  // about: an outcome the harness only ever produces when it has been told to
  // run a test again is refused there, by name, whatever its attempts did. What
  // this case is about is the attempts, and they are read the same way here as
  // they are there.
  const endedWell = [
    ...whole,
    {
      file: 'core.spec.js',
      title: 'one that failed and then passed',
      engine: 'chromium',
      status: 'expected',
      results: [{ status: 'failed' }, { status: 'passed' }],
    },
  ];
  assert.deepEqual(judge({ report: reportOf(endedWell), exitCode: 0 }), []);

  // The floors are floors rather than exact numbers, and the three lists are
  // lists rather than counts. Read back here so a floor lowered to nothing, or a
  // named test quietly dropped, is visible as a change to this file as well as
  // to the policy.
  assert.ok(MINIMUM_SPEC_FILES >= 3);
  assert.ok(MINIMUM_EXECUTED_TESTS >= MINIMUM_EXECUTED_TESTS_PER_ENGINE);
  assert.ok(MINIMUM_EXECUTED_TESTS_PER_SPEC_FILE >= 2);
  assert.deepEqual([...REQUIRED_SPEC_FILES].sort(), ['core.spec.js', 'smoke.spec.js', 'viewer.spec.js']);
  assert.deepEqual(Object.keys(REQUIRED_TESTS).sort(), ['core.spec.js', 'smoke.spec.js', 'viewer.spec.js']);
  for (const file of REQUIRED_SPEC_FILES) {
    assert.ok((REQUIRED_TESTS[file] ?? []).length >= 1, `${file} names no test that has to have run`);
  }
});

/**
 * A run of `count` tests, all in one spec file and one engine.
 *
 * For the cases about one floor at a time, where everything else being wrong is
 * the point: what is read back is whether that floor's own line was written,
 * not whether the run was accepted.
 *
 * @param {number} count
 * @param {string} [file]
 * @param {string} [engine]
 * @returns {Reported[]}
 */
function someTests(count, file = 'core.spec.js', engine = 'chromium') {
  return Array.from({ length: count }, (_unused, index) => ({
    file,
    title: `a test (${index})`,
    engine,
    status: 'expected',
  }));
}

/** The line each counting floor writes when it is not met. */
const TOTAL_SHORT = 'means the suite did not run rather than passed';
const ENGINE_SHORT = 'means this suite ran in one engine rather than both';
const SPEC_FILE_SHORT = 'means that file did not run rather than passed';

test('each counting floor refuses the count below it and admits the count at it', () => {
  // A floor is a constant and a comparison, and the constant is the only half of
  // it anything here was asking about: every fixture and every built report
  // above puts counts to these that are nowhere near the edge, so `<` relaxed to
  // `<=` — which refuses a run that exactly meets a floor — and `<` narrowed to
  // one below it — which admits a run one short — both survive. Each floor is
  // put its own two counts, and what is read back is that floor's own line
  // rather than whether the run was accepted, because a report built to sit on
  // one boundary is wrong in other ways by construction.

  /** @param {Reported[]} tests @returns {string[]} */
  const failuresOf = (tests) => judge({ report: reportOf(tests), exitCode: 0 });

  const belowTotal = failuresOf(someTests(MINIMUM_EXECUTED_TESTS - 1));
  assert.ok(
    belowTotal.some((line) => line.includes(TOTAL_SHORT)),
    `${MINIMUM_EXECUTED_TESTS - 1} executed test(s) was not reported as short of the total floor`,
  );
  assert.ok(
    !failuresOf(someTests(MINIMUM_EXECUTED_TESTS)).some((line) => line.includes(TOTAL_SHORT)),
    `exactly ${MINIMUM_EXECUTED_TESTS} executed test(s) was reported as short of the total floor`,
  );

  for (const engine of REQUIRED_ENGINES) {
    const below = failuresOf(someTests(MINIMUM_EXECUTED_TESTS_PER_ENGINE - 1, 'core.spec.js', engine));
    assert.ok(
      below.some((line) => line.includes(ENGINE_SHORT) && line.includes(engine)),
      `${MINIMUM_EXECUTED_TESTS_PER_ENGINE - 1} test(s) in ${engine} was not reported as short of the per-engine floor`,
    );
    const at = failuresOf(someTests(MINIMUM_EXECUTED_TESTS_PER_ENGINE, 'core.spec.js', engine));
    assert.ok(
      !at.some((line) => line.includes(ENGINE_SHORT) && line.includes(engine)),
      `exactly ${MINIMUM_EXECUTED_TESTS_PER_ENGINE} test(s) in ${engine} was reported as short of the per-engine floor`,
    );
  }

  const whole = wholeRun();
  for (const [count, short] of /** @type {[number, boolean][]} */ ([
    [MINIMUM_EXECUTED_TESTS_PER_SPEC_FILE - 1, true],
    [MINIMUM_EXECUTED_TESTS_PER_SPEC_FILE, false],
  ])) {
    const withExtra = [...whole, ...someTests(count, 'extra.spec.js')];
    const failures = failuresOf(withExtra);
    assert.equal(
      failures.some((line) => line.includes(SPEC_FILE_SHORT) && line.includes('extra.spec.js')),
      short,
      `a spec file that executed exactly ${count} test(s) was judged the other way`,
    );
  }
});

test('what a run reported is counted exactly', () => {
  // Every floor is a lower bound, so a counter that counted each test twice
  // would clear all of them twice over and no fixture would say a word — and the
  // per-file floor, which is what a skipped-out file trips, would be cleared by
  // a file that ran one test. The counts are read back against a report of known
  // size, in every dimension the policy keeps one.
  const whole = wholeRun();
  const summary = summariseRun(reportOf(whole));

  assert.equal(summary.executed, whole.length);
  assert.equal(summary.failed, 0);
  assert.equal(summary.skipped, 0);
  for (const engine of REQUIRED_ENGINES) {
    assert.equal(summary.byEngine.get(engine), whole.filter((one) => one.engine === engine).length);
  }
  for (const file of REQUIRED_SPEC_FILES) {
    assert.equal(summary.byFile.get(file), whole.filter((one) => one.file === file).length);
  }
  assert.deepEqual(summary.files, [...REQUIRED_SPEC_FILES].sort());

  // And the same of a run that executed nothing, so the two counters are shown
  // apart rather than one standing in for the other.
  const allSkipped = whole.map((one) => ({ ...one, status: 'skipped' }));
  const nothing = summariseRun(reportOf(allSkipped));
  assert.equal(nothing.executed, 0);
  assert.equal(nothing.skipped, whole.length);
  for (const file of REQUIRED_SPEC_FILES) {
    assert.equal(nothing.byFile.get(file), 0);
  }

  // And a run with one failure in it, counted as one.
  const oneFailed = [...whole, { file: 'core.spec.js', title: 'one more', engine: 'chromium', status: 'unexpected' }];
  assert.equal(summariseRun(reportOf(oneFailed)).failed, 1);
  assert.equal(summariseRun(reportOf(oneFailed)).executed, whole.length + 1);
});

test('a test whose last attempt did not pass is a failure, whatever the outcome was called', () => {
  // The comparison rather than the one status the harness's expected-to-fail
  // case produces. Read as "the last attempt did not fail" it refuses exactly
  // that one case and admits every other way an attempt can end — a timeout, an
  // interruption, a skip, a status spelled differently — each of which is a test
  // that ran and did not give the right answer.
  const whole = wholeRun();

  /** @param {{ status: string }[]} results @returns {string[]} */
  const withAttempts = (results) =>
    judge({
      report: reportOf([
        ...whole,
        { file: 'core.spec.js', title: 'one whose attempts are the question', engine: 'chromium', status: 'expected', results },
      ]),
      exitCode: 0,
    });

  for (const status of ['timedOut', 'interrupted', 'skipped', 'failed', '', 'Passed', 'passed ']) {
    assert.ok(
      withAttempts([{ status }]).some((line) => line.includes('test(s) failed')),
      `an attempt that ended as ${JSON.stringify(status)} was counted as a pass`,
    );
  }

  // No attempts at all is not a pass either, and neither is a last attempt that
  // failed after one that passed — which is what reading the first attempt
  // instead of the last would call a pass.
  assert.ok(withAttempts([]).some((line) => line.includes('test(s) failed')));
  assert.ok(
    withAttempts([{ status: 'passed' }, { status: 'failed' }]).some((line) => line.includes('test(s) failed')),
    'a test that passed and then failed was counted by its first attempt',
  );

  // And the accepting direction, so this is a reading of the attempts rather
  // than a refusal of everything.
  assert.deepEqual(withAttempts([{ status: 'passed' }]), []);
  assert.deepEqual(withAttempts([{ status: 'failed' }, { status: 'passed' }]), []);
});

test('a test the harness ran again until it passed is not a test this suite reports', () => {
  // The outcome no floor here could see, and the one that would quietly undo
  // several of the readings in the suite these floors are about.
  //
  // The harness runs each test once, because how many times it runs one is a
  // setting and that setting is at its default. Nothing anywhere said so — not
  // this file, not the policy, not the pins on the manifest — and raising it is
  // one word in one file. A run made that way reports a test that failed and
  // then passed as `flaky`, which is a test that ran, in the right file, in both
  // engines, whose last attempt passed: every count in the policy clear, the
  // reading of its attempts satisfied, and the whole step green.
  //
  // What that hides is the class of thing the browser suite exists for. Its
  // readings about ordering — advice drawn over a settled surface, a
  // continuation resolving after a page was put away — are readings of a race,
  // and a race that fails once and passes on the retry is exactly what a retry
  // turns into a pass. So the outcome is refused, whatever asked for it.
  //
  // Refused by name and separately from the failure count, because the two say
  // different things: one is a test that gave the wrong answer, and this is a
  // test that gave the right one only when it was asked twice.
  const whole = wholeRun();

  assert.equal(summariseRun(reportOf(whole)).flaky, 0, 'a run with nothing wrong with it reported a retried pass');

  /** @type {Reported[]} */
  const retried = [
    ...whole,
    { file: 'core.spec.js', title: 'one that needed a second asking', engine: 'chromium', status: 'flaky' },
  ];
  const summary = summariseRun(reportOf(retried));
  assert.equal(summary.flaky, 1, 'a test the harness called flaky was not counted as one');
  assert.equal(summary.executed, whole.length + 1, 'a test that ran twice was counted as other than one test');
  assert.equal(summary.failed, 0, 'a retried pass was counted as a failure, which is a different thing');

  const failures = judge({ report: reportOf(retried), exitCode: 0 });
  assert.ok(
    failures.some((line) => line.includes('passed only after being run again')),
    `a retried pass was accepted:\n${failures.join('\n')}`,
  );
  assert.ok(
    !failures.some((line) => line.includes('test(s) failed')),
    'a retried pass was reported as a failure rather than as what it is',
  );

  // And it is the outcome the harness classified rather than the attempts under
  // it. The same two attempts, under the classification a test declared to fail
  // produces, are accepted — which is what the case above this one asserts — so
  // the two cases have to part company on the same attempts, and they do.
  /** @type {Reported[]} */
  const declared = [
    ...whole,
    {
      file: 'core.spec.js',
      title: 'one that said what it would do',
      engine: 'chromium',
      status: 'expected',
      results: [{ status: 'failed' }, { status: 'passed' }],
    },
  ];
  assert.deepEqual(
    judge({ report: reportOf(declared), exitCode: 0 }),
    [],
    'the same attempts under a different classification were refused, so this is not the reading it says it is',
  );

  // And a retried test whose last attempt did not pass is both things at once:
  // it needed a second asking, and it still gave the wrong answer.
  /** @type {Reported[]} */
  const bothWays = [
    ...whole,
    {
      file: 'core.spec.js',
      title: 'one that needed a second asking and failed it',
      engine: 'chromium',
      status: 'flaky',
      results: [{ status: 'failed' }, { status: 'failed' }],
    },
  ];
  const both = judge({ report: reportOf(bothWays), exitCode: 0 });
  assert.ok(both.some((line) => line.includes('passed only after being run again')));
  assert.ok(both.some((line) => line.includes('test(s) failed')));
});

test('a path that merely extends another is not that path', () => {
  const whole = wholeRun();

  // The directory comparison, at the edge equality has and a prefix test does
  // not. A tree nested inside the one this suite collects from begins with it,
  // and so does a sibling whose name extends it; the directory above it is the
  // same relation the other way round. Each is a different set of spec files
  // reported under names relative to a different root.
  for (const directory of [
    join(REQUIRED_TEST_DIR, 'shadow'),
    dirname(REQUIRED_TEST_DIR),
    `${REQUIRED_TEST_DIR}-elsewhere`,
  ]) {
    assert.ok(
      judge({
        report: reportOf(whole, { configFile: REQUIRED_CONFIG_FILE, directories: [directory] }),
        exitCode: 0,
      }).some((line) => line.includes(directory)),
      `${directory} was accepted as the directory this suite collects from`,
    );
  }

  // The one difference between two spellings of a directory that means nothing,
  // and it is the only one admitted.
  assert.deepEqual(
    judge({
      report: reportOf(whole, {
        configFile: REQUIRED_CONFIG_FILE,
        directories: [`${REQUIRED_TEST_DIR}${sep}`],
        rootDir: REQUIRED_TEST_DIR,
      }),
      exitCode: 0,
    }),
    [],
  );

  // And the spelling that is not that one. A separator this platform does not
  // use is an ordinary character a directory name may end in, so dropping it
  // made a directory genuinely named that way compare equal to a different
  // directory of the same name without it. Only this platform's own separator
  // means nothing at the end of a path; everything else is part of the name.
  const otherSeparator = sep === '/' ? '\\' : '/';
  for (const spelling of [
    `${REQUIRED_TEST_DIR}${otherSeparator}`,
    `${REQUIRED_TEST_DIR}${sep}${sep}`,
    `${REQUIRED_TEST_DIR} `,
  ]) {
    assert.ok(
      judge({
        report: reportOf(whole, { configFile: REQUIRED_CONFIG_FILE, directories: [spelling], rootDir: spelling }),
        exitCode: 0,
      }).some((line) => line.includes(REQUIRED_TEST_DIR)),
      `${JSON.stringify(spelling)} was accepted as the directory this suite collects from`,
    );
  }

  // And the same comparison on the other side of it: which configuration was
  // loaded is what decides whether the directory is looked at at all, so a file
  // whose name merely begins with this repository's must not be taken for it.
  assert.deepEqual(
    judge({
      report: reportOf(whole, { configFile: `${REQUIRED_CONFIG_FILE}.disabled`, directories: ['/elsewhere'] }),
      exitCode: 0,
    }),
    [],
  );
});

test("a run that named no configuration must have loaded this repository's own", () => {
  const whole = wholeRun();
  const own = { configFile: REQUIRED_CONFIG_FILE, directories: [REQUIRED_TEST_DIR] };

  // The invocation `npm run check` makes: nothing named, the harness's own
  // choice, and it has to have chosen this repository's configuration.
  assert.deepEqual(judge({ report: reportOf(whole, own), exitCode: 0, configArgument: null }), []);

  // The harness prefers `playwright.config.ts` to `playwright.config.js`, so a
  // `.ts` file added beside this repository's own — with no existing file
  // edited — is the configuration a default run loads, and it can point the
  // whole step wherever it likes. Every floor is read from names relative to
  // that, so all of them can be satisfied by a suite that is not this one.
  const shadowedByTypeScript = {
    configFile: `${dirname(REQUIRED_CONFIG_FILE)}/playwright.config.ts`,
    directories: ['/elsewhere/browser-fixtures/passing'],
  };
  assert.ok(
    judge({ report: reportOf(whole, shadowedByTypeScript), exitCode: 0, configArgument: null }).some((line) =>
      line.includes('nothing pointed this run at a configuration'),
    ),
    'a default run that loaded a configuration this repository does not use was accepted',
  );

  // A run that reported no configuration at all is the same answer, rather than
  // a run nothing can be said about.
  assert.ok(
    judge({ report: null, exitCode: 0, configArgument: null }).some((line) =>
      line.includes('nothing pointed this run at a configuration'),
    ),
  );

  // And the fixture invocations, which name what they are pointed at. Those are
  // the runs allowed to load something else, and they are told apart by the
  // command line rather than by the report — a report is written by whatever
  // ran, and what is being asked here is what was asked for.
  assert.deepEqual(
    judge({ report: reportOf(whole), exitCode: 0, configArgument: '/elsewhere/playwright.config.js' }),
    [],
  );
});

test('a required test is the one this suite carries, not one of its name elsewhere', () => {
  const whole = wholeRun();
  const own = { configFile: REQUIRED_CONFIG_FILE, directories: [REQUIRED_TEST_DIR] };

  // A spec file added under `test/` is reported with the directory in front of
  // its name, and the files this suite is built from are not — so reading only
  // the last element of that name made the two one file. A shadow registering
  // one trivial test under each required title then supplied the identity of a
  // real test that had been skipped out, in both engines, with the collection
  // directory still `test/` and every count still clear.
  for (const [file, titles] of Object.entries(REQUIRED_TESTS)) {
    for (const title of titles) {
      /** @type {Reported[]} */
      const shadowed = whole.map((one) =>
        one.file === file && one.title === title ? { ...one, status: 'skipped' } : one,
      );
      for (const engine of REQUIRED_ENGINES) {
        shadowed.push({ file: `shadow/${file}`, title, engine, status: 'expected' });
      }
      const failures = judge({ report: reportOf(shadowed, own), exitCode: 0, configArgument: null });
      assert.ok(
        failures.some((line) => line.includes(title) && line.includes('did not execute')),
        `${title} skipped out and supplied by a shadow file was not noticed: ${JSON.stringify(failures)}`,
      );
    }
  }

  // And the fixture trees, whose names are relative to the fixture tree itself:
  // a run that collected from a directory inside one still reports its files by
  // name there, and nothing in this policy can name a directory for a
  // configuration it has never seen.
  const nested = whole.map((one) => ({ ...one, file: `nested/${one.file}` }));
  assert.deepEqual(judge({ report: reportOf(nested), exitCode: 0 }), []);
});

test('a required test is the one at the top of its file, not one of its name inside a group', () => {
  const whole = wholeRun();
  const own = { configFile: REQUIRED_CONFIG_FILE, directories: [REQUIRED_TEST_DIR] };

  // The route the file-name comparison above cannot reach, because it is the
  // genuine file. A group written inside `test/core.spec.js` registers a test of
  // any title it likes, and the harness reports that test's title as its own
  // with the group appearing only as the suite it sits in — so a required test
  // skipped out and a two-line group beside it carrying the same title was a run
  // with every count clear, both engines represented, and the question that test
  // asks never asked. Each required test in turn, in the file it belongs to.
  for (const [file, titles] of Object.entries(REQUIRED_TESTS)) {
    for (const title of titles) {
      /** @type {Reported[]} */
      const shadowed = whole.map((one) =>
        one.file === file && one.title === title ? { ...one, status: 'skipped' } : one,
      );
      for (const engine of REQUIRED_ENGINES) {
        shadowed.push({ file, title, engine, status: 'expected', groups: ['shadow'] });
      }
      const failures = judge({ report: reportOf(shadowed, own), exitCode: 0, configArgument: null });
      assert.ok(
        failures.some((line) => line.includes(title) && line.includes('did not execute')),
        `${title} skipped out and supplied by a group in the same file was not noticed: ${JSON.stringify(failures)}`,
      );
      // And every total stays clear, so what refused the run is the identity
      // rather than the run having become too small to count.
      assert.ok(!failures.some((line) => line.includes('did not run')), 'the totals were meant to stay clear');
    }
  }

  // Depth is not the question either: a group inside a group is still not the
  // top of the file, and an ancestry that only looked one level up would admit
  // it.
  const [firstFile, firstTitles] = Object.entries(REQUIRED_TESTS)[0] ?? ['core.spec.js', []];
  const deepTitle = firstTitles[0];
  assert.ok(deepTitle !== undefined, 'the required tests are gone');
  /** @type {Reported[]} */
  const deep = whole.map((one) =>
    one.file === firstFile && one.title === deepTitle ? { ...one, status: 'skipped' } : one,
  );
  for (const engine of REQUIRED_ENGINES) {
    deep.push({ file: firstFile, title: deepTitle, engine, status: 'expected', groups: ['outer', 'inner'] });
  }
  assert.ok(
    judge({ report: reportOf(deep, own), exitCode: 0, configArgument: null }).some(
      (line) => line.includes(deepTitle) && line.includes('did not execute'),
    ),
    'a required test supplied from two groups down was accepted',
  );

  // And an unnamed group, which is the same fact with nothing to read: a test
  // inside one is still not a test at the top of its file, and an ancestry that
  // dropped a group carrying no title would put it there.
  /** @type {Reported[]} */
  const unnamed = whole.map((one) =>
    one.file === firstFile && one.title === deepTitle ? { ...one, status: 'skipped' } : one,
  );
  for (const engine of REQUIRED_ENGINES) {
    unnamed.push({ file: firstFile, title: deepTitle, engine, status: 'expected', groups: [''] });
  }
  assert.ok(
    judge({ report: reportOf(unnamed, own), exitCode: 0, configArgument: null }).some(
      (line) => line.includes(deepTitle) && line.includes('did not execute'),
    ),
    'a required test supplied from a group carrying no title was accepted',
  );

  // The accepting direction, so this is a reading of the position rather than a
  // refusal of everything with a suite tree in it: the same run with the
  // required tests where they belong, and a group beside them carrying a test of
  // its own, is a run of this suite.
  /** @type {Reported[]} */
  const grouped = [...whole];
  for (const engine of REQUIRED_ENGINES) {
    grouped.push({ file: 'core.spec.js', title: 'one inside a group', engine, status: 'expected', groups: ['a group'] });
  }
  assert.deepEqual(judge({ report: reportOf(grouped, own), exitCode: 0, configArgument: null }), []);
});

test('the names a run reported are measured from this suite\'s own directory', () => {
  const whole = wholeRun();

  // The coordinate underneath every file name in the report, and a different
  // field from the collection directories beside it. The harness reports a spec
  // file's name relative to the root it resolved, and the two agree only while
  // every project collects from one tree — so a run naming the right collection
  // directory can still be reporting names measured from somewhere else, and
  // every name-based floor here would be reading them against the wrong tree.
  const elsewhereRoot = {
    configFile: REQUIRED_CONFIG_FILE,
    directories: [REQUIRED_TEST_DIR],
    rootDir: '/elsewhere',
  };
  assert.ok(
    judge({ report: reportOf(whole, elsewhereRoot), exitCode: 0, configArgument: null }).some(
      (line) => line.includes('/elsewhere') && line.includes(REQUIRED_TEST_DIR),
    ),
    'a run reporting its names against another root was accepted',
  );

  // A run that said nothing about it is the same answer rather than a run
  // nothing can be said about.
  const noRoot = { configFile: REQUIRED_CONFIG_FILE, directories: [REQUIRED_TEST_DIR], rootDir: null };
  assert.ok(
    judge({ report: reportOf(whole, noRoot), exitCode: 0, configArgument: null }).some((line) =>
      line.includes('named no root'),
    ),
    'a run that reported no root for its names was accepted',
  );

  // And the accepting direction.
  assert.deepEqual(
    judge({
      report: reportOf(whole, { configFile: REQUIRED_CONFIG_FILE, directories: [REQUIRED_TEST_DIR] }),
      exitCode: 0,
      configArgument: null,
    }),
    [],
  );

  // The fixture trees are not held to it, for the same reason they are not held
  // to a collection directory: nothing here can name a root for a configuration
  // it has never seen.
  assert.deepEqual(judge({ report: reportOf(whole, { rootDir: '/elsewhere/somewhere-else' }), exitCode: 0 }), []);
});

/**
 * A tree that is a repository as far as the manifest check is concerned, with
 * this runner copied into it.
 *
 * The counterpart of the one in `run-node-tests-selftest.mjs`, and it exists for
 * the same reason: the manifest a runner reads is the one beside the program, so
 * a copy of the program in a tree of this file's own making is a runner whose
 * manifest this case gets to choose. Everything `checkManifest` reads is written
 * here and says what the pins say, except for what the caller substitutes.
 *
 * `node_modules` is linked rather than copied. The runner resolves the browser
 * harness relative to itself, so without it a run in this tree fails because the
 * harness is missing, which is a different answer from the one being asked for.
 *
 * @param {Record<string, string>} substitutions Step names to the command each
 *   should run instead of the one it is pinned to.
 * @returns {{ root: string, runner: string }}
 */
function scratchRepository(substitutions) {
  const root = mkdtempSync(join(tmpdir(), 'browser-manifest-'));

  for (const files of Object.values(CHECK_FILES)) {
    for (const file of files) {
      const target = join(root, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, '');
    }
  }
  for (const [file, config] of Object.entries(CHECK_CONFIGS)) {
    writeFileSync(join(root, file), JSON.stringify(config, null, 2));
  }
  for (const program of ['run-browser-tests.mjs', 'run-browser-tests-core.mjs', 'check-manifest-core.mjs']) {
    copyFileSync(fileURLToPath(new URL(`./${program}`, import.meta.url)), join(root, 'scripts', program));
  }
  symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir');

  const scripts = { check: CHECK_STEPS.join(' && '), ...CHECK_COMMANDS, ...substitutions };
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts }, null, 2));

  return { root, runner: join(root, 'scripts', 'run-browser-tests.mjs') };
}

test('a run spawned where the manifest is wrong is refused, and names the step', () => {
  // That this runner *calls* the manifest check, which nothing asked. The cases
  // for what that check answers are in `test/node/core.test.mjs` and none of them
  // observes that any program invokes it: deleting `checkManifest(readManifest())`
  // from this runner and from the node one left the whole gate exiting 0 with
  // everything else pristine, because the manifest this repository has is sound
  // in every spawn the suite makes and the call therefore contributes no failure
  // whether it is there or not.
  //
  // The substituted step is this runner's own, which is the one a person
  // silencing the browser suite would reach for, and the run is otherwise a
  // healthy one: the fixture tree passes, so the only thing to report is the
  // manifest.
  const sound = scratchRepository({});
  try {
    const result = runRunnerAt(sound.runner, ['--config', fixtureConfig('passing')]);
    assert.equal(result.status, 0, `a copy of the runner beside a sound manifest was refused:\n${result.stderr}`);
    assert.ok(
      !result.stderr.includes('`test:smoke` runs'),
      `a sound manifest was reported as a silenced one:\n${result.stderr}`,
    );
  } finally {
    rmSync(sound.root, { recursive: true, force: true });
  }

  const silenced = scratchRepository({ 'test:smoke': 'true' });
  try {
    const result = runRunnerAt(silenced.runner, ['--config', fixtureConfig('passing')]);
    assert.equal(result.status, 1, 'a passing tree beside a silenced manifest was accepted');
    assert.ok(
      result.stderr.includes('`test:smoke` runs "true"'),
      `the run did not report the silenced step:\n${result.stderr}`,
    );
  } finally {
    rmSync(silenced.root, { recursive: true, force: true });
  }
});

/**
 * A spec file for the tree below: the titles this suite is required to carry in
 * that file, and enough tests beside them for one engine alone to clear every
 * floor.
 *
 * The titles are read from the policy for the reason the fixture tree under
 * `browser-fixtures/passing/` reads them: a tree standing in for the real suite
 * has to carry whatever that list says, and what pins the list itself is
 * `test/node/core.test.mjs`, outside both. `omit` is what makes the refusing
 * direction below a refusal about one named test rather than about a tree that
 * is wrong in a dozen ways at once.
 *
 * @param {string} file
 * @param {string | null} omit A required title to leave out, or `null`.
 * @returns {string}
 */
function defaultSuiteSpec(file, omit) {
  const titles = (REQUIRED_TESTS[file] ?? []).filter((title) => title !== omit);
  const filler = Array.from(
    { length: MINIMUM_EXECUTED_TESTS },
    (_unused, index) => `a test that passes in ${file} (${index})`,
  );
  return [
    "import { test } from '@playwright/test';",
    ...[...titles, ...filler].map((title) => `test(${JSON.stringify(title)}, () => {});`),
    '',
  ].join('\n');
}

/**
 * A repository whose own suite is the tree above, so that a run of it naming no
 * configuration is a default invocation with an answer this file chose.
 *
 * The copied policy module resolves the configuration it requires, and the
 * directory it requires the suite to be collected from, relative to itself — so
 * in this tree they are this tree's own. That is what makes a default invocation
 * here a real one: the harness finds the configuration by looking in the working
 * directory, exactly as it does for `npm run check`, and the policy holds the run
 * to the configuration beside the runner rather than to one named on a command
 * line.
 *
 * @param {string | null} omit A required title to leave out of `core.spec.js`.
 * @returns {{ root: string, runner: string }}
 */
function scratchDefaultRepository(omit) {
  const { root, runner } = scratchRepository({});

  writeFileSync(
    join(root, 'playwright.config.js'),
    [
      "import { defineConfig } from '@playwright/test';",
      '',
      'export default defineConfig({',
      "  testDir: 'test',",
      "  projects: [{ name: 'chromium' }, { name: 'webkit' }],",
      '});',
      '',
    ].join('\n'),
  );
  mkdirSync(join(root, 'test'), { recursive: true });
  for (const file of REQUIRED_SPEC_FILES) {
    writeFileSync(join(root, 'test', file), defaultSuiteSpec(file, file === 'core.spec.js' ? omit : null));
  }

  return { root, runner };
}

test('the default invocation this repository ships exits 0', () => {
  // The shape `npm run check` actually uses, and the one nothing here had ever
  // driven. Every fixture case above names its configuration on the command line,
  // and the one default case runs from a directory with no configuration to find,
  // so it is about a default invocation that fails — leaving the pair
  // `named === null` and `exitCode === 0` a combination no case reached. A runner
  // that skipped every judgement on exactly that pair exited 0, and exited 0
  // again with the browser corpus collected out of the suite, which is the whole
  // browser path running nothing in either engine and saying so nowhere.
  //
  // Driven from a tree of this file's own rather than by running this
  // repository's suite, and that is a structural requirement rather than a
  // preference for speed. `test/core.spec.js` spawns both named node suites, one
  // of which is the suite this file belongs to — so a case here that ran the real
  // browser suite would spawn a run of itself, without end. The tree below is a
  // repository as far as the copied policy is concerned, so the default
  // invocation it takes is the real branch with an answer this file chose.
  //
  // Both directions, because either alone is satisfiable by the wrong runner: one
  // that refused every default invocation would pass the second, and one that
  // judged none of them would pass the first.
  const sound = scratchDefaultRepository(null);
  try {
    const result = runRunnerAt(sound.runner, [], sound.root);
    assert.equal(result.status, 0, `a sound default invocation was refused:\n${result.stdout}\n${result.stderr}`);
    assert.ok(result.stdout.includes('test:smoke — '), 'the default run printed no summary line');
    for (const engine of REQUIRED_ENGINES) {
      assert.ok(result.stdout.includes(`in ${engine}`), `the default run reported nothing for ${engine}`);
    }
  } finally {
    rmSync(sound.root, { recursive: true, force: true });
  }

  // And the same invocation over a suite one required test short. The harness
  // still exits 0 — nothing failed, a test is simply not there — so this is the
  // successful default path being judged, which is the branch a bypass on
  // `named === null && exitCode === 0` removes.
  const missing = REQUIRED_TESTS['core.spec.js']?.[0];
  assert.ok(missing !== undefined, 'the policy requires no test of the corpus spec file');
  const short = scratchDefaultRepository(missing);
  try {
    const result = runRunnerAt(short.runner, [], short.root);
    assert.equal(result.status, 1, 'a default invocation missing a required test was accepted');
    assert.ok(
      result.stderr.includes(missing),
      `the refusal did not name the missing test:\n${result.stderr}`,
    );
  } finally {
    rmSync(short.root, { recursive: true, force: true });
  }
});
