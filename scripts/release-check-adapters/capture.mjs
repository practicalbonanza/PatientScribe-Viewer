/**
 * Reading a response as it arrives on the wire.
 *
 * Every convenient HTTP client folds a response into a shape that is easier to
 * use and impossible to check. Header fields become a map, so two policies
 * become one; interim responses are consumed and discarded, so an origin sending
 * early hints looks exactly like an origin sending none; and bodies arrive
 * already decoded, so a body whose declared coding does not apply arrives as an
 * exception from somewhere else or as bytes with the failure smoothed over. Each
 * of those is the same defect: the client decided what the response meant before
 * anything could ask what it said.
 *
 * So this reads a response two ways at once, and both of them are kept.
 *
 * The first is the host's own HTTP/1.1 parser, in its strict mode, with every
 * shape it exposes asked for by name: each field occurrence separately rather
 * than a map, each interim response as its own record, the trailer section of a
 * chunked message as its own list, and the response's own version. A parser is
 * exactly the wrong thing to write twice — the reason a hand-rolled one is
 * tempting is that it can be made to expose whatever a check wants, and the
 * reason it is a mistake is that everything it does not refuse becomes something
 * this check accepts. So the framing is read by the parser that has been shown
 * strict about framing, and where it does not police a rule this check needs, the
 * rule is enforced here, on top, from the bytes rather than from the parse.
 *
 * The second is the bytes themselves. Every octet that arrives on the connection
 * is kept, in order, exactly as it arrived, and every refusal below quotes from
 * that transcript rather than from anything a reading of it produced. That is
 * what makes a refusal about the origin rather than about the client: the wire
 * said this, and here it is. It is also the only way to see the one thing a
 * client cannot report, because to a client it is not part of the response at
 * all — octets on the connection beyond the message that was framed. A second
 * response after the first is the interesting case: the request asked for the
 * connection to be closed, so anything after the message is something nobody
 * asked for, and a client that reads it as the next response on a connection
 * reports the first one and says nothing.
 *
 * What the accepted shape is, exactly, is written in `RELEASE-CHECK.md`. What is
 * enforced here rather than by the parser is: the response's version, the choice
 * of body framing, what an interim response declares about framing it does not
 * have, the trailer section, and the octets beyond the message.
 *
 * And what cannot be read, it says. A response the parser refuses is a typed
 * refusal quoting what arrived, never a silent drop and never an empty buffer
 * standing in for a body — because every way of leaving that out produces a
 * response that looks better than the one that arrived.
 *
 * It speaks HTTP/1.1 and nothing else, and it asks for the connection to be
 * closed after each response. Both are deliberate. A multiplexed protocol hides
 * the framing this is reading, and a reused connection makes the second response
 * on it depend on how the first was parsed — neither of which is a property this
 * check wants its measurements to have. The cost is a connection per request,
 * which against an origin under test is not a cost.
 *
 * TLS is verified. `rejectUnauthorized` is on, the server name is sent, and the
 * certificate is checked against it — because a client that skips verification
 * measures an origin it cannot name, and the whole point of measuring a release
 * is knowing which origin served it. The one seam is a trust anchor the caller
 * may add, which is what lets a fixture on loopback present a certificate minted
 * for the run. Adding an anchor is not the same as switching verification off:
 * a fixture certificate that does not match the name is still refused.
 */

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect } from 'node:net';
import { Duplex } from 'node:stream';
import { connect as tlsConnect } from 'node:tls';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

/**
 * Where to send a request, and how to be sure of who answered.
 *
 * @typedef {object} Target
 * @property {'http' | 'https'} scheme
 * @property {string} address The address to connect to. Always a literal; this
 *   client resolves no names.
 * @property {number} port
 * @property {string} authority What goes in the `Host` field, and what the
 *   certificate is checked against.
 * @property {string | null} trustAnchor A PEM certificate to trust in addition
 *   to the system anchors, for a fixture. `null` everywhere else.
 */

