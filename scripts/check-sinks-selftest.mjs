/**
 * Self-test for the forbidden-sink check.
 *
 * A static check is only worth what its rules actually catch, and a rule that
 * silently stops matching is worse than no rule — it reports PASS and is
 * believed. So the checker is pointed at a fixture corpus with known answers,
 * and the command line is spawned as a real child process.
 *
 * The claims tested here, and why each one exists:
 *
 *   - The rule set is exactly the pinned list below. The expected IDs are
 *     hardcoded rather than derived from `RULES`, because a test that builds its
 *     expectations out of the thing under test passes just as happily after a
 *     rule is deleted. Adding or removing a rule now requires editing this list,
 *     which is a visible, reviewable act.
 *   - Every rule fires on at least one violation fixture. A rule with no fixture
 *     is a rule nobody has seen work.
 *   - And every alternative every rule names is refused, one by one. "It fired
 *     somewhere" is the wrong question for any rule whose pattern is a list, and
 *     most of these are: one rule names five ways to parse a string as markup,
 *     one names eight elements that fetch or execute, one names seven URL-
 *     bearing properties, one names four ways to navigate. A rule with one
 *     alternative deleted still fires on the fixture lines that use the others,
 *     so the rule set stayed complete, every rule stayed "fired", and a whole
 *     construct stopped being seen. The alternatives are listed in this file,
 *     independently of the patterns, and each is asked for by name.
 *   - The suppression rule and the two code-execution rules are in that list for
 *     the same reason and were there first: three independent comments, and two
 *     alternations over the punctuation that follows a name — where the
 *     alternative nothing exercised was the capture, an alias reaching a
 *     variable with no call on the line.
 *   - A clean fixture produces nothing, and demonstrates the sanctioned idioms.
 *   - A tree with exactly one violation is a failure. The violations tree
 *     carries dozens, so a scan that only spoke once it had found several would
 *     fail that tree too and look correct.
 *   - A violation is reported at the line it is on and carries that line's text,
 *     truncated to the reported width when the line is longer than it and whole
 *     when it is not. Every fixture line but one sits well under that width, so
 *     the slice that truncates never removed a character and nothing could have
 *     said if it stopped.
 *   - An empty tree cannot be scanned and says so, rather than being reported as
 *     clean: a scan that read nothing has shown nothing.
 *   - No module the checks are made of turns the type checker off. The
 *     suppression rule reaches every file by declaration and was only ever run
 *     over `site/`, which left the modules that decide whether these checks pass
 *     outside it — and the tooling typecheck configuration covers exactly those.
 *     "Exactly those" is compared against that configuration's own pinned scope
 *     rather than asserted: the reading was two directories while the scope is
 *     two directories and a file, and the file it was missing is the harness
 *     configuration.
 *   - The documented known-miss corpus is still missed. This asserts the
 *     checker's limits rather than its powers: if a rule change starts catching
 *     one of those spellings, this test fails on purpose and the honesty
 *     paragraph in the core gets updated by someone who noticed.
 *   - The scan fails closed on a symlink, whether it is an entry in the tree or
 *     the scan root itself.
 *   - The command line exits 1, 0 and 2 as documented — including when reached
 *     through a symlinked path, which is exactly how it used to fail open.
 *   - And the invocation that names no tree scans the shipped one. Every claim
 *     above is about what the rules catch, and none of them is about what the
 *     rules are run over: repointing the default one directory down left the
 *     whole chain green, reporting a pass over a single stylesheet, with a
 *     forbidden sink shipped in a served module. So the default target is read
 *     back from a real run of it — the tree by name, the number of files it
 *     holds, and the served files that have to be among them.
 *
 * The corpus lives outside `site/`, so none of it is ever served, and the real
 * scan of `site/` never sees it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHECK_CONFIGS } from './check-manifest-core.mjs';
import { collectFiles, REPO_ROOT, RULES, ScanError, scanTree, SHIPPED_TREE } from './check-sinks-core.mjs';

const FIXTURES = fileURLToPath(new URL('../test/sink-fixtures/', import.meta.url));
const CLI = fileURLToPath(new URL('./check-sinks.mjs', import.meta.url));

/**
 * The three comments the suppression rule names, assembled rather than written.
 *
 * That rule's reach now includes the modules the checks are made of — this file
 * among them — and a scan for a construct cannot tell the construct from a
 * mention of it. Spelling them here in full would put three suppressions in a
 * scanned file, which is the thing being refused. Assembling them says the same
 * three things and is not one of them.
 *
 * @type {readonly string[]}
 */
