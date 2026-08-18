import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

/**
 * The viewer, driven.
 *
 * `core.spec.js` beside this file runs the corpus against the served modules and
 * asks what each of them returns. This file asks what a recipient sees. The two
 * are different questions and the second one cannot be asked from the first:
 * every claim about the surface — that the failures collapse, that the copy on
 * screen is the copy that was agreed, that nothing of the link is on the page —
 * is a claim about a rendered page rather than about a returned value.
 *
 * Every state is pinned as an accessibility snapshot, which is the closest thing
 * to "what is on the screen" that can be compared as bytes. A snapshot carries
 * the roles, the names and the text in document order, and it carries nothing
 * about colour, spacing or the order attributes happen to be written in — so it
 * is a comparison of the surface rather than of the markup that produced it.
 *
 * One of the snapshots is built rather than written, and deliberately: the
 * decrypted note's wording comes from inside the encrypted document, so a
 * literal copy of it in this file would be a second spelling of something the
 * viewer is not allowed to have a spelling of. The shape below is pinned; the
 * words in it are read at run time out of the document the share carried.
 *
 * The timezone is pinned for the whole file, because one of the things on that
 * surface is a formatted expiry and a formatted expiry without a timezone is a
 * claim about the machine the test ran on.
 */
test.use({ timezoneId: 'Australia/Sydney' });

/** The interop vectors, as everything else in this suite reads them. */
const vectors = JSON.parse(readFileSync(fileURLToPath(new URL('./vectors/vectors.json', import.meta.url)), 'utf8'));

/** The fixture every state below is driven from. */
const named = vectors.fixtures[0];

/** A share whose key is derived under one identifier and sealed against another. */
const mismatched = vectors.mismatches[0];

/** The code a recipient types in these tests, spelled so that finding it means something. */
const TYPED_CODE = 'probe-code-4821';

/** Abbreviated English names, written here rather than taken from the viewer. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The expiry a moment reads as, derived independently of the viewer.
 *
 * The viewer writes its own names out of tables because a platform formatter's
 * output depends on the data the engine was built with. This does the opposite
 * on purpose: it asks the platform for the numbers in the pinned timezone and
 * then spells them with tables of its own. So the two agree on the moment
 * through different machinery, and neither is reading the other's answer.
 *
 * @param {number} epochSeconds
 * @returns {string}
 */
function expiryText(epochSeconds) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Australia/Sydney',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(epochSeconds * 1000))
      .map((part) => [part.type, part.value]),
  );
  const year = Number(parts['year']);
  const month = Number(parts['month']);
  const day = Number(parts['day']);
  const hours = Number(parts['hour']);
  const minutes = Number(parts['minute']);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  const padded = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${weekday} ${day} ${MONTHS[month - 1]}, ${twelve}:${padded} ${hours < 12 ? 'am' : 'pm'}`;
}

/**
 * The link a share arrives in.
 *
 * @param {any} fixture
 * @returns {string}
 */
function fragmentFor(fixture) {
  return `#v=link_split_v1&id=${fixture.inputs.id}&a=${fixture.inputs.a}`;
}

/**
 * The stored response for a fixture, as the server would answer it.
 *
 * @param {any} fixture
 * @returns {string}
 */
function shareBody(fixture) {
  const outputs = fixture.outputs;
  return JSON.stringify({
    b: fixture.inputs.b,
    wrapped_k: outputs.wrapped_k,
    ciphertext: outputs.ciphertext,
    aad: fixture.inputs.aad,
  });
}

/** The shell: a code to type, and where the code comes from. */
const SHELL = `- main:
  - heading "PatientScribe" [level=1]
  - paragraph: Someone has shared a PatientScribe note with you.
  - paragraph: They'll have given you a code \u2014 usually over the phone.
  - paragraph:
    - text: Code
    - textbox "Code"
    - button "Open the note"
  - group: For people viewing a shared note.
  - button "Report a problem with this link"`;

/** The shell, with the advice a browser that failed the probe earns. */
const SHELL_WITH_ADVISORY = `- main:
  - heading "PatientScribe" [level=1]
  - paragraph:
    - text: This app's built-in browser can't open shared notes safely. Tap \u22ef and choose
    - strong: Open in Safari
    - text: (or Chrome).
  - paragraph: Someone has shared a PatientScribe note with you.
  - paragraph: They'll have given you a code \u2014 usually over the phone.
  - paragraph:
    - text: Code
    - textbox "Code"
    - button "Open the note"
  - group: For people viewing a shared note.
  - button "Report a problem with this link"`;

/** The shell, plus the one line a code that did not match earns. */
const WRONG_CODE = `- main:
  - heading "PatientScribe" [level=1]
  - paragraph: Someone has shared a PatientScribe note with you.
  - paragraph: They'll have given you a code \u2014 usually over the phone.
  - paragraph:
    - text: Code
    - textbox "Code": ${TYPED_CODE}
    - button "Open the note"
  - paragraph: That code didn't match. Check it with the person who shared this.
  - group: For people viewing a shared note.
  - button "Report a problem with this link"`;

/**
 * The shell with a request in flight.
 *
 * The same surface, with one difference and no new words. A control that cannot
 * be pressed says what there is to say by not being pressable; a line of status
 * text beside it would be a second spelling of the same thing, and one more
 * string on a surface whose whole design is that it says as little as possible.
 */
const SHELL_SENDING = `- main:
  - heading "PatientScribe" [level=1]
  - paragraph: Someone has shared a PatientScribe note with you.
  - paragraph: They'll have given you a code \u2014 usually over the phone.
  - paragraph:
    - text: Code
    - textbox "Code": ${TYPED_CODE}
    - button "Open the note" [disabled]
  - group: For people viewing a shared note.
  - button "Report a problem with this link"`;

/** The one surface every failure ends on, where there is a link to report. */
const UNAVAILABLE = `- main:
  - heading "PatientScribe" [level=1]
  - paragraph: This shared note is no longer available. If you were expecting it, ask the person who shared it.
  - group: For people viewing a shared note.
  - button "Report a problem with this link"`;

/**
 * The same surface, without the control that reports a link.
 *
 * Two ways to reach it, and neither of them is about the failure. A fragment
 * that never parsed carries no identifier, so there is nothing to name in a
 * report. And a page restored out of the back/forward cache has dropped the
 * identifier it did parse, which comes to the same thing.
 */
const UNAVAILABLE_UNNAMED = `- main:
  - heading "PatientScribe" [level=1]
  - paragraph: This shared note is no longer available. If you were expecting it, ask the person who shared it.
  - group: For people viewing a shared note.`;

/**
 * The collection notice, transcribed from the agreed text rather than read from
 * the viewer.
 *
 * Every character outside ASCII is written as an escape, and what that buys is
 * worth being exact about. A lookalike character — a dash that is the wrong
 * dash, an apostrophe that is the wrong apostrophe — is a character this
 * comparison can see, rather than two identical-looking strings agreeing with
 * each other, and a slip on either side of the comparison fails here.
 *
 * What it does not buy is agreement with the wording itself. This transcription
 * is compared against what the page renders, and the transcription in the node
 * suite is compared against the file the page renders from; nothing in this
 * repository compares that file against the text it was transcribed from. So a
 * wording that is wrong in the viewer and wrong the same way in both
 * transcriptions is a wording every check here agrees with, and the escapes do
 * not change that.
 *
 * The trailing space after the last colon is part of the string: the sentence
 * carries on into the link that follows it, and a transcription that tidied the
 * space away would be a different sentence.
 */
const NOTICE_BODY =
  'This page shows you an encrypted note shared with you through PatientScribe. ' +
  'PatientScribe (DigiFrontiers) cannot decrypt stored share content under our normal, ' +
  'published viewer protocol \u2014 and we cannot verify who opens a share: anyone with ' +
  'both the link and the code can open it. When you open this page we handle your IP ' +
  'address and basic request data, kept briefly (up to 30 days) only to limit abuse and ' +
  'keep the service working; the access code you type is sent to us only to check it and is ' +
  "not kept (without it we can't show you the note); and each share link keeps a simple " +
  'code-entry attempt counter while it exists \u2014 we use none of this for analytics, ' +
  "advertising, or profiling, we don't set cookies, and nothing here is used to track you " +
  'across other sites or pages. Questions: support@patientscribe.com.au. Full policy: ';

/** The text of the link the notice ends on, transcribed the same way. */
const POLICY_LINK_TEXT = 'patientscribe.com.au/privacy-policy';

/**
 * And what the notice ends with, after the link: the sentence's full stop.
 *
 * One character, and it is here for the same reason the other two are. The
 * notice is one sentence assembled out of three spans, and a span nothing reads
 * is a span anything can be written into — this one was the span nothing read.
 */
const NOTICE_TAIL = '.';

/** The whole notice, as a recipient reads it: the lead, the link, and the stop. */
const NOTICE = `${NOTICE_BODY}${POLICY_LINK_TEXT}${NOTICE_TAIL}`;

/**
 * A decrypted note's surface: the shape pinned, the words interpolated.
 *
 * Every string that came out of the encrypted document is read from the document
 * rather than written here — the banner above all, which the viewer renders as
 * the sender wrote it and has no copy of. What is pinned is the order things
 * appear in, the roles they appear as, and the wording around them that belongs
 * to this viewer.
 *
 * The two chips are the part of the shape that is not always there, and they are
 * built from the same two values the viewer builds them from: the name inside
 * the document, and whether the authenticated data says the share was edited.
 * The name being absent takes one line away and changes the wording of the
 * other, which is three lines of agreed copy between them — so this takes the
 * document and the authenticated data rather than a fixture, and a share that
 * pairs the two values differently is a call with different arguments rather
 * than a second copy of this function.
 *
 * @param {string} plaintext The document, as it came out of the share.
 * @param {string} aadText The authenticated data, as the share carried it.
 * @returns {string}
 */
function decryptedSurface(plaintext, aadText) {
  const doc = JSON.parse(plaintext);
  const aad = JSON.parse(aadText);
  const hasName = doc.you_means.length > 0;

  /** @type {string[]} */
  const chips = [];
  if (hasName) {
    chips.push(`  - paragraph: "'You' means ${doc.you_means}"`);
  }
  if (aad.edited === true) {
    chips.push(hasName ? `  - paragraph: Edited by ${doc.you_means}` : '  - paragraph: Edited by the sharer');
  }

  /** @type {string[]} */
  const body = [];
  for (const section of doc.sections) {
    body.push(`  - heading "${section.heading}" [level=2]`);
    if (section.lines.length === 0) {
      continue;
    }
    body.push('  - list:');
    for (const line of section.lines) {
      body.push(`    - listitem: ${line}`);
    }
  }
  return [
    '- main:',
    '  - heading "PatientScribe" [level=1]',
    `  - paragraph: ${doc.banner_text}`,
    ...chips,
    `  - paragraph: ${doc.visit_date}`,
    `  - paragraph: ${doc.topic}`,
    ...body,
    `  - paragraph: This link works until ${expiryText(aad.exp)}`,
    '  - paragraph:',
    '    - link "PatientScribe is free on the App Store":',
    '      - /url: https://apps.apple.com/au/app/id6758035505',
    '  - group: For people viewing a shared note.',
    '  - button "Report a problem with this link"',
  ].join('\n');
}

/**
 * The published share whose document carries a given name, by the name the
 * generator gave the fixture.
 *
 * @param {string} name
 * @returns {any}
 */
function fixtureNamed(name) {
  const found = vectors.fixtures.find((/** @type {any} */ one) => one.name === name);
  expect(found, `the vectors no longer carry a fixture called ${name}`).toBeTruthy();
  return found;
}

