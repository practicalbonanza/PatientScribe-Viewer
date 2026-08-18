import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The viewer's module graph, as the page loads it.
 *
 * The entry point first, then everything reachable from it: `main.js` imports
 * `flow.js` and `render.js`; `flow.js` imports the origin table, the capability
 * probe, the cryptography, the formatter, the version dispatcher, the parser,
 * the validator and the renderer; `render.js` imports the copy table and the
 * formatter; and the sealed core imports the parser beneath it. Written out here
 * rather than derived from the modules, for the reason every pin in this
 * repository is written that way — a check that takes its expectation from the
 * thing it is checking passes whatever that thing says.
 *
 * A list rather than a count, and the whole list rather than a floor: a module
 * dropping out of the graph and a module joining it are both changes to what the
 * page loads, and both should be an edit here. `crypto.js` is on it now and was
 * deliberately absent before: nothing the page loaded reached the cryptography
 * while there was no flow to reach it from, and the sentence recording that was
 * a fact about what the page fetched rather than a reading of anyone's import
 * statements. It still is, one entry longer.
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
const MODULE_GRAPH = [
  '/js/main.js',
  '/js/flow.js',
  '/js/render.js',
  '/js/config.js',
  '/js/capability.js',
  '/js/crypto.js',
  '/js/format.js',
  '/js/dispatch.js',
  '/js/parse.js',
  '/js/validate.js',
  '/js/copy.js',
];

/** The one module the page itself names, which the rest of the graph hangs off. */
const ENTRY_POINT = 'js/main.js';

/** The one stylesheet the page names. */
const STYLESHEET = 'css/viewer.css';

/** The id of the element the entry point resolves, spelled here as the page spells it. */
const ROOT_ID = 'viewer-root';

/**
 * The content security policy the page carries, transcribed rather than read.
 *
 * Written out here, once, and compared against what the served page hands back —
 * so this is a reading of the policy the page has against the policy that was
 * agreed, in both directions. Taking it out of `index.html` instead would leave a
 * check that passes whatever that file says, which is the shape every pin in this
 * repository is written to avoid.
 *
 * Read as one string rather than as a set of directives on purpose. A policy is
 * enforced as it is spelled: a directive dropped, renamed, reordered or given a
 * source it did not have is a different policy, and the page is meant to carry
 * exactly this one.
 *
 * One directive names an origin outside this page, and it is the only one. A
 * browser handed both this policy and the one the hosting sets in a response
 * header enforces the INTERSECTION of the two — so a `connect-src` here naming
 * `'self'` alone would refuse the request the committed origin table decides on,
 * whatever the header permitted, and the wire half of the release check would
 * never see it because it reads headers and does not parse the document. The
 * source written here is the share API that table sends a page to. Nothing else
 * about the page is loosened by it: every other directive is `'self'` or
 * `'none'`, and the table remains the only thing that decides whether a request
 * is built at all.
 *
 * Written across two lines because the string is long, and joined rather than
 * left as one line so the policy is still one string with one spelling. What is
 * compared is the value, and the value is what the page carries byte for byte.
 */
const POLICY =
  "default-src 'self'; connect-src 'self' https://2kcwhm87v5.execute-api.ap-southeast-2.amazonaws.com; " +
  "style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'";

/**
 * The one source that policy names which is not `'self'`, read back out of it.
 *
 * Read rather than written, and that is the whole point of it. The policy above
 * is this file's single transcription of the page's policy — `SAFE_PREFIX`, the
 * element inventory and the expected violation report are all built from it — so
 * a second spelling of the share API here would be a second thing to keep in
 * step with `site/index.html`, and the first place the two could silently
 * disagree. Taking it out of the string that was already agreed keeps the count
 * at one.
 */
const POLICY_CONNECT_ORIGIN = String(/connect-src 'self' ([^;]+);/.exec(POLICY)?.[1] ?? '');

/**
 * The page from its first byte to the end of the policy, written out.
 *
 * A policy in a `<meta>` element is applied from the point in the byte stream
 * where the parser reads it, not from the top of the document — so this is the
 * one region of the page where a destination can be written and reached for
 * with no policy in force. It is short and it is fixed: the doctype, the opening
 * element, the head, the character set, and the policy itself, each on its own
 * line. Written out here as the lines they are, so that what is being held can
 * be read without running anything.
 *
 * The policy line is built from the constant above rather than transcribed a
 * second time. Two copies of one string are two things to keep in step, and a
 * respelling of the policy is already an edit somebody has to make in one place.
 *
 * The trailing empty entry is the newline that ends the policy line. What comes
 * after it — the viewport meta on the next line — is outside this and is meant
 * to be: everything past the policy is read under the policy.
 */
const SAFE_PREFIX = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <meta charset="utf-8" />',
  `    <meta http-equiv="Content-Security-Policy" content="${POLICY}" />`,
  '',
].join('\n');

