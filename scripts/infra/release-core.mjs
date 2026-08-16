/**
 * Everything the release drivers decide, separated from everything they call.
 *
 * The shell halves — `release.sh` and `drill.sh` — fetch: they run `aws`, they
 * run `git`, they write files. This decides: it reads documents and answers, and
 * every one of its answers can be driven from a document written by hand. That
 * split is the same one `assert-distribution-core.mjs` makes and it is made for
 * the same reason — a failing direction that has never run is a check nobody has
 * seen work, and a check whose failing direction needs a real deploy to reach is
 * a check whose failing direction never runs.
 *
 * Nothing here imports the release check's frozen core, and nothing here imports
 * the fixture corpus that imports it. Every constant it needs comes through
 * `frozen-spellings.mjs`, which transcribes them and re-reads each one out of its
 * source file as text. The oracle re-reads all of it itself, from its own copy,
 * and its verdict is the one that decides a switch.
 *
 * Usage:
 *   node scripts/infra/release-core.mjs --read-output <stacks.json> <OutputKey>
 *   node scripts/infra/release-core.mjs --read-json <file> <Dotted.Path>
 *   node scripts/infra/release-core.mjs --check-remote <url>
 *   node scripts/infra/release-core.mjs --manifest-field <manifest.json> <field>
 *   node scripts/infra/release-core.mjs --preflight-manifests <target.json> [<retained.json> ...]
 *   node scripts/infra/release-core.mjs --plan <manifest.json>
 *   node scripts/infra/release-core.mjs --listing-keys <listing.json>
 *   node scripts/infra/release-core.mjs --inventory <keys.txt> <out.json>
 *   node scripts/infra/release-core.mjs --scan-release-comment <document>
 *   node scripts/infra/release-core.mjs --sha256 <file>
 *   node scripts/infra/release-core.mjs --run-id
 *   node scripts/infra/release-core.mjs --retain-until <days>
 *   node scripts/infra/release-core.mjs --log-body <out.json> --event E --release-id R
 *                                       --operation O --timestamp T --outcome ok|failed
 *                                       --detail D [--invalidation-id I ...]
 *   node scripts/infra/release-core.mjs --self-test
 *
 * Exit codes: 0 = it answered, 1 = it refused, 2 = it could not run.
 */

import { createHash } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ASSET_CONTENT_TYPES,
  ASSET_PREFIX,
  compactInstant,
  CONFIG_PATH,
  DOCUMENT_CONTENT_TYPES,
  ENTRY_POINT,
  IMMUTABLE_DIRECTIVE,
  INVENTORY_SCHEMA,
  isCommit,
  isDigest,
  MANIFEST_FIELDS,
  MANIFEST_SCHEMA,
  parseAssetPath,
  parseReleaseId,
  releaseComments,
  whyNotAPath,
} from './frozen-spellings.mjs';

/** The schema the release log's events are written under. */
export const RELEASE_LOG_SCHEMA = 'viewer-release-log/1';

/**
 * The events the release log carries, and no others.
 *
 * @type {readonly string[]}
 */
export const LOG_EVENTS = Object.freeze([
  'switch-started',
  'switch-succeeded',
  'switch-failed',
  'drill-started',
  'drill-mangled',
  'drill-restored',
  'drill-succeeded',
  'drill-failed',
]);

/**
 * What a run of one of these drivers is doing.
 *
 * The operation is a field of the log rather than a branch of the code: a
 * rollback is a switch to an older manifest and takes the same path, and a path
 * that forked on the word would be two paths one of which is exercised rarely.
 *
 * @type {readonly string[]}
 */
export const LOG_OPERATIONS = Object.freeze(['release', 'rollback', 'drill']);

/** The public repository the drivers require the `origin` remote to be. */
export const PUBLIC_REMOTE_HOST = 'github.com';

/** Its path, without a leading slash and without the optional `.git`. */
export const PUBLIC_REMOTE_PATH = 'practicalbonanza/PatientScribe-Viewer';

/**
 * @param {string} message
 * @returns {never}
 */
function cannotRun(message) {
  process.stderr.write(`release-core — cannot run: ${message}\n`);
  process.exit(2);
}

/**
 * @param {readonly string[]} lines
 * @returns {never}
 */
function refuse(lines) {
  for (const line of lines) {
    process.stderr.write(`release-core — refusing: ${line}\n`);
  }
  process.exit(1);
}

/**
 * @param {string} file
 * @returns {string}
 */
function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return cannotRun(`cannot open ${file}`);
  }
}

/**
 * @param {string} file
 * @returns {unknown}
 */
