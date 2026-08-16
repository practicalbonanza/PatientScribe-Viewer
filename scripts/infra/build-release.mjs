/**
 * Build a release: the served tree, and the manifest that says what it is.
 *
 * A release is a pure function of two things — the source tree, and the
 * identifier the release is being given — and nothing else. Run twice on the same
 * inputs it writes the same bytes, which is not a nicety: the switch driver
 * proves a manifest's provenance by rebuilding it and comparing, so a build that
 * embedded a clock, a random name, or a directory-order dependence would make
 * that proof impossible and every manifest a thing to be trusted rather than
 * checked.
 *
 * Three orderings carry that, and they are one rule written three times. Source
 * files are processed in byte-wise ascending order of their paths; the manifest's
 * `objects` keys are serialised in that same order; and so is the inventory the
 * switch driver writes later. The rewrite itself needs no tie-break — each file's
 * output depends only on the digests of the files it imports — but two correct
 * builders have to agree on the bytes, not only on the contents, and agreeing on
 * the bytes means agreeing on the order.
 *
 * What the layout is, and why the origin table is not an asset. Everything under
 * `/assets/` is named by the digest of its own bytes, which is what makes it
 * cacheable for a year: the name cannot come to mean different bytes. The origin
 * table cannot live there. It is the module whose bytes decide where the page is
 * allowed to send a share code, the release check binds it three ways — the
 * checkout's bytes, the manifest's digest, the origin's bytes — and it is asked
 * for at a fixed path because a fixed path is what a binding can be about. So it
 * is served at `/js/config.js`, under the default behaviour, `no-store` like the
 * document it belongs to. The build refuses if its output differs from its input
 * by a byte.
 *
 * Provenance. A release built from bytes no commit holds is a release nothing can
 * be checked against afterwards, so a dirty `site/` refuses outright. With no
 * `--commit` the manifest records `HEAD`. An explicit `--commit` is accepted
 * exactly when its `site` tree is the working one's — equal trees are what make
 * the label true of the bytes being built — and that acceptance is what lets the
 * switch driver rebuild a published manifest at the commit the manifest names.
 *
 * Usage:
 *   node scripts/infra/build-release.mjs [--tree DIR] [--out DIR]
 *                                        [--release-id ID] [--commit SHA]
 *
 * Exit codes: 0 = built, 1 = refused, 2 = it could not run.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  CONFIG_PATH,
  compactInstant,
  ENTRY_POINT,
  isCommit,
  MANIFEST_SCHEMA,
  parseReleaseId,
  releaseComment,
  releaseComments,
  releaseIdFor,
} from './frozen-spellings.mjs';

/**
 * @param {string} message
 * @returns {never}
 */
function cannotRun(message) {
  process.stderr.write(`build-release — cannot run: ${message}\n`);
  process.exit(2);
}

/**
 * @param {string} message
 * @returns {never}
 */
