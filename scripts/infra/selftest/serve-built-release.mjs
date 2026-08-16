/**
 * A local origin that serves a built release, for the self-tests and for nothing
 * else.
 *
 * NOT PRODUCTION HOSTING. Nothing deploys this, nothing depends on it, and no
 * response it writes is evidence about the real distribution — the real one is
 * CloudFront in front of a private bucket, configured by `infra/viewer-stack.yaml`
 * and read back at the deploy gate. What this exists for is one thing: letting the
 * REAL release check run, end to end, against a real socket, in a round that
 * reaches no cloud. The drill self-test mangles bytes here and watches the oracle
 * go red, and restores them and watches it go green, which is the whole point of
 * a drill rehearsed dark.
 *
 * ITS CONFORMANCE BAR IS THE ORACLE'S VERDICT. If the check refuses a response
 * from this server, the defect is in this server or in the layout it was handed —
 * never in the frozen expectation. Adapting the expectation, or the layout, to
 * make this server pass would be tuning the measuring instrument to the thing
 * being measured, which is the one move this whole design exists to prevent.
 *
 * The posture below is transcribed rather than invented, and every string comes
 * through `../frozen-spellings.mjs`, whose own self-test re-reads each of them
 * out of the frozen module as text. Where the shape rather than a string is
 * transcribed — which responses may be kept, how a coding is negotiated, what a
 * conditional answers — the source is the conformant fixture,
 * `test/release-fixtures/deployment.mjs` and `routes.mjs`, read and written out
 * again here rather than imported: the fixtures import the frozen core, so
 * importing them would be importing it.
 *
 * The one origin. It binds `127.0.0.1:4173` and nothing else, because that is the
 * one origin the committed table answers for — a page served from anywhere else
 * makes no request at all, and the check refuses an origin the table does not
 * name rather than skipping the question. Plain HTTP, because the committed entry
 * is plain HTTP; the check's scheme comes from the origin it is pointed at.
 *
 * Usage: node scripts/infra/selftest/serve-built-release.mjs <layout-dir>
 */

import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';

import { apiOriginFor } from '../../../site/js/config.js';
import {
  ASSET_CONTENT_TYPES,
  CACHE_FIELD,
  contentSecurityPolicy,
  CSP_FIELD,
  DOCUMENT_CONTENT_TYPES,
  GOVERNED_HEADERS,
  IMMUTABLE_DIRECTIVE,
  NO_STORE_DIRECTIVE,
  parseAssetPath,
} from '../frozen-spellings.mjs';

/** The one address this binds. */
const HOST = '127.0.0.1';

/** The one port. */
const PORT = 4173;

/** The origin a page served from here reports itself as. */
const ORIGIN = `http://${HOST}:${PORT}`;

/** The entry point, and its alias. Source: scripts/release-check-core/requests.mjs (`ENTRY_ALIASES`). */
const ENTRY_ALIAS = '/';

/**
 * @param {string} message
 * @returns {never}
 */
function cannotRun(message) {
  process.stderr.write(`serve-built-release — cannot run: ${message}\n`);
  process.exit(2);
}

const layoutRoot = process.argv[2] === undefined ? cannotRun('a layout directory is required') : resolve(process.argv[2]);
if (!existsSync(layoutRoot) || !statSync(layoutRoot).isDirectory()) {
  cannotRun(`${layoutRoot} is not a directory`);
}

const apiOrigin = apiOriginFor(ORIGIN);
if (apiOrigin === null) {
  cannotRun(`the committed origin table does not answer for ${ORIGIN}, so there is no policy to serve`);
}

/**
 * Which coding to answer a request with.
 *
 * Transcribed from test/release-fixtures/routes.mjs (`negotiate`).
 *
 * @param {import('node:http').IncomingMessage} request
 * @returns {'identity' | 'gzip' | 'br'}
 */
function negotiate(request) {
  const asked = String(request.headers['accept-encoding'] ?? '').toLowerCase();
  if (asked.includes('br')) {
    return 'br';
  }
  if (asked.includes('gzip')) {
    return 'gzip';
  }
  return 'identity';
}

/**
 * The bytes as that coding.
 *
 * Transcribed from test/release-fixtures/routes.mjs (`encode`).
 *
 * @param {Buffer} identity
 * @param {'identity' | 'gzip' | 'br'} coding
 * @returns {Buffer}
 */
function encode(identity, coding) {
  if (coding === 'gzip') {
    return gzipSync(identity);
  }
  if (coding === 'br') {
    return brotliCompressSync(identity);
  }
  return identity;
}

/**
 * Every field a response carries before anything specific to it.
 *
 * Transcribed from test/release-fixtures/routes.mjs (`baseFields`): the policy,
 * the four other governed headers, and the cache directive.
 *
 * @param {string} cache
 * @returns {Record<string, string>}
 */