/**
 * What to ask for.
 *
 * @typedef {object} Ask
 * @property {string} arm
 * @property {string} method
 * @property {string} path
 * @property {boolean} hasQuery
 * @property {string} query
 * @property {readonly import('../release-check-core/observation.mjs').HeaderField[]} headers
 */

/**
 * How long to wait for a response before calling it a failure.
 *
 * A capture that hangs is a check that never answers, which in a gate is worse
 * than a check that refuses: a refusal is read and a hang is killed by whatever
 * is running it, with no record of what it was doing.
 */
const TIMEOUT_MS = 15_000;

/**
 * How long to keep listening after the message is complete, where the origin
 * left the connection open.
 *
 * The request asks for the connection to be closed, so the ordinary end of an
 * exchange is the origin closing it, and that is what says the transcript is
 * everything. An origin that leaves it open has not done what the request asked;
 * this waits a moment for anything else it means to send, and then reads the
 * transcript as it stands rather than holding the whole run against one
 * connection nobody is going to close.
 */
const LINGER_MS = 250;

/**
 * What ends a block of head.
 */
const HEAD_TERMINATOR = '\r\n\r\n';

/**
 * What ends a line of framing.
 */
const LINE_TERMINATOR = '\r\n';

/**
 * The version this check speaks, and the only one it accepts back.
 */
const EXPECTED_VERSION = '1.1';

/**
 * The one transfer coding a response may use, spelled exactly.
 */
const CHUNKED = 'chunked';

/**
 * A chunk-size line, read as a size.
 *
 * The line is hex digits and then, optionally, a semicolon and an extension the
 * sender may put anything printable in. What is read here is the digits: the
 * extension is skipped as the framing it is, never looked into. Any spelling of
 * a number is the number — `0` and `00` are both the zero-length chunk, which is
 * a thing a sender may write either way and neither of which says anything about
 * the message.
 *
 * @param {string} line
 * @returns {number} The size, or `-1` where the line is not a chunk-size line.
 */
function chunkSize(line) {
  const extension = line.indexOf(';');
  const digits = extension < 0 ? line : line.slice(0, extension);
  if (digits.length === 0 || !/^[0-9a-fA-F]+$/.test(digits)) {
    return -1;
  }
  return Number.parseInt(digits, 16);
}

/**
 * Where a chunked message ends in the octets that carried it.
 *
 * Arithmetic, and deliberately only that. Each chunk says how long it is, so the
 * data after it is skipped by that count rather than searched for anything —
 * which is the whole reason this is not written as a pattern. A pattern anchored
 * at the end of the region calls a second message's terminator this message's
 * and reads two responses as one; a pattern that takes the first terminator it
 * finds calls a run of bytes inside a chunk of compressed data the end of the
 * message. Neither can tell framing from content, because both are looking at
 * content. Counting cannot make that mistake: what is skipped by a size is never
 * read.
 *
 * Nothing here reads a field, a trailer's value, or an octet of data. The trailer
 * section is walked as lines to find the blank one that closes it, and what the
 * lines say is the parser's business and is refused there. This answers exactly
 * one question — where the message stops — and the answer feeds exactly one
 * reading: whether anything came after it.
 *
 * @param {Buffer} region The octets after the head.
 * @returns {number} The offset just past the message's last octet, or `-1` where
 *   these octets are not a chunked message this can account for.
 */
