/**
 * What holds the release check's frozen core in place.
 *
 * The core is a set of pure modules that decide what a release must look like.
 * Everything else in the check — the socket client, the browser driver, the
 * command line, the fixture origin — is replaceable, and is expected to be
 * replaced as the deploy it measures changes. The core is not, and the
 * difference between the two is not a comment: it is this file.
 *
 * Four things are asked, and none of them is asked by the suite that replays the
 * fixtures. That separation is the point. A corpus is judged by the runner that
 * runs it, so a corpus that has lost half its cases and a runner that has
 * stopped comparing look identical from inside either one; these questions are
 * asked from a step of their own, about files rather than about runs.
 *
 * - Every artifact of the core digests to what was recorded for it, and the
 *   recorded list names exactly the artifacts that are there. Either half alone
 *   is defeated by the other's absence: a digest list that names a file which is
 *   no longer there passes if nothing checks the directory, and a directory
 *   check passes over files whose contents have changed.
 *
 * - The core imports nothing but itself and one named exception. A core that can
 *   read a file is a core whose expectations can come from the thing it is
 *   checking; a core that can open a socket is a core that can be told what it
 *   wants to hear. `node:crypto` is the exception, in `digest.mjs`, and it is
 *   named here as well as there so that the exception cannot grow quietly.
 *
 * - The arrangement runs one way. Adapters import the core; the core imports no
 *   adapter and no fixture. Written the other way round, "frozen core" and
 *   "replaceable adapter" are two words for one directory.
 *
 * - The corpus covers the roster. Every predicate the core can refuse under is
 *   exercised by at least one fixture, or is one of the two that only a browser
 *   can drive — and those two are required to appear in the browser suite by
 *   name. A predicate with no fixture is a predicate nobody has seen refuse
 *   anything, which is the state every check in this repository is written to
 *   avoid being in.
 *
 * Exit codes: 0 = all four hold, 1 = one does not.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { planRequests } from './release-check-core/requests.mjs';
import { PREDICATES } from './release-check-core/verdict.mjs';
import { FIXTURES } from '../test/release-fixtures/corpus.mjs';

const CORE_DIRECTORY = fileURLToPath(new URL('./release-check-core/', import.meta.url));
const ADAPTER_DIRECTORY = fileURLToPath(new URL('./release-check-adapters/', import.meta.url));
const DIGEST_FILE = join(CORE_DIRECTORY, 'digests.txt');
const BROWSER_SUITE = fileURLToPath(new URL('../test/release.spec.js', import.meta.url));

/**
 * The one host module a core artifact may import, and the artifact that may
 * import it.
 *
 * A pair rather than a list of allowed modules, because what makes this
 * admissible is which module needs it and why — see `digest.mjs`. A second
 * artifact reaching for the same import would be a different decision.
 */
const PERMITTED_HOST_IMPORT = Object.freeze({ artifact: 'digest.mjs', module: 'node:crypto' });

/**
 * The predicates no socket can drive.
 *
 * A cookie the browser was already holding, and a jar with something in it after
 * the page finished: neither is a property of a response, so neither has a
 * fixture in the replayed corpus. They are required to be driven by the browser
 * suite instead, and required by name — a count of browser tests says nothing
 * about which ones ran.
 *
 * @type {readonly string[]}
 */
const BROWSER_MEASURED = Object.freeze([PREDICATES.COOKIE_REQUEST, PREDICATES.COOKIE_JAR]);

/**
 * Every arm the request matrix issues, written out.
 *
 * The matrix is fixed by the requirements, so what it contains is a thing to be
 * compared against a list rather than read off the function that builds it. A
 * function compared against itself agrees after an arm is deleted from it, and
 * an arm deleted from the matrix is a set of assertions that all still pass.
 *
 * @type {readonly string[]}
 */
const EXPECTED_ARMS = Object.freeze([
  'alias-br',
  'alias-conditional',
  'alias-gzip',
  'alias-identity',
  'object-bare-query',
  'object-br',
  'object-conditional',
  'object-gzip',
  'object-identity',
  'probe-absent-asset',
  'probe-asset-query',
  'probe-document-miss',
]);

/** @type {string[]} */
const failures = [];

