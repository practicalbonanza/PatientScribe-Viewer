/**
 * Cryptography.
 *
 * Web Crypto and nothing else. Every key object this module produces is
 * non-extractable, and the content key in particular is unwrapped straight into
 * a key object: `unwrapKey` decrypts and imports in one step inside the
 * implementation, so the content key never passes through a buffer this script
 * could read.
 *
 * That is narrower than "no key material is ever bytes here", and the narrower
 * claim is the true one. Both halves of the key split arrive as bytes — they
 * have to, since one comes from a URL fragment and the other from a stored
 * response — and `deriveKek` concatenates them into the input keying material
 * Web Crypto imports. Those bytes are readable for as long as they exist.
 *
 * What this module guarantees is narrower still, and worth stating exactly: the
 * concatenation `deriveKek` builds is zeroed before the caller resumes, the key
 * derived from it cannot be exported, and nothing returned from here carries any
 * of it. That concatenation is not the only copy of the material in play, and
 * saying it was would be the kind of claim that reads as a control. Reading a
 * stored response decodes the server's half into a buffer of its own, and that
 * buffer is what `deriveKek` is handed; it is released rather than scrubbed. So
 * is whatever the caller is still holding of the link half. Zeroing the
 * concatenation is worth doing because it is the one place both halves sit
 * together in one buffer, which is the value most worth not leaving behind — it
 * is not a claim that this page ever stopped holding either half.
 *
 * Every function fails the same way, and every function is total. Any value at
 * all may be handed to any of them — a number where a string belongs, a plain
 * array where key material belongs, nothing at all — and any step that does not
 * succeed returns `null`: no exception escapes, no failure detail is produced,
 * no second result shape exists, and nothing derived from the inputs appears in
 * anything this module returns. A caller cannot tell a wrong link capability
 * from a wrong stored key, a modified blob from a truncated one, or an expired
 * share from a missing one, because those all reach the caller as the same
 * value. That is the point: the difference between one failure and another is
 * exactly what a recipient must not be able to observe.
 *
 * Types are checked before lengths, and lengths before anything is decoded. A
 * response is untrusted, and decoding is where a hostile response would get to
 * choose how much this page allocates.
 *
 * The additional authenticated data is used as the bytes of the string exactly
 * as it was received. It is never parsed, canonicalised or rebuilt on the way
 * into the tag check — a re-serialised copy is a different string that happens
 * to mean the same thing, and it would fail against a tag computed over the
 * original. Reading the AAD is a separate step, downstream, on a string the tag
 * has already covered.
 *
 * "Exactly as it was received" rules out the small repairs as firmly as it rules
 * out the large one. Normalising the string, trimming it, or re-encoding it are
 * each a single method call and each produces a different string that means what
 * the original meant — which is the whole of what must not happen, whether it
 * happens on the way into the tag check or on the way back out to the caller.
 * The additional authenticated data handed back is the string that arrived: the
 * same value, not a copy of it that means the same thing.
 *
 * The plaintext is not that, and cannot be. It was never a string on this side —
 * it is bytes the tag covered, decoded here — so what a caller receives is the
 * string those bytes decode to. That is the string that was sealed whenever the
 * string that was sealed was well-formed UTF-16, and this module asks that
 * question of the additional authenticated data and not of the plaintext. The
 * asymmetry is deliberate rather than an oversight: the AAD's injectivity is
 * what "one string, one tag" rests on, because a caller compares the AAD against
 * what it expected, while the plaintext is only ever whatever the sealed bytes
 * say and is compared against nothing.
 *
 * "The string those bytes decode to" was a sentence this module did not keep,
 * and the decoder is where it was lost rather than anywhere in the reasoning: a
 * decoder deletes a leading byte-order mark by default, so a document sealed
 * with one came back a character shorter than it went in. That is the same class
 * of repair as normalising or trimming, made in the one place the prose above
 * was not looking, and it is closed at `DECODER` — where the reason it matters
 * more here than it would elsewhere is also written down.
 *
 * For "the bytes of the string exactly as it was received" to be a true
 * statement, the mapping from string to bytes has to be injective, and UTF-8
 * encoding is not: every unpaired surrogate encodes to the bytes of U+FFFD, so a
 * string spelled with one and the string spelled with U+FFFD reach the tag as
 * the same bytes and both authenticate. An AAD that is not well-formed UTF-16 is
 * therefore refused before it reaches the tag check, which restores the property
 * the rest of this module's reasoning rests on: one string, one tag, and the
 * string a caller is handed back is the string that was sealed.
 */

