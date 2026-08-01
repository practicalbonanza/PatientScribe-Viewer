/**
 * Entry point.
 *
 * The boot seam, and nothing more. It resolves the one element the viewer is
 * allowed to write into and stops there.
 *
 * The flow that will run from here is ordered by the implementation, not by this
 * file: read the link, then hand a parsed document to `dispatchDoc`. Each step
 * belongs to the module that owns it, so this file stays a wiring point rather
 * than becoming the place logic accumulates.
 *
 * Scaffold status: no behaviour. Nothing here reads the link, reaches the
 * network, or writes to the page.
 */

import { dispatchDoc } from './dispatch.js';

/** The id of the single element the viewer renders into. */
const ROOT_ID = 'viewer-root';

/**
 * Resolve the viewer root and hand over to the flow.
 *
 * @returns {void}
 */
function boot() {
  const root = document.getElementById(ROOT_ID);
  if (root === null) {
    return;
  }

  // The implementation continues from here and ends in a call of the form
  // dispatchDoc(root, docVersion, aad, value). Referenced so the seam is a real
  // import rather than a comment describing one.
  void dispatchDoc;
}

boot();