function chunkedMessageEnd(region) {
  let at = 0;
  for (;;) {
    const lineEnd = region.indexOf(LINE_TERMINATOR, at, 'latin1');
    if (lineEnd < 0) {
      return -1;
    }
    const size = chunkSize(region.subarray(at, lineEnd).toString('latin1'));
    if (size < 0) {
      return -1;
    }
    at = lineEnd + LINE_TERMINATOR.length;
    if (size === 0) {
      break;
    }
    const dataEnd = at + size;
    if (dataEnd + LINE_TERMINATOR.length > region.length) {
      return -1;
    }
    if (region.subarray(dataEnd, dataEnd + LINE_TERMINATOR.length).toString('latin1') !== LINE_TERMINATOR) {
      return -1;
    }
    at = dataEnd + LINE_TERMINATOR.length;
  }
  // The trailer section: zero or more field lines, and then the blank line that
  // ends the message. Counted as lines, for the same reason as above.
  for (;;) {
    const lineEnd = region.indexOf(LINE_TERMINATOR, at, 'latin1');
    if (lineEnd < 0) {
      return -1;
    }
    if (lineEnd === at) {
      return at + LINE_TERMINATOR.length;
    }
    at = lineEnd + LINE_TERMINATOR.length;
  }
}

/**
 * Which typed refusal each parser refusal is.
 *
 * The parser answers with a code, and each code is a defect this check already
 * has a name for. The mapping is written out rather than derived from the
 * message text: a message is prose that a host may reword, and a check whose
 * refusals are attributed by matching prose is a check that stops attributing
 * them after an upgrade.
 *
 * Anything not on this list is a response that could not be read for a reason
 * nothing here has anticipated, which is refused under its own name rather than
 * mapped onto the nearest one.
 *
 * @type {Readonly<Record<string, import('../release-check-core/observation.mjs').CaptureFailure['kind']>>}
 */
const PARSER_REFUSALS = Object.freeze({
  HPE_INVALID_HEADER_TOKEN: 'header-line',
  HPE_UNEXPECTED_CONTENT_LENGTH: 'body-length',
  HPE_INVALID_CONTENT_LENGTH: 'body-length',
  HPE_INVALID_CHUNK_SIZE: 'body-framing',
  HPE_STRICT: 'body-framing',
});

/**
 * Does a response with this status carry a body at all?
 *
 * Read from the status rather than from what the response says about itself. An
 * interim response, a 204 and a 304 each say that nothing is being sent, so
 * whatever follows the head of one is not a body it framed.
 *
 * @param {number} status
 * @returns {boolean}
 */
function carriesNoBody(status) {
  return (status >= 100 && status < 200) || status === 204 || status === 304;
}

/**
 * A run of octets, as something a refusal can quote.
 *
 * Long enough to see what arrived and bounded so that a refusal is readable: a
 * message that carries a megabyte of body is a message nobody reads the refusal
 * of.
 *
 * @param {Uint8Array} bytes
 * @param {number} [limit]
 * @returns {string}
 */
function quoteOctets(bytes, limit = 300) {
  const shown = Buffer.from(bytes.subarray(0, limit)).toString('latin1');
  return bytes.length > limit ? `${JSON.stringify(shown)} (${bytes.length} octet(s) in all)` : JSON.stringify(shown);
}

/**
 * Where the final response's body begins in the transcript.
 *
 * Counted rather than parsed: a head ends at the first blank line, a field value
 * cannot contain one — a continuation that tried to would be the obsolete
 * folding the parser refuses — and an interim response has no body, so the body
 * of the final response begins after as many blank lines as there were heads.
 * How many heads there were is the parser's own answer, not a guess made here.
 *
 * @param {Buffer} transcript
 * @param {number} heads How many response heads arrived, interim ones included.
 * @returns {number} The offset, or `-1` where that many heads are not there.
 */
function bodyOffset(transcript, heads) {
  let at = 0;
  for (let seen = 0; seen < heads; seen += 1) {
    const end = transcript.indexOf(HEAD_TERMINATOR, at, 'latin1');
    if (end < 0) {
      return -1;
    }
    at = end + HEAD_TERMINATOR.length;
  }
  return at;
}

/**
 * Field occurrences, from the parser's own record of them.
 *
 * Every occurrence, in the order received, name and value separately — which is
 * what `rawHeaders` is and is the reason it is what this reads. The name is
 * lowercased because field names are case-insensitive on the wire, and nothing
 * else is done to either half.
 *
 * @param {readonly string[]} raw
 * @returns {import('../release-check-core/observation.mjs').HeaderField[]}
 */