// `SHARE_ID_BYTE_LENGTH` is imported rather than declared again here. The same
// count is the length of the decoded fragment identifier and the length of the
// derivation salt, which is one requirement rather than two that happen to
// agree, and `parse.js` says the primitives are exported from there so there is
// one definition of each rather than one per caller. A second declaration is a
// second thing to keep in step, and the failure if they ever drifted would be a
// key derived under a salt of a length nobody chose.
import { decodeBase64url, readOwnFields, SHARE_ID_BYTE_LENGTH } from './parse.js';

/** Bytes in the link capability, the half of the key split carried in the fragment. */
const LINK_KEY_BYTE_LENGTH = 32;

/** Bytes in the stored key, the half of the key split the server holds. */
const SERVER_KEY_BYTE_LENGTH = 32;

/** Bytes in the content key. */
const CONTENT_KEY_BYTE_LENGTH = 32;

/** 96-bit nonce, in bytes. */
const NONCE_BYTE_LENGTH = 12;

/** 128-bit tag, in bytes. */
const TAG_BYTE_LENGTH = 16;

/** 128-bit tag, as Web Crypto counts it. */
const TAG_BIT_LENGTH = 128;

/** AES-256, as Web Crypto counts it. */
const AES_KEY_BIT_LENGTH = 256;

/**
 * The derivation context. Bound into the derived key, so a key derived for this
 * purpose cannot be a key derived for any other.
 */
const KEK_INFO = 'patientscribe/link_split_v1/kek';

/** Encoded length of the stored key: 32 bytes, unpadded. */
export const SERVER_KEY_B64_LENGTH = 43;

/**
 * Encoded length of the wrapped content key: a 12-byte nonce, 32 bytes of
 * ciphertext and a 16-byte tag is 60 bytes, which is exactly 80 unpadded
 * base64url characters.
 */
export const WRAPPED_KEY_B64_LENGTH = 80;

/** The smallest blob that could be a nonce and a tag with nothing between them. */
export const MIN_BLOB_BYTE_LENGTH = NONCE_BYTE_LENGTH + TAG_BYTE_LENGTH;

/**
 * The largest ciphertext worth decoding.
 *
 * The server keeps one stored item per share and caps it at 350 KB. Every blob
 * in that item travels as base64url text, so no one field can be larger than the
 * item holding it. Whether that cap is counted over the stored text or over the
 * bytes the text encodes, the encoded form of a 350 KB item is at most
 * `ceil(350 * 1024 / 3) * 4` characters, so this takes the larger of the two
 * readings on purpose: a bound that refuses an item the server would have
 * accepted is a bug, while a bound that is generous by a third still stops a
 * response that could never have been stored from choosing how much this page
 * allocates. Under half a megabyte either way.
 *
 * Exported, like the other bounds here, because no outcome can show it. A blob
 * over the bound is refused by the bound and would have been refused by the tag
 * anyway, so widening it, or deleting the check that uses it, changes nothing a
 * corpus of inputs and outcomes can see. Its exact value is pinned in the corpus
 * instead, which turns a silent widening into a failure.
 *
 * The two comparisons against this bound are written `>` and neither can be
 * shown to be `>` rather than `>=`, which is a residual rather than a gap, and
 * the arithmetic is why. `Math.ceil((350 * 1024) / 3) * 4` is 477868. The two
 * spellings differ for exactly one input, a ciphertext field of exactly 477868
 * characters, and no such field can be stored: unpadded base64url of the largest
 * item the server holds, 350 KB, is `Math.ceil(358400 * 4 / 3)` — 477867
 * characters, one short. So the length at which the two disagree is not a length
 * a stored response can carry, and `>=` would be strictly more refusing at it.
 * Pinning the difference would mean a half-megabyte string in the corpus, which
 * buys a comparison nothing can reach at the cost of a corpus nobody can read.
 */
