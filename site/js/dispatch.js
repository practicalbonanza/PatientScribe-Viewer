/**
 * Version dispatch.
 *
 * One table, keyed on a document's declared schema version, mapping to the
 * handler that validates and renders that version. Everything not in the table
 * routes to the generic-unavailable surface.
 *
 * The point of the table is that adding a future version is an addition and
 * never a loosening: a new version gets its own entry, its own validator and its
 * own renderer, while every unknown version keeps hitting the same refusal it
 * hits today. There is no fallback handler, no "best effort" branch, and no path
 * by which an unrecognised version reaches a renderer.
 *
 * A `Map` is used rather than an object literal on purpose. Lookup keys come
 * from a document, so an object would answer for inherited property names —
 * `toString` and friends would resolve to a function and route as though they
 * were a known version. A `Map` answers only for keys actually put in it.
 *
 * The authenticated AAD travels alongside the document because it is the sole
 * display source for expiry and edited state, and this module is where the
 * `share_doc.edited === aad.edited` equality check lives — in the resolution
 * step for the version that requires it, which the handler for that version
 * calls. The document's own `edited` field is only what the plaintext claims;
 * the AAD's copy is covered by the content tag. Where the two disagree, the
 * document is not the document that was shared, and disagreement is a refusal
 * rather than a choice between them.
 *
 * Argument order is fixed across the chain — root, then AAD, then the document —
 * so a transposed call is visible on sight rather than only at the type level.
 *
 * Both exported functions are total. `dispatchDoc` in particular takes whatever
 * a document declared as its version — untrusted, and not necessarily a string —
 * and whatever the caller passed as a root; neither can make it throw.
 */

import { SHARE_DOC_V1, validateAadV1, validateShareDocV1 } from './validate.js';
import { renderShareDocV1, renderUnavailable } from './render.js';

/** @import { AadV1, ShareDocV1 } from './validate.js' */

/**
 * A handler for one document version: validate, then render or refuse.
 *
 * @typedef {(root: unknown, aad: unknown, value: unknown) => void} DocHandler
 */

/**
 * A refusal. One value, shared by every refusal in this module, so a caller has
 * one shape to handle and nothing to read off it.
 *
 * @type {{ ok: false }}
 */
const REFUSED = Object.freeze({ ok: false });

/**
 * Everything `share_doc_v1` requires before anything may be drawn, or nothing.
 *
 * @typedef {{ ok: true, aad: AadV1, doc: ShareDocV1 } | { ok: false }} ResolvedShareDocV1
 */

/**
 * Decide whether a `share_doc_v1` may be rendered.
 *
 * Separated from the handler because it is the whole of the decision and none of
 * the drawing: a value, computed from two inputs, with one failure shape. The
 * handler below adds nothing to it but the two calls that act on the answer.
 *
 * @param {unknown} aad The parsed AAD, unvalidated.
 * @param {unknown} value The document body, unvalidated.
 * @returns {ResolvedShareDocV1}
 */
export function resolveShareDocV1(aad, value) {
  const validatedAad = validateAadV1(aad);
  if (!validatedAad.ok) {
    return REFUSED;
  }

  const validatedDoc = validateShareDocV1(value);
  if (!validatedDoc.ok) {
    return REFUSED;
  }

  if (validatedDoc.doc.edited !== validatedAad.aad.edited) {
    return REFUSED;
  }

  return { ok: true, aad: validatedAad.aad, doc: validatedDoc.doc };
}

/**
 * Handler for `share_doc_v1`.
 *
 * @type {DocHandler}
 */
function handleShareDocV1(root, aad, value) {
  const resolved = resolveShareDocV1(aad, value);
  if (!resolved.ok) {
    renderUnavailable(root);
    return;
  }
  renderShareDocV1(root, resolved.aad, resolved.doc);
}

/**
 * The dispatch table. Every key is a document version this viewer can render.
 *
 * @type {ReadonlyMap<string, DocHandler>}
 */
const HANDLERS = new Map([[SHARE_DOC_V1, handleShareDocV1]]);

/**
 * Route a parsed document to the handler for its declared version.
 *
 * @param {unknown} root The viewer root element.
 * @param {unknown} docVersion The version the document declared.
 * @param {unknown} aad The authenticated AAD. Left `unknown` deliberately: its
 *   shape is fixed by the design and belongs to the handler that reads it, not
 *   to a guess made here.
 * @param {unknown} value The document body, unvalidated.
 * @returns {void}
 */
export function dispatchDoc(root, docVersion, aad, value) {
  // The string test is a type step, not a control, and it is worth being exact
  // about which. `Map.get` is typed to take a key of the map's key type, and a
  // declared version arrives as `unknown`; this is what narrows it. It stops
  // nothing on its own — `Map.get` answers `undefined` for a number, an object
  // or `null` just as readily, because a map answers only for keys actually put
  // in it. What refuses an unknown version is the table not holding it, and the
  // corpus shows that with versions that are not strings at all.
  const handler = typeof docVersion === 'string' ? HANDLERS.get(docVersion) : undefined;
  if (handler === undefined) {
    renderUnavailable(root);
    return;
  }
  handler(root, aad, value);
}
