import { expect, test } from '@playwright/test';

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
 * deliberately not in it — nothing in the graph imports it yet — so this list is
 * also the record of how far the boot seam currently reaches.
 *
 * @type {readonly string[]}
 */
const MODULE_GRAPH = ['/js/main.js', '/js/dispatch.js', '/js/validate.js', '/js/render.js', '/js/parse.js'];

/** The one module the page itself names, which the rest of the graph hangs off. */
const ENTRY_POINT = 'js/main.js';

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
 * module graph is fetched whole before it is evaluated. Fetched-and-answered is
 * not by itself evaluated — but a graph that fetched completely and then failed
 * to evaluate reports an error to the page, and the two assertions at the end
 * are what say none was reported. Together they are the claim in the name.
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

  // And the graph behind it, whole. Sorted on both sides so this is a comparison
  // of which modules the page loaded rather than of the order it happened to
  // fetch them in.
  expect([...modulesFetched.keys()].sort(), 'the modules the page loaded are not the viewer\'s module graph').toEqual(
    [...MODULE_GRAPH].sort(),
  );
  for (const module of MODULE_GRAPH) {
    expect(modulesFetched.get(module), `${module} was not served`).toBe(200);
  }

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