function refuse(message) {
  process.stderr.write(`build-release — refusing: ${message}\n`);
  process.exit(1);
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Byte-wise ascending, which is the one ordering rule this build has.
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function byBytes(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

/**
 * Run git and answer with its output, or `null` where it refused.
 *
 * @param {string} cwd
 * @param {readonly string[]} args
 * @returns {string | null}
 */
function git(cwd, args) {
  try {
    return execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Invocation
 * @property {string | null} tree
 * @property {string} out
 * @property {string | null} releaseId
 * @property {string | null} commit
 */

/**
 * @param {readonly string[]} argv
 * @returns {Invocation}
 */
function commandLine(argv) {
  /** @type {Invocation} */
  const invocation = { tree: null, out: 'release-build', releaseId: null, commit: null };
  let at = 0;
  while (at < argv.length) {
    const flag = argv[at];
    const value = argv[at + 1];
    if (value === undefined || value.startsWith('--')) {
      cannotRun(`${String(flag)} needs a value`);
    }
    if (flag === '--tree') {
      invocation.tree = value;
    } else if (flag === '--out') {
      invocation.out = value;
    } else if (flag === '--release-id') {
      invocation.releaseId = value;
    } else if (flag === '--commit') {
      invocation.commit = value;
    } else {
      cannotRun(`unknown argument: ${String(flag)}`);
    }
    at += 2;
  }
  return invocation;
}

// ---------------------------------------------------------------------------
// The source tree
// ---------------------------------------------------------------------------

/**
 * Every file under a directory, as tree-relative paths with forward slashes.
 *
 * @param {string} root
 * @param {string} [prefix]
 * @returns {string[]}
 */
function filesUnder(root, prefix = '') {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...filesUnder(root, relativePath));
      continue;
    }
    if (entry.isFile()) {
      found.push(relativePath);
    }
  }
  return found;
}

/** The entry document, as a tree-relative path. */
const ENTRY_SOURCE = ENTRY_POINT.slice(1);

/** The origin table, as a tree-relative path. */
const CONFIG_SOURCE = CONFIG_PATH.slice(1);

/**
 * The one occurrence of a pattern, or a refusal.
 *
 * @param {string} text
 * @param {RegExp} pattern A global pattern.
 * @param {string} what
 * @returns {RegExpMatchArray}
 */
function exactlyOne(text, pattern, what) {
  const found = [...text.matchAll(pattern)];
  if (found.length !== 1) {
    refuse(`the entry document carries ${found.length} ${what}, and exactly one is expected`);
  }
  const one = found[0];
  if (one === undefined) {
    refuse(`the entry document carries no ${what}`);
  }
  return one;
}

/** Every relative specifier this build rewrites, exactly. */
const SPECIFIER = /\.\/([A-Za-z0-9_-]+)\.js/g;

/** The stylesheet the entry document links, exactly as it is written. */
const STYLESHEET = /<link rel="stylesheet" href="([^"]*)" \/>/g;

/** The module the entry document loads, exactly as it is written. */
const MODULE_SCRIPT = /<script type="module" src="([^"]*)"><\/script>/g;

/**
 * @param {string} what
 * @returns {void}
 */
function say(what) {
  process.stdout.write(`${what}\n`);
}

/**
 * @returns {number} process exit code
 */
