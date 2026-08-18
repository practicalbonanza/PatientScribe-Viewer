/**
 * Forbidden-sink scan — the engine.
 *
 * Holds the rules and the tree walk. No CLI, no argument parsing, no exit codes,
 * no output: this module is importable from a test without doing anything. The
 * command-line front end is `check-sinks.mjs`, and it is deliberately a separate
 * file that runs unconditionally — an earlier version guarded its own CLI on
 * `import.meta.url === process.argv[1]`, which compares a realpath-resolved URL
 * against an as-invoked path and so silently did nothing when the script was
 * reached through a symlink. A check that can be made to exit 0 without scanning
 * is worse than no check. There is now nothing to guard.
 *
 * What the rules cover, and what they cannot:
 *
 * 1. There is no suppression mechanism. No allowlist file, no magic comment, no
 *    "expected violations" count. A check that can be switched off one line at a
 *    time stops being a control the moment someone is in a hurry. If a rule here
 *    is genuinely wrong, the rule gets changed in this file, in a reviewed
 *    change, in public — not annotated away at the call site.
 *
 * 2. Comments are not exempt. The scan is line-based and does not parse, so a
 *    forbidden construct is reported whether it is live code, dead code, or a
 *    remark about it. The cost is that this file's own vocabulary cannot be
 *    written into `site/`; that cost is worth paying to keep "it was only a
 *    comment" out of the argument entirely.
 *
 * 3. This is a line-based lexical scan over source text, and its reach ends
 *    there. It catches these constructs written plainly. It cannot catch a name
 *    assembled at runtime, an identifier spelled with unicode escapes, a
 *    property reached through a key that is not written down, a member pulled
 *    out by destructuring, a member reached through an optional chain where the
 *    rule that names it is anchored to a dot, a call split across lines, a
 *    string passed through a variable, a constructor reached through a chain
 *    of other objects, a destination assembled out of two strings joined at a
 *    seam — where neither half carries a scheme or a pair of slashes and the
 *    whole only exists once something has run — a destination that borrows the
 *    page's scheme from inside a markup attribute written without quotes, that
 *    same destination with BOTH of its slashes leaning the other way, which
 *    is the one leaning spelling this deliberately does not look for and the
 *    reason is beside the rule, or a destination whose scheme is followed by
 *    FEWER than the two characters that rule is written with — a parser takes
 *    what follows one of these schemes as the part naming a host whether the
 *    pair is there, half there, or absent, so long as the scheme is not the one
 *    the page itself was served over; where the two schemes are the same it
 *    reads the rest as relative and the host lands in the path instead, which
 *    means this shape names somewhere else under one scheme and nowhere new
 *    under the other, and the known-miss fixture carries a line for each.
 *    Reaching that would mean matching
 *    a scheme and its colon and nothing else, which refuses every line that so
 *    much as mentions one. A further consequence of reading text rather
 *    than resolving it: what any of these patterns compare are spellings, never
 *    hosts, so two spellings a parser would resolve to one host are two
 *    different strings here, and one spelling that a parser rewrites before it
 *    resolves it — a name in a script that is converted first — is compared as
 *    written. The self-test asserts those misses deliberately, so the limit
 *    stays documented rather than assumed away. Read this as a tripwire against
 *    accident and drift. The controls against an author who is actually trying
 *    are review, and CSP — whose resource half the page carries itself, as the
 *    policy written into `index.html`. One directive there names an origin
 *    outside this page and it is the only one: `connect-src` names `'self'` and
 *    the share API the origin table sends a page to, because a request the table
 *    decides on is a request the policy has to permit. The rest name `'self'` or
 *    `'none'` — and Trusted Types, which the origin adds along with the
 *    directives a page cannot carry.
 *
 * 4. Three ways off this page are not fetches, and the policy the page carries
 *    reaches none of them. They are named here because the paragraph above leans
 *    on that policy, and a reader who stopped there would take it for a statement
 *    about everything that leaves.
 *
 *    A top-level NAVIGATION is the first. Sending the document somewhere else
 *    carries whatever the address holds, and no directive in the shipped set
 *    governs it. The set has one navigation control in it — `form-action`, which
 *    says where a form may submit — and a navigation made any other way is
 *    governed by nothing, in this policy or in any other: no currently
 *    implemented CSP directive governs a general top-level navigation. The one
 *    drafted for it, `navigate-to`, is not in the specification any more, and
 *    neither engine this project runs recognises it. Nor is this a case of a
 *    directive that exists but cannot be written into a page: the three a meta
 *    element cannot carry are `report-uri`, `frame-ancestors` and `sandbox`, and
 *    none of those is a navigation control. What stands in its place is the
 *    browser suite's reading of the origin and the path of everything each
 *    surface drives, and review.
 *
 *    WebRTC is the second. A peer connection leaves without a fetch, so none of
 *    the directives above is consulted on the way out. CSP3 defines a `webrtc`
 *    directive for this, and it is deliberately not written into the page:
 *    measured in both engines this project's suite runs, neither implements it —
 *    each reports it as an unrecognised directive on every load, and with the
 *    directive present ICE candidate gathering still completes in both, reaching
 *    an external STUN server and returning a server-reflexive candidate from it.
 *    A directive that refuses nothing and makes every page load noisy buys
 *    nothing here. So this stays a miss on both sides, held by the absence of any
 *    code that reaches for it, and review.
 *
 *    CROSS-CONTEXT MESSAGING is the third. A message posted to an opener or a
 *    parent in another origin carries whatever was handed to it and leaves
 *    without a fetch, so nothing in this policy is consulted on the way out —
 *    CSP has no directive for it at all, and no rule below looks for it either.
 *    `frame-ancestors` is not the control it might be taken for: that one says
 *    who may frame this document, an opener is not framing it, and it is one of
 *    the three a page cannot carry in a meta element in any case. So this is a
 *    miss on both sides too, held the same way — the absence of any code that
 *    reaches for it, and review.
 *
 * One rule here is not about a sink at all, and it is worth saying why it lives
 * here rather than looking like a stray. The typecheck step is pinned as two
 * whole configurations, because the ways to turn a checker off are not a list
 * anyone finishes — but a one-line comment turns it off for one module while
 * both configurations still say exactly what they are pinned to say. Nothing
 * that reads a configuration can see that. This scan reads every line of every
 * served file, which makes it the only existing thing that can, so the
 * suppression comments are a rule here rather than a second scanner somewhere
 * else.
 *
 * That rule is declared for files of every extension, and until recently the
 * only tree it was ever run over was `site/` — so the modules that decide
 * whether any of these checks pass were outside its reach, and the second
 * typecheck configuration covers exactly those. A comment at the top of one of
 * them turned the checker off for the module that judges a suite, with the whole
 * chain green. `check-sinks-selftest.mjs` now reads this rule over those modules
 * as well, and the cost is the one this file's other patterns already impose:
 * the spellings cannot be written plainly in the tree that is scanned for them.
 *
 * This engine lives outside `site/` precisely so its own patterns are not in
 * scope for itself.
 */

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * The tree this scan is for: the bytes that are served.
 *
 * Here rather than in the command-line front end, and exported, because the
 * front end is where it used to be and nothing could see it there. Every rule
 * below is pinned — the set, by an independent list; each rule's firing, by a
 * fixture; each alternative of the rules that alternate, one by one — and none
 * of that says a word about what the rules are run over. Repointing the default
 * one directory down, at `site/css`, left `npm run check` exiting 0 while
 * reporting "scanned 1 file(s) under site/css/ … PASS", with a genuine
 * `innerHTML` assignment shipped in `site/js/render.js`. The manifest pins the
 * command that starts this scan and cannot pin what the scan then looks at.
 *
 * So the target is a constant with a name, in the module the self-test already
 * reads, and `check-sinks-selftest.mjs` holds it two ways: against a path
 * written out there rather than derived from here, and against what a default
 * invocation of the command line actually reported having scanned — the tree by
 * name, the count of files it holds, and the served files that must be among
 * them. A constant nothing compares against is a constant, not a pin.
 */
export const SHIPPED_TREE = join(REPO_ROOT, 'site');

/** Marker meaning "this rule applies to every file, whatever its extension". */
const ANY = 'any';

/** Extensions read as markup, where an attribute can carry script or a URL. */
const MARKUP_FILES = ['.html', '.htm', '.xhtml', '.svg'];

/** Extensions read as scripts. */
const SCRIPT_FILES = ['.js', '.mjs'];

/**
 * Extensions read as stylesheets.
 *
 * Two rules below are declared for these and for nothing else, and the narrowing
 * is the point of both. A stylesheet is the one served kind where the name of a
 * resource and the text a reader sees are ordinary properties rather than
 * constructs — so the spellings that matter there are ordinary words everywhere
 * else, and a rule that looked for them in a script would be refusing the
 * language rather than a sink.
 */
const STYLESHEET_FILES = ['.css'];

/**
 * @typedef {object} Rule
 * @property {string} id
 * @property {'any' | readonly string[]} files
 * @property {RegExp} pattern
 * @property {string} why
 * @property {readonly string[]} [exceptFiles] Repository-relative paths this
 *   rule is not applied to. Empty on every rule but one, and the one is
 *   documented where it is declared: a construct that has to exist somewhere is
 *   refused everywhere else, which is a narrower rule than not having one.
 * @property {Readonly<Record<string, RegExp>>} [patternIn] Repository-relative
 *   paths this rule reads with a pattern of their own rather than with
 *   `pattern`. Absent on every rule but one, and it is the other shape of the
 *   same idea `exceptFiles` is: a construct that belongs in one named file is
 *   admitted there and refused everywhere else.
 *
 *   The direction of the exception is what makes this safe to have. `pattern`
 *   is the narrowest of the set and it is what every file not named here is
 *   read with, so a file this does not know about is a file where nothing extra
 *   is admitted — a path typed wrongly, a file renamed, a tree scanned from
 *   somewhere else all fail closed. The only thing an entry here can do is
 *   admit one more construct in one more named file.
 */

/**
 * @typedef {object} Violation
 * @property {string} file
 * @property {number} line
 * @property {string} rule
 * @property {string} why
 * @property {string} text
 */

/**
 * @typedef {object} ScanResult
 * @property {string[]} files
 * @property {Violation[]} violations
 * @property {Map<string, number>} byExt
 */

/** Raised when the tree cannot be scanned safely. Always fail closed. */
export class ScanError extends Error {}

/**
 * The served file that decides where this page's two requests go.
 *
 * One table, keyed on the origin the page was served from, and every value in
 * it is a decision about where a share code travels.
 *
 * Up here rather than beside the reading that parses it, because the rules below
 * are built from it: one of them admits a construct in this file and refuses it
 * in every other, and a rule cannot name a file that is declared after it.
 */
export const ORIGIN_TABLE_FILE = 'site/js/config.js';

/**
 * The served file a browser is handed first, and the one carrying the policy.
 *
 * Named for the same reason and used the same way: the policy that says what may
 * leave this page is written in this file and nowhere else, so the rule that
 * admits the one destination that policy names admits it here and nowhere else.
 */
export const ENTRY_DOCUMENT_FILE = 'site/index.html';

/**
 * The origin the development server and the browser suite run on.
 *
 * A name rather than a spelling written out where it is used, because it is used
 * three times below: in the admitted set, in the table pin, and in the reading
 * that says which file it belongs in. Three transcriptions of one origin are
 * three things to keep in step.
 */
const LOOPBACK_ORIGIN = 'http://127.0.0.1:4173';

