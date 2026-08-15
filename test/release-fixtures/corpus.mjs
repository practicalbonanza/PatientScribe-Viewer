/**
 * One fixture per branch of what the release check is required to decide.
 *
 * The coverage rule this corpus is written against is anchored to the
 * requirements, not to the implementation: every branch of the response
 * classification and of the request matrix has a fixture that exercises it, and
 * a branch with no fixture is a gap in the corpus rather than a branch that did
 * not need one. Written the other way round — a fixture per branch of the code —
 * the corpus would agree with whatever the code did, including after a branch
 * quietly stopped refusing anything.
 *
 * Every entry carries the branch it is for in its own words, so the table in a
 * report is read off the corpus rather than assembled beside it.
 *
 * Each fixture is judged on the set of predicates its run produced, and judged
 * exactly: the predicates it names must all appear and nothing else may. A
 * fixture asserted only on "something refused" is a fixture that keeps passing
 * after the refusal it was written for is replaced by a different one, and a
 * fixture asserted only on "the predicate appeared" is a fixture that keeps
 * passing after the origin it describes has grown a second defect. Both of those
 * are how a corpus stops being evidence.
 *
 * And each runs alone. One origin, one manifest, one listing, started and
 * stopped around it. A fixture whose redness could have been left over from the
 * one before it is not a fixture.
 */

import { sha256Hex } from '../../scripts/release-check-core/digest.mjs';
import { PREDICATES } from '../../scripts/release-check-core/verdict.mjs';
import { buildDeployment, FIXTURE_RELEASE_ID, IMMUTABLE, NO_STORE, withEntryDocument, withRetainedRelease } from './deployment.mjs';
import {
  answeringConditionalWith,
  asChunked,
  conformantRoute,
  encode,
  encodeStored,
  followedBy,
  renamingField,
  replacingBody,
  replacingField,
  withField,
  withoutField,
  withTransform,
} from './routes.mjs';

/**
 * What a fixture hands the runner, over and above the conformant deployment.
 *
 * @typedef {object} Scenario
 * @property {import('./deployment.mjs').Deployment} deployment
 * @property {(request: import('./origin.mjs').FixtureRequest) => import('./origin.mjs').FixtureResponse} route
 * @property {string} manifestText
 * @property {string | null} inventoryText `null` means the run was given no
 *   listing, which is a failure rather than a smaller check.
 * @property {readonly string[]} unionManifestTexts The retained releases'
 *   manifests, as documents. Read by the runner the way the command line reads
 *   what `--union` names, so that the allowlist a fixture drives is built by the
 *   code a deploy builds it with.
 * @property {Uint8Array | null} localConfigBytes
 * @property {string} origin The origin key the table is asked about.
 */

/**
 * One fixture.
 *
 * @typedef {object} Fixture
 * @property {string} name
 * @property {string} branch The requirement this fixture is about, in the words
 *   it is written in.
 * @property {readonly string[]} expect Exactly the predicates this fixture's run
 *   must produce. Empty means the run must produce none at all.
 * @property {(origin: string) => Scenario} build
 * @property {boolean} [https] Whether this fixture is served over TLS. Read
 *   before the scenario is built, because which origin the deployment is built
 *   for depends on it.
 */

/** @param {string} text */
const bytes = (text) => new TextEncoder().encode(text);

/**
 * A manifest document with its parsed form changed.
 *
 * @param {string} manifestText
 * @param {(manifest: any) => void} mutate
 * @returns {string}
 */
