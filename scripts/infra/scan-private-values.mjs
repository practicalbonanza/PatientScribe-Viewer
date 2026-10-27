/**
 * Refuse a public tree that has a private value in it.
 *
 * Usage:
 *   node scripts/infra/scan-private-values.mjs            scans the tree
 *   node scripts/infra/scan-private-values.mjs <dir>...   scans the given paths
 *   node scripts/infra/scan-private-values.mjs --overlay <path> [<dir>...]
 *                                                         the same, looking for
 *                                                         the values of the
 *                                                         overlay at <path>
 *   node scripts/infra/scan-private-values.mjs --self-test
 *
 * Exit codes: 0 = clean, 1 = something matched, 2 = the scan could not run.
 *
 * The templates in this repository are public and the values they are deployed
 * with are not. That split only holds if something checks it, because it is the
 * kind of thing that stays true for as long as everyone remembers it and then
 * quietly stops.
 *
 * Two deploy-time values are exceptions to the second half of that, and they
 * are named here rather than taught to the code below. `ApiOrigin` and
 * `DomainName` are supplied from the overlay like the others and are public by
 * design. `ApiOrigin` rides the `connect-src` of the security policy on every
 * response the hosting serves, and the served bytes carry it too — in the
 * committed origin table, which decides where a share code travels, and in the
 * entry document's own policy, which has to permit what that table decides.
 * `DomainName` is the alias the production viewer is served under, and the
 * served bytes carry it as well: it is the origin the committed table is keyed
 * on for that flavour, written there with its scheme, because it is the address
 * in every production share link. A development overlay's `DomainName` is empty,
 * and an empty value is never looked for, so only an overlay that carries one
 * reports it. So a run with an overlay that carries them reports each at every
 * file that carries it, and those reports are an expected set that is
 * adjudicated at review. No allowlist is added for either: the allowlist here is
 * consulted only for the pattern rules, and an entry that looked like it held
 * would in fact have said nothing at all about a CHANGED value. What catches
 * that is the release check, which derives its expected `connect-src` from the
 * committed table and compares it against the live response header. Which
 * parameter a value came from is carried this far, for the report only: a report
 * names its parameter when the public template declares that name, and never its
 * value. Nothing is skipped by parameter except the three at
 * TEMPLATE_STATED_VALUES, and only for values the public template itself states
 * for each: `Environment`'s allowed values, `AccessLogRetentionDays` within its
 * bounds, and `RequestCountAlarmThreshold`'s default.
 *
 * Which overlay is read. By default the one at `infra/parameters.json`, if it
 * has been created locally at all, exactly as it always has been. `--overlay`
 * names another — the drivers take the same option, because an overlay need not
 * live in the checkout — and it changes which VALUES are looked for, never which
 * files are read. A named overlay is held to more than the default one: a path
 * that is not there, or a file that is not a parameters array, is a run that
 * cannot say what it was looking for, and it exits 2 rather than scanning for
 * nothing and calling the tree clean.
 *
 * The file set is `git ls-files --cached --others --exclude-standard`: the
 * tracked tree, plus every untracked file that is not ignored. The second half
 * matters more than it looks. A scan of the tracked tree alone would say nothing
 * about work in progress — which is exactly when a value gets pasted somewhere to
 * see if it works — and the ignored files are excluded because that is where the
 * private values are supposed to be.
 *
 * Two scopes, because two of these rules would be wrong applied everywhere.
 *
 * Tree-wide: account-number shapes, literal ARNs, and AWS key shapes. Those are
 * private wherever they appear and there is no legitimate reason for one to be in
 * a public file.
 *
 * This directory and `infra/` only: e-mail addresses. An ops contact leaking into
 * a deploy template is a real thing to catch, and it would land here. Applied
 * tree-wide the rule would be noise: the test fixtures elsewhere carry synthetic
 * addresses on purpose, they are part of what those tests are for, and a scan
 * that has to be taught about them one by one is a scan that gets an allowlist
 * instead of a rule.
 *
 * The allowlist is visible, it is short, and every entry says why it is there. It
 * is not a suppression mechanism: it names two lines, both of them a fixture's
 * placeholder release identifier ending in twelve zeros, and both in files this
 * round may not touch. Twelve zeros is not an account number, but it is the shape
 * of one, and the honest thing is to say so here rather than to weaken the rule
 * until it stops noticing.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Where the deploy overlay lives by default, if it has been created locally at
 * all. `--overlay` names another; see `resolveArguments`.
 */
const OVERLAY = join(REPO_ROOT, 'infra', 'parameters.json');

/**
 * The public template, whose parameter names are the only keys a report may
 * print.
 */
const TEMPLATE = join(REPO_ROOT, 'infra', 'viewer-stack.yaml');

/**
 * The directories the e-mail rule applies to, relative to the repository root.
 *
 * @type {readonly string[]}
 */
const CONTACT_SCOPE = Object.freeze(['infra/', 'scripts/infra/']);

/**
 * @typedef {object} Rule
 * @property {string} name
 * @property {RegExp} pattern
 * @property {string} why
 * @property {boolean} contactScopeOnly
 */

/**
 * The rules, and the reasoning each one is shaped by.
 *
 * @type {readonly Rule[]}
 */
