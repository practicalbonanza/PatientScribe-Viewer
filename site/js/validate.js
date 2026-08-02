/**
 * Validation.
 *
 * Parsing asks "is this well-formed?". This module asks the stricter question:
 * "is this exactly a document of the version it claims to be?" Only a document
 * that passes may reach the renderer.
 *
 * The validator must be an allowlist, not a filter. It must admit the fields the
 * schema fixes and refuse a document carrying anything else — an unexpected
 * field must be a refusal, never something to ignore and render around. That is
 * what makes a later schema version safe to add: a new version gets a new
 * validator and a new dispatch entry, and this one must keep refusing everything
 * it does not recognise.
 *
 * The allowlist is enforced by `readOwnFields`, which admits a value only when
 * its own property set is exactly the named one — nothing extra, nothing
 * inherited standing in for something missing, no symbol-keyed or non-enumerable
 * extra, and no getter in place of a value. Each validator here names its fields
 * once, in one list, and the count is that list's length rather than a second
 * number to keep in step with it. `readOwnElements` below holds an array to the
 * same rule.
 *
 * Every validated value is rebuilt as a fresh object literal rather than passed
 * through. That does not give it an unusual prototype — an object literal has
 * `Object.prototype`, exactly as `JSON.parse` output does — and it is not what
 * the rebuild is for. What the rebuild guarantees is about own properties: the
 * renderer receives a record whose own properties are precisely the fields named
 * here, each holding a value the validator checked, with no getter, no
 * symbol-keyed property, no non-enumerable property and no extra field carried
 * over from the parsed input.
 *
 * Every exported function here is total. Any value at all may be handed to it,
 * including one built to throw when it is looked at, and the answer is a
 * returned refusal rather than an exception — an exception would be a second
 * failure shape, and this module is allowed exactly one.
 *
 * Failure carries no detail. The result type is deliberately unable to express a
 * reason, because a reason would eventually reach a carer and become a second
 * observable failure shape.
 */

import {
  decodeBase64url,
  LINK_SPLIT_V1,
  readOwnFields,
  SHARE_ID_B64_LENGTH,
  SHARE_ID_BYTE_LENGTH,
} from './parse.js';

/**
 * The document version this module validates.
 *
 * Exported so routing and validation cannot drift apart: `dispatch.js` keys its
 * table on this same constant rather than repeating the string.
 *
 * `@satisfies` rather than `@type`: it checks the value without widening it, so
 * the constant keeps its literal type and everything derived from it stays tied
 * to this exact string. Changing the value fails the build here, at the pin,
 * rather than silently retyping the schema everywhere downstream.
 *
 * @satisfies {'share_doc_v1'}
 */
export const SHARE_DOC_V1 = 'share_doc_v1';

/**
 * The one banner a `share_doc_v1` may carry.
 *
 * The document names a banner rather than choosing one, and this is the only
 * name that resolves. What the banner says is not fixed here: the wording
 * travels inside the encrypted document, in `banner_text`, and the viewer
 * renders that embedded text rather than a copy of its own. The name is the
 * allowlist — a document naming any other banner is refused — and the text it
 * admits is the text the document was sealed with.
 *
 * @satisfies {'relay_banner_shared_v1'}
 */
export const RELAY_BANNER_SHARED_V1 = 'relay_banner_shared_v1';

/**
 * The fields of a `share_doc_v1`, in the order they are read.
 *
 * The list is the allowlist. Its length is the field count, so there is no
 * second number that could disagree with it.
 */
const SHARE_DOC_V1_FIELDS = [
  'schema',
  'banner_key',
  'banner_text',
  'you_means',
  'edited',
  'visit_date',
  'topic',
  'sections',
];

/** The fields of one section of a `share_doc_v1`, in the order they are read. */
const SECTION_FIELDS = ['heading', 'lines'];

/** The fields of the additional authenticated data, in the order they are read. */
const AAD_V1_FIELDS = ['v', 'id', 'doc', 'exp', 'edited', 'sfv'];

/**
 * One section of a document.
 *
 * @typedef {object} ShareDocSection
 * @property {string} heading
 * @property {readonly string[]} lines
 */

/**
 * A validated document.
 *
 * @typedef {object} ShareDocV1
 * @property {typeof SHARE_DOC_V1} schema The schema discriminator, tied to the
 *   constant above so the two can never disagree.
 * @property {typeof RELAY_BANNER_SHARED_V1} banner_key Which banner to show.
 * @property {string} banner_text
 * @property {string} you_means Who "you" refers to in the note. Empty is a
 *   value, not an absence: it selects the nameless wording.
 * @property {boolean} edited Whether the note was edited before sharing. Must
 *   agree with the authenticated copy in the AAD, which is what makes this field
 *   trustworthy — on its own it is only what the plaintext claims.
 * @property {string} visit_date
 * @property {string} topic
 * @property {readonly ShareDocSection[]} sections
 */

