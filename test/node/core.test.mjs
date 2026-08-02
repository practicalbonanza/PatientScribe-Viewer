/**
 * The fast path.
 *
 * The same corpus the browser suite runs, against the same files, in a runtime
 * that starts in a fraction of a second. It exists so a mistake is caught while
 * it is still being made — it does not replace the browser suite, which is the
 * one that runs where the viewer actually runs, in both engines, over the served
 * bytes. Nothing about how the viewer behaves may be checked only here: an
 * outcome asserted in this file and nowhere else is an outcome nothing has asked
 * of either engine.
 *
 * That rule is about behaviour, and this file carries three kinds of thing that
 * are not behaviour, so the list is written out rather than left as "the
 * exception":
 *
 *   - The tests about the checks themselves: what the comparison does with a
 *     corpus that has lost most of itself, what the confinement scan reaches,
 *     what the browser path's floors refuse, and what the vectors are. Those are
 *     about the harness, and the harness is the same in both places.
 *   - Two claims about the viewer that are true of its bytes rather than of any
 *     run, and so cannot be asserted from a run at all: that no module under
 *     `site/js/` can serialise JSON, and that both render functions open with
 *     the clear and the branch on it. The second of those is the clear gate,
 *     which is the one property of this viewer no observation can carry for as
 *     long as the surface drawn after a successful clear is nothing. Both are
 *     read out of the source text here, and both go when there is a surface to
 *     assert instead.
 *   - The pins on the other path: the browser runner's command, its floors, and
 *     the titles of the tests its suite is built from. A check on whether a step
 *     of `npm run check` runs cannot live inside that step, so this file holds
 *     the browser path's end of it and the browser suite holds this one's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  CHECK_COMMANDS,
  CHECK_CONFIGS,
  CHECK_FILES,
  CHECK_STEPS,
  checkManifest,
  readManifest,
} from '../../scripts/check-manifest-core.mjs';
import {
  checkBrowserRun,
  MINIMUM_EXECUTED_TESTS as MINIMUM_BROWSER_TESTS,
  MINIMUM_EXECUTED_TESTS_PER_ENGINE,
  MINIMUM_EXECUTED_TESTS_PER_SPEC_FILE,
  MINIMUM_SPEC_FILES,
  REQUIRED_ENGINES,
  REQUIRED_SPEC_FILES,
  REQUIRED_TESTS,
} from '../../scripts/run-browser-tests-core.mjs';
import { buildCases, canonicalJson, CASE_FIELDS, observableCases, vectors } from '../lib/cases.mjs';
import { observeCases } from '../lib/driver.mjs';
import {
  checkObservations,
  MINIMUM_CASES,
  MINIMUM_CASES_BY_KIND,
  MINIMUM_PROBES,
  MINIMUM_SECRETS,
} from '../lib/expect.mjs';

const MODULE_BASE = new URL('../../site/js/', import.meta.url).href;
const SITE_JS = fileURLToPath(new URL('../../site/js/', import.meta.url));
const VECTORS_FILE = fileURLToPath(new URL('../vectors/vectors.json', import.meta.url));

test('the corpus holds', async () => {
  const { cases, probes, secrets } = buildCases();
  assert.ok(cases.length >= MINIMUM_CASES, `the corpus is ${cases.length} cases`);
  assert.ok(probes.length >= MINIMUM_PROBES, `the confinement scan has ${probes.length} probes`);
  assert.ok(secrets >= MINIMUM_SECRETS, `the confinement scan watches ${secrets} secrets`);

  const results = await observeCases({ moduleBase: MODULE_BASE, cases: observableCases(cases) });
  const failures = checkObservations({ cases, probes, secrets, results });
  assert.deepEqual(failures, []);
});

test('what the driver is handed carries no expectations', () => {
  // The hole this closes was the whole suite. Cases used to travel with what
  // they required attached, so a driver that imported no viewer module and
  // handed each case's own expectation straight back satisfied all of them, in
  // both engines — every green result here, including the ones about the viewer
  // being correct, was worth the assumption that the driver was honest.
  const { cases, probes, secrets } = buildCases();
  const payload = observableCases(cases);

  // Every field of every case is either something the driver reads or the
  // expectation. A field that is neither is a field nobody has decided about.
  for (const item of cases) {
    for (const field of Object.keys(item)) {
      assert.ok(
        field === 'expect' || CASE_FIELDS.includes(field),
        `${item.name} carries a field called ${field}, which is neither an input the driver reads nor the expectation`,
      );
    }
    assert.ok(Object.prototype.hasOwnProperty.call(item, 'expect'), `${item.name} requires nothing`);
  }

  assert.equal(payload.length, cases.length);
  for (const item of payload) {
    assert.ok(!('expect' in item));
  }
  assert.ok(!JSON.stringify(payload).includes('expect'));

  // And the attack itself, run against what actually crosses.
  const echoed = payload.map((item) => ({
    name: item.name,
    observed: { .../** @type {Record<string, unknown>} */ (/** @type {any} */ (item).expect) },
  }));
  const failures = checkObservations({ cases, probes, secrets, results: echoed });
  assert.ok(failures.length > 0, 'a driver that echoes the payload back still passes');
  assert.ok(failures.some((line) => line.includes('was not observed at all')));
});

