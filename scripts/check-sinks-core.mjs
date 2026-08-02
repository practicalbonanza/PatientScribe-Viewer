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
 *    computed property access, a call split across lines, a string passed
 *    through a variable, or a constructor reached through a chain of other
 *    objects — and the self-test asserts those misses deliberately, so the limit
 *    stays documented rather than assumed away. Read this as a tripwire against
 *    accident and drift. The controls against an author who is actually trying
 *    are review, and CSP and Trusted Types at the origin.
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
 * @typedef {object} Rule
 * @property {string} id
 * @property {'any' | readonly string[]} files
 * @property {RegExp} pattern
 * @property {string} why
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
    pattern: /\.\s*(?:href|src|srcset|imagesrcset|srcdoc|action|formAction)\s*=(?!=)/i,
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
    byExt.set(ext, (byExt.get(ext) ?? 0) + 1);

    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of RULES) {
        if (!appliesTo(rule, ext)) continue;
        if (rule.pattern.test(line)) {
          violations.push({
            file: relative(REPO_ROOT, file) || file,
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