/**
 * The validated additional authenticated data.
 *
 * This travels with the document because it is the sole display source for
 * expiry and edited state: it is covered by the content tag, so it cannot be
 * changed without the decryption failing, which is not true of anything in the
 * document body.
 *
 * @typedef {object} AadV1
 * @property {typeof LINK_SPLIT_V1} v
 * @property {string} id Share identifier, unpadded base64url.
 * @property {typeof SHARE_DOC_V1} doc
 * @property {number} exp Expiry, a positive integer.
 * @property {boolean} edited
 * @property {string} sfv Non-empty.
 */

/**
 * The outcome of validation: a document, or nothing.
 *
 * @typedef {{ ok: true, doc: ShareDocV1 } | { ok: false }} ValidateResult
 */

/**
 * The outcome of validating the AAD: the authenticated fields, or nothing.
 *
 * @typedef {{ ok: true, aad: AadV1 } | { ok: false }} ValidateAadResult
 */

/**
 * A refusal. One value, shared by every refusal in this module, so there is one
 * failure shape and nothing to read off it.
 *
 * @type {{ ok: false }}
 */
const REFUSED = Object.freeze({ ok: false });

/**
 * Validate the additional authenticated data.
 *
 * Called only on a value parsed from a string the content tag has already
 * authenticated. Validating before that point would be validating something an
 * attacker chose.
 *
 * @param {unknown} value The parsed AAD.
 * @returns {ValidateAadResult} The authenticated fields, or a bare failure.
 */
export function validateAadV1(value) {
  const fields = readOwnFields(value, AAD_V1_FIELDS);
  if (fields === null) {
    return REFUSED;
  }

  const [v, id, doc, exp, edited, sfv] = fields;

  if (v !== LINK_SPLIT_V1 || doc !== SHARE_DOC_V1) {
    return REFUSED;
  }
  // The identifier is checked with the same strict decoder the fragment's is,
  // rather than against a pattern of its own. A pattern can say what characters
  // and how many; it cannot say that the encoding is the only one that produces
  // those bytes, and 60 of the 64 characters that could end a 22-character
  // identifier encode bits there is no byte to hold. One rule, one spelling —
  // and the alternative was an identifier the fragment refuses and the
  // authenticated data admits.
  //
  // The two lengths below move together, so neither comparison is separable from
  // a looser one by any input: a decode of n characters yields the floor of
  // three quarters of n bytes, and 22 is the only character count that reaches
  // 16. An identifier of 23 characters passes a character check written as `<`
  // and is then refused by the byte count, and one of 21 the other way about.
  // What the pair is for is that the two facts are not derived from each other —
  // one is the schema's width, one is the identifier's size — so an edit that
  // moved either alone has to be a refusal rather than a derivation over the
  // wrong bytes. Written here because no authenticated document can be built
  // that tells the spellings apart.
  if (typeof id !== 'string' || id.length !== SHARE_ID_B64_LENGTH) {
    return REFUSED;
  }
  const idBytes = decodeBase64url(id);
  if (idBytes === null || idBytes.length !== SHARE_ID_BYTE_LENGTH) {
    return REFUSED;
  }
  // Safe, not merely integral. A JSON number is parsed into a double, so an
  // integer past 2^53 does not survive the parse: the text `9007199254740993`
  // becomes 9007199254740992, which is an integer, is positive, and is not the
  // number that was sealed. Admitting it would mean showing an expiry the tag
  // never covered — the one thing the authenticated copy exists to prevent.
  // Anything outside the range a reader can carry back exactly is refused.
  if (typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp <= 0) {
    return REFUSED;
  }
  if (typeof edited !== 'boolean') {
    return REFUSED;
  }
  if (typeof sfv !== 'string' || sfv.length === 0) {
    return REFUSED;
  }

  // The two discriminators are written from the constants rather than from the
  // input. They were just proved equal to it, and taking them from the pins is
  // what ties the returned type to those pins.
  return { ok: true, aad: { v: LINK_SPLIT_V1, id, doc: SHARE_DOC_V1, exp, edited, sfv } };
}

/**
 * Validate one section.
 *
 * @param {unknown} value
 * @returns {ShareDocSection | null}
 */
function validateSection(value) {
  const fields = readOwnFields(value, SECTION_FIELDS);
  if (fields === null) {
    return null;
  }

  const [heading, lines] = fields;

  if (typeof heading !== 'string') {
    return null;
  }
  const validated = validateLines(lines);
  if (validated === null) {
    return null;
  }

  return { heading, lines: validated };
}

/**
 * Validate the lines of one section.
 *
 * @param {unknown} value
 * @returns {string[] | null}
 */