test('an observation reported under the wrong name is a failure', () => {
  // Results are matched to cases by name rather than by position, so a driver
  // that reported them in a different order, twice under one name, or under a
  // name nobody asked about, is caught rather than compared against whatever
  // happened to be at that index.
  const { cases, probes, secrets } = buildCases();
  const honest = cases.map((item) => ({ name: item.name, observed: { ...item.expect } }));
  assert.deepEqual(checkObservations({ cases, probes, secrets, results: honest }), []);

  const shuffled = [...honest].reverse();
  assert.deepEqual(checkObservations({ cases, probes, secrets, results: shuffled }), []);

  const [first, second] = honest;
  assert.ok(first !== undefined && second !== undefined);

  const twice = [...honest];
  twice[1] = { name: first.name, observed: { ...first.observed } };
  assert.ok(
    checkObservations({ cases, probes, secrets, results: twice }).some((line) =>
      line.includes(`two observations are reported as ${first.name}`),
    ),
  );

  const unasked = [...honest];
  unasked[0] = { name: 'nobody/asked', observed: {} };
  assert.ok(
    checkObservations({ cases, probes, secrets, results: unasked }).some((line) =>
      line.includes('no case by that name was asked'),
    ),
  );
});

test('an emptied corpus fails rather than passes', () => {
  // The comparison is the only thing standing between "the viewer did what the
  // corpus required" and "nothing was asked of the viewer". Both of these would
  // once have come back clean.
  assert.notDeepEqual(checkObservations({ cases: [], probes: [], secrets: 0, results: [] }), []);
  assert.notDeepEqual(checkObservations({ cases: [], probes: ['probe'], secrets: 1, results: [] }), []);

  const { cases, probes, secrets } = buildCases();
  assert.notDeepEqual(checkObservations({ cases: cases.slice(0, 2), probes, secrets, results: [] }), []);
  assert.notDeepEqual(checkObservations({ cases, probes: probes.slice(0, 1), secrets, results: [] }), []);
  assert.notDeepEqual(checkObservations({ cases, probes, secrets: 1, results: [] }), []);

  // Each floor at its own edge, which the corpus cannot be put on. Every one of
  // them is a constant and a comparison, and the cases above are nowhere near
  // any of the three boundaries — an emptied corpus and the whole corpus tell
  // `fewer than the floor` and `fewer than or equal to it` exactly the same
  // story. Synthetic lists rather than real ones, and read as the presence of
  // one line rather than as the whole answer, because a list built to sit on one
  // boundary is short of the other floors by construction.
  /** @param {number} count */
  const namedCases = (count) =>
    Array.from({ length: count }, (_unused, index) => ({
      name: `aad/synthetic-${index}`,
      kind: 'aad',
      expect: {},
    }));
  /** @param {number} count */
  const spelledProbes = (count) => Array.from({ length: count }, (_unused, index) => `probe-${index}`);

  for (const [size, short] of /** @type {[number, boolean][]} */ ([
    [MINIMUM_CASES - 1, true],
    [MINIMUM_CASES, false],
  ])) {
    const failures = checkObservations({ cases: namedCases(size), probes, secrets, results: [] });
    assert.equal(
      failures.some((line) => line.includes('is not a corpus')),
      short,
      `a corpus of exactly ${size} distinct case(s) was judged the other way`,
    );
  }
  for (const [size, short] of /** @type {[number, boolean][]} */ ([
    [MINIMUM_PROBES - 1, true],
    [MINIMUM_PROBES, false],
  ])) {
    const failures = checkObservations({ cases, probes: spelledProbes(size), secrets, results: [] });
    assert.equal(
      failures.some((line) => line.includes('is not a scan')),
      short,
      `a scan of exactly ${size} probe(s) was judged the other way`,
    );
  }
  for (const [size, short] of /** @type {[number, boolean][]} */ ([
    [MINIMUM_SECRETS - 1, true],
    [MINIMUM_SECRETS, false],
  ])) {
    const failures = checkObservations({ cases, probes, secrets: size, results: [] });
    assert.equal(
      failures.some((line) => line.includes('secret(s), and fewer than')),
      short,
      `a scan watching exactly ${size} secret(s) was judged the other way`,
    );
  }
});

test('a corpus that has lost one family of cases fails', () => {
  // A single total is an average, and an average hides the loss of a whole
  // family. Every negative case for the authenticated data and every negative
  // document case could be deleted at once and the old floor of 200 was still
  // clear, which is to say it was holding none of them up. Each kind is dropped
  // in turn here, and each must be missed.
  const { cases, probes, secrets } = buildCases();
  for (const kind of Object.keys(MINIMUM_CASES_BY_KIND)) {
    const kept = cases.filter((item) => !item.name.startsWith(`${kind}/`) && item.name !== kind);
    const failures = checkObservations({ cases: kept, probes, secrets, results: [] });
    assert.ok(
      failures.some((line) => line.includes(`${kind} case(s)`) || line.includes(`of ${kind}`)),
      `dropping every ${kind} case was not noticed: ${JSON.stringify(failures)}`,
    );
  }
});

