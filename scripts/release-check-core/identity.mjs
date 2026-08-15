/**
 * Which release a served document is.
 *
 * A deployed origin serves bytes and says nothing about where they came from.
 * The digest comparison closes most of that — bytes that match a manifest entry
 * are the bytes that entry is about — but it closes it one object at a time, and
 * the question a person standing in front of a deploy actually asks is "which
 * release is up". So the entry point carries its own answer, in a form a browser
 * ignores and a reader can see: one HTML comment naming the release.
 *
 * The extraction rule is written down rather than implied, because the ways to
 * get it wrong are all quiet. A reading that takes the first match is a reading a
 * stale comment left higher in the document wins; a reading that takes any match
 * is a reading two comments both satisfy; and a reading that searches the whole
 * document text for the pattern is a reading that anything spelling it satisfies
 * — a string in a script, a value in an attribute, a line of visible prose. So:
 * the document is scanned for its comments first, the pattern is looked for
 * inside those spans and nowhere else, and the answer is the last such comment,
 * exactly one expected, zero or more than one a refusal rather than a fallback.
 *
 * The comment's own grammar is anchored to the exact spelling — one space either
 * side of the identifier, the word `release`, a colon — so that a comment which
 * is nearly one is not one. A pattern that tolerated whitespace variation would
 * be a pattern that matched a comment nobody generated.
 *
 * What this is and is not, stated plainly so that nobody grows it into something
 * else. This reads release identity: which release a document says it is. It is
 * not a reading of what the document contains — the byte-exactness of the served
 * document is held by the manifest digest, which compares every byte of it
 * against a value written down before the deploy, and that comparison is what
 * makes a document with anything unexpected in it a failed check. A span scan
 * over text is not a parser and must not be made into one: an HTML tokeniser
 * would be a second implementation of a browser's reading, held to a standard
 * nothing here needs and wrong in ways nothing here would notice. The honest
 * residual is that a comment-looking span inside script text or an attribute
 * value is read here as a span; the digest is what makes that harmless, because
 * a document carrying one is not the document the manifest names.
 *
 * This round freezes the format and the rule and models both in fixtures. The
 * document this repository currently ships carries no such comment; stamping one
 * at build time is a later change, and the check is written first so that the
 * stamp is measured against something rather than the other way round.
 */

import { parseReleaseId } from './manifest.mjs';
import { fail, PREDICATES } from './verdict.mjs';

/**
 * What opens a comment.
 */
const COMMENT_OPEN = '<!--';

/**
 * What closes one. The second is the abrupt form, which a browser accepts as a
 * close and a reader who only knows the first would read straight past.
 *
 * @type {readonly string[]}
 */
const COMMENT_CLOSE = Object.freeze(['-->', '--!>']);

/**
 * The comment's content, exactly, once the span it is in has been found.
 *
 * Anchored at both ends of the span: the span carries this and nothing else, so
 * a comment that names a release and says something more is not a release
 * comment. Not global, because it is asked of one span at a time.
 */
const RELEASE_CONTENT = /^ release: ([0-9A-Za-z-]+) $/;

/**
 * Every comment span in a document, as the text between its delimiters.
 *
 * A span that is never closed runs to the end of the document, which is what a
 * browser does with it — treating an unterminated comment as no comment would
 * be reading a document nobody serves.
 *
 * @param {string} document
 * @returns {string[]}
 */
export function commentSpans(document) {
  /** @type {string[]} */
  const spans = [];
  let at = 0;
  for (;;) {
    const open = document.indexOf(COMMENT_OPEN, at);
    if (open < 0) {
      return spans;
    }
    const from = open + COMMENT_OPEN.length;
    let end = -1;
    let after = document.length;
    for (const close of COMMENT_CLOSE) {
      const found = document.indexOf(close, from);
      if (found >= 0 && (end < 0 || found < end)) {
        end = found;
        after = found + close.length;
      }
    }
    if (end < 0) {
      spans.push(document.slice(from));
      return spans;
    }
    spans.push(document.slice(from, end));
    at = after;
  }
}

/**
 * Every release comment in a document, in the order written.
 *
 * @param {string} document
 * @returns {string[]}
 */
export function releaseComments(document) {
  /** @type {string[]} */
  const found = [];
  for (const span of commentSpans(document)) {
    const match = RELEASE_CONTENT.exec(span);
    const value = match?.[1];
    if (value !== undefined) {
      found.push(value);
    }
  }
  return found;
}

/**
 * Is the release identifier in this document the one the manifest names?
 *
 * @param {string} document The entry point, decoded to text.
 * @param {string} expected The manifest's `release_id`.
 * @param {string} subject What to call the document in a refusal.
 * @returns {import('./verdict.mjs').Refusal[]}
 */
export function checkReleaseIdentifier(document, expected, subject) {
  const found = releaseComments(document);
  if (found.length !== 1) {
    return [
      fail(
        PREDICATES.RELEASE_IDENTIFIER,
        subject,
        `the document carries ${found.length} release comment(s), and exactly one is expected`,
      ),
    ];
  }
  // The last one, which with exactly one is the same element and is written this
  // way because the rule is "the last", not "the only". A document that grew a
  // second comment is refused above; a reading that took the first would be a
  // different rule that happens to agree while there is one.
  const identifier = found[found.length - 1] ?? '';
  if (parseReleaseId(identifier) === null) {
    return [
      fail(PREDICATES.RELEASE_IDENTIFIER, subject, `the document names ${JSON.stringify(identifier)}, which is not a release identifier`),
    ];
  }
  if (identifier !== expected) {
    return [
      fail(PREDICATES.RELEASE_IDENTIFIER, subject, `the document names ${identifier} and the manifest names ${expected}`),
    ];
  }
  return [];
}