/**
 * The one chip configuration the published fixtures do not pair, sealed here.
 *
 * The agreed copy has four states between them: a document that names who "you"
 * is, or does not, crossed with a share that was edited, or was not. Three are
 * published. The fourth — edited, with no name — has a line of its own, and no
 * published share puts those two values together, so nothing was rendering that
 * line and nothing was reading it.
 *
 * So this takes the edited fixture's own document, flips the one field this case
 * is about, and seals it again under that fixture's own content key, over that
 * fixture's own authenticated data. Everything else is the producer's untouched
 * bytes: the salt and the wrapped key in the answer, and the identifier and the
 * capability in the link.
 *
 * The nonce is the one thing it does not reuse. The fixture's own nonce is
 * already spent: it seals the fixture's own document under that same key, and a
 * second sealing of a different document under the same key and the same nonce
 * is the one thing this cipher must never be asked to do — the two ciphertexts
 * would differ by exactly the difference between the two documents, and the
 * authentication would stop being worth anything for either. That would be
 * contained here, because the key never leaves this process, but this file is
 * read by people deciding whether to trust the rest of it. So a nonce of its own
 * is derived from the fixture's.
 *
 * And the two are read back apart from the answer this hands the page rather than
 * compared where they are made. Comparing them where they are made is what this
 * did, and it was an assertion that could not fail: one byte of a copy is flipped
 * and the copy is then required to differ from the original, which it does for any
 * nonce with a byte in it, whatever the sealing below goes on to use. What is
 * asked now is the nonce the answer actually carries, which is the value a change
 * to the sealing would move.
 *
 * What that proves is the surface for this state, and not interop. The claim
 * that this viewer reads what an independent producer sealed rests on the
 * published shares, and this case does not replace any of them — it replaces one
 * document's seal, in a state the producer never emitted.
 *
 * @param {any} fixture The published share this is built out of.
 * @returns {Promise<{ docText: string, body: string }>}
 */
async function sealedWithoutAName(fixture) {
  const doc = JSON.parse(fixture.inputs.plaintext);
  const written = `"you_means":${JSON.stringify(doc.you_means)}`;
  expect(
    fixture.inputs.plaintext.split(written).length - 1,
    'the fixture no longer writes its name exactly once, so this is not flipping one field',
  ).toBe(1);
  const docText = fixture.inputs.plaintext.replace(written, '"you_means":""');
  expect(docText, 'the re-seal is of the document it was handed, so it is asking nothing').not.toBe(
    fixture.inputs.plaintext,
  );

  const published = Buffer.from(fixture.inputs.content_nonce, 'base64url');
  expect(published.length, 'the fixture no longer publishes a nonce to derive one from').toBeGreaterThan(0);
  const nonce = Buffer.from(published);
  const last = nonce.length - 1;
  nonce[last] = (published[last] ?? 0) ^ 0xff;

  const key = await crypto.subtle.importKey(
    'raw',
    Buffer.from(fixture.inputs.k, 'base64url'),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const sealed = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      tagLength: 128,
      additionalData: new TextEncoder().encode(fixture.inputs.aad),
    },
    key,
    new TextEncoder().encode(docText),
  );

  const body = JSON.stringify({
    b: fixture.inputs.b,
    wrapped_k: fixture.outputs.wrapped_k,
    ciphertext: Buffer.concat([nonce, Buffer.from(sealed)]).toString('base64url'),
    aad: fixture.inputs.aad,
  });
  expect(body, 'the re-sealed answer is the published one, so this configuration is the one above it').not.toBe(
    shareBody(fixture),
  );

  // The nonce this answer is actually sealed under, read back out of the answer
  // and compared with the one the published share is sealed under. A sealed
  // message carries its nonce in front of the ciphertext, so this is a read of the
  // value the page will be handed rather than of an intermediate — which is what
  // makes it an assertion that can fail: sealing under the fixture's own nonce, by
  // edit or by accident, is one run handing the page two messages under the same
  // key and nonce with different contents inside them, and it fails here.
  const carried = Buffer.from(JSON.parse(body).ciphertext, 'base64url').subarray(0, published.length);
  expect(
    carried.equals(published),
    'the re-seal went out under the nonce the published share is already sealed under, which is the one pair ' +
      'this cipher must never be used with twice',
  ).toBe(false);

  return { docText, body };
}

/**
 * The lines a browser writes about the one request these tests make fail, and
 * where each of them has to have come from.
 *
 * Measured in both engines, at the versions this repository pins. For a status
 * that is not a success the two are identical — the same type, the same text,
 * the same location, on 400, 410 and 500 alike. They part company for one case:
 * a request that never arrived at all, where one engine speaks from its own
 * network stack and the other's line comes from the automation layer announcing
 * that it blocked the load.
 *
 * Written out as whole lines rather than as a shape to match, because what is
 * wanted here is a subtraction of things already seen and not a filter that
 * decides what a browser might say. A line that is not one of these is a line
 * nobody has looked at.
 *
 * And each carries where it must have come from, which the text alone does not
 * say. Four of these five name no resource — "failed to load resource" is the
 * whole of what they report — so subtracting them by text subtracts them for any
 * resource on the page, and a stylesheet or a module that failed to load would
 * come out of the reading on exactly the tests that exist to watch the failure
 * paths. Measured, all four are reported against the request that failed, so
 * that is what they are required to be reported against.
 *
 * The fifth is reported with no location at all, in the engine that writes it,
 * and it is scoped by naming the destination inside its own text instead. That
 * is the reason this needs to be told where the harness serves from.
 *
 * @param {string} origin Where the harness serves the page from.
 * @returns {readonly { text: string, from: string }[]}
 */
function browserNetworkLines(origin) {
  const request = `${origin}/share/open`;
  return [
    { text: 'error: Failed to load resource: net::ERR_FAILED', from: request },
    { text: 'error: Failed to load resource: the server responded with a status of 400 (Bad Request)', from: request },
    { text: 'error: Failed to load resource: the server responded with a status of 410 (Gone)', from: request },
    {
      text: 'error: Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
      from: request,
    },
    { text: `info: Web Inspector blocked ${request} from loading`, from: '' },
  ];
}

/**
 * Watch every channel a page can speak on.
 *
 * The viewer says nothing at any level, and `all` is the reading that says so:
 * every console message, of every type, whoever produced it. Every test below
 * that drives nothing but successful requests reads it whole and requires it to
 * be empty.
 *
 * A browser is not so quiet, so the tests that drive a request to a failure
 * cannot read `all`. What those runs collect is the browser reporting on the
 * request those tests made fail, which is not the page saying anything.
 * `unaccounted` is the same channel with exactly those lines taken out of it, by
 * whole text and by what the browser attributed them to. Everything else stays
 * in, whoever wrote it — a line this has not seen before, and a line the browser
 * wrote about some other resource, are both still there and both fail.
 *
 * Not by where a message came from alone, which is what this replaced. A console
 * method handed somewhere as a callback reference is reported by both engines
 * with no source location at all — so a reading that admitted messages by the
 * file behind them dropped every message of that shape, silently, on the two
 * tests below that drive a request to a failure. And not by text alone either,
 * which is what it was replaced with: four of the five lines name no resource,
 * so a subtraction that read only their text would take out the browser's
 * complaint about any resource on the page, on exactly the tests that exist to
 * police the failure paths.
 *
 * What is subtracted is what these engines write under interception at the
 * versions this repository pins, and nothing more general than that. A browser
 * that words one of those lines differently, or attributes it to something else,
 * produces a line this does not recognise, and an unrecognised line is a failure
 * here rather than something that passes quietly.
 *
 * `errors` is neither of those: nothing but a script can raise one, so it is
 * read whole everywhere.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string | undefined} baseURL The origin the harness serves from.
 * @returns {{ all: string[], unaccounted: string[], errors: string[] }}
 */
function watch(page, baseURL) {
  expect(baseURL, 'the harness ran with no base URL, so the lines to subtract cannot be built').toBeTruthy();
  const browsers = browserNetworkLines(baseURL ?? '');
  /** @type {string[]} */
  const all = [];
  /** @type {string[]} */
  const unaccounted = [];
  /** @type {string[]} */
  const errors = [];
  page.on('console', (message) => {
    const line = `${message.type()}: ${message.text()}`;
    const from = message.location().url;
    all.push(line);
    if (!browsers.some((known) => known.text === line && known.from === from)) {
      unaccounted.push(`${line} (reported against ${from.length === 0 ? 'nothing' : from})`);
    }
  });
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  return { all, unaccounted, errors };
}

/**
 * The surface, as a snapshot.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>}
 */
function surfaceOf(page) {
  return page.locator('#viewer-root').ariaSnapshot();
}

/**
 * The elements the collection notice is written into, which every surface
 * carrying the footer has to be showing once the disclosure is open.
 *
 * Written once. Both of the readings below that require these to be on the
 * screen take the list from here, so the two cannot come to require different
 * elements without the difference being written down.
 */
const NOTICE_ON_SCREEN = ['notice-summary', 'notice-body', 'notice-lead', 'policy-link', 'notice-tail'];

/**
 * Whether the disclosure the notice lives in is open.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>}
 */
function noticeIsOpen(page) {
  return page.evaluate(() => {
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
    const disclosure = inPage['document'].getElementById('notice');
    return disclosure !== null && disclosure.open === true;
  });
}

/**
 * The disclosure open, from whatever it was left in.
 *
 * A click on the summary is a toggle and not an opening, and the state it
 * toggles survives everything the viewer does to the page: a render draws into
 * the sections, it does not rebuild the footer, so a disclosure opened on one
 * surface is still open on the next one. A second reading that clicked to "open"
 * it closed it instead, and read a notice that was not on the screen at all.
 *
 * That reading passed, which is the part worth writing down. A closed disclosure
 * in one of these engines does not collapse its contents to nothing — it stops
 * painting them and stops answering for them while leaving the sizes they last
 * had, so `getBoundingClientRect` goes on reporting a box of the right size for
 * content that is not being shown, at coordinates outside a page that cannot
 * scroll that far. A reading that asks only for a box cannot tell that apart
 * from a notice on the screen.
 *
 * So the state is read before it is driven, and asserted after. Anything that
 * leaves the disclosure closed here fails rather than quietly measuring nothing.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function openTheNotice(page) {
  await expect(page.locator('#notice-summary')).toBeVisible();
  if (!(await noticeIsOpen(page))) {
    await page.locator('#notice-summary').click();
  }
  expect(
    await noticeIsOpen(page),
    'the notice disclosure is closed, and everything read from under it is a reading of nothing',
  ).toBe(true);
}

/**
 * Each of these elements read for whether a recipient could see it, rather than
 * for whether the document is holding it somewhere.
 *
 * "On the screen, with a box that has width and height in it" is a reading of
 * the layout, and the layout is only one of the things a stylesheet decides.
 * Four declarations take this notice off a recipient's screen and leave the
 * layout exactly as it was — the element keeps its box, keeps its place in the
 * flow, answers `visible`, and measures at the same size it always did. Each was
 * put to both engines, and under each of them every reading of the box went on
 * agreeing that the notice was being shown:
 *
 *   opacity: 0                          box, colour and size untouched, and
 *                                       nothing of it drawn.
 *   color: transparent                  the colour resolves with an alpha of
 *                                       zero, and a contrast reading that takes
 *                                       three channels and not the fourth sees
 *                                       black on white and is satisfied.
 *   position: absolute; left: -99999px  a box of the right size in a place no
 *                                       scrolling reaches, because a page does
 *                                       not scroll to the left of itself.
 *   clip-path: inset(100%)              box, colour, opacity and size all as
 *                                       they were, and the region it is painted
 *                                       in — and answered for — clipped away.
 *
 * So four readings, each of them the one that catches its own.
 *
 * The opacity it is drawn at, multiplied out through every element it sits
 * inside: opacity compounds in the painting rather than in the property, so an
 * ancestor at zero takes the element with it while the element's own opacity
 * still answers 1.
 *
 * The alpha of the colour its text is written in, which is the channel a ratio
 * over r, g and b never looks at.
 *
 * Whether any part of it is in the window, after the window has been scrolled to
 * it. Scrolled first, because below the fold is not hidden and a recipient can
 * reach it. A page cannot be scrolled to a negative offset, so an element placed
 * to the left of the document is out of the window however far the scroll goes,
 * which is what separates the two.
 *
 * And whether the page answers with the element, or with something inside it, at
 * a point inside its own box. An element whose paint region has been clipped
 * away is not what is at any of its points, and neither is one with something
 * opaque drawn over it.
 *
 * That point is taken inside a client rect and not inside the bounding box. The
 * bounding box of an inline element that wraps is the union of its lines, and
 * the middle of a union can fall in the gap between two of them; the client
 * rects are the lines themselves. Where a line is partly out of the window the
 * point is the middle of the part that is in it, so it is always inside both.
 *
 * This is a battery against those four, and not a proof that anything was
 * painted. It reads style, geometry, and what the page answers at a point, and a
 * declaration that gets past all four of those and still leaves the notice
 * unreadable is not caught here. One of those is not a worry but a measurement:
 * `filter: opacity(0)` on the same element takes the notice off the screen as
 * completely as `opacity: 0` does, and every reading in this repository stays
 * green under it — a filter is not the `opacity` property, so the property still
 * answers 1, and a filter changes no box, no colour and nothing about what the
 * page answers at a point. The others alongside it: an opacity or an alpha that
 * is small rather than zero, a font size that is small rather than zero, and
 * something drawn over the notice that declines hit-testing.
 *
 * They are written down rather than chased. Naming the properties that can hide
 * something is the same unfinishable list as naming the characters that can end
 * a URL, and a reading whose limits are not written down is read as a guarantee.
 * What stands behind the unbounded part is the stylesheet's bytes, which are
 * pinned whole elsewhere; what this adds is that the four spellings above, each
 * of which survives that pin when the pin is updated in the same change, do not
 * also survive a reading of the screen.
 *
 * The window is put back where it was found, for the same reason the disclosure
 * is: everything after this reads a page this is not allowed to have moved.
 *
 * @param {import('@playwright/test').Page} page
 * @param {readonly string[]} ids
 * @returns {Promise<string[]>} One line per element that is not on the screen.
 */
