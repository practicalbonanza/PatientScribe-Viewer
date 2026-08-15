/**
 * The browser test path — the policy.
 *
 * What counts as having run the browser suite. No running, no reporting, no exit
 * codes: this module is importable from a test without starting a browser, which
 * it has to be, because the tests that hold these floors are themselves run by
 * the thing the floors are about. The runner is `run-browser-tests.mjs`, and it
 * is a separate file for that reason.
 *
 * Why any of this exists. The browser harness fails closed on one mistake only —
 * a run that matched no test at all is an error — and that is a narrower
 * guarantee than it reads as. A suite of several spec files loses one of them
 * and the harness still matches tests, still runs them, and still exits 0.
 * Deleting the file that carries the whole corpus was a green run, and so was
 * narrowing the pattern that collects it, because the only assertions that could
 * have noticed lived inside the file that had just gone.
 *
 * So the run is judged from outside it, on what the harness reported having
 * done: enough spec files, the ones the suite is built from among them, enough
 * tests actually executed in total and in each spec file, every engine
 * represented, and every test the suite is built from executed by name in each
 * of them. Each of those is a separate floor because each catches something the
 * others do not — a file count catches a spec file going missing but not one
 * that quietly stopped registering tests, an executed count catches that but is
 * satisfied by one enormous file, and both are satisfied by a run in a single
 * engine.
 *
 * The last of them is the one every count is blind to, and it is the reason this
 * module is not a set of totals. A single `.skip` on the test that carries the
 * whole corpus took that corpus out of both engines and left every floor here
 * clear: two spec files still ran, both were the required ones, and the counts
 * stayed several times over every floor below — this suite carries eight tests
 * in each engine and losing one leaves seven, against a per-engine floor of
 * three. What was gone was not a count, it was an identity — so the tests the
 * suite is built from are named, and a run that did not execute one of them in
 * one of the engines is not a run of this suite, whatever its totals say.
 *
 * Executed means executed, here as in the fast path. A skipped test is reported
 * with an outcome of its own and is not counted: skipping out a file is one
 * line, and a suite of nothing but skipped tests is the one thing these floors
 * exist to refuse.
 *
 * The floors sit below what the suite carries, so adding a test does not have to
 * touch them. The three lists do not: they name what must be there, and adding a
 * spec file, an engine or a test is an addition to a list rather than a number to
 * raise.
 *
 * And one thing that is not a floor at all: where the run collected from. Every
 * floor above is read from a reported file name, and what the harness reports is
 * a path relative to the directory it was pointed at — so a spec file called
 * `core.spec.js` under one directory and one under another are the same name to
 * all of them. Changing `testDir` in the harness configuration to the fixture
 * tree under `browser-fixtures/passing/` was therefore a green run of the whole
 * step: that tree registers the required spec file names and the required
 * titles, in both engines, and every count and every list here was satisfied by
 * a suite that is not this one. So the directory is compared as well, against
 * what the harness reported having resolved it to, whenever the configuration it
 * reports having loaded is this repository's own.
 *
 * Two things follow from that "whenever", and both of them were holes.
 *
 * The first is what happens when the configuration is not this repository's and
 * nobody asked for another one. That comparison was written as a condition to
 * enter the directory check under, so a run that loaded some other configuration
 * simply did not have its directory looked at — the check failed open on the one
 * input it exists to refuse. The harness chooses its own configuration when it
 * is not given one, and it prefers `playwright.config.ts` to `playwright.config.js`:
 * adding a `.ts` file next to the `.js` one, editing nothing else, pointed the
 * whole step at a fixture tree with every floor above satisfied and the step
 * exited 0. So a run is now asked which configuration it was pointed at as well
 * as which one it loaded. A run that named none — the default invocation, which
 * is what `npm run check` makes — has to have loaded this repository's own, and
 * is refused if it did not. A run that named one is a self-test's run against a
 * fixture tree, and those are the runs that are allowed to be anything.
 *
 * The second is what a required test's identity is, and it took two rounds to
 * say in full, because a test has two coordinates and only one of them was being
 * read.
 *
 * The first coordinate is the file. The reported name is relative to the
 * directory the run collected from, and taking the last element of it made
 * `test/shadow/core.spec.js` and `test/core.spec.js` one file: a shadow spec
 * file carrying one trivial test under each required title supplied the identity
 * for a real test that had been skipped out, in both engines, with the
 * collection directory still `test/` and every count still clear. For a run of
 * this repository's own configuration the whole reported name is therefore the
 * identity, so a required test is the one at the top of `test/` and nothing else
 * can stand in for it. Fixture trees keep the last element, because a fixture
 * tree's names are relative to the fixture tree and are meant to be read as the
 * names of files rather than as paths into this suite.
 *
 * The second coordinate is where in the file the test sits, and closing the
 * first route left this one open. The harness reports a suite tree — one suite
 * per spec file, and one nested suite per enclosing group inside it — and a
 * spec's title is its own, not its position. Reading the title alone therefore
 * made a test at the top of the file and a test of the same title inside a group
 * in that same file one test, and the genuine file is the one place no directory
 * comparison and no file-name comparison can help: skipping out the real corpus
 * test and adding a two-line group beside it, in `test/core.spec.js` itself,
 * supplied that test's identity in both engines with sixteen tests executed,
 * eight per engine, and nothing failing. So a required test is named by its whole
 * position — the file, every group enclosing it, and its title — and a required
 * test is one at the top level of its file, which is a group ancestry of nothing.
 * A test moved into a group is a different test to this module, and moving one
 * there is a failure that says which.
 *
 * And underneath both of them, the thing every name here is relative to. The
 * harness reports a spec file's name relative to the root it resolved for the
 * run, which is not the same field as a project's collection directory and can
 * differ from it — with two projects collecting from two directories the root
 * becomes the directory holding the configuration, and every name in the report
 * grows a path in front of it. So the root is compared as well as the collection
 * directories, for a run of this repository's own configuration, because it is
 * the coordinate the file names are actually measured from.
 */

