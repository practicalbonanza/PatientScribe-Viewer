/**
 * Parsing.
 *
 * This module must turn untrusted input into plain data structures and do
 * nothing else. It must never touch the DOM, never perform a network request,
 * and never decide what the viewer shows — validation belongs in `validate.js`,
 * routing in `dispatch.js`, and output in `render.js`. Keeping the three apart
 * is what lets the schema evolve without loosening the refusal path.
 *
 * Every function here must be total and must fail closed: unparseable input
 * returns `null`, which the caller turns into the single generic-unavailable
 * surface. There must be no second failure shape and no partial result.
 *
 * This is the lowest layer, depending on nothing else in the viewer. The
 * primitives untrusted input is handled with — the strict base64url decoder, the
 * object predicate, the exact-field reader, the pinned link format version and
 * the share identifier's lengths — are exported from here so there is one
 * definition of each rather than one per caller.
 *
 * One handling pin, because a returned object cannot enforce it: the link
 * capability is reachable only through a one-shot accessor and is never a field.
 * The accessor hands the bytes over once; the caller that takes them owns them
 * from that point, and must not retain them beyond the derivation that needs
 * them, place them in the DOM, or let them reach a log or a payload. A plain
 * field would be easy to log wholesale, copy into a payload, or hand to
 * something that stringifies it — removing the field is the part of that the
 * shape itself can enforce, and it is enforced here.
 */

/**
 * The link format version this module parses, and the value the AAD's `v` must
 * carry. Exported so the fragment grammar and the AAD validator cannot drift
 * apart: `validate.js` pins its `v` on this same constant rather than repeating
 * the string.
 *
 * `@satisfies` rather than `@type`: it checks the value without widening it, so
 * the constant keeps its literal type and everything derived from it stays tied
 * to this exact string. Changing the value fails the build here, at the pin,
 * rather than silently retyping everything downstream.
 *
 * @satisfies {'link_split_v1'}
 */
export const LINK_SPLIT_V1 = 'link_split_v1';

/** Base64url alphabet, in value order. There is no padding character: padding is never valid here. */
const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Character code to six-bit value; `-1` for every code outside the alphabet. */
const B64URL_VALUES = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let index = 0; index < B64URL_ALPHABET.length; index += 1) {
    table[B64URL_ALPHABET.charCodeAt(index)] = index;
  }
  return table;
})();

/**
 * Bytes carried by the share identifier. Exported because the identifier also
 * appears inside the additional authenticated data, and the two spellings of the
 * same rule must be one spelling.
 */
export const SHARE_ID_BYTE_LENGTH = 16;

/** Bytes carried by the link capability. */
const LINK_KEY_BYTE_LENGTH = 32;

/** Encoded length of the share identifier: 16 bytes, unpadded. */
export const SHARE_ID_B64_LENGTH = 22;

/** Encoded length of the link capability: 32 bytes, unpadded. */
const LINK_KEY_B64_LENGTH = 43;

/**
 * The fragment grammar, as fixed-width pieces.
 *
 * Every field has a fixed length, so the fragment has exactly one legal length
 * and exactly one legal byte-for-byte layout. Comparing against that layout at
 * fixed offsets enforces the parameter order, the exact parameter set, the
 * single occurrence of each, and the absence of anything trailing — all at once,
 * with nothing to split and no list to walk. A repeated, reordered, missing or
 * extra parameter changes the string, and a changed string fails the comparison.
 */
const VERSION_FIELD = `v=${LINK_SPLIT_V1}`;
const ID_FIELD = '&id=';
const LINK_KEY_FIELD = '&a=';
const ID_OFFSET = VERSION_FIELD.length + ID_FIELD.length;
const LINK_KEY_FIELD_OFFSET = ID_OFFSET + SHARE_ID_B64_LENGTH;
const LINK_KEY_OFFSET = LINK_KEY_FIELD_OFFSET + LINK_KEY_FIELD.length;
const FRAGMENT_LENGTH = LINK_KEY_OFFSET + LINK_KEY_B64_LENGTH;

/**
 * The largest input worth looking at: the one legal fragment plus its optional
 * leading `#`. Checked before anything is sliced, so an oversized fragment
 * cannot make this page allocate on its way to being refused.
 *
 * Exported for the same reason the bounds in `crypto.js` are: no outcome can
 * show it. A fragment over this length is refused by this bound and would have
 * been refused by the exact-length comparison two lines later, so widening it —
 * or deleting the comparison that uses it — changes no answer a corpus of
 * fragments and outcomes can see. What changes is the copy this page makes on
 * the way to the refusal, which is counted; the value itself is pinned in the
 * corpus beside the other bounds.
 */
