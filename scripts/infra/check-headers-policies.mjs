/**
 * The two response-headers policies are the same policy twice. This is what says
 * so.
 *
 * Usage:
 *   node scripts/infra/check-headers-policies.mjs [template.yaml]
 *   node scripts/infra/check-headers-policies.mjs --self-test
 *
 * Exit codes: 0 = they agree, 1 = they do not, 2 = the check could not run.
 *
 * The normative text says the two policies are identical except for the
 * cache-control item's override mode, and that identity is a requirement rather
 * than an observation about how the template happens to be written. CloudFormation
 * has no way to write a definition once and instantiate it twice — a YAML anchor
 * is not reliably a CloudFormation feature, and this template is handed to the
 * service as raw bytes — so the two blocks are written out in full, twice, and
 * the equality is asserted here instead. Two blocks that must stay equal while
 * being maintained separately will eventually differ by one character, and the
 * character it differs by will be in a security header.
 *
 * The governed headers live in two blocks rather than one, and not by choice:
 * CloudFront's API refuses `content-security-policy`, `strict-transport-security`
 * and `referrer-policy` as custom headers, because each has a slot of its own in
 * the typed security-headers configuration. So three of them are written there
 * and three stay custom, and both blocks are inside the equality above. The three
 * that moved must also not reappear as custom headers, which is a refusal here
 * because it is otherwise a refusal nothing sees until a change-set is executed.
 *
 * It also checks the values themselves, against the strings the release check
 * refuses anything else for. Those strings are read out of the frozen core as
 * text — this file does not import that module and does not execute it, because
 * the frozen core is not this round's to depend on. Reading it as bytes is the
 * weakest coupling that still catches the thing worth catching, which is a
 * transcription error in the template.
 *
 * One of those values is not written in the template at all. CloudFront composes
 * the transport-security string out of a number and two flags, so the template
 * carries the three fields and the wire carries the string. The composition is
 * done here the way CloudFront does it and compared against the frozen spelling,
 * which is the most this file can say about it; the bytes themselves are judged
 * on the wire by the release check.
 *
 * The template is read with a line scanner rather than a YAML parser, because
 * this repository has no YAML parser and is not gaining a dependency for one. The
 * scanner is written to fail closed: if it cannot find both policies, both
 * custom-header blocks, both security-headers blocks and both removal blocks in
 * the shape it expects, it says so and exits 2 rather than comparing two empty
 * lists and calling them equal.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The template this is about, when nothing else is named. */
const TEMPLATE = join(REPO_ROOT, 'infra', 'viewer-stack.yaml');

/** Where the settled spelling of the governed headers lives. */
const FROZEN_HEADERS = join(REPO_ROOT, 'scripts', 'release-check-core', 'headers.mjs');

/** The two logical resources, and which is which. */
const DEFAULT_POLICY = 'DefaultResponseHeadersPolicy';
const ASSET_POLICY = 'AssetResponseHeadersPolicy';

/**
 * The header whose override mode is allowed to differ, and nothing else is.
 */
const DIFFERING_HEADER = 'cache-control';

/**
 * The values every governed header must carry, other than the policy itself.
 *
 * Written out here as literals for the same reason the frozen core writes them
 * out: a check that assembles its expectation from what it read passes whatever
 * it read. These are compared against the frozen core's text as well, so a drift
 * between this file and that one is itself a finding.
 *
 * @type {Readonly<Record<string, string>>}
 */
const GOVERNED = Object.freeze({
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, noarchive, nosnippet',
  'cache-control': 'no-store',
});

/**
 * The governed headers that are carried as custom headers.
 *
 * @type {readonly string[]}
 */
const CUSTOM_CARRIED = Object.freeze(['permissions-policy', 'x-robots-tag', 'cache-control']);

/**
 * The governed headers that cannot be custom headers.
 *
 * Each of these has a dedicated field in the typed security-headers
 * configuration, and CloudFront refuses to accept a header with a dedicated
 * field as a custom one. The refusal is the API's and is not in the template
 * language: a template naming one of these in `CustomHeadersConfig` renders,
 * validates and produces a change-set like any other, and the execute is where
 * it fails. That is late enough to be worth a line here.
 *
 * @type {readonly string[]}
 */
