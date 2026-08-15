import { expect, test } from '@playwright/test';

import { checkCookieJar, checkHeaderAllowlist, checkNoRequestCookie } from '../scripts/release-check-core/headers.mjs';
import { startFixtureOrigin } from './release-fixtures/origin.mjs';

/**
 * The half of the release check that needs a browser.
 *
 * Most of what a release check asks can be asked of a socket, and everything
 * that can be is — a raw client sees more than an engine will tell you, and it
 * sees it the same way twice. Three things cannot be asked that way, and they
 * are here.
 *
 * The first is what a browsing context is left holding. A response that sets no
 * cookie and a request that carries none are two readings of the wire; whether
 * anything is in the jar afterwards is a reading of the browser, and a page can
 * put something there without either wire reading changing.
 *
 * The second is that the first is not vacuous. A jar assertion that has only
 * ever been run against a page which sets nothing is an assertion nobody has
 * seen fire, so one fixture sets a cookie in a response and one seeds the
 * context before navigation, and each must redden its own half.
 *
 * The third is a measurement rather than an assertion, and the difference is
 * deliberate. A destination named in a `Link` response header is fetched before
 * the parser has read a byte of the document, so whether the page's own policy
 * reaches it is a question about engines. It is measured here, in both, across
 * three preload destinations and two policy arms, and the result is recorded —
 * in this file's output and in `RELEASE-CHECK.md` — as what was observed on the
 * versions it was observed on. Nothing in this repository is allowed to depend
 * on the answer: the check refuses a `Link` header on the entry point outright,
 * which is an assertion that needs no engine to hold.
 *
 * Both engines run all of it, because a measurement in one engine is not a
 * measurement.
 *
 * Serial, because each test binds a fixed port. The two engines run at the same
 * time and never on the same port — the table below has an entry per engine —
 * and within an engine the tests run one after another.
 */
test.describe.configure({ mode: 'serial' });

/**
 * The port the cookie fixtures bind, per engine.
 *
 * One number per engine rather than one shared number: the engines run
 * concurrently, and two servers on one port is a race whose loser reports
 * whatever the winner served.
 *
 * @type {Readonly<Record<string, number>>}
 */
const COOKIE_PORTS = Object.freeze({ chromium: 8615, webkit: 8616 });

/**
 * The port the preload measurement binds, per engine.
 *
 * @type {Readonly<Record<string, number>>}
 */
const PRELOAD_PORTS = Object.freeze({ chromium: 8611, webkit: 8612 });

/**
 * How long to leave a page alone after it has loaded, before reading what it
 * asked for.
 *
 * A preload is a fetch the engine may start at its own pace, and reading the
 * request log the instant `load` fires is reading it before the answer exists.
 * This is a settle, not a timeout: nothing fails because of it, and a
 * measurement that needed longer would show as a destination not fetched in
 * both arms, which is the inconclusive reading rather than a false one.
 */
const SETTLE_MS = 500;

/**
 * The policy the deployed origin serves, for an origin allowed to talk to
 * itself.
 *
 * Written out here rather than imported from the core, for the same reason the
 * fixture deployment writes it out: the arm this appears in is the arm where the
 * policy is present, and a policy taken from the checker would still be present
 * after the checker stopped requiring anything.
 *
 * @param {string} origin
 * @returns {string}
 */
function policyFor(origin) {
  return (
    "default-src 'none'; script-src 'self'; style-src 'self'; " +
    `connect-src ${origin}; ` +
    "img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; " +
    "require-trusted-types-for 'script'"
  );
}

/**
 * Which port this engine uses from a table.
 *
 * @param {Readonly<Record<string, number>>} table
 * @param {string} engine
 * @returns {number}
 */
function portFor(table, engine) {
  const port = table[engine];
  if (port === undefined) {
    throw new Error(`no fixture port is written down for ${engine}`);
  }
  return port;
}

/**
 * A recorded request, as one of the observations the core predicates read.
 *
 * The core judges observations, and what a browser sent is an observation like
 * any other — so the request the fixture origin recorded is put into that shape
 * and handed to the same predicate the socket client's captures go through.
 * Reimplementing the reading here would be a second implementation of a rule
 * that has one.
 *
 * @param {import('./release-fixtures/origin.mjs').FixtureRequest} request
 * @returns {import('../scripts/release-check-core/observation.mjs').Observation}
 */
function asObservation(request) {
  return {
    arm: 'browser',
    method: request.method,
    path: request.path,
    hasQuery: request.hasQuery,
    query: request.query,
    requestHeaders: request.headers,
    status: 200,
    headers: [],
    interim: [],
    raw: null,
    decoded: null,
    decodeFailure: null,
    captureFailures: [],
  };
}

