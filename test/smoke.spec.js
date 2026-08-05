import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The viewer's module graph, as the page loads it.
 *
 * The entry point first, then everything reachable from it: `main.js` imports
 * `dispatch.js`, which imports `validate.js` and `render.js`, and `validate.js`
 * imports `parse.js`. Written out here rather than derived from the modules,
 * for the reason every pin in this repository is written that way — a check that
 * takes its expectation from the thing it is checking passes whatever that thing
 * says.
 *
 * A list rather than a count, and the whole list rather than a floor: a module
 * dropping out of the graph and a module joining it are both changes to what the
 * page loads, and both should be an edit here. `crypto.js` is served and is
 * deliberately not on it, which is a fact about what the page fetched rather
 * than a reading of anyone's import statements.
 *
 * Fetched is what this list is, and only that. A request list says a file was
 * asked for; it does not say what asked for it, and nothing downstream of it
 * can. That these fetches came from static imports is inferred, from the other
 * reads in the test below rather than from the requests: the page names one
 * module script and no other script, carries no preloading link of either
 * spelling, and is the elements it is — so the ways a module could be fetched
 * without a module importing it are closed one at a time, and what is left is
 * the entry point and its imports. The inference is only ever as good as those
 * reads, which is why they are whole-list comparisons and not searches.
 *
 * @type {readonly string[]}
 */
const MODULE_GRAPH = ['/js/main.js', '/js/dispatch.js', '/js/validate.js', '/js/render.js', '/js/parse.js'];

/** The one module the page itself names, which the rest of the graph hangs off. */
const ENTRY_POINT = 'js/main.js';

/** The one stylesheet the page names. */
const STYLESHEET = 'css/viewer.css';

/** The id of the element the entry point resolves, spelled here as the page spells it. */
const ROOT_ID = 'viewer-root';

/**
 * Every element the served page carries, in document order, with every
 * attribute each one has.
 *
 * The page is nine elements long, so what it is made of is written down rather
 * than described. That is what makes the assertions about links and scripts
 * below into a statement about the page's whole fetching surface instead of a
 * statement about two element names: an `<img>`, an `<iframe>`, a `<video>` with
 * a `<source>`, an `<object>` or an `<embed>` each fetch whatever their
 * attribute names, none of them is a link or a script, and every one of them
 * would put a file into the request list that no module imported. Rather than
 * enumerate the element names that can fetch — a list nobody finishes, and one
 * that grows with the platform — the page is required to be the elements it is.
 *
 * Attributes as well as names, because a tag list is not the fetching surface
 * either. Which elements the page has says nothing about what they carry, and an
 * attribute on an element that is already here fetches just as well as a new
 * element does: `style="background-image:url('js/dispatch.js')"` on the `<html>`
 * element that has always been here puts a module in the request list with the
 * tag list unchanged, and so does a `background`, a `formaction`, or an `src`
 * moved onto something that did not have one. Two of the nine elements here are
 * `meta` tags carrying nothing but a name, and a name is one word from
 * `http-equiv="refresh"`, which navigates. So each element is required to carry
 * exactly the attributes it carries, by name and by value.
 *
 * @type {readonly { tag: string, attributes: Readonly<Record<string, string>> }[]}
 */
const PAGE_ELEMENTS = [
  { tag: 'html', attributes: { lang: 'en' } },
  { tag: 'head', attributes: {} },
  { tag: 'meta', attributes: { charset: 'utf-8' } },
  { tag: 'meta', attributes: { name: 'viewport', content: 'width=device-width, initial-scale=1' } },
  { tag: 'title', attributes: {} },
  { tag: 'link', attributes: { rel: 'stylesheet', href: STYLESHEET } },
  { tag: 'script', attributes: { type: 'module', src: ENTRY_POINT } },
  { tag: 'body', attributes: {} },
  { tag: 'main', attributes: { id: ROOT_ID } },
];

/**
 * Where the page records the element lookups made in it.
 *
 * The entry point's whole observable act, in this scaffold, is asking the
 * document for one element by id. Nothing it does afterwards writes anything or
 * reaches anywhere, so that lookup is the only trace its top-level call leaves —
 * and a page instrumented to record lookups before any of its own scripts run is
 * where the trace can be read.
 */