test('two cases with one name are a failure', () => {
  // A name collision loses a question without losing a line, so a corpus can
  // report more cases than it asks. Two derivation cases were called
  // `derive/salt-sensitivity`.
  const { cases, probes, secrets } = buildCases();
  const [first] = cases;
  assert.ok(first !== undefined);
  const collided = [...cases, { ...first }];
  const failures = checkObservations({ cases: collided, probes, secrets, results: [] });
  assert.ok(failures.some((line) => line.includes(`two cases are called ${first.name}`)));
});

test('an observation carrying a field its case does not name is a failure', () => {
  // A case that names a subset of what it saw has stopped asking about the
  // rest, and the rest is where a change nobody meant would sit.
  const { cases, probes, secrets } = buildCases();
  const [first] = cases;
  assert.ok(first !== undefined);

  const results = cases.map((item) => ({ name: item.name, observed: { ...item.expect } }));
  const clean = checkObservations({ cases, probes, secrets, results });
  assert.deepEqual(clean, []);

  results[0] = { name: first.name, observed: { ...first.expect, spare: 1 } };
  const failures = checkObservations({ cases, probes, secrets, results });
  assert.ok(failures.some((line) => line.includes('which the case does not name')));

  // And a spare that does not enumerate, which is the same claim about a field
  // an enumeration cannot see. "The case names everything the observation
  // carries" was read off `Object.keys`, so a property defined without
  // `enumerable` was a field the comparison never compared.
  /** @type {Record<string, unknown>} */
  const quietSpare = { ...first.expect };
  Object.defineProperty(quietSpare, 'spare', { value: 1, enumerable: false });
  results[0] = { name: first.name, observed: quietSpare };
  assert.ok(
    checkObservations({ cases, probes, secrets, results }).some((line) =>
      line.includes('which the case does not name'),
    ),
    'a field hidden from enumeration was not compared against what the case names',
  );

  // And a field the case names but nothing observed is a failure too, rather
  // than a comparison of `undefined` against `undefined`.
  const [field] = Object.keys(first.expect);
  assert.ok(field !== undefined);
  const missing = { ...first.expect };
  delete missing[field];
  results[0] = { name: first.name, observed: missing };
  assert.ok(
    checkObservations({ cases, probes, secrets, results }).some((line) => line.includes('was not observed at all')),
  );
});

test('the confinement scan reaches a thrown value and a symbol-keyed one', () => {
  // Two places key material could sit and be missed. A case that threw is a
  // failure already, and a scan that stopped at the failure would never look at
  // the string the throw built. A symbol-keyed property is not reached by any
  // ordinary enumeration, which is exactly what would make it a good place to
  // find something nobody meant to report.
  const { cases, probes, secrets } = buildCases();
  const [first] = cases;
  const [probe] = probes;
  assert.ok(first !== undefined && probe !== undefined);

  /** @param {Record<string, unknown>} observed */
  const scanOne = (observed) => {
    const results = cases.map((item) => ({ name: item.name, observed: { ...item.expect } }));
    results[0] = { name: first.name, observed };
    return checkObservations({ cases, probes, secrets, results });
  };

  const thrown = scanOne({ threw: `Error: ${probe}` });
  assert.ok(thrown.some((line) => line.includes('key material appears')));
  assert.ok(thrown.some((line) => line.includes('threw instead of refusing')));

  /** @type {Record<string, unknown>} */
  const hidden = {};
  Object.defineProperty(hidden, Symbol('hidden'), { value: probe, enumerable: true });
  assert.ok(scanOne(hidden).some((line) => line.includes('key material appears')));

  // And the plainer half of the same hole, which was open while the symbol half
  // was closed: an ordinary name, defined without `enumerable`. No enumeration
  // shows it and everything else about it is an ordinary property, so it is the
  // easiest place of the three to put something nobody meant to report.
  /** @type {Record<string, unknown>} */
  const quiet = { ...first.expect };
  Object.defineProperty(quiet, 'notEnumerable', { value: probe, enumerable: false });
  assert.ok(
    scanOne(quiet).some((line) => line.includes('key material appears')),
    'key material under a property hidden from enumeration was not seen by the scan',
  );

  // And a clean observation is not flagged, so the scan is not simply saying yes.
  assert.ok(!scanOne({ ...first.expect }).some((line) => line.includes('key material appears')));
});

test('the stored key is watched, in every spelling the other secrets get', () => {
  // Half the key split, and it was absent from the scan. A leak of it is the
  // leak that turns a link somebody already has into a readable note.
  const { probes } = buildCases();
  for (const fixture of vectors.fixtures) {
    const bytes = Buffer.from(fixture.inputs.b, 'base64url');
    for (const spelling of [
      fixture.inputs.b,
      bytes.toString('hex'),
      bytes.toString('hex').toUpperCase(),
      Array.from(bytes).join(','),
    ]) {
      assert.ok(probes.includes(spelling), `the stored key of ${fixture.name} is not watched as ${spelling}`);
    }
  }
});

// Whether the fast path really ran is not asked here, and cannot be. This file
// is what the runner runs, so a check inside it on the runner's own answer is a
// check the runner decides the result of — and an assertion that
// `test/node/core.test.mjs` still exists, written in `test/node/core.test.mjs`,
// disappears with the file it was watching. All of it lives in
// `scripts/run-node-tests-selftest.mjs`, which spawns the runner as a child
// process and reads its exit code from outside.