/**
 * A response, as one of those observations, for the field readings.
 *
 * @param {number} status
 * @param {readonly (readonly [string, string])[]} headers
 * @returns {import('../scripts/release-check-core/observation.mjs').Observation}
 */
function asResponseObservation(status, headers) {
  return {
    arm: 'browser',
    method: 'GET',
    path: '/',
    hasQuery: false,
    query: '',
    requestHeaders: [],
    status,
    headers: headers.map(([name, value]) => ({ name: name.toLowerCase(), value })),
    interim: [],
    raw: null,
    decoded: null,
    decodeFailure: null,
    captureFailures: [],
  };
}

/**
 * A page that loads one first-party module and nothing else.
 *
 * @param {boolean} setsCookie
 * @returns {(request: import('./release-fixtures/origin.mjs').FixtureRequest) => import('./release-fixtures/origin.mjs').FixtureResponse}
 */
function cookieRoute(setsCookie) {
  const document = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8" /><title>Shared note</title>',
    '<script type="module" src="/thing.js"></script>',
    '</head><body><main></main></body></html>',
    '',
  ].join('\n');

  return (request) => {
    /** @type {[string, string][]} */
    const fields = [['cache-control', 'no-store']];
    if (setsCookie) {
      fields.push(['set-cookie', 'seen=1; Path=/']);
    }
    if (request.path === '/thing.js') {
      return {
        status: 200,
        reason: 'OK',
        headers: [...fields, ['content-type', 'text/javascript']],
        body: new TextEncoder().encode("export const nothing = '';\n"),
      };
    }
    return {
      status: 200,
      reason: 'OK',
      headers: [...fields, ['content-type', 'text/html; charset=utf-8']],
      body: new TextEncoder().encode(document),
    };
  };
}

test('a page that sets nothing leaves nothing, and both halves of that are shown to fire', async ({ browser }, testInfo) => {
  const port = portFor(COOKIE_PORTS, testInfo.project.name);

  // The sound arm. Nothing is set, nothing is sent, nothing is left.
  {
    const origin = await startFixtureOrigin({ port, route: cookieRoute(false) });
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
      await page.waitForTimeout(SETTLE_MS);

      const requests = origin.received();
      expect(requests.length, 'the page was never loaded').toBeGreaterThanOrEqual(2);
      for (const request of requests) {
        expect(checkNoRequestCookie(asObservation(request)), `${request.target} carried a cookie`).toEqual([]);
      }
      expect(checkCookieJar((await context.cookies()).length, 'the sound arm')).toEqual([]);
    } finally {
      await context.close();
      await origin.close();
    }
  }

  // The response half of the vacuity control. An origin that sets a cookie must
  // redden the response reading and must leave the jar non-empty — the second is
  // what shows the jar reading is asking the browser rather than repeating the
  // first.
  {
    const origin = await startFixtureOrigin({ port, route: cookieRoute(true) });
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
      await page.waitForTimeout(SETTLE_MS);

      const refused = checkHeaderAllowlist(
        asResponseObservation(200, [
          ['cache-control', 'no-store'],
          ['set-cookie', 'seen=1; Path=/'],
        ]),
      );
      expect(refused.map((one) => one.predicate)).toEqual(['set-cookie']);

      const jar = await context.cookies();
      expect(jar.length, 'the engine did not accept the cookie, so this control shows nothing').toBeGreaterThan(0);
      expect(checkCookieJar(jar.length, 'the response-sets-a-cookie control').map((one) => one.predicate)).toEqual([
        'cookie-jar',
      ]);
    } finally {
      await context.close();
      await origin.close();
    }
  }

  // The request half. A context seeded before navigation sends what it holds,
  // and the predicate that says a viewer sends none has to see it.
  {
    const origin = await startFixtureOrigin({ port, route: cookieRoute(false) });
    const context = await browser.newContext();
    try {
      await context.addCookies([{ name: 'seeded', value: '1', url: `http://127.0.0.1:${port}/` }]);
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
      await page.waitForTimeout(SETTLE_MS);

      const carrying = origin
        .received()
        .map((request) => checkNoRequestCookie(asObservation(request)))
        .filter((refusals) => refusals.length > 0);
      expect(carrying.length, 'a seeded context sent no cookie, so this control shows nothing').toBeGreaterThan(0);
      expect(carrying[0]?.map((one) => one.predicate)).toEqual(['cookie-request-header']);
    } finally {
      await context.close();
      await origin.close();
    }
  }
});

/**
 * The three destinations, and what each one is admitted by.
 *
 * `script` and `image` are named by directives of their own in the policy, and
 * both of those directives admit the origin's own resources. `font` is named by
 * no directive, so it falls to `default-src`, and `default-src` is `'none'` —
 * which makes it the cell worth measuring and the other two the controls that
 * say the measurement is about the policy rather than about preloading.
 *
 * @type {readonly { as: string, path: string, type: string, extra: string }[]}
 */