/**
 * Every import specifier a module names, in every form the language has.
 *
 * A scan rather than a parse: the specifiers are string literals in `import` and
 * `export` statements, and what is being asked is which strings appear there. A
 * parser would be a second thing that has to be as good as the loader.
 *
 * Every form, and that is the part worth stating. A scan that reads only the
 * form the code happens to use today is a scan whose answer is "nothing found"
 * for an import written any other way — and "nothing found" is exactly what a
 * pure module looks like. So the quoting is either quote, the statement is
 * `import` in all three of its shapes and `export … from`, and the dynamic form
 * is included as well: a core artifact that reached for the filesystem at the
 * moment it needed it would be reaching through `import(`.
 *
 * And a comment stands wherever whitespace stands. `import/*…*\/'x'` is an
 * import, and so is `import x from/*…*\/'x'`, and a scan that requires a space
 * where the language requires only a separator is a scan with a seam in it —
 * one a module could be made pure-looking through by writing a comment. So what
 * separates the parts of these statements is spelled as whitespace or a comment
 * rather than as whitespace, in every position where one may stand.
 *
 * @param {string} source
 * @returns {string[]}
 */
function importsOf(source) {
  /** @type {string[]} */
  const found = [];
  /** @param {RegExp} pattern */
  const collect = (pattern) => {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1] ?? match[2];
      if (specifier !== undefined) {
        found.push(specifier);
      }
    }
  };
  // What may stand between the parts of an import statement: whitespace, a
  // bracketed comment, or a comment that runs to the end of its line. The
  // bracketed one is written as "anything that is not the close, then the
  // close" rather than as a shortest-match: a shortest-match can be made to
  // stretch by backtracking, and a comment that stretches across the statement
  // after it swallows the import that was going to be found there.
  const gap = String.raw`(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/[^\n]*\n)`;
  const quoted = String.raw`(?:'([^']+)'|"([^"]+)")`;
  // Where the grammar separates two tokens by punctuation, nothing has to stand
  // between them at all: `import{x}from'y'` is the same statement as
  // `import { x } from 'y'`, and a scan that requires a separator where the
  // language does not is a scan an import can be written past. So the gaps below
  // are optional, and what keeps the keyword a keyword is that nothing may follow
  // it that would make it the front of a longer name — `imports` and `exporting`
  // are words, and a scan that read them as statements would report a specifier
  // no module imports.
  const keyword = String.raw`(?![$\w])`;
  // Where a statement may begin: the start of the source, the start of a line, or
  // straight after the semicolon that ended the statement before it. The last of
  // those is the one a scan written around lines does not have — a file may put
  // two statements on one line, and `import './a.mjs';import 'node:fs';` is two
  // imports of which such a scan reports one. It is still an anchor rather than
  // no anchor: the word has to be where a statement can start, so the one inside
  // a comment or a sentence is not read as a statement.
  const statement = String.raw`(?:^|\n|;)`;
  // `import … from 'x'` and `export … from 'x'`, in either quote.
  collect(new RegExp(String.raw`${statement}[ \t]*(?:import|export)${keyword}${gap}*[^;]*?from${gap}*${quoted}`, 'g'));
  // `import 'x'` — the side-effect form, which names no binding and is the one a
  // pattern written around `from` does not see at all.
  collect(new RegExp(String.raw`${statement}[ \t]*import${keyword}${gap}*${quoted}`, 'g'));
  // `import('x')` — the dynamic form, which can appear anywhere an expression
  // can and is therefore not anchored to the start of a line.
  collect(new RegExp(String.raw`\bimport${keyword}${gap}*\(${gap}*${quoted}`, 'g'));
  return found;
}

/**
 * A module written to carry every import form, and what a reading of it must
 * find.
 *
 * The scan above is the whole of what says a core artifact stayed pure, and a
 * scan that silently sees nothing is indistinguishable from a scan that
 * correctly found nothing. So it is run first against a source that names one
 * specifier in each form, and a form that comes back missing stops the check
 * before any conclusion is drawn from it.
 *
 * Each seam a comment may stand in gets its own specimen, and they are separate
 * specimens rather than one statement carrying several: a source that put every
 * seam in one line would be a source one surviving pattern could match whole,
 * and each of these is a position a scan can lose on its own.
 *
 * The compact forms are specimens for the same reason and are the ones a scan
 * loses most quietly. Where the grammar separates two tokens by punctuation,
 * nothing has to stand between them: `import{x}from'y'` is a statement a
 * minifier writes and a scan expecting a space reads as nothing at all. The
 * mid-line pair is the same loss in the other axis: two statements on one line
 * are two statements, and a scan anchored to the start of a line reads the
 * second of them as part of the first — which is a specifier that does not
 * appear in the answer at all.
 *
 * And two lines that are not statements, which the scan must not read as ones.
 * `imports` and `exporting` are ordinary words, and reading a keyword out of the
 * front of one produces a specifier no module imports — a purity failure about
 * nothing, which is the way this check fails that nobody can act on. They are
 * near-misses rather than code: each is exactly the shape the reading has to
 * refuse.
 *
 * @type {{ source: string, expected: readonly string[], refused: readonly string[] }}
 */
