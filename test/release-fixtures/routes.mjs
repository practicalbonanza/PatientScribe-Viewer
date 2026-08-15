/**
 * How the conformant deployment answers, and how a fixture bends it.
 *
 * The rules below are the normative ones written out a second time, from the
 * text rather than from the checker: which responses may be kept, which
 * directive says so, what a conditional answers, and what a path nobody ratified
 * answers. Written independently on purpose — see the
 * note in `deployment.mjs`. Two spellings of one rule that disagree are a thing
 * a run can notice; one spelling used by both sides is a rule that cannot be
 * wrong.
 *
 * Negative fixtures are this route with a transform over its answer, and a
 * transform is the smallest thing that can express them: one field removed, one
 * status changed, one directive dropped. A fixture that rebuilt the whole
 * response would be a fixture whose redness has more than one possible cause.
 */

import { brotliCompressSync, gzipSync } from 'node:zlib';

import { IMMUTABLE, NO_STORE, POLICY_FIELDS, policyValue } from './deployment.mjs';

/**
 * Every field a response carries before anything specific to it.
 *
 * @param {string} apiOrigin
 * @param {string} cache
 * @returns {[string, string][]}
 */
function baseFields(apiOrigin, cache) {
  return [
    ['content-security-policy', policyValue(apiOrigin)],
    ...POLICY_FIELDS.map(([name, value]) => /** @type {[string, string]} */ ([name, value])),
    ['cache-control', cache],
  ];
}

/**
 * Which coding to answer a request with.
 *
 * @param {import('./origin.mjs').FixtureRequest} request
 * @returns {'identity' | 'gzip' | 'br'}
 */
function negotiate(request) {
  const asked = request.headers
    .filter((field) => field.name === 'accept-encoding')
    .map((field) => field.value.toLowerCase())
    .join(',');
  if (asked.includes('br')) {
    return 'br';
  }
  if (asked.includes('gzip')) {
    return 'gzip';
  }
  return 'identity';
}

/**
 * The bytes as that coding.
 *
 * @param {Uint8Array} identity
 * @param {'identity' | 'gzip' | 'br'} coding
 * @returns {Uint8Array}
 */
export function encode(identity, coding) {
  if (coding === 'gzip') {
    return gzipSync(Buffer.from(identity));
  }
  if (coding === 'br') {
    return brotliCompressSync(Buffer.from(identity));
  }
  return identity;
}

/**
 * The route the conformant deployment answers with.
 *
 * @param {import('./deployment.mjs').Deployment} deployment
 * @returns {(request: import('./origin.mjs').FixtureRequest) => import('./origin.mjs').FixtureResponse}
 */
export function conformantRoute(deployment) {
  const { apiOrigin } = deployment;

  return (request) => {
    // The entry point answers at two URLs and is one object. `/` is a serving
    // alias: same bytes, same classification, same identifier.
    const path = request.path === '/' ? '/index.html' : request.path;
    const object = deployment.objects.find((one) => one.path === path) ?? null;

    if (object === null) {
      return {
        status: 404,
        reason: 'Not Found',
        headers: [...baseFields(apiOrigin, NO_STORE), ['content-type', 'text/plain; charset=utf-8']],
        body: new TextEncoder().encode('not found'),
      };
    }

    // A query with something in it is answered non-cacheable. A bare `?` is not
    // a query with something in it, and the two are separate readings here for
    // the same reason they are separate fields on an observation.
    const carriesQuery = request.hasQuery && request.query.length > 0;
    const keepable = object.asset && !carriesQuery;
    const cache = keepable ? IMMUTABLE : NO_STORE;

    const validator = request.headers.find((field) => field.name === 'if-none-match')?.value ?? null;
    if (validator !== null && validator === object.etag) {
      // With a length, and the length of the object itself. A 304 sends no body
      // and the field is not about this response — it describes the
      // representation the browser is being told it already holds — so an origin
      // that carries it is doing something ordinary, and a check that compared
      // it against the nothing that was sent would refuse this deployment for
      // being right. Serving it here is what keeps that reading honest.
      return {
        status: 304,
        reason: 'Not Modified',
        headers: [...baseFields(apiOrigin, cache), ['etag', object.etag], ['content-length', String(object.bytes.length)]],
        body: null,
      };
    }

    const coding = negotiate(request);
    const body = encode(object.bytes, coding);
    /** @type {[string, string][]} */
    const fields = [
      ...baseFields(apiOrigin, cache),
      ['content-type', object.contentType],
      ['etag', object.etag],
      ['accept-ranges', 'bytes'],
    ];
    if (coding !== 'identity') {
      fields.push(['content-encoding', coding]);
      // A response whose bytes depend on what the request asked for has to say
      // so, or a cache in front of it hands one client's coding to another.
      fields.push(['vary', 'Accept-Encoding']);
    }
    return { status: 200, reason: 'OK', headers: fields, body };
  };
}