export const RULES = Object.freeze([
  {
    name: 'account-number',
    // Bounded by non-alphanumerics rather than by non-digits, and that is the
    // whole difference between a rule and a nuisance. This tree is full of
    // 64-character hex digests, and a twelve-digit run happens inside one of
    // them regularly — `…b611027167765a…` is twelve digits with a letter either
    // side. An account number is a token, so the boundaries are the token's.
    //
    // The residual of that choice, stated rather than left to be discovered: an
    // account number pasted *inside* an alphanumeric token — appended to a
    // digest, or run together with a word — does not match. That is accepted.
    // The alternative reddens on ordinary content in this repository, and a rule
    // that reddens on ordinary content is a rule that gets an allowlist bolted
    // to it until it means nothing. An account number written where a leak would
    // actually put it — a value, a parameter, an ARN, a bucket name — is a token
    // and is caught.
    pattern: /(?<![0-9A-Za-z])[0-9]{12}(?![0-9A-Za-z])/g,
    why: 'a twelve-digit token is the shape of an account number',
    contactScopeOnly: false,
  },
  {
    name: 'arn',
    // A literal AWS partition after `arn:`. That admits every real ARN and
    // excludes the two things in this repository that look like one and are not:
    // a CloudFormation ARN built through `${AWS::Partition}`, which is a
    // template rather than a value, and a parameter's AllowedPattern, which is a
    // regular expression describing ARNs rather than being one.
    pattern: /arn:aws[a-z-]*:/g,
    why: 'a literal ARN names a real resource in a real account',
    contactScopeOnly: false,
  },
  {
    name: 'access-key-id',
    pattern: /(?<![0-9A-Za-z])(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Za-z])/g,
    why: 'that is the shape of an access key identifier',
    contactScopeOnly: false,
  },
  {
    name: 'secret-assignment',
    // Named credentials being assigned, rather than a guess at what a secret
    // looks like. A rule that matched "a long random-looking string" would match
    // every digest in this repository and would have to be defeated to be
    // usable.
    pattern: /\b(?:aws_secret_access_key|aws_session_token|aws_access_key_id)\b\s*[=:]/gi,
    why: 'a credential is being assigned a value',
    contactScopeOnly: false,
  },
  {
    name: 'contact-address',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[A-Za-z]/g,
    why: 'an address here would be an ops contact, and this surface is public',
    contactScopeOnly: true,
  },
]);

/**
 * @typedef {object} AllowlistEntry
 * @property {string} file
 * @property {string} rule
 * @property {string} match
 * @property {string} justification
 */

/**
 * Twelve zeros, assembled rather than typed.
 *
 * This file is inside the set it scans, which is deliberate — a scanner exempt
 * from its own rules is a blind spot in the shape of a scanner. The cost is that
 * every example in here has to be built out of pieces, because a literal one
 * would be a finding about this file. It reads slightly awkwardly and it is the
 * honest arrangement: the alternative is an exemption, and an exemption is
 * exactly what the tree-wide rules exist to avoid handing out.
 */
const TWELVE_ZEROS = '0'.repeat(12);

/**
 * The carve-outs, in full.
 *
 * Two entries. Both are the same thing in two files: a test fixture's synthetic
 * release identifier, whose trailing field is twelve zeros. It is a placeholder
 * standing in for a commit-shaped value, it is not an account number, and both
 * files are inside the frozen set this round cannot edit — so the choice is to
 * name them here or to blunt the rule, and naming them is the one that leaves
 * the rule intact.
 *
 * @type {readonly AllowlistEntry[]}
 */
export const ALLOWLIST = Object.freeze([
  {
    file: 'scripts/check-release-core.mjs',
    rule: 'account-number',
    match: TWELVE_ZEROS,
    justification:
      'the trailing field of a fixture\'s synthetic release identifier, which is twelve zeros standing in for a commit-shaped value; not an account',
  },
  {
    file: 'scripts/run-release-tests.mjs',
    rule: 'account-number',
    match: TWELVE_ZEROS,
    justification:
      'the same synthetic release identifier in the release-test fixture corpus; a placeholder, not an account',
  },
]);

/**
 * @param {string} file Repository-relative, forward slashes.
 * @param {string} rule
 * @param {string} match
 * @returns {boolean}
 */
function allowed(file, rule, match) {
  return ALLOWLIST.some((entry) => entry.file === file && entry.rule === rule && entry.match === match);
}

/**
 * @param {string} file Repository-relative.
 * @returns {boolean}
 */
function inContactScope(file) {
  return CONTACT_SCOPE.some((prefix) => file.startsWith(prefix));
}

/**
 * The parameters whose values are not looked for, each with the values of it
 * that are skipped: exactly the values the public template itself states.
 *
 * `Environment` is skipped when it is one of its `AllowedValues`, `dev` or
 * `prod`; `AccessLogRetentionDays` when it is a plain integer within its
 * `MinValue` and `MaxValue`, 1 to 30, written without a leading zero; and
 * `RequestCountAlarmThreshold` when it is exactly its `Default`, `10000`. Each of
 * those is in the public template already, and looking for `prod`, `dev` or
 * `10000` as a substring of every line buries every other report under hundreds
 * of ordinary words and numbers. Every other value of these three parameters is
 * looked for like any other value.
 *
 * Exactly three, by name, here and nowhere else. Every other parameter's value
 * is looked for, whatever it is.
 *
 * @type {Readonly<Record<string, RegExp>>}
 */
export const TEMPLATE_STATED_VALUES = Object.freeze({
  Environment: /^(?:dev|prod)$/,
  AccessLogRetentionDays: /^(?:[1-9]|[12][0-9]|30)$/,
  RequestCountAlarmThreshold: /^10000$/,
});

/**
 * Whether a value is one the public template itself states for its parameter.
 *
 * @param {string} key
 * @param {string} value
 * @returns {boolean}
 */
function statedByTemplate(key, value) {
  if (!Object.prototype.hasOwnProperty.call(TEMPLATE_STATED_VALUES, key)) {
    return false;
  }
  const stated = TEMPLATE_STATED_VALUES[key];
  return stated !== undefined && stated.test(value);
}

/**
 * The parameter names a template declares: the keys directly under its
 * top-level `Parameters:`.
 *
 * Read by lines rather than by a YAML library, because the shape is this
 * repository's own and narrow: `Parameters:` alone on a line at the left margin;
 * each name on a line of its own, exactly two spaces in, ending in its colon;
 * and the block ending at the next line that starts at the left margin and is
 * not a comment. A line nested deeper is a property of a parameter, not a name.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function templateParameterNames(text) {
  /** @type {Set<string>} */
  const names = new Set();
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    if (!inside) {
      inside = line === 'Parameters:';
      continue;
    }
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    if (!line.startsWith(' ')) {
      break;
    }
    const named = /^ {2}([A-Za-z0-9]+):\s*$/.exec(line);
    if (named !== null && named[1] !== undefined) {
      names.add(named[1]);
    }
  }
  return names;
}

/**
 * The parameter names the template at `file` declares, read once per run — or
 * `null` where it cannot be read or declares none, in which case no report
 * names a parameter at all.
 *
 * @param {string} [file]
 * @returns {Set<string> | null}
 */