function fieldsFrom(raw) {
  /** @type {import('../release-check-core/observation.mjs').HeaderField[]} */
  const fields = [];
  for (let at = 0; at + 1 < raw.length; at += 2) {
    fields.push({ name: String(raw[at]).toLowerCase(), value: String(raw[at + 1]).trim() });
  }
  return fields;
}

/**
 * The connection under the client, and the transcript taken off it.
 *
 * The parser is given this rather than the socket, for one reason: handed a
 * socket, the host's client reads it below the level anything in JavaScript can
 * see, and the bytes that arrive are then only ever visible as the reading the
 * parser made of them. Handed a stream, it reads the stream — and the stream is
 * where every octet is copied into the transcript on its way past, before the
 * parser has seen any of it.
 *
 * Nothing here interprets a byte. It is a pipe with a tap on it.
 */
class TranscriptStream extends Duplex {
  /**
   * @param {import('node:net').Socket} connection
   * @param {Buffer[]} transcript
   */
  constructor(connection, transcript) {
    super();
    this.connection = connection;
    this.ended = false;
    connection.on('data', (chunk) => {
      transcript.push(Buffer.from(chunk));
      if (!this.push(chunk)) {
        connection.pause();
      }
    });
    const finish = () => {
      if (!this.ended) {
        this.ended = true;
        this.push(null);
      }
    };
    connection.on('end', finish);
    connection.on('close', finish);
  }

  /** @override */
  _read() {
    this.connection.resume();
  }

  /**
   * @override
   * @param {any} chunk
   * @param {any} encoding
   * @param {(error?: Error | null) => void} done
   */
  _write(chunk, encoding, done) {
    this.connection.write(chunk, encoding, done);
  }

  /**
   * @override
   * @param {(error?: Error | null) => void} done
   */
  _final(done) {
    this.connection.end();
    done();
  }

  /**
   * @override
   * @param {Error | null} error
   * @param {(error?: Error | null) => void} done
   */
  _destroy(error, done) {
    this.connection.destroy();
    done(error);
  }

  /** The client asks a socket for these; a stream is not one, and none of them is a thing this needs. */
  setTimeout() {
    return this;
  }

  setNoDelay() {
    return this;
  }

  setKeepAlive() {
    return this;
  }
}

/**
 * Open a connection to a target.
 *
 * @param {Target} target
 * @returns {import('node:net').Socket}
 */
function openConnection(target) {
  if (target.scheme === 'http') {
    return netConnect({ host: target.address, port: target.port });
  }
  return tlsConnect({
    host: target.address,
    port: target.port,
    servername: target.authority.split(':')[0] ?? target.authority,
    ...(target.trustAnchor === null ? {} : { ca: [target.trustAnchor] }),
    rejectUnauthorized: true,
  });
}

/**
 * Remove the content codings a response declares, in the order that undoes them.
 *
 * @param {Buffer} raw
 * @param {readonly string[]} codings
 * @returns {{ decoded: Uint8Array | null, failure: string | null }}
 */
function decodeBody(raw, codings) {
  let bytes = raw;
  for (const coding of [...codings].reverse()) {
    try {
      if (coding === 'identity') {
        continue;
      } else if (coding === 'gzip' || coding === 'x-gzip') {
        bytes = gunzipSync(bytes);
      } else if (coding === 'br') {
        bytes = brotliDecompressSync(bytes);
      } else if (coding === 'deflate') {
        bytes = inflateSync(bytes);
      } else {
        return { decoded: null, failure: `${coding} is a coding this client cannot remove` };
      }
    } catch (error) {
      return { decoded: null, failure: `${coding} did not decode: ${error instanceof Error ? error.message : 'unknown'}` };
    }
  }
  return { decoded: bytes, failure: null };
}

