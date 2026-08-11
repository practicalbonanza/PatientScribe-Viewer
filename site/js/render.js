/**
 * Rendering.
 *
 * The only module permitted to write to the DOM. Everything a recipient sees is
 * written from here, and the rules it writes under are narrow on purpose: text
 * into elements, and the `hidden` property to decide which of them are on
 * screen. It must not accept markup, must not build markup, must not linkify,
 * must not construct a URL or a style from anything a document carried, and must
 * offer nothing to save or print.
 *
 * The page is static. `index.html` carries every element of every state, with
 * the ones that are not the neutral base marked hidden, and this module reveals
 * and hides them and fills in their text. Nothing here creates an element that
 * carries a destination, and the two links that leave this page are written into
 * the page as attributes — their text comes from `copy.js` and their
 * destinations are never touched by any code at all. There is one place elements
 * are created, and it is the body of a decrypted note, where the number of
 * headings and lines is whatever the sender wrote.
 *
 * It renders only what a validator has already admitted. Rendering is not a
 * place where a decision gets made about whether input is acceptable — by the
 * time a document arrives here, that question is closed.
 *
 * Every function here is total. A root that is not this viewer's page is a
 * refusal — nothing is thrown — because these are the last functions in every
 * path the viewer takes, including the failure paths, and a throw from the end
 * of a failure path is a second failure shape reached from the first.
 *
 * What a refusal does with such a root is empty it, and that is a decision
 * rather than a formality. This viewer owns exactly one element and draws inside
 * it. If what it was handed is not the page it is built for, there is nothing to
 * reveal and nowhere to write — and whatever that element is holding is not
 * something this module can replace. Emptying it is the one act that is right in
 * every case: it leaves nothing on screen, including a note that had been
 * decrypted into that element a moment earlier.
 *
 * The same reasoning one level down is what the clear inside a real render is
 * for. Four functions here empty the body of a note before they change what is
 * on screen, and each of them draws nothing at all if it could not be emptied:
 * the code-entry surface, the line a code that did not match earns, the one
 * unavailable line, and a note. Drawing any of those over a body that still
 * holds an earlier note is the failure this ordering exists to prevent.
 * `clearRoot` reports whether the element is empty rather than whether the call
 * returned, because those are different questions and only the first one is the
 * one that matters.
 *
 * Three of those four are driven with that write replaced by something that
 * returns and empties nothing, which is what separates a clear that ran from a
 * clear that emptied nothing. The fourth is the code-entry surface, which is
 * drawn once, at boot, before there is anything in the page to hold back.
 *
 * Argument order is fixed across the chain — root, then AAD, then the document —
 * so a transposed call is visible on sight rather than only at the type level.
 */

import { COPY } from './copy.js';
import { formatDateTime } from './format.js';

/** @import { AadV1, ShareDocV1 } from './validate.js' */

/**
 * Every region of the page, by the selector that finds it.
 *
 * Literal selectors, written here, one per region. Nothing in this table is
 * built from anything a document carried, and nothing outside this table is ever
 * looked up: a selector assembled from a value would be a way for a document to
 * choose which element gets written into.
 *
 * The page is resolved from the viewer root rather than from the document, and
 * that is what keeps the entry point's single lookup single. It also means a
 * page missing any one of these is not this viewer's page, which is the answer
 * `readPage` gives.
 *
 * @type {Readonly<Record<string, string>>}
 */