const ROOT_LOOKUPS = '__viewerRootLookups';

/**
 * Harness smoke test.
 *
 * This asserts that the harness works, not that the viewer does. It proves a
 * browser starts, the page is served, and the module graph resolves and runs
 * without error — which is the precondition for every behavioural test that
 * follows, and the thing most likely to be silently broken by a renamed file or
 * a bad import path.
 *
 * That was the claim in its name and, until this round, not the claim it made.
 * What it asked was that the response was 200, that one `#viewer-root` was in
 * the page, and that nothing was written to any console channel — every one of
 * which is true of a page with no script in it at all. Deleting the single
 * `<script type="module">` line from `site/index.html` disconnected the shipped
 * entry point from every module behind it and left `npm run check` at exit 0,
 * with this test passing under a name that says the module graph ran.
 *
 * So the graph is read from the requests the page actually made. The page names
 * one entry point; that entry point has to have been fetched and answered; and
 * everything it imports has to have been fetched and answered too, because a
 * module graph is fetched whole before it is evaluated.
 *
 * Fetched is not imported, and it is worth being exact about the difference,
 * because two edits turn one into the other and neither is visible in a list of
 * requests. A module can be fetched without any module importing it — a
 * `<link rel="modulepreload">` in the head fetches it, and so does a `preload`
 * of the same file — so stripping the entry point's imports and preloading the
 * rest leaves this list exactly as it is while the graph behind the entry point
 * is gone. And a second script in the page can fetch anything at all, and so can
 * an element that is neither a link nor a script: `<img src="js/dispatch.js">`
 * fetches a module the request list then carries while nothing imported it. So
 * what the page carries is read whole rather than searched for — the link list,
 * the script list, and the elements of the page itself with every attribute each
 * one carries, all three compared against what is written at the top of this
 * file — which is what makes a fetch of a module a fetch some module asked for.
 *
 * Elements and attributes both, because either alone is a surface with a hole in
 * it. A new element that fetches is caught by the element list; an attribute
 * added to an element already on that list is not, and an inline
 * `style="background-image:url(…)"` on the `<html>` element fetches whatever it
 * names with every tag in the page unchanged. So the read is the whole of each
 * element, name and attributes together.
 *
 * Fetching surfaces outside all three of those reads are residuals rather than
 * things covered, and there is more than one of them. This used to say there was
 * exactly one, which was a claim about what had been thought of rather than about
 * what the reads reach. Three are known, and none of them is chased with new
 * machinery here:
 *
 *   - A stylesheet fetches, through `url()` and through `@import`, and neither is
 *     an element or an attribute — it is the content of a file. What stands in
 *     for reading it is narrow and is worth naming rather than implying: the page
 *     names exactly one stylesheet, which is the link assertion below and also
 *     the `link` element's attributes in the whole-page read, and
 *     `npm run check:sinks` scans what is under `site/` for the sinks this
 *     project forbids. What is not established is that stylesheet fetching
 *     something, and closing it would mean parsing CSS.
 *   - A resource element a script builds and never inserts fetches all the same,
 *     and the page's inventory of elements and attributes is identical
 *     afterwards — the element was never in the page to be inventoried.
 *   - Egress through a computed property, `navigator['sendBeacon']`, passes the
 *     sink scan, which reads names in lines rather than what a line resolves to.
 *     It is one of the misses that scan documents about itself.
 *
 * All three are the same kind of thing: a change to a served file rather than a
 * silent one, visible in a diff, and answered at runtime by CSP — `style-src` and
 * `img-src` for what a stylesheet fetches, `connect-src` for what leaves the
 * page — which arrives with the deploy configuration and is where a control of
 * this kind belongs. What is written here is where these reads stop, not a list
 * anybody should read as finished.
 *
 * Fetched is not evaluated either, and that is the second half. A graph that
 * fetched completely and then failed to evaluate reports an error to the page,
 * and the two assertions at the end are what say none was reported — but an
 * entry point whose top-level call has been reduced to a mention of the function
 * evaluates perfectly and does nothing, which is the whole of what the name of
 * this test claims. `main.js` resolves one element by id and that is its only
 * observable act, so the lookup is instrumented before any script in the page
 * runs and the record of it is read afterwards. Nothing about the shipped bytes
 * changes for that: the call is already there, and this is the first thing to
 * look at whether it happened.
 *
 * What that last read establishes is exactly one thing, and it is narrower than
 * "the entry point ran": the viewer root was resolved, once, by that id. Any
 * line producing that lookup satisfies it — the top-level call replaced by a
 * mention of the function, with the lookup made from somewhere else, would pass.
 * The reason it is written this way is that `boot` has no other observable: it
 * resolves the root, returns when there is none, and refers to the seam it will
 * hand over to. Telling "it ran" from "the lookup happened" needs an observable
 * it does not have, and manufacturing one here would be instrumenting the test
 * rather than reading the viewer. So this pin is the proxy, stated as a proxy.
 * When `boot` gains work — reading the link, and the call into `dispatchDoc`
 * that this file already knows the shape of — that work is what to assert
 * instead, and this is the assertion to revisit then.
 *
 * There are deliberately no assertions about viewer behaviour here. That is a
 * division of labour rather than a statement about the viewer: `core.spec.js`
 * beside this file runs the corpus in this same engine and asserts hundreds of
 * behavioural outcomes against the served modules. What this file holds is the
 * precondition all of them rest on, which is exactly the thing that cannot be
 * asserted from inside a suite that has already failed to load.
 */
