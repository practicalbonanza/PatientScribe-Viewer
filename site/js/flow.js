/**
 * The flow.
 *
 * What happens between a link arriving and a note being on screen, and the only
 * module in this viewer that talks to a server. Two requests exist: one that
 * asks for a share, and one that reports a link. There are no others, and a
 * check on the served tree refuses the name of a request anywhere else under
 * `site/`.
 *
 * The order of the first few steps is load-bearing and is set out in `main.js`,
 * which performs them before anything here is called. What this module is handed
 * is the fragment as a string, already taken off the address bar.
 *
 * From there:
 *
 *   - The fragment is parsed. A fragment that is not exactly a link goes to the
 *     unavailable surface, and that surface carries no report control, because
 *     reporting a link means naming it and there is no name.
 *   - The parsed parameters are held. The link capability is not taken out of
 *     them: it stays inside the accessor the parser returned until the moment a
 *     share has arrived and is about to be decrypted, and the bytes it hands
 *     over are zeroed as soon as the decryption returns.
 *   - A probe runs, on constants of this viewer's own, to find out whether this
 *     browser can do the work at all. It never touches a recipient's share, and
 *     what it produces is advice rather than a block.
 *   - A code is typed and sent. What comes back is classified into exactly three
 *     outcomes, and two of them are the same surface.
 *
 * The classification is a pure function and so is the identifier comparison, so
 * both can be put to a corpus over inputs no server would ever send. What is not
 * pure is everything that follows from them, and that is the point of the split:
 * the decisions are values, and the acts are somewhere a reader can see all of
 * them at once.
 *
 * Failure collapses. A wrong code is the one outcome with a line of its own, and
 * everything else — a request that did not arrive, a status that was not a
 * success, a body that was not a record, a tag that did not verify, an
 * identifier that did not match, a document that did not validate — draws the
 * same bytes. A recipient inspecting their own browser can of course see more
 * than the page shows them; they are holding the response. What the page does
 * not do is tell them apart on the screen, and nothing here is built or claimed
 * about how long any of it took.
 */

import { apiOriginFor } from './config.js';
import { checkCapability } from './capability.js';
import { decryptShare } from './crypto.js';
import { encodeBase64url } from './format.js';
import { dispatchDoc } from './dispatch.js';
import { isRecord, parseAad, parseLinkFragment, parseShareDoc, readOwnFields } from './parse.js';
import { validateAadV1 } from './validate.js';
import {
  blankSurface,
  readCode,
  renderShell,
  renderUnavailable,
  renderWrongCode,
  setReportUsed,
  setSubmitBusy,
  showAdvisory,
  wireControls,
} from './render.js';

/** @import { LinkParams } from './parse.js' */

/** The path a share is asked for at. */
const OPEN_PATH = '/share/open';

/** The path a link is reported at. */
const REPORT_PATH = '/share/report';

/** What a body has to say, and be nothing but, for a code to have been wrong. */
const WRONG_CODE_STATUS = 'wrong_code';

/**
 * The three outcomes a response can have.
 *
 * Three and not more: the shapes a server can send are many, and the outcomes
 * are these. Anything that is not a share to decrypt and not exactly a
 * wrong-code answer is the one surface that says nothing.
 */
export const UNAVAILABLE = 'unavailable';
export const WRONG_CODE = 'wrong-code';
export const DECRYPT = 'decrypt';

/**
 * The states the code-entry surface moves through.
 *
 * `ready` is a field a recipient can type in and a control they can press.
 * `sending` is a request in flight. `settled` is a surface that is not the shell
 * any more — a note, or the one unavailable line — and nothing moves out of it.
 *
 * What refuses a second press is the state and not the control: a press arriving
 * in any state but `ready` is dropped where the submit begins. The control's
 * disabled state follows the request rather than the state, and comes back the
 * moment an answer arrives — which on the path to a note is before the note is
 * drawn, and on the path to the generic surface is before that line is. So it is
 * what a recipient sees rather than what holds this.
 */
export const READY = 'ready';
export const SENDING = 'sending';
export const SETTLED = 'settled';

/**
 * Where a state goes next.
 *
 * A total function of the state and what happened, written out rather than left
 * as conditions spread through the acts below, because the one property worth
 * holding is that a second press while a request is in flight changes nothing.
 * Every pair this does not name leaves a state that is a string where it was,
 * and answers `settled` for anything that is not one: a value that was never a
 * state is not a state to be left in.
 *
 * @param {unknown} state
 * @param {unknown} event
 * @returns {string}
 */
