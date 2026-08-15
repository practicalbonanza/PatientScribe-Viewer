/**
 * The whole judgement, in one place, over data.
 *
 * Everything the check decides is decided here, from a capture: a list of
 * observations, the manifest they are measured against, the listing the deploy
 * supplied, and the origin the page's requests are allowed to reach. Nothing in
 * this module opens anything. That is what makes the same judgement runnable
 * against a live origin and against a fixture on loopback without a second
 * implementation, and it is what makes a fixture's redness evidence about the
 * check rather than about the fixture harness.
 *
 * The verdict is a list of refusals and it is fail-closed in both directions
 * that matter. A predicate with nothing to look at does not pass: an object with
 * no observation against it is a refusal, an inventory that was not supplied is
 * a refusal, a conditional arm that could not be issued is recorded rather than
 * dropped. And a refusal of either severity refuses the run — see `verdict.mjs`
 * for why a surfaced finding is not a warning.
 *
 * Every body that arrives is judged, and which judgement applies is decided by
 * the response rather than by which arm elicited it. That is not a refinement;
 * it is the difference between a check on an origin and a check on three of the
 * requests one can make of it. An origin that serves the release under
 * `Accept-Encoding: identity`, `gzip` and `br` and serves something else to a
 * conditional request, or to a request carrying a query, is an origin most of
 * whose traffic is the something else — every browser sends a coding, most send
 * a validator on a second visit, and the arms that would have caught it are the
 * ones nobody hashed. So a 200 for a path the release names must be that path's
 * bytes whichever arm asked, and a 304 must carry nothing at all.
 *
 * And a partial response is refused wherever it appears. Nothing this check
 * sends asks for one — no request in the matrix carries a `Range` — so a 206 is
 * an origin answering a question nobody asked, and there is no reading of "these
 * are some of the bytes" that a check comparing whole objects against recorded
 * digests can make.
 */

import { checkAssetContentType, checkCacheDirective, expectedDirective, parseAssetPath, underAssets } from './cache.mjs';
import { sha256Hex } from './digest.mjs';
import {
  CACHE_FIELD,
  checkGovernedHeaders,
  checkHeaderAllowlist,
  checkNoRequestCookie,
  CSP_FIELD,
  GOVERNED_HEADERS,
} from './headers.mjs';
import { checkReleaseIdentifier } from './identity.mjs';
import { compareInventory, CONFIG_PATH, ENTRY_POINT } from './manifest.mjs';
import { couldNotBeRead, fieldValues, listTokens } from './observation.mjs';
import { checkNoOutOfBandInitiation } from './out-of-band.mjs';
import { ENCODING_ARMS, ENTRY_ALIASES, probedPaths } from './requests.mjs';
import { fail, finding, PREDICATES } from './verdict.mjs';

/**
 * Which predicate each kind of unread wire carries.
 *
 * The mapping is here rather than in the client, so that the client says what it
 * could not read and the roster stays the core's. A client that named its own
 * predicates would be a client that could name one nothing asserts on.
 *
 * @type {Readonly<Record<import('./observation.mjs').CaptureFailure['kind'], string>>}
 */
const CAPTURE_PREDICATES = Object.freeze({
  'header-line': PREDICATES.CAPTURE_HEADER_LINE,
  'body-length': PREDICATES.CAPTURE_BODY_LENGTH,
  'body-framing': PREDICATES.CAPTURE_BODY_FRAMING,
  'framing-choice': PREDICATES.CAPTURE_FRAMING_CHOICE,
  'http-version': PREDICATES.CAPTURE_HTTP_VERSION,
  'trailer-field': PREDICATES.CAPTURE_TRAILER_FIELD,
  unreadable: PREDICATES.CAPTURE_UNREADABLE,
});

/**
 * An arm the client could not issue.
 *
 * @typedef {object} NotRun
 * @property {string} arm
 * @property {string} path
 * @property {string} reason
 */