const SELECTORS = Object.freeze({
  brand: '#brand',
  advisory: '#advisory',
  advisoryLead: '#advisory-lead',
  advisoryEmphasis: '#advisory-emphasis',
  advisoryTail: '#advisory-tail',
  shell: '#shell',
  shellIntro: '#shell-intro',
  codeHelper: '#code-helper',
  codeLabel: '#code-label',
  codeInput: '#code-input',
  codeSubmit: '#code-submit',
  wrongCode: '#wrong-code',
  unavailable: '#unavailable',
  note: '#note',
  banner: '#banner',
  youChip: '#you-chip',
  editedChip: '#edited-chip',
  visitDate: '#visit-date',
  topic: '#topic',
  noteBody: '#note-body',
  expiry: '#expiry',
  appLink: '#app-link',
  footer: '#footer',
  noticeSummary: '#notice-summary',
  noticeLead: '#notice-lead',
  policyLink: '#policy-link',
  noticeTail: '#notice-tail',
  report: '#report',
});

/**
 * The page, once every region has been found.
 *
 * @typedef {object} Page
 * @property {HTMLElement} brand
 * @property {HTMLElement} advisory
 * @property {HTMLElement} advisoryLead
 * @property {HTMLElement} advisoryEmphasis
 * @property {HTMLElement} advisoryTail
 * @property {HTMLElement} shell
 * @property {HTMLElement} shellIntro
 * @property {HTMLElement} codeHelper
 * @property {HTMLElement} codeLabel
 * @property {HTMLInputElement} codeInput
 * @property {HTMLButtonElement} codeSubmit
 * @property {HTMLElement} wrongCode
 * @property {HTMLElement} unavailable
 * @property {HTMLElement} note
 * @property {HTMLElement} banner
 * @property {HTMLElement} youChip
 * @property {HTMLElement} editedChip
 * @property {HTMLElement} visitDate
 * @property {HTMLElement} topic
 * @property {HTMLElement} noteBody
 * @property {HTMLElement} expiry
 * @property {HTMLElement} appLink
 * @property {HTMLElement} footer
 * @property {HTMLElement} noticeSummary
 * @property {HTMLElement} noticeLead
 * @property {HTMLElement} policyLink
 * @property {HTMLElement} noticeTail
 * @property {HTMLButtonElement} report
 */

/**
 * Empty an element, and say whether it is now empty.
 *
 * The answer is read back from the element rather than inferred from the call. A
 * call that returns is not a clear: the returned answer used to be `true` for
 * anything whose `replaceChildren` did not throw, so an element that answered
 * the call and kept its children reported itself empty, and whatever was drawn
 * next was drawn over content that was still there. `firstChild` is what a node
 * with no children answers `null` to, so asking it afterwards asks about the
 * element's state rather than about the call's.
 *
 * `false` covers four different situations and deliberately does not tell them
 * apart: the value is not something that can hold children, it has no way to
 * replace them, replacing them failed, or it is not empty afterwards. Nothing
 * above needs the difference, and every one of them means the same thing to a
 * caller — do not draw.
 *
 * Exported so that "it reports whether the element is empty" is a property
 * something can be asked about directly, over values a page cannot contain: a
 * node that answers a call and keeps its children, one that has no way to say
 * what its first child is, one whose write is not callable at all. Nothing
 * outside this module may call it.
 *
 * @param {unknown} node
 * @returns {boolean} Whether the element is empty.
 */
export function clearRoot(node) {
  if (typeof node !== 'object' || node === null) {
    return false;
  }

  try {
    const clear = /** @type {Record<string, unknown>} */ (node)['replaceChildren'];
    if (typeof clear !== 'function') {
      return false;
    }
    clear.call(node);
    return /** @type {Record<string, unknown>} */ (node)['firstChild'] === null;
  } catch {
    // Nothing to report and nowhere to report it. The refusal is silent by
    // design, as every refusal in the viewer is — but it is not silent to this
    // function's callers, who are told the element is not empty and must not
    // draw over what is still there.
    return false;
  }
}

/**
 * Find every region of the page, or refuse.
 *
 * Whole or nothing: a page missing one region is not a page this module can
 * drive, and half a surface is worse than none. The two regions whose type
 * matters beyond being an element are checked for the property that makes them
 * that type — a field has a string value, a control has a boolean disabled state
 * — so the shapes this module goes on to use are shapes it has looked at.
 *
 * Guarded throughout, because the value handed in is whatever a caller passed
 * and a hostile one can throw when it is looked at.
 *
 * @param {unknown} root
 * @returns {Page | null}
 */
