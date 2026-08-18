/**
 * A deployment that does everything right, so that the ones that do not can be
 * one edit away from it.
 *
 * Every negative fixture in this corpus is this deployment with exactly one
 * thing changed. That is what makes a fixture's redness attributable: an origin
 * built wrong from scratch is red for however many reasons it happens to have,
 * and a fixture whose refusal could have come from any of three defects is a
 * fixture that shows a check refuses something rather than showing which check
 * refused what.
 *
 * The expectations here are written out rather than imported from the core. That
 * is the whole point of a conformant fixture: if the fixture built its headers
 * by asking the checker what it wanted, the pair would agree after any edit to
 * either, including an edit that stopped the checker asking for anything. So the
 * policy string, the cache directives and the content types are spelled out
 * again in this file, from the same normative text, and the two spellings
 * disagreeing is a thing the run notices.
 *
 * The origin table this fixture serves maps its own origin to itself, which is
 * how the committed table treats the origin a local conformance run is served
 * from. No deployment configuration value appears in this fixture, and a fixture
 * that carried one would be the first.
 *
 * The repository does now carry exactly TWO, deliberately and in the served
 * bytes, and they are the same two `CONTRIBUTING.md` names as the rule's only
 * exceptions. The first is the origin the hosted viewer is served from, which
 * the committed table is keyed on and which is the address in every share link a
 * carer receives. The second is the origin its share API answers at, which that
 * table names because it decides where a share code travels and which the entry
 * document's policy names because a browser refuses a request the page's own
 * policy does not permit. Both are public by construction — the first is what a
 * recipient types, the second rides the `connect-src` of every response the
 * hosting serves — and they are the only two.
 */

import { sha256Hex } from '../../scripts/release-check-core/digest.mjs';

/**
 * The commit this simulated release was built from.
 *
 * Forty hex characters, and not a commit of this repository — a fixture that
 * carried a real object id would be a fixture that goes stale the moment the
 * history moves, and this one is about the shape of an identifier rather than
 * about any particular release.
 */
export const FIXTURE_COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

/**
 * The instant this simulated release was built at.
 */
export const FIXTURE_INSTANT = '20260813T091500Z';

/**
 * The identifier the two of them make.
 */
export const FIXTURE_RELEASE_ID = `${FIXTURE_INSTANT}-${FIXTURE_COMMIT.slice(0, 12)}`;

/**
 * What an allowlisted object's response says.
 */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * What every other response says.
 */
export const NO_STORE = 'no-store';

/**
 * The §6.1 headers other than the policy and the cache directive.
 *
 * @type {readonly (readonly [string, string])[]}
 */
export const POLICY_FIELDS = Object.freeze([
  Object.freeze(/** @type {[string, string]} */ (['permissions-policy', 'camera=(), microphone=(), geolocation=()'])),
  Object.freeze(/** @type {[string, string]} */ (['strict-transport-security', 'max-age=63072000; includeSubDomains; preload'])),
  Object.freeze(/** @type {[string, string]} */ (['referrer-policy', 'no-referrer'])),
  Object.freeze(/** @type {[string, string]} */ (['x-robots-tag', 'noindex, noarchive, nosnippet'])),
]);

/**
 * The policy, for an origin that may talk to `apiOrigin`.
 *
 * @param {string} apiOrigin
 * @returns {string}
 */
export function policyValue(apiOrigin) {
  return (
    "default-src 'none'; script-src 'self'; style-src 'self'; " +
    `connect-src ${apiOrigin}; ` +
    "img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; " +
    "require-trusted-types-for 'script'"
  );
}

/**
 * One object this deployment serves.
 *
 * @typedef {object} ServedObject
 * @property {string} path
 * @property {Uint8Array} bytes The identity-encoded bytes — the object itself.
 * @property {string} contentType
 * @property {boolean} asset Whether it lives under the asset behaviour.
 * @property {string} etag
 */