test('the browser path is invoked through the runner that fails closed, and both engines are pinned', () => {
  // The other half of a pair. A check on whether a step of `npm run check` runs
  // cannot live inside that step, so the browser suite holds the fast path's end
  // of it and this holds the browser path's: that the browser runner is what
  // `test:smoke` invokes, and that its floors are what they are pinned to be.
  //
  // The floors are spelled out rather than compared against themselves. A test
  // that builds its expectations out of the thing under test passes just as
  // happily after the thing is zeroed, and zeroing a floor is a one-character
  // edit that every suite it protects would keep passing through.
  assert.deepEqual(checkManifest(readManifest()), []);
  assert.deepEqual(
    [...CHECK_STEPS],
    ['npm run typecheck', 'npm run check:sinks', 'npm run check:self', 'npm run test:fast', 'npm run test:smoke'],
  );
  assert.equal(CHECK_COMMANDS['test:smoke'], 'node scripts/run-browser-tests.mjs');

  assert.ok(MINIMUM_SPEC_FILES >= 2);
  assert.ok(MINIMUM_BROWSER_TESTS >= 6);
  assert.ok(MINIMUM_EXECUTED_TESTS_PER_ENGINE >= 3);
  assert.ok(MINIMUM_EXECUTED_TESTS_PER_SPEC_FILE >= 2);
  assert.deepEqual([...REQUIRED_SPEC_FILES].sort(), ['core.spec.js', 'smoke.spec.js']);

  // Both engines, named. "A viewer that behaves in one engine and not the other
  // is a viewer that has not been tested" is a claim about what runs, and until
  // the run was judged on what it reported having done, removing one of these
  // from the harness configuration was a line nothing looked at.
  assert.deepEqual([...REQUIRED_ENGINES].sort(), ['chromium', 'webkit']);

  // And the tests that suite is built from, by title, written out here rather
  // than read off the policy. Every floor above is a count, and a count cannot
  // tell one test from another: a single `.skip` on the test that carries the
  // corpus left all of them clear — two spec files, both required, eight tests
  // executed, four in each engine — and took the corpus out of both engines.
  // Dropping a title from that list is now an edit to this file too.
  assert.deepEqual(Object.keys(REQUIRED_TESTS).sort(), ['core.spec.js', 'smoke.spec.js']);
  assert.deepEqual(
    [...(REQUIRED_TESTS['core.spec.js'] ?? [])].sort(),
    [
      'the canonical form the generator emitted is the one the fixtures were sealed with',
      'the corpus holds in this engine',
      'the fast path is invoked through the runner that fails closed, and that runner is checked',
      'the node runner hands back the exit code it says it does',
      'the suite the node runner was asked for is the suite it ran',
    ],
  );
  assert.deepEqual(
    [...(REQUIRED_TESTS['smoke.spec.js'] ?? [])].sort(),
    [
      'the development server refuses anything outside the tree it serves',
      'the engine running this project is the engine the project names',
      'the page is served and its module graph runs without error',
    ],
  );

  // And the policy is asked to bite, which is the part a text comparison cannot
  // reach. A command that names the right runner and a runner whose floors admit
  // a run of nothing are a step that does nothing, spelled correctly.
  const nothing = checkBrowserRun({ report: null, exitCode: 0 });
  assert.ok(nothing.some((line) => line.includes('spec file(s)')));
  assert.ok(nothing.some((line) => line.includes('did not run')));
  for (const engine of REQUIRED_ENGINES) {
    assert.ok(nothing.some((line) => line.includes(engine)));
  }
  for (const titles of Object.values(REQUIRED_TESTS)) {
    for (const title of titles) {
      for (const engine of REQUIRED_ENGINES) {
        assert.ok(
          nothing.some((line) => line.includes(title) && line.includes(engine)),
          `a run of nothing was not reported as missing ${title} in ${engine}`,
        );
      }
    }
  }
});

