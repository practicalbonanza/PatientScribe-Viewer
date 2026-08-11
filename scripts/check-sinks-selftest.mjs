/**
 * Self-test for the forbidden-sink check.
 *
 * A static check is only worth what its rules actually catch, and a rule that
 * silently stops matching is worse than no rule — it reports PASS and is
 * believed. So the checker is pointed at a fixture corpus with known answers,
 * and the command line is spawned as a real child process.
 *
 * The claims tested here, and why each one exists:
 *
 *   - The rule set is exactly the pinned list below. The expected IDs are
 *     hardcoded rather than derived from `RULES`, because a test that builds its
 *     expectations out of the thing under test passes just as happily after a
 *     rule is deleted. Adding or removing a rule now requires editing this list,
 *     which is a visible, reviewable act.
 *   - Every rule fires on at least one violation fixture. A rule with no fixture
 *     is a rule nobody has seen work.
 *   - And every alternative every rule names is refused, one by one. "It fired
 *     somewhere" is the wrong question for any rule whose pattern is a list, and
 *     most of these are: one rule names five ways to parse a string as markup,
 *     one names nine elements that fetch, execute or carry CSS, one names eight URL-
 *     bearing properties, one names four ways to navigate. A rule with one
 *     alternative deleted still fires on the fixture lines that use the others,
 *     so the rule set stayed complete, every rule stayed "fired", and a whole
 *     construct stopped being seen. The alternatives are listed in this file,
 *     independently of the patterns, and each is asked for by name.
 *   - The suppression rule and the two code-execution rules are in that list for
 *     the same reason and were there first: three independent comments, and two
 *     alternations over the punctuation that follows a name — where the
 *     alternative nothing exercised was the capture, an alias reaching a
 *     variable with no call on the line.
 *   - A clean fixture produces nothing, and demonstrates the sanctioned idioms.
 *   - A tree with exactly one violation is a failure. The violations tree
 *     carries dozens, so a scan that only spoke once it had found several would
 *     fail that tree too and look correct.
 *   - A violation is reported at the line it is on and carries that line's text,
 *     truncated to the reported width when the line is longer than it and whole
 *     when it is not. Every fixture line but one sits well under that width, so
 *     the slice that truncates never removed a character and nothing could have
 *     said if it stopped.
 *   - An empty tree cannot be scanned and says so, rather than being reported as
 *     clean: a scan that read nothing has shown nothing.
 *   - No module the checks are made of turns the type checker off. The
 *     suppression rule reaches every file by declaration and was only ever run
 *     over `site/`, which left the modules that decide whether these checks pass
 *     outside it — and the tooling typecheck configuration covers exactly those.
 *     "Exactly those" is compared against that configuration's own pinned scope
 *     rather than asserted: the reading was two directories while the scope is
 *     two directories and a file, and the file it was missing is the harness
 *     configuration.
 *   - The documented known-miss corpus is still missed. This asserts the
 *     checker's limits rather than its powers: if a rule change starts catching
 *     one of those spellings, this test fails on purpose and the honesty
 *     paragraph in the core gets updated by someone who noticed.
 *   - The scan fails closed on a symlink, whether it is an entry in the tree or
 *     the scan root itself.
 *   - The command line exits 1, 0 and 2 as documented — including when reached
 *     through a symlinked path, which is exactly how it used to fail open.
 *   - And the invocation that names no tree scans the shipped one. Every claim
 *     above is about what the rules catch, and none of them is about what the
 *     rules are run over: repointing the default one directory down left the
 *     whole chain green, reporting a pass over a single stylesheet, with a
 *     forbidden sink shipped in a served module. So the default target is read
 *     back from a real run of it — the tree by name, the number of files it
 *     holds, and the served files that have to be among them.
 *
 * The corpus lives outside `site/`, so none of it is ever served, and the real
 * scan of `site/` never sees it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHECK_CONFIGS } from './check-manifest-core.mjs';
import {
  ALLOWED_URLS,
  collectFiles,
  countAllowedUrls,
  countNetworkCallSites,
  NETWORK_CALL_SITES,
  NETWORK_FILE,
  readApiOrigins,
  REPO_ROOT,
  RULES,
  ScanError,
  scanTree,
  SHIPPED_TREE,
} from './check-sinks-core.mjs';

const FIXTURES = fileURLToPath(new URL('../test/sink-fixtures/', import.meta.url));
const CLI = fileURLToPath(new URL('./check-sinks.mjs', import.meta.url));

/**
 * The three comments the suppression rule names, assembled rather than written.
 *
 * That rule's reach now includes the modules the checks are made of — this file
 * among them — and a scan for a construct cannot tell the construct from a
 * mention of it. Spelling them here in full would put three suppressions in a
 * scanned file, which is the thing being refused. Assembling them says the same
 * three things and is not one of them.
 *
 * @type {readonly string[]}
 */
const SUPPRESSION_SPELLINGS = ['nocheck', 'ignore', 'expect-error'].map((word) => `@ts-${word}`);

/**
 * The modules the checks are made of: everything the tooling typecheck
 * configuration reads.
 *
 * Written from that configuration's own scope rather than from a list of
 * directories, because what a suppression comment suppresses is exactly what
 * that configuration was going to check.
 *
 * @type {readonly string[]}
 */
const POLICY_TREES = ['scripts', 'test'];

/**
 * And the one thing in that scope which is not in a tree.
 *
 * The tooling configuration's `include` names two directories and one file. The
 * file was missing from the list above while the prose beside it said "everything
 * the tooling typecheck configuration reads", so the reading covered the scope
 * with one hole in it — and the hole was the harness configuration, which is the
 * file that decides which spec files run, in which engines, from which
 * directory. A suppression comment at the top of it would have turned the
 * checker off for exactly that, with both configurations still saying what they
 * are pinned to say and nothing else looking.
 *
 * A separate list rather than an entry in the one above because these are read
 * rather than walked: `collectFiles` takes a directory and refuses anything
 * else, which is the behaviour that is right for a tree and wrong for a file.
 *
 * @type {readonly string[]}
 */
const POLICY_FILES = ['playwright.config.js'];

/**
 * What the tooling configuration excludes, and so what a suppression in it
 * would suppress nothing of.
 *
 * Not an exemption anything can claim: the checker does not read these files, so
 * a comment telling it to stop reading them changes nothing. The sink fixtures
 * are the tree that deliberately carries every construct these rules name.
 *
 * @type {readonly string[]}
 */
const OUTSIDE_THE_TYPECHECK = ['test/sink-fixtures'];

/**
 * The rule set, pinned independently of the implementation.
 *
 * @type {readonly string[]}
 */
const EXPECTED_RULE_IDS = [
  'innerHTML',
  'outerHTML',
  'insertAdjacentHTML',
  'document.write',
  'eval',
  'Function-constructor',
  'javascript-url',
  'inline-event-attribute',
  'event-handler-property',
  'html-string-parsing',
  'style-construction',
  'setAttribute',
  'object-assign',
  'url-property-assign',
  'srcdoc',
  'object-url',
  'navigation',
  'string-timer',
  'active-element-creation',
  'dynamic-import',
  'network-egress',
  'network-request',
  'console-output',
  'persistence',
  'timing-api',
  'external-url',
  'stylesheet-resource',
  'stylesheet-content',
  'typecheck-suppression',
];

/**
 * @param {string} name
 * @returns {string}
 */
function fixtureDir(name) {
  return join(FIXTURES, name);
}

/**
 * The program and the tree it aims itself at, copied somewhere nothing serves.
 *
 * Two cases below have to see the default invocation refuse a forbidden
 * construct in the tree it points itself at, and the only way to show that is
 * for such a construct to be in that tree while the run happens. Written into
 * `site/` and removed afterwards, that is a file the whole of this scan exists
 * to refuse sitting in a public repository for as long as the run takes — and a
 * run that is interrupted rather than finished leaves it there, because the step
 * that removes it is a step, and a signal does not wait for one.
 *
 * So the construct goes into a copy. The scan decides what it reads from where
 * its own program is, so a copy of the program beside a copy of the tree is the
 * same self-aiming run over a tree that is not the one on disk here. What is
 * being shown is that the program aims itself and that what it finds there it
 * refuses; that the tree it aims at is the served one is shown separately, by
 * the constant and by what a real default run reports having read.
 *
 * @param {string} directory Somewhere temporary.
 * @returns {string} The command line inside the copy.
 */
function copyOfTheCheck(directory) {
  mkdirSync(join(directory, 'scripts'), { recursive: true });
  for (const name of ['check-sinks.mjs', 'check-sinks-core.mjs']) {
    cpSync(join(REPO_ROOT, 'scripts', name), join(directory, 'scripts', name));
  }
  cpSync(SHIPPED_TREE, join(directory, 'site'), { recursive: true });
  return join(directory, 'scripts', 'check-sinks.mjs');
}

