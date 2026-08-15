/**
 * The response headers a release must serve, and the ones it may.
 *
 * Two lists, and they do opposite jobs. The governed set is what every response
 * has to carry, spelled out to the character: a policy that differs from the one
 * written here by a directive is a different policy, and the interesting way for
 * a security header to stop working is for it to still be there. The allowlist
 * is what a response may carry beyond that, and it exists because the opposite
 * rule — "anything else is fine" — makes a header nobody chose indistinguishable
 * from a header somebody added on purpose.
 *
 * The expected strings are written here, once, as literals. They are not derived
 * from the origin, not read from a deployment configuration, and not assembled
 * from parts at a call site: a check that builds its expectation out of what it
 * measured passes whatever it measures, and a check whose expectation lives at
 * the call site is a check that can be relaxed one call at a time. The one thing
 * that is not a literal is the `connect-src` origin, and it is substituted from
 * a mapping the caller supplies rather than from the response — see the note on
 * `contentSecurityPolicy`.
 *
 * The allowlist is scoped by response class, which is the part that is easy to
 * get wrong in the safe-looking direction. `Location` on a 3xx is the redirect;
 * on a 200 it is nothing the status accounts for. So the class decides whether
 * it is admitted, and the class is read from the status rather than from
 * anything the response says about itself.
 *
 * `Content-Range` is admitted nowhere. It is the field a partial response uses
 * to say which bytes of how many it carries, and no request this check makes
 * asks for part of anything — so the field is either on a response that is not
 * partial, where it claims the status is something it is not, or on one that is,
 * which is refused for being partial. Neither is a response this check has a
 * reading of.
 */

import { fieldNames, fieldValues } from './observation.mjs';
import { fail, finding, PREDICATES } from './verdict.mjs';

/**
 * The §6.1 headers other than the policy and the cache directive, and the exact
 * value each must carry.
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
 * Eight directives and then the trusted-types requirement, which is written as
 * its own entry rather than folded into the list above it because the normative
 * text states it separately — the eight are the policy the design settled, and
 * the ninth is what was appended to it. Spelling them as one string here would
 * be spelling a decision as a sentence.
 *
 * @param {string} apiOrigin The origin this page's requests may reach, which is
 *   read from the committed origin table whose bytes the release manifest binds.
 *   Never from the response, and never from the origin under test: an expected
 *   value taken from the thing being tested is not an expectation.
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

/**
 * The field name the policy is carried in.
 */
export const CSP_FIELD = 'content-security-policy';

/**
 * The field name the cache directive is carried in.
 *
 * Governed, but not by a single expected string — which behaviour applies is
 * decided per path and per status in `cache.mjs`. It is named here so that the
 * allowlist below can admit it without admitting anything else.
 */
export const CACHE_FIELD = 'cache-control';

/**
 * Headers a response may carry beyond the governed set, in any class.
 *
 * @type {readonly string[]}
 */
export const ALLOWED_HEADERS = Object.freeze([
  'content-type',
  'content-length',
  'content-encoding',
  'vary',
  'date',
  'etag',
  'last-modified',
  'accept-ranges',
  'age',
  'server',
  'alt-svc',
  'via',
  'x-cache',
]);

/**
 * The connection-management set, exactly.
 *
 * Three names and no rule that generates them. A rule — anything hop-by-hop,
 * anything named in `Connection` — is a rule whose members the response gets to
 * choose, which is an allowlist the subject writes.
 *
 * @type {readonly string[]}
 */
export const CONNECTION_HEADERS = Object.freeze(['connection', 'keep-alive', 'transfer-encoding']);

/**
 * The one prefix rule.
 *
 * A distribution in front of the origin adds fields of its own under this
 * prefix. They are admitted by prefix because their names are not a list anyone
 * outside that distribution finishes, and they are admitted only under a prefix
 * that cannot be spelled by accident.
 */
export const ALLOWED_PREFIX = 'x-amz-cf-';

/**
 * The field a 3xx may carry and nothing else may.
 */
export const LOCATION_FIELD = 'location';

/**
 * The field that is a failure wherever it appears.
 *
 * Not "wherever it appears with a value this reading finds interesting" — the
 * viewer has no session, no server-side state and nothing to remember, so a
 * response setting a cookie is a response from something that is not this
 * design, whatever the cookie says.
 */
export const SET_COOKIE_FIELD = 'set-cookie';

/**
 * Is a field name admitted on a response of this status?
 *
 * @param {string} name Lowercase.
 * @param {number} status
 * @returns {boolean}
 */
export function admitsHeader(name, status) {
  if (name === CSP_FIELD || name === CACHE_FIELD) {
    return true;
  }
  if (Object.prototype.hasOwnProperty.call(GOVERNED_HEADERS, name)) {
    return true;
  }
  if (ALLOWED_HEADERS.includes(name) || CONNECTION_HEADERS.includes(name)) {
    return true;
  }
  if (name.startsWith(ALLOWED_PREFIX)) {
    return true;
  }
  if (name === LOCATION_FIELD) {
    return status >= 300 && status < 400;
  }
  return false;
}