function imperceptible(page, ids) {
  return page.evaluate((wanted) => {
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
    const wasX = Number(inPage['scrollX']);
    const wasY = Number(inPage['scrollY']);

    /**
     * The fourth channel of a resolved colour. Absent means opaque: `rgb(...)`
     * carries no alpha and is not transparent for the lack of one.
     *
     * @param {string} colour
     */
    const alphaOf = (colour) => {
      const found = colour.match(/rgba?\(([^)]+)\)/);
      if (found === null) {
        return 1;
      }
      const parts = (found[1] ?? '').split(',').map((one) => Number.parseFloat(one.trim()));
      return parts.length > 3 ? (parts[3] ?? 1) : 1;
    };

    /** @type {string[]} */
    const failures = [];
    for (const id of wanted) {
      const element = inPage['document'].getElementById(id);
      if (element === null) {
        failures.push(`${id}: is not in the page, and this page has to be showing it`);
        continue;
      }

      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });

      let drawnAt = 1;
      /** @type {any} */
      let node = element;
      while (node !== null && node !== undefined && node.nodeType === 1) {
        const own = Number.parseFloat(inPage['getComputedStyle'](node).opacity);
        drawnAt *= Number.isFinite(own) ? own : 1;
        node = node.parentElement;
      }
      if (!(drawnAt > 0)) {
        failures.push(`${id}: is drawn at ${drawnAt} opacity, counting every element it sits inside`);
      }

      const alpha = alphaOf(String(inPage['getComputedStyle'](element).color));
      if (!(alpha > 0)) {
        failures.push(`${id}: is written in a colour with an alpha of ${alpha}, so none of it is drawn`);
      }

      // The middle of the part of each line that is inside the window, which is
      // a point inside the element and inside the window both.
      /** @type {{ x: number, y: number }[]} */
      const points = [];
      for (const line of element.getClientRects()) {
        if (line.width <= 0 || line.height <= 0) {
          continue;
        }
        const left = Math.max(line.left, 0);
        const top = Math.max(line.top, 0);
        const right = Math.min(line.right, Number(inPage['innerWidth']));
        const bottom = Math.min(line.bottom, Number(inPage['innerHeight']));
        if (right <= left || bottom <= top) {
          continue;
        }
        points.push({ x: (left + right) / 2, y: (top + bottom) / 2 });
      }
      if (points.length === 0) {
        failures.push(`${id}: has no part of it in the window, with the window scrolled as far as it goes towards it`);
        continue;
      }

      const reached = points.some((point) => {
        const at = inPage['document'].elementFromPoint(point.x, point.y);
        return at !== null && element.contains(at);
      });
      if (!reached) {
        failures.push(`${id}: is not what the page answers with at any point inside it, so nothing of it is on top`);
      }
    }

    inPage['scrollTo'](wasX, wasY);
    return failures;
  }, ids);
}

/**
 * The notice a recipient can read on every surface that carries the footer.
 *
 * The snapshots above carry this notice only as far as its summary line. The
 * disclosure it lives in arrives closed, and a closed disclosure exposes its
 * summary and nothing under it — so the notice itself is not in any pinned
 * snapshot, and a sentence changed inside it moves no byte of one.
 *
 * So it is read from the element it is written into, against this file's own
 * transcription. `textContent` and not `innerText`: what is closed is not
 * rendered, and `innerText` answers with the empty string here in both engines,
 * which is a comparison that passes whatever the notice says.
 *
 * The whole of it, from the element that holds all of it, and that is the point
 * of reading it this way rather than span by span. The notice is one sentence
 * written into three elements, and a reading that names two of them says nothing
 * at all about the third: a sentence appended to the span that was not named
 * reached a recipient with every check in this repository green. Comparing what
 * the paragraph says closes that for the span that was missed and for any span
 * added to it later, which a third named reading would not.
 *
 * The two spans are still read separately underneath, because a failure that
 * says which of them moved is a more useful failure than one that says the
 * notice did.
 *
 * And then the disclosure is opened and the notice is read a second way, which
 * is the way a recipient reads it: on the screen. Everything above is a reading
 * of what the document HOLDS, and a document holds text a reader cannot see. One
 * declaration in the stylesheet takes this notice off the screen with every
 * character of it still in the element — measured, in both engines — and every
 * assertion above passes on a page showing a recipient nothing at all. The
 * stylesheet's bytes are pinned whole by the fast suite, and that pin is a
 * different kind of guard: it says the file is the file that was read, and it
 * moves with any deliberate change to it. So a change that hid the notice and
 * re-pinned the hash in the same edit — which is what a deliberate change looks
 * like — left nothing anywhere reading whether the notice was on the screen.
 *
 * This is that reading. Each span is required to be visible and to have a box
 * with width and height in it, which is the property `display: none`, a zero
 * size, and a collapsed ancestor each take away. The box is read as well as
 * asked for, rather than resting on what "visible" is defined to mean somewhere
 * else.
 *
 * And then, because a box is not a thing anybody can see, each span is read for
 * whether it is perceptible and in the window as well as for whether it has a
 * size. Four declarations leave the box and the colour exactly where this found
 * them and take the notice off the screen anyway; `imperceptible` above is the
 * reading of those, and what each of its four parts is for is written there. The
 * box reading is kept underneath it rather than replaced, because a failure
 * saying the notice has no size at all is a different and more useful failure
 * than one saying it could not be seen.
 *
 * The disclosure is put back the way it was found. The pinned snapshots in this
 * file are of a page whose disclosure is closed, and a helper that left it open
 * would change what every reading after it sees.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function expectNotice(page) {
  expect(await page.locator('#notice-body').textContent()).toBe(NOTICE);
  expect(await page.locator('#notice-lead').textContent()).toBe(NOTICE_BODY);
  expect(await page.locator('#policy-link').textContent()).toBe(POLICY_LINK_TEXT);

  await openTheNotice(page);
  for (const id of NOTICE_ON_SCREEN) {
    const shown = page.locator(`#${id}`);
    await expect(shown, `#${id} is in the document and not on the screen`).toBeVisible();
    const box = await shown.boundingBox();
    expect(box, `#${id} has no box at all, so nothing of it is on the screen`).not.toBeNull();
    expect(box?.width ?? 0, `#${id} is on the screen with no width`).toBeGreaterThan(0);
    expect(box?.height ?? 0, `#${id} is on the screen with no height`).toBeGreaterThan(0);
  }
  expect(
    await imperceptible(page, NOTICE_ON_SCREEN),
    'the notice is in the document and not on the screen a recipient is looking at',
  ).toEqual([]);
  await page.locator('#notice-summary').click();
  await expect(page.locator('#notice-body')).toBeHidden();
}

/**
 * Type the code and press the control.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function enterCode(page) {
  await page.locator('#code-input').fill(TYPED_CODE);
  await page.locator('#code-submit').click();
}

/**
 * Type the code and send it the other way, from the field itself.
 *
 * The viewer answers two things on this surface: the control being pressed, and
 * the return key while the field has the focus. They are two listeners in the
 * renderer and they reach the same request, and only the first of them was ever
 * driven — so the second was a way of sending a recipient's code that no
 * reading in this file had ever watched happen.
 *
 * `press` rather than a typed newline: what the renderer listens for is the key,
 * and a field that is not a form has nothing that would submit without one.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function enterCodeWithTheReturnKey(page) {
  await page.locator('#code-input').fill(TYPED_CODE);
  await page.locator('#code-input').press('Enter');
}

/**
 * Every place in the page that is holding a spelling somewhere other than in its
 * text.
 *
 * A snapshot reads what the page exposes and the document's text reads what it
 * says, and a control's value is in neither: a field is not text, and neither is
 * an attribute. So this walks every element and looks at the two string slots a
 * control keeps a value in and at every attribute each element carries.
 *
 * Answers are `tag#id where`, so a failure says which element and which slot
 * rather than that something somewhere matched.
 *
 * @param {import('@playwright/test').Page} page
 * @param {readonly string[]} spellings
 * @returns {Promise<string[]>}
 */
function residueIn(page, spellings) {
  return page.evaluate((wanted) => {
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
    /** @type {string[]} */
    const found = [];
    for (const element of inPage['document'].querySelectorAll('*')) {
      const id = String(element.id ?? '');
      const where = `${String(element.tagName).toLowerCase()}${id.length > 0 ? `#${id}` : ''}`;
      for (const slot of ['value', 'defaultValue']) {
        const held = element[slot];
        if (typeof held !== 'string') {
          continue;
        }
        for (const spelling of wanted) {
          if (spelling.length > 0 && held.includes(spelling)) {
            found.push(`${where} ${slot}`);
          }
        }
      }
      for (const attribute of Array.from(element.attributes)) {
        const one = /** @type {Record<string, any>} */ (attribute);
        for (const spelling of wanted) {
          if (spelling.length > 0 && String(one['value']).includes(spelling)) {
            found.push(`${where} @${String(one['name'])}`);
          }
        }
      }
    }
    return found;
  }, spellings);
}

/**
 * Put the page away and bring it back, without leaving the document.
 *
 * The event a browser fires when it restores a page out of its back/forward
 * cache, dispatched here rather than waited for. Navigating away and back is a
 * different question: whether a browser restores the document or loads it again
 * is the browser's decision, and a page that was loaded again is a fresh page —
 * so anything left underneath a surface would be gone for a reason that has
 * nothing to do with the viewer. Dispatching it in place keeps the elements the
 * note was written into.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function putAway(page) {
  await page.evaluate(() => {
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
    const event = new inPage['Event']('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    inPage['window'].dispatchEvent(event);
  });
}

/**
 * Put the page away and stop there.
 *
 * The other half of the pair above, and it needs its own helper because the pair
 * is what hides it. A browser fires one event as a page goes and another as it
 * comes back, and the viewer answers both: the first empties everything, and the
 * second draws the generic surface over what the first left. Read after both, the
 * page looks the way it looks whether or not the first one did anything at all —
 * which is exactly what a reading of the put-away act must not be built on.
 *
 * So this dispatches only the going, in the same way and in the same document.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function putAwayWithoutReturning(page) {
  await page.evaluate(() => {
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
    inPage['window'].dispatchEvent(new inPage['Event']('pagehide'));
  });
}

/**
 * Which of the page's sections are on screen.
 *
 * By the property the viewer sets rather than by what a snapshot exposes: what is
 * being asked here is whether the act of putting the page away took each section
 * off, and a section that is off has nothing in a snapshot to read.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>} The ids still showing, in document order.
 */