export function nextSubmitState(state, event) {
  if (state === READY && event === 'submit') {
    return SENDING;
  }
  if (state === SENDING && event === WRONG_CODE) {
    return READY;
  }
  if (state === SENDING && (event === DECRYPT || event === UNAVAILABLE)) {
    return SETTLED;
  }
  return typeof state === 'string' ? state : SETTLED;
}

/**
 * Which of the three outcomes a response is.
 *
 * `ok` is whether the status was a success, and `body` is whatever the body
 * parsed to — including nothing, for a body that did not parse at all.
 *
 * The wrong-code answer is recognised by its whole shape rather than by a field
 * read off it. A body carrying `status` and anything else is not the answer this
 * viewer knows; a body carrying `status` inherited, or as a getter, is not one
 * either. That matters because this is the one outcome with a surface of its
 * own: everything that is not exactly this answer has to collapse, and a loose
 * reading here would be a way to reach a distinguishable surface from a shape
 * nobody agreed to.
 *
 * @param {unknown} ok Whether the response reported success.
 * @param {unknown} body The parsed body, or `null`.
 * @returns {string} One of the three outcomes.
 */
export function classifyOpen(ok, body) {
  if (ok !== true || !isRecord(body)) {
    return UNAVAILABLE;
  }
  const fields = readOwnFields(body, ['status']);
  if (fields !== null && fields[0] === WRONG_CODE_STATUS) {
    return WRONG_CODE;
  }
  return DECRYPT;
}

/**
 * Is the identifier the link carried the identifier the share was sealed for?
 *
 * Made after the tag has verified and never before it, because before that the
 * authenticated data is a string an attacker chose. Made on the encoded
 * spelling, which is the form the authenticated data carries and the form the
 * fragment's bytes are brought to — one canonical spelling per value, so two
 * identifiers agree only when they are the same bytes.
 *
 * A comparison of strings and not of bytes decoded again, deliberately. Decoding
 * the authenticated data's identifier a second time would mean comparing through
 * a decoder, and a decoder that accepted a second spelling of the same bytes
 * would make two different identifiers agree.
 *
 * @param {unknown} fromLink The identifier the link carried, encoded.
 * @param {unknown} fromShare The identifier inside the authenticated data.
 * @returns {boolean}
 */
export function idMatches(fromLink, fromShare) {
  return typeof fromLink === 'string' && fromLink.length > 0 && fromLink === fromShare;
}

/**
 * One string, as a JSON string literal.
 *
 * The viewer builds exactly two request bodies and this is what puts a value
 * into one. It is not a serialiser and cannot become one: it takes a string and
 * produces a quoted string, and the two bodies below are the only two shapes
 * written from it.
 *
 * That distinction is worth being exact about, because this viewer's whole
 * discipline about authenticated data is that it is never rebuilt. It is not
 * rebuilt here either. The authenticated data never reaches this function, never
 * leaves this page, and is handed back to the caller as the string that arrived;
 * what this writes is an identifier and a code a recipient typed, on the way out
 * to a server that is going to compare them.
 *
 * Everything outside printable ASCII is written as an escape, which is more than
 * the format requires and is what makes the result well-formed for every string
 * there is: a code carrying a lone surrogate would otherwise reach the wire as
 * bytes that are not the code, and a code carrying a control character would
 * reach it as text no reader parses.
 *
 * @param {string} text
 * @returns {string}
 */
function jsonText(text) {
  let out = '"';
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    const character = text[index] ?? '';
    if (character === '"' || character === '\\') {
      out += `\\${character}`;
    } else if (unit < 0x20 || unit > 0x7e) {
      out += `\\u${unit.toString(16).padStart(4, '0')}`;
    } else {
      out += character;
    }
  }
  return `${out}"`;
}

/**
 * The body of the request that asks for a share.
 *
 * The code exactly as it was typed. Trimming it, folding its case, or stripping
 * anything out of it would be this page deciding what a code is, and the server
 * is the side that decides that — a viewer that normalised would be a second
 * opinion about which codes match.
 *
 * @param {string} id The identifier, encoded.
 * @param {string} code
 * @returns {string}
 */
export function openRequestBody(id, code) {
  return `{"id":${jsonText(id)},"code":${jsonText(code)}}`;
}