/**
 * Run the command line as a child process.
 *
 * @param {string | null} target The tree to scan, or `null` for the invocation
 *   that names none — which is the one `npm run check` makes, and so the one
 *   whose target is decided by the program rather than by the caller.
 * @param {string} [cliPath]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runCli(target, cliPath = CLI) {
  const result = spawnSync(process.execPath, target === null ? [cliPath] : [cliPath, target], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('the rule set matches the independently pinned list', () => {
  const actual = RULES.map((rule) => rule.id).slice().sort();
  const expected = EXPECTED_RULE_IDS.slice().sort();

  assert.deepEqual(
    actual,
    expected,
    'the rule set changed — if that was deliberate, update EXPECTED_RULE_IDS in this file',
  );

  // And which files each rule applies to, which is a second field of every rule
  // and was not pinned by anything at all.
  //
  // It is read — `appliesTo` compares a file's extension against it — but nothing
  // said what any rule's value should be, and a narrowing is invisible from
  // every other case here. Nearly every rule that fires in the violations tree
  // fires on a `.js` file, so narrowing a rule from every file to script files
  // leaves that tree reporting exactly what it reported before: `network-egress`
  // narrowed to scripts kept all of these green while a beacon in a `.html` file
  // stopped being a violation. The four rules that are genuinely narrow are
  // narrow for a reason — an inline handler is a markup construct, a handler
  // property is a script one, and the two stylesheet rules look for words that
  // are ordinary names in every other kind of file — and every other rule is
  // about a construct that means the same thing wherever it is written, so it
  // applies everywhere.
  //
  // The two stylesheet entries are the ones to read twice, because a narrowing is
  // normally what this case exists to catch. The resource rule is narrowed
  // because the function it looks for shares its name with the constructor a
  // script builds a destination with, so read over a script it refuses an
  // ordinary `new URL(` — a wrong answer waiting for the first served module that
  // writes one. The generated-content rule is narrowed because the word it looks
  // for is an ordinary property name everywhere else. Both are pinned to the
  // extension they are about, so a widening of either is a change this reports
  // rather than a change that quietly starts refusing the language.
  //
  // Written as the exceptions plus "everything else is every file", rather than
  // as an entry per rule, so that a rule added without a scope decision is
  // caught by the same assertion rather than by somebody remembering to add a
  // line.
  const narrowed = Object.freeze({
    'inline-event-attribute': ['.html', '.htm', '.xhtml', '.svg'],
    'event-handler-property': ['.js', '.mjs'],
    'stylesheet-resource': ['.css'],
    'stylesheet-content': ['.css'],
  });
  for (const rule of RULES) {
    const expectedFiles = narrowed[/** @type {keyof typeof narrowed} */ (rule.id)];
    if (expectedFiles === undefined) {
      assert.equal(
        rule.files,
        'any',
        `${rule.id} applies to some files rather than all of them, and nothing here decided that`,
      );
      continue;
    }
    assert.deepEqual(
      [...rule.files].sort(),
      [...expectedFiles].sort(),
      `${rule.id} applies to a different set of files than the one pinned here`,
    );
  }
});

test('every rule fires on at least one violation fixture', () => {
  const { violations } = scanTree(fixtureDir('violations'));
  const fired = new Set(violations.map((violation) => violation.rule));
  const notFired = EXPECTED_RULE_IDS.filter((id) => !fired.has(id));

  assert.deepEqual(notFired, [], `rules with no violation fixture: ${notFired.join(', ')}`);
});