export function readPage(root) {
  if (typeof root !== 'object' || root === null) {
    return null;
  }

  try {
    const query = /** @type {Record<string, unknown>} */ (root)['querySelector'];
    if (typeof query !== 'function') {
      return null;
    }

    /** @type {Record<string, unknown>} */
    const found = {};
    for (const [name, selector] of Object.entries(SELECTORS)) {
      const element = query.call(root, selector);
      if (typeof element !== 'object' || element === null) {
        return null;
      }
      const fields = /** @type {Record<string, unknown>} */ (element);
      if (typeof fields['hidden'] !== 'boolean') {
        return null;
      }
      found[name] = element;
    }

    if (typeof /** @type {Record<string, unknown>} */ (found['codeInput'])['value'] !== 'string') {
      return null;
    }
    for (const name of ['codeSubmit', 'report']) {
      if (typeof /** @type {Record<string, unknown>} */ (found[name])['disabled'] !== 'boolean') {
        return null;
      }
    }

    return /** @type {Page} */ (/** @type {unknown} */ (found));
  } catch {
    return null;
  }
}

/**
 * Empty the body of a note and blank every line around it.
 *
 * Hiding the note would take it off the screen and leave it in the page, where
 * it is still text a recipient's own browser is holding after the viewer says
 * there is nothing to show. So leaving the decrypted state empties the body and
 * writes every one of its lines back to nothing.
 *
 * Reports whether the body could be emptied, and a caller that is told it could
 * not draws nothing: a body that still holds a note is a body a later surface
 * would be sitting on top of.
 *
 * @param {Page} page
 * @returns {boolean}
 */
function blankNote(page) {
  if (!clearRoot(page.noteBody)) {
    return false;
  }
  page.banner.textContent = '';
  page.youChip.textContent = '';
  page.youChip.hidden = true;
  page.editedChip.textContent = '';
  page.editedChip.hidden = true;
  page.visitDate.textContent = '';
  page.topic.textContent = '';
  page.expiry.textContent = '';
  return true;
}

/**
 * Write the text that never changes.
 *
 * Once, at boot, before any state is shown. The alternative — writing it again
 * on every transition — would mean either re-deriving text that has not changed
 * or rebuilding the two paragraphs that have a link inside them, and rebuilding
 * those means removing and replacing an anchor whose destination is written in
 * the page. The destinations are the one thing no code here touches, so the
 * anchors stay exactly where they were put and only their text is written.
 *
 * @param {unknown} root
 * @returns {void}
 */
export function renderChrome(root) {
  const page = readPage(root);
  if (page === null) {
    return;
  }

  page.brand.textContent = COPY.brand;
  page.shellIntro.textContent = COPY.shellIntro;
  page.codeHelper.textContent = COPY.codeHelper;
  page.codeLabel.textContent = COPY.codeLabel;
  page.codeSubmit.textContent = COPY.codeSubmit;
  page.wrongCode.textContent = COPY.wrongCode;
  page.unavailable.textContent = COPY.unavailable;
  page.appLink.textContent = COPY.appBanner;
  page.report.textContent = COPY.reportControl;

  page.advisoryLead.textContent = COPY.advisoryLead;
  page.advisoryEmphasis.textContent = COPY.advisoryEmphasis;
  page.advisoryTail.textContent = COPY.advisoryTail;

  page.noticeSummary.textContent = COPY.noticeSummary;
  page.noticeLead.textContent = COPY.noticeLead;
  page.policyLink.textContent = COPY.policyLinkText;
  page.noticeTail.textContent = COPY.noticeTail;
}

/**
 * The code-entry surface.
 *
 * @param {unknown} root
 * @returns {void}
 */
