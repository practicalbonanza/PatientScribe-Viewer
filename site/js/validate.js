/**
 * Validation.
 *
 * Parsing asks "is this well-formed?". This module asks the stricter question:
 * "is this exactly a document of the version it claims to be?" Only a document
 * that passes may reach the renderer.
 *
 * The validator must be an allowlist, not a filter. It must admit the fields the
 * schema fixes and refuse a document carrying anything else — an unexpected
 * field must be a refusal, never something to ignore and render around. That is
 * what makes a later schema version safe to add: a new version gets a new
 * validator and a new dispatch entry, and this one must keep refusing everything
 * it does not recognise.
 *
 * Failure carries no detail. The result type is deliberately unable to express a
 * reason, because a reason would eventually reach a carer and become a second
 * observable failure shape.
 *
 * Scaffold status: the shape of the contract only. The field set is not pinned
 * here, and the implementation is the sole place allowed to admit a field.
 */

/**
 * The document version this module validates.
 *
 * Exported so routing and validation cannot drift apart: `dispatch.js` keys its
 * table on this same constant rather than repeating the string.
 *
 * `@satisfies` rather than `@type`: it checks the value without widening it, so
 * the constant keeps its literal type and everything derived from it stays tied
 * to this exact string. Changing the value fails the build here, at the pin,
 * rather than silently retyping the schema everywhere downstream.
 *
 * @satisfies {'share_doc_v1'}
 */
export const SHARE_DOC_V1 = 'share_doc_v1';

/**
 * A validated document.
 *
 * Only the version discriminator is pinned at scaffold stage. The remaining
 * fields are fixed by the schema and arrive with the validator that admits
 * them — writing a speculative field set here would put a second, unenforced
 * copy of the schema in the repository.
 *
 * @typedef {object} ShareDocV1
 * @property {typeof SHARE_DOC_V1} doc The schema discriminator, tied to the
 *   constant above so the two can never disagree.
 */

/**
 * The outcome of validation: a document, or nothing.
 *
 * @typedef {{ ok: true, doc: ShareDocV1 } | { ok: false }} ValidateResult
 */

/**
 * Validate an unvalidated document body against the fixed schema.
 *
 * @param {unknown} value The document body, straight from the parser.
 * @returns {ValidateResult} A validated document, or a bare failure carrying no
 *   detail about what was wrong.
 */
export function validateShareDocV1(value) {
  void value;
  return { ok: false };
}