export const CIPHERTEXT_MAX_B64_LENGTH = Math.ceil((350 * 1024) / 3) * 4;

/**
 * The largest AAD worth looking at.
 *
 * The AAD is fixed by its schema at six scalar fields: two pinned literals, a
 * 22-character identifier, an integer, a boolean and one short string. This
 * bound assumes that stays true — none of those fields is long-form text. The
 * room it leaves above the longest form they can take is something over thirty
 * times, not the orders of magnitude it might read as: the fixtures sealed
 * against this schema run to a little over a hundred code units, and the fields
 * that could grow are an expiry of at most sixteen digits and one short string.
 * Thirty times is ample for a schema this shape and is the number, so it is the
 * number written down. Counted in UTF-16 code units, which bound the UTF-8 byte
 * count the tag covers within a factor of three.
 *
 * The two comparisons against this bound are `>`, and unlike the ciphertext ones
 * that is a pinned comparison rather than a residual — the reason it was written
 * down as a residual was false. `>=` differs from `>` for exactly one input, an
 * AAD of exactly 4096 code units, and refuses it where `>` admits it; the claim
 * beside it was that no producer of this schema emits a string that long. It is
 * not so. Of the six scalar fields, the last is constrained only to be a
 * non-empty string, so an AAD of exactly 4096 code units — the fixture's, with a
 * final field of 3,983 characters — is one the validator admits and one a
 * producer may emit. The fixtures sit at 114 to 118 code units because that is
 * what those fixtures carry, which is a fact about them and not about the
 * schema.
 *
 * So the corpus carries that length rather than an argument about it: an AAD of
 * exactly 4096 code units the validator admits, and a share sealed over one,
 * decrypted and read back. Both are accepted, and `>=` refuses both.
 *
 * @see CIPHERTEXT_MAX_B64_LENGTH for why this is exported, and for the bound
 *   beside this one that genuinely is a residual — no stored item can carry a
 *   ciphertext field of the length that separates its two spellings, so nothing
 *   can be sealed at it.
 */
export const AAD_MAX_LENGTH = 4096;

const ENCODER = new TextEncoder();

/**
 * Fatal, so plaintext that is not well-formed UTF-8 is a refusal rather than
 * replacement characters. And the byte-order mark is a character rather than a
 * mark, which is the second half of the same requirement and was missing.
 *
 * A decoder's default is to delete a leading U+FEFF from what it returns. That
 * is a repair, on a path whose stated discipline everywhere else is refusal —
 * and it is the repair with the worst reach available here, because it is
 * silent, it is at the front of the document, and it changes what the document
 * is. Re-sealing a fixture's own document with a leading mark, under that
 * fixture's own content key and nonce, and reading it back through this module
 * returned 355 code units where 356 were sealed. The string that was sealed is
 * not JSON — a byte-order mark is not JSON whitespace, so parsing it throws —
 * while the string that came back is, so the deletion turned a document the
 * protocol refuses into one that renders.
 *
 * `ignoreBOM` reads as the permissive spelling and is the strict one: it means
 * "do not treat these bytes as a mark", which is to say hand back every
 * character the bytes encode. What a caller receives is then the string those
 * bytes decode to, with nothing removed.
 */
const DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const KEK_INFO_BYTES = ENCODER.encode(KEK_INFO);

/**
 * The byte count of a typed array, read from the internal slot.
 *
 * `.length` is an accessor on the typed array prototype, which means it can be
 * shadowed: an own data property on the instance, or a getter on a subclass,
 * makes a 31-byte value answer 32 and an empty one answer 16. Nothing that
 * copies from such a value copies the count it claims — `set` and Web Crypto
 * both read the slot — so the difference does not become an error, it becomes
 * zero bytes, and a key derived from it is a key derived from something nobody
 * chose. This getter reads the slot, which no property can shadow, and throws
 * on any value that has no slot to read.
 */
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength',
)?.get;