function manifestWith(manifestText, mutate) {
  const manifest = JSON.parse(manifestText);
  mutate(manifest);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * An inventory document with its list changed.
 *
 * @param {string} inventoryText
 * @param {(paths: string[]) => string[]} mutate
 * @returns {string}
 */
function inventoryWith(inventoryText, mutate) {
  const inventory = JSON.parse(inventoryText);
  inventory.paths = mutate(inventory.paths);
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

/**
 * The scenario every fixture starts from.
 *
 * @param {string} origin
 * @param {import('./deployment.mjs').Deployment} [deployment]
 * @returns {Scenario}
 */
function baseline(origin, deployment = buildDeployment(origin)) {
  return {
    deployment,
    route: conformantRoute(deployment),
    manifestText: deployment.manifestText,
    inventoryText: deployment.inventoryText,
    unionManifestTexts: deployment.unionManifestTexts,
    localConfigBytes: deployment.configBytes,
    origin,
  };
}

/**
 * A digest with one character changed to another hex character.
 *
 * @param {string} digest
 * @returns {string}
 */
function mangle(digest) {
  const first = digest[0] === '0' ? '1' : '0';
  return `${first}${digest.slice(1)}`;
}

/**
 * Bytes that are not any object this deployment serves, and are plausible.
 *
 * Plausible on purpose: a body of noise is caught by anything, and what these
 * fixtures are about is an origin serving something that looks like the release
 * and is not it. This is a module that would run.
 */
const PLAUSIBLE_BUT_WRONG = bytes("export const greeting = 'a note is shown and nothing is kept.';\n");

/**
 * A document that is a document and is not the one the manifest names.
 */
const PLAUSIBLE_BUT_WRONG_DOCUMENT = bytes(
  ['<!doctype html>', '<html lang="en">', '  <head><meta charset="utf-8" /><title>Shared note</title></head>', '  <body><main></main></body>', '</html>', ''].join('\n'),
);

/**
 * The same object as a representation no arm of the matrix asking for one was
 * served: a gzip stream that stores rather than compresses.
 *
 * It decodes to exactly the object's bytes, so an origin answering with it is
 * answering with the release; what it is for is the number of octets it takes on
 * the wire, which has to be a number no representation arm saw or the fixtures
 * below prove nothing. That it is such a number is checked here rather than
 * assumed: a fixture whose one distinguishing value quietly collided with
 * another would pass while showing nothing, which is the way a corpus stops
 * being evidence.
 *
 * @param {import('./deployment.mjs').ServedObject} object
 * @returns {Uint8Array}
 */
function storedRepresentation(object) {
  const stored = encodeStored(object.bytes);
  const served = ['identity', 'gzip', 'br'].map((coding) => encode(object.bytes, /** @type {'identity' | 'gzip' | 'br'} */ (coding)).length);
  if (served.includes(stored.length)) {
    throw new Error(
      `the stored representation of ${object.path} is ${stored.length} octet(s), which is a length an encoding arm is served — a fixture resting on it would prove nothing`,
    );
  }
  return stored;
}

/**
 * The scenario where one query-carrying arm is answered with the stored
 * representation, and the path's `304` claims that length.
 *
 * The two fixtures built from this differ in one thing — which of the two
 * query-carrying arms is answered that way — because the exclusion they are
 * about has two halves and a fixture for one is not evidence about the other.
 * Everything else is held identical on purpose: the response decodes to the
 * object, carries the classification the arm requires, and differs from a
 * conformant one only in how many octets it took on the wire.
 *
 * @param {string} origin
 * @param {(request: import('./origin.mjs').FixtureRequest) => boolean} onArm Which
 *   query-carrying request is answered with the stored representation.
 * @returns {Scenario}
 */
function claimingAStoredLength(origin, onArm) {
  const scenario = baseline(origin);
  // The path both query arms are issued against: the first one under /assets/,
  // in the order the matrix asks them.
  const probed = Object.keys(JSON.parse(scenario.manifestText).objects)
    .sort()
    .find((path) => path.startsWith('/assets/'));
  const object = scenario.deployment.objects.find((one) => one.path === probed);
  if (object === undefined) {
    throw new Error('this deployment serves no object under /assets/, and both query arms are asked about one');
  }
  const stored = storedRepresentation(object);
  return {
    ...scenario,
    route: withTransform(scenario.route, (response, request) => {
      if (request.path !== probed) {
        return response;
      }
      if (request.hasQuery && onArm(request)) {
        return withField(replacingBody(response, stored), 'content-encoding', 'gzip');
      }
      return response.status === 304 ? replacingField(response, 'content-length', String(stored.length)) : response;
    }),
  };
}

/**
 * A path under the asset behaviour that the allowlist cannot carry.
 *
 * Under `/assets/` and not the grammar an object there must have — sixty-five
 * characters where sixty-four hex ones are required — so the allowlist does not
 * carry it however the manifest is written, which is the only way this matrix
 * can ask a query-carrying request about a path that is not allowlisted: the one
 * request with something in its query is issued against the first path under
 * `/assets/`, and every path a manifest names is in the union. Sixty-three
 * zeroes put it first in that order.
 */
const MISNAMED_ASSET = `/assets/${'0'.repeat(63)}zz.js`;

/**
 * The deployment with an object served at that path.
 *
 * Everything else about it is ordinary: the bytes are the digest the manifest
 * records, the listing names it, and it answers every arm the matrix asks. It is
 * marked as not under the asset behaviour so that the conformant route says
 * `no-store` for it everywhere — which is what the classification requires of a
 * path the allowlist does not carry, and what leaves the one response a fixture
 * bends the only thing wrong with the origin.
 *
 * @param {string} origin
 * @returns {Scenario}
 */
function withAPathTheAllowlistCannotCarry(origin) {
  const deployment = buildDeployment(origin);
  const source = '// An object whose name is not the grammar the asset behaviour serves.\n';
  /** @type {import('./deployment.mjs').ServedObject} */
  const object = {
    path: MISNAMED_ASSET,
    bytes: bytes(source),
    contentType: 'text/javascript',
    asset: false,
    etag: '"misnamed"',
  };
  const objects = [...deployment.objects, object];
  const assetPaths = objects
    .map((one) => one.path)
    .filter((path) => path.startsWith('/assets/'))
    .sort();
  if (assetPaths[0] !== MISNAMED_ASSET) {
    throw new Error(
      `the query probe is issued against ${assetPaths[0]}, and this fixture is about the one issued against ${MISNAMED_ASSET}`,
    );
  }
  return baseline(origin, {
    ...deployment,
    objects,
    manifestText: manifestWith(deployment.manifestText, (manifest) => {
      manifest.objects[MISNAMED_ASSET] = sha256Hex(object.bytes);
    }),
    inventoryText: inventoryWith(deployment.inventoryText, (paths) => [...paths, MISNAMED_ASSET]),
  });
}

/**
 * The retained release's module, for the fixtures about the union.
 */
const RETAINED_SOURCE = "// An older release still ships this.\nexport const kept = 'still here';\n";

/**
 * The scenario a retained release's object is served from.
 *
 * @param {string} origin
 * @returns {{ scenario: Scenario, retainedPath: string }}
 */
function retained(origin) {
  const deployment = withRetainedRelease(buildDeployment(origin), RETAINED_SOURCE);
  return { scenario: baseline(origin, deployment), retainedPath: deployment.retainedPath };
}

/**
 * The whole corpus.
 *
 * @type {readonly Fixture[]}
 */
export const FIXTURES = Object.freeze([
  {
    name: 'conformant deployment over http',
    branch: 'one fully conformant simulated deployment: both aliases, gzip and brotli among its objects, passes everything',
    expect: [],
    build: (origin) => baseline(origin),
  },
  {
    name: 'conformant deployment over https',
    branch: 'the capture client supports http and https, with certificate verification on; at least one https fixture',
    expect: [],
    https: true,
    build: (origin) => baseline(origin),
  },

  {
    name: 'a §6.1 header is missing',
    branch: 'the other §6.1 headers, exact expected strings — Referrer-Policy: no-referrer',
    expect: [PREDICATES.POLICY_HEADER],
    build: (origin) => {
      const scenario = baseline(origin);
      return { ...scenario, route: withTransform(scenario.route, (response) => withoutField(response, 'referrer-policy')) };
    },
  },
  {
    name: 'the policy is one directive off',
    branch: "the CSP the deployed origin must serve as a response header — img-src 'self'",
    expect: [PREDICATES.CSP_VALUE],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response) =>
          replacingField(
            response,
            'content-security-policy',
            (response.headers.find(([name]) => name === 'content-security-policy')?.[1] ?? '').replace("img-src 'self'", 'img-src *'),
          ),
        ),
      };
    },
  },
  {
    name: 'the policy names an origin the table does not',
    branch: 'connect-src <api-origin>, derived from the config table whose bytes the manifest binds',
    expect: [PREDICATES.CSP_VALUE],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response) =>
          replacingField(
            response,
            'content-security-policy',
            (response.headers.find(([name]) => name === 'content-security-policy')?.[1] ?? '').replace(
              `connect-src ${origin}`,
              'connect-src https://somewhere-else.example',
            ),
          ),
        ),
      };
    },
  },
  {
    name: 'the policy is carried in two header fields',
    branch: 'the CSP is carried in exactly one Content-Security-Policy header field; zero or multiple are each a FAIL',
    expect: [PREDICATES.CSP_FIELD_COUNT],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response) =>
          withField(response, 'content-security-policy', "default-src 'none'"),
        ),
      };
    },
  },
  {
    name: 'no policy at all',
    branch: 'the CSP is carried in exactly one Content-Security-Policy header field; zero or multiple are each a FAIL',
    expect: [PREDICATES.CSP_FIELD_COUNT],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response) => withoutField(response, 'content-security-policy')),
      };
    },
  },
  {
    name: 'a response sets a cookie',
    branch: 'Set-Cookie anywhere is a FAILURE',
    expect: [PREDICATES.SET_COOKIE],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path === '/index.html' ? withField(response, 'set-cookie', 'session=1; Path=/') : response,
        ),
      };
    },
  },
  {
    name: 'a header nothing admits',
    branch: 'any header outside the class allowlist is a surfaced finding',
    expect: [PREDICATES.HEADER_ALLOWLIST],
    build: (origin) => {
      const scenario = baseline(origin);
      return { ...scenario, route: withTransform(scenario.route, (response) => withField(response, 'x-frame-options', 'DENY')) };
    },
  },
  {
    name: 'a class-scoped header out of its class',
    branch: 'content-range is admitted on no response: on a 200 it claims the response is a range the status says it is not',
    expect: [PREDICATES.HEADER_ALLOWLIST],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response) =>
          response.status === 200 ? withField(response, 'content-range', 'bytes 0-0/10') : response,
        ),
      };
    },
  },

  {
    name: 'the entry point may be kept',
    branch: 'every response not under /assets/ reaches the browser with Cache-Control: no-store',
    expect: [PREDICATES.CACHE_CLASSIFICATION],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path === '/' || request.path === '/index.html' ? replacingField(response, 'cache-control', 'public, max-age=60') : response,
        ),
      };
    },
  },
  {
    name: 'the two aliases serve different bytes',
    branch: 'the entry point answers at exactly two URLs and they must serve byte-identical bodies',
    // The same number of bytes, and different ones. A body that was also a
    // different length would be an origin that disagrees with itself about how
    // long the entry point is as well as about what it says, and a fixture with
    // two defects in it is a fixture whose redness has two possible causes.
    expect: [PREDICATES.ALIAS_DIVERGENCE],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path === '/' && response.body !== null && response.body.length > 0
            ? { ...response, body: new Uint8Array([...response.body.subarray(0, response.body.length - 1), 0x20]) }
            : response,
        ),
      };
    },
  },
  {
    name: 'an allowlisted 200 is not immutable',
    branch: 'allowlisted objects carry Cache-Control: public, max-age=31536000, immutable',
    expect: [PREDICATES.CACHE_CLASSIFICATION],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/assets/') && response.status === 200
            ? replacingField(response, 'cache-control', 'public, max-age=31536000')
            : response,
        ),
      };
    },
  },
  {
    name: 'an allowlisted 304 is not immutable',
    branch: 'a 200, 206 or 304 for an allowlisted object must itself carry the immutable directive',
    expect: [PREDICATES.CACHE_CLASSIFICATION],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/assets/') && response.status === 304 ? replacingField(response, 'cache-control', NO_STORE) : response,
        ),
      };
    },
  },
  {
    name: 'an asset 5xx may be kept',
    branch: 'every other response on either behaviour — 3xx, 4xx incl. 416, 5xx, anything not allowlisted — must reach the browser with explicit no-store',
    expect: [PREDICATES.CACHE_CLASSIFICATION],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path === `/assets/${'0'.repeat(64)}.js`
            ? { ...replacingField(response, 'cache-control', 'public, max-age=60'), status: 503, reason: 'Service Unavailable' }
            : response,
        ),
      };
    },
  },
  {
    name: 'a 416 may be kept',
    branch: 'every other response on either behaviour — 3xx, 4xx incl. 416, 5xx — must reach the browser with explicit no-store',
    // No request this check makes asks for a range, and this fixture does not
    // add one: what it is about is the classification of the status, which an
    // origin can answer with whether or not anybody asked it a range question.
    // A fixture that had to send a `Range` to elicit the status it classifies
    // would be a fixture asserting that ranges are served.
    expect: [PREDICATES.CACHE_CLASSIFICATION],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-')
            ? { ...replacingField(response, 'cache-control', IMMUTABLE), status: 416, reason: 'Range Not Satisfiable' }
            : response,
        ),
      };
    },
  },
  {
    name: 'a 404 carries no cache directive at all',
    branch: 'absence of immutable is NOT sufficient; 404 is heuristically cacheable',
    expect: [PREDICATES.CACHE_FIELD_COUNT],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response) => (response.status === 404 ? withoutField(response, 'cache-control') : response)),
      };
    },
  },
  {
    name: 'an asset is served as the wrong type',
    branch: 'served Content-Type per the exact table: css→text/css',
    expect: [PREDICATES.CONTENT_TYPE],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.endsWith('.css') && response.status === 200 ? replacingField(response, 'content-type', 'text/plain') : response,
        ),
      };
    },
  },
  {
    name: 'an asset with a query is answered with the canonical response',
    branch: 'a request with a non-empty query on an allowlisted asset path may be answered with the canonical response — the direction that must pass',
    // Green, and it is the shape a correct edge produces rather than an
    // indulgence. The cache in front of these objects is keyed on the path
    // alone and does not override what an object says about itself, so a
    // request differing from the canonical one only in its query is answered
    // out of the cache with the canonical response, directive included. The
    // bytes are the object's, and they are digest-named — a copy kept for a
    // year is a copy of bytes that cannot come to mean anything else.
    expect: [],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/assets/') && request.hasQuery && request.query.length > 0
            ? replacingField(response, 'cache-control', IMMUTABLE)
            : response,
        ),
      };
    },
  },
  {
    name: 'an asset with a query is answered with neither form',
    branch: 'a non-empty query on an allowlisted asset path is answered with the canonical response or an explicit no-store, and nothing else',
    // Heuristically cacheable and not the settled string: a browser may keep
    // this for a minute, which is neither of the two things the rule allows. The
    // widening is two answers, not a licence to say anything cacheable.
    expect: [PREDICATES.CACHE_CLASSIFICATION],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/assets/') && request.hasQuery && request.query.length > 0
            ? replacingField(response, 'cache-control', 'public, max-age=60')
            : response,
        ),
      };
    },
  },
  {
    name: 'a query on a path the allowlist does not carry is answered with the immutable directive',
    branch: 'the two answers a query may have are for allowlisted paths only — a query-carrying request anywhere else stays no-store',
    // The scope of the widening, which is the half of it that can go wrong
    // quietly. What makes the canonical answer sound is that the path is
    // allowlisted and its bytes are named by their own digest; a path the
    // allowlist does not carry has neither property, so the response it gives a
    // query is the one everything not allowlisted gives.
    //
    // Two predicates, and both are the origin's. A manifest naming a path under
    // /assets/ that is not the grammar is a manifest disagreeing with the design
    // before any request is made, and that is the only way this matrix can put a
    // query-carrying request against a non-allowlisted path at all — every path
    // a manifest names is in the allowlist union, so the grammar is what the
    // allowlist turns on. The cache half is doing its own work here: with the
    // widening's allowlist scoping removed, this fixture refuses under the path
    // predicate alone.
    expect: [PREDICATES.ASSET_PATH, PREDICATES.CACHE_CLASSIFICATION],
    build: (origin) => {
      const scenario = withAPathTheAllowlistCannotCarry(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path === MISNAMED_ASSET && request.hasQuery && request.query.length > 0
            ? replacingField(response, 'cache-control', IMMUTABLE)
            : response,
        ),
      };
    },
  },
  {
    name: 'a bare ? answers differently from the canonical request',
    branch: 'a bare-? request must answer equal to the canonical request (same status, same decoded bytes, same cache directive)',
    // And the bytes it answered with are not the release's, which is the other
    // true thing about this origin and is named rather than smoothed over. The
    // bare-query arm is a 200 at a path the manifest names, so it is hashed like
    // every other 200 at a path the manifest names; a fixture whose expected set
    // hid that would be a fixture that has stopped describing what its origin
    // does.
    expect: [PREDICATES.BARE_QUERY, PREDICATES.OBJECT_DIGEST],
    build: (origin) => {
      const scenario = baseline(origin);
      const extra = bytes('\n');
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.hasQuery && request.query.length === 0 && response.body !== null
            ? { ...response, body: new Uint8Array([...response.body, ...extra]), headers: response.headers.filter(([name]) => name !== 'content-length') }
            : response,
        ),
      };
    },
  },
  {
    name: 'a redirect may be kept',
    branch: '3xx classification applies whenever a 3xx is observed',
    expect: [PREDICATES.CACHE_CLASSIFICATION],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-')
            ? { ...replacingField(withField(response, 'location', '/index.html'), 'cache-control', 'public, max-age=60'), status: 302, reason: 'Found' }
            : response,
        ),
      };
    },
  },
  {
    name: 'a redirect that classifies',
    branch: '3xx classification applies whenever a 3xx is observed — the direction that must pass',
    expect: [],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-')
            ? { ...withField(response, 'location', '/index.html'), status: 302, reason: 'Found' }
            : response,
        ),
      };
    },
  },
  {
    name: 'a compressed response carries no Vary',
    branch: 'a compressed response must carry Vary including accept-encoding',
    expect: [PREDICATES.VARY],
    build: (origin) => {
      const scenario = baseline(origin);
      return { ...scenario, route: withTransform(scenario.route, (response) => withoutField(response, 'vary')) };
    },
  },
  {
    name: 'a coding that does not apply',
    branch: 'decode gzip/brotli before hashing; an undecodable body FAILS',
    expect: [PREDICATES.OBJECT_UNDECODABLE],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/assets/') &&
          request.path.endsWith('.js') &&
          response.status === 200 &&
          !response.headers.some(([name]) => name === 'content-encoding')
            ? withField(response, 'content-encoding', 'gzip')
            : response,
        ),
      };
    },
  },
  {
    name: 'an object answers with a redirect',
    branch: 'comparison verdicts: a redirect where an object is expected',
    // And the arm that then has nothing to be conditional about. An object that
    // never answers 200 issues no validator, so its conditional arm cannot run —
    // named here rather than smoothed over, because a fixture whose expected set
    // is edited to hide a consequence is a fixture that has stopped describing
    // what its origin does.
    expect: [PREDICATES.OBJECT_REDIRECT, PREDICATES.CONDITIONAL_ARM],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.endsWith('.css') && response.status === 200
            ? {
                status: 302,
                reason: 'Found',
                headers: [...response.headers.filter(([name]) => name !== 'content-encoding' && name !== 'vary' && name !== 'content-type'), ['location', '/index.html']].map(
                  ([name, value]) => /** @type {[string, string]} */ ([name, name === 'cache-control' ? NO_STORE : value]),
                ),
                body: null,
              }
            : response,
        ),
      };
    },
  },
  {
    name: 'an object is not there',
    branch: 'comparison verdicts: missing object',
    expect: [PREDICATES.OBJECT_MISSING, PREDICATES.CONDITIONAL_ARM],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.endsWith('.css') && response.status === 200
            ? {
                status: 404,
                reason: 'Not Found',
                headers: response.headers
                  .filter(([name]) => name !== 'content-encoding' && name !== 'vary' && name !== 'etag' && name !== 'accept-ranges')
                  .map(([name, value]) => /** @type {[string, string]} */ ([name, name === 'cache-control' ? NO_STORE : name === 'content-type' ? 'text/plain; charset=utf-8' : value])),
                body: bytes('not found'),
              }
            : response,
        ),
      };
    },
  },
  {
    name: 'the bytes are not the bytes the manifest records',
    branch: 'comparison verdicts: body ≠ digest, with an honest manifest',
    expect: [PREDICATES.OBJECT_DIGEST],
    build: (origin) => {
      const scenario = baseline(origin);
      const deployment = scenario.deployment;
      const altered = deployment.objects.map((one) =>
        one.path.endsWith('.css') ? { ...one, bytes: bytes('body { margin: 1px; }\n') } : one,
      );
      return { ...baseline(origin, { ...deployment, objects: altered }), manifestText: deployment.manifestText };
    },
  },
  {
    name: 'the manifest records a digest the repository does not',
    branch: 'comparison verdicts: body ≠ digest, with a mangled manifest',
    expect: [PREDICATES.OBJECT_DIGEST],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        manifestText: manifestWith(scenario.manifestText, (manifest) => {
          manifest.objects['/index.html'] = mangle(manifest.objects['/index.html']);
        }),
      };
    },
  },
  {
    name: 'an asset is named by a digest that is not its own',
    branch: 'path grammar: /assets/<64-char hex of the object’s identity-encoded bytes — the digest its manifest records>',
    expect: [PREDICATES.ASSET_PATH, PREDICATES.OBJECT_DIGEST],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        manifestText: manifestWith(scenario.manifestText, (manifest) => {
          for (const path of Object.keys(manifest.objects)) {
            if (path.endsWith('.js') && path.startsWith('/assets/')) {
              manifest.objects[path] = mangle(manifest.objects[path]);
            }
          }
        }),
      };
    },
  },

  {
    name: 'the manifest carries a field the schema does not name',
    branch: 'a JSON document with EXACTLY these four fields and no others (any unknown field = FAIL)',
    expect: [PREDICATES.MANIFEST_SCHEMA],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        manifestText: manifestWith(scenario.manifestText, (manifest) => {
          manifest.generated_by = 'a tool nobody agreed about';
        }),
      };
    },
  },
  {
    name: 'the manifest names one path twice',
    branch: 'duplicate path keys in the JSON text are a FAIL',
    expect: [PREDICATES.MANIFEST_DUPLICATE_KEY],
    build: (origin) => {
      const scenario = baseline(origin);
      // String surgery rather than an object, because an object cannot hold the
      // defect: a second member of the same name is gone before anything can
      // look at it.
      const text = scenario.manifestText.replace(
        '"/index.html":',
        '"/index.html": "0000000000000000000000000000000000000000000000000000000000000000",\n    "/index.html":',
      );
      return { ...scenario, manifestText: text };
    },
  },
  {
    name: 'the release identifier does not carry the commit it claims',
    branch: 'release_id, whose 12-hex suffix MUST equal the first 12 characters of commit',
    expect: [PREDICATES.MANIFEST_RELEASE_ID],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        manifestText: manifestWith(scenario.manifestText, (manifest) => {
          manifest.release_id = `${String(manifest.release_id).split('-')[0]}-0123456789ab`;
        }),
      };
    },
  },
  {
    name: 'a manifest path is percent-encoded',
    branch: 'manifest and inventory paths use ONLY [A-Za-z0-9._~/-]; percent-encoding anywhere in a path is a FAIL',
    expect: [PREDICATES.MANIFEST_PATH],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        manifestText: manifestWith(scenario.manifestText, (manifest) => {
          manifest.objects['/js/%2e%2e/config.js'] = manifest.objects['/js/config.js'];
        }),
      };
    },
  },
  {
    name: 'the manifest names / as an object',
    branch: '"/" is NEVER an objects key',
    expect: [PREDICATES.MANIFEST_PATH],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        manifestText: manifestWith(scenario.manifestText, (manifest) => {
          manifest.objects['/'] = manifest.objects['/index.html'];
        }),
      };
    },
  },
  {
    name: 'the manifest does not name the entry point',
    branch: "the entry-point document's own path (/index.html) MUST be among objects",
    expect: [PREDICATES.MANIFEST_SCHEMA],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        manifestText: manifestWith(scenario.manifestText, (manifest) => {
          delete manifest.objects['/index.html'];
        }),
      };
    },
  },

  {
    name: 'the document names a release the manifest does not',
    branch: 'release_id appears in the entry-point document and must match the manifest',
    expect: [PREDICATES.RELEASE_IDENTIFIER],
    build: (origin) => {
      const base = buildDeployment(origin);
      const deployment = withEntryDocument(base, base.entryDocument.replace(/<!-- release: [^ ]+ -->/, '<!-- release: 20200101T000000Z-a1b2c3d4e5f6 -->'));
      return baseline(origin, deployment);
    },
  },
  {
    name: 'the document names no release at all',
    branch: 'exactly one release comment expected, zero or more than one = FAIL',
    expect: [PREDICATES.RELEASE_IDENTIFIER],
    build: (origin) => {
      const base = buildDeployment(origin);
      return baseline(origin, withEntryDocument(base, base.entryDocument.replace(/<!-- release: [^ ]+ -->\n/, '')));
    },
  },
  {
    name: 'the document names two releases',
    branch: 'exactly one release comment expected, zero or more than one = FAIL',
    expect: [PREDICATES.RELEASE_IDENTIFIER],
    build: (origin) => {
      const base = buildDeployment(origin);
      const twice = base.entryDocument.replace(/(<!-- release: [^ ]+ -->)/, '$1\n$1');
      return baseline(origin, withEntryDocument(base, twice));
    },
  },

  {
    name: 'the entry point carries a Link header',
    branch: 'live absence: entry-point responses carry no Link response header',
    expect: [PREDICATES.LINK_HEADER, PREDICATES.HEADER_ALLOWLIST],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path === '/' || request.path === '/index.html'
            ? withField(response, 'link', '</assets/anything.js>; rel=preload; as=script')
            : response,
        ),
      };
    },
  },
  {
    name: 'a 103 arrives before the response',
    branch: 'live absence: no 103 Early Hints interim response — and the adapter must be proven able to see it',
    expect: [PREDICATES.EARLY_HINTS],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path === '/' || request.path === '/index.html'
            ? {
                ...response,
                interim: [
                  {
                    status: 103,
                    reason: 'Early Hints',
                    headers: [['link', '</assets/anything.js>; rel=preload; as=script']],
                  },
                ],
              }
            : response,
        ),
      };
    },
  },

  {
    name: 'the listing names something under the document prefix that the release does not',
    branch: 'every inventory path under the document prefix must be a manifest object (extra = FAIL)',
    expect: [PREDICATES.OBJECT_EXTRA_DOCUMENT],
    build: (origin) => {
      const scenario = baseline(origin);
      return { ...scenario, inventoryText: inventoryWith(scenario.inventoryText ?? '', (paths) => [...paths, '/orphan.html']) };
    },
  },
  {
    name: 'the listing names an asset no retained release does',
    branch: 'every inventory path under /assets/ must be in the retained-releases union (extra = FAIL)',
    expect: [PREDICATES.OBJECT_EXTRA_ASSET],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        inventoryText: inventoryWith(scenario.inventoryText ?? '', (paths) => [...paths, `/assets/${'a'.repeat(64)}.js`]),
      };
    },
  },
  {
    name: 'the listing does not name an object the release does',
    branch: 'a manifest object absent from the inventory = FAIL',
    expect: [PREDICATES.INVENTORY_MISSING_OBJECT],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        inventoryText: inventoryWith(scenario.inventoryText ?? '', (paths) => paths.filter((path) => path !== '/js/config.js')),
      };
    },
  },
  {
    name: 'the listing names one path twice',
    branch: 'duplicate entries = FAIL',
    expect: [PREDICATES.INVENTORY_SCHEMA],
    build: (origin) => {
      const scenario = baseline(origin);
      return { ...scenario, inventoryText: inventoryWith(scenario.inventoryText ?? '', (paths) => [...paths, '/index.html']) };
    },
  },
  {
    name: 'no listing was supplied',
    branch: 'live mode WITHOUT an inventory argument FAILS, it does not skip',
    expect: [PREDICATES.INVENTORY_ABSENT],
    build: (origin) => ({ ...baseline(origin), inventoryText: null }),
  },

  {
    name: 'the table does not answer for the origin under test',
    branch: 'an origin the table does not answer is a FAILED check, not a skipped one',
    expect: [PREDICATES.CONNECT_SRC_ORIGIN],
    build: (origin) => ({ ...baseline(origin), origin: 'https://an-origin-nobody-added.example' }),
  },
  {
    name: 'the local origin table is not the one the manifest binds',
    branch: 'sha256(local checkout’s site/js/config.js identity bytes) == manifest.objects["/js/config.js"]',
    expect: [PREDICATES.CONFIG_BINDING],
    build: (origin) => ({ ...baseline(origin), localConfigBytes: bytes('export function apiOriginFor() { return null; }\n') }),
  },
  {
    name: 'the live origin table is not the one the manifest binds',
    branch: 'manifest.objects["/js/config.js"] == sha256(live /js/config.js decoded bytes)',
    expect: [PREDICATES.CONFIG_BINDING, PREDICATES.OBJECT_DIGEST],
    build: (origin) => {
      const scenario = baseline(origin);
      const swapped = bytes('export function apiOriginFor() { return "https://somewhere-else.example"; }\n');
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) => {
          if (request.path !== '/js/config.js') {
            return response;
          }
          // The conditional answer describes the representation this origin
          // serves, which is the swapped one. An origin still naming the length
          // of the table it no longer serves would be a second defect, and this
          // fixture is about the table.
          if (response.status === 304) {
            return replacingField(response, 'content-length', String(swapped.length));
          }
          if (response.status !== 200) {
            return response;
          }
          return {
            ...response,
            headers: response.headers.filter(([name]) => name !== 'content-encoding' && name !== 'vary' && name !== 'content-length'),
            body: swapped,
          };
        }),
      };
    },
  },
  {
    name: 'no response carries a validator',
    branch: 'if no validator was present, record NOT-RUN as a surfaced finding',
    expect: [PREDICATES.CONDITIONAL_ARM],
    build: (origin) => {
      const scenario = baseline(origin);
      return { ...scenario, route: withTransform(scenario.route, (response) => withoutField(response, 'etag')) };
    },
  },

  {
    name: 'a conditional request is answered 200 with bytes that are not the object',
    branch: 'any 200 for a manifest-covered path, on any arm, must decode to the manifest digest — the conditional arm',
    expect: [PREDICATES.OBJECT_DIGEST],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: answeringConditionalWith(scenario.route, (request) => request.path.endsWith('.js') && request.path.startsWith('/assets/'), PLAUSIBLE_BUT_WRONG),
      };
    },
  },
  {
    name: 'the entry point answers a conditional request 200 with a different document',
    branch: 'any 200 for a manifest-covered path, on any arm, must decode to the manifest digest — the entry point’s conditional arm',
    expect: [PREDICATES.OBJECT_DIGEST],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: answeringConditionalWith(
          scenario.route,
          (request) => request.path === '/' || request.path === '/index.html',
          PLAUSIBLE_BUT_WRONG_DOCUMENT,
        ),
      };
    },
  },
  {
    name: 'a plain GET is answered with a partial response',
    branch: 'a 206 observed on any arm is a refusal: no request this check makes asks for part of anything',
    expect: [PREDICATES.PARTIAL_CONTENT],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-') ? { ...response, status: 206, reason: 'Partial Content' } : response,
        ),
      };
    },
  },
  {
    name: 'a conditional request is answered with a partial response',
    branch: 'a 206 observed on any arm is a refusal — the conditional arm',
    expect: [PREDICATES.PARTIAL_CONTENT],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          response.status === 304 && (request.path === '/' || request.path === '/index.html')
            ? { ...withoutField(response, 'content-length'), status: 206, reason: 'Partial Content' }
            : response,
        ),
      };
    },
  },
  {
    name: 'a 304 carries a body',
    branch: '304s carry no body: raw body must be empty, and a 304 with bytes is a refusal',
    expect: [PREDICATES.NOT_MODIFIED_BODY],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response) =>
          response.status === 304 ? { ...response, body: bytes('the object, again') } : response,
        ),
      };
    },
  },
  {
    name: 'the object is itself as plain bytes and something else under gzip',
    branch: 'every arm’s decoded bytes must equal the manifest digest — cross-encoding equivalence, on the gzip arm alone',
    expect: [PREDICATES.OBJECT_DIGEST],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response) =>
          response.headers.some(([name, value]) => name === 'content-encoding' && value === 'gzip')
            ? replacingBody(response, encode(PLAUSIBLE_BUT_WRONG, 'gzip'))
            : response,
        ),
      };
    },
  },
  {
    name: 'the object is itself as plain bytes and something else under brotli',
    branch: 'every arm’s decoded bytes must equal the manifest digest — cross-encoding equivalence, on the brotli arm alone',
    expect: [PREDICATES.OBJECT_DIGEST],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response) =>
          response.headers.some(([name, value]) => name === 'content-encoding' && value === 'br')
            ? replacingBody(response, encode(PLAUSIBLE_BUT_WRONG, 'br'))
            : response,
        ),
      };
    },
  },

  {
    name: 'the policy is continued on a folded line',
    branch: 'a header line that begins with whitespace is an obsolete folded continuation and is a typed capture refusal',
    // The first line is the expected policy exactly, so the reading that drops
    // the continuation is the reading that passes. That is the whole shape of
    // this defect: the wire carries one policy and the check compares another,
    // and nothing in the comparison can tell.
    expect: [PREDICATES.CAPTURE_HEADER_LINE],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-')
            ? replacingField(
                response,
                'content-security-policy',
                `${response.headers.find(([name]) => name === 'content-security-policy')?.[1] ?? ''}\r\n  ; report-uri /collect`,
              )
            : response,
        ),
      };
    },
  },
  {
    name: 'a field name is separated from its colon',
    branch: 'no whitespace between a field name and its colon',
    // The value is the policy, exactly. A reader that trimmed the name would
    // find the policy it expected and pass, which is what makes this a fixture
    // about the line rather than about the policy.
    expect: [PREDICATES.CAPTURE_HEADER_LINE],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-') ? renamingField(response, 'content-security-policy', 'content-security-policy ') : response,
        ),
      };
    },
  },
  {
    name: 'a line in the head is not a field',
    branch: 'no colon-less field line',
    expect: [PREDICATES.CAPTURE_HEADER_LINE],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-') ? withField(response, 'x-cache', 'Miss from cloudfront\r\nthis-line-is-not-a-field') : response,
        ),
      };
    },
  },
  {
    name: 'the response declares two different lengths',
    branch: 'exactly one Content-Length occurrence — no duplicates',
    expect: [PREDICATES.CAPTURE_BODY_LENGTH],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-') && response.body !== null
            ? withField(withField(response, 'content-length', String(response.body.length)), 'content-length', String(response.body.length + 3))
            : response,
        ),
      };
    },
  },
  {
    name: 'the response declares the same length twice',
    branch: 'exactly one Content-Length occurrence — no duplicates, even where they agree',
    // Stricter than the specification, deliberately: two fields that agree today
    // are two fields, and which of them a cache in front of this origin keeps is
    // a question this check would rather not have an answer to.
    expect: [PREDICATES.CAPTURE_BODY_LENGTH],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-') && response.body !== null
            ? withField(withField(response, 'content-length', String(response.body.length)), 'content-length', String(response.body.length))
            : response,
        ),
      };
    },
  },
  {
    name: 'the response declares its length as a list',
    branch: 'no comma-coalesced Content-Length values',
    expect: [PREDICATES.CAPTURE_BODY_LENGTH],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-') && response.body !== null
            ? withField(response, 'content-length', `${response.body.length}, ${response.body.length}`)
            : response,
        ),
      };
    },
  },
  {
    name: 'the response declares both a length and a transfer coding',
    branch: 'either exactly one Content-Length or a chunked transfer coding, never both',
    expect: [PREDICATES.CAPTURE_BODY_LENGTH],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-') && response.body !== null
            ? withField(asChunked(response), 'content-length', String(response.body.length))
            : response,
        ),
      };
    },
  },
  {
    name: 'the response declares neither a length nor a transfer coding',
    branch: 'never neither: a close-delimited body is a refusal',
    expect: [PREDICATES.CAPTURE_FRAMING_CHOICE],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-') ? { ...response, closeDelimited: true } : response,
        ),
      };
    },
  },
  {
    name: 'the transfer coding is not chunked',
    branch: 'a Transfer-Encoding whose value is exactly the single terminal token chunked',
    expect: [PREDICATES.CAPTURE_FRAMING_CHOICE],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-')
            ? { ...withoutField(response, 'content-length'), headers: [...withoutField(response, 'content-length').headers, ['transfer-encoding', 'gzip']] }
            : response,
        ),
      };
    },
  },
  {
    name: 'the response announces a version this check does not speak',
    branch: "the final response's version is HTTP/1.1",
    expect: [PREDICATES.CAPTURE_HTTP_VERSION],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-') ? { ...response, statusLine: `HTTP/1.0 ${response.status} ${response.reason}` } : response,
        ),
      };
    },
  },
  {
    name: 'the first line is not a status line',
    branch: 'anything the parser refuses to read is a typed refusal quoting what arrived',
    expect: [PREDICATES.CAPTURE_UNREADABLE],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-') ? { ...response, statusLine: 'this line is not a status line' } : response,
        ),
      };
    },
  },
  {
    name: 'a whole second response follows the first',
    branch: 'octets beyond the framed message are a refusal — including ones that are themselves a response',
    // The case a client cannot report, because to a client it is not part of
    // this response at all. The request asked for the connection to be closed,
    // so there is no next response for these to be; a reader that took them as
    // one would report the first response and say nothing about the rest.
    expect: [PREDICATES.CAPTURE_BODY_LENGTH],
    build: (origin) => {
      const scenario = baseline(origin);
      const second = bytes(
        ['HTTP/1.1 200 OK', 'content-type: text/plain; charset=utf-8', 'content-length: 7', '', 'another'].join('\r\n'),
      );
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-') && response.body !== null
            ? {
                ...withField(response, 'content-length', String(response.body.length)),
                body: new Uint8Array([...response.body, ...second]),
              }
            : response,
        ),
      };
    },
  },
  {
    name: 'a whole second chunked response follows a chunked one',
    branch: 'octets beyond the framed message are a refusal — including a second response framed the way the first was',
    // The shape a message that says where it ends is read past. A reading that
    // looks for the end of a chunked message anywhere in what arrived finds this
    // one's terminator at the end of the second response and calls the pair a
    // message; the accounting that reads each chunk's size and skips that many
    // octets finds the first message's end where it is.
    expect: [PREDICATES.CAPTURE_BODY_FRAMING],
    build: (origin) => {
      const scenario = baseline(origin);
      const second = bytes(
        [
          'HTTP/1.1 200 OK',
          'content-type: text/plain; charset=utf-8',
          'transfer-encoding: chunked',
          '',
          '7',
          'another',
          '0',
          '',
          '',
        ].join('\r\n'),
      );
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-') ? followedBy(asChunked(response), second) : response,
        ),
      };
    },
  },
  {
    name: 'octets follow a chunked message and end the way it did',
    branch: 'octets beyond the framed message are a refusal — including ones ending in something that looks like a terminator',
    expect: [PREDICATES.CAPTURE_BODY_FRAMING],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-')
            ? followedBy(asChunked(response), bytes('and then some octets nobody asked for\r\n0\r\n\r\n'))
            : response,
        ),
      };
    },
  },
  {
    name: 'a trailer field arrives after the head',
    branch: 'any non-empty trailer field is a refusal naming the field',
    // A cookie is the specimen because it is the field this design refuses
    // everywhere, and a trailer is where a response can carry one after
    // everything reading the head has finished.
    expect: [PREDICATES.CAPTURE_TRAILER_FIELD],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-') ? asChunked(response, [['set-cookie', 'session=1; Path=/']]) : response,
        ),
      };
    },
  },
  {
    name: 'a chunked message ends with an empty trailer section',
    branch: 'the trailer section is always present and may be empty — the direction that must pass',
    expect: [],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-') ? asChunked(response) : response,
        ),
      };
    },
  },
  {
    name: 'a chunked message ends with a zero chunk spelled in two digits',
    branch: 'a zero-length chunk in any hex spelling ends the message — the direction that must pass',
    // Green, and it is a counterfactual for a wrong refusal rather than a second
    // conformant run. A chunk size is a hex number, `00` is the number zero, and
    // an origin that writes it that way has ended its message — so a reading
    // that accepted only the one-digit spelling refused a sender for a choice
    // the framing leaves open.
    expect: [],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-') ? asChunked(response, [], { zero: '00' }) : response,
        ),
      };
    },
  },
  {
    name: 'a chunk carries data that reads like the end of a message',
    branch: 'a chunked message ends where its sizes say it ends, not where its data happens to look like it does — the direction that must pass',
    // Green, and the other wrong refusal the accounting has to avoid. A chunk's
    // data is octets, and octets may be anything: a compressed asset can carry
    // this sequence anywhere in it. A reading that looked for the end of the
    // message rather than counting to it would stop inside this chunk and call
    // the rest of a sound message something that followed it.
    expect: [],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-')
            ? asChunked(replacingBody(response, bytes('not found\r\n0\r\n\r\nand there is more of it')))
            : response,
        ),
      };
    },
  },
  {
    name: 'an interim response declares a transfer coding',
    branch: 'a status that carries no body frames none — an interim response included',
    // An interim response is a whole response that arrives before the response,
    // and it sends no body. A client reads its fields and hands them over, so
    // what one of them claims about framing is nobody's reading unless the
    // capture takes it.
    expect: [PREDICATES.CAPTURE_FRAMING_CHOICE],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-')
            ? {
                ...response,
                interim: [{ status: 102, reason: 'Processing', headers: [['transfer-encoding', 'chunked']] }],
              }
            : response,
        ),
      };
    },
  },
  {
    name: 'a forbidden field is placed beyond the count a client stops collecting at',
    branch: 'every field occurrence observed — including the ones past the count a client stops recording at',
    // Every filler field is one the allowlist admits, so the only thing wrong
    // with this response is the last field on it. A client reading with its
    // ordinary limit records the fillers and stops, and the response then looks
    // like one that sets no cookie.
    //
    // The count is chosen from both ends. It is far enough past the number of
    // fields a client stops recording at that the cookie is behind it, and the
    // head is short enough to stay well inside the size a head may be — a head
    // over that is refused outright, which fails closed but would be a fixture
    // about a different limit.
    expect: [PREDICATES.SET_COOKIE],
    build: (origin) => {
      const scenario = baseline(origin);
      /** @type {[string, string][]} */
      const filler = Array.from({ length: 1800 }, () => ['age', '0']);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-')
            ? { ...response, headers: [...response.headers, ...filler, ['set-cookie', 'session=1; Path=/']] }
            : response,
        ),
      };
    },
  },
  {
    name: 'a 304 says the representation is as long as the coding the request did not ask for',
    branch: 'a 304 Content-Length is conformant when it is the length of any representation of that path this run observed',
    // Green, and it is the counterfactual for a wrong refusal rather than a
    // second conformant run. The conditional request replays a validator and
    // asks for no coding, and a validator that is not specific to one can
    // validate a representation other than the one that issued it — so a length
    // that is the compressed representation's is a length this origin may
    // honestly send, and a check that compared it against one baseline would
    // redden a sound deployment.
    expect: [],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) => {
          if (response.status !== 304) {
            return response;
          }
          const path = request.path === '/' ? '/index.html' : request.path;
          const object = scenario.deployment.objects.find((one) => one.path === path);
          return object === undefined
            ? response
            : replacingField(response, 'content-length', String(encode(object.bytes, 'gzip').length));
        }),
      };
    },
  },
  {
    name: 'a 304 says the representation is a length nothing was served at',
    branch: 'a 304 Content-Length equal to no observed representation is a refusal naming every number compared',
    expect: [PREDICATES.NOT_MODIFIED_LENGTH],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response) =>
          response.status === 304
            ? replacingField(response, 'content-length', String(Number(response.headers.find(([name]) => name === 'content-length')?.[1] ?? 0) + 1))
            : response,
        ),
      };
    },
  },
  {
    name: 'a 304 says the representation is a length only a query probe was served at',
    branch: 'the lengths a 304 may claim are the ones the representation arms were served — a response to a request carrying a query is not one of them',
    // The query probe is answered with the same object stored rather than
    // compressed: it decodes to exactly the bytes the release records, so the
    // only thing it contributes is a number of octets on the wire that no arm
    // asking for a representation of this path was served. A check that counted
    // every 200 would let a 304 claim that number, which is a check whose
    // baseline the origin gets to widen.
    expect: [PREDICATES.NOT_MODIFIED_LENGTH],
    build: (origin) => claimingAStoredLength(origin, (request) => request.query.length > 0),
  },
  {
    name: 'a 304 says the representation is a length only the bare-? probe was served at',
    branch: 'the lengths a 304 may claim are the ones the representation arms were served — the bare-? arm carries a query and is not one of them',
    // The other half of the same exclusion, and it is not the same fixture. A
    // bare `?` is cache-key-identical to no query and this deployment answers it
    // identically, which is exactly why it looks like a representation arm and
    // is not one: it is a different request target, the matrix asks it as its own
    // arm, and a 304 answering a request that carried no query at all has nothing
    // to do with what came back from it.
    expect: [PREDICATES.NOT_MODIFIED_LENGTH],
    build: (origin) => claimingAStoredLength(origin, (request) => request.query.length === 0),
  },
  {
    name: 'more bytes arrive than the response declared',
    branch: 'a content-length that does not equal the bytes actually received is a refusal — trailing bytes beyond the declared length',
    expect: [PREDICATES.CAPTURE_BODY_LENGTH],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path === `/assets/${'0'.repeat(64)}.js` && response.body !== null
            ? {
                ...response,
                headers: [...response.headers, ['content-length', String(response.body.length)]],
                body: new Uint8Array([...response.body, ...bytes(' and more')]),
              }
            : response,
        ),
      };
    },
  },
  {
    name: 'fewer bytes arrive than the response declared',
    branch: 'a content-length that does not equal the bytes actually received is a refusal — a body cut short',
    expect: [PREDICATES.CAPTURE_BODY_LENGTH],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path === `/assets/${'0'.repeat(64)}.js` && response.body !== null
            ? { ...response, headers: [...response.headers, ['content-length', String(response.body.length + 7)]] }
            : response,
        ),
      };
    },
  },
  {
    name: 'a chunked body is never terminated',
    branch: 'a chunked body whose parse fails is a refusal, never an empty buffer',
    expect: [PREDICATES.CAPTURE_BODY_FRAMING],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-')
            ? {
                ...response,
                headers: [...response.headers.filter(([name]) => name.toLowerCase() !== 'content-length'), ['transfer-encoding', 'chunked']],
                // One chunk, and then the connection closes: no zero-length
                // chunk, no trailer, nothing that says the body ended.
                body: bytes('9\r\nnot found\r\n'),
              }
            : response,
        ),
      };
    },
  },

  {
    name: 'a chunk’s data is not followed by the terminator its framing requires',
    branch: 'each chunk’s data is followed by CRLF, and a chunked body whose framing does not parse is a refusal',
    // The other malformed-chunk direction. The message reaches a zero-length
    // chunk and a trailer section, so nothing about where it stops is wrong —
    // what is wrong is inside it, at the two octets that are supposed to end the
    // one chunk it carries.
    expect: [PREDICATES.CAPTURE_BODY_FRAMING],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) =>
          request.path.startsWith('/missing-') ? asChunked(response, [], { afterChunkData: 'XX' }) : response,
        ),
      };
    },
  },

  {
    name: 'a retained release’s object is served and listed',
    branch: 'every /assets/ path of every retained manifest joins the request matrix — the direction that must pass',
    expect: [],
    build: (origin) => retained(origin).scenario,
  },
  {
    name: 'a retained release’s object answers with something else',
    branch: 'a union asset is digest-checked against its own manifest’s digest',
    expect: [PREDICATES.OBJECT_DIGEST],
    build: (origin) => {
      const { scenario, retainedPath } = retained(origin);
      return {
        ...scenario,
        route: withTransform(scenario.route, (response, request) => {
          if (request.path !== retainedPath) {
            return response;
          }
          // As with the table above: the conditional answer names the length of
          // what this origin serves, so that the one thing wrong with it is the
          // bytes.
          if (response.status === 304) {
            return replacingField(response, 'content-length', String(PLAUSIBLE_BUT_WRONG.length));
          }
          return response.status === 200
            ? replacingBody(withoutField(withoutField(response, 'content-encoding'), 'vary'), PLAUSIBLE_BUT_WRONG)
            : response;
        }),
      };
    },
  },
  {
    name: 'a retained release’s object is not in the listing',
    branch: 'a union asset absent from the inventory is a refusal — rollback needs it live',
    expect: [PREDICATES.INVENTORY_MISSING_OBJECT],
    build: (origin) => {
      const { scenario, retainedPath } = retained(origin);
      return {
        ...scenario,
        inventoryText: inventoryWith(scenario.inventoryText ?? '', (paths) => paths.filter((path) => path !== retainedPath)),
      };
    },
  },
  {
    name: 'two retained releases disagree about the bytes at one path',
    branch: 'an object under /assets/ is named by the digest of its own bytes, so at most one of two records for it can be right',
    // Two refusals, and the pair is the point. A name under /assets/ pins the
    // digest, so a disagreement between two releases always means at least one
    // of the two records disagrees with the name it is written at — and a check
    // that only noticed the second thing would report a broken record while
    // saying nothing about the two releases that cannot both be rolled back to.
    // Naming both is what shows the disagreement is seen in its own right rather
    // than inferred from the record that happens to be malformed.
    expect: [PREDICATES.ASSET_PATH, PREDICATES.MANIFEST_ASSET_COLLISION],
    build: (origin) => {
      const { scenario, retainedPath } = retained(origin);
      const other = manifestWith(scenario.unionManifestTexts[0] ?? '', (manifest) => {
        manifest.objects[retainedPath] = mangle(manifest.objects[retainedPath]);
      });
      return { ...scenario, unionManifestTexts: [...scenario.unionManifestTexts, other] };
    },
  },

  {
    name: 'the identifier is spelled in script text and in an attribute, and in no comment',
    branch: 'a release spelling outside a real comment span is not a release comment — zero comments is the refusal',
    expect: [PREDICATES.RELEASE_IDENTIFIER],
    build: (origin) => {
      const base = buildDeployment(origin);
      const decoyed = base.entryDocument
        .replace(/<!-- release: [^ ]+ -->\n/, '')
        .replace(
          '    <main></main>',
          [
            `    <div data-stamp="release: ${FIXTURE_RELEASE_ID}"></div>`,
            '    <main></main>',
            `    <script type="module">export const stamp = 'release: ${FIXTURE_RELEASE_ID}';</script>`,
          ].join('\n'),
        );
      return baseline(origin, withEntryDocument(base, decoyed));
    },
  },

  {
    name: 'the release comment is closed the abrupt way',
    branch: 'a comment closes at --> or at the abrupt --!>, and a reader that knows only the first reads past the end of one',
    // Green, and it is a discriminator rather than a second conformant run: a
    // span scan that did not know the abrupt close would read this comment as
    // running to the end of the document, find no span whose content is a
    // release, and refuse for having found none.
    expect: [],
    build: (origin) => {
      const base = buildDeployment(origin);
      return baseline(origin, withEntryDocument(base, base.entryDocument.replace(` ${FIXTURE_RELEASE_ID} -->`, ` ${FIXTURE_RELEASE_ID} --!>`)));
    },
  },

  {
    name: 'the release identifier names the thirty-first of February',
    branch: 'parseReleaseId rejects calendar-impossible instants — month lengths',
    expect: [PREDICATES.MANIFEST_RELEASE_ID],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        manifestText: manifestWith(scenario.manifestText, (manifest) => {
          manifest.release_id = `20260231T091500Z-${String(manifest.commit).slice(0, 12)}`;
        }),
      };
    },
  },
  {
    name: 'the release identifier names the twenty-ninth of a February that had twenty-eight days',
    branch: 'parseReleaseId rejects calendar-impossible instants — leap years',
    expect: [PREDICATES.MANIFEST_RELEASE_ID],
    build: (origin) => {
      const scenario = baseline(origin);
      return {
        ...scenario,
        manifestText: manifestWith(scenario.manifestText, (manifest) => {
          manifest.release_id = `20260229T091500Z-${String(manifest.commit).slice(0, 12)}`;
        }),
      };
    },
  },
]);
