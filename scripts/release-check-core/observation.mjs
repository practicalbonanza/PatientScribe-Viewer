/**
 * What a captured response is, to this core.
 *
 * The predicates in the rest of this directory judge responses, and this is the
 * only shape of response they know. It is plain data: field names, field values,
 * a status, some bytes. Nothing in it is a socket, a stream, a client object or
 * anything else that could still be talking to something — which is what lets
 * the whole judgement be replayed from a file, compared between runs, and driven
 * from fixtures without a network.
 *
 * Two decisions in this shape are load-bearing rather than incidental.
 *
 * Header fields are a list of occurrences and not a map. A map answers "what is
 * the Content-Security-Policy" with one string however many the response
 * carried, and the normative text says that zero or more than one is itself a
 * failure — an origin serving two policies is an origin where the browser
 * enforces the intersection and the operator believes they configured one. A map
 * cannot tell that case from the sound one, so this does not use a map.
 *
 * Interim responses are recorded separately and are not merged into the final
 * one. A `103 Early Hints` is a whole response that arrives before the response,
 * carrying its own fields, and every part of the fetch it can start has already
 * started by the time the final headers arrive. A capture that folded its fields
 * into the final response's would report an origin that sends early hints as an
 * origin that sends a `Link` header, and a capture that dropped them would
 * report it as an origin that sends nothing at all. Both readings are wrong in
 * the direction that matters, so the interim responses are their own list and
 * the predicate that looks for them looks at that list.
 *
 * And an observation carries what could not be read as well as what could. A
 * client that cannot make sense of a line in the head, or of the framing of a
 * body, has two ways to answer: drop what it did not understand and hand over
 * the rest, or say so. The first is the one every convenient client takes, and
 * it is the one that turns a malformed response into a well-formed one on the
 * way past — a folded continuation of a policy line disappears and the policy
 * that is judged is shorter than the policy that arrived. So the reading is
 * recorded: each thing the wire carried that the client could not account for is
 * a typed entry here, and the judgement turns each of them into a refusal.
 */

/**
 * One header field occurrence.
 *
 * @typedef {object} HeaderField
 * @property {string} name The field name, lowercased. Field names are
 *   case-insensitive on the wire and comparing them in any other way is a
 *   comparison that a differently-cased spelling walks past.
 * @property {string} value The field value, with leading and trailing
 *   whitespace removed and nothing else done to it.
 */

/**
 * One interim response — a response that arrived before the response.
 *
 * @typedef {object} Interim
 * @property {number} status
 * @property {readonly HeaderField[]} headers
 */

/**
 * Something the wire carried that the client could not account for.
 *
 * Several kinds, and they are kinds rather than one string because each of them
 * is a different way for a response to be read as better than it was.
 *
 * `header-line` is a line in a head that is not a field: no colon, an empty
 * field name, whitespace between the name and its colon, or a leading space or
 * tab — which is the obsolete line folding a sender may still emit and a reader
 * may not silently resolve. Dropping such a line leaves a head that parses, and
 * the field it continued is recorded shorter than it arrived.
 *
 * `body-length` is a declared `Content-Length` that does not account for the
 * octets on the connection, or that cannot be read as a length at all. Fewer
 * octets than declared is a body that was cut off; more is octets nobody has
 * accounted for, which may be noise and may be a second response nobody asked
 * for. A length stated twice, or as a list, is a message with two answers to how
 * long it is.
 *
 * `body-framing` is a chunked body whose framing did not parse, did not reach
 * its end, or did not end where the octets did. An empty buffer in its place is
 * a body of zero bytes, which is a claim about the response rather than an
 * admission about the reading.
 *
 * `framing-choice` is a message framed by something other than exactly one of
 * the two framings this check reads: neither a length nor a coding, which is a
 * body delimited by the connection closing and therefore a body whose
 * completeness cannot be established; both at once; or a transfer coding that is
 * not the single terminal `chunked`.
 *
 * `http-version` is a final response that is not HTTP/1.1. A parser will read an
 * older version happily, and its framing rules are not the ones this check is
 * making claims about.
 *
 * `trailer-field` is a field carried in the trailer section of a chunked
 * message. The section may be there and may be empty; a field in it is a field
 * that arrives after everything reading the head has finished.
 *
 * `unreadable` is a response that could not be read for a reason none of the
 * above names — the fail-closed answer, so that a reading nobody anticipated is
 * a refusal rather than a response with parts missing.
 *
 * @typedef {object} CaptureFailure
 * @property {'header-line' | 'body-length' | 'body-framing' | 'framing-choice' | 'http-version' | 'trailer-field' | 'unreadable'} kind
 * @property {string} detail What the wire actually carried.
 */