/**
 * One route with its answers passed through a transform.
 *
 * @param {(request: import('./origin.mjs').FixtureRequest) => import('./origin.mjs').FixtureResponse} route
 * @param {(response: import('./origin.mjs').FixtureResponse, request: import('./origin.mjs').FixtureRequest) => import('./origin.mjs').FixtureResponse} transform
 * @returns {(request: import('./origin.mjs').FixtureRequest) => import('./origin.mjs').FixtureResponse}
 */
export function withTransform(route, transform) {
  return (request) => transform(route(request), request);
}

/**
 * A response with one field removed.
 *
 * @param {import('./origin.mjs').FixtureResponse} response
 * @param {string} name
 * @returns {import('./origin.mjs').FixtureResponse}
 */
export function withoutField(response, name) {
  return { ...response, headers: response.headers.filter(([field]) => field.toLowerCase() !== name) };
}

/**
 * A response with a field added at the end.
 *
 * @param {import('./origin.mjs').FixtureResponse} response
 * @param {string} name
 * @param {string} value
 * @returns {import('./origin.mjs').FixtureResponse}
 */
export function withField(response, name, value) {
  return { ...response, headers: [...response.headers, [name, value]] };
}

/**
 * A response carrying different bytes, framed by whatever the origin works out.
 *
 * Any `Content-Length` the response named is dropped, so that the length on the
 * wire is the length of what is there. A fixture about the wrong bytes and a
 * fixture about the wrong length are different fixtures, and one that was both
 * would be neither.
 *
 * @param {import('./origin.mjs').FixtureResponse} response
 * @param {Uint8Array} body
 * @returns {import('./origin.mjs').FixtureResponse}
 */
export function replacingBody(response, body) {
  return { ...response, headers: response.headers.filter(([name]) => name.toLowerCase() !== 'content-length'), body };
}

/**
 * A route that answers a conditional request with a whole response instead of a
 * `304`, carrying bytes of the caller's choosing.
 *
 * The response is the one this route would have given the same request without
 * its validator, with the body swapped — so every field on it is the field a
 * conformant origin would have sent and the only thing wrong with it is what it
 * is a fixture about. Built by asking the route a second question rather than by
 * assembling a response here, because a response assembled beside the route is a
 * response that stops resembling it the moment either changes.
 *
 * @param {(request: import('./origin.mjs').FixtureRequest) => import('./origin.mjs').FixtureResponse} route
 * @param {(request: import('./origin.mjs').FixtureRequest) => boolean} matches
 * @param {Uint8Array} body
 * @returns {(request: import('./origin.mjs').FixtureRequest) => import('./origin.mjs').FixtureResponse}
 */
export function answeringConditionalWith(route, matches, body) {
  const validators = ['if-none-match', 'if-modified-since'];
  return (request) => {
    const conditional = request.headers.some((field) => validators.includes(field.name));
    if (!conditional || !matches(request)) {
      return route(request);
    }
    return replacingBody(route({ ...request, headers: request.headers.filter((field) => !validators.includes(field.name)) }), body);
  };
}

/**
 * A response with one field's name spelled differently.
 *
 * For the fixtures about the head as a sequence of lines rather than as a set of
 * fields: a name with a space before its colon is a line a reader may not tidy
 * up into the field it resembles, and the only way to serve one is to write the
 * name that way.
 *
 * @param {import('./origin.mjs').FixtureResponse} response
 * @param {string} name
 * @param {string} spelling
 * @returns {import('./origin.mjs').FixtureResponse}
 */