/**
 * Every element the served page carries once the flow has run on it, in document
 * order, with every attribute each one has.
 *
 * The page is forty-two elements long, so what it is made of is written down
 * rather than described. That is what makes the assertions about links and
 * scripts below into a statement about the page's whole fetching surface instead
 * of a statement about two element names: an `<img>`, an `<iframe>`, a `<video>`
 * with a `<source>`, an `<object>` or an `<embed>` each fetch whatever their
 * attribute names, none of them is a link or a script, and every one of them
 * would put a file into the request list that no module imported. Rather than
 * enumerate the element names that can fetch — a list nobody finishes, and one
 * that grows with the platform — the page is required to be the elements it is.
 *
 * Attributes as well as names, because a tag list is not the fetching surface
 * either. Which elements the page has says nothing about what they carry, and an
 * attribute on an element that is already here fetches just as well as a new
 * element does: an inline `style` naming a resource on the `<html>` element that
 * has always been here puts a file in the request list with the tag list
 * unchanged, and so does a `background`, a `formaction`, or an `src` moved onto
 * something that did not have one. Two of these elements are `meta` tags
 * carrying nothing but a name, and a name is one word from
 * `http-equiv="refresh"`, which navigates. So each element is required to carry
 * exactly the attributes it carries, by name and by value.
 *
 * The destinations this page names are here as well, all of them: three `href`
 * attributes — the stylesheet and the two links that leave the page — and the
 * one `src`, which is the entry point. They are in the markup rather than in any
 * module, and that is the point of them: a destination written into the page is
 * a destination no code assigns. Reading them here is what makes that checkable
 * from outside the files that would have to be edited to change it.
 *
 * This is the live tree rather than the file on disk, and the difference is the
 * `hidden` attributes. The page is served with every state section hidden; what
 * is read below is the page after the entry point has run on a link that is not
 * one, which is the unavailable surface — so `#unavailable` and `#footer` have
 * lost the attribute, `#report` has gained it, and every other section still
 * carries it. That is the state, written down, and a viewer that showed anything
 * else for a fragment that does not parse is a comparison that fails here.
 *
 * ONE surface, and which claim that supports is worth saying plainly, because a
 * fetching surface read in one state is not obviously a statement about a page
 * that has five.
 *
 * What makes one enough is what the viewer is allowed to do to this tree. Every
 * element below is written in `index.html`; the renderer adds none of them and
 * removes none of them. It writes text into elements that are already here, it
 * moves two attributes on them, and for the body of a note it creates a heading,
 * a list and the list's items and writes text into those. The two attributes are
 * `hidden`, on everything the page shows and hides — the state sections, the
 * advisory, the two chips and the report control — and `disabled`, on the two
 * controls, which is what a request in flight and a link already reported look
 * like. Neither of them carries a destination, and both are moved by the property
 * rather than by a call.
 *
 * What stands behind that is a scan over every served file, and which half of it
 * does what is worth saying plainly. The call that sets an attribute is refused
 * outright, whatever name it would have been handed — that one is a construct, so
 * refusing it refuses every attribute at once. Assignment to a property that
 * carries a destination is refused by an enumeration instead: `href`, `src`,
 * `srcset`, `imageSrcset`, `srcdoc`, `action`, `formAction` and `ping`. An
 * enumeration is a list somebody has to keep up, which is the reason that scan's
 * own comment gives for refusing the attribute call rather than naming the
 * dangerous attributes, and it is as true of this list. So what holds is that no
 * line in this viewer can set an attribute by name and that the
 * destination-carrying properties written down there are refused — not that no
 * property anywhere could carry one.
 *
 * Between any two of this page's surfaces the differences are therefore which
 * elements carry `hidden`, which controls carry `disabled`, what text is inside
 * them, and whether a note's body holds those three tag names.
 *
 * Each of those is read somewhere else. The `hidden` pattern of every surface is
 * in the pinned snapshots in `test/viewer.spec.js`, one per state, and so is the
 * text; a disabled control is in the snapshot of the surface that has one, and in
 * the reading that presses the report control; the notice's own words are read out
 * of the elements they are written into; a note's body is in the snapshot that file
 * builds at run time from the document that was sealed. What this inventory adds is
 * the half none of those can see — the attributes, and so the destinations — and one
 * state is enough for that because every attribute below other than those two is
 * the same in all of them.
 *
 * What it does not cover, said rather than left to be assumed: an attribute on an
 * element the renderer created for a note's body would not appear here, because
 * those elements are not here. What stands behind that is the scan refusing the
 * call that would set one, and review.
 *
 * @type {readonly { tag: string, attributes: Readonly<Record<string, string>> }[]}
 */