const SUPPRESSION_SPELLINGS = ['nocheck', 'ignore', 'expect-error'].map((word) => `@ts-${word}`);

/**
 * The modules the checks are made of: everything the tooling typecheck
 * configuration reads.
 *
 * Written from that configuration's own scope rather than from a list of
 * directories, because what a suppression comment suppresses is exactly what
 * that configuration was going to check.
 *
 * @type {readonly string[]}
 */
const POLICY_TREES = ['scripts', 'test'];

/**
 * And the one thing in that scope which is not in a tree.
 *
 * The tooling configuration's `include` names two directories and one file. The
 * file was missing from the list above while the prose beside it said "everything
 * the tooling typecheck configuration reads", so the reading covered the scope
 * with one hole in it — and the hole was the harness configuration, which is the
 * file that decides which spec files run, in which engines, from which
 * directory. A suppression comment at the top of it would have turned the
 * checker off for exactly that, with both configurations still saying what they
 * are pinned to say and nothing else looking.
 *
 * A separate list rather than an entry in the one above because these are read
 * rather than walked: `collectFiles` takes a directory and refuses anything
 * else, which is the behaviour that is right for a tree and wrong for a file.
 *
 * @type {readonly string[]}
 */
const POLICY_FILES = ['playwright.config.js'];

/**
 * What the tooling configuration excludes, and so what a suppression in it
 * would suppress nothing of.
 *
 * Not an exemption anything can claim: the checker does not read these files, so
 * a comment telling it to stop reading them changes nothing. The sink fixtures
 * are the tree that deliberately carries every construct these rules name.
 *
 * @type {readonly string[]}
 */
const OUTSIDE_THE_TYPECHECK = ['test/sink-fixtures'];

/**
 * The rule set, pinned independently of the implementation.
 *
 * @type {readonly string[]}
 */
const EXPECTED_RULE_IDS = [
  'innerHTML',
  'outerHTML',
  'insertAdjacentHTML',
  'document.write',
  'eval',
  'Function-constructor',
  'javascript-url',
  'inline-event-attribute',
  'event-handler-property',
  'html-string-parsing',
  'style-construction',
  'setAttribute',
  'object-assign',
  'url-property-assign',
  'srcdoc',
  'object-url',
  'navigation',
  'string-timer',
  'active-element-creation',
  'dynamic-import',
  'typecheck-suppression',
];

/**
 * @param {string} name
 * @returns {string}
 */
function fixtureDir(name) {
  return join(FIXTURES, name);
}