function validateLines(value) {
  const elements = readOwnElements(value);
  if (elements === null) {
    return null;
  }

  /** @type {string[]} */
  const validated = [];
  for (const line of elements) {
    if (typeof line !== 'string') {
      return null;
    }
    validated.push(line);
  }

  return validated;
}

/**
 * Read an array's elements as its own data properties, or refuse.
 *
 * The array counterpart of `readOwnFields`, held to the same rule for the same
 * reasons. `Array.isArray` says a value is an array; it does not say the
 * elements are there to be read, and it says nothing at all about what else the
 * value is carrying. Iterating runs whatever the value's iterator is, and
 * reading an index runs whatever a getter at that index is, so the elements come
 * from descriptors rather than from property reads.
 *
 * Exactness, in the same four senses:
 *
 * - The length is taken from the own `length` descriptor, not from `.length`. On
 *   an array `length` is an own, non-configurable data property — the slot
 *   itself, with no accessor to run — while `.length` is a property read, and a
 *   proxy's `get` trap answers it. A value that reported zero that way returned
 *   an empty array here and a document that validated with none of its sections.
 * - The own property set it lists must be exactly the indices below that length
 *   plus `length` itself: one name per element, and one more. So an extra own
 *   property, or a non-enumerable one, is a refusal rather than something to
 *   walk past — an array is a record with numeric names, and the reason to
 *   refuse a record carrying an unexpected field applies to it unchanged. Lists
 *   rather than carries, for the reason `readOwnFields` says it: the count comes
 *   from asking the value, and a proxy may answer with fewer names than its
 *   target holds.
 * - No symbol-keyed own property.
 * - Every element an enumerable own data property, never an accessor.
 *
 * What that cannot do is see through a value that lies consistently, and there
 * are two of those rather than one. A proxy whose traps agree with each other
 * about a shorter array is, to every reflection there is, that shorter array. So
 * is one that carries an unexpected own property and leaves that one name out of
 * its listing: the count is still one per element plus `length`, every element
 * still reads, and the property is still there. Nothing available to a script
 * distinguishes either of them from the value it is imitating, and neither can
 * arrive here — every value that does comes from `JSON.parse` in this one realm,
 * and this function's caller rebuilds what it reads. What is ruled out is the
 * value that answers differently depending on which way it is asked, which is
 * what a `get` trap over a real array is.
 *
 * @param {unknown} value
 * @returns {unknown[] | null}
 */
function readOwnElements(value) {
  // Guarded for the same reason `readOwnFields` is: a hostile value can be a
  // proxy, and a proxy's traps run on the reflection calls themselves.
  try {
    if (!Array.isArray(value)) {
      return null;
    }

    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (lengthDescriptor === undefined || !('value' in lengthDescriptor)) {
      return null;
    }
    const length = lengthDescriptor.value;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
      return null;
    }

    if (Object.getOwnPropertySymbols(value).length !== 0) {
      return null;
    }
    // One name per element, plus `length`. Every index below the length is
    // proved to be an own property in the loop, so a count of exactly one more
    // than the length leaves room for nothing else.
    if (Object.getOwnPropertyNames(value).length !== length + 1) {
      return null;
    }

    /** @type {unknown[]} */
    const elements = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (descriptor === undefined || descriptor.enumerable !== true || !('value' in descriptor)) {
        return null;
      }
      elements.push(descriptor.value);
    }

    return elements;
  } catch {
    return null;
  }
}

/**
 * Validate an unvalidated document body against the fixed schema.
 *
 * @param {unknown} value The document body, straight from the parser.
 * @returns {ValidateResult} A validated document, or a bare failure carrying no
 *   detail about what was wrong.
 */
export function validateShareDocV1(value) {
  const fields = readOwnFields(value, SHARE_DOC_V1_FIELDS);
  if (fields === null) {
    return REFUSED;
  }

  const [schema, banner_key, banner_text, you_means, edited, visit_date, topic, sections] = fields;

  if (schema !== SHARE_DOC_V1 || banner_key !== RELAY_BANNER_SHARED_V1) {
    return REFUSED;
  }
  if (typeof banner_text !== 'string' || typeof you_means !== 'string') {
    return REFUSED;
  }
  if (typeof edited !== 'boolean') {
    return REFUSED;
  }
  if (typeof visit_date !== 'string' || typeof topic !== 'string') {
    return REFUSED;
  }

  const elements = readOwnElements(sections);
  if (elements === null) {
    return REFUSED;
  }

  /** @type {ShareDocSection[]} */
  const validatedSections = [];
  for (const section of elements) {
    const validated = validateSection(section);
    if (validated === null) {
      return REFUSED;
    }
    validatedSections.push(validated);
  }

  return {
    ok: true,
    doc: {
      schema: SHARE_DOC_V1,
      banner_key: RELAY_BANNER_SHARED_V1,
      banner_text,
      you_means,
      edited,
      visit_date,
      topic,
      sections: validatedSections,
    },
  };
}