/**
 * Everything a judgement is made from.
 *
 * @typedef {object} Capture
 * @property {string} apiOrigin The origin the page may talk to, derived by the
 *   caller from the committed table whose bytes the manifest binds. Never read
 *   from a response.
 * @property {import('./manifest.mjs').ReleaseManifest} manifest
 * @property {ReadonlyMap<string, string>} assetUnion Every `/assets/` path in
 *   the union of the manifests of retained ratified releases, this release
 *   included, with the digest the release that named it recorded. A map rather
 *   than a set: a retained object is one the origin must still be serving, and
 *   which bytes it must be serving there is the half a set cannot carry.
 * @property {import('./manifest.mjs').OriginInventory | null} inventory
 * @property {boolean} inventorySupplied Whether a listing was handed to the run
 *   at all. Separate from whether the one supplied could be read: a listing that
 *   was supplied and refused has already produced its own refusals, and
 *   reporting it a second time as a listing nobody supplied would name a defect
 *   that is not the one there.
 * @property {readonly import('./observation.mjs').Observation[]} observations
 * @property {readonly NotRun[]} notRun
 * @property {{ localDigest: string | null, liveDigest: string | null }} configBinding
 */

/**
 * Bytes as text, for the readings that are about a document rather than a blob.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function asText(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Are two byte strings the same bytes?
 *
 * @param {Uint8Array | null} left
 * @param {Uint8Array | null} right
 * @returns {boolean}
 */
function sameBytes(left, right) {
  if (left === null || right === null) {
    return left === right;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let at = 0; at < left.length; at += 1) {
    if (left[at] !== right[at]) {
      return false;
    }
  }
  return true;
}

/**
 * The governed fields of a response, as a sorted multiset of `name: value`.
 *
 * What "identical classification" means between the two entry-point aliases:
 * the same governed fields with the same values, however many times each. The
 * representation headers are deliberately not in it — two responses to two
 * different request targets legitimately differ in `Content-Length` when one is
 * a range and in `ETag` when the origin derives it from the path — so comparing
 * every field would be comparing things nobody claimed were equal.
 *
 * @param {import('./observation.mjs').Observation} response
 * @returns {string[]}
 */
function governedFields(response) {
  const governed = new Set([...Object.keys(GOVERNED_HEADERS), CSP_FIELD, CACHE_FIELD]);
  return response.headers
    .filter((field) => governed.has(field.name))
    .map((field) => `${field.name}: ${field.value}`)
    .sort();
}

/**
 * Is this path one the asset behaviour may keep?
 *
 * @param {string} path
 * @param {ReadonlyMap<string, string>} assetUnion
 * @returns {boolean}
 */
function allowlisted(path, assetUnion) {
  return underAssets(path) && assetUnion.has(path) && parseAssetPath(path) !== null;
}

/**
 * The arms that ask a path for a representation of itself, and nothing else.
 *
 * Six of them: the three codings, of an object and of an entry-point alias. What
 * they have in common is the request — no query, one `Accept-Encoding`, nothing
 * else — so what comes back is a representation of the path as the origin serves
 * it, which is what the reading below needs and is the only thing it may have.
 *
 * @type {ReadonlySet<string>}
 */
const REPRESENTATION_ARMS = new Set(
  ['object', 'alias'].flatMap((subject) => ENCODING_ARMS.map((encoding) => `${subject}-${encoding}`)),
);

/**
 * How long each representation of each path was, as it arrived.
 *
 * A path can be served as more than one representation — this matrix asks for
 * three codings of every object — and each of them is a different number of
 * octets. What that set is for is the reading of a 304 below: the field a 304
 * may carry describes a representation the browser already holds, and which of
 * the path's representations that is, is not something the response says.
 *
 * Exactly the representation arms, and the exclusion is the load-bearing half.
 * The matrix also asks each path with a query on it, and a response to one of
 * those is an answer to a different question: a query is part of a request
 * target, an origin may legitimately answer it with something else, and the
 * conditional request that a 304 answers carries no query at all. Counting those
 * lengths would widen the set a 304's claim is checked against with numbers no
 * conditional request could ever have been about — so an origin serving one
 * length under `?v=1` would be an origin whose 304 may claim that length, which
 * is a check admitting whatever the origin puts in front of it.
 *
 * Measured as the octets that arrived rather than as the object's own length,
 * because a `Content-Length` counts what is on the wire — the encoded
 * representation — and comparing it against the decoded object would be
 * comparing two different numbers whenever a coding was applied.
 *
 * @param {Capture} capture
 * @returns {Map<string, Set<number>>}
 */