test('the manifest check refuses each way a step can be silenced', () => {
  // Every comparison in that module only speaks when something is wrong, so on a
  // repository where nothing is wrong all of them are silent whether they are
  // there or not — and a check that is silent either way is a check that can be
  // deleted unnoticed. Each is handed a manifest that is wrong in the one way it
  // is for.
  const pinned = { scripts: { check: CHECK_STEPS.join(' && '), ...CHECK_COMMANDS } };
  assert.deepEqual(checkManifest(pinned), []);

  /**
   * @param {Record<string, string>} overrides
   * @returns {string[]}
   */
  const withScripts = (overrides) => checkManifest({ scripts: { ...pinned.scripts, ...overrides } });

  // A step dropped from the chain.
  assert.ok(
    withScripts({ check: CHECK_STEPS.filter((step) => step !== 'npm run test:smoke').join(' && ') }).some((line) =>
      line.includes('`check` runs'),
    ),
  );
  // A step commented out of the chain while its text stays in it, which is what
  // a comparison looking for the text rather than the chain cannot see.
  assert.ok(
    withScripts({ check: CHECK_STEPS.join(' && ').replace('npm run test:smoke', 'true # npm run test:smoke') }).some(
      (line) => line.includes('`check` runs'),
    ),
  );
  // A step whose command was replaced by something that does nothing. Each in
  // turn, because a comparison can be dropped for one step and kept for the
  // rest.
  for (const name of Object.keys(CHECK_COMMANDS)) {
    for (const nothing of ['true', ':', 'exit 0', `echo ${name}`]) {
      assert.ok(
        withScripts({ [name]: nothing }).some((line) => line.includes(`\`${name}\``)),
        `\`${name}\` replaced with ${nothing} was not refused`,
      );
    }
  }
  // A manifest with no scripts at all, and one that is not a manifest.
  assert.ok(checkManifest({}).some((line) => line.includes('no scripts')));
  assert.ok(checkManifest(null).some((line) => line.includes('could not be read')));
  // And a step naming a runner that is not there, which is a command that does
  // nothing while reading exactly right.
  assert.ok(checkManifest(pinned, () => false).some((line) => line.includes('runs nothing')));

  // What that comparison is aimed at, which is a different question from whether
  // it bites. The seam above shows the branch works against any list; the list
  // itself decided which files a step can lose without anything noticing, and
  // nothing was reading it. A step quietly dropped from it, or a step's entry
  // reduced to the one file everybody would notice anyway, left that comparison
  // as thorough as ever about a smaller subject.
  //
  // Written out here rather than derived, like every other pin in this suite: a
  // list built from the thing under test agrees with it whatever it says.
  assert.deepEqual(
    Object.fromEntries(Object.entries(CHECK_FILES).map(([step, files]) => [step, [...files].sort()])),
    {
      typecheck: ['jsconfig.json', 'tsconfig.tooling.json'],
      'check:sinks': ['scripts/check-sinks-core.mjs', 'scripts/check-sinks.mjs'],
      'check:self': [
        'scripts/check-manifest-core.mjs',
        'scripts/run-node-tests-core.mjs',
        'scripts/run-node-tests.mjs',
      ],
      'test:fast': [
        'scripts/check-manifest-core.mjs',
        'scripts/run-node-tests-core.mjs',
        'scripts/run-node-tests.mjs',
      ],
      'test:smoke': [
        'playwright.config.js',
        'scripts/check-manifest-core.mjs',
        'scripts/run-browser-tests-core.mjs',
        'scripts/run-browser-tests.mjs',
        'scripts/serve.mjs',
      ],
    },
    'the files a step cannot run without have changed, and that is a decision rather than an edit',
  );

  // And every step of the chain has an entry, so a step added to the manifest
  // cannot arrive with nothing named for it.
  assert.deepEqual(Object.keys(CHECK_FILES).sort(), Object.keys(CHECK_COMMANDS).sort());

  // The typecheck step's scope, which none of the above can reach. Its command
  // is one string and its files are both on disk in every case here, and it
  // still checks nothing if the files say not to. Each configuration is damaged
  // in one way at a time and handed back through the seam.
  /** @param {(file: string) => unknown} readConfig */
  const withConfigs = (readConfig) => checkManifest(pinned, () => true, readConfig);

  assert.deepEqual(withConfigs((file) => CHECK_CONFIGS[file] ?? null), []);
  assert.ok(withConfigs(() => null).some((line) => line.includes('could not be read')));

  /** @type {[string, (config: any) => void][]} */
  const damages = [
    ['checkJs turned off', (config) => { config.compilerOptions.checkJs = false; }],
    ['strict turned off', (config) => { config.compilerOptions.strict = false; }],
    ['allowJs turned off', (config) => { config.compilerOptions.allowJs = false; }],
    ['the include globs narrowed', (config) => { config.include = config.include.slice(0, 1); }],
    ['the include globs emptied', (config) => { config.include = []; }],
    ['an exclude standing in for a narrowed include', (config) => { config.exclude = ['site', 'scripts', 'test']; }],
    ['the types roster widened', (config) => { config.compilerOptions.types = ['node', 'anything']; }],
    // An option nobody decided about, which is how a checker gets turned off
    // next time: not by changing one of the options this list already names.
    ['an option nothing pins', (config) => { config.compilerOptions.somethingNew = true; }],
    ['an option removed', (config) => { delete config.compilerOptions.noUncheckedIndexedAccess; }],
  ];

  // And the one difference that is deliberately not one, which is the other side
  // of the same comparison: a key whose name marks it as documentation is
  // ignored, at the top level and inside the options, because `tsc` ignores it
  // too. Nothing exercised that — neither configuration carries one — so the
  // filter could be deleted with the whole chain green, and the next person to
  // write a note into one of those files would have got a failure telling them
  // the typecheck step's scope had changed.
  for (const file of Object.keys(CHECK_CONFIGS)) {
    const documented = JSON.parse(JSON.stringify(CHECK_CONFIGS[file]));
    documented['// note'] = 'why this file is what it is';
    documented.compilerOptions['// note'] = 'and why one of its options is';
    assert.deepEqual(
      withConfigs((asked) => (asked === file ? documented : (CHECK_CONFIGS[asked] ?? null))),
      [],
      `${file} carrying a documentation key was refused`,
    );
  }

  for (const file of Object.keys(CHECK_CONFIGS)) {
    for (const [what, damage] of damages) {
      const copy = JSON.parse(JSON.stringify(CHECK_CONFIGS[file]));
      damage(copy);
      const failures = withConfigs((asked) => (asked === file ? copy : (CHECK_CONFIGS[asked] ?? null)));
      assert.ok(
        failures.some((line) => line.startsWith(file)),
        `${file} with ${what} was not refused`,
      );
    }
  }

  // The manifest as it actually is, last, so the cases above are a comparison
  // rather than the only thing this asks — and it reads the configurations off
  // disk, so the pins above are pins on those files rather than on a copy.
  assert.deepEqual(checkManifest(readManifest()), []);
});