const IMPORT_FORMS = {
  source: [
    "import single from './single.mjs';",
    'import double from "./double.mjs";',
    "import './side-effect.mjs';",
    'import "./side-effect-double.mjs";',
    "export { one } from './re-export.mjs';",
    'export * from "./re-export-double.mjs";',
    "const later = await import('./dynamic.mjs');",
    'const alsoLater = await import("./dynamic-double.mjs");',
    "import/* a comment stands where a space may */'./seam-after-import.mjs';",
    "import seam from/* here too */'./seam-after-from.mjs';",
    "export { seam } from/* and here */'./seam-after-export-from.mjs';",
    "export/* and here */{ seamed } from './seam-after-export.mjs';",
    "const seamLater = await import/* and here */('./seam-before-paren.mjs');",
    "import{compact}from'./compact-named.mjs';",
    "export*from'./compact-star.mjs';",
    "export{compacted}from'./compact-export.mjs';",
    "import'./compact-side-effect.mjs';",
    "import head from './mid-line-head.mjs';import tail from './mid-line-from.mjs';",
    "import './mid-line-head-side-effect.mjs';import'./mid-line-side-effect.mjs';",
    "imports from './not-an-import.mjs';",
    "exporting { all } from './also-not-an-import.mjs';",
  ].join('\n'),
  expected: Object.freeze([
    './single.mjs',
    './double.mjs',
    './side-effect.mjs',
    './side-effect-double.mjs',
    './re-export.mjs',
    './re-export-double.mjs',
    './dynamic.mjs',
    './dynamic-double.mjs',
    './seam-after-import.mjs',
    './seam-after-from.mjs',
    './seam-after-export-from.mjs',
    './seam-after-export.mjs',
    './seam-before-paren.mjs',
    './compact-named.mjs',
    './compact-star.mjs',
    './compact-export.mjs',
    './compact-side-effect.mjs',
    './mid-line-head.mjs',
    './mid-line-from.mjs',
    './mid-line-head-side-effect.mjs',
    './mid-line-side-effect.mjs',
  ]),
  refused: Object.freeze(['./not-an-import.mjs', './also-not-an-import.mjs']),
};

// The scan, before anything is concluded from it. Both directions: a form it
// cannot see is a purity result that means nothing, and a line it reads a
// statement out of is a purity failure about a module that imports nothing.
const seenForms = importsOf(IMPORT_FORMS.source);
for (const specifier of IMPORT_FORMS.expected) {
  if (!seenForms.includes(specifier)) {
    failures.push(
      `the import scan did not see ${specifier} in the module written to carry every form, so a purity result from it would mean nothing`,
    );
  }
}
for (const specifier of IMPORT_FORMS.refused) {
  if (seenForms.includes(specifier)) {
    failures.push(
      `the import scan read ${specifier} out of a line that is not an import statement, so it would name specifiers no module imports`,
    );
  }
}

// The artifacts, and the record of them.
const onDisk = readdirSync(CORE_DIRECTORY)
  .filter((name) => name.endsWith('.mjs'))
  .sort();

/** @type {Map<string, string>} */
const recorded = new Map();
try {
  for (const line of readFileSync(DIGEST_FILE, 'utf8').split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }
    const [digest, name] = line.split(/\s+/);
    if (digest === undefined || name === undefined) {
      failures.push(`the recorded digests carry a line that is not one: ${JSON.stringify(line)}`);
      continue;
    }
    recorded.set(name, digest);
  }
} catch (error) {
  failures.push(`the recorded digests could not be read: ${error instanceof Error ? error.message : 'unknown'}`);
}

if ([...recorded.keys()].sort().join(',') !== onDisk.join(',')) {
  failures.push(
    `the recorded digests name [${[...recorded.keys()].sort().join(', ')}] and the core is [${onDisk.join(', ')}]`,
  );
}

for (const name of onDisk) {
  const source = readFileSync(join(CORE_DIRECTORY, name));
  const digest = createHash('sha256').update(source).digest('hex');
  const was = recorded.get(name);
  if (was === undefined) {
    continue;
  }
  if (was !== digest) {
    failures.push(`${name} digests to ${digest} and what was recorded for it is ${was}`);
  }
}