test('the page is served and its module graph runs without error', async ({ page }) => {
  // Every console channel, not only errors: this page has nothing to say at any
  // level, so anything it says is something to look at.
  /** @type {string[]} */
  const consoleOutput = [];
  /** @type {string[]} */
  const pageErrors = [];
  /** @type {Map<string, number>} */
  const modulesFetched = new Map();

  page.on('console', (message) => {
    consoleOutput.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  // What the page asked the server for, by path and by what it got back. Only
  // the script tree: the stylesheet and the document itself are answered
  // elsewhere in this test, and a request for anything outside `/js/` is not a
  // module of this viewer.
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/js/')) {
      modulesFetched.set(path, response.status());
    }
  });

  // Installed before anything in the page runs, so the entry point's own call is
  // one of the calls it records. The stand-in does the real lookup and hands
  // back the real answer; all it adds is the note that it was asked.
  await page.addInitScript((slot) => {
    // Reached through the global object rather than written as the names
    // `window` and `document`, because this file type-checks in the tooling
    // world, and that world deliberately cannot see browser globals: the harness
    // itself runs in node, and only this callback's body runs in a page.
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
    /** @type {string[]} */
    const looked = [];
    inPage[slot] = looked;
    const owner = inPage['document'];
    const real = owner.getElementById.bind(owner);
    owner.getElementById = (/** @type {string} */ id) => {
      looked.push(id);
      return real(id);
    };
  }, ROOT_LOOKUPS);

  const response = await page.goto('/index.html');

  expect(response?.status()).toBe(200);
  await expect(page.locator('#viewer-root')).toHaveCount(1);

  // The entry point, named by the page rather than assumed. One module script,
  // and it is the viewer's: a page carrying none, or carrying one that points
  // somewhere else, is a page whose module graph is not this one.
  const entryPoints = await page.locator('script[type="module"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('src')),
  );
  expect(entryPoints, 'the served page does not name exactly one module entry point').toEqual([ENTRY_POINT]);

  // The two link kinds that fetch a module without any module importing one,
  // named because they are the attack this closes: strip the entry point's
  // imports, preload the rest, and the list of requests below is unchanged while
  // nothing imports anything.
  for (const rel of ['modulepreload', 'preload']) {
    const preloaded = await page
      .locator(`link[rel="${rel}"]`)
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
    expect(preloaded, `the served page fetches ${rel} resources, which no module imported`).toEqual([]);
  }

  // And every link and every script the page carries, whole, because the two
  // reads above name two spellings of a thing that has many. `rel` is a list of
  // tokens rather than one word, so an attribute selector for `modulepreload`
  // does not match `rel="preload modulepreload"`; `prefetch` fetches too; and a
  // script that is not a module can fetch whatever it likes without appearing in
  // the entry-point read above. What the page carries is short enough to write
  // down, so it is written down: of the elements that fetch, one stylesheet link
  // and one module script and nothing else — and, in the read after these two,
  // that those are the only elements of either kind the page has at all. Adding
  // either is then an edit here rather than a silent change to what the page
  // loads.
  const links = await page
    .locator('link')
    .evaluateAll((nodes) => nodes.map((node) => ({ rel: node.getAttribute('rel'), href: node.getAttribute('href') })));
  expect(links, 'the served page carries a link element it did not before').toEqual([
    { rel: 'stylesheet', href: STYLESHEET },
  ]);

  const scripts = await page.locator('script').evaluateAll((nodes) =>
    nodes.map((node) => ({
      type: node.getAttribute('type'),
      src: node.getAttribute('src'),
      inline: (node.textContent ?? '').length > 0,
    })),
  );
  expect(scripts, 'the served page carries a script element it did not before').toEqual([
    { type: 'module', src: ENTRY_POINT, inline: false },
  ]);

  // And the page itself, element by element, which is what turns the two reads
  // above into a statement about everything the page can fetch rather than about
  // links and scripts. A link and a script are not the only elements that fetch:
  // an `<img>`, an `<iframe>`, a `<video>` with a `<source>`, an `<object>` and
  // an `<embed>` each fetch whatever their attributes name, and an `<img>`
  // pointing at `js/dispatch.js` puts that module in the request list below
  // while nothing has imported it — which is precisely the substitution the
  // module-graph comparison is there to refuse and could not see.
  //
  // Written as the elements the page has rather than as the element names it may
  // not have, for the reason every other whole-list read here is written that
  // way: a list of what is forbidden is a list somebody has to keep finishing,
  // and the platform keeps adding to it. This page is nine elements long.
  //
  // And every attribute on each of them, which is the half a tag list cannot
  // reach. The elements above are the ones that fetch; the attributes are what
  // they fetch, and an attribute added to an element already on this list leaves
  // the list identical. An inline `style` with a `url()` in it on the `<html>`
  // element loads a module that way, a `formaction` does it from a button that
  // is not here yet, and a `meta` carrying `http-equiv="refresh"` instead of
  // `name="viewport"` navigates the page — none of which changes a tag name.
  // Read straight off each element rather than by asking for the attributes this
  // test expects, so the comparison is what the page has against what is written
  // down, in both directions.
  const elements = await page.locator('*').evaluateAll((nodes) =>
    nodes.map((node) => ({
      tag: node.tagName.toLowerCase(),
      attributes: Object.fromEntries(Array.from(node.attributes, (one) => [one.name, one.value])),
    })),
  );
  expect(elements, 'the served page carries an element or an attribute it did not before').toEqual([...PAGE_ELEMENTS]);

  // And the graph behind it, whole. Sorted on both sides so this is a comparison
  // of which modules the page loaded rather than of the order it happened to
  // fetch them in.
  expect([...modulesFetched.keys()].sort(), 'the modules the page loaded are not the viewer\'s module graph').toEqual(
    [...MODULE_GRAPH].sort(),
  );
  for (const module of MODULE_GRAPH) {
    expect(modulesFetched.get(module), `${module} was not served`).toBe(200);
  }

  // And that the viewer root was resolved, exactly once, by that id — which
  // nothing above asks. Every assertion so far is about bytes arriving; a module
  // whose one top-level call has been replaced by a mention of the function
  // fetches identically, evaluates without error, and does nothing.
  //
  // That is the claim, and it is deliberately not the claim that `boot` ran.
  // Resolving the root is the whole of what `boot` does that anything can see,
  // so any line producing that lookup satisfies this — `void boot;` beside a
  // lookup made from somewhere else reads identically from here. The two are
  // separable only by an observable `boot` does not have yet, and inventing one
  // for this test to read would be instrumenting the test rather than looking at
  // the viewer. So this is a proxy for execution and is written as one. It is
  // also the tightest proxy available: exactly one lookup and exactly that id,
  // so a page that resolved the root twice, or resolved something else, fails.
  //
  // Revisit when `boot` gains work — reading the link, and the call into
  // `dispatchDoc` whose shape this file already describes. That work is what
  // this should be asserting, and this line is the marker saying so.
  const rootLookups = await page.evaluate(
    (slot) => /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis))[slot],
    ROOT_LOOKUPS,
  );
  expect(rootLookups, 'the viewer root was not resolved exactly once by the id the page gives it').toEqual([ROOT_ID]);

  expect(pageErrors).toEqual([]);
  expect(consoleOutput).toEqual([]);
});