export function renderShell(root) {
  const page = readPage(root);
  if (page === null) {
    clearRoot(root);
    return;
  }
  if (!blankNote(page)) {
    return;
  }

  page.note.hidden = true;
  page.unavailable.hidden = true;
  page.wrongCode.hidden = true;
  page.shell.hidden = false;
  page.footer.hidden = false;
  page.report.hidden = false;
}

/**
 * The advice about this browser, added to the shell that is already on screen.
 *
 * Advice and not a state: it appears beside the code field rather than in place
 * of it, and nothing about the field changes.
 *
 * @param {unknown} root
 * @returns {void}
 */
export function showAdvisory(root) {
  const page = readPage(root);
  if (page === null) {
    return;
  }
  page.advisory.hidden = false;
}

/**
 * The shell, plus the one line a code that did not match earns.
 *
 * One line, and nothing else changes: the field keeps what a recipient typed and
 * stays usable. There is no attempt count here because there is nowhere for one
 * to go — what it would tell a recipient it would tell anyone holding the link.
 *
 * @param {unknown} root
 * @returns {void}
 */
export function renderWrongCode(root) {
  const page = readPage(root);
  if (page === null) {
    clearRoot(root);
    return;
  }
  if (!blankNote(page)) {
    return;
  }

  page.note.hidden = true;
  page.unavailable.hidden = true;
  page.shell.hidden = false;
  page.wrongCode.hidden = false;
  page.footer.hidden = false;
  page.report.hidden = false;
}

/**
 * The single generic-unavailable surface.
 *
 * Every failure the viewer can reach ends here, and they all draw the same
 * bytes: a network that did not answer, a status that was not a success, a body
 * that did not parse, a blob that did not authenticate, an identifier that did
 * not match, a document that did not validate, and a browser that refused to do
 * the work at all. The difference between one of those and another is exactly
 * what a recipient must not be able to read off the page.
 *
 * There is one sanctioned difference, and it is not about the failure. Reporting
 * a link means naming it, and a link whose fragment never parsed has no name to
 * send — so a caller that has no identifier says so and the control is not
 * there. Nothing else varies about what is drawn.
 *
 * The code field is emptied on the way in. Nothing on this surface asks for a
 * code and nothing reachable from it will send one, so a code a recipient typed
 * has no reason to still be sitting in a control on the page. It happens after
 * the note has been blanked, so a surface that could not be blanked does not
 * reach it either.
 *
 * @param {unknown} root
 * @param {boolean} [showReport] `false` where there is no identifier to report:
 *   a fragment that never parsed, and a page restored out of the cache, which
 *   has dropped the one it did parse. Absent everywhere else, including from the
 *   version dispatcher, which reaches this only after a fragment has parsed.
 * @returns {void}
 */
export function renderUnavailable(root, showReport) {
  const page = readPage(root);
  if (page === null) {
    clearRoot(root);
    return;
  }
  if (!blankNote(page)) {
    return;
  }
  page.codeInput.value = '';

  page.advisory.hidden = true;
  page.shell.hidden = true;
  page.wrongCode.hidden = true;
  page.note.hidden = true;
  page.unavailable.hidden = false;
  page.footer.hidden = false;
  page.report.hidden = showReport === false;
}

/**
 * Draw a document's sections into the body of the note.
 *
 * Elements this module creates, text this module writes, and nothing else. A
 * heading and its lines are the document's own strings put into a heading and a
 * list — never parsed, never linkified, never given a destination or a style.
 *
 * A section with no lines is a heading with no list under it, which is what a
 * document carrying one says.
 *
 * @param {HTMLElement} body
 * @param {readonly { heading: string, lines: readonly string[] }[]} sections
 * @returns {void}
 */