/**
 * One captured response, and the request that elicited it.
 *
 * @typedef {object} Observation
 * @property {string} arm Which arm of the request matrix this is, by name. Used
 *   in refusals so that a failure says which of the several requests against one
 *   path it was.
 * @property {string} method
 * @property {string} path The request path with any query removed. Always
 *   begins with `/`.
 * @property {boolean} hasQuery Whether the request target carried a `?` at all.
 *   Separate from the query's content because the normative text separates them:
 *   a bare `?` is cache-key-identical to no query, and a non-empty query is not.
 * @property {string} query What followed the `?`, empty when it followed nothing.
 * @property {readonly HeaderField[]} requestHeaders Every request field, in the
 *   order sent. Read for `Cookie`, which must never be there.
 * @property {number} status The status the response answered with, or `0` where
 *   no response was read at all. Zero is not a status: it is how a response the
 *   client could not read is recorded, and `couldNotBeRead` below is what asks
 *   that question rather than call sites comparing against the number.
 * @property {readonly HeaderField[]} headers Every response field occurrence, in
 *   the order received.
 * @property {readonly Interim[]} interim Every interim response received before
 *   the final one, in order.
 * @property {Uint8Array | null} raw The body exactly as it arrived, before any
 *   content coding was removed. `null` where the response carries no body.
 * @property {Uint8Array | null} decoded The body with its content coding
 *   removed. `null` where it could not be removed, which the normative text
 *   calls a failure rather than a body of unknown length.
 * @property {string | null} decodeFailure Why the coding could not be removed,
 *   or `null`.
 * @property {readonly CaptureFailure[]} captureFailures Everything about this
 *   response the client could not account for. Empty on a response that was read
 *   whole, which is what every response from a sound origin is.
 */

/**
 * Was there a response here at all?
 *
 * A response the client could not read is recorded as the reading that failed
 * and nothing else: no status, no fields, no body. Every other predicate in this
 * core is a question about a response, and asked of this one each would answer
 * about a response that was never there — a policy that is missing, a directive
 * that is absent, an object that did not arrive. Those are all true of an empty
 * record and none of them is what happened, so they are not said. What happened
 * is the refusal the reading produced, and the run fails on it.
 *
 * @param {Observation} response
 * @returns {boolean}
 */
export function couldNotBeRead(response) {
  return response.status === 0;
}

/**
 * Every occurrence of one field, by name.
 *
 * @param {Observation} response
 * @param {string} name Lowercase.
 * @returns {string[]}
 */
export function fieldValues(response, name) {
  return response.headers.filter((field) => field.name === name).map((field) => field.value);
}

/**
 * The one occurrence of a field, or `null` where there are none or several.
 *
 * `null` for "several" rather than the first of them, because a caller that
 * wanted the first would be reading a response the browser does not read that
 * way. Callers that care how many there were count them with `fieldValues`.
 *
 * @param {Observation} response
 * @param {string} name Lowercase.
 * @returns {string | null}
 */
export function singleField(response, name) {
  const found = fieldValues(response, name);
  return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * Every field name a response carried, deduplicated, in the order first seen.
 *
 * @param {Observation} response
 * @returns {string[]}
 */
export function fieldNames(response) {
  /** @type {string[]} */
  const names = [];
  for (const field of response.headers) {
    if (!names.includes(field.name)) {
      names.push(field.name);
    }
  }
  return names;
}

/**
 * A comma-separated field value as its list of tokens, lowercased and trimmed.
 *
 * Empty elements are dropped: `a,,b` is two tokens rather than three, which is
 * what every list-valued field in HTTP means by it.
 *
 * @param {string} value
 * @returns {string[]}
 */
export function listTokens(value) {
  return value
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
}