const MOVED = Object.freeze(['content-security-policy', 'strict-transport-security', 'referrer-policy']);

/**
 * The typed security-headers configuration, flattened to the keys the scanner
 * produces, with the value each one must carry.
 *
 * The policy string is not in here — it has a parameter in it and is read
 * directive by directive below — and neither is anything else, which is the
 * point: a key in either block that is not the policy string and not named here
 * is a field this check has never read, and it refuses rather than ignores it.
 *
 * @type {Readonly<Record<string, string>>}
 */
const SECURITY_FIELDS = Object.freeze({
  'ContentSecurityPolicy.Override': 'true',
  'StrictTransportSecurity.AccessControlMaxAgeSec': '63072000',
  'StrictTransportSecurity.IncludeSubdomains': 'true',
  'StrictTransportSecurity.Preload': 'true',
  'StrictTransportSecurity.Override': 'true',
  'ReferrerPolicy.ReferrerPolicy': 'no-referrer',
  'ReferrerPolicy.Override': 'true',
});

/** The one field in that block whose value is not a literal. */
const CSP_FIELD = 'ContentSecurityPolicy.ContentSecurityPolicy';

/**
 * The policy's directives, in order, with the origin left open.
 *
 * @type {readonly string[]}
 */
const CSP_DIRECTIVES = Object.freeze([
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  'connect-src ',
  "img-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
]);

/**
 * The headers both policies must strip, because the origin emits them and the
 * release check admits neither.
 *
 * @type {readonly string[]}
 */
const REMOVED = Object.freeze(['x-amz-version-id', 'x-amz-server-side-encryption']);

/**
 * The refusals that mean the template could not be read, as against read and
 * found wanting.
 *
 * A check that cannot see what it is checking has not checked it, and reporting
 * that with the exit code a disagreement uses invites the two to be read as one
 * thing. These three exit 2. They are named here rather than matched on their
 * wording downstream so that the refusal and its exit code are the same string
 * in both places and cannot drift; the self-test pins the wording from the other
 * side, by mutating the template until each one fires.
 */
const UNREADABLE = Object.freeze({
  policies: 'the template does not carry both response-headers policies in the shape this reads',
  custom: 'one of the policies carries no custom headers, which is not a policy this check can read',
  security:
    'one of the policies does not carry a security-headers configuration, and three of the governed headers can live nowhere else',
});

/**
 * @typedef {object} HeaderItem
 * @property {string} header
 * @property {string} value
 * @property {string} override
 */

/**
 * @typedef {object} Policy
 * @property {HeaderItem[]} items
 * @property {string[]} removed
 * @property {Map<string, string>} security The security-headers block, flattened
 *   to `Block.Field` keys so that two of them can be compared as one thing.
 */

/**
 * Pull the two policies out of the template.
 *
 * The scanner keys off indentation, which is what makes it a scanner rather than
 * a set of hopeful regular expressions: a resource block is everything indented
 * past the resource's own name, and an item is a `- Header:` line plus the lines
 * indented under it. The security-headers block is read the same way, one level
 * deeper: a key with nothing after it opens a block, and a key with a value in it
 * belongs to whichever block is open. Anything it cannot read in that shape is an
 * error rather than an empty result.
 *
 * @param {string} text
 * @returns {Map<string, Policy>}
 */