/**
 * The body of the request that reports a link.
 *
 * The identifier and nothing else. Not the code, not the fragment, not a word
 * about what the recipient saw: a report says which link, and the rest is
 * something a person can be asked for through a channel that is not this page.
 *
 * @param {string} id The identifier, encoded.
 * @returns {string}
 */
export function reportRequestBody(id) {
  return `{"id":${jsonText(id)}}`;
}

/**
 * The lifecycle counter.
 *
 * Every request this module makes is followed by work that writes to the page,
 * and between the two the page can be put away — hidden into the back/forward
 * cache, or restored out of it. A continuation that ran after that would be
 * writing a note onto a page whose state was thrown away, so each one carries
 * the count it started under and does nothing at all if the count has moved.
 */
let epoch = 0;

/**
 * The parsed link, for as long as this page is the page that was opened.
 *
 * The capability is not in it: it stays inside the accessor the parser returned,
 * and is taken out once, at the moment a share is about to be decrypted.
 *
 * @type {LinkParams | null}
 */
let held = null;

/** Where the code-entry surface is. */
let state = READY;

/**
 * Start.
 *
 * @param {unknown} root The viewer root.
 * @param {unknown} fragment The fragment, as it was captured before the scrub.
 * @returns {void}
 */
export function start(root, fragment) {
  const params = parseLinkFragment(fragment);
  if (params === null) {
    // Nothing parsed, so there is no identifier, so there is nothing to report.
    renderUnavailable(root, false);
    return;
  }

  held = params;
  state = READY;
  renderShell(root);
  wireControls(
    root,
    () => {
      void submit(root);
    },
    () => {
      report(root);
    },
  );

  const started = epoch;
  void checkCapability().then(
    (able) => {
      // The advice belongs to the code-entry surface and to nothing else. This
      // probe starts here and answers whenever the browser gets to it, which can
      // be after a code has been sent and the shell has been replaced by a note
      // or by the one line that says nothing. The counter above does not move on
      // that path — it is about the page being put away, and the page has not
      // been — so without this the advice would be written onto a surface that
      // is finished, and one of those surfaces is the one every failure has to
      // draw identically. A code that did not match comes back to the shell, and
      // a late answer there is still advice worth giving.
      if (started !== epoch || state !== READY || able) {
        return;
      }
      showAdvisory(root);
    },
    () => {
      // The probe answers rather than rejects, so nothing arrives here. It is
      // written because an unhandled rejection is a channel this page is not
      // allowed to speak on, and a promise nobody is waiting for is where one
      // would come from.
    },
  );
}

/**
 * Ask for the share, and act on what comes back.
 *
 * @param {unknown} root
 * @returns {Promise<void>}
 */
async function submit(root) {
  if (state !== READY || held === null) {
    return;
  }
  const params = held;
  const started = epoch;

  state = nextSubmitState(state, 'submit');
  setSubmitBusy(root, true);

  const outcome = await ask(params, root);
  if (started !== epoch) {
    return;
  }

  state = nextSubmitState(state, outcome === null ? UNAVAILABLE : outcome.what);
  setSubmitBusy(root, false);

  if (outcome === null) {
    renderUnavailable(root);
    return;
  }
  if (outcome.what === WRONG_CODE) {
    renderWrongCode(root);
    return;
  }
  await openShare(root, params, outcome.body, started);
}

/**
 * Make the request, and say what its answer was.
 *
 * `null` for everything that is not an answer: an origin this page may not talk
 * to, an identifier that would not encode, a request that did not arrive, a
 * status that was not a success, a body that did not parse, and a body this
 * viewer does not recognise. All of them are the same to the caller, which is
 * the whole design.
 *
 * @param {LinkParams} params
 * @param {unknown} root
 * @returns {Promise<{ what: string, body: unknown } | null>}
 */