/**
 * Everything about a response that could not be accounted for, decided from the
 * head the parser read and the octets the connection carried.
 *
 * The rules here are the ones the parser does not enforce, and each of them is a
 * way for a response to be read as sounder than it was.
 *
 * A version is one of them because a parser that accepts an older version is a
 * parser reading a message whose framing rules are not the ones this check
 * assumes.
 *
 * What the interim responses declare is another. An interim response sends no
 * body, so it frames none: a `Content-Length` or a `Transfer-Encoding` on one is
 * a message saying how long something is that is not being sent. A client reads
 * an interim response for its fields and hands them over; what the fields claim
 * about framing is nobody's reading unless it is taken here.
 *
 * The choice of framing is another. Exactly one of the two framings, and no
 * others: a body with neither a length nor a coding is delimited by the
 * connection closing, which is a body whose completeness cannot be distinguished
 * from a body that was cut off, and a transfer coding that is not the terminal
 * `chunked` is a body framed by something this client is not reading.
 *
 * The trailer section is the third. It always exists on a chunked message and it
 * may be empty; a field in it is a field arriving after the head, which is where
 * a header that would have been refused can be put by somebody who has read the
 * check.
 *
 * And the octets beyond the message are the fourth. The request asked for the
 * connection to be closed, so a second response on it is not the next response —
 * it is something the origin sent that nothing asked for, and which framing it
 * belongs to is not a question with an answer. Judged against the length the
 * message declared, which is where a client stops reading and a transcript does
 * not.
 *
 * @param {object} what
 * @param {Buffer} what.transcript
 * @param {number} what.status
 * @param {string} what.version
 * @param {readonly import('../release-check-core/observation.mjs').HeaderField[]} what.headers
 * @param {readonly import('../release-check-core/observation.mjs').Interim[]} what.interim
 * @param {readonly string[]} what.trailers
 * @param {number} what.heads
 * @param {boolean} what.completed Whether the parser read the message to its end.
 * @returns {{ failures: import('../release-check-core/observation.mjs').CaptureFailure[], bodyOctets: Uint8Array | null }}
 */
