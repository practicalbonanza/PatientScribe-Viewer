/**
 * The words.
 *
 * Every string a recipient can see is here, and this module holds nothing else:
 * no logic, no formatting, no branching, no element names. It is a table of
 * agreed text, and the point of it being a table in one file is that the words
 * are a controlled surface. They are agreed away from the keyboard, transcribed
 * once, and never edited to fit a layout.
 *
 * Three visible strings are deliberately not here, and each is somewhere a
 * reader can check:
 *
 *   - The document title, which is static in `index.html` because a title is
 *     part of the page rather than something drawn into it. Nothing updates it
 *     at runtime.
 *   - The two external link destinations, which are static attributes in
 *     `index.html`. A destination this module carried would be a destination
 *     something had to write onto an element, and writing a destination is the
 *     one thing the renderer must never do. The text of both links is here; only
 *     where they point is over there.
 *   - The banner on a decrypted note. That wording travels inside the encrypted
 *     document and is rendered as it arrived, so there is no copy of it in this
 *     viewer to drift from it. A constant here would be a second spelling of
 *     something the sender already said.
 *
 * Several entries are a fragment rather than a sentence, and the reason is
 * always the same: the sentence has something inside it that is not text. The
 * chip leads are followed by a name the document carries; the expiry lead by a
 * date; the advisory is split around the words that are emphasised; the notice
 * is split around a link. Each set of fragments concatenates to exactly the
 * sentence it is a split of, which is what the copy check reads.
 *
 * Written as template literals throughout, and that is a checkable decision
 * rather than a style: a quoted string with an apostrophe in it has to escape
 * the apostrophe, so the bytes in this file would stop being the bytes on the
 * page. Between backticks the source and the string are the same characters,
 * which is what lets the copy check compare this file's own text against the
 * agreed words.
 */

/** The agreed text. */
export const COPY = Object.freeze({
  /** The heading every state carries. */
  brand: `PatientScribe`,

  /** The shell: what this page is, and where the code comes from. */
  shellIntro: `Someone has shared a PatientScribe note with you.`,
  codeHelper: `They'll have given you a code — usually over the phone.`,

  /** The code field's label, and the control that sends what was typed. */
  codeLabel: `Code`,
  codeSubmit: `Open the note`,

  /**
   * The one thing a recipient is told about a code that did not match.
   *
   * There is no attempt count here and there is nowhere for one to go. What a
   * counter would tell a recipient, it would tell anyone holding the link.
   */
  wrongCode: `That code didn't match. Check it with the person who shared this.`,

  /**
   * The single surface every failure ends on.
   *
   * One sentence for a network that did not answer, a share that has expired, a
   * blob that did not authenticate, a document that did not validate, and an
   * identifier that did not match. The difference between those is exactly what
   * must not be readable from here.
   */
  unavailable: `This shared note is no longer available. If you were expecting it, ask the person who shared it.`,

  /**
   * The chip that says who "you" is in the note, and the two that say it was
   * edited. Each is a lead, followed by the name the document carries — except
   * the third, which is the whole line for a document that carries no name.
   */
  youChipLead: `'You' means `,
  editedChipLead: `Edited by `,
  editedChipNameless: `Edited by the sharer`,

  /** The expiry line's lead, followed by the formatted date and time. */
  expiryLead: `This link works until `,

  /** The text of the link to the app. Where it points is static in the page. */
  appBanner: `PatientScribe is free on the App Store`,

  /**
   * The advisory, in three pieces around the words that are emphasised.
   *
   * Advice and not a block: it appears when the checks say this browser cannot
   * be relied on to do the decryption, and the code field stays usable
   * underneath it. A recipient who tries anyway either sees their note or sees
   * the one unavailable surface, which is what they would have seen in any case.
   */
  advisoryLead: `This app's built-in browser can't open shared notes safely. Tap ⋯ and choose `,
  advisoryEmphasis: `Open in Safari`,
  advisoryTail: ` (or Chrome).`,

  /** The control that reports a link, which exists only where there is an identifier to report. */
  reportControl: `Report a problem with this link`,

  /**
   * The collection notice: its own lead sentence, then the body in two pieces
   * around the link to the full policy.
   *
   * The claim about decryption is made once, in these words, and is not
   * restated anywhere in this viewer. It is scoped on purpose — to stored share
   * content, under the published protocol — because a shorter, stronger
   * sentence would be a claim this design does not support.
   */
  noticeSummary: `For people viewing a shared note.`,
  noticeLead: `This page shows you an encrypted note shared with you through PatientScribe. PatientScribe (DigiFrontiers) cannot decrypt stored share content under our normal, published viewer protocol — and we cannot verify who opens a share: anyone with both the link and the code can open it. When you open this page we handle your IP address and basic request data, kept briefly (up to 30 days) only to limit abuse and keep the service working; the access code you type is sent to us only to check it and is not kept (without it we can't show you the note); and each share link keeps a simple code-entry attempt counter while it exists — we use none of this for analytics, advertising, or profiling, we don't set cookies, and nothing here is used to track you across other sites or pages. Questions: support@patientscribe.com.au. Full policy: `,
  policyLinkText: `patientscribe.com.au/privacy-policy`,
  noticeTail: `.`,
});