/**
 * Is this a key object, without asking a hostile value a question it can answer
 * by throwing?
 *
 * `instanceof` reads the prototype chain, and reading the prototype of a revoked
 * proxy throws. Written out here, once, so that a guard cannot be the thing that
 * turns a refusal into an exception — the whole point of these guards is that
 * every failure is the same returned `null`.
 *
 * @param {unknown} value
 * @returns {value is CryptoKey}
 */
function isCryptoKey(value) {
  try {
    return value instanceof CryptoKey;
  } catch {
    return false;
  }
}

/**
 * The fields of the stored response, in the order they are read. The list is the
 * allowlist, and its length is the field count.
 */
const RESPONSE_FIELDS = ['b', 'wrapped_k', 'ciphertext', 'aad'];

/**
 * The stored response, once its fields have been read and length-checked but
 * before any of them has been decoded.
 *
 * @typedef {object} ShareResponse
 * @property {string} b The stored key, unpadded base64url.
 * @property {string} wrapped_k The wrapped content key, unpadded base64url.
 * @property {string} ciphertext Nonce, ciphertext and tag, unpadded base64url.
 * @property {string} aad The additional authenticated data, exactly as received.
 */

/**
 * A decryption that succeeded.
 *
 * The AAD travels back out with the plaintext, and it is the same string that
 * went in. Returning the pair rather than the plaintext alone is what makes the
 * association checkable: these two are what one tag covered, so a caller cannot
 * end up reading an AAD that was never authenticated alongside the document it
 * is describing.
 *
 * @typedef {object} DecryptedShare
 * @property {string} plaintext
 * @property {string} aad
 */

/**
 * Read the four fields of a stored response and check every length that can be
 * checked before decoding.
 *
 * The field set is exact, in the sense `readOwnFields` makes exact: these four
 * own properties and nothing else, with nothing inherited standing in for one of
 * them. The response is a frozen contract, so a response carrying something else
 * is not a newer server, it is not the server.
 *
 * Type before length, in that order, in every pair below and everywhere else in
 * this module that reads a length. The order is not tidiness. `readOwnFields`
 * refuses a field that is a getter, but it says nothing about what the field's
 * value is, and a value carrying a `length` accessor that throws is an ordinary
 * data property to it. Reading the length of something that has not been proved
 * to be a string therefore runs code an untrusted response chose, outside the
 * try blocks the cryptographic calls sit in — an exception escaping a module
 * whose whole contract is a returned refusal. The short-circuit is what stops
 * it, and the corpus puts a throwing `length` accessor in each of these fields
 * so that it is held there rather than assumed.
 *
 * @param {unknown} value
 * @returns {ShareResponse | null}
 */
function readResponse(value) {
  const fields = readOwnFields(value, RESPONSE_FIELDS);
  if (fields === null) {
    return null;
  }

  const [b, wrapped_k, ciphertext, aad] = fields;

  if (typeof b !== 'string' || b.length !== SERVER_KEY_B64_LENGTH) {
    return null;
  }
  if (typeof wrapped_k !== 'string' || wrapped_k.length !== WRAPPED_KEY_B64_LENGTH) {
    return null;
  }
  // `>` rather than `>=`, and the difference is a documented residual rather
  // than an untested edge: the two spellings part company at a ciphertext of
  // exactly 477868 characters, the largest encoding a 350 KB stored item can
  // carry is 477867, and `>=` refuses where `>` admits. See
  // `CIPHERTEXT_MAX_B64_LENGTH` for the arithmetic.
  if (typeof ciphertext !== 'string' || ciphertext.length > CIPHERTEXT_MAX_B64_LENGTH) {
    return null;
  }
  // The same, one bound down, except that this one is reachable: the spellings
  // part company at exactly 4096 code units, which this schema can carry because
  // its last field is constrained only to be non-empty, and the corpus carries a
  // share sealed over one. See `AAD_MAX_LENGTH`.
  if (typeof aad !== 'string' || aad.length > AAD_MAX_LENGTH) {
    return null;
  }

  return { b, wrapped_k, ciphertext, aad };
}

