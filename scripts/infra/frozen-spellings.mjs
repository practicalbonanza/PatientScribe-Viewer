/**
 * The oracle's spellings, transcribed once so that the release tooling never
 * imports them.
 *
 * The release check's core is frozen: later work executes it and never edits or
 * imports it. That rule is what keeps a builder from quietly widening what the
 * check accepts by editing the thing that accepts. But the tooling that publishes
 * a release has to produce documents the check will read — a manifest with those
 * exact fields, an entry point carrying that exact comment, objects under that
 * exact prefix — and it cannot do that without knowing what those spellings are.
 *
 * So they are written out again, here, from the frozen modules, with a comment on
 * each naming the file it came from. Two spellings of one string can drift, and
 * this file is where that drift would land, so the drift is what the self-test
 * below looks for: it reads each source module **as text** — never as an import —
 * and requires every transcribed value to appear in it verbatim. A frozen module
 * that changed a string would make this file's self-test red rather than making a
 * release quietly unreadable.
 *
 * What this is not: a second implementation of the check. Nothing here judges an
 * origin. These are the constants and the two readings — a release identifier and
 * the comment spans of a document — that a *producer* of releases needs in order
 * to produce something the check can read. The check re-reads all of it itself,
 * from its own copy, and its answer is the one that counts.
 *
 * Usage:
 *   node scripts/infra/frozen-spellings.mjs --self-test
 *
 * Exit codes: 0 = every transcription still matches its source, 1 = one does not.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repository this transcription was taken from. */
const REPO_ROOT = resolve(HERE, '..', '..');

// ---------------------------------------------------------------------------
// Schemas and field lists
// ---------------------------------------------------------------------------

/** The manifest's `schema` value. Source: scripts/release-check-core/manifest.mjs */
export const MANIFEST_SCHEMA = 'viewer-release-manifest/1';

/** An inventory's `schema` value. Source: scripts/release-check-core/manifest.mjs */
export const INVENTORY_SCHEMA = 'viewer-origin-inventory/1';

/**
 * The manifest's fields, exactly, in the order a manifest is written.
 *
 * Source: scripts/release-check-core/manifest.mjs (`MANIFEST_FIELDS`). The
 * reading there is order-insensitive — it sorts both sides — so the order here is
 * the one the conformant fixture writes them in, which is what makes two builds
 * of one tree byte-identical.
 *
 * @type {readonly string[]}
 */
export const MANIFEST_FIELDS = Object.freeze(['schema', 'commit', 'release_id', 'objects']);

/**
 * An inventory's fields, exactly.
 *
 * Source: scripts/release-check-core/manifest.mjs (`INVENTORY_FIELDS`).
 *
 * @type {readonly string[]}
 */
export const INVENTORY_FIELDS = Object.freeze(['schema', 'paths']);

/** The entry point's one manifest key. Source: scripts/release-check-core/manifest.mjs */
export const ENTRY_POINT = '/index.html';

/** The committed origin table's served path. Source: scripts/release-check-core/manifest.mjs */
export const CONFIG_PATH = '/js/config.js';

/** The prefix that separates the two cache behaviours. Source: scripts/release-check-core/cache.mjs */
export const ASSET_PREFIX = '/assets/';

// ---------------------------------------------------------------------------
// Cache directives and content types
// ---------------------------------------------------------------------------

/** What an allowlisted object's response must say. Source: scripts/release-check-core/cache.mjs */
export const IMMUTABLE_DIRECTIVE = 'public, max-age=31536000, immutable';

/** The directive every other response must say. Source: scripts/release-check-core/cache.mjs */
export const NO_STORE_DIRECTIVE = 'no-store';

/**
 * Extension to served content type, exactly, with no parameters.
 *
 * Source: scripts/release-check-core/cache.mjs (`ASSET_CONTENT_TYPES`).
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ASSET_CONTENT_TYPES = Object.freeze({
  js: 'text/javascript',
  css: 'text/css',
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  ico: 'image/x-icon',
});

/**
 * What the two document-prefix objects are served as.
 *
 * Source: test/release-fixtures/deployment.mjs, which is the conformant
 * deployment the whole fixture corpus is one edit away from — the entry point is
 * `text/html; charset=utf-8` and the origin table is
 * `text/javascript; charset=utf-8`. These carry a charset where the asset table
 * does not, and that is not an oversight in either place: the asset table is the
 * normative one and says no parameters, and these two are documents the browser
 * decodes as text.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const DOCUMENT_CONTENT_TYPES = Object.freeze({
  '/index.html': 'text/html; charset=utf-8',
  '/js/config.js': 'text/javascript; charset=utf-8',
});

// ---------------------------------------------------------------------------
// Grammars
// ---------------------------------------------------------------------------

/**
 * The characters a path may be written with, and no others.
 *
 * Source: scripts/release-check-core/manifest.mjs (`PATH_CHARACTERS`).
 */
