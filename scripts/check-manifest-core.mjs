/**
 * What `npm run check` is.
 *
 * Every check in this repository is reached through one npm script, which means
 * the manifest is the layer that decides whether any of them runs at all. A
 * check that is thorough about its subject and silent about its own invocation
 * is a check that can be switched off by an edit it is not looking at: replacing
 * a step's command with `true` leaves it green having run nothing, and so does
 * dropping the step from the chain while its text still appears somewhere.
 *
 * So the chain and every command in it are pinned here, as literals, written out
 * rather than derived from the manifest they are compared against. A test that
 * builds its expectations out of the thing under test passes just as happily
 * after the thing is deleted. Changing what `npm run check` runs therefore means
 * editing this file, which is a visible, reviewable act.
 *
 * Four things are asked, and the last two are what make the first two worth
 * having:
 *
 * - The chain is exactly the pinned steps, in order. Compared as one string, so
 *   a step commented out, reordered, or replaced by something that merely
 *   contains the same text is a different chain rather than a chain that still
 *   mentions the right words.
 * - Every step's command is exactly the pinned command. This is what refuses
 *   `true`, `:`, `exit 0`, and an `echo` wearing a step's name — not by
 *   enumerating the ways to write nothing, which is a game the enumerator loses,
 *   but by admitting exactly one spelling of each step.
 * - Every file of this repository's own that a step reaches for is on disk. A
 *   command that names a runner which is not there is a command that does
 *   nothing, and it would otherwise satisfy the text comparison perfectly. Not
 *   every precondition: a step also needs its installed dependencies, and this
 *   says nothing about those. What it covers is what this repository can lose,
 *   which is written out in `CHECK_FILES` and is where the claim had drifted
 *   from the list — the browser step's harness configuration and development
 *   server were absent from it while this sentence claimed everything.
 * - And the two configurations the typecheck step is pointed at say what that
 *   step needs them to say. A command spelled exactly right, naming files that
 *   are all present, still checks nothing if the files tell it not to:
 *   `"checkJs": false` leaves `tsc` reading the shipped JavaScript without
 *   checking any of it, and a narrowed `include` leaves it not reading some of
 *   it at all. Both were green, with a blatant type error in a served module.
 *
 * The pins are compared as whole configurations rather than option by option,
 * because the ways to turn a checker off are not a list anyone finishes: one
 * option set to false, one glob narrowed, one `exclude` added, one newer option
 * that skips the checking wholesale. What is admitted is exactly the two
 * configurations written below, and changing either of them means editing this
 * file, which is a visible, reviewable act.
 *
 * What this cannot do is check itself, and there is no arrangement in which it
 * could: `npm run check` is the root, and a chain rewritten to run nothing has
 * nothing left to notice. What it does instead is make every single-step
 * disabling visible from somewhere else — this module is read by both runners,
 * so silencing any one step leaves at least one other still asking. That is the
 * honest reach of it, and it is written down here rather than assumed.
 *
 * No CLI, no exit codes, no output: this is importable from a test without doing
 * anything, which it has to be, because the tests that hold the pins below are
 * themselves steps in the chain being pinned.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The manifest itself, which is also the one file none of this can do without. */
export const MANIFEST_FILE = join(REPO_ROOT, 'package.json');

/**
 * The steps of `npm run check`, in order.
 *
 * Ordered so that the cheap checks fail first and the self-tests run before the
 * suites they are about: a runner whose exit codes have stopped meaning what
 * they say should be reported as that, rather than as whatever the suite it was
 * running happened to say next.
 *
 * @type {readonly string[]}
 */
export const CHECK_STEPS = Object.freeze([
  'npm run typecheck',
  'npm run check:sinks',
  'npm run check:self',
  'npm run test:fast',
  'npm run test:smoke',
]);