function drawSections(body, sections) {
  const owner = body.ownerDocument;
  for (const section of sections) {
    const heading = owner.createElement('h2');
    heading.textContent = section.heading;
    body.append(heading);

    if (section.lines.length === 0) {
      continue;
    }
    const list = owner.createElement('ul');
    for (const line of section.lines) {
      const item = owner.createElement('li');
      item.textContent = line;
      list.append(item);
    }
    body.append(list);
  }
}

/**
 * Render a validated document.
 *
 * The banner is the document's own wording, rendered as it arrived. There is no
 * banner text in this viewer to compare it against and none to fall back to: the
 * sender said it, and what a recipient reads is what the sender said.
 *
 * Expiry and edited state are read from the authenticated data and from nowhere
 * else, which is what makes there one spelling of each rather than two that
 * could disagree.
 *
 * The body is emptied before anything is written into it, and nothing is written
 * if it could not be emptied. Every section this function reveals or hides is
 * revealed or hidden after all of the writing is done, so a document it could
 * not finish drawing is a document that never appears.
 *
 * The code field is emptied here too, once the note is written and before any of
 * it is on screen. A recipient holding their note has no further use for what
 * they typed, and a code left in a control is a code still on the page. It sits
 * below the guard on the clear, so a render that drew nothing does not empty it
 * either.
 *
 * @param {unknown} root The viewer root element.
 * @param {AadV1} aad The authenticated AAD — the sole display source for expiry
 *   and edited state. Validated, like the document: nothing reaches here that a
 *   validator has not already admitted.
 * @param {ShareDocV1} doc A document that has passed validation.
 * @returns {void}
 */
export function renderShareDocV1(root, aad, doc) {
  const page = readPage(root);
  if (page === null) {
    clearRoot(root);
    return;
  }
  if (!isRenderable(aad, doc)) {
    // Unreachable from the viewer, and total anyway. Everything that calls this
    // has been through both validators; what this refuses is a caller that has
    // not, and refusing is the one answer that cannot become an exception thrown
    // from the end of a path.
    return;
  }
  if (!clearRoot(page.noteBody)) {
    return;
  }

  page.banner.textContent = doc.banner_text;

  const named = doc.you_means.length > 0;
  page.youChip.textContent = named ? `${COPY.youChipLead}${doc.you_means}` : '';
  page.youChip.hidden = !named;

  page.editedChip.textContent = !aad.edited
    ? ''
    : named
      ? `${COPY.editedChipLead}${doc.you_means}`
      : COPY.editedChipNameless;
  page.editedChip.hidden = !aad.edited;

  page.visitDate.textContent = doc.visit_date;
  page.topic.textContent = doc.topic;

  drawSections(page.noteBody, doc.sections);

  page.expiry.textContent = `${COPY.expiryLead}${formatDateTime(aad.exp)}`;
  page.codeInput.value = '';

  page.advisory.hidden = true;
  page.shell.hidden = true;
  page.wrongCode.hidden = true;
  page.unavailable.hidden = true;
  page.note.hidden = false;
  page.footer.hidden = false;
  page.report.hidden = false;
}

/**
 * Are these the shapes this module writes from?
 *
 * A reading of the two values rather than a validation of them: validation
 * happened upstream, and this is what makes the function above total for a
 * caller that skipped it.
 *
 * @param {unknown} aad
 * @param {unknown} doc
 * @returns {boolean}
 */
function isRenderable(aad, doc) {
  if (typeof aad !== 'object' || aad === null || typeof doc !== 'object' || doc === null) {
    return false;
  }
  const authenticated = /** @type {Record<string, unknown>} */ (aad);
  const fields = /** @type {Record<string, unknown>} */ (doc);
  if (typeof authenticated['edited'] !== 'boolean' || typeof authenticated['exp'] !== 'number') {
    return false;
  }
  for (const field of ['banner_text', 'you_means', 'visit_date', 'topic']) {
    if (typeof fields[field] !== 'string') {
      return false;
    }
  }
  const sections = fields['sections'];
  if (!Array.isArray(sections)) {
    return false;
  }
  for (const section of sections) {
    if (typeof section !== 'object' || section === null) {
      return false;
    }
    const one = /** @type {Record<string, unknown>} */ (section);
    if (typeof one['heading'] !== 'string' || !Array.isArray(one['lines'])) {
      return false;
    }
    for (const line of one['lines']) {
      if (typeof line !== 'string') {
        return false;
      }
    }
  }
  return true;
}

