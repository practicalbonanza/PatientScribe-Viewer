/**
 * Which responses may be kept, and which may not.
 *
 * Two behaviours and one boundary between them. Under `/assets/` an object is
 * named by the digest of its own bytes, so the name can never come to mean
 * different bytes and the response may be kept for a year. Everywhere else —
 * the entry-point document, its alias, error documents, redirects, anything at
 * all — the response reaches the browser with `no-store`, because everywhere
 * else is where a share can be, and a shared note in a cache is a shared note
 * somebody else can read.
 *
 * The classification below is written as the normative text is written, and one
 * sentence of that text is the whole reason this is a table rather than a rule
 * about caching: absence of the immutable directive is not sufficient for the
 * responses that must not be kept. A 404 with no cache directive at all is
 * heuristically cacheable — a cache is allowed to invent a freshness lifetime
 * for it — so "not marked immutable" and "will not be stored" are different
 * claims and only the second one is being made. Every response that is not an
 * allowlisted object answering 200, 206 or 304 must say `no-store` in so many
 * words.
 *
 * And the statuses are tested as outcomes rather than derived from what the
 * specification says a cache does with them. A 304 that omits the directive is a
 * 304 whose stored response keeps whatever it was stored with, and a 206 is a
 * response to a request the browser made about bytes it already partly holds;
 * reasoning about either from the RFC is reasoning about what ought to happen
 * at an origin nobody has measured. So the rule here is flat: for an allowlisted
 * object, each of 200, 206 and 304 must itself carry the immutable directive.
 *
 * One request has two acceptable answers rather than one, and it is the only
 * place in this table where that is true. A request for an allowlisted object
 * with something in its query is answered either with the canonical response —
 * the object's own immutable directive, over the object's own bytes — or with an
 * explicit `no-store`. Both are sound and which one arrives is not a property of
 * the release: the cache in front of these objects is keyed on the path alone
 * and does not override what an object says about itself, so a request that
 * differs from the canonical one only in its query is answered out of the cache
 * with the canonical response, metadata and all. Requiring `no-store` there
 * would be requiring the edge to behave in a way the design deliberately did not
 * configure it to. Neither answer can go stale into a browser, either, because
 * these objects are named by the digest of their own bytes: a query variant kept
 * for a year is a copy of bytes that can never come to mean anything else. What
 * is not widened is anything else — a query on a path the allowlist does not
 * carry says `no-store` like everything else that is not allowlisted, and a bare
 * `?`, which is cache-key-identical to no query at all, answers exactly as the
 * canonical request does.
 */

import { listTokens, singleField } from './observation.mjs';
import { fail, PREDICATES } from './verdict.mjs';

/**
 * The prefix that separates the two behaviours.
 */
export const ASSET_PREFIX = '/assets/';

/**
 * What an allowlisted object's response must say, exactly.
 */
export const IMMUTABLE_DIRECTIVE = 'public, max-age=31536000, immutable';

/**
 * The directive every other response must say.
 */
export const NO_STORE_DIRECTIVE = 'no-store';

/**
 * Extension to served content type, exactly.
 *
 * No parameters, and no `charset`. A parameter is a second thing the response is
 * saying, and the table in the normative text says one.
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
 * The path grammar an object under `/assets/` must have, exactly.
 *
 * A direct child of `/assets/`, named by sixty-four lowercase hex characters —
 * the digest the object's own manifest entry records — and one extension from
 * the table above. Anchored at both ends, because a pattern that is not is a
 * pattern that admits a longer path with an admitted one inside it.
 */
const ASSET_PATH = /^\/assets\/([0-9a-f]{64})\.([a-z]+)$/;

/**
 * An asset path taken apart, or `null` if it is not one.
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
 * Is this path under the asset behaviour at all?
 *
 * Read from the prefix rather than from the grammar, because the two questions
 * are different and confusing them is how a malformed asset path gets judged by
 * the wrong behaviour. Anything under `/assets/` is under the asset behaviour;
 * whether it is a well-formed, allowlisted object is the next question, and a
 * path that fails it is a response that must say `no-store` like everything else
 * that is not allowlisted.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function underAssets(path) {
  return path.startsWith(ASSET_PREFIX);
}

/**
 * Which directive this response must carry.
 *
 * Three answers, and the third is one request's two acceptable ones rather than
 * a relaxation of the other two — see the note at the top of this file for why a
 * query on an allowlisted object has two sound answers and what stops that
 * spreading anywhere else.
 *
 * The order the questions are asked in is the order the normative text asks
 * them: what is not under the asset behaviour says `no-store`, then what the
 * allowlist does not carry says `no-store`, then what did not answer with the
 * object says `no-store`, and only what is left is the object answering for
 * itself.
 *
 * @param {object} where
 * @param {string} where.path
 * @param {boolean} where.hasQuery
 * @param {string} where.query
 * @param {number} where.status
 * @param {boolean} where.allowlisted Whether this path is in the union of the
 *   manifests of retained ratified releases. Supplied by the caller, because an
 *   origin is never the source of the list of what it is allowed to serve.
 * @returns {'immutable' | 'no-store' | 'immutable-or-no-store'}
 */
export function expectedDirective({ path, hasQuery, query, status, allowlisted }) {
  if (!underAssets(path)) {
    return 'no-store';
  }
  if (!allowlisted) {
    return 'no-store';
  }
  if (status !== 200 && status !== 206 && status !== 304) {
    return 'no-store';
  }
  // A query with something in it is a different request target, and the two
  // answers it may have are the canonical response and an explicit `no-store`. A
  // bare `?` is not that request: the delimiter with nothing after it is
  // cache-key-identical to no delimiter at all, which is why the two are
  // separate fields on an observation rather than one string, and it answers
  // exactly as the canonical request does.
  if (hasQuery && query.length > 0) {
    return 'immutable-or-no-store';
  }
  return 'immutable';
}