/**
 * Split a decoded blob into its nonce and everything the tag check consumes.
 *
 * @param {Uint8Array<ArrayBuffer>} blob
 * @returns {{ nonce: Uint8Array<ArrayBuffer>, body: Uint8Array<ArrayBuffer> }}
 */
function splitBlob(blob) {
  return { nonce: blob.subarray(0, NONCE_BYTE_LENGTH), body: blob.subarray(NONCE_BYTE_LENGTH) };
}

/**
 * Is this exactly `byteLength` bytes of key material?
 *
 * Named as a check on the type as well as the length, because the two are one
 * requirement here. A plain array of 32 numbers has a length of 32 and is not
 * key material: copying it into a buffer coerces whatever it holds, so a value
 * that is not bytes would silently become bytes, and the key derived from those
 * bytes would be a key derived from something nobody chose.
 *
 * Three things make this total and make its answer mean what it says:
 *
 * - The whole test is guarded. `instanceof` reads the prototype chain, and a
 *   revoked proxy throws when its prototype is read, so an unguarded test is a
 *   guard that can throw.
 * - The brand is `instanceof`, which is deliberately realm-local. A typed array
 *   from another realm is refused. That fails closed, this page has one realm,
 *   and the alternative — a brand check that spans realms — would admit values
 *   this viewer has no reason to see.
 * - The count comes from the internal slot, never from `.length`. See
 *   `TYPED_ARRAY_BYTE_LENGTH`: a value that satisfies the brand can still lie
 *   about its length, and it is the lie that would reach a key derivation.
 *
 * @param {unknown} value
 * @param {number} byteLength
 * @returns {value is Uint8Array<ArrayBuffer>}
 */
function isBytes(value, byteLength) {
  if (TYPED_ARRAY_BYTE_LENGTH === undefined) {
    return false;
  }
  try {
    if (!(value instanceof Uint8Array)) {
      return false;
    }
    return TYPED_ARRAY_BYTE_LENGTH.call(value) === byteLength;
  } catch {
    return false;
  }
}

/**
 * Is this string well-formed UTF-16 — every surrogate paired?
 *
 * Asked of the additional authenticated data before it is encoded, because UTF-8
 * encoding is not injective over strings that are not: an unpaired surrogate and
 * U+FFFD produce the same three bytes. Without this, two different strings reach
 * the tag as one, so a string that was never sealed authenticates against a tag
 * computed over one that was — and the caller is handed the string that arrived,
 * not the string the tag covers.
 *
 * Written out rather than deferred to the platform's own well-formedness test,
 * which is newer than the language level this viewer is pinned to.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isWellFormedUtf16(text) {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdfff) {
      continue;
    }
    // Reaching a trailing surrogate here means no leading one claimed it, since
    // a pair is stepped over whole. Otherwise this is a leading surrogate, and
    // what follows it must be a trailing one. `charCodeAt` past the end of the
    // string is `NaN`, which fails the range test, so a leading surrogate as the
    // last unit of the string is refused by the same comparison.
    if (unit > 0xdbff) {
      return false;
    }
    index += 1;
    const next = text.charCodeAt(index);
    if (!(next >= 0xdc00 && next <= 0xdfff)) {
      return false;
    }
  }
  return true;
}

/**
 * Derive the key that the content key is wrapped under.
 *
 * The input keying material is the link capability followed by the stored key,
 * raw and in that order, so neither half derives anything on its own. The share
 * identifier is the salt.
 *
 * The derived key is non-extractable and can do exactly one thing: unwrap.
 *
 * So is the key it is derived from, and that one is worth a sentence because
 * nothing can show it. The HKDF base key exists for one line: it is imported
 * non-extractable, its usage list is `deriveKey` and nothing else, and the
 * derivation below is the only thing done with it before it goes out of scope.
 * A base key that also carried `deriveBits` would derive exactly the same key,
 * refuse exactly the same inputs, and produce exactly the same outcome for every
 * input there is — no corpus of inputs and results can tell the two apart, and
 * the shape cases in this suite are about the keys this module hands back rather
 * than about one it never returns. What the narrow list buys is that this key
 * cannot be asked for bytes: `deriveBits` is the operation that answers with raw
 * output, nothing here wants raw output, and a usage nothing needs is a door
 * left open on the one value both halves of the split have been mixed into.
 * Written down here because it is a claim about these bytes that only a reader
 * can check.
 *
 * @param {unknown} linkKey The link capability, 32 bytes.
 * @param {unknown} serverKey The stored key, 32 bytes.
 * @param {unknown} shareId The share identifier, 16 bytes.
 * @returns {Promise<CryptoKey | null>}
 */