import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The fewest spec files that can be called a run of the browser suite.
 *
 * @see REQUIRED_SPEC_FILES
 */
export const MINIMUM_SPEC_FILES = 3;

/**
 * The spec files the suite is built from.
 *
 * A count alone would be satisfied by three files of anything. These are the
 * three that have to have run: the corpus, the harness smoke test that says a
 * page was served and its module graph resolved, and the one that drives the
 * viewer and reads what a recipient would see.
 *
 * @type {readonly string[]}
 */
export const REQUIRED_SPEC_FILES = Object.freeze(['core.spec.js', 'smoke.spec.js', 'viewer.spec.js']);

/**
 * The tests each spec file is built from, by title.
 *
 * The floors above are counts, and a count cannot tell one test from another. A
 * single `.skip` on the corpus test left every one of them clear — two spec
 * files, both required, and seven tests still executed in each engine against a
 * floor of three — and took the whole corpus out of both engines. What is
 * missing from a run like that is a particular question, so the questions are
 * named here and each has to have been asked in each engine.
 *
 * Titles rather than counts, and a list rather than a number: adding a test to
 * either file means adding a line here, which is a visible, reviewable act, and
 * skipping one out is a failure that says which one.
 *
 * Each title names a test at the top level of its file. That is part of the
 * identity rather than an incidental fact about where these tests happen to be
 * written: a group inside the same file can register a test of any title, and
 * one that did stood in for the real test of that title after it was skipped
 * out. Moving a required test inside a group therefore has to be a failure here
 * and a deliberate edit to this file, not a silent substitution.
 *
 * The fixture trees under `browser-fixtures/` register these same titles rather
 * than repeating them, so a title added here is a title those trees carry too.
 * What pins the titles themselves is `test/node/core.test.mjs`, from outside the
 * suite they are in.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const REQUIRED_TESTS = Object.freeze({
  'core.spec.js': Object.freeze([
    'the corpus holds in this engine',
    'the canonical form the generator emitted is the one the fixtures were sealed with',
    'the fast path is invoked through the runner that fails closed, and that runner is checked',
    'the node runner hands back the exit code it says it does',
    'the suite the node runner was asked for is the suite it ran',
  ]),
  'smoke.spec.js': Object.freeze([
    'the page is served and its module graph runs without error',
    'the development server refuses anything outside the tree it serves',
    // The one that ties together three things that are supposed to be the same:
    // what the sink scan reads, what this suite runs against, and what a
    // recipient receives. Nothing else on the browser side puts a response body
    // and a file side by side, so before it the suite could not tell a served
    // response from the file behind it.
    'the bytes the server hands back are the bytes on disk',
    // The one that holds the only region of the page a browser reads before it
    // has a policy: the bytes from the first to the end of the policy element
    // are written out and compared against the file this repository ships and
    // against what a real navigation was handed, so nothing can be written ahead
    // of the policy and fetched under none.
    'nothing precedes the policy, in the file or in the bytes a browser is handed',
    // The one that makes the engine list below mean something. Everything here
    // reads a project's name, and a name is not an engine: pointing the project
    // called `webkit` at Chromium is one word in the harness configuration, and
    // it left every count, every engine and every named test clear with WebKit
    // never having started. That test asks the page what it is.
    'the engine running this project is the engine the project names',
    // The one that asks a browser to enforce the policy the page carries rather
    // than asking the page what policy it is carrying. A policy is a string
    // until something refuses a request under it, and a string is what every
    // other reading of it here can reach.
    'the policy the page carries is enforced against an origin that answers',
  ]),
  // The surface, which nothing else in this suite reads. The corpus asks what
  // the modules return and the smoke test asks what the page loaded; neither can
  // say that the failures collapse into one surface, that the words on it are
  // the words that were agreed, or that nothing of the link is on the page.
  'viewer.spec.js': Object.freeze([
    'each state the viewer can be in is the surface it is pinned to be',
    'a browser that fails the probe is advised, and its code field still works',
    'a probe that answers late does not draw advice over a surface that is finished',
    'a decrypted note is the document that was sealed, and carries nothing of the link',
    'the link is out of the address bar before anything is sent, and nothing sent carries it',
    'a browser that refuses to rewrite the address still draws its surface and still empties',
    'reporting a link sends the identifier and nothing else',
    'a wrong code can be tried again, and a body that is nearly one cannot',
    'every failure the viewer can reach draws the same surface',
    'a decrypted note is not left on the page underneath a later surface',
    'a page that comes back out of the cache shows nothing it was showing',
    'putting the page away empties it, before anything can be drawn over it',
    'every text on every surface reaches the contrast it has to',
    'the page reflows at a narrow width and at twice the text size',
    'the expiry is the moment it was sealed with, spelled the one way',
  ]),
  // The half of the release check that needs a browser. Neither of these can be
  // reached from a socket: what a browsing context is left holding after a page
  // has loaded is a reading of the browser, and what an engine does with a fetch
  // that a response header started is a fact about engines that has to be taken
  // in each of them. Both are named here for the reason every title here is —
  // the counting floors clear whether these ran or not, so a `.skip` on either
  // would take a browser-measured item out of both engines with every number in
  // this file still satisfied.
  'release.spec.js': Object.freeze([
    'a page that sets nothing leaves nothing, and both halves of that are shown to fire',
    'what each engine does with a fetch a response header started, measured in both arms',
  ]),
});

/** The fewest tests that can be called a run of the browser suite. */
export const MINIMUM_EXECUTED_TESTS = 6;