function representationLengths(capture) {
  /** @type {Map<string, Set<number>>} */
  const lengths = new Map();
  for (const response of capture.observations) {
    if (response.status !== 200 || response.raw === null) {
      continue;
    }
    if (!REPRESENTATION_ARMS.has(response.arm) || response.hasQuery) {
      continue;
    }
    const seen = lengths.get(response.path) ?? new Set();
    seen.add(response.raw.length);
    lengths.set(response.path, seen);
  }
  return lengths;
}

/**
 * Judge every response on its own: what could be read of it at all, the headers
 * it must carry, the headers it may carry, the directive its class requires, the
 * cookie it must not set, the partial response it must not be, and the body a
 * 304 must not have.
 *
 * The reading comes first, and it is a judgement rather than a precondition. A
 * response the client could not account for in full is a response whose every
 * other reading is about the part that survived — so what the client could not
 * read is refused under its own name, next to the readings of what it could. A
 * response that could not be read at all is the one exception, and it is
 * `couldNotBeRead` rather than a special case here: there is nothing to say
 * about the fields of a response that has none.
 *
 * A 304 carrying bytes is refused here rather than among the object judgements,
 * because it is not a claim about any particular object: the status says the
 * browser already holds the representation and none is being sent, and a body
 * alongside it is a response contradicting itself whatever path it came from.
 *
 * A 304's `Content-Length` is a different question and is not that one. It
 * describes the representation the browser is being told it already has, so it
 * is never compared against the nothing that arrived — an origin refused for
 * that is an origin refused for being correct. It is compared against the
 * lengths this run saw that path served as a representation of itself, and it is
 * conformant if it is any of them: the conditional request replays a validator
 * and sends no coding preference of its own, and a validator that is not
 * specific to a coding can validate a representation other than the one that
 * issued it. Which responses those are is decided above, and it is a shorter
 * list than "every 200".
 *
 * @param {Capture} capture
 * @returns {import('./verdict.mjs').Refusal[]}
 */
export function judgeEachResponse(capture) {
  /** @type {import('./verdict.mjs').Refusal[]} */
  const refusals = [];
  const lengths = representationLengths(capture);
  for (const response of capture.observations) {
    const where = `${response.arm} ${response.path}`;
    for (const unread of response.captureFailures) {
      refusals.push(fail(CAPTURE_PREDICATES[unread.kind], where, unread.detail));
    }
    if (couldNotBeRead(response)) {
      continue;
    }
    if (response.status === 206) {
      refusals.push(
        fail(
          PREDICATES.PARTIAL_CONTENT,
          where,
          'the origin answered with a partial response, and no request this check makes asks for one — which bytes of the object these are is a question nobody put to it',
        ),
      );
    }
    if (response.status === 304 && response.raw !== null && response.raw.length > 0) {
      refusals.push(
        fail(
          PREDICATES.NOT_MODIFIED_BODY,
          where,
          `a 304 carried ${response.raw.length} byte(s), and a 304 says the browser already holds the representation and none is being sent`,
        ),
      );
    }
    if (response.status === 304) {
      const declared = fieldValues(response, 'content-length');
      const seen = lengths.get(response.path) ?? new Set();
      for (const value of declared) {
        const claimed = Number.parseInt(value, 10);
        if (!seen.has(claimed)) {
          refusals.push(
            fail(
              PREDICATES.NOT_MODIFIED_LENGTH,
              where,
              `a 304 says the representation is ${JSON.stringify(value)} byte(s) long, and this path was served at ${
                seen.size === 0 ? 'no length this run observed' : `${[...seen].sort((one, two) => one - two).join(', ')}`
              }`,
            ),
          );
        }
      }
    }
    refusals.push(...checkGovernedHeaders(response, capture.apiOrigin));
    refusals.push(...checkHeaderAllowlist(response));
    refusals.push(...checkNoRequestCookie(response));
    refusals.push(
      ...checkCacheDirective(
        response,
        expectedDirective({
          path: response.path,
          hasQuery: response.hasQuery,
          query: response.query,
          status: response.status,
          allowlisted: allowlisted(response.path, capture.assetUnion),
        }),
      ),
    );
    const asset = parseAssetPath(response.path);
    if (asset !== null && (response.status === 200 || response.status === 206)) {
      refusals.push(...checkAssetContentType(response, asset.extension));
    }
  }
  return refusals;
}