/**
 * Run the command line as a child process.
 *
 * @param {string | null} target The tree to scan, or `null` for the invocation
 *   that names none — which is the one `npm run check` makes, and so the one
 *   whose target is decided by the program rather than by the caller.
 * @param {string} [cliPath]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runCli(target, cliPath = CLI) {
  const result = spawnSync(process.execPath, target === null ? [cliPath] : [cliPath, target], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('the rule set matches the independently pinned list', () => {
  const actual = RULES.map((rule) => rule.id).slice().sort();
  const expected = EXPECTED_RULE_IDS.slice().sort();

  assert.deepEqual(
    actual,
    expected,
    'the rule set changed — if that was deliberate, update EXPECTED_RULE_IDS in this file',
  );
});

test('every rule fires on at least one violation fixture', () => {
  const { violations } = scanTree(fixtureDir('violations'));
  const fired = new Set(violations.map((violation) => violation.rule));
  const notFired = EXPECTED_RULE_IDS.filter((id) => !fired.has(id));

  assert.deepEqual(notFired, [], `rules with no violation fixture: ${notFired.join(', ')}`);
});

/**
 * What each rule's pattern alternates over, written out here rather than read
 * from the pattern.
 *
 * The test above asks that each rule fired somewhere, which is the right
 * question only for a rule whose pattern is one construct written several ways.
 * It is the wrong question for every rule below: each names a list of things
 * that are not variations on each other, and deleting one entry from such a list
 * leaves the rule firing on every fixture line that uses the rest. The rule set
 * is still complete, every rule still fires, and a construct nobody decided to
 * allow is now allowed.
 *
 * The values are the text a violation of that alternative has to carry, so this
 * is a list of spellings rather than of regular-expression fragments — a list
 * built out of the pattern would pass whatever the pattern said. A rule whose
 * alternatives are genuinely one construct spelled several ways is not here;
 * `every rule fires on at least one violation fixture` is the whole question for
 * those.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const RULE_ALTERNATIVES = Object.freeze({
  // Two methods, and the second writes markup exactly as the first does.
  'document.write': ['document.write(', 'document.writeln('],
  // Three punctuations, because what follows the name decides whether the line
  // is a call, the closing half of the indirect form, or a capture.
  eval: ['eval(', 'eval)', 'eval,'],
  'Function-constructor': ['Function(', 'Function)', 'Function,'],
  // Four characters may sit in front of an attribute name, and three of them are
  // not whitespace: the slash that needs no space at all, and either quote
  // closing the attribute before it.
  'inline-event-attribute': [' on', '/on', "'on", '"on'],
  // Five ways to turn a string into markup, sharing nothing but their effect.
  'html-string-parsing': [
    'DOMParser',
    'parseFromString(',
    'createContextualFragment(',
    'setHTMLUnsafe(',
    'parseHTMLUnsafe(',
  ],
  // Four shapes of style assignment, of which the first is the one a careless
  // author reaches for and the last is any single property.
  'style-construction': ['.style = ', '.style.cssText', '.style.setProperty(', '.style.color'],
  'setAttribute': ['setAttribute(', 'setAttributeNS('],
  // Seven properties that carry a URL. Written with the assignment attached so
  // that one name is not read out of another: `srcset` contains `src`.
  'url-property-assign': [
    '.href = ',
    '.src = ',
    '.srcset = ',
    '.imageSrcset = ',
    '.srcdoc = ',
    '.action = ',
    '.formAction = ',
  ],
  // Four ways to navigate, two of which are methods, one an assignment, and one
  // a bare global call.
  navigation: ['location.assign(', 'location.replace(', 'location = ', 'window.open(', '= open('],
  'string-timer': ['setTimeout(', 'setInterval('],
  // Eight elements that fetch, execute, or carry CSS. A list of names is the
  // most fragile shape a rule here has: any one of them can go with the other
  // seven still firing.
  'active-element-creation': [
    "createElement('script'",
    "createElement('iframe'",
    "createElement('object'",
    "createElement('embed'",
    "createElement('link'",
    "createElement('base'",
    "createElement('meta'",
    "createElement('form'",
    "createElement('style'",
  ],
  // The three comments, assembled rather than written, for the reason
  // `SUPPRESSION_SPELLINGS` is.
  'typecheck-suppression': SUPPRESSION_SPELLINGS,
});

test('every alternative every rule names is refused', () => {
  const { violations } = scanTree(fixtureDir('violations'));

  for (const [rule, alternatives] of Object.entries(RULE_ALTERNATIVES)) {
    assert.ok(
      RULES.some((one) => one.id === rule),
      `${rule} is no longer a rule, so the alternatives listed for it are about nothing`,
    );
    const fired = violations.filter((violation) => violation.rule === rule);
    for (const alternative of alternatives) {
      assert.ok(
        fired.some((violation) => violation.text.includes(alternative)),
        `${rule}: ${JSON.stringify(alternative)} in a shipped file was not refused`,
      );
    }
  }

  // And the list is a list of the rules that need one. A rule whose pattern
  // grew an alternative nobody wrote down here would be a rule back where all
  // of these started, so the rules that are absent are named as absent.
  const withoutAlternatives = RULES.map((one) => one.id).filter(
    (id) => !Object.prototype.hasOwnProperty.call(RULE_ALTERNATIVES, id),
  );
  assert.deepEqual(
    withoutAlternatives.sort(),
    ['dynamic-import', 'event-handler-property', 'innerHTML', 'insertAdjacentHTML', 'javascript-url', 'object-assign', 'object-url', 'outerHTML', 'srcdoc'],
    'a rule has appeared or gone, and whether its pattern alternates over anything has not been decided',
  );
});

test('every spelling of a typecheck suppression is refused', () => {
  // The test above asks that each rule fired somewhere, which is the right
  // question for a rule whose pattern is one construct written several ways. It
  // is the wrong question for this one: three independent comments, any two of
  // which could stop matching while the rule still fired on the third. So each
  // is asked for by name.
  const { violations } = scanTree(fixtureDir('violations'));
  const suppressions = violations.filter((violation) => violation.rule === 'typecheck-suppression');

  for (const spelling of SUPPRESSION_SPELLINGS) {
    assert.ok(
      suppressions.some((violation) => violation.text.includes(spelling)),
      `${spelling} in a shipped file was not refused`,
    );
  }
  assert.equal(suppressions.length, 3, 'the suppression fixture no longer carries exactly the three spellings');
});

test('every punctuation the code-execution rules name is refused', () => {
  // Two of these rules are alternations over punctuation rather than over
  // constructs: what follows the name decides whether the line is a call, an
  // indirect reference, or a capture. Dropping one alternative leaves the rule
  // firing on the fixture lines that use the others, so "it fired somewhere" is
  // satisfied by a rule that has quietly stopped seeing a whole shape — and the
  // one that was never exercised was the capture, which is how an alias reaches
  // a variable without ever being called on that line.
  const { violations } = scanTree(fixtureDir('violations'));

  for (const [rule, name] of [
    ['eval', 'eval'],
    ['Function-constructor', 'Function'],
  ]) {
    const fired = violations.filter((violation) => violation.rule === rule);
    for (const punctuation of ['(', ')', ',']) {
      assert.ok(
        fired.some((violation) => violation.text.includes(`${name}${punctuation}`)),
        `${name} followed by ${punctuation} was not refused`,
      );
    }
  }
});

test('the clean fixture produces no violations', () => {
  const { violations } = scanTree(fixtureDir('clean'));
  assert.deepEqual(violations, []);
});

test('the documented known misses are still missed', () => {
  // Documented limits, asserted so they stay documented:
  //   1. a property name assembled at runtime
  //   2. an identifier spelled with a unicode escape
  //   3. an alias captured with no call on the same line
  //   4. a call split across lines
  //   5. a string reaching a timer through a variable
  //   6. the constructor chain reached from a literal
  const { violations } = scanTree(fixtureDir('known-miss'));

  assert.deepEqual(
    violations,
    [],
    'a documented known miss is now being caught — that is good news, but the paragraph ' +
      'about the limits of this scan at the top of check-sinks-core.mjs and the list in ' +
      'the fixture itself both describe it as a miss, and both should be updated ' +
      'deliberately rather than left stale',
  );
});

test('a tree with exactly one violation is a failure', () => {
  // The boundary between "clean" and "not", which the violations tree is far too
  // broken to reach: it carries dozens, so a scan that only reported a failure
  // once it had found several would fail that tree too and look correct. One is
  // not none.
  const { violations } = scanTree(fixtureDir('one-violation'));
  assert.equal(violations.length, 1, 'the one-violation fixture no longer carries exactly one');

  const result = runCli(fixtureDir('one-violation'));
  assert.equal(result.status, 1, 'a tree with one forbidden construct was reported as clean');
  assert.ok(
    result.stdout.includes('FAIL — 1 forbidden-sink violation(s)'),
    `the one-violation run did not report the one violation:\n${result.stdout}`,
  );
  assert.ok(!result.stdout.includes('PASS'), 'a tree with one forbidden construct printed a pass line');
});

test('a violation is reported at the line and with the text it is on', () => {
  // Where a violation is and what it says are arithmetic and a slice, and
  // nothing was reading either: every other case here counts violations or
  // names their rule, so the line number could be off by one, or fixed, and the
  // text could be any part of any line. A report nobody can follow to a line is
  // a report that has to be believed rather than checked.
  const { violations } = scanTree(fixtureDir('one-violation'));
  const [only] = violations;
  assert.ok(only !== undefined);

  const file = join(fixtureDir('one-violation'), 'one.js');
  const lines = readFileSync(file, 'utf8').split('\n');
  const at = lines.findIndex((line) => line.includes('.innerHTML'));
  assert.ok(at !== -1, 'the one-violation fixture no longer carries the construct this case is about');

  assert.equal(only.line, at + 1, 'the reported line is not the line the construct is on');
  assert.equal(only.text, lines[at]?.trim(), 'the reported text is not the line the construct is on');
  assert.equal(only.rule, 'innerHTML');
  assert.equal(only.file, relative(REPO_ROOT, file));
});

test('a violation on a line longer than the report is truncated to the reported width', () => {
  // The one arithmetic step in a report that nothing reached. Every fixture line
  // but one is comfortably shorter than the width a report truncates at, so the
  // slice that does the truncating never removed a character: widening it,
  // narrowing it, or deleting it left every case here reporting exactly what it
  // reported before, and the step was a gap with nothing written beside it.
  //
  // The width is spelled here rather than imported, for the reason every pin in
  // this repository is: read from the module it is in, this would pass whatever
  // that module said.
  const width = 120;

  const { violations } = scanTree(fixtureDir('violations'));
  const long = violations.filter((violation) => violation.text.length >= width);
  assert.equal(long.length, 1, 'the violations fixture no longer carries exactly one over-length line');

  const [only] = long;
  assert.ok(only !== undefined);
  assert.equal(only.text.length, width, 'a violation was reported at a width other than the one it truncates to');

  const source = readFileSync(join(REPO_ROOT, only.file), 'utf8').split(/\r?\n/);
  const line = source[only.line - 1];
  assert.ok(line !== undefined);
  assert.ok(line.trim().length > width, 'the over-length fixture line is no longer longer than the reported width');
  assert.equal(only.text, line.trim().slice(0, width), 'the reported text is not the start of the line it is on');

  // And the other side of the same step: a line shorter than the width comes
  // back whole, so this is a truncation rather than a fixed-width field.
  const short = violations.find((violation) => violation.text.length < width);
  assert.ok(short !== undefined);
  const shortSource = readFileSync(join(REPO_ROOT, short.file), 'utf8').split(/\r?\n/);
  assert.equal(short.text, shortSource[short.line - 1]?.trim());
});

test('an empty tree cannot be scanned, and says so', () => {
  // Not a clean tree: a scan that read nothing has not shown that anything is
  // clean, and the difference between "no violations" and "no files" is the
  // difference between a check and a check that has been pointed at nothing.
  // Exit 2 rather than 0, from outside, because the comparison that tells the
  // two apart is a count against zero and every other case here hands it a
  // count that is far from it.
  const directory = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    const result = runCli(directory);

    assert.equal(result.status, 2, 'an empty tree was scanned rather than refused');
    assert.ok(result.stderr.includes('cannot scan'), `the empty run gave a different reason:\n${result.stderr}`);
    assert.ok(!result.stdout.includes('PASS'), 'an empty tree printed a pass line');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('no module the checks are made of turns the type checker off', () => {
  // The suppression rule is declared for files of every extension, and the only
  // tree it was ever run over was `site/`. So the modules that decide whether
  // any of these checks pass — the scan engine, the manifest pins, both
  // runners' policies, the suites themselves — were outside its reach entirely,
  // while the second typecheck configuration covers exactly those. One comment
  // at the top of one of them turns the checker off for a module that judges a
  // suite, with both configurations still saying what they are pinned to say and
  // this scan never looking.
  //
  // Read here rather than by extending what `check:sinks` walks, because the
  // other rules cannot be run over this tree: their patterns are written in it,
  // and a line-based scan cannot tell a pattern from the construct it is for.
  // This one rule can, because its spellings are written in one place — the
  // pattern — and nowhere else.
  const rule = RULES.find((one) => one.id === 'typecheck-suppression');
  assert.ok(rule !== undefined, 'the suppression rule is gone');

  /** @type {string[]} */
  const found = [];
  const readable = [
    ...POLICY_TREES.flatMap((tree) => collectFiles(join(REPO_ROOT, tree))),
    ...POLICY_FILES.map((file) => join(REPO_ROOT, file)),
  ];
  {
    for (const file of readable) {
      const shown = relative(REPO_ROOT, file);
      if (OUTSIDE_THE_TYPECHECK.some((outside) => shown === outside || shown.startsWith(`${outside}/`))) {
        continue;
      }
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (rule.pattern.test(line)) {
            found.push(`${shown}:${index + 1}  ${line.trim().slice(0, 120)}`);
          }
        });
    }
  }

  assert.deepEqual(found, [], `the type checker is turned off in:\n${found.join('\n')}`);

  // And the reading is shown to find one, so a clean answer is an answer rather
  // than a walk that reached nothing. Each spelling separately, because the
  // rule is three independent alternatives.
  for (const spelling of SUPPRESSION_SPELLINGS) {
    assert.ok(rule.pattern.test(`// ${spelling}`), `${spelling} is no longer refused`);
  }
  assert.ok(readable.length > 20, `the reading covered ${readable.length} file(s), which is not the tree it is for`);
  assert.ok(readable.some((file) => file.endsWith('run-node-tests-core.mjs')));
  assert.ok(readable.some((file) => file.endsWith('run-browser-tests-core.mjs')));
  assert.ok(readable.some((file) => file.endsWith('check-manifest-core.mjs')));
  assert.ok(readable.some((file) => file.endsWith('check-sinks-core.mjs')));
  assert.ok(readable.some((file) => file.endsWith('playwright.config.js')));

  // And the reading covers the configuration's scope rather than approximately
  // covering it. Every entry of that scope is either a tree walked above or the
  // file read beside it, compared against what the manifest pins the scope to
  // be — so a scope that grows an entry is a comparison that fails here rather
  // than a corner nothing reads.
  const tooling = CHECK_CONFIGS['tsconfig.tooling.json'];
  assert.ok(tooling !== undefined, 'the manifest no longer pins the tooling typecheck configuration');
  const covered = new Set([...POLICY_TREES.map((tree) => `${tree}/**/*`), ...POLICY_FILES]);
  const uncovered = tooling.include.filter((entry) => !covered.has(entry.replace(/\.(js|mjs)$/, '')) && !covered.has(entry));
  assert.deepEqual(
    uncovered,
    [],
    `the tooling typecheck reads ${uncovered.join(', ')}, which this reading does not cover`,
  );
});