function readJson(file) {
  const text = readText(file);
  try {
    return JSON.parse(text);
  } catch (error) {
    return cannotRun(`${file} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function asObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * Byte-wise ascending: the one ordering rule the build, the manifest and the
 * inventory all share.
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function byBytes(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

// ---------------------------------------------------------------------------
// Reading a manifest strictly, before anything is called
// ---------------------------------------------------------------------------

/**
 * A duplicate-member scan over the document's text.
 *
 * `JSON.parse` answers what a value is and says nothing about how it was
 * written, so a manifest naming one path twice parses into a map with one entry
 * and nothing records that a choice was made. The oracle refuses that, and it
 * refuses it after the switch has happened; refusing it here costs nothing and is
 * the earliest anyone can be told. This is an EARLY-REFUSAL COURTESY, not an
 * authority: the frozen reader re-reads the whole document itself and its answer
 * is the one that counts. Informed by the grammar in
 * scripts/release-check-core/json-text.mjs, written here rather than imported.
 *
 * @param {string} text
 * @returns {{ duplicates: string[], syntax: string | null }}
 */
export function scanForDuplicateKeys(text) {
  /** @type {string[]} */
  const duplicates = [];
  let at = 0;

  /** @returns {string | null} */
  const skipWhitespace = () => {
    while (at < text.length) {
      const ch = text[at];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        at += 1;
        continue;
      }
      return ch ?? null;
    }
    return null;
  };

  /** @returns {string} */
  const readString = () => {
    if (text[at] !== '"') {
      throw new SyntaxError(`expected a string at ${at}`);
    }
    at += 1;
    let out = '';
    while (at < text.length) {
      const ch = text[at];
      if (ch === undefined) {
        break;
      }
      if (ch === '"') {
        at += 1;
        return out;
      }
      if (ch === '\\') {
        const escape = text[at + 1];
        at += 2;
        if (escape === 'u') {
          const code = text.slice(at, at + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(code)) {
            throw new SyntaxError(`a \\u escape at ${at} is not four hex digits`);
          }
          out += String.fromCharCode(Number.parseInt(code, 16));
          at += 4;
          continue;
        }
        const simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        const resolved = escape === undefined ? undefined : /** @type {Record<string, string>} */ (simple)[escape];
        if (resolved === undefined) {
          throw new SyntaxError(`an unknown escape at ${at - 1}`);
        }
        out += resolved;
        continue;
      }
      out += ch;
      at += 1;
    }
    throw new SyntaxError('a string was never closed');
  };

  /** @param {string} where */
  const readValue = (where) => {
    const ch = skipWhitespace();
    if (ch === null) {
      throw new SyntaxError('the document ended where a value was expected');
    }
    if (ch === '{') {
      at += 1;
      /** @type {Set<string>} */
      const seen = new Set();
      if (skipWhitespace() === '}') {
        at += 1;
        return;
      }
      for (;;) {
        if (skipWhitespace() !== '"') {
          throw new SyntaxError(`expected a member name at ${at}`);
        }
        const name = readString();
        if (seen.has(name)) {
          duplicates.push(`${where}.${name}`);
        }
        seen.add(name);
        if (skipWhitespace() !== ':') {
          throw new SyntaxError(`expected a colon at ${at}`);
        }
        at += 1;
        readValue(`${where}.${name}`);
        const next = skipWhitespace();
        if (next === ',') {
          at += 1;
          continue;
        }
        if (next === '}') {
          at += 1;
          return;
        }
        throw new SyntaxError(`expected a comma or a close at ${at}`);
      }
    }
    if (ch === '[') {
      at += 1;
      if (skipWhitespace() === ']') {
        at += 1;
        return;
      }
      let index = 0;
      for (;;) {
        readValue(`${where}[${index}]`);
        index += 1;
        const next = skipWhitespace();
        if (next === ',') {
          at += 1;
          continue;
        }
        if (next === ']') {
          at += 1;
          return;
        }
        throw new SyntaxError(`expected a comma or a close at ${at}`);
      }
    }
    if (ch === '"') {
      readString();
      return;
    }
    const literal = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(at));
    if (literal === null) {
      throw new SyntaxError(`expected a value at ${at}`);
    }
    at += literal[0].length;
  };

  try {
    readValue('');
    if (skipWhitespace() !== null) {
      throw new SyntaxError(`the document carries more than one value, from ${at}`);
    }
  } catch (error) {
    return { duplicates, syntax: error instanceof Error ? error.message : 'the document could not be scanned' };
  }

  return { duplicates, syntax: null };
}

/**
 * A release manifest, once it is one.
 *
 * @typedef {object} ReleaseManifest
 * @property {string} commit
 * @property {string} release_id
 * @property {Record<string, string>} objects
 */

/**
 * Read a manifest document against the transcribed grammar.
 *
 * @param {string} text
 * @param {string} subject
 * @returns {{ manifest: ReleaseManifest | null, refusals: string[] }}
 */
export function readManifestDocument(text, subject) {
  /** @type {string[]} */
  const refusals = [];

  const scan = scanForDuplicateKeys(text);
  if (scan.syntax !== null) {
    return { manifest: null, refusals: [`${subject} could not be read as JSON: ${scan.syntax}`] };
  }
  for (const duplicate of scan.duplicates) {
    refusals.push(`${subject} states ${duplicate} more than once, and a parser that keeps the last is not a detection`);
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { manifest: null, refusals: [`${subject} could not be parsed: ${error instanceof Error ? error.message : 'unknown'}`] };
  }

  const source = asObject(parsed);
  if (source === null) {
    return { manifest: null, refusals: [`${subject} is not a JSON object`] };
  }

  const names = Object.keys(source).sort();
  const expected = [...MANIFEST_FIELDS].sort();
  if (names.join(',') !== expected.join(',')) {
    return {
      manifest: null,
      refusals: [`${subject} carries the fields ${JSON.stringify(names)}, and the schema is exactly ${JSON.stringify(expected)}`],
    };
  }

  const schema = source['schema'];
  const commit = source['commit'];
  const releaseId = source['release_id'];
  const objects = asObject(source['objects']);

  if (schema !== MANIFEST_SCHEMA) {
    refusals.push(`${subject} names the schema ${JSON.stringify(schema)}, and it must be ${JSON.stringify(MANIFEST_SCHEMA)}`);
  }
  if (typeof commit !== 'string' || !isCommit(commit)) {
    refusals.push(`${subject} records the commit ${JSON.stringify(commit)}, and it must be forty lowercase hex characters`);
  }
  if (typeof releaseId !== 'string') {
    refusals.push(`${subject} records the release_id ${JSON.stringify(releaseId)}, and it must be a string`);
  } else {
    const read = parseReleaseId(releaseId);
    if (read === null) {
      refusals.push(`${subject} records the release_id ${JSON.stringify(releaseId)}, and its form is <UTC yyyymmddThhmmssZ>-<12 hex>`);
    } else if (typeof commit === 'string' && read.commitPrefix !== commit.slice(0, 12)) {
      refusals.push(`${subject} carries the suffix ${read.commitPrefix} and its commit begins ${commit.slice(0, 12)}`);
    }
  }

  if (objects === null) {
    refusals.push(`${subject} has an objects that is not a JSON object`);
    return { manifest: null, refusals };
  }

  /** @type {Record<string, string>} */
  const map = {};
  for (const [path, digest] of Object.entries(objects)) {
    if (path === '/') {
      refusals.push(`${subject} names / as an object, and / is a serving alias verified against the live origin`);
      continue;
    }
    const why = whyNotAPath(path);
    if (why !== null) {
      refusals.push(`${subject} names ${JSON.stringify(path)}, which is not a path: ${why}`);
      continue;
    }
    if (typeof digest !== 'string' || !isDigest(digest)) {
      refusals.push(`${subject} records ${JSON.stringify(digest)} at ${path}, and a digest is sixty-four lowercase hex characters`);
      continue;
    }
    map[path] = digest;
  }

  if (!Object.prototype.hasOwnProperty.call(map, ENTRY_POINT)) {
    refusals.push(`${subject} does not name ${ENTRY_POINT}, and the entry point is always an object`);
  }

  if (refusals.length > 0) {
    return { manifest: null, refusals };
  }
  return { manifest: { commit: String(commit), release_id: String(releaseId), objects: map }, refusals };
}

/**
 * The two static defects a union of manifests can have, decided from the
 * documents alone.
 *
 * Both are things the frozen core refuses, and both would otherwise first surface
 * after the entry point had already moved — where no rollback cures them, because
 * a rollback runs the same union and refuses identically. So they are asked here,
 * at preflight, before anything is put anywhere.
 *
 * @param {readonly {subject: string, manifest: ReleaseManifest}[]} all
 * @returns {string[]}
 */
export function unionDefects(all) {
  /** @type {string[]} */
  const refusals = [];
  /** @type {Map<string, {digest: string, subject: string}>} */
  const seen = new Map();
  for (const { subject, manifest } of all) {
    for (const [path, digest] of Object.entries(manifest.objects)) {
      if (!path.startsWith(ASSET_PREFIX)) {
        continue;
      }
      const named = parseAssetPath(path);
      if (named !== null && named.digest !== digest) {
        refusals.push(
          `${subject} records ${digest} for ${path}, and an object under ${ASSET_PREFIX} is named by the digest of its own bytes`,
        );
      }
      const was = seen.get(path);
      if (was !== undefined && was.digest !== digest) {
        refusals.push(
          `${was.subject} records ${was.digest} for ${path} and ${subject} records ${digest} — at most one of them can be the object that is there`,
        );
        continue;
      }
      seen.set(path, { digest, subject });
    }
  }
  return refusals;
}

// ---------------------------------------------------------------------------
// The upload plan
// ---------------------------------------------------------------------------

/**
 * One object to be put, with everything the put needs.
 *
 * @typedef {object} PlannedUpload
 * @property {string} path The manifest path.
 * @property {string} key The S3 key: the path with its single leading slash
 *   removed and nothing else changed. The distribution's default root object is
 *   exactly `index.html`, and a key with a leading slash is a different object it
 *   would never serve.
 * @property {string} contentType
 * @property {string} cacheControl `-` where the object carries none.
 */

/**
 * The plan, in the order the switch performs it.
 *
 * Assets and the origin table strictly before the entry point: the entry point is
 * what says which release is up, so it moves last and every object it names is
 * already there when it does.
 *
 * @param {ReleaseManifest} manifest
 * @returns {{ plan: PlannedUpload[], refusals: string[] }}
 */
export function planUploads(manifest) {
  /** @type {PlannedUpload[]} */
  const before = [];
  /** @type {PlannedUpload[]} */
  const entry = [];
  /** @type {string[]} */
  const refusals = [];

  for (const path of Object.keys(manifest.objects).sort(byBytes)) {
    const asset = parseAssetPath(path);
    /** @type {string | null} */
    let contentType = null;
    let cacheControl = '-';
    if (asset !== null) {
      contentType = ASSET_CONTENT_TYPES[asset.extension] ?? null;
      cacheControl = IMMUTABLE_DIRECTIVE;
    } else {
      contentType = DOCUMENT_CONTENT_TYPES[path] ?? null;
    }
    if (contentType === null) {
      refusals.push(
        `${path} is neither ${ENTRY_POINT}, nor ${CONFIG_PATH}, nor a well-formed object under ${ASSET_PREFIX}, so this release names an object nothing knows how to serve`,
      );
      continue;
    }
    const upload = { path, key: path.slice(1), contentType, cacheControl };
    if (path === ENTRY_POINT) {
      entry.push(upload);
      continue;
    }
    before.push(upload);
  }

  return { plan: [...before, ...entry], refusals };
}

// ---------------------------------------------------------------------------
// The listing and the inventory
// ---------------------------------------------------------------------------

/**
 * Every key a listing carries.
 *
 * The CLI paginates a listing itself and merges the pages, so a merged document
 * carrying a continuation token is a document that is not the whole listing — and
 * a model of this CLI that accepted one would be a model of a different CLI. It
 * is refused rather than followed.
 *
 * @param {unknown} listing
 * @returns {{ keys: string[], refusals: string[] }}
 */
export function listingKeys(listing) {
  const root = asObject(listing);
  if (root === null) {
    return { keys: [], refusals: ['the listing is not a JSON object'] };
  }
  const token = root['NextToken'];
  if (token !== undefined && token !== null && token !== '') {
    return {
      keys: [],
      refusals: [
        'the listing carries a NextToken, and this CLI paginates and merges for itself — a truncated listing here is a listing of something other than the bucket',
      ],
    };
  }
  const contents = Array.isArray(root['Contents']) ? root['Contents'] : [];
  /** @type {string[]} */
  const keys = [];
  for (const entry of contents) {
    const record = asObject(entry);
    const key = record === null ? undefined : record['Key'];
    if (typeof key === 'string' && key !== '') {
      keys.push(key);
    }
  }
  return { keys: keys.sort(byBytes), refusals: [] };
}

/**
 * The deploy-side listing, as the document the check reads.
 *
 * The keys are mapped back to paths by restoring the one leading slash the upload
 * removed — the exact inverse, so that a round trip is the identity.
 *
 * @param {readonly string[]} keys
 * @returns {{ document: string, refusals: string[] }}
 */
export function inventoryDocument(keys) {
  /** @type {string[]} */
  const refusals = [];
  /** @type {string[]} */
  const paths = [];
  for (const key of keys) {
    const path = `/${key}`;
    const why = whyNotAPath(path);
    if (why !== null) {
      refusals.push(`the origin lists ${JSON.stringify(key)}, and ${JSON.stringify(path)} is not a path: ${why}`);
      continue;
    }
    if (!paths.includes(path)) {
      paths.push(path);
    }
  }
  paths.sort(byBytes);
  return { document: `${JSON.stringify({ schema: INVENTORY_SCHEMA, paths }, null, 2)}\n`, refusals };
}

// ---------------------------------------------------------------------------
// The public roster
// ---------------------------------------------------------------------------

/**
 * The roster the public tip publishes, read out of `git ls-tree`.
 *
 * Fail closed: a member is a blob whose name is a release identifier and
 * `.json`, and anything else under that tree — a subtree, a stray file, a name
 * that is nearly an identifier — refuses the run rather than being skipped. A
 * roster that quietly ignores what it does not recognise is a roster whose
 * membership something else decides.
 *
 * @param {string} text The output of `git ls-tree <tree>`.
 * @returns {{ stems: string[], refusals: string[] }}
 */
export function rosterEntries(text) {
  /** @type {string[]} */
  const refusals = [];
  /** @type {string[]} */
  const stems = [];
  for (const line of text.split('\n')) {
    if (line === '') {
      continue;
    }
    const tab = line.indexOf('\t');
    if (tab < 0) {
      refusals.push(`the public tip's releases tree carries ${JSON.stringify(line)}, which is not an entry this can read`);
      continue;
    }
    const fields = line.slice(0, tab).split(/\s+/);
    const type = fields[1];
    const name = line.slice(tab + 1);
    if (type !== 'blob') {
      refusals.push(
        `the public tip's releases tree carries ${JSON.stringify(name)} as a ${String(type)}, and the roster is manifests and nothing else`,
      );
      continue;
    }
    if (!name.endsWith('.json')) {
      refusals.push(`the public tip's releases tree carries ${JSON.stringify(name)}, which is not <release-id>.json`);
      continue;
    }
    const stem = name.slice(0, -'.json'.length);
    if (parseReleaseId(stem) === null) {
      refusals.push(`the public tip's releases tree carries ${JSON.stringify(name)}, whose stem is not a release identifier`);
      continue;
    }
    stems.push(stem);
  }
  return { stems: stems.sort(byBytes), refusals };
}

