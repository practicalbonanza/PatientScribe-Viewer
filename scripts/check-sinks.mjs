/**
 * Forbidden-sink scan — the command line.
 *
 * Usage:
 *   node scripts/check-sinks.mjs           scans site/ — the default, and what CI runs
 *   node scripts/check-sinks.mjs <dir>     scans <dir> — used by the self-test to
 *                                          exercise this file against fixture trees
 *
 * Exit codes: 0 = clean, 1 = violations found, 2 = the scan could not run.
 *
 * This file does its work on import, unconditionally. There is deliberately no
 * "am I the entry module?" guard: the obvious way to write one compares
 * `import.meta.url`, which the loader has resolved through symlinks, against
 * `process.argv[1]`, which it has not — so invoking the script through a
 * symlinked path made the guard false and the whole check silently exited 0
 * without scanning anything. Splitting the engine into `check-sinks-core.mjs`
 * removes the reason the guard existed, and the self-test now spawns this file
 * as a child process, including through a symlink, so the command-line path is
 * covered rather than assumed.
 *
 * The rules and the tree walk live in `check-sinks-core.mjs`.
 */

import { join, relative, resolve } from 'node:path';

import { REPO_ROOT, RULES, ScanError, scanTree } from './check-sinks-core.mjs';

const argument = process.argv[2];
const target = argument === undefined ? join(REPO_ROOT, 'site') : resolve(argument);
const label = `${relative(REPO_ROOT, target) || target}/`;

/**
 * @returns {number} process exit code
 */
function run() {
  /** @type {import('./check-sinks-core.mjs').ScanResult} */
  let result;
  try {
    result = scanTree(target);
  } catch (error) {
    if (error instanceof ScanError) {
      process.stderr.write(`check:sinks — cannot scan: ${error.message}\n`);
      return 2;
    }
    throw error;
  }

  if (result.files.length === 0) {
    process.stderr.write(`check:sinks — cannot scan: ${label} is empty\n`);
    return 2;
  }

  const extSummary = [...result.byExt.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ext, count]) => `${count}${ext || ' extensionless'}`)
    .join(', ');

  process.stdout.write(
    `check:sinks — scanned ${result.files.length} file(s) under ${label} (${extSummary}) against ${RULES.length} rules\n`,
  );

  if (result.violations.length === 0) {
    process.stdout.write(`PASS — no configured pattern matched in ${label}\n`);
    return 0;
  }

  process.stdout.write(`FAIL — ${result.violations.length} forbidden-sink violation(s):\n\n`);
  for (const violation of result.violations) {
    process.stdout.write(`  ${violation.file}:${violation.line}  [${violation.rule}] — ${violation.why}\n`);
    process.stdout.write(`      ${violation.text}\n`);
  }
  process.stdout.write('\nThere is no suppression mechanism. Remove the construct.\n');
  return 1;
}

process.exit(run());