/**
 * Judge the entry point: both aliases, against each other and against the
 * manifest's release identifier, and neither of them starting anything out of
 * band.
 *
 * @param {Capture} capture
 * @returns {import('./verdict.mjs').Refusal[]}
 */
export function judgeEntryPoint(capture) {
  /** @type {import('./verdict.mjs').Refusal[]} */
  const refusals = [];

  /** @param {string} arm @param {string} path */
  const find = (arm, path) => capture.observations.find((one) => one.arm === arm && one.path === path) ?? null;

  for (const alias of ENTRY_ALIASES) {
    for (const response of capture.observations.filter((one) => one.path === alias && one.arm.startsWith('alias-'))) {
      refusals.push(...checkNoOutOfBandInitiation(response));
    }
  }

  // Every arm the entry point is asked on, the conditional one included. `/` is
  // never a key of the manifest, so the digest comparison that pins
  // `/index.html` on every arm does not reach it — what pins `/` is that it
  // answers identically to `/index.html`, and an arm that comparison does not
  // cover is an arm where `/` may answer anything. The conditional arm is the
  // one that was not covered.
  const aliasArms = [...ENCODING_ARMS.map((encoding) => `alias-${encoding}`), 'alias-conditional'];
  for (const arm of aliasArms) {
    const root = find(arm, '/');
    const named = find(arm, ENTRY_POINT);
    if (root === null && named === null) {
      if (arm === 'alias-conditional') {
        // Neither alias issued a validator, which is recorded as an arm that did
        // not run. Refusing it a second time here would name it as a divergence,
        // and two aliases that both did not run have not diverged.
        continue;
      }
      refusals.push(fail(PREDICATES.OBJECT_MISSING, arm, 'neither entry-point alias was observed on this arm'));
      continue;
    }
    if (root === null || named === null) {
      refusals.push(
        fail(
          PREDICATES.ALIAS_DIVERGENCE,
          arm,
          `${root === null ? '/' : ENTRY_POINT} was not observed on this arm and ${root === null ? ENTRY_POINT : '/'} was`,
        ),
      );
      continue;
    }
    if (root.status !== named.status) {
      refusals.push(
        fail(PREDICATES.ALIAS_DIVERGENCE, arm, `/ answered ${root.status} and ${ENTRY_POINT} answered ${named.status}`),
      );
    }
    if (!sameBytes(root.decoded, named.decoded)) {
      refusals.push(
        fail(
          PREDICATES.ALIAS_DIVERGENCE,
          arm,
          `/ and ${ENTRY_POINT} served different bytes — ${root.decoded?.length ?? 'undecodable'} against ${named.decoded?.length ?? 'undecodable'}`,
        ),
      );
    }
    const left = governedFields(root).join(' | ');
    const right = governedFields(named).join(' | ');
    if (left !== right) {
      refusals.push(
        fail(PREDICATES.ALIAS_DIVERGENCE, arm, `/ carries {${left}} and ${ENTRY_POINT} carries {${right}}`),
      );
    }
  }

  for (const alias of ENTRY_ALIASES) {
    const response = find('alias-identity', alias);
    if (response === null || response.decoded === null) {
      refusals.push(fail(PREDICATES.RELEASE_IDENTIFIER, alias, 'the entry point was not observed as bytes anything can be read from'));
      continue;
    }
    refusals.push(...checkReleaseIdentifier(asText(response.decoded), capture.manifest.release_id, alias));
  }

  return refusals;
}

/**
 * Judge every object the origin must be serving — this release's, and the
 * objects under `/assets/` the retained releases still name — on every arm the
 * matrix asked it: the bytes under each coding, the validator arm, and the
 * bare-query probe.
 *
 * @param {Capture} capture
 * @returns {import('./verdict.mjs').Refusal[]}
 */