function accountForTheWire({ transcript, status, version, headers, interim, trailers, heads, completed }) {
  /** @type {import('../release-check-core/observation.mjs').CaptureFailure[]} */
  const failures = [];

  if (version !== EXPECTED_VERSION) {
    failures.push({
      kind: 'http-version',
      detail: `the response is HTTP/${version} and this check speaks HTTP/${EXPECTED_VERSION}: ${quoteOctets(transcript.subarray(0, 64))}`,
    });
  }

  for (const [order, one] of interim.entries()) {
    const framing = one.headers.filter((field) => field.name === 'content-length' || field.name === 'transfer-encoding');
    if (framing.length === 0) {
      continue;
    }
    // The interim's own head, quoted from the transcript: it is the response
    // between the one before it and the one after, and the heads are counted the
    // same way the body's start is.
    const from = bodyOffset(transcript, order);
    const to = bodyOffset(transcript, order + 1);
    failures.push({
      kind: 'framing-choice',
      detail: `the interim ${one.status} response declared ${framing
        .map((field) => `${field.name}: ${JSON.stringify(field.value)}`)
        .join(', ')}, and a response that sends no body frames none: ${
        from < 0 || to < 0 ? quoteOctets(transcript) : quoteOctets(transcript.subarray(from, to))
      }`,
    });
  }

  const at = bodyOffset(transcript, heads);
  if (at < 0) {
    failures.push({
      kind: 'unreadable',
      detail: `the head the parser read is not in the octets that arrived: ${quoteOctets(transcript)}`,
    });
    return { failures, bodyOctets: null };
  }

  const after = transcript.subarray(at);
  const lengths = headers.filter((field) => field.name === 'content-length');
  const codings = headers.filter((field) => field.name === 'transfer-encoding');
  const declared = lengths.length === 1 ? Number.parseInt(String(lengths[0]?.value), 10) : Number.NaN;

  if (trailers.length > 0) {
    /** @type {string[]} */
    const named = [];
    for (let one = 0; one + 1 < trailers.length; one += 2) {
      named.push(`${trailers[one]}: ${trailers[one + 1]}`);
    }
    failures.push({
      kind: 'trailer-field',
      detail: `the chunked message carried ${named.length} trailer field(s) — ${named.join('; ')} — and a field after the head is a field the head did not carry; the message ended ${quoteOctets(
        after.subarray(Math.max(0, after.length - 160)),
      )}`,
    });
  }

  if (carriesNoBody(status)) {
    // A `Content-Length` on one of these is not compared against the octets that
    // arrived, and that is the whole point of separating them. A 304 says the
    // browser already holds the representation; the field describes that
    // representation rather than this response, and comparing it against the
    // nothing that was sent refuses an origin for being correct. What the field
    // may say is judged where the representations it could be describing are
    // known, which is not here.
    if (codings.length > 0) {
      failures.push({
        kind: 'framing-choice',
        detail: `a ${status} declared ${codings
          .map((field) => JSON.stringify(field.value))
          .join(', ')} as a transfer coding, and a response that sends no body frames none: ${quoteOctets(transcript.subarray(0, at))}`,
      });
    }
    if (after.length === 0) {
      return { failures, bodyOctets: null };
    }
    if (status === 304) {
      // Handed back as the body it is not allowed to have, so that the reading
      // which refuses a 304 with bytes is the one that refuses this rather than
      // a reading about framing that would name a different defect.
      return { failures, bodyOctets: after };
    }
    failures.push({
      kind: 'framing-choice',
      detail: `a ${status} carries no body and ${after.length} octet(s) followed its head: ${quoteOctets(after)}`,
    });
    return { failures, bodyOctets: null };
  }

  if (codings.length > 0 && lengths.length > 0) {
    failures.push({
      kind: 'framing-choice',
      detail: `the response declared both a transfer coding and a length: ${quoteOctets(transcript.subarray(0, at))}`,
    });
    return { failures, bodyOctets: null };
  }

  if (codings.length > 1) {
    failures.push({
      kind: 'framing-choice',
      detail: `the response carried ${codings.length} Transfer-Encoding field(s) — ${codings
        .map((field) => JSON.stringify(field.value))
        .join(', ')} — and one framing is one field: ${quoteOctets(transcript.subarray(0, at))}`,
    });
    return { failures, bodyOctets: null };
  }

  if (codings.length === 1) {
    const value = String(codings[0]?.value).toLowerCase();
    if (value !== CHUNKED) {
      failures.push({
        kind: 'framing-choice',
        detail: `the transfer coding is ${JSON.stringify(
          String(codings[0]?.value),
        )}, and the only one this check reads is the single terminal ${CHUNKED}: ${quoteOctets(transcript.subarray(0, at))}`,
      });
      return { failures, bodyOctets: null };
    }
    if (!completed) {
      failures.push({
        kind: 'body-framing',
        detail: `the chunked framing did not reach its end: ${after.length} octet(s) arrived after the head and then the connection did — ${quoteOctets(after)}`,
      });
      return { failures, bodyOctets: null };
    }
    const end = chunkedMessageEnd(after);
    if (end < 0) {
      failures.push({
        kind: 'body-framing',
        detail: `the octets after the head are not a chunked message that can be accounted for: ${quoteOctets(after)}`,
      });
    } else if (end < after.length) {
      failures.push({
        kind: 'body-framing',
        detail: `the chunked message ends after ${end} octet(s) and ${after.length} arrived, so ${
          after.length - end
        } octet(s) followed it: ${quoteOctets(after.subarray(end))}`,
      });
    }
    return { failures, bodyOctets: null };
  }

  if (lengths.length === 0) {
    failures.push({
      kind: 'framing-choice',
      detail: `the response declared neither a length nor a transfer coding, so its body ran to the end of the connection: ${after.length} octet(s) arrived — ${quoteOctets(after)}`,
    });
    return { failures, bodyOctets: null };
  }

  if (!Number.isInteger(declared) || declared < 0) {
    failures.push({
      kind: 'body-length',
      detail: `Content-Length is ${JSON.stringify(String(lengths[0]?.value))}, which is not a count of octets; ${after.length} octet(s) arrived after the head`,
    });
    return { failures, bodyOctets: null };
  }

  if (!completed || after.length !== declared) {
    // Both directions, and both of them quote. Fewer octets than declared is a
    // body that was cut off; more is octets on the connection that the message
    // does not account for, whether they are noise or a whole second response —
    // and a reader that takes the first `declared` of them and stops is a reader
    // that has chosen which of two framings to believe. What is quoted differs
    // because what is worth seeing differs: past the declared length it is what
    // followed the message, and short of it there is no message to have followed,
    // so it is everything that arrived.
    failures.push({
      kind: 'body-length',
      detail: `Content-Length says ${declared} and ${after.length} octet(s) arrived after the head; ${
        after.length > declared
          ? `what followed the message was ${quoteOctets(after.subarray(declared))}`
          : `what arrived was ${quoteOctets(after)}`
      }`,
    });
  }

  return { failures, bodyOctets: null };
}