/**
 * What the development server will not serve.
 *
 * The server the harness runs is development-only and models nothing about
 * production — but it has one control in it, and a control nothing asks about is
 * a control nobody has seen work. It refuses any path that resolves outside
 * `site/`, and that refusal is a comparison between two paths: the resolved
 * target, and the served root followed by a separator. Written without the
 * separator it becomes a prefix test, and a prefix test admits a sibling
 * directory whose name merely begins with the root's — a different tree, served
 * as though it were this one.
 *
 * Two requests, because the two failures are different. The first leaves the
 * served tree outright and has to be refused. The second resolves to a sibling
 * of it, and has to be refused for being outside rather than answered as
 * something that is simply not there — the status is what tells the containment
 * check from the file read behind it.
 *
 * The separators are percent-encoded so the path arrives with its escape intact.
 * A URL parser resolves `..` segments — including ones spelled `%2e%2e` — before
 * anything downstream sees them, so a path whose dots are separate segments can
 * never reach the comparison. Encoding the slashes keeps the whole thing one
 * segment through the parse, and the server decodes it afterwards, which is
 * exactly the order that makes the comparison the only thing left holding the
 * tree closed.
 */
test('the development server refuses anything outside the tree it serves', async ({ request }) => {
  const outside = await request.get('/here%2f..%2f..%2fpackage.json');
  expect(outside.status(), 'a path resolving above the served root was not refused').toBe(403);

  const sibling = await request.get('/here%2f..%2f..%2fsite-that-is-not-this-one%2findex.html');
  expect(sibling.status(), 'a path resolving to a sibling of the served root was not refused').toBe(403);

  // And the other direction, so this is a containment check rather than a server
  // that refuses everything.
  const inside = await request.get('/index.html');
  expect(inside.status()).toBe(200);
});