/**
 * And the fewest in each engine, so a total cannot be reached by one engine
 * running twice as much while the other ran nothing.
 */
export const MINIMUM_EXECUTED_TESTS_PER_ENGINE = 3;

/**
 * And the fewest in each spec file the run collected, which is the floor the
 * fast path has and this one did not.
 *
 * A total is satisfied by one enormous file, so a file that was collected and
 * executed nothing — every test in it skipped out, one line — is invisible in
 * it. Counted per file it is not. This applies to every spec file the report
 * mentions rather than only to the required ones, so a spec file added later
 * cannot sit in the suite running nothing.
 *
 * Two, and it is a floor for a spec file this suite does not have rather than a
 * count of one it does: the smallest of the three files here carries four tests,
 * which `REQUIRED_TESTS` above lists by name, so all three of them clear this
 * several times over. What it is set for is a spec file added later carrying one test —
 * one test, in both engines, is two, and a file that ran nothing is zero. The
 * reason it is not one is that a file which ran at all ran in both engines, so
 * one is a count no healthy run of any spec file here can produce.
 */
export const MINIMUM_EXECUTED_TESTS_PER_SPEC_FILE = 2;

/**
 * The engines the suite runs in.
 *
 * "Both engines" is a stated property of this suite rather than a convenience: a
 * viewer that behaves in one engine and not the other is a viewer that has not
 * been tested, and Web Crypto is exactly where two conforming implementations
 * can differ. Dropping one from the harness configuration is a one-line edit,
 * and this is what notices — from what actually ran, not from a reading of the
 * configuration file, because a configuration can name an engine it does not
 * reach.
 *
 * @type {readonly string[]}
 */
