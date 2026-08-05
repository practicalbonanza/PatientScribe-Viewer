/**
 * Commit-message attribution check — the runner.
 *
 * Usage:
 *   node scripts/check-attribution.mjs                    reads the whole
 *                                                         history of this
 *                                                         repository — every
 *                                                         branch and every tag
 *   node scripts/check-attribution.mjs --message <file>   reads one message,
 *                                                         which is what the
 *                                                         `commit-msg` hook does
 *   node scripts/check-attribution.mjs --in <dir>         reads the history of
 *                                                         <dir> — used by the
 *                                                         self-test to run this
 *                                                         file against a
 *                                                         repository whose
 *                                                         answer is known
 *
 * Exit codes: 0 = nothing to report, 1 = something is there, or the history
 * could not be read.
 *
 * Two callers and one program, so there is one definition of the rules rather
 * than one per place they are applied. The hook is what stops a message being
 * written; the history scan is what notices if one was written anyway — with the
 * hook unwired, with the hook skipped, or on another machine entirely. Neither
 * is a substitute for the other, and the second is the one that keeps being true
 * after the first has been bypassed.
 *
 * The history scan reads names and addresses as well as message text, because a
 * commit can carry an attribution in who it says wrote it as readily as in what
 * it says.
 *
 * Like the other entry points here, this file does its work on import and has no
 * "am I the entry module?" guard: an earlier check in this repository guarded its
 * own work on a comparison that silently failed through a symlink, and a check
 * that can be made to exit 0 without checking is worse than no check. The rules
 * live in `check-attribution-core.mjs` so that a test can import them without
 * starting a scan.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { brokenRules } from './check-attribution-core.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * @param {string} label How the thing being reported is named.
 * @param {string} text
 * @returns {string[]} One line per rule broken.
 */
function report(label, text) {
  return brokenRules(text).map((rule) => `${label}: ${rule.why} (${rule.name})`);
}

/**
 * Every commit reachable from anywhere in a repository, read whole.
 *
 * Records are separated by NUL, which no commit message can contain, and each
 * begins with its own hash so a failure names something a reader can go and
 * look at.
 *
 * @param {string} root
 * @returns {string[]} One line per reason; empty means there was nothing.
 */
function scanHistory(root) {
  const result = spawnSync('git', ['-C', root, 'log', '--all', '-z', '--format=%H%n%an%n%ae%n%cn%n%ce%n%B'], {
    encoding: 'utf8',
  });
  if (result.error !== undefined || result.status !== 0) {
    return [`the history could not be read (${result.error?.message ?? `git exited ${String(result.status)}`})`];
  }

  const records = (result.stdout ?? '').split('\0').filter((record) => record.trim().length > 0);
  if (records.length === 0) {
    // Nothing to scan is not a clean scan. What reaches this branch is a
    // repository with no commits in it, and nothing else.
    //
    // It is not what a shallow checkout looks like, and it is worth being exact
    // about that because the two used to be described here as one thing. A
    // shallow checkout has a commit — that is what makes it a checkout — so this
    // scan reads one record, finds nothing in it, and reports a clean history
    // having looked at the tip and no further. There is no count that tells that
    // apart from a repository whose history really is one commit, so nothing
    // here can catch it: what does is the checkout being told to fetch
    // everything, which is `fetch-depth: 0` in the workflow and is asserted by
    // the self-test that reads the workflow.
    return ['the history holds no commit, so nothing was read rather than nothing was found'];
  }

  /** @type {string[]} */
  const failures = [];
  for (const record of records) {
    const [hash] = record.split('\n');
    failures.push(...report(String(hash).slice(0, 12), record));
  }
  return failures;
}

/**
 * One message, as the repository will keep it.
 *
 * Lines beginning with `#` are dropped, because that is what git does to them
 * before the message becomes a commit: the block an editor session opens with is
 * instructions to the author, not text anybody will ever read out of the
 * history. A message written with cleanup turned off keeps them, which is a case
 * this cannot see and the history scan can — the two halves of this program
 * cover each other, and this is one of the places where it matters.
 *
 * @param {string} file
 * @returns {string[]}
 */
function scanMessage(file) {
  /** @type {string} */
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [`the message could not be read from ${file}`];
  }
  const committed = text
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('#'))
    .join('\n');
  return report('this message', committed);
}

const args = process.argv.slice(2);
const [first, second] = args;

/** @type {string[] | null} */
let failures = null;

if (args.length === 0) {
  failures = scanHistory(REPO_ROOT);
} else if (args.length === 2 && second !== undefined && second.length > 0) {
  if (first === '--in') {
    failures = scanHistory(resolve(second));
  } else if (first === '--message') {
    failures = scanMessage(second);
  }
}

if (failures === null) {
  process.stderr.write('check:attribution — usage: check-attribution.mjs [--message <file>] [--in <dir>]\n');
  process.exit(1);
}

if (failures.length === 0) {
  process.stdout.write('check:attribution — nothing to report\n');
} else {
  process.exitCode = 1;
  for (const failure of failures) {
    process.stderr.write(`check:attribution — ${failure}\n`);
  }
  process.stderr.write(
    "check:attribution — this repository's history describes the change and nothing about how it came to be written\n",
  );
}