/**
 * What the server hands back, against what is on disk.
 *
 * Everything else in this suite reads the page, and the page reads the server —
 * so every claim in it is a claim about whatever the server served, and none of
 * them is a claim that what it served is what this repository ships. Nothing on
 * the browser side reads a file, and until this test there was not one
 * comparison between a response body and a file anywhere in the suite.
 *
 * That gap is the one that separates three things which are supposed to be the
 * same: what the checks scan, what the tests run against, and what a recipient
 * receives. A response canned for one module — a rule in the server, a cache
 * answering, anything at all between the file and the socket — plus a defect in
 * the file on disk behind a condition the tests never take, is a viewer that is
 * correct in this suite, correct under the sink scan, and wrong when it is
 * deployed. The scan reads `site/`, the deploy publishes `site/`, and this is
 * what makes the suite read it too.
 *
 * Every served file rather than one, because "one file arrives intact" says
 * nothing about the next one. The comparison is over bytes: a text comparison
 * would be a comparison of what a decoder made of two byte strings, and two
 * different byte strings can decode alike.
 */
test('the bytes the server hands back are the bytes on disk', async ({ request }) => {
  const root = fileURLToPath(new URL('../site/', import.meta.url));

  /**
   * Every file under `site/`, as a served path, found by walking rather than
   * listed here: a file added to the tree is a file this compares, and a list
   * written here would be a list that can fall behind the tree it is about.
   *
   * @param {string} directory
   * @param {string} prefix
   * @returns {string[]}
   */
  const served = (directory, prefix) =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? served(join(directory, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
    );

  const paths = served(root, '/');
  // A tree this found nothing in would pass every comparison below without
  // making one.
  expect(paths.length, 'the served tree has no files in it').toBeGreaterThanOrEqual(3);

  for (const path of paths) {
    const response = await request.get(path);
    expect(response.status(), `${path} was not served`).toBe(200);
    const body = Buffer.from(await response.body());
    const disk = readFileSync(join(root, path.slice(1)));
    expect(
      body.equals(disk),
      `${path} was served as ${body.length} byte(s) and is ${disk.length} byte(s) on disk`,
    ).toBe(true);
  }
});

/**
 * What the engine names it runs under are worth.
 *
 * "Both engines" is the stated property of this suite, and every check that
 * holds it — the per-engine counts, the named tests in each engine, the list of
 * engines itself — reads the project's name and nothing else. A name is not an
 * engine. Setting the project called `webkit` to `browserName: 'chromium'` is
 * one word in the harness configuration: both projects launch Chromium, WebKit
 * never starts, and every one of those checks passes with the suite having run
 * twice in one engine.
 *
 * WebKit is also the engine that costs the most to lose. A link opened on an
 * iPhone is opened in WebKit whichever browser was chosen, and WebKit is where
 * Web Crypto and back/forward-cache behaviour differ from Chromium — so a suite
 * that quietly stopped running it is a suite that stopped asking about the
 * engine those differences live in.
 *
 * So the page is asked what it is. The two facts read here are what a script in
 * the page can see of the browser running it: Chromium's user agent carries a
 * `Chrome/` version and its vendor is Google's, WebKit's carries neither and its
 * vendor is Apple's. Both carry `AppleWebKit` and both carry `Safari`, which is
 * why neither of those is what is read. The engine is derived from those facts
 * here rather than in the page, and compared against the label the harness ran
 * this project under — so what is compared is an observation against a name,
 * not a name against itself.
 *
 * The raw pair travels in the failure message, because the other way this test
 * can fail is a browser version whose user agent no longer looks like this, and
 * that is a deliberate update rather than a bug in the viewer.
 */
/**
 * Which engine a pair of facts describes, or neither.
 *
 * A function rather than three expressions inside the test, because one of its
 * three answers is the one a healthy run never reaches and so the one nothing
 * was holding. `neither` is what a browser whose user agent no longer looks like
 * either of these produces, and it has to be an answer rather than a fall
 * through to one of the two names — a derivation that guessed would report the
 * suite as having run in an engine it had not identified.
 *
 * Each of the two conditions is a conjunction of both facts, and a run in a real
 * browser satisfies one of them whole. So a conjunction relaxed to either half
 * still names the engine correctly every time this suite runs, while answering
 * an engine's name for a browser it has never seen — which is why the pairs
 * below include the two that differ from a real engine's in one fact each.
 *
 * @param {{ userAgent: string, vendor: string }} observed
 * @returns {'chromium' | 'webkit' | 'neither'}
 */
function engineFrom(observed) {
  const looksChromium = observed.userAgent.includes('Chrome/') && observed.vendor === 'Google Inc.';
  const looksWebkit = !observed.userAgent.includes('Chrome/') && observed.vendor === 'Apple Computer, Inc.';
  return looksChromium ? 'chromium' : looksWebkit ? 'webkit' : 'neither';
}

test('the engine running this project is the engine the project names', async ({ page }, testInfo) => {
  expect(engineFrom({ userAgent: 'Mozilla/5.0 Chrome/1.2.3 Safari/537', vendor: 'Google Inc.' })).toBe('chromium');
  expect(engineFrom({ userAgent: 'Mozilla/5.0 AppleWebKit/605 Safari/605', vendor: 'Apple Computer, Inc.' })).toBe(
    'webkit',
  );
  expect(engineFrom({ userAgent: 'Mozilla/5.0 Chrome/1.2.3 Safari/537', vendor: 'Apple Computer, Inc.' })).toBe(
    'neither',
  );
  expect(engineFrom({ userAgent: 'Mozilla/5.0 AppleWebKit/605 Safari/605', vendor: 'Google Inc.' })).toBe('neither');
  expect(engineFrom({ userAgent: 'Mozilla/5.0 Gecko/20100101 Firefox/141', vendor: '' })).toBe('neither');
  expect(engineFrom({ userAgent: '', vendor: '' })).toBe('neither');

  await page.goto('/index.html');

  const observed = await page.evaluate(() => {
    // `vendor` is a legacy property the type library no longer declares, and it
    // is still the pair's cleanest difference, so it is read as a property
    // rather than through a declaration that does not exist. Anything but a
    // string is an empty string, which matches neither engine.
    const legacy = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (navigator));
    const vendor = legacy['vendor'];
    return {
      userAgent: navigator.userAgent,
      vendor: typeof vendor === 'string' ? vendor : '',
    };
  });

  expect(engineFrom(observed), `vendor ${observed.vendor}; user agent ${observed.userAgent}`).toBe(
    testInfo.project.name,
  );
});
