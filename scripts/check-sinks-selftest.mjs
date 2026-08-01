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
 *   - A clean fixture produces nothing, and demonstrates the sanctioned idioms.
 *   - The documented known-miss corpus is still missed. This asserts the
 *     checker's limits rather than its powers: if a rule change starts catching
 *     one of those spellings, this test fails on purpose and the honesty
 *     paragraph in the core gets updated by someone who noticed.
 *   - The scan fails closed on a symlink, whether it is an entry in the tree or
 *     the scan root itself.
 *   - The command line exits 1, 0 and 2 as documented — including when reached
 *     through a symlinked path, which is exactly how it used to fail open.
 *
 * The corpus lives outside `site/`, so none of it is ever served, and the real
 * scan of `site/` never sees it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT, RULES, ScanError, scanTree } from './check-sinks-core.mjs';

const FIXTURES = fileURLToPath(new URL('../test/sink-fixtures/', import.meta.url));
const CLI = fileURLToPath(new URL('./check-sinks.mjs', import.meta.url));

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
 * @param {string} target
 * @param {string} [cliPath]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runCli(target, cliPath = CLI) {
  const result = spawnSync(process.execPath, [cliPath, target], { encoding: 'utf8' });
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
    'a documented known miss is now being caught — that is good news, but update the ' +
      'coverage record and the checker header deliberately rather than leaving them stale',
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