export const MAX_FRAGMENT_LENGTH = FRAGMENT_LENGTH + 1;

/**
 * The parameters carried in a share link's fragment.
 *
 * The link capability is deliberately absent from this shape. It is held in the
 * closure `parseLinkFragment` returns and is reachable only by calling
 * `takeLinkKey`, which is itself a non-enumerable, non-writable, frozen property
 * of a frozen object. So enumeration, spread, a generic clone and serialisation
 * all miss it: there is no property holding the bytes to find, the one property
 * that could fetch them is not one any of those operations visits, and nothing
 * can be hung off that property — or off the object — to make them visit it.
 *
 * None of that hides the capability from someone holding the fragment. Parsing
 * the same fragment again yields it again, and must: the fragment is the
 * carrier, and holding the fragment is holding the capability. What this shape
 * prevents is the accident — the log line, the payload, the clone — that would
 * carry the bytes somewhere the fragment never went.
 *
 * @typedef {object} LinkParams
 * @property {typeof LINK_SPLIT_V1} v Link format version.
 * @property {Uint8Array<ArrayBuffer>} id Share identifier, decoded. Not secret
 *   in the way the link capability is — it is the key derivation salt, and the
 *   server sees it — but it still names one share, so it must never be logged.
 * @property {() => Uint8Array<ArrayBuffer> | null} takeLinkKey The link
 *   capability, once. The first call yields the decoded bytes and drops the
 *   reference; every later call returns `null`. One-shot because a value that
 *   can be read twice can be read once for the use it is for and once for
 *   somewhere it must never go.
 */

/**
 * A parsed document, reduced to the one field routing depends on plus its
 * still-unvalidated body.
 *
 * `value` is deliberately `unknown`: nothing may read a field off it until it
 * has been through the validator for its version.
 *
 * @typedef {object} ParsedDoc
 * @property {string} docVersion The document's self-declared schema version.
 * @property {unknown} value     The document body, unvalidated.
 */

/**
 * Is this a JSON object — not `null`, not an array, not a primitive?
 *
 * The predicate `readOwnFields` starts from, and so the one definition of "an
 * object" that every allowlist in the viewer reaches through. Exported alongside
 * it for a caller that needs only the shape question answered.
 *
 * `Array.isArray` is called inside a guard because it is not total: on a revoked
 * proxy it throws, and a predicate that throws is a second failure shape.
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  try {
    return !Array.isArray(value);
  } catch {
    return false;
  }
}

/**
 * Read exactly the named fields off a value, as its own enumerable data
 * properties, or refuse.
 *
 * This is what every allowlist in the viewer is built on, and it is one function
 * rather than one per caller so the rule cannot drift between them. It admits a
 * value only when the own property set it lists is exactly `names` — no more, no
 * fewer, nothing inherited standing in for a missing one, no symbol-keyed extra,
 * no non-enumerable extra — and only when every one of those properties holds a
 * value rather than a getter.
 *
 * "The own property set it lists" rather than "its own property set", and the
 * difference is a real one rather than a hedge. The count comes from
 * `getOwnPropertyNames`, which asks the value what its own properties are, and a
 * proxy may answer with fewer names than its target carries as long as the ones
 * it leaves out are configurable properties of an extensible object. A value
 * that leaves out exactly one unexpected property therefore matches the count
 * while carrying a property this reader was never told about, and every named
 * field still reads through it, so nothing else here refuses it. That is a
 * residual rather than a gap: what is being described is a value that lies
 * consistently, and no reflection available to a script distinguishes one of
 * those from the value it is imitating. What is ruled out is the value that
 * answers differently depending on which way it is asked, which is the shape a
 * mistake takes.
 *
 * It is a residual this viewer cannot reach in any case. Every value that
 * arrives at an allowlist here comes from `JSON.parse`, which builds ordinary
 * objects in this one realm and cannot build a proxy, and both validators
 * rebuild what they read as fresh literals rather than passing the value on. The
 * corpus carries the shape anyway, admitted, so that this paragraph is a
 * description of what happens rather than a claim about it.
 *
 * Each of those is load-bearing:
 *
 * - Own properties only. Counting keys and then reading fields through the
 *   prototype chain would admit an object carrying an unexpected own field plus
 *   a missing field inherited, which is the same count and not the same object.
 * - Symbols and non-enumerable properties counted too, so "the field set is
 *   exactly this" is a claim about everything the value lists, not only about
 *   what a plain enumeration would have shown.
 * - Descriptors rather than property reads. A getter is code the caller would be
 *   running, and it can throw or return a different value each time it is asked;
 *   a field set that admits one is not a fixed field set.
 * - A name list that names something twice is refused outright. The count is
 *   the list's length, so `['a', 'a']` compares against two while admitting one
 *   named field and leaving room for a second, unnamed one: `{ a: 1, b: 2 }`
 *   passes it and comes back as `[1, 1]`. Every allowlist in the viewer is built
 *   here, so a mistake in one of those lists has to be a refusal rather than a
 *   quietly widened schema.
 * - And the list is a list of strings. A string satisfies every step this used
 *   to take — it has a length, it indexes to characters, and `indexOf` answers
 *   for it — so `readOwnFields({ a: 1, b: 2 }, 'ab')` came back `[1, 2]` as
 *   though two fields had been named. No caller passes anything but an array of
 *   names, so no schema in this viewer was ever widened by it; what was wrong
 *   was the exported contract, which said the field set is exactly `names` while
 *   admitting values for which that sentence means nothing.
 *
 * The values come back in the order asked for, which is how the callers name
 * them. Everything is inside a guard because a hostile value can be a proxy, and
 * a proxy's traps run on the reflection calls themselves.
 *
 * Everything except the first line, which is outside it. That is deliberate and
 * it is why `isRecord` carries a guard of its own rather than relying on this
 * one: a revoked proxy throws when `Array.isArray` looks at it, and that look
 * happens before this function has entered its own `try`. The two guards are one
 * requirement written in the only two places it can be written.
 *
 * @param {unknown} value
 * @param {unknown} names The exact field set, as an array of distinct strings,
 *   in the order the caller reads them. Typed as `unknown` because the answer
 *   this gives for anything else is part of the contract rather than something
 *   the callers happen never to reach.
 * @returns {unknown[] | null} One value per name, or `null` if `value` does not
 *   list exactly that field set as its own properties, or if `names` is not a
 *   list of distinct names.
 */