const PATH_CHARACTERS = /^[A-Za-z0-9._~/-]+$/;

/** A digest, as the manifest records it. Source: scripts/release-check-core/manifest.mjs */
const DIGEST = /^[0-9a-f]{64}$/;

/** A commit, as the manifest records it. Source: scripts/release-check-core/manifest.mjs */
const COMMIT = /^[0-9a-f]{40}$/;

/**
 * A release identifier: a UTC instant, then the commit's first twelve.
 *
 * Source: scripts/release-check-core/manifest.mjs (`RELEASE_ID`).
 */
const RELEASE_ID = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-([0-9a-f]{12})$/;

/**
 * The path grammar an object under `/assets/` must have, exactly.
 *
 * Source: scripts/release-check-core/cache.mjs (`ASSET_PATH`).
 */
const ASSET_PATH = /^\/assets\/([0-9a-f]{64})\.([a-z]+)$/;

/**
 * How many days each month has, in a year that is not a leap year.
 *
 * Source: scripts/release-check-core/manifest.mjs (`MONTH_LENGTHS`).
 *
 * @type {readonly number[]}
 */
const MONTH_LENGTHS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

/**
 * Is this year one February has twenty-nine days in?
 *
 * Source: scripts/release-check-core/manifest.mjs (`isLeapYear`) — the whole rule
 * rather than the divisible-by-four half of it.
 *
 * @param {number} year
 * @returns {boolean}
 */
function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Is a value forty lowercase hex characters?
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isCommit(value) {
  return COMMIT.test(value);
}

/**
 * Is a value sixty-four lowercase hex characters?
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isDigest(value) {
  return DIGEST.test(value);
}

/**
 * Is a release identifier well-formed, and what does it claim about its commit?
 *
 * Source: scripts/release-check-core/manifest.mjs (`parseReleaseId`). The instant
 * is checked as an instant rather than as six numbers in ranges: a day between 1
 * and 31 admits the thirty-first of February, which is a moment no release was
 * built at.
 *
 * @param {string} value
 * @returns {{ commitPrefix: string } | null}
 */
export function parseReleaseId(value) {
  const found = RELEASE_ID.exec(value);
  if (found === null) {
    return null;
  }
  const year = found[1];
  const month = found[2];
  const day = found[3];
  const hour = found[4];
  const minute = found[5];
  const second = found[6];
  const commitPrefix = found[7];
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined ||
    commitPrefix === undefined
  ) {
    return null;
  }
  /**
   * @param {string} part
   * @param {number} low
   * @param {number} high
   * @returns {boolean}
   */
  const inRange = (part, low, high) => {
    const number = Number(part);
    return Number.isInteger(number) && number >= low && number <= high;
  };
  if (
    !inRange(month, 1, 12) ||
    !inRange(day, 1, 31) ||
    !inRange(hour, 0, 23) ||
    !inRange(minute, 0, 59) ||
    !inRange(second, 0, 59)
  ) {
    return null;
  }
  const monthLength = MONTH_LENGTHS[Number(month) - 1];
  if (monthLength === undefined) {
    return null;
  }
  const days = monthLength + (Number(month) === 2 && isLeapYear(Number(year)) ? 1 : 0);
  if (Number(day) > days) {
    return null;
  }
  return { commitPrefix };
}

/**
 * Why this string is not a path, or nothing.
 *
 * Source: scripts/release-check-core/manifest.mjs (`whyNotAPath`).
 *
 * @param {string} path
 * @returns {string | null}
 */
export function whyNotAPath(path) {
  if (!path.startsWith('/')) {
    return 'it does not begin with /';
  }
  if (!PATH_CHARACTERS.test(path)) {
    return 'it is written with characters outside [A-Za-z0-9._~/-], which includes every percent-encoding';
  }
  if (path.includes('//')) {
    return 'it carries a duplicate slash';
  }
  const segments = path.split('/').slice(1);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return 'it carries a dot segment';
  }
  return null;
}

/**
 * An asset path taken apart, or `null` if it is not one.
 *
 * Source: scripts/release-check-core/cache.mjs (`parseAssetPath`).
 *
 * @param {string} path
 * @returns {{ digest: string, extension: string } | null}
 */
