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
 * display source for expiry and edited state, and the version handler is where
 * the `share_doc.edited === aad.edited` equality check will live.
 *
 * Argument order is fixed across the chain — root, then AAD, then the document —
 * so a transposed call is visible on sight rather than only at the type level.
 */

import { SHARE_DOC_V1, validateShareDocV1 } from './validate.js';
import { renderShareDocV1, renderUnavailable } from './render.js';

/**
 * A handler for one document version: validate, then render or refuse.
 *
 * @typedef {(root: HTMLElement, aad: unknown, value: unknown) => void} DocHandler
 */

/**
 * Handler for `share_doc_v1`.
 *
 * @type {DocHandler}
 */
function handleShareDocV1(root, aad, value) {
  const result = validateShareDocV1(value);
  if (!result.ok) {
    renderUnavailable(root);
    return;
  }
  renderShareDocV1(root, aad, result.doc);
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
 * @param {HTMLElement} root The viewer root element.
 * @param {string} docVersion The version the document declared.
 * @param {unknown} aad The authenticated AAD. Left `unknown` deliberately: its
 *   shape is fixed by the design and belongs to the handler that reads it, not
 *   to a guess made here.
 * @param {unknown} value The document body, unvalidated.
 * @returns {void}
 */
export function dispatchDoc(root, docVersion, aad, value) {
  const handler = HANDLERS.get(docVersion);
  if (handler === undefined) {
    renderUnavailable(root);
    return;
  }
  handler(root, aad, value);
}