export function readOwnFields(value, names) {
  if (!isRecord(value)) {
    return null;
  }

  try {
    // Inside the guard, like everything else here: `Array.isArray` throws on a
    // revoked proxy, and a name list is as capable of being one as a record is.
    if (!Array.isArray(names)) {
      return null;
    }

    /** @type {string[]} */
    const asked = [];
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      if (typeof name !== 'string' || names.indexOf(name) !== index) {
        return null;
      }
      asked.push(name);
    }

    if (Object.getOwnPropertySymbols(value).length !== 0) {
      return null;
    }
    if (Object.getOwnPropertyNames(value).length !== asked.length) {
      return null;
    }

    /** @type {unknown[]} */
    const values = [];
    for (const name of asked) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (descriptor === undefined || descriptor.enumerable !== true || !('value' in descriptor)) {
        return null;
      }
      values.push(descriptor.value);
    }
    return values;
  } catch {
    return null;
  }
}

/**
 * How many bytes an unpadded base64url string of this many characters decodes
 * to: four characters carry three bytes, and a trailing two or three carry one
 * or two, so it is the floor of three quarters of the length.
 *
 * Arithmetic rather than a shift, and a named export rather than an expression
 * inside the decoder, because the shift it replaces was wrong at input sizes no
 * test can build. `(length * 3) >> 2` coerces to a signed 32-bit integer: at
 * 715827883 characters the product passes 2^31 and the shift turns negative, so
 * allocating the result throws — an exception where this module promises a
 * refusal — and at 1431655766 the product wraps to 2, the shift reaches 0, and a
 * vast input decodes to an empty array rather than being refused. Both lengths
 * are beyond the longest string one of the two engines this viewer is tested in
 * can hold and within reach of the other, which is exactly why the arithmetic is
 * a step something can be asserted about rather than a line nothing can drive.
 *
 * Divided before it is multiplied, which is the same reasoning one size up.
 * `(count * 3) / 4` is exact only while the product fits the integers a double
 * carries exactly, and three times a count near the largest of those does not:
 * the product rounds to the nearest value a double can hold before anything is
 * divided, so the division answers a number that is not the floor of three
 * quarters of anything. The two spellings first disagree at 3002399751580333
 * characters and disagree for more than a third of the counts near the top of
 * the range, always by one. Splitting the count into whole groups of four and a
 * remainder keeps every intermediate value well inside the exact range, so the
 * answer is exact for every count this function admits. No string can be that
 * long in either engine, and it makes no difference: this is an exported helper
 * with an exact contract, and it either has it or does not.
 *
 * Total, like everything else exported from this module, which the arithmetic
 * alone is not: multiplying a `BigInt` or a `Symbol` throws, and a throw from an
 * exported function here is the second failure shape this viewer is not allowed
 * to have. Anything that is not a count of characters is answered with a size of
 * zero rather than with an exception — the fail-closed answer as well as the
 * total one, since a caller sizing an allocation from it would allocate nothing.
 * Unreachable from the one caller below, which passes a string's own length.
 *
 * @param {unknown} characterCount
 * @returns {number}
 */