export const REQUIRED_ENGINES = Object.freeze(['chromium', 'webkit']);

/**
 * The harness configuration this repository's own suite is run from.
 *
 * Not a floor and not a list: it is how this module tells "a run of this suite"
 * from "a run the self-test pointed at a fixture tree of its own". Both reach
 * the same runner and the same policy, and only the first one has a directory
 * that can be named here.
 */
export const REQUIRED_CONFIG_FILE = fileURLToPath(new URL('../playwright.config.js', import.meta.url));

/**
 * And the directory that configuration has to have collected from.
 *
 * Written as a path from this module's own location rather than read out of the
 * configuration, for the reason every pin in this repository is written that
 * way: a check that takes its expectation from the file it is checking passes
 * whatever that file says.
 */
export const REQUIRED_TEST_DIR = fileURLToPath(new URL('../test', import.meta.url));

/**
 * What a run reported.
 *
 * @typedef {object} RunSummary
 * @property {string[]} files Spec file names that carried at least one executed test.
 * @property {number} executed Tests that ran, skipped ones excluded.
 * @property {number} failed Of those, the ones that did not pass.
 * @property {number} flaky Of those, the ones the harness says passed only
 *   because they were run again. A count of its own rather than a kind of
 *   failure, because what it reports is a different thing: the test gave the
 *   right answer in the end, and what is wrong is that it was asked twice.
 * @property {number} skipped
 * @property {Map<string, number>} byEngine Executed tests per engine.
 * @property {Map<string, number>} byFile Executed tests per spec file, with an
 *   entry for every spec file the report mentions — a file whose tests were all
 *   skipped is in here carrying zero, which is the whole point of counting per
 *   file rather than in total.
 * @property {Map<string, Set<string>>} byTest The engines each test executed in,
 *   keyed by `testKey` — the whole position of a test, not its title.
 * @property {string | null} configFile The harness configuration the run
 *   reported having loaded.
 * @property {string | null} rootDir The root the run resolved for itself, which
 *   is what every spec file name in the report is relative to. Not the same
 *   field as a project's collection directory and not always the same value: the
 *   two agree while every project collects from one directory, and part company
 *   when they do not — with two projects pointed at two trees the root becomes
 *   the directory holding the configuration and every name in the report grows a
 *   path in front of it.
 * @property {string[]} directories The directories the run reported having
 *   collected from, one per project, without repeats. These say where the run
 *   was pointed; `rootDir` says what the names are measured from. Neither on its
 *   own can tell one directory's `core.spec.js` from another's, which is why
 *   both are compared before any name below is believed.
 */

/**
 * How a test is named in `RunSummary.byTest`: its whole position — the spec
 * file, every group enclosing it, and its own title — joined by NULs.
 *
 * The position rather than the title, because a title is not an identity. A
 * group inside a spec file can register a test of any title, and the harness
 * reports that test's title as its own with no trace of the group in it; keyed
 * by title alone, a two-line group in the genuine file supplied the identity of
 * the required test beside it after that one had been skipped out.
 *
 * A flat join rather than a nesting because the key is only ever looked up, and
 * NUL because no test title and no group title carries one — a printable
 * separator could be part of either and make two different positions one key.
 *
 * @param {string} file
 * @param {readonly string[]} groups The titles of the groups enclosing the test,
 *   outermost first. Empty for a test at the top level of its file, which is
 *   what every required test is.
 * @param {string} title
 * @returns {string}
 */
export function testKey(file, groups, title) {
  return [file, ...groups, title].join('\u0000');
}

/**
 * The last path element of a reported file name.
 *
 * The harness reports a path relative to the directory it collects from, which
 * is one thing here and another for a fixture tree; the name of the file is the
 * part that means the same in both.
 *
 * Used for a fixture tree's names only. For a run of this repository's own
 * configuration the whole reported name is the identity — see `identifierFor`
 * below and the paragraph about the shadow spec file at the top of this file.
 *
 * @param {string} file
 * @returns {string}
 */