test('the canonical form is what the generator pinned, and the records carry what produces it', () => {
  for (const item of vectors.canonicalisations) {
    assert.equal(item.canonical, item.expected, item.name);

    // The record used as what it is published as. `canonical` and `expected`
    // are the same string in every entry by construction — the generator will
    // not write a file in which they differ — so on their own they are two
    // copies of an answer with no question beside them, and an implementer of
    // the producing side has nothing to canonicalise. The input is the question,
    // and this is it being asked.
    assert.equal(canonicalJson(item.input), item.expected, item.name);
  }

  // And at least one input is not already in the form it must reach, so these
  // are records of a transformation rather than of an identity.
  assert.ok(
    vectors.canonicalisations.some((/** @type {any} */ item) => JSON.stringify(item.input) !== item.expected),
    'no canonicalisation record has an input that canonicalising changes',
  );

  assert.equal(vectors.canonicalisations[0].expected, vectors.fixtures[0].inputs.aad);

  // And which of the records are a share's authenticated data, which is a
  // classification and not a count: one of the four is, and the other three are
  // values chosen to put one rule of the form — escaping, ordering by code
  // unit, the spelling of integers — to a canonicaliser, none of which the six
  // fixed member names of an authenticated document can be made to do. Each
  // record's own note says so, and prose is not checkable, so the split is read
  // out of the records here. A record that quietly became the other kind is a
  // vector a conforming reader would be right to refuse as a document while
  // still being required to canonicalise it.
  const aads = new Set(vectors.fixtures.map((/** @type {any} */ fixture) => fixture.inputs.aad));
  const shares = vectors.canonicalisations.filter((/** @type {any} */ item) => aads.has(item.expected));
  assert.equal(shares.length, 1, 'the canonicalisation records no longer split one share from three values');
  assert.equal(shares[0].name, vectors.canonicalisations[0].name);

  const aadFields = ['doc', 'edited', 'exp', 'id', 'sfv', 'v'];
  assert.deepEqual(Object.keys(JSON.parse(shares[0].expected)).sort(), aadFields);
  for (const item of vectors.canonicalisations) {
    if (item === shares[0]) {
      continue;
    }
    assert.notDeepEqual(
      Object.keys(JSON.parse(item.expected)).sort(),
      aadFields,
      `${item.name} carries the field set of a share while its note says it is not one`,
    );
  }
});

test('the viewer never re-serialises anything', () => {
  // The additional authenticated data is authenticated as the bytes that
  // arrived. A viewer that can write JSON is a viewer that can write a copy of
  // the AAD that means the same thing and hashes differently, so it cannot.
  //
  // Lexical, and comments are not exempt: the cost is that this construct
  // cannot be named in the viewer's own prose, which is cheaper than arguing
  // about whether a particular occurrence was live code.
  //
  // It catches none of the ways an AAD could be altered without being rebuilt.
  // Normalising it, trimming it, or re-encoding it are all single method calls
  // that this scan has no opinion about; what refuses those is the
  // `combining-marks` fixture, whose strings are changed by every one of them.
  for (const name of readdirSync(SITE_JS)) {
    const source = readFileSync(join(SITE_JS, name), 'utf8');
    assert.ok(!source.includes('JSON.stringify'), `${name} serialises JSON`);
  }
});

test('both render functions are gated on the clear', () => {
  // The one claim about this viewer that no observation of it can carry, and it
  // is the one that keeps a decrypted note from being drawn over rather than
  // replaced. Both render functions clear the root and draw nothing if it did
  // not empty; the surface they draw after a successful clear is, in this
  // scaffold, nothing at all — so removing the branch and keeping the call
  // changes no behaviour any input reaches, and both engines stay green.
  //
  // Lexical, like the check that this viewer never re-serialises anything, and
  // for the same reason: a property of these bytes that no run can show is a
  // property to read out of the bytes. When the surface arrives, this becomes a
  // behavioural test and this one goes.
  const source = readFileSync(join(SITE_JS, 'render.js'), 'utf8');
  const guard = 'if (!clearRoot(root)) {\n    return;\n  }';

  assert.equal(
    source.split(guard).length - 1,
    2,
    'render.js no longer opens both of its render functions with the clear and the branch on it',
  );

  // And each of the two is that function's first statement, rather than two
  // guards in one of them.
  for (const name of ['renderShareDocV1', 'renderUnavailable']) {
    const at = source.indexOf(`export function ${name}(`);
    assert.ok(at !== -1, `render.js no longer exports ${name}`);
    const body = source.slice(source.indexOf('{', at) + 1);
    assert.ok(body.trimStart().startsWith(guard), `${name} does not begin with the clear and the branch on it`);
  }
});

test('every fixture uses its own nonces', () => {
  /** @type {string[]} */
  const nonces = [];
  for (const fixture of vectors.fixtures) {
    nonces.push(fixture.inputs.wrap_nonce, fixture.inputs.content_nonce);
  }
  assert.equal(new Set(nonces).size, nonces.length);
});