// ---------------------------------------------------------------------------
// The public remote
// ---------------------------------------------------------------------------

/**
 * A remote URL taken apart, or `null` where it is not one.
 *
 * Both spellings answer — the scp-like `user@host:path` and a URL with a scheme —
 * because both are ordinary ways to write the same remote. What does not answer
 * is a same-path mirror on another host, which is the class this is for.
 *
 * @param {string} url
 * @returns {{ host: string, path: string } | null}
 */
export function parseRemote(url) {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url)) {
    try {
      const parsed = new URL(url);
      return { host: parsed.hostname.toLowerCase(), path: parsed.pathname.replace(/^\//, '') };
    } catch {
      return null;
    }
  }
  const scpLike = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(url);
  if (scpLike === null) {
    return null;
  }
  const host = scpLike[1];
  const path = scpLike[2];
  if (host === undefined || path === undefined) {
    return null;
  }
  return { host: host.toLowerCase(), path };
}

/**
 * Is this remote the public repository the drivers read the roster from?
 *
 * @param {string} url
 * @returns {string | null} Why it is not, or `null` where it is.
 */
export function whyNotThePublicRemote(url) {
  const parsed = parseRemote(url);
  if (parsed === null) {
    return `the origin remote is ${JSON.stringify(url)}, which is not a remote this can read a host and a path out of`;
  }
  const path = parsed.path.replace(/\.git$/, '').replace(/\/$/, '');
  if (parsed.host !== PUBLIC_REMOTE_HOST) {
    return `the origin remote is on ${parsed.host}, and the public repository is on ${PUBLIC_REMOTE_HOST}`;
  }
  if (path.toLowerCase() !== PUBLIC_REMOTE_PATH.toLowerCase()) {
    return `the origin remote names ${path}, and the public repository is ${PUBLIC_REMOTE_PATH}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The log body
// ---------------------------------------------------------------------------

/**
 * One release-log event, as the object that is written.
 *
 * The fields are exactly these eight. The values may name account-side facts —
 * the bucket this lands in is private and is never served — and the schema is
 * public and is documented in RELEASING.md.
 *
 * @param {object} event
 * @param {string} event.event
 * @param {string} event.releaseId
 * @param {string} event.operation
 * @param {string} event.timestamp
 * @param {readonly string[]} event.invalidationIds
 * @param {string} event.outcome
 * @param {string} event.detail
 * @returns {{ document: string, refusals: string[] }}
 */
export function logBody({ event, releaseId, operation, timestamp, invalidationIds, outcome, detail }) {
  /** @type {string[]} */
  const refusals = [];
  if (!LOG_EVENTS.includes(event)) {
    refusals.push(`${JSON.stringify(event)} is not one of the events this log carries: ${LOG_EVENTS.join(', ')}`);
  }
  if (!LOG_OPERATIONS.includes(operation)) {
    refusals.push(`${JSON.stringify(operation)} is not one of ${LOG_OPERATIONS.join(', ')}`);
  }
  if (outcome !== 'ok' && outcome !== 'failed') {
    refusals.push(`${JSON.stringify(outcome)} is not ok or failed`);
  }
  if (parseReleaseId(releaseId) === null) {
    refusals.push(`${JSON.stringify(releaseId)} is not a release identifier`);
  }
  if (!/^\d{8}T\d{6}Z$/.test(timestamp)) {
    refusals.push(`${JSON.stringify(timestamp)} is not the compact UTC spelling the release-id grammar uses`);
  }
  const document = `${JSON.stringify(
    {
      schema: RELEASE_LOG_SCHEMA,
      event,
      release_id: releaseId,
      operation,
      timestamp,
      invalidation_ids: [...invalidationIds],
      outcome,
      detail,
    },
    null,
    2,
  )}\n`;
  return { document, refusals };
}

// ---------------------------------------------------------------------------
// Small readings the shell asks for
// ---------------------------------------------------------------------------

/**
 * Every stack output, by key.
 *
 * @param {unknown} stacks
 * @returns {Map<string, string>}
 */
export function stackOutputs(stacks) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const root = asObject(stacks);
  const list = root === null || !Array.isArray(root['Stacks']) ? null : root['Stacks'];
  const first = list === null ? null : asObject(list[0]);
  const outputs = first === null || !Array.isArray(first['Outputs']) ? null : first['Outputs'];
  if (outputs === null) {
    return out;
  }
  for (const entry of outputs) {
    const record = asObject(entry);
    if (record === null) {
      continue;
    }
    const key = record['OutputKey'];
    const value = record['OutputValue'];
    if (typeof key === 'string' && typeof value === 'string') {
      out.set(key, value);
    }
  }
  return out;
}

/**
 * One value out of a JSON document, by a dotted path of member names.
 *
 * @param {unknown} document
 * @param {string} dotted
 * @returns {string | null}
 */
export function readDotted(document, dotted) {
  /** @type {unknown} */
  let here = document;
  for (const name of dotted.split('.')) {
    const record = asObject(here);
    if (record === null) {
      return null;
    }
    here = record[name];
  }
  if (typeof here === 'string' || typeof here === 'number' || typeof here === 'boolean') {
    return String(here);
  }
  return null;
}

/**
 * The run identifier: a UTC instant and six hex characters of entropy.
 *
 * What it is for is disambiguation rather than secrecy. The key a log event lands
 * at carries the release identifier and a timestamp, per the ruling; two runs of
 * one release in one second would otherwise write the same key, and a conditional
 * write turns that into a refused write rather than a lost record — loud, but
 * loud about the wrong thing.
 *
 * @returns {string}
 */
export function runIdentifier() {
  const handle = openSync('/dev/urandom', 'r');
  try {
    const bytes = Buffer.alloc(3);
    readSync(handle, bytes, 0, 3, null);
    return `${compactInstant(new Date())}-${bytes.toString('hex')}`;
  } finally {
    closeSync(handle);
  }
}

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

/**
 * @param {readonly string[]} argv
 * @returns {number}
 */
function run(argv) {
  const mode = argv[0];

  if (mode === '--read-output') {
    const file = argv[1];
    const key = argv[2];
    if (file === undefined || key === undefined) {
      cannotRun('usage: --read-output <stacks.json> <OutputKey>');
    }
    const value = stackOutputs(readJson(file)).get(key);
    if (value === undefined || value === '') {
      cannotRun(`the stack carries no ${key} output`);
    }
    process.stdout.write(value);
    return 0;
  }

  if (mode === '--read-output-raw') {
    // The same reading, except that an empty value comes back as one rather
    // than as "the stack carries no such output". The difference matters for
    // exactly one value: a release-log prefix that is empty is a prefix that
    // would write the record at the bucket root, and the caller refuses it BY
    // NAME rather than as a missing output.
    const file = argv[1];
    const key = argv[2];
    if (file === undefined || key === undefined) {
      cannotRun('usage: --read-output-raw <stacks.json> <OutputKey>');
    }
    const value = stackOutputs(readJson(file)).get(key);
    if (value === undefined) {
      cannotRun(`the stack carries no ${key} output`);
    }
    process.stdout.write(value);
    return 0;
  }

  if (mode === '--read-json') {
    const file = argv[1];
    const dotted = argv[2];
    if (file === undefined || dotted === undefined) {
      cannotRun('usage: --read-json <file> <Dotted.Path>');
    }
    const value = readDotted(readJson(file), dotted);
    if (value === null) {
      cannotRun(`${file} carries no ${dotted}`);
    }
    process.stdout.write(value);
    return 0;
  }

  if (mode === '--check-remote') {
    const url = argv[1];
    if (url === undefined) {
      cannotRun('usage: --check-remote <url>');
    }
    const why = whyNotThePublicRemote(url);
    if (why !== null) {
      refuse([why, 'the roster and the target are read from the public tip, so the remote this reads has to be the public repository']);
    }
    return 0;
  }

  if (mode === '--manifest-field') {
    const file = argv[1];
    const field = argv[2];
    if (file === undefined || field === undefined) {
      cannotRun('usage: --manifest-field <manifest.json> <commit|release_id>');
    }
    const read = readManifestDocument(readText(file), file);
    if (read.manifest === null) {
      refuse(read.refusals);
    }
    if (field === 'commit') {
      process.stdout.write(read.manifest.commit);
      return 0;
    }
    if (field === 'release_id') {
      process.stdout.write(read.manifest.release_id);
      return 0;
    }
    if (field === 'config-digest') {
      const digest = read.manifest.objects[CONFIG_PATH];
      if (digest === undefined) {
        refuse([`${file} does not bind ${CONFIG_PATH}, so the expected connect-src would come from bytes nothing pinned`]);
      }
      process.stdout.write(digest);
      return 0;
    }
    if (field === 'entry-digest') {
      const digest = read.manifest.objects[ENTRY_POINT];
      if (digest === undefined) {
        refuse([`${file} does not name ${ENTRY_POINT}`]);
      }
      process.stdout.write(digest);
      return 0;
    }
    cannotRun(`unknown field: ${field}`);
  }

  if (mode === '--preflight-manifests') {
    const files = argv.slice(1);
    if (files.length === 0) {
      cannotRun('usage: --preflight-manifests <target.json> [<retained.json> ...]');
    }
    /** @type {string[]} */
    const refusals = [];
    /** @type {{subject: string, manifest: ReleaseManifest}[]} */
    const all = [];
    for (const file of files) {
      const read = readManifestDocument(readText(file), file);
      refusals.push(...read.refusals);
      if (read.manifest !== null) {
        all.push({ subject: file, manifest: read.manifest });
      }
    }
    refusals.push(...unionDefects(all));
    if (refusals.length > 0) {
      refuse(refusals);
    }
    process.stdout.write(`release-core — ${all.length} manifest(s) read strictly, and the union has neither static defect\n`);
    return 0;
  }

  if (mode === '--is-release-id') {
    const value = argv[1];
    if (value === undefined) {
      cannotRun('usage: --is-release-id <value>');
    }
    if (parseReleaseId(value) === null) {
      refuse([`${JSON.stringify(value)} is not a release identifier: the form is <UTC yyyymmddThhmmssZ>-<12 hex>`]);
    }
    return 0;
  }

  if (mode === '--roster-entries') {
    const file = argv[1];
    if (file === undefined) {
      cannotRun('usage: --roster-entries <ls-tree-output>');
    }
    const read = rosterEntries(readText(file));
    if (read.refusals.length > 0) {
      refuse(read.refusals);
    }
    for (const stem of read.stems) {
      process.stdout.write(`${stem}\n`);
    }
    return 0;
  }

  if (mode === '--plan') {
    const file = argv[1];
    if (file === undefined) {
      cannotRun('usage: --plan <manifest.json>');
    }
    const read = readManifestDocument(readText(file), file);
    if (read.manifest === null) {
      refuse(read.refusals);
    }
    const planned = planUploads(read.manifest);
    if (planned.refusals.length > 0) {
      refuse(planned.refusals);
    }
    for (const upload of planned.plan) {
      process.stdout.write(`${upload.path}\t${upload.key}\t${upload.contentType}\t${upload.cacheControl}\n`);
    }
    return 0;
  }

  if (mode === '--listing-keys') {
    const file = argv[1];
    if (file === undefined) {
      cannotRun('usage: --listing-keys <listing.json>');
    }
    const read = listingKeys(readJson(file));
    if (read.refusals.length > 0) {
      refuse(read.refusals);
    }
    for (const key of read.keys) {
      process.stdout.write(`${key}\n`);
    }
    return 0;
  }

  if (mode === '--inventory') {
    const keysFile = argv[1];
    const out = argv[2];
    if (keysFile === undefined || out === undefined) {
      cannotRun('usage: --inventory <keys.txt> <out.json>');
    }
    const keys = readText(keysFile).split('\n').filter((line) => line !== '');
    const built = inventoryDocument(keys);
    if (built.refusals.length > 0) {
      refuse(built.refusals);
    }
    writeFileSync(out, built.document);
    return 0;
  }

  if (mode === '--scan-release-comment') {
    const file = argv[1];
    if (file === undefined) {
      cannotRun('usage: --scan-release-comment <document>');
    }
    const found = releaseComments(readText(file));
    if (found.length !== 1) {
      refuse([
        `the captured document carries ${found.length} release comment(s), and exactly one is expected — the frozen identity rule demands one and so does this capture`,
      ]);
    }
    const identifier = found[0];
    if (identifier === undefined || parseReleaseId(identifier) === null) {
      refuse([`the captured document names ${JSON.stringify(identifier)}, which is not a release identifier`]);
    }
    process.stdout.write(identifier);
    return 0;
  }

  if (mode === '--sha256') {
    const file = argv[1];
    if (file === undefined) {
      cannotRun('usage: --sha256 <file>');
    }
    /** @type {Buffer} */
    let bytes;
    try {
      bytes = readFileSync(file);
    } catch {
      return cannotRun(`cannot open ${file}`);
    }
    process.stdout.write(createHash('sha256').update(bytes).digest('hex'));
    return 0;
  }

  if (mode === '--run-id') {
    process.stdout.write(runIdentifier());
    return 0;
  }

  if (mode === '--retain-until') {
    const days = Number(argv[1]);
    if (!Number.isInteger(days) || days < 1) {
      cannotRun(`--retain-until takes a positive whole number of days, and it was ${JSON.stringify(argv[1])}`);
    }
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    process.stdout.write(until.toISOString().replace(/\.\d{3}Z$/, 'Z'));
    return 0;
  }

  if (mode === '--log-body') {
    const out = argv[1];
    if (out === undefined) {
      cannotRun('usage: --log-body <out.json> --event E ...');
    }
    /** @type {Record<string, string>} */
    const named = {};
    /** @type {string[]} */
    const invalidationIds = [];
    let at = 2;
    while (at < argv.length) {
      const flag = argv[at];
      const value = argv[at + 1];
      if (flag === undefined || value === undefined) {
        cannotRun(`${String(flag)} needs a value`);
      }
      if (flag === '--invalidation-id') {
        invalidationIds.push(value);
      } else if (flag.startsWith('--')) {
        named[flag.slice(2)] = value;
      } else {
        cannotRun(`unknown argument: ${flag}`);
      }
      at += 2;
    }
    const built = logBody({
      event: named['event'] ?? '',
      releaseId: named['release-id'] ?? '',
      operation: named['operation'] ?? '',
      timestamp: named['timestamp'] ?? '',
      invalidationIds,
      outcome: named['outcome'] ?? '',
      detail: named['detail'] ?? '',
    });
    if (built.refusals.length > 0) {
      refuse(built.refusals);
    }
    writeFileSync(out, built.document);
    return 0;
  }

  if (mode === '--self-test') {
    return selfTest();
  }

  return cannotRun(
    'usage: --read-output | --read-output-raw | --read-json | --check-remote | --manifest-field | --preflight-manifests | --is-release-id | --roster-entries | --plan | --listing-keys | --inventory | --scan-release-comment | --sha256 | --run-id | --retain-until | --log-body | --self-test',
  );
}

// ---------------------------------------------------------------------------
// The self-test
// ---------------------------------------------------------------------------

/**
 * A conformant manifest, written out rather than built from a real release.
 *
 * @param {Partial<{schema: string, commit: string, release_id: string, objects: Record<string, string>}>} [changed]
 * @returns {string}
 */
function conformantManifest(changed = {}) {
  const commit = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const scriptDigest = 'b'.repeat(64);
  const styleDigest = 'c'.repeat(64);
  return `${JSON.stringify(
    {
      schema: MANIFEST_SCHEMA,
      commit,
      release_id: `20260813T091500Z-${commit.slice(0, 12)}`,
      objects: {
        [`/assets/${scriptDigest}.js`]: scriptDigest,
        [`/assets/${styleDigest}.css`]: styleDigest,
        [ENTRY_POINT]: 'd'.repeat(64),
        [CONFIG_PATH]: 'e'.repeat(64),
      },
      ...changed,
    },
    null,
    2,
  )}\n`;
}

/**
 * @returns {number}
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

  const clean = readManifestDocument(conformantManifest(), 'the conformant manifest');
  record('a conformant manifest reads', clean.manifest !== null, clean.refusals.join('; '));

  const duplicate = readManifestDocument(
    '{"schema":"viewer-release-manifest/1","schema":"viewer-release-manifest/1","commit":"a1b2c3d4e5f60718293a4b5c6d7e8f9012345678","release_id":"20260813T091500Z-a1b2c3d4e5f6","objects":{"/index.html":"' +
      'd'.repeat(64) +
      '"}}',
    'a manifest with a duplicate key',
  );
  record(
    'a duplicate member name refuses',
    duplicate.manifest === null && duplicate.refusals.some((line) => line.includes('more than once')),
    duplicate.refusals.join('; '),
  );

  const wrongSchema = readManifestDocument(conformantManifest({ schema: 'viewer-release-manifest/2' }), 'a wrong schema');
  record('a wrong schema refuses', wrongSchema.manifest === null, 'it was read');

  const shortCommit = readManifestDocument(conformantManifest({ commit: 'abc123' }), 'a short commit');
  record('a commit that is not forty hex refuses', shortCommit.manifest === null, 'it was read');

  const wrongSuffix = readManifestDocument(
    conformantManifest({ release_id: '20260813T091500Z-ffffffffffff' }),
    'a release id whose suffix is not the commit',
  );
  record('a release id that contradicts its commit refuses', wrongSuffix.manifest === null, 'it was read');

  const noEntry = readManifestDocument(conformantManifest({ objects: { [CONFIG_PATH]: 'e'.repeat(64) } }), 'a manifest with no entry point');
  record('a manifest with no entry point refuses', noEntry.manifest === null, 'it was read');

  const badDigest = readManifestDocument(
    conformantManifest({ objects: { [ENTRY_POINT]: 'not-a-digest', [CONFIG_PATH]: 'e'.repeat(64) } }),
    'a manifest with a bad digest',
  );
  record('a digest that is not sixty-four hex refuses', badDigest.manifest === null, 'it was read');

  // The two static union defects.
  const honest = readManifestDocument(conformantManifest(), 'target').manifest;
  const misnamedText = conformantManifest({
    objects: { [`/assets/${'b'.repeat(64)}.js`]: 'f'.repeat(64), [ENTRY_POINT]: 'd'.repeat(64), [CONFIG_PATH]: 'e'.repeat(64) },
  });
  const misnamed = readManifestDocument(misnamedText, 'misnamed').manifest;
  record(
    'an asset path disagreeing with its own recorded digest refuses',
    misnamed !== null && unionDefects([{ subject: 'misnamed', manifest: misnamed }]).length > 0,
    'nothing refused',
  );

  const otherText = conformantManifest({
    commit: 'f0e1d2c3b4a596873625140312345678900abcde',
    release_id: '20260701T101500Z-f0e1d2c3b4a5',
    objects: { [`/assets/${'b'.repeat(64)}.js`]: 'b'.repeat(64), [ENTRY_POINT]: 'd'.repeat(64) },
  });
  const other = readManifestDocument(otherText, 'retained').manifest;
  record(
    'two releases agreeing about one asset raise nothing',
    honest !== null &&
      other !== null &&
      unionDefects([
        { subject: 'target', manifest: honest },
        { subject: 'retained', manifest: other },
      ]).length === 0,
    'something refused',
  );

  const collidingText = conformantManifest({
    commit: 'f0e1d2c3b4a596873625140312345678900abcde',
    release_id: '20260701T101500Z-f0e1d2c3b4a5',
    objects: { [`/assets/${'b'.repeat(64)}.js`]: 'a'.repeat(64), [ENTRY_POINT]: 'd'.repeat(64) },
  });
  const colliding = readManifestDocument(collidingText, 'colliding').manifest;
  record(
    'two releases disagreeing about one asset refuses',
    honest !== null &&
      colliding !== null &&
      unionDefects([
        { subject: 'target', manifest: honest },
        { subject: 'colliding', manifest: colliding },
      ]).some((line) => line.includes('at most one of them')),
    'nothing refused',
  );

  // The plan: keys, order, types, directives.
  const planned = honest === null ? { plan: [], refusals: ['no manifest'] } : planUploads(honest);
  record('the plan refuses nothing on a conformant manifest', planned.refusals.length === 0, planned.refusals.join('; '));
  record(
    'the entry point is planned last',
    planned.plan.length > 0 && planned.plan[planned.plan.length - 1]?.path === ENTRY_POINT,
    JSON.stringify(planned.plan.map((one) => one.path)),
  );
  record(
    'the entry point\'s key is exactly index.html',
    planned.plan.some((one) => one.path === ENTRY_POINT && one.key === 'index.html'),
    'it was not',
  );
  record(
    'the origin table\'s key is exactly js/config.js and it carries no cache directive',
    planned.plan.some((one) => one.path === CONFIG_PATH && one.key === 'js/config.js' && one.cacheControl === '-'),
    'it was not',
  );
  record(
    'every asset carries the immutable directive and its table content type',
    planned.plan
      .filter((one) => one.path.startsWith(ASSET_PREFIX))
      .every((one) => one.cacheControl === IMMUTABLE_DIRECTIVE && one.contentType.includes('/')),
    'one did not',
  );
  record(
    'no key carries a leading slash',
    planned.plan.every((one) => !one.key.startsWith('/')),
    'one did',
  );

  // The listing.
  const merged = listingKeys({ Contents: [{ Key: 'index.html' }, { Key: 'js/config.js' }] });
  record('a merged listing reads its keys', merged.keys.length === 2, JSON.stringify(merged));
  const truncated = listingKeys({ Contents: [{ Key: 'index.html' }], NextToken: 'more' });
  record('a truncated listing refuses', truncated.refusals.length === 1, JSON.stringify(truncated));

  const inventory = inventoryDocument(['index.html', 'js/config.js']);
  record(
    'the inventory restores the one leading slash',
    inventory.document.includes('"/index.html"') && inventory.document.includes('"/js/config.js"'),
    inventory.document,
  );
  record('the inventory names the schema the check reads', inventory.document.includes(INVENTORY_SCHEMA), inventory.document);

  // The remote.
  for (const spelling of [
    `git@${PUBLIC_REMOTE_HOST}:${PUBLIC_REMOTE_PATH}.git`,
    `https://${PUBLIC_REMOTE_HOST}/${PUBLIC_REMOTE_PATH}.git`,
    `https://${PUBLIC_REMOTE_HOST}/${PUBLIC_REMOTE_PATH}`,
    `ssh://git@${PUBLIC_REMOTE_HOST}/${PUBLIC_REMOTE_PATH}.git`,
  ]) {
    record(`${spelling} is the public remote`, whyNotThePublicRemote(spelling) === null, String(whyNotThePublicRemote(spelling)));
  }
  record(
    'a same-path mirror on another host is not',
    whyNotThePublicRemote(`https://example.invalid/${PUBLIC_REMOTE_PATH}.git`) !== null,
    'it was accepted',
  );
  record(
    'another repository on the right host is not',
    whyNotThePublicRemote(`git@${PUBLIC_REMOTE_HOST}:somebody/else.git`) !== null,
    'it was accepted',
  );
  record('a local path is not a remote this reads', whyNotThePublicRemote('/tmp/a-clone') !== null, 'it was accepted');

  // The log body.
  const body = logBody({
    event: 'switch-succeeded',
    releaseId: '20260813T091500Z-a1b2c3d4e5f6',
    operation: 'release',
    timestamp: '20260813T091500Z',
    invalidationIds: ['INVALIDATION-UNDER-TEST'],
    outcome: 'ok',
    detail: 'the wire half of E-6 exited 0',
  });
  record('a well-formed event is written', body.refusals.length === 0, body.refusals.join('; '));
  record(
    'the event carries exactly the eight fields',
    Object.keys(JSON.parse(body.document)).join(',') ===
      'schema,event,release_id,operation,timestamp,invalidation_ids,outcome,detail',
    body.document,
  );
  const wrongEvent = logBody({
    event: 'switch-maybe',
    releaseId: '20260813T091500Z-a1b2c3d4e5f6',
    operation: 'release',
    timestamp: '20260813T091500Z',
    invalidationIds: [],
    outcome: 'ok',
    detail: '',
  });
  record('an event outside the eight refuses', wrongEvent.refusals.length > 0, 'nothing refused');

  // The release comment, through the command-line surface.
  const dir = mkdtempSync(join(tmpdir(), 'viewer-release-core-'));
  const document = join(dir, 'index.html');
  writeFileSync(document, '<html></html>\n<!-- release: 20260813T091500Z-a1b2c3d4e5f6 -->\n');
  const found = releaseComments(readFileSync(document, 'utf8'));
  record('a stamped document names one release', found.length === 1, JSON.stringify(found));
  writeFileSync(document, '<html></html>\n<!-- release: 20260813T091500Z-a1b2c3d4e5f6 -->\n<!-- release: 20260701T101500Z-f0e1d2c3b4a5 -->\n');
  record('a document carrying two release comments is two', releaseComments(readFileSync(document, 'utf8')).length === 2, 'it was not');

  const identifier = runIdentifier();
  record('a run identifier is an instant and six hex', /^\d{8}T\d{6}Z-[0-9a-f]{6}$/.test(identifier), identifier);
  record('two run identifiers differ', runIdentifier() !== runIdentifier(), 'they did not');

  // The roster, read the way `git ls-tree` writes it.
  const blob = '100644 blob 0123456789abcdef0123456789abcdef01234567';
  const tree = '040000 tree 89abcdef0123456789abcdef0123456789abcdef';
  const twoMembers = rosterEntries(
    `${blob}\t20260813T091500Z-a1b2c3d4e5f6.json\n${blob}\t20260701T101500Z-f0e1d2c3b4a5.json\n`,
  );
  record(
    'two published manifests are two roster members',
    twoMembers.refusals.length === 0 && twoMembers.stems.length === 2,
    JSON.stringify(twoMembers),
  );
  record(
    'the roster comes back in one order',
    twoMembers.stems.join(',') === '20260701T101500Z-f0e1d2c3b4a5,20260813T091500Z-a1b2c3d4e5f6',
    twoMembers.stems.join(','),
  );
  record(
    'a subtree under the releases tree refuses',
    rosterEntries(`${blob}\t20260813T091500Z-a1b2c3d4e5f6.json\n${tree}\tarchive\n`).refusals.length === 1,
    'nothing refused',
  );
  record(
    'a stray file under the releases tree refuses',
    rosterEntries(`${blob}\t20260813T091500Z-a1b2c3d4e5f6.json\n${blob}\tREADME.md\n`).refusals.length === 1,
    'nothing refused',
  );
  record(
    'a name that is nearly an identifier refuses',
    rosterEntries(`${blob}\t20260231T091500Z-a1b2c3d4e5f6.json\n`).refusals.length === 1,
    'nothing refused',
  );

  if (failures === 0) {
    process.stdout.write('release-core self-test — PASS\n');
    return 0;
  }
  process.stdout.write(`release-core self-test — FAIL (${failures} case(s))\n`);
  return 1;
}

process.exit(run(process.argv.slice(2)));
