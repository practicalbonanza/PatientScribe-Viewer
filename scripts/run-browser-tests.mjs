/**
 * The browser test path — the runner.
 *
 * Usage:
 *   node scripts/run-browser-tests.mjs                 runs the suite — the
 *                                                      default, and what
 *                                                      `npm run check` runs
 *   node scripts/run-browser-tests.mjs --config <file> runs the harness against
 *                                                      another configuration —
 *                                                      used by the self-test to
 *                                                      exercise this file
 *                                                      against fixture trees
 *                                                      with known answers
 *
 * Exit codes: 0 = the suite ran and passed, 1 = it did not.
 *
 * This wraps the browser harness for the same reason the fast path is wrapped:
 * the harness answers "did anything fail?" and this has to answer "did the suite
 * run?". Those come apart the moment a suite is more than one file. Deleting the
 * spec file that carries the corpus left the harness matching tests, running
 * them, and exiting 0, and the only assertions that could have noticed were
 * inside the file that had gone. The floors are in `run-browser-tests-core.mjs`,
 * they are read from what the harness reported having done, and they live here
 * rather than in a spec file because a check on whether the spec files ran
 * cannot be one of them.
 *
 * The manifest is checked from here as well, and that is not a stray concern:
 * this program and the fast path's runner are the two things `npm run check`
 * invokes that can read anything, so between them they are where a step of that
 * chain being replaced by something that does nothing is noticed. Silencing this
 * one leaves the fast path's runner asking, and silencing that one leaves this
 * one asking.
 *
 * Nothing in the browser suite checks this file, and nothing can: this is what
 * decides whether that suite's result is reported as a pass. What checks it is
 * `run-browser-tests-selftest.mjs`, which spawns it against fixture
 * configurations and reads the exit code from outside.
 *
 * Like the other two entry points here, this file does its work on import and
 * has no "am I the entry module?" guard. The policy lives in the core module so
 * that a test can import it without starting a browser run.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkManifest, readManifest } from './check-manifest-core.mjs';
import { checkBrowserRun, summariseRun } from './run-browser-tests-core.mjs';

const HARNESS_CLI = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));

/**
 * The command line, as two separate readings of it.
 *
 * `extra` is what the harness is handed. `named` is which configuration the
 * command line asked for, and it is read from the command line rather than from
 * `extra` on purpose: the policy uses it to tell the default invocation — the
 * one `npm run check` makes, which names no configuration and lets the harness
 * choose — from a self-test's run against a fixture tree. Taken from `extra`
 * instead, a default branch that had quietly grown a configuration of its own
 * would be reporting itself as a run that asked for one, which is exactly the
 * claim the policy would then be trusting.
 *
 * @returns {{ extra: string[], named: string | null } | null} The two readings,
 *   or `null` if the command line is not one of the two documented forms.
 */
function commandLine() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    return { extra: [], named: null };
  }
  if (args.length === 2 && args[0] === '--config' && args[1] !== undefined && args[1].length > 0) {
    return { extra: ['--config', args[1]], named: args[1] };
  }
  return null;
}

const invocation = commandLine();
if (invocation === null) {
  process.stderr.write('test:smoke — usage: run-browser-tests.mjs [--config <file>]\n');
  process.exit(1);
}
const extra = invocation.extra;

const directory = mkdtempSync(join(tmpdir(), 'viewer-browser-run-'));
const reportFile = join(directory, 'report.json');

/** @type {number | null} */
let exitCode = null;
/** @type {unknown} */
let report = null;

try {
  /** @type {Record<string, string | undefined>} */
  const environment = { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile };
  // This program is run by the fast path's runner when the self-test spawns it,
  // and that marks its children so a nested test run refuses to execute any
  // files. The harness is not a node test run, but its workers are node
  // processes and the mark travels; removed here so a nested invocation runs
  // what it was pointed at rather than nothing.
  delete environment['NODE_TEST_CONTEXT'];

  // Two reporters: the readable one to this process's stdout, and the machine
  // one to a file. The judgement below is made from the file, so what is read is
  // what the harness recorded rather than what was printed.
  const result = spawnSync(process.execPath, [HARNESS_CLI, 'test', '--reporter=list,json', ...extra], {
    stdio: 'inherit',
    env: environment,
  });
  exitCode = result.status;

  try {
    report = JSON.parse(readFileSync(reportFile, 'utf8'));
  } catch {
    report = null;
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

const failures = [
  ...checkManifest(readManifest()),
  ...checkBrowserRun({ report, exitCode, configArgument: invocation.named }),
];

if (failures.length === 0) {
  const summary = summariseRun(report);
  const engines = [...summary.byEngine.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([engine, count]) => `${count} in ${engine}`)
    .join(', ');
  process.stdout.write(
    `test:smoke — ${summary.executed} test(s) in ${summary.files.length} spec file(s) (${engines})\n`,
  );
} else {
  process.exitCode = 1;
  for (const failure of failures) {
    process.stderr.write(`test:smoke — ${failure}\n`);
  }
}