export function declaredParameterNames(file = TEMPLATE) {
  try {
    const names = templateParameterNames(readFileSync(file, 'utf8'));
    return names.size > 0 ? names : null;
  } catch {
    return null;
  }
}

/**
 * One value out of an overlay, with what its report may say about where it came
 * from: the parameter's name when the public template declares it, the entry's
 * position when it does not, and nothing when the template could not be read.
 * The value itself never goes to the report.
 *
 * @typedef {object} OverlayValue
 * @property {string} value
 * @property {string | null} shown
 */

/**
 * The values an overlay carries that are looked for, each with what its report
 * may name — or why the overlay cannot say. The one place both overlays are
 * read from, so the rules below hold for both.
 *
 *   - The empty string is skipped: it is how a dev overlay says a prod-only
 *     parameter has no value, and every line contains it.
 *   - Anything carrying the example file's `REPLACE-ME` marker is skipped: it is
 *     a placeholder, public by construction.
 *   - A value at TEMPLATE_STATED_VALUES is skipped.
 *   - A key is named only when the template declares it. Otherwise the report
 *     names the entry's index: a key that is not a declared name may be anything
 *     at all, a value pasted into the wrong slot included, and this tool does
 *     not print what it cannot show is public.
 *
 * Strict, for an overlay named on the command line: a document that is not a
 * parameters array, or an entry that is not a string `ParameterKey` and a string
 * `ParameterValue`, is a reason. Lenient, for the default overlay: those are
 * skipped, as they always have been.
 *
 * @param {unknown} parsed
 * @param {{ strict: boolean, declared: ReadonlySet<string> | null }} how
 * @returns {{ values: OverlayValue[] } | { why: string }}
 */
export function extractOverlayValues(parsed, { strict, declared }) {
  if (!Array.isArray(parsed)) {
    return strict ? { why: 'is not a parameters array' } : { values: [] };
  }
  /** @type {OverlayValue[]} */
  const values = [];
  for (const [index, entry] of parsed.entries()) {
    const record =
      entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        ? /** @type {Record<string, unknown>} */ (entry)
        : null;
    const key = record === null ? undefined : record['ParameterKey'];
    const value = record === null ? undefined : record['ParameterValue'];
    if (strict && (typeof key !== 'string' || typeof value !== 'string')) {
      return { why: `carries an entry, at ${index}, that is not a ParameterKey and a ParameterValue` };
    }
    if (typeof value !== 'string') {
      continue;
    }
    const name = typeof key === 'string' ? key : '';
    if (value === '' || value.startsWith('REPLACE-ME') || statedByTemplate(name, value)) {
      continue;
    }
    /** @type {string | null} */
    let shown = null;
    if (declared !== null) {
      shown = declared.has(name) ? name : `the entry at index ${index}, whose ParameterKey the template does not declare`;
    }
    values.push({ value, shown });
  }
  return { values };
}

/**
 * Every literal value the local overlay carries, if there is one.
 *
 * The overlay is ignored by git and is never in the scanned set, so this does not
 * read it to check it — it reads it to learn what a leak of it would look like.
 *
 * Every value is taken. There is no minimum length, and there used to be: values
 * shorter than eight characters were dropped as too noisy to match on, which
 * quietly meant a short `LogOpsPrefix` — the most likely short value on the whole
 * roster — was the one thing this rule could not have caught. Noise is a reason
 * to look at a finding, not a reason to not produce it.
 *
 * Which values are skipped, and what a report of the others may name, is decided
 * by `extractOverlayValues`, leniently: a default overlay that is missing, is
 * not JSON or is not an array carries no values.
 *
 * @param {ReadonlySet<string> | null} declared The template's parameter names.
 * @param {string} [file] The default path unless the self-test names a fixture.
 * @returns {OverlayValue[]}
 */
export function overlayValues(declared, file = OVERLAY) {
  /** @type {string} */
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const read = extractOverlayValues(parsed, { strict: false, declared });
  return 'why' in read ? [] : read.values;
}

/**
 * Every literal value an overlay NAMED on the command line carries — or why
 * this run cannot say.
 *
 * The same values `overlayValues` takes, through the same extractor, out of a
 * file somebody pointed this run at. The difference is what a problem with
 * the file means. The default overlay is optional: a checkout without one is
 * how this runs in CI, and a missing file there is the ordinary case. A named
 * one is not optional — somebody said which values to look for — so a path that
 * is not there, a file that is not JSON, and a document that is not a
 * parameters array are each a reason this run cannot say what it was looking
 * for, and the caller exits 2 on it rather than scanning for nothing and
 * reporting a clean tree.
 *
 * A parameters array is what the CLI reads: an array of objects, each carrying
 * a string `ParameterKey` and a string `ParameterValue`. An empty array is one,
 * and it carries no values.
 *
 * @param {string} file
 * @param {ReadonlySet<string> | null} declared The template's parameter names.
 * @returns {{ values: OverlayValue[] } | { why: string }}
 */
export function namedOverlayValues(file, declared) {
  /** @type {string} */
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { why: `the overlay ${file} cannot be read` };
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { why: `the overlay ${file} is not JSON` };
  }
  const read = extractOverlayValues(parsed, { strict: true, declared });
  return 'why' in read ? { why: `the overlay ${file} ${read.why}` } : read;
}

/**
 * What a run was asked to do, read off its command line.
 *
 * A pure function of the arguments and the working directory — nothing here
 * touches the disk — so the self-test can ask where a run WOULD look for its
 * overlay without any run looking there. That matters because the default path
 * is where a real overlay lives, and a test that found out by running would be
 * a test that reads one.
 *
 * `--overlay <path>` names the overlay, absolute or relative to the working
 * directory, at most once. Every other argument is a path to scan, exactly as
 * before the option existed, and without it the overlay is the default one.
 *
 * @param {readonly string[]} args The arguments after the script's own path.
 * @param {string} [cwd]
 * @returns {{ overlay: string, named: boolean, paths: string[] } | { why: string }}
 */
