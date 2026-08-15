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
 *   - The claims about the viewer that are true of its bytes rather than of any
 *     run, and so cannot be asserted from a run at all. Three of them, each read
 *     out of a served file as text: that no module under `site/js/` names the JSON
 *     serialiser; that every visible string in `copy.js` is the string that was
 *     agreed and that the file carries no other; and that the stylesheet's bytes
 *     are the bytes that were reviewed. The last of those is the file whose
 *     effect no reading of a run can see — a stylesheet changes what a page says
 *     without a node or a string constant moving — which is why it is pinned
 *     whole rather than read for a construct.
 *
 *     There was another, about both render functions opening with the clear and
 *     branching on it, and it is not in this file any more — that one is asserted
 *     against a page now, and a note where it used to be says which test carries
 *     it and how.
 *   - The pins on the other path: the browser runner's command, its floors, and
 *     the titles of the tests its suite is built from. A check on whether a step
 *     of `npm run check` runs cannot live inside that step, so this file holds
 *     the browser path's end of it and the browser suite holds this one's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  CHECK_COMMANDS,
  CHECK_CONFIGS,
  CHECK_FILES,
  CHECK_STEPS,
  checkManifest,
  onDisk,
  readConfigFile,
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
import { SUITES as NODE_SUITES } from '../../scripts/run-node-tests-core.mjs';
import { CAPABILITY_PROBE } from '../../site/js/capability.js';
import { encodeBase64url, formatDateTime } from '../../site/js/format.js';
import { decodeBase64url } from '../../site/js/parse.js';
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