test('markup rules reach every configured markup extension', () => {
  const { violations } = scanTree(fixtureDir('violations'));

  for (const extension of ['.html', '.htm', '.xhtml', '.svg']) {
    const hits = violations.filter(
      (violation) => violation.file.endsWith(extension) && violation.rule === 'inline-event-attribute',
    );
    assert.ok(hits.length > 0, `markup-scoped rules did not apply to a ${extension} file`);
  }
});

test('script rules reach .mjs, not only .js', () => {
  const { violations } = scanTree(fixtureDir('violations'));
  const inMjs = violations.filter(
    (violation) => violation.file.endsWith('.mjs') && violation.rule === 'event-handler-property',
  );

  assert.ok(inMjs.length > 0, 'script-scoped rules did not apply to a .mjs file');
});

test('a symlinked entry in the scanned tree fails the scan closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    writeFileSync(join(dir, 'real.js'), 'export const value = 1;\n');
    symlinkSync(join(dir, 'real.js'), join(dir, 'link.js'));

    assert.throws(() => scanTree(dir), ScanError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a symlinked scan root fails the scan closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    const real = join(dir, 'real');
    mkdirSync(real);
    writeFileSync(join(real, 'a.js'), 'export const value = 1;\n');
    const link = join(dir, 'link');
    symlinkSync(real, link, 'dir');

    assert.throws(() => scanTree(link), ScanError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the command line exits 1 and prints FAIL on a violations tree', () => {
  const result = runCli(fixtureDir('violations'));

  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes('FAIL —'), 'the violations run printed no FAIL line');
});

