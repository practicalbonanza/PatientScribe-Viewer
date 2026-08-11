/**
 * Where this page is allowed to talk to.
 *
 * One table, keyed on the origin the page was loaded from, mapping to the
 * origin its two requests go to. Nothing else is in this module, and nothing
 * else decides the destination: the two requests in `flow.js` are built from
 * whatever this answers, and it answers nothing at all for an origin that is not
 * a key.
 *
 * Exact match, and a table rather than a rule. A rule — a suffix, a pattern, a
 * derivation from the current origin — is a rule that answers for origins nobody
 * chose, and the origin is the whole of what decides where a share code is sent.
 * A page served from somewhere this table does not name makes no request at all,
 * which is a viewer that shows the one unavailable surface rather than a viewer
 * that sends a code somewhere.
 *
 * `Object.prototype.hasOwnProperty` rather than a property read, and a `null`
 * prototype would not be enough on its own: the key comes from the page's own
 * origin, and a lookup that answered for an inherited name would answer for
 * `toString` and friends. Asking for own properties is what makes the table the
 * allowlist it is described as.
 *
 * One key is committed here, and it is the origin the development server and the
 * browser suite run on — that origin answers for itself, and the suite
 * intercepts both requests rather than making them. Every other origin this
 * viewer is ever served from is added here, one key at a time, in a reviewed
 * change: an entry in this table is a decision about where share codes travel,
 * and it should read as one in a diff.
 */

/**
 * The origin the development server and the browser suite use.
 *
 * Written once and used as both the key and the value, so the spelling that
 * decides which pages may talk and the spelling of what they talk to cannot
 * drift apart — and so that this destination appears exactly once in the served
 * tree, which is what the scan that counts them expects.
 */
const DEVELOPMENT_ORIGIN = 'http://127.0.0.1:4173';

/**
 * Origin served from, to origin talked to.
 *
 * @type {Readonly<Record<string, string>>}
 */
const API_ORIGINS = Object.freeze({ [DEVELOPMENT_ORIGIN]: DEVELOPMENT_ORIGIN });

/**
 * Which origin a page served from `origin` may talk to, or nothing.
 *
 * Total, like every exported function in this viewer: anything that is not one
 * of the keys — including something that is not a string at all — is answered
 * with `null`, and a `null` answer is a submit that reaches the unavailable
 * surface without a request having been made.
 *
 * @param {unknown} origin The origin the page was served from.
 * @returns {string | null}
 */
export function apiOriginFor(origin) {
  if (typeof origin !== 'string') {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(API_ORIGINS, origin)) {
    return null;
  }
  const found = API_ORIGINS[origin];
  return typeof found === 'string' ? found : null;
}