/**
 * Does this response carry the governed headers, each exactly once and each with
 * exactly the value it must have?
 *
 * Each exactly once, and that is the comparison rather than "is the value
 * somewhere among the occurrences". A response carrying two `Referrer-Policy`
 * fields, one of them right, is a response whose behaviour depends on which the
 * intermediary kept.
 *
 * @param {import('./observation.mjs').Observation} response
 * @param {string} apiOrigin
 * @returns {import('./verdict.mjs').Refusal[]}
 */
export function checkGovernedHeaders(response, apiOrigin) {
  /** @type {import('./verdict.mjs').Refusal[]} */
  const refusals = [];
  const where = `${response.arm} ${response.path}`;

  for (const [name, expected] of Object.entries(GOVERNED_HEADERS)) {
    const occurrences = fieldValues(response, name);
    if (occurrences.length !== 1) {
      refusals.push(
        fail(PREDICATES.POLICY_HEADER, where, `${name} appeared ${occurrences.length} time(s), and it must appear once`),
      );
      continue;
    }
    const value = occurrences[0] ?? '';
    if (value !== expected) {
      refusals.push(fail(PREDICATES.POLICY_HEADER, where, `${name} is ${JSON.stringify(value)}, and it must be ${JSON.stringify(expected)}`));
    }
  }

  const policies = fieldValues(response, CSP_FIELD);
  if (policies.length !== 1) {
    refusals.push(
      fail(
        PREDICATES.CSP_FIELD_COUNT,
        where,
        `the policy appeared in ${policies.length} header field(s), and zero or several are each a failure`,
      ),
    );
  } else {
    const expected = contentSecurityPolicy(apiOrigin);
    const value = policies[0] ?? '';
    if (value !== expected) {
      refusals.push(fail(PREDICATES.CSP_VALUE, where, `the policy is ${JSON.stringify(value)}, and it must be ${JSON.stringify(expected)}`));
    }
  }

  return refusals;
}

/**
 * Does this response carry anything outside the class-scoped allowlist, and does
 * it set a cookie?
 *
 * The two are read together because they are read from the same list of field
 * names, and separated in the answer because the normative text separates them:
 * an unexpected field is a surfaced finding and a cookie is a failure.
 *
 * @param {import('./observation.mjs').Observation} response
 * @returns {import('./verdict.mjs').Refusal[]}
 */
export function checkHeaderAllowlist(response) {
  /** @type {import('./verdict.mjs').Refusal[]} */
  const refusals = [];
  const where = `${response.arm} ${response.path}`;

  for (const name of fieldNames(response)) {
    if (name === SET_COOKIE_FIELD) {
      refusals.push(
        fail(PREDICATES.SET_COOKIE, where, 'the response set a cookie, and this design has nothing to remember about anyone'),
      );
      continue;
    }
    if (!admitsHeader(name, response.status)) {
      refusals.push(
        finding(
          PREDICATES.HEADER_ALLOWLIST,
          where,
          `${name} is not admitted on a ${response.status}, and the allowlist is the list rather than a judgement at a call site`,
        ),
      );
    }
  }

  return refusals;
}

/**
 * Did the request carry a cookie?
 *
 * The other half of the zero-cookie predicate, and the half a response-side
 * reading cannot reach: an origin that sets no cookie still receives whatever a
 * browser was already holding for it.
 *
 * @param {import('./observation.mjs').Observation} response
 * @returns {import('./verdict.mjs').Refusal[]}
 */
export function checkNoRequestCookie(response) {
  const carried = response.requestHeaders.filter((field) => field.name === 'cookie');
  if (carried.length === 0) {
    return [];
  }
  return [
    fail(
      PREDICATES.COOKIE_REQUEST,
      `${response.arm} ${response.path}`,
      `the request carried ${carried.length} Cookie field(s), and a viewer with no session sends none`,
    ),
  ];
}

/**
 * Is the browsing context holding anything after the page has finished loading?
 *
 * The third reading of the same requirement, and the one neither of the other
 * two can make. "No response set a cookie" is about what the origin sent; "no
 * request carried one" is about what went back; this is about what is left
 * behind, which is the thing a person sitting at that browser afterwards
 * actually has. A page can leave a jar populated without either of the other two
 * readings noticing — a script writing `document.cookie` sends nothing and is
 * sent nothing — so the jar is asked directly.
 *
 * @param {number} count How many cookies the context holds.
 * @param {string} subject
 * @returns {import('./verdict.mjs').Refusal[]}
 */
export function checkCookieJar(count, subject) {
  if (count === 0) {
    return [];
  }
  return [
    fail(PREDICATES.COOKIE_JAR, subject, `the browsing context holds ${count} cookie(s) after the page finished loading, and it must hold none`),
  ];
}