function baseName(file) {
  const at = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  return at === -1 ? file : file.slice(at + 1);
}

/**
 * How a reported spec file is named, given which configuration the run loaded.
 *
 * For this repository's own configuration the name is taken whole, so a spec
 * file in a subdirectory of `test/` is a different file from the one at the top
 * of it — which is what stops a shadow `test/shadow/core.spec.js` from supplying
 * the identity of a required test that was skipped out. The required names
 * carry no separator, so nothing under a subdirectory can match one.
 *
 * For anything else — the fixture trees the self-test points the runner at — the
 * last element is the name, because those trees are read as sets of file names
 * rather than as paths into this suite.
 *
 * @param {boolean} own Whether the run loaded this repository's configuration.
 * @returns {(file: string) => string}
 */
function identifierFor(own) {
  return own ? (file) => file : baseName;
}

/**
 * Are these two the same path?
 *
 * Compared as text, with a trailing separator dropped, because that is the one
 * difference between two spellings of one directory that means nothing. No
 * resolution, no realpath: both sides are absolute paths the harness and this
 * module each produced from a known location, and a check that resolves what it
 * is comparing is a check that can be satisfied by a link.
 *
 * The separator is this platform's, and that is the whole of why it is read from
 * the platform rather than written as a pair. Dropping both spellings made a
 * trailing backslash mean nothing everywhere — and on a system where the
 * separator is `/`, a backslash is an ordinary character a directory name may
 * end in, so a directory genuinely named that way compared equal to a different
 * directory of the same name without it. One separator, the one this platform
 * uses, and every other character is part of the name.
 *
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
function samePath(left, right) {
  /** @param {string} path */
  const trimmed = (path) => (path.length > 1 && path.endsWith(sep) ? path.slice(0, -1) : path);
  return trimmed(left) === trimmed(right);
}

/**
 * Did this test's last attempt pass?
 *
 * The harness reports two different things about a test and they are not the
 * same thing: `results` is what its attempts did, and `status` is how the
 * harness classified the outcome given what the test said to expect. A test
 * marked as expected to fail, with an assertion that fails, is reported as
 * `status: 'expected'` over `results: ['failed']` — the harness is saying "it
 * did what it said it would", which is not "it gave the right answer". Counting
 * that as a pass is how a test that ran and answered wrongly stayed invisible.
 *
 * The last attempt rather than any of them, so a retried test that failed and
 * then passed is still the flaky pass the harness calls it.
 *
 * @param {unknown} results
 * @returns {boolean}
 */
function passedOnItsLastAttempt(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return false;
  }
  const last = results[results.length - 1];
  if (last === null || typeof last !== 'object') {
    return false;
  }
  return /** @type {Record<string, unknown>} */ (last)['status'] === 'passed';
}

/**
 * Read a run out of the harness's own report.
 *
 * Total, and deliberately incurious: anything the report does not carry in the
 * shape expected simply does not count towards a floor, which means a malformed
 * report is a run of nothing rather than a crash or a pass. The report is
 * written by the harness on this machine, not by anything untrusted; the
 * totality is here because a runner that throws is a runner whose exit code is
 * an accident.
 *
 * @param {unknown} report
 * @returns {RunSummary}
 */
