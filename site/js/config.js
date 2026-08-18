/**
 * Where this page is allowed to talk to.
 *
 * One table, keyed on the origin the page was loaded from, mapping to the
 * origin its two requests go to. The table and the function that reads it are
 * the whole of this module, and nothing else decides the destination: the two
 * requests in `flow.js` are built from whatever this answers, and it answers
 * nothing at all for an origin that is not a key.
 *
 * The table is exported, and the export is not for the page. Nothing in the
 * viewer imports it; `flow.js` asks the function. It is exported so that the
 * checks over this repository can read the table by EVALUATING it rather than by
 * reading these bytes as text — which sounds like a small difference and is not.
 * A reading of source is a claim about a program, and four separate classes of
 * decoy have now been shown to make that claim false while every check stayed
 * green: a conforming table written into a block comment above a live wrong one;
 * a constant declared right in a comment and wrong in code; the same with the
 * live declaration written as an identifier rather than a string; and a live
 * declaration hidden from a text reading by a comment between its own name and
 * its `=`. Each was closed after somebody found it. None of them can survive
 * being imported, because an engine does not read around comments or guess which
 * of two declarations is live — it evaluates the one that is.
 *
 * So the export is a surface for review to stand on, and the cost of it is worth
 * saying out loud: one more name leaves this module. It is a frozen object of
 * two entries, it is what the function already answers from, and nothing that
 * imports it can change it.
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
 * Two keys are committed here. The first is the origin the development server
 * and the browser suite run on — that origin answers for itself, and the suite
 * intercepts both requests rather than making them. The second is the hosted
 * development viewer, and it is the first entry whose two halves are different
 * origins: the page is served from one address and the share API answers at
 * another, so the key and the value are two spellings rather than one written
 * twice. Every other origin this viewer is ever served from is added here, one
 * key at a time, in a reviewed change: an entry in this table is a decision
 * about where share codes travel, and it should read as one in a diff.
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
 * The address a carer visits while this viewer is hosted for development.
 *
 * Written once and used as a key and nothing else, so this destination too
 * appears exactly once in the served tree. It is not a secret: it is the address
 * the link in a share goes to, which is to say the one thing about this viewer
 * every recipient of it already has.
 */
const HOSTED_DEVELOPMENT_ORIGIN = 'https://d30xbcndd2uqpg.cloudfront.net';

/**
 * The share API a page served from that address is allowed to talk to.
 *
 * This is the one spelling in this module that is written in two places rather
 * than one, and the second place is the policy in the entry document. The two
 * exist for different reasons and neither stands in for the other: this table
 * decides where a share code travels, and the policy decides what the browser
 * will permit to leave — so the policy has to name what the table decides, or
 * the request this table builds is refused before it is made. A policy that
 * named nothing here would be a viewer that cannot talk to its own API; a table
 * that named an origin the policy does not carry would be a viewer that asks for
 * a request the browser then throws away.
 *
 * Not a secret either, and less of one than the address above: it rides the
 * `connect-src` of the security policy on every response the hosting serves, so
 * it is already in the headers any recipient of this page can read.
 */
const HOSTED_DEVELOPMENT_API_ORIGIN = 'https://2kcwhm87v5.execute-api.ap-southeast-2.amazonaws.com';

/**
 * Origin served from, to origin talked to.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const API_ORIGINS = Object.freeze({
  [DEVELOPMENT_ORIGIN]: DEVELOPMENT_ORIGIN,
  [HOSTED_DEVELOPMENT_ORIGIN]: HOSTED_DEVELOPMENT_API_ORIGIN,
});

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