function main() {
  const invocation = commandLine(process.argv.slice(2));

  // The git context is the repository of the current working directory, never
  // the one this script happens to be checked out in. A rollback runs from a
  // worktree at an older commit, and the self-tests hand the drivers a scratch
  // repository the same way — by being in it.
  const toplevel = git(process.cwd(), ['rev-parse', '--show-toplevel']);

  const treeArgument = invocation.tree;
  if (treeArgument === null && toplevel === null) {
    cannotRun('there is no git repository here, so there is no site/ to build and no commit to record');
  }
  const tree = treeArgument === null ? join(String(toplevel), 'site') : resolve(treeArgument);
  if (!existsSync(tree)) {
    cannotRun(`${tree} does not exist`);
  }

  const realSite =
    toplevel !== null && realpathSync(tree) === realpathSync(join(toplevel, 'site'));

  // ------------------------------------------------------------------
  // Which commit this release records, and whether it may.
  // ------------------------------------------------------------------
  /** @type {string} */
  let commit;
  if (realSite) {
    const root = String(toplevel);
    const dirty = git(root, ['status', '--porcelain', '--', 'site']);
    if (dirty === null) {
      cannotRun('git could not report the state of site/');
    }
    if (dirty !== '') {
      refuse(
        `site/ carries uncommitted changes, and a release built from bytes no commit holds is a release nothing can be checked against:\n${dirty}`,
      );
    }
    if (invocation.commit === null) {
      const head = git(root, ['rev-parse', 'HEAD']);
      if (head === null) {
        cannotRun('git could not resolve HEAD');
      }
      commit = head;
    } else {
      const named = git(root, ['rev-parse', `${invocation.commit}^{commit}`]);
      if (named === null) {
        refuse(`git does not know the commit ${invocation.commit}`);
      }
      const theirs = git(root, ['rev-parse', `${invocation.commit}:site`]);
      const ours = git(root, ['rev-parse', 'HEAD:site']);
      if (theirs === null || ours === null) {
        refuse(`git could not resolve the site tree at ${invocation.commit} and at HEAD`);
      }
      if (theirs !== ours) {
        refuse(
          `the site tree at ${invocation.commit} is ${theirs} and at HEAD it is ${ours} — an explicit commit is a label on the bytes being built, and it is only true of them when the two trees are the same`,
        );
      }
      commit = named;
    }
  } else {
    if (invocation.commit === null) {
      cannotRun('a tree other than the repository\'s own site/ records no commit of its own, so --commit is required');
    }
    commit = invocation.commit;
  }

  if (!isCommit(commit)) {
    refuse(`${JSON.stringify(commit)} is not forty lowercase hex characters, and the manifest reader requires that`);
  }

  // ------------------------------------------------------------------
  // Which release this is.
  // ------------------------------------------------------------------
  //
  // Derived from the commit the manifest will record rather than from HEAD, so
  // that a permitted equal-trees --commit invocation cannot mint an identifier
  // whose suffix contradicts the manifest — which the frozen reader refuses.
  const releaseId = invocation.releaseId === null ? releaseIdFor(compactInstant(new Date()), commit) : invocation.releaseId;
  const parsed = parseReleaseId(releaseId);
  if (parsed === null) {
    refuse(`${JSON.stringify(releaseId)} is not a release identifier: the form is <UTC yyyymmddThhmmssZ>-<12 hex>`);
  }
  if (parsed.commitPrefix !== commit.slice(0, 12)) {
    refuse(
      `the release identifier carries the suffix ${parsed.commitPrefix} and the commit begins ${commit.slice(0, 12)}`,
    );
  }

  // ------------------------------------------------------------------
  // The source files, in the one order.
  // ------------------------------------------------------------------
  const sources = filesUnder(tree).sort(byBytes);
  if (sources.length === 0) {
    refuse(`${tree} holds no files`);
  }

  /** @type {Map<string, Buffer>} */
  const sourceBytes = new Map();
  for (const relativePath of sources) {
    sourceBytes.set(relativePath, readFileSync(join(tree, relativePath)));
  }

  /** @type {string[]} */
  const scripts = [];
  /** @type {string[]} */
  const styles = [];
  for (const relativePath of sources) {
    if (relativePath === ENTRY_SOURCE) {
      continue;
    }
    if (relativePath.endsWith('.js')) {
      scripts.push(relativePath);
      continue;
    }
    if (relativePath.endsWith('.css')) {
      styles.push(relativePath);
      continue;
    }
    refuse(
      `${relativePath} is neither the entry document nor a .js or .css file, and this build's layout is exactly those — an object of another class is a decision nobody has made`,
    );
  }

  if (!sourceBytes.has(ENTRY_SOURCE)) {
    refuse(`${tree} has no ${ENTRY_SOURCE}, and the entry point is always an object`);
  }
  if (!sourceBytes.has(CONFIG_SOURCE)) {
    refuse(`${tree} has no ${CONFIG_SOURCE}, and the release check binds the origin table at that path`);
  }

  // ------------------------------------------------------------------
  // The constructs this build refuses rather than guesses at.
  // ------------------------------------------------------------------
  for (const relativePath of sources) {
    const text = String(sourceBytes.get(relativePath));
    if (text.includes('../')) {
      refuse(`${relativePath} carries a ../ specifier, and this build resolves siblings only`);
    }
    if (relativePath.endsWith('.js') && /\bimport\s*\(/.test(text)) {
      refuse(`${relativePath} carries a dynamic import, whose target this build cannot resolve at build time`);
    }
    if (relativePath.endsWith('.css') && (text.includes('url(') || text.includes('@import'))) {
      refuse(`${relativePath} references another object from inside a stylesheet, and this build rewrites no stylesheet references`);
    }
  }

  // ------------------------------------------------------------------
  // The import graph, resolved against the sibling set.
  // ------------------------------------------------------------------
  /** @type {Map<string, string[]>} */
  const imports = new Map();
  for (const relativePath of scripts) {
    const text = String(sourceBytes.get(relativePath));
    const here = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '';
    /** @type {string[]} */
    const targets = [];
    for (const found of text.matchAll(SPECIFIER)) {
      const name = found[1];
      if (name === undefined) {
        continue;
      }
      const sibling = here === '' ? `${name}.js` : `${here}/${name}.js`;
      if (!sourceBytes.has(sibling)) {
        refuse(`${relativePath} names ./${name}.js and there is no such sibling in ${tree}`);
      }
      if (!targets.includes(sibling)) {
        targets.push(sibling);
      }
    }
    imports.set(relativePath, targets);
  }

  // ------------------------------------------------------------------
  // Bottom-up: every file after the files it imports.
  // ------------------------------------------------------------------
  /** @type {Map<string, 'open' | 'done'>} */
  const state = new Map();
  /** @type {string[]} */
  const order = [];

  /** @param {string} relativePath @param {string[]} stack */
  const visit = (relativePath, stack) => {
    const held = state.get(relativePath);
    if (held === 'done') {
      return;
    }
    if (held === 'open') {
      refuse(`the import graph has a cycle: ${[...stack, relativePath].join(' -> ')}`);
    }
    state.set(relativePath, 'open');
    for (const target of imports.get(relativePath) ?? []) {
      visit(target, [...stack, relativePath]);
    }
    state.set(relativePath, 'done');
    order.push(relativePath);
  };

  for (const relativePath of scripts) {
    visit(relativePath, []);
  }

  // ------------------------------------------------------------------
  // The rewrite, and the served path each object ends up at.
  // ------------------------------------------------------------------
  /** @type {Map<string, string>} */
  const servedPath = new Map();
  /** @type {Map<string, Buffer>} */
  const built = new Map();

  servedPath.set(CONFIG_SOURCE, CONFIG_PATH);

  for (const relativePath of styles) {
    const bytes = sourceBytes.get(relativePath);
    if (bytes === undefined) {
      cannotRun(`${relativePath} disappeared while it was being read`);
    }
    const digest = sha256Hex(bytes);
    built.set(relativePath, bytes);
    servedPath.set(relativePath, `/assets/${digest}.css`);
  }

  for (const relativePath of order) {
    const bytes = sourceBytes.get(relativePath);
    if (bytes === undefined) {
      cannotRun(`${relativePath} disappeared while it was being read`);
    }
    const text = bytes.toString('utf8');
    const here = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '';
    const rewritten = text.replace(SPECIFIER, (whole, name) => {
      const sibling = here === '' ? `${String(name)}.js` : `${here}/${String(name)}.js`;
      const served = servedPath.get(sibling);
      if (served === undefined) {
        // Bottom-up means every sibling already has one. Reaching here at all
        // would mean the ordering was wrong rather than the tree.
        refuse(`${relativePath} names ${String(whole)} and its target has no served path yet`);
      }
      return served;
    });
    if (rewritten.includes('./')) {
      refuse(
        `${relativePath} still carries a ./ specifier after the rewrite — every one of them is resolved or this build refuses itself`,
      );
    }
    const output = Buffer.from(rewritten, 'utf8');
    built.set(relativePath, output);
    if (relativePath === CONFIG_SOURCE) {
      if (Buffer.compare(output, bytes) !== 0) {
        refuse(
          'the origin table came out of the rewrite different from the bytes it went in as, and the release check binds those bytes three ways',
        );
      }
      continue;
    }
    servedPath.set(relativePath, `/assets/${sha256Hex(output)}.js`);
  }

  // ------------------------------------------------------------------
  // The entry document.
  // ------------------------------------------------------------------
  const entrySource = sourceBytes.get(ENTRY_SOURCE);
  if (entrySource === undefined) {
    cannotRun(`${ENTRY_SOURCE} disappeared while it was being read`);
  }
  let entryText = entrySource.toString('utf8');

  /**
   * @param {string} reference As the document writes it.
   * @returns {string} The served path it becomes.
   */
  const servedFor = (reference) => {
    const relativePath = reference.startsWith('./') ? reference.slice(2) : reference;
    if (relativePath.startsWith('/') || relativePath.includes('../')) {
      refuse(`the entry document references ${JSON.stringify(reference)}, and this build resolves tree-relative references only`);
    }
    const served = servedPath.get(relativePath);
    if (served === undefined) {
      refuse(`the entry document references ${JSON.stringify(reference)} and no such object is in ${tree}`);
    }
    return served;
  };

  const stylesheet = exactlyOne(entryText, STYLESHEET, 'stylesheet link(s)');
  entryText = entryText.replace(String(stylesheet[0]), `<link rel="stylesheet" href="${servedFor(String(stylesheet[1]))}" />`);

  const moduleScript = exactlyOne(entryText, MODULE_SCRIPT, 'module script(s)');
  entryText = entryText.replace(
    String(moduleScript[0]),
    `<script type="module" src="${servedFor(String(moduleScript[1]))}"></script>`,
  );

  const closes = [...entryText.matchAll(/<\/html>/g)];
  if (closes.length !== 1) {
    refuse(`the entry document carries ${closes.length} </html> tag(s), and the release comment is stamped after exactly one`);
  }
  const close = closes[0];
  if (close === undefined || close.index === undefined) {
    refuse('the entry document carries no </html> tag');
  }
  const cut = close.index + '</html>'.length;
  entryText = `${entryText.slice(0, cut)}\n${releaseComment(releaseId)}${entryText.slice(cut)}`;

  const stamped = releaseComments(entryText);
  if (stamped.length !== 1 || stamped[0] !== releaseId) {
    refuse(
      `the built entry document carries ${stamped.length} release comment(s) ${JSON.stringify(stamped)}, and exactly one naming ${releaseId} is expected`,
    );
  }

  const entryBytes = Buffer.from(entryText, 'utf8');
  built.set(ENTRY_SOURCE, entryBytes);
  servedPath.set(ENTRY_SOURCE, ENTRY_POINT);

  // ------------------------------------------------------------------
  // Writing it out.
  // ------------------------------------------------------------------
  const releaseDir = resolve(invocation.out, releaseId);
  if (existsSync(releaseDir)) {
    refuse(`${releaseDir} already exists — a build writes a release once, and overwriting one is not a thing this does quietly`);
  }
  const layoutDir = join(releaseDir, 'layout');

  /** @type {Record<string, string>} */
  const objects = {};
  const servedOrder = [...servedPath.values()].sort(byBytes);
  /** @type {Map<string, string>} */
  const sourceOf = new Map();
  for (const [relativePath, served] of servedPath.entries()) {
    sourceOf.set(served, relativePath);
  }

  for (const served of servedOrder) {
    const relativePath = sourceOf.get(served);
    if (relativePath === undefined) {
      cannotRun(`${served} has no source`);
    }
    const bytes = built.get(relativePath);
    if (bytes === undefined) {
      cannotRun(`${served} was never built`);
    }
    const target = join(layoutDir, served.slice(1));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    // The digest is over the object's identity bytes — the object as it is,
    // before any transfer coding is applied to it. Source:
    // scripts/release-check-core/manifest.mjs.
    objects[served] = sha256Hex(bytes);
  }

  const manifest = {
    schema: MANIFEST_SCHEMA,
    commit,
    release_id: releaseId,
    objects,
  };
  writeFileSync(join(releaseDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  say(`build-release — ${releaseId} at ${commit}`);
  say(`  layout   ${layoutDir}`);
  say(`  manifest ${join(releaseDir, 'manifest.json')}`);
  for (const served of servedOrder) {
    say(`  ${served}`);
  }
  return 0;
}

process.exit(main());