/**
 * A whole simulated deployment.
 *
 * @typedef {object} Deployment
 * @property {string} origin
 * @property {string} apiOrigin
 * @property {string} manifestText
 * @property {string} inventoryText
 * @property {ServedObject[]} objects
 * @property {Uint8Array} configBytes
 * @property {readonly string[]} unionManifestTexts The manifests of the other
 *   releases still retained, as the documents `--union` would be handed. Read
 *   the same way the command line reads them, so that a fixture drives the
 *   allowlist through the same path a deploy does rather than through a set of
 *   paths assembled beside it.
 * @property {string} entryDocument
 */

/** @param {string} text */
const bytes = (text) => new TextEncoder().encode(text);

/**
 * Build the conformant deployment for an origin.
 *
 * @param {string} origin The origin the fixture is served from, scheme and
 *   authority. Also the origin its page is allowed to talk to, which is how the
 *   committed table treats the development origin.
 * @returns {Deployment}
 */
export function buildDeployment(origin) {
  const apiOrigin = origin;

  const configSource = [
    '/**',
    ' * Where a page served from this origin is allowed to talk to.',
    ' *',
    ' * One table, exact match, no rule. A fixture copy of the shape the committed',
    " * module's local-conformance entry has: the origin answers for itself, and",
    ' * nothing else answers at all. The committed table also carries an entry whose',
    ' * key and destination are different origins; a fixture serves one origin, so',
    ' * the entry a fixture needs is this one.',
    ' */',
    `const API_ORIGINS = Object.freeze({ ${JSON.stringify(origin)}: ${JSON.stringify(apiOrigin)} });`,
    '',
    'export function apiOriginFor(origin) {',
    "  if (typeof origin !== 'string') {",
    '    return null;',
    '  }',
    '  return Object.prototype.hasOwnProperty.call(API_ORIGINS, origin) ? API_ORIGINS[origin] : null;',
    '}',
    '',
  ].join('\n');

  const scriptSource = [
    '// A first-party module this simulated release ships under the asset behaviour.',
    "export const greeting = 'a note is shown and nothing is kept';",
    '',
  ].join('\n');

  const styleSource = [':root { color-scheme: light dark; }', 'body { margin: 0; }', ''].join('\n');

  const scriptDigest = sha256Hex(bytes(scriptSource));
  const styleDigest = sha256Hex(bytes(styleSource));

  const entryDocument = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <title>Shared note</title>',
    `    <link rel="stylesheet" href="/assets/${styleDigest}.css" />`,
    `    <script type="module" src="/assets/${scriptDigest}.js"></script>`,
    '  </head>',
    '  <body>',
    '    <main></main>',
    '  </body>',
    '</html>',
    `<!-- release: ${FIXTURE_RELEASE_ID} -->`,
    '',
  ].join('\n');

  /** @type {ServedObject[]} */
  const objects = [
    { path: '/index.html', bytes: bytes(entryDocument), contentType: 'text/html; charset=utf-8', asset: false, etag: '"entry"' },
    { path: '/js/config.js', bytes: bytes(configSource), contentType: 'text/javascript; charset=utf-8', asset: false, etag: '"config"' },
    { path: `/assets/${scriptDigest}.js`, bytes: bytes(scriptSource), contentType: 'text/javascript', asset: true, etag: '"script"' },
    { path: `/assets/${styleDigest}.css`, bytes: bytes(styleSource), contentType: 'text/css', asset: true, etag: '"style"' },
  ];

  const manifestText = `${JSON.stringify(
    {
      schema: 'viewer-release-manifest/1',
      commit: FIXTURE_COMMIT,
      release_id: FIXTURE_RELEASE_ID,
      objects: Object.fromEntries(objects.map((one) => [one.path, sha256Hex(one.bytes)])),
    },
    null,
    2,
  )}\n`;

  const inventoryText = `${JSON.stringify(
    {
      schema: 'viewer-origin-inventory/1',
      paths: objects.map((one) => one.path),
    },
    null,
    2,
  )}\n`;

  return {
    origin,
    apiOrigin,
    manifestText,
    inventoryText,
    objects,
    configBytes: bytes(configSource),
    unionManifestTexts: [],
    entryDocument,
  };
}