// Purity, and the direction of the arrangement.
for (const name of onDisk) {
  const source = readFileSync(join(CORE_DIRECTORY, name), 'utf8');
  for (const specifier of importsOf(source)) {
    if (specifier.startsWith('./') && onDisk.includes(specifier.slice(2))) {
      continue;
    }
    if (name === PERMITTED_HOST_IMPORT.artifact && specifier === PERMITTED_HOST_IMPORT.module) {
      continue;
    }
    failures.push(
      `${name} imports ${specifier}, and a core artifact imports its siblings and nothing else — the one exception is ${PERMITTED_HOST_IMPORT.module} in ${PERMITTED_HOST_IMPORT.artifact}`,
    );
  }
  if (source.includes('release-check-adapters') || source.includes('release-fixtures')) {
    failures.push(`${name} names an adapter or a fixture, and the core is what those import rather than the other way round`);
  }
}

const adapters = readdirSync(ADAPTER_DIRECTORY)
  .filter((name) => name.endsWith('.mjs'))
  .sort();
if (adapters.length === 0) {
  failures.push('there are no adapters, so nothing shows the core is reached from outside itself');
}
if (
  !adapters.some((name) => importsOf(readFileSync(join(ADAPTER_DIRECTORY, name), 'utf8')).some((one) => one.includes('release-check-core')))
) {
  failures.push('no adapter imports the core, so the boundary this file is about is not the boundary the code has');
}

// The corpus against the roster.
/** @type {Set<string>} */
const exercised = new Set();
for (const fixture of FIXTURES) {
  for (const predicate of fixture.expect) {
    exercised.add(predicate);
  }
}
const browserSuite = readFileSync(BROWSER_SUITE, 'utf8');
/** @type {ReadonlySet<string>} */
const roster = new Set(Object.values(PREDICATES));
for (const predicate of Object.values(PREDICATES)) {
  if (exercised.has(predicate)) {
    continue;
  }
  if (BROWSER_MEASURED.includes(predicate)) {
    if (!browserSuite.includes(`'${predicate}'`)) {
      failures.push(`${predicate} is driven by the browser suite and the browser suite does not name it`);
    }
    continue;
  }
  failures.push(`${predicate} is a refusal this core can make and no fixture exercises it`);
}
for (const predicate of exercised) {
  if (!roster.has(predicate)) {
    failures.push(`a fixture expects ${predicate}, which is not a predicate this core knows`);
  }
}

// The matrix. Planned with one retained release's object in the union as well as
// this release's own, because a retained object is asked the same questions on
// the same arms — an arm list that grew a name of its own for those would be a
// second classification, and the requirement is that there is one.
const RETAINED_PROBE = `/assets/${'3'.repeat(64)}.js`;
const plan = planRequests(
  {
    schema: 'viewer-release-manifest/1',
    commit: '0'.repeat(40),
    release_id: '20260101T000000Z-000000000000',
    objects: { '/index.html': '1'.repeat(64), [`/assets/${'2'.repeat(64)}.js`]: '2'.repeat(64) },
  },
  new Map([
    [`/assets/${'2'.repeat(64)}.js`, '2'.repeat(64)],
    [RETAINED_PROBE, '3'.repeat(64)],
  ]),
  'shape',
);
const arms = [...new Set(plan.map((one) => one.arm))].sort();
if (arms.join(',') !== [...EXPECTED_ARMS].join(',')) {
  failures.push(`the matrix issues [${arms.join(', ')}] and the arms it is required to issue are [${EXPECTED_ARMS.join(', ')}]`);
}

// And the retained object is in it, on every arm the current release's objects
// get. A union that is carried as far as the allowlist and no further is an
// allowlist that permits paths nothing ever asks about.
const objectArms = [...new Set(plan.filter((one) => one.arm.startsWith('object-')).map((one) => one.arm))].sort();
const retainedArms = [...new Set(plan.filter((one) => one.path === RETAINED_PROBE).map((one) => one.arm))].sort();
if (retainedArms.join(',') !== objectArms.join(',')) {
  failures.push(
    `a retained release's object is asked on [${retainedArms.join(', ')}] and this release's objects are asked on [${objectArms.join(', ')}]`,
  );
}

if (failures.length === 0) {
  process.stdout.write(
    `check:release — ${onDisk.length} frozen core artifact(s) at their recorded digests, ${adapters.length} adapter(s), ${FIXTURES.length} fixture(s) covering ${exercised.size} predicate(s) of ${Object.values(PREDICATES).length}, ${arms.length} matrix arm(s)\n`,
  );
} else {
  process.exitCode = 1;
  for (const failure of failures) {
    process.stderr.write(`check:release — ${failure}\n`);
  }
}