const DESTINATIONS = Object.freeze([
  { as: 'script', path: 'hint.js', type: 'text/javascript', extra: '' },
  { as: 'image', path: 'hint.png', type: 'image/png', extra: '' },
  // A font preload is a CORS-mode fetch and engines want the attribute that says
  // so. Written here so the arm is given every chance to fetch: a destination
  // that never fetches for a reason that is not the policy is a cell that
  // measures nothing.
  { as: 'font', path: 'hint.woff2', type: 'font/woff2', extra: '; crossorigin' },
]);

/**
 * The two policy arms.
 *
 * The arm without a policy is the counterfactual, and it is what makes the other
 * arm readable. A hinted fetch that does not happen under a policy tells you
 * nothing on its own — it could be the policy, or it could be that the hint was
 * never going to be followed. Measuring both is what separates those.
 *
 * @type {readonly { name: string, policy: boolean }[]}
 */
const POLICY_ARMS = Object.freeze([
  { name: 'policy present', policy: true },
  { name: 'policy absent', policy: false },
]);

test('what each engine does with a fetch a response header started, measured in both arms', async ({ browser }, testInfo) => {
  const engine = testInfo.project.name;
  const port = portFor(PRELOAD_PORTS, engine);
  const origin = `http://127.0.0.1:${port}`;

  /** @type {{ engine: string, as: string, arm: string, hinted: boolean }[]} */
  const matrix = [];

  const server = await startFixtureOrigin({
    port,
    route: (request) => {
      const hinted = DESTINATIONS.find((one) => request.path.endsWith(one.path));
      if (hinted !== undefined) {
        return {
          status: 200,
          reason: 'OK',
          headers: [
            ['cache-control', 'no-store'],
            ['content-type', hinted.type],
            ['access-control-allow-origin', '*'],
          ],
          body: new Uint8Array([0]),
        };
      }
      const cell = DESTINATIONS.find((one) => request.path.includes(`-${one.as}-`));
      const withPolicy = request.path.includes('-with-');
      /** @type {[string, string][]} */
      const fields = [
        ['cache-control', 'no-store'],
        ['content-type', 'text/html; charset=utf-8'],
      ];
      if (cell !== undefined) {
        fields.push(['link', `</${request.path.slice(1)}--${cell.path}>; rel=preload; as=${cell.as}${cell.extra}`]);
      }
      if (withPolicy) {
        fields.push(['content-security-policy', policyFor(origin)]);
      }
      return {
        status: 200,
        reason: 'OK',
        headers: fields,
        // A document that names nothing. Every fetch the engine makes beyond
        // this document is a fetch the response header started.
        body: new TextEncoder().encode(
          '<!doctype html>\n<html lang="en"><head><meta charset="utf-8" /><title>m</title></head><body></body></html>\n',
        ),
      };
    },
  });

  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    for (const destination of DESTINATIONS) {
      for (const arm of POLICY_ARMS) {
        const cell = `/cell-${destination.as}-${arm.policy ? 'with' : 'without'}-${Date.now()}`;
        const before = server.received().length;
        await page.goto(`${origin}${cell}`, { waitUntil: 'load' });
        await page.waitForTimeout(SETTLE_MS);
        const after = server.received().slice(before);
        matrix.push({
          engine,
          as: destination.as,
          arm: arm.name,
          hinted: after.some((request) => request.path.endsWith(destination.path)),
        });
      }
    }
  } finally {
    await context.close();
    await server.close();
  }

  // Recorded, not asserted. What an engine does with a hint is a fact about that
  // engine on that version, and turning it into a requirement here would be this
  // repository depending on it — which is exactly what the design says nothing
  // may do.
  const lines = matrix.map((cell) => `  ${cell.engine} · as=${cell.as} · ${cell.arm} · hinted fetch issued: ${cell.hinted}`);
  const record = `preload-initiation matrix (${engine}, ${browser.version()}):\n${lines.join('\n')}`;
  process.stdout.write(`${record}\n`);
  await testInfo.attach('preload-initiation-matrix', { body: record, contentType: 'text/plain' });

  // The only thing asserted is that the measurement was made: six cells, one per
  // destination per arm. A run that measured fewer has not measured the thing
  // this test is named for.
  expect(matrix.length).toBe(DESTINATIONS.length * POLICY_ARMS.length);
  expect(new Set(matrix.map((cell) => `${cell.as}/${cell.arm}`)).size).toBe(DESTINATIONS.length * POLICY_ARMS.length);
});