export function readPolicies(text) {
  const lines = text.split('\n');

  /** @type {Map<string, Policy>} */
  const policies = new Map();

  /** @type {string | null} */
  let current = null;
  /** @type {'none' | 'security' | 'custom' | 'remove'} */
  let section = 'none';
  /** @type {HeaderItem | null} */
  let item = null;
  /** @type {string | null} */
  let block = null;

  /** @type {Policy | undefined} */
  let policy;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line === '' || /^\s*#/.test(line)) {
      continue;
    }

    const resource = /^  ([A-Za-z0-9]+):$/.exec(line);
    if (resource !== null) {
      const name = resource[1] ?? '';
      if (item !== null && policy !== undefined) {
        policy.items.push(item);
        item = null;
      }
      current = name === DEFAULT_POLICY || name === ASSET_POLICY ? name : null;
      section = 'none';
      block = null;
      if (current !== null) {
        policy = { items: [], removed: [], security: new Map() };
        policies.set(current, policy);
      } else {
        policy = undefined;
      }
      continue;
    }

    if (current === null || policy === undefined) {
      continue;
    }

    if (/^\s*SecurityHeadersConfig:\s*$/.test(line)) {
      if (item !== null) {
        policy.items.push(item);
        item = null;
      }
      section = 'security';
      block = null;
      continue;
    }
    if (/^\s*CustomHeadersConfig:\s*$/.test(line)) {
      if (item !== null) {
        policy.items.push(item);
        item = null;
      }
      section = 'custom';
      block = null;
      continue;
    }
    if (/^\s*RemoveHeadersConfig:\s*$/.test(line)) {
      if (item !== null) {
        policy.items.push(item);
        item = null;
      }
      section = 'remove';
      block = null;
      continue;
    }

    if (section === 'security') {
      const opener = /^\s*([A-Za-z]+):\s*$/.exec(line);
      if (opener !== null) {
        block = opener[1] ?? '';
        continue;
      }
      const field = /^\s*([A-Za-z]+):\s*(.+)$/.exec(line);
      if (field !== null && block !== null) {
        policy.security.set(`${block}.${field[1] ?? ''}`, unquote(field[2] ?? ''));
      }
      continue;
    }

    if (section === 'custom') {
      const header = /^\s*-\s*Header:\s*(.+)$/.exec(line);
      if (header !== null) {
        if (item !== null) {
          policy.items.push(item);
        }
        item = { header: unquote(header[1] ?? ''), value: '', override: '' };
        continue;
      }
      const value = /^\s*Value:\s*(.+)$/.exec(line);
      if (value !== null && item !== null) {
        item.value = unquote(value[1] ?? '');
        continue;
      }
      const override = /^\s*Override:\s*(.+)$/.exec(line);
      if (override !== null && item !== null) {
        item.override = (override[1] ?? '').trim();
        continue;
      }
      continue;
    }

    if (section === 'remove') {
      const header = /^\s*-\s*Header:\s*(.+)$/.exec(line);
      if (header !== null) {
        policy.removed.push(unquote(header[1] ?? ''));
      }
    }
  }

  if (item !== null && policy !== undefined) {
    policy.items.push(item);
  }

  return policies;
}

/**
 * Strip a YAML tag and one layer of quoting, and nothing else.
 *
 * The tag comes off because the policy string is written as `!Sub "…"` — it is
 * the one value in either policy with a parameter in it — and what this compares
 * is the string, not how CloudFormation is told to build it. Everything else is
 * a plain quoted scalar and passes through untouched.
 *
 * @param {string} raw
 * @returns {string}
 */
