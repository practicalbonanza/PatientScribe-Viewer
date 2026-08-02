import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { CHECK_COMMANDS, CHECK_CONFIGS, CHECK_STEPS, checkManifest, readManifest } from '../scripts/check-manifest-core.mjs';
import { checkRun, SUITES } from '../scripts/run-node-tests-core.mjs';
import { buildCases, canonicalJson, observableCases, vectors } from './lib/cases.mjs';
import { observeCases } from './lib/driver.mjs';
import {
  checkObservations,
  MINIMUM_CASES,
  MINIMUM_CASES_BY_KIND,
  MINIMUM_PROBES,
  MINIMUM_SECRETS,
} from './lib/expect.mjs';

/**
 * The corpus, where the viewer actually runs.
 *
 * The page is loaded from the development server and the viewer's own modules
 * are imported inside it, so what runs is the served bytes — the same files a
 * browser would fetch, not a copy compiled for a test runner. Both engines run
 * it, because a viewer that behaves in one engine and not the other is a viewer
 * that has not been tested. Web Crypto in particular is a place where two
 * conforming implementations can differ, and this is a suite that mostly asserts
 * what Web Crypto refuses. Which engines those are is named in the harness
 * configuration and held by `run-browser-tests-core.mjs`, from what a run
 * reported having done — a configuration can name an engine it does not reach,
 * and dropping one from it is a line nothing in this file could see.
 *
 * The interop fixtures the corpus is built from come from a generator written in
 * another language against another cryptography library, so the vectors were
 * never produced by the code being checked against them.
 */