test('the command line exits 0 on a clean tree', () => {
  const result = runCli(fixtureDir('clean'));

  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('PASS —'), 'the clean run printed no PASS line');
});

test('the command line exits 2 on a missing tree', () => {
  const result = runCli(fixtureDir('does-not-exist'));

  assert.equal(result.status, 2);
});

test('the invocation that names no tree scans the shipped one', () => {
  // The subject of this whole check, which nothing was asking about. Every other
  // case here points the scanner at a fixture tree and reads what it said about
  // it; the run that matters points itself, and where it points was a path
  // written once in the command-line front end with nothing beside it. Moved to
  // `site/css`, the step reported "scanned 1 file(s) under site/css/ … PASS" and
  // `npm run check` exited 0 with `el.innerHTML = s` exported from a served
  // module.
  //
  // Held from outside in the two ways it can be got wrong. The constant can be
  // repointed, so it is compared against a path written here rather than taken
  // from there. And the constant can be left alone while the program scans
  // something else, so a run that named no tree is asked what it actually
  // reached.
  assert.equal(SHIPPED_TREE, join(REPO_ROOT, 'site'), 'the scan is aimed somewhere other than the served tree');

  const shipped = collectFiles(SHIPPED_TREE).map((file) => relative(REPO_ROOT, file));
  assert.ok(shipped.length > 0, 'the served tree holds no files, so a pass over it would show nothing');

  // The files a scan of the served tree cannot have missed: the page that is
  // served and every module reachable from it. A count on its own is a count,
  // and a tree of the right size is not the tree.
  for (const file of [
    'site/index.html',
    'site/js/main.js',
    'site/js/dispatch.js',
    'site/js/render.js',
    'site/js/validate.js',
    'site/js/parse.js',
    'site/js/crypto.js',
  ]) {
    assert.ok(shipped.includes(file), `${file} is not among the files the shipped tree holds`);
  }

  const result = runCli(null);

  assert.equal(result.status, 0, `the default invocation did not exit 0:\n${result.stdout}\n${result.stderr}`);
  assert.ok(
    result.stdout.includes(`scanned ${shipped.length} file(s) under site/ `),
    `the default invocation did not report having scanned the ${shipped.length} file(s) under site/:\n${result.stdout}`,
  );
  assert.ok(
    result.stdout.includes('PASS — no configured pattern matched in site/'),
    `the default invocation did not report a pass over site/:\n${result.stdout}`,
  );

  // And the reading bites: a forbidden construct in a served file is refused by
  // the run that points itself, not only by the runs a fixture points. Written
  // and removed here rather than kept on disk, because a fixture carrying one
  // would be a forbidden sink in the served tree.
  const planted = join(SHIPPED_TREE, 'js', 'a-file-this-test-writes.js');
  try {
    writeFileSync(planted, `const el = document.body;\nel.${'inner'}HTML = 'x';\n`);
    const withSink = runCli(null);
    assert.equal(withSink.status, 1, 'a forbidden construct in the served tree was not refused by the default run');
    assert.ok(
      withSink.stdout.includes('site/js/a-file-this-test-writes.js'),
      `the default run did not name the served file it found:\n${withSink.stdout}`,
    );
  } finally {
    rmSync(planted, { force: true });
  }

  // And the tree is back as it was, so the case leaves nothing behind.
  assert.equal(runCli(null).status, 0, 'the served tree did not come back clean');
});

test('the command line still scans when reached through a symlinked path', () => {
  // The regression this exists for: a main-module guard comparing a
  // realpath-resolved import.meta.url against an as-invoked argv[1] made the
  // whole check exit 0 without scanning whenever the script was reached through
  // a symlink. There is no guard now, and this proves it.
  const dir = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    const linkedRepo = join(dir, 'repo');
    symlinkSync(REPO_ROOT, linkedRepo, 'dir');
    const linkedCli = join(linkedRepo, 'scripts', 'check-sinks.mjs');

    const result = runCli(fixtureDir('violations'), linkedCli);

    assert.equal(result.status, 1, 'the check did not run through the symlinked path');
    assert.ok(result.stdout.includes('FAIL —'), 'the symlinked invocation printed no FAIL line');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