async function showing(page) {
  return page.evaluate(() => {
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
    /** @type {string[]} */
    const on = [];
    for (const id of ['advisory', 'shell', 'wrong-code', 'note', 'unavailable', 'footer']) {
      const element = inPage['document'].getElementById(id);
      if (element !== null && element.hidden !== true) {
        on.push(String(id));
      }
    }
    return on;
  });
}

/** Where the stand-in below records what it was asked to do. */
const EMPTYING = '__emptyingAttempts';

/**
 * Stop one element from being emptied, and prove it is stopped before the viewer
 * is asked for anything.
 *
 * The one DOM write the viewer makes, replaced on the element itself by a
 * stand-in that counts the calls and does nothing. That is what puts the guard
 * above it on a clear which genuinely failed, rather than on a clear nobody
 * tried.
 *
 * A redefinition can quietly do nothing, and a test built on one that did would
 * be the ordinary path wearing the guarded path's name. So the stand-in is
 * called once from here while the element is holding something, and what it was
 * holding has to still be there afterwards: the real write would have taken it.
 * That control runs before the viewer sees anything, and the count is put back
 * to zero after it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @returns {Promise<void>}
 */
async function refuseToEmpty(page, selector) {
  const control = await page.evaluate(
    ([where, slot]) => {
      const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
      const element = inPage['document'].querySelector(where);
      const before = Number(element.childNodes.length);
      const state = { calls: 0 };
      inPage[String(slot)] = state;
      Object.defineProperty(element, 'replaceChildren', {
        value: () => {
          state.calls += 1;
        },
        configurable: true,
      });
      element.replaceChildren();
      const after = Number(element.childNodes.length);
      state.calls = 0;
      return { before, after };
    },
    [selector, EMPTYING],
  );

  expect(control.before, `${selector} was holding nothing, so a write that emptied it would look the same`).toBeGreaterThan(0);
  expect(control.after, `${selector} was emptied by the stand-in, so the redefinition did not take`).toBe(control.before);
}

/**
 * How many times the stand-in has been asked to empty something since it was
 * installed.
 *
 * Zero is its own failure: a guard nothing reached is a guard nothing has shown
 * to work, and the assertions around it would pass on a viewer that never tried.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
async function emptyingAttempts(page) {
  return page.evaluate((slot) => {
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
    return Number(inPage[String(slot)]?.calls ?? 0);
  }, EMPTYING);
}

/**
 * How many links a page has been opened with.
 *
 * Every load below carries a query nothing else does, and it has to. A
 * navigation that differs from the current address only in its fragment is not a
 * navigation at all — the browser treats it as a move within the same document,
 * and the entry point never runs a second time. Since the first thing the entry
 * point does is take the fragment off the address bar, every load after the
 * first would be exactly that: same path, new fragment, no boot, and a test
 * driving a page that is still showing whatever the last one left.
 *
 * @type {WeakMap<import('@playwright/test').Page, number>}
 */
const opened = new WeakMap();

/**
 * Open a link, as a recipient would.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} fragment
 * @returns {Promise<void>}
 */
async function openLink(page, fragment) {
  const run = (opened.get(page) ?? 0) + 1;
  opened.set(page, run);
  await page.goto(`/index.html?open=${run}${fragment}`);
}

/**
 * The two requests this viewer may make, spelled at the origin the harness
 * serves the page from.
 *
 * Every stub below is registered against one of these rather than against a
 * pattern that matches a path at any origin, and that is what makes the reading
 * underneath them able to see anything. A stub written as `**\/share/open`
 * answers for `/share/open` wherever it is asked of — so a viewer asking a
 * different host for it would be answered by the test, with its own answer,
 * and nothing would be different about the run. Written whole, a request that
 * left this origin matches no stub at all and reaches the catch-all below.
 *
 * @param {string | undefined} baseURL Where the harness serves the page from.
 * @returns {string}
 */
function shareOpenAt(baseURL) {
  return `${baseURL ?? ''}/share/open`;
}

/** @see shareOpenAt @param {string | undefined} baseURL @returns {string} */
function shareReportAt(baseURL) {
  return `${baseURL ?? ''}/share/report`;
}

/**
 * The origin a URL names, or `null` for a string that is not one.
 *
 * @param {string} url
 * @returns {string | null}
 */
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * What each page asked for, and what it asked somewhere else for.
 *
 * @type {WeakMap<import('@playwright/test').Page, { asked: string[], strayed: string[] }>}
 */
const traffic = new WeakMap();

/**
 * Watch where every request goes, on every surface this file drives.
 *
 * The page makes two requests of its own and both are built from one table
 * keyed on the origin the page was served from. Nothing was reading the origin
 * they actually went to. What was read was the PATH — the case below that lists
 * every path of the run — and a path is the half of a destination that a swap at
 * a request's call site does not have to move: the same path at another host is
 * the same path, and a recipient's typed code goes to that host with every pin
 * in this file unchanged. The report request in particular was never driven
 * under any reading at all, so its call site was unwatched entirely.
 *
 * So the origin is read here, for every test in this file rather than inside one
 * of them, and it is read twice over:
 *
 *   - Every request the page makes is collected as it is made, and the reading
 *     after each test requires each of them to name this page's own origin.
 *   - And a handler registered in front of all of them refuses a request that
 *     does not, rather than letting it out and reporting on it afterwards. Two
 *     mechanisms for one property on purpose: the first is a listener, and a
 *     listener is a line a later edit can take out without anything else
 *     changing, while the second stops the request itself and shows up as the
 *     surface a failed request produces.
 *
 * This ADDS to the path reading rather than replacing it, and the two are
 * complementary in a way that is worth writing down, because either of them
 * alone leaves a spelling through. The harness serves this page over `http`,
 * and a destination written as one of these schemes followed by fewer than two
 * slashes — `http:/elsewhere.example/share/open` — is read by a parser against
 * the page it is written in: the scheme matches the page's, so it resolves
 * against this origin with the host pushed into the PATH. Here that spelling
 * makes no off-origin request at all and the origin reading sees nothing, while
 * the path reading sees a path it does not list. From a page served over
 * `https` — the other scheme a page carrying this can be served over — the same
 * spelling names another host outright, and the origin reading is the one that
 * sees it while the path reading sees the path it always saw. Neither reading
 * covers the other's case, and the harness only ever runs one of the two
 * schemes. Both stay.
 *
 * And what this is not: an allowlist. The only origin admitted is the one the
 * page was served from, and no exception is written for anywhere else. The page
 * does carry two links that go somewhere else — the app on the store and the
 * privacy policy — and both are static attributes in the markup, pinned as
 * attributes by the page inventory in `smoke.spec.js`; neither is followed
 * here, and following one would mean writing the first exception into this
 * reading. An exception list is the shape that hides the next destination
 * somebody adds, so there is none, and not following those two links is a
 * deliberate limit of this file rather than an oversight.
 *
 * What none of this is, either, is proof that the page cannot send anything
 * anywhere. The scan over the served tree is a lexical tripwire and says so
 * itself; this is a reading of the requests the surfaces below actually drive,
 * which is what closes the request the surfaces below actually make. The control
 * that holds at runtime for every request nothing here drives is CSP
 * `connect-src`, which the page carries itself as `'self'` and the one share API
 * the committed origin table sends a page to — that table remaining the sole
 * decider of what is ever asked for, since a policy permits a request and does
 * not make one — and which `smoke.spec.js` drives both a refusal and a
 * permission under. The directives a page cannot carry —
 * who may frame it, where violations are reported — still arrive with the deploy
 * configuration and are not in this repository.
 */
test.beforeEach(async ({ page, baseURL }) => {
  expect(baseURL, 'the harness ran with no base URL, so there is no origin to hold requests to').toBeTruthy();
  const origin = originOf(String(baseURL));
  expect(origin, 'the harness base URL is not a URL, so there is no origin to hold requests to').toBeTruthy();

  /** @type {{ asked: string[], strayed: string[] }} */
  const seen = { asked: [], strayed: [] };
  traffic.set(page, seen);

  page.on('request', (request) => {
    seen.asked.push(request.url());
  });

  // Registered before anything else, which is what puts it behind every stub a
  // test registers for itself: the harness offers a matching handler the request
  // in the reverse of the order they were added, so this one is reached only by
  // a request no stub claimed. Every stub in this file is written at this
  // origin, so what reaches here is what left it.
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (originOf(url) !== origin) {
      seen.strayed.push(url);
      await route.abort();
      return;
    }
    await route.continue();
  });
});

test.afterEach(async ({ page, baseURL }) => {
  const seen = traffic.get(page);
  expect(seen, 'no reading of where this page sent its requests was installed').toBeTruthy();
  const origin = originOf(String(baseURL));

  const elsewhere = (seen?.asked ?? []).filter((url) => originOf(url) !== origin);
  expect(elsewhere, `this page asked ${String(origin)} for everything except these`).toEqual([]);
  expect(seen?.strayed ?? [], 'a request left this origin and was stopped').toEqual([]);
});

test('each state the viewer can be in is the surface it is pinned to be', async ({ page, baseURL }) => {
  const seen = watch(page, baseURL);

  // A link that is not one. No identifier parsed, so there is nothing to report
  // and the control is not there — the one sanctioned difference between two
  // unavailable surfaces, and the only one.
  await openLink(page, '#not-a-link');
  expect(await surfaceOf(page)).toBe(UNAVAILABLE_UNNAMED);
  await expectNotice(page);

  // A link that is one.
  await openLink(page, fragmentFor(named));
  expect(await surfaceOf(page)).toBe(SHELL);
  await expectNotice(page);

  // A code that did not match, and the field still holding what was typed.
  await page.route(shareOpenAt(baseURL), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"wrong_code"}' }),
  );
  await enterCode(page);
  await expect(page.locator('#wrong-code')).toBeVisible();
  expect(await surfaceOf(page)).toBe(WRONG_CODE);
  await expectNotice(page);
  await expect(page.locator('#code-input')).toBeEditable();

  // And a failure, which is where every other answer ends.
  await page.unroute(shareOpenAt(baseURL));
  await page.route(shareOpenAt(baseURL), (route) => route.fulfill({ status: 410, body: '' }));
  await openLink(page, fragmentFor(named));
  await enterCode(page);
  await expect(page.locator('#unavailable')).toBeVisible();
  expect(await surfaceOf(page)).toBe(UNAVAILABLE);
  await expectNotice(page);

  // And nothing of the link or the code left in a slot on this surface either.
  //
  // The same three spellings the decrypted surface is read for, asked of the
  // surface a failure ends on, because that surface empties the field too and
  // nothing here was asking whether it did. The snapshot cannot: by the time
  // this line is on screen the shell is hidden, and a field inside a hidden
  // section is not in the accessibility tree at all — so the field could keep
  // what a recipient typed with every pin above it unchanged.
  expect(await residueIn(page, [named.inputs.a, TYPED_CODE, fragmentFor(named)])).toEqual([]);

  expect(seen.errors).toEqual([]);
  // The console, with the browser's own lines about the request this drove to a
  // failure subtracted. A request that did not succeed is reported by the
  // browser itself, and the two engines write the same bytes for a status that
  // is not a success; they differ for one case only, a request that never
  // arrived, where one speaks from its network stack and the other from the
  // automation layer that blocked the load. Five lines come out, and each of them
  // only where it is the line this has seen and where the browser said that line
  // came from — which is not one answer for all five. Four are subtracted where
  // the browser attributed them to this request; the fifth, the one the automation
  // layer writes, arrives with no location on it at all, and it is subtracted
  // where it has none and where it names this request inside its own text.
  // Everything else stays in and fails here, whoever wrote it — a page that said
  // something, and equally a browser complaining about some other resource, which
  // is not a complaint this reading may lose.
  expect(seen.unaccounted).toEqual([]);
});