/** The address a carer visits while this viewer is hosted for development. */
const HOSTED_DEVELOPMENT_ORIGIN = 'https://d30xbcndd2uqpg.cloudfront.net';

/**
 * The share API a page served from that address is allowed to talk to.
 *
 * The one destination here that belongs in two served files rather than one, and
 * the one the admission below treats differently from its siblings. Both facts
 * have the same cause and it is written out beside each of them.
 */
const HOSTED_DEVELOPMENT_API_ORIGIN = 'https://2kcwhm87v5.execute-api.ap-southeast-2.amazonaws.com';

/**
 * The five destinations this viewer names, and the file or files each belongs in.
 *
 * The rule below admits these five spellings; this is what says where each of
 * them may appear and how often. Two are attributes in the page, because a
 * destination written into the markup is a destination no code ever assigns. Two
 * more are the origin table's keys — the origin the development server runs on,
 * which is also its own destination, and the address the hosted development
 * viewer is served from.
 *
 * The fifth is the share API, and it is the only one whose value is two files.
 * That is not a convenience: the origin table names it because the table decides
 * where a share code travels, and the entry document's policy names it because a
 * browser refuses a request the policy does not permit. Neither site can be
 * dropped in favour of the other, so the honest shape of this map is a list of
 * files per spelling rather than one file per spelling with an exception written
 * in prose.
 *
 * Above the rules rather than beside `countAllowedUrls` below, because the rule
 * is built from it. The spellings a scan admits and the spellings a reader is
 * told about were two lists in one file, and two lists in one file drift.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const ALLOWED_URLS = Object.freeze({
  'https://apps.apple.com/au/app/id6758035505': Object.freeze([ENTRY_DOCUMENT_FILE]),
  'https://patientscribe.com.au/privacy-policy': Object.freeze([ENTRY_DOCUMENT_FILE]),
  [LOOPBACK_ORIGIN]: Object.freeze([ORIGIN_TABLE_FILE]),
  [HOSTED_DEVELOPMENT_ORIGIN]: Object.freeze([ORIGIN_TABLE_FILE]),
  [HOSTED_DEVELOPMENT_API_ORIGIN]: Object.freeze([ENTRY_DOCUMENT_FILE, ORIGIN_TABLE_FILE]),
});

/**
 * A literal, as a pattern that matches exactly itself.
 *
 * @param {string} text
 * @returns {string}
 */