function baseFields(cache) {
  /** @type {Record<string, string>} */
  const fields = { [CSP_FIELD]: contentSecurityPolicy(String(apiOrigin)) };
  for (const [name, value] of Object.entries(GOVERNED_HEADERS)) {
    fields[name] = value;
  }
  fields[CACHE_FIELD] = cache;
  return fields;
}

/**
 * What this layout holds at a served path, or nothing.
 *
 * Existence is asked of the disk on every request rather than of a listing taken
 * at start-up, and that is deliberate: the drill replaces the entry point's bytes
 * underneath this server and the whole rehearsal depends on the next request
 * seeing them.
 *
 * @param {string} path A served path, beginning with `/`.
 * @returns {Buffer | null}
 */
function objectAt(path) {
  const target = resolve(join(layoutRoot, path.slice(1)));
  if (target !== layoutRoot && !target.startsWith(layoutRoot + sep)) {
    return null;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    return null;
  }
  return readFileSync(target);
}

/**
 * The content type a served path answers with, or `null` where this design has
 * none for it.
 *
 * @param {string} path
 * @returns {string | null}
 */
function contentTypeFor(path) {
  const asset = parseAssetPath(path);
  if (asset !== null) {
    return ASSET_CONTENT_TYPES[asset.extension] ?? null;
  }
  return DOCUMENT_CONTENT_TYPES[path] ?? null;
}

const server = createServer((request, response) => {
  const raw = request.url ?? '/';
  const mark = raw.indexOf('?');
  const pathname = mark < 0 ? raw : raw.slice(0, mark);
  const query = mark < 0 ? '' : raw.slice(mark + 1);
  const hasQuery = mark >= 0;

  // The entry point answers at two URLs and is one object.
  const path = pathname === ENTRY_ALIAS ? '/index.html' : pathname;

  const bytes = objectAt(path);
  const type = contentTypeFor(path);

  if (bytes === null || type === null) {
    // Everything not allowlisted reaches the browser with an explicit no-store.
    // Absence of the immutable directive is not sufficient here: a 404 with no
    // directive at all is heuristically cacheable.
    const body = Buffer.from('not found', 'utf8');
    response.writeHead(404, {
      ...baseFields(NO_STORE_DIRECTIVE),
      'content-type': 'text/plain; charset=utf-8',
      'content-length': String(body.length),
    });
    response.end(body);
    return;
  }

  // A query with something in it is not the canonical request. A bare `?` is:
  // the delimiter with nothing after it is cache-key-identical to no delimiter at
  // all. Transcribed from test/release-fixtures/routes.mjs.
  const carriesQuery = hasQuery && query.length > 0;
  const keepable = parseAssetPath(path) !== null && !carriesQuery;
  const cache = keepable ? IMMUTABLE_DIRECTIVE : NO_STORE_DIRECTIVE;

  // A strong validator, derived from the object's own bytes so that it is the
  // same value on every run and the same value for both entry-point aliases.
  const etag = `"${createHash('sha256').update(bytes).digest('hex')}"`;

  const validator = request.headers['if-none-match'];
  if (typeof validator === 'string' && validator === etag) {
    // No body at all, and a length that describes the representation the browser
    // is being told it already holds — never this response, which sends nothing.
    response.writeHead(304, {
      ...baseFields(cache),
      etag,
      'content-length': String(bytes.length),
    });
    response.end();
    return;
  }

  const coding = negotiate(request);
  const body = encode(bytes, coding);
  /** @type {Record<string, string>} */
  const fields = {
    ...baseFields(cache),
    'content-type': type,
    etag,
    'accept-ranges': 'bytes',
    'content-length': String(body.length),
  };
  if (coding !== 'identity') {
    fields['content-encoding'] = coding;
    // A response whose bytes depend on what the request asked for has to say so.
    fields['vary'] = 'Accept-Encoding';
  }
  response.writeHead(200, fields);
  response.end(body);
});

server.on('error', (error) => {
  cannotRun(`${HOST}:${PORT} — ${error.message}`);
});

/**
 * Refuse rather than reuse.
 *
 * A server that quietly attached itself to whatever was already on this port
 * would be a self-test measuring somebody else's process, so the port is probed
 * first and something answering there stops the run.
 *
 * @param {() => void} then
 * @returns {void}
 */
function requireThePortIsFree(then) {
  const probe = createConnection({ host: HOST, port: PORT });
  const give = () => {
    probe.destroy();
    then();
  };
  probe.setTimeout(500);
  probe.on('connect', () => {
    probe.destroy();
    cannotRun(`something is already listening on ${HOST}:${PORT}, and this refuses rather than reusing it`);
  });
  probe.on('timeout', give);
  probe.on('error', give);
}

requireThePortIsFree(() => {
  server.listen(PORT, HOST, () => {
    process.stdout.write(`serve-built-release — listening on ${ORIGIN}/ over ${layoutRoot}\n`);
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