const PAGE_ELEMENTS = [
  { tag: 'html', attributes: { lang: 'en' } },
  { tag: 'head', attributes: {} },
  { tag: 'meta', attributes: { charset: 'utf-8' } },
  { tag: 'meta', attributes: { 'http-equiv': 'Content-Security-Policy', content: POLICY } },
  { tag: 'meta', attributes: { name: 'viewport', content: 'width=device-width, initial-scale=1' } },
  { tag: 'title', attributes: {} },
  { tag: 'link', attributes: { rel: 'stylesheet', href: STYLESHEET } },
  { tag: 'script', attributes: { type: 'module', src: ENTRY_POINT } },
  { tag: 'body', attributes: {} },
  { tag: 'main', attributes: { id: ROOT_ID } },
  { tag: 'h1', attributes: { id: 'brand' } },
  { tag: 'p', attributes: { id: 'advisory', hidden: '' } },
  { tag: 'span', attributes: { id: 'advisory-lead' } },
  { tag: 'strong', attributes: { id: 'advisory-emphasis' } },
  { tag: 'span', attributes: { id: 'advisory-tail' } },
  { tag: 'section', attributes: { id: 'shell', hidden: '' } },
  { tag: 'p', attributes: { id: 'shell-intro' } },
  { tag: 'p', attributes: { id: 'code-helper' } },
  { tag: 'p', attributes: { id: 'code-row' } },
  { tag: 'label', attributes: { id: 'code-label', for: 'code-input' } },
  { tag: 'input', attributes: { id: 'code-input', type: 'text' } },
  { tag: 'button', attributes: { id: 'code-submit', type: 'button' } },
  { tag: 'p', attributes: { id: 'wrong-code', hidden: '' } },
  { tag: 'p', attributes: { id: 'unavailable' } },
  { tag: 'section', attributes: { id: 'note', hidden: '' } },
  { tag: 'p', attributes: { id: 'banner' } },
  { tag: 'p', attributes: { id: 'you-chip', hidden: '' } },
  { tag: 'p', attributes: { id: 'edited-chip', hidden: '' } },
  { tag: 'p', attributes: { id: 'visit-date' } },
  { tag: 'p', attributes: { id: 'topic' } },
  { tag: 'div', attributes: { id: 'note-body' } },
  { tag: 'p', attributes: { id: 'expiry' } },
  { tag: 'p', attributes: { id: 'get-app' } },
  { tag: 'a', attributes: { id: 'app-link', href: 'https://apps.apple.com/au/app/id6758035505' } },
  { tag: 'footer', attributes: { id: 'footer' } },
  { tag: 'details', attributes: { id: 'notice' } },
  { tag: 'summary', attributes: { id: 'notice-summary' } },
  { tag: 'p', attributes: { id: 'notice-body' } },
  { tag: 'span', attributes: { id: 'notice-lead' } },
  { tag: 'a', attributes: { id: 'policy-link', href: 'https://patientscribe.com.au/privacy-policy' } },
  { tag: 'span', attributes: { id: 'notice-tail' } },
  { tag: 'button', attributes: { id: 'report', type: 'button', hidden: '' } },
];