function unquote(raw) {
  const trimmed = raw.trim().replace(/^![A-Za-z:]+\s+/, '');
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * @param {HeaderItem} item
 * @returns {string} The item as a comparable line, override included.
 */
function fingerprint(item) {
  return `${item.header} ${item.value} ${item.override}`;
}

/**
 * Everything this check has to say about a template.
 *
 * @param {string} templateText
 * @param {string} frozenText The frozen core's headers module, as bytes.
 * @returns {string[]} refusals; empty means it holds
 */
export function checkTemplate(templateText, frozenText) {
  /** @type {string[]} */
  const refusals = [];

  const policies = readPolicies(templateText);
  const fallback = {
    items: /** @type {HeaderItem[]} */ ([]),
    removed: /** @type {string[]} */ ([]),
    security: /** @type {Map<string, string>} */ (new Map()),
  };
  const defaultPolicy = policies.get(DEFAULT_POLICY) ?? fallback;
  const assetPolicy = policies.get(ASSET_POLICY) ?? fallback;

  if (!policies.has(DEFAULT_POLICY) || !policies.has(ASSET_POLICY)) {
    refusals.push(UNREADABLE.policies);
    return refusals;
  }
  if (defaultPolicy.items.length === 0 || assetPolicy.items.length === 0) {
    refusals.push(UNREADABLE.custom);
    return refusals;
  }
  if (defaultPolicy.security.size === 0 || assetPolicy.security.size === 0) {
    refusals.push(UNREADABLE.security);
    return refusals;
  }

  // 1. Structural equality, the removal set included.
  const defaultByName = new Map(defaultPolicy.items.map((entry) => [entry.header, entry]));
  const assetByName = new Map(assetPolicy.items.map((entry) => [entry.header, entry]));

  for (const name of defaultByName.keys()) {
    if (!assetByName.has(name)) {
      refusals.push(`${name} is in the default policy and not in the asset policy`);
    }
  }
  for (const name of assetByName.keys()) {
    if (!defaultByName.has(name)) {
      refusals.push(`${name} is in the asset policy and not in the default policy`);
    }
  }

  for (const [name, left] of defaultByName) {
    const right = assetByName.get(name);
    if (right === undefined) {
      continue;
    }
    if (name === DIFFERING_HEADER) {
      if (left.value !== right.value) {
        refusals.push(
          `${name} carries ${JSON.stringify(left.value)} in the default policy and ${JSON.stringify(right.value)} in the asset policy; only the override mode may differ`,
        );
      }
      if (left.override !== 'true') {
        refusals.push(`${name} must override the origin on the default behaviour, and it is ${JSON.stringify(left.override)}`);
      }
      if (right.override !== 'false') {
        refusals.push(
          `${name} must defer to the object's own directive on the asset behaviour, and it is ${JSON.stringify(right.override)}`,
        );
      }
      continue;
    }
    if (fingerprint(left) !== fingerprint(right)) {
      refusals.push(`${name} differs between the two policies, and ${DIFFERING_HEADER} is the only item that may`);
    }
  }

  const removedLeft = [...defaultPolicy.removed].sort();
  const removedRight = [...assetPolicy.removed].sort();
  if (removedLeft.join(',') !== removedRight.join(',')) {
    refusals.push('the two policies remove different headers, and the removal set is inside the equality');
  }
  for (const name of REMOVED) {
    if (!removedLeft.includes(name)) {
      refusals.push(`${name} is not removed, and the origin emits it on every successful read`);
    }
  }

  const securityKeys = [...new Set([...defaultPolicy.security.keys(), ...assetPolicy.security.keys()])].sort();
  for (const key of securityKeys) {
    const left = defaultPolicy.security.get(key);
    const right = assetPolicy.security.get(key);
    if (left !== right) {
      refusals.push(
        `${key} is ${JSON.stringify(left ?? null)} in the default policy and ${JSON.stringify(right ?? null)} in the asset policy, and nothing in the security-headers configuration may differ`,
      );
    }
  }

  // 2. The values themselves, in whichever block carries them.
  for (const [name, expected] of Object.entries(GOVERNED)) {
    if (!CUSTOM_CARRIED.includes(name)) {
      continue;
    }
    const item = defaultByName.get(name);
    if (item === undefined) {
      refusals.push(`${name} is not carried at all`);
      continue;
    }
    if (item.value !== expected) {
      refusals.push(`${name} is ${JSON.stringify(item.value)}, and the settled spelling is ${JSON.stringify(expected)}`);
    }
    if (name !== DIFFERING_HEADER && item.override !== 'true') {
      refusals.push(`${name} does not override the origin, and a header the origin can win is not a governed header`);
    }
  }

  for (const name of MOVED) {
    for (const [label, byName] of /** @type {[string, Map<string, HeaderItem>][]} */ ([
      ['default', defaultByName],
      ['asset', assetByName],
    ])) {
      if (byName.has(name)) {
        refusals.push(
          `${name} is a custom header on the ${label} policy, and CloudFront refuses it as one — it has a field of its own and belongs in it`,
        );
      }
    }
  }

  const security = defaultPolicy.security;

  for (const [key, expected] of Object.entries(SECURITY_FIELDS)) {
    const actual = security.get(key);
    if (actual === undefined) {
      refusals.push(`${key} is not carried, and the security-headers configuration is read field by field`);
      continue;
    }
    if (actual !== expected) {
      refusals.push(`${key} is ${JSON.stringify(actual)}, and it must be ${JSON.stringify(expected)}`);
    }
  }

  for (const key of security.keys()) {
    if (key !== CSP_FIELD && SECURITY_FIELDS[key] === undefined) {
      refusals.push(`${key} is a field this check has never read, and an unread field in a security header is an unchecked one`);
    }
  }

  // The transport-security value is the one governed string the template does not
  // contain: CloudFront builds it from the three fields above. It is built here
  // the same way and compared against the settled spelling, which is as close to
  // the wire as this file gets — the bytes themselves are the release check's.
  /** @type {string[]} */
  const composed = [];
  const seconds = security.get('StrictTransportSecurity.AccessControlMaxAgeSec');
  if (seconds !== undefined) {
    composed.push(`max-age=${seconds}`);
  }
  if (security.get('StrictTransportSecurity.IncludeSubdomains') === 'true') {
    composed.push('includeSubDomains');
  }
  if (security.get('StrictTransportSecurity.Preload') === 'true') {
    composed.push('preload');
  }
  const transport = composed.join('; ');
  const settledTransport = GOVERNED['strict-transport-security'] ?? '';
  if (transport !== settledTransport) {
    refusals.push(
      `the transport-security fields compose to ${JSON.stringify(transport)}, and the settled spelling is ${JSON.stringify(settledTransport)}`,
    );
  }

  const policy = security.get(CSP_FIELD);
  if (policy === undefined) {
    refusals.push('no content-security-policy is carried');
  } else {
    const directives = policy.split('; ');
    if (directives.length !== CSP_DIRECTIVES.length) {
      refusals.push(`the policy has ${directives.length} directives, and it must have ${CSP_DIRECTIVES.length}`);
    }
    for (const [index, expected] of CSP_DIRECTIVES.entries()) {
      const actual = directives[index] ?? '';
      const held = expected === 'connect-src ' ? actual.startsWith('connect-src ') : actual === expected;
      if (!held) {
        refusals.push(`directive ${index + 1} is ${JSON.stringify(actual)}, and it must be ${JSON.stringify(expected)}`);
      }
    }
    // The one slot that is a parameter rather than a literal.
    const connect = directives[3] ?? '';
    if (!connect.includes('${ApiOrigin}')) {
      refusals.push('connect-src does not carry the ApiOrigin parameter, and it is the only value that is per-environment');
    }
  }

  // 3. This file's expectations against the frozen core's own bytes.
  for (const [name, expected] of Object.entries(GOVERNED)) {
    if (name === DIFFERING_HEADER) {
      continue;
    }
    if (!frozenText.includes(expected)) {
      refusals.push(`the frozen core does not spell ${name} as ${JSON.stringify(expected)}, so this check is out of date`);
    }
  }
  for (const directive of CSP_DIRECTIVES) {
    if (directive === 'connect-src ') {
      continue;
    }
    if (!frozenText.includes(directive)) {
      refusals.push(`the frozen core does not spell ${JSON.stringify(directive)}, so this check is out of date`);
    }
  }

  return refusals;
}

/**
 * @param {string} message
 * @returns {never}
 */
function cannotRun(message) {
  process.stderr.write(`check-headers-policies — cannot run: ${message}\n`);
  process.exit(2);
}

/**
 * @param {string} file
 * @returns {string}
 */
function read(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return cannotRun(`cannot open ${file}`);
  }
}