export function judgeObjects(capture) {
  /** @type {import('./verdict.mjs').Refusal[]} */
  const refusals = [];

  /** @param {string} arm @param {string} path @param {boolean} [withQuery] */
  const find = (arm, path, withQuery = false) =>
    capture.observations.find((one) => one.arm === arm && one.path === path && one.hasQuery === withQuery) ?? null;

  for (const path of probedPaths(capture.manifest, capture.assetUnion)) {
    const ownDigest = Object.prototype.hasOwnProperty.call(capture.manifest.objects, path)
      ? capture.manifest.objects[path]
      : capture.assetUnion.get(path);
    if (ownDigest === undefined) {
      continue;
    }
    const digest = ownDigest;
    const named = Object.prototype.hasOwnProperty.call(capture.manifest.objects, path)
      ? 'the manifest records'
      : 'the retained release that names it records';

    // An object under /assets/ is named by its own digest, so a name that does
    // not match the bytes it records is a manifest disagreeing with itself
    // before any request is made.
    if (underAssets(path)) {
      const asset = parseAssetPath(path);
      if (asset === null) {
        refusals.push(fail(PREDICATES.ASSET_PATH, path, 'it is under /assets/ and is not a direct child named by sixty-four hex characters and an admitted extension'));
      } else if (asset.digest !== digest) {
        refusals.push(fail(PREDICATES.ASSET_PATH, path, `it is named ${asset.digest} and ${named} ${digest}`));
      }
    }

    // Every 200 this path answered, on whichever arm asked. A release is a set
    // of bytes at a set of paths, and a 200 at one of those paths is either
    // those bytes or it is not — which arm elicited it changes what the request
    // was asking about, not what the answer has to be.
    const seen = capture.observations.filter((one) => one.path === path);
    for (const response of seen) {
      if (response.status !== 200) {
        continue;
      }
      const where = `${response.arm} ${response.path}${response.hasQuery ? `?${response.query}` : ''}`;
      if (response.decoded === null) {
        refusals.push(
          fail(PREDICATES.OBJECT_UNDECODABLE, where, `the body could not be decoded: ${response.decodeFailure ?? 'no reason recorded'}`),
        );
        continue;
      }
      const served = sha256Hex(response.decoded);
      if (served !== digest) {
        refusals.push(fail(PREDICATES.OBJECT_DIGEST, where, `the decoded bytes digest to ${served} and ${named} ${digest}`));
      }
    }

    for (const encoding of ENCODING_ARMS) {
      const arm = `object-${encoding}`;
      const response = find(arm, path);
      if (response === null) {
        refusals.push(fail(PREDICATES.OBJECT_MISSING, `${arm} ${path}`, 'this arm was not observed'));
        continue;
      }
      if (response.status >= 300 && response.status < 400) {
        refusals.push(fail(PREDICATES.OBJECT_REDIRECT, `${arm} ${path}`, `the origin answered ${response.status} where an object is expected`));
        continue;
      }
      if (response.status !== 200) {
        refusals.push(fail(PREDICATES.OBJECT_MISSING, `${arm} ${path}`, `the origin answered ${response.status}`));
        continue;
      }
      if (response.decoded === null) {
        // Already refused above, with every other 200 whose body could not be
        // read. The reading below is about a response whose coding came off, and
        // a response whose coding did not come off is not a second finding about
        // its coding — it is the same one.
        continue;
      }
      const codings = fieldValues(response, 'content-encoding').flatMap((value) => listTokens(value));
      const compressed = codings.some((token) => token !== 'identity');
      if (compressed) {
        const vary = fieldValues(response, 'vary').flatMap((value) => listTokens(value));
        if (!vary.includes('accept-encoding')) {
          refusals.push(
            fail(PREDICATES.VARY, `${arm} ${path}`, `the response is ${codings.join(', ')} encoded and its Vary is ${JSON.stringify(vary.join(', '))}`),
          );
        }
      }
    }

    const canonical = find('object-identity', path);
    const bare = find('object-bare-query', path, true);
    if (bare === null) {
      refusals.push(fail(PREDICATES.BARE_QUERY, path, 'the bare-query arm was not observed'));
    } else if (canonical !== null) {
      const differences = [];
      if (bare.status !== canonical.status) {
        differences.push(`status ${bare.status} against ${canonical.status}`);
      }
      if (!sameBytes(bare.decoded, canonical.decoded)) {
        differences.push('different decoded bytes');
      }
      const bareDirective = fieldValues(bare, CACHE_FIELD).join(', ');
      const canonicalDirective = fieldValues(canonical, CACHE_FIELD).join(', ');
      if (bareDirective !== canonicalDirective) {
        differences.push(`Cache-Control ${JSON.stringify(bareDirective)} against ${JSON.stringify(canonicalDirective)}`);
      }
      if (differences.length > 0) {
        refusals.push(
          fail(PREDICATES.BARE_QUERY, path, `a bare ? answered differently from the canonical request: ${differences.join('; ')}`),
        );
      }
    }
  }

  for (const missed of capture.notRun) {
    refusals.push(
      finding(PREDICATES.CONDITIONAL_ARM, `${missed.arm} ${missed.path}`, `this arm did not run: ${missed.reason}`),
    );
  }

  return refusals;
}