/**
 * Issue one request and read what comes back.
 *
 * @param {Target} target
 * @param {Ask} ask
 * @returns {Promise<import('../release-check-core/observation.mjs').Observation>}
 */
export function capture(target, ask) {
  return new Promise((resolve, reject) => {
    const connection = openConnection(target);
    /** @type {Buffer[]} */
    const received = [];
    const stream = new TranscriptStream(connection, received);

    /** @type {import('../release-check-core/observation.mjs').Interim[]} */
    const interim = [];
    /** @type {Buffer[]} */
    const body = [];
    /** @type {{ status: number, version: string, headers: import('../release-check-core/observation.mjs').HeaderField[] } | null} */
    let head = null;
    /** @type {readonly string[]} */
    let trailers = [];
    /** @type {import('../release-check-core/observation.mjs').CaptureFailure | null} */
    let parserRefusal = null;
    /** @type {Error | null} */
    let transportFailure = null;
    let completed = false;
    let resolved = false;
    let settled = false;
    /** @type {NodeJS.Timeout | null} */
    let linger = null;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (linger !== null) {
        clearTimeout(linger);
      }
      clearTimeout(deadline);
      connection.destroy();

      const transcript = Buffer.concat(received);

      if (head === null) {
        if (parserRefusal === null) {
          reject(
            transportFailure ??
              new Error(`release-check: no response was read from ${target.authority}${ask.path}`),
          );
          return;
        }
        // A response the parser refused to read at all. Nothing about it is
        // reported as a response — there is no status, and a status invented
        // here would be this client saying what the origin answered.
        resolve({
          arm: ask.arm,
          method: ask.method,
          path: ask.path,
          hasQuery: ask.hasQuery,
          query: ask.query,
          requestHeaders: ask.headers,
          status: 0,
          headers: [],
          interim,
          raw: null,
          decoded: null,
          decodeFailure: null,
          captureFailures: [parserRefusal],
        });
        return;
      }

      const { failures, bodyOctets } = accountForTheWire({
        transcript,
        status: head.status,
        version: head.version,
        headers: head.headers,
        interim,
        trailers,
        heads: interim.length + 1,
        completed,
      });

      const raw = bodyOctets === null ? Buffer.concat(body) : Buffer.from(bodyOctets);
      const codings = head.headers
        .filter((field) => field.name === 'content-encoding')
        .flatMap((field) => field.value.split(',').map((token) => token.trim().toLowerCase()))
        .filter((token) => token.length > 0);
      const { decoded, failure } = decodeBody(raw, codings);

      resolve({
        arm: ask.arm,
        method: ask.method,
        path: ask.path,
        hasQuery: ask.hasQuery,
        query: ask.query,
        requestHeaders: ask.headers,
        status: head.status,
        headers: head.headers,
        interim,
        raw,
        decoded,
        decodeFailure: failure,
        captureFailures: failures,
      });
    };

    /**
     * Settle when both halves are in: the exchange the parser saw, and the
     * octets the connection carried. Either alone is half the record — the
     * parser's reading finishes before the connection does, and the octets after
     * the message are exactly the ones that arrive in between.
     */
    const readyToFinish = () => {
      if (!resolved) {
        return;
      }
      if (stream.ended || connection.destroyed) {
        finish();
        return;
      }
      if (linger === null) {
        linger = setTimeout(finish, LINGER_MS);
      }
    };

    const deadline = setTimeout(() => {
      if (!settled) {
        settled = true;
        connection.destroy();
        reject(new Error(`release-check: ${target.authority}${ask.path} did not answer within ${TIMEOUT_MS}ms`));
      }
    }, TIMEOUT_MS);

    connection.setTimeout(TIMEOUT_MS);
    connection.on('timeout', () => connection.destroy());
    connection.on('error', (error) => {
      transportFailure = error;
    });
    connection.on('close', () => readyToFinish());
    connection.on('end', () => readyToFinish());

    const send = target.scheme === 'https' ? httpsRequest : httpRequest;
    /** @type {Record<string, string>} */
    const headers = { Host: target.authority };
    for (const field of ask.headers) {
      headers[field.name] = field.value;
    }
    headers['Connection'] = 'close';

    const request = send({
      createConnection: () => stream,
      method: ask.method,
      path: `${ask.path}${ask.hasQuery ? `?${ask.query}` : ''}`,
      headers,
      setHost: false,
      insecureHTTPParser: false,
    });

    // No cap on how many field occurrences are collected. The default one stops
    // recording past a count and says nothing about having stopped, which is a
    // response whose last fields this check cannot see — and a field nobody can
    // see is a field an origin may carry. The limit on the size of a head stays
    // where the host puts it: a head past it is a refusal, which is the direction
    // that fails closed.
    request.maxHeadersCount = 0;

    request.on('information', (info) => {
      // An interim response is a whole response that arrived before the
      // response. It is kept as its own record rather than merged into the final
      // one: a `Link` in a 103 has already started its fetches by the time the
      // final headers arrive, and folding it in would report an origin that
      // sends early hints as an origin that sends a header.
      interim.push({ status: info.statusCode, headers: fieldsFrom(info.rawHeaders) });
    });

    request.on('error', (error) => {
      const code = /** @type {{ code?: string }} */ (error).code ?? '';
      if (!code.startsWith('HPE_')) {
        // Not a reading of a response: a connection that failed, or ended
        // before one arrived. Recorded, and the exchange is over either way —
        // where a response had already been read this changes nothing about it,
        // and where none had, there is nothing to report but the failure.
        transportFailure = error;
        resolved = true;
        readyToFinish();
        return;
      }
      if (head !== null) {
        // A refusal after the message was complete is the parser being handed
        // whatever followed it. What followed it is in the transcript, and the
        // accounting there names it — reported twice it would be one defect
        // under two names, and the transcript is the one that can say what the
        // octets were.
        resolved = true;
        readyToFinish();
        return;
      }
      parserRefusal = {
        kind: PARSER_REFUSALS[code] ?? 'unreadable',
        detail: `the response could not be read — ${error.message.split('\n')[0]} (${code}) — and what arrived was ${quoteOctets(Buffer.concat(received))}`,
      };
      resolved = true;
      readyToFinish();
    });

    request.on('response', (response) => {
      head = {
        status: response.statusCode ?? 0,
        version: response.httpVersion,
        headers: fieldsFrom(response.rawHeaders),
      };
      response.on('data', (chunk) => body.push(Buffer.from(chunk)));
      response.on('aborted', () => {
        resolved = true;
        readyToFinish();
      });
      response.on('error', () => {
        resolved = true;
        readyToFinish();
      });
      response.on('end', () => {
        completed = true;
        trailers = response.rawTrailers;
        resolved = true;
        readyToFinish();
      });
    });

    request.end();
  });
}
