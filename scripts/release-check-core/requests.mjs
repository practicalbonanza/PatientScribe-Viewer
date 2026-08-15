/**
 * What the check asks of an origin.
 *
 * The matrix is written here, in full, as a function of the manifest and
 * nothing else. It is not derived from the origin, not derived from what the
 * capture client happens to support, and not assembled by the code that issues
 * the requests — because a coverage claim built out of the implementation under
 * it is a coverage claim that shrinks silently. A request arm deleted from an
 * adapter would leave every remaining assertion passing and the report saying
 * the same words; an arm deleted from here changes what this function returns,
 * and the fixture corpus reads what it returns.
 *
 * Three encoding arms per object, because cross-encoding equivalence is a thing
 * an origin can get wrong. An origin that serves the right bytes as plain, and a
 * stale copy under gzip, is an origin most clients see the stale copy from —
 * every browser sends `Accept-Encoding` — and the arm that would have caught it
 * is the one nobody issues. So all three arms are issued and all three are
 * decoded and hashed against the same manifest entry.
 *
 * A conditional arm per object and per alias, because a 304 is a response the
 * browser acts on and a response the classification has to cover. Its validator
 * comes from the first response rather than from a value written here: a
 * conditional request carrying a validator the origin never issued is a request
 * that gets a 200 and tells nobody anything. Where the first response carried no
 * validator at all there is no conditional request to make, and that is recorded
 * as an arm that did not run rather than as an arm that passed.
 *
 * No request carries a `Range`. Whether an origin serves ranges is not something
 * a release is: it is a property of the service in front of the bytes, it varies
 * between the distribution and the store behind it, and a check that asserted it
 * would be a check that reddens a deploy which is exactly the release it says it
 * is. What the absence buys is not only the two arms: with nothing asking for
 * part of anything, a partial response is a refusal wherever it turns up, which
 * is a stronger statement than any reading of one could have been.
 *
 * And three synthetic probes, because the classification has branches no
 * manifest object reaches: a path under `/assets/` that no release ratified, a
 * real asset with something in its query, and a path under the document prefix
 * that is not there. The last one carries a nonce so that it cannot be a path the
 * origin has ever been asked for.
 *
 * The objects of the retained releases are asked the same questions as the
 * current release's. An older release is retained so that it can be rolled back
 * to, and an object under `/assets/` that a retained release names is an object
 * that rollback needs to be there and to be itself — so it is fetched under
 * every coding, ranged, conditioned and probed exactly as this release's are,
 * and hashed against the digest its own release recorded. An allowlist that
 * permits those paths without ever asking for them is an allowlist that says a
 * rollback may work; asking is what says it will. Their document-prefix paths
 * are not asked for at all: the live document set is exactly the current
 * release's, and requesting an older entry point would be requiring the origin
 * to be two releases at once.
 */

/**
 * One request the matrix issues.
 *
 * @typedef {object} PlannedRequest
 * @property {string} arm
 * @property {string} path
 * @property {boolean} hasQuery
 * @property {string} query
 * @property {'identity' | 'gzip' | 'br' | null} acceptEncoding `null` sends no
 *   `Accept-Encoding` field at all, which is what the conditional arm does —
 *   that arm is about a different axis and adding a coding to it would make a
 *   failure two questions.
 * @property {boolean} conditional Whether this request carries the validator
 *   taken from the arm's first response. The client fills the value in; the plan
 *   says that it must.
 */

/**
 * The two URLs the entry point answers at.
 *
 * @type {readonly string[]}
 */
export const ENTRY_ALIASES = Object.freeze(['/', '/index.html']);

/**
 * The three encoding arms, in the order they are issued.
 *
 * @type {readonly ('identity' | 'gzip' | 'br')[]}
 */
export const ENCODING_ARMS = Object.freeze(/** @type {('identity' | 'gzip' | 'br')[]} */ (['identity', 'gzip', 'br']));

/**
 * A path under `/assets/` that no release can have ratified.
 *
 * Sixty-four zeroes is a well-formed asset path and is not the digest of any
 * byte string anybody has: the probe is about a path the allowlist does not
 * carry, so the path has to be well-formed or the origin is being asked a
 * different question.
 */
export const ABSENT_ASSET = `/assets/${'0'.repeat(64)}.js`;

/**
 * Every path the matrix asks about, in one order.
 *
 * The current release's objects, and then every path under `/assets/` that a
 * retained release names and this one does not. Sorted, so that a report reads
 * the same way twice.
 *
 * @param {import('./manifest.mjs').ReleaseManifest} manifest
 * @param {ReadonlyMap<string, string>} assetUnion
 * @returns {string[]}
 */
export function probedPaths(manifest, assetUnion) {
  const paths = new Set(Object.keys(manifest.objects));
  for (const path of assetUnion.keys()) {
    if (path.startsWith('/assets/')) {
      paths.add(path);
    }
  }
  return [...paths].sort();
}

/**
 * The whole matrix.
 *
 * @param {import('./manifest.mjs').ReleaseManifest} manifest
 * @param {ReadonlyMap<string, string>} assetUnion Every path under `/assets/`
 *   the union of the retained releases names, with the digest its own release
 *   recorded.
 * @param {string} nonce A value nothing else in the run uses, for the
 *   document-prefix miss.
 * @returns {PlannedRequest[]}
 */
export function planRequests(manifest, assetUnion, nonce) {
  /** @type {PlannedRequest[]} */
  const plan = [];

  /**
   * @param {string} arm
   * @param {string} path
   * @param {Partial<PlannedRequest>} [how]
   */
  const add = (arm, path, how = {}) => {
    plan.push({
      arm,
      path,
      hasQuery: how.hasQuery ?? false,
      query: how.query ?? '',
      acceptEncoding: how.acceptEncoding ?? null,
      conditional: how.conditional ?? false,
    });
  };

  for (const alias of ENTRY_ALIASES) {
    for (const encoding of ENCODING_ARMS) {
      add(`alias-${encoding}`, alias, { acceptEncoding: encoding });
    }
    add('alias-conditional', alias, { conditional: true });
  }

  const paths = probedPaths(manifest, assetUnion);
  for (const path of paths) {
    for (const encoding of ENCODING_ARMS) {
      add(`object-${encoding}`, path, { acceptEncoding: encoding });
    }
    add('object-conditional', path, { conditional: true });
    add('object-bare-query', path, { hasQuery: true, query: '', acceptEncoding: 'identity' });
  }

  add('probe-absent-asset', ABSENT_ASSET, { acceptEncoding: 'identity' });

  const anyAsset = paths.find((path) => path.startsWith('/assets/'));
  if (anyAsset !== undefined) {
    add('probe-asset-query', anyAsset, { hasQuery: true, query: 'v=1', acceptEncoding: 'identity' });
  }

  add('probe-document-miss', `/missing-${nonce}`, { acceptEncoding: 'identity' });

  return plan;
}
