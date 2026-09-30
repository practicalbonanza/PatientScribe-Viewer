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
 * consulted only for the pattern rules, overlay values are reported
 * unconditionally, and which parameter a value came from is not carried this far
 * — so an entry that looked like it held would in fact have said nothing at all
 * about a CHANGED value. What catches that is the release check, which derives
 * its expected `connect-src` from the committed table and compares it against
 * the live response header.
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
 * Exactly two values are skipped, and both are skipped because they are not
 * values:
 *
 *   - the empty string, which is how a dev overlay says a prod-only parameter has
 *     no value. Every line of every file contains the empty string, so matching
 *     on it would redden the tree unconditionally.
 *   - anything still carrying the example file's `REPLACE-ME` marker, which is a
 *     placeholder that is public by construction — it is in
 *     parameters.json.example, in this repository, on purpose.
 *
 * @returns {string[]}
 */
export function overlayValues() {
  /** @type {string} */
  let text;
  try {
    text = readFileSync(OVERLAY, 'utf8');
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
  if (!Array.isArray(parsed)) {
    return [];
  }
  /** @type {string[]} */
  const values = [];
  for (const entry of parsed) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const value = /** @type {Record<string, unknown>} */ (entry)['ParameterValue'];
    if (typeof value === 'string' && value !== '' && !value.startsWith('REPLACE-ME')) {
      values.push(value);
    }
  }
  return values;
}

/**
 * Every literal value an overlay NAMED on the command line carries — or why
 * this run cannot say.
 *
 * The same values `overlayValues` takes, skipped for the same two reasons, out
 * of a file somebody pointed this run at. The difference is what a problem with
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
 * @returns {{ values: string[] } | { why: string }}
 */
export function namedOverlayValues(file) {
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
  if (!Array.isArray(parsed)) {
    return { why: `the overlay ${file} is not a parameters array` };
  }
  /** @type {string[]} */
  const values = [];
  for (const [index, entry] of parsed.entries()) {
    const record =
      entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        ? /** @type {Record<string, unknown>} */ (entry)
        : null;
    const key = record === null ? undefined : record['ParameterKey'];
    const value = record === null ? undefined : record['ParameterValue'];
    if (typeof key !== 'string' || typeof value !== 'string') {
      return { why: `the overlay ${file} carries an entry, at ${index}, that is not a ParameterKey and a ParameterValue` };
    }
    if (value !== '' && !value.startsWith('REPLACE-ME')) {
      values.push(value);
    }
  }
  return { values };
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
 * @param {readonly string[]} secrets Literal values that must not appear.
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
      if (line.includes(secret)) {
        violations.push({
          file,
          line: index + 1,
          rule: 'overlay-value',
          why: 'this is a literal value out of the deploy overlay',
          match: '(withheld)',
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

  /** @type {string[]} */
  let secrets;
  let source = 'the local overlay';
  if (which.named) {
    const read = namedOverlayValues(which.overlay);
    if ('why' in read) {
      process.stderr.write(`scan-private-values — cannot run: ${read.why}, so this run cannot say which values it is looking for\n`);
      return 2;
    }
    secrets = read.values;
    source = 'the overlay named on the command line';
  } else {
    secrets = overlayValues();
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
  const leaked = scanText('infra/README.md', 'the bucket is viewer-origin-abcdefghij', ['viewer-origin-abcdefghij']);
  record(
    'a literal overlay value reddens wherever it appears',
    leaked.some((violation) => violation.rule === 'overlay-value'),
    'nothing matched',
  );

  record(
    'the overlay value is not echoed into the report',
    leaked.every((violation) => !violation.match.includes('viewer-origin')),
    'the finding quoted the value it was refusing',
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
        { ParameterKey: 'SeededParameter', ParameterValue: seededValue },
        { ParameterKey: 'EmptyParameter', ParameterValue: '' },
      ])}\n`,
    );
    writeFileSync(notJson, '[ this is not JSON\n');
    writeFileSync(notAnArray, '{ "ParameterKey": "Environment", "ParameterValue": "dev" }\n');
    writeFileSync(notParameters, '[{ "ParameterKey": "Environment" }]\n');

    mkdirSync(join(fixtureRoot, 'dirty'), { recursive: true });
    mkdirSync(join(fixtureRoot, 'clean'), { recursive: true });
    mkdirSync(join(fixtureRoot, 'named'), { recursive: true });
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
      'and the value it found is not echoed into the report',
      !namedRun.output.includes(seededValue),
      'the finding quoted the value it was refusing',
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