/**
 * Both directions, on the real template and on mutations of it.
 *
 * The mutations are textual and are applied to a copy in memory: nothing is
 * written, and the template on disk is the one the run above just read.
 *
 * @returns {number} process exit code
 */
function selfTest() {
  const template = read(TEMPLATE);
  const frozen = read(FROZEN_HEADERS);
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

  const clean = checkTemplate(template, frozen);
  record('the template as written holds', clean.length === 0, `got ${JSON.stringify(clean)}`);

  /** @type {{name: string, mutate: (text: string) => string, expect: string}[]} */
  const cases = [
    {
      name: 'a header value drifts in one policy only',
      mutate: (text) => text.replace("Value: 'noindex, noarchive, nosnippet'", "Value: 'noindex'"),
      expect: 'differs between the two policies',
    },
    {
      name: 'a security header drifts in one policy only',
      mutate: (text) => text.replace('ReferrerPolicy: no-referrer', 'ReferrerPolicy: strict-origin'),
      expect: 'nothing in the security-headers configuration may differ',
    },
    {
      name: 'the transport-security fields lose a directive',
      mutate: (text) => text.replace(/IncludeSubdomains: true/g, 'IncludeSubdomains: false'),
      expect: 'the transport-security fields compose to',
    },
    {
      name: 'the transport-security age drifts',
      mutate: (text) => text.replace(/AccessControlMaxAgeSec: 63072000/g, 'AccessControlMaxAgeSec: 31536000'),
      expect: 'the transport-security fields compose to',
    },
    {
      name: 'a field nothing here reads appears in the security block',
      mutate: (text) => text.replace(/ {12}Preload: true\n/g, '            Preload: true\n            IncludeSubDomains: true\n'),
      expect: 'a field this check has never read',
    },
    {
      name: 'a moved header is written as a custom header again',
      mutate: (text) =>
        text.replace(
          '            - Header: permissions-policy\n',
          "            - Header: referrer-policy\n              Value: 'no-referrer'\n              Override: true\n            - Header: permissions-policy\n",
        ),
      expect: 'CloudFront refuses it as one',
    },
    {
      name: 'a security-headers configuration goes missing',
      mutate: (text) => text.replace(/ {8}SecurityHeadersConfig:\n(?: {10,}.*\n)+/, ''),
      expect: 'does not carry a security-headers configuration',
    },
    {
      name: 'a security header stops overriding the origin',
      mutate: (text) => text.replace(/(ReferrerPolicy: no-referrer\n\s+Override: )true/g, '$1false'),
      expect: 'ReferrerPolicy.Override is',
    },
    {
      name: 'a governed header stops overriding the origin',
      mutate: (text) => text.replace(/(Header: x-robots-tag\n\s+Value: '[^']*'\n\s+Override: )true/, '$1false'),
      expect: 'does not override the origin',
    },
    {
      name: 'the asset policy starts overriding the cache directive',
      mutate: (text) => text.replace(/(Header: cache-control\n\s+Value: 'no-store'\n\s+Override: )false/, '$1true'),
      expect: "defer to the object's own directive",
    },
    {
      name: 'a removal is dropped from one policy',
      mutate: (text) => text.replace('            - Header: x-amz-version-id\n', ''),
      expect: 'remove different headers',
    },
    {
      name: 'a directive is dropped from the policy string',
      mutate: (text) => text.replace(/base-uri 'none'; /g, ''),
      expect: 'directives, and it must have',
    },
  ];

  for (const testCase of cases) {
    const mutated = testCase.mutate(template);
    if (mutated === template) {
      failures += 1;
      process.stdout.write(`  FAIL ${testCase.name} — the mutation changed nothing, so it tested nothing\n`);
      continue;
    }
    const refusals = checkTemplate(mutated, frozen);
    record(
      testCase.name,
      refusals.some((line) => line.includes(testCase.expect)),
      `nothing refused with ${JSON.stringify(testCase.expect)}; got ${JSON.stringify(refusals)}`,
    );
  }

  if (failures === 0) {
    process.stdout.write(`check-headers-policies self-test — PASS (${cases.length + 1} case(s))\n`);
    return 0;
  }
  process.stdout.write(`check-headers-policies self-test — FAIL (${failures} case(s))\n`);
  return 1;
}

/**
 * @returns {number} process exit code
 */
function main() {
  const argument = process.argv[2];
  if (argument === '--self-test') {
    return selfTest();
  }

  const file = argument === undefined ? TEMPLATE : resolve(argument);
  const refusals = checkTemplate(read(file), read(FROZEN_HEADERS));

  if (refusals.length === 0) {
    process.stdout.write('check-headers-policies — PASS: the two policies differ in the one field they may\n');
    return 0;
  }
  /** @type {string[]} */
  const unreadable = Object.values(UNREADABLE);
  const cannotSee = refusals.some((line) => unreadable.includes(line));
  process.stdout.write(
    `check-headers-policies — ${cannotSee ? 'CANNOT RUN' : 'FAIL'} — ${refusals.length} refusal(s):\n\n`,
  );
  for (const line of refusals) {
    process.stdout.write(`  ${line}\n`);
  }
  return cannotSee ? 2 : 1;
}

process.exit(main());