test('the cases that ask what the decoder does with ill-formed bytes are there, by name', () => {
  // A per-kind floor is a count, and a count cannot tell one case from another.
  // The decryption floor sits below what that kind carries — deliberately, so
  // ordinary additions do not touch it — which means these four could be deleted
  // together and every floor would still be clear. What they hold is the one
  // flag deciding whether a document whose bytes are not well-formed UTF-8 is
  // refused or handed back repaired, with U+FFFD standing in for whatever the
  // bytes were, and there is nothing else in the corpus that asks. So they are
  // named here, outside the file that builds them, in the shape the browser
  // suite's required titles are named: a list, written out, compared whole.
  //
  // Whole rather than a subset, because "not well-formed UTF-8" is four
  // different mistakes with four different repairs and the flag is one flag —
  // any one of them going is a shape nobody asks about any more.
  //
  // The list also carries the one case in this group that is not about the flag
  // at all: a document sealed over `c2 80`, which is well-formed UTF-8 for a C1
  // control. It is named here with the rest because it is the same kind of thing
  // — a shape the counts cannot hold up — and because what it asks is the other
  // half of what this step does. The four say the decoder does not repair what
  // it cannot read; that one says it does not quietly drop what it can. Deleting
  // U+0080 from the decoded string left every one of the corpus's cases green,
  // because no other document here carries a code point that shows as nothing.
  const { cases } = buildCases();
  const sealedOver = cases
    .filter((item) => item.name.startsWith('decrypt/document-sealed-over-'))
    .map((item) => item.name)
    .sort();
  assert.deepEqual(sealedOver, [
    'decrypt/document-sealed-over-a-byte-that-begins-no-sequence',
    'decrypt/document-sealed-over-a-continuation-byte-with-no-lead',
    'decrypt/document-sealed-over-a-control-character-that-shows-as-nothing',
    'decrypt/document-sealed-over-a-sequence-that-stops-early',
    'decrypt/document-sealed-over-a-surrogate-spelled-as-three-bytes',
    'decrypt/document-sealed-over-the-code-point-below-the-surrogates',
    'decrypt/document-sealed-over-the-replacement-character-itself',
    'decrypt/document-sealed-over-the-sequence-that-stops-early-completed',
  ]);

  /** @param {string} name */
  const byName = (name) => {
    const found = cases.find((item) => item.name === name);
    assert.ok(found !== undefined, `${name} is not in the corpus`);
    return found;
  };

  // And what each of them requires, because a name is not a question. Every one
  // of the four is sealed over the same document as the ones that must decrypt,
  // under the same content key and over the same authenticated data, so the only
  // thing left that could refuse them is the decode — and the group below is what
  // says so, since a refusal arriving from the tag, a length, or the base64
  // reading would take one of them with it.
  //
  // The content key and not the nonce, though they share that too. A nonce
  // travels inside the blob and is handed to the decryption from there, so a case
  // sealed under a different one decrypts just the same and the sharing carries
  // no weight. It is the key that has to be the one the wrap arrives at.
  for (const what of [
    'a-byte-that-begins-no-sequence',
    'a-continuation-byte-with-no-lead',
    'a-sequence-that-stops-early',
    'a-surrogate-spelled-as-three-bytes',
  ]) {
    const item = byName(`decrypt/document-sealed-over-${what}`);
    assert.deepEqual(item.expect, { ok: false, plaintext: null, aad: null }, `${what} no longer requires a refusal`);
    assert.ok(item.reseal?.bytes !== undefined, `${what} is no longer sealed over bytes, so it cannot be ill-formed`);
  }

  // And the key all seven seal under, which is what makes the four a question
  // about the decode at all rather than four assertions that something refused.
  //
  // A refusal does not say where it came from. Sealed under a key the viewer
  // will not arrive at, each of the four refuses at the tag, reports exactly the
  // refusal its case requires, and passes with the decode never reached — so the
  // one flag those cases hold could be turned over with all four still green.
  // That was the state until this line: the sentence above said they share a
  // key, and nothing asked. What closes it is that the ones which must decrypt
  // seal under the same key, so a key that stops being the wrapped one takes
  // those down — they are required to come back whole, and a control that stops
  // decrypting cannot be read as a pass.
  //
  // Read off the built cases rather than off the expression that built them, so
  // this is a claim about what the corpus holds and not a restatement of one
  // line of the file that produced it.
  const publishedKey = Array.from(Buffer.from(vectors.fixtures[0].inputs.k, 'base64url'));
  for (const name of sealedOver) {
    assert.deepEqual(
      byName(name).reseal?.k,
      publishedKey,
      `${name} is no longer sealed under the fixture's own content key, so a refusal from it says nothing about the decode`,
    );
  }

  // The three that must decrypt: two of them one byte from an ill-formed
  // sibling, and one that is what the four refusals are not about. Read as the
  // bytes they are sealed over rather than as the characters they end in, so
  // this says the share carries the sequence rather than that a string was
  // spelled a particular way.
  //
  // The third is `ef bf bd`, which is well-formed UTF-8 for a document
  // containing U+FFFD. Without it the four refusals could be satisfied by a
  // decoder that repaired ill-formed bytes to that character and then refused
  // any document carrying one: every refusal the four require would arrive, and
  // no other document in this corpus carries a U+FFFD to notice. What that
  // decoder does to a share nobody tampered with is collapse it into the same
  // unavailable state a tampered one gets. So the four are about ill-formed
  // bytes, and this is the case that says so.
  for (const [what, sequence] of /** @type {[string, number[]][]} */ ([
    ['the-sequence-that-stops-early-completed', [0xe2, 0x82, 0xac]],
    ['the-code-point-below-the-surrogates', [0xed, 0x9f, 0xbf]],
    ['the-replacement-character-itself', [0xef, 0xbf, 0xbd]],
  ])) {
    const item = byName(`decrypt/document-sealed-over-${what}`);
    assert.equal(item.expect['ok'], true, `${what} no longer requires the share to decrypt`);
    assert.deepEqual(
      (item.reseal?.bytes ?? []).slice(-sequence.length),
      sequence,
      `${what} is no longer sealed over the sequence it is named for`,
    );
    assert.equal(
      typeof item.expect['plaintext'] === 'string' &&
        item.expect['plaintext'].endsWith(Buffer.from(sequence).toString('utf8')),
      true,
      `${what} no longer requires the decoded document to carry what was appended to it`,
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

  // And a spare kept under a symbol, which is the same claim about the other
  // kind of key. The list this direction was read from returns names only, so a
  // symbol-keyed field on an observation was the one thing that could arrive
  // reported and be neither named by the case nor refused as unnamed — and it is
  // the key somebody would choose for exactly that reason, since no ordinary
  // enumeration shows it.
  /** @type {Record<string | symbol, unknown>} */
  const symbolSpare = { ...first.expect };
  symbolSpare[Symbol.for('spare')] = 1;
  results[0] = { name: first.name, observed: symbolSpare };
  assert.ok(
    checkObservations({ cases, probes, secrets, results }).some((line) =>
      line.includes('which the case does not name'),
    ),
    'a field kept under a symbol was not compared against what the case names',
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

test('the comparison separates values one serialisation spells the same way', () => {
  // What a case requires and what the driver observed used to be compared by
  // serialising both and comparing the text, and `JSON.stringify` is not
  // injective: it writes `null` for `null` and for `NaN`, `0` for `0` and for
  // `-0`, drops a member whose value is `undefined`, and writes `null` for a
  // hole and for a `null` element. Each of those is a pair a case could observe
  // one of while requiring the other and be reported as a match — and the first
  // pair is one token away in the driver, where the value that stands for "there
  // was nothing to hand back" is written.
  //
  // Every pair below is asserted to be a genuine collision before it is asserted
  // to be caught, so this is a test about the comparison rather than about five
  // values that happen to differ.
  //
  // And every one of them is a pair the walk settles, which is the point of the
  // list. A pair separated by the type test in front of the walk — an object and
  // the string it serialises as, which is what a value carrying a `toJSON`
  // produces — belongs to a different claim: it holds the guard, not the
  // comparison, and reading it as coverage of the walk was reading confidence
  // into the wrong line. The last pair is the walk one level down, where the
  // recursion is the only thing that can find the difference.
  const { cases, probes, secrets } = buildCases();
  const [first] = cases;
  assert.ok(first !== undefined);

  /**
   * One case's requirement and its observation, both replaced by a single
   * field, with every other case answered honestly.
   *
   * @param {unknown} expected
   * @param {unknown} observed
   * @returns {string[]}
   */
  const compared = (expected, observed) => {
    const swapped = cases.map((item) => (item === first ? { ...item, expect: { only: expected } } : item));
    const results = swapped.map((item) => ({ name: item.name, observed: { ...item.expect } }));
    results[0] = { name: first.name, observed: { only: observed } };
    return checkObservations({ cases: swapped, probes, secrets, results });
  };

  // Equal values are still equal, including the one a text comparison and a
  // value comparison disagree about in the other direction.
  assert.deepEqual(compared(null, null), []);
  assert.deepEqual(compared([1, 2], [1, 2]), []);
  assert.deepEqual(compared({ a: 1, b: [2, null] }, { a: 1, b: [2, null] }), []);
  assert.deepEqual(compared(Number.NaN, Number.NaN), []);

  // And the symbol side's accepting direction, which nothing here had. Every
  // symbol case below is a pair that must be told apart, and the walk can tell
  // any pair apart by refusing all of them: deleting the `!` from the symbol
  // membership test made two objects that both carry a symbol compare unequal
  // always, and every one of those cases passed exactly as before. This is the
  // pair that has to come back equal — two separately built records carrying the
  // same registered symbol and the same value under it — so the branch is pinned
  // to be a membership test rather than a refusal.
  assert.deepEqual(
    compared({ a: 1, [Symbol.for('probe')]: 2 }, { a: 1, [Symbol.for('probe')]: 2 }),
    [],
    'two records carrying the same symbol and the same value under it were not equal',
  );

  /** @type {[string, unknown, unknown][]} */
  const collisions = [
    ['a refusal and a number that is not one', null, Number.NaN],
    ['zero and the other zero', 0, -0],
    ['a field holding nothing and a field that is not there', { a: undefined }, {}],
    ['a hole in a list and a null in one', [null, 1], [, 1]],
    ['a field holding nothing and a field that is not there, one level down', { a: { b: undefined } }, { a: {} }],
    // A value under a symbol, which is not so much a `JSON.stringify` collision
    // as a value it cannot see at all: it walks own string keys and nothing
    // else, so a property under a symbol is invisible to it whatever is in
    // there. The comparison reads own symbols as well as own names, and these
    // three pairs are what say so. Both directions, because they are held by
    // different lines: the walk lists the observation's own symbols and looks
    // for each on the requirement, so a symbol the observation carries and the
    // case does not is caught by that list, while a symbol the case requires and
    // the observation does not carry is caught only by the count in front of it.
    // Until both were here, that count could go with nothing to notice.
    ['a value under a symbol the case does not require', { a: 1 }, { a: 1, [Symbol.for('probe')]: 2 }],
    ['a value under a symbol nothing observed', { a: 1, [Symbol.for('probe')]: 2 }, { a: 1 }],
    ['two values under the same symbol', { a: 1, [Symbol.for('probe')]: 2 }, { a: 1, [Symbol.for('probe')]: 3 }],
  ];
  for (const [what, expected, observed] of collisions) {
    assert.equal(
      JSON.stringify({ only: expected }),
      JSON.stringify({ only: observed }),
      `${what} are not spelled the same way, so this pair holds nothing`,
    );
    assert.ok(
      compared(expected, observed).some((line) => line.startsWith(`${first.name}: only`)),
      `${what} were compared as the same value`,
    );
  }
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
    [
      'npm run typecheck',
      'npm run check:sinks',
      'npm run check:self',
      'npm run check:release',
      'npm run test:fast',
      'npm run test:release',
      'npm run test:smoke',
    ],
  );
  assert.equal(CHECK_COMMANDS['test:smoke'], 'node scripts/run-browser-tests.mjs');

  assert.ok(MINIMUM_SPEC_FILES >= 3);
  assert.ok(MINIMUM_BROWSER_TESTS >= 6);
  assert.ok(MINIMUM_EXECUTED_TESTS_PER_ENGINE >= 3);
  assert.ok(MINIMUM_EXECUTED_TESTS_PER_SPEC_FILE >= 2);
  assert.deepEqual([...REQUIRED_SPEC_FILES].sort(), ['core.spec.js', 'smoke.spec.js', 'viewer.spec.js']);

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
  assert.deepEqual(Object.keys(REQUIRED_TESTS).sort(), ['core.spec.js', 'release.spec.js', 'smoke.spec.js', 'viewer.spec.js']);
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
      'nothing precedes the policy, in the file or in the bytes a browser is handed',
      'the bytes the server hands back are the bytes on disk',
      'the development server refuses anything outside the tree it serves',
      'the engine running this project is the engine the project names',
      'the page is served and its module graph runs without error',
      'the policy the page carries is enforced against an origin that answers',
    ],
  );
  assert.deepEqual(
    [...(REQUIRED_TESTS['viewer.spec.js'] ?? [])].sort(),
    [
      'a browser that fails the probe is advised, and its code field still works',
      'a browser that refuses to rewrite the address still draws its surface and still empties',
      'a decrypted note is not left on the page underneath a later surface',
      'a decrypted note is the document that was sealed, and carries nothing of the link',
      'a page that comes back out of the cache shows nothing it was showing',
      'a probe that answers late does not draw advice over a surface that is finished',
      'a wrong code can be tried again, and a body that is nearly one cannot',
      'each state the viewer can be in is the surface it is pinned to be',
      'every failure the viewer can reach draws the same surface',
      'every text on every surface reaches the contrast it has to',
      'putting the page away empties it, before anything can be drawn over it',
      'reporting a link sends the identifier and nothing else',
      'the expiry is the moment it was sealed with, spelled the one way',
      'the link is out of the address bar before anything is sent, and nothing sent carries it',
      'the page reflows at a narrow width and at twice the text size',
    ],
  );

  // The two the release check cannot ask of a socket. A cookie the browser was
  // already holding and a jar with something left in it are readings of the
  // browser rather than of a response, and what an engine does with a fetch a
  // response header started has to be taken in each engine to have been taken at
  // all. Every counting floor above clears whether either of these ran.
  assert.deepEqual(
    [...(REQUIRED_TESTS['release.spec.js'] ?? [])].sort(),
    [
      'a page that sets nothing leaves nothing, and both halves of that are shown to fire',
      'what each engine does with a fetch a response header started, measured in both arms',
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

test('the self suite is required to run every check that is about another check, by title', () => {
  // The other half of the pair the fast path's runner is pinned by, and the
  // outside end of it. Each suite names the tests it is built from, and a list a
  // suite keeps about itself is a list that suite can shorten: emptying the self
  // suite's titles where they live would leave every floor clear and every one
  // of these checks skippable one line at a time. So they are written out here,
  // from the other suite — the self suite's titles are pinned by this file,
  // which is the fast suite, and the fast suite's titles are pinned by
  // `scripts/run-node-tests-selftest.mjs`, which is the self suite. Neither can
  // quietly shorten its own.
  //
  // This is the browser path's arrangement on the node runner: `REQUIRED_TESTS`
  // is pinned by a test in this file rather than by one in the suite it governs,
  // for the same reason and against the same edit.
  const self = NODE_SUITES['self'];
  assert.ok(self !== undefined, 'the runner no longer knows a suite called self');

  assert.deepEqual(Object.keys(self.requiredTests).sort(), [
    'check-attribution-selftest.mjs',
    'check-sinks-selftest.mjs',
    'run-browser-tests-selftest.mjs',
    'run-node-tests-selftest.mjs',
  ]);

  assert.deepEqual(
    [...(self.requiredTests['check-attribution-selftest.mjs'] ?? [])].sort(),
    [
      'a commit merged in from a branch is still read',
      'a commit no branch points at is still read',
      'a history with commits in it is read, and read field by field',
      'a message that cannot be read, and a command line that is not one, are refused',
      'a message with nothing to report is accepted',
      'each rule refuses a message that breaks only that rule, in each spelling it has',
      'the history this repository has is accepted, and an empty one is not',
      'the hook is on disk, executable, and refuses what it is for',
      'the rules are the rules this check is pinned to have',
      'the workflow reads the whole history, and reads it with this check',
    ],
  );

  assert.deepEqual(
    [...(self.requiredTests['check-sinks-selftest.mjs'] ?? [])].sort(),
    [
      'a symlinked entry in the scanned tree fails the scan closed',
      'a symlinked scan root fails the scan closed',
      'a tree with exactly one violation is a failure',
      'a violation is reported at the line and with the text it is on',
      'a violation on a line longer than the report is truncated to the reported width',
      'an empty tree cannot be scanned, and says so',
      'each destination is admitted where it ends, and nothing longer is admitted at all',
      'every alternative every rule names is refused',
      'every punctuation the code-execution rules name is refused',
      'every rule fires on at least one violation fixture',
      'every spelling of a typecheck suppression is refused',
      'markup rules reach every configured markup extension',
      'no character carries an admitted destination on to somewhere else',
      'no module the checks are made of turns the type checker off',
      'nothing in front of an admitted destination, and no seam inside one, carries it somewhere else',
      'nothing written inside the scheme of a destination stops this reading it as one',
      'script rules reach .mjs, not only .js',
      'the clean fixture produces no violations',
      'the command line exits 0 on a clean tree',
      'the command line exits 1 and prints FAIL on a violations tree',
      'the command line exits 2 on a missing tree',
      'the command line still scans when reached through a symlinked path',
      'the documented known misses are still missed',
      'the invocation that names no tree scans the shipped one',
      'the rule set matches the independently pinned list',
      'the scan reads every line of a file, and every extension it is handed',
      'the two requests and the three destinations are where they are allowed to be',
    ],
  );

  assert.deepEqual(
    [...(self.requiredTests['run-browser-tests-selftest.mjs'] ?? [])].sort(),
    [
      'a command line that is neither documented form exits 1',
      'a default invocation that did not load this configuration exits 1',
      'a passing tree exits 0',
      'a path that merely extends another is not that path',
      'a required test is the one at the top of its file, not one of its name inside a group',
      'a required test is the one this suite carries, not one of its name elsewhere',
      'a run spawned where the manifest is wrong is refused, and names the step',
      "a run that named no configuration must have loaded this repository's own",
      'a test the harness ran again until it passed is not a test this suite reports',
      'a test whose last attempt did not pass is a failure, whatever the outcome was called',
      'a tree of nothing but skipped tests exits 1',
      'a tree run in one engine exits 1',
      'a tree with a failing test exits 1, and for that reason',
      'a tree with exactly one reason to be refused exits 1',
      'a tree with the corpus collected out exits 1',
      'an absent configuration exits 1',
      'each counting floor refuses the count below it and admits the count at it',
      'the default invocation this repository ships exits 0',
      "the names a run reported are measured from this suite's own directory",
      'the run policy answers the questions it is asked',
      'what a run reported is counted exactly',
    ],
  );

  assert.deepEqual(
    [...(self.requiredTests['run-node-tests-selftest.mjs'] ?? [])].sort(),
    [
      'a command line that names no suite exits 1',
      'a required test missing from a run is a failure that names it',
      'a run spawned where the manifest is wrong is refused, and names the step',
      'a tree of nothing but empty groups exits 1',
      'a tree of nothing but pending tests exits 1',
      'a tree of nothing but skipped tests exits 1',
      'a tree of passing tests exits 0',
      'a tree whose every test passes and whose file-level hook throws exits 1',
      'a tree whose every test passes and whose group body throws exits 1',
      'a tree whose smallest file sits on the per-file floor is judged by which side of it',
      'a tree with a failing test exits 1, and for that reason',
      'a tree with one file skipped out exits 1',
      'an absent tree exits 1',
      'an empty tree exits 1',
      'each suite is where the runner looks for it, and holds what it is built from',
      'the count the runner reports is the count the reporter saw',
      'the run policy answers the questions it is asked',
      'the same tree answers the same whether it is named or given as a tree',
    ],
  );

  // And every file the self suite is required to collect names at least one
  // test, so a file listed as required but required to run nothing in particular
  // cannot sit in the suite with all of its tests skipped out.
  for (const file of self.required) {
    assert.ok(
      (self.requiredTests[file] ?? []).length > 0,
      `${file} is required to be collected and no test in it is required to run`,
    );
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

  // The seam shows the branch works against any answer; what it cannot show is
  // that the default answer is a reading of the disk. Every call that takes the
  // default hands it this repository, where every file a step names is present,
  // so `onDisk` was only ever observed saying `true` — and a version of it that
  // said `true` about everything would leave the comparison above unable to
  // fire, with nothing anywhere disagreeing. Both directions, on files whose
  // presence and absence are not in doubt.
  assert.equal(onDisk('package.json'), true, 'a file that is there was reported missing');
  assert.equal(
    onDisk('a-file-this-repository-does-not-have.json'),
    false,
    'a file that is not there was reported present, so the branch that refuses a missing runner can never fire',
  );

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
      'check:release': [
        'scripts/check-release-core.mjs',
        'scripts/release-check-core/digests.txt',
        'scripts/release-check-core/requests.mjs',
        'scripts/release-check-core/verdict.mjs',
        'test/release-fixtures/corpus.mjs',
        'test/release.spec.js',
      ],
      'test:fast': [
        'scripts/check-manifest-core.mjs',
        'scripts/run-node-tests-core.mjs',
        'scripts/run-node-tests.mjs',
      ],
      'test:release': [
        'scripts/check-manifest-core.mjs',
        'scripts/release-check-adapters/capture.mjs',
        'scripts/release-check-adapters/run.mjs',
        'scripts/release-check-core/check.mjs',
        'scripts/run-release-tests.mjs',
        'test/release-fixtures/certificate.mjs',
        'test/release-fixtures/corpus.mjs',
        'test/release-fixtures/deployment.mjs',
        'test/release-fixtures/origin.mjs',
        'test/release-fixtures/routes.mjs',
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

  // And the two reads themselves, which is what every line above rests on and
  // what nothing was asking. Each comparison here is between a pin and a value,
  // and the value arrives from one `readFileSync` in each of the two readers. A
  // `readManifest` that returns the pinned scripts, and a `readConfigFile` that
  // returns the pinned configurations, are one expression each: with the first,
  // `npm run check` exited 0 with `"test:smoke": "true"` in the manifest and the
  // entire browser suite — both engines, the served-bytes corpus, the served-page
  // smoke test — not run and nothing saying so; with the second it exited 0 with
  // `"checkJs": false` on disk and a blatant type error in a shipped module. The
  // comparisons were as thorough as ever and were being handed their own answers.
  //
  // So the readers are pointed at a tree written here, and the refusals are
  // required to arrive. Two directions, because either alone is satisfiable by
  // the wrong function: a reader that always refuses passes the damaged tree, and
  // a reader that never reads passes the sound one.
  //
  // Called directly rather than through a spawned run, and that is a deliberate
  // exception to how the rest of this repository pins its runners. What is being
  // pinned here is a file read — whether these two functions return what is on
  // disk — and not a wiring decision about which program invokes what. That
  // wiring is pinned in the ordinary way, by a spawned run in each of the two
  // self-tests: `run-node-tests-selftest.mjs` and `run-browser-tests-selftest.mjs`
  // each carry `a run spawned where the manifest is wrong is refused, and names
  // the step`, which copies its runner into a tree whose manifest is wrong and
  // requires the refusal to arrive. That claim used to be made here in prose and
  // was false — neither self-test mentioned the manifest, the real one is sound
  // in every spawn, and the call contributed no failure whether it was there or
  // not.
  //
  // Two trees rather than one, asked in an interleaved order, each asked twice,
  // and each carrying a value nothing outside it can know. A single tree written
  // sound and then damaged is a question asked in a fixed order from one place,
  // and a reader that answers by counting its calls — the pins for the first
  // scratch call, a damaged manifest for the second — passes both directions
  // having read nothing at all. With the real manifest damaged beside it, the
  // whole gate exited 0 and the browser suite did not run.
  //
  // The nonce is what closes it rather than the ordering. An order can be
  // predicted by a reader carrying a list of answers, and a count can be keyed on
  // the root it is handed; a fresh random value written into each file and
  // required to come back is a thing a reader can only produce by reading, and it
  // is never passed to the reader in any form.
  const sound = mkdtempSync(join(tmpdir(), 'manifest-read-sound-'));
  const damaged = mkdtempSync(join(tmpdir(), 'manifest-read-damaged-'));
  try {
    /** @type {Map<string, string>} */
    const nonces = new Map();
    /** @param {string} root @param {{ smoke: string, checkJs: boolean }} how */
    const writeTree = (root, { smoke, checkJs }) => {
      const nonce = randomUUID();
      nonces.set(root, nonce);
      const scripts = { check: CHECK_STEPS.join(' && '), ...CHECK_COMMANDS, 'test:smoke': smoke };
      // A member `checkManifest` reads nothing from, so what it changes is the
      // bytes on disk and nothing about the answer.
      writeFileSync(join(root, 'package.json'), JSON.stringify({ nonce, scripts }, null, 2));
      for (const file of Object.keys(CHECK_CONFIGS)) {
        const config = JSON.parse(JSON.stringify(CHECK_CONFIGS[file]));
        // A documentation key, which the comparison ignores at every level, for
        // the same reason.
        config['// nonce'] = nonce;
        if (file === 'jsconfig.json') {
          config.compilerOptions.checkJs = checkJs;
        }
        writeFileSync(join(root, file), JSON.stringify(config, null, 2));
      }
    };
    /** @param {string} root @returns {string[]} */
    const readTree = (root) =>
      checkManifest(
        readManifest(root),
        () => true,
        (file) => readConfigFile(file, root),
      );

    writeTree(sound, { smoke: CHECK_COMMANDS['test:smoke'] ?? '', checkJs: true });
    writeTree(damaged, { smoke: 'true', checkJs: false });

    // What is on disk, read back. A reader answering from the pins, or from a
    // list of canned answers, or from the root it was handed, cannot produce
    // these.
    for (const root of [sound, damaged]) {
      const manifest = readManifest(root);
      assert.equal(
        /** @type {Record<string, unknown>} */ (manifest)?.['nonce'],
        nonces.get(root),
        'the manifest reader answered without reading the file it was pointed at',
      );
      for (const file of Object.keys(CHECK_CONFIGS)) {
        const config = readConfigFile(file, root);
        assert.equal(
          /** @type {Record<string, unknown>} */ (config)?.['// nonce'],
          nonces.get(root),
          `the configuration reader answered without reading ${file} in the tree it was pointed at`,
        );
      }
    }

    // And the two answers, asked in an order that is not sound-then-damaged and
    // asked more than once each: the same tree has to give the same answer
    // however many questions have come before it.
    for (const root of [damaged, sound, damaged, sound]) {
      const failures = readTree(root);
      if (root === sound) {
        assert.deepEqual(
          failures,
          [],
          'a tree that says what the pins say was refused, so the readers refuse rather than read',
        );
        continue;
      }
      assert.ok(
        failures.some((line) => line.includes('`test:smoke`')),
        'a manifest whose browser step is `true` was accepted, so nothing observes that the manifest is read',
      );
      assert.ok(
        failures.some((line) => line.startsWith('jsconfig.json') && line.includes('checkJs')),
        'a jsconfig with checkJs off was accepted, so nothing observes that the configurations are read',
      );
    }
  } finally {
    rmSync(sound, { recursive: true, force: true });
    rmSync(damaged, { recursive: true, force: true });
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
  // arrived. The platform's serialiser is what would turn it back into a copy
  // that means the same thing and hashes differently, so that function's name
  // does not appear under `site/js/` at all.
  //
  // What this is not, and was written as though it were: a claim that the viewer
  // cannot write JSON. It can, in one place and one shape — `flow.js` builds the
  // bodies of its two requests from a writer that takes a string and produces a
  // quoted string: one body of two named string fields, and one of a single
  // named string field, which is the whole point of the second. That writer is
  // reachable only from those two bodies, the authenticated data never passes
  // through it, and nothing built by it is ever compared against a tag. The
  // sentence here used to say a viewer that can write JSON can write a copy of
  // the AAD, which is true of a general serialiser and not true of that. What
  // this check holds is the general one.
  //
  // Lexical, and comments are not exempt: the cost is that this construct
  // cannot be named in the viewer's own prose, which is cheaper than arguing
  // about whether a particular occurrence was live code.
  //
  // The name rather than one spelling of reaching it. This read the fourteen
  // characters `JSON.stringify`, and a property is not only reachable through
  // its dot: the bracket form is the same function, ships straight past a
  // substring search, and so does a destructured or captured reference to it.
  // Enumerating the ways to write a property access is the game the enumerator
  // loses — a space before the dot, a computed key, an alias — so what is
  // refused is the name itself, anywhere under `site/js/`. The cost is one more
  // word the viewer's prose cannot use, which is the trade this check already
  // made and is priced the same way. The name is not written out here either,
  // for the same reason: this file is read by the scan below it.
  //
  // It catches none of the ways an AAD could be altered without being rebuilt.
  // Normalising it and trimming it are single method calls that this scan has no
  // opinion about; what refuses those is the `combining-marks` fixture, whose
  // authenticated data is changed by normalising and whose document is changed
  // by normalising and by trimming.
  //
  // Re-encoding is not among them and cannot be, which is a residual rather than
  // a gap in that fixture. Encoding a string to UTF-8 and decoding those bytes
  // back is the identity on every string the viewer's tag check can be reached
  // with — the strings for which it is not are the ones that are not well-formed
  // UTF-16, and those are refused before the encoding — so no fixture is changed
  // by a re-encoding and none can be. Trimming the authenticated data is a
  // residual of the same kind, for the reason the fixture test below sets out:
  // canonical JSON has no outer whitespace to trim.
  const serialiser = ['string', 'ify'].join('');
  for (const name of readdirSync(SITE_JS)) {
    const source = readFileSync(join(SITE_JS, name), 'utf8');
    assert.ok(!source.includes(serialiser), `${name} names the JSON serialiser`);
  }
});

// The claim that used to be read out of `render.js` here — that the two renders
// it read open with the clear and the branch on it — is a behavioural claim now,
// and it is asserted where behaviour can be seen. `test/viewer.spec.js` carries
// `a decrypted note is not left on the page underneath a later surface`, which
// drives four legs inside one document. A share is decrypted onto the page and
// the page is then put away, and what the note put there has to be gone from the
// document rather than merely off the screen. Then the same thing three times
// more with the body's own write replaced by a stand-in that returns and empties
// nothing — on the way to the generic surface, on the way to a note, and on the
// way to the line a code that did not match earns — where what has to happen is
// that nothing is drawn at all.
//
// Those last three are what neither the source reading nor the first leg can
// stand in for. A renderer reading the call's return instead of the element's
// state draws straight over what is still there, and a leg that only ever meets
// a clear which worked passes exactly the same. Stopping the write is what tells
// a clear that ran from a clear that emptied nothing.
//
// One thing the source reading said that this does not is a count: that there
// are exactly so many of these guards, and that each is the first thing its
// function does. Four functions in that module carry one, three of them are
// driven there, and the fourth is the code-entry surface, which is drawn at boot
// before there is anything in the page to hold back. What replaces the count is
// the module's own paragraph saying which four they are, which is prose rather
// than a check — so a fifth surface added without a guard is caught by review
// rather than here.

test('the copy the viewer ships is the copy that was agreed', () => {
  // The one thing in this viewer that is not a decision about code. Every
  // visible string is agreed away from the keyboard and transcribed once, and
  // this is the transcription being checked rather than trusted.
  //
  // The literals below are this test's own, written from the agreed text with
  // every character outside ASCII spelled as an escape — so a dash that is the
  // wrong dash, or an apostrophe that is the wrong apostrophe, is a failure
  // here rather than something a reader would have to notice on a screen. They
  // are not read from `copy.js` and that file is never imported: a check that
  // takes its expectation from the thing it is checking passes whatever that
  // thing says.
  //
  // What is compared is the file's own text. Every string in `copy.js` is
  // written between backticks, which is what makes that possible: a quoted
  // string carrying an apostrophe has to escape it, and the bytes in the file
  // would then stop being the bytes on the page.
  const copySource = readFileSync(join(SITE_JS, 'copy.js'), 'utf8');
  const indexSource = readFileSync(fileURLToPath(new URL('../../site/index.html', import.meta.url)), 'utf8');

  /** The title, which is part of the page rather than something drawn into it. */
  const title = 'Shared note \u2014 PatientScribe';

  /** Every string `copy.js` carries, in the order the surfaces use them. */
  const agreed = [
    'PatientScribe',
    'Someone has shared a PatientScribe note with you.',
    'They\'ll have given you a code \u2014 usually over the phone.',
    'Code',
    'Open the note',
    'That code didn\'t match. Check it with the person who shared this.',
    'This shared note is no longer available. If you were expecting it, ask the person who shared it.',
    '\'You\' means ',
    'Edited by ',
    'Edited by the sharer',
    'This link works until ',
    'PatientScribe is free on the App Store',
    'This app\'s built-in browser can\'t open shared notes safely. Tap \u22ef and choose ',
    'Open in Safari',
    ' (or Chrome).',
    'Report a problem with this link',
    'For people viewing a shared note.',
    'This page shows you an encrypted note shared with you through PatientScribe. PatientScribe (DigiFrontiers) cannot decrypt stored share content under our normal, published viewer protocol \u2014 and we cannot verify who opens a share: anyone with both the link and the code can open it. When you open this page we handle your IP address and basic request data, kept briefly (up to 30 days) only to limit abuse and keep the service working; the access code you type is sent to us only to check it and is not kept (without it we can\'t show you the note); and each share link keeps a simple code-entry attempt counter while it exists \u2014 we use none of this for analytics, advertising, or profiling, we don\'t set cookies, and nothing here is used to track you across other sites or pages. Questions: support@patientscribe.com.au. Full policy: ',
    'patientscribe.com.au/privacy-policy',
    '.',
  ];

  for (const text of agreed) {
    assert.equal(
      copySource.split(`\`${text}\``).length - 1,
      1,
      `${JSON.stringify(text)} is not written exactly once in copy.js as a string of its own`,
    );
  }
  assert.ok(copySource.includes('Object.freeze('), 'the copy table is no longer frozen');

  // And the other direction, which is the one that matters for the banner: the
  // strings in that file are exactly these and nothing else. A string it carried
  // that is not on this list is a visible surface nobody agreed to — and the
  // banner is the case that makes the point, because a constant there would be a
  // second spelling of wording that travels inside the encrypted document, and a
  // fallback the viewer could show in its place.
  //
  // Read with the comments taken out first, because the prose in that file uses
  // backticks the way this repository's prose does. None of the agreed strings
  // carries either comment opener, so removing them cannot remove part of one.
  const withoutComments = copySource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const literals = [...withoutComments.matchAll(/`([^`]*)`/g)].map((found) => found[1]);
  assert.deepEqual(literals, agreed, 'copy.js carries a string that was not agreed, or has lost one that was');

  // And the two sentences that are split around something that is not text: the
  // advisory around the words it emphasises, and the notice around the link to
  // the policy. Each is held as one whole sentence here as well as in pieces, so
  // a split moved by a space — or a piece dropped — is a failure against the
  // sentence rather than only against the fragments.
  const [
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    ,
    advisoryLead,
    advisoryEmphasis,
    advisoryTail,
    ,
    noticeSummary,
    noticeLead,
    policyLinkText,
    noticeTail,
  ] = agreed;
  assert.equal(
    `${advisoryLead}${advisoryEmphasis}${advisoryTail}`,
    'This app\'s built-in browser can\'t open shared notes safely. Tap \u22ef and choose Open in Safari (or Chrome).',
    'the advisory\'s pieces no longer make the sentence they are a split of',
  );
  assert.equal(
    `${noticeSummary} ${noticeLead}${policyLinkText}${noticeTail}`,
    'For people viewing a shared note. This page shows you an encrypted note shared with you through PatientScribe. PatientScribe (DigiFrontiers) cannot decrypt stored share content under our normal, published viewer protocol \u2014 and we cannot verify who opens a share: anyone with both the link and the code can open it. When you open this page we handle your IP address and basic request data, kept briefly (up to 30 days) only to limit abuse and keep the service working; the access code you type is sent to us only to check it and is not kept (without it we can\'t show you the note); and each share link keeps a simple code-entry attempt counter while it exists \u2014 we use none of this for analytics, advertising, or profiling, we don\'t set cookies, and nothing here is used to track you across other sites or pages. Questions: support@patientscribe.com.au. Full policy: patientscribe.com.au/privacy-policy.',
    'the notice\'s pieces no longer make the notice they are a split of',
  );

  // The three strings that are not in `copy.js`, audited where they are. The
  // title belongs to the page; the two destinations are attributes, because a
  // destination written into the markup is a destination no code assigns.
  assert.equal(
    indexSource.split(`<title>${title}</title>`).length - 1,
    1,
    'the page does not carry the agreed title exactly once',
  );
  for (const href of [
    'href="https://apps.apple.com/au/app/id6758035505"',
    'href="https://patientscribe.com.au/privacy-policy"',
  ]) {
    assert.equal(indexSource.split(href).length - 1, 1, `${href} is not written exactly once in the page`);
  }

  // What must appear nowhere. The claim about decryption is made once, in the
  // notice, in exactly the words above — scoped to stored share content, under
  // the published protocol. Every spelling below is a stronger claim than the
  // design supports, and the cost of one of them appearing anywhere in the
  // served tree is that a recipient is told something untrue about what this
  // service can see.
  /** @type {string[]} */
  const served = [];
  /** @param {string} directory */
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        served.push(full);
      }
    }
  };
  walk(fileURLToPath(new URL('../../site/', import.meta.url)));
  assert.ok(served.length >= 3, 'the served tree has nothing in it, so this reading shows nothing');

  for (const file of served) {
    const text = readFileSync(file, 'utf8').toLowerCase();
    for (const stronger of ['cannot read', 'cannot see', 'cannot access', 'end-to-end encrypted', 'end to end encrypted']) {
      assert.ok(!text.includes(stronger), `${file} claims ${JSON.stringify(stronger)}, which is stronger than the notice`);
    }
  }

  // And the banner, over the whole served tree rather than over the one file the
  // exact list above covers.
  for (const fixture of vectors.fixtures) {
    const wording = JSON.parse(fixture.inputs.plaintext).banner_text;
    for (const file of served) {
      assert.ok(
        !readFileSync(file, 'utf8').includes(wording),
        `${file} carries a banner's wording, which belongs to the document rather than to this viewer`,
      );
    }
  }
});

test('the stylesheet the viewer ships is the stylesheet that was reviewed', () => {
  // The one served file that is pinned whole, and the reason is what a
  // stylesheet can do that no other served file can.
  //
  // Everything else about what a recipient reads is held by reading what the
  // page says: the copy oracle above reads the strings out of the file they live
  // in, and the browser suite reads the notice out of the elements it is written
  // into. Both of those read text — the text of a source file, and the text a
  // document holds — and a stylesheet changes what a page says without either of
  // them moving. A generated-content declaration on a pseudo-element writes a
  // sentence into a surface, and no node, no text node and no string constant
  // changes; a display or a sizing declaration takes a whole surface off the
  // screen while every character of it is still in the document, and a reading of
  // the document's text sees exactly what it saw before. Measured, in both
  // engines: a sentence added to the privacy notice this way, and the notice
  // erased this way, both go straight past every reading of the text.
  //
  // The second of those is why this is the file's bytes rather than a scan for a
  // property name. A scan can be written for the declaration that adds a
  // sentence, and there is one — `stylesheet-content` in the forbidden-sink
  // rules, which is where a second stylesheet would meet it. The declarations
  // that take something off the screen are not a list anybody finishes: a size, a
  // colour, a position, an opacity, an overflow, a clip, and the next property
  // the platform adds. Enumerating them is the same losing game as enumerating
  // the characters that end a URL.
  //
  // So the whole file is one value, and changing a byte of it is a deliberate act
  // that updates this line. That is the whole of what this asserts: not that the
  // stylesheet is correct, and not that the notice is intact — the pins on the
  // notice's own text say that — but that the bytes being served are the bytes
  // that were read.
  //
  // Read as bytes rather than as text, because a line ending is a byte and this
  // is a claim about the file rather than about its lines.
  const stylesheet = readFileSync(fileURLToPath(new URL('../../site/css/viewer.css', import.meta.url)));
  assert.equal(
    createHash('sha256').update(stylesheet).digest('hex'),
    'd16b68a1d972f2da8627a9cc91cc610c6e437edbfe786c6dbe9aecbe78d445e6',
    'the served stylesheet is not the one this pin was computed from — if the change was deliberate, ' +
      'the new value goes here in the same change that makes it',
  );
});

test('the expiry formatter writes one pattern, in whatever timezone the reader is in', async () => {
  // Fixed moments in fixed timezones, against strings written out here. The
  // formatter writes its own month and weekday names rather than asking the
  // platform, precisely so that this table is a claim about the viewer instead
  // of a claim about the internationalisation data an engine was built with —
  // and a table read from the formatter would agree with it whatever it said.
  //
  // The zones are chosen for what they put to the arithmetic: one at the
  // meridian, one that crosses a day boundary in each direction, one at a
  // half-hour offset and one at three quarters of an hour. The moments are
  // chosen for the pattern: midnight and noon, which are both twelve; a minute
  // under ten, which is the one that is padded; and the moment the agreed
  // pattern is illustrated with.
  //
  // Run in a child process per zone, because a timezone is a property of the
  // process rather than an argument to the call.
  /** @type {[string, number, string][]} */
  const expected = [
    ['UTC', 1767225600, 'Thu 1 Jan, 12:00 am'],
    ['UTC', 1767268800, 'Thu 1 Jan, 12:00 pm'],
    ['UTC', 1767225900, 'Thu 1 Jan, 12:05 am'],
    ['UTC', 1752567120, 'Tue 15 Jul, 8:12 am'],
    ['Australia/Sydney', 1767225600, 'Thu 1 Jan, 11:00 am'],
    ['Australia/Sydney', 1767268800, 'Thu 1 Jan, 11:00 pm'],
    ['Australia/Sydney', 1767225900, 'Thu 1 Jan, 11:05 am'],
    ['Australia/Sydney', 1752567120, 'Tue 15 Jul, 6:12 pm'],
    ['America/New_York', 1767225600, 'Wed 31 Dec, 7:00 pm'],
    ['America/New_York', 1767268800, 'Thu 1 Jan, 7:00 am'],
    ['America/New_York', 1767225900, 'Wed 31 Dec, 7:05 pm'],
    ['America/New_York', 1752567120, 'Tue 15 Jul, 4:12 am'],
    ['Asia/Kolkata', 1767225600, 'Thu 1 Jan, 5:30 am'],
    ['Asia/Kolkata', 1767268800, 'Thu 1 Jan, 5:30 pm'],
    ['Asia/Kolkata', 1767225900, 'Thu 1 Jan, 5:35 am'],
    ['Asia/Kolkata', 1752567120, 'Tue 15 Jul, 1:42 pm'],
    ['Pacific/Chatham', 1767225600, 'Thu 1 Jan, 1:45 pm'],
    ['Pacific/Chatham', 1767268800, 'Fri 2 Jan, 1:45 am'],
    ['Pacific/Chatham', 1767225900, 'Thu 1 Jan, 1:50 pm'],
    ['Pacific/Chatham', 1752567120, 'Tue 15 Jul, 8:57 pm'],
  ];

  /** @type {Map<string, number[]>} */
  const asked = new Map();
  for (const [zone, epoch] of expected) {
    asked.set(zone, [...(asked.get(zone) ?? []), epoch]);
  }

  const program = [
    `import { formatDateTime } from ${JSON.stringify(new URL('../../site/js/format.js', import.meta.url).href)};`,
    'const moments = JSON.parse(process.argv[1]);',
    'process.stdout.write(JSON.stringify(moments.map((one) => formatDateTime(one))));',
  ].join('\n');

  for (const [zone, moments] of asked) {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', program, JSON.stringify(moments)], {
      encoding: 'utf8',
      env: { ...process.env, TZ: zone },
    });
    assert.equal(run.status, 0, `${zone}: ${run.stderr}`);
    const written = JSON.parse(run.stdout);
    moments.forEach((moment, index) => {
      const wanted = expected.find(([one, two]) => one === zone && two === moment)?.[2];
      assert.equal(written[index], wanted, `${zone} at ${moment}`);
    });
  }

  // And everything that is not a moment, which is the empty string rather than a
  // date built out of nothing. A lead with nothing after it says less; a lead
  // followed by a date nobody sealed says something wrong.
  for (const notAMoment of [1.5, Number.NaN, Number.MAX_SAFE_INTEGER, -1e15, 'x', null, undefined, {}]) {
    assert.equal(formatDateTime(notAMoment), '', `${String(notAMoment)} was formatted as a moment`);
  }
});

test('the encoder and the strict decoder are inverses', () => {
  // The identifier comparison is a comparison of encoded spellings, and it is
  // only a comparison of bytes while the two directions agree. Every identifier
  // the vectors publish goes both ways: the published spelling decodes and
  // encodes back to itself, and the bytes it decodes to encode and decode back
  // to themselves.
  const published = [
    ...vectors.fixtures.map((/** @type {any} */ one) => one.inputs.id),
    ...vectors.derivations.map((/** @type {any} */ one) => one.inputs.id),
    ...vectors.mismatches.map((/** @type {any} */ one) => one.inputs.id),
    ...vectors.mismatches.map((/** @type {any} */ one) => one.inputs.aad_id),
    vectors.capability.id,
  ];
  assert.ok(published.length >= 14, 'there are not enough published identifiers for this to be a reading');

  for (const spelling of published) {
    const bytes = decodeBase64url(spelling);
    assert.ok(bytes !== null, `${spelling} is not a canonical encoding`);
    assert.equal(encodeBase64url(bytes), spelling, `${spelling} does not encode back to itself`);
    const again = decodeBase64url(encodeBase64url(bytes));
    assert.deepEqual(Array.from(again ?? []), Array.from(bytes), `${spelling} does not decode back to its own bytes`);
  }

  // And every length the encoder can be handed, over bytes that are not an
  // identifier: the remainder decides how many characters the last group writes,
  // and the unused low bits of the final character have to be zero or the strict
  // decoder refuses what this produced.
  for (let length = 0; length <= 64; length += 1) {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = (index * 37 + 11) % 256;
    }
    const spelling = encodeBase64url(bytes);
    assert.equal(spelling.length % 4 === 1, false, `an encoding of ${length} byte(s) is a length no decoder admits`);
    const back = decodeBase64url(spelling);
    assert.deepEqual(Array.from(back ?? []), Array.from(bytes), `${length} byte(s) did not survive the round trip`);
  }

  // And anything that is not bytes at all, which is the empty string — a value
  // no identifier encodes to, and so a value that matches nothing.
  for (const notBytes of [null, undefined, 'AAA', [1, 2, 3], new Uint16Array(4), {}]) {
    assert.equal(encodeBase64url(notBytes), '', `${String(notBytes)} was encoded as though it were bytes`);
  }
});

test('the capability probe the viewer ships is the one the generator published', () => {
  // The probe decides whether a recipient is told their browser cannot do this
  // or told their share is unavailable, so it has to be a share somebody else
  // sealed. Shipped as constants, because it runs before anything is fetched;
  // compared here against the vector file, because constants a viewer generated
  // for itself would be a check on this code by this code.
  assert.deepEqual(
    { ...CAPABILITY_PROBE },
    { ...vectors.capability },
    'the probe in the viewer is not the probe the generator emitted',
  );
  assert.ok(Object.isFrozen(CAPABILITY_PROBE));

  // And what makes it a probe rather than a formality: it authenticates
  // something. A probe sealed over an empty string would open identically
  // whether the additional data reached the tag or not.
  assert.ok(vectors.capability.aad.length > 0, 'the probe authenticates nothing');
  assert.ok(vectors.capability.plaintext.length > 0, 'the probe carries no plaintext to compare');
  assert.notEqual(vectors.capability.aad, vectors.capability.plaintext);
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

  // And each of those is the one spelling of its bytes, which the lengths above
  // do not say and the derivation witness below cannot.
  //
  // Everything that reads these values decodes them first, and the decoder is
  // lenient: it takes either alphabet, ignores padding, and ignores the unused
  // low bits of the last character. So a published input rewritten into a
  // different string that decodes to the same bytes passes every derivation
  // check there is. What that would move is not the cryptography but the
  // confinement scan, which watches these as literal strings — it would go on
  // watching for a spelling no longer published, and key material could then
  // appear in a report with nothing looking for it.
  //
  // Re-encoding is the whole test: a value that is already canonical unpadded
  // base64url survives the round trip unchanged, and every other spelling of the
  // same bytes does not.
  //
  // The derivations as well as the fixtures. Those carry the same three inputs
  // and are read the same way — decoded, derived from, compared as bytes — and
  // the corpus does not decrypt with them, so a re-spelling there disturbs even
  // less than one in a fixture does.
  for (const record of [...vectors.fixtures, ...vectors.derivations]) {
    for (const field of ['a', 'b', 'id']) {
      const published = record.inputs[field];
      assert.equal(
        Buffer.from(published, 'base64url').toString('base64url'),
        published,
        `${record.name}: inputs.${field} is not the canonical spelling of its own bytes, so what the confinement scan watches for is not what is published`,
      );
    }
  }
});

test('every published derived key is the one its published inputs derive', async () => {
  // The `derived.kek` values had no witness. Nothing in the corpus compares
  // against them — the viewer derives its own key and hands back a key object,
  // never bytes — so a wrong one is not a wrong decryption. What they are used
  // for is the confinement scan: each is watched as a value that must never
  // appear in anything the viewer reports, and the floor on that scan counts
  // distinct strings rather than correct ones. So changing one of them by a
  // character left every count clear while the scan watched for a string no
  // derivation produces, which is a scan one secret smaller than it says.
  //
  // That is a claim about every value the scan watches, and the derived key was
  // only one of them. The content keys are watched the same way and were in the
  // same position: `derivation.probe.k` is compared against by nothing at all —
  // the corpus hands the viewer the wrapped form and asks whether it unwraps,
  // never what it unwrapped to — and `fixture.inputs.k` is compared against only
  // where a case reseals a document under it, which is a handful of cases and
  // not a statement about the published value. Both are re-derivable from what
  // is published beside them, so both are re-derived below rather than left as
  // strings the scan watches and nothing checks.
  //
  // Re-derived here from the inputs published beside them, by a derivation
  // written out in this file: not imported from the viewer, which is the thing
  // these vectors exist to be independent of, and not read out of the vector
  // file's own description of itself, which would agree with whatever it said.
  const info = 'patientscribe/link_split_v1/kek';
  const outputBytes = 32;

  /**
   * @param {string} a The link capability, unpadded base64url.
   * @param {string} b The stored key, unpadded base64url.
   * @param {string} id The share identifier, unpadded base64url.
   * @returns {Promise<string>}
   */
  const kekFrom = async (a, b, id) => {
    const ikm = Buffer.concat([Buffer.from(a, 'base64url'), Buffer.from(b, 'base64url')]);
    const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: Buffer.from(id, 'base64url'),
        info: new TextEncoder().encode(info),
      },
      base,
      outputBytes * 8,
    );
    return Buffer.from(bits).toString('base64url');
  };

  /**
   * The content key a wrapped one carries, read back under the key that wrapped
   * it.
   *
   * The wire layout the vectors publish for themselves — nonce, then ciphertext
   * and tag — and no additional authenticated data, which is what the scheme
   * note says of this one encryption and is a claim of its own: written with an
   * AAD, this refuses. Spelled out here rather than imported from the viewer,
   * for the reason the derivation above is.
   *
   * @param {string} kek Unpadded base64url.
   * @param {string} wrapped Unpadded base64url of nonce || ciphertext || tag.
   * @returns {Promise<string>} The unwrapped key, unpadded base64url.
   */
  const unwrapped = async (kek, wrapped) => {
    const key = await crypto.subtle.importKey('raw', Buffer.from(kek, 'base64url'), 'AES-GCM', false, ['decrypt']);
    const bytes = Buffer.from(wrapped, 'base64url');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
    return Buffer.from(plain).toString('base64url');
  };

  for (const fixture of vectors.fixtures) {
    assert.equal(
      await kekFrom(fixture.inputs.a, fixture.inputs.b, fixture.inputs.id),
      fixture.derived.kek,
      fixture.name,
    );

    // And the content key, which the scan watches and which the derivation above
    // says nothing about. Unwrapped from what is published beside it, so a
    // published key changed by a character is a key the published wrapping does
    // not hold rather than a string the scan is watching for no reason.
    assert.equal(
      await unwrapped(fixture.derived.kek, fixture.outputs.wrapped_k),
      fixture.inputs.k,
      `${fixture.name}: the published content key is not the one the published wrapping carries`,
    );
    // And the nonce it was wrapped under, which is published as its own value
    // and is the first twelve bytes of that wrapping — one fact written in two
    // places, and neither of them derived from the other here.
    assert.equal(
      Buffer.from(fixture.outputs.wrapped_k, 'base64url').subarray(0, 12).toString('base64url'),
      fixture.inputs.wrap_nonce,
      `${fixture.name}: the published wrapping nonce is not the one the wrapping begins with`,
    );
    assert.equal(
      Buffer.from(fixture.outputs.ciphertext, 'base64url').subarray(0, 12).toString('base64url'),
      fixture.inputs.content_nonce,
      `${fixture.name}: the published content nonce is not the one the ciphertext begins with`,
    );
  }
  for (const derivation of vectors.derivations) {
    assert.equal(
      await kekFrom(derivation.inputs.a, derivation.inputs.b, derivation.inputs.id),
      derivation.derived.kek,
      derivation.name,
    );
    // And the parameters each derivation record publishes as its own, which is
    // what an implementer of the other side would build against. The derivation
    // above names them itself rather than reading them from here, so this is two
    // statements agreeing rather than one taken from the other.
    assert.equal(derivation.inputs.info, info, derivation.name);
    assert.equal(derivation.inputs.output_bytes, outputBytes, derivation.name);

    // And the probe, which is watched by the confinement scan exactly as the
    // derived key is and which nothing anywhere compares against: the corpus
    // hands the viewer `probe.wrapped_k` and asks whether it unwraps, and never
    // asks what it unwrapped to. So a probe key changed by a character was a
    // secret the scan watched for that no wrapping here carries, with every
    // count still clear — the same hole the derived key had, one field over.
    assert.equal(
      await unwrapped(derivation.derived.kek, derivation.probe.wrapped_k),
      derivation.probe.k,
      `${derivation.name}: the published probe key is not the one the published wrapping carries`,
    );
    assert.equal(
      Buffer.from(derivation.probe.wrapped_k, 'base64url').subarray(0, 12).toString('base64url'),
      derivation.probe.nonce,
      `${derivation.name}: the published probe nonce is not the one its wrapping begins with`,
    );
  }

  // And the note at the top of the file, which is the only place the derivation
  // is written out in prose. A note that no longer describes the records under
  // it is a conformance target saying one thing and publishing another.
  assert.ok(vectors.scheme.kek.includes('HKDF-SHA-256'), 'the published scheme no longer names the derivation');
  assert.ok(vectors.scheme.kek.includes(`"${info}"`), 'the published scheme no longer names the derivation context');
  assert.ok(
    vectors.scheme.wrapped_k.includes('AES-256-GCM'),
    'the published scheme no longer names how a content key is wrapped',
  );

  // And both witnesses are shown to refuse, so a clean answer is an answer
  // rather than a comparison nothing could fail.
  const [first] = vectors.fixtures;
  const salt = Buffer.from(first.inputs.id, 'base64url');
  salt[0] = ((salt[0] ?? 0) ^ 1) & 0xff;
  assert.notEqual(
    await kekFrom(first.inputs.a, first.inputs.b, salt.toString('base64url')),
    first.derived.kek,
    'the witness derived the published key from a salt that is not the published one',
  );

  // The unwrap refuses by throwing rather than by answering something else,
  // which is what a tag is for — so this is the assertion that the second
  // witness is reading the wrapping and not reading past it. One bit of the
  // key it is opened under.
  const wrongKek = Buffer.from(first.derived.kek, 'base64url');
  wrongKek[0] = ((wrongKek[0] ?? 0) ^ 1) & 0xff;
  await assert.rejects(
    () => unwrapped(wrongKek.toString('base64url'), first.outputs.wrapped_k),
    'the witness opened a published wrapping under a key that is not the one it was wrapped with',
  );
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