export function resolveArguments(args, cwd = process.cwd()) {
  let overlay = OVERLAY;
  let named = false;
  /** @type {string[]} */
  const paths = [];
  for (let at = 0; at < args.length; at += 1) {
    const one = String(args[at]);
    if (one !== '--overlay') {
      paths.push(one);
      continue;
    }
    const value = args[at + 1];
    if (value === undefined || value === '') {
      return { why: '--overlay needs a path' };
    }
    if (named) {
      return { why: '--overlay is given more than once, and a run looks for the values of one overlay' };
    }
    overlay = resolve(cwd, value);
    named = true;
    at += 1;
  }
  return { overlay, named, paths };
}

/**
 * @typedef {object} Violation
 * @property {string} file
 * @property {number} line
 * @property {string} rule
 * @property {string} why
 * @property {string} match
 */

/**
 * @param {string} file Repository-relative path, used for scoping and reporting.
 * @param {string} contents
 * @param {readonly OverlayValue[]} secrets Literal values that must not appear,
 *   each with what its report may name.
 * @returns {Violation[]}
 */
export function scanText(file, contents, secrets) {
  /** @type {Violation[]} */
  const violations = [];
  const lines = contents.split('\n');

  for (const [index, line] of lines.entries()) {
    for (const rule of RULES) {
      if (rule.contactScopeOnly && !inContactScope(file)) {
        continue;
      }
      rule.pattern.lastIndex = 0;
      for (const found of line.matchAll(rule.pattern)) {
        const text = found[0];
        if (allowed(file, rule.name, text)) {
          continue;
        }
        violations.push({ file, line: index + 1, rule: rule.name, why: rule.why, match: text });
      }
    }

    for (const secret of secrets) {
      if (line.includes(secret.value)) {
        violations.push({
          file,
          line: index + 1,
          rule: 'overlay-value',
          why: 'this is a literal value out of the deploy overlay',
          match: secret.shown === null ? '(withheld)' : `(withheld: ${secret.shown})`,
        });
      }
    }
  }

  return violations;
}

/**
 * The intended-public file set.
 *
 * @param {string[]} paths Optional explicit roots; empty means the whole tree.
 * @returns {string[]} Repository-relative paths.
 */