/**
 * What each step runs, exactly.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CHECK_COMMANDS = Object.freeze({
  typecheck: 'tsc --noEmit -p jsconfig.json && tsc --noEmit -p tsconfig.tooling.json',
  'check:sinks': 'node scripts/check-sinks.mjs',
  'check:self': 'node scripts/run-node-tests.mjs self',
  'test:fast': 'node scripts/run-node-tests.mjs fast',
  'test:smoke': 'node scripts/run-browser-tests.mjs',
});

/**
 * What each step cannot run without, as repository-relative paths.
 *
 * Every file of this repository's own that a step reaches for: the program its
 * command names, and each module that program imports from here. Not everything
 * a step needs — `typecheck` cannot run without the compiler and `test:smoke`
 * cannot run without the browser harness, and both of those are installed
 * dependencies rather than files this repository carries — so this is a list of
 * what the repository can lose rather than a list of preconditions. The
 * distinction is worth writing down because the sentence at the top of this file
 * used to claim the second and mean the first.
 *
 * `test:smoke` names two files beyond its own programs, and they were both
 * missing: the harness configuration, which is what decides which spec files run
 * and in which engines, and the server the harness starts, which is what the
 * page under test is served by. Either of them gone is a step that runs nothing,
 * which is exactly the condition this list exists to notice.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const CHECK_FILES = Object.freeze({
  typecheck: ['jsconfig.json', 'tsconfig.tooling.json'],
  'check:sinks': ['scripts/check-sinks.mjs', 'scripts/check-sinks-core.mjs'],
  'check:self': ['scripts/run-node-tests.mjs', 'scripts/run-node-tests-core.mjs', 'scripts/check-manifest-core.mjs'],
  'test:fast': ['scripts/run-node-tests.mjs', 'scripts/run-node-tests-core.mjs', 'scripts/check-manifest-core.mjs'],
  'test:smoke': [
    'scripts/run-browser-tests.mjs',
    'scripts/run-browser-tests-core.mjs',
    'scripts/check-manifest-core.mjs',
    'playwright.config.js',
    'scripts/serve.mjs',
  ],
});

/**
 * A configuration the typecheck step is pointed at.
 *
 * @typedef {object} TypecheckConfig
 * @property {Record<string, unknown>} compilerOptions
 * @property {string[]} include
 * @property {string[]} [exclude]
 */

/**
 * What the two configurations the typecheck step names must say, in full.
 *
 * Two worlds, and the split between them is the point of there being two files:
 * the browser one must not type-check against node globals, or the checker would
 * accept code no browser can run, and the tooling one is the only place those
 * globals are allowed. So the empty `types` roster is as load-bearing as
 * `checkJs`, and both are pinned here rather than left to the file that would be
 * edited to change them.
 *
 * Written out whole. Every key that decides what is read (`include`, `exclude`),
 * what is checked (`allowJs`, `checkJs`, `strict` and the rest), and what is
 * visible while checking (`lib`, `types`) is here, and so is every other key
 * those files carry — a configuration that has grown an option this list does
 * not name is a configuration nobody has decided about, and the option that
 * turns a checker off is as likely to be the next one as the last one.
 *
 * Keys whose name begins with `//` are documentation and are ignored on both
 * sides of the comparison; `tsc` ignores them too.
 *
 * @type {Readonly<Record<string, TypecheckConfig>>}
 */
export const CHECK_CONFIGS = Object.freeze({
  'jsconfig.json': {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      allowJs: true,
      checkJs: true,
      noEmit: true,
      strict: true,
      noImplicitOverride: true,
      noUncheckedIndexedAccess: true,
      noFallthroughCasesInSwitch: true,
      noImplicitReturns: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      forceConsistentCasingInFileNames: true,
      skipLibCheck: true,
      types: [],
    },
    include: ['site/**/*.js', 'site/**/*.mjs'],
  },
  'tsconfig.tooling.json': {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      allowJs: true,
      checkJs: true,
      noEmit: true,
      strict: true,
      noImplicitOverride: true,
      noUncheckedIndexedAccess: true,
      noFallthroughCasesInSwitch: true,
      noImplicitReturns: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      forceConsistentCasingInFileNames: true,
      skipLibCheck: true,
      types: ['node'],
    },
    include: ['scripts/**/*.js', 'scripts/**/*.mjs', 'test/**/*.js', 'test/**/*.mjs', 'playwright.config.js'],
    exclude: ['node_modules', 'test/sink-fixtures'],
  },
});

/**
 * The manifest, parsed.
 *
 * Total: an unreadable or unparseable manifest comes back as `null`, which
 * `checkManifest` reports as the failure it is rather than as an exception from
 * a module whose callers are runners.
 *
 * @returns {unknown}
 */