function asPattern(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** The three quotes a destination can be written between. */
const QUOTE = "['\"`]";

/** The same three, one at a time, so a spelling can be asked to end at the one it began with. */
const QUOTES = ["'", '"', '`'];

/**
 * The admitted spellings, each required to be a whole delimited destination.
 *
 * This used to be the other way round: the spelling, followed by anything that
 * is not one of the characters a URL is made of. That reading is a list of what
 * carries a destination on, and such a list is a claim about a parser rather
 * than about a character set — measured against `new URL`, a quote, a backtick,
 * a brace, a bar, a caret, an angle bracket, a space, a tab, a newline and every
 * other character outside that list all carry an admitted origin straight on
 * into a different host. `http://127.0.0.1:4173` followed by a quote, an `@` and
 * a host resolves to that host, and every one of those spellings was admitted.
 *
 * So the question is inverted. Nothing ends a URL from inside it: after a scheme
 * and a host, one more character is one more character of the same URL as far as
 * a parser is concerned, which is why enumerating the endings does not converge.
 * What ends a destination is the source it is written in — the quote that closes
 * the string, or the quote that closes the attribute — so an admitted spelling
 * is admitted where it sits between a matching pair of them and ends at the
 * closing one, and is refused everywhere else.
 *
 * "Ends at the closing one" is a claim about the string, and the string is as far
 * as it goes. A source can write half a destination here and the other half in a
 * second string, and join the two once something has run: an admitted spelling
 * followed by a closing quote, a plus and another string is admitted by this, and
 * the value it makes is not what was admitted. That is the seam, and it is a
 * documented miss — named at the top of this module, carried by the known-miss
 * fixture, and swept for in the self-test so the line it is missed on is a line
 * somebody chose. Nothing a reading of one line can do reaches it.
 *
 * The pairing is what makes the rest of it hold rather than the closing quote on
 * its own.
 * A spelling followed by some quote is a spelling that may still be inside a
 * string opened with a different one, and the characters after it would then be
 * part of the destination — so the quote in front and the quote behind have to
 * be the same character, which is why this is a dozen alternatives rather than
 * four: each of the four generally admitted destinations, once per quote it
 * could be written between.
 *
 * Four rather than five, and the missing one is the whole of the paragraph
 * further down. Which four is read off the map rather than written out again, so
 * a destination added to that map joins this admission by being added there and
 * the one entry held out is held out by name.
 *
 * @type {readonly string[]}
 */
const GENERALLY_ADMITTED = Object.keys(ALLOWED_URLS).filter((url) => url !== HOSTED_DEVELOPMENT_API_ORIGIN);

/** @see GENERALLY_ADMITTED @type {string} */
const QUOTE_ADMITTED = QUOTES.flatMap((quote) =>
  GENERALLY_ADMITTED.map((url) => `(?<=${quote})${asPattern(url)}(?=${quote})`),
).join('|');

/**
 * The bytes the entry document's policy writes in front of the share API.
 *
 * Not a URL and not a spelling this scan is otherwise about: it is the source
 * list of one directive, up to and including the space that separates its second
 * source from its first.
 */
const POLICY_CONNECT_SOURCE = "connect-src 'self' ";

/**
 * And the bytes that open the element that policy is written in.
 *
 * The whole of the element up to the value, because what is being told apart is
 * a policy from a string that reads like one. Markup can write those same
 * directive bytes into any attribute of any element — a `title`, an `alt`, a
 * `data-` anything — and a reading anchored on the directive alone admits every
 * one of them. Anchored on this, the spelling has to sit inside the value of the
 * `content` attribute of a policy element that begins its line, which is where
 * the served file writes it and where a browser reads a policy from.
 */
const POLICY_ELEMENT_OPEN = '<meta http-equiv="Content-Security-Policy" content="';

/**
 * What may sit between the opening of that value and the directive.
 *
 * Directives, and the two bytes that end one. A policy is a list separated by
 * semicolons, so the directive this admission is about is either the first thing
 * in the value or the thing after a separator — and writing that down is the
 * difference between reading a directive and reading a string that ends with
 * one. `connect-src` is a suffix of `xconnect-src`, which is not a directive any
 * browser has ever heard of and is therefore ignored entirely: a policy carrying
 * it names the share API nowhere, permits nothing, and a page relying on that
 * permission stops working — with a reading that matched the directive name as a
 * bare substring calling the file conformant. Measured: it did.
 *
 * Optional, because the directive can also be the first in the value, and that
 * is a policy this file has no opinion about the ordering of.
 */
const POLICY_DIRECTIVE_BOUNDARY = '(?:[^"]*; )?';

/**
 * The name the origin table's module declares that destination under.
 *
 * The identifier and not merely the shape of a declaration, for the same reason
 * `ORIGIN_TABLE_NAME` below is written out: `const anything = '<the share API>';`
 * is a shape any served module can write, and admitting the shape would admit
 * this spelling in any file that felt like declaring it. Admitting the one
 * declaration admits the one declaration. A rename is then a red scan rather
 * than a silent move, which is what a rename of this constant should be.
 */
const API_ORIGIN_CONSTANT_NAME = 'HOSTED_DEVELOPMENT_API_ORIGIN';

/**
 * The share API, admitted at two positions and refused everywhere else.
 *
 * Every other admitted spelling is admitted wherever it is written between a
 * matching pair of quotes, and that is right for them: each belongs in exactly
 * one served file, the count beside this scan says which, and inside that file
 * there is no second place the spelling could sit and mean something else.
 *
 * This one is different in both halves of that. It belongs in TWO files, and in
 * one of them — the entry document — it sits inside a policy attribute, between
 * a space and a semicolon, where there is no quote in front of it and none
 * behind. So the generic admission could never have admitted it there: written
 * into the policy, the spelling would have been refused as an external
 * destination the moment the policy named it.
 *
 * Widening the generic admission to reach it would have been the wrong repair,
 * and the reason is the other half. The entry document is markup, and markup
 * writes destinations between quotes all the time: with this spelling on the
 * generic admission, a link element carrying it as an attribute would be
 * admitted, and it would be admitted in place of the policy occurrence rather
 * than as well as it — one occurrence in that file is what the count requires,
 * and the count cannot tell which one it found. The position would then be held
 * by nothing at all, and the served page would carry a link to the share API
 * where it used to carry the permission to reach it.
 *
 * So the admission for this entry is built per position rather than per quote,
 * and it is two positions:
 *
 * 1. The one named constant in the origin table's module — the spelling as the
 *    whole of a quoted string that the `const` named above is declared with and
 *    a semicolon ends. That is where the table's second entry gets its value
 *    from. Any other constant carrying the same spelling is refused, which is
 *    why the identifier is part of the pattern rather than the shape of a
 *    declaration.
 * 2. The second source of the policy's `connect-src` directive in the entry
 *    document — the spelling between the bytes above and the semicolon that ends
 *    the directive.
 *
 * The second is the inversion this file already explains, asked of a different
 * closing byte. A quoted string ends at its closing quote; a source in a policy
 * ends at whitespace or at the semicolon that ends the directive. A spelling
 * followed by one more character of a URL is therefore not admitted here, and
 * neither is a spelling followed by a space and a second source — which is what
 * naming a second destination in that directive would look like.
 *
 * "Two positions" is a claim about a position IN A FILE, and there are two ways
 * to fail it that a pattern alone fails at. Both were measured on a working
 * version of this that had neither, and both are worth writing down because
 * neither is obvious from reading a regular expression.
 *
 * The first is that an anchor travels with what it anchors. These patterns are
 * bytes, the scan applies them to every served file, and bytes can be typed
 * anywhere — so the policy anchor pasted into a comment in the origin table's
 * module was admitted there, and the constant anchor would have been admitted
 * inside the entry document. That is why the two are NOT one alternation applied
 * everywhere: each is written into `patternIn` under the one file it is the
 * position of, and every other file is read with the pattern that has neither.
 * The direction of that exception is what keeps it honest — a file this does not
 * name is a file where nothing extra is admitted at all.
 *
 * The second is that a file has more than one position in it. Naming the file
 * says nothing about where inside it, and the entry document is markup: the
 * directive bytes written into a `title` attribute in the body are the same
 * bytes as the directive, so with the real policy occurrence deleted and those
 * bytes pasted into the body, the count found its one occurrence in the file it
 * belongs to and the scan admitted it — a page carrying an inert attribute where
 * it used to carry the permission to reach its own API, with everything green.
 * So each admission is anchored from the START of its line: the origin table's
 * to a line that begins with the declaration and ends with its semicolon, the
 * entry document's to a line that begins with the policy element, with the
 * spelling inside the value of its `content` attribute — a span that cannot
 * reach past the quote that closes it, so no second attribute on that same line
 * can carry it either.
 *
 * What this still does NOT do is count. `countAllowedUrls` beside this scan is
 * what says the spelling appears exactly once in each file it belongs to, and
 * the two compose: this says where a line may put it, that says how many lines
 * do.
 *
 * And one CLASS of shape it does not reach, named here rather than left to be
 * found, because it is the same limit paragraph 2 at the top of this module
 * already declares for every other rule: this scan reads a line at a time. An
 * admitted line reproduced EXACTLY is admitted, whatever encloses it, and what
 * encloses a line is never on the line. A block comment is the obvious member of
 * the class and it is not the only one — a `<template>` element holds markup the
 * browser parses and never applies, and a block scope holds a declaration that
 * runs and is reachable by nothing. Each is opened somewhere above and closed
 * somewhere below, which is exactly what a reading of one line cannot see.
 *
 * That is a miss about ENCLOSURE rather than about position: every byte of the
 * line is the byte the position requires, which is why nothing narrower closes
 * it and why widening the reading to "unless it looks enclosed" would be a claim
 * about a parser again — and a wrong one, since which enclosures are open at a
 * given line is the whole of what parsing is.
 *
 * Enclosure has a sibling, and it is worth naming beside it because the two are
 * the same limit wearing different clothes: TRIVIA BETWEEN TOKENS. A comment
 * does not only sit around lines, it sits inside them, and a language lets it
 * sit anywhere a space can. A declaration whose name is followed by a comment
 * and then by its `=` is one declaration to an engine and, to any reading that
 * expects whitespace in that position, no declaration at all. (The shape cannot
 * be written out here: the two characters that close a comment would close this
 * one.)
 * That was measured on the origin table's own module: a comment between the
 * table's name and its `=` hid the live declaration from a reading of text
 * entirely, leaving a commented decoy above it as the only declaration the
 * reading could see. Neither this rule nor the readings beside it close that,
 * for the same reason they do not close enclosure — where trivia may appear is a
 * fact about a grammar, and a grammar is what a line scan is not.
 *
 * What closes both is not in this file. The self-test imports the served module
 * and compares the table an engine evaluates against the entries this repository
 * pins, and an engine reads around trivia and enclosure because that is what
 * reading a program is. That is why the reading here is a reviewability control
 * and the completeness claim is made there.
 *
 * What it costs is bounded, and the bound is the rest of the gate rather than
 * this pattern. Such a line is either a SECOND occurrence — and the count beside
 * this refuses a second occurrence in either file, whatever encloses either of
 * them — or it REPLACES the real one, and then:
 *
 *   - In the entry document, the served page no longer carries the share API in
 *     an applied policy at all: a policy element inside a `<template>` is parsed
 *     and never applied, and one inside a comment is not parsed. The browser
 *     suite reads that three ways in both engines — the policy pinned in the
 *     element inventory, the byte comparison of the document through the end of
 *     the policy element, and the test that drives a real permitted request
 *     under it.
 *   - In the origin table's module, the declaration the table's second entry is
 *     built from is not running — and it is worth being exact about what
 *     notices, because the readings beside this one do not. They read raw text:
 *     a declaration inside a comment is counted like any other and its literal
 *     is resolved like any other, so a REPLACING commented declaration looks to
 *     them like a name declared once with a good value, and the pin is green.
 *     What refuses it is the module itself. The table refers to a name nothing
 *     declares, so the typecheck step ahead of this one reports the name as not
 *     found, and the self-test's runtime import — which asks the module what it
 *     answers rather than what it says — throws on evaluating it. Measured, both
 *     of them, on this file. A name declared twice IS caught by the readings
 *     beside this, which is the case where the live declaration stays and a
 *     second one is added; the replacing case belongs to the two layers named
 *     here.
 *
 * There is no arrangement of one enclosed line that is green everywhere; there
 * is an arrangement that is green HERE, and that is what this paragraph is
 * for.
 *
 * @type {string}
 */
const ORIGIN_TABLE_ADMITTED = QUOTES.map(
  (quote) =>
    `(?<=^const\\s+${API_ORIGIN_CONSTANT_NAME}\\s*=\\s*${quote})` +
    `${asPattern(HOSTED_DEVELOPMENT_API_ORIGIN)}(?=${quote};$)`,
).join('|');

/** @see ORIGIN_TABLE_ADMITTED @type {string} */
const ENTRY_DOCUMENT_ADMITTED =
  `(?<=^\\s*${asPattern(POLICY_ELEMENT_OPEN)}${POLICY_DIRECTIVE_BOUNDARY}${asPattern(POLICY_CONNECT_SOURCE)})` +
  `${asPattern(HOSTED_DEVELOPMENT_API_ORIGIN)}(?=;)`;

/**
 * The characters a URL parser deletes before it reads anything at all.
 *
 * Exactly three — tab, line feed and carriage return — and the set is the
 * parser's rather than a choice made here. It removes every one of them from the
 * whole of an address before it parses it, which means they can sit anywhere: in
 * the middle of a scheme, between the colon and the slashes, between the two
 * slashes, inside a host. Measured against the platform's own parser,
 * `https:/⇥/host`, `https:⇥//host` and `htt⇥ps://host` all name `host`, and each
 * of them was admitted by a reading that required the characters around them to
 * be next to each other.
 *
 * So this is written into the scheme construct at every join, and after the
 * quote that opens the one that borrows the page's scheme. It matches nothing at
 * all in the ordinary case, and what it costs is nothing: measured over the
 * served tree, no line's answer changes.
 *
 * Two of the three cannot in fact reach a line here, and that is worth saying so
 * the set is not read as three equal cases. This scan splits a file on its line
 * endings, so a line feed is never inside a line and a carriage return only is
 * when it is not followed by one. The tab is the one that arrives ordinarily.
 * They are all three here because the set belongs to the parser, and a reading
 * that carried two of them would be a claim about which of them somebody would
 * think to use.
 *
 * A character NOT deleted, and left out on purpose: the space. A parser does not
 * remove it from the middle of an address — it ends the parse or is encoded — so
 * tolerating it here would refuse ordinary prose about a scheme rather than a
 * destination.
 */
const STRIPPED = '[\\t\\n\\r]*';

/**
 * And what a parser trims off the FRONT of an address, which is a wider set.
 *
 * Every C0 control and the space, removed from the beginning and the end of an
 * address before anything else happens to it. That is a different rule from the
 * one above and it matters in one place: a destination that borrows the page's
 * scheme is read here only where a quote sits in front of it, and a quote is
 * exactly where the beginning of an address is. Measured against the platform's
 * own parser, a space, a null and a unit separator each sit between the quote and
 * the two slashes and are trimmed away, leaving a destination that resolves off
 * this origin — and each of those spellings was admitted.
 *
 * So the tolerance after the quote is this set rather than the three above. It
 * costs a line that opens a string with whitespace and then writes two slashes,
 * which is refused whether or not it names anything; that is the same trade this
 * alternative already makes for two slashes written straight after a quote.
 * Measured over the served tree and over every fixture tree, no line's answer
 * changes.
 */
const TRIMMED = '[\\x00-\\x20]*';

/**
 * A destination's scheme and the two characters after it.
 *
 * Either scheme, in any case, because a browser reads a scheme
 * case-insensitively while a comparison does not. Then the pair that opens the
 * part naming a host, whichever way each of them leans: a parser reading one of
 * these schemes treats a backslash as a slash, so `https:/\host`, `https:\/host`
 * and `https:\\host` all name `host`, and all three are read here — a line
 * carrying one of these schemes is not something else this could be confused
 * with, so nothing has to be given up to reach them.
 *
 * With the deleted characters written into every join, for the reason beside
 * them.
 */
const SCHEME =
  `[Hh]${STRIPPED}[Tt]${STRIPPED}[Tt]${STRIPPED}[Pp]${STRIPPED}(?:[Ss]${STRIPPED})?` +
  `:${STRIPPED}[\\/\\\\]${STRIPPED}[\\/\\\\]`;

/**
 * The two characters that open the part of a destination naming a host, in the
 * spellings a browser accepts for them, where there is no scheme in front.
 *
 * A parser reading one of these schemes treats a backslash as a slash, so
 * `https:/\host`, `https:\/host` and `https:\\host` all name `host` and so does
 * `\\host` on its own — measured against the platform's own parser, every one of
 * them resolves off this origin. Three of those four are written out here.
 *
 * The fourth, both characters leaning the other way, is left out where a quote is
 * what tells this from a comment, and the reason is a measurement rather than a
 * preference: this viewer's own escape writer puts exactly that pair after a
 * quote in front of an ordinary letter, three times in one served file, so
 * looking for it there refuses lines that name nothing at all. It is left in
 * where the scheme is written, because a line carrying one of these schemes is
 * not that construct. The half that is given up is named at the top of this
 * module and carried by the known-miss fixture rather than left to be found.
 *
 * The deleted characters sit between the pair here as well. What sits after the
 * quote in the pattern that uses this is the wider trimmed set, for the reason
 * beside that one.
 */
const SLASHES = `(?:\\/${STRIPPED}\\/|\\/${STRIPPED}\\\\|\\\\${STRIPPED}\\/)`;

/**
 * What a host cannot begin with.
 *
 * This used to be the other way round — an allow-set of the letters, digits and
 * the one bracket a host was expected to start with — and an allow-set is the
 * same mistake the endings were: a claim about a parser written as a list.
 * Measured against `new URL`, an underscore, a third slash, a percent-encoded
 * first letter and a name written in another script all begin a host that
 * resolves somewhere else, and every one of them was admitted.
 *
 * So the question is inverted here too. Every character in the printable range
 * and a sample outside it was written after the two slashes and swept against the
 * parser, in five continuations each, and exactly two of them cannot begin a host
 * however the rest of the line reads: the one that starts a query and the one
 * that starts a fragment. Both end the authority immediately, and a destination
 * with no host at all is not a destination this scan is about. Everything else
 * is refused.
 */
const HOST_START = '[^#?]';

/**
 * A destination this page may not name.
 *
 * Two shapes. A destination carrying a scheme, in either case, that is not one of
 * the admitted spellings written whole between matching quotes. And a destination
 * that leaves the scheme out and borrows the page's — matched only where a line
 * scan can tell one from the two characters that open a comment, which is
 * immediately after a quote.
 *
 * A resource named from inside a stylesheet used to be the third shape here and
 * is a rule of its own now, declared for stylesheets and for nothing else. Read
 * over every file it was a false refusal waiting to happen: the name it looks for
 * is also the name of the constructor a script builds a destination with, so an
 * ordinary `new URL(` in a served module would have been reported as a resource
 * this page pulls in. Nothing under `site/` writes one today, which is the only
 * reason that was still a latent fault rather than a wrong answer.
 *
 * Built rather than written out once, because there are three of these and they
 * differ in exactly one thing: what they admit. The narrowest is the one every
 * served file is read with; the other two are the narrowest plus the one
 * position their own file has, and each is named under that file in `patternIn`
 * below. Three spellings of this expression would be three things to keep in
 * step, and the two that admit more would be the ones nobody was reading.
 *
 * @param {string} admitted
 * @returns {RegExp}
 */
function externalUrl(admitted) {
  return new RegExp(`(?!${admitted})${SCHEME}|${QUOTE}${TRIMMED}${SLASHES}${HOST_START}`);
}

/**
 * What every served file is read with: the four spellings admitted between
 * matching quotes, and nothing else.
 *
 * The floor of the set, and the one an unrecognised file gets. Neither position
 * of the share API is in here, so a file this scan has not been told about is a
 * file that refuses the share API outright.
 */
const EXTERNAL_URL = externalUrl(QUOTE_ADMITTED);

/** The above, plus the one line of the origin table's module that may carry the share API. */
const EXTERNAL_URL_IN_ORIGIN_TABLE = externalUrl(`${QUOTE_ADMITTED}|${ORIGIN_TABLE_ADMITTED}`);

/** The above, plus the one line of the entry document that may carry it. */
const EXTERNAL_URL_IN_ENTRY_DOCUMENT = externalUrl(`${QUOTE_ADMITTED}|${ENTRY_DOCUMENT_ADMITTED}`);

/**
 * A named member of a named object, in the three spellings that reach it without
 * computing anything.
 *
 * The plain dot, the optional chain, and a key written out in quotes — reached
 * directly or through an optional chain of its own. A key that is not written
 * out is not here and cannot be: a computed key is a value, and this reads text.
 *
 * @param {string} owner
 * @param {string} member
 * @returns {string}
 */
function memberPattern(owner, member) {
  return (
    `\\b${owner}\\s*\\??\\.\\s*${member}\\b` +
    `|\\b${owner}\\s*(?:\\?\\.)?\\s*\\[\\s*${QUOTE}\\s*${member}`
  );
}

/** @type {readonly Rule[]} */
export const RULES = [
  {
    id: 'innerHTML',
    files: ANY,
    pattern: /\binnerHTML\b/,
    why: 'assigns markup instead of text',
  },
  {
    id: 'outerHTML',
    files: ANY,
    pattern: /\bouterHTML\b/,
    why: 'assigns markup instead of text',
  },
  {
    id: 'insertAdjacentHTML',
    files: ANY,
    pattern: /\binsertAdjacentHTML\b/,
    why: 'parses a string as markup',
  },
  {
    id: 'document.write',
    files: ANY,
    pattern: /\bdocument\s*\.\s*write(?:ln)?\s*\(/,
    why: 'parses a string as markup',
  },
  {
    id: 'eval',
    files: ANY,
    // No lookbehind: `window.eval(...)` is eval, and so is the indirect
    // `(0, eval)` form, which is why `)` and `,` count as well as `(`. A
    // dot-prefixed false positive costs nothing; the hole cost everything.
    pattern: /\beval\s*[(),]/,
    why: 'executes a string as code',
  },
  {
    id: 'Function-constructor',
    files: ANY,
    // The first alternative is contained in the second and is kept for reading
    // rather than for reach: every line the `new Function(` branch matches
    // carries `Function` followed by optional whitespace and `(`, which is
    // exactly what `\bFunction\s*[(),]` matches, so deleting the first branch
    // leaves the same set of lines refused. It is a redundancy on purpose — the
    // constructed form is the one a reader looks for — and it is written down
    // because a redundant alternative is otherwise indistinguishable from an
    // alternative that has quietly stopped mattering.
    pattern: /\bnew\s+Function\s*\(|\bFunction\s*[(),]/,
    why: 'executes a string as code',
  },
  {
    id: 'javascript-url',
    files: ANY,
    pattern: /javascript\s*:/i,
    why: 'a URL that executes code',
  },
  {
    id: 'inline-event-attribute',
    files: MARKUP_FILES,
    // The separator is deliberately wide: `<img src=x/onerror=...>` needs no
    // whitespace before the attribute name. This also matches `once=`, which is
    // a false positive worth keeping — false positives are an argument, holes
    // are an incident.
    pattern: /[\s/'"]on[a-z]+\s*=/i,
    why: 'an inline event handler is script in an attribute',
  },
  {
    id: 'event-handler-property',
    files: SCRIPT_FILES,
    pattern: /\.\s*on[a-z]+\s*=(?!=)/i,
    why: 'assigns a handler by property instead of addEventListener',
  },
  {
    id: 'html-string-parsing',
    files: ANY,
    pattern:
      /\bDOMParser\b|\bparseFromString\s*\(|\bcreateContextualFragment\s*\(|\bsetHTMLUnsafe\b|\bparseHTMLUnsafe\b/,
    why: 'parses a string as markup',
  },
  {
    id: 'style-construction',
    files: ANY,
    // Four shapes: the whole style object, `cssText`, `setProperty`, and any
    // single property. Assigning `el.style` outright is the one a careless
    // author reaches for first, and it was the one missing.
    pattern:
      /\.\s*style\s*=(?!=)|\.\s*style\s*\.\s*cssText|\.\s*style\s*\.\s*setProperty\s*\(|\.\s*style\s*\.\s*[A-Za-z_$][\w$]*\s*=(?!=)/i,
    why: 'builds a style from a value',
  },
  {
    id: 'setAttribute',
    files: ANY,
    // Every attribute write, not only the URL-bearing ones. Attributes are where
    // URLs, styles and handlers live, and enumerating the dangerous names is a
    // game the enumerator loses. The sanctioned route is property reflection —
    // `el.id`, `el.hidden`, `el.role`, `el.ariaLive`, `el.inputMode` and the
    // like — which is typed, non-generic, and cannot be handed an attribute name
    // computed at runtime; `clean/clean.js` in the fixture corpus shows the
    // idiom. If a genuine need for this ever arises, the rule changes with it,
    // in a reviewed change, in public.
    pattern: /\bsetAttribute(?:NS)?\s*\(/,
    why: 'writes an attribute from a value',
  },
  {
    id: 'object-assign',
    files: ANY,
    // Copies properties onto a target without naming any of them, so it reaches
    // `href`, `src` and every handler property while matching none of the rules
    // that look for those names.
    pattern: /\bObject\s*\.\s*assign\s*\(/,
    why: 'copies unnamed properties onto an object',
  },
  {
    id: 'url-property-assign',
    files: ANY,
    // The properties that carry a destination, named one by one. Unlike the rule
    // above this one is an enumeration, and an enumeration is a list somebody has
    // to keep up — the same game the attribute-setting rule says the enumerator
    // loses, played here because the sanctioned route into this page's markup is
    // property reflection and there is nothing narrower to refuse. So this is the
    // destination-carrying properties anyone has written down, not every property
    // that could carry one.
    //
    // `ping` is on the list because it is the one of them this page's own markup
    // exposes. An anchor carrying it sends a request to wherever it names the
    // moment the link is used, which is a measurement of the recipient rather
    // than a resource the page needs, and the destination can be relative — so
    // the rule that reads destinations would not see it either.
    pattern: /\.\s*(?:href|src|srcset|imagesrcset|srcdoc|action|formAction|ping)\s*=(?!=)/i,
    why: 'builds a URL from a value',
  },
  {
    id: 'srcdoc',
    files: ANY,
    pattern: /\bsrcdoc\b/,
    why: 'embeds a document as a string',
  },
  {
    id: 'object-url',
    files: ANY,
    pattern: /\bURL\s*\.\s*createObjectURL\s*\(/,
    why: 'mints a URL for content held in the page',
  },
  {
    id: 'navigation',
    files: ANY,
    // The bare `open(` alternative is not anchored to `window` because the
    // global is callable unqualified. It is excluded after `.` so ordinary
    // method calls on unrelated objects do not match.
    pattern:
      /\blocation\s*\.\s*(?:assign|replace)\s*\(|\blocation\s*=(?!=)|\bwindow\s*\.\s*open\s*\(|(?<![.\w$])open\s*\(/,
    why: 'navigates to a constructed destination',
  },
  {
    id: 'string-timer',
    files: ANY,
    pattern: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/,
    why: 'executes a string as code',
  },
  {
    id: 'active-element-creation',
    files: ANY,
    // `style` belongs here: a style element's text content is CSS, and CSS built
    // from a value is an injection sink of its own.
    pattern: /createElement\s*\(\s*['"`]\s*(?:script|iframe|object|embed|link|base|meta|form|style)/i,
    why: 'creates an element that fetches, executes, or carries CSS',
  },
  {
    id: 'dynamic-import',
    files: ANY,
    pattern: /(?<![.\w$])import\s*\(/,
    why: 'loads a module from a computed specifier',
  },
  {
    id: 'network-egress',
    files: ANY,
    // Every other rule here is about what arrives — markup parsed, code run, a
    // URL built. This one is about what leaves, which is a different question
    // and was not being asked at all.
    //
    // The link capability is in the fragment, and the fragment never reaches a
    // server on its own. One line sending it somewhere is all it takes for that
    // to stop being true: a beacon fires during unload and returns nothing a
    // caller has to read, so it leaves no result to notice and no error to
    // handle. The viewer imports nothing, talks to nobody, and fetches only what
    // its own module graph names — so a network call in a served file is not a
    // feature written carelessly, it is a feature this viewer does not have.
    //
    // Four names, and a list of names is the most fragile shape a rule here has:
    // any one can go with the other three still firing, which is why the
    // self-test names each spelling separately rather than asking whether the
    // rule fired.
    //
    // All four are matched as names rather than as calls, so a captured
    // reference is refused along with a call. None of them is ordinary English,
    // none of them is spelled anywhere under `site/`, and a captured beacon in
    // particular is the one whose call site is easiest to put where a line scan
    // is not looking.
    //
    // The cost of matching a name rather than a call, said rather than left to
    // be discovered: `const sendBeacon = false;` is refused, and so is a comment
    // that mentions the word. Neither sends anything anywhere. That is the same
    // trade every tripwire in this file makes — the rule is that the word does
    // not appear under `site/`, not that a particular occurrence of it is live.
    //
    // The one name that used to be here and is not is `fetch`, which now has a
    // rule of its own for one reason: the viewer has exactly one file that is
    // allowed to make a request, so `fetch` is a construct with a place rather
    // than a construct with none, and a rule that admits it everywhere or
    // nowhere cannot say that. See `network-request` below.
    //
    // What this cannot do is decide anything. It is a lexical tripwire like the
    // rest of this file — it reads lines, not data flow, and every miss listed
    // at the top of this module applies to it exactly as much. `navigator['sendBeacon']`
    // is one of them, name match or no name match. The control that actually
    // holds at runtime is CSP `connect-src`, which the page carries itself as
    // `'self'` and the one share API the committed table sends a page to — two
    // entries in that table, and the second is the one whose key and value are
    // different origins — and which a browser test drives a real refusal under.
    // This is the same requirement asserted at the earliest point it can be
    // asserted, where it costs one line and catches the accident.
    pattern: /\bsendBeacon\b|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/,
    why: 'sends data off the page',
  },
  {
    id: 'network-request',
    files: ANY,
    // The one construct in this file that is allowed somewhere, which is why it
    // is a rule of its own rather than a name in the list above.
    //
    // The viewer makes two requests and both are written in one module. That is
    // a design decision, and a scan is the only thing that can hold it: a
    // request written into the renderer, or into the parser, would be a request
    // nothing about the module graph would notice. So the construct is refused
    // in every served file except the one it belongs in, and the file it belongs
    // in is named here rather than marked at the call site — there is no
    // suppression mechanism in this scan and this is not one. Moving the
    // exception is an edit to this line, in public.
    //
    // Anchored to the call, unlike the four names above, because `fetch` is
    // ordinary English and this project's prose will want the word. That is the
    // trade, and it is a real hole rather than a tidy one: a captured reference
    // with no call on the line goes through, which the known-miss fixture
    // carries and the self-test asserts is still missed. A call with a space
    // before its parenthesis does not, which the violations fixture carries.
    //
    // What is not held here at all is how many requests the permitted file
    // makes, or where they go. The first is held beside this scan:
    // `countNetworkCallSites` counts the call sites in that one file.
    //
    // The second is not held by anything in this file, and the sentence here
    // used to say it was — that `config.js` decides the destination. That is
    // what the viewer is built to do rather than something read anywhere: a
    // request built from a literal at its own call site is a request `config.js`
    // has no part in, and every spelling of one that this scan cannot see is
    // listed at the top of this module. What holds it is the browser suite,
    // which reads the ORIGIN of every request each surface drives and the PATH
    // of every request of a whole run, and refuses one that left the page's own
    // origin. And what holds at runtime, for a request no test drives, is CSP
    // `connect-src`, which is in this repository rather than around it: the page
    // carries the fetch-class policy itself, written into `index.html` and pinned
    // by the browser suite, which also drives a refusal under it. The directives
    // a page cannot carry arrive with the deploy configuration instead. A scan
    // reads lines.
    exceptFiles: ['site/js/flow.js'],
    pattern: /\bfetch\s*\(/,
    why: 'sends data off the page from a file that is not the one that may',
  },
  {
    id: 'console-output',
    files: ANY,
    // This page is built to say nothing on any output channel, and that is held
    // where it can be held: the browser suite collects the messages the page
    // produces, of every type, while each surface is driven, and requires there
    // to be none the browser did not write itself. Those readings are the
    // control. This is a tripwire beside them rather than a second proof of the
    // same thing: a page can be made to speak without this word ever appearing,
    // and a file can carry the word and never run the line it is on. What this
    // catches is the accident — a line left in while something was being worked
    // out, on a branch no test drives.
    //
    // Matched as a name rather than as a call, so the dotted member, the
    // computed member, the bare global read and a captured alias are one word to
    // it. Those four are the same reach written four ways, and anchoring to the
    // call would let three of them through.
    //
    // Its misses are the ones at the top of this module rather than any of its
    // own: a name assembled at runtime reaches the same object without spelling
    // it, an identifier written with a unicode escape is not this word to a text
    // comparison, and a computed key needs neither. It reads lines, so all three
    // walk past it.
    //
    // The cost is the one every name-matched rule here pays: the word cannot be
    // written under `site/` at all, including in prose about not writing it, and
    // this rule is not exempt from itself. The served files are written
    // accordingly.
    //
    // And it is not about output the page did not write. A request that failed,
    // a script that threw, a policy the browser enforced — those lines are the
    // browser's own, they are written whatever a served file says, and nothing
    // in a scan of source text has any reach over them.
    pattern: /\bconsole\b/,
    why: 'writes to an output channel',
  },
  {
    id: 'persistence',
    files: ANY,
    // Nothing this viewer holds may outlive the page holding it.
    //
    // A share is a link and a code, and the whole design is that a recipient's
    // browser keeps neither afterwards. Every name here is a place something
    // could be kept: a store that survives the tab, a store that survives the
    // navigation, a database, a cookie, a response cache, a worker that outlives
    // the document, a cookie store, a quota to ask about. One line using any of
    // them turns a viewer that forgets into a viewer that remembers, and the
    // difference would not be visible in anything the page draws.
    //
    // Matched as names, and comments are not exempt, so the words cannot be
    // written under `site/` at all — including in prose about not using them.
    // The served files are written accordingly.
    //
    // Six of the eight are one word and are matched as that word, so every way
    // of reaching them is the same line to this rule. The other two are a member
    // of an object whose own name is ordinary — a document and a navigator are
    // written all over a viewer — so they are matched as the pair, and a pair
    // has spellings. Three are written out for each: the plain dot, the optional
    // chain, and the key in quotes, reached directly or through a chain of its
    // own. A dot was the only one of the three this rule had, and the other two
    // are the same property reached without one.
    //
    // A tripwire and not a proof. This reads lines, so what it cannot see is a
    // key that is not written down: `document[name]` reaches the cookie jar
    // without the word being anywhere on the line, exactly as the paragraph at
    // the top of this module says of every rule here, and so does a name
    // assembled a character at a time. What holds at runtime is the absence of
    // any code that wants these, and review. The policy the page carries is not
    // what holds this one: it governs what the page fetches and where it may
    // send, and says nothing about what the page keeps.
    pattern: new RegExp(
      '\\blocalStorage\\b|\\bsessionStorage\\b|\\bindexedDB\\b|\\bcaches\\b|\\bserviceWorker\\b|\\bcookieStore\\b' +
        `|${memberPattern('document', 'cookie')}|${memberPattern('navigator', 'storage')}`,
    ),
    why: 'keeps something after the page is gone',
  },
  {
    id: 'timing-api',
    files: ANY,
    // The one copy of the link this page cannot take away from itself.
    //
    // The first thing the entry point does is read the fragment off the address
    // bar and rewrite the address without it, and `main.js` says what that buys
    // and what it does not: the browser keeps its own record of the address this
    // document was loaded from, fragment and all, for as long as the document is
    // alive, and nothing the platform offers clears it. So the capability that
    // opens a share is still readable from inside the page after the scrub, by
    // one interface, and a served file that reached for it would be reading the
    // link back out of the very place the scrub was for — after which it is a
    // value in a variable, and a value in a variable can be put into a request.
    //
    // Nothing under `site/` reads it, and this is the line that says so keeps
    // being true. It costs nothing today: the word is written nowhere in the
    // served tree, and the two sentences in `main.js` that are about this entry
    // name it as the navigation timing entry and the timing API rather than by
    // the name below, which is why they are not refused by their own tripwire.
    // Anything written there later has to keep doing that, exactly as the served
    // files already avoid the words the output and persistence rules refuse.
    //
    // Three spellings, and they are three reaches rather than three ways of
    // writing one: the object itself, by name — which is how every entry is
    // reached, whether through the global, a member of the window, or an alias —
    // the reading that returns the entries, in each of the ways it is spelled,
    // and the observer that is handed them as they arrive without anything ever
    // asking for them. Any one of the three could stop matching with the other
    // two still firing, so the self-test names each separately.
    //
    // The interface's own name, written with a capital and reached through its
    // prototype, is not the object and is not read here on its own — what a line
    // doing that would be reaching for is the entries, which the second
    // alternative names in every spelling it has.
    //
    // A LEXICAL TRIPWIRE, like everything in this file. Its misses are the
    // families at the top of this module and not any of its own: a name
    // assembled at runtime, an identifier written with an escape, a member
    // reached through a key nobody wrote down. What holds at runtime is that the
    // viewer has no code that wants any of this, and the reading in the browser
    // suite that requires every request it drives to name this page's own
    // origin.
    pattern: /\bperformance\b|\bgetEntries|\bPerformanceObserver\b/,
    why: 'reads the address this page was loaded from back out of the browser',
  },
  {
    id: 'external-url',
    files: ANY,
    // Where this page can point.
    //
    // One construct in two spellings: a destination written into a script or a
    // document, carrying its own scheme or borrowing the page's. The viewer is
    // first-party bytes and nothing else — no font, no image, no analytics
    // endpoint, no third-party anything — and a destination it names is how the
    // first of those would arrive. A resource pulled in from inside a stylesheet
    // is the same requirement written somewhere else, and it is the rule below
    // this one, declared for the files it can be written in.
    //
    // Five destinations are admitted, and they are the five this viewer has: the
    // app on the store, the privacy policy, the origin the development server
    // and the browser suite run on, the address the hosted development viewer is
    // served from, and the share API a page served from that address talks to.
    // The alternation that admits them is built from `ALLOWED_URLS` above rather
    // than written out a second time here, so the spellings this refuses to
    // refuse and the spellings the check beside it looks for cannot be two
    // different lists. They are in a reviewed file rather than annotated at
    // their call sites, for the reason every allowance in this file is: a
    // suppression at a call site is a suppression.
    //
    // Each is admitted whole, and that is the difference between an allowance
    // and a prefix. A destination that begins with one of the five and carries
    // on is a different destination — a campaign token on the end of the store
    // link is the clearest case, and a campaign token is the one thing that link
    // is built not to have. So four of them are admitted where they are written
    // between a matching pair of quotes and end at the closing one, and refused
    // wherever anything at all is written after them on the same line, which is
    // what `QUOTE_ADMITTED` above sets out and why it is written that way round.
    // On the same line, and inside the one string: a destination whose second
    // half is a second string, joined to the first once something has run, is a
    // destination no reading of either string can see, and that is a named miss
    // rather than something this covers.
    //
    // The fifth is admitted per position instead of per quote, and the whole of
    // why is beside `ORIGIN_TABLE_ADMITTED` and `ENTRY_DOCUMENT_ADMITTED` above,
    // which are the two positions and the two declarations. In short: it belongs
    // in two
    // files rather than one, and in the entry document it sits inside a policy
    // attribute where there is no quote on either side of it — so the generic
    // admission could not reach it there, and widening the generic admission to
    // reach it would have admitted the same spelling as an ordinary quoted
    // attribute anywhere in that file, which is a link to the share API standing
    // in for the permission to reach it with every count below still satisfied.
    //
    // The scheme is part of the spelling for the same reason. The store link is
    // https and the development origin is http; swapping them names something
    // else. And the scheme is matched whatever case it is written in, because a
    // browser reads a scheme case-insensitively while a comparison does not —
    // the admitted spellings are lower case, so an upper-case one is a
    // destination that is not among them.
    //
    // Whichever way the two characters after the scheme lean. A parser reading
    // one of these schemes treats a backslash as a slash, so three spellings
    // that are not two forward slashes name a host just as well, and all three
    // are read here: the scheme is what tells this construct from anything else
    // on the line, so nothing has to be given up to reach them.
    //
    // And whatever a parser takes out before it reads any of it. Three characters
    // are deleted from the whole of an address — a tab, a line feed and a
    // carriage return — so they can sit between the letters of the scheme,
    // between the colon and the characters after it, or between those two, and
    // `https:/⇥/host` names `host` exactly as the spelling without the tab does.
    // A reading that required each of those characters to be next to the next one
    // admitted every one of those spellings. `STRIPPED` above is written into
    // each of those joins, and what a parser trims off the FRONT of an address is
    // a wider set again — every C0 control and the space — which is `TRIMMED`,
    // written after the quote the second shape below is anchored to.
    //
    // What is NOT reached is the same construct with fewer than two of those
    // characters. A parser takes what follows one of these schemes as the part
    // naming a host whether the pair is written, half written, or left out
    // entirely, so `https:/host` and `https:host` both name `host` from a page
    // that was not itself served over `https` — and from one that was, the same
    // two spellings are read as relative to the page, with the host landing in
    // the path on this very origin. So the shape names somewhere else under one
    // scheme and nowhere new under the other, which is why the known-miss
    // fixture carries a line for each of the two rather than one line spoken
    // about as though it held for both. Reaching either
    // means matching a scheme and its colon and nothing else, which refuses
    // every line that so much as mentions one. That is a cost to a reader rather
    // than a pattern to widen quietly, so the shape is named at the top of this
    // module and carried by the known-miss fixture instead.
    //
    // A destination can also leave the scheme out and borrow the page's, which
    // is two slashes and a host. Those two characters also open a comment in
    // every script this scans, so this reads them only where the two can be told
    // apart: after a quote, which is where a destination is written and where a
    // comment is not. After a quote and after anything a parser would trim off
    // the front, which is the same thing to a parser and was not to this — a
    // space between the quote and the pair was admitted, and resolved off this
    // origin. What may follow the pair is `HOST_START` above,
    // which is written as a refusal rather than as a list of the characters a
    // host was expected to start with — an underscore, a third slash, a
    // percent-encoded letter and a name in another script each begin a host that
    // resolves somewhere else, and an allow-set admitted all four.
    //
    // Two spellings of that second shape are misses, and they are named at the
    // top of this module and carried by the known-miss fixture rather than left
    // to be discovered. An attribute written into markup with nothing quoted
    // around it has no quote for this to read. And of the three leaning
    // spellings a browser accepts, the one where BOTH characters lean the other
    // way is not looked for here: the pair that would find it is a pair this
    // viewer's own escape writer puts after a quote in front of an ordinary
    // letter, so looking for it refuses lines that name nothing at all —
    // measured, on `flow.js`, where the writer that escapes a code a recipient
    // typed is written exactly that way, on three lines. The other two leaning
    // spellings cost nothing and are read.
    //
    // The allowance is by spelling, and for four of the five it says nothing at
    // all about which file the spelling appears in. What says that is
    // `countAllowedUrls` beside this scan, which reads the served tree and
    // requires each of the five to appear exactly once in each file it belongs
    // to and nowhere else — four of them in one file each, and the share API in
    // two. Neither half is the other's proof, and neither is proof that the page
    // fetches nothing else — a lexical scan reads lines, and the control that
    // holds at runtime is CSP at the origin.
    pattern: EXTERNAL_URL,
    // And the two files that are read with one more admission than that. The
    // share API belongs in both of them and nowhere else, and inside each it
    // belongs on one line: `patternIn` is what makes "at two positions" a claim
    // about positions rather than about bytes that could be typed anywhere.
    // Every other served file — and every file in every fixture and scratch tree
    // this scan is ever pointed at — is read with `pattern` above, which admits
    // neither.
    patternIn: Object.freeze({
      [ORIGIN_TABLE_FILE]: EXTERNAL_URL_IN_ORIGIN_TABLE,
      [ENTRY_DOCUMENT_FILE]: EXTERNAL_URL_IN_ENTRY_DOCUMENT,
    }),
    why: 'names something outside this page',
  },
  {
    id: 'stylesheet-resource',
    files: STYLESHEET_FILES,
    // A resource pulled in from inside a stylesheet.
    //
    // The same requirement as the rule above, written where a stylesheet writes
    // it. A font, an image, a cursor, a mask: each of them is named by one
    // function call in a declaration, and each puts a request on the wire that no
    // module imported and no element in the page names.
    //
    // A stylesheet is the one of those this does NOT reach, and it is worth
    // saying rather than leaving in a list. Another stylesheet is pulled in by a
    // rule of its own rather than by a function — `@import "/x.css";` needs no
    // call at all — so a line writing one goes past this. That is an alternative
    // this rule could grow; what closes it for the file this project actually
    // serves is the pin on that file's bytes, and what would close it anywhere
    // else is CSP at the origin.
    //
    // Matched in whatever case the function is written, because a browser reads
    // it in any of them: each of the three letters is read either way, so all
    // eight spellings are refused and `URL(` and `Url(` pull in the resource
    // `url(` does.
    //
    // Declared for stylesheets and for nothing else, and that narrowing is a
    // correction rather than a convenience. This alternative sat in the rule
    // above, which reads every file, and the name it looks for is also the name
    // of the constructor a script builds a destination with — so an ordinary
    // `new URL(` in a served module would have been reported as a resource this
    // page pulls in. No served module writes one today, so the wrong answer was
    // latent rather than live; the scope is what stops it being either.
    //
    // A tripwire and not a proof, like everything here. It reads a line, so a
    // declaration assembled by a custom property, or a function name written with
    // an escape, is outside it — those are instances of the families the
    // paragraph at the top of this module lists. What holds at runtime is CSP at
    // the origin.
    pattern: /\b[Uu][Rr][Ll]\s*\(/,
    why: 'pulls a resource into the page from a stylesheet',
  },
  {
    id: 'stylesheet-content',
    files: STYLESHEET_FILES,
    // Text written into the page by a stylesheet.
    //
    // Every other rule here is about a script or a document. This one is about
    // the one served file that can change what the page says without touching a
    // node, a text node, or a string constant: a generated-content declaration on
    // a pseudo-element writes a sentence into a surface, and no reading of the
    // document's text can see that it was written.
    //
    // Which makes this the structural half of a pair. The bytes of the shipped
    // stylesheet are pinned whole by the suite, and that pin is what actually
    // closes the channel for the file this project serves — including the half
    // this pattern cannot reach, where a declaration takes text off the screen
    // rather than putting text on it. This rule is what a second stylesheet, or a
    // first draft of one, meets before it ever gets that far.
    //
    // A LEXICAL TRIPWIRE, and nothing more. It says nothing about whether the
    // notice a recipient reads is the notice that was agreed — the pin on the
    // stylesheet's bytes and the pin on the rendered notice are what say that.
    //
    // Read in whatever case the property is written, because a stylesheet reads a
    // property name that way and a text comparison does not: `CONTENT:` writes
    // the same sentence into the same place, measured in both engines this suite
    // runs, and a case-sensitive reading admitted it.
    //
    // Anchored so that it is this property rather than any property ending in the
    // word. `align-content`, `justify-content` and `place-content` are ordinary
    // layout properties whose names end in it, and a word boundary does not tell
    // them apart from it, because the character in front is a hyphen — which is
    // still the character in front of it when the name is read in any case.
    //
    // Its misses are the families the paragraph at the top of this module lists —
    // a property name spelled with an escape, a declaration assembled through a
    // custom property, one written by a script rather than a stylesheet — and one
    // more that is worth naming here rather than leaving to be found: a comment
    // written between the property's name and its colon. `content/**/:` declares
    // generated content in both engines, measured, and this reads a line rather
    // than parsing a stylesheet, so it does not see it. Tolerating a comment there
    // is not the small fix it looks like: `align-content/**/:` is an ordinary
    // layout declaration in both engines too, and the hyphen that tells the two
    // apart stops being the character in front of the word as soon as a comment
    // may sit there. So this is a line scan meeting the thing a line scan cannot
    // do, and the stylesheet's bytes are pinned whole by the suite for exactly
    // that reason.
    pattern: /(?<![-\w])content\s*:/i,
    why: 'writes text into the page from a stylesheet',
  },
  {
    id: 'typecheck-suppression',
    files: ANY,
    // Not a sink, and here anyway. The typecheck step is pinned whole — both
    // configurations, every option — on the reasoning that the ways to turn a
    // checker off are not a list anyone finishes. A comment at the top of a
    // shipped module turns it off for that module without touching either
    // configuration, so the whole-configuration pin does not reach it and
    // nothing else was looking. This scan already reads every line of every
    // served file, which makes it the one place that reach exists.
    //
    // All three spellings the pattern names, including the one that is normally
    // the disciplined choice: the checked variant fails once the error it was
    // written for goes away, which makes it better practice than the blanket
    // pair — but "better" is not the question here. Nothing in `site/` may be
    // exempt from the checker, so the answer to a type error in a served file is
    // to fix the type error.
    //
    // Spelled once, in the pattern, and nowhere else in this repository's own
    // programs. This rule's reach now includes the modules the checks are made
    // of, which are read for it by `check-sinks-selftest.mjs`, and a scan for a
    // construct cannot tell the construct from a description of it. So the same
    // cost this file's other patterns impose on `site/` — that their vocabulary
    // cannot be written there — is now paid here as well, which is why the prose
    // above names none of the three.
    pattern: /@ts-(?:nocheck|ignore|expect-error)\b/,
    why: 'turns the type checker off for served code',
  },
];

/**
 * Every regular file under a directory, recursively.
 *
 * Anything that is not a regular file or a directory stops the scan rather than
 * being skipped, and that applies to the root as hard as it applies to anything
 * inside it. A symlink above all: it could point the scan at bytes that are not
 * the bytes being served, or quietly point it away from bytes that are. A scan
 * that skips what it cannot understand reports a clean result it has not earned.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function collectFiles(root) {
  const shownRoot = relative(REPO_ROOT, root) || root;

  /** @type {import('node:fs').Stats} */
  let rootStat;
  try {
    // lstat, not stat: stat follows a symlinked root and would scan through it.
    rootStat = lstatSync(root);
  } catch {
    throw new ScanError(`${shownRoot} does not exist`);
  }

  if (rootStat.isSymbolicLink()) {
    throw new ScanError(`the scan root is a symlink: ${shownRoot} — the scan must read the served bytes, not a link to them`);
  }
  if (!rootStat.isDirectory()) {
    throw new ScanError(`the scan root is not a directory: ${shownRoot}`);
  }

  /** @type {string[]} */
  const found = [];
  // Sorted so that a scan of one tree reports the same thing in the same order
  // wherever it runs. Nothing here depends on the order: the file count, the
  // count by extension and the set of violations are all the same set whatever
  // sequence the directory is read in, and every case that reads a violation
  // finds it rather than indexing to it. So no input separates this line from
  // the same line without the sort, and on a filesystem that already answers in
  // order — which is what this one does — nothing could separate them even in
  // principle. What it buys is a report two people can compare, which is a
  // property of the output rather than of the answer, and it is written down
  // here because that is the only place it can be said.
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const full = join(root, entry.name);
    const shown = relative(REPO_ROOT, full) || full;

    if (entry.isSymbolicLink()) {
      throw new ScanError(`symlink in the scanned tree: ${shown} — the scan must read the served bytes, not a link to them`);
    }
    if (entry.isDirectory()) {
      found.push(...collectFiles(full));
    } else if (entry.isFile()) {
      found.push(full);
    } else {
      throw new ScanError(`not a regular file or directory: ${shown}`);
    }
  }

  return found;
}

/**
 * @param {Rule} rule
 * @param {string} ext
 * @returns {boolean}
 */
function appliesTo(rule, ext) {
  return rule.files === ANY || rule.files.includes(ext);
}

/**
 * A path as this module names one: repository-relative, with forward slashes.
 *
 * @param {string} file
 * @returns {string}
 */
function shownPath(file) {
  return (relative(REPO_ROOT, file) || file).split('\\').join('/');
}

/**
 * Is this the one file a rule is not applied to?
 *
 * By whole path rather than by name, so a second `flow.js` somewhere else in the
 * served tree is not the file the exception is about.
 *
 * @param {Rule} rule
 * @param {string} shown A repository-relative path.
 * @returns {boolean}
 */
function exempt(rule, shown) {
  return rule.exceptFiles !== undefined && rule.exceptFiles.includes(shown);
}

/**
 * The pattern a named file is read with.
 *
 * By whole path, like the exemption above, and for the same reason: a second
 * `config.js` somewhere else in the served tree is not the file whose one line
 * may carry the share API.
 *
 * Own properties only. The lookup key is a path, paths are arbitrary text, and a
 * property read that answered for an inherited name would hand back whatever
 * `Object.prototype` has under `constructor` or `toString` — which is not a
 * pattern, and `.test` on it would throw or, worse, not. This is the same
 * reasoning the served origin table is written with, and it is here for the same
 * reason: the thing being looked up did not come from this file.
 *
 * Absent, misspelled, or a path this tree does not hold: `pattern`, which is the
 * narrowest of the set. Failing closed is the whole of why the exception is
 * written in this direction.
 *
 * @param {Rule} rule
 * @param {string} shown A repository-relative path.
 * @returns {RegExp}
 */
function patternFor(rule, shown) {
  if (rule.patternIn === undefined || !Object.prototype.hasOwnProperty.call(rule.patternIn, shown)) {
    return rule.pattern;
  }
  const found = rule.patternIn[shown];
  return found instanceof RegExp ? found : rule.pattern;
}

/**
 * The one served file that may make a request, and how many it may make.
 *
 * The scan refuses the construct everywhere else; nothing in the scan says how
 * many times it appears where it is allowed, and "somewhere" is not "twice". A
 * third request added to that module is a third thing this page sends, and it
 * should be a failure here rather than a line in a diff nobody counted.
 */
export const NETWORK_FILE = 'site/js/flow.js';

/** @see NETWORK_FILE */
export const NETWORK_CALL_SITES = 2;

/**
 * How many request call sites the permitted file carries.
 *
 * Counted the same way the rule matches, over the same bytes, including
 * comments — so the count is a count of the construct rather than a judgement
 * about which occurrences are live, exactly as every rule here is.
 *
 * @param {string} [root] The served tree.
 * @returns {number} The count, or `-1` when the file is not there.
 */
export function countNetworkCallSites(root = SHIPPED_TREE) {
  const file = collectFiles(root).find((one) => shownPath(one) === NETWORK_FILE);
  if (file === undefined) {
    return -1;
  }
  return (readFileSync(file, 'utf8').match(/\bfetch\s*\(/g) ?? []).length;
}

/**
 * Where the origin table sits inside the served tree, which is what the reading
 * below finds it by.
 *
 * The file itself is `ORIGIN_TABLE_FILE`, declared up with the rules because one
 * of them is about it.
 *
 * Two spellings of one file, and the difference is which root each is measured
 * from. The name above is repository-relative, which is how every path in this
 * module is reported and how a reader knows which file is meant. The reading
 * below is handed a served tree, which is this repository's `site/` when it is
 * asked about the real one and a scratch directory when a case is showing that
 * the reading reads — so the file has to be found by where it is inside
 * whichever tree that is.
 */
const ORIGIN_TABLE_IN_TREE = 'js/config.js';

/**
 * The name that table is declared under, which is part of what is read below.
 *
 * A rename is a change to the one table this reading is about, and a reading
 * that found whichever frozen object it happened to meet would follow a rename
 * onto some other object without saying so. So the name is written here, and a
 * file that no longer declares it is reported rather than read.
 */
const ORIGIN_TABLE_NAME = 'API_ORIGINS';

/**
 * The table the served module is required to be, entry for entry.
 *
 * A pin rather than an invariant, and the difference is the edit that produced
 * it. This reading used to hold a universal — every entry answers with itself —
 * which was true of a table with one key in it, written as one constant used as
 * both halves so the origin a page is served from and the origin it talks to
 * could not come apart. That universal was written for the moment a second
 * origin arrived, because that is the moment they can come apart, and the second
 * origin has now arrived: the hosted development viewer is served from one
 * address and its share API answers at another, so the entry that going live
 * actually needed is an entry the old universal refuses.
 *
 * A universal that has to be relaxed to admit the change it was written for
 * stops being a control. So what replaced it is the table written out: these
 * entries, these destinations, and nothing else. Any missing entry, any extra
 * entry, any different destination is a failure that names what it found — in
 * the bytes this reading can see.
 *
 * That last clause is the whole of what this pin is now, and it is worth being
 * plain about the demotion. "These entries and no others" is a claim about a
 * program, and this reads text: four times over, a table was written so that
 * what an engine evaluates and what a reading of the file sees were different
 * things, and each time this pin was green about a table it had not read. The
 * completeness claim therefore lives at the self-test's runtime layer, which
 * imports the served module and compares the EVALUATED table against the same
 * written-out entries. What survives here is the reviewability claim, and it is
 * a real one: these are the bytes a reviewer reads in a diff, this refuses every
 * departure it can see in them, and it says "cannot read" rather than guessing
 * about the shapes it cannot. Both are needed — a table nobody can review is not
 * fixed by evaluating correctly today.
 *
 * That answers the one-word slip the universal was for, and answers it more
 * exactly. `{ [VIEWER]: SOMEWHERE_ELSE }` sends every recipient's access code to
 * whatever `SOMEWHERE_ELSE` is; under a self-equality rule it was refused
 * because the two halves differed, which is a rule that would also have refused
 * the correct entry above. Under this it is refused because the destination is
 * not the one destination that key has, which is the thing actually worth
 * refusing.
 *
 * Spellings from the constants above rather than written out again here, so the
 * table this pins and the spellings the scan admits are one list.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ORIGIN_TABLE = Object.freeze({
  [LOOPBACK_ORIGIN]: LOOPBACK_ORIGIN,
  [HOSTED_DEVELOPMENT_ORIGIN]: HOSTED_DEVELOPMENT_API_ORIGIN,
});

/**
 * Every entry of that table, and every way it is not the table pinned above.
 *
 * What this exists for is one edit, and the edit has now been made. The rule set
 * above reads spellings and cannot see it: every one of these strings is an
 * admitted destination in the file it is admitted in, and `countAllowedUrls`
 * beside it would find each of them once, in `config.js`, exactly as it is
 * required to. Neither of those readings looks at which key a destination is
 * written under, which is the only thing that decides where a share code goes.
 *
 * So this reads the table as source, in the tree that is served, the way
 * `countAllowedUrls` reads the same file for the same reason: what the shipped
 * bytes say rather than what a module hands back when it is imported and asked
 * the questions somebody thought of.
 *
 * Read rather than parsed as a language. The table is one frozen object literal
 * of entries whose two halves are each either a quoted string or the name of a
 * string constant declared in the same file, which is what the served file
 * writes and what a reviewed change to it may write. Anything else — an entry
 * this cannot take apart, a name it cannot resolve, a table it cannot find — is
 * reported as a reason rather than skipped, so a table written in a shape this
 * does not read is a failure to read it and not a table with nothing wrong.
 *
 * @param {string} [root] The served tree.
 * @returns {{ entries: { key: string, destination: string }[], failures: string[] }}
 */
export function readApiOrigins(root = SHIPPED_TREE) {
  /** @type {string[]} */
  const failures = [];
  /** @type {{ key: string, destination: string }[]} */
  const entries = [];

  const file = collectFiles(root).find(
    (one) => relative(root, one).split('\\').join('/') === ORIGIN_TABLE_IN_TREE,
  );
  if (file === undefined) {
    failures.push(`${ORIGIN_TABLE_FILE} is not in the served tree, so where this page may talk to is unknown`);
    return { entries, failures };
  }

  const text = readFileSync(file, 'utf8');

  /**
   * How many times each name in the file is declared, and — separately, below —
   * what the ones declared as a quoted string hold.
   *
   * The count is the point of it, and it is asked of the left-hand side alone:
   * `const`, `let` or `var`, the name, the `=`. This reads raw text and text
   * includes
   * comments — paragraph 2 at the top of this module says so about every rule
   * here — so "the value of NAME" is a question with more than one answer in a
   * file where the name is declared twice, and the answer this used to give was
   * whichever came last. That is not a tie-break, it is the wrong reading: a
   * module declaring the constant WRONG in code and RIGHT again inside a block
   * comment resolved to the commented spelling, and this reported a table it had
   * not read. Measured, on this file — the pin was green, entry for entry, while
   * the module sent a hosted viewer's share codes to the loopback.
   *
   * So the count is kept and a name written more than once resolves to nothing
   * at all.
   *
   * Counted across the whole file, by the left-hand side, for `const`, `let` and
   * `var` alike. What a second declaration MEANS is deliberately not guessed at:
   * it can be dead, commented out, in another scope, or the one that runs — and
   * which of those it is, is exactly what a reading of text cannot say. Refusing
   * to resolve the name is the answer that does not require knowing.
   */
  /**
   * How many times each name is declared, whatever it is declared AS.
   *
   * Counting and reading are two questions and this is the counting one. It was
   * one question, asked with the pattern that reads a quoted string, and that is
   * a net with a hole exactly the shape of every other way to write a
   * declaration: a live `const NAME = SOME_OTHER_NAME;` beside a commented
   * `const NAME = 'the right spelling';` was ONE literal declaration by that
   * count, so the name resolved to the commented spelling and nothing anywhere
   * said otherwise. Measured, on this file — scan green, every reading green,
   * and the module sending a hosted viewer's share codes to the loopback.
   *
   * So this counts a declaration by its left-hand side alone: the keyword, the
   * name, the `=`. What follows is not looked at, because what follows is
   * exactly what the hole was made of — an identifier, a template literal, a
   * call, a concatenation, anything somebody writes next is a declaration of
   * that name whether or not this file can read its value.
   *
   * `let` and `var` as well as `const`, for the same reason: the question is how
   * many times the name is written down, not how firmly.
   */
  /** @type {Map<string, number>} */
  const declaredTimes = new Map();
  for (const found of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    const name = String(found[1]);
    declaredTimes.set(name, (declaredTimes.get(name) ?? 0) + 1);
  }

  /**
   * And the reading question: the value, where the declaration is a quoted
   * string.
   *
   * Narrower than the count on purpose. This module resolves a name to a string
   * and a quoted literal is the only shape it can do that from without running
   * anything — so a name declared once, as something else, is a name whose value
   * this does not know, and the entry that needs it is reported rather than
   * guessed at.
   */
  /** @type {Map<string, string>} */
  const literals = new Map();
  for (const found of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])((?:(?!\2).)*)\2\s*;/g)) {
    literals.set(String(found[1]), String(found[3]));
  }

  /**
   * A constant's value, or the reason there is not one.
   *
   * Three reasons, and they are different failures: the name is not declared at
   * all; it is declared more than once, so which spelling it holds is not
   * something a reading of text can answer; or it is declared exactly once and
   * not as a quoted string, so this knows where the value comes from and not
   * what it is.
   *
   * @param {string} name
   * @returns {{ value: string } | { duplicated: string } | { unreadable: string } | null}
   */
  const constantNamed = (name) => {
    const times = declaredTimes.get(name) ?? 0;
    if (times === 0) {
      return null;
    }
    if (times > 1) {
      return { duplicated: name };
    }
    const value = literals.get(name);
    return value === undefined ? { unreadable: name } : { value };
  };

  /**
   * How many times the table itself is declared, counted the way every other
   * name in this file is counted: by the left-hand side alone.
   *
   * This is the same asymmetry, in the last place it was still alive. A reading
   * that LOCATES by shape and COUNTS by that same shape counts only the
   * declarations it can already read — so a declaration written in a shape it
   * cannot read is not a second declaration to it, it is no declaration at all,
   * and whatever it CAN read becomes the whole file as far as it is concerned.
   * A conforming table in a block comment, above a live one wrapped in one extra
   * pair of parentheses, was exactly that: one readable declaration, which was
   * the comment. Every reading below this — the entries, the pin, the
   * destinations — was a reading of the comment, and the live table quietly
   * carried an entry nobody reviewed. Measured, on this file, with the whole
   * gate green.
   *
   * So the count is asked of the left-hand side and nothing else — the keyword,
   * the name, the `=` — which is what `declaredTimes` above already holds for
   * every name in the file. Two declarations of this name is a file this cannot
   * read, whatever shapes they are in, and the strict reader below never runs.
   *
   * With that closed, a single declaration in a shape the strict reader cannot
   * read is no longer a route to anywhere: there is no second declaration for it
   * to be read INSTEAD of, so it lands on the refusal below and says so.
   */
  const timesDeclared = declaredTimes.get(ORIGIN_TABLE_NAME) ?? 0;
  if (timesDeclared > 1) {
    failures.push(
      `${ORIGIN_TABLE_FILE} declares ${ORIGIN_TABLE_NAME} ${timesDeclared} times and is meant to declare it once, so which of them decides where a share code travels is not something this can read`,
    );
    return { entries, failures };
  }

  /**
   * And the declaration itself, read strictly.
   *
   * Exactly one match is the only outcome this reads from. None is a table
   * written in a shape this does not know — including the shape the count above
   * has just made harmless. More than one cannot happen once that count has
   * passed, because every match here is a `const NAME =` the count also saw; it
   * is folded into the same refusal rather than given a branch of its own,
   * because a branch nothing can reach is a branch nobody can check.
   */
  const declarations = [
    ...text.matchAll(
      new RegExp(
        `\\bconst\\s+${ORIGIN_TABLE_NAME}\\s*=\\s*Object\\s*\\.\\s*freeze\\s*\\(\\s*\\{([^}]*)\\}`,
        'g',
      ),
    ),
  ];
  if (declarations.length !== 1) {
    failures.push(
      `${ORIGIN_TABLE_FILE} no longer declares ${ORIGIN_TABLE_NAME} as one frozen object literal, so this cannot read it`,
    );
    return { entries, failures };
  }
  const declared = declarations[0];
  if (declared === undefined) {
    failures.push(`${ORIGIN_TABLE_FILE} declares ${ORIGIN_TABLE_NAME} in a shape this cannot read it from`);
    return { entries, failures };
  }

  const body = String(declared[1]).trim();
  if (body.length === 0) {
    failures.push(`${ORIGIN_TABLE_NAME} is empty, so this page may talk to nowhere at all`);
    return { entries, failures };
  }

  /**
   * The DESTINATION half of an entry, as a value.
   *
   * A quoted string, or the name of a string constant declared in the same file.
   * Both are ordinary ways to write the right-hand side of a property and both
   * mean the string, so both resolve.
   *
   * @param {string} written
   * @returns {{ value: string } | { duplicated: string } | { unreadable: string } | null}
   */
  const destinationOf = (written) => {
    const text = written.trim();
    const quoted = /^(['"])((?:(?!\1).)*)\1$/.exec(text);
    if (quoted !== null) {
      return { value: String(quoted[2]) };
    }
    const named = /^([A-Za-z_$][\w$]*)$/.exec(text);
    if (named !== null) {
      return constantNamed(String(named[1]));
    }
    return null;
  };

  /**
   * The KEY half, which is not the same question and used to be read as though
   * it were.
   *
   * Two spellings resolve, and they are the two that mean an origin: a computed
   * key, `[NAME]`, which is the constant's VALUE; and a quoted string, which is
   * itself. A bare identifier is neither. `{ DEVELOPMENT_ORIGIN: … }` is a
   * property whose name is the identifier itself — the brackets are what make a
   * key a value in this language, and without them that entry answers for a page
   * served from an origin spelled `DEVELOPMENT_ORIGIN`, which is no origin at
   * all.
   *
   * That is not a nicety. Reading a bare key as though it were bracketed, this
   * check called a table conformant while the module it was reading answered
   * `null` for the loopback origin — a viewer that makes no request from the one
   * address the suites serve it at, with the scan green and every entry
   * apparently in place. Measured, on this file. So a bare identifier is a
   * failure that names the entry rather than a spelling this quietly resolves.
   *
   * `null` for anything else, which the caller reports as an entry it cannot
   * resolve.
   *
   * @param {string} written
   * @returns {{ key: string } | { unbracketed: string } | { duplicated: string } | { unreadable: string } | null}
   */
  const keyOf = (written) => {
    const text = written.trim();
    const bracketed = /^\[([\s\S]*)\]$/.exec(text);
    if (bracketed !== null) {
      const inside = String(bracketed[1]).trim();
      const quoted = /^(['"])((?:(?!\1).)*)\1$/.exec(inside);
      if (quoted !== null) {
        return { key: String(quoted[2]) };
      }
      const named = /^([A-Za-z_$][\w$]*)$/.exec(inside);
      if (named === null) {
        return null;
      }
      const found = constantNamed(String(named[1]));
      if (found === null || 'duplicated' in found || 'unreadable' in found) {
        return found;
      }
      return { key: found.value };
    }
    const quoted = /^(['"])((?:(?!\1).)*)\1$/.exec(text);
    if (quoted !== null) {
      return { key: String(quoted[2]) };
    }
    const named = /^([A-Za-z_$][\w$]*)$/.exec(text);
    if (named !== null && declaredTimes.has(String(named[1]))) {
      return { unbracketed: String(named[1]) };
    }
    return null;
  };

  /**
   * The positions of a character, where it is neither inside a quoted string nor
   * inside a computed key's brackets.
   *
   * Both matter and neither is theoretical here: an origin written out in full
   * carries a colon inside its own quotes, so "the colon that separates the two
   * halves" is not the first one and not the last one either, and a computed key
   * carries its own brackets around a name. Read with the quotes and the
   * brackets tracked, the separator is the one at the top level.
   *
   * @param {string} text
   * @param {string} character
   * @returns {number[]}
   */
  const outsideStrings = (text, character) => {
    /** @type {number[]} */
    const at = [];
    /** @type {string | null} */
    let quote = null;
    let depth = 0;
    for (let index = 0; index < text.length; index += 1) {
      const one = text[index];
      if (quote !== null) {
        if (one === quote) {
          quote = null;
        }
        continue;
      }
      if (one === "'" || one === '"' || one === '`') {
        quote = one;
        continue;
      }
      if (one === '[') {
        depth += 1;
        continue;
      }
      if (one === ']') {
        depth -= 1;
        continue;
      }
      if (one === character && depth === 0) {
        at.push(index);
      }
    }
    return at;
  };

  /** @type {string[]} */
  const written = [];
  let from = 0;
  for (const at of outsideStrings(body, ',')) {
    written.push(body.slice(from, at));
    from = at + 1;
  }
  written.push(body.slice(from));

  for (const one of written) {
    const entry = one.trim();
    if (entry.length === 0) {
      continue;
    }
    const colons = outsideStrings(entry, ':');
    if (colons.length !== 1) {
      failures.push(`${ORIGIN_TABLE_NAME} carries ${JSON.stringify(entry)}, which is not an entry this can read`);
      continue;
    }
    const at = Number(colons[0]);
    const read = keyOf(entry.slice(0, at).trim());
    const destination = destinationOf(entry.slice(at + 1).trim());
    // A name written twice, on either half. Reported before anything else about
    // the entry, because the other reports would be about a value this has no
    // business having chosen.
    /** @param {string} name */
    const writtenTwice = (name) =>
      `${ORIGIN_TABLE_NAME} carries ${JSON.stringify(entry)}, and ${name} is declared more than once in this file, so which spelling it holds is not something this can read`;
    if (read !== null && 'duplicated' in read) {
      failures.push(writtenTwice(read.duplicated));
      continue;
    }
    if (destination !== null && 'duplicated' in destination) {
      failures.push(writtenTwice(destination.duplicated));
      continue;
    }
    // A name declared once and not as a quoted string. This knows the value has
    // a source and not what the source says, which is a reading that has run out
    // rather than a table that is wrong — reported as itself, naming the name,
    // so that the next reader knows which of the two it is looking at.
    /** @param {string} name */
    const notALiteral = (name) =>
      `${ORIGIN_TABLE_NAME} carries ${JSON.stringify(entry)}, and ${name} is declared once but not as a quoted string, so what it holds is not something this can read`;
    if (read !== null && 'unreadable' in read) {
      failures.push(notALiteral(read.unreadable));
      continue;
    }
    if (destination !== null && 'unreadable' in destination) {
      failures.push(notALiteral(destination.unreadable));
      continue;
    }
    if (read !== null && 'unbracketed' in read) {
      failures.push(
        `${ORIGIN_TABLE_NAME} carries ${JSON.stringify(entry)}, whose key is the name ${read.unbracketed} rather than the origin it holds — a computed key is written in brackets, and without them this entry answers for no origin at all`,
      );
      continue;
    }
    if (read === null || destination === null) {
      failures.push(`${ORIGIN_TABLE_NAME} carries ${JSON.stringify(entry)}, whose two halves this cannot resolve`);
      continue;
    }
    // A key already read, before anything collapses it. Two entries under one
    // origin are one entry at runtime — the later one wins and the earlier is
    // gone — so a table that looks like it answers two ways answers one, and
    // which one is a question about evaluation order rather than about a
    // reviewed decision. Read as source, both are here to be seen, and this is
    // where they are seen: after this loop they are a `Map` and the first of
    // them no longer exists to be reported.
    if (entries.some((one) => one.key === read.key)) {
      failures.push(
        `${ORIGIN_TABLE_NAME} carries ${read.key} more than once, and only the last of them decides where that page talks`,
      );
      continue;
    }
    entries.push({ key: read.key, destination: destination.value });
  }

  // And the pin, over the entries as a whole rather than one at a time. Each of
  // the three ways a table can differ from the pinned one is reported
  // separately, and each names what it found: an entry whose destination is not
  // the pinned one is the slip this reading exists for, an entry under a key the
  // pin does not carry is an origin nobody reviewed, and a pinned entry that is
  // absent is a page that will make no request at all from an address this
  // viewer is served at.
  //
  // Skipped when nothing was read, because an unreadable table has already been
  // reported as unreadable and reporting it a second time as two missing
  // entries says nothing further.
  if (failures.length === 0) {
    const found = new Map(entries.map((one) => [one.key, one.destination]));
    for (const [key, destination] of Object.entries(ORIGIN_TABLE)) {
      if (!found.has(key)) {
        failures.push(`${ORIGIN_TABLE_NAME} no longer carries ${key}, so a page served from there talks to nowhere`);
        continue;
      }
      const answered = found.get(key);
      if (answered !== destination) {
        failures.push(
          `${ORIGIN_TABLE_NAME} sends a page served from ${key} to ${String(answered)} rather than to ${destination}`,
        );
      }
    }
    for (const one of entries) {
      if (!Object.prototype.hasOwnProperty.call(ORIGIN_TABLE, one.key)) {
        failures.push(
          `${ORIGIN_TABLE_NAME} carries ${one.key}, which is not an origin this viewer is pinned to be served from`,
        );
      }
    }
  }

  return { entries, failures };
}

/**
 * Where each admitted destination actually appears, and how often.
 *
 * @param {string} [root] The served tree.
 * @returns {Record<string, { file: string, count: number }[]>}
 */
export function countAllowedUrls(root = SHIPPED_TREE) {
  /** @type {Record<string, { file: string, count: number }[]>} */
  const found = {};
  for (const url of Object.keys(ALLOWED_URLS)) {
    found[url] = [];
  }
  for (const file of collectFiles(root)) {
    const text = readFileSync(file, 'utf8');
    for (const url of Object.keys(ALLOWED_URLS)) {
      const count = text.split(url).length - 1;
      if (count > 0) {
        found[url]?.push({ file: shownPath(file), count });
      }
    }
  }
  return found;
}

/**
 * Scan a tree for forbidden sinks.
 *
 * @param {string} root
 * @returns {ScanResult}
 */
export function scanTree(root) {
  const files = collectFiles(root);
  /** @type {Violation[]} */
  const violations = [];
  /** @type {Map<string, number>} */
  const byExt = new Map();

  for (const file of files) {
    const ext = extname(file).toLowerCase();
    const shown = shownPath(file);
    byExt.set(ext, (byExt.get(ext) ?? 0) + 1);

    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of RULES) {
        if (!appliesTo(rule, ext)) continue;
        if (exempt(rule, shown)) continue;
        // Which pattern this file is read with. `pattern` unless the rule names
        // this exact path, which one rule does and the reason is beside it: a
        // construct that belongs on one line of one file cannot be told from the
        // same bytes typed into another file by a reading that never asks which
        // file it is in. Absent, misspelled or not this tree, the answer is
        // `pattern` — the narrowest of the set — so an unrecognised file admits
        // nothing extra.
        if (patternFor(rule, shown).test(line)) {
          violations.push({
            file: shown,
            line: index + 1,
            rule: rule.id,
            why: rule.why,
            text: line.trim().slice(0, 120),
          });
        }
      }
    });
  }

  return { files, violations, byExt };
}