/**
 * What each rule's pattern alternates over, written out here rather than read
 * from the pattern.
 *
 * The test above asks that each rule fired somewhere, which is the right
 * question only for a rule whose pattern is one construct written several ways.
 * It is the wrong question for every rule below: each names a list of things
 * that are not variations on each other, and deleting one entry from such a list
 * leaves the rule firing on every fixture line that uses the rest. The rule set
 * is still complete, every rule still fires, and a construct nobody decided to
 * allow is now allowed.
 *
 * The values are the text a violation of that alternative has to carry, so this
 * is a list of spellings rather than of regular-expression fragments — a list
 * built out of the pattern would pass whatever the pattern said.
 *
 * Several of the entries below are one construct spelled a number of ways rather
 * than several constructs, and they are here on purpose. Where a rule chooses to
 * match a name rather than a call, a pair rather than a dot, a case-insensitive
 * function name, or a character a parser reads as another one, the spellings that
 * choice admits are the whole content of it: anchoring the output rule to its
 * parenthesis leaves three of its four spellings through with the rule still
 * firing on the first; the two pairs in the persistence rule were anchored to a
 * dot until the two spellings that need none were written down here; two of the
 * three cases anybody writes the stylesheet function's name in were going through
 * until this list reached them, and all eight the pattern actually reads are
 * written down now, because a list of three would let a pattern narrowed to three
 * pass; and seven spellings a parser resolves off this origin were admitted by
 * the destination rule until they were written down here.
 * So the question this file asks is not only "does each construct have a fixture"
 * but "does each spelling somebody decided to reach have one".
 *
 * A rule with nothing to list either way is absent, and the absences are pinned
 * at the end of the case below so that an unlisted rule is a decision rather
 * than an oversight.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const RULE_ALTERNATIVES = Object.freeze({
  // Two methods, and the second writes markup exactly as the first does.
  'document.write': ['document.write(', 'document.writeln('],
  // Three punctuations, because what follows the name decides whether the line
  // is a call, the closing half of the indirect form, or a capture.
  eval: ['eval(', 'eval)', 'eval,'],
  'Function-constructor': ['Function(', 'Function)', 'Function,'],
  // Four characters may sit in front of an attribute name, and three of them are
  // not whitespace: the slash that needs no space at all, and either quote
  // closing the attribute before it.
  'inline-event-attribute': [' on', '/on', "'on", '"on'],
  // Five ways to turn a string into markup, sharing nothing but their effect.
  'html-string-parsing': [
    'DOMParser',
    'parseFromString(',
    'createContextualFragment(',
    'setHTMLUnsafe(',
    'parseHTMLUnsafe(',
  ],
  // Four shapes of style assignment, of which the first is the one a careless
  // author reaches for and the last is any single property.
  'style-construction': ['.style = ', '.style.cssText', '.style.setProperty(', '.style.color'],
  'setAttribute': ['setAttribute(', 'setAttributeNS('],
  // Eight properties that carry a URL. Written with the assignment attached so
  // that one name is not read out of another: `srcset` contains `src`.
  //
  // Eight rather than the seven this said until now, and the eight is the one
  // this page's own markup could actually be turned with: an anchor's `ping`
  // sends a request to wherever it names when the link is used, its destination
  // may be relative — so the rule that reads destinations does not see it — and
  // property reflection is the sanctioned route, so nothing else was looking
  // either. It was missing from the pattern and from this list together, which is
  // how a list of names goes wrong: nothing here asks for a name nobody wrote
  // down.
  'url-property-assign': [
    '.href = ',
    '.src = ',
    '.srcset = ',
    '.imageSrcset = ',
    '.srcdoc = ',
    '.action = ',
    '.formAction = ',
    '.ping = ',
  ],
  // Four ways to navigate, two of which are methods, one an assignment, and one
  // a bare global call.
  navigation: ['location.assign(', 'location.replace(', 'location = ', 'window.open(', '= open('],
  'string-timer': ['setTimeout(', 'setInterval('],
  // Nine elements that fetch, execute, or carry CSS. A list of names is the most
  // fragile shape a rule here has: any one of them can go with the other eight
  // still firing.
  //
  // Nine rather than the eight this said until now, and the eight was not a
  // miscount at the time: `style` was added to the rule when a style element's
  // text content was recognised as an injection sink of its own, the list of
  // spellings below was extended with it, and these two sentences were not. A
  // count written in prose beside a list is a claim about the list, so it is
  // read as one — the assertion under it is what actually holds every name, and
  // this is here so that a reader comparing the two is not told the wrong
  // number.
  'active-element-creation': [
    "createElement('script'",
    "createElement('iframe'",
    "createElement('object'",
    "createElement('embed'",
    "createElement('link'",
    "createElement('base'",
    "createElement('meta'",
    "createElement('form'",
    "createElement('style'",
  ],
  // Four ways off the page, sharing nothing but where the data ends up. All four
  // are matched as names, so any one of them could go with the rule still firing
  // on the other three.
  //
  // Five spellings for the four, because `sendBeacon` is listed twice on
  // purpose: called, and captured with no call on the line. The rule's own
  // comment says every name here is matched as a name, and for a while that was
  // true of the sentence and not of the pattern — `sendBeacon` was anchored to
  // its call, so a captured reference went through while the called spelling
  // below kept this passing. The captured spelling is what tells the two apart.
  //
  // `fetch` used to be the fifth and is a rule of its own now, because it is the
  // one construct here with a place it is allowed to be.
  'network-egress': ['sendBeacon(', 'sendBeacon;', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
  // One name, in the four ways it is reached. The rule matches the name rather
  // than a call, which is what makes the four one line to it — and which is
  // exactly the claim that needs holding, because anchoring it to the call would
  // leave the last three through with the first still firing.
  'console-output': ["console.log(", "console['warn']", 'output = console;', '{ error } = console;'],
  // Eight places something could outlive the page, in twelve spellings. A list
  // of names, so any one of them could go with the rule still firing on the
  // other seven — and the two that are a member of an ordinary object rather
  // than a name of their own are written three ways each, because a pair can be
  // reached without the dot and the rule was once anchored to one.
  persistence: [
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'document.cookie',
    'document?.cookie',
    "document['cookie']",
    'caches',
    'serviceWorker',
    'cookieStore',
    'navigator.storage',
    'navigator?.storage',
    "navigator['storage']",
  ],
  // Three reaches for the one record of the address this page was loaded from,
  // and they share nothing but what they reach: the object by name, the reading
  // that hands back the entries, and the observer that is given them without
  // anything asking. A list of three, so any one of them could go with the rule
  // still firing on the other two.
  //
  // Five spellings for the three, because the reading is spelled three ways — by
  // type, by name, and with no argument at all — and each is one line in the
  // fixture rather than one line satisfying several. A line carrying the object
  // AND a reading would satisfy two entries here from one match, which is how a
  // list like this stops being able to tell an alternative that was dropped from
  // one that is still there.
  'timing-api': ['= performance;', 'getEntriesByType(', 'getEntriesByName(', 'getEntries(', 'PerformanceObserver('],
  // One construct and eleven spellings. A destination carrying a scheme, written
  // either way — the optional `s` is one character in the pattern and is the
  // difference between refusing both schemes and refusing one — and with either
  // of the two characters after that scheme leaning the other way, which a
  // parser reads as the same pair. Then the same destination borrowing the
  // page's scheme instead, which is a quote, that same pair, and a host: with a
  // name, with an address in brackets, with a first character an allow-set used
  // to refuse, and with each of the two mixed leaning spellings of the pair.
  //
  // The last two are the characters a parser takes out before it reads anything,
  // and they are two different sets rather than one. A tab, a line feed and a
  // carriage return are deleted from the whole of an address, so one of them
  // between the two characters after a scheme leaves a destination that still
  // names its host while the pair is no longer written next to each other — the
  // spelling below carries a real tab. And every C0 control and the space are
  // trimmed off the FRONT of an address, so one of them between the quote and the
  // pair does the same to the alternative that is anchored to that quote — the
  // spelling below carries a space. Both were admitted, and each is a spelling
  // this scan chose to reach rather than a variation on the others.
  //
  // What is deliberately absent is the spelling where BOTH characters lean: it is
  // in the known-miss fixture, with the measurement that made leaving it out a
  // decision. So is a scheme followed by fewer than two of those characters,
  // which a parser reads as a host just as well and this construct is not written
  // to reach.
  //
  // The stylesheet function's spellings have moved to the rule below, which is
  // where they are now looked for.
  'external-url': [
    'http://',
    'https://',
    'https:/\\',
    'https:\\/',
    "'//e",
    "'//[",
    "'//_",
    "'/\\e",
    "'\\/e",
    'https:/\t/',
    "' //",
  ],
  // One function, in every case its name can be written in, because a CSS
  // function name is case-insensitive while a text comparison is not and two of
  // the lower-case, upper-case and title-case three were going through until this
  // list reached them.
  //
  // Eight rather than those three, and the difference is the whole property being
  // claimed. The pattern reads each of the three letters in either case, which is
  // eight spellings; a list of three asks about three of them, so a pattern
  // narrowed to exactly `url`, `URL` and `Url` would have passed this case while
  // quietly losing five spellings a stylesheet reads identically. Written out in
  // full rather than generated, because a list built from the pattern is the
  // pattern agreeing with itself.
  'stylesheet-resource': ['url(', 'urL(', 'uRl(', 'uRL(', 'Url(', 'UrL(', 'URl(', 'URL('],
  // One property, written the two ways a stylesheet may write the space in front
  // of its colon, and once in upper case. The space tolerance is one fragment of
  // the pattern and nothing was asking for it, so a declaration written with the
  // space would have gone straight through a rule that had quietly lost it while
  // still firing on the line above. The case is the same shape of claim: a
  // stylesheet reads a property name in any case, a comparison reads it in one,
  // and `CONTENT:` declared the same generated content while this rule admitted
  // it.
  'stylesheet-content': ['content:', 'content :', 'CONTENT:'],
  // The three comments, assembled rather than written, for the reason
  // `SUPPRESSION_SPELLINGS` is.
  'typecheck-suppression': SUPPRESSION_SPELLINGS,
});

test('every alternative every rule names is refused', () => {
  const { violations } = scanTree(fixtureDir('violations'));

  for (const [rule, alternatives] of Object.entries(RULE_ALTERNATIVES)) {
    assert.ok(
      RULES.some((one) => one.id === rule),
      `${rule} is no longer a rule, so the alternatives listed for it are about nothing`,
    );
    // An entry with nothing in it asks nothing, and the loop under it runs zero
    // times and passes. Emptying one array is the cheapest way to stop a rule's
    // spellings being asked for while every other case here reports exactly what
    // it reported before — including the pin below, which reads which keys are
    // present rather than what is under them.
    assert.ok(
      alternatives.length > 0,
      `${rule} lists no alternatives, so the entry for it asks nothing about it`,
    );
    const fired = violations.filter((violation) => violation.rule === rule);
    for (const alternative of alternatives) {
      assert.ok(
        fired.some((violation) => violation.text.includes(alternative)),
        `${rule}: ${JSON.stringify(alternative)} in a shipped file was not refused`,
      );
    }
  }

  // And the list is a list of the rules that need one. A rule whose pattern
  // grew an alternative nobody wrote down here would be a rule back where all
  // of these started, so the rules that are absent are named as absent.
  const withoutAlternatives = RULES.map((one) => one.id).filter(
    (id) => !Object.prototype.hasOwnProperty.call(RULE_ALTERNATIVES, id),
  );
  assert.deepEqual(
    withoutAlternatives.sort(),
    [
      'dynamic-import',
      'event-handler-property',
      'innerHTML',
      'insertAdjacentHTML',
      'javascript-url',
      'network-request',
      'object-assign',
      'object-url',
      'outerHTML',
      'srcdoc',
    ],
    'a rule has appeared or gone, and whether its pattern alternates over anything has not been decided',
  );
});

test('each destination is admitted where it ends, and nothing longer is admitted at all', () => {
  // The allowance is the one place this scan says yes, and a yes is where the
  // holes are. It used to admit by prefix: every refusal below begins with an
  // admitted spelling, or carries a scheme the admitted spelling does not, and
  // every one of them went through — a campaign token on the end of the store
  // link above all, which is the single thing that link is built not to have.
  //
  // Built from the table rather than written out, so these are the destinations
  // this viewer actually admits rather than three strings that used to be. Read
  // through a real scan of a real tree rather than through the pattern, because
  // a pattern read out of the rule it belongs to is the rule agreeing with
  // itself.
  const admitted = Object.keys(ALLOWED_URLS);
  const [store, policy, origin] = admitted;
  assert.ok(
    store !== undefined && policy !== undefined && origin !== undefined,
    'the admitted destinations are no longer the three this reads',
  );

  /**
   * The same origin on a different port.
   *
   * By parsing the origin and asking for another port, rather than by editing the
   * last character of the string. Editing the last character is what this was: the
   * origin with its final character dropped and a `4` put in its place, which is a
   * different port for the port this project happens to use and the SAME port for
   * any port ending in a `4`. For those the case read as a refusal being checked
   * while the line it wrote was the admitted spelling, and it passed by being
   * admitted — a control that reports success for the wrong reason, which is worse
   * than not having one.
   *
   * @param {string} from
   * @returns {string}
   */
  const onAnotherPort = (from) => {
    const parsed = new URL(from);
    parsed.port = String((Number(parsed.port || '80') % 65535) + 1);
    return parsed.origin;
  };

  const otherPort = onAnotherPort(origin);

  // And it is another port for every port rather than for this one. The two
  // single-digit cases are the ones the old construction collapsed on, and the
  // last is the top of the range, where "one more" has to come back round rather
  // than off the end. Asked of the same code the line below uses, so this is the
  // control being checked and not a second copy of it.
  for (const port of ['4', '14', '4173', '65535']) {
    const one = new URL(origin);
    one.port = port;
    assert.notEqual(
      onAnotherPort(one.origin),
      one.origin,
      `the other-port control is the same origin for port ${port}, so for that port it is not a control`,
    );
  }

  /** @type {readonly [string, string][]} */
  const refused = [
    ['a campaign token on the end of the store link', `${store}?pt=campaign`],
    ['a host that merely begins like the admitted one', store.replace('apps.apple.com', 'apps.apple.com.example.invalid')],
    ['one more character on the end', `${policy}-2`],
    ['the admitted destination under the other scheme', policy.replace('https://', 'http://')],
    ['the development origin on another port', otherPort],
    ['the scheme written in upper case', store.replace('https://', 'HTTPS://')],
    ['a destination that borrows the scheme of the page', store.slice('https:'.length)],
    // And each character after the scheme leaning the other way, which a parser
    // reads as the pair it is written with and this admitted until the pattern
    // was widened to the three spellings a browser accepts.
    ['the admitted destination with one slash leaning the other way', store.replace('https://', 'https:/\\')],
    ['the admitted destination with the other slash leaning', store.replace('https://', 'https:\\/')],
  ];

  const directory = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    const lines = [
      ...admitted.map((url, index) => `export const admitted${index} = '${url}';`),
      ...refused.map(([, url], index) => `export const refused${index} = '${url}';`),
    ];
    writeFileSync(join(directory, 'destinations.js'), `${lines.join('\n')}\n`);

    const onLine = new Set(
      scanTree(directory)
        .violations.filter((violation) => violation.rule === 'external-url')
        .map((violation) => violation.line),
    );

    admitted.forEach((url, index) => {
      assert.ok(!onLine.has(index + 1), `${url} is one of the three this viewer names and was refused`);
    });
    refused.forEach(([what], index) => {
      assert.ok(onLine.has(admitted.length + index + 1), `${what} was admitted`);
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('no character carries an admitted destination on to somewhere else', () => {
  // The case the list above is not, and cannot be. Every refusal there is a
  // spelling somebody thought of, and the defect this replaces was a spelling
  // nobody did: the allowance used to end at any character outside the set a URL
  // is made of, which reads as a tidy rule and is a claim about a parser. It is
  // not one a parser agrees with. `http://127.0.0.1:4173` followed by a quote,
  // an `@` and a host is a URL whose host is that host, and the quote is outside
  // that set, so the spelling was admitted while naming somewhere else entirely.
  // Nine other characters did the same.
  //
  // So this asks the parser rather than a list. Every printable character, plus
  // the ones outside that range that a source file can carry, is written after
  // each admitted destination and in front of a host, and each of the resulting
  // spellings has to satisfy one of two things: this scan refuses it, or the
  // platform's own parser reads it as a destination whose host is still the
  // admitted one. There is nothing in between, and a character where both fail
  // is a character that carries an admitted spelling somewhere it was never
  // admitted to go.
  //
  // A loop rather than a list, because a list is what let the last one through.
  //
  // What the parser is asked is the destination as the source actually names it,
  // which is not always the whole string: a line writes its destination between
  // quotes, and a character equal to the quote it opened with ends the string
  // there. So for that one character the destination is the admitted spelling
  // and nothing after it, which is exactly why the scan may admit it — and the
  // reading below says so by asking the parser the same question the source
  // does. Every other character leaves the string open, and the parser is handed
  // the whole of it.
  // A file per spelling rather than a line per spelling, because three of the
  // characters swept are the ones that end a line: written into a shared file
  // they would not be a character inside a destination at all, which is the one
  // thing this case is not asking about.
  const admitted = Object.keys(ALLOWED_URLS);
  const quote = "'";

  /** @type {string[]} */
  const characters = [];
  for (let code = 0x20; code <= 0x7e; code += 1) {
    characters.push(String.fromCharCode(code));
  }
  // And a sample from outside it: the three whitespace characters a URL parser
  // deletes outright, a control character, two spaces that are not the space, a
  // full-width form of the character that separates a host from what precedes
  // it, something with no width at all, a line separator, and a character
  // outside the basic plane.
  for (const code of [0x09, 0x0a, 0x0d, 0x00, 0x1f, 0xa0, 0x2028, 0x3000, 0xff20, 0x200b, 0x1f600]) {
    characters.push(String.fromCodePoint(code));
  }
  assert.ok(characters.length > 100, 'the sweep is too small to be one');

  const directory = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    /** @type {{ file: string, url: string, character: string, spelling: string }[]} */
    const swept = [];
    for (const url of admitted) {
      for (const character of characters) {
        const spelling = `${url}${character}@evil.example.invalid/steal`;
        const file = `carried-${swept.length}.js`;
        writeFileSync(join(directory, file), `export const destination = ${quote}${spelling}${quote};\n`);
        swept.push({ file, url, character, spelling });
      }
    }

    const refusedFiles = new Set(
      scanTree(directory)
        .violations.filter((violation) => violation.rule === 'external-url')
        .map((violation) => violation.file.split('/').slice(-1)[0]),
    );

    /** @type {string[]} */
    const disagreed = [];
    for (const one of swept) {
      if (refusedFiles.has(one.file)) {
        continue;
      }
      // What the source names, which is not always the whole of what was
      // written: the string ends at the first character equal to the quote it
      // opened with.
      const named = one.spelling.split(quote)[0] ?? '';
      /** @type {string | null} */
      let reached = null;
      try {
        reached = new URL(named).host;
      } catch {
        reached = null;
      }
      const host = new URL(one.url).host;
      if (reached !== host) {
        disagreed.push(
          `${JSON.stringify(one.character)} after ${one.url} is admitted and names ${String(reached)} rather than ${host}`,
        );
      }
    }

    assert.deepEqual(disagreed, [], `the scan and the platform's parser disagree:\n${disagreed.join('\n')}`);

    // And the sweep refused nearly all of it, so the agreement above is an
    // agreement rather than a scan that admits nothing and a reading nothing
    // reaches. One character per destination is the quote the destination was
    // written between, and every other one of them is refused.
    assert.equal(
      refusedFiles.size,
      admitted.length * (characters.length - 1),
      'the sweep admitted more than the one character that ends a string, or refused that one as well',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('nothing in front of an admitted destination, and no seam inside one, carries it somewhere else', () => {
  // The other two directions, and the reason they are here is the shape of the
  // case above rather than anything it got wrong. That one writes a character
  // AFTER an admitted destination, so every spelling it can build begins with one
  // of the three — which means the whole of its proof is about suffixes, and two
  // shapes it structurally cannot reach were being spoken about as though it
  // covered them.
  //
  // The first is a character in FRONT. A destination the scan admits is admitted
  // because it sits whole between a matching pair of quotes, and what decides
  // that is as much the character before it as the one after.
  //
  // The second is a seam: one destination written as two strings with an operator
  // between them. Neither half has to look like a destination for the value to be
  // one, so this asks what a line like that is admitted for and what the value it
  // makes actually names.
  //
  // Both readings ask the platform's parser rather than a list, for the reason
  // the case above does: a list is what let the last of these through.
  const admitted = Object.keys(ALLOWED_URLS);
  const quote = "'";
  // What a relative destination is read against. One of the three admitted
  // spellings is the origin this project serves from, so it is the base a page
  // carrying any of these would resolve a relative reference against.
  const base = 'http://127.0.0.1:4173/index.html';
  const baseHost = new URL(base).host;

  /** @type {string[]} */
  const characters = [];
  for (let code = 0x20; code <= 0x7e; code += 1) {
    characters.push(String.fromCharCode(code));
  }
  for (const code of [0x09, 0x0a, 0x0d, 0x00, 0x1f, 0xa0, 0x2028, 0x3000, 0xff20, 0x200b, 0x1f600]) {
    characters.push(String.fromCodePoint(code));
  }

  /**
   * Every host the platform's parser reads a spelling as naming, both ways a
   * source can mean it: on its own, and against the page it is written in.
   *
   * @param {string} text
   * @returns {string[]}
   */
  const hostsOf = (text) => {
    /** @type {string[]} */
    const hosts = [];
    for (const how of [undefined, base]) {
      try {
        hosts.push(new URL(text, how).host);
      } catch {
        // A spelling this reading cannot make a destination out of names no host,
        // which is the outcome this case wants and not a failure to record.
      }
    }
    return hosts;
  };

  const directory = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    // A file per spelling, for the reason the sweep above uses one: three of the
    // characters swept end a line, and written into a shared file they would stop
    // being a character inside a destination at all.
    /** @type {{ file: string, what: string, named: string, host: string }[]} */
    const swept = [];

    for (const url of admitted) {
      const host = new URL(url).host;

      for (const character of characters) {
        const spelling = `${character}${url}`;
        const file = `in-front-${swept.length}.js`;
        writeFileSync(join(directory, file), `export const destination = ${quote}${spelling}${quote};\n`);
        swept.push({
          file,
          what: `${JSON.stringify(character)} in front of ${url}`,
          // What the source names, which ends at the first character equal to the
          // quote it opened with — exactly as the sweep above reads it.
          named: spelling.split(quote)[0] ?? '',
          host,
        });
      }

      for (let at = 0; at <= url.length; at += 1) {
        const left = url.slice(0, at);
        const right = url.slice(at);
        const file = `seam-${swept.length}.js`;
        writeFileSync(
          join(directory, file),
          `export const destination = ${quote}${left}${quote} + ${quote}${right}${quote};\n`,
        );
        // A seam is the one shape where what the source names is not on the line:
        // it is what the two halves make once something has run, which is the
        // destination itself.
        swept.push({ file, what: `${url} split after ${at} character(s)`, named: left + right, host });
      }
    }

    const refusedFiles = new Set(
      scanTree(directory)
        .violations.filter((violation) => violation.rule === 'external-url')
        .map((violation) => violation.file.split('/').slice(-1)[0]),
    );

    /** @type {string[]} */
    const disagreed = [];
    for (const one of swept) {
      if (refusedFiles.has(one.file)) {
        continue;
      }
      const reached = hostsOf(one.named).filter((host) => host !== one.host && host !== baseHost);
      if (reached.length > 0) {
        disagreed.push(`${one.what} is admitted and names ${reached.join(' / ')} rather than ${one.host}`);
      }
    }

    assert.deepEqual(disagreed, [], `the scan and the platform's parser disagree:\n${disagreed.join('\n')}`);

    // And both halves of the sweep reached something, so the agreement above is an
    // agreement rather than a scan refusing everything or a reading nothing gets
    // to. Measured, they come out differently and the difference is the honest
    // shape of this: a character in front is refused for all but one character per
    // destination — the quote, which ends the string in front of the spelling
    // rather than inside it — while about a fifth of the seams are admitted,
    // because a split can leave two halves neither of which carries a scheme or a
    // pair of slashes. Those admitted seams are why the line above is worth
    // asserting: what the two halves make is the destination that was admitted
    // anyway, so admitting the line names nowhere new.
    //
    // What that same shape does when the two halves make something ELSE is the
    // miss this cannot close and does not pretend to: it is written down at the
    // top of `check-sinks-core.mjs` and carried by the known-miss fixture, where
    // a seam assembling a host off this origin is asserted to go straight
    // through. Nothing a line scan does can tell those two lines apart.
    const inFront = swept.filter((one) => one.file.startsWith('in-front-'));
    const seams = swept.filter((one) => one.file.startsWith('seam-'));
    assert.equal(inFront.length, admitted.length * characters.length, 'the sweep in front is not the sweep it says it is');
    assert.ok(seams.length > admitted.length * 20, 'the seam sweep is too small to be one');
    assert.ok(
      inFront.filter((one) => refusedFiles.has(one.file)).length > inFront.length - admitted.length * 2,
      'a character in front of an admitted destination stopped being refused, in more than the one spelling per destination that ends the string',
    );
    assert.ok(
      seams.some((one) => !refusedFiles.has(one.file)),
      'every seam is refused, so this half of the case is a scan agreeing with itself rather than a reading',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('nothing written inside the scheme of a destination stops this reading it as one', () => {
  // The third direction, and it is the one the two cases above structurally
  // cannot reach. Both of them keep an admitted destination whole and ask what a
  // character around it does. This one starts from a destination that is not
  // admitted and asks what a character INSIDE the part that makes it one does —
  // between the letters of the scheme, between the colon and the two characters
  // after it, and between those two.
  //
  // That position was missed, and the miss was real: a parser deletes a tab, a
  // line feed and a carriage return from the whole of an address before it reads
  // any of it, so `https:/⇥/host` names `host` while a reading that required the
  // two characters to be next to each other saw nothing. And what a parser trims
  // off the FRONT of an address is wider — every C0 control and the space — so a
  // space between the quote and the pair did the same to the alternative that is
  // anchored to that quote. Both were admitted before this case existed.
  //
  // So the sweep is a loop over every character at every position inside that
  // part, rather than the two or three somebody would think of. The invariant is
  // the same shape as the two above: this scan refuses the spelling, or the
  // platform's own parser does not read it as a destination under one of the two
  // schemes this rule is about naming the host it was written to name. A
  // spelling whose scheme has become something else — `htxtps:`, which is a
  // perfectly good scheme name and nothing a browser fetches — is neither, and is
  // not what this is asking about.
  //
  // The line feed is the one character left out of the set swept, and the reason
  // is what this scan reads rather than a hole being avoided: a line feed ends
  // the line, so it cannot be inside a destination written on one, and a
  // destination split over two lines is the miss listed at the top of
  // `check-sinks-core.mjs` and carried by the known-miss fixture. A carriage
  // return is not left out — this scan splits on the line ending, so one that is
  // not part of one stays inside the line, and it is swept with everything else.
  const target = 'evil.example.invalid';
  const base = 'http://127.0.0.1:4173/index.html';
  const quote = "'";

  /** @type {readonly { what: string, text: string, through: number }[]} */
  const carriers = [
    { what: 'a destination carrying its own scheme', text: `https://${target}/steal`, through: 'https://'.length },
    { what: "a destination borrowing the page's scheme", text: `//${target}/steal`, through: '//'.length },
  ];

  /** @type {string[]} */
  const characters = [];
  for (let code = 0x20; code <= 0x7e; code += 1) {
    characters.push(String.fromCharCode(code));
  }
  for (const code of [0x09, 0x0d, 0x00, 0x1f, 0xa0, 0x2028, 0x3000, 0xff20, 0x200b, 0x1f600]) {
    characters.push(String.fromCodePoint(code));
  }
  assert.ok(characters.length > 100, 'the sweep is too small to be one');
  assert.ok(!characters.includes('\n'), 'the line feed is swept, and a line scan has no line to sweep it on');

  const directory = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    /** @type {{ file: string, what: string, named: string }[]} */
    const swept = [];
    for (const carrier of carriers) {
      for (const character of characters) {
        for (let at = 0; at <= carrier.through; at += 1) {
          const spelling = `${carrier.text.slice(0, at)}${character}${carrier.text.slice(at)}`;
          const file = `inside-${swept.length}.js`;
          writeFileSync(join(directory, file), `export const destination = ${quote}${spelling}${quote};\n`);
          swept.push({
            file,
            what: `${JSON.stringify(character)} at ${at} of ${carrier.what}`,
            // What the source names, which ends at the first character equal to
            // the quote it opened with — as both sweeps above read it.
            named: spelling.split(quote)[0] ?? '',
          });
        }
      }
    }

    const refusedFiles = new Set(
      scanTree(directory)
        .violations.filter((violation) => violation.rule === 'external-url')
        .map((violation) => violation.file.split('/').slice(-1)[0]),
    );

    /** @type {string[]} */
    const disagreed = [];
    for (const one of swept) {
      if (refusedFiles.has(one.file)) {
        continue;
      }
      for (const how of [undefined, base]) {
        /** @type {URL | null} */
        let reached = null;
        try {
          reached = new URL(one.named, how);
        } catch {
          reached = null;
        }
        if (reached === null) {
          continue;
        }
        if (reached.host === target && (reached.protocol === 'http:' || reached.protocol === 'https:')) {
          disagreed.push(`${one.what} is admitted and still names ${reached.protocol}//${reached.host}`);
        }
      }
    }

    assert.deepEqual(disagreed, [], `the scan and the platform's parser disagree:\n${disagreed.join('\n')}`);

    // And the characters the parser takes out are refused at every position,
    // asked for by name. The invariant above is satisfied by a spelling nothing
    // reaches as well as by one this refuses, so the shapes this case was written
    // for are named rather than left to the arithmetic.
    for (const character of ['\t', '\r']) {
      const missed = swept.filter(
        (one) => one.what.startsWith(JSON.stringify(character)) && !refusedFiles.has(one.file),
      );
      assert.deepEqual(missed.map((one) => one.what), [], 'a character a parser deletes was written into a scheme and admitted');
    }
    for (const code of [0x20, 0x00, 0x1f]) {
      const character = String.fromCharCode(code);
      const missed = swept.filter(
        (one) =>
          one.what === `${JSON.stringify(character)} at 0 of a destination borrowing the page's scheme` &&
          !refusedFiles.has(one.file),
      );
      assert.deepEqual(
        missed.map((one) => one.what),
        [],
        'a character a parser trims off the front was written between the quote and the two slashes, and admitted',
      );
    }

    // And the sweep is a sweep rather than a scan that refuses everything: most
    // of these spellings are admitted, because most characters written into a
    // scheme leave something no browser fetches.
    assert.ok(refusedFiles.size > 0, 'the sweep refused nothing, so the readings above reach nothing');
    assert.ok(refusedFiles.size < swept.length, 'the sweep refused everything, so it is a scan agreeing with itself');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('every spelling of a typecheck suppression is refused', () => {
  // The test above asks that each rule fired somewhere, which is the right
  // question for a rule whose pattern is one construct written several ways. It
  // is the wrong question for this one: three independent comments, any two of
  // which could stop matching while the rule still fired on the third. So each
  // is asked for by name.
  const { violations } = scanTree(fixtureDir('violations'));
  const suppressions = violations.filter((violation) => violation.rule === 'typecheck-suppression');

  for (const spelling of SUPPRESSION_SPELLINGS) {
    assert.ok(
      suppressions.some((violation) => violation.text.includes(spelling)),
      `${spelling} in a shipped file was not refused`,
    );
  }
  assert.equal(suppressions.length, 3, 'the suppression fixture no longer carries exactly the three spellings');
});

test('every punctuation the code-execution rules name is refused', () => {
  // Two of these rules are alternations over punctuation rather than over
  // constructs: what follows the name decides whether the line is a call, an
  // indirect reference, or a capture. Dropping one alternative leaves the rule
  // firing on the fixture lines that use the others, so "it fired somewhere" is
  // satisfied by a rule that has quietly stopped seeing a whole shape — and the
  // one that was never exercised was the capture, which is how an alias reaches
  // a variable without ever being called on that line.
  const { violations } = scanTree(fixtureDir('violations'));

  for (const [rule, name] of [
    ['eval', 'eval'],
    ['Function-constructor', 'Function'],
  ]) {
    const fired = violations.filter((violation) => violation.rule === rule);
    for (const punctuation of ['(', ')', ',']) {
      assert.ok(
        fired.some((violation) => violation.text.includes(`${name}${punctuation}`)),
        `${name} followed by ${punctuation} was not refused`,
      );
    }
  }
});

test('the clean fixture produces no violations', () => {
  const { violations } = scanTree(fixtureDir('clean'));
  assert.deepEqual(violations, []);
});

test('the documented known misses are still missed', () => {
  // Documented limits, asserted so they stay documented:
  //   1. a property name assembled at runtime
  //   2. an identifier spelled with a unicode escape
  //   3. an alias captured with no call on the same line
  //   4. a call split across lines
  //   5. a member reached through an optional chain, where the rule that names
  //      it is anchored to a dot
  //   6. a member pulled out by destructuring, which never writes the pair
  //   7. a string reaching a timer through a variable
  //   8. the constructor chain reached from a literal
  //   9. a request captured with no call on the same line
  //  10. a destination borrowing the page's scheme from an unquoted attribute,
  //      which cannot be written in a script and so is a markup file in that
  //      fixture rather than a line of one
  //  11. the same destination with BOTH of its slashes leaning the other way,
  //      which is a pair this repository's own escape writing already puts after
  //      a quote in front of an ordinary letter, so looking for it there refuses
  //      lines that name nothing — the two mixed spellings cost nothing and are
  //      caught
  //  12. a destination assembled out of two strings joined at a seam, where
  //      neither half is a destination and only running the line makes one
  //  13. a destination whose scheme is followed by fewer than the two characters
  //      the construct this looks for is written with, which a parser reads as
  //      naming a host whenever that scheme is not the page's own — reaching it
  //      would mean matching a scheme and a colon and nothing else, and refusing
  //      every line that mentions one. Two fixture lines, one per scheme a page
  //      here can be served over, for the reason the sweep below sets out
  //
  // The two under numbers eleven and twelve were both rewritten when the matcher was
  // widened, and the reason is worth keeping: the line that used to stand for the
  // leaning spelling carried ONE backslash, which a parser resolves to a path on
  // this very origin — so the fixture demonstrated no miss while the paragraph
  // over it said it did. Every line in that fixture is now a value the platform's
  // own parser resolves off this origin under at least one of the two schemes a
  // page here is served over, and the sweep below says which, rather than
  // reporting one scheme's answer as though it were both.
  const { violations } = scanTree(fixtureDir('known-miss'));

  assert.deepEqual(
    violations,
    [],
    'a documented known miss is now being caught — that is good news, but the paragraph ' +
      'about the limits of this scan at the top of check-sinks-core.mjs and the list in ' +
      'the fixture itself both describe it as a miss, and both should be updated ' +
      'deliberately rather than left stale',
  );

  // And the destination misses are misses of something, which is the half a
  // fixture of unrefused lines cannot say on its own.
  //
  // A line nothing catches is a line nothing catches whether or not it names
  // anywhere. The leaning spelling in that fixture used to carry ONE backslash —
  // a value the platform's parser resolves to a path on this very origin — so the
  // fixture went through with a paragraph over it calling it an evasion, and the
  // assertion above passed exactly as it does now. What separates the two is the
  // value, and a value is something to read rather than something to describe.
  //
  // So each is written out here as the source spells it and as it means it, the
  // first required to be in the fixture and the second required to name an origin
  // that is not this one. Neither can be lost without this failing: the source
  // spelling pins the line, and the reading pins that the line is worth having.
  //
  // And they are read under BOTH schemes a page carrying them can be served
  // over, rather than under the one the suite's own server happens to use.
  //
  // That was the shape of a wrong sentence rather than a missing case. This
  // read every spelling against `http://…`, because that is what the harness
  // serves, and reported each of them as naming somewhere off this origin. One
  // of them does not: a scheme followed by fewer than two of the characters this
  // rule is written with is read by a parser as relative to the page whenever
  // the two schemes are the SAME, and the host lands in the path on this very
  // origin. So `https:/evil.example/x` names another host from an `http` page
  // and names nothing new from an `https` one. The line stood for a miss under
  // the scheme the harness runs on and for nothing at all under the other one,
  // with a sentence over it saying it stood for a miss.
  //
  // What is asked now is a verdict per spelling per scheme, written out here and
  // compared with the platform's own parser, so that no documented miss is a
  // miss only under the scheme this suite happens to run on. Two further
  // readings under it: no spelling may be on-origin under both schemes, which is
  // a fixture line demonstrating nothing at all; and every family must reach off
  // this origin under EACH scheme through one of its spellings, which is what
  // makes the set independent of the scheme rather than merely measured on both.
  //
  // What this cannot say is that these spellings are caught. They are not — that
  // is the whole of what a known miss is, and the assertion above is what holds
  // them missed. A line scan can reach none of the three: the seam only exists
  // once something has run, the leaning pair is a sequence this repository's own
  // escape writing puts after a quote in front of an ordinary letter, and the
  // short form would mean matching a scheme and its colon and nothing else. What
  // closes the request axis is not this scan at all: it is the browser suite,
  // which reads the ORIGIN of every request every surface makes and the PATH of
  // every request of a whole run, and refuses one that left this page's own
  // origin. And what holds at runtime, for every request no test drives, is CSP
  // `connect-src`, which is in this repository: the page carries the fetch-class
  // policy itself, and the browser suite pins it and drives a refusal under it.
  // The directives a page cannot carry arrive with the deploy configuration
  // instead.
  const schemes = ['http:', 'https:'];
  /** @param {string} scheme @returns {string} */
  const servedOver = (scheme) => `${scheme}//127.0.0.1:4173/index.html`;

  /** @type {readonly { file: string, what: string, family: string, spelled: string, means: string, off: readonly string[] }[]} */
  const destinations = [
    {
      file: 'known-miss.js',
      what: 'both slashes leaning the other way',
      family: 'a leaning pair',
      spelled: String.raw`const leaning = '\\\\evil.example/x';`,
      means: String.raw`\\evil.example/x`,
      off: ['http:', 'https:'],
    },
    {
      file: 'known-miss.js',
      what: 'two strings joined at a seam',
      family: 'a seam',
      spelled: String.raw`const seam = 'https:/' + '/evil.example/x';`,
      means: 'https://evil.example/x',
      off: ['http:', 'https:'],
    },
    {
      file: 'known-miss.js',
      what: 'a scheme followed by fewer than two of the characters this reads, from a page served over http',
      family: 'a short scheme',
      spelled: String.raw`const shortFromAnHttpPage = 'https:/evil.example/x';`,
      means: 'https:/evil.example/x',
      off: ['http:'],
    },
    {
      file: 'known-miss.js',
      what: 'the same shape from a page served over https',
      family: 'a short scheme',
      spelled: String.raw`const shortFromAnHttpsPage = 'http:/evil.example/x';`,
      means: 'http:/evil.example/x',
      off: ['https:'],
    },
    {
      file: 'known-miss.html',
      what: 'an unquoted markup attribute',
      family: 'a borrowed scheme',
      spelled: '<a href=//evil.example/x>go</a>',
      means: '//evil.example/x',
      off: ['http:', 'https:'],
    },
  ];

  /** @type {Map<string, Set<string>>} */
  const reachedBy = new Map();
  for (const one of destinations) {
    const source = readFileSync(join(fixtureDir('known-miss'), one.file), 'utf8');
    assert.ok(
      source.includes(one.spelled),
      `${one.what} is no longer written in ${one.file} the way this reads it, so the miss it stands for is unpinned`,
    );

    for (const scheme of schemes) {
      const base = servedOver(scheme);
      const onOrigin = new URL(base).origin;
      /** @type {string | null} */
      let reached = null;
      try {
        reached = new URL(one.means, base).origin;
      } catch {
        reached = null;
      }
      const wentOff = reached !== null && reached !== onOrigin;
      assert.equal(
        wentOff,
        one.off.includes(scheme),
        `${one.what} resolves to ${String(reached)} from a page served over ${scheme}, and this reads it as ` +
          `${one.off.includes(scheme) ? 'off' : 'on'} ${onOrigin}`,
      );
      if (wentOff) {
        reachedBy.set(one.family, (reachedBy.get(one.family) ?? new Set()).add(scheme));
      }
    }

    assert.ok(
      one.off.length > 0,
      `${one.what} is on this origin under every scheme, so the fixture line demonstrates no miss at all`,
    );
  }

  for (const [family, covered] of reachedBy) {
    assert.deepEqual(
      [...covered].sort(),
      [...schemes].sort(),
      `${family} is only demonstrated from a page served over ${[...covered].join(' and ')}, so under the other ` +
        'scheme this set of fixture lines shows nothing',
    );
  }
  assert.deepEqual(
    [...reachedBy.keys()].sort(),
    ['a borrowed scheme', 'a leaning pair', 'a seam', 'a short scheme'],
    'a family of documented misses has appeared or gone without this reading being decided about it',
  );
});

test('a tree with exactly one violation is a failure', () => {
  // The boundary between "clean" and "not", which the violations tree is far too
  // broken to reach: it carries dozens, so a scan that only reported a failure
  // once it had found several would fail that tree too and look correct. One is
  // not none.
  const { violations } = scanTree(fixtureDir('one-violation'));
  assert.equal(violations.length, 1, 'the one-violation fixture no longer carries exactly one');

  const result = runCli(fixtureDir('one-violation'));
  assert.equal(result.status, 1, 'a tree with one forbidden construct was reported as clean');
  assert.ok(
    result.stdout.includes('FAIL — 1 forbidden-sink violation(s)'),
    `the one-violation run did not report the one violation:\n${result.stdout}`,
  );
  assert.ok(!result.stdout.includes('PASS'), 'a tree with one forbidden construct printed a pass line');
});

test('a violation is reported at the line and with the text it is on', () => {
  // Where a violation is and what it says are arithmetic and a slice, and
  // nothing was reading either: every other case here counts violations or
  // names their rule, so the line number could be off by one, or fixed, and the
  // text could be any part of any line. A report nobody can follow to a line is
  // a report that has to be believed rather than checked.
  const { violations } = scanTree(fixtureDir('one-violation'));
  const [only] = violations;
  assert.ok(only !== undefined);

  const file = join(fixtureDir('one-violation'), 'one.js');
  const lines = readFileSync(file, 'utf8').split('\n');
  const at = lines.findIndex((line) => line.includes('.innerHTML'));
  assert.ok(at !== -1, 'the one-violation fixture no longer carries the construct this case is about');

  assert.equal(only.line, at + 1, 'the reported line is not the line the construct is on');
  assert.equal(only.text, lines[at]?.trim(), 'the reported text is not the line the construct is on');
  assert.equal(only.rule, 'innerHTML');
  assert.equal(only.file, relative(REPO_ROOT, file));
});

test('a violation on a line longer than the report is truncated to the reported width', () => {
  // The one arithmetic step in a report that nothing reached. Every fixture line
  // but one is comfortably shorter than the width a report truncates at, so the
  // slice that does the truncating never removed a character: widening it,
  // narrowing it, or deleting it left every case here reporting exactly what it
  // reported before, and the step was a gap with nothing written beside it.
  //
  // The width is spelled here rather than imported, for the reason every pin in
  // this repository is: read from the module it is in, this would pass whatever
  // that module said.
  const width = 120;

  const { violations } = scanTree(fixtureDir('violations'));
  const long = violations.filter((violation) => violation.text.length >= width);
  assert.equal(long.length, 1, 'the violations fixture no longer carries exactly one over-length line');

  const [only] = long;
  assert.ok(only !== undefined);
  assert.equal(only.text.length, width, 'a violation was reported at a width other than the one it truncates to');

  const source = readFileSync(join(REPO_ROOT, only.file), 'utf8').split(/\r?\n/);
  const line = source[only.line - 1];
  assert.ok(line !== undefined);
  assert.ok(line.trim().length > width, 'the over-length fixture line is no longer longer than the reported width');
  assert.equal(only.text, line.trim().slice(0, width), 'the reported text is not the start of the line it is on');

  // And the other side of the same step: a line shorter than the width comes
  // back whole, so this is a truncation rather than a fixed-width field.
  const short = violations.find((violation) => violation.text.length < width);
  assert.ok(short !== undefined);
  const shortSource = readFileSync(join(REPO_ROOT, short.file), 'utf8').split(/\r?\n/);
  assert.equal(short.text, shortSource[short.line - 1]?.trim());
});

test('an empty tree cannot be scanned, and says so', () => {
  // Not a clean tree: a scan that read nothing has not shown that anything is
  // clean, and the difference between "no violations" and "no files" is the
  // difference between a check and a check that has been pointed at nothing.
  // Exit 2 rather than 0, from outside, because the comparison that tells the
  // two apart is a count against zero and every other case here hands it a
  // count that is far from it.
  const directory = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    const result = runCli(directory);

    assert.equal(result.status, 2, 'an empty tree was scanned rather than refused');
    assert.ok(result.stderr.includes('cannot scan'), `the empty run gave a different reason:\n${result.stderr}`);
    assert.ok(!result.stdout.includes('PASS'), 'an empty tree printed a pass line');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('no module the checks are made of turns the type checker off', () => {
  // The suppression rule is declared for files of every extension, and the only
  // tree it was ever run over was `site/`. So the modules that decide whether
  // any of these checks pass — the scan engine, the manifest pins, both
  // runners' policies, the suites themselves — were outside its reach entirely,
  // while the second typecheck configuration covers exactly those. One comment
  // at the top of one of them turns the checker off for a module that judges a
  // suite, with both configurations still saying what they are pinned to say and
  // this scan never looking.
  //
  // Read here rather than by extending what `check:sinks` walks, because the
  // other rules cannot be run over this tree: their patterns are written in it,
  // and a line-based scan cannot tell a pattern from the construct it is for.
  // This one rule can, because its spellings are written in one place — the
  // pattern — and nowhere else.
  const rule = RULES.find((one) => one.id === 'typecheck-suppression');
  assert.ok(rule !== undefined, 'the suppression rule is gone');

  /** @type {string[]} */
  const found = [];
  const readable = [
    ...POLICY_TREES.flatMap((tree) => collectFiles(join(REPO_ROOT, tree))),
    ...POLICY_FILES.map((file) => join(REPO_ROOT, file)),
  ];
  {
    for (const file of readable) {
      const shown = relative(REPO_ROOT, file);
      if (OUTSIDE_THE_TYPECHECK.some((outside) => shown === outside || shown.startsWith(`${outside}/`))) {
        continue;
      }
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (rule.pattern.test(line)) {
            found.push(`${shown}:${index + 1}  ${line.trim().slice(0, 120)}`);
          }
        });
    }
  }

  assert.deepEqual(found, [], `the type checker is turned off in:\n${found.join('\n')}`);

  // And the reading is shown to find one, so a clean answer is an answer rather
  // than a walk that reached nothing. Each spelling separately, because the
  // rule is three independent alternatives.
  for (const spelling of SUPPRESSION_SPELLINGS) {
    assert.ok(rule.pattern.test(`// ${spelling}`), `${spelling} is no longer refused`);
  }
  assert.ok(readable.length > 20, `the reading covered ${readable.length} file(s), which is not the tree it is for`);
  assert.ok(readable.some((file) => file.endsWith('run-node-tests-core.mjs')));
  assert.ok(readable.some((file) => file.endsWith('run-browser-tests-core.mjs')));
  assert.ok(readable.some((file) => file.endsWith('check-manifest-core.mjs')));
  assert.ok(readable.some((file) => file.endsWith('check-sinks-core.mjs')));
  assert.ok(readable.some((file) => file.endsWith('playwright.config.js')));

  // And the reading covers the configuration's scope rather than approximately
  // covering it. Every entry of that scope is either a tree walked above or the
  // file read beside it, compared against what the manifest pins the scope to
  // be — so a scope that grows an entry is a comparison that fails here rather
  // than a corner nothing reads.
  const tooling = CHECK_CONFIGS['tsconfig.tooling.json'];
  assert.ok(tooling !== undefined, 'the manifest no longer pins the tooling typecheck configuration');
  const covered = new Set([...POLICY_TREES.map((tree) => `${tree}/**/*`), ...POLICY_FILES]);
  const uncovered = tooling.include.filter((entry) => !covered.has(entry.replace(/\.(js|mjs)$/, '')) && !covered.has(entry));
  assert.deepEqual(
    uncovered,
    [],
    `the tooling typecheck reads ${uncovered.join(', ')}, which this reading does not cover`,
  );
});

test('markup rules reach every configured markup extension', () => {
  const { violations } = scanTree(fixtureDir('violations'));

  for (const extension of ['.html', '.htm', '.xhtml', '.svg']) {
    const hits = violations.filter(
      (violation) => violation.file.endsWith(extension) && violation.rule === 'inline-event-attribute',
    );
    assert.ok(hits.length > 0, `markup-scoped rules did not apply to a ${extension} file`);
  }
});

test('script rules reach .mjs, not only .js', () => {
  const { violations } = scanTree(fixtureDir('violations'));
  const inMjs = violations.filter(
    (violation) => violation.file.endsWith('.mjs') && violation.rule === 'event-handler-property',
  );

  assert.ok(inMjs.length > 0, 'script-scoped rules did not apply to a .mjs file');
});

test('the scan reads every line of a file, and every extension it is handed', () => {
  // Three readings that decide how much of a tree is actually looked at, none of
  // which any fixture could see. Every fixture under `test/sink-fixtures/` is
  // under a hundred lines and every one of them is named in lower case, so a
  // scan that read the first two hundred lines of a file, or that treated an
  // extension it did not recognise as nothing to scan, or that exempted one
  // extension from every rule that applies to any file, answered exactly the
  // same on all of them — while the shipped tree it is aimed at carries files
  // several hundred lines long.
  const dir = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    // How far into a file the scan reaches. Deliberately past the end of
    // anything this repository holds, so this is a claim about the reading
    // rather than about the length of some file that might shrink.
    const deep = 4000;
    const write = `el.${'inner'}HTML = 'x';\n`;
    writeFileSync(join(dir, 'deep.js'), `${'const value = 1;\n'.repeat(deep - 1)}${write}`);
    const deepHits = scanTree(dir).violations.filter((violation) => violation.file.endsWith('deep.js'));
    assert.ok(
      deepHits.some((violation) => violation.line === deep),
      `a violation on line ${deep} was not reported, so the scan does not read a whole file`,
    );
    rmSync(join(dir, 'deep.js'));

    // And the extension, which decides which rules apply at all. It is read
    // through a normalisation nothing observed: an upper-case name is the same
    // extension, and a scan that compared it as written would silently drop every
    // rule scoped to a kind of file. Both scoped rules, because they are scoped
    // to different lists.
    writeFileSync(join(dir, 'SHOUTED.JS'), 'el.onclick = handler;\n');
    writeFileSync(join(dir, 'SHOUTED.HTML'), '<a onclick="go()">go</a>\n');
    const shouted = scanTree(dir).violations;
    assert.ok(
      shouted.some((violation) => violation.file.endsWith('SHOUTED.JS') && violation.rule === 'event-handler-property'),
      'a script-scoped rule did not apply to a file whose extension is spelled in upper case',
    );
    assert.ok(
      shouted.some((violation) => violation.file.endsWith('SHOUTED.HTML') && violation.rule === 'inline-event-attribute'),
      'a markup-scoped rule did not apply to a file whose extension is spelled in upper case',
    );
    rmSync(join(dir, 'SHOUTED.JS'));
    rmSync(join(dir, 'SHOUTED.HTML'));

    // And that a rule which applies to any file applies to any file. The reading
    // that decides it is one expression, and an extension exempted there is a
    // whole kind of served file nothing looks at — with every fixture still
    // reporting exactly what it reported before, because each of them is one
    // extension asking about its own rules. So one text is written out under
    // every extension the shipped tree could carry, and the rules that fire have
    // to be the same rules each time.
    const text = readFileSync(join(FIXTURES, 'violations', 'sinks.js'), 'utf8');
    const anyRules = new Set(RULES.filter((rule) => rule.files === 'any').map((rule) => rule.id));
    assert.ok(anyRules.size > 0, 'no rule applies to any file, so this asks nothing');

    const extensions = ['.js', '.mjs', '.html', '.htm', '.xhtml', '.svg', '.css', '.txt', ''];
    for (const extension of extensions) {
      writeFileSync(join(dir, `same${extension}`), text);
    }
    const spread = scanTree(dir).violations;
    /** @param {string} extension */
    const firedIn = (extension) =>
      [
        ...new Set(
          spread
            .filter((violation) => violation.file.endsWith(`same${extension}`))
            .map((violation) => violation.rule)
            .filter((rule) => anyRules.has(rule)),
        ),
      ].sort();

    const expected = firedIn('.js');
    assert.ok(expected.length > 1, 'the shared text does not break enough rules for this to be a comparison');
    for (const extension of extensions) {
      assert.deepEqual(
        firedIn(extension),
        expected,
        `the rules that apply to any file did not all apply to ${JSON.stringify(extension || 'a file with no extension')}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a symlinked entry in the scanned tree fails the scan closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    writeFileSync(join(dir, 'real.js'), 'export const value = 1;\n');
    symlinkSync(join(dir, 'real.js'), join(dir, 'link.js'));

    assert.throws(() => scanTree(dir), ScanError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a symlinked scan root fails the scan closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    const real = join(dir, 'real');
    mkdirSync(real);
    writeFileSync(join(real, 'a.js'), 'export const value = 1;\n');
    const link = join(dir, 'link');
    symlinkSync(real, link, 'dir');

    assert.throws(() => scanTree(link), ScanError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the command line exits 1 and prints FAIL on a violations tree', () => {
  const result = runCli(fixtureDir('violations'));

  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes('FAIL —'), 'the violations run printed no FAIL line');
});

test('the command line exits 0 on a clean tree', () => {
  const result = runCli(fixtureDir('clean'));

  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('PASS —'), 'the clean run printed no PASS line');
});

test('the command line exits 2 on a missing tree', () => {
  const result = runCli(fixtureDir('does-not-exist'));

  assert.equal(result.status, 2);
});

test('the invocation that names no tree scans the shipped one', () => {
  // The subject of this whole check, which nothing was asking about. Every other
  // case here points the scanner at a fixture tree and reads what it said about
  // it; the run that matters points itself, and where it points was a path
  // written once in the command-line front end with nothing beside it. Moved to
  // `site/css`, the step reported "scanned 1 file(s) under site/css/ … PASS" and
  // `npm run check` exited 0 with `el.innerHTML = s` exported from a served
  // module.
  //
  // Held from outside in the two ways it can be got wrong. The constant can be
  // repointed, so it is compared against a path written here rather than taken
  // from there. And the constant can be left alone while the program scans
  // something else, so a run that named no tree is asked what it actually
  // reached.
  assert.equal(SHIPPED_TREE, join(REPO_ROOT, 'site'), 'the scan is aimed somewhere other than the served tree');

  const shipped = collectFiles(SHIPPED_TREE).map((file) => relative(REPO_ROOT, file));
  assert.ok(shipped.length > 0, 'the served tree holds no files, so a pass over it would show nothing');

  // The files a scan of the served tree cannot have missed: the page that is
  // served and every module reachable from it. A count on its own is a count,
  // and a tree of the right size is not the tree.
  for (const file of [
    'site/index.html',
    'site/js/main.js',
    'site/js/dispatch.js',
    'site/js/render.js',
    'site/js/validate.js',
    'site/js/parse.js',
    'site/js/crypto.js',
  ]) {
    assert.ok(shipped.includes(file), `${file} is not among the files the shipped tree holds`);
  }

  const result = runCli(null);

  assert.equal(result.status, 0, `the default invocation did not exit 0:\n${result.stdout}\n${result.stderr}`);
  assert.ok(
    result.stdout.includes(`scanned ${shipped.length} file(s) under site/ `),
    `the default invocation did not report having scanned the ${shipped.length} file(s) under site/:\n${result.stdout}`,
  );
  assert.ok(
    result.stdout.includes('PASS — no configured pattern matched in site/'),
    `the default invocation did not report a pass over site/:\n${result.stdout}`,
  );

  // And the reading bites: a forbidden construct in the tree the run points
  // itself at is refused by that run, not only by the runs a fixture points.
  // Planted in a copy rather than in the tree that is served, for the reason
  // `copyOfTheCheck` sets out.
  const directory = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    const cli = copyOfTheCheck(directory);
    assert.equal(runCli(null, cli).status, 0, 'the copy the plant goes into was not clean before it went in');

    writeFileSync(
      join(directory, 'site', 'js', 'a-file-this-test-writes.js'),
      `const el = document.body;\nel.${'inner'}HTML = 'x';\n`,
    );
    const withSink = runCli(null, cli);
    assert.equal(withSink.status, 1, 'a forbidden construct in the tree a default run aims at was not refused');
    assert.ok(
      withSink.stdout.includes('site/js/a-file-this-test-writes.js'),
      `the default run did not name the file it found:\n${withSink.stdout}`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the two requests and the three destinations are where they are allowed to be', () => {
  // The two claims the rules above cannot make, because a rule reads lines and
  // neither of these is about a line.
  //
  // The first is a count. One served file may make a request; the scan says
  // "not here" everywhere else and says nothing at all about how many times the
  // construct appears where it is allowed. "Somewhere" is not "twice", and a
  // third request added to that module is a third thing this page sends.
  //
  // The second is a place. Three destinations are admitted by exact spelling,
  // and the pattern that admits them admits them anywhere — so a copy of the
  // policy link assigned in a script would pass the scan while being the one
  // thing the page is built not to do. This is what says which file each of the
  // three belongs in, and that each appears once.
  //
  // Both are written out here rather than read from the module they are about,
  // like every other pin in this repository.
  const rule = RULES.find((one) => one.id === 'network-request');
  assert.ok(rule !== undefined, 'the rule that refuses requests is gone');
  assert.deepEqual(
    [...(rule.exceptFiles ?? [])],
    ['site/js/flow.js'],
    'the request construct is allowed in a different set of files than the one pinned here',
  );
  for (const other of RULES) {
    if (other.id === 'network-request') {
      continue;
    }
    assert.equal(
      other.exceptFiles,
      undefined,
      `${other.id} exempts a file, and only the rule about requests may exempt one`,
    );
  }

  assert.equal(NETWORK_FILE, 'site/js/flow.js');
  assert.equal(NETWORK_CALL_SITES, 2);
  assert.equal(
    countNetworkCallSites(),
    NETWORK_CALL_SITES,
    'the one file that may make a request does not make exactly the requests it is allowed',
  );

  // And the count is a reading rather than a constant: a tree with no such file
  // in it answers that it found none.
  const elsewhere = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    writeFileSync(join(elsewhere, 'a.js'), 'export const value = 1;\n');
    assert.equal(countNetworkCallSites(elsewhere), -1, 'a tree without that file was counted as though it had one');
  } finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }

  // The exception is by whole path, so the same construct in any other served
  // file is refused. In a copy of the tree rather than in the tree that is
  // served, for the reason `copyOfTheCheck` sets out.
  const directory = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    const cli = copyOfTheCheck(directory);
    assert.equal(runCli(null, cli).status, 0, 'the copy the plant goes into was not clean before it went in');

    writeFileSync(
      join(directory, 'site', 'js', 'a-file-this-test-writes.js'),
      "export const asked = () => fetch('/somewhere');\n",
    );
    const withRequest = runCli(null, cli);
    assert.equal(withRequest.status, 1, 'a request in a served file that is not the one that may was not refused');
    assert.ok(
      withRequest.stdout.includes('network-request'),
      `the run did not name the rule that refuses it:\n${withRequest.stdout}`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  // The two spellings the anchor decides between, one caught and one named as a
  // miss. A call with a space before its parenthesis is a call; a reference
  // captured with no call on the line is not reachable by a line scan, and the
  // known-miss fixture carries it so that a rule change which starts catching it
  // is a deliberate update rather than a drift.
  const caught = scanTree(fixtureDir('violations')).violations.filter((one) => one.rule === 'network-request');
  assert.ok(
    caught.some((one) => one.text.includes('fetch (')),
    'a request written with a space before its parenthesis was not refused',
  );
  const missed = readFileSync(join(fixtureDir('known-miss'), 'known-miss.js'), 'utf8');
  assert.ok(missed.includes('= fetch;'), 'the known-miss fixture no longer carries a captured request');
  assert.deepEqual(
    scanTree(fixtureDir('known-miss')).violations,
    [],
    'a captured request is now caught — good news, and the honesty paragraph in the core and the fixture both call it a miss',
  );

  // And the three destinations, each once, each where it belongs.
  assert.deepEqual(
    ALLOWED_URLS,
    {
      'https://apps.apple.com/au/app/id6758035505': 'site/index.html',
      'https://patientscribe.com.au/privacy-policy': 'site/index.html',
      'http://127.0.0.1:4173': 'site/js/config.js',
    },
    'the destinations this viewer admits have changed, and that is a decision rather than an edit',
  );
  const where = countAllowedUrls();
  for (const [url, file] of Object.entries(ALLOWED_URLS)) {
    assert.deepEqual(
      where[url],
      [{ file, count: 1 }],
      `${url} is not written exactly once in ${file}`,
    );
  }

  // And the third claim, which is neither a count nor a place: what the table of
  // destinations SAYS.
  //
  // Everything above is satisfied by a table that sends the wrong pages to the
  // wrong place. The two readings are of spellings and of files: each of the
  // three destinations is admitted, and each appears once, in the file it
  // belongs to. A second origin added to that table is admitted by the first as
  // soon as it is written into `ALLOWED_URLS` — which a reviewed change adding
  // it would do — and counted by the second as one appearance in `config.js`,
  // which is where it belongs. Neither of them looks at which key it is under.
  //
  // That is the one edit worth reading for here, because it is the edit going
  // live is: the table commits one key today, written as one constant used as
  // both halves so the two cannot come apart, and a second entry is the first
  // moment they can. `{ [DEVELOPMENT]: DEVELOPMENT, [PRODUCTION]: DEVELOPMENT }`
  // is one word wrong and every production recipient's access code goes to a
  // development host, with every reading above unchanged.
  const table = readApiOrigins();
  assert.deepEqual(
    table.failures,
    [],
    'the served origin table sends a page somewhere other than to the origin it was served from',
  );
  assert.ok(table.entries.length > 0, 'the origin table was read as having no entries, so nothing above was read');
  for (const entry of table.entries) {
    assert.equal(
      entry.destination,
      entry.key,
      `a page served from ${entry.key} is sent to ${entry.destination}`,
    );
  }

  // And the reading is a reading. Two scratch trees, one written the way the
  // served file is written and one written the way going live goes wrong, so the
  // refusal above is something this has been shown to produce rather than a
  // silence nobody has separated from an empty function.
  const tables = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    /** @param {string} body @returns {{ entries: unknown[], failures: string[] }} */
    const readWith = (body) => {
      const js = join(tables, 'site', 'js');
      mkdirSync(js, { recursive: true });
      writeFileSync(join(js, 'config.js'), body);
      return readApiOrigins(join(tables, 'site'));
    };

    const wellFormed = readWith(
      [
        "const DEVELOPMENT_ORIGIN = 'http://127.0.0.1:4173';",
        "const PRODUCTION_ORIGIN = 'https://viewer.example';",
        'const API_ORIGINS = Object.freeze({',
        '  [DEVELOPMENT_ORIGIN]: DEVELOPMENT_ORIGIN,',
        '  [PRODUCTION_ORIGIN]: PRODUCTION_ORIGIN,',
        '});',
        '',
      ].join('\n'),
    );
    assert.deepEqual(wellFormed.failures, [], 'a table where every origin answers for itself was refused');
    assert.deepEqual(wellFormed.entries, [
      { key: 'http://127.0.0.1:4173', destination: 'http://127.0.0.1:4173' },
      { key: 'https://viewer.example', destination: 'https://viewer.example' },
    ]);

    const goingLive = readWith(
      [
        "const DEVELOPMENT_ORIGIN = 'http://127.0.0.1:4173';",
        "const PRODUCTION_ORIGIN = 'https://viewer.example';",
        'const API_ORIGINS = Object.freeze({',
        '  [DEVELOPMENT_ORIGIN]: DEVELOPMENT_ORIGIN,',
        '  [PRODUCTION_ORIGIN]: DEVELOPMENT_ORIGIN,',
        '});',
        '',
      ].join('\n'),
    );
    assert.ok(
      goingLive.failures.some(
        (line) => line.includes('https://viewer.example') && line.includes('http://127.0.0.1:4173'),
      ),
      `the one-word edit that sends production somewhere else was read as well formed:\n${goingLive.failures.join('\n')}`,
    );

    // The same entry written out in full rather than through a constant, which
    // is the other way that edit can be spelled — and the one where the
    // separator between the two halves is not the first colon on the line or the
    // last.
    const spelledOut = readWith(
      [
        'const API_ORIGINS = Object.freeze({',
        "  'https://viewer.example': 'http://127.0.0.1:4173',",
        '});',
        '',
      ].join('\n'),
    );
    assert.ok(
      spelledOut.failures.some(
        (line) => line.includes('https://viewer.example') && line.includes('http://127.0.0.1:4173'),
      ),
      `the same edit written out in full was read as well formed:\n${spelledOut.failures.join('\n')}`,
    );

    // And a table this cannot take apart is a reason rather than a silence: a
    // reading that skipped what it did not understand would report nothing at
    // all about a table written in some other shape.
    const unreadable = readWith('const API_ORIGINS = whatever;\n');
    assert.ok(
      unreadable.failures.some((line) => line.includes('this cannot read it')),
      `a table written in a shape this does not read was reported as nothing to report:\n${unreadable.failures.join('\n')}`,
    );
  } finally {
    rmSync(tables, { recursive: true, force: true });
  }
});

test('the command line still scans when reached through a symlinked path', () => {
  // The regression this exists for: a main-module guard comparing a
  // realpath-resolved import.meta.url against an as-invoked argv[1] made the
  // whole check exit 0 without scanning whenever the script was reached through
  // a symlink. There is no guard now, and this proves it.
  const dir = mkdtempSync(join(tmpdir(), 'sink-selftest-'));
  try {
    const linkedRepo = join(dir, 'repo');
    symlinkSync(REPO_ROOT, linkedRepo, 'dir');
    const linkedCli = join(linkedRepo, 'scripts', 'check-sinks.mjs');

    const result = runCli(fixtureDir('violations'), linkedCli);

    assert.equal(result.status, 1, 'the check did not run through the symlinked path');
    assert.ok(result.stdout.includes('FAIL —'), 'the symlinked invocation printed no FAIL line');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