export function decodedByteLength(characterCount) {
  if (typeof characterCount !== 'number' || !Number.isSafeInteger(characterCount) || characterCount < 0) {
    return 0;
  }
  const groups = Math.floor(characterCount / 4);
  const remainder = characterCount - groups * 4;
  return groups * 3 + Math.floor((remainder * 3) / 4);
}

/**
 * Decode strict unpadded base64url.
 *
 * Strict in five ways, each a refusal rather than a repair: nothing that is not
 * a string, no character outside the alphabet, no padding, no length no unpadded
 * encoding can produce, and no non-zero bits left over in the final character.
 * The last of those is what stops two different strings decoding to the same
 * bytes, which would otherwise let a link be rewritten without changing what it
 * resolves to. The first is what stops a non-string standing in for the empty
 * string: without it, anything with no `length` decodes to zero bytes, which is
 * a successful decode of something that was never an encoding.
 *
 * Bounding the input is the caller's job: this allocates in proportion to what
 * it is given, so every caller checks a length first.
 *
 * The buffer type is pinned rather than left to widen, because Web Crypto takes
 * only bytes backed by a plain buffer and a widened type is rejected at the call
 * that matters.
 *
 * @param {unknown} text
 * @returns {Uint8Array<ArrayBuffer> | null} The decoded bytes, or `null` if
 *   `text` is not exactly a canonical unpadded base64url encoding.
 */
export function decodeBase64url(text) {
  if (typeof text !== 'string') {
    return null;
  }

  const length = text.length;

  // One leftover character cannot carry a whole byte, so no unpadded encoding
  // has this length.
  if (length % 4 === 1) {
    return null;
  }

  const bytes = new Uint8Array(decodedByteLength(length));
  let accumulator = 0;
  let bits = 0;
  let written = 0;

  for (let index = 0; index < length; index += 1) {
    const value = B64URL_VALUES[text.charCodeAt(index)] ?? -1;
    if (value < 0) {
      return null;
    }
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[written] = (accumulator >> bits) & 0xff;
      written += 1;
    }
  }

  if (bits > 0 && (accumulator & ((1 << bits) - 1)) !== 0) {
    return null;
  }

  return bytes;
}

/**
 * Parse a location fragment into link parameters.
 *
 * The fragment is hostile input: it arrives from a URL that may have been
 * edited, truncated, or synthesised. Anything the parser cannot account for in
 * full must be a refusal, never a best effort.
 *
 * @param {unknown} fragment The raw fragment, with or without its leading `#`.
 * @returns {LinkParams | null} The parameters, or `null` if the fragment is not
 *   exactly a well-formed link.
 */