/**
 * Does the response carry the directive it must?
 *
 * `no-store` is checked as a token among the directives rather than as the whole
 * field value, and the immutable case is checked as the whole field value. The
 * asymmetry is deliberate and it is the fail-closed direction of each. A
 * response that says `no-store, must-revalidate` will not be stored, which is
 * the whole of what is being asked of it; a response that says `public,
 * max-age=31536000, immutable, stale-while-revalidate=60` is saying something
 * more than the design settled, and the design settled a string.
 *
 * The `no-store` reading also refuses a field that carries `no-store` alongside
 * something that contradicts it. `no-store, public` is not a claim a cache can
 * act on coherently, and a response making it is a response nobody wrote on
 * purpose.
 *
 * Where two answers are acceptable, both readings are asked and each keeps its
 * own strictness. That is the part worth stating: a response admitted there is
 * one that satisfies one of the two rules as written, not one that half
 * satisfies either. `public, max-age=31536000, immutable, stale-while-revalidate=60`
 * is refused there for the same reason it is refused anywhere else, and so is
 * `no-store, public`.
 *
 * @param {import('./observation.mjs').Observation} response
 * @param {'immutable' | 'no-store' | 'immutable-or-no-store'} expected
 * @returns {import('./verdict.mjs').Refusal[]}
 */
export function checkCacheDirective(response, expected) {
  const where = `${response.arm} ${response.path}${response.hasQuery ? `?${response.query}` : ''}`;
  const occurrences = response.headers.filter((field) => field.name === 'cache-control');
  if (occurrences.length !== 1) {
    return [
      fail(
        PREDICATES.CACHE_FIELD_COUNT,
        where,
        `Cache-Control appeared ${occurrences.length} time(s) on a ${response.status}, and it must appear once`,
      ),
    ];
  }
  const value = occurrences[0]?.value ?? '';
  const saysImmutable = value === IMMUTABLE_DIRECTIVE;
  const notNoStore = whyItIsNotNoStore(value);

  if (expected === 'immutable') {
    if (!saysImmutable) {
      return [
        fail(
          PREDICATES.CACHE_CLASSIFICATION,
          where,
          `a ${response.status} for an allowlisted object says ${JSON.stringify(value)}, and it must say ${JSON.stringify(IMMUTABLE_DIRECTIVE)}`,
        ),
      ];
    }
    return [];
  }

  if (expected === 'immutable-or-no-store') {
    if (saysImmutable || notNoStore === null) {
      return [];
    }
    return [
      fail(
        PREDICATES.CACHE_CLASSIFICATION,
        where,
        `a ${response.status} for an allowlisted object answering a request that carried a query says ${JSON.stringify(
          value,
        )}, and there are two answers it may give and no others: the canonical response, which says ${JSON.stringify(
          IMMUTABLE_DIRECTIVE,
        )}, or an explicit ${JSON.stringify(NO_STORE_DIRECTIVE)} — and as the second of those it ${notNoStore}`,
      ),
    ];
  }

  if (notNoStore !== null) {
    return [fail(PREDICATES.CACHE_CLASSIFICATION, where, `a ${response.status} ${notNoStore}`)];
  }
  return [];
}

/**
 * Why a field value is not an explicit `no-store`, or `null` where it is one.
 *
 * Written out once because two readings ask it — the responses that must say
 * `no-store` and the one request that may — and a second spelling of it is a
 * second rule that can come to disagree with this one.
 *
 * @param {string} value
 * @returns {string | null}
 */
function whyItIsNotNoStore(value) {
  const tokens = listTokens(value);
  if (!tokens.includes(NO_STORE_DIRECTIVE)) {
    return `says ${JSON.stringify(
      value,
    )}, and it must say no-store — absence of immutable is not sufficient, because a response with no directive is heuristically cacheable`;
  }
  const contradictions = tokens.filter(
    (token) => token === 'immutable' || token === 'public' || (token.startsWith('max-age=') && token !== 'max-age=0'),
  );
  if (contradictions.length > 0) {
    return `says no-store alongside ${contradictions.join(', ')}, which is not one claim`;
  }
  return null;
}

/**
 * Is the served content type the one this extension's table entry names?
 *
 * Asked only of responses that carry a body of the object — a 304 carries none,
 * and a 416 is not the object. Callers decide; this answers about what it is
 * handed.
 *
 * @param {import('./observation.mjs').Observation} response
 * @param {string} extension
 * @returns {import('./verdict.mjs').Refusal[]}
 */
export function checkAssetContentType(response, extension) {
  const expected = ASSET_CONTENT_TYPES[extension];
  if (expected === undefined) {
    return [
      fail(
        PREDICATES.ASSET_PATH,
        `${response.arm} ${response.path}`,
        `${extension} is not one of the extensions the asset behaviour serves`,
      ),
    ];
  }
  const served = singleField(response, 'content-type');
  if (served === null) {
    return [
      fail(
        PREDICATES.CONTENT_TYPE,
        `${response.arm} ${response.path}`,
        `no single Content-Type was served, and the table says ${JSON.stringify(expected)}`,
      ),
    ];
  }
  if (served !== expected) {
    return [
      fail(
        PREDICATES.CONTENT_TYPE,
        `${response.arm} ${response.path}`,
        `Content-Type is ${JSON.stringify(served)}, and the table says ${JSON.stringify(expected)} with no parameters`,
      ),
    ];
  }
  return [];
}