export function summariseRun(report) {
  /** @type {Set<string>} */
  const files = new Set();
  /** @type {Map<string, number>} */
  const byEngine = new Map();
  /** @type {Map<string, number>} */
  const byFile = new Map();
  /** @type {Map<string, Set<string>>} */
  const byTest = new Map();
  let executed = 0;
  let failed = 0;
  let flaky = 0;
  let skipped = 0;

  /** @type {string | null} */
  let configFile = null;
  /** @type {string | null} */
  let rootDir = null;
  /** @type {Set<string>} */
  const directories = new Set();

  // Where the run was pointed, from the same report every count below comes
  // from. Incurious in the same way: anything not carried in the shape expected
  // simply is not there, so a report without it is a run that did not say where
  // it collected from rather than a crash.
  //
  // Read before the walk rather than after it, because which configuration was
  // loaded decides how a reported spec file is named.
  if (report !== null && typeof report === 'object') {
    const config = /** @type {Record<string, unknown>} */ (report)['config'];
    if (config !== null && typeof config === 'object') {
      const named = /** @type {Record<string, unknown>} */ (config);
      if (typeof named['configFile'] === 'string') {
        configFile = named['configFile'];
      }
      // What the file names below are relative to. Read from the same object and
      // in the same incurious way as everything else here: a report that does
      // not carry it is a run that did not say what its names are measured from,
      // which is a thing `checkBrowserRun` refuses rather than a thing this
      // function guesses at.
      if (typeof named['rootDir'] === 'string') {
        rootDir = named['rootDir'];
      }
      const projects = named['projects'];
      if (Array.isArray(projects)) {
        for (const project of projects) {
          if (project === null || typeof project !== 'object') {
            continue;
          }
          const directory = /** @type {Record<string, unknown>} */ (project)['testDir'];
          if (typeof directory === 'string') {
            directories.add(directory);
          }
        }
      }
    }
  }

  const nameOf = identifierFor(configFile !== null && samePath(configFile, REQUIRED_CONFIG_FILE));

  /**
   * @param {unknown} suite
   * @param {readonly string[]} groups The titles of the groups enclosing
   *   everything in this suite, outermost first. Empty at the top level, where
   *   the harness's suites are the spec files themselves rather than groups
   *   inside them — so a spec file's own name never becomes part of a group
   *   ancestry, and a test written at the top of a file has an ancestry of
   *   nothing.
   */
  const walk = (suite, groups) => {
    if (suite === null || typeof suite !== 'object') {
      return;
    }
    const node = /** @type {Record<string, unknown>} */ (suite);

    const specs = node['specs'];
    if (Array.isArray(specs)) {
      for (const spec of specs) {
        if (spec === null || typeof spec !== 'object') {
          continue;
        }
        const entry = /** @type {Record<string, unknown>} */ (spec);
        const file = typeof entry['file'] === 'string' ? nameOf(entry['file']) : null;
        const title = typeof entry['title'] === 'string' ? entry['title'] : null;
        const tests = entry['tests'];
        if (!Array.isArray(tests)) {
          continue;
        }
        // Every spec file the report mentions gets an entry, whether or not
        // anything in it ran. A file whose tests were all skipped is a file that
        // executed nothing, and the per-file floor can only say so if the file is
        // in the map to be counted.
        if (file !== null && !byFile.has(file)) {
          byFile.set(file, 0);
        }
        for (const test of tests) {
          if (test === null || typeof test !== 'object') {
            continue;
          }
          const one = /** @type {Record<string, unknown>} */ (test);
          const status = one['status'];
          if (status === 'skipped') {
            skipped += 1;
            continue;
          }
          // Anything that is not a skip is a test that ran: expected, flaky, or
          // unexpected. The last of those is also a failure.
          executed += 1;
          // And the middle one is recorded on its own. `flaky` is what the
          // harness calls a test that failed and then passed when it was run
          // again, which it only ever does when it has been told to run one
          // again — so this is zero on every run of this suite as it is
          // configured, and non-zero is a fact about the run rather than about
          // the report. What it means is read where the run is judged.
          if (status === 'flaky') {
            flaky += 1;
          }
          // And so is a test whose attempts failed while the harness called the
          // outcome expected, which is what `test.fail()` over a failing
          // assertion produces. That reads as a pass to the line above and is a
          // test that ran and gave the wrong answer, so what a test did is read
          // from its results and the classification is asked as well rather than
          // instead. Both directions are kept: a test declared to fail that
          // passes is reported as unexpected, which is the first comparison's.
          if (status !== 'expected' && status !== 'flaky') {
            failed += 1;
          } else if (!passedOnItsLastAttempt(one['results'])) {
            failed += 1;
          }
          if (file !== null) {
            files.add(file);
            byFile.set(file, (byFile.get(file) ?? 0) + 1);
          }
          const engine = one['projectName'];
          if (typeof engine === 'string') {
            byEngine.set(engine, (byEngine.get(engine) ?? 0) + 1);
            // A test that ran and failed is still a test that ran. Which of them
            // failed is the count above; what this records is that the question
            // was asked at all, in this engine.
            if (file !== null && title !== null) {
              const key = testKey(file, groups, title);
              const engines = byTest.get(key) ?? new Set();
              engines.add(engine);
              byTest.set(key, engines);
            }
          }
        }
      }
    }

    const nested = node['suites'];
    if (Array.isArray(nested)) {
      for (const child of nested) {
        // A group's own title, added to what its contents are enclosed by. A
        // child carrying no title still deepens the ancestry by one, because a
        // test inside an unnamed group is still not a test at the top of its
        // file, and an ancestry that quietly ignored one would be the hole this
        // exists to close wearing a different spelling.
        const named =
          child !== null && typeof child === 'object' ? /** @type {Record<string, unknown>} */ (child)['title'] : null;
        walk(child, [...groups, typeof named === 'string' ? named : '']);
      }
    }
  };

  if (report !== null && typeof report === 'object') {
    const suites = /** @type {Record<string, unknown>} */ (report)['suites'];
    if (Array.isArray(suites)) {
      for (const suite of suites) {
        walk(suite, []);
      }
    }
  }

  return {
    files: [...files].sort(),
    executed,
    failed,
    flaky,
    skipped,
    byEngine,
    byFile,
    byTest,
    configFile,
    rootDir,
    directories: [...directories].sort(),
  };
}

