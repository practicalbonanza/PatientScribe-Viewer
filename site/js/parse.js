/**
 * Parsing.
 *
 * This module must turn untrusted input into plain data structures and do
 * nothing else. It must never touch the DOM, never perform a network request,
 * and never decide what the viewer shows — validation belongs in `validate.js`,
 * routing in `dispatch.js`, and output in `render.js`. Keeping the three apart
 * is what lets the schema evolve without loosening the refusal path.
 *
 * Every function here must be total and must fail closed: unparseable input
 * returns `null`, which the caller turns into the single generic-unavailable
 * surface. There must be no second failure shape and no partial result.
 *
 * One handling pin, because a returned object cannot enforce it: `LinkParams`
 * carries the link capability, so the caller must extract that field into a
 * closure local immediately and must not retain, spread, or serialise the object
 * itself. A plain record is easy to log wholesale, copy into a payload, or hand
 * to something that stringifies it — none of which the shape can prevent, and
 * all of which are the caller's responsibility to avoid.
 *
 * Scaffold status: signatures and types only. The strict decoders — length
 * bounds applied before allocation, strict base64url with no padding and no
 * alphabet slack, rejection of trailing or duplicated parameters — land with the
 * implementation.
 */

/**
 * The parameters carried in a share link's fragment.
 *
 * All three are captured exactly as they appeared, still encoded: decoding and
 * range-checking belong to the implementation, not to the shape.
 *
 * @typedef {object} LinkParams
 * @property {string} v  Link format version.
 * @property {string} id Share identifier, base64url.
 * @property {string} a  Link capability, base64url. It must never be logged and
 *   must never be placed in the DOM. The caller must lift it into a closure
 *   local as soon as it has it, and must not retain, spread, or serialise the
 *   containing object.
 */

/**
 * A parsed document, reduced to the one field routing depends on plus its
 * still-unvalidated body.
 *
 * `value` is deliberately `unknown`: nothing may read a field off it until it
 * has been through the validator for its version.
 *
 * @typedef {object} ParsedDoc
 * @property {string} docVersion The document's self-declared schema version.
 * @property {unknown} value     The document body, unvalidated.
 */

/**
 * Parse a location fragment into link parameters.
 *
 * The fragment is hostile input: it arrives from a URL that may have been
 * edited, truncated, or synthesised. Anything the parser cannot account for in
 * full must be a refusal, never a best effort.
 *
 * @param {string} fragment The raw fragment, with or without its leading `#`.
 * @returns {LinkParams | null} The parameters, or `null` if the fragment is not
 *   exactly a well-formed link.
 */
export function parseLinkFragment(fragment) {
  void fragment;
  return null;
}

/**
 * Parse decrypted plaintext into a routable document.
 *
 * Called only on plaintext that has already authenticated. That makes this
 * parser's job narrow — read the declared version, keep the body untouched —
 * but not trusting: a document that authenticates can still be malformed, and
 * malformed must be a refusal.
 *
 * @param {string} plaintext The decrypted document text.
 * @returns {ParsedDoc | null} The parsed document, or `null` if it is not
 *   well-formed or does not declare a version.
 */
export function parseShareDoc(plaintext) {
  void plaintext;
  return null;
}