export async function deriveKek(linkKey, serverKey, shareId) {
  if (
    !isBytes(linkKey, LINK_KEY_BYTE_LENGTH) ||
    !isBytes(serverKey, SERVER_KEY_BYTE_LENGTH) ||
    !isBytes(shareId, SHARE_ID_BYTE_LENGTH)
  ) {
    return null;
  }

  const ikm = new Uint8Array(LINK_KEY_BYTE_LENGTH + SERVER_KEY_BYTE_LENGTH);
  ikm.set(linkKey, 0);
  ikm.set(serverKey, LINK_KEY_BYTE_LENGTH);

  try {
    const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: shareId, info: KEK_INFO_BYTES },
      base,
      { name: 'AES-GCM', length: AES_KEY_BIT_LENGTH },
      false,
      ['unwrapKey'],
    );
  } catch {
    return null;
  } finally {
    // The one buffer in which both halves sit together, gone before the caller
    // resumes. Not the only copy of either half in play — the stored key reaches
    // this function as a buffer somebody else decoded, and the link capability as
    // one the caller is still holding — which is why this is a claim about this
    // buffer rather than about the material.
    ikm.fill(0);
  }
}

/**
 * Unwrap the content key.
 *
 * The wrap carries no additional authenticated data: the key derivation already
 * binds the wrap to this share, and adding a second binding here would be a
 * second thing to keep in step.
 *
 * The content key arrives as a key object, never as bytes. `unwrapKey` decrypts
 * and imports in one step inside the implementation, so there is no point at
 * which the key material is a buffer this script could read.
 *
 * @param {unknown} kek
 * @param {unknown} wrapped The wrapped content key, unpadded base64url.
 * @returns {Promise<CryptoKey | null>}
 */
export async function unwrapContentKey(kek, wrapped) {
  if (!isCryptoKey(kek)) {
    return null;
  }
  if (typeof wrapped !== 'string' || wrapped.length !== WRAPPED_KEY_B64_LENGTH) {
    return null;
  }

  // The byte count is a second reading of a width already fixed, and no input
  // separates the comparison it is written with from a looser one: the check
  // above admits only an 80-character string, a canonical 80-character unpadded
  // encoding decodes to 60 bytes and to nothing else, and 60 is what this
  // compares against — so `!==`, `<` and `>` admit and refuse exactly the same
  // strings here. It is kept because the encoded width and the byte layout are
  // two separate facts — one the field's, one the wrap's — and an edit that
  // moved one without the other has to be a refusal rather than an unwrap over
  // the wrong number of bytes. This is the same construct `parse.js` documents
  // at the two byte counts inside the fragment, and it is written down here for
  // the same reason: nothing a corpus of inputs and outcomes can show
  // distinguishes the spellings, so the reasoning is the only thing that can.
  const blob = decodeBase64url(wrapped);
  if (blob === null || blob.length !== NONCE_BYTE_LENGTH + CONTENT_KEY_BYTE_LENGTH + TAG_BYTE_LENGTH) {
    return null;
  }
  const { nonce, body } = splitBlob(blob);

  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      body,
      kek,
      { name: 'AES-GCM', iv: nonce, tagLength: TAG_BIT_LENGTH },
      { name: 'AES-GCM', length: AES_KEY_BIT_LENGTH },
      false,
      ['decrypt'],
    );
  } catch {
    return null;
  }
}