export function renamingField(response, name, spelling) {
  return {
    ...response,
    headers: response.headers.map(([field, value]) =>
      field.toLowerCase() === name ? /** @type {[string, string]} */ ([spelling, value]) : /** @type {[string, string]} */ ([field, value]),
    ),
  };
}

/**
 * The same response, framed as a chunked message.
 *
 * One chunk and then the zero-length chunk, followed by a trailer section that
 * is empty unless the caller asks for a field in it. Both directions are
 * fixtures: a chunked message always has a trailer section and an empty one is
 * ordinary, and a field in it is a field that arrives after everything reading
 * the head has finished — which is where a header that would have been refused
 * can be put by somebody who has read the check.
 *
 * Two parts of the framing are the caller's to spell, because both are things a
 * fixture is about. How the zero-length chunk is written is one: a size is a hex
 * number and `00` is the same number as `0`, so a message ending either way has
 * ended and a reader that accepts only one spelling refuses a sender for a
 * choice the framing leaves open. What follows a chunk's data is the other: the
 * framing requires exactly a CRLF there, and a fixture that puts something else
 * is the only way to show that the requirement is enforced rather than assumed.
 *
 * @param {import('./origin.mjs').FixtureResponse} response
 * @param {readonly (readonly [string, string])[]} [trailer]
 * @param {object} [how]
 * @param {string} [how.zero] How the zero-length chunk's size is spelled.
 * @param {string} [how.afterChunkData] What follows the chunk's data.
 * @returns {import('./origin.mjs').FixtureResponse}
 */
export function asChunked(response, trailer = [], { zero = '0', afterChunkData = '\r\n' } = {}) {
  const body = response.body === null ? new Uint8Array(0) : response.body;
  /** @type {Buffer[]} */
  const framed = [];
  if (body.length > 0) {
    framed.push(
      Buffer.from(`${body.length.toString(16)}\r\n`, 'latin1'),
      Buffer.from(body),
      Buffer.from(afterChunkData, 'latin1'),
    );
  }
  framed.push(Buffer.from(`${zero}\r\n`, 'latin1'));
  for (const [name, value] of trailer) {
    framed.push(Buffer.from(`${name}: ${value}\r\n`, 'latin1'));
  }
  framed.push(Buffer.from('\r\n', 'latin1'));
  return {
    ...response,
    headers: [
      ...response.headers.filter(([name]) => name.toLowerCase() !== 'content-length'),
      /** @type {[string, string]} */ (['transfer-encoding', 'chunked']),
    ],
    body: Buffer.concat(framed),
  };
}

/**
 * The same response with octets after it that its framing does not account for.
 *
 * Appended to the body the origin writes, which is what puts them on the
 * connection after the message rather than inside it: a chunked message says
 * where it ends, so anything written past that point is not part of it whatever
 * it happens to look like.
 *
 * @param {import('./origin.mjs').FixtureResponse} response
 * @param {Uint8Array} octets
 * @returns {import('./origin.mjs').FixtureResponse}
 */
export function followedBy(response, octets) {
  return { ...response, body: response.body === null ? octets : new Uint8Array([...response.body, ...octets]) };
}

/**
 * The same bytes as a gzip stream that stores rather than compresses them.
 *
 * A representation of the same object — it decodes to exactly these bytes — and
 * a different number of octets from any of the three codings the encoding arms
 * ask for, because storing adds the format's overhead where compressing removes
 * more than it. That is what makes it usable as a length no representation arm
 * of this run was served at.
 *
 * @param {Uint8Array} identity
 * @returns {Uint8Array}
 */
export function encodeStored(identity) {
  return gzipSync(Buffer.from(identity), { level: 0 });
}

/**
 * A response with one field's value replaced wherever it appears.
 *
 * @param {import('./origin.mjs').FixtureResponse} response
 * @param {string} name
 * @param {string} value
 * @returns {import('./origin.mjs').FixtureResponse}
 */
export function replacingField(response, name, value) {
  return {
    ...response,
    headers: response.headers.map(([field, was]) =>
      field.toLowerCase() === name ? /** @type {[string, string]} */ ([field, value]) : /** @type {[string, string]} */ ([field, was]),
    ),
  };
}