/**
 * Where the page records the element lookups made in it.
 *
 * The entry point asks the document for one element by id, and nothing else in
 * the viewer asks the document for an element at all. That is a design decision
 * rather than an accident of how much the viewer does: the renderer finds every
 * region it writes into by looking inside the root it was handed, so the page it
 * drives is the subtree of one element and not whatever happens to carry a
 * matching id somewhere else in the document. A page instrumented to record
 * lookups before any of its own scripts run is where that can be read, and the
 * reading is a whole list rather than a search — one lookup, of that id, and no
 * others.
 *
 * A lookup and not every reach, which is what the instrumentation below can see
 * and so what this claims. The renderer does reach a document: it asks the one
 * that owns the body of a note to create the heading, the list and each line the
 * note is drawn from, as many times as the sender wrote. Creating an element is
 * not finding one, and nothing here records it.
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
 * That is the claim in its name, and it was not always the claim it made.
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
 * page — which the page carries itself, as the policy pinned in the inventory
 * below and read for its effect at the end of this file. One directive in that
 * policy names an origin outside this page and it is the only one: `connect-src`
 * also names the share API the committed origin table sends a page to, because a
 * browser enforces the intersection of this policy and the one the hosting sets,
 * and a request the table decides on has to be permitted by both. The rest name
 * `'self'` or `'none'`. The
 * directives a page cannot carry still arrive with the deploy configuration.
 * What is written here is where these reads stop, not a list anybody should read
 * as finished.
 *
 * Fetched is not evaluated either, and that is the second half. A graph that
 * fetched completely and then failed to evaluate reports an error to the page,
 * and the two assertions at the end are what say none was reported — but an
 * entry point whose top-level call has been reduced to a mention of the function
 * evaluates perfectly and does nothing, which is the whole of what the name of
 * this test claims. What says it ran is the page itself: the element list above
 * is the live tree after the flow has been over it, and a page nothing ran on
 * still carries `hidden` on the section that is now showing. That is a reading
 * of the surface, and it is the assertion this file used to have a proxy for.
 *
 * The lookup is still instrumented and still read, and it holds a different
 * claim now: exactly one element is asked of the document by id, and no other.
 * Every region the renderer writes into, it finds inside the element that lookup
 * returned — so the page the viewer drives is one subtree rather than whatever
 * the document happens to carry, and a module reaching for a region through the
 * document would be a second lookup here. What it does not say is that the
 * renderer never touches a document: it asks the one that owns a note's body for
 * the elements the note is drawn from, and creating an element is not finding
 * one.
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
  // and the platform keeps adding to it. This page is forty-two elements long,
  // which is short enough to write down.
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

  // And that exactly one element was asked of the document by id. The element
  // list above already says the viewer ran; this says how much of the document
  // it went looking through to do it, which nothing else here can.
  //
  // One and not "at least one": every region the renderer writes into is found
  // inside the element this lookup returned, so a module that reached for a
  // region through the document would show up here as a second entry. That is
  // the difference between a viewer that drives one subtree and a viewer that
  // drives whatever in the page happens to answer to a name.
  //
  // Lookups by id, which is the one call the stand-in above wraps. The elements
  // a note is drawn from are created through the document that owns the body
  // they go into; this does not see that and is not about it.
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
 * them is a claim that what it served is what this repository ships. This is the
 * one place a response body and a file are put side by side; the pin below over
 * the bytes before the policy reads a file as well, but against bytes written
 * down rather than against a response.
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
 *
 * Equality and nothing else, which is worth saying because equality is the whole
 * of what a comparison like this can hold. What the bytes say — where the policy
 * sits in them, what is written ahead of it — is read where those bytes are
 * pinned rather than searched, in the test below.
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
 * What is written before the policy takes effect.
 *
 * A policy in a `<meta>` element applies from the point in the byte stream where
 * the parser reads it. Anything the parser met earlier — a stylesheet, a script,
 * an image, a preload — was handed to the network before there was a policy to
 * refuse it, and an element that takes itself out of the page once it has run
 * leaves a tree with nothing in it that was ever wrong. Every reading of the page
 * in this file that is of a tree has no order to be wrong about.
 *
 * So the region where that can happen is pinned rather than searched for, and
 * pinned as the bytes it is. Within the bytes of the document the region is
 * exactly the prefix: from byte zero to the newline that ends the policy
 * element. Before it, nothing may be written at all; after it, whatever is
 * written is read under the policy the parser has just met. That is what this
 * pin holds, and the whole of why a prefix is the shape of this. A pin over
 * those bytes has nothing to recognise — not which spellings a parser closes a
 * comment on, not which malformed tags it accepts as comments, not what a
 * doctype may carry inside itself — because a decoy has to be spelled as
 * something, and this region admits nothing but these bytes. One thing does not
 * reach the navigation reading below, and it is named there rather than left to
 * be found. A reading that instead looks for where the policy sits has to
 * tokenise to be right about it, and a tokeniser written here would be one more
 * thing that has to be as good as a browser's.
 *
 * What that bound leaves out, named rather than left as a category: a request can
 * be started by the response instead of by the document. A destination named in a
 * `Link` response header, or sent ahead of the document as an early hint, is
 * fetched before the parser has read anything, so a policy that applies only from
 * where the parser reads it never reaches it — and it is written in none of these
 * bytes, so it disturbs no byte of this prefix and no reading of these bytes can
 * hold it. What holds it is a policy delivered as a response header, which is
 * deploy-side: checked against the live origin rather than here.
 *
 * A prefix and not a digest of the whole file, deliberately. What the pin gives
 * up is any claim about the rest of the page, and the rest of the page is
 * covered by the controls that are already on it: the element and attribute
 * inventory at the top of this file, the surface snapshots beside it, the scan
 * over every served file, and a diff in a public repository. What it buys is
 * that the rest of the page stays free to move under those controls — including
 * the address the footer's policy link carries, which is not settled yet, and
 * which sits well after the policy element: changing it disturbs no byte of
 * this, so settling it will not mean re-pinning it.
 *
 * The prefix is read in two places, and neither reading subsumes the other, so
 * both are here and which is which is worth writing down.
 *
 * One of them is the response a real navigation was handed, which is the reading
 * nothing else in this suite makes and the one this test was built for. The
 * comparison of served bytes against disk above is made through the harness's
 * own HTTP client; that client is not the stack either engine navigates with, so
 * the bytes it was handed are not, strictly, the bytes the browser was handed.
 * Here the browser is sent to the page and what is read is the response it
 * navigated with — the strongest statement available about what a parser
 * actually met. Both engines, because every file in this suite runs in both, and
 * the two do not have to agree about anything for this to be worth asking of
 * each.
 *
 * What a navigation body is, written from measurement rather than assumed: it is
 * the document the browser decoded and encoded again, not the bytes off the
 * wire. For this page that round-trips exactly — the body read here is the file
 * on disk, byte for byte, in both engines — which is what makes a byte pin over
 * it a pin on the file's own bytes. It is not so in general: the same file given
 * a mark declaring an encoding it is not written in comes back as bodies that
 * differ between the two engines, measured. So the round trip is a fact about
 * this page rather than a property of the reading, and the reading is worth no
 * more than it.
 *
 * The other is the file itself, off disk, which is what this repository ships.
 * It is here for one thing a navigation cannot show, and the thing is named
 * rather than left as a category: a leading byte-order mark — the three bytes
 * `EF BB BF` — is taken out by the parser before there is a navigation body to
 * read, so a page carrying one and nothing else changed hands a browser a body
 * that begins at the doctype and matches the prefix written down at the top of
 * this file exactly, in both engines, measured. Reading the file is what sees
 * it. Nothing else in this repository sees it either: the comparison above holds
 * the served bytes against disk, and a mark in the file is in both sides of that.
 *
 * What that mark is, and what it is not, because the difference is the whole
 * size of this. It is three fixed bytes. It names no destination, so it fetches
 * nothing, and it cannot change the encoding this page is read under — the
 * character set inside the pinned prefix and the content type asserted below fix
 * that between them. What the file read closes is therefore a gap in what this
 * gate reads rather than a way for anything to be fetched: those three bytes
 * were the one thing that could sit ahead of the policy with `npm run check`
 * green. What sits close to them was caught before this and is caught still —
 * two of those marks, a mark declaring an encoding this page is not written in,
 * a single inserted space.
 *
 * What all of this is a claim about, said plainly rather than left to be
 * assumed: the file in this repository, and the bytes the development server
 * hands a browser from it. That server says in its own header that it models
 * nothing about production, and it is right to — it sets no security header, and
 * nothing a deploy would be configured with beyond the content type, which it
 * does set on every response and which is the one read below. It is not a
 * statement about deployed bytes, and nothing in this file is: what a host
 * serves, and what anything in front of it does to these bytes, is checked
 * against the live origin rather than here.
 *
 * The content type is read for the same reason the bytes are. These bytes are a
 * document a policy lives in only if they are served as one; handed back as
 * anything else they are a download or a page of text, and the policy in them is
 * not a policy at all.
 */
