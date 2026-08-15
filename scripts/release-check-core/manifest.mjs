/**
 * What a release says about itself, and what an origin has to be for that to be
 * true.
 *
 * A release manifest is four fields: which schema it is, which commit it was
 * built from, which release it is, and a map from every path the release serves
 * to the digest of the bytes at it. That is the whole document, and "that is the
 * whole document" is enforced rather than assumed — a manifest carrying a field
 * this schema does not name is a manifest somebody has extended, and a checker
 * that ignores what it does not recognise is a checker that can be told things
 * it will not repeat.
 *
 * The manifest is supplied to the check from the public repository at the named
 * commit. The origin never serves one and is never asked for one. That is not a
 * convenience: an origin that supplies the expectations it is measured against
 * is an origin that passes, and the only interesting question about a deployed
 * release is whether it matches something written down before it was deployed.
 *
 * Digests are over identity-encoded bytes — the object as it is, before any
 * transfer coding was applied to it. An origin that serves the same object as
 * plain bytes, as gzip and as brotli is serving one object three ways, and the
 * manifest records the object. So every arm's body is decoded before it is
 * hashed, and a body whose declared coding cannot be removed is a failure rather
 * than a body of unknown content: "it did not decode" and "it is the right
 * object" are not compatible readings.
 *
 * Two of the comparison verdicts here need something no HTTP request can
 * produce, and the shape of that is worth stating where the code is. An origin
 * cannot be enumerated: `GET /` returns a document, not a listing, and the
 * absence of a response for a path nobody asked about says nothing. So "is
 * there something served here that the manifest does not name" is not a question
 * the origin can be asked — it is answered from a listing produced on the deploy
 * side and handed to the check as an input. A run that has no listing does not
 * skip those two verdicts. It fails, because a check that quietly answers fewer
 * questions when it is given less is a check whose coverage the person invoking
 * it decides.
 */

import { ASSET_PREFIX, parseAssetPath } from './cache.mjs';
import { scanForDuplicateKeys } from './json-text.mjs';
import { fail, PREDICATES } from './verdict.mjs';

/**
 * The one value the manifest's `schema` field may hold.
 */
export const MANIFEST_SCHEMA = 'viewer-release-manifest/1';

/**
 * The one value an inventory's `schema` field may hold.
 */
export const INVENTORY_SCHEMA = 'viewer-origin-inventory/1';

/**
 * The manifest's fields, exactly.
 *
 * @type {readonly string[]}
 */
export const MANIFEST_FIELDS = Object.freeze(['schema', 'commit', 'release_id', 'objects']);

/**
 * An inventory's fields, exactly.
 *
 * @type {readonly string[]}
 */
export const INVENTORY_FIELDS = Object.freeze(['schema', 'paths']);

/**
 * The entry point's one manifest key.
 *
 * `/` is not one. The entry point answers at two URLs and is one object: the
 * manifest names the object, and the second URL is a serving alias verified
 * against the live origin rather than a second entry in a map of bytes.
 */
export const ENTRY_POINT = '/index.html';

/**
 * The committed origin table's served path.
 *
 * Role-bearing: this is the module whose bytes decide where the page is allowed
 * to talk, so the manifest has to bind it or the expected `connect-src` is
 * derived from something nothing pinned.
 */
export const CONFIG_PATH = '/js/config.js';

/**
 * The characters a path may be written with, and no others.
 *
 * Percent-encoding is absent from this set on purpose, and it is the reason the
 * set is a set rather than a list of forbidden constructs. Every literal check
 * below — no dot segment, no duplicate slash, no backslash — is a check on the
 * characters as written, and every one of them is walked past by a path that
 * spells the same construct as an escape. Refusing `%` outright is what makes
 * the literal checks the whole of the reading rather than the first half of one.
 */
const PATH_CHARACTERS = /^[A-Za-z0-9._~/-]+$/;

/**
 * A digest, as the manifest records it.
 */
const DIGEST = /^[0-9a-f]{64}$/;

/**
 * A commit, as the manifest records it.
 */