export function readManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * A configuration file, parsed, or `null` if it cannot be.
 *
 * @param {string} file A repository-relative path.
 * @returns {unknown}
 */
function readConfigFile(file) {
  try {
    return JSON.parse(readFileSync(join(REPO_ROOT, file), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * A value as one string, with object keys in a fixed order and documentation
 * keys dropped.
 *
 * Compared as text so that a configuration differing in the order its options
 * are written is the same configuration, and one differing in an option — or
 * carrying one more — is not.
 *
 * @param {unknown} value
 * @returns {string}
 */
function canonicalise(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalise).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const source = /** @type {Record<string, unknown>} */ (value);
    const names = Object.keys(source)
      .filter((name) => !name.startsWith('//'))
      .sort();
    return `{${names.map((name) => `${JSON.stringify(name)}:${canonicalise(source[name])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/**
 * Is a file a step names on disk?
 *
 * @param {string} file A repository-relative path.
 * @returns {boolean}
 */
function onDisk(file) {
  return existsSync(join(REPO_ROOT, file));
}

/**
 * Is the chain, and every step of it, what it is pinned to be?
 *
 * `fileExists` is an argument rather than a call so that the answer this
 * function gives when a runner is missing is a thing a test can ask for. Every
 * comparison below only fires when something is wrong, so on a repository where
 * nothing is wrong all of them are silent whether they are there or not — which
 * is the shape a check can be deleted in without anything noticing. The tests
 * that hold this hand it a manifest that is wrong in each way in turn, and this
 * seam is what lets them do the same for the one condition that is not in the
 * manifest at all.
 *
 * `readConfig` is an argument for the same reason, and for one more: the
 * configurations it reads are the typecheck step's whole scope, and a check on
 * them that has never been shown to refuse anything is a check nobody can tell
 * from an empty function.
 *
 * @param {unknown} manifest The parsed manifest, or `null`.
 * @param {(file: string) => boolean} [fileExists]
 * @param {(file: string) => unknown} [readConfig]
 * @returns {string[]} One line per reason it is not; empty means it is.
 */
export function checkManifest(manifest, fileExists = onDisk, readConfig = readConfigFile) {
  /** @type {string[]} */
  const failures = [];

  if (manifest === null || typeof manifest !== 'object') {
    failures.push('package.json could not be read as an object, so what `npm run check` runs is unknown');
    return failures;
  }

  const scripts = /** @type {Record<string, unknown>} */ (manifest)['scripts'];
  if (scripts === null || typeof scripts !== 'object') {
    failures.push('package.json carries no scripts, so `npm run check` is not defined');
    return failures;
  }

  const named = /** @type {Record<string, unknown>} */ (scripts);
  const chain = CHECK_STEPS.join(' && ');
  if (named['check'] !== chain) {
    failures.push(`\`check\` runs ${JSON.stringify(named['check'])}, and the chain it must run is ${JSON.stringify(chain)}`);
  }

  for (const [name, command] of Object.entries(CHECK_COMMANDS)) {
    if (named[name] !== command) {
      failures.push(`\`${name}\` runs ${JSON.stringify(named[name])}, and the command it must run is ${JSON.stringify(command)}`);
    }
  }

  for (const [name, files] of Object.entries(CHECK_FILES)) {
    for (const file of files) {
      if (!fileExists(file)) {
        failures.push(`\`${name}\` names ${file}, which is not there, so the step runs nothing`);
      }
    }
  }

  for (const [file, pinned] of Object.entries(CHECK_CONFIGS)) {
    const actual = readConfig(file);
    if (actual === null || typeof actual !== 'object') {
      failures.push(`${file} could not be read as an object, so what \`typecheck\` checks is unknown`);
      continue;
    }
    const source = /** @type {Record<string, unknown>} */ (actual);
    const required = /** @type {Record<string, unknown>} */ (pinned);
    const names = new Set([
      ...Object.keys(source).filter((name) => !name.startsWith('//')),
      ...Object.keys(required),
    ]);
    for (const name of [...names].sort()) {
      const was = canonicalise(source[name]);
      const must = canonicalise(required[name]);
      if (was !== must) {
        failures.push(`${file} sets ${name} to ${was}, and what \`typecheck\` needs it to be is ${must}`);
      }
    }
  }

  return failures;
}