test('a browser that fails the probe is advised, and its code field still works', async ({ page, baseURL }) => {
  // The advisory is reached by taking the platform's cryptography away, and
  // taking it away is the part that has to be checked rather than assumed.
  // `delete crypto.subtle` does nothing: it is an inherited accessor, and
  // deleting a property an object does not have succeeds and changes nothing.
  // So it is redefined on the instance, and the page is asked whether it is
  // actually gone before the viewer is allowed to look.
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    /** @type {Record<string, unknown>} */ (globalThis)['__subtleWasRemoved'] =
      globalThis.crypto.subtle === undefined;
  });

  const seen = watch(page, baseURL);
  await openLink(page, fragmentFor(named));

  expect(
    await page.evaluate(() => /** @type {Record<string, unknown>} */ (globalThis)['__subtleWasRemoved']),
    'the cryptography was still there, so the advisory this test is about was reached some other way',
  ).toBe(true);
  expect(await page.evaluate(() => globalThis.crypto.subtle === undefined)).toBe(true);

  await expect(page.locator('#advisory')).toBeVisible();
  expect(await surfaceOf(page)).toBe(SHELL_WITH_ADVISORY);
  await expectNotice(page);

  // Advice and not a block: the field is still usable, and a recipient who goes
  // on reaches the one surface everything else reaches.
  await expect(page.locator('#code-input')).toBeEditable();
  await expect(page.locator('#code-submit')).toBeEnabled();

  // The three pieces of that advisory concatenate to exactly one sentence, which
  // a snapshot cannot say: it normalises the spaces at the joins.
  expect(await page.locator('#advisory').textContent()).toBe(
    "This app's built-in browser can't open shared notes safely. Tap \u22ef and choose Open in Safari (or Chrome).",
  );

  expect(seen.errors).toEqual([]);
  expect(seen.all).toEqual([]);
});

test('a probe that answers late does not draw advice over a surface that is finished', async ({ page, baseURL }) => {
  // The advice above belongs to the code-entry surface. The probe that earns it
  // starts when the page does and answers whenever the browser gets to it, and
  // those two facts come apart on a browser that is both slow at this and bad at
  // it: the answer arrives after a code has been sent, when the shell has been
  // replaced by a note or by the one line every failure ends on. Advice written
  // onto that line is a difference between two failures that are required to draw
  // the same bytes.
  //
  // The timing is made from here, and no served file is edited to make it. The
  // first call the probe makes into the platform's cryptography is held open
  // until this test lets go of it, and what it is let go with is a value the
  // derivation cannot use — so the probe answers, late, that this browser cannot
  // do the work. Everything else is the viewer running as it ships.
  await page.addInitScript(() => {
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
    const subtle = inPage['crypto'].subtle;

    /** @type {() => void} */
    let open = () => {};
    const opened = new Promise((resolve) => {
      open = () => {
        resolve(undefined);
      };
    });
    const gate = {
      held: 0,
      derived: false,
      installed: false,
      open: () => {
        open();
      },
    };
    inPage['__probeGate'] = gate;

    // The first call is held; anything after it is the platform's own, so a page
    // that goes on to do real work is not broken by this.
    const realImport = subtle.importKey;
    Object.defineProperty(subtle, 'importKey', {
      configurable: true,
      writable: true,
      value: async (/** @type {any[]} */ ...args) => {
        gate.held += 1;
        if (gate.held > 1) {
          return realImport.apply(subtle, args);
        }
        await opened;
        return null;
      },
    });

    // And the step after it, wrapped only to record that it has finished. What
    // follows the probe's answer is a fixed handful of turns, so a reading taken
    // after this has settled is a reading taken after the viewer has had its
    // chance to write.
    const realDerive = subtle.deriveKey;
    Object.defineProperty(subtle, 'deriveKey', {
      configurable: true,
      writable: true,
      value: (/** @type {any[]} */ ...args) => {
        const settled = () => {
          gate.derived = true;
        };
        try {
          return Promise.resolve(realDerive.apply(subtle, args)).then(
            (value) => {
              settled();
              return value;
            },
            (error) => {
              settled();
              throw error;
            },
          );
        } catch (error) {
          settled();
          throw error;
        }
      },
    });

    gate.installed = subtle.importKey !== realImport && subtle.deriveKey !== realDerive;
  });

  /**
   * What the held probe has done so far.
   *
   * @returns {Promise<any>}
   */
  const gateState = () =>
    page.evaluate(() => /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis))['__probeGate']);

  /**
   * Let the probe answer.
   *
   * @returns {Promise<void>}
   */
  const letTheProbeAnswer = async () => {
    await page.evaluate(() => {
      /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis))['__probeGate'].open();
    });
  };

  const seen = watch(page, baseURL);

  // The control first, and it is the half that makes the other half a reading of
  // the timing. Held the same way and let go while the shell is still the
  // surface, this probe answers that the browser cannot do the work and the
  // advice appears — so an advisory that stays away below stays away because of
  // when the answer arrived rather than because the answer was yes.
  await openLink(page, fragmentFor(named));
  expect(
    (await gateState()).installed,
    'the call the probe makes into the platform was not held, so nothing here is about timing',
  ).toBe(true);
  await expect.poll(async () => (await gateState()).held).toBe(1);
  await expect(page.locator('#advisory')).toBeHidden();

  await letTheProbeAnswer();
  await expect(page.locator('#advisory')).toBeVisible();
  expect(await surfaceOf(page)).toBe(SHELL_WITH_ADVISORY);

  // And the race. The same held probe, and a code sent before it is let go, so
  // the answer comes back to a page that has finished with the shell.
  await page.route(shareOpenAt(baseURL), (route) => route.fulfill({ status: 500, body: '' }));
  await openLink(page, fragmentFor(named));
  await expect.poll(async () => (await gateState()).held).toBe(1);
  await expect(page.locator('#advisory')).toBeHidden();

  await enterCode(page);
  await expect(page.locator('#unavailable')).toBeVisible();
  expect(await surfaceOf(page)).toBe(UNAVAILABLE);

  await letTheProbeAnswer();
  await expect.poll(async () => (await gateState()).derived).toBe(true);
  // And the turns after that answer, taken in the page rather than waited out on
  // a clock: the microtasks the viewer's own chain runs on, and two turns of the
  // task queue behind them.
  await page.evaluate(async () => {
    for (let turn = 0; turn < 50; turn += 1) {
      await Promise.resolve();
    }
    for (let turn = 0; turn < 2; turn += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  });

  expect(
    await showing(page),
    'the advice was drawn over the surface a failure had already finished on',
  ).toEqual(['unavailable', 'footer']);
  await expect(page.locator('#advisory')).toBeHidden();
  expect(await surfaceOf(page)).toBe(UNAVAILABLE);

  expect(seen.errors).toEqual([]);
  expect(seen.unaccounted).toEqual([]);
});

test('a decrypted note is the document that was sealed, and carries nothing of the link', async ({ page, baseURL }) => {
  const seen = watch(page, baseURL);

  // The four states the two chips have between them: a document that names who
  // "you" is, or does not, crossed with a share that was edited, or was not.
  // Three of the four are published shares. The fourth is sealed here, for the
  // reason given where it is built.
  const edited = fixtureNamed('edited');
  const withoutAName = await sealedWithoutAName(edited);
  const configurations = [
    {
      what: 'a name, and a share that was not edited',
      hasName: true,
      wasEdited: false,
      fixture: named,
      docText: named.inputs.plaintext,
      aadText: named.inputs.aad,
      body: shareBody(named),
    },
    {
      what: 'no name, and a share that was not edited',
      hasName: false,
      wasEdited: false,
      fixture: fixtureNamed('nameless'),
      docText: fixtureNamed('nameless').inputs.plaintext,
      aadText: fixtureNamed('nameless').inputs.aad,
      body: shareBody(fixtureNamed('nameless')),
    },
    {
      what: 'a name, and a share that was edited',
      hasName: true,
      wasEdited: true,
      fixture: edited,
      docText: edited.inputs.plaintext,
      aadText: edited.inputs.aad,
      body: shareBody(edited),
    },
    {
      what: 'no name, and a share that was edited',
      hasName: false,
      wasEdited: true,
      fixture: edited,
      docText: withoutAName.docText,
      aadText: edited.inputs.aad,
      body: withoutAName.body,
    },
  ];

  // Each row is asked to be the state it is named after, before anything is
  // driven from it. Four labels over four shares is a table that reads as
  // coverage of four states and asserts nothing about which state any of them
  // is in: the same share four times, or a fixture that quietly stopped carrying
  // a name, would drive four identical surfaces under four different headings
  // and every assertion below would hold.
  for (const configuration of configurations) {
    expect(JSON.parse(configuration.docText).you_means.length > 0, `${configuration.what}: the document's name`).toBe(
      configuration.hasName,
    );
    expect(JSON.parse(configuration.aadText).edited, `${configuration.what}: the authenticated edited state`).toBe(
      configuration.wasEdited,
    );
  }

  /** @type {string[]} */
  const drawn = [];
  for (const configuration of configurations) {
    const fragment = fragmentFor(configuration.fixture);
    await page.unroute(shareOpenAt(baseURL));
    await page.route(shareOpenAt(baseURL), (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: configuration.body }),
    );

    await openLink(page, fragment);
    await enterCode(page);
    await expect(page.locator('#note'), configuration.what).toBeVisible();

    const surface = await surfaceOf(page);
    expect(surface, configuration.what).toBe(decryptedSurface(configuration.docText, configuration.aadText));
    drawn.push(surface);
    await expectNotice(page);

    // And what must not be anywhere on it, read three ways because the three
    // read different things. The snapshot is what the page exposes. The
    // document's text is what the page says, which is more — a value written
    // into a hidden element is in the second and not the first. And neither of
    // those reaches what a control is holding or what an attribute is carrying,
    // which is where a code a recipient typed actually sits, so the third walks
    // the elements and looks in those slots by name.
    //
    // All three are reads of the page, and neither more nor less than that.
    // None of them is a claim about memory: after the field is emptied the
    // string a recipient typed is still on the heap, in whatever the browser has
    // not yet collected, and no test driving a browser can say otherwise. None
    // of them is a claim that the link has left the document either — the
    // navigation timing entry records the address this page was loaded from,
    // fragment and all, for as long as the document is alive, and two of these
    // three spellings are in it. What these say is that none of the three is on
    // the surface, in what the page says, or in a slot an element is holding.
    const text = await page.evaluate(() => {
      const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
      return String(inPage['document'].documentElement.textContent ?? '');
    });
    const spellings = [configuration.fixture.inputs.a, TYPED_CODE, fragment];
    for (const [what, spelling] of [
      ['the link capability', spellings[0]],
      ['the code that was typed', spellings[1]],
      ['the fragment the link arrived in', spellings[2]],
    ]) {
      expect(surface, `${what} is on the surface with ${configuration.what}`).not.toContain(spelling);
      expect(text, `${what} is in the page with ${configuration.what}`).not.toContain(spelling);
    }
    expect(await residueIn(page, spellings), `with ${configuration.what}`).toEqual([]);
  }

  // And the four are four. Each surface above is compared against what this file
  // builds for the document and the authenticated data it was driven with, and
  // that comparison would hold just as well if all four rows drew the same
  // thing — the builder would be handed the same two values and produce the same
  // expectation. What separates the four states is that they look different, so
  // that is asked directly.
  expect(new Set(drawn).size, `four chip configurations drew ${new Set(drawn).size} different surface(s)`).toBe(
    configurations.length,
  );

  expect(seen.errors).toEqual([]);
  expect(seen.all).toEqual([]);
});

