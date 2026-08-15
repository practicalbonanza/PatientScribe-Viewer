/**
 * An origin that answers however a fixture says it should.
 *
 * The release check is a set of claims about responses, and a claim that has
 * never been shown refusing anything is indistinguishable from an empty
 * function. So each claim needs an origin that breaks exactly it — one that
 * omits a header, one that serves a 404 with no cache directive, one that
 * answers a bare `?` differently from the canonical request — and every one of
 * those is a response no ordinary server will produce, because ordinary servers
 * are written not to.
 *
 * Hence a server that writes the response itself. Status line, every field in
 * the order and with the repetition the fixture asked for, any interim responses
 * ahead of it, and the body exactly as handed over. Nothing is normalised,
 * nothing is added that the fixture did not ask for except a `Content-Length`
 * where a fixture did not name one, and no field is refused for being wrong —
 * being wrong is what most of these fixtures are for.
 *
 * It speaks HTTP/1.1 over a plain socket or a TLS one and closes the connection
 * after each response, which is the same framing the capture client reads and
 * the simplest thing a browser will also accept.
 */

import { createServer as createSocketServer } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';

/**
 * What a fixture hands back.
 *
 * @typedef {object} FixtureResponse
 * @property {number} status
 * @property {string} reason
 * @property {readonly (readonly [string, string])[]} headers Every field, in
 *   order, repetitions included. A pair rather than a map, because half these
 *   fixtures are about a field appearing the wrong number of times.
 * @property {Uint8Array | null} body
 * @property {readonly { status: number, reason: string, headers: readonly (readonly [string, string])[] }[]} [interim]
 * @property {string} [statusLine] The whole first line, for the fixtures that
 *   are about it: a response announcing an older version, or a first line that
 *   is not one at all. Everything else gets the line built from the status and
 *   the reason, which is what a fixture about anything else should not have to
 *   spell.
 * @property {boolean} [closeDelimited] Whether to leave the response saying
 *   nothing about how long its body is. The server names a length for every
 *   response that did not name one itself — a fixture about one thing should not
 *   have to frame the rest — and a body delimited by the connection closing is
 *   the one case where that help is the thing being tested away.
 */

/**
 * What a fixture is asked.
 *
 * @typedef {object} FixtureRequest
 * @property {string} method
 * @property {string} target The request target exactly as it arrived.
 * @property {string} path
 * @property {boolean} hasQuery
 * @property {string} query
 * @property {readonly { name: string, value: string }[]} headers
 */

/**
 * A running fixture origin.
 *
 * @typedef {object} FixtureOrigin
 * @property {number} port
 * @property {() => Promise<void>} close
 * @property {() => readonly FixtureRequest[]} received Every request it was
 *   asked, in order. Read by the browser-driven fixtures, which need to know
 *   what the engine asked for rather than only what it was told.
 */

/**
 * The head of a request, parsed.
 *
 * @param {string} block
 * @returns {FixtureRequest | null}
 */
function parseRequest(block) {
  const lines = block.split('\r\n');
  const [method, target] = (lines[0] ?? '').split(' ');
  if (method === undefined || target === undefined) {
    return null;
  }
  const at = target.indexOf('?');
  /** @type {{ name: string, value: string }[]} */
  const headers = [];
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      headers.push({ name: line.slice(0, colon).trim().toLowerCase(), value: line.slice(colon + 1).trim() });
    }
  }
  return {
    method,
    target,
    path: at < 0 ? target : target.slice(0, at),
    hasQuery: at >= 0,
    query: at < 0 ? '' : target.slice(at + 1),
    headers,
  };
}

/**
 * A response, as bytes.
 *
 * @param {FixtureResponse} response
 * @returns {Buffer}
 */
function responseBytes(response) {
  // Written by concatenation rather than by joining a list of lines. A list
  // joined on the separator needs one empty element to end a block and produces
  // one separator too many when another block follows it — which put a blank
  // line between an interim response and the response, and left every reading of
  // the second one a line out of step while the first parsed perfectly.
  let head = '';
  for (const one of response.interim ?? []) {
    head += `HTTP/1.1 ${one.status} ${one.reason}\r\n`;
    for (const [name, value] of one.headers) {
      head += `${name}: ${value}\r\n`;
    }
    head += '\r\n';
  }
  head += `${response.statusLine ?? `HTTP/1.1 ${response.status} ${response.reason}`}\r\n`;
  const named = response.headers.map(([name]) => name.trim().toLowerCase());
  for (const [name, value] of response.headers) {
    head += `${name}: ${value}\r\n`;
  }
  if (response.closeDelimited !== true && !named.includes('content-length') && !named.includes('transfer-encoding')) {
    head += `content-length: ${response.body === null ? 0 : response.body.length}\r\n`;
  }
  head += '\r\n';
  return Buffer.concat([
    Buffer.from(head, 'latin1'),
    response.body === null ? Buffer.alloc(0) : Buffer.from(response.body),
  ]);
}

/**
 * Start an origin that answers with whatever `route` returns.
 *
 * @param {object} how
 * @param {number} how.port
 * @param {(request: FixtureRequest) => FixtureResponse} how.route
 * @param {{ key: string, cert: string } | null} [how.tls]
 * @returns {Promise<FixtureOrigin>}
 */
export function startFixtureOrigin({ port, route, tls = null }) {
  /** @type {FixtureRequest[]} */
  const received = [];

  /** @param {import('node:net').Socket} socket */
  const handle = (socket) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let answered = false;
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk) => {
      if (answered) {
        return;
      }
      chunks.push(Buffer.from(chunk));
      const all = Buffer.concat(chunks);
      const end = all.indexOf('\r\n\r\n', 0, 'latin1');
      if (end < 0) {
        return;
      }
      answered = true;
      const request = parseRequest(all.subarray(0, end).toString('latin1'));
      if (request === null) {
        socket.destroy();
        return;
      }
      received.push(request);
      socket.end(responseBytes(route(request)));
    });
  };

  const server = tls === null ? createSocketServer(handle) : createTlsServer({ key: tls.key, cert: tls.cert }, handle);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // 127.0.0.1 and nothing else. A fixture that listened on every interface
    // would be a fixture reachable from off this machine, which is a different
    // thing from a fixture.
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port,
        received: () => received,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
