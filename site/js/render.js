/**
 * Rendering.
 *
 * The only module permitted to write to the DOM, and the narrowest one in the
 * viewer. It must write text into elements it creates itself. It must not accept
 * markup, must not build markup, must not linkify, must not construct a URL or a
 * style from anything a document carried, and must offer nothing to save or
 * print.
 *
 * It must also render only what a validator has already admitted. Rendering is
 * not a place where a decision gets made about whether input is acceptable — by
 * the time a document arrives here, that question is closed.
 *
 * Clearing the root is each render function's own first act, never the caller's.
 * A caller that is trusted to empty the root is a caller that can forget to, and
 * the failure mode of forgetting is the worst one available here: a previously
 * decrypted note still on screen underneath whatever is drawn next. Keeping the
 * clear inside these functions also keeps every DOM write in one module, which
 * is what makes that claim checkable rather than merely stated.
 *
 * Argument order is fixed across the chain — root, then AAD, then the document —
 * so a transposed call is visible on sight rather than only at the type level.
 *
 * Scaffold status: signatures, plus the clear. Every visible string in this
 * viewer is a controlled surface fixed elsewhere; none of them are drafted here,
 * and none are invented at the keyboard.
 */

/** @import { ShareDocV1 } from './validate.js' */

/**
 * Render a validated document into the viewer root.
 *
 * Empties the root before writing anything.
 *
 * @param {HTMLElement} root The viewer root element.
 * @param {unknown} aad The authenticated AAD — the sole display source for
 *   expiry and edited state. Left `unknown` at scaffold stage; the fields it
 *   carries arrive with the implementation that reads them.
 * @param {ShareDocV1} doc A document that has passed validation.
 * @returns {void}
 */
export function renderShareDocV1(root, aad, doc) {
  root.replaceChildren();
  void aad;
  void doc;
}

/**
 * Render the single generic-unavailable surface.
 *
 * Empties the root before writing anything, which is also what makes this the
 * safe landing point for a failure part-way through a render: whatever was on
 * screen goes, and the generic surface replaces it.
 *
 * Every failure the viewer can reach must end here — no exceptions, and no
 * variants. Whatever went wrong, and at whatever depth, the result on screen
 * must be the same bytes in the same shape, because the difference between one
 * failure and another is exactly the thing a recipient must not be able to
 * observe.
 *
 * @param {HTMLElement} root The viewer root element.
 * @returns {void}
 */
export function renderUnavailable(root) {
  root.replaceChildren();
}