/**
 * Judge the listing against the manifest, in both directions.
 *
 * A run with no listing fails here. It does not skip: an origin cannot be
 * enumerated over HTTP, so the two extra-object verdicts have no other source,
 * and a check that answers fewer questions when it is given less is a check
 * whose scope its caller sets.
 *
 * @param {Capture} capture
 * @returns {import('./verdict.mjs').Refusal[]}
 */
export function judgeInventory(capture) {
  if (!capture.inventorySupplied) {
    return [
      fail(
        PREDICATES.INVENTORY_ABSENT,
        'origin inventory',
        'no listing was supplied, and the extra-object verdicts have no other source — an origin is never asked what it serves',
      ),
    ];
  }
  if (capture.inventory === null) {
    // Supplied and refused. The refusals for why are already in the run, and a
    // second one here would say the listing was missing, which it was not.
    return [];
  }
  return compareInventory(capture.manifest, capture.inventory, capture.assetUnion);
}

/**
 * Judge the three-way binding of the origin table.
 *
 * The local module is what executes to produce the expected `connect-src`, the
 * live bytes are what the origin serves, and the manifest entry is what binds
 * them to each other. Any leg failing fails the run — two legs agreeing is a
 * check that the third can be swapped under.
 *
 * @param {Capture} capture
 * @returns {import('./verdict.mjs').Refusal[]}
 */
export function judgeConfigBinding(capture) {
  /** @type {import('./verdict.mjs').Refusal[]} */
  const refusals = [];
  const bound = capture.manifest.objects[CONFIG_PATH];
  if (bound === undefined) {
    return [
      fail(
        PREDICATES.CONFIG_BINDING,
        CONFIG_PATH,
        'the manifest does not bind the origin table, so the expected connect-src would be derived from bytes nothing pinned',
      ),
    ];
  }
  const { localDigest, liveDigest } = capture.configBinding;
  if (localDigest === null) {
    refusals.push(fail(PREDICATES.CONFIG_BINDING, CONFIG_PATH, 'the local origin table was not read'));
  } else if (localDigest !== bound) {
    refusals.push(fail(PREDICATES.CONFIG_BINDING, CONFIG_PATH, `the local table digests to ${localDigest} and the manifest binds ${bound}`));
  }
  if (liveDigest === null) {
    refusals.push(fail(PREDICATES.CONFIG_BINDING, CONFIG_PATH, 'the live origin table was not served as bytes anything could digest'));
  } else if (liveDigest !== bound) {
    refusals.push(fail(PREDICATES.CONFIG_BINDING, CONFIG_PATH, `the live table digests to ${liveDigest} and the manifest binds ${bound}`));
  }
  return refusals;
}

/**
 * Everything, in the order a reader wants it.
 *
 * @param {Capture} capture
 * @returns {import('./verdict.mjs').Refusal[]}
 */
export function judge(capture) {
  return [
    ...judgeEachResponse(capture),
    ...judgeEntryPoint(capture),
    ...judgeObjects(capture),
    ...judgeInventory(capture),
    ...judgeConfigBinding(capture),
  ];
}