export function parseLinkFragment(fragment) {
  if (typeof fragment !== 'string') {
    return null;
  }
  if (fragment.length > MAX_FRAGMENT_LENGTH) {
    return null;
  }

  // The one repair this parser makes, and its exact shape is part of the grammar
  // rather than a convenience on the way to one. A leading `#` is optional
  // because a fragment is handed about both with and without it. Removing a `#`
  // that is not leading, removing more than one, or removing whatever character
  // happens to be first are each a different accepted set, and each is a
  // one-token edit that everything downstream is blind to: what the layout
  // comparison compares is whatever this line produced. So the corpus asks about
  // this step directly, with a `#` inside the fragment, a `#` at the end of it,
  // and a leading character that is not one.
  const text = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (text.length !== FRAGMENT_LENGTH) {
    return null;
  }
  if (
    !text.startsWith(VERSION_FIELD) ||
    !text.startsWith(ID_FIELD, VERSION_FIELD.length) ||
    !text.startsWith(LINK_KEY_FIELD, LINK_KEY_FIELD_OFFSET)
  ) {
    return null;
  }

  // Both byte counts below are a second reading of a fixed-width slice, and no
  // input separates the comparison they are written with from a looser one: a
  // canonical 22-character encoding decodes to 16 bytes and to nothing else, and
  // a 43-character one to 32 and to nothing else, so `!==`, `<` and `>` admit
  // and refuse exactly the same fragments here. The comparisons are kept because
  // the encoded width and the byte count are two separate facts — one the
  // grammar's, one the key's — and a later edit that moved one without the other
  // has to be a refusal rather than a derivation over the wrong number of bytes.
  // Nothing a corpus of fragments can show distinguishes them, which is why this
  // is written here rather than asked for as a case.
  const id = decodeBase64url(text.slice(ID_OFFSET, ID_OFFSET + SHARE_ID_B64_LENGTH));
  if (id === null || id.length !== SHARE_ID_BYTE_LENGTH) {
    return null;
  }

  /** @type {Uint8Array<ArrayBuffer> | null} */
  let linkKey = decodeBase64url(text.slice(LINK_KEY_OFFSET));
  if (linkKey === null || linkKey.length !== LINK_KEY_BYTE_LENGTH) {
    return null;
  }

  const params = { v: LINK_SPLIT_V1, id };

  // Three doors shut at once, and each of them matters.
  //
  // The accessor is a property rather than a field so the bytes are never a
  // value sitting on the object. It is non-enumerable so that every operation
  // that walks an object — enumeration, spread, a generic clone, serialisation —
  // does not visit it, which is what makes those operations unable to reach the
  // capability rather than merely unlikely to. It is frozen so nothing can be
  // hung off the function itself: an unfrozen accessor takes a `toJSON`, and a
  // `toJSON` is exactly a way to make serialisation call the thing it was not
  // supposed to be able to call. And the object is frozen so the capability
  // cannot be attached back onto it, by that route or any other.
  Object.defineProperty(params, 'takeLinkKey', {
    value: Object.freeze(() => {
      const held = linkKey;
      linkKey = null;
      return held;
    }),
    writable: false,
    enumerable: false,
    configurable: false,
  });

  return /** @type {LinkParams} */ (Object.freeze(params));
}

/**
 * Parse JSON that has already authenticated.
 *
 * A JSON `null` and a parse failure both come back as `null`. That is not a lost
 * distinction: neither is a value any validator here admits, so both are the
 * same refusal.
 *
 * The string check is not redundant with the callers' own. `JSON.parse` coerces
 * whatever it is given, so it hands a boolean straight back, and it stringifies
 * an object — meaning a value carrying a `toString` could choose the document
 * that gets parsed. Only a string may be parsed as one.
 *
 * @param {unknown} text
 * @returns {unknown}
 */
function parseJson(text) {
  if (typeof text !== 'string') {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Parse the additional authenticated data.
 *
 * Called only on a string the content tag has already authenticated, and only
 * ever as a reading of it. The bytes the tag covered are the received string
 * itself, so nothing derived from this parse may be written back out and used
 * as the authenticated data: a re-serialised object is a different string that
 * happens to mean the same thing, and "happens to mean the same thing" is not
 * what a tag covers.
 *
 * @param {unknown} text The authenticated AAD string.
 * @returns {unknown} The parsed value, still unvalidated, or `null`.
 */
export function parseAad(text) {
  return parseJson(text);
}

/**
 * Parse decrypted plaintext into a routable document.
 *
 * Called only on plaintext that has already authenticated. That makes this
 * parser's job narrow — read the declared version, keep the body untouched —
 * but not trusting: a document that authenticates can still be malformed, and
 * malformed must be a refusal.
 *
 * @param {unknown} plaintext The decrypted document text.
 * @returns {ParsedDoc | null} The parsed document, or `null` if it is not
 *   well-formed or does not declare a version.
 */
export function parseShareDoc(plaintext) {
  const value = parseJson(plaintext);
  if (!isRecord(value)) {
    return null;
  }

  // Read as an own property. `JSON.parse` cannot produce anything else, but this
  // function's contract is what it does with any input, not with that one.
  const declaring = Object.getOwnPropertyDescriptor(value, 'schema');
  if (declaring === undefined || !('value' in declaring)) {
    return null;
  }

  const declared = declaring.value;
  if (typeof declared !== 'string') {
    return null;
  }

  return { docVersion: declared, value };
}