test('the link is out of the address bar before anything is sent, and nothing sent carries it', async ({ page, baseURL }) => {
  const seen = watch(page, baseURL);

  /** @type {{ url: string, body: string | null }[]} */
  const sent = [];
  page.on('request', (request) => {
    sent.push({ url: request.url(), body: request.postData() });
  });
  await page.route(shareOpenAt(baseURL), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: shareBody(named) }),
  );

  await openLink(page, fragmentFor(named));

  // Before a single thing is asked of a server. The scrub happens at boot, in
  // front of every await and every request, so this is the state the page is in
  // while nothing has been sent.
  expect(await page.evaluate(() => {
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
    return String(inPage['location'].hash);
  })).toBe('');
  expect(sent.some((request) => request.url.includes('/share/'))).toBe(false);

  await enterCode(page);
  await expect(page.locator('#note')).toBeVisible();

  // What the page asked for, whole. The fragment never travels — it is not part
  // of a request — and this is what says so about every request in the run
  // rather than about the one that could have carried it.
  for (const request of sent) {
    expect(request.url, `${request.url} carries the link capability`).not.toContain(named.inputs.a);
    expect(request.url, `${request.url} carries the fragment`).not.toContain('v=link_split_v1');
    if (request.body !== null) {
      expect(request.body).not.toContain(named.inputs.a);
      expect(request.body).not.toContain('v=link_split_v1');
    }
  }

  // And every path of it, which is the other half of a destination and the half
  // this case has always read. It stays, and it stays beside the origin reading
  // this file now runs over every test rather than being replaced by it. A path
  // does not move when a request is pointed at another host, so a swapped
  // destination is invisible here and visible there; and a destination written
  // as this page's own scheme followed by fewer than two slashes does not leave
  // this origin at all when the page is served over that same scheme — it
  // resolves against this page with the host pushed into the path, which is
  // invisible there and visible here. Two readings, two spellings, and neither
  // one covers the other's.
  const paths = sent.map((request) => new URL(request.url).pathname).sort();
  expect(paths).toEqual(
    [
      '/index.html',
      '/css/viewer.css',
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
      '/share/open',
    ].sort(),
  );

  expect(seen.errors).toEqual([]);
  expect(seen.all).toEqual([]);
});

test('a browser that refuses to rewrite the address still draws its surface and still empties', async ({
  page,
  baseURL,
}) => {
  // The case above reads the rewrite where it works. This one reads it where the
  // browser will not do it, which is a thing browsers are entitled to say.
  // Rewriting the address is privileged: a document whose origin is opaque has
  // no address it is allowed to rewrite to, and an engine that caps how often a
  // page may rewrite throws once that cap is reached.
  //
  // What the throw used to cost was the whole page. The rewrite is the first
  // side-effecting thing the entry point does, it was unguarded, and the entry
  // point had nothing around it — so a throw there ended the function on its
  // second statement. No lifecycle handlers, no root, nothing drawn: a blank
  // document, which is neither of the two surfaces this viewer has. And it cost
  // both halves at once, because the run that loses the scrub is exactly the run
  // that keeps the capability in the address, and the handler that empties the
  // page had never been attached to take anything back off it.
  //
  // So the refusal is driven from outside every served file — the rewrite is
  // redefined to throw before the module graph runs — and the page is asked
  // whether it really does throw, because a test that quietly drove the ordinary
  // path would pass for the wrong reason.
  await page.addInitScript(() => {
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
    const scrub = { attempts: 0, throws: false };
    inPage['__scrub'] = scrub;

    Object.defineProperty(inPage['history'], 'replaceState', {
      configurable: true,
      writable: true,
      value: () => {
        scrub.attempts += 1;
        throw new inPage['DOMException']('the address of this document may not be rewritten', 'SecurityError');
      },
    });

    // Asked once here, and then discounted: this call is the test's own and is
    // not one of the entry point's.
    try {
      inPage['history'].replaceState(null, '', inPage['location'].pathname);
    } catch {
      scrub.throws = true;
    }
    scrub.attempts = 0;
  });

  /**
   * What the refusal has seen, in the document that is loaded now. The init
   * script runs for each document, so these counts are per load rather than
   * across the test.
   *
   * @returns {Promise<{ attempts: number, throws: boolean }>}
   */
  const scrubState = () =>
    page.evaluate(() => {
      const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
      const held = inPage['__scrub'];
      return { attempts: Number(held.attempts), throws: held.throws === true };
    });

  /** @returns {Promise<string>} */
  const addressFragment = () =>
    page.evaluate(() => {
      const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
      return String(inPage['location'].hash);
    });

  // Every request in this run answers, so the whole channel is read: a throw
  // that escaped the entry point would be here as well as on the surface.
  const seen = watch(page, baseURL);
  await page.route(shareOpenAt(baseURL), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: shareBody(named) }),
  );

  // A link that parses, opened into a browser that will not rewrite.
  await openLink(page, fragmentFor(named));

  const first = await scrubState();
  expect(first.throws, 'the rewrite did not throw, so this drove the path the case above already reads').toBe(true);
  expect(first.attempts, 'the entry point did not attempt the rewrite').toBe(1);

  // And the fragment is still in the address, which is the honest cost of the
  // refusal and the second reason this is not the ordinary path wearing a
  // disguise. `main.js` says this is what a refused rewrite leaves.
  expect(await addressFragment()).toBe(fragmentFor(named));

  // Not blank. Everything after the rewrite ran, so there is a surface, and it is
  // the one a parsed link earns rather than a page with nothing on it.
  expect(await surfaceOf(page)).toBe(SHELL);
  await expectNotice(page);

  // And what the flow was handed is the fragment itself rather than something
  // that merely parsed. A code goes in, the stored share comes back, and the note
  // drawn is the document that was sealed — which cannot happen unless the
  // capability the link carried reached the decryption intact.
  await enterCode(page);
  await expect(page.locator('#note')).toBeVisible();
  expect(await surfaceOf(page)).toBe(decryptedSurface(named.inputs.plaintext, named.inputs.aad));
  expect(await residueIn(page, [named.inputs.a, TYPED_CODE, fragmentFor(named)])).toEqual([]);

  // And the handler that empties the page was attached, which is the other half
  // of what the throw used to take. The going, on its own: the note's body is
  // emptied and every section goes off.
  await putAwayWithoutReturning(page);
  expect(await page.locator('#note-body').innerHTML()).toBe('');
  expect(await showing(page)).toEqual([]);

  // And the coming back, which is the other listener and would be missing for the
  // same reason. A restored page draws the generic surface with nothing to report.
  await putAway(page);
  expect(await surfaceOf(page)).toBe(UNAVAILABLE_UNNAMED);

  // Then the other kind of link, because the surface a refusal leaves must be
  // whichever surface the fragment earns rather than one fixed answer. A fragment
  // that is not one parses to nothing, and what is drawn is the single line every
  // failure ends on, without the control that reports a link that was never named.
  await openLink(page, '#not-a-link');

  const second = await scrubState();
  expect(second.throws).toBe(true);
  expect(second.attempts, 'the rewrite is attempted on every boot, whatever the fragment turns out to be').toBe(1);
  expect(await addressFragment()).toBe('#not-a-link');
  expect(await surfaceOf(page)).toBe(UNAVAILABLE_UNNAMED);
  await expectNotice(page);

  await putAwayWithoutReturning(page);
  expect(await showing(page)).toEqual([]);

  // Nothing was said on any channel. The throw is swallowed where it happens and
  // is not re-raised anywhere else, and an entry point that ended on an uncaught
  // error would be in the second of these readings.
  expect(seen.errors).toEqual([]);
  expect(seen.all).toEqual([]);
});

test('reporting a link sends the identifier and nothing else', async ({ page, baseURL }) => {
  const seen = watch(page, baseURL);

  /** @type {{ method: string, type: string | undefined, body: string | null }[]} */
  const reports = [];
  await page.route(shareReportAt(baseURL), (route) => {
    const request = route.request();
    reports.push({
      method: request.method(),
      type: request.headers()['content-type'],
      body: request.postData(),
    });
    return route.fulfill({ status: 204, body: '' });
  });

  await openLink(page, fragmentFor(named));
  await page.locator('#report').click();
  await expect(page.locator('#report')).toBeDisabled();
  await expect.poll(() => reports.length).toBe(1);

  const [only] = reports;
  expect(only?.method).toBe('POST');
  expect(only?.type).toBe('application/json');
  expect(only?.body).toBe(`{"id":"${named.inputs.id}"}`);

  // Once. The control disables itself the moment it is used, so a second press
  // is not a second report.
  await page.locator('#report').click({ force: true });
  await page.waitForTimeout(150);
  expect(reports.length).toBe(1);

  expect(seen.errors).toEqual([]);
  expect(seen.all).toEqual([]);
});

test('a wrong code can be tried again, and a body that is nearly one cannot', async ({ page, baseURL }) => {
  const seen = watch(page, baseURL);

  let answered = 0;
  await page.route(shareOpenAt(baseURL), (route) => {
    answered += 1;
    return answered === 1
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"wrong_code"}' })
      : route.fulfill({ status: 200, contentType: 'application/json', body: shareBody(named) });
  });

  await openLink(page, fragmentFor(named));
  await enterCode(page);
  await expect(page.locator('#wrong-code')).toBeVisible();

  // What the page is holding on the one surface that keeps something on purpose.
  //
  // The code a recipient typed stays in the field here, and it has to: this whole
  // surface is an invitation to try again, and a field emptied under somebody who
  // mistyped one character is a viewer making them start over. So the field is
  // read for it and required to still have it — a positive, because an assertion
  // that a spelling is absent cannot tell "kept here on purpose" from "cleared
  // everywhere, including where it should not be".
  expect(await residueIn(page, [TYPED_CODE])).toEqual(['input#code-input value']);
  // And the two spellings that are nowhere on any surface. This one is reached
  // through a request and an answer refusing it, which is a path no other reading
  // of a slot in this file walks.
  expect(await residueIn(page, [named.inputs.a, fragmentFor(named)])).toEqual([]);

  // The retry is real: the control comes back, and the second answer renders.
  await expect(page.locator('#code-submit')).toBeEnabled();
  await page.locator('#code-submit').click();
  await expect(page.locator('#note')).toBeVisible();
  expect(await surfaceOf(page)).toBe(decryptedSurface(named.inputs.plaintext, named.inputs.aad));

  // And the field is empty again, on the path that reaches a note the second
  // time. The decrypted test reads this after one answer; this reads it after a
  // wrong one and then a right one, which is the sequence a recipient who
  // mistyped actually walks — and the one place where a field that was
  // deliberately left holding something has to stop holding it.
  expect(await residueIn(page, [named.inputs.a, TYPED_CODE, fragmentFor(named)])).toEqual([]);

  // And the shape that is nearly the wrong-code answer. One extra field, and it
  // is not that answer any more — it is a body this viewer does not know, which
  // collapses like everything else it does not know.
  await page.unroute(shareOpenAt(baseURL));
  await page.route(shareOpenAt(baseURL), (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"status":"wrong_code","attempts_left":2}',
    }),
  );
  await openLink(page, fragmentFor(named));
  await enterCode(page);
  await expect(page.locator('#unavailable')).toBeVisible();
  expect(await surfaceOf(page)).toBe(UNAVAILABLE);

  // The same reading a third time, on a surface a body nobody recognises ends on
  // — a second driven route to the clear the generic surface makes, reached from
  // a body that looks like the one that keeps the field rather than from a status
  // or a network failure.
  expect(await residueIn(page, [named.inputs.a, TYPED_CODE, fragmentFor(named)])).toEqual([]);

  // And the other way a code is sent, which is the field's own return key rather
  // than the control beside it. Two listeners in the renderer reach one request,
  // and this one had never been pressed by anything here — so a code sent this
  // way was a request no reading in this file had watched being made, on the one
  // request that carries what a recipient typed.
  await page.unroute(shareOpenAt(baseURL));
  await page.route(shareOpenAt(baseURL), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: shareBody(named) }),
  );
  await openLink(page, fragmentFor(named));
  await enterCodeWithTheReturnKey(page);
  await expect(page.locator('#note')).toBeVisible();
  expect(await surfaceOf(page)).toBe(decryptedSurface(named.inputs.plaintext, named.inputs.aad));
  expect(await residueIn(page, [named.inputs.a, TYPED_CODE, fragmentFor(named)])).toEqual([]);

  expect(seen.errors).toEqual([]);
  expect(seen.all).toEqual([]);
});