test('nothing precedes the policy, in the file or in the bytes a browser is handed', async ({ page }) => {
  const expected = Buffer.from(SAFE_PREFIX, 'utf8');

  const moved =
    ' are not the bytes written down in this file: either something is written ahead of the policy, ' +
    'where a browser meets it under no policy at all, or the policy region itself has moved. If ' +
    'that was deliberate, the new prefix belongs here, spelled out, in the same change that moves it.';
  const wrongInFile = 'the bytes before the policy in site/index.html' + moved;
  const wrongNavigated = 'the bytes before the policy the browser was handed' + moved;

  // The file this repository ships. This is the reading a byte-order mark
  // reaches: those three bytes are gone from a navigation body before there is
  // one to read, and they are on both sides of the served-bytes-against-disk
  // comparison above, so the file is where they are visible at all.
  const file = readFileSync(fileURLToPath(new URL('../site/index.html', import.meta.url)));
  const onDisk = file.subarray(0, expected.length);

  // Compared as text and again as bytes, and the duplicate is deliberate. The
  // text comparison is the one that prints a difference somebody can read; the
  // byte comparison is the claim. The second is not there because a case is
  // known where it bites alone — this expectation is ASCII, and a decoding of
  // some other bytes that matched it would have to be these bytes — but that is
  // a fact about a decoder, and what is being held is a fact about bytes, so it
  // is held over bytes. The navigation reading further down is made the same
  // way, for the same reason.
  expect(onDisk.toString('utf8'), wrongInFile).toBe(SAFE_PREFIX);
  expect(onDisk.equals(expected), wrongInFile).toBe(true);

  // And the bytes a browser was handed, which is the reading the file cannot
  // make: what a parser met is what the browser was given, through the stack it
  // navigates with rather than through the harness's HTTP client.
  const response = await page.goto('/index.html');
  expect(response, 'navigating to the page produced no response to read').not.toBeNull();
  const navigated = /** @type {import('@playwright/test').Response} */ (response);

  expect(
    navigated.headers()['content-type'],
    'the page is served as something other than the kind of document a policy is read out of',
  ).toBe('text/html; charset=utf-8');

  const body = Buffer.from(await navigated.body());
  const prefix = body.subarray(0, expected.length);

  expect(prefix.toString('utf8'), wrongNavigated).toBe(SAFE_PREFIX);
  expect(prefix.equals(expected), wrongNavigated).toBe(true);
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

/**
 * What the policy in the page is worth once a browser has read it.
 *
 * The page inventory above says the policy is written in the page, spelled the
 * way it was agreed. That is a reading of an attribute, and an attribute is a
 * string: a policy misspelled in a way a parser rejects, a policy a browser of
 * this vintage does not implement, and a policy delivered in a form that only
 * reports are all pages carrying that same attribute. So this asks the browser
 * instead, and asks it by making it refuse something.
 *
 * The refusal has to be one that cannot be confused with a request that failed
 * for some other reason, and that is the whole difficulty. There are two other
 * reasons, and each one would keep this test green with no policy in the page at
 * all.
 *
 * The first is a socket nothing is listening on, which is refused by the network
 * and reaches the page as the same rejected promise. So the origin used here is
 * the harness's own server under its other spelling — `localhost` where the page
 * was served from `127.0.0.1`. Those are two origins to a browser, which
 * compares them as written and never resolves either; they are one listener to
 * everything else. There is something there, and it answers.
 *
 * The second is the sharing rule, which refuses a cross-origin response the
 * server did not offer to share and is nothing to do with any policy. It is the
 * quieter of the two, because it produces the same rejected promise from the same
 * URL and would still be there if this page carried nothing. So the request is
 * made in the one mode that rule does not refuse: `no-cors`, which is how a page
 * fetches something it will not read, and which a server that says nothing about
 * sharing answers with a response the page cannot look inside. Measured in both
 * engines, that request resolves with no policy in the page and rejects with it.
 * What is left to refuse it is the policy.
 *
 * Three readings then say the refusal was the policy, and each one is enough on
 * its own:
 *
 *   - The browser reports the violation itself, on the document, and names what
 *     it refused and which directive refused it. Neither a dead socket nor a
 *     sharing rule reports anything of the kind. The report also carries the
 *     policy the browser is enforcing, which is read here against the same
 *     string the page inventory pins — the browser's own account of what it
 *     parsed, rather than the text it was handed — and the disposition, which is
 *     what tells a policy that blocks from one that only reports.
 *   - The same URL is fetched from outside the page, where no policy applies,
 *     and answers with the page's own bytes. The listener is live, it is
 *     reachable under that spelling, and it is this server.
 *   - The page fetches its own origin in the same run and is answered, so the
 *     rejection above is not a page that cannot fetch at all.
 *
 * The console is read rather than muted, and read for what it should carry. A
 * violation is reported to the console by both engines, in wording and in counts
 * that are each engine's own, so what is asserted is the property they share:
 * every message is an error, about this URL, about the policy — and so nothing
 * else has been said. Muting the channel for this test would leave the one test
 * in this file that provokes the browser unable to notice anything else the page
 * said while it did.
 *
 * What this does not reach is the rest of the policy. `connect-src` is the
 * directive a viewer that must not send anywhere is written for, and it is also
 * the only one a page can be made to violate without adding an element to the
 * page or a stylesheet to the tree. The others are held by the page inventory
 * being what it is: there is no element that fetches, and no request but the two.
 */
test('the policy the page carries is enforced against an origin that answers', async ({ page, baseURL, request }) => {
  const base = new URL(String(baseURL));
  // The other spelling is derived from the harness's own base URL rather than
  // written down, so a harness moved to another port keeps testing the same
  // thing. The hostname it is derived from is asserted, because the derivation
  // is only a different origin while the base URL is the one this repository
  // serves from — pointed at `localhost` already, the two spellings would be one
  // origin and the fetch below would be allowed.
  expect(base.hostname, 'the harness is not served from the spelling this test derives its other from').toBe(
    '127.0.0.1',
  );
  const other = new URL(base.href);
  // The harness binds IPv4 only: where `localhost` resolves to `::1` alone this fails loudly, never falsely green.
  other.hostname = 'localhost';
  expect(other.origin, 'the two spellings are one origin, so there is nothing here to refuse').not.toBe(base.origin);
  const elsewhere = `${other.origin}/index.html`;

  // Outside the page first, so what follows is known to be a live listener
  // before the page is asked to reach it.
  const outside = await request.get(elsewhere);
  expect(outside.status(), `nothing answered at ${elsewhere}, so a refusal there would say nothing`).toBe(200);
  const servedElsewhere = Buffer.from(await outside.body());
  const servedHere = Buffer.from(await (await request.get(`${base.origin}/index.html`)).body());
  expect(
    servedElsewhere.equals(servedHere),
    'the two spellings are answered by different servers, so one of them is not this one',
  ).toBe(true);

  /** @type {{ type: string, text: string }[]} */
  const consoleOutput = [];
  /** @type {string[]} */
  const pageErrors = [];
  page.on('console', (message) => consoleOutput.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/index.html');

  const observed = await page.evaluate(async (url) => {
    // The page's own globals, reached the way every other reading in this suite
    // reaches them: this file is checked in a world that has no browser in it,
    // so what runs in the page is written against names rather than against
    // declarations that are not there.
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));

    /** @type {{ blockedURI: string, effectiveDirective: string, disposition: string, policy: string }[]} */
    const violations = [];
    inPage['document'].addEventListener(
      'securitypolicyviolation',
      (/** @type {Record<string, any>} */ violation) => {
        violations.push({
          blockedURI: violation['blockedURI'],
          effectiveDirective: violation['effectiveDirective'],
          disposition: violation['disposition'],
          policy: violation['originalPolicy'],
        });
      },
    );

    /**
     * What a fetch did, as data rather than as an exception.
     *
     * The two engines word a refused fetch differently — one of them says the
     * fetch failed and the other says the load did — so what travels back is
     * that it rejected and what kind of error it was, never the wording.
     *
     * `no-cors` on both, so that the sharing rule is not what refuses the
     * off-origin one, and so that the pair is a comparison of destinations
     * rather than of modes.
     *
     * @param {string} target
     */
    const asked = async (target) => {
      try {
        const response = await fetch(target, { mode: 'no-cors' });
        return { rejected: false, type: response.type, kind: '' };
      } catch (error) {
        return { rejected: true, type: '', kind: error instanceof Error ? error.name : typeof error };
      }
    };

    const refused = await asked(url);
    const own = await asked('/index.html');
    // The violation is reported on a task of its own, so the report can be
    // behind the rejected promise that caused it.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    return { refused, own, violations };
  }, elsewhere);

  expect(observed.refused, `the page reached ${elsewhere}, which the policy does not name`).toEqual({
    rejected: true,
    type: '',
    kind: 'TypeError',
  });
  // Answered, and answered as a response the page may read: a request in this
  // mode is only made opaque by being off-origin, and this one is not. Read as
  // well as the rejection above, because a page that could not fetch at all
  // would produce that rejection too.
  expect(observed.own, 'the page cannot fetch its own origin, so the refusal above says nothing').toEqual({
    rejected: false,
    type: 'basic',
    kind: '',
  });
  expect(observed.violations, 'the browser did not report refusing the request under the policy').toEqual([
    {
      blockedURI: elsewhere,
      effectiveDirective: 'connect-src',
      disposition: 'enforce',
      policy: POLICY,
    },
  ]);

  expect(pageErrors, 'the page reported an error while the policy was refusing a request').toEqual([]);

  // Something was said. The readings below are each written as a property every
  // message must have, which is a shape that holds vacuously over no messages at
  // all — and an engine that stopped reporting refusals to the console would
  // leave them holding exactly that way. Both engines report one today. No
  // mutation of this repository can make this assertion bite, because what it is
  // watching for is a change in an engine rather than a change here; it is here
  // to fail loudly on the day one goes quiet rather than to let the loop below
  // pass over nothing.
  expect(
    consoleOutput.length,
    'the browser refused the request without saying so, so the readings below are over nothing',
  ).toBeGreaterThanOrEqual(1);

  for (const message of consoleOutput) {
    expect(message.type, `the page said something that was not the refusal: ${message.text}`).toBe('error');
    expect(message.text, `the page said something that was not about ${elsewhere}`).toContain(elsewhere);
    expect(message.text, `the page said something that was not about the policy: ${message.text}`).toContain(
      'Content Security Policy',
    );
  }
});

/**
 * The other half of that reading, and the one the fold this file's policy just
 * had was made for.
 *
 * The test above asks whether the policy refuses an origin it does not name.
 * This one asks whether it PERMITS the one origin it does — which is not the
 * same question, and until the policy named something it could not be asked at
 * all. It matters because of how the two policies this page ends up under
 * combine: the hosting sets `connect-src` in a response header, the document
 * carries its own in a meta element, and a browser enforces the INTERSECTION of
 * every policy it is handed. A meta naming `'self'` alone would therefore refuse
 * the request the committed origin table decides on however the header was
 * written, and nothing on the wire side of the release check could see it —
 * that check reads response headers and never parses the document. A browser
 * is the only thing that can, and this is it.
 *
 * No byte leaves the machine, and that is a property of how this is measured
 * rather than a hope. The harness routes every request the page makes before the
 * network is reached, so any of the two destinations below that BECOMES a
 * request is answered by the harness and never resolved, connected to or sent
 * anything — and the one the policy refuses never becomes a request at all,
 * which is the asymmetry the paragraph below reads. Either way nothing goes out:
 * the share API is not contacted by this suite at any point.
 *
 * What is read is the interception itself, because the asymmetry IS the
 * measurement: a fetch the policy permits becomes a request, and a request is
 * something the route handler sees; a fetch the policy refuses never becomes a
 * request at all, so the handler is never reached and there is nothing to
 * intercept. Asking only whether the fetch rejected would confuse "the policy
 * allowed it" with "something answered", and asking only what was intercepted
 * would confuse "the policy refused it" with "the handler declined". Both are
 * read, on both destinations, in the one run.
 *
 * The second destination is the honesty of it. A permitted fetch that is
 * intercepted proves the policy admits something; it does not prove the policy
 * is still refusing anything. So an origin the policy does not name is asked for
 * in the same breath, under the same interception, and has to reach neither the
 * handler nor a resolved promise — and the browser's own violation report says
 * which directive refused it.
 */
test('the policy permits the one origin it names, and still refuses one it does not', async ({ page, baseURL }) => {
  expect(POLICY_CONNECT_ORIGIN, 'the policy names no source but `self`, so there is nothing here to permit').toMatch(
    /^https:\/\/[^\s'"]+$/,
  );
  const base = new URL(String(baseURL));
  expect(
    new URL(POLICY_CONNECT_ORIGIN).origin,
    'the origin the policy names is the origin the page is served from, so permitting it says nothing',
  ).not.toBe(base.origin);

  // An origin the policy does not name, spelled in a reserved namespace that
  // cannot be registered and so cannot be reached by accident. It never leaves
  // the page in any case — the policy refuses it, and the route below would have
  // answered it if it had not.
  const unnamed = 'https://named-by-no-directive.invalid';

  /** Every request the page actually made to either destination. @type {string[]} */
  const intercepted = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(POLICY_CONNECT_ORIGIN) || url.startsWith(unnamed)) {
      intercepted.push(url);
      // Answered here, so nothing is resolved and nothing is connected to. The
      // body is empty and the status is the one that carries none: what is being
      // read is that the request existed, not what came back.
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.continue();
  });

  /** @type {string[]} */
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/index.html');

  const observed = await page.evaluate(async ([permitted, refused]) => {
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));

    /** @type {{ blockedURI: string, effectiveDirective: string, disposition: string }[]} */
    const violations = [];
    inPage['document'].addEventListener(
      'securitypolicyviolation',
      (/** @type {Record<string, any>} */ violation) => {
        violations.push({
          blockedURI: violation['blockedURI'],
          effectiveDirective: violation['effectiveDirective'],
          disposition: violation['disposition'],
        });
      },
    );

    /**
     * What a fetch did, as data rather than as an exception.
     *
     * `no-cors` on both, so that the sharing rule is not what decides either
     * answer and the pair is a comparison of destinations. Both are off-origin,
     * so a permitted one comes back opaque; that it came back at all is the
     * half of the reading this side carries.
     *
     * @param {string} target
     */
    const asked = async (target) => {
      try {
        const response = await fetch(target, { mode: 'no-cors' });
        return { rejected: false, kind: '', type: response.type };
      } catch (error) {
        return { rejected: true, kind: error instanceof Error ? error.name : typeof error, type: '' };
      }
    };

    const allowed = await asked(`${permitted}/`);
    const blocked = await asked(`${refused}/`);
    // The violation is reported on a task of its own, so the report can be
    // behind the rejected promise that caused it.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    return { allowed, blocked, violations };
  }, [POLICY_CONNECT_ORIGIN, unnamed]);

  // The direction this test exists for: the policy did not stop it, so it became
  // a request.
  expect(
    observed.allowed,
    `the page could not reach ${POLICY_CONNECT_ORIGIN}, which its own policy names`,
  ).toEqual({ rejected: false, kind: '', type: 'opaque' });
  expect(
    intercepted.filter((url) => url.startsWith(POLICY_CONNECT_ORIGIN)),
    'the fetch resolved without the harness ever seeing a request, so the policy was not what let it through',
  ).toEqual([`${POLICY_CONNECT_ORIGIN}/`]);

  // And the same policy, still refusing. Rejected, never intercepted, and
  // reported by the browser as this directive's doing.
  expect(observed.blocked, `the page reached ${unnamed}, which the policy does not name`).toEqual({
    rejected: true,
    kind: 'TypeError',
    type: '',
  });
  expect(
    intercepted.filter((url) => url.startsWith(unnamed)),
    'a destination the policy does not name became a request, so the policy refused nothing',
  ).toEqual([]);
  // The blocked address as the browser spells it back, which is the address that
  // was asked for and not the origin it is on: a fetch of an origin asks for the
  // path at its root, and the report names what was refused.
  expect(observed.violations, 'the browser did not report refusing the request under the policy').toEqual([
    { blockedURI: `${unnamed}/`, effectiveDirective: 'connect-src', disposition: 'enforce' },
  ]);

  expect(pageErrors, 'the page reported an error while the policy was being read').toEqual([]);
});