/**
 * Was that a run of the browser suite?
 *
 * @param {{ report: unknown, exitCode: number | null, configArgument?: string | null }} run
 *   The harness's report, the code it handed back to the shell, and which
 *   configuration the command line named. The first two are asked about because
 *   a report clearing every floor while the harness exited non-zero is a run
 *   that failed, and an exit of 0 with no report is a harness that did not run.
 *
 *   `configArgument` is the file the invocation named, or `null` for the default
 *   invocation, which names none and lets the harness choose. Absent means the
 *   same as `null`, and that direction is the one that matters: a caller that
 *   stops saying is a caller whose run is held to the stricter rule rather than
 *   released from it.
 * @returns {string[]} One line per reason it was not; empty means it was.
 */
export function checkBrowserRun(run) {
  /** @type {string[]} */
  const failures = [];
  const summary = summariseRun(run.report);

  if (run.exitCode !== 0) {
    failures.push(`the browser harness exited ${run.exitCode === null ? 'without a status' : run.exitCode}`);
  }

  const namedAConfiguration = typeof run.configArgument === 'string' && run.configArgument.length > 0;
  const loadedOwnConfiguration = summary.configFile !== null && samePath(summary.configFile, REQUIRED_CONFIG_FILE);

  // A run nobody pointed anywhere has to have found this repository's own
  // configuration. The harness picks one when it is not given one and prefers a
  // `.ts` file to the `.js` file beside it, so a configuration this repository
  // does not use could be the one that ran while nothing said so — and every
  // floor below is read from names that only mean something once the
  // configuration and the directory are known. Refused here rather than passed
  // over, because passing over the one case a check exists for is what a check
  // that fails open does.
  if (!namedAConfiguration && !loadedOwnConfiguration) {
    failures.push(
      `nothing pointed this run at a configuration and the harness reported having loaded ${
        summary.configFile === null ? 'none it named' : summary.configFile
      }, and a run of this suite is the one ${REQUIRED_CONFIG_FILE} describes`,
    );
  }

  // Where it collected from, before anything read out of a file name is
  // believed. Only for a run of this repository's own configuration: a run the
  // self-test pointed at a fixture tree collects from that tree, which is the
  // whole point of those trees, and nothing here can name a directory for a
  // configuration it has never seen.
  if (loadedOwnConfiguration) {
    if (summary.directories.length === 0) {
      failures.push('the run named no directory to have collected from, so which tests it ran is unknown');
    }
    // And the root the names are measured from, which is a different field and
    // can be a different directory. A run whose projects collect from one tree
    // reports the two as one value; a run whose projects collect from two
    // reports a root above both of them, and every spec file name in it grows a
    // path in front of it. Compared here so the names below are relative to this
    // suite's own directory rather than to whatever the run chose.
    if (summary.rootDir === null) {
      failures.push('the run named no root for the names it reported, so what those names are relative to is unknown');
    } else if (!samePath(summary.rootDir, REQUIRED_TEST_DIR)) {
      failures.push(
        `reported its file names relative to ${summary.rootDir}, and this suite's names are relative to ${REQUIRED_TEST_DIR} — a name read against the wrong root is a name for another file`,
      );
    }
    for (const directory of summary.directories) {
      if (!samePath(directory, REQUIRED_TEST_DIR)) {
        failures.push(
          `collected from ${directory}, and this suite is the tests under ${REQUIRED_TEST_DIR} — every name below is relative to whatever this was, so on their own they cannot tell one directory's spec files from another's`,
        );
      }
    }
  }

  if (summary.files.length < MINIMUM_SPEC_FILES) {
    failures.push(
      `ran ${summary.files.length} spec file(s), and fewer than ${MINIMUM_SPEC_FILES} means the suite has moved or gone rather than passed`,
    );
  }
  for (const required of REQUIRED_SPEC_FILES) {
    if (!summary.files.includes(required)) {
      failures.push(`${required} ran no test, so whatever it holds was not asked`);
    }
  }

  for (const [file, count] of summary.byFile) {
    if (count < MINIMUM_EXECUTED_TESTS_PER_SPEC_FILE) {
      failures.push(
        `${file} executed ${count} test(s), and fewer than ${MINIMUM_EXECUTED_TESTS_PER_SPEC_FILE} means that file did not run rather than passed`,
      );
    }
  }

  // The floor no count can be: each named test, at the top level of its own spec
  // file, in each engine. A `.skip` on the one test that carries the corpus
  // leaves every total here clear, and a group registering a test of the same
  // title in the same file leaves the title clear too — so what is looked up is
  // the position, and the position of a required test is an ancestry of nothing.
  for (const [file, titles] of Object.entries(REQUIRED_TESTS)) {
    for (const title of titles) {
      const engines = summary.byTest.get(testKey(file, [], title)) ?? new Set();
      for (const engine of REQUIRED_ENGINES) {
        if (!engines.has(engine)) {
          failures.push(
            `${file} › ${title} did not execute at the top level of that file in ${engine}, so what it holds was not asked there`,
          );
        }
      }
    }
  }

  if (summary.executed < MINIMUM_EXECUTED_TESTS) {
    failures.push(
      `executed ${summary.executed} test(s), and fewer than ${MINIMUM_EXECUTED_TESTS} means the suite did not run rather than passed`,
    );
  }

  for (const engine of REQUIRED_ENGINES) {
    const count = summary.byEngine.get(engine) ?? 0;
    if (count < MINIMUM_EXECUTED_TESTS_PER_ENGINE) {
      failures.push(
        `executed ${count} test(s) in ${engine}, and fewer than ${MINIMUM_EXECUTED_TESTS_PER_ENGINE} means this suite ran in one engine rather than both`,
      );
    }
  }

  if (summary.failed > 0) {
    failures.push(`${summary.failed} test(s) failed`);
  }

  // And a test that only passed the second time is not a test that passed.
  //
  // The harness runs each test once, because the number of times it runs one is
  // a setting and that setting is at its default. Nothing said so. Every floor
  // above is about which tests ran and how many, and a run made with that
  // setting raised reports a test that failed and then passed as `flaky` — an
  // outcome that is not a failure to any of the counting above, and which the
  // reading of a test's last attempt beside them treats as a pass, deliberately
  // and correctly, because the last attempt did pass.
  //
  // What that turns into is the thing this whole module exists against. Several
  // of the readings in this suite are about ordering — a probe answering after a
  // surface has settled, a continuation resolving after a page was put away —
  // and a race that fails once and passes on the retry is precisely what those
  // readings are written to catch. With retries on, the first answer is thrown
  // away and the second one is reported, and a viewer that draws over a settled
  // surface some of the time ships with the whole chain green.
  //
  // Refused here rather than pinned in the harness configuration, and the
  // difference matters: the setting can be raised in that file, named on a
  // command line, or read out of the environment, so a pin on the file is a pin
  // on one of the three ways to change it. This is a reading of what the run
  // actually did, which is the same place every other floor here reads from, and
  // it does not care how the retry was asked for.
  if (summary.flaky > 0) {
    failures.push(
      `${summary.flaky} test(s) passed only after being run again, and an answer that needs a second asking is not an answer this suite reports`,
    );
  }

  return failures;
}