test('every failure the viewer can reach draws the same surface', async ({ page, baseURL }) => {
  const seen = watch(page, baseURL);

  /** @type {[string, any, (route: import('@playwright/test').Route) => unknown][]} */
  const failures = [
    ['a request that did not arrive', named, (route) => route.abort()],
    ['a status that is not a success', named, (route) => route.fulfill({ status: 500, body: '' })],
    ['a request the server refused', named, (route) => route.fulfill({ status: 400, body: '' })],
    [
      'a body that is not JSON',
      named,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{not json' }),
    ],
    [
      'a body that says the share is gone',
      named,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"unavailable"}' }),
    ],
    [
      'a share whose tag does not verify',
      named,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            b: named.inputs.b,
            wrapped_k: named.outputs.wrapped_k,
            ciphertext: `A${named.outputs.ciphertext.slice(1)}`,
            aad: named.inputs.aad,
          }),
        }),
    ],
    [
      'a share sealed for another identifier',
      mismatched,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            b: mismatched.inputs.b,
            wrapped_k: mismatched.outputs.wrapped_k,
            ciphertext: mismatched.outputs.ciphertext,
            aad: mismatched.inputs.aad,
          }),
        }),
    ],
  ];

  /** @type {string[]} */
  const surfaces = [];
  for (const [what, fixture, answer] of failures) {
    await page.unroute(shareOpenAt(baseURL));
    await page.route(shareOpenAt(baseURL), answer);
    await openLink(page, fragmentFor(fixture));
    await enterCode(page);
    await expect(page.locator('#unavailable'), what).toBeVisible();
    surfaces.push(await surfaceOf(page));
  }

  for (let index = 0; index < surfaces.length; index += 1) {
    expect(surfaces[index], `${failures[index]?.[0]} does not draw the surface every other failure draws`).toBe(
      UNAVAILABLE,
    );
  }

  // And the one difference there is, which is not about the failure at all: a
  // link that never parsed has no identifier, so there is nothing to report.
  await openLink(page, '#not-a-link');
  expect(await surfaceOf(page)).toBe(UNAVAILABLE_UNNAMED);

  expect(seen.errors).toEqual([]);
  // The console, with the browser's own lines about the request this drove to a
  // failure subtracted. A request that did not succeed is reported by the
  // browser itself, and the two engines write the same bytes for a status that
  // is not a success; they differ for one case only, a request that never
  // arrived, where one speaks from its network stack and the other from the
  // automation layer that blocked the load. Five lines come out, and each of them
  // only where it is the line this has seen and where the browser said that line
  // came from — which is not one answer for all five. Four are subtracted where
  // the browser attributed them to this request; the fifth, the one the automation
  // layer writes, arrives with no location on it at all, and it is subtracted
  // where it has none and where it names this request inside its own text.
  // Everything else stays in and fails here, whoever wrote it — a page that said
  // something, and equally a browser complaining about some other resource, which
  // is not a complaint this reading may lose.
  expect(seen.unaccounted).toEqual([]);
});

test('a decrypted note is not left on the page underneath a later surface', async ({ page, baseURL }) => {
  // The property the renderer's ordering exists for, asked of the page rather
  // than read out of the source. A surface drawn over a note that is still there
  // is a viewer that believes it has replaced something it has not, and it is
  // the failure with the worst consequence available here.
  //
  // Four legs, and all four stay inside one document, which is what makes any of
  // this a reading of the guard. A page loaded again is a fresh page: nothing is
  // underneath anything on it, so a note that survived would be gone for a
  // reason that has nothing to do with the viewer, and both halves of the
  // guarantee would pass on a viewer that has neither.
  //
  //   A. The clear runs, and it runs before anything is drawn. A note is on the
  //      page; the page is put away; the body is empty, none of the document's
  //      own words is anywhere in the page, and what is on screen is the surface
  //      a restore is meant to draw.
  //   B. The clear cannot run, and nothing is drawn over what is still there.
  //   C. The same guard on the render that draws a note.
  //   D. The same guard on the render that draws the line a code that did not
  //      match earns.
  //
  // B, C and D are the ones that separate a clear that ran from a clear that
  // emptied nothing. With the write stopped, a renderer reading the call's
  // return instead of the element's state draws straight over what is there, and
  // every assertion in leg A still passes.
  //
  // Four of the renderer's five surfaces have such a guard, and this reaches
  // three of them. The one it does not is the code-entry shell, which is drawn
  // once, at boot, before anything in the page can be replaced with a stand-in
  // that refuses — so a leg for it would be a differently built test rather than
  // a fifth paragraph here.
  //
  // Every request here succeeds, so the whole channel is read.
  const seen = watch(page, baseURL);

  await page.route(shareOpenAt(baseURL), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: shareBody(named) }),
  );

  const doc = JSON.parse(named.inputs.plaintext);
  /** Everything the document put on the page, all of which has to go. */
  const written = [doc.banner_text, doc.you_means, doc.topic, doc.visit_date, doc.sections[0].heading];

  /** @returns {Promise<string>} */
  const pageText = () =>
    page.evaluate(() => {
      const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
      return String(inPage['document'].documentElement.textContent ?? '');
    });

  // A. Clear first, then draw.
  await openLink(page, fragmentFor(named));
  await enterCode(page);
  await expect(page.locator('#note')).toBeVisible();
  expect(await page.locator('#note-body').innerHTML(), 'the note was drawn into nothing').not.toBe('');
  expect(await pageText()).toContain(doc.banner_text);

  await putAway(page);
  await expect(page.locator('#unavailable')).toBeVisible();
  expect(await page.locator('#note-body').innerHTML()).toBe('');
  const after = await pageText();
  for (const gone of written) {
    expect(after, `${gone} is still in the page under the surface that replaced it`).not.toContain(gone);
  }
  expect(await surfaceOf(page)).toBe(UNAVAILABLE_UNNAMED);

  // B. Draw nothing when the clear could not empty anything.
  await openLink(page, fragmentFor(named));
  await enterCode(page);
  await expect(page.locator('#note')).toBeVisible();
  await refuseToEmpty(page, '#note-body');

  await putAway(page);
  expect(
    await emptyingAttempts(page),
    'the viewer never asked for the body to be emptied, so nothing here was guarded',
  ).toBeGreaterThan(0);
  await expect(page.locator('#note'), 'the note was hidden although the clear emptied nothing').toBeVisible();
  await expect(
    page.locator('#unavailable'),
    'a surface was drawn over a note that is still on the page',
  ).toBeHidden();
  expect(await pageText()).toContain(doc.banner_text);
  expect(await surfaceOf(page)).toBe(decryptedSurface(named.inputs.plaintext, named.inputs.aad));

  // C. The same guard on the render that draws a note.
  const marker = 'a-marker-this-test-planted';
  await openLink(page, fragmentFor(named));
  await page.evaluate((text) => {
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
    inPage['document'].querySelector('#note-body').textContent = String(text);
  }, marker);
  await refuseToEmpty(page, '#note-body');

  await enterCode(page);
  await expect
    .poll(() => emptyingAttempts(page), {
      message: 'the renderer never asked for the body to be emptied, so nothing here was guarded',
    })
    .toBeGreaterThan(0);
  await expect(page.locator('#note'), 'a note was revealed although its body could not be emptied').toBeHidden();
  const drawn = await pageText();
  expect(drawn, 'what was in the body before the render is gone, so something wrote over it').toContain(marker);
  // All five of the document's own words, which leg A already reads for. One of
  // them is one word of a note, and a render that drew everything except the
  // banner would be a note on the page that this could not see.
  for (const word of written) {
    expect(drawn, `${word} was drawn into a body that could not be emptied`).not.toContain(word);
  }

  // D. And the same guard on the third render that has one: the line a code that
  // did not match earns. It is reached without a note ever being decrypted, so
  // what would be drawn over is whatever the body is holding, and this puts
  // something there to be drawn over.
  const other = 'a-second-marker-this-test-planted';
  await page.unroute(shareOpenAt(baseURL));
  await page.route(shareOpenAt(baseURL), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"wrong_code"}' }),
  );
  await openLink(page, fragmentFor(named));
  await page.evaluate((text) => {
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
    inPage['document'].querySelector('#note-body').textContent = String(text);
  }, other);
  await refuseToEmpty(page, '#note-body');

  await enterCode(page);
  await expect
    .poll(() => emptyingAttempts(page), {
      message: 'the wrong-code render never asked for the body to be emptied, so nothing here was guarded',
    })
    .toBeGreaterThan(0);
  await expect(
    page.locator('#wrong-code'),
    'a line was drawn although the body underneath it could not be emptied',
  ).toBeHidden();
  expect(await pageText(), 'what was in the body before the render is gone').toContain(other);

  expect(seen.errors).toEqual([]);
  expect(seen.all).toEqual([]);
});

test('a page that comes back out of the cache shows nothing it was showing', async ({ page, baseURL }) => {
  const seen = watch(page, baseURL);
  await page.route(shareOpenAt(baseURL), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: shareBody(named) }),
  );

  await openLink(page, fragmentFor(named));
  await enterCode(page);
  await expect(page.locator('#note')).toBeVisible();

  // Away and back. Whether the browser restores this page from its cache or
  // loads it again is the browser's decision, and the outcome is the same either
  // way: the fragment was scrubbed at boot, so there is nothing to resume from.
  await page.goto('/index.html?away=1');
  await page.goBack();
  await expect(page.locator('#unavailable')).toBeVisible();

  const doc = JSON.parse(named.inputs.plaintext);
  const after = await page.evaluate(() => {
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
    return String(inPage['document'].documentElement.textContent ?? '');
  });
  expect(after).not.toContain(doc.banner_text);
  expect(await surfaceOf(page)).toBe(UNAVAILABLE_UNNAMED);

  // And the event itself, dispatched while an answer is still on its way. The
  // continuation that resolves afterwards has to write nothing at all: it
  // belongs to a page that has been put away, and the note it would draw is a
  // note nobody asked for on a page nobody is looking at any more.
  const stalled = page.waitForRequest(shareOpenAt(baseURL));
  /** @type {{ go: () => void }} */
  const held = { go: () => {} };
  await page.unroute(shareOpenAt(baseURL));
  await page.route(shareOpenAt(baseURL), async (route) => {
    await new Promise((resolve) => {
      held.go = () => resolve(undefined);
    });
    return route.fulfill({ status: 200, contentType: 'application/json', body: shareBody(named) });
  });

  await openLink(page, fragmentFor(named));
  await enterCode(page);
  await stalled;

  // What a request in flight looks like, which is the same surface with the
  // control disabled and not one new word on it.
  await expect(page.locator('#code-submit')).toBeDisabled();
  expect(await surfaceOf(page)).toBe(SHELL_SENDING);

  await putAway(page);
  await expect(page.locator('#unavailable')).toBeVisible();
  expect(await surfaceOf(page)).toBe(UNAVAILABLE_UNNAMED);

  held.go();
  await page.waitForTimeout(250);
  expect(await page.locator('#note').isVisible()).toBe(false);
  expect(await surfaceOf(page)).toBe(UNAVAILABLE_UNNAMED);
  expect(await page.evaluate(() => {
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
    return String(inPage['document'].documentElement.textContent ?? '');
  })).not.toContain(doc.banner_text);

  expect(seen.errors).toEqual([]);
  expect(seen.all).toEqual([]);
});

