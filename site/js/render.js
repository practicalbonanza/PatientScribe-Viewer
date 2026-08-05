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
 * A clear that does not happen is therefore not a step to carry on past. If the
 * root cannot be emptied, whatever is on it is still on it, and drawing over
 * that is the same failure as forgetting to clear — worst of all on the
 * unavailable path, where the viewer would believe it had replaced a decrypted
 * note with the generic surface while the note was still there. So `clearRoot`
 * reports whether the root is empty, and both functions below draw nothing when
 * it is not. That adds no failure shape anyone can see: a root that refuses to
 * be written into is a root nothing can be drawn on either way.
 *
 * That guard is the one thing in this module no observation of it can show,
 * because the surface drawn after a successful clear is, in this scaffold,
 * nothing at all — so removing the branch and keeping the call changes no
 * behaviour any input can reach. It is held in place by a reading of this file's
 * own text, in the fast suite, alongside the other claims about these bytes that
 * are true of the source rather than of any run.
 *
 * Argument order is fixed across the chain — root, then AAD, then the document —
 * so a transposed call is visible on sight rather than only at the type level.
 *
 * Every function here is total, like every other exported function in the
 * viewer. A root that is not an element to write into is a refusal — nothing is
 * drawn and nothing is thrown — because these are the last functions in every
 * path the viewer takes, including the failure paths, and a throw from the end
 * of a failure path is a second failure shape reached from the first.
 *
 * Scaffold status: signatures, plus the clear. Every visible string in this
 * viewer is a controlled surface fixed elsewhere; none of them are drafted here,
 * and none are invented at the keyboard.
 */

/** @import { AadV1, ShareDocV1 } from './validate.js' */

/**
 * Empty the root, and say whether it is now empty.
 *
 * The one DOM write in the viewer, so it is also the one place that write can be
 * refused — and the answer matters to both callers, because a root that was not
 * emptied is a root still showing whatever it was showing.
 *
 * The answer is read back from the root rather than inferred from the call. A
 * call that returns is not a clear: the returned answer used to be `true` for
 * anything whose `replaceChildren` did not throw, so a root that answered the
 * call and kept its children reported itself empty, both render functions passed
 * the guard, and each would have drawn over a note that was still on the page —
 * which is precisely the failure the guard exists for. `firstChild` is what a
 * node with no children answers `null` to, so asking it afterwards asks about
 * the root's state rather than about the call's.
 *
 * `false` covers four different situations and deliberately does not tell them
 * apart: the value is not something that can hold children, it has no way to
 * replace them, replacing them failed, or it is not empty afterwards. Nothing
 * above needs the difference, and every one of them means the same thing to a
 * caller — do not draw.
 *
 * Exported so that "it reports whether the root is empty" is a property
 * something can be asked about, which nothing else can ask: both callers do no
 * more than branch on it, and the branch they take is invisible from outside
 * this module for as long as the surface they draw after clearing is nothing.
 * Nothing outside this module may call it: clearing is each render function's
 * first act, and a caller that could clear is a caller that could clear and then
 * draw nothing, or draw without clearing.
 *
 * @param {unknown} root
 * @returns {boolean} Whether the root is empty.
 */
export function clearRoot(root) {
  if (typeof root !== 'object' || root === null) {
    return false;
  }

  try {
    const clear = /** @type {Record<string, unknown>} */ (root)['replaceChildren'];
    if (typeof clear !== 'function') {
      return false;
    }
    clear.call(root);
    return /** @type {Record<string, unknown>} */ (root)['firstChild'] === null;
  } catch {
    // Nothing to report and nowhere to report it. The refusal is silent by
    // design, as every refusal in the viewer is — but it is not silent to this
    // function's callers, who are told the root is not empty and must not draw
    // over what is still there.
    return false;
  }
}

/**
 * Render a validated document into the viewer root.
 *
 * Empties the root before writing anything, and writes nothing at all if it
 * could not: drawing a note over a root that still holds an earlier one is the
 * failure this ordering exists to prevent.
 *
 * @param {unknown} root The viewer root element.
 * @param {AadV1} aad The authenticated AAD — the sole display source for expiry
 *   and edited state. Validated, like the document: nothing reaches here that a
 *   validator has not already admitted.
 * @param {ShareDocV1} doc A document that has passed validation.
 * @returns {void}
 */
export function renderShareDocV1(root, aad, doc) {
  if (!clearRoot(root)) {
    return;
  }
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
 * That order is load-bearing here in a way it is nowhere else, and so is what
 * happens when the clear fails. The surface this draws is the one that says
 * nothing; drawing it over a root that still holds a decrypted note would leave
 * the note on screen while the viewer believed it had been replaced. So a failed
 * clear draws nothing, and the page keeps whatever it already had rather than
 * gaining a generic surface that would be a lie about what is underneath it.
 *
 * Every failure the viewer can reach must end in this function — no exceptions,
 * and no variants. That is a requirement on the paths that lead here and not yet
 * a fact about anything drawn: this function draws no surface, so what a
 * recipient sees today is whatever an emptied root looks like, and "the same
 * bytes in the same shape" is what that will be once there is a surface rather
 * than something these bytes currently do. The reason the requirement is written
 * down before the surface exists is that it is the surface's whole
 * specification: whatever went wrong, and at whatever depth, what is drawn must
 * be identical, because the difference between one failure and another is
 * exactly the thing a recipient must not be able to observe.
 *
 * Where the requirement stands today, written out rather than asserted, because
 * three refusals do not route here and one family of them has no route at all
 * yet.
 *
 * Routed: an unrecognised document version, which is every version not in the
 * dispatch table and every declared version that is not a string; a refusal from
 * either validator; and the disagreement between what the document says about
 * having been edited and what the authenticated data says. The last three arrive
 * as one refusal from the resolution step, and every null the validators get
 * back from the parsing helpers they use is inside one of them.
 *
 * Not routed, deliberately, in the two places a clear can fail. A render
 * function whose clear failed returns without drawing and does not call this,
 * because this would attempt the same clear on the same root and fail the same
 * way — a second failed write is not a surface. And this function's own failed
 * clear is where that stops. Both leave the page holding what it already held,
 * which is the outcome the guard is for.
 *
 * Not routed, because there is nothing to route to: the entry point returns when
 * the document has no viewer root in it. There is no element to draw on, so
 * there is no call to make.
 *
 * Scaffold residual: the refusals in the link parser and in the decryption
 * module are not on this list, and they are not exceptions to it — nothing in
 * the page's module graph calls them yet. The entry point does not read the link
 * or fetch anything, and the decryption module is not imported by anything the
 * page loads. When those paths are wired up, each of their refusals has to land
 * here, and until they are, "every refusal routes here" is a claim about the
 * refusals that have a caller.
 *
 * @param {unknown} root The viewer root element.
 * @returns {void}
 */
export function renderUnavailable(root) {
  if (!clearRoot(root)) {
    return;
  }
  // The surface is drawn from here. Scaffold: the clear is all there is so far,
  // and the guard above is what the drawing will sit behind when it arrives.
}