async function ask(params, root) {
  const api = apiOriginFor(location.origin);
  if (api === null) {
    // An origin no reviewed change has added to the table. No request is made
    // at all, which is a submit that lands on the unavailable surface having
    // sent a recipient's code nowhere.
    return null;
  }

  const id = encodeBase64url(params.id);
  if (id.length === 0) {
    return null;
  }

  try {
    const response = await fetch(`${api}${OPEN_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: openRequestBody(id, readCode(root)),
    });
    const text = await response.text();
    /** @type {unknown} */
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const what = classifyOpen(response.ok, body);
    return what === UNAVAILABLE ? null : { what, body };
  } catch {
    return null;
  }
}

/**
 * Turn a share into a document on the page, or into the surface that says
 * nothing.
 *
 * The capability is taken here, immediately before the decryption that needs it,
 * and the bytes it hands over are zeroed the moment that decryption returns.
 * Everything after that reads values the tag has already covered.
 *
 * One other place takes it, and takes it for the opposite reason: the handler
 * that runs when the page is being put away takes it in order to zero it. The
 * accessor hands its bytes over once and answers nothing afterwards, so whichever
 * of the two runs first is the only one that gets anything, and the other is
 * handed nothing and says so.
 *
 * The identifier comparison sits between the tag check and the document parse,
 * which is the only place it can sit: before the tag check it would be comparing
 * against a string an attacker chose, and after the document is on the page it
 * would be too late.
 *
 * @param {unknown} root
 * @param {LinkParams} params
 * @param {unknown} body
 * @param {number} started
 * @returns {Promise<void>}
 */
async function openShare(root, params, body, started) {
  let linkKey = params.takeLinkKey();
  if (linkKey === null) {
    renderUnavailable(root);
    return;
  }

  const result = await decryptShare(linkKey, params.id, body);
  linkKey.fill(0);
  linkKey = null;

  if (started !== epoch) {
    return;
  }
  if (result === null) {
    renderUnavailable(root);
    return;
  }

  const parsedAad = parseAad(result.aad);
  const validated = validateAadV1(parsedAad);
  if (!validated.ok) {
    renderUnavailable(root);
    return;
  }
  if (!idMatches(encodeBase64url(params.id), validated.aad.id)) {
    renderUnavailable(root);
    return;
  }

  const parsed = parseShareDoc(result.plaintext);
  if (parsed === null) {
    renderUnavailable(root);
    return;
  }

  dispatchDoc(root, parsed.docVersion, parsedAad, parsed.value);
}

/**
 * Report this link.
 *
 * Sent and not waited on. There is no answer worth showing — a report that
 * arrived and a report that did not would draw the same thing, because the
 * alternative is a page that tells a recipient which of the two happened — so
 * the control disables itself the moment it is used and nothing else changes.
 *
 * @param {unknown} root
 * @returns {void}
 */
function report(root) {
  const params = held;
  if (params === null) {
    return;
  }
  setReportUsed(root);

  const api = apiOriginFor(location.origin);
  if (api === null) {
    return;
  }
  const id = encodeBase64url(params.id);
  if (id.length === 0) {
    return;
  }

  try {
    const sent = fetch(`${api}${REPORT_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: reportRequestBody(id),
    });
    void sent.then(
      () => {},
      () => {},
    );
  } catch {
    // A request that could not even be started. There is nothing to say about it
    // and nowhere to say it.
  }
}

/**
 * The page is being put away.
 *
 * Everything goes: the surface is blanked, the code field is emptied, the link
 * capability is taken out of its accessor and zeroed if it is still there, the
 * identifier's bytes are zeroed, and the parsed link is dropped. The counter is
 * bumped first, so anything still in flight comes back to a page that has moved
 * on and writes nothing.
 *
 * @param {unknown} root
 * @returns {void}
 */
export function onPageHide(root) {
  epoch += 1;
  state = SETTLED;
  blankSurface(root);

  const params = held;
  held = null;
  if (params === null) {
    return;
  }
  const capability = params.takeLinkKey();
  if (capability !== null) {
    capability.fill(0);
  }
  params.id.fill(0);
}

/**
 * The page has been restored out of the back/forward cache.
 *
 * It shows the unavailable surface, with no report control, and that is
 * deliberate rather than a gap. A restored page is the same document as the one
 * that was put away: its address bar no longer carries the fragment, because the
 * fragment was scrubbed at boot, and the capability that was in it has been
 * zeroed and dropped. Nothing this module is still holding could resume the
 * share, and there is no identifier left to name in a report. The document does
 * still record the address it was loaded from, fragment and all, in the entry
 * `main.js` names — this viewer never reads that and does not resume from it.
 * The way back to the note is to open the link again from wherever it arrived.
 *
 * @param {unknown} root
 * @param {unknown} persisted Whether the page came out of the cache.
 * @returns {void}
 */
export function onPageShow(root, persisted) {
  if (persisted !== true) {
    return;
  }
  epoch += 1;
  state = SETTLED;
  held = null;
  renderUnavailable(root, false);
}