/**
 * The commit an older, still-retained release was built from.
 */
export const RETAINED_COMMIT = 'f0e1d2c3b4a596873625140312345678900abcde';

/**
 * The instant it was built at, and the identifier the two make.
 */
export const RETAINED_INSTANT = '20260701T101500Z';

/**
 * The retained release's identifier.
 */
export const RETAINED_RELEASE_ID = `${RETAINED_INSTANT}-${RETAINED_COMMIT.slice(0, 12)}`;

/**
 * The entry-point digest the retained release records.
 *
 * A well-formed digest that belongs to no object this fixture serves, which is
 * the point: a retained release's document-prefix paths are not on the origin
 * any more — the live document set is exactly the current release's — so nothing
 * asks for it and nothing compares it. Its objects under `/assets/` are a
 * different matter, and that difference is what these fixtures are for.
 */
const RETAINED_ENTRY_DIGEST = 'b'.repeat(64);

/**
 * The same deployment, with one older release still retained.
 *
 * The object that release still names is served — it has to be, because keeping
 * a release retained is what makes rolling back to it possible, and an object
 * named by the digest of its own bytes is one an older document still points at.
 * It is listed in the inventory for the same reason. It is *not* in the current
 * release's manifest, which is exactly the shape the retained-asset checks are
 * about: a path this release does not name and the origin must still be serving.
 *
 * @param {Deployment} base
 * @param {string} source The module the retained release still ships.
 * @returns {Deployment & { retainedPath: string, retainedDigest: string }}
 */
export function withRetainedRelease(base, source) {
  const retainedBytes = bytes(source);
  const retainedDigest = sha256Hex(retainedBytes);
  const retainedPath = `/assets/${retainedDigest}.js`;

  /** @type {ServedObject[]} */
  const objects = [
    ...base.objects,
    { path: retainedPath, bytes: retainedBytes, contentType: 'text/javascript', asset: true, etag: '"retained"' },
  ];

  const inventory = JSON.parse(base.inventoryText);
  inventory.paths = [...inventory.paths, retainedPath];

  const retainedManifest = {
    schema: 'viewer-release-manifest/1',
    commit: RETAINED_COMMIT,
    release_id: RETAINED_RELEASE_ID,
    objects: { '/index.html': RETAINED_ENTRY_DIGEST, [retainedPath]: retainedDigest },
  };

  return {
    ...base,
    objects,
    inventoryText: `${JSON.stringify(inventory, null, 2)}\n`,
    unionManifestTexts: [`${JSON.stringify(retainedManifest, null, 2)}\n`],
    retainedPath,
    retainedDigest,
  };
}

/**
 * The same deployment serving a different entry-point document.
 *
 * The manifest is recomputed over the new bytes, so the digest still agrees with
 * what is served. That is what makes the release-identifier fixtures about the
 * identifier: a document edited without recomputing the manifest is a document
 * that fails the digest comparison first, and a fixture whose redness arrives
 * from the wrong predicate shows nothing about the one it was written for.
 *
 * `release_id` is deliberately not recomputed — it is what the document is being
 * compared against.
 *
 * @param {Deployment} base
 * @param {string} document
 * @returns {Deployment}
 */
export function withEntryDocument(base, document) {
  const objects = base.objects.map((one) => (one.path === '/index.html' ? { ...one, bytes: bytes(document) } : one));
  const manifest = JSON.parse(base.manifestText);
  manifest.objects = Object.fromEntries(objects.map((one) => [one.path, sha256Hex(one.bytes)]));
  return {
    ...base,
    objects,
    entryDocument: document,
    manifestText: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}