function fileSet(paths) {
  /** @type {string} */
  let listing;
  try {
    listing = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    process.stderr.write(`scan-private-values — cannot run: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }

  const all = listing.split('\n').filter((line) => line !== '');
  if (paths.length === 0) {
    return all;
  }
  const roots = paths.map((path) => relative(REPO_ROOT, resolve(path)).split('\\').join('/'));
  return all.filter((file) => roots.some((root) => file === root || file.startsWith(`${root}/`)));
}

/**
 * @param {string[]} paths
 * @param {{ overlay: string, named: boolean }} [which] The overlay whose values
 *   are looked for; the default one unless a run named another.
 * @returns {number} process exit code
 */
function scan(paths, which = { overlay: OVERLAY, named: false }) {
  const files = fileSet(paths);

  // The template's parameter names, read once: a report names a parameter only
  // when it is one of them.
  const declared = declaredParameterNames();
  if (declared === null) {
    process.stdout.write(
      'scan-private-values — the template\'s parameter names could not be read, so no report names the parameter it came from\n',
    );
  }

  /** @type {OverlayValue[]} */
  let secrets;
  let source = 'the local overlay';
  if (which.named) {
    const read = namedOverlayValues(which.overlay, declared);
    if ('why' in read) {
      process.stderr.write(`scan-private-values — cannot run: ${read.why}, so this run cannot say which values it is looking for\n`);
      return 2;
    }
    secrets = read.values;
    source = 'the overlay named on the command line';
  } else {
    secrets = overlayValues(declared);
  }

  /** @type {Violation[]} */
  const violations = [];
  let scanned = 0;

  for (const file of files) {
    /** @type {string} */
    let contents;
    try {
      contents = readFileSync(join(REPO_ROOT, file), 'utf8');
    } catch {
      // A path git lists but this cannot read as text — a directory entry, a
      // deleted file, something binary. Not a finding, and not a reason to stop.
      continue;
    }
    scanned += 1;
    violations.push(...scanText(file, contents, secrets));
  }

  // An empty file set is a failure, not a pass.
  //
  // A scan of nothing finds nothing, and the report it writes is indistinguishable
  // from the report of a clean tree — which makes a mistyped path, a filter that
  // stopped matching, or a `git ls-files` that answered with nothing look exactly
  // like success. The one thing this run can be certain of is that it proved
  // nothing, so that is what it says.
  if (scanned === 0) {
    process.stderr.write(
      `scan-private-values — cannot scan: the file set resolved to zero files${paths.length > 0 ? ` under ${paths.join(', ')}` : ''}, so this run proved nothing\n`,
    );
    return 2;
  }

  process.stdout.write(
    `scan-private-values — scanned ${scanned} file(s) against ${RULES.length} rules` +
      `${secrets.length > 0 ? `, plus ${secrets.length} literal value(s) from ${source}` : ''}\n`,
  );

  if (violations.length === 0) {
    process.stdout.write('PASS — no private value appears in any public file\n');
    return 0;
  }

  process.stdout.write(`FAIL — ${violations.length} finding(s):\n\n`);
  for (const violation of violations) {
    process.stdout.write(`  ${violation.file}:${violation.line}  [${violation.rule}] — ${violation.why}\n`);
    process.stdout.write(`      ${violation.match}\n`);
  }
  process.stdout.write('\nThere is no suppression flag. Move the value into the overlay.\n');
  return 1;
}

// ---------------------------------------------------------------------------
// The self-test
// ---------------------------------------------------------------------------

/**
 * Both directions of every rule, plus the allowlist.
 *
 * The seeded violations are written to a temporary directory and scanned through
 * `scanText` under the repository-relative names the scoping rules care about,
 * because the name is an input: the e-mail rule fires on `infra/…` and not on
 * `test/…`, and a self-test that only ever passed one kind of name would not
 * have noticed if that had stopped being true.
 *
 * @returns {number} process exit code
 */
function selfTest() {
  let failures = 0;

  /**
   * @param {string} label
   * @param {boolean} held
   * @param {string} detail
   */
  function record(label, held, detail) {
    if (held) {
      process.stdout.write(`  ok   ${label}\n`);
      return;
    }
    failures += 1;
    process.stdout.write(`  FAIL ${label} — ${detail}\n`);
  }

  // Every seed is assembled from pieces, for the reason given at TWELVE_ZEROS:
  // this file is scanned by the rules it defines, so a seed written out in full
  // would be a finding about the self-test rather than a test of it.
  const digits = `${'1234'}${'5678'}${'9012'}`;
  const partition = `arn:${'aws'}:sns:us-east-1:`;
  const keyId = `${'AK'}${'IAIOSFODNN7EXAMPLE'}`;
  const secretName = `${'aws_secret'}${'_access_key'}`;
  const address = `someone.else${'@'}example.test`;

  /** @type {{rule: string, file: string, line: string}[]} */
  const seeded = [
    { rule: 'account-number', file: 'infra/seeded.yaml', line: `  Value: ${digits}` },
    { rule: 'arn', file: 'infra/seeded.yaml', line: `  Topic: ${partition}${digits}:viewer` },
    { rule: 'access-key-id', file: 'infra/seeded.yaml', line: `  Key: ${keyId}` },
    { rule: 'secret-assignment', file: 'infra/seeded.yaml', line: `${secretName} = something` },
    { rule: 'contact-address', file: 'infra/seeded.yaml', line: `# owner: ${address}` },
  ];

  for (const seed of seeded) {
    const found = scanText(seed.file, seed.line, []);
    record(
      `a seeded ${seed.rule} reddens`,
      found.some((violation) => violation.rule === seed.rule),
      `nothing matched; got ${JSON.stringify(found.map((v) => v.rule))}`,
    );
  }

  // The contact rule's scope, both ways round. The same line in a test fixture
  // is not this scan's business.
  const outOfScope = scanText('test/node/example.test.mjs', `# owner: ${address}`, []);
  record(
    'an address outside infra/ and scripts/infra/ is left alone',
    outOfScope.length === 0,
    `got ${JSON.stringify(outOfScope.map((v) => v.rule))}`,
  );

  const inScope = scanText('scripts/infra/example.sh', `# owner: ${address}`, []);
  record(
    'an address inside scripts/infra/ reddens',
    inScope.some((violation) => violation.rule === 'contact-address'),
    'nothing matched',
  );

  // The allowlist: the exact line it names passes, and the same shape in any
  // other file does not.
  const fixtureLine = `    release_id: '20260101T000000Z-${TWELVE_ZEROS}',`;

  const allowlisted = scanText('scripts/check-release-core.mjs', fixtureLine, []);
  record('the allowlisted fixture line passes', allowlisted.length === 0, `got ${JSON.stringify(allowlisted)}`);

  const notAllowlisted = scanText('infra/viewer-stack.yaml', fixtureLine, []);
  record(
    'the same shape in a file the allowlist does not name still reddens',
    notAllowlisted.some((violation) => violation.rule === 'account-number'),
    'nothing matched',
  );

  // A digest is not an account number, which is the false positive this rule was
  // shaped around.
  const digestLine = scanText(
    'infra/example.txt',
    'ea7c7b25a957a705133f307f5e2c2ea8efff0fd05eae2cb611027167765a2170  manifest.mjs',
    [],
  );
  record('a hex digest carrying a twelve-digit run is left alone', digestLine.length === 0, `got ${JSON.stringify(digestLine)}`);

  // A CloudFormation-built ARN and a pattern describing one are both templates
  // rather than values.
  const intrinsic = scanText(
    'infra/viewer-stack.yaml',
    "  'AWS:SourceArn': !Sub 'arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${Distribution}'",
    [],
  );
  record('an ARN built by CloudFormation is left alone', intrinsic.length === 0, `got ${JSON.stringify(intrinsic)}`);

  const allowedPattern = scanText(
    'infra/viewer-stack.yaml',
    "    AllowedPattern: '^$|^arn:[a-z0-9-]+:acm:us-east-1:[0-9]{12}:certificate/.+$'",
    [],
  );
  record('a pattern describing an ARN is left alone', allowedPattern.length === 0, `got ${JSON.stringify(allowedPattern)}`);

  // The overlay-value rule, which only has anything to say when an overlay
  // exists locally.
  const leaked = scanText('infra/README.md', 'the bucket is viewer-origin-abcdefghij', [
    { shown: 'OriginBucketName', value: 'viewer-origin-abcdefghij' },
  ]);
  record(
    'a literal overlay value reddens wherever it appears',
    leaked.some((violation) => violation.rule === 'overlay-value'),
    'nothing matched',
  );

  record(
    'the overlay value is not echoed into the report, and the parameter it came from is',
    leaked.length > 0 &&
      leaked.every((violation) => !violation.match.includes('viewer-origin') && violation.match === '(withheld: OriginBucketName)'),
    `the finding read ${JSON.stringify(leaked.map((violation) => violation.match))}`,
  );

  // ------------------------------------------------------------------
  // The template's parameter names, and the one extractor both overlays use.
  // ------------------------------------------------------------------
  //
  // The reader first, on lines written here, then on the template itself.
  const sampleTemplate = [
    'Description: not a parameter',
    'Parameters:',
    '  # a comment inside the block',
    '  First:',
    '    Type: String',
    '',
    '# a comment at the margin, still inside',
    '  Second:',
    '    Default: Third',
    'Conditions:',
    '  NotAParameter: !Equals [a, b]',
  ].join('\n');
  record(
    'the template reader takes the names directly under Parameters and nothing else',
    [...templateParameterNames(sampleTemplate)].join(',') === 'First,Second',
    JSON.stringify([...templateParameterNames(sampleTemplate)]),
  );
  const declared = declaredParameterNames();
  record(
    'the real template declares the parameters an overlay carries',
    declared !== null &&
      ['Environment', 'ApiOrigin', 'AccountId', 'LogOpsPrefix', 'DomainName', 'RequestCountAlarmThreshold', 'AccessLogRetentionDays'].every(
        (name) => declared.has(name),
      ),
    JSON.stringify(declared === null ? null : [...declared]),
  );
  record(
    'a template that cannot be read declares nothing, rather than an empty set a report could be checked against',
    declaredParameterNames(join(tmpdir(), `viewer-scan-no-template-${process.pid}.yaml`)) === null,
    'it answered something',
  );

  // A value pasted into the key slot, assembled for the reason every seed is.
  const undeclaredKey = `${'synthetic'}-${'bucket'}-${'7f3a'}`;
  const markerValue = `${'public'}-${'marker'}-${'for'}-${'this'}-${'case'}`;
  /** @type {readonly unknown[]} */
  const extractable = [
    { ParameterKey: 'OriginBucketName', ParameterValue: 'viewer-origin-abcdefghij' },
    { ParameterKey: undeclaredKey, ParameterValue: markerValue },
    { ParameterKey: `OriginBucketName${'\n'}injected`, ParameterValue: `${markerValue}-two` },
    { ParameterKey: 'Environment', ParameterValue: 'prod' },
    { ParameterKey: 'RequestCountAlarmThreshold', ParameterValue: '10000' },
    { ParameterKey: 'AccessLogRetentionDays', ParameterValue: '30' },
    { ParameterKey: 'LogBucketName', ParameterValue: '' },
    { ParameterKey: 'AlarmTopicArn', ParameterValue: 'REPLACE-ME--placeholder' },
  ];
  for (const strict of [true, false]) {
    const mode = strict ? 'the named-overlay reading' : 'the default-overlay reading';
    const read = extractOverlayValues(extractable, { strict, declared });
    const values = 'why' in read ? [] : read.values;
    record(
      `${mode} names a parameter the template declares`,
      values.some((one) => one.value === 'viewer-origin-abcdefghij' && one.shown === 'OriginBucketName'),
      JSON.stringify(values.map((one) => one.shown)),
    );
    record(
      `${mode} still looks for the value of a key the template does not declare, and names its index rather than the key`,
      values.some(
        (one) => one.value === markerValue && one.shown === 'the entry at index 1, whose ParameterKey the template does not declare',
      ) && values.every((one) => one.shown === null || !one.shown.includes(undeclaredKey)),
      JSON.stringify(values.map((one) => one.shown)),
    );
    record(
      `${mode} does not print a key carrying a line feed`,
      values.some((one) => one.value === `${markerValue}-two` && one.shown !== null && one.shown.startsWith('the entry at index 2,')) &&
        values.every((one) => one.shown === null || !one.shown.includes('\n')),
      JSON.stringify(values.map((one) => one.shown)),
    );
    record(
      `${mode} skips the values the template states, the empty string and the placeholder, and nothing else`,
      values.length === 3,
      JSON.stringify(values.map((one) => one.shown)),
    );
    const unreadable = extractOverlayValues(extractable, { strict, declared: null });
    record(
      `${mode} names no parameter at all when the template could not be read`,
      !('why' in unreadable) && unreadable.values.length === 3 && unreadable.values.every((one) => one.shown === null),
      JSON.stringify(unreadable),
    );
  }
  const strictRefusal = extractOverlayValues([{ ParameterKey: 'Environment' }], { strict: true, declared });
  const lenientSkip = extractOverlayValues([{ ParameterKey: 'Environment' }, 7, null], { strict: false, declared });
  record(
    'the named-overlay reading refuses an entry that is not a key and a value; the default-overlay reading skips it',
    'why' in strictRefusal && !('why' in lenientSkip) && lenientSkip.values.length === 0,
    `${JSON.stringify(strictRefusal)} ${JSON.stringify(lenientSkip)}`,
  );

  // The default-overlay path itself, through the wrapper the default path
  // takes, pointed at a fixture so that nothing here reads the default path.
  const extractDir = mkdtempSync(join(tmpdir(), 'viewer-scan-extract-'));
  const defaultFixture = join(extractDir, 'default-overlay.json');
  writeFileSync(defaultFixture, `${JSON.stringify(extractable)}\n`);
  const throughDefault = overlayValues(declared, defaultFixture);
  rmSync(extractDir, { recursive: true, force: true });
  record(
    'the default-overlay path carries the key, the skip and the undeclared-key rule',
    throughDefault.length === 3 &&
      throughDefault.some((one) => one.shown === 'OriginBucketName') &&
      throughDefault.some((one) => one.shown === 'the entry at index 1, whose ParameterKey the template does not declare') &&
      throughDefault.every((one) => !['prod', '10000', '30'].includes(one.value)),
    JSON.stringify(throughDefault.map((one) => one.shown)),
  );

  const dir = mkdtempSync(join(tmpdir(), 'viewer-scan-'));
  mkdirSync(join(dir, 'infra'), { recursive: true });
  writeFileSync(join(dir, 'infra', 'seeded.yaml'), seeded.map((seed) => seed.line).join('\n'));
  const wholeFile = scanText('infra/seeded.yaml', readFileSync(join(dir, 'infra', 'seeded.yaml'), 'utf8'), []);
  record(
    'every seeded rule fires when they are read as one file',
    new Set(wholeFile.map((violation) => violation.rule)).size === seeded.length,
    `got ${JSON.stringify([...new Set(wholeFile.map((v) => v.rule))])}`,
  );

  // ------------------------------------------------------------------
  // Which overlay a run reads, asked without any run reading one.
  // ------------------------------------------------------------------
  //
  // The default path is where a real overlay lives, so the one reading of it
  // this self-test makes is of the resolver, which is a function of the command
  // line and touches nothing. The path it answers is written out here rather
  // than taken from the constant it is compared with.
  const defaultOverlay = join(REPO_ROOT, 'infra', 'parameters.json');
  const unnamed = resolveArguments(['infra/'], '/somewhere/else');
  record(
    'with no --overlay the overlay is the default path, and every argument is a path to scan',
    !('why' in unnamed) && unnamed.overlay === defaultOverlay && !unnamed.named && unnamed.paths.join(',') === 'infra/',
    JSON.stringify(unnamed),
  );

  const relativeOverlay = resolveArguments(['--overlay', 'held/overlay.json', 'infra/'], '/somewhere/else');
  record(
    'a relative --overlay is resolved against the working directory, and is not a path to scan',
    !('why' in relativeOverlay) &&
      relativeOverlay.overlay === join('/somewhere/else', 'held', 'overlay.json') &&
      relativeOverlay.named &&
      relativeOverlay.paths.join(',') === 'infra/',
    JSON.stringify(relativeOverlay),
  );

  const absoluteOverlay = resolveArguments(['infra/', '--overlay', '/held/overlay.json'], '/somewhere/else');
  record(
    'an absolute --overlay is taken as it is written, wherever it sits on the command line',
    !('why' in absoluteOverlay) && absoluteOverlay.overlay === '/held/overlay.json' && absoluteOverlay.paths.join(',') === 'infra/',
    JSON.stringify(absoluteOverlay),
  );

  const noValue = resolveArguments(['--overlay'], '/somewhere/else');
  const twice = resolveArguments(['--overlay', 'a.json', '--overlay', 'b.json'], '/somewhere/else');
  record(
    'an --overlay with no path, and a second --overlay, are each a run that cannot say what it looks for',
    'why' in noValue && 'why' in twice,
    `${JSON.stringify(noValue)} ${JSON.stringify(twice)}`,
  );

  // ------------------------------------------------------------------
  // The whole pipeline, not just the matching.
  // ------------------------------------------------------------------
  //
  // Everything above tests `scanText`, which is the part that decides. It says
  // nothing about the part that chooses what to read — and a scan that discovers
  // no files reports the same clean summary as a scan that read the tree and
  // found it clean. So these run the real command: real file discovery through
  // `git ls-files`, real reads, real reporting, real exit codes.
  //
  // The fixtures live in a directory inside this repository rather than in the
  // system temp space, because `git ls-files --others` is what resolves the file
  // set and it only lists paths git can see. The directory is removed afterwards
  // whatever happens.
  //
  // Every run names its overlay, and none of them reads the default one. The
  // overlays are fixtures this self-test writes into the system temp space — an
  // empty parameters array standing in for "no overlay", and the few a case is
  // about — so what each run looks for is decided here, whatever does or does
  // not exist at the default path, and nothing here creates, writes, moves or
  // removes anything there.
  const fixtureName = `.scan-selftest-${process.pid}`;
  const fixtureRoot = join(REPO_ROOT, fixtureName);
  const overlays = mkdtempSync(join(tmpdir(), 'viewer-scan-overlays-'));
  const emptyOverlay = join(overlays, 'empty.json');
  const seededOverlay = join(overlays, 'seeded.json');
  const notJson = join(overlays, 'not-json.json');
  const notAnArray = join(overlays, 'not-an-array.json');
  const notParameters = join(overlays, 'not-parameters.json');
  const nowhere = join(overlays, 'not-written.json');

  // A value no file in this repository carries, assembled for the reason every
  // seed here is.
  const seededValue = `${'overlay'}-${'seeded'}-${'for'}-${'this'}-${'case'}`;

  /**
   * @param {readonly string[]} args
   * @returns {{status: number, output: string}}
   */
  function runScanner(args) {
    try {
      const output = execFileSync(process.execPath, [fileURLToPath(import.meta.url), ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, output };
    } catch (error) {
      const failure = /** @type {{status?: number, stdout?: string, stderr?: string}} */ (error);
      return { status: failure.status ?? -1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
    }
  }

  try {
    writeFileSync(emptyOverlay, '[]\n');
    writeFileSync(
      seededOverlay,
      `${JSON.stringify([
        { ParameterKey: 'Environment', ParameterValue: 'a-flavour-under-test' },
        { ParameterKey: 'OriginBucketName', ParameterValue: seededValue },
        { ParameterKey: 'EmptyParameter', ParameterValue: '' },
      ])}\n`,
    );
    writeFileSync(notJson, '[ this is not JSON\n');
    writeFileSync(notAnArray, '{ "ParameterKey": "Environment", "ParameterValue": "dev" }\n');
    writeFileSync(notParameters, '[{ "ParameterKey": "Environment" }]\n');

    mkdirSync(join(fixtureRoot, 'dirty'), { recursive: true });
    mkdirSync(join(fixtureRoot, 'clean'), { recursive: true });
    mkdirSync(join(fixtureRoot, 'named'), { recursive: true });
    mkdirSync(join(fixtureRoot, 'fixed'), { recursive: true });
    writeFileSync(join(fixtureRoot, 'dirty', 'seeded.yaml'), `${seeded[0]?.line ?? ''}\n`);
    writeFileSync(join(fixtureRoot, 'clean', 'ordinary.md'), 'Nothing private lives in this file.\n');
    writeFileSync(join(fixtureRoot, 'named', 'carries-it.md'), `The value ${seededValue} is written here.\n`);

    const dirty = runScanner(['--overlay', emptyOverlay, `${fixtureName}/dirty`]);
    record(
      'the real file set finds a seeded file and the run exits 1',
      dirty.status === 1 && dirty.output.includes('account-number'),
      `exit ${dirty.status}: ${dirty.output}`,
    );

    const cleanRun = runScanner(['--overlay', emptyOverlay, `${fixtureName}/clean`]);
    record(
      'the real file set finds a clean file and the run exits 0',
      cleanRun.status === 0 && cleanRun.output.includes('PASS'),
      `exit ${cleanRun.status}: ${cleanRun.output}`,
    );

    const empty = runScanner(['--overlay', emptyOverlay, `${fixtureName}/nothing-here`]);
    record(
      'a file set that resolves to zero files is a failure, not a pass',
      empty.status === 2 && empty.output.includes('proved nothing'),
      `exit ${empty.status}: ${empty.output}`,
    );

    // An overlay at a named path is read, and its value is reported where a
    // tracked-or-intended-public file carries it — with the value itself
    // withheld from the report, as every overlay finding is.
    const namedRun = runScanner(['--overlay', seededOverlay, `${fixtureName}/named`]);
    record(
      'an overlay at a named path is read, and its value is reported at the file that carries it',
      namedRun.status === 1 &&
        namedRun.output.includes(`${fixtureName}/named/carries-it.md:1  [overlay-value]`) &&
        namedRun.output.includes('from the overlay named on the command line'),
      `exit ${namedRun.status}: ${namedRun.output}`,
    );
    record(
      'and the value it found is not echoed into the report, and the parameter it came from is',
      !namedRun.output.includes(seededValue) && namedRun.output.includes('(withheld: OriginBucketName)'),
      `the report read: ${namedRun.output}`,
    );

    // The three parameters whose values the template states. A value the
    // template states for its parameter is not looked for at all, over a file
    // that carries it; any other value of theirs is looked for, and reported
    // under its parameter, like every other value.
    for (const [label, entries, carried] of /** @type {readonly [string, Record<string, string>, string][]} */ ([
      ['an Environment of prod', { Environment: 'prod' }, 'the prod flavour'],
      ['an Environment of dev', { Environment: 'dev' }, 'the dev flavour'],
      ['a threshold of 10000, its default', { RequestCountAlarmThreshold: '10000' }, 'a threshold of 10000'],
      ['a retention of 30, its upper bound', { AccessLogRetentionDays: '30' }, 'a retention of 30 days'],
      ['a retention of 7, within its bounds', { AccessLogRetentionDays: '7' }, 'a retention of 7 days'],
    ])) {
      const overlay = join(overlays, 'stated.json');
      writeFileSync(
        overlay,
        `${JSON.stringify(Object.entries(entries).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })))}\n`,
      );
      writeFileSync(join(fixtureRoot, 'fixed', 'carries-it.md'), `This file names ${carried}.\n`);
      const statedRun = runScanner(['--overlay', overlay, `${fixtureName}/fixed`]);
      record(
        `${label}, over a file carrying it, is not looked for: the template states it`,
        statedRun.status === 0 && statedRun.output.includes('PASS'),
        `exit ${statedRun.status}: ${statedRun.output}`,
      );
    }

    // A value long enough is also read for in the report: a short value such as
    // `x` or `030` is in the report's own words and paths, so for those only the
    // parameter is read. The twelve digits are carried inside a word, where the
    // account-number rule does not reach, so only this rule can report them.
    const outsideSet = `${'prod'}${'uction'}`;
    for (const [label, key, value, before] of /** @type {readonly [string, string, string, string][]} */ ([
      ['an Environment outside the allowed set', 'Environment', outsideSet, ''],
      ['a threshold of twelve digits', 'RequestCountAlarmThreshold', `${'123456'}${'789012'}`, 'owner'],
      ['a threshold that is not a whole number', 'RequestCountAlarmThreshold', `${'10000'}${'.5'}`, ''],
      ['a threshold that is not its default', 'RequestCountAlarmThreshold', `${'50'}${'00'}`, ''],
      ['a retention above its bound', 'AccessLogRetentionDays', `${'3'}${'1'}`, ''],
      ['a retention with a leading zero', 'AccessLogRetentionDays', `${'0'}${'30'}`, ''],
      ['a retention that is not a number', 'AccessLogRetentionDays', 'x', ''],
    ])) {
      const overlay = join(overlays, 'unstated.json');
      writeFileSync(overlay, `${JSON.stringify([{ ParameterKey: key, ParameterValue: value }])}\n`);
      writeFileSync(join(fixtureRoot, 'fixed', 'carries-it.md'), `This file names ${before}${value} here.\n`);
      const unstatedRun = runScanner(['--overlay', overlay, `${fixtureName}/fixed`]);
      record(
        `${label} is looked for like any other value, and reported under its parameter`,
        unstatedRun.status === 1 &&
          unstatedRun.output.includes(`${fixtureName}/fixed/carries-it.md:1  [overlay-value]`) &&
          unstatedRun.output.includes(`(withheld: ${key})`),
        `exit ${unstatedRun.status}: ${unstatedRun.output}`,
      );
      if (value.length >= 7) {
        record(
          `and the report of ${label} never carries the value`,
          !unstatedRun.output.includes(value),
          'the finding quoted the value it was refusing',
        );
      }
    }

    // A value pasted into the key slot: the value is still looked for, and the
    // key is not printed, because the template does not declare it.
    const reversedOverlay = join(overlays, 'reversed.json');
    writeFileSync(reversedOverlay, `${JSON.stringify([{ ParameterKey: undeclaredKey, ParameterValue: markerValue }])}\n`);
    writeFileSync(join(fixtureRoot, 'fixed', 'carries-it.md'), `This file names ${markerValue} here.\n`);
    const reversedRun = runScanner(['--overlay', reversedOverlay, `${fixtureName}/fixed`]);
    record(
      'a key the template does not declare is not printed, and its value is still reported, by its index',
      reversedRun.status === 1 &&
        reversedRun.output.includes('(withheld: the entry at index 0, whose ParameterKey the template does not declare)') &&
        !reversedRun.output.includes(undeclaredKey) &&
        !reversedRun.output.includes(markerValue),
      `exit ${reversedRun.status}: ${reversedRun.output}`,
    );

    // Which values, never which files: the same paths under the named overlay
    // and under the empty one are the same file set, read the same way.
    const sameFiles = runScanner(['--overlay', seededOverlay, `${fixtureName}/clean`]);
    record(
      'a named overlay changes which values are looked for, and not which files are read',
      sameFiles.status === 0 &&
        /scanned 1 file\(s\)/.test(sameFiles.output) &&
        /scanned 1 file\(s\)/.test(cleanRun.output),
      `exit ${sameFiles.status}: ${sameFiles.output}`,
    );

    // A named overlay that is not there, or not a parameters array, is a run
    // that cannot say what it is looking for — never a clean tree.
    for (const [label, file] of /** @type {readonly [string, string][]} */ ([
      ['a named overlay that does not exist', nowhere],
      ['a named overlay that is not JSON', notJson],
      ['a named overlay that is not an array', notAnArray],
      ['a named overlay whose entry is not a ParameterKey and a ParameterValue', notParameters],
    ])) {
      const refusedRun = runScanner(['--overlay', file, `${fixtureName}/clean`]);
      record(
        `${label} cannot run, and exits 2`,
        refusedRun.status === 2 && refusedRun.output.includes('cannot run') && !refusedRun.output.includes('PASS'),
        `exit ${refusedRun.status}: ${refusedRun.output}`,
      );
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
    rmSync(overlays, { recursive: true, force: true });
  }

  if (failures === 0) {
    process.stdout.write('scan-private-values self-test — PASS\n');
    return 0;
  }
  process.stdout.write(`scan-private-values self-test — FAIL (${failures} case(s))\n`);
  return 1;
}

/**
 * @returns {number} process exit code
 */
function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--self-test') {
    return selfTest();
  }
  const asked = resolveArguments(args);
  if ('why' in asked) {
    process.stderr.write(`scan-private-values — cannot run: ${asked.why}\n`);
    return 2;
  }
  return scan(asked.paths, asked);
}

process.exit(main());