test('the interop vectors cover the shapes they are meant to', () => {
  assert.ok(vectors.fixtures.length >= 6);
  assert.ok(vectors.derivations.length >= 3);
  assert.ok(vectors.canonicalisations.length >= 4);

  const documents = vectors.fixtures.map((/** @type {any} */ fixture) => JSON.parse(fixture.inputs.plaintext));
  assert.ok(documents.some((/** @type {any} */ doc) => doc.you_means === ''));
  assert.ok(documents.some((/** @type {any} */ doc) => doc.edited === true));
  assert.ok(documents.some((/** @type {any} */ doc) => doc.sections.length === 0));
  assert.ok(documents.some((/** @type {any} */ doc) => doc.sections.length > 1));

  // One derivation has to be genuinely extreme, not merely differently
  // patterned: an all-zero capability and an all-ones stored key are the shapes
  // an implementation is most likely to special-case or mistake for absent.
  const extreme = vectors.derivations[1];
  assert.ok(Buffer.from(extreme.inputs.a, 'base64url').every((/** @type {number} */ byte) => byte === 0x00));
  assert.ok(Buffer.from(extreme.inputs.b, 'base64url').every((/** @type {number} */ byte) => byte === 0xff));
  assert.ok(Buffer.from(extreme.inputs.id, 'base64url').every((/** @type {number} */ byte) => byte === 0x00));

  // And one fixture's authenticated data has to carry U+FFFD, so the corpus can
  // present the same bytes spelled with an unpaired surrogate.
  assert.ok(vectors.fixtures.some((/** @type {any} */ fixture) => fixture.inputs.aad.includes('�')));

  for (const fixture of vectors.fixtures) {
    assert.equal(fixture.outputs.wrapped_k.length, 80);
    assert.equal(fixture.inputs.b.length, 43);
    assert.equal(fixture.inputs.id.length, 22);
    assert.equal(fixture.inputs.a.length, 43);
  }
});

test('one fixture is changed by every repair that could change it', () => {
  // Until this one existed, every string in the corpus survived normalisation
  // and trimming unchanged — so normalising the AAD before the tag check, or
  // after it, or trimming either string on the way out, altered nothing any case
  // could see. All four passed the whole suite.
  //
  // Three of those four are still caught here, and the fourth cannot be. The
  // authenticated data is canonical JSON, and outer whitespace is not something
  // a canonical JSON document has, so trimming it is equivalent by construction
  // to doing nothing: there is no valid input that would tell the two apart, and
  // the fixture that used to tell them apart did so by being sealed over a
  // string the protocol does not admit. What that published was a conformance
  // vector a correct producer could not emit and a correct reader would refuse.
  const changed = vectors.fixtures.filter(
    (/** @type {any} */ fixture) =>
      fixture.inputs.aad !== fixture.inputs.aad.normalize('NFC') &&
      fixture.inputs.plaintext !== fixture.inputs.plaintext.normalize('NFC') &&
      fixture.inputs.plaintext !== fixture.inputs.plaintext.trim(),
  );
  assert.ok(changed.length >= 1, 'no fixture is sensitive to normalisation and trimming');

  // And it still has to be a share: the strings are unusual, the document is
  // not.
  for (const fixture of changed) {
    assert.equal(JSON.parse(fixture.inputs.plaintext).schema, 'share_doc_v1');
    assert.equal(JSON.parse(fixture.inputs.aad).doc, 'share_doc_v1');
  }
});

test('every fixture is sealed over the canonical form of its authenticated data', () => {
  // The protocol says that string is canonical JSON. A vector sealed over
  // anything else is a conformance target that a conforming implementation
  // would be right to fail, which is the opposite of what these are for — and
  // one fixture was, sealed with a trailing space so that trimming it would be
  // visible. It is checked here as well as in the generator because the
  // generator is the thing that would have to be re-run to notice, and this file
  // reads what was actually emitted.
  //
  // Members sorted by code unit, no whitespace, integers as digits: the same
  // form the generator pins each fixture against, recomputed from the emitted
  // bytes rather than taken from it.
  for (const fixture of vectors.fixtures) {
    const parsed = JSON.parse(fixture.inputs.aad);
    const canonical = `{${Object.keys(parsed)
      .sort()
      .map((name) => `${JSON.stringify(name)}:${JSON.stringify(parsed[name])}`)
      .join(',')}}`;
    assert.equal(fixture.inputs.aad, canonical, fixture.name);
  }
});

test('one fixture carries a surrogate pair in what the tag covers', () => {
  // The well-formedness test on the authenticated data has two directions, and
  // only one of them was ever asked about. It can be made to refuse every
  // surrogate rather than every unpaired one — which is to say every emoji and
  // every astral character — and until this fixture existed no vector in the
  // corpus contained one, so that mistake decrypted everything there was to
  // decrypt and the suite stayed green.
  const paired = vectors.fixtures.filter((/** @type {any} */ fixture) => {
    const text = fixture.inputs.aad;
    for (let index = 0; index < text.length - 1; index += 1) {
      const unit = text.charCodeAt(index);
      const next = text.charCodeAt(index + 1);
      if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        return true;
      }
    }
    return false;
  });
  assert.ok(paired.length >= 1, 'no fixture authenticates a surrogate pair');

  // And every fixture's authenticated data is well-formed, which is what makes
  // the set of shares that must decrypt a set the refusing direction cannot
  // shrink by accident. Counted out rather than deferred to the platform's own
  // test, which is newer than the language level the viewer is pinned to.
  for (const fixture of vectors.fixtures) {
    const text = fixture.inputs.aad;
    for (let index = 0; index < text.length; index += 1) {
      const unit = text.charCodeAt(index);
      if (unit < 0xd800 || unit > 0xdfff) {
        continue;
      }
      assert.ok(unit <= 0xdbff, `${fixture.name} carries an unpaired trailing surrogate`);
      index += 1;
      const next = text.charCodeAt(index);
      assert.ok(next >= 0xdc00 && next <= 0xdfff, `${fixture.name} carries an unpaired leading surrogate`);
    }
  }
});