const COMMIT = /^[0-9a-f]{40}$/;

/**
 * A release identifier: a UTC instant, then the commit's first twelve.
 */
const RELEASE_ID = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-([0-9a-f]{12})$/;

/**
 * How many days each month has, in a year that is not a leap year.
 *
 * @type {readonly number[]}
 */
const MONTH_LENGTHS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

/**
 * Is this year one February has twenty-nine days in?
 *
 * The whole rule rather than the divisible-by-four half of it: 2100 is not a
 * leap year and a reading that says it is would admit an instant that never
 * happens, which is the thing this is here to refuse.
 *
 * @param {number} year
 * @returns {boolean}
 */
function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Is a release identifier well-formed, and what does it claim about its commit?
 *
 * The instant is checked as an instant rather than as six numbers in ranges. A
 * day between 1 and 31 admits the thirty-first of February and the twenty-ninth
 * of a February that has twenty-eight days — identifiers that name a moment that
 * did not occur, and therefore identifiers that no release was built at. A
 * release identifier is a claim about when something happened, and a claim about
 * a time that never was is not a weaker claim, it is a different kind of thing.
 *
 * @param {string} value
 * @returns {{ commitPrefix: string } | null}
 */
export function parseReleaseId(value) {
  const found = RELEASE_ID.exec(value);
  if (found === null) {
    return null;
  }
  const [, year, month, day, hour, minute, second, commitPrefix] = found;
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
  const inRange = (/** @type {string} */ part, /** @type {number} */ low, /** @type {number} */ high) => {
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
 * A release manifest, once it is one.
 *
 * @typedef {object} ReleaseManifest
 * @property {string} schema
 * @property {string} commit
 * @property {string} release_id
 * @property {Readonly<Record<string, string>>} objects
 */

/**
 * Read a manifest document, refusing everything about it that is not the schema.
 *
 * The text is scanned for duplicate member names before it is parsed, because a
 * parse cannot report one; see `json-text.mjs`.
 *
 * @param {string} text The document, as bytes decoded to text.
 * @param {string} subject What to call it in a refusal.
 * @returns {{ manifest: ReleaseManifest | null, refusals: import('./verdict.mjs').Refusal[] }}
 */
export function readManifestDocument(text, subject) {
  /** @type {import('./verdict.mjs').Refusal[]} */
  const refusals = [];

  const scan = scanForDuplicateKeys(text);
  if (scan.syntax !== null) {
    refusals.push(fail(PREDICATES.MANIFEST_SCHEMA, subject, `it could not be read as JSON: ${scan.syntax}`));
    return { manifest: null, refusals };
  }
  for (const duplicate of scan.duplicates) {
    refusals.push(
      fail(
        PREDICATES.MANIFEST_DUPLICATE_KEY,
        subject,
        `${duplicate} is stated more than once, and a parser that keeps the last is not a detection`,
      ),
    );
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    refusals.push(
      fail(PREDICATES.MANIFEST_SCHEMA, subject, `it could not be parsed: ${error instanceof Error ? error.message : 'unknown'}`),
    );
    return { manifest: null, refusals };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    refusals.push(fail(PREDICATES.MANIFEST_SCHEMA, subject, 'it is not a JSON object'));
    return { manifest: null, refusals };
  }

  const source = /** @type {Record<string, unknown>} */ (parsed);
  const names = Object.keys(source).sort();
  const expected = [...MANIFEST_FIELDS].sort();
  if (names.join(',') !== expected.join(',')) {
    refusals.push(
      fail(
        PREDICATES.MANIFEST_SCHEMA,
        subject,
        `its fields are ${JSON.stringify(names)}, and the schema is exactly ${JSON.stringify(expected)}`,
      ),
    );
    return { manifest: null, refusals };
  }

  const schema = source['schema'];
  const commit = source['commit'];
  const releaseId = source['release_id'];
  const objects = source['objects'];

  if (schema !== MANIFEST_SCHEMA) {
    refusals.push(fail(PREDICATES.MANIFEST_SCHEMA, subject, `schema is ${JSON.stringify(schema)}, and it must be ${JSON.stringify(MANIFEST_SCHEMA)}`));
  }
  if (typeof commit !== 'string' || !COMMIT.test(commit)) {
    refusals.push(fail(PREDICATES.MANIFEST_SCHEMA, subject, `commit is ${JSON.stringify(commit)}, and it must be forty lowercase hex characters`));
  }
  if (typeof releaseId !== 'string') {
    refusals.push(fail(PREDICATES.MANIFEST_SCHEMA, subject, `release_id is ${JSON.stringify(releaseId)}, and it must be a string`));
  } else {
    const read = parseReleaseId(releaseId);
    if (read === null) {
      refusals.push(
        fail(
          PREDICATES.MANIFEST_RELEASE_ID,
          subject,
          `release_id is ${JSON.stringify(releaseId)}, and its form is <UTC yyyymmddThhmmssZ>-<12 hex>`,
        ),
      );
    } else if (typeof commit === 'string' && read.commitPrefix !== commit.slice(0, 12)) {
      refusals.push(
        fail(
          PREDICATES.MANIFEST_RELEASE_ID,
          subject,
          `release_id carries the suffix ${read.commitPrefix}, and the commit begins ${commit.slice(0, 12)}`,
        ),
      );
    }
  }

  if (objects === null || typeof objects !== 'object' || Array.isArray(objects)) {
    refusals.push(fail(PREDICATES.MANIFEST_SCHEMA, subject, 'objects is not a JSON object'));
    return { manifest: null, refusals };
  }

  const entries = Object.entries(/** @type {Record<string, unknown>} */ (objects));
  /** @type {Record<string, string>} */
  const map = {};
  for (const [path, digest] of entries) {
    if (path === '/') {
      refusals.push(
        fail(
          PREDICATES.MANIFEST_PATH,
          subject,
          '/ is a serving alias verified against the live origin, and never a key of objects',
        ),
      );
      continue;
    }
    const why = whyNotAPath(path);
    if (why !== null) {
      refusals.push(fail(PREDICATES.MANIFEST_PATH, subject, `${JSON.stringify(path)} is not a path: ${why}`));
      continue;
    }
    if (typeof digest !== 'string' || !DIGEST.test(digest)) {
      refusals.push(
        fail(PREDICATES.MANIFEST_SCHEMA, subject, `the digest at ${path} is ${JSON.stringify(digest)}, and it must be sixty-four lowercase hex characters`),
      );
      continue;
    }
    map[path] = digest;
  }

  if (!Object.prototype.hasOwnProperty.call(map, ENTRY_POINT)) {
    refusals.push(fail(PREDICATES.MANIFEST_SCHEMA, subject, `${ENTRY_POINT} is not among objects, and the entry point is always an object`));
  }

  if (refusals.length > 0) {
    return { manifest: null, refusals };
  }

  return {
    manifest: Object.freeze({
      schema: MANIFEST_SCHEMA,
      commit: String(commit),
      release_id: String(releaseId),
      objects: Object.freeze(map),
    }),
    refusals,
  };
}

/**
 * An origin inventory, once it is one.
 *
 * @typedef {object} OriginInventory
 * @property {readonly string[]} paths
 */

/**
 * Read an inventory document.
 *
 * Held to the same "exactly these fields" rule as the manifest. The normative
 * text spells the manifest's rule out and gives the inventory as a shape; the
 * two are the same kind of document produced by the same deploy and read by the
 * same check, and a schema that admits extra fields on one of them is a schema
 * with a place to put things.
 *
 * @param {string} text
 * @param {string} subject
 * @returns {{ inventory: OriginInventory | null, refusals: import('./verdict.mjs').Refusal[] }}
 */
export function readInventoryDocument(text, subject) {
  /** @type {import('./verdict.mjs').Refusal[]} */
  const refusals = [];

  const scan = scanForDuplicateKeys(text);
  if (scan.syntax !== null) {
    refusals.push(fail(PREDICATES.INVENTORY_SCHEMA, subject, `it could not be read as JSON: ${scan.syntax}`));
    return { inventory: null, refusals };
  }
  for (const duplicate of scan.duplicates) {
    refusals.push(fail(PREDICATES.INVENTORY_SCHEMA, subject, `${duplicate} is stated more than once`));
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    refusals.push(
      fail(PREDICATES.INVENTORY_SCHEMA, subject, `it could not be parsed: ${error instanceof Error ? error.message : 'unknown'}`),
    );
    return { inventory: null, refusals };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    refusals.push(fail(PREDICATES.INVENTORY_SCHEMA, subject, 'it is not a JSON object'));
    return { inventory: null, refusals };
  }

  const source = /** @type {Record<string, unknown>} */ (parsed);
  const names = Object.keys(source).sort();
  const expected = [...INVENTORY_FIELDS].sort();
  if (names.join(',') !== expected.join(',')) {
    refusals.push(
      fail(PREDICATES.INVENTORY_SCHEMA, subject, `its fields are ${JSON.stringify(names)}, and the schema is exactly ${JSON.stringify(expected)}`),
    );
    return { inventory: null, refusals };
  }

  if (source['schema'] !== INVENTORY_SCHEMA) {
    refusals.push(
      fail(PREDICATES.INVENTORY_SCHEMA, subject, `schema is ${JSON.stringify(source['schema'])}, and it must be ${JSON.stringify(INVENTORY_SCHEMA)}`),
    );
  }

  const paths = source['paths'];
  if (!Array.isArray(paths)) {
    refusals.push(fail(PREDICATES.INVENTORY_SCHEMA, subject, 'paths is not an array'));
    return { inventory: null, refusals };
  }

  /** @type {string[]} */
  const listed = [];
  for (const entry of paths) {
    if (typeof entry !== 'string') {
      refusals.push(fail(PREDICATES.INVENTORY_SCHEMA, subject, `${JSON.stringify(entry)} is not a string`));
      continue;
    }
    const why = whyNotAPath(entry);
    if (why !== null) {
      refusals.push(fail(PREDICATES.INVENTORY_SCHEMA, subject, `${JSON.stringify(entry)} is not a path: ${why}`));
      continue;
    }
    if (listed.includes(entry)) {
      refusals.push(fail(PREDICATES.INVENTORY_SCHEMA, subject, `${entry} is listed more than once`));
      continue;
    }
    listed.push(entry);
  }

  if (refusals.length > 0) {
    return { inventory: null, refusals };
  }
  return { inventory: Object.freeze({ paths: Object.freeze(listed) }), refusals };
}

/**
 * The allowlist under `/assets/`, as a map from path to the digest the release
 * that ratified it recorded.
 *
 * A map rather than a set, and that is the whole of what this function is for.
 * An object under `/assets/` that a retained release still names is an object
 * the origin is still required to serve, because rolling back to that release
 * means every page of it has to load — and "still required to serve" is a claim
 * about bytes, not about a path being permitted. Reduced to a set of paths, the
 * allowlist can say that something may be there and can never say what it must
 * be, so an origin that answers those paths with anything at all passes.
 *
 * The current release's own objects are in it, because the union of the retained
 * releases includes the one being deployed.
 *
 * @param {readonly ReleaseManifest[]} manifests The current release's manifest
 *   first, then each retained release's.
 * @returns {{ assets: Map<string, string>, refusals: import('./verdict.mjs').Refusal[] }}
 */
export function retainedAssets(manifests) {
  /** @type {Map<string, string>} */
  const assets = new Map();
  /** @type {import('./verdict.mjs').Refusal[]} */
  const refusals = [];
  for (const manifest of manifests) {
    for (const [path, digest] of Object.entries(manifest.objects)) {
      if (!path.startsWith(ASSET_PREFIX)) {
        // A retained release's document-prefix paths are not part of this. The
        // live document set is exactly the current release's: an older release's
        // entry point is not something the origin still serves, and asking for
        // it would be asking the origin to be two releases at once.
        continue;
      }
      // What the name says about the bytes, asked of every record rather than of
      // the one that ends up in the map. A record whose path names one digest
      // and whose value is another is a manifest disagreeing with itself, and it
      // is exactly the losing side of a disagreement between releases that no
      // reading of the map can reach — the map holds one of the two, so a check
      // made only there is a check that sees whichever arrived first.
      const named = parseAssetPath(path);
      if (named !== null && named.digest !== digest) {
        refusals.push(
          fail(
            PREDICATES.ASSET_PATH,
            path,
            `a ratified release records ${digest} for it, and an object under ${ASSET_PREFIX} is named by the digest of its own bytes`,
          ),
        );
      }
      const was = assets.get(path);
      if (was !== undefined && was !== digest) {
        // Two ratified releases naming one path and disagreeing about the bytes
        // at it. The path is the digest, so at most one of them can be right,
        // and which one is not a thing to be decided by iteration order.
        //
        // Refused under its own name rather than folded into the reading above.
        // The two are related — a disagreement means at least one of the records
        // is one the reading above refuses — and they are not the same claim: one
        // is about a record, the other is about two releases that cannot both be
        // rolled back to. A single name for both would be a name that keeps
        // appearing after the disagreement stopped being noticed.
        refusals.push(
          fail(
            PREDICATES.MANIFEST_ASSET_COLLISION,
            path,
            `two ratified releases record ${was} and ${digest} for it, and an object under ${ASSET_PREFIX} is named by the digest of its own bytes — at most one of them can be the object that is there`,
          ),
        );
        continue;
      }
      assets.set(path, digest);
    }
  }
  return { assets, refusals };
}

/**
 * Does the listing and the manifest agree, in both directions?
 *
 * Both directions, because either alone is half a check. A listing that names
 * something the manifest does not is an object nobody ratified being served; a
 * manifest object the listing does not name is a release that is not all there,
 * and no request against the paths the manifest does name would ever notice.
 *
 * And the retained releases' objects are held to the second direction too. An
 * asset a retained release names and the listing does not is an asset that is
 * not on the origin, which is a rollback to that release that loads a page with
 * nothing in it — a failure that is invisible until the day it is needed.
 *
 * @param {ReleaseManifest} manifest
 * @param {OriginInventory} inventory
 * @param {ReadonlyMap<string, string>} assetUnion Every path under `/assets/` in
 *   the union of the manifests of retained ratified releases, with the digest
 *   its own release recorded.
 * @returns {import('./verdict.mjs').Refusal[]}
 */
export function compareInventory(manifest, inventory, assetUnion) {
  /** @type {import('./verdict.mjs').Refusal[]} */
  const refusals = [];
  const objects = new Set(Object.keys(manifest.objects));
  const listed = new Set(inventory.paths);

  for (const path of inventory.paths) {
    if (path.startsWith(ASSET_PREFIX)) {
      if (!assetUnion.has(path)) {
        refusals.push(
          fail(
            PREDICATES.OBJECT_EXTRA_ASSET,
            path,
            'it is served under /assets/ and is in no retained release, so nothing ratified put it there',
          ),
        );
      }
      continue;
    }
    if (!objects.has(path)) {
      refusals.push(
        fail(PREDICATES.OBJECT_EXTRA_DOCUMENT, path, 'it is served under the document prefix and this release does not name it'),
      );
    }
  }

  for (const path of objects) {
    if (!listed.has(path)) {
      refusals.push(fail(PREDICATES.INVENTORY_MISSING_OBJECT, path, 'this release names it and the listing does not'));
    }
  }

  for (const path of assetUnion.keys()) {
    if (objects.has(path) || listed.has(path)) {
      continue;
    }
    refusals.push(
      fail(
        PREDICATES.INVENTORY_MISSING_OBJECT,
        path,
        'a retained release names it and the listing does not, and a release that is retained is a release that has to be able to be rolled back to',
      ),
    );
  }

  return refusals;
}
