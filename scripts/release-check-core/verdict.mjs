/**
 * What a release check says when something is wrong.
 *
 * Every judgement in this core answers with refusals rather than with a boolean,
 * and every refusal names three things: which predicate refused, what it was
 * looking at, and what it saw. A check that answers `false` is a check whose
 * result cannot be read — it says a release is not acceptable and leaves the
 * person holding it to find out why from the code, which is exactly the reading
 * a gate is supposed to save them. So the answer is the reason.
 *
 * Two severities, and the difference between them is a difference in the
 * normative text rather than a dial. A response carrying a header outside the
 * class-scoped allowlist is described there as a surfaced finding: the header is
 * not one this design chose, and what to do about it is a decision rather than a
 * refusal of the deploy. A response carrying `Set-Cookie` is described as a
 * failure. Both are reported, both are named, and both refuse the run — the
 * severity is what a reader sorts by, not a switch that lets one of them pass
 * unnoticed. The alternative, a run that exits 0 with findings printed above the
 * summary, is a run whose findings nobody reads twice.
 *
 * The roster below is frozen with this module. A refusal whose predicate is not
 * one of these names is a refusal from somewhere nothing has decided about, and
 * `refuse` will not build one — which is what keeps the fixture corpus able to
 * assert on predicate identity rather than on the wording of a message.
 */

/**
 * Every predicate this core can refuse under, by name.
 *
 * Written out here rather than collected from the modules that use them, for the
 * reason every list in this repository is written out: a roster derived from its
 * users agrees with them whatever they say, including after one of them stops
 * refusing anything.
 *
 * Deliberately not annotated as a map of strings. Annotated that way, every
 * member read off it is a `string | undefined` to the type checker and every
 * call site grows a coalesce — a lot of code written for a case that cannot
 * arise, and each of those coalesces is a place where a mistyped member name
 * quietly becomes a refusal named after nothing. Left to be inferred, the
 * members are exactly these names and a mistyped one does not compile.
 */
export const PREDICATES = Object.freeze({
  POLICY_HEADER: 'policy-header',
  CSP_FIELD_COUNT: 'csp-field-count',
  CSP_VALUE: 'csp-value',
  HEADER_ALLOWLIST: 'header-allowlist',
  SET_COOKIE: 'set-cookie',
  COOKIE_REQUEST: 'cookie-request-header',
  COOKIE_JAR: 'cookie-jar',
  CACHE_FIELD_COUNT: 'cache-control-field-count',
  CACHE_CLASSIFICATION: 'cache-classification',
  CONTENT_TYPE: 'content-type',
  ASSET_PATH: 'asset-path-grammar',
  ALIAS_DIVERGENCE: 'alias-divergence',
  MANIFEST_SCHEMA: 'release-manifest-schema',
  MANIFEST_PATH: 'release-manifest-path-grammar',
  MANIFEST_DUPLICATE_KEY: 'release-manifest-duplicate-key',
  MANIFEST_RELEASE_ID: 'release-manifest-release-id',
  MANIFEST_ASSET_COLLISION: 'release-manifest-asset-collision',
  OBJECT_MISSING: 'object-missing',
  OBJECT_DIGEST: 'object-digest',
  OBJECT_REDIRECT: 'object-redirect',
  OBJECT_UNDECODABLE: 'object-undecodable',
  OBJECT_EXTRA_DOCUMENT: 'object-extra-under-document-prefix',
  OBJECT_EXTRA_ASSET: 'object-extra-under-assets',
  PARTIAL_CONTENT: 'partial-content-unrequested',
  NOT_MODIFIED_BODY: 'not-modified-carries-a-body',
  NOT_MODIFIED_LENGTH: 'not-modified-content-length',
  CAPTURE_HEADER_LINE: 'capture-header-line',
  CAPTURE_BODY_LENGTH: 'capture-body-length',
  CAPTURE_BODY_FRAMING: 'capture-body-framing',
  CAPTURE_FRAMING_CHOICE: 'capture-body-framing-choice',
  CAPTURE_HTTP_VERSION: 'capture-http-version',
  CAPTURE_TRAILER_FIELD: 'capture-trailer-field',
  CAPTURE_UNREADABLE: 'capture-response-unreadable',
  INVENTORY_SCHEMA: 'origin-inventory-schema',
  INVENTORY_MISSING_OBJECT: 'origin-inventory-missing-object',
  INVENTORY_ABSENT: 'origin-inventory-absent',
  VARY: 'vary-accept-encoding',
  BARE_QUERY: 'bare-query-equivalence',
  RELEASE_IDENTIFIER: 'release-identifier',
  LINK_HEADER: 'link-header-absent',
  EARLY_HINTS: 'early-hints-absent',
  CONFIG_BINDING: 'config-binding',
  CONNECT_SRC_ORIGIN: 'connect-src-origin-unknown',
  CONDITIONAL_ARM: 'conditional-arm-not-run',
});

/**
 * The predicate names, as a set, for the one question `refuse` asks.
 *
 * @type {ReadonlySet<string>}
 */
const KNOWN = new Set(Object.values(PREDICATES));

/**
 * How much a refusal weighs.
 *
 * `fail` is a refusal the normative text calls a failure. `finding` is one it
 * calls a surfaced finding. Both refuse a run; see the note at the top of this
 * file for why the second is not a warning.
 *
 * @typedef {'fail' | 'finding'} Severity
 */

/**
 * One refusal.
 *
 * @typedef {object} Refusal
 * @property {string} predicate Which predicate refused — a member of `PREDICATES`.
 * @property {Severity} severity
 * @property {string} subject What it was looking at: a path, an arm, a field name.
 * @property {string} detail What it saw, and what it needed to see.
 */

/**
 * Build a refusal.
 *
 * Throws on a predicate name that is not on the roster, which is deliberate and
 * is the one place in this core that throws rather than answering. A refusal
 * carrying an unknown name is a refusal nothing can be asserted about — the
 * fixture corpus matches on these names, so a typo in one would be a fixture
 * that reddens for a reason nobody can hold, and a fixture nobody can hold is
 * indistinguishable from a fixture that never fired.
 *
 * @param {string} predicate
 * @param {Severity} severity
 * @param {string} subject
 * @param {string} detail
 * @returns {Refusal}
 */
export function refuse(predicate, severity, subject, detail) {
  if (!KNOWN.has(predicate)) {
    throw new Error(`release-check: ${predicate} is not a predicate this core knows`);
  }
  return Object.freeze({ predicate, severity, subject, detail });
}

/**
 * A refusal of severity `fail`.
 *
 * @param {string} predicate
 * @param {string} subject
 * @param {string} detail
 * @returns {Refusal}
 */
export function fail(predicate, subject, detail) {
  return refuse(predicate, 'fail', subject, detail);
}

/**
 * A refusal of severity `finding`.
 *
 * @param {string} predicate
 * @param {string} subject
 * @param {string} detail
 * @returns {Refusal}
 */
export function finding(predicate, subject, detail) {
  return refuse(predicate, 'finding', subject, detail);
}

/**
 * A refusal as one line.
 *
 * @param {Refusal} one
 * @returns {string}
 */
export function describe(one) {
  return `[${one.severity}] ${one.predicate} — ${one.subject}: ${one.detail}`;
}