test('no object in the emitted vectors names a member twice', () => {
  // The generator's guard was in the canonicaliser only, and the canonicaliser
  // runs over the authenticated data — not over the graph that is written to
  // this file. This reads the file as text, because a duplicate member is
  // exactly what parsing it would hide.
  assert.deepEqual(duplicateMemberNames(readFileSync(VECTORS_FILE, 'utf8')), []);

  // And the scanner is shown to find one, so a clean answer is an answer.
  assert.deepEqual(duplicateMemberNames('{"a":1,"b":{"c":2,"c":3}}'), ['c']);
  assert.deepEqual(duplicateMemberNames('{"a":1,"b":[{"c":2},{"c":3}]}'), []);
  assert.deepEqual(duplicateMemberNames('{"a":"}\\"","a":2}'), ['a']);

  // The duplicate a parser genuinely hides and a scan of the raw text did not:
  // one name, two spellings. `"a"` and `"\u0061"` are the same member to every
  // JSON parser, and comparing the characters between the quotes made them two.
  assert.deepEqual(duplicateMemberNames('{"a":1,"\\u0061":2}'), ['a']);
  assert.deepEqual(duplicateMemberNames('{"\\u0061":1,"a":2}'), ['a']);
  assert.deepEqual(duplicateMemberNames('{"a\\u002Eb":1,"a.b":2}'), ['a.b']);
  // And the other escapes, so what is decoded is JSON's escapes rather than one
  // of them.
  assert.deepEqual(duplicateMemberNames('{"a\\nb":1,"a\\u000Ab":2}'), ['a\nb']);
  assert.deepEqual(duplicateMemberNames('{"a\\/b":1,"a/b":2}'), ['a/b']);
  assert.deepEqual(duplicateMemberNames('{"a\\\\b":1,"a\\u005Cb":2}'), ['a\\b']);
  // Two genuinely different names stay two, so the decoding is not collapsing
  // everything it touches.
  assert.deepEqual(duplicateMemberNames('{"a":1,"\\u0062":2}'), []);
});

/**
 * The escapes JSON spells with one character after the backslash.
 *
 * @type {Readonly<Record<string, string>>}
 */
const SIMPLE_ESCAPES = Object.freeze({
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
});

/**
 * Member names that appear more than once in one object, anywhere in a JSON
 * text.
 *
 * A scanner rather than a parse, because every JSON parser resolves a duplicate
 * member — keeping the first, keeping the last, or refusing — and resolving it
 * is what makes it invisible.
 *
 * The names are unescaped as they are read, and that is what makes this a scan
 * for duplicate members rather than for repeated text. Two members are the same
 * member when they spell the same name, and JSON gives every name more than one
 * spelling: `"a"` and `"\u0061"` are one name to every parser there is. Holding
 * the raw text meant those two compared as different members, so the one shape
 * a duplicate could take that parsing genuinely hides — a second spelling of a
 * name already used — was the one shape this did not catch, while its own
 * comment said it caught what parsing would hide.
 *
 * Everything JSON can escape is decoded, not only the escape that hides a name:
 * a scanner that decoded some of them would be the same mistake with a shorter
 * list.
 *
 * @param {string} text
 * @returns {string[]}
 */
function duplicateMemberNames(text) {
  /** @type {Set<string>} */
  const duplicated = new Set();
  /** @type {{ isObject: boolean, names: Set<string> }[]} */
  const stack = [];
  /** @type {string | null} */
  let pending = null;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === '"') {
      let value = '';
      index += 1;
      while (index < text.length && text[index] !== '"') {
        if (text[index] === '\\') {
          index += 1;
          const escaped = text[index];
          if (escaped === 'u') {
            value += String.fromCharCode(Number.parseInt(text.slice(index + 1, index + 5), 16));
            index += 5;
          } else {
            value += SIMPLE_ESCAPES[String(escaped)] ?? String(escaped);
            index += 1;
          }
          continue;
        }
        value += text[index];
        index += 1;
      }
      pending = value;
      continue;
    }

    if (character === ':') {
      const frame = stack[stack.length - 1];
      if (frame !== undefined && frame.isObject && pending !== null) {
        if (frame.names.has(pending)) {
          duplicated.add(pending);
        }
        frame.names.add(pending);
      }
      pending = null;
      continue;
    }

    if (character === '{' || character === '[') {
      stack.push({ isObject: character === '{', names: new Set() });
      pending = null;
      continue;
    }

    if (character === '}' || character === ']') {
      stack.pop();
      pending = null;
      continue;
    }

    if (character === ',') {
      pending = null;
    }
  }

  return [...duplicated].sort();
}