export function parseAssetPath(path) {
  const found = ASSET_PATH.exec(path);
  if (found === null) {
    return null;
  }
  const digest = found[1];
  const extension = found[2];
  if (digest === undefined || extension === undefined) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(ASSET_CONTENT_TYPES, extension)) {
    return null;
  }
  return { digest, extension };
}

/**
 * The identifier an instant and a commit make.
 *
 * @param {string} instant A compact UTC spelling, `yyyymmddThhmmssZ`.
 * @param {string} commit The full forty-character commit.
 * @returns {string}
 */
export function releaseIdFor(instant, commit) {
  return `${instant}-${commit.slice(0, 12)}`;
}

/**
 * An instant in the compact UTC spelling the release-id grammar uses.
 *
 * @param {Date} at
 * @returns {string}
 */
export function compactInstant(at) {
  return `${at.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
}

// ---------------------------------------------------------------------------
// The release comment
// ---------------------------------------------------------------------------

/** What opens a comment. Source: scripts/release-check-core/identity.mjs */
const COMMENT_OPEN = '<!--';

/**
 * What closes one. The second is the abrupt form, which a browser accepts as a
 * close and a reader who only knows the first would read straight past.
 *
 * Source: scripts/release-check-core/identity.mjs (`COMMENT_CLOSE`).
 *
 * @type {readonly string[]}
 */
const COMMENT_CLOSE = Object.freeze(['-->', '--!>']);

/**
 * The comment's content, exactly, once the span it is in has been found.
 *
 * Source: scripts/release-check-core/identity.mjs (`RELEASE_CONTENT`). Anchored
 * at both ends of the span: one space either side of the identifier and nothing
 * else, so a comment that names a release and says something more is not one.
 */
const RELEASE_CONTENT = /^ release: ([0-9A-Za-z-]+) $/;

/**
 * The release comment for an identifier, as a document carries it.
 *
 * @param {string} releaseId
 * @returns {string}
 */
export function releaseComment(releaseId) {
  return `${COMMENT_OPEN} release: ${releaseId} ${COMMENT_CLOSE[0]}`;
}

/**
 * Every comment span in a document, as the text between its delimiters.
 *
 * Source: scripts/release-check-core/identity.mjs (`commentSpans`). A span that
 * is never closed runs to the end of the document, which is what a browser does
 * with it.
 *
 * @param {string} document
 * @returns {string[]}
 */
export function commentSpans(document) {
  /** @type {string[]} */
  const spans = [];
  let at = 0;
  for (;;) {
    const open = document.indexOf(COMMENT_OPEN, at);
    if (open < 0) {
      return spans;
    }
    const from = open + COMMENT_OPEN.length;
    let end = -1;
    let after = document.length;
    for (const close of COMMENT_CLOSE) {
      const found = document.indexOf(close, from);
      if (found >= 0 && (end < 0 || found < end)) {
        end = found;
        after = found + close.length;
      }
    }
    if (end < 0) {
      spans.push(document.slice(from));
      return spans;
    }
    spans.push(document.slice(from, end));
    at = after;
  }
}

/**
 * Every release comment in a document, in the order written.
 *
 * Source: scripts/release-check-core/identity.mjs (`releaseComments`).
 *
 * @param {string} document
 * @returns {string[]}
 */
export function releaseComments(document) {
  /** @type {string[]} */
  const found = [];
  for (const span of commentSpans(document)) {
    const match = RELEASE_CONTENT.exec(span);
    const value = match === null ? undefined : match[1];
    if (value !== undefined) {
      found.push(value);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// The governed response headers
// ---------------------------------------------------------------------------

/**
 * The §6.1 headers other than the policy and the cache directive.
 *
 * Source: scripts/release-check-core/headers.mjs (`GOVERNED_HEADERS`).
 *
 * @type {Readonly<Record<string, string>>}
 */
export const GOVERNED_HEADERS = Object.freeze({
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, noarchive, nosnippet',
});

/**
 * The policy's directives, in order, with the `connect-src` origin left open.
 *
 * Source: scripts/release-check-core/headers.mjs (`contentSecurityPolicy`).
 *
 * @param {string} apiOrigin
 * @returns {string}
 */
export function contentSecurityPolicy(apiOrigin) {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `connect-src ${apiOrigin}`,
    "img-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "require-trusted-types-for 'script'",
  ].join('; ');
}

/** The field name the policy is carried in. Source: scripts/release-check-core/headers.mjs */
export const CSP_FIELD = 'content-security-policy';

/** The field name the cache directive is carried in. Source: scripts/release-check-core/headers.mjs */
export const CACHE_FIELD = 'cache-control';

// ---------------------------------------------------------------------------
// The drift alarm
// ---------------------------------------------------------------------------

/**
 * One transcription, and where it was taken from.
 *
 * @typedef {object} Transcription
 * @property {string} source Repository-relative path of the module it came from.
 * @property {string} what A name for the value, for the report.
 * @property {string} literal The text that must appear in that file, verbatim.
 */

/**
 * Every transcription above, paired with the text it must still be found in.
 *
 * The pairing is the whole mechanism. A transcription with no source named here
 * is a value nothing holds; a source named here whose text no longer carries the
 * literal is drift, and drift is what this file exists to make loud.
 *
 * @returns {Transcription[]}
 */
function transcriptions() {
  const manifest = 'scripts/release-check-core/manifest.mjs';
  const cache = 'scripts/release-check-core/cache.mjs';
  const identity = 'scripts/release-check-core/identity.mjs';
  const headers = 'scripts/release-check-core/headers.mjs';
  const fixture = 'test/release-fixtures/deployment.mjs';

  /** @type {Transcription[]} */
  const all = [
    { source: manifest, what: 'the manifest schema', literal: `'${MANIFEST_SCHEMA}'` },
    { source: manifest, what: 'the inventory schema', literal: `'${INVENTORY_SCHEMA}'` },
    { source: manifest, what: 'the manifest field list', literal: MANIFEST_FIELDS.map((one) => `'${one}'`).join(', ') },
    { source: manifest, what: 'the inventory field list', literal: INVENTORY_FIELDS.map((one) => `'${one}'`).join(', ') },
    { source: manifest, what: 'the entry point', literal: `ENTRY_POINT = '${ENTRY_POINT}'` },
    { source: manifest, what: 'the origin table path', literal: `CONFIG_PATH = '${CONFIG_PATH}'` },
    { source: manifest, what: 'the path character set', literal: PATH_CHARACTERS.source },
    { source: manifest, what: 'the digest grammar', literal: DIGEST.source },
    { source: manifest, what: 'the commit grammar', literal: COMMIT.source },
    { source: manifest, what: 'the release-identifier grammar', literal: RELEASE_ID.source },
    { source: manifest, what: 'the month lengths', literal: MONTH_LENGTHS.join(', ') },
    { source: manifest, what: 'the leap-year rule', literal: 'year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)' },
    { source: manifest, what: 'the commit binding', literal: 'read.commitPrefix !== commit.slice(0, 12)' },
    { source: cache, what: 'the asset prefix', literal: `ASSET_PREFIX = '${ASSET_PREFIX}'` },
    { source: cache, what: 'the immutable directive', literal: `'${IMMUTABLE_DIRECTIVE}'` },
    { source: cache, what: 'the no-store directive', literal: `'${NO_STORE_DIRECTIVE}'` },
    { source: cache, what: 'the asset path grammar', literal: ASSET_PATH.source },
    { source: identity, what: 'what opens a comment', literal: `COMMENT_OPEN = '${COMMENT_OPEN}'` },
    { source: identity, what: 'what closes one', literal: COMMENT_CLOSE.map((one) => `'${one}'`).join(', ') },
    { source: identity, what: 'the release comment grammar', literal: RELEASE_CONTENT.source },
    { source: headers, what: 'the policy join', literal: "].join('; ')" },
    { source: headers, what: 'the policy field name', literal: `CSP_FIELD = '${CSP_FIELD}'` },
    { source: headers, what: 'the cache field name', literal: `CACHE_FIELD = '${CACHE_FIELD}'` },
  ];

  for (const [extension, type] of Object.entries(ASSET_CONTENT_TYPES)) {
    all.push({ source: cache, what: `the ${extension} content type`, literal: `${extension}: '${type}'` });
  }
  for (const [name, value] of Object.entries(GOVERNED_HEADERS)) {
    all.push({ source: headers, what: `the ${name} value`, literal: `'${name}': '${value}'` });
  }
  for (const directive of contentSecurityPolicy('__ORIGIN__').split('; ')) {
    all.push({
      source: headers,
      what: `the policy directive ${directive}`,
      literal: directive.includes('__ORIGIN__') ? '`connect-src ${apiOrigin}`' : `"${directive}"`,
    });
  }
  for (const [path, type] of Object.entries(DOCUMENT_CONTENT_TYPES)) {
    all.push({ source: fixture, what: `the ${path} content type`, literal: `contentType: '${type}'` });
  }

  return all;
}

/**
 * @returns {number} process exit code
 */
function selfTest() {
  let failures = 0;

  /**
   * @param {string} label
   * @param {boolean} held
   * @param {string} detail
   */
  const record = (label, held, detail) => {
    if (held) {
      process.stdout.write(`  ok   ${label}\n`);
      return;
    }
    failures += 1;
    process.stdout.write(`  FAIL ${label} — ${detail}\n`);
  };

  /** @type {Map<string, string>} */
  const texts = new Map();
  /**
   * @param {string} relativePath
   * @returns {string}
   */
  const sourceText = (relativePath) => {
    const held = texts.get(relativePath);
    if (held !== undefined) {
      return held;
    }
    const text = readFileSync(join(REPO_ROOT, relativePath), 'utf8');
    texts.set(relativePath, text);
    return text;
  };

  const all = transcriptions();
  for (const one of transcriptions()) {
    record(
      `${one.what} is still spelled that way in ${one.source}`,
      sourceText(one.source).includes(one.literal),
      `${JSON.stringify(one.literal)} does not appear in ${one.source}`,
    );
  }

  // The two readings, both directions. A transcription that is a function rather
  // than a string cannot be checked by looking for it in a file, so it is checked
  // by asking it the questions the frozen one answers.
  record('a well-formed release identifier parses', parseReleaseId('20260813T091500Z-a1b2c3d4e5f6') !== null, 'it did not');
  record('the thirty-first of February is refused', parseReleaseId('20260231T091500Z-a1b2c3d4e5f6') === null, 'it parsed');
  record(
    'the twenty-ninth of a February that has twenty-eight days is refused',
    parseReleaseId('20270229T091500Z-a1b2c3d4e5f6') === null,
    'it parsed',
  );
  record('the twenty-ninth of a leap February parses', parseReleaseId('20240229T091500Z-a1b2c3d4e5f6') !== null, 'it did not');
  record('a year no century divides is not a leap year', parseReleaseId('21000229T091500Z-a1b2c3d4e5f6') === null, 'it parsed');
  record('an hour of twenty-four is refused', parseReleaseId('20260813T241500Z-a1b2c3d4e5f6') === null, 'it parsed');

  const identifier = '20260813T091500Z-a1b2c3d4e5f6';
  record(
    'the comment this file writes is one the reading finds',
    releaseComments(`<html></html>\n${releaseComment(identifier)}\n`).join(',') === identifier,
    'it was not found',
  );
  record(
    'a comment carrying anything more is not a release comment',
    releaseComments(`<!-- release: ${identifier} and more -->`).length === 0,
    'it was read as one',
  );
  record(
    'the abrupt close ends a span',
    releaseComments(`<!-- release: ${identifier} --!><!-- release: ${identifier} -->`).length === 2,
    'the abrupt close was read past',
  );
  record(
    'an unterminated span runs to the end of the document',
    commentSpans('<!-- release: nothing closes this').length === 1,
    'it was not read as a span',
  );
  record(
    'a release spelling outside a comment span is not a release comment',
    releaseComments(`<p> release: ${identifier} </p>`).length === 0,
    'ordinary text was read as a comment',
  );

  record('a well-formed asset path parses', parseAssetPath(`/assets/${'a'.repeat(64)}.js`) !== null, 'it did not');
  record('an extension outside the table is refused', parseAssetPath(`/assets/${'a'.repeat(64)}.svg`) === null, 'it parsed');
  record('a path that is not a direct child is refused', parseAssetPath(`/assets/x/${'a'.repeat(64)}.js`) === null, 'it parsed');
  record('a percent-encoded path is refused', whyNotAPath('/js/%2econfig.js') !== null, 'it was accepted');
  record('a dot segment is refused', whyNotAPath('/js/../config.js') !== null, 'it was accepted');
  record('an ordinary path is accepted', whyNotAPath(CONFIG_PATH) === null, 'it was refused');

  if (failures === 0) {
    process.stdout.write(`frozen-spellings self-test — PASS (${all.length} transcription(s) re-read from source)\n`);
    return 0;
  }
  process.stdout.write(`frozen-spellings self-test — FAIL (${failures} case(s))\n`);
  return 1;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  if (process.argv[2] === '--self-test') {
    process.exit(selfTest());
  }
  process.stderr.write('frozen-spellings — usage: frozen-spellings.mjs --self-test\n');
  process.exit(2);
}