test('the corpus holds in this engine', async ({ page }) => {
  // Every channel, not only errors. A viewer that must never speak has nothing
  // to say at any level, so a warning, a log line or a debug trace is as much a
  // failure as a thrown error — and any of them could carry what the confinement
  // scan exists to keep out of sight.
  /** @type {string[]} */
  const consoleOutput = [];
  /** @type {string[]} */
  const pageErrors = [];
  page.on('console', (message) => {
    consoleOutput.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto('/index.html');

  const { cases, probes, secrets } = buildCases();

  // The floor, here as well as in the fast path: this suite must not be able to
  // pass by running nothing.
  expect(cases.length).toBeGreaterThanOrEqual(MINIMUM_CASES);
  expect(probes.length).toBeGreaterThanOrEqual(MINIMUM_PROBES);
  expect(secrets).toBeGreaterThanOrEqual(MINIMUM_SECRETS);

  // And the floors themselves, against numbers written here rather than against
  // themselves. Compared only with what they govern, a floor lowered to nothing
  // is a change no run can see: the corpus still carries what it carries, every
  // count still clears the new floor, and the control is gone. The kinds are
  // named as well as counted, because a floor deleted outright is a kind with no
  // floor rather than a floor that is too low.
  expect(MINIMUM_CASES).toBeGreaterThanOrEqual(470);
  expect(MINIMUM_PROBES).toBeGreaterThanOrEqual(230);
  expect(MINIMUM_SECRETS).toBeGreaterThanOrEqual(30);
  expect(Object.keys(MINIMUM_CASES_BY_KIND).sort()).toEqual([
    'aad',
    'base64',
    'capability',
    'clear',
    'constants',
    'cost',
    'decrypt',
    'derive',
    'dispatch',
    'document',
    'fields',
    'fragment',
    'guard',
    'instrument',
    'ordering',
    'render',
    'resolve',
    'sizing',
  ]);
  expect(Object.values(MINIMUM_CASES_BY_KIND).reduce((total, floor) => total + floor, 0)).toBeGreaterThanOrEqual(460);

  // What crosses into the page is inputs. While the expectations crossed with
  // them, a driver that imported nothing and echoed each case's own expectation
  // back satisfied every case in this suite, in both engines — so this is
  // asserted at the call rather than left to the helper, because the mistake
  // that would undo it is passing `cases` here.
  const payload = observableCases(cases);
  expect(payload.every((item) => !('expect' in item))).toBe(true);
  expect(JSON.stringify(payload)).not.toContain('"expect"');

  const results = await page.evaluate(observeCases, { moduleBase: '/js/', cases: payload });

  expect(checkObservations({ cases, probes, secrets, results })).toEqual([]);

  expect(pageErrors).toEqual([]);
  expect(consoleOutput).toEqual([]);
});

/**
 * The canonical form is pinned twice: once in the generator, which compares what
 * it produced against a literal before it will write a file, and once here. The
 * viewer canonicalises nothing — it authenticates the bytes it was handed — so
 * these vectors are the only place the form is asserted at all, and a document
 * sealed against it has to arrive carrying it.
 *
 * Each record carries the input as well, and it has to: `canonical` and
 * `expected` are one string in every entry by construction, so without an input
 * the records are two copies of an answer and an implementer of the producing
 * side has nothing to check their own canonicaliser against.
 */
test('the canonical form the generator emitted is the one the fixtures were sealed with', () => {
  for (const item of vectors.canonicalisations) {
    expect(item.canonical, item.name).toBe(item.expected);
    expect(canonicalJson(item.input), item.name).toBe(item.expected);
  }
  expect(
    vectors.canonicalisations.some((/** @type {any} */ item) => JSON.stringify(item.input) !== item.expected),
  ).toBe(true);
  expect(vectors.canonicalisations[0].expected).toBe(vectors.fixtures[0].inputs.aad);
});

/**
 * How the other paths are invoked, asserted from this one.
 *
 * A check on whether a step of `npm run check` runs cannot live inside that
 * step: replacing its command with something that does nothing is exactly what
 * would stop the check running. So the two halves ask about each other. This
 * suite holds the fast path's end of it — that the node runner is what
 * `test:fast` and `check:self` invoke, and that its floors are what they are
 * pinned to be — and the fast path holds this suite's end.
 *
 * The floors are spelled out here rather than compared against themselves. A
 * test that builds its expectations out of the thing under test passes just as
 * happily after the thing is zeroed, and zeroing a floor is a one-character
 * edit that every suite it protects would keep passing through.
 *
 * And the policy is asked to bite, which is the part a text comparison cannot
 * reach. A command that names the right runner and a runner whose floors admit
 * an empty run are a step that does nothing, spelled correctly.
 */
test('the fast path is invoked through the runner that fails closed, and that runner is checked', () => {
  expect(checkManifest(readManifest())).toEqual([]);
  expect([...CHECK_STEPS]).toEqual([
    'npm run typecheck',
    'npm run check:sinks',
    'npm run check:self',
    'npm run test:fast',
    'npm run test:smoke',
  ]);
  expect(CHECK_COMMANDS['test:fast']).toBe('node scripts/run-node-tests.mjs fast');
  expect(CHECK_COMMANDS['check:self']).toBe('node scripts/run-node-tests.mjs self');

  // And the two steps that had no second copy of their command anywhere. The
  // manifest check compares what `package.json` says against the pins in
  // `check-manifest-core.mjs`, which is a comparison of two files that can both
  // be edited at once: `check:sinks` replaced by something that does nothing, in
  // the manifest and in the pin together, left the chain green with a genuine
  // forbidden sink in a served file. The fast path's command and the self-test's
  // are spelled out above and the browser path's is spelled out in the fast
  // suite, so these two are the ones that were missing.
  expect(CHECK_COMMANDS['check:sinks']).toBe('node scripts/check-sinks.mjs');
  expect(CHECK_COMMANDS['typecheck']).toBe('tsc --noEmit -p jsconfig.json && tsc --noEmit -p tsconfig.tooling.json');

  // The typecheck step's scope, from outside the files that carry it. A command
  // spelled exactly right, naming two files that are both on disk, checks
  // nothing if those files say not to: `checkJs` set to false left a blatant
  // type error in a served module with the whole chain green, and a narrowed
  // `include` leaves the checker never reading the file at all. The empty
  // `types` roster is the other half of what those two files are for — the
  // browser world must not see node's globals, or the checker accepts code no
  // browser can run.
  const browserWorld = CHECK_CONFIGS['jsconfig.json'];
  const toolingWorld = CHECK_CONFIGS['tsconfig.tooling.json'];
  if (browserWorld === undefined || toolingWorld === undefined) {
    throw new Error('the manifest no longer pins the configurations the typecheck step is pointed at');
  }
  expect(browserWorld.compilerOptions['allowJs']).toBe(true);
  expect(browserWorld.compilerOptions['checkJs']).toBe(true);
  expect(browserWorld.compilerOptions['strict']).toBe(true);
  expect(browserWorld.compilerOptions['types']).toEqual([]);
  expect(browserWorld.include).toEqual(['site/**/*.js', 'site/**/*.mjs']);
  expect(toolingWorld.compilerOptions['allowJs']).toBe(true);
  expect(toolingWorld.compilerOptions['checkJs']).toBe(true);
  expect(toolingWorld.compilerOptions['strict']).toBe(true);
  expect(toolingWorld.compilerOptions['types']).toEqual(['node']);
  expect(toolingWorld.include).toEqual([
    'scripts/**/*.js',
    'scripts/**/*.mjs',
    'test/**/*.js',
    'test/**/*.mjs',
    'playwright.config.js',
  ]);

  const fast = SUITES['fast'];
  const self = SUITES['self'];
  if (fast === undefined || self === undefined) {
    throw new Error('the runner no longer knows the suites this check is about');
  }
  expect(fast.minimumFiles).toBeGreaterThanOrEqual(1);
  expect(fast.minimumExecuted).toBeGreaterThanOrEqual(15);
  expect(fast.minimumExecutedPerFile).toBeGreaterThanOrEqual(3);
  expect([...fast.required]).toEqual(['core.test.mjs']);
  expect(self.minimumFiles).toBeGreaterThanOrEqual(3);
  expect(self.minimumExecuted).toBeGreaterThanOrEqual(20);
  expect(self.minimumExecutedPerFile).toBeGreaterThanOrEqual(3);
  expect([...self.required].sort()).toEqual([
    'check-sinks-selftest.mjs',
    'run-browser-tests-selftest.mjs',
    'run-node-tests-selftest.mjs',
  ]);

  // The floors, put to a run that did nothing. Each has to refuse it.
  const nothing = checkRun({ suite: fast, files: [], passed: 0, failed: 0 });
  expect(nothing.some((line) => line.includes('test file'))).toBe(true);
  expect(nothing.some((line) => line.includes('did not run'))).toBe(true);
  expect(
    checkRun({ suite: fast, files: ['/elsewhere/other.test.mjs'], passed: 99, failed: 0 }).some((line) =>
      line.includes('core.test.mjs'),
    ),
  ).toBe(true);
});

/**
 * The node runner's exit code, read from the one place the node runner cannot
 * silence.
 *
 * The self-tests are collected and run by that runner, which is what makes them
 * fail closed and is also what makes this necessary: a runner that reported
 * every failure as a pass would report its own self-test's failures as passes
 * too, and the whole of the fast path would go quiet at one character. So the
 * claim that its exit code means what it says is made from here, in the suite
 * the other runner judges. Neutering one runner is caught by the other; the
 * detailed cases stay in `run-node-tests-selftest.mjs`, where a failure says
 * which answer was wrong rather than only that one was.
 *
 * Both directions, because a runner that exited 1 on everything would satisfy
 * the failing tree while having stopped saying anything.
 */
test('the node runner hands back the exit code it says it does', () => {
  const runner = fileURLToPath(new URL('../scripts/run-node-tests.mjs', import.meta.url));

  /** @param {string} name */
  const tree = (name) => fileURLToPath(new URL(`../test/runner-fixtures/${name}/`, import.meta.url));

  /** @param {string} name */
  const run = (name) =>
    spawnSync(process.execPath, [runner, '--tree', tree(name)], { encoding: 'utf8' }).status;

  expect(run('passing')).toBe(0);
  expect(run('failing')).toBe(1);
  expect(run('skipped')).toBe(1);
  expect(run('one-file-skipped')).toBe(1);
  expect(run('does-not-exist')).toBe(1);
});

/**
 * Which suite the node runner ran, asked of the runner from outside every suite
 * it knows.
 *
 * The two suites are two different things — one is the corpus against the
 * viewer, the other is every check that is about another check — and which of
 * them runs is decided by one lookup on the command line. Reading a fixed name
 * out of the table instead of the argument is one token, and it is invisible
 * from everywhere the argument matters: both invocations still exit 0, both
 * still clear every floor of whichever suite actually ran, and `npm run check`
 * stays green having run one of the two twice and the other never. With `fast`
 * pointed at the self-tests the corpus is never executed at all.
 *
 * So each named suite is run and asked what it ran. The runner names it in its
 * own summary line, which is the one thing about the selection that leaves the
 * process, and the name is compared against the label the policy gives that
 * suite — read from the policy, because what is being checked is the runner's
 * choice rather than the policy's spelling of it.
 *
 * This lives here, in the suite neither of them runs, and it has to. A check on
 * the selection cannot sit inside either suite: put in the fast suite it is a
 * check the fast suite's own selection decides whether to run, and put in the
 * self suite it is a check that spawns the suite it is part of — under the very
 * edit it exists to catch, either of those calls itself without end rather than
 * failing.
 */
test('the suite the node runner was asked for is the suite it ran', () => {
  const runner = fileURLToPath(new URL('../scripts/run-node-tests.mjs', import.meta.url));

  /** @param {string} suite */
  const run = (suite) => spawnSync(process.execPath, [runner, suite], { encoding: 'utf8' });

  const fast = SUITES['fast'];
  const self = SUITES['self'];
  if (fast === undefined || self === undefined) {
    throw new Error('the runner no longer knows the suites this check is about');
  }
  // The two labels have to be different, or nothing below distinguishes
  // anything.
  expect(fast.label).not.toBe(self.label);

  for (const [argument, ran, notRan] of [
    ['fast', fast.label, self.label],
    ['self', self.label, fast.label],
  ]) {
    const result = run(String(argument));
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(`under ${ran}`);
    expect(result.stdout).not.toContain(`under ${notRan}`);
  }
});
