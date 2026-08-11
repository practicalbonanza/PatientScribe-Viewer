/**
 * Entry point.
 *
 * Five acts, in this order, before anything waits on anything and before a
 * single byte leaves the page. The order is the whole of what this file is for,
 * and each step is here rather than in the flow because each has to happen
 * before the next one can be observed to have happened.
 *
 * 1. The fragment is read off the address bar and held in a local. It carries
 *    the link capability, and everything after this reads it out of that local
 *    rather than out of the page.
 *
 * 2. The address bar is rewritten to the same page without it. The rewrite is
 *    attempted unconditionally — including when there was no fragment, and
 *    including when the fragment will turn out not to parse — because a scrub
 *    that only runs on the inputs it recognises is a scrub with an input-shaped
 *    hole in it.
 *
 *    Attempted, and not assumed. Rewriting the address is a privileged act and a
 *    browser is entitled to throw instead of performing it: a document whose
 *    origin is opaque has no address it is allowed to rewrite to, and an engine
 *    that caps how often a page may rewrite throws once that cap is reached. A
 *    document embedded inside an application's own browser can meet either. This
 *    file does not know which browsers a recipient will arrive in and does not
 *    claim the refusal is rare, so the throw is caught.
 *
 *    Caught, and nothing put in its place. There is no second way of clearing
 *    the address that does not either go somewhere else or send something, and
 *    both of those are worse than leaving it alone. What the catch buys is the
 *    three acts below it: without it the throw ends this function on its second
 *    statement, and a page whose handlers were never attached and whose root was
 *    never drawn into is a blank document — neither of the two surfaces this
 *    viewer has — that shows a recipient nothing and that nothing can afterwards
 *    empty. A refused rewrite leaves a narrower page than the one this file
 *    wanted. It does not leave a dead one.
 *
 *    What the rewrite buys, where it happens, is narrow and worth stating
 *    narrowly: the capability stops being in the address bar, so it is not in
 *    what a recipient copies, screenshots, or hands to someone helping them. It
 *    was never sent to a server — a fragment is not. It is still in the message
 *    the link arrived in, which is where it lives and has to be. And it is still
 *    in one place inside this document, which is worth naming rather than
 *    leaving to be found: the navigation timing entry records the address this
 *    page was loaded from, fragment and all, and keeps it for as long as the
 *    document is alive. Nothing the timing API offers clears that entry, in
 *    either engine. So this narrows where the capability can be read from. It
 *    does not take it out of the page.
 *
 *    And where the rewrite does not happen, none of that narrowing does either:
 *    the capability is still in the address this document was loaded with. What
 *    is unchanged is that it was still never sent to a server and is still
 *    nowhere it was not already. What is changed is that it is back in the one
 *    place the rewrite was for. Whether a recipient can read it off a bar there
 *    depends on the context that refused — an application that embeds a document
 *    without showing its address is not putting it in front of anyone, and a
 *    browser that is showing an address bar still is — and this file cannot tell
 *    which of the two it is in, so it claims neither.
 *
 * 3. The lifecycle handlers are attached, before anything can be drawn. A page
 *    can be put away at any moment, and the handler that empties it is no use if
 *    it was attached after the first thing appeared.
 *
 * 4. The viewer root is resolved, once, by the one id the page gives it.
 *
 * 5. The text that never changes is written into it, once, before any state is
 *    shown.
 *
 * Then the captured fragment is handed to the flow, and this file is finished.
 * Nothing else happens here: reading the link, talking to a server, deciding
 * what is on screen and writing it are each somewhere a reader can find all of
 * them at once, which is what keeps this a wiring point rather than the place
 * logic accumulates.
 */

import { onPageHide, onPageShow, start } from './flow.js';
import { renderChrome } from './render.js';

/** The id of the single element the viewer renders into. */
const ROOT_ID = 'viewer-root';

/**
 * Read the link, take it out of the address bar where the browser allows that,
 * and start either way.
 *
 * @returns {void}
 */
function boot() {
  const captured = location.hash;

  // The same page, without its fragment. Written from the parts the page was
  // loaded with rather than as a destination assembled here, so there is no
  // spelling of an origin in this file and nothing for a value to get into.
  try {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  } catch {
    // Refused, and that is the whole of what happens. Nothing is tried in its
    // place, and nothing below is skipped: everything after this is what puts a
    // surface on the screen and what makes the page emptiable, and a page that
    // is still carrying the fragment is the page that needs both of those most.
  }

  /** @type {HTMLElement | null} */
  let root = null;

  window.addEventListener('pagehide', () => {
    onPageHide(root);
  });
  window.addEventListener('pageshow', (event) => {
    onPageShow(root, event.persisted);
  });

  root = document.getElementById(ROOT_ID);
  if (root === null) {
    return;
  }

  renderChrome(root);
  start(root, captured);
}

boot();