/**
 * Take everything off the page and empty what a note was drawn into.
 *
 * The act the viewer performs when the page is being put away: every surface
 * hidden, the code field's value gone, and the note's body emptied and its lines
 * written back to nothing.
 *
 * That last part is the one with a condition on it, and the condition is not
 * checked here. Emptying the body reports whether the body is empty afterwards,
 * and the answer is read by every other caller because every other caller was
 * about to draw something; this one is not. Everything it does takes something
 * off the screen, so on a page whose own write refused, carrying on hides the
 * note rather than drawing over it — and what is left is a hidden section still
 * holding the text that was in it. Stopping instead would leave that same text
 * on the screen, which is worse, and there is nowhere here to report the
 * difference to.
 *
 * @param {unknown} root
 * @returns {void}
 */
export function blankSurface(root) {
  const page = readPage(root);
  if (page === null) {
    clearRoot(root);
    return;
  }

  blankNote(page);
  page.advisory.hidden = true;
  page.shell.hidden = true;
  page.wrongCode.hidden = true;
  page.note.hidden = true;
  page.unavailable.hidden = true;
  page.footer.hidden = true;
  page.codeInput.value = '';
}

/**
 * What a recipient typed.
 *
 * A read rather than a write, and here rather than in the flow because the shape
 * of the page belongs to this module: a caller that reached into the page for
 * the field would be a second module that knows where things are.
 *
 * @param {unknown} root
 * @returns {string} The value of the field, or the empty string when there is no
 *   field to read.
 */
export function readCode(root) {
  const page = readPage(root);
  return page === null ? '' : page.codeInput.value;
}

/**
 * Set whether the submit control can be pressed.
 *
 * The caller decides, and it decides from whether a request is in flight rather
 * than from whether another attempt is possible: the control comes back the
 * moment an answer arrives, including on the answers that end the shell, where
 * what comes back is a control inside a section about to be hidden. What refuses
 * a second attempt is the state machine above this, not the page.
 *
 * No new words either way: a control that cannot be pressed says what it needs
 * to say by not being pressable, and a line of status text would be a surface
 * with two spellings.
 *
 * @param {unknown} root
 * @param {boolean} busy
 * @returns {void}
 */
export function setSubmitBusy(root, busy) {
  const page = readPage(root);
  if (page === null) {
    return;
  }
  page.codeSubmit.disabled = busy === true;
}

/**
 * Disable the report control, which happens the moment it is used.
 *
 * Once and not again: the request is sent without waiting for an answer, so
 * there is no outcome to report back and nothing a second press could add.
 *
 * @param {unknown} root
 * @returns {void}
 */
export function setReportUsed(root) {
  const page = readPage(root);
  if (page === null) {
    return;
  }
  page.report.disabled = true;
}

/**
 * The two controls a recipient can operate, handed to the caller that knows what
 * to do when they are.
 *
 * Listeners are attached here because attaching one is a write to the page, and
 * every write to the page is in this module. What the listener does is not: the
 * two functions passed in belong to the flow.
 *
 * @param {unknown} root
 * @param {() => void} onSubmit
 * @param {() => void} onReport
 * @returns {void}
 */
export function wireControls(root, onSubmit, onReport) {
  const page = readPage(root);
  if (page === null) {
    return;
  }
  page.codeSubmit.addEventListener('click', () => {
    onSubmit();
  });
  page.codeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSubmit();
    }
  });
  page.report.addEventListener('click', () => {
    onReport();
  });
}