/**
 * Decrypt the document.
 *
 * The additional authenticated data is the UTF-8 bytes of `aad` as it stands.
 * Nothing here parses it, reorders it, or writes it back out. The one thing
 * asked of it before it is encoded is that it be well-formed UTF-16, which is
 * not a reading of it: it is what makes the encoding injective, and so what
 * makes "the bytes of this string" name one string rather than a set of them.
 *
 * @param {unknown} contentKey
 * @param {unknown} ciphertext Nonce, ciphertext and tag, unpadded base64url.
 * @param {unknown} aad The additional authenticated data, exactly as received.
 * @returns {Promise<string | null>} The plaintext, or `null`.
 */
export async function decryptContent(contentKey, ciphertext, aad) {
  if (!isCryptoKey(contentKey)) {
    return null;
  }
  // The second copy of each bound, and each is `>` for the reason its first copy
  // is — but the two reasons are different, and only one of them is a residual.
  // The ciphertext spellings part company at exactly 477868 characters against a
  // largest producible encoding of 477867, so nothing can be sealed at the
  // length that separates them. The AAD spellings part company at exactly 4096
  // code units, which this schema can carry, so the corpus carries a share
  // sealed at it and this copy of the bound is held by that case as much as the
  // first copy is. See `CIPHERTEXT_MAX_B64_LENGTH` and `AAD_MAX_LENGTH`.
  if (typeof ciphertext !== 'string' || ciphertext.length > CIPHERTEXT_MAX_B64_LENGTH) {
    return null;
  }
  if (typeof aad !== 'string' || aad.length > AAD_MAX_LENGTH) {
    return null;
  }
  if (!isWellFormedUtf16(aad)) {
    return null;
  }

  const blob = decodeBase64url(ciphertext);
  if (blob === null || blob.length < MIN_BLOB_BYTE_LENGTH) {
    return null;
  }
  const { nonce, body } = splitBlob(blob);

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: TAG_BIT_LENGTH, additionalData: ENCODER.encode(aad) },
      contentKey,
      body,
    );
    return DECODER.decode(plaintext);
  } catch {
    return null;
  }
}

/**
 * Turn a stored response and the link capability into a document.
 *
 * Derive, unwrap, decrypt, decode. Every step's failure is this function's
 * failure, and every failure is the same `null`.
 *
 * @param {unknown} linkKey The link capability, taken from the fragment.
 * @param {unknown} shareId The share identifier, taken from the fragment.
 * @param {unknown} response The stored response, untrusted.
 * @returns {Promise<DecryptedShare | null>}
 */
export async function decryptShare(linkKey, shareId, response) {
  const fields = readResponse(response);
  if (fields === null) {
    return null;
  }

  // And the same construct one field over, with the same standing. `readResponse`
  // admits only a 43-character stored key, a canonical 43-character unpadded
  // encoding decodes to 32 bytes and to nothing else, and 32 is the count here —
  // so no response separates `!==` from `<` or `>`. Kept because the encoded
  // width is the field's fact and the byte count is the key's, and a key derived
  // over the wrong number of bytes is the failure this refuses rather than
  // reports.
  const serverKey = decodeBase64url(fields.b);
  if (serverKey === null || serverKey.length !== SERVER_KEY_BYTE_LENGTH) {
    return null;
  }

  const kek = await deriveKek(linkKey, serverKey, shareId);
  if (kek === null) {
    return null;
  }

  const contentKey = await unwrapContentKey(kek, fields.wrapped_k);
  if (contentKey === null) {
    return null;
  }

  const plaintext = await decryptContent(contentKey, fields.ciphertext, fields.aad);
  if (plaintext === null) {
    return null;
  }

  return { plaintext, aad: fields.aad };
}