test('putting the page away empties it, before anything can be drawn over it', async ({ page, baseURL }) => {
  // The act a browser fires as a page goes, read for what it does rather than
  // for what is on screen afterwards.
  //
  // Everything else in this file that reaches the put-away path dispatches the
  // going and the coming back together, because that is the sequence a recipient
  // walks. The trouble with reading it that way is that the coming back draws the
  // generic surface over whatever the going left, and it draws it from scratch:
  // it hides every section itself, empties the note itself, and empties the field
  // itself. So a page read after the pair looks the same whether the going did
  // all of that, some of it, or none of it. Measured, before this test was
  // written: with the going reduced to a function that resolves the page and
  // returns, every other check in this project was green.
  //
  // That was a gap worth closing rather than a curiosity, because the going is the
  // half that runs when nothing comes back. A page put away and never restored,
  // a tab closed, a device locked with the note on screen: in every one of those
  // the emptying is the only thing that happens, and nothing was asking whether it
  // happened.
  //
  // So this dispatches the going on its own and reads the page while it is the
  // only thing that has run. Two legs, because the act has two halves that no one
  // surface shows at once: a note, which is what there is to empty, and the field
  // after a code that did not match, which is the one surface that deliberately
  // still holds what a recipient typed.
  //
  // Every request here answers, so the whole channel is read.
  const seen = watch(page, baseURL);

  let answered = 0;
  await page.route(shareOpenAt(baseURL), (route) => {
    answered += 1;
    return answered === 1
      ? route.fulfill({ status: 200, contentType: 'application/json', body: shareBody(named) })
      : route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"wrong_code"}' });
  });

  const doc = JSON.parse(named.inputs.plaintext);
  /** Everything the document put on the page, all of which the going has to take. */
  const written = [doc.banner_text, doc.you_means, doc.topic, doc.visit_date, doc.sections[0].heading];

  /** @returns {Promise<string>} */
  const pageText = () =>
    page.evaluate(() => {
      const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
      return String(inPage['document'].documentElement.textContent ?? '');
    });

  // A note on the page, and then the going.
  await openLink(page, fragmentFor(named));
  await enterCode(page);
  await expect(page.locator('#note')).toBeVisible();

  // What is there to lose, asserted first, so that finding it gone afterwards is
  // a change rather than a page that never had it.
  expect(await page.locator('#note-body').innerHTML(), 'the note was drawn into nothing').not.toBe('');
  expect(await showing(page)).toEqual(['note', 'footer']);
  const before = await pageText();
  for (const there of written) {
    expect(before, `${there} was never on the page, so losing it says nothing`).toContain(there);
  }

  await putAwayWithoutReturning(page);

  // The body is empty, every line around it is blank, every section is off, and
  // none of the document's own words is anywhere in the page. Nothing has been
  // drawn: what is on screen is a page with nothing on it, which is the state
  // this act is for and a state no render in this viewer produces.
  expect(await page.locator('#note-body').innerHTML()).toBe('');
  expect(await showing(page)).toEqual([]);
  const after = await pageText();
  for (const gone of written) {
    expect(after, `${gone} is still in the page after it was put away`).not.toContain(gone);
  }
  expect(await residueIn(page, [named.inputs.a, TYPED_CODE, fragmentFor(named)])).toEqual([]);

  // And the other half, on the surface that keeps something on purpose. A code
  // that did not match leaves what was typed in the field, deliberately, so the
  // field is the one slot where the going has something of a recipient's to take
  // and the reading is not satisfied by a page that was already empty.
  await openLink(page, fragmentFor(named));
  await enterCode(page);
  await expect(page.locator('#wrong-code')).toBeVisible();
  expect(await residueIn(page, [TYPED_CODE])).toEqual(['input#code-input value']);
  expect(await showing(page)).toEqual(['shell', 'wrong-code', 'footer']);

  await putAwayWithoutReturning(page);

  expect(await residueIn(page, [TYPED_CODE])).toEqual([]);
  expect(await showing(page)).toEqual([]);

  expect(seen.errors).toEqual([]);
  expect(seen.all).toEqual([]);
});

test('every text on every surface reaches the contrast it has to', async ({ page, baseURL }) => {
  const seen = watch(page, baseURL);
  await page.route(shareOpenAt(baseURL), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: shareBody(named) }),
  );

  /**
   * Contrast, computed from what the browser resolved.
   *
   * The ratio is the one the guidelines define, over the colour of the text and
   * the first opaque background behind it. Large text is allowed the lower
   * threshold, which is what the size and weight are read for.
   *
   * An element with no box is passed over, because there is no contrast between
   * a colour and a background nobody can see — but that exemption used to apply
   * to every element in the page, and applied to the wrong ones it is the reading
   * agreeing with a page that shows nothing. An element that is REQUIRED to be on
   * screen and has no box is a failure of this rather than a skip: the ids below
   * are the ones every one of these surfaces carries, and each of them is asked
   * for a box whether or not the walk reached it. A collapsed notice is exactly
   * the shape this had no opinion about.
   *
   * The colour is composited onto that background before the ratio is taken,
   * rather than being read as though it were opaque. A resolved colour has four
   * channels and the ratio is over three of them, so text written in
   * `transparent` arrives here as rgba(0, 0, 0, 0) and used to be measured as
   * black — 21 against a white background, the best score the scale has, for
   * text with nothing of it drawn. Compositing is what the fourth channel means:
   * at an alpha of 1 it returns the colour unchanged, and at 0 it returns the
   * background, which is a ratio of 1 and a failure.
   *
   * What this still does not read is whether the elements it measured were
   * anywhere a recipient could see them. That is asked separately, of the same
   * required ids, by `imperceptible` at the top of this file.
   */
  const onScreen = ['brand', ...NOTICE_ON_SCREEN];

  const measure = async () => {
    const contrast = await page.evaluate((required) => {
      const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
      /** @param {string} colour */
      const parse = (colour) => {
        const found = colour.match(/rgba?\(([^)]+)\)/);
        if (found === null) {
          return null;
        }
        const parts = (found[1] ?? '').split(',').map((one) => Number.parseFloat(one.trim()));
        return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts.length > 3 ? (parts[3] ?? 1) : 1 };
      };
      /** @param {number} value */
      const channel = (value) => {
        const scaled = value / 255;
        return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
      };
      /** @param {{ r: number, g: number, b: number }} colour */
      const luminance = (colour) => 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
      /**
       * A colour laid over what is behind it, which at an alpha of 1 is the
       * colour and at an alpha of 0 is what was behind it.
       *
       * @param {{ r: number, g: number, b: number, a: number }} over
       * @param {{ r: number, g: number, b: number }} under
       */
      const composite = (over, under) => ({
        r: over.r * over.a + under.r * (1 - over.a),
        g: over.g * over.a + under.g * (1 - over.a),
        b: over.b * over.a + under.b * (1 - over.a),
      });
      /** @param {any} element */
      const behind = (element) => {
        /** @type {any} */
        let node = element;
        while (node !== null && node !== undefined) {
          const found = parse(String(inPage['getComputedStyle'](node).backgroundColor));
          if (found !== null && found.a === 1) {
            return found;
          }
          node = node.parentElement;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
      };

      // The brand line and every span the collection notice is written into.
      // Each of them is on each of the surfaces this test drives, and each is
      // opened before the reading is taken, so an element here with no box is a
      // page that is not showing something it has to. The list is handed in from
      // outside so that this and the reading of whether these same elements can
      // be seen at all are asking about one set of elements rather than two.
      const onScreen = new Set(required);
      /** @type {Set<string>} */
      const asked = new Set();

      /** @type {string[]} */
      const failures = [];
      for (const element of inPage['document'].querySelectorAll('*')) {
        const carries = Array.from(element.childNodes).some(
          (node) => node.nodeType === 3 && (node.textContent ?? '').trim().length > 0,
        );
        if (!carries) {
          continue;
        }
        const box = element.getBoundingClientRect();
        const id = String(element.id ?? '');
        if (onScreen.has(id)) {
          asked.add(id);
        }
        if (box.width === 0 || box.height === 0) {
          if (onScreen.has(id)) {
            failures.push(`${id}: has no box, and it is one of the things this page has to be showing`);
          }
          continue;
        }
        const style = inPage['getComputedStyle'](element);
        const colour = parse(String(style.color));
        if (colour === null) {
          continue;
        }
        const under = behind(element);
        const one = luminance(composite(colour, under));
        const other = luminance(under);
        const ratio = (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05);
        const size = Number.parseFloat(style.fontSize);
        const weight = Number.parseInt(style.fontWeight, 10) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const needed = large ? 3 : 4.5;
        if (ratio + 1e-9 < needed) {
          failures.push(`${element.id || element.tagName}: ${ratio.toFixed(2)} against ${needed}`);
        }
      }

      // And the ones the walk above never reached, which is not the same set as
      // the ones it passed over. It only looks at an element holding text of its
      // own, so a container whose children carry all of it — the paragraph the
      // notice is written into — is never examined at all, and that paragraph is
      // exactly what a declaration hiding the notice would be written against.
      for (const id of onScreen) {
        if (asked.has(id)) {
          continue;
        }
        const element = inPage['document'].getElementById(id);
        if (element === null) {
          failures.push(`${id}: is not in the page, and this page has to be showing it`);
          continue;
        }
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) {
          failures.push(`${id}: has no box, and it is one of the things this page has to be showing`);
        }
      }

      return failures;
    }, onScreen);

    // Two readings of the same required elements, reported together: what
    // colour they were drawn in, and whether they were drawn anywhere a
    // recipient could see them. Neither answers the other's question, and a
    // surface has to clear both.
    return contrast.concat(await imperceptible(page, onScreen));
  };

  await openLink(page, fragmentFor(named));
  await openTheNotice(page);
  expect(await measure(), 'the shell').toEqual([]);

  // And a decrypted note, which is the surface with the most on it.
  //
  // What is not read here is the submit control while a request is in flight. By
  // the time a note is on screen the shell is hidden, so that control has no box
  // and the reading above skips it — this used to say it was being measured.
  // Reading it would mean holding a request open while the measurement runs,
  // which is not what this drives.
  await page.locator('#code-input').fill(TYPED_CODE);
  await page.locator('#code-submit').click();
  await expect(page.locator('#note')).toBeVisible();
  await openTheNotice(page);
  expect(await measure(), 'a decrypted note').toEqual([]);

  await page.unroute(shareOpenAt(baseURL));
  await page.route(shareOpenAt(baseURL), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"wrong_code"}' }),
  );
  await openLink(page, fragmentFor(named));
  await enterCode(page);
  await expect(page.locator('#wrong-code')).toBeVisible();
  await openTheNotice(page);
  expect(await measure(), 'a code that did not match').toEqual([]);

  await openLink(page, '#not-a-link');
  await openTheNotice(page);
  expect(await measure(), 'the unavailable surface').toEqual([]);

  expect(seen.errors).toEqual([]);
  expect(seen.all).toEqual([]);
});

test('the page reflows at a narrow width and at twice the text size', async ({ page, baseURL }) => {
  const seen = watch(page, baseURL);
  await page.route(shareOpenAt(baseURL), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: shareBody(named) }),
  );

  const overflows = () =>
    page.evaluate(() => {
      const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
      const root = inPage['document'].documentElement;
      return Number(root.scrollWidth) - Number(root.clientWidth);
    });

  // The width the reflow requirement names, on the surface with the most in it.
  await page.setViewportSize({ width: 320, height: 640 });
  await openLink(page, fragmentFor(named));
  expect(await overflows(), 'the shell scrolls sideways at 320px').toBeLessThanOrEqual(0);
  await expect(page.locator('#code-input')).toBeVisible();
  await expect(page.locator('#code-submit')).toBeVisible();
  await expect(page.locator('#report')).toBeVisible();

  await enterCode(page);
  await expect(page.locator('#note')).toBeVisible();
  expect(await overflows(), 'a decrypted note scrolls sideways at 320px').toBeLessThanOrEqual(0);

  // And twice the text size, which is the other half of the same requirement.
  // Everything in the stylesheet is sized in relative units, so this is what
  // doubling the reader's text size does to the page.
  await page.setViewportSize({ width: 640, height: 512 });
  await page.evaluate(() => {
    const inPage = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
    inPage['document'].documentElement.style.fontSize = '200%';
  });
  expect(await overflows(), 'a decrypted note scrolls sideways at twice the text size').toBeLessThanOrEqual(0);
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#app-link')).toBeVisible();

  expect(seen.errors).toEqual([]);
  expect(seen.all).toEqual([]);
});

test('the expiry is the moment it was sealed with, spelled the one way', async ({ page, baseURL }) => {
  // The wired path for the formatter, under a timezone this file pins. The
  // formatter itself is put to a table of fixed moments in the fast suite; what
  // this adds is that the string on the page is the one it produces, for a share
  // that came through the whole flow.
  const seen = watch(page, baseURL);
  await page.route(shareOpenAt(baseURL), (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: shareBody(named) }),
  );

  await openLink(page, fragmentFor(named));
  await enterCode(page);
  await expect(page.locator('#note')).toBeVisible();

  const aad = JSON.parse(named.inputs.aad);
  expect(await page.locator('#expiry').textContent()).toBe(`This link works until ${expiryText(aad.exp)}`);
  expect(await page.locator('#expiry').textContent()).toMatch(
    /^This link works until (?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec), \d{1,2}:\d{2} (?:am|pm)$/,
  );

  expect(seen.errors).toEqual([]);
  expect(seen.all).toEqual([]);
});
