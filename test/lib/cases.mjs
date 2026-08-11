/**
 * The corpus.
 *
 * Every case is a value: an input, a kind, and what the viewer must be observed
 * to do with it. Nothing here runs viewer code — that is the driver's job — and
 * nothing here compares anything — that is the host's. Keeping the three apart
 * is what makes the corpus the same corpus in node and in both browser engines.
 *
 * Almost every input is expressed as text rather than as a structure, because
 * the corpus travels through JSON to reach a browser and text survives that
 * unchanged. It also lets a case say exactly what arrives — a duplicate member,
 * a member named `__proto__`, a number no JavaScript literal would write the
 * same way — which a structure could not.
 *
 * Every case names every field its kind observes. The host fails a case that
 * saw a field the case did not name, so there is no such thing here as a partial
 * expectation: the shorthands just below exist so that naming all of them is one
 * spread rather than eight lines, not so that some can be left out.
 *
 * What a case says the viewer must do stays on this side. `observableCases`
 * below is what crosses into the page, and it carries the inputs and nothing
 * else. That is not tidiness. While the expectations travelled with the cases, a
 * driver that imported no viewer module at all and handed each case's own
 * expectation straight back satisfied the entire corpus in both engines — so
 * every green result this suite has ever produced, including the ones about the
 * viewer being correct, rested on the driver being honest rather than on the
 * corpus being answerable only by running something.
 *
 * The interop fixtures are the only inputs not written here: they come from
 * `../vectors/vectors.json`, produced by a generator in another language on
 * another stack, so agreement with them is agreement with something, rather than
 * the viewer agreeing with itself.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** @type {any} */
export const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL('../vectors/vectors.json', import.meta.url)), 'utf8'),
);

/**
 * The canonical form of a value: members sorted by code unit, no whitespace,
 * integers as digits.
 *
 * Not a viewer function and never one. The viewer canonicalises nothing — it
 * authenticates the bytes it was handed — which is exactly why this is here: the
 * vector file publishes canonicalisation records as a conformance target, and
 * the side of the protocol that has to canonicalise is the producing side. Each
 * record now carries the input as well as the string it must produce, and this
 * is what turns the pair into something a reader can check rather than two
 * spellings of the same answer.
 *
 * `JSON.stringify` of a string escapes what the generator escapes and nothing
 * else, and `Array.prototype.sort` orders by UTF-16 code unit, which is the
 * ordering the form specifies. Both suites recompute the records with it.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const source = /** @type {Record<string, unknown>} */ (value);
    return `{${Object.keys(source)
      .sort()
      .map((name) => `${JSON.stringify(name)}:${canonicalJson(source[name])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The largest ciphertext the viewer will decode, pinned here as well as in the
 * viewer. A change to the bound has to be a deliberate change in two places, and
 * `constants/bounds` below compares the two.
 */
export const CIPHERTEXT_MAX_B64_LENGTH = Math.ceil((350 * 1024) / 3) * 4;

/** The largest AAD the viewer will look at, pinned here as well as in the viewer. */
export const AAD_MAX_LENGTH = 4096;

/**
 * A case, with what the viewer must be observed to do with it.
 *
 * @typedef {import('./driver.mjs').Case & { expect: Record<string, unknown> }} CorpusCase
 */

/**
 * Every field of a case the driver reads.
 *
 * An allowlist rather than a list of what to strip, so that a field added to a
 * case is either named here — a deliberate, reviewable act — or does not reach
 * the page at all. The one thing that must never reach it is the expectation,
 * and a rule written as "everything except `expect`" would hold only until the
 * second name for the same idea appeared.
 *
 * @type {readonly string[]}
 */
export const CASE_FIELDS = [
  'name',
  'kind',
  'text',
  'wrap',
  'aadText',
  'docText',
  'a',
  'b',
  'id',
  'wrapped',
  'ciphertext',
  'response',
  'responseParts',
  'synth',
  'synthCodeUnit',
  'docVersion',
  'aadProbe',
  'root',
  'render',
  'call',
  'slot',
  'hostile',
  'record',
  'names',
  'namesKind',
  'predicate',
  'characters',
  'characterKind',
  'tamper',
  'aadTamper',
  'reseal',
  'idCheck',
  'flow',
];

/**
 * The corpus as it crosses into the page: the inputs, and nothing that could be
 * handed back in place of running the viewer.
 *
 * @param {readonly CorpusCase[]} cases
 * @returns {import('./driver.mjs').Case[]}
 */
export function observableCases(cases) {
  /** @type {import('./driver.mjs').Case[]} */
  const stripped = [];
  for (const item of cases) {
    /** @type {Record<string, unknown>} */
    const copy = {};
    for (const field of CASE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(item, field)) {
        copy[field] = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (item))[field];
      }
    }
    stripped.push(/** @type {import('./driver.mjs').Case} */ (/** @type {unknown} */ (copy)));
  }
  return stripped;
}

/**
 * @param {string} text
 * @returns {Buffer}
 */
const decode = (text) => Buffer.from(text, 'base64url');

/**
 * @param {Buffer | Uint8Array} bytes
 * @returns {string}
 */
const encode = (bytes) => Buffer.from(bytes).toString('base64url');

/**
 * @param {string} text
 * @returns {number[]}
 */
const bytesOf = (text) => Array.from(decode(text));

/**
 * Flip the low bit of one byte of an encoded blob.
 *
 * @param {string} text
 * @param {number} index Negative counts back from the end.
 * @returns {string}
 */
const flipBit = (text, index) => {
  const bytes = decode(text);
  const at = index < 0 ? bytes.length + index : index;
  const byte = bytes[at];
  if (byte === undefined) {
    throw new RangeError(`no byte at ${index}`);
  }
  bytes[at] = byte ^ 1;
  return encode(bytes);
};

/**
 * Drop bytes from the end of an encoded blob and re-encode.
 *
 * @param {string} text
 * @param {number} count
 * @returns {string}
 */
const dropBytes = (text, count) => encode(decode(text).subarray(0, decode(text).length - count));

const fixtures = vectors.fixtures;
const derivations = vectors.derivations;
const named = fixtures[0];
const nameless = fixtures[1];
const edited = fixtures[2];
const wide = fixtures[3];
const replacement = fixtures[4];
const combining = fixtures[5];
const astral = fixtures[6];

/**
 * The shape every refusal in the viewer has: one field, frozen, and the same
 * value every time. Asserted on every refusing case, because a refusal that had
 * grown a reason would still report `ok: false`.
 */
const REFUSAL = { resultKeys: ['ok'], frozen: true, isTheRefusal: true };

/** The fields a validated AAD carries, in the order the validator writes them. */
const AAD_KEYS = ['v', 'id', 'doc', 'exp', 'edited', 'sfv'];

/** The fields a validated document carries, in the order the validator writes them. */
const DOC_KEYS = [
  'schema',
  'banner_key',
  'banner_text',
  'you_means',
  'edited',
  'visit_date',
  'topic',
  'sections',
];

/**
 * What a key derived by this viewer must be. Not a detail of the algorithm: a
 * key that could be exported decrypts exactly as well as one that cannot, so no
 * outcome distinguishes them and only this does.
 */
const KEK_SHAPE = { extractable: false, usages: ['unwrapKey'], algorithm: { name: 'AES-GCM', length: 256 } };

/** @see KEK_SHAPE */
const CONTENT_KEY_SHAPE = { extractable: false, usages: ['decrypt'], algorithm: { name: 'AES-GCM', length: 256 } };

/** Every field an `aad` case observes, for an input that must be refused. */
const AAD_REFUSED = { ok: false, ...REFUSAL, aadKeys: null, aad: null };

/** Every field a `document` case observes, for text that does not parse. */
const DOC_UNPARSED = {
  parsed: false,
  docVersion: null,
  ok: false,
  resultKeys: null,
  frozen: null,
  isTheRefusal: null,
  docKeys: null,
  doc: null,
};

/** Every field a `resolve` case observes, for a pair that must be refused. */
const RESOLVE_REFUSED = { ok: false, ...REFUSAL, aad: null, doc: null };

/** Every field a `decrypt` case observes, for a response that must be refused. */
const DECRYPT_REFUSED = { ok: false, plaintext: null, aad: null };

/**
 * The AAD a valid input must come back as: exactly these fields, exactly these
 * values, written in the order the validator writes them so a comparison by
 * serialisation is a comparison of the order too.
 *
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
const expectedAad = (text) => {
  const aad = JSON.parse(text);
  return { v: aad.v, id: aad.id, doc: aad.doc, exp: aad.exp, edited: aad.edited, sfv: aad.sfv };
};

/**
 * The document a valid input must come back as. Rebuilt field by field for the
 * same reason.
 *
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
const expectedDoc = (text) => {
  const doc = JSON.parse(text);
  return {
    schema: doc.schema,
    banner_key: doc.banner_key,
    banner_text: doc.banner_text,
    you_means: doc.you_means,
    edited: doc.edited,
    visit_date: doc.visit_date,
    topic: doc.topic,
    sections: doc.sections.map((/** @type {any} */ section) => ({
      heading: section.heading,
      lines: [...section.lines],
    })),
  };
};

/**
 * Every field an `aad` case observes, for an input that must be admitted.
 *
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
const aadAdmitted = (text) => ({
  ok: true,
  resultKeys: ['aad', 'ok'],
  frozen: false,
  isTheRefusal: false,
  aadKeys: AAD_KEYS,
  aad: expectedAad(text),
});

/**
 * Every field a `document` case observes, for a document that parses and is
 * then refused.
 *
 * @param {string} [version]
 * @returns {Record<string, unknown>}
 */
const docRefused = (version = 'share_doc_v1') => ({
  parsed: true,
  docVersion: version,
  ok: false,
  ...REFUSAL,
  docKeys: null,
  doc: null,
});

/**
 * Every field a `document` case observes, for a document that must be admitted.
 *
 * @param {string} text
 * @param {Record<string, unknown>} [doc] What it must come back as, when that is
 *   not simply the input read back.
 * @returns {Record<string, unknown>}
 */
const docAdmitted = (text, doc) => ({
  parsed: true,
  docVersion: 'share_doc_v1',
  ok: true,
  resultKeys: ['doc', 'ok'],
  frozen: false,
  isTheRefusal: false,
  docKeys: DOC_KEYS,
  doc: doc ?? expectedDoc(text),
});

/**
 * The stored response for a fixture, as the server would return it.
 *
 * @param {any} fixture
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
const responseFor = (fixture, overrides = {}) => ({
  b: fixture.inputs.b,
  wrapped_k: fixture.outputs.wrapped_k,
  ciphertext: fixture.outputs.ciphertext,
  aad: fixture.inputs.aad,
  ...overrides,
});

/**
 * A document derived from the named fixture's plaintext by mutating a copy.
 *
 * @param {(doc: any) => void} mutate
 * @returns {string}
 */
const docText = (mutate) => {
  const doc = JSON.parse(named.inputs.plaintext);
  mutate(doc);
  return JSON.stringify(doc);
};

/**
 * An AAD derived from the named fixture's by mutating a copy.
 *
 * @param {(aad: any) => void} mutate
 * @returns {string}
 */
const aadText = (mutate) => {
  const aad = JSON.parse(named.inputs.aad);
  mutate(aad);
  return JSON.stringify(aad);
};

/**
 * An AAD with its expiry respelled as literal text.
 *
 * Not reachable through a structure: the numbers worth asking about are the ones
 * a reader cannot carry back exactly, and writing one as a JavaScript literal
 * loses it before it ever becomes text.
 *
 * @param {string} spelling
 * @returns {string}
 */
const aadWithExpiry = (spelling) => named.inputs.aad.replace('1767225600', spelling);

/**
 * The named fixture's authenticated data, padded out to exactly `length` code
 * units by lengthening its one free-form field.
 *
 * Here because the bound on that string is written `>`, and the one length that
 * tells `>` from `>=` is the bound itself — so separating them needs a string of
 * exactly that length, and the corpus had none. The comment beside the bound
 * used to call that a length no producer of this schema emits, which is not so:
 * the schema fixes six scalar fields and constrains the last of them only to be
 * a non-empty string, so an authenticated data of any length this bound admits
 * is one the validator admits too. This builds one, with every other field and
 * the canonical member order exactly as the fixture has them.
 *
 * @param {number} length
 * @returns {string}
 */
const aadOfExactly = (length) => {
  const base = named.inputs.aad;
  const pad = length - base.length;
  if (pad < 0) {
    throw new Error(`the fixture's authenticated data is already longer than ${length} code units`);
  }
  const grown = base.replace('"sfv":"1"', `"sfv":"${'1'.repeat(1 + pad)}"`);
  if (grown.length !== length) {
    throw new Error(`the authenticated data came out ${grown.length} code units rather than ${length}`);
  }
  return grown;
};

/**
 * The named fixture's AAD with its members written in the reverse order.
 *
 * The same six members with the same six values, so it means exactly what the
 * sealed one means — and it is not the string the tag covers, which is the whole
 * reason the viewer must never rebuild it.
 *
 * @returns {string}
 */
const reorderedAad = () => {
  const aad = JSON.parse(named.inputs.aad);
  /** @type {Record<string, unknown>} */
  const reversed = {};
  for (const key of Object.keys(aad).reverse()) {
    reversed[key] = aad[key];
  }
  return JSON.stringify(reversed);
};

/** The fragment's fixed pieces, so a case can rebuild it wrongly on purpose. */
const ID = named.inputs.id;
const A = named.inputs.a;
const VALID_FRAGMENT = `#v=link_split_v1&id=${ID}&a=${A}`;

/**
 * What serialising a parsed link must produce: the version and the identifier,
 * and no third thing. Computed here rather than written out, so the assertion is
 * about which fields are reachable rather than about how a `Uint8Array` happens
 * to serialise.
 */
const PARAMS_JSON = JSON.stringify({ v: 'link_split_v1', id: new Uint8Array(decode(ID)) });

/** The same, as entries. */
const PARAMS_ENTRIES_JSON = JSON.stringify([
  ['v', 'link_split_v1'],
  ['id', new Uint8Array(decode(ID))],
]);

/** Every field a `fragment` case observes, for a fragment that parses. */
const FRAGMENT_PARSED = {
  parsed: true,
  v: 'link_split_v1',
  id: bytesOf(ID),
  // The accessor is an own property and not an enumerable one, so it is there
  // to be called and not there to be walked over.
  keys: ['v', 'id'],
  ownNames: ['v', 'id', 'takeLinkKey'],
  symbolCount: 0,
  json: PARAMS_JSON,
  frozen: true,
  take1: bytesOf(A),
  take2: null,
  take3: null,
};

/** The own properties a node-shaped double carries, and the only ones it may. */
const NODE_OWN_NAMES = ['firstChild', 'replaceChildren'];

/**
 * The root shapes a render, dispatch or clear case can be given, and what each
 * of them does when the viewer writes to it.
 *
 * `attempted` and `completed` are about the call; `remaining` is about the root,
 * and is `null` for the shapes that hold no children because they are not the
 * kind of thing that could. `method-ignores` is the shape the plain ones could
 * not express: it answers the call, returns from it, and keeps everything it was
 * holding. A clear that reported whether the call returned called that a
 * success, so both render functions would have drawn over a note that was still
 * on the page — the one failure the clear exists to prevent.
 *
 * `method-needs-receiver` is the second of those shapes. Every other double
 * answers a bare call exactly as it answers a call made on the root, so the step
 * that supplies the receiver was doing nothing any case could see and could be
 * dropped in a word. This one refuses a call that arrives without its root, the
 * way a node's own method does, so the difference has an answer.
 *
 * `ownNames` is what the root is carrying once the viewer has finished with it,
 * and it is here because the counters cannot see a write that is not the clear.
 * None of these roots is this viewer's page, so both render functions empty one
 * and draw nothing over it — which meant a line putting text on the root changed
 * no count, no child and no outcome, and text on an element is a permitted
 * write, so no sink rule refused it either. What refuses it is the root's own
 * property set being exactly what it was built with.
 *
 * `callable-with-a-write` is the shape the type gate above the clear is about.
 * That gate names `'object'`, and every other root it refuses is refused a step
 * later anyway for carrying no write at all — so widening it to admit callables
 * changed no answer here. This one is a function that really does carry a
 * working write, which makes the gate the only thing that refuses it.
 *
 * `writeArguments` is the other half of that, and it is zero everywhere but one.
 * A clear handed something to put back in place of what it removed is a write of
 * that thing, and this viewer is allowed exactly one write. A number that is
 * zero in every case is also what a counter that had stopped counting would
 * report, so `already-written-to` is a root something really did hand a child to
 * before the viewer saw it: the number there is one, and a counter answering
 * zero fails it.
 *
 * `method-without-firstChild` is the shape the emptiness test itself is about.
 * It answers the write and has nothing to read back from, so what it says about
 * its first child is `undefined` rather than `null` — one character apart in
 * that comparison, and the difference between a root reported as empty and a
 * root that cannot say whether it is.
 *
 * `method-is-an-object-with-call` is what tells the callable test from what
 * happens next. `method-not-callable` carries a number, and a number's `.call`
 * throws — which the guard around the whole thing catches, so the root is
 * refused either way and the test itself was doing nothing any case could see.
 * This one carries an object with a `call` method that really does empty the
 * root, so `typeof clear !== 'function'` relaxed to `typeof clear < 'function'`
 * stops refusing it and the clear reports a success: `'object'` sorts after
 * `'function'`, the guard does not fire, and the object's own `call` runs. The
 * counters and the child count say which happened.
 *
 * @type {Readonly<Record<string, { attempted: number, completed: number, remaining: number | null, emptied: boolean, ownNames: string[] | null, writeArguments: number }>>}
 */
const ROOT_BEHAVIOUR = Object.freeze({
  element: { attempted: 1, completed: 1, remaining: 0, emptied: true, ownNames: NODE_OWN_NAMES, writeArguments: 0 },
  'method-ignores': { attempted: 1, completed: 1, remaining: 2, emptied: false, ownNames: NODE_OWN_NAMES, writeArguments: 0 },
  'method-throws': { attempted: 1, completed: 0, remaining: 2, emptied: false, ownNames: NODE_OWN_NAMES, writeArguments: 0 },
  'method-needs-receiver': { attempted: 1, completed: 1, remaining: 0, emptied: true, ownNames: NODE_OWN_NAMES, writeArguments: 0 },
  'already-written-to': { attempted: 2, completed: 2, remaining: 0, emptied: true, ownNames: NODE_OWN_NAMES, writeArguments: 1 },
  'method-without-firstChild': {
    attempted: 1,
    completed: 1,
    remaining: null,
    emptied: false,
    ownNames: ['replaceChildren'],
    writeArguments: 0,
  },
  'method-not-callable': { attempted: 0, completed: 0, remaining: null, emptied: false, ownNames: ['replaceChildren'], writeArguments: 0 },
  'method-is-an-object-with-call': {
    attempted: 0,
    completed: 0,
    remaining: 2,
    emptied: false,
    ownNames: NODE_OWN_NAMES,
    writeArguments: 0,
  },
  'callable-with-a-write': {
    attempted: 0,
    completed: 0,
    remaining: 2,
    emptied: false,
    // A function's own properties, plus the two it was given. `length` and
    // `name` are the function's own and are here because this observation is
    // what the root is carrying afterwards rather than a list of what was put
    // on it.
    ownNames: ['firstChild', 'length', 'name', 'replaceChildren'],
    writeArguments: 0,
  },
  'no-method': { attempted: 0, completed: 0, remaining: null, emptied: false, ownNames: [], writeArguments: 0 },
  null: { attempted: 0, completed: 0, remaining: null, emptied: false, ownNames: null, writeArguments: 0 },
  undefined: { attempted: 0, completed: 0, remaining: null, emptied: false, ownNames: null, writeArguments: 0 },
  number: { attempted: 0, completed: 0, remaining: null, emptied: false, ownNames: null, writeArguments: 0 },
  string: { attempted: 0, completed: 0, remaining: null, emptied: false, ownNames: null, writeArguments: 0 },
  array: { attempted: 0, completed: 0, remaining: null, emptied: false, ownNames: ['length'], writeArguments: 0 },
});

const ROOT_SHAPES = Object.keys(ROOT_BEHAVIOUR);

/**
 * What each shape does, by name, with the lookup narrowed once here rather than
 * at every use.
 *
 * @param {string} shape
 * @returns {{ attempted: number, completed: number, remaining: number | null, emptied: boolean, ownNames: string[] | null, writeArguments: number }}
 */
const behaviourOf = (shape) => {
  const behaviour = ROOT_BEHAVIOUR[shape];
  if (behaviour === undefined) {
    throw new RangeError(`no root shape called ${shape}`);
  }
  return behaviour;
};

/** The ones a clear cannot empty, whether or not it can be attempted on them. */
const UNCLEARABLE_ROOTS = ROOT_SHAPES.filter((shape) => !behaviourOf(shape).emptied);

/**
 * Every field a `render` case observes, for a given root shape.
 *
 * @param {string} shape
 * @returns {Record<string, unknown>}
 */
const renderExpectation = (shape) => {
  const { attempted, completed, remaining, ownNames, writeArguments } = behaviourOf(shape);
  return { cleared: completed, attempted, remaining, rootOwnNames: ownNames, writeArguments };
};

/**
 * Every field a `dispatch` case observes.
 *
 * @param {string} shape
 * @param {boolean} aadInspected
 * @returns {Record<string, unknown>}
 */
const dispatchExpectation = (shape, aadInspected) => ({ ...renderExpectation(shape), aadInspected });

/**
 * Every field a `clear` case observes.
 *
 * @param {string} shape
 * @returns {Record<string, unknown>}
 */
const clearExpectation = (shape) => {
  const { attempted, completed, remaining, emptied, ownNames, writeArguments } = behaviourOf(shape);
  return { emptied, attempted, completed, remaining, rootOwnNames: ownNames, writeArguments };
};

/**
 * Build the corpus.
 *
 * @returns {{ cases: CorpusCase[], probes: string[], secrets: number }}
 */
export function buildCases() {
  /** @type {CorpusCase[]} */
  const cases = [];

  // ---- Fragments -------------------------------------------------------

  cases.push({
    name: 'fragment/valid',
    kind: 'fragment',
    text: VALID_FRAGMENT,
    expect: FRAGMENT_PARSED,
  });

  cases.push({
    name: 'fragment/valid-without-hash',
    kind: 'fragment',
    text: VALID_FRAGMENT.slice(1),
    expect: FRAGMENT_PARSED,
  });

  // Serialising a parsed link must not reach the capability, and nothing
  // ordinary may be able to make it reach: not a `toJSON` on the object, not a
  // `toJSON` on the accessor, not a redefinition of either, not a spread, not a
  // clone. Each of those is attempted here and each must come back refused —
  // and the confinement scan over everything reported is what says the bytes did
  // not appear anyway.
  //
  // Every one of those attempts asks whether something can be added. None of
  // them asked what was already there, and the capability does not have to be
  // added to ride out on the accessor — hanging it off the function as an own
  // property before the freeze put it somewhere no case looked, and it survived
  // the whole corpus. The accessor's own property names are pinned for that
  // reason: a frozen arrow function carries `length` and `name`, no symbols, and
  // nothing else. `plantedOwnNames` is the same reading taken of a function that
  // is carrying one, so a clean answer is an answer.
  cases.push({
    name: 'capability/cannot-reach-serialisation',
    kind: 'capability',
    text: VALID_FRAGMENT,
    expect: {
      parsed: true,
      accessorEnumerable: false,
      accessorWritable: false,
      accessorConfigurable: false,
      accessorFrozen: true,
      accessorOwnNames: ['length', 'name'],
      accessorOwnSymbols: 0,
      plantedOwnNames: ['length', 'linkKey', 'name'],
      frozen: true,
      extensible: false,
      attachToAccessor: 'refused',
      attachToParams: 'refused',
      defineOnAccessor: 'refused',
      defineOnParams: 'refused',
      replaceAccessor: 'refused',
      json: PARAMS_JSON,
      jsonAfterAttempts: PARAMS_JSON,
      entries: PARAMS_ENTRIES_JSON,
      spreadKeys: ['v', 'id'],
      spreadJson: PARAMS_JSON,
      cloned: PARAMS_JSON,
      // Not a defect, and recorded so it stays deliberate: the fragment is the
      // carrier, so parsing it again yields the capability again.
      reparsedTake: bytesOf(A),
      take1: bytesOf(A),
      take2: null,
    },
  });

  /** @type {[string, string][]} */
  const rejectedFragments = [
    ['empty', ''],
    ['hash-only', '#'],
    ['wrong-order', `#a=${A}&id=${ID}&v=link_split_v1`],
    ['version-last', `#id=${ID}&a=${A}&v=link_split_v1`],
    ['id-and-key-swapped', `#v=link_split_v1&a=${A}&id=${ID}`],
    ['missing-key', `#v=link_split_v1&id=${ID}`],
    ['missing-id', `#v=link_split_v1&a=${A}`],
    ['missing-version', `#id=${ID}&a=${A}`],
    ['duplicate-id', `#v=link_split_v1&id=${ID}&id=${ID}&a=${A}`],
    ['duplicate-key', `#v=link_split_v1&id=${ID}&a=${A}&a=${A}`],
    ['duplicate-version', `#v=link_split_v1&v=link_split_v1&id=${ID}&a=${A}`],
    ['extra-parameter', `${VALID_FRAGMENT}&x=1`],
    ['unknown-version', `#v=link_split_v2&id=${ID}&a=${A}`],
    ['empty-version', `#v=&id=${ID}&a=${A}`],
    ['id-too-short', `#v=link_split_v1&id=${ID.slice(0, 21)}&a=${A}`],
    ['id-too-long', `#v=link_split_v1&id=${ID}A&a=${A}`],
    ['key-too-short', `#v=link_split_v1&id=${ID}&a=${A.slice(0, 42)}`],
    ['key-too-long', `#v=link_split_v1&id=${ID}&a=${A}A`],
    ['id-padded', `#v=link_split_v1&id=${ID.slice(0, 20)}==&a=${A}`],
    ['key-padded', `#v=link_split_v1&id=${ID}&a=${A.slice(0, 42)}=`],
    ['id-standard-base64-alphabet', `#v=link_split_v1&id=${`+${ID.slice(1)}`}&a=${A}`],
    ['key-standard-base64-alphabet', `#v=link_split_v1&id=${ID}&a=${`${A.slice(0, 42)}/`}`],
    ['key-non-ascii', `#v=link_split_v1&id=${ID}&a=${`${A.slice(0, 42)}é`}`],
    ['id-non-canonical-trailing-bits', `#v=link_split_v1&id=${`${ID.slice(0, 21)}x`}&a=${A}`],
    ['key-non-canonical-trailing-bits', `#v=link_split_v1&id=${ID}&a=${`${A.slice(0, 42)}9`}`],
    ['trailing-ampersand', `${VALID_FRAGMENT}&`],
    ['trailing-character', `${VALID_FRAGMENT}x`],
    ['leading-space', ` ${VALID_FRAGMENT}`],
    ['double-hash', `#${VALID_FRAGMENT}`],
    // The strip step itself, which the layout comparison downstream is blind to:
    // what it compares is whatever the strip produced. Removing a `#` from
    // wherever it is found accepts the first of these, removing a trailing one
    // accepts the second, and removing whichever character happens to be first
    // accepts the third — each a one-token edit, and each an accepted set that
    // is not the one legal layout. The leading `#` stays optional; it is the
    // step that is pinned, not the policy.
    ['hash-inside-the-fragment', `${VALID_FRAGMENT.slice(1, 21)}#${VALID_FRAGMENT.slice(21)}`],
    ['trailing-hash', `${VALID_FRAGMENT.slice(1)}#`],
    ['leading-character-that-is-not-a-hash', `x${VALID_FRAGMENT.slice(1)}`],
    ['percent-encoded', VALID_FRAGMENT.replace('v=', '%76=')],
    ['query-separator', VALID_FRAGMENT.replace('&id=', '?id=')],
    ['oversize', `${VALID_FRAGMENT}${'x'.repeat(4096)}`],
  ];
  // The three fixed pieces of the grammar, each mangled in place so the
  // fragment is still exactly 87 characters long. Length is the check that
  // catches almost everything, which is why almost everything above is caught
  // whether or not the layout is compared at all — and the third separator's
  // comparison could be deleted outright with every case above still passing,
  // after which `?a=`, `&b=` and three characters of anything at all parsed and
  // handed back the right capability. A separator is not a delimiter here, it is
  // three bytes of the one legal layout.
  const LAYOUT = VALID_FRAGMENT.slice(1);

  /**
   * @param {number} offset
   * @param {string} replacement
   * @returns {string}
   */
  const respell = (offset, replacement) =>
    `#${LAYOUT.slice(0, offset)}${replacement}${LAYOUT.slice(offset + replacement.length)}`;

  /** @type {[string, string][]} */
  const respeltFragments = [
    ['version-field-capitalised', respell(0, 'V=link_split_v1')],
    ['version-field-separator-respelled', respell(0, 'v-link_split_v1')],
    ['id-parameter-renamed', respell(15, '&ix=')],
    ['id-separator-arbitrary', respell(15, 'xxxx')],
    ['key-separator-is-a-query', respell(41, '?a=')],
    ['key-parameter-renamed', respell(41, '&b=')],
    ['key-separator-arbitrary', respell(41, 'xyz')],
    ['key-separator-without-its-equals', respell(41, '&a&')],
  ];
  for (const [name, text] of respeltFragments) {
    rejectedFragments.push([name, text]);
  }

  // The leftover-bit rule where a link actually carries one, at every bit of
  // both fields. The two trailing-bit fragments above each set the lowest bit
  // and nothing else, so the mask that refuses them could be narrowed with both
  // still refused — and under that narrowing the identifier below with only its
  // top leftover bit set decodes to the same sixteen bytes as the real one, so
  // the link parses and hands back the same capability under a different
  // spelling. The bit widths are four for the 22-character identifier and two
  // for the 43-character capability; see the base64 family for the same rule
  // asked of the decoder directly.
  /** @type {[string, string][]} */
  const nonCanonicalFinalCharacters = [
    ['bit-0', 'B'],
    ['bit-1', 'C'],
    ['bit-2', 'E'],
    ['bit-3', 'I'],
  ];
  for (const [which, character] of nonCanonicalFinalCharacters) {
    rejectedFragments.push([
      `id-leftover-${which}`,
      `#v=link_split_v1&id=${ID.slice(0, 21)}${character}&a=${A}`,
    ]);
  }
  for (const [which, character] of nonCanonicalFinalCharacters.slice(0, 2)) {
    rejectedFragments.push([
      `key-leftover-${which}`,
      `#v=link_split_v1&id=${ID}&a=${A.slice(0, 42)}${character}`,
    ]);
  }

  for (const [name, text] of rejectedFragments) {
    cases.push({ name: `fragment/${name}`, kind: 'fragment', text, expect: { parsed: false } });
  }

  // Every exported function in the viewer takes whatever it is given and returns
  // a refusal, never an exception. Text is what these functions are for, so a
  // value that is not text is the input most likely to be reached by a mistake
  // somewhere above them — and the one a `.length` or a `.startsWith` written
  // without thinking would throw on.
  //
  // Two of these are shapes that are not merely wrong but persuasive. An object
  // is not a string, and anything that stringifies its input would turn the
  // coercible ones into a whole valid document — a parser that coerces is a
  // parser whose input was chosen by the value rather than by its caller.
  //
  // And the last is the one every other entry here is blind to. A benign wrong
  // type is refused by a type test and by a length test alike, so none of them
  // can say which of the two ran or in which order, and the order is the whole
  // of it: a `length` read on something not yet proved to be a string runs an
  // accessor the value chose, and an accessor that throws turns this viewer's
  // one returned refusal into an escaping exception. This value throws when its
  // length is read and does nothing at all when its type is asked first.
  /** @type {[string, unknown, string | undefined][]} */
  const notStrings = [
    ['null', null, undefined],
    ['a-number', 1, undefined],
    ['zero', 0, undefined],
    ['true', true, undefined],
    ['false', false, undefined],
    ['an-array', [], undefined],
    ['an-object', {}, undefined],
    ['an-object-with-a-length', { length: 43 }, undefined],
    ['coercible-to-a-fragment', VALID_FRAGMENT, 'coercible'],
    ['coercible-to-an-encoding', A, 'coercible'],
    ['coercible-to-an-aad', named.inputs.aad, 'coercible'],
    ['coercible-to-a-document', named.inputs.plaintext, 'coercible'],
    ['with-a-hostile-length', undefined, 'hostile-length'],
  ];
  // What a fragment costs on the way to its answer, which is the only thing
  // there is to see of the one bound on this path. A fragment longer than the
  // one legal layout plus its optional `#` is refused by that bound and would
  // have been refused by the length comparison two lines later, so widening the
  // bound a thousandfold — or deleting the comparison that reads it — changes no
  // answer any case above can report. What it changes is whether this page
  // copies the oversized string before refusing it, and a copy is what `slice`
  // makes.
  //
  // The counts on the paths that do copy are what make zero a measurement: a
  // fragment that parses is sliced three times — the `#` off the front, the
  // identifier out of the middle, the capability off the end — one that arrives
  // without its `#` is sliced twice, and one of the legal length that is not a
  // link is sliced once and refused. A counter that answered zero everywhere
  // fails all three.
  /** @type {[string, unknown, boolean, number][]} */
  const fragmentCosts = [
    ['a-valid-fragment-is-copied-three-times', VALID_FRAGMENT, true, 3],
    ['a-valid-fragment-without-its-hash-is-copied-twice', VALID_FRAGMENT.slice(1), true, 2],
    ['a-fragment-of-the-legal-length-that-is-not-a-link-is-copied-once', `#a=${A}&id=${ID}&v=link_split_v1`, false, 1],
    // One character over the bound, which is the tightest thing that can be
    // said about where it sits, and a long one, which is what the bound is for.
    ['a-fragment-one-character-over-the-bound-is-never-copied', `${VALID_FRAGMENT}x`, false, 0],
    // One character over the legal length and inside the bound, which is the
    // only input that separates the exact-length comparison from a comparison
    // that admits anything longer. Both refuse it: read as at-least, the layout
    // still matches, the identifier still decodes, and what refuses it is the
    // capability being 44 characters and so 33 bytes. So the outcome is the same
    // either way and the copies are not — two slices taken on the way to a
    // refusal the length comparison had already reached.
    ['a-fragment-one-character-over-the-legal-length-is-never-copied', `${VALID_FRAGMENT.slice(1)}x`, false, 0],
    // And one character short of it, which is the other side of the same
    // comparison and the side nothing was on. Read as at-most rather than as
    // exact, a short fragment passes the length step: the three fixed pieces are
    // all at the front and all still match, so the parser goes on to cut the
    // identifier out of the middle and the capability off the end before
    // anything refuses it — for the capability being 42 characters and so 31
    // bytes. Same answer, two copies taken to reach it that the exact comparison
    // never takes.
    ['a-fragment-one-character-short-of-the-legal-length-is-never-copied', VALID_FRAGMENT.slice(1, -1), false, 0],
    ['an-oversize-fragment-is-never-copied', `${VALID_FRAGMENT}${'x'.repeat(4096)}`, false, 0],
    ['something-that-is-not-a-string-is-never-copied', 1, false, 0],
  ];
  for (const [name, text, parsed, copies] of fragmentCosts) {
    cases.push({ name: `cost/${name}`, kind: 'cost', text, expect: { parsed, copies } });
  }

  for (const [name, text, wrap] of notStrings) {
    cases.push({ name: `fragment/not-a-string-${name}`, kind: 'fragment', text, wrap, expect: { parsed: false } });
    cases.push({ name: `base64/not-a-string-${name}`, kind: 'base64', text, wrap, expect: { bytes: null } });
    cases.push({ name: `aad/not-a-string-${name}`, kind: 'aad', text, wrap, expect: AAD_REFUSED });
    cases.push({ name: `document/not-a-string-${name}`, kind: 'document', text, wrap, expect: DOC_UNPARSED });
  }

  // ---- Base64url -------------------------------------------------------

  /** @type {[string, string, number[] | null][]} */
  const base64Cases = [
    ['empty', '', []],
    ['one-character', 'A', null],
    ['five-characters', 'AAAAA', null],
    ['two-characters', 'AA', [0]],
    ['non-canonical-two-characters', 'AB', null],
    ['high-bits', '_w', [255]],
    ['dash', '-w', [251]],
    ['four-characters', 'AAAA', [0, 0, 0]],
    ['plus-is-not-base64url', 'A+AA', null],
    ['slash-is-not-base64url', 'A/AA', null],
    ['padding-is-not-accepted', 'AA==', null],
    ['non-ascii', 'AÀAA', null],
    ['space', 'AA A', null],
    ['newline', 'AA\nA', null],
    // Every bit of the leftover field, one at a time, at both widths a link
    // field ends on.
    //
    // A decode that leaves bits over must leave them zero, and that is the rule
    // stopping two different strings from decoding to the same bytes — which is
    // the rule stopping a share link from being rewritten without changing what
    // it resolves to. The comparison that says so is a mask, and every
    // non-canonical case in this corpus differed in the lowest leftover bit
    // alone: `non-canonical-two-characters` above, and the two trailing-bit
    // fragments below. So the mask's higher bits were free. Narrowed by one bit
    // it refused all of them exactly as before and admitted a second spelling of
    // every identifier — sixteen spellings of one share id, all decoding to the
    // same sixteen bytes.
    //
    // Each bit is therefore asked for on its own, and in both directions: an
    // encoding carrying only that bit must be refused, and the encoding whose
    // leftover is zero because the set bit is just above the field must be
    // admitted — which is what stops the mask being widened rather than
    // narrowed. Two characters leave four bits over, which is what a
    // 22-character identifier ends on; three leave two, which is what a
    // 43-character field ends on.
    ['leftover-of-four-bit-0', 'AB', null],
    ['leftover-of-four-bit-1', 'AC', null],
    ['leftover-of-four-bit-2', 'AE', null],
    ['leftover-of-four-bit-3', 'AI', null],
    ['leftover-of-four-every-bit', 'A_', null],
    ['canonical-of-four-decoding-to-0', 'AA', [0]],
    ['canonical-of-four-decoding-to-1', 'AQ', [1]],
    ['canonical-of-four-decoding-to-2', 'Ag', [2]],
    ['canonical-of-four-decoding-to-3', 'Aw', [3]],
    ['leftover-of-two-bit-0', 'AAB', null],
    ['leftover-of-two-bit-1', 'AAC', null],
    ['leftover-of-two-every-bit', 'AAD', null],
    ['canonical-of-two-decoding-to-0', 'AAA', [0, 0]],
    ['canonical-of-two-decoding-to-1', 'AAE', [0, 1]],
    ['canonical-of-two-decoding-to-2', 'AAI', [0, 2]],
    ['canonical-of-two-decoding-to-4', 'AAQ', [0, 4]],
  ];
  for (const [name, text, bytes] of base64Cases) {
    cases.push({ name: `base64/${name}`, kind: 'base64', text, expect: { bytes } });
  }

  // How large a buffer a decode of a given length allocates, asked directly.
  //
  // The two interesting lengths are past the point where a string can be built
  // in one of the two engines this viewer is tested in, so no input can reach
  // them: at 715827883 characters the arithmetic the decoder used turned
  // negative, which made allocating throw where this module promises to refuse,
  // and at 1431655766 it wrapped to zero, which would have decoded a vast input
  // to an empty array. Neither is reachable through `decodeBase64url`, and both
  // are reachable through the step it does its sizing with, which is why that
  // step has a name.
  /** @type {[string, number, number][]} */
  const sizings = [
    ['no-characters', 0, 0],
    ['two-characters', 2, 1],
    ['three-characters', 3, 2],
    ['four-characters', 4, 3],
    ['an-encoded-key', 43, 32],
    ['an-encoded-wrapped-key', 80, 60],
    ['just-below-the-signed-32-bit-turn', 715827882, 536870911],
    ['at-the-signed-32-bit-turn', 715827883, 536870912],
    ['where-the-shift-wrapped-to-zero', 1431655766, 1073741824],
    ['the-largest-signed-32-bit-length', 2147483647, 1610612735],
    // And the size above which multiplying before dividing stops being exact.
    // Three times a count this large does not fit the integers a double carries
    // exactly, so the product rounds before anything is divided and the answer
    // comes back one too many. The two below are counts where that happens; the
    // third is the largest count this function admits at all, where it does not,
    // so the pair is a difference rather than a direction.
    ['where-multiplying-first-rounds-up', 9007199254740989, 6755399441055741],
    ['where-multiplying-first-rounds-up-again', 9007199254740985, 6755399441055738],
    ['at-the-largest-exact-integer', 9007199254740991, 6755399441055743],
  ];
  for (const [name, characters, bytes] of sizings) {
    cases.push({ name: `sizing/${name}`, kind: 'sizing', characters, expect: { bytes } });
  }

  // And the same step asked what it does with something that is not a count.
  // Every exported function in this viewer is total, and this one was not: a
  // multiplication answers for `null`, a string and an object, and throws for a
  // `BigInt` and a `Symbol` — so the one arithmetic step the decoder sizes its
  // allocation with had a second failure shape in it. Nothing reaches it that
  // way today, because its one caller passes a string's own length; the claim
  // being kept is the module's, not that particular caller's.
  /** @type {[string, unknown][]} */
  const notCounts = [
    ['null', null],
    ['a-string', '43'],
    ['an-object', {}],
    ['an-array', []],
    ['true', true],
    ['absent', undefined],
    ['negative', -4],
    // And the count immediately below the guard, because the guard is a
    // comparison and a comparison has an edge. `characterCount < 0` relaxed to
    // `characterCount < -1` refuses -4 exactly as before and admits -1, which
    // then computes a size of -1 — a negative allocation from a step whose whole
    // job is to size one. One token, no case, until this one.
    ['negative-one', -1],
    ['fractional', 4.5],
    ['one-past-the-largest-exact-integer', 9007199254740992],
  ];
  for (const [name, characters] of notCounts) {
    cases.push({ name: `sizing/not-a-count-${name}`, kind: 'sizing', characters, expect: { bytes: 0 } });
  }

  // The two that no corpus can write down, and the two that made this throw.
  for (const characterKind of ['bigint', 'symbol', 'nan', 'infinity']) {
    cases.push({
      name: `sizing/not-a-count-${characterKind}`,
      kind: 'sizing',
      characterKind,
      expect: { bytes: 0 },
    });
  }

  // ---- The primitive every allowlist is built on -----------------------

  // `readOwnFields` is asked directly here, because two of its rules cannot be
  // reached through a validator. A duplicated name is a mistake in a caller's
  // list rather than in its input, and no input can produce one. And the two
  // descriptor rules were only ever exercised by shapes that a type check would
  // have refused anyway: a field replaced by a throwing getter reads back as
  // `undefined` whether or not anything looks at the descriptor, so it never
  // showed that anything did.
  //
  // And the name list itself is asked about, because it was never checked to be
  // one. A string has a length, indexes to characters and answers `indexOf`, so
  // it satisfied every step: `readOwnFields({ a: 1, b: 2 }, 'ab')` came back
  // `[1, 2]`. Every caller in the viewer passes an array of names, so no schema
  // was ever widened by it — what was wrong was the exported contract, and these
  // are the shapes that hold it.
  /** @type {[string, unknown, unknown, unknown, { kind: string, field?: string } | undefined][]} */
  const fieldReads = [
    ['exact-set', { a: 1, b: 2 }, ['a', 'b'], [1, 2], undefined],
    ['empty-set-of-an-empty-record', {}, [], [], undefined],
    ['order-is-the-order-asked-for', { a: 1, b: 2 }, ['b', 'a'], [2, 1], undefined],
    // Without the duplicate check this reads `[1, 1]` and admits `b`: the count
    // is compared against the length of the list, so a list that names one field
    // twice leaves room for one field nobody named.
    ['name-list-repeats-a-name', { a: 1, b: 2 }, ['a', 'a'], null, undefined],
    ['name-list-repeats-a-name-three-times', { a: 1, b: 2, c: 3 }, ['a', 'a', 'a'], null, undefined],
    ['unnamed-own-property', { a: 1, b: 2, c: 3 }, ['a', 'b'], null, undefined],
    ['named-field-missing', { a: 1 }, ['a', 'b'], null, undefined],
    ['not-a-record', 'a', ['a'], null, undefined],
    // Name lists that are not lists of names. The first is the one that read
    // back `[1, 2]`: two characters, each of them at the index `indexOf` finds
    // it at, and a length of two.
    ['name-list-is-a-string', { a: 1, b: 2 }, 'ab', null, undefined],
    ['name-list-is-an-array-like', { a: 1, b: 2 }, { 0: 'a', 1: 'b', length: 2 }, null, undefined],
    ['name-list-is-null', { a: 1, b: 2 }, null, null, undefined],
    ['name-list-is-a-number', { a: 1 }, 1, null, undefined],
    // A name that is not a string, naming a field that exists. The descriptor
    // read coerces it, so this came back as two values off a record whose field
    // set was never compared against anything a caller could have written down.
    ['name-list-holds-a-number-that-names-a-field', { 1: 2, a: 1 }, ['a', 1], null, undefined],
    ['named-field-not-enumerable', { a: 1, b: 2 }, ['a', 'b'], null, { kind: 'not-enumerable', field: 'b' }],
    ['named-field-is-a-quiet-accessor', { a: 1, b: 2 }, ['a', 'b'], null, { kind: 'quiet-getter', field: 'b' }],
    // Values that answer a reflection call by throwing rather than by lying.
    // The first is refused by `isRecord`'s own guard and by nothing else: it is
    // asked before this function enters its `try`, which is why that guard is
    // there and not merely tidy. The other two are refused inside it.
    ['a-revoked-proxy', { a: 1, b: 2 }, ['a', 'b'], null, { kind: 'revoked' }],
    ['a-record-that-cannot-be-enumerated', { a: 1, b: 2 }, ['a', 'b'], null, { kind: 'own-keys-throws' }],
    ['a-record-whose-descriptors-throw', { a: 1, b: 2 }, ['a', 'b'], null, { kind: 'descriptor-throws' }],
    // The other side of the count. Every shape above that is about the field set
    // being wrong makes it too large — an unexpected own property, a hidden one,
    // a symbol-keyed one — so "the own property set is exactly this" and "the
    // own property set is not larger than this" refuse all of them alike, and
    // one of those two sentences is the contract. This value lists one name
    // fewer than it carries while answering for every named field, so it is the
    // only shape that tells them apart.
    ['a-record-that-lists-fewer-properties-than-it-has', { a: 1, b: 2 }, ['a', 'b'], null, {
      kind: 'own-keys-under-reports',
    }],
    // And the value the reader's first line is for, reached through the reader
    // rather than through the predicate beside it. Every other value here that
    // is not a record is also carrying the wrong field set, so the count refuses
    // it a step later and the shape question could be deleted with nothing to
    // notice: a callable's own `length` and `name` are two names no list here
    // asks for. This one lists exactly the names it is asked about, holds them
    // as ordinary data properties, and answers every reflection the way the
    // record beside it does — so what refuses it is that it is a function.
    ['a-callable-carrying-exactly-the-named-fields', { a: 1, b: 2 }, ['a', 'b'], null, {
      kind: 'callable-with-fields',
    }],
  ];
  for (const [name, record, names, fields, tamper] of fieldReads) {
    cases.push({ name: `fields/${name}`, kind: 'fields', record, names, tamper, expect: { fields } });
  }

  // The name list the corpus cannot write down, for the one comparison in that
  // reader with an edge no honest list can reach.
  //
  // The duplicate rule is `names.indexOf(name) !== index`, and relaxing it to
  // `names.indexOf(name) < index` refuses every duplicated list above exactly as
  // before: a real array answers `indexOf` with the first position holding the
  // name, which for the second `'a'` in `['a', 'a']` is 0, and 0 is below 1. The
  // two spellings part company only for a list whose `indexOf` answers a
  // position *after* the one being asked about, which no array does and a proxy
  // over one does. `Array.isArray` reaches through a proxy, so this is a list by
  // every test that reader makes, and the identity comparison is the only thing
  // that refuses it — under the relaxation it is read as two distinct names and
  // the record is admitted.
  cases.push({
    name: 'fields/name-list-whose-indexOf-answers-past-the-index',
    kind: 'fields',
    record: { a: 1, b: 2 },
    namesKind: 'indexOf-answers-past-the-index',
    expect: { fields: null },
  });

  // And the predicate that reader starts from, asked directly.
  //
  // `isRecord` is documented as the one definition of "an object" every
  // allowlist in the viewer reaches through, and until now nothing asked it
  // anything: every case above reaches it through `readOwnFields`, where a value
  // it admitted would be refused a step later for not carrying the named fields.
  // So widening it was free — `typeof value !== 'object' && typeof value !==
  // 'function'` admits every callable as an object, and the whole gate stayed
  // green. A function and a class are what separate the two spellings, and a
  // class is here as well as a function because a constructible carrier is the
  // one that also looks like a namespace: it has a prototype, it takes
  // properties, and `Object.getOwnPropertyNames` answers for it.
  /** @type {[string, unknown, boolean, { kind: string, field?: string } | undefined][]} */
  const recordPredicate = [
    ['a-plain-record', { a: 1 }, true, undefined],
    ['an-empty-record', {}, true, undefined],
    ['an-array', [], false, undefined],
    ['a-non-empty-array', [1, 2], false, undefined],
    ['null', null, false, undefined],
    ['a-string', 'a', false, undefined],
    ['a-number', 1, false, undefined],
    ['a-boolean', true, false, undefined],
    ['absent', undefined, false, undefined],
    // The two that are not JSON, and the reason this family exists.
    ['a-function', {}, false, { kind: 'callable' }],
    ['a-class', {}, false, { kind: 'constructible' }],
    // And the value the guard inside it is for, asked of the guard rather than
    // through the reader that wraps it.
    ['a-revoked-proxy', { a: 1 }, false, { kind: 'revoked' }],
  ];
  for (const [name, record, isRecord, tamper] of recordPredicate) {
    cases.push({
      name: `fields/is-a-record-${name}`,
      kind: 'fields',
      record,
      tamper,
      predicate: true,
      expect: { isRecord },
    });
  }

  // The flow's four pure decisions, which nothing outside the flow was asking
  // anything of.
  //
  // They are exported so that the answers can be put to inputs no server would
  // send, and three of the four had no reader at all: the one body that carries
  // a recipient's typed code was written in one place and compared against
  // nothing anywhere. A body is not a surface, so no browser pin reaches its
  // shape either — what the report body is is asserted by a browser test because
  // that request is intercepted and read, and the request that carries the code
  // is only ever asserted not to contain the things it must not.
  //
  // Which response is the one answer with a surface of its own is the same
  // question the reader above answers, one level up: the wrong-code answer is
  // recognised by its whole field set rather than by a field read off it, so a
  // body carrying that field and one more is not that answer. What such a body
  // is instead is a share to decrypt, which is not a third outcome — it is a
  // share that will not decrypt, and the surface it reaches is the one every
  // failure reaches. That is what separates a collapse from a distinguishable
  // outcome, and the browser suite drives exactly one shape of it.
  /** @type {[string, unknown, unknown, string, { kind: string, field?: string } | undefined][]} */
  const classifications = [
    ['the-wrong-code-answer', true, { status: 'wrong_code' }, 'wrong-code', undefined],
    ['a-wrong-code-answer-carrying-one-more-field', true, { status: 'wrong_code', attempts_left: 2 }, 'decrypt', undefined],
    ['a-body-carrying-no-status', true, { attempts_left: 2 }, 'decrypt', undefined],
    ['a-status-that-is-not-the-one', true, { status: 'unavailable' }, 'decrypt', undefined],
    ['a-status-that-is-not-a-string', true, { status: 1 }, 'decrypt', undefined],
    ['a-share-to-decrypt', true, { b: 'a', wrapped_k: 'b', ciphertext: 'c', aad: 'd' }, 'decrypt', undefined],
    ['a-status-that-was-not-a-success', false, { status: 'wrong_code' }, 'unavailable', undefined],
    ['a-body-that-did-not-parse', true, null, 'unavailable', undefined],
    ['a-body-that-is-not-a-record', true, [1, 2], 'unavailable', undefined],
    ['a-success-that-is-not-the-boolean', 1, { status: 'wrong_code' }, 'unavailable', undefined],
    // And the field carried somewhere the reader is documented not to look. A
    // record whose own fields are none, answering `status` off its prototype, is
    // not the answer this viewer knows — which is the whole reason that reader
    // asks for own fields rather than reading one.
    ['a-status-inherited-rather-than-carried', true, { status: 'wrong_code' }, 'decrypt', { kind: 'inherit', field: 'status' }],
  ];
  for (const [name, ok, record, outcome, tamper] of classifications) {
    cases.push({
      name: `fields/classify-${name}`,
      kind: 'fields',
      flow: { call: 'classify', ok },
      record,
      tamper,
      expect: { outcome },
    });
  }

  // Where a submit goes next. The one property worth holding is that a second
  // press while a request is in flight changes nothing, and the surface can only
  // show that the control was not pressable — which is the page's doing rather
  // than this function's.
  /** @type {[string, unknown, unknown, string][]} */
  const submitStates = [
    ['a-press-while-ready', 'ready', 'submit', 'sending'],
    ['a-press-while-sending', 'sending', 'submit', 'sending'],
    ['a-wrong-code-answer', 'sending', 'wrong-code', 'ready'],
    ['a-share-to-decrypt', 'sending', 'decrypt', 'settled'],
    ['a-failure', 'sending', 'unavailable', 'settled'],
    ['a-press-while-settled', 'settled', 'submit', 'settled'],
    ['an-answer-arriving-while-ready', 'ready', 'decrypt', 'ready'],
    ['an-event-that-is-not-one', 'ready', 'nonsense', 'ready'],
    // A state that was never a state is not a state to be left in.
    ['a-state-that-is-not-a-string', 1, 'submit', 'settled'],
    ['no-state-at-all', undefined, 'submit', 'settled'],
  ];
  for (const [name, state, event, next] of submitStates) {
    cases.push({
      name: `fields/submit-state-${name}`,
      kind: 'fields',
      flow: { call: 'submit-state', state, event },
      expect: { state: next },
    });
  }

  // And the two bodies, each asked for exactly the fields it is allowed to have.
  //
  // The identifier is a spelling of the shape one really is; the code is written
  // to carry the characters that decide whether the writer is a writer of one
  // string or a serialiser — a quote, a backslash, something outside printable
  // ASCII, and a control character — because everything outside printable ASCII
  // is escaped on the way out and nothing here was reading the result.
  const anId = 'AAAAAAAAAAAAAAAAAAAAAA';
  const aCode = 'a "code" with a \\ and \u00e9 and \u0007';
  cases.push({
    name: 'fields/open-request-body',
    kind: 'fields',
    flow: { call: 'open-body', id: anId, code: aCode },
    expect: {
      body: `{"id":"${anId}","code":"a \\"code\\" with a \\\\ and \\u00e9 and \\u0007"}`,
      names: ['code', 'id'],
      values: [aCode, anId],
    },
  });
  cases.push({
    name: 'fields/report-request-body',
    kind: 'fields',
    flow: { call: 'report-body', id: anId },
    expect: {
      body: `{"id":"${anId}"}`,
      names: ['id'],
      values: [anId],
    },
  });

  // ---- Bounds and pins -------------------------------------------------

  // Nothing an input can do shows any of these. A blob over a bound is refused
  // by the bound and would have been refused by the tag check anyway; the
  // smallest-blob check and the wrapped-key length check are both redundant with
  // what the tag does next. So the outcome cases below cannot prove the checks
  // are applied, let alone that they are applied first, and this case is what
  // makes widening one of them, or deleting the value it compares against, a
  // failure rather than a silent change.
  cases.push({
    name: 'constants/bounds',
    kind: 'constants',
    expect: {
      ciphertextMaxB64Length: CIPHERTEXT_MAX_B64_LENGTH,
      aadMaxLength: AAD_MAX_LENGTH,
      minBlobByteLength: 28,
      wrappedKeyB64Length: 80,
      serverKeyB64Length: 43,
      // The one legal fragment is 87 characters, and the `#` in front of it is
      // optional: 88 is the longest input the parser will look at.
      maxFragmentLength: 88,
      shareIdB64Length: 22,
      shareIdByteLength: 16,
      linkSplitV1: 'link_split_v1',
      shareDocV1: 'share_doc_v1',
      relayBannerSharedV1: 'relay_banner_shared_v1',
    },
  });

  // ---- Whole shares ----------------------------------------------------

  for (const fixture of fixtures) {
    cases.push({
      name: `decrypt/fixture-${fixture.name}`,
      kind: 'decrypt',
      a: bytesOf(fixture.inputs.a),
      id: bytesOf(fixture.inputs.id),
      response: responseFor(fixture),
      expect: { ok: true, plaintext: fixture.inputs.plaintext, aad: fixture.inputs.aad },
    });
  }

  /** @type {[string, Record<string, unknown>][]} */
  const rejectedResponses = [
    ['wrapped-key-nonce-bit-flipped', { wrapped_k: flipBit(named.outputs.wrapped_k, 0) }],
    ['wrapped-key-ciphertext-bit-flipped', { wrapped_k: flipBit(named.outputs.wrapped_k, 12) }],
    ['wrapped-key-tag-bit-flipped', { wrapped_k: flipBit(named.outputs.wrapped_k, -1) }],
    ['ciphertext-nonce-bit-flipped', { ciphertext: flipBit(named.outputs.ciphertext, 0) }],
    ['ciphertext-body-bit-flipped', { ciphertext: flipBit(named.outputs.ciphertext, 20) }],
    ['ciphertext-tag-bit-flipped', { ciphertext: flipBit(named.outputs.ciphertext, -1) }],
    ['stored-key-bit-flipped', { b: flipBit(named.inputs.b, 0) }],
    ['wrapped-key-truncated', { wrapped_k: dropBytes(named.outputs.wrapped_k, 1) }],
    ['ciphertext-truncated', { ciphertext: dropBytes(named.outputs.ciphertext, 1) }],
    ['ciphertext-truncated-to-tag', { ciphertext: encode(decode(named.outputs.ciphertext).subarray(0, 27)) }],
    ['ciphertext-empty', { ciphertext: '' }],
    ['aad-expiry-changed', { aad: named.inputs.aad.replace('1767225600', '1767225601') }],
    ['aad-members-reordered', { aad: reorderedAad() }],
    ['aad-whitespace-added', { aad: `${named.inputs.aad} ` }],
    ['aad-empty', { aad: '' }],
    ['aad-from-another-share', { aad: nameless.inputs.aad }],
    ['wrapped-key-from-another-share', { wrapped_k: nameless.outputs.wrapped_k }],
    ['ciphertext-from-another-share', { ciphertext: nameless.outputs.ciphertext }],
    ['stored-key-from-another-share', { b: nameless.inputs.b }],
    ['stored-key-too-short', { b: named.inputs.b.slice(0, 42) }],
    ['stored-key-too-long', { b: `${named.inputs.b}A` }],
    ['stored-key-not-base64url', { b: `+${named.inputs.b.slice(1)}` }],
    ['wrapped-key-too-short', { wrapped_k: named.outputs.wrapped_k.slice(0, 79) }],
    ['wrapped-key-too-long', { wrapped_k: `${named.outputs.wrapped_k}A` }],
    ['wrapped-key-not-base64url', { wrapped_k: `+${named.outputs.wrapped_k.slice(1)}` }],
    ['ciphertext-not-base64url', { ciphertext: `+${named.outputs.ciphertext.slice(1)}` }],
    ['stored-key-not-a-string', { b: 1 }],
    ['wrapped-key-not-a-string', { wrapped_k: null }],
    ['ciphertext-not-a-string', { ciphertext: [] }],
    ['aad-not-a-string', { aad: { v: 'link_split_v1' } }],
  ];
  for (const [name, overrides] of rejectedResponses) {
    cases.push({
      name: `decrypt/${name}`,
      kind: 'decrypt',
      a: bytesOf(A),
      id: bytesOf(ID),
      response: responseFor(named, overrides),
      expect: DECRYPT_REFUSED,
    });
  }

  // ---- Shares sealed for another identifier -----------------------------
  //
  // Every case above is about a share that does not decrypt. These are about
  // shares that do.
  //
  // The key is derived under the identifier the link carried, and the
  // authenticated data carries an identifier of its own. Nothing in the
  // cryptography compares the two: the tag covers whatever the authenticated
  // data says, so a share sealed for one identifier and delivered under a link
  // naming another decrypts perfectly, hands back a document, and is not the
  // document that link named. What refuses it is one comparison in the flow,
  // made after the tag has verified — and a viewer without that comparison
  // passes every other case in this corpus.
  //
  // Three shapes, because "different" has a shape. One identifier from another
  // share entirely; one that differs in a single character; and one that differs
  // only at the characters where the url-safe alphabet parts company with the
  // standard one.
  //
  // That last pair is the one a reader expects a lenient decoder to blur, and it
  // does not: the two alphabets disagree about which characters spell the last
  // two values, not about what those values are, so a decoder accepting either
  // alphabet still reads the two identifiers as different bytes. What it is
  // really there for is the comparison this viewer makes, which is one of
  // spellings — and the pair where two spellings are most nearly the same value
  // is the pair a comparison written one token looser would let through.
  for (const item of vectors.mismatches) {
    cases.push({
      name: `decrypt/sealed-for-${item.name}`,
      kind: 'decrypt',
      idCheck: true,
      a: bytesOf(item.inputs.a),
      id: bytesOf(item.inputs.id),
      response: {
        b: item.inputs.b,
        wrapped_k: item.outputs.wrapped_k,
        ciphertext: item.outputs.ciphertext,
        aad: item.inputs.aad,
      },
      expect: { decrypted: true, admitted: false },
    });
  }

  // And the control, which is what makes those three a comparison rather than
  // three assertions that something refused. A published share, under its own
  // link, through the same step: it decrypts and it is admitted. A comparison
  // that refused everything would satisfy all three above and fail this one.
  cases.push({
    name: 'decrypt/sealed-for-the-identifier-its-own-link-carries',
    kind: 'decrypt',
    idCheck: true,
    a: bytesOf(A),
    id: bytesOf(ID),
    response: responseFor(named),
    expect: { decrypted: true, admitted: true },
  });

  // The authenticated data of this share carries a letter followed by a
  // combining mark, where a precomposed character exists. It is there so that
  // tidying the string is visible: the fixture case above pins the string that
  // comes back out, and this one pins that the tidied spelling does not
  // authenticate. A viewer that normalised before the tag check, or after it,
  // passed every other share in this corpus.
  //
  // There is no trimming case beside it any more, and there cannot be one. The
  // authenticated data is canonical JSON by the protocol's own definition, and
  // outer trimming cannot change a canonical JSON document — so `.trim()`,
  // applied anywhere along this path, is equivalent by construction to doing
  // nothing, and there is no input that would tell the two apart. It was once
  // told apart, by a fixture sealed with a trailing space; what that fixture
  // published was a conformance vector outside the protocol's valid domain,
  // which a correct producer could not emit and a correct reader would be right
  // to refuse. The trimming of the plaintext is still caught, by the trailing
  // newline this fixture's document is sealed with.
  // What comes back out, as opposed to whether anything came back. Every share
  // above is judged on a plaintext the generator sealed, and the generator seals
  // documents that begin with `{` — so the one step between the tag check and
  // the caller, the decode, had a class of behaviour no published fixture could
  // reach. A decoder deletes a leading byte-order mark from what it returns
  // unless it is told not to, and the mark is exactly the character that makes
  // the deletion visible: the string that was sealed is not JSON, since a mark
  // is not JSON whitespace, and the string that came back is. So the deletion
  // turned a document the protocol refuses into one that renders, on the path
  // whose discipline everywhere else is refusal rather than repair.
  //
  // Sealed here rather than published, because a share carrying this document
  // does not exist until something makes one. The fixture's own content key and
  // nonce, the fixture's own authenticated data, and its own document with one
  // character in front of it; what is asserted is the string the viewer handed
  // back, against the string that went in.
  const withByteOrderMark = `\uFEFF${named.inputs.plaintext}`;
  cases.push({
    name: 'decrypt/document-sealed-with-a-byte-order-mark',
    kind: 'decrypt',
    a: bytesOf(named.inputs.a),
    id: bytesOf(named.inputs.id),
    response: responseFor(named),
    reseal: {
      k: bytesOf(named.inputs.k),
      nonce: bytesOf(named.inputs.content_nonce),
      text: withByteOrderMark,
    },
    expect: { ok: true, plaintext: withByteOrderMark, aad: named.inputs.aad },
  });

  // The largest authenticated data the bound admits, sealed and read back. The
  // two comparisons against that bound are written `>`, and the difference
  // between `>` and `>=` is one length — this one — so this is the only input
  // that separates them and nothing in the corpus had it. The share
  // authenticates, so what would refuse it under `>=` is the bound rather than
  // the tag.
  cases.push({
    name: 'decrypt/aad-at-the-largest-length-admitted',
    kind: 'decrypt',
    a: bytesOf(named.inputs.a),
    id: bytesOf(named.inputs.id),
    response: responseFor(named, { aad: aadOfExactly(AAD_MAX_LENGTH) }),
    reseal: {
      k: bytesOf(named.inputs.k),
      nonce: bytesOf(named.inputs.content_nonce),
      text: named.inputs.plaintext,
    },
    expect: { ok: true, plaintext: named.inputs.plaintext, aad: aadOfExactly(AAD_MAX_LENGTH) },
  });

  // The floor on the blob, at the one length that separates the comparison it is
  // written with from the next one up. `MIN_BLOB_BYTE_LENGTH` is a nonce and a
  // tag with nothing between them, and every published share has a document
  // between them — so `<` relaxed to `<=` refused nothing any fixture carries,
  // and the bound was the one in this module whose comparator neither a case nor
  // a written reason was holding. A share sealed over the empty string is
  // exactly 28 bytes: `<` admits it and hands back the empty document, `<=`
  // refuses it.
  //
  // The empty string is not a document — nothing downstream parses it — and that
  // is beside the point of this case, which is about the one comparison in front
  // of the tag check and is asked of the decryption rather than of the viewer.
  cases.push({
    name: 'decrypt/blob-at-the-smallest-length-admitted',
    kind: 'decrypt',
    a: bytesOf(named.inputs.a),
    id: bytesOf(named.inputs.id),
    response: responseFor(named),
    reseal: {
      k: bytesOf(named.inputs.k),
      nonce: bytesOf(named.inputs.content_nonce),
      text: '',
    },
    expect: { ok: true, plaintext: '', aad: named.inputs.aad },
  });

  // What the decoder does with a plaintext that is not well-formed UTF-8, which
  // is the other half of the claim the byte-order-mark case above makes about
  // that one step. The decoder is constructed with two flags and the mark case
  // holds one of them; this holds the other, which is the one that decides
  // between refusing such a document and handing back a repaired copy of it with
  // U+FFFD standing in for whatever the bytes were. A repair, at the last step
  // before the caller, on a path whose discipline everywhere else is refusal —
  // and unlike the mark it can happen anywhere in the document and as often as
  // there are bad bytes.
  //
  // No published share can ask it and no case sealed from a string can either: a
  // string encodes to well-formed UTF-8 whatever the string is, so the question
  // only exists for a plaintext assembled as bytes. These seal the named
  // fixture's own document, under its own content key and nonce and over its own
  // authenticated data, with one ill-formed sequence in it — so the share
  // authenticates and the only thing left to refuse it is the decode.
  //
  // Four shapes rather than one, because "not well-formed UTF-8" is not one
  // mistake. A byte that begins no sequence at all, a sequence that stops before
  // it is finished, a continuation byte with nothing leading it, and a
  // well-formed-looking three-byte sequence for a code point UTF-8 may not
  // encode are each refused by the same flag and each repaired differently
  // without it.
  const documentBytes = Array.from(Buffer.from(named.inputs.plaintext, 'utf8'));

  // One key and one nonce, shared by the four below and by the three that must
  // decrypt. The shared key is what makes either group mean anything. The shared
  // nonce carries none of that weight and is here because these are one document
  // sealed several ways, which is worth saying rather than leaving implied: a
  // nonce travels inside the blob — it is the first bytes of it, which the viewer
  // splits off and hands to the decryption — so a case sealed under a different
  // one decrypts exactly as well, and nothing here would notice. Crediting the
  // nonce with the binding would be crediting it with work the format does not
  // give it.
  //
  // The key is the opposite, and the four are why. They are required to refuse,
  // and a refusal says nothing about where it came from: sealed under a key the
  // viewer will not arrive at, they refuse at the tag, still report exactly the
  // refusal the case requires, and pass while the decode they exist to ask about
  // is never reached. That was demonstrated — resealing the four under a wrong
  // key left the whole fast suite green with `fatal: false` back in the decoder —
  // and it was available precisely because each group named its key in its own
  // expression. Two expressions can be edited one at a time.
  //
  // One binding cannot. A key that stops being the one the share is wrapped
  // under takes the three controls down with it, because those are required to
  // come back whole rather than to refuse, and a control that stops decrypting
  // is a failure nothing can read as success. `test/node/core.test.mjs` holds
  // the other end: that all seven seal under this binding, and that this binding
  // is the fixture's own published content key.
  const documentKey = bytesOf(named.inputs.k);
  const documentNonce = bytesOf(named.inputs.content_nonce);

  /** @type {[string, number[]][]} */
  const illFormedSequences = [
    ['a-byte-that-begins-no-sequence', [0xff]],
    ['a-sequence-that-stops-early', [0xe2, 0x82]],
    ['a-continuation-byte-with-no-lead', [0x80]],
    ['a-surrogate-spelled-as-three-bytes', [0xed, 0xa0, 0x80]],
  ];
  for (const [what, sequence] of illFormedSequences) {
    cases.push({
      name: `decrypt/document-sealed-over-${what}`,
      kind: 'decrypt',
      a: bytesOf(named.inputs.a),
      id: bytesOf(named.inputs.id),
      response: responseFor(named),
      reseal: {
        k: documentKey,
        nonce: documentNonce,
        bytes: [...documentBytes, ...sequence],
      },
      expect: DECRYPT_REFUSED,
    });
  }

  // And the three that must decrypt, which is what makes the four above about
  // the decode rather than about a refusal that would have happened anyway.
  //
  // The refusal these cases require is the one every other negative decryption
  // case requires: no plaintext, no authenticated data, and no reason given —
  // by design, because a viewer that told a recipient which step refused would be
  // telling them something. So on its own each case above says only that this
  // share did not decrypt, and a tag that no longer verifies, a length
  // comparison gone wrong, or a base64 reading that stopped working would
  // satisfy all four of them exactly as well as the decode does.
  //
  // What separates those is a share built the same way, sealed the same way,
  // over the same document, differing from an ill-formed one by a single byte —
  // and required to come back whole. The first completes the sequence that stops
  // early: `e2 82` is refused and `e2 82 ac` must not be. The second is the code
  // point immediately below the surrogates, which is a three-byte sequence of the
  // same shape as the surrogate spelled as three bytes and is a code point UTF-8
  // may encode. Between them, a refusal arriving from anywhere but the decode
  // takes one of these down with it, and a decoder made to refuse the shape
  // rather than the code point takes the second.
  //
  // The third is about what the four refusals are refusals of, and it is there
  // because they can be satisfied by the wrong thing. The four require a refusal
  // and say nothing about how it was reached, so a decoder that repaired the
  // ill-formed bytes to U+FFFD and then refused any document containing that
  // character reports exactly the refusal all four require — and every other case
  // in this corpus passes with it, because no other document here carries a
  // U+FFFD. That decoder is not this one. The bytes `ef bf bd` are well-formed
  // UTF-8 for a document containing the replacement character, which a document
  // is allowed to contain like any other: the shipped decoder decodes it and
  // hands it on, while the repair-then-refuse one collapses a valid share into
  // the same unavailable state a hostile one gets.
  //
  // So this case says what the four are about: ill-formed bytes, not the
  // character U+FFFD. Sealed under the same binding as the other six, so it
  // stands or falls with them.
  //
  // Its character is written as an escape where the two above are written as
  // themselves, and that is deliberate rather than inconsistent: this is the one
  // character a mis-encoded file produces by accident, so a literal here would be
  // indistinguishable from the damage it is meant to be a case about.
  //
  // The fourth is not about ill-formed bytes at all, and it is here because this
  // group is the only one in the corpus that says what the decoder hands back
  // rather than whether it handed anything back. Every other plaintext here is
  // printable, so a decode that quietly dropped a character nobody can see
  // satisfied all of them: deleting U+0080 from the decoded string returned a
  // document two code points long where three were sealed, with the tag checked
  // and every case in this corpus green. The bytes `c2 80` are well-formed UTF-8
  // for U+0080, a C1 control — a code point a document may carry like any other,
  // that no fixture carried, and that shows as nothing. So this is not
  // decoration: it is the shape without which a silent rewrite of authenticated
  // content, after the tag check, is invisible. What it pins is what that step is
  // for — the string that comes out is the string that went in, code point for
  // code point, including the ones a reader cannot see.
  //
  // Written as an escape rather than as itself, for the reason the replacement
  // character below it is: a literal control byte in a source file is
  // indistinguishable from damage to the file.
  /** @type {[string, number[], string][]} */
  const wellFormedSequences = [
    ['the-sequence-that-stops-early-completed', [0xe2, 0x82, 0xac], '€'],
    ['the-code-point-below-the-surrogates', [0xed, 0x9f, 0xbf], '퟿'],
    ['the-replacement-character-itself', [0xef, 0xbf, 0xbd], '\uFFFD'],
    ['a-control-character-that-shows-as-nothing', [0xc2, 0x80], '\u0080'],
  ];
  for (const [what, sequence, character] of wellFormedSequences) {
    cases.push({
      name: `decrypt/document-sealed-over-${what}`,
      kind: 'decrypt',
      a: bytesOf(named.inputs.a),
      id: bytesOf(named.inputs.id),
      response: responseFor(named),
      reseal: {
        // The same binding the four refuse under. See the note above it.
        k: documentKey,
        nonce: documentNonce,
        bytes: [...documentBytes, ...sequence],
      },
      expect: { ok: true, plaintext: `${named.inputs.plaintext}${character}`, aad: named.inputs.aad },
    });
  }

  cases.push({
    name: 'decrypt/combining-marks-aad-normalised',
    kind: 'decrypt',
    a: bytesOf(combining.inputs.a),
    id: bytesOf(combining.inputs.id),
    response: responseFor(combining, { aad: combining.inputs.aad.normalize('NFC') }),
    expect: DECRYPT_REFUSED,
  });

  /** @type {[string, unknown][]} */
  const malformedResponses = [
    ['response-null', null],
    ['response-array', []],
    ['response-string', 'wrapped'],
    ['response-number', 1],
    ['response-empty-object', {}],
  ];
  for (const [name, response] of malformedResponses) {
    cases.push({ name: `decrypt/${name}`, kind: 'decrypt', a: bytesOf(A), id: bytesOf(ID), response, expect: DECRYPT_REFUSED });
  }

  const withoutCiphertext = responseFor(named);
  delete withoutCiphertext['ciphertext'];
  cases.push({
    name: 'decrypt/response-missing-field',
    kind: 'decrypt',
    a: bytesOf(A),
    id: bytesOf(ID),
    response: withoutCiphertext,
    expect: DECRYPT_REFUSED,
  });

  cases.push({
    name: 'decrypt/response-extra-field',
    kind: 'decrypt',
    a: bytesOf(A),
    id: bytesOf(ID),
    response: responseFor(named, { extra: 1 }),
    expect: DECRYPT_REFUSED,
  });

  // Field sets that no JSON text can express, so the corpus has to build them.
  // Each of these has four own properties, which is the right number, and is not
  // the right field set: one expected field is on the prototype, or hidden from
  // enumeration, or under a symbol, or is a getter rather than a value. A reader
  // that counts keys and then reads through the prototype chain admits the first
  // of them and decrypts the whole share.
  /** @type {[string, { kind: string, field?: string }][]} */
  const tamperedResponses = [
    ['response-field-inherited', { kind: 'inherit', field: 'aad' }],
    ['response-stored-key-inherited', { kind: 'inherit', field: 'b' }],
    ['response-extra-field-not-enumerable', { kind: 'hide' }],
    ['response-extra-field-under-a-symbol', { kind: 'symbol' }],
    ['response-field-is-a-getter', { kind: 'getter', field: 'ciphertext' }],
    ['response-field-is-a-quiet-accessor', { kind: 'quiet-getter', field: 'ciphertext' }],
    ['response-field-not-enumerable', { kind: 'not-enumerable', field: 'b' }],
    // A response that throws when it is looked at rather than one that lies
    // about what it is carrying. The reader reaches it through `readOwnFields`,
    // which asks `isRecord` before it enters its own guard — so a revoked proxy
    // is refused by `isRecord`'s guard and by nothing else, and the other two are
    // refused by `readOwnFields`'s.
    ['response-revoked-proxy', { kind: 'revoked' }],
    ['response-cannot-be-enumerated', { kind: 'own-keys-throws' }],
    ['response-descriptors-cannot-be-read', { kind: 'descriptor-throws' }],
    // Four ordinary own data properties, each holding a value that throws when
    // its length is read. Every field of a stored response is checked for its
    // type and then for its length, and a response of benign wrong types cannot
    // say which of those two ran first — both refuse. These can: asked in the
    // stated order they are refused in silence, and asked the other way round
    // the accessor runs where nothing is catching, and the module's single
    // returned refusal becomes an exception leaving `decryptShare`.
    ['response-stored-key-length-cannot-be-read', { kind: 'hostile-length', field: 'b' }],
    ['response-wrapped-key-length-cannot-be-read', { kind: 'hostile-length', field: 'wrapped_k' }],
    ['response-ciphertext-length-cannot-be-read', { kind: 'hostile-length', field: 'ciphertext' }],
    ['response-aad-length-cannot-be-read', { kind: 'hostile-length', field: 'aad' }],
  ];
  for (const [name, tamper] of tamperedResponses) {
    cases.push({
      name: `decrypt/${name}`,
      kind: 'decrypt',
      a: bytesOf(A),
      id: bytesOf(ID),
      response: responseFor(named),
      tamper,
      expect: DECRYPT_REFUSED,
    });
  }

  // Two lengths, because one of them would be refused for the wrong reason: a
  // length one over the bound is also a length no unpadded encoding can have,
  // so only the four-over case reaches the bound as the thing that stops it.
  //
  // What these cannot show is that the bound is applied at all, let alone that
  // it is applied before the decode. Both orders refuse, and so does no bound at
  // all, because the tag refuses anyway; refusing is the whole of what an
  // outcome can report. `constants/bounds` holds the value itself, and the
  // `ordering` cases below are what make the order observable rather than
  // asserted, by counting what was allocated on the way to the refusal.
  for (const over of [1, 4]) {
    cases.push({
      name: `decrypt/ciphertext-over-bound-by-${over}`,
      kind: 'decrypt',
      a: bytesOf(A),
      id: bytesOf(ID),
      responseParts: responseFor(named),
      synth: { field: 'ciphertext', char: 'A', length: CIPHERTEXT_MAX_B64_LENGTH + over },
      expect: DECRYPT_REFUSED,
    });
  }

  cases.push({
    name: 'decrypt/aad-over-bound',
    kind: 'decrypt',
    a: bytesOf(A),
    id: bytesOf(ID),
    responseParts: responseFor(named),
    synth: { field: 'aad', char: 'a', length: AAD_MAX_LENGTH + 1 },
    expect: DECRYPT_REFUSED,
  });

  // The authenticated data of this share carries U+FFFD. Encoding UTF-16 to
  // UTF-8 maps every unpaired surrogate to the bytes of U+FFFD, so the same
  // share with that one character respelled as a bare leading surrogate produces
  // the same bytes, passes the tag check, and hands back a string that was never
  // sealed. Refusing an AAD that is not well-formed UTF-16 is what stops it, and
  // this pair is what says so: the genuine spelling decrypts, and no other
  // spelling of the same bytes does.
  cases.push({
    name: 'decrypt/fixture-replacement-character-lone-leading-surrogate',
    kind: 'decrypt',
    a: bytesOf(replacement.inputs.a),
    id: bytesOf(replacement.inputs.id),
    responseParts: responseFor(replacement),
    synthCodeUnit: { field: 'aad', from: '�', codeUnits: [0xd800] },
    expect: DECRYPT_REFUSED,
  });

  cases.push({
    name: 'decrypt/fixture-replacement-character-lone-trailing-surrogate',
    kind: 'decrypt',
    a: bytesOf(replacement.inputs.a),
    id: bytesOf(replacement.inputs.id),
    responseParts: responseFor(replacement),
    synthCodeUnit: { field: 'aad', from: '�', codeUnits: [0xdc00] },
    expect: DECRYPT_REFUSED,
  });

  cases.push({
    name: 'decrypt/wrong-link-capability',
    kind: 'decrypt',
    a: bytesOf(nameless.inputs.a),
    id: bytesOf(ID),
    response: responseFor(named),
    expect: DECRYPT_REFUSED,
  });

  cases.push({
    name: 'decrypt/wrong-share-identifier-as-salt',
    kind: 'decrypt',
    a: bytesOf(A),
    id: bytesOf(nameless.inputs.id),
    response: responseFor(named),
    expect: DECRYPT_REFUSED,
  });

  cases.push({
    name: 'decrypt/link-capability-too-short',
    kind: 'decrypt',
    a: bytesOf(A).slice(0, 31),
    id: bytesOf(ID),
    response: responseFor(named),
    expect: DECRYPT_REFUSED,
  });

  cases.push({
    name: 'decrypt/share-identifier-too-short',
    kind: 'decrypt',
    a: bytesOf(A),
    id: bytesOf(ID).slice(0, 15),
    response: responseFor(named),
    expect: DECRYPT_REFUSED,
  });

  // ---- Order ------------------------------------------------------------

  // "Types before lengths, lengths before anything is decoded" is the module's
  // stated order, and until now nothing put it to the test. It cannot be reached
  // through outcomes: every input that a bound refuses is an input the tag would
  // have refused, so deleting either copy of the ciphertext bound, either copy
  // of the bound on the authenticated data, or the length checks the stored and
  // wrapped keys are decoded behind — or moving any decode in front of every
  // check it is supposed to follow — changes nothing that a corpus of inputs and
  // refusals can see. Eleven such changes passed the whole suite.
  //
  // What tells them apart is what was allocated on the way to the refusal. The
  // decoder allocates before it decodes, so a field refused before anything is
  // decoded is a field that costs nothing at all, and a field refused after is
  // one that cost an allocation the check was there to prevent. The valid cases
  // carry the counts a whole share, one unwrap and one decryption really do
  // make, so zero is a measurement rather than the only number this can report.
  //
  // The two direct calls are here because a bound written twice needs asking
  // twice: with only the whole-share cases, deleting the inner copy leaves the
  // outer one refusing at the same cost, and the deletion is invisible.
  //
  // And the counter itself is asked about, which matters more than any single
  // case here. Every refusal above expects zero, so a counter rewritten to
  // report zero whenever the call it wrapped came back with nothing would
  // satisfy all of them while measuring nothing at all — the successful cases
  // would not notice, because they are the ones that do come back with
  // something. What notices is a refusal that costs something: a share whose tag
  // does not verify has decoded every field on the way there, and a field that
  // is the right length and not an encoding has decoded exactly as far as the
  // decoder gets before it gives up. Those are pinned at their real non-zero
  // counts, so a counter that answers zero on the refusal path is a counter that
  // fails these.
  /** @type {{ name: string, call: string, fixture: any, overrides?: Record<string, unknown>, synth?: { field: string, char: string, length: number }, synthCodeUnit?: { field: string, from: string, codeUnits: number[] }, ok: boolean, allocations: number }[]} */
  const orderings = [
    // A whole share: the stored key, the input keying material, the wrapped key
    // and the ciphertext, in that order and nothing else.
    { name: 'whole-share-costs-four-allocations', call: 'share', fixture: named, ok: true, allocations: 4 },
    {
      name: 'ciphertext-over-bound-is-never-decoded',
      call: 'share',
      fixture: named,
      synth: { field: 'ciphertext', char: 'A', length: CIPHERTEXT_MAX_B64_LENGTH + 4 },
      ok: false,
      allocations: 0,
    },
    {
      name: 'aad-over-bound-is-never-decoded',
      call: 'share',
      fixture: named,
      synth: { field: 'aad', char: 'a', length: AAD_MAX_LENGTH + 1 },
      ok: false,
      allocations: 0,
    },
    {
      name: 'stored-key-of-the-wrong-length-is-never-decoded',
      call: 'share',
      fixture: named,
      overrides: { b: named.inputs.b.slice(0, 42) },
      ok: false,
      allocations: 0,
    },
    {
      // The same check, from above. The stored key has one length, and only a
      // comparison for exactly that length says so: relaxed to a minimum, a
      // short key is still refused here and a long one is decoded — bounded by
      // nothing on its way into the decoder, and refused afterwards by the byte
      // count, which is a refusal that has already allocated. Four characters
      // longer rather than one so that this is the length check doing the
      // refusing; the decoder has no opinion about either length.
      name: 'stored-key-longer-than-its-one-length-is-never-decoded',
      call: 'share',
      fixture: named,
      overrides: { b: `${named.inputs.b}ABCD` },
      ok: false,
      allocations: 0,
    },
    {
      name: 'wrapped-key-of-the-wrong-length-is-never-decoded',
      call: 'share',
      fixture: named,
      // Four characters too long rather than one. One too long is also a length
      // no unpadded encoding can have, so the decoder refuses it on the way in
      // and allocates nothing — which would make a length check moved behind the
      // decode cost nothing either, and the measurement agree for the wrong
      // reason.
      overrides: { wrapped_k: `${named.outputs.wrapped_k}ABCD` },
      ok: false,
      allocations: 0,
    },
    {
      name: 'ciphertext-that-is-not-a-string-is-never-decoded',
      call: 'share',
      fixture: named,
      overrides: { ciphertext: [] },
      ok: false,
      allocations: 0,
    },
    {
      name: 'aad-that-is-not-a-string-is-never-decoded',
      call: 'share',
      fixture: named,
      overrides: { aad: 1 },
      ok: false,
      allocations: 0,
    },
    {
      name: 'response-with-an-extra-field-is-never-decoded',
      call: 'share',
      fixture: named,
      overrides: { extra: 1 },
      ok: false,
      allocations: 0,
    },
    // The unwrap, asked directly, so the length check in front of its decode is
    // asked about rather than the one in front of the response reader.
    { name: 'unwrap-costs-one-allocation', call: 'wrap', fixture: named, ok: true, allocations: 1 },
    {
      name: 'unwrap-of-the-wrong-length-is-never-decoded',
      call: 'wrap',
      fixture: named,
      // Four too long, for the same reason: see above.
      overrides: { wrapped_k: `${named.outputs.wrapped_k}ABCD` },
      ok: false,
      allocations: 0,
    },
    // And the decryption, for the same reason: both of its bounds are second
    // copies of a bound the response reader already applied.
    { name: 'decryption-costs-one-allocation', call: 'content', fixture: named, ok: true, allocations: 1 },
    {
      name: 'decryption-ciphertext-over-bound-is-never-decoded',
      call: 'content',
      fixture: named,
      synth: { field: 'ciphertext', char: 'A', length: CIPHERTEXT_MAX_B64_LENGTH + 4 },
      ok: false,
      allocations: 0,
    },
    {
      name: 'decryption-aad-over-bound-is-never-decoded',
      call: 'content',
      fixture: named,
      synth: { field: 'aad', char: 'a', length: AAD_MAX_LENGTH + 1 },
      ok: false,
      allocations: 0,
    },
    // The well-formedness test sits in front of the decode too, and it is the
    // one check on this path that is not a length.
    {
      name: 'decryption-aad-that-is-not-well-formed-is-never-decoded',
      call: 'content',
      fixture: replacement,
      synthCodeUnit: { field: 'aad', from: '�', codeUnits: [0xd800] },
      ok: false,
      allocations: 0,
    },
    // And its accepting direction, which nothing asked about until this fixture
    // existed. The test refuses an unpaired surrogate; a test that refused every
    // surrogate would refuse every emoji and every astral character, and would
    // have decrypted every share in this corpus. The authenticated data of this
    // one carries a pair.
    { name: 'decryption-of-a-surrogate-pair-costs-one-allocation', call: 'content', fixture: astral, ok: true, allocations: 1 },
    // The edges of the surrogate range, both ways round.
    //
    // Two spellings said the test refuses something and admits something else,
    // and left every boundary in it free: the first code unit of the range, the
    // last, the first and last a pair may end with, and the step over a pair
    // once it has been read. Each of these is one of those boundaries, and the
    // allocation count is what separates them, because every one of them
    // arrives at the same outcome. A string that is not well-formed is refused
    // before anything is decoded and costs nothing; a string that is
    // well-formed and simply is not what was sealed reaches the tag, which
    // means the ciphertext was decoded and it cost one.
    //
    // Every comparison in that test has two sides, and a single code unit can
    // only reach one of them. Three of its boundaries survived a corpus that
    // named every boundary code unit and used each of them alone: moving the
    // leading-surrogate boundary from 0xdbff to 0xdc00, the trailing-surrogate
    // floor from 0xdc00 down to 0xdbff, and the trailing-surrogate ceiling from
    // 0xdfff up to 0xe000 each changed nothing any single unit could show,
    // because the character after a lone surrogate in these fixtures is a quote
    // and a quote is refused under either spelling. What tells them apart is the
    // unit that follows: the last three entries below are the pairs where one
    // spelling of the test reads a well-formed pair and the other does not, and
    // they are the only inputs that separate them.
    ...(/** @type {{ name: string, codeUnits: number[], wellFormed: boolean }[]} */ ([
      { name: 'just-below-the-surrogate-range', codeUnits: [0xd7ff], wellFormed: true },
      { name: 'just-above-the-surrogate-range', codeUnits: [0xe000], wellFormed: true },
      { name: 'the-first-leading-surrogate-alone', codeUnits: [0xd800], wellFormed: false },
      { name: 'the-last-leading-surrogate-alone', codeUnits: [0xdbff], wellFormed: false },
      { name: 'the-first-trailing-surrogate-alone', codeUnits: [0xdc00], wellFormed: false },
      { name: 'the-last-trailing-surrogate-alone', codeUnits: [0xdfff], wellFormed: false },
      { name: 'the-lowest-surrogate-pair', codeUnits: [0xd800, 0xdc00], wellFormed: true },
      { name: 'the-highest-surrogate-pair', codeUnits: [0xdbff, 0xdfff], wellFormed: true },
      { name: 'a-pair-across-the-whole-range', codeUnits: [0xd800, 0xdfff], wellFormed: true },
      { name: 'the-last-leading-surrogate-with-the-first-trailing-one', codeUnits: [0xdbff, 0xdc00], wellFormed: true },
      // A pair followed by nothing to pair with: the step over a pair, which a
      // reader that read the trailing unit and then read it again would refuse.
      { name: 'a-pair-and-then-a-trailing-surrogate', codeUnits: [0xd800, 0xdc00, 0xdc00], wellFormed: false },
      // Two trailing surrogates. The first of them is unpaired, and the only
      // thing that says so is where the leading-surrogate boundary sits: read as
      // a leading surrogate, 0xdc00 finds a trailing one after it and the pair is
      // admitted.
      { name: 'two-trailing-surrogates', codeUnits: [0xdc00, 0xdc00], wellFormed: false },
      // A leading surrogate followed by the last leading surrogate, which is one
      // code unit below the first a pair may end with.
      { name: 'a-leading-surrogate-and-then-another-leading-one', codeUnits: [0xd800, 0xdbff], wellFormed: false },
      // And a leading surrogate followed by the first code unit above the range,
      // which is one above the last a pair may end with.
      { name: 'a-leading-surrogate-and-then-the-unit-above-the-range', codeUnits: [0xd800, 0xe000], wellFormed: false },
    ])).map((item) => ({
      name: `decryption-aad-with-${item.name}-${item.wellFormed ? 'is-decoded' : 'is-never-decoded'}`,
      call: 'content',
      fixture: replacement,
      synthCodeUnit: { field: 'aad', from: '�', codeUnits: item.codeUnits },
      ok: false,
      allocations: item.wellFormed ? 1 : 0,
    })),
    // And the two ends of the walk itself, which every case above is blind to.
    //
    // Each of those respells one character in the middle of the authenticated
    // data, so the walk reaches it wherever it starts and wherever it stops.
    // Both ends of the range were therefore free: starting the index at one, and
    // stopping it one code unit short of the length, each skip a code unit no
    // case here puts a surrogate in, and each was green on the whole gate. What
    // separates them from the range that is written is where the unpaired
    // surrogate sits. The authenticated data is one JSON object, so its first
    // code unit is the only `{` in it and its last is the only `}` — respelling
    // either puts the surrogate at an end of the string rather than inside it.
    //
    // The last position is also the one input that holds the sentence written
    // beside the test: a leading surrogate there is refused because `charCodeAt`
    // past the end of a string is `NaN`, and `NaN` fails the range test the
    // trailing unit has to pass. Nothing asked that of it until now.
    ...(/** @type {{ name: string, from: string, codeUnits: number[] }[]} */ ([
      { name: 'first-code-unit-is-an-unpaired-leading-surrogate', from: '{', codeUnits: [0xd800] },
      { name: 'first-code-unit-is-an-unpaired-trailing-surrogate', from: '{', codeUnits: [0xdc00] },
      { name: 'last-code-unit-is-an-unpaired-leading-surrogate', from: '}', codeUnits: [0xd800] },
      { name: 'last-code-unit-is-an-unpaired-trailing-surrogate', from: '}', codeUnits: [0xdc00] },
    ])).map((item) => ({
      name: `decryption-aad-whose-${item.name}-is-never-decoded`,
      call: 'content',
      fixture: named,
      synthCodeUnit: { field: 'aad', from: item.from, codeUnits: item.codeUnits },
      ok: false,
      allocations: 0,
    })),
    // A refusal that costs what it cost. Every other refusing case here expects
    // nothing to have been allocated, which is exactly what a counter that
    // reported nothing on refusal would report — so these are the ones that say
    // the counter is measuring. A tag that does not verify is reached by
    // decoding everything on the way to it, and a field that is the right length
    // and not an encoding is refused by the decoder, after the decoder has
    // allocated.
    {
      name: 'share-whose-tag-does-not-verify-still-costs-four-allocations',
      call: 'share',
      fixture: named,
      overrides: { ciphertext: flipBit(named.outputs.ciphertext, -1) },
      ok: false,
      allocations: 4,
    },
    {
      name: 'share-whose-stored-key-is-not-an-encoding-costs-one-allocation',
      call: 'share',
      fixture: named,
      overrides: { b: `+${named.inputs.b.slice(1)}` },
      ok: false,
      allocations: 1,
    },
    {
      name: 'share-whose-wrapped-key-is-not-an-encoding-costs-three-allocations',
      call: 'share',
      fixture: named,
      overrides: { wrapped_k: `+${named.outputs.wrapped_k.slice(1)}` },
      ok: false,
      allocations: 3,
    },
    {
      name: 'unwrap-whose-tag-does-not-verify-costs-one-allocation',
      call: 'wrap',
      fixture: named,
      overrides: { wrapped_k: flipBit(named.outputs.wrapped_k, -1) },
      ok: false,
      allocations: 1,
    },
    {
      name: 'decryption-whose-tag-does-not-verify-costs-one-allocation',
      call: 'content',
      fixture: named,
      overrides: { ciphertext: flipBit(named.outputs.ciphertext, -1) },
      ok: false,
      allocations: 1,
    },
  ];
  for (const item of orderings) {
    const uses = item.synth !== undefined || item.synthCodeUnit !== undefined;
    cases.push({
      name: `ordering/${item.name}`,
      kind: 'ordering',
      call: item.call,
      a: bytesOf(item.fixture.inputs.a),
      b: bytesOf(item.fixture.inputs.b),
      id: bytesOf(item.fixture.inputs.id),
      wrapped: item.fixture.outputs.wrapped_k,
      response: uses ? undefined : responseFor(item.fixture, item.overrides ?? {}),
      responseParts: uses ? responseFor(item.fixture, item.overrides ?? {}) : undefined,
      synth: item.synth,
      synthCodeUnit: item.synthCodeUnit,
      expect: { ok: item.ok, allocations: item.allocations },
    });
  }

  // ---- Derivation ------------------------------------------------------

  for (const derivation of derivations) {
    cases.push({
      name: `derive/${derivation.name}`,
      kind: 'derive',
      a: bytesOf(derivation.inputs.a),
      b: bytesOf(derivation.inputs.b),
      id: bytesOf(derivation.inputs.id),
      wrapped: derivation.probe.wrapped_k,
      expect: { ok: true, kek: KEK_SHAPE, contentKey: CONTENT_KEY_SHAPE },
    });
  }

  const extreme = derivations[1];
  const saltChanged = derivations[2];
  // `derives` says whether the key derivation itself succeeds. Where it does,
  // the derived key is still pinned: a case that fails at the unwrap has still
  // derived a key, and that key has to be non-extractable and single-purpose
  // like every other.
  /** @type {{ name: string, a: number[], b: number[], id: number[], wrapped: string, derives: boolean }[]} */
  const rejectedDerivations = [
    {
      // Named for what it is rather than for the vector it borrows: the vector
      // called `salt-sensitivity` is a derivation that must succeed, and this is
      // the assertion that its probe does not unwrap under the other salt. Both
      // were once called `derive/salt-sensitivity`, so the corpus carried 302
      // cases and asked 301 questions.
      name: 'probe-does-not-unwrap-under-another-salt',
      a: bytesOf(extreme.inputs.a),
      b: bytesOf(extreme.inputs.b),
      id: bytesOf(saltChanged.inputs.id),
      wrapped: extreme.probe.wrapped_k,
      derives: true,
    },
    {
      name: 'wrong-link-capability',
      a: bytesOf(saltChanged.inputs.a).map((byte) => byte ^ 1),
      b: bytesOf(extreme.inputs.b),
      id: bytesOf(extreme.inputs.id),
      wrapped: extreme.probe.wrapped_k,
      derives: true,
    },
    {
      name: 'wrong-stored-key',
      a: bytesOf(extreme.inputs.a),
      b: bytesOf(extreme.inputs.b).map((byte) => byte ^ 1),
      id: bytesOf(extreme.inputs.id),
      wrapped: extreme.probe.wrapped_k,
      derives: true,
    },
    {
      name: 'link-capability-too-short',
      a: bytesOf(extreme.inputs.a).slice(0, 31),
      b: bytesOf(extreme.inputs.b),
      id: bytesOf(extreme.inputs.id),
      wrapped: extreme.probe.wrapped_k,
      derives: false,
    },
    {
      name: 'stored-key-too-long',
      a: bytesOf(extreme.inputs.a),
      b: [...bytesOf(extreme.inputs.b), 0],
      id: bytesOf(extreme.inputs.id),
      wrapped: extreme.probe.wrapped_k,
      derives: false,
    },
    {
      name: 'salt-too-short',
      a: bytesOf(extreme.inputs.a),
      b: bytesOf(extreme.inputs.b),
      id: bytesOf(extreme.inputs.id).slice(0, 15),
      wrapped: extreme.probe.wrapped_k,
      derives: false,
    },
    {
      name: 'probe-tag-bit-flipped',
      a: bytesOf(extreme.inputs.a),
      b: bytesOf(extreme.inputs.b),
      id: bytesOf(extreme.inputs.id),
      wrapped: flipBit(extreme.probe.wrapped_k, -1),
      derives: true,
    },
  ];
  for (const item of rejectedDerivations) {
    cases.push({
      name: `derive/${item.name}`,
      kind: 'derive',
      a: item.a,
      b: item.b,
      id: item.id,
      wrapped: item.wrapped,
      expect: { ok: false, kek: item.derives ? KEK_SHAPE : null, contentKey: null },
    });
  }

  // ---- Guards ----------------------------------------------------------

  // Values that cannot be written into the corpus, aimed at the three functions
  // that take key material.
  //
  // The proxies are there because `instanceof` reads a prototype and a revoked
  // proxy throws when its prototype is read: a guard written outside the try
  // block turned every one of these into an exception, which is a second failure
  // shape reached from the first. The typed arrays whose `length` disagrees with
  // their contents are the quieter half — the brand passes, the length passes,
  // and what is copied is the slot, so a value carrying 31 bytes and claiming 32
  // derived a key from 31 bytes and a zero, and an empty salt claiming to be 16
  // bytes derived one from no salt at all.
  /** @type {{ name: string, call: string, slot?: string, hostile: { kind: string, carries?: number, claims?: number, how?: string } }[]} */
  const guards = [
    { name: 'derive-link-capability-revoked-proxy', call: 'deriveKek', slot: 'linkKey', hostile: { kind: 'revoked-proxy' } },
    { name: 'derive-link-capability-prototype-throws', call: 'deriveKek', slot: 'linkKey', hostile: { kind: 'prototype-throws' } },
    { name: 'derive-stored-key-revoked-proxy', call: 'deriveKek', slot: 'serverKey', hostile: { kind: 'revoked-proxy' } },
    { name: 'derive-salt-prototype-throws', call: 'deriveKek', slot: 'shareId', hostile: { kind: 'prototype-throws' } },
    {
      name: 'derive-link-capability-claims-32-carries-31',
      call: 'deriveKek',
      slot: 'linkKey',
      hostile: { kind: 'length-lies', carries: 31, claims: 32, how: 'own-property' },
    },
    {
      name: 'derive-link-capability-claims-32-carries-31-by-subclass',
      call: 'deriveKek',
      slot: 'linkKey',
      hostile: { kind: 'length-lies', carries: 31, claims: 32, how: 'subclass' },
    },
    {
      name: 'derive-stored-key-claims-32-carries-31',
      call: 'deriveKek',
      slot: 'serverKey',
      hostile: { kind: 'length-lies', carries: 31, claims: 32, how: 'own-property' },
    },
    {
      name: 'derive-salt-claims-16-carries-nothing',
      call: 'deriveKek',
      slot: 'shareId',
      hostile: { kind: 'length-lies', carries: 0, claims: 16, how: 'own-property' },
    },
    {
      name: 'derive-salt-claims-16-carries-15-by-subclass',
      call: 'deriveKek',
      slot: 'shareId',
      hostile: { kind: 'length-lies', carries: 15, claims: 16, how: 'subclass' },
    },
    // Typed arrays of the wrong kind, carrying exactly the right number of
    // bytes. The count is read from the internal slot through the accessor every
    // typed array shares, so all three satisfy it, and the only thing that says
    // they are not key material is the brand — which is one line, and until now
    // nothing put anything to it that could pass without it. The wider one is
    // the worst of them: sixteen elements is thirty-two bytes, so it clears the
    // count and then copies half of them, and the derivation succeeds on a key
    // half made of sixteen bytes and sixteen zeroes.
    {
      name: 'derive-link-capability-is-a-signed-typed-array',
      call: 'deriveKek',
      slot: 'linkKey',
      hostile: { kind: 'another-typed-array', carries: 32, how: 'signed' },
    },
    {
      name: 'derive-link-capability-is-a-wider-typed-array',
      call: 'deriveKek',
      slot: 'linkKey',
      hostile: { kind: 'another-typed-array', carries: 16, how: 'wider' },
    },
    {
      name: 'derive-stored-key-is-a-clamped-typed-array',
      call: 'deriveKek',
      slot: 'serverKey',
      hostile: { kind: 'another-typed-array', carries: 32, how: 'clamped' },
    },
    {
      name: 'derive-salt-is-a-signed-typed-array',
      call: 'deriveKek',
      slot: 'shareId',
      hostile: { kind: 'another-typed-array', carries: 16, how: 'signed' },
    },
    { name: 'unwrap-key-revoked-proxy', call: 'unwrapContentKey', slot: 'kek', hostile: { kind: 'revoked-proxy' } },
    { name: 'unwrap-key-prototype-throws', call: 'unwrapContentKey', slot: 'kek', hostile: { kind: 'prototype-throws' } },
    { name: 'decrypt-key-revoked-proxy', call: 'decryptContent', slot: 'contentKey', hostile: { kind: 'revoked-proxy' } },
    {
      name: 'decrypt-key-prototype-throws',
      call: 'decryptContent',
      slot: 'contentKey',
      hostile: { kind: 'prototype-throws' },
    },
    // The arguments that are meant to be strings, in the two functions a caller
    // can reach directly, each handed a value whose length cannot be read. The
    // genuine key goes in the other slot, so what is being asked about is the
    // order these functions ask their two questions in and not a refusal that
    // would have happened at the key.
    {
      name: 'unwrap-wrapped-key-length-cannot-be-read',
      call: 'unwrapContentKey',
      slot: 'wrapped',
      hostile: { kind: 'length-throws' },
    },
    {
      name: 'decrypt-ciphertext-length-cannot-be-read',
      call: 'decryptContent',
      slot: 'ciphertext',
      hostile: { kind: 'length-throws' },
    },
    {
      name: 'decrypt-aad-length-cannot-be-read',
      call: 'decryptContent',
      slot: 'aad',
      hostile: { kind: 'length-throws' },
    },
  ];
  for (const guard of guards) {
    cases.push({
      name: `guard/${guard.name}`,
      kind: 'guard',
      call: guard.call,
      slot: guard.slot,
      hostile: guard.hostile,
      a: bytesOf(A),
      b: bytesOf(named.inputs.b),
      id: bytesOf(ID),
      wrapped: named.outputs.wrapped_k,
      ciphertext: named.outputs.ciphertext,
      aadText: named.inputs.aad,
      expect: { ok: false },
    });
  }

  // ---- Additional authenticated data -----------------------------------

  for (const fixture of fixtures) {
    cases.push({
      name: `aad/fixture-${fixture.name}`,
      kind: 'aad',
      text: fixture.inputs.aad,
      expect: aadAdmitted(fixture.inputs.aad),
    });
  }

  // An expiry at the largest value a reader carries back exactly. Here so that
  // refusing everything above it is a bound rather than a blanket.
  const safeMaximumExpiry = aadWithExpiry('9007199254740991');
  cases.push({
    name: 'aad/expiry-at-the-largest-exact-integer',
    kind: 'aad',
    text: safeMaximumExpiry,
    expect: aadAdmitted(safeMaximumExpiry),
  });

  // And at the smallest value the rule admits, which is the other edge of the
  // same comparison and had no case at all. Everything the corpus refused for
  // being at or below zero is refused just as readily by a rule that admits only
  // two and above, so the bound could be tightened by one with nothing to say
  // so — and the value it would then refuse is a real expiry, one second into
  // 1970. The floor of a bound needs a case on the admitted side of it as much
  // as the ceiling does.
  const smallestExpiry = aadWithExpiry('1');
  cases.push({
    name: 'aad/expiry-at-the-smallest-admitted-value',
    kind: 'aad',
    text: smallestExpiry,
    expect: aadAdmitted(smallestExpiry),
  });

  // And above every expiry a fixture carries, which is a band rather than an
  // edge and was empty. The published values run through 2026 and stop at
  // 1783036800; the only admitted value anywhere above them is the largest exact
  // integer there is, which is a date 285 million years out. So every ordinary
  // expiry past next year was a value no case held, and the expiry is returned
  // as it arrived — a rewrite that moved one by a day, gated on being inside
  // that band, changed what a recipient is told about when the link stops
  // working and left this whole corpus green.
  //
  // Two of them rather than one, because a rewrite gated on a range is gated on
  // a range somebody picked: one a few years out, one at the turn of the next
  // century.
  const expiryAboveTheFixtures = aadWithExpiry('1900000000');
  cases.push({
    name: 'aad/expiry-above-every-fixture',
    kind: 'aad',
    text: expiryAboveTheFixtures,
    expect: aadAdmitted(expiryAboveTheFixtures),
  });

  const expiryFarAboveTheFixtures = aadWithExpiry('4102444800');
  cases.push({
    name: 'aad/expiry-far-above-every-fixture',
    kind: 'aad',
    text: expiryFarAboveTheFixtures,
    expect: aadAdmitted(expiryFarAboveTheFixtures),
  });

  // And at the largest length the bound on this string admits, which is the
  // other half of what the comparison beside that bound claims. The reason
  // written there was that no producer of this schema emits a string that long;
  // it is written that way no longer, because the schema's last field is
  // constrained only to be a non-empty string and this is what the validator
  // does with one of 3,983 characters. The share carrying it is the case beside
  // the fixtures above; this is the reading of it, so "admissible" is a fact
  // rather than an assertion in a comment.
  const aadAtTheBound = aadOfExactly(AAD_MAX_LENGTH);
  cases.push({
    name: 'aad/at-the-largest-length-the-bound-admits',
    kind: 'aad',
    text: aadAtTheBound,
    expect: aadAdmitted(aadAtTheBound),
  });

  // And the same question the document case below asks, for the one field of the
  // authenticated data that is a free string.
  //
  // Two of the six fields cannot be rewritten at all: `v` and `doc` are written
  // back from the pins. The other four are handed back as they arrived, each
  // past a check of its own — `exp` past a safe-integer test, `edited` past a
  // type test, `id` past a decode and a length comparison, and `sfv` past a test
  // that it is a non-empty string. `sfv` is the one with no constraint on its
  // contents at all, so trimming it, or truncating it, was a rewrite of what the
  // tag covered that nothing here asked about. Every published fixture's `sfv`
  // is short and carries no outer whitespace, which is exactly what made the two
  // edits invisible. The other three are asked about further down, each by a
  // case about the values the fixtures happen not to carry.
  const aadPreservingSfv = aadText((aad) => {
    aad['sfv'] = '  a structured field value, spaced, and longer than any width a rewrite would keep it to  ';
  });
  cases.push({
    name: 'aad/every-shape-a-silent-rewrite-would-change',
    kind: 'aad',
    text: aadPreservingSfv,
    expect: aadAdmitted(aadPreservingSfv),
  });

  /** @type {[string, string][]} */
  const rejectedAad = [
    ['not-json', '{'],
    ['json-null', 'null'],
    ['json-array', '[]'],
    ['json-string', '"link_split_v1"'],
    ['json-number', '1'],
    ['empty-object', '{}'],
    ['unknown-field', aadText((aad) => { aad['extra'] = 1; })],
    ['prototype-field', named.inputs.aad.replace('{', '{"__proto__":1,')],
    ['missing-sfv', aadText((aad) => { delete aad['sfv']; })],
    ['missing-exp', aadText((aad) => { delete aad['exp']; })],
    ['wrong-link-version', aadText((aad) => { aad['v'] = 'link_split_v2'; })],
    ['wrong-document-version', aadText((aad) => { aad['doc'] = 'share_doc_v2'; })],
    ['version-not-a-string', aadText((aad) => { aad['v'] = 1; })],
    ['identifier-too-short', aadText((aad) => { aad['id'] = aad['id'].slice(0, 21); })],
    ['identifier-too-long', aadText((aad) => { aad['id'] = `${aad['id']}A`; })],
    ['identifier-not-base64url', aadText((aad) => { aad['id'] = `+${aad['id'].slice(1)}`; })],
    ['identifier-padded', aadText((aad) => { aad['id'] = `${aad['id'].slice(0, 20)}==`; })],
    ['identifier-not-a-string', aadText((aad) => { aad['id'] = 1; })],
    // Twenty-two characters from the alphabet, and still not an encoding of any
    // sixteen bytes: the last character carries bits there is no byte to hold.
    // Sixty of the sixty-four characters that could end an identifier are like
    // this, and the fragment refuses every one of them.
    ['identifier-non-canonical-trailing-bits', aadText((aad) => { aad['id'] = `${aad['id'].slice(0, 21)}x`; })],
    ['identifier-non-canonical-trailing-bits-alternate', aadText((aad) => { aad['id'] = `${aad['id'].slice(0, 21)}B`; })],
    ['expiry-fractional', aadText((aad) => { aad['exp'] = 1767225600.5; })],
    ['expiry-negative', aadText((aad) => { aad['exp'] = -1; })],
    ['expiry-zero', aadText((aad) => { aad['exp'] = 0; })],
    ['expiry-a-string', aadText((aad) => { aad['exp'] = '1767225600'; })],
    ['expiry-null', aadText((aad) => { aad['exp'] = null; })],
    // An integer one past the range a double carries exactly. It parses to
    // 9007199254740992, which is an integer and is positive and is not the
    // number that was sealed — so a viewer that asked only whether it was an
    // integer displayed an expiry the tag never covered.
    ['expiry-one-past-the-largest-exact-integer', aadWithExpiry('9007199254740993')],
    ['expiry-far-past-the-largest-exact-integer', aadWithExpiry('123456789012345678901')],
    ['expiry-in-exponent-notation', aadWithExpiry('1e21')],
    ['edited-a-string', aadText((aad) => { aad['edited'] = 'false'; })],
    ['edited-a-number', aadText((aad) => { aad['edited'] = 0; })],
    ['sfv-empty', aadText((aad) => { aad['sfv'] = ''; })],
    ['sfv-not-a-string', aadText((aad) => { aad['sfv'] = 1; })],
  ];
  for (const [name, text] of rejectedAad) {
    cases.push({ name: `aad/${name}`, kind: 'aad', text, expect: AAD_REFUSED });
  }

  /** @type {[string, { kind: string, field?: string }][]} */
  const tamperedRecords = [
    ['field-inherited', { kind: 'inherit', field: 'sfv' }],
    ['discriminator-inherited', { kind: 'inherit', field: 'v' }],
    ['extra-field-not-enumerable', { kind: 'hide' }],
    ['extra-field-under-a-symbol', { kind: 'symbol' }],
    ['field-is-a-getter', { kind: 'getter', field: 'exp' }],
    // A getter that hands back exactly what was there, and a field that is its
    // own value but not enumerable. Neither is refused by anything but the rule
    // it is aimed at, which the loud getter above never showed.
    ['field-is-a-quiet-accessor', { kind: 'quiet-getter', field: 'sfv' }],
    ['field-not-enumerable', { kind: 'not-enumerable', field: 'sfv' }],
    // And the three that throw when they are looked at. This validator is total,
    // and totality here is a property of the reflection calls the reader makes
    // rather than of the values it makes them on.
    ['a-revoked-proxy', { kind: 'revoked' }],
    ['cannot-be-enumerated', { kind: 'own-keys-throws' }],
    ['descriptors-cannot-be-read', { kind: 'descriptor-throws' }],
    ['lists-fewer-properties-than-it-has', { kind: 'own-keys-under-reports' }],
    // The two fields of the authenticated data whose lengths are read, each
    // holding a value that throws when its length is asked for. This validator
    // is reached from routing, which is not inside a guard of its own, so the
    // order those two questions are asked in is the difference between a
    // refusal and an exception arriving at the boot seam.
    ['identifier-length-cannot-be-read', { kind: 'hostile-length', field: 'id' }],
    ['sfv-length-cannot-be-read', { kind: 'hostile-length', field: 'sfv' }],
  ];
  for (const [name, tamper] of tamperedRecords) {
    cases.push({ name: `aad/${name}`, kind: 'aad', text: named.inputs.aad, tamper, expect: AAD_REFUSED });
  }

  // ---- Documents -------------------------------------------------------

  for (const fixture of fixtures) {
    cases.push({
      name: `document/fixture-${fixture.name}`,
      kind: 'document',
      text: fixture.inputs.plaintext,
      expect: docAdmitted(fixture.inputs.plaintext),
    });
  }

  // A document carrying the shapes a silent rewrite needs in order to be seen.
  //
  // Every document case above asks whether a document is admitted or refused.
  // None of them asks what a recipient reads, because the published fixtures are
  // all one small shape: at most two sections, at most two lines in one, headings
  // shorter than any truncation anybody would write, and no field whose
  // whitespace means anything. So the validator could rewrite what it returns and
  // the whole corpus stayed green. Each of these was demonstrated against the
  // full gate, at exit 0:
  //
  //   - dropping every section past the second, invisible because no successful
  //     fixture has three;
  //   - sorting the sections by heading, invisible because the one multi-section
  //     fixture is already in sorted order — reversing them is caught, sorting
  //     them is not, and the difference is which of the two a rewrite would be;
  //   - keeping only the first two lines of a section, invisible because no
  //     section carries three;
  //   - truncating a heading, invisible because none is long;
  //   - trimming `banner_text`, invisible because none carries whitespace that
  //     means anything.
  //
  // That list was the shapes one person thought of, and the document was built to
  // carry exactly those. Five more rewrites were then found, every one of them
  // leaving the full gate at exit 0 and every one of them changing what a
  // recipient reads:
  //
  //   - merging duplicate lines, invisible because no section repeats one;
  //   - deleting blank lines, invisible because no section carries one;
  //   - trimming `you_means`, `topic` and `heading`, invisible because the first
  //     two were never given whitespace and the third was only ever given length.
  //
  // The pattern is exact and is the point: the previous round gave `banner_text`
  // outer whitespace and gave a heading extra length, so a rewrite reaching a
  // field that had been given neither, or a shape no document carried at all,
  // stayed invisible. A corpus holds the shapes it was given.
  //
  // The general property is that a successful validation returns what it was
  // given — every field, unchanged, whatever it was. No list of cases holds that,
  // and this one does not: a rewrite reaching some shape none of these cases
  // carries is outside it, and the honest alternative is a generator of documents
  // rather than a corpus about a validator. That residual is named rather than
  // closed.
  //
  // What now stands for it, exactly:
  //
  //   - every string field a recipient reads — `banner_text`, `you_means`,
  //     `visit_date`, `topic`, and every `heading` — carries both outer
  //     whitespace and a length past the widths a rewrite would plausibly keep,
  //     so trimming one, truncating one, or wrapping one is a different document;
  //   - one section's lines carry a repeat, an empty string, and a line with both
  //     whitespace and length, so merging duplicates, dropping blanks, trimming
  //     and truncating are each a different document;
  //   - there are three sections, in no sorted order, and one of them has more
  //     than two lines, so sorting, dropping a section, and keeping only the
  //     first lines are each a different document.
  //
  // The expectation is rebuilt from this same text by `expectedDoc`, field by
  // field, so what is compared is the input read back rather than anything the
  // viewer produced.
  const preservingDocument = docText((doc) => {
    doc['banner_text'] = '  Example banner text, spaced, and long enough that shortening it to a line would drop some.  ';
    doc['you_means'] = '  Example recipient, spaced, and longer than any name a rewrite would keep whole.  ';
    doc['visit_date'] = '  15 January 2026, spelled at a length no reformatting would leave alone.  ';
    doc['topic'] = '  Example topic, spaced, and long enough that dropping its tail would change what it says.  ';
    doc['sections'] = [
      {
        heading: '  Zebra: a heading longer than any truncation a rewrite would pick, and then some more of it  ',
        lines: [
          '  Example line one, spaced, and long enough that wrapping it would change where it breaks.  ',
          'Example line two.',
          'Example line two.',
          '',
          'Example line three.',
        ],
      },
      {
        heading: '  Middle heading, spaced, and carried at a length nothing would leave as it is.  ',
        lines: ['Example line four.'],
      },
      {
        heading: '  Alpha heading, spaced, and long for the same reason the two above it are.  ',
        lines: [],
      },
    ];
  });
  cases.push({
    name: 'document/every-shape-a-silent-rewrite-would-change',
    kind: 'document',
    text: preservingDocument,
    expect: docAdmitted(preservingDocument),
  });

  // ---- Validator-output fidelity ---------------------------------------
  //
  // The property, stated once: a successful validation returns what it was
  // given. At every location the validator returns a string, the string that
  // comes back is the string that went in — nothing normalises, trims,
  // truncates, collapses, reorders, deduplicates or drops.
  //
  // Validator output, and deliberately not "what a carer reads". The roots the
  // `render` cases hand over are not this viewer's page, so the renderer empties
  // one and draws nothing, and those cases observe the clear and the write
  // counters rather than any text — so nothing in this corpus is in a position
  // to say what a recipient sees. What these cases pin is the value
  // `validateShareDocV1` and `validateAadV1` hand back; whatever displays it is
  // downstream of that and is asked about elsewhere. Writing the stronger claim
  // here would be a sentence in the code that is not true of the code, which is
  // its own defect.
  //
  // Eight locations carry a string back: `banner_text`, `you_means`,
  // `visit_date`, `topic`, every `heading`, every entry of every `lines`, and —
  // in the authenticated data — `sfv` and `id`. Six of the eight come back
  // unexamined past `typeof`. The other two are examined past it and returned as
  // they arrived all the same: `sfv` has its length compared against zero, and
  // `id` is decoded and its length compared, and in both cases what comes back
  // afterwards is the string that went in. So a rewrite inside what those checks
  // admit — a non-empty `sfv`, a substitution inside the identifier's
  // alphabet — is a returned value like the rest of them.
  //
  // Two more fields are returned rather than refused without being strings at
  // all: `exp`, a number checked for being a safe positive integer and handed
  // back, and `edited`, a boolean checked for being one. Only four fields
  // anywhere — `v`, `doc`, `schema` and `banner_key` — are written back from a
  // pin, and those four are the only ones no rewrite can reach.
  //
  // For the other ten the coverage is the values this corpus carries, and the
  // shape of that coverage differs by field. The matrix below is shapes, at
  // every location that admits an arbitrary string. The remaining three axes are
  // values rather than shapes and have a case apiece beside them: an expiry
  // above the band every fixture sits in, an identifier carrying a character no
  // fixture does, and this whole matrix run again with `edited` true.
  //
  // The lone refusal anywhere in this matrix is the empty string at `sfv`, which
  // `aad/sfv-empty` already holds.
  //
  // The case above closed the shapes one person listed. This closes the class
  // those shapes were examples of, and the difference is per-location coverage
  // rather than a longer list: an earlier attempt was defeated by
  // `heading.normalize('NFC')` alone, because a composable character sat in some
  // fields and in no heading. So every shape below is at every one of the seven
  // locations, rather than somewhere in the document.
  //
  // What a list of cases still cannot do is hold the property, and the reason is
  // structural rather than a matter of length. The property quantifies over
  // every value a share can carry; a corpus quantifies over the values it does
  // carry. Those are different quantifiers, and no list closes the gap between
  // them: a predicate chosen after reading a finite corpus can always be made
  // true only outside it, so for any corpus there is a transform gated on
  // something none of its cases happens to be — an interval, a container count,
  // a character, a flag. Adding the case that catches today's transform is worth
  // doing, and it is not progress towards closing the class.
  //
  // So the class is closed by that argument and by the reviewable diff, not by
  // enumeration. A rewrite of what a validator returns is a change to a public
  // file in a public repository, and that is what it comes up against. The
  // alternative that would close it by construction is a generator — documents
  // drawn from the schema and compared against themselves, rather than a corpus
  // about a validator — and it is named here as deliberately not taken rather
  // than overlooked: it moves the question to whether the generator's
  // distribution reaches the shape, which is this question with a longer answer.
  //
  // The instances left open by design, so nobody has to rediscover which ones
  // they are: a transform gated on a container count or a window the corpus
  // skips; an expiry interval outside the band the cases cover; an identifier
  // substitution outside the alphabet they carry; and a predicate on any axis
  // every fixture holds constant. Each is a value this corpus does not carry,
  // and each stays reachable for exactly as long as that is true of it. No
  // longer list changes any of this; what a longer list does is move a named
  // instance from open to closed, one value at a time.
  //
  // What stands for it now, exactly. At every one of the seven locations that
  // admit an arbitrary string — the eighth, `id`, is fixed at twenty-two
  // characters of one alphabet and has a case of its own — outer whitespace at
  // both ends, an interior run of spaces, all three spellings of a line break,
  // seventeen invisible and format characters, an acute accent both precomposed
  // and decomposed, a variation selector, a character outside the basic plane, a
  // C1 control, a U+FFFD that is there because it was sealed there, mixed case,
  // and the three substitution baits — a typographic quote, an en dash and a
  // non-breaking space.
  //
  // Length is the one item that is not per-location, and writing it as though it
  // were would be exactly the overclaim this paragraph exists to avoid. Each of
  // these strings runs to between 482 and 500 characters: past any width
  // somebody would truncate a heading or a date to, and nowhere near past every
  // width there is. What stands against a cut at an arbitrary width is the
  // document at the largest size a share can be, below, whose padded line
  // carries 345,490 characters — a truncation that leaves 500 alone still shows
  // there. So the claim is per-location shape coverage everywhere, and length
  // past any cut at the one location carrying the document's bulk.
  //
  // In the containers: a section list in an order that is neither sorted nor its
  // own reverse, a section that repeats a line, a leading empty line, an interior
  // one and a trailing one, the empty string at a heading and at a line, a
  // document at the largest size a share can be, and two documents at the most
  // sections and the most lines one can hold.
  //
  // Two things about the machinery, because each is one edit from turning this
  // from an assertion into an agreement. `expectedDoc` is the identity
  // assertion: it is `JSON.parse` of the very text the driver is handed, so what
  // every admitted-document case compares against is its own input read back
  // rather than anything a person wrote down — and because it is shared by all
  // of them, anyone who answers a red identity failure by editing it destroys
  // the property for the whole corpus in a single edit. And `docAdmitted` takes
  // an optional second argument, which is the seam where identity could become
  // an editable expectation: whatever is handed there is what the case compares
  // against, in place of the input read back. Two cases below pass it, and what
  // they pass is `expectedDoc` of the very text the driver is handed — the
  // identity oracle written out rather than left to the default, which is the
  // same comparison either way. Nothing in this corpus passes a hand-written
  // document there, and a new fixture must not be the first.

  // The shapes, one named constant apiece, every one written as an escape and
  // none of them pasted. An invisible character that arrives in a fixture by
  // accident is indistinguishable from one that was intended: two stray U+0001
  // characters once passed typecheck, the sink scan, the corpus, both engines
  // and the attribution scan without a word. This fixture is made of invisible
  // characters, so the alphabet assertion below is what holds its contents,
  // rather than care.
  const SHAPES = Object.freeze({
    softHyphen: '\u00AD',
    zeroWidthSpace: '\u200B',
    zeroWidthNonJoiner: '\u200C',
    zeroWidthJoiner: '\u200D',
    leftToRightMark: '\u200E',
    rightToLeftMark: '\u200F',
    leftToRightEmbedding: '\u202A',
    rightToLeftEmbedding: '\u202B',
    popDirectionalFormatting: '\u202C',
    leftToRightOverride: '\u202D',
    rightToLeftOverride: '\u202E',
    wordJoiner: '\u2060',
    functionApplication: '\u2061',
    invisibleTimes: '\u2062',
    invisibleSeparator: '\u2063',
    invisiblePlus: '\u2064',
    byteOrderMark: '\uFEFF',
    // Composed and decomposed both, and at every location, because a
    // normalisation is a rewrite in one direction only: NFC is invisible to a
    // fixture carrying no decomposed sequence, and NFD to one carrying no
    // precomposed character.
    composedAcute: '\u00E9',
    baseLetter: 'e',
    combiningAcute: '\u0301',
    variationSelector: '\uFE0F',
    // Outside the basic plane, so it is a surrogate pair in the string as well
    // as one character in the text. Unpaired surrogates are admitted by the
    // validator too, and are deliberately not here: a lone surrogate cannot
    // survive the transport that carries an observation back out of the page,
    // which is why the two cases that ask about one build it inside the page
    // from code units instead.
    nonBasicPlane: '\u{1D11E}',
    // A control that is legal in a JSON string once it is past U+001F, and one
    // that a "strip control characters" pass would take.
    c1Control: '\u0080',
    // A replacement character that is in the document because it was in the
    // document, not because something was repaired on the way.
    replacementCharacter: '\uFFFD',
    // The substitution bait. A pass that maps a typographic quote, an en dash
    // or a non-breaking space to its ASCII lookalike is a rewrite of what was
    // sealed, and nothing in this corpus saw one until now.
    rightSingleQuotationMark: '\u2019',
    enDash: '\u2013',
    nonBreakingSpace: '\u00A0',
    // A line break inside a value, in all three spellings, so a fixture that
    // splits on one is a different document. It has to sit inside a `lines`
    // entry to reach `validateLines`, and it does.
    lineFeed: '\n',
    carriageReturn: '\r',
  });

  /** Outer whitespace, at both ends of every location's string. */
  const OUTER_SPACE = '  ';

  /** An interior run, which a collapse leaves alone at the ends and not here. */
  const INTERIOR_RUN = '   ';

  /** Length, past any width a truncation would plausibly keep. */
  const FIDELITY_PADDING = 'carried on at a length no truncation would leave alone, and then further still, ';

  /**
   * One location's string: every shape class in one value, behind a marker
   * naming the location it belongs to.
   *
   * The marker is not decoration. A single failing case here prints the whole
   * document twice, and at this size that is an unreadable single-line diff — so
   * each location says which one it is, and the first difference in the dump
   * names the field that moved.
   *
   * @param {string} marker
   * @returns {string}
   */
  const fidelityString = (marker) =>
    `${OUTER_SPACE}${marker}|MiXeD${INTERIOR_RUN}CaSe|` +
    `${SHAPES.composedAcute}|${SHAPES.baseLetter}${SHAPES.combiningAcute}|${SHAPES.variationSelector}|` +
    `${SHAPES.softHyphen}${SHAPES.zeroWidthSpace}${SHAPES.zeroWidthNonJoiner}${SHAPES.zeroWidthJoiner}` +
    `${SHAPES.leftToRightMark}${SHAPES.rightToLeftMark}${SHAPES.leftToRightEmbedding}` +
    `${SHAPES.rightToLeftEmbedding}${SHAPES.popDirectionalFormatting}${SHAPES.leftToRightOverride}` +
    `${SHAPES.rightToLeftOverride}${SHAPES.wordJoiner}${SHAPES.functionApplication}` +
    `${SHAPES.invisibleTimes}${SHAPES.invisibleSeparator}${SHAPES.invisiblePlus}${SHAPES.byteOrderMark}|` +
    `${SHAPES.nonBasicPlane}|${SHAPES.c1Control}|${SHAPES.replacementCharacter}|` +
    `it${SHAPES.rightSingleQuotationMark}s${SHAPES.enDash}spaced${SHAPES.nonBreakingSpace}thus|` +
    `${SHAPES.lineFeed}${SHAPES.carriageReturn}${SHAPES.carriageReturn}${SHAPES.lineFeed}|` +
    FIDELITY_PADDING.repeat(5) +
    `${marker}-end${OUTER_SPACE}`;

  /** Every character the fixture is allowed to carry beyond ASCII printables. */
  const SHAPE_ALPHABET = new Set(Object.values(SHAPES).flatMap((shape) => [...shape]));

  /**
   * Hold one location's string to the matrix, at build time.
   *
   * Both directions, and the second is the one that is easy to leave out. Every
   * shape `SHAPES` declares has to be present, and no character outside the
   * alphabet `SHAPES` declares is allowed to be — so a location that quietly
   * lost a shape is a build failure, and an invisible character that arrived by
   * accident is one too. Neither could come from the identity comparison, which
   * derives its expectation from this same text and would agree with a mistake
   * as readily as with the intent.
   *
   * What this does not do is make the matrix complete, and it would be an easy
   * sentence to write. Both directions are read off `SHAPES`: the alphabet is
   * built from its values and the loop walks its entries. So what is held is the
   * fixture against the table, both ways round, and never the table against the
   * code points there are — a shape nobody wrote down is absent from the table
   * and from every location at once, and this agrees with itself about it. That
   * the seventeen invisibles are the invisibles worth naming, and that each
   * escape is the character its name says it is, are held by reading them.
   *
   * @param {string} where
   * @param {unknown} text
   */
  const holdFidelityString = (where, text) => {
    if (typeof text !== 'string') {
      throw new Error(`the fidelity fixture has no string at ${where}`);
    }
    for (const [name, shape] of Object.entries(SHAPES)) {
      if (!text.includes(shape)) {
        throw new Error(`the fidelity fixture is missing ${name} at ${where}`);
      }
    }
    if (!text.includes(`${SHAPES.carriageReturn}${SHAPES.lineFeed}`)) {
      throw new Error(`the fidelity fixture carries no CRLF at ${where}`);
    }
    if (!text.startsWith(OUTER_SPACE) || !text.endsWith(OUTER_SPACE)) {
      throw new Error(`the fidelity fixture has no outer whitespace at ${where}`);
    }
    if (!text.includes(INTERIOR_RUN)) {
      throw new Error(`the fidelity fixture has no interior whitespace run at ${where}`);
    }
    if (text.length <= 300) {
      throw new Error(`the fidelity fixture is short enough to survive a truncation at ${where}`);
    }
    for (const character of text) {
      const code = character.codePointAt(0) ?? 0;
      if (SHAPE_ALPHABET.has(character) || (code >= 0x20 && code <= 0x7e)) {
        continue;
      }
      const point = code.toString(16).toUpperCase().padStart(4, '0');
      throw new Error(`the fidelity fixture carries U+${point} at ${where}, which is not one of its shapes`);
    }
  };

  // The document. Seven sections rather than the three above, and one section of
  // eight lines rather than five, because two of the transforms that survived
  // everything else were gated on a container count the corpus happened to top
  // out at: reversing the sections when there are more than three, and dropping
  // a section's last line when there are more than five. The order the sections
  // are written in is neither sorted nor reverse-sorted, so both a sort and a
  // reversal are a different document.
  //
  // The empty string is legal at a heading and at a line and is carried at both.
  // It is legal at the four scalar fields as well and is not carried there,
  // because a field holding the empty string cannot also hold the shapes, and
  // those four have exactly one value each.
  const fidelitySections = [
    {
      heading: fidelityString('HEAD-Z'),
      lines: [
        fidelityString('LINE-1'),
        fidelityString('LINE-DUP'),
        fidelityString('LINE-DUP'),
        '',
        fidelityString('LINE-2'),
        fidelityString('LINE-3'),
        fidelityString('LINE-4'),
        fidelityString('LINE-5'),
      ],
    },
    { heading: fidelityString('HEAD-M'), lines: ['', fidelityString('LINE-6')] },
    { heading: fidelityString('HEAD-A'), lines: [fidelityString('LINE-7'), ''] },
    { heading: '', lines: [''] },
    { heading: fidelityString('HEAD-B'), lines: [] },
    { heading: fidelityString('HEAD-Y'), lines: [fidelityString('LINE-8'), fidelityString('LINE-8')] },
    { heading: fidelityString('HEAD-C'), lines: [fidelityString('LINE-9')] },
  ];

  const fidelityDocument = docText((doc) => {
    doc['banner_text'] = fidelityString('BANNER');
    doc['you_means'] = fidelityString('YOU-MEANS');
    doc['visit_date'] = fidelityString('VISIT-DATE');
    doc['topic'] = fidelityString('TOPIC');
    doc['sections'] = fidelitySections;
  });

  /**
   * Hold the built document to the matrix, reading the text back rather than the
   * object it was built from.
   *
   * Read back, because the text is what the driver is handed and the object is
   * not: a shape lost in serialisation would be a shape this fixture claims and
   * does not carry, and reading the object could not tell.
   *
   * @param {string} text
   */
  const holdFidelityDocument = (text) => {
    const doc = JSON.parse(text);
    holdFidelityString('banner_text', doc.banner_text);
    holdFidelityString('you_means', doc.you_means);
    holdFidelityString('visit_date', doc.visit_date);
    holdFidelityString('topic', doc.topic);

    /** @type {string[]} */
    const headings = [];
    let emptyHeadings = 0;
    let emptyLines = 0;
    let leadingEmpty = 0;
    let interiorEmpty = 0;
    let trailingEmpty = 0;
    let duplicated = 0;
    let longestSection = 0;

    for (const [index, section] of doc.sections.entries()) {
      headings.push(section.heading);
      if (section.heading === '') {
        emptyHeadings += 1;
      } else {
        holdFidelityString(`the heading of section ${index}`, section.heading);
      }
      /** @type {string[]} */
      const lines = section.lines;
      longestSection = Math.max(longestSection, lines.length);
      if (lines.length > 1 && lines[0] === '') {
        leadingEmpty += 1;
      }
      if (lines.length > 1 && lines[lines.length - 1] === '') {
        trailingEmpty += 1;
      }
      if (lines.slice(1, -1).some((line) => line === '')) {
        interiorEmpty += 1;
      }
      if (new Set(lines).size !== lines.length) {
        duplicated += 1;
      }
      for (const [position, line] of lines.entries()) {
        if (line === '') {
          emptyLines += 1;
        } else {
          holdFidelityString(`line ${position} of section ${index}`, line);
        }
      }
    }

    /**
     * Two lists of headings in the same order, compared element by element.
     *
     * Element-wise rather than by joining on a separator, because a separator
     * is a character and every character in this fixture is one somebody chose
     * on purpose. A join needs one that no heading carries, which is a second
     * thing to be right about for no gain.
     *
     * @param {readonly string[]} left
     * @param {readonly string[]} right
     * @returns {boolean}
     */
    const sameOrder = (left, right) =>
      left.length === right.length && left.every((item, index) => item === right[index]);

    /** @type {[boolean, string][]} */
    const containers = [
      [doc.sections.length > 3, 'more than three sections, so reversing them is a different document'],
      [longestSection > 5, 'a section of more than five lines, so dropping its last one shows'],
      [
        !sameOrder(headings, [...headings].sort()),
        'sections in an order that is not sorted, so sorting them shows',
      ],
      [
        !sameOrder(headings, [...headings].reverse()),
        'sections in an order that is not its own reverse, so reversing them shows',
      ],
      [emptyHeadings > 0, 'the empty string at a heading'],
      [emptyLines > 0, 'the empty string at a line'],
      [leadingEmpty > 0, 'a section whose first line is empty'],
      [interiorEmpty > 0, 'a section with an empty line in the middle'],
      [trailingEmpty > 0, 'a section whose last line is empty'],
      [duplicated > 0, 'a section that repeats a line, so merging duplicates shows'],
    ];
    for (const [held, what] of containers) {
      if (!held) {
        throw new Error(`the fidelity fixture does not carry ${what}`);
      }
    }
  };

  holdFidelityDocument(fidelityDocument);

  cases.push({
    name: 'document/every-shape-at-every-location-the-validator-returns',
    kind: 'document',
    text: fidelityDocument,
    expect: docAdmitted(fidelityDocument),
  });

  // And the same matrix at the seventh location, which is in the other
  // validator. `sfv` is the authenticated field with no constraint on its
  // contents — a non-empty string, handed straight back. Trimming it and
  // truncating it were already caught by the case above this one; normalising it
  // and stripping the zero-width characters out of it both survived, which is
  // what this closes. The other authenticated field that comes back as the
  // string that arrived is `id`, and it cannot carry this matrix: it is
  // twenty-two characters of one alphabet, so what is asked about it is asked
  // below.
  const fidelityAad = aadText((aad) => {
    aad['sfv'] = fidelityString('SFV');
  });
  holdFidelityString('sfv', JSON.parse(fidelityAad).sfv);

  cases.push({
    name: 'aad/every-shape-at-the-one-location-the-validator-returns',
    kind: 'aad',
    text: fidelityAad,
    expect: aadAdmitted(fidelityAad),
  });

  // And the identifier, which is the other authenticated field handed back as
  // the string that arrived. Most of what could be done to it is refused: it has
  // to be twenty-two characters, it has to decode to sixteen bytes, and the
  // decoder is strict about the trailing bits. What survives all three is a
  // substitution inside the alphabet — one character of it swapped for another,
  // twenty-two characters still, sixteen bytes still, and a different share
  // named.
  //
  // The alphabet has sixty-four characters, and the identifiers the fixtures
  // carry in their authenticated data reach most of them — but not one of those
  // carries `_`. So a pass rewriting `_` to `-` was invisible here while a pass
  // rewriting `-` to `_` was caught, which is a coverage accident rather than a
  // difference between the two. This carries the character that was missing.
  // Elsewhere in the vectors an identifier of nothing but `_` does appear, as a
  // derivation's salt; it never reaches this validator, so it stands for nothing
  // about what is returned. What admits it is the validator's
  // own decoder and not any leniency: twenty-two characters, a decode of exactly
  // sixteen bytes, and a final `A` so the leftover bits are the zeroes the
  // encoding requires of them.
  const aadCarryingAnUnderscore = aadText((aad) => {
    aad['id'] = 'AAAAAAAAAA_AAAAAAAAAAA';
  });
  cases.push({
    name: 'aad/identifier-carrying-an-underscore',
    kind: 'aad',
    text: aadCarryingAnUnderscore,
    expect: aadAdmitted(aadCarryingAnUnderscore),
  });

  // And both matrices again with `edited` true, which is the one axis every
  // fixture carrying a matrix holds constant.
  //
  // The two interop fixtures whose `edited` is true are small — no outer
  // whitespace, nothing long, one section apiece — and they were the only
  // documents carrying that flag whose returned value anything here compared.
  // One other case sends a document with `edited` true through the validator,
  // and the resolution step refuses it on the mismatch with the authenticated
  // copy, so what came back was never looked at. So a rewrite conditioned on the
  // flag had nothing to show: trimming `banner_text` when the document says it
  // was edited left the full gate at exit 0, and so did the same trim written at
  // the resolution step and conditioned on the authenticated copy instead. A
  // matrix at every location closes a transform that applies to every document.
  // It does not close one that waits for a value the matrix never takes.
  //
  // Respelled by spread rather than rebuilt, so the member order is the order
  // the two texts above already have and the only difference anywhere in the
  // pair is that one boolean. Run through the resolution step because that is
  // the one place both are read together, so a single case stands behind both
  // spellings of the transform — the one inside the document validator and the
  // one conditioned on the authenticated copy.
  const editedFidelityDocument = JSON.stringify({ ...JSON.parse(fidelityDocument), edited: true });
  const editedFidelityAad = JSON.stringify({ ...JSON.parse(fidelityAad), edited: true });
  holdFidelityDocument(editedFidelityDocument);
  holdFidelityString('sfv', JSON.parse(editedFidelityAad).sfv);

  cases.push({
    name: 'resolve/every-shape-at-every-location-with-edited-true',
    kind: 'resolve',
    aadText: editedFidelityAad,
    docText: editedFidelityDocument,
    expect: {
      ok: true,
      resultKeys: ['aad', 'doc', 'ok'],
      frozen: false,
      isTheRefusal: false,
      aad: expectedAad(editedFidelityAad),
      doc: expectedDoc(editedFidelityDocument),
    },
  });

  // The largest valid share there is, which is the only thing that closes a
  // transform gated on a length above whatever the longest string in a fixture
  // happens to be. A stored item is bounded at 350 KB; the blob inside it is a
  // 12-byte nonce, the ciphertext, and a 16-byte tag, and AES-GCM's ciphertext
  // is the length of its plaintext — so this is the largest plaintext any share
  // can carry, exactly.
  //
  // Exactly, and not one byte more. The bound on the encoded ciphertext admits
  // one more byte than can be stored, so a fixture built at 358,373 would be a
  // conformance vector for a share that cannot exist; one such fixture has
  // already been removed from this repository on that ground and this is not a
  // second.
  const MAX_STORED_ITEM_BYTES = 350 * 1024;
  const NONCE_BYTES = 12;
  const TAG_BYTES = 16;
  const MAX_PLAINTEXT_BYTES = MAX_STORED_ITEM_BYTES - NONCE_BYTES - TAG_BYTES;

  /**
   * The fidelity document, padded with ASCII to an exact size in bytes.
   *
   * Padded at one line rather than spread about, so the shapes above are carried
   * unchanged and the size is one number in one place. ASCII because a byte of
   * padding has to be a byte: every character added is one byte of UTF-8 and one
   * byte of JSON text, with no escape to account for.
   *
   * @param {number} targetBytes
   * @returns {string}
   */
  const documentOfExactly = (targetBytes) => {
    const doc = JSON.parse(fidelityDocument);
    // The padding is a section of the same kind as every other, rather than a
    // plain one bolted on the end. Every heading and every line in this document
    // is held to the matrix, and a padding section written as bare ASCII is two
    // more locations carrying none of the shapes — which the hold below caught
    // on the first attempt at this. The run of `x` sits inside the string,
    // before its trailing whitespace, so the padding adds length and nothing
    // else.
    const padded = (/** @type {number} */ count) =>
      `${fidelityString('PADDING')}${'x'.repeat(count)}${OUTER_SPACE}`;
    /** @type {{ heading: string, lines: string[] }} */
    const padding = { heading: fidelityString('HEAD-PADDING'), lines: [padded(0)] };
    doc.sections.push(padding);
    const sizeOf = () => new TextEncoder().encode(JSON.stringify(doc)).length;
    const deficit = targetBytes - sizeOf();
    if (deficit < 0) {
      throw new Error(`the fidelity document is already ${-deficit} byte(s) past ${targetBytes}`);
    }
    padding.lines[0] = padded(deficit);
    const text = JSON.stringify(doc);
    const size = new TextEncoder().encode(text).length;
    if (size !== targetBytes) {
      throw new Error(`the padded document is ${size} bytes rather than ${targetBytes}`);
    }
    return text;
  };

  const largestValidShare = documentOfExactly(MAX_PLAINTEXT_BYTES);
  holdFidelityDocument(largestValidShare);

  // Both kinds, because they reach different code. The `document` case is handed
  // the text and is the one that sees a truncation inside `validate.js`; the
  // `decrypt` case is the one that reaches the bound on the encoded ciphertext,
  // which no text handed to a validator ever touches.
  cases.push({
    name: 'document/at-the-largest-valid-share',
    kind: 'document',
    text: largestValidShare,
    expect: docAdmitted(largestValidShare),
  });

  cases.push({
    name: 'decrypt/document-at-the-largest-valid-share',
    kind: 'decrypt',
    a: bytesOf(named.inputs.a),
    id: bytesOf(named.inputs.id),
    response: responseFor(named),
    reseal: {
      k: bytesOf(named.inputs.k),
      nonce: bytesOf(named.inputs.content_nonce),
      text: largestValidShare,
    },
    expect: { ok: true, plaintext: largestValidShare, aad: named.inputs.aad },
  });


  // The container counts, which are what a document carrying every shape at
  // every location still cannot reach. How many locations there are is not a
  // property of any one of them, and two transforms live in exactly that gap:
  // reversing the sections above some count, and dropping a section's last line
  // above some count. The document above closes both at the counts it carries,
  // seven sections and eight lines, and closes nothing above them.
  //
  // So these two are at the counts no valid share can exceed. A section costs at
  // least the twenty-five characters of `{"heading":"","lines":[]}` and a line at
  // least the two of `""`, so the largest plaintext a share can carry holds
  // 13,777 of the first or 119,399 of the second, and the assertion below is what
  // says those are the maxima rather than two numbers somebody liked. Above them
  // there is no document at all, which is what makes this the end of the
  // inequality rather than a bar to be raised again next time.
  //
  // Minimal rather than shaped, deliberately. What these ask is about the count;
  // the shapes are asked at every location by the document above, and giving
  // 13,777 sections a heading apiece would buy nothing and cost the budget the
  // count needs.
  const MOST_SECTIONS = 13777;
  const MOST_LINES_IN_A_SECTION = 119399;

  /**
   * A minimal document of exactly this many sections, carrying this many lines
   * in the first of them, padded with ASCII at the last heading to an exact size.
   *
   * @param {number} sections
   * @param {number} linesInFirst
   * @param {number} targetBytes
   * @returns {string}
   */
  const containersOfExactly = (sections, linesInFirst, targetBytes) => {
    /** @type {{ heading: string, lines: string[] }[]} */
    const built = Array.from({ length: sections }, () => ({ heading: '', lines: [] }));
    const first = built[0];
    const last = built[sections - 1];
    if (first === undefined || last === undefined) {
      throw new Error('a document of no sections cannot carry a container count');
    }
    first.lines = Array.from({ length: linesInFirst }, () => '');
    const doc = {
      schema: 'share_doc_v1',
      banner_key: 'relay_banner_shared_v1',
      banner_text: '',
      you_means: '',
      edited: false,
      visit_date: '',
      topic: '',
      sections: built,
    };
    const deficit = targetBytes - new TextEncoder().encode(JSON.stringify(doc)).length;
    if (deficit < 0) {
      throw new Error(`${sections} section(s) and ${linesInFirst} line(s) are past ${targetBytes} bytes`);
    }
    last.heading = 'x'.repeat(deficit);
    const text = JSON.stringify(doc);
    const size = new TextEncoder().encode(text).length;
    if (size !== targetBytes) {
      throw new Error(`the padded document is ${size} bytes rather than ${targetBytes}`);
    }
    return text;
  };

  const mostSections = containersOfExactly(MOST_SECTIONS, 0, MAX_PLAINTEXT_BYTES);
  const mostLines = containersOfExactly(1, MOST_LINES_IN_A_SECTION, MAX_PLAINTEXT_BYTES);

  // And that one more of either does not fit, which is the half that makes these
  // the maxima. Without it they are two counts larger than the corpus had, and a
  // transform gated above them would be outside the corpus again.
  for (const [what, sections, lines] of /** @type {[string, number, number][]} */ ([
    ['section', MOST_SECTIONS + 1, 0],
    ['line', 1, MOST_LINES_IN_A_SECTION + 1],
  ])) {
    let fitted = true;
    try {
      containersOfExactly(sections, lines, MAX_PLAINTEXT_BYTES);
    } catch {
      fitted = false;
    }
    if (fitted) {
      throw new Error(`one more ${what} still fits, so the count above is not the largest a share can carry`);
    }
  }

  cases.push({
    name: 'document/at-the-most-sections-a-share-can-carry',
    kind: 'document',
    text: mostSections,
    expect: docAdmitted(mostSections),
  });

  cases.push({
    name: 'document/at-the-most-lines-a-section-can-carry',
    kind: 'document',
    text: mostLines,
    expect: docAdmitted(mostLines),
  });

  const duplicateMember = named.inputs.plaintext.replace(
    '"topic":"Example topic"',
    '"topic":"first","topic":"Example topic"',
  );
  cases.push({
    name: 'document/duplicate-member-keeps-the-last',
    kind: 'document',
    text: duplicateMember,
    expect: docAdmitted(duplicateMember),
  });

  /** @type {[string, string][]} */
  const unparseableDocuments = [
    ['not-json', 'not json at all'],
    ['truncated-json', named.inputs.plaintext.slice(0, 40)],
    ['json-null', 'null'],
    ['json-array', '[]'],
    ['json-string', '"share_doc_v1"'],
    ['no-schema-member', docText((doc) => { delete doc['schema']; })],
    ['schema-not-a-string', docText((doc) => { doc['schema'] = 1; })],
  ];
  for (const [name, text] of unparseableDocuments) {
    cases.push({ name: `document/${name}`, kind: 'document', text, expect: DOC_UNPARSED });
  }

  cases.push({
    name: 'document/unknown-schema',
    kind: 'document',
    text: docText((doc) => { doc['schema'] = 'share_doc_v2'; }),
    expect: docRefused('share_doc_v2'),
  });

  /** @type {[string, string][]} */
  const rejectedDocuments = [
    ['unknown-field', docText((doc) => { doc['extra'] = 1; })],
    ['prototype-field', named.inputs.plaintext.replace('{', '{"__proto__":1,')],
    ['missing-topic', docText((doc) => { delete doc['topic']; })],
    ['missing-sections', docText((doc) => { delete doc['sections']; })],
    ['wrong-banner-key', docText((doc) => { doc['banner_key'] = 'relay_banner_shared_v2'; })],
    ['banner-key-not-a-string', docText((doc) => { doc['banner_key'] = 1; })],
    ['banner-text-a-number', docText((doc) => { doc['banner_text'] = 1; })],
    ['banner-text-null', docText((doc) => { doc['banner_text'] = null; })],
    ['you-means-null', docText((doc) => { doc['you_means'] = null; })],
    ['edited-a-string', docText((doc) => { doc['edited'] = 'true'; })],
    ['visit-date-a-number', docText((doc) => { doc['visit_date'] = 20260115; })],
    ['topic-an-array', docText((doc) => { doc['topic'] = ['Example topic']; })],
    ['sections-an-object', docText((doc) => { doc['sections'] = { heading: 'x', lines: [] }; })],
    ['sections-a-string', docText((doc) => { doc['sections'] = 'none'; })],
    ['sections-null', docText((doc) => { doc['sections'] = null; })],
    ['section-not-an-object', docText((doc) => { doc['sections'] = ['Example heading']; })],
    ['section-null', docText((doc) => { doc['sections'] = [null]; })],
    ['section-an-array', docText((doc) => { doc['sections'] = [[]]; })],
    ['section-unknown-field', docText((doc) => { doc['sections'][0]['extra'] = 1; })],
    ['section-missing-lines', docText((doc) => { delete doc['sections'][0]['lines']; })],
    ['section-missing-heading', docText((doc) => { delete doc['sections'][0]['heading']; })],
    ['section-heading-a-number', docText((doc) => { doc['sections'][0]['heading'] = 1; })],
    ['section-lines-a-string', docText((doc) => { doc['sections'][0]['lines'] = 'one line'; })],
    ['section-lines-an-object', docText((doc) => { doc['sections'][0]['lines'] = { 0: 'one line' }; })],
    // An array-like carrying a `length`, which is the shape that made
    // `Array.isArray` deletable. Every other object offered as an array here is
    // refused by the length descriptor being absent, so the brand check never
    // had to do any work: these two carry one, their own property set is exactly
    // the indices plus `length`, every element is an own enumerable value, and
    // without the brand check they are admitted as sections and as lines. A
    // document that validated out of one of them would be a document assembled
    // from something that was never an array.
    [
      'section-lines-an-array-like-carrying-a-length',
      docText((doc) => { doc['sections'][0]['lines'] = { 0: 'Example line one.', length: 1 }; }),
    ],
    [
      'sections-an-array-like-carrying-a-length',
      docText((doc) => { doc['sections'] = { 0: { heading: 'Example heading', lines: [] }, length: 1 }; }),
    ],
    ['line-a-number', docText((doc) => { doc['sections'][0]['lines'][0] = 1; })],
    ['line-null', docText((doc) => { doc['sections'][0]['lines'][0] = null; })],
    ['line-an-array', docText((doc) => { doc['sections'][0]['lines'][0] = ['Example line one.']; })],
    ['second-section-invalid', docText((doc) => { doc['sections'][1]['lines'][0] = 1; })],
  ];
  for (const [name, text] of rejectedDocuments) {
    cases.push({ name: `document/${name}`, kind: 'document', text, expect: docRefused() });
  }

  /** @type {[string, { kind: string, field?: string, where?: string }][]} */
  const tamperedDocuments = [
    ['field-inherited', { kind: 'inherit', field: 'topic' }],
    ['schema-inherited', { kind: 'inherit', field: 'schema' }],
    ['sections-inherited', { kind: 'inherit', field: 'sections' }],
    ['extra-field-not-enumerable', { kind: 'hide' }],
    ['extra-field-under-a-symbol', { kind: 'symbol' }],
    ['field-is-a-getter', { kind: 'getter', field: 'banner_text' }],
    ['field-is-a-quiet-accessor', { kind: 'quiet-getter', field: 'banner_text' }],
    ['field-not-enumerable', { kind: 'not-enumerable', field: 'topic' }],
    ['section-field-inherited', { kind: 'inherit', field: 'lines', where: 'section' }],
    ['section-extra-field-not-enumerable', { kind: 'hide', where: 'section' }],
    ['section-extra-field-under-a-symbol', { kind: 'symbol', where: 'section' }],
    ['section-field-is-a-getter', { kind: 'getter', field: 'heading', where: 'section' }],
    ['section-field-is-a-quiet-accessor', { kind: 'quiet-getter', field: 'heading', where: 'section' }],
    ['section-field-not-enumerable', { kind: 'not-enumerable', field: 'heading', where: 'section' }],
    ['a-revoked-proxy', { kind: 'revoked' }],
    ['cannot-be-enumerated', { kind: 'own-keys-throws' }],
    ['descriptors-cannot-be-read', { kind: 'descriptor-throws' }],
    ['section-is-a-revoked-proxy', { kind: 'revoked', where: 'section' }],
    ['section-cannot-be-enumerated', { kind: 'own-keys-throws', where: 'section' }],
    ['lists-fewer-properties-than-it-has', { kind: 'own-keys-under-reports' }],
    ['section-lists-fewer-properties-than-it-has', { kind: 'own-keys-under-reports', where: 'section' }],
  ];
  for (const [name, tamper] of tamperedDocuments) {
    cases.push({
      name: `document/${name}`,
      kind: 'document',
      text: named.inputs.plaintext,
      tamper,
      expect: docRefused(),
    });
  }

  // The same questions, put to the two arrays. `Array.isArray` was the whole of
  // what an array had to satisfy, so an array carrying an unexpected property, a
  // symbol-keyed one or a hidden one all validated — and an element that was not
  // an own enumerable value was reached by index, which runs a getter and reads
  // through a prototype.
  /** @type {[string, string][]} */
  const arrayTampers = [
    ['carries-an-extra-property', 'extra'],
    ['carries-a-property-hidden-from-enumeration', 'hide'],
    ['carries-a-property-under-a-symbol', 'symbol'],
    ['first-element-is-a-getter', 'getter'],
    ['first-element-is-a-quiet-accessor', 'quiet-getter'],
    ['first-element-not-enumerable', 'not-enumerable'],
    ['first-element-inherited', 'inherit'],
    // The array reader is guarded for the same reasons the record reader is, and
    // its guard covers `Array.isArray` as well: that call is inside the `try`
    // here, because there is no predicate in front of it to hold one of its own.
    ['is-a-revoked-proxy', 'revoked'],
    ['cannot-be-enumerated', 'own-keys-throws'],
    ['descriptors-cannot-be-read', 'descriptor-throws'],
    // The other side of the count, as for the record reader: every shape above
    // makes the own property set too large, so a comparison written as "not more
    // than one name per element plus `length`" refuses all of them and admits an
    // array whose listing is short of what it holds. Its elements are all still
    // there and all still readable, so nothing but the exact count refuses it.
    ['lists-fewer-properties-than-it-has', 'own-keys-under-reports'],
  ];
  for (const where of ['sections', 'lines']) {
    for (const [name, kind] of arrayTampers) {
      cases.push({
        name: `document/${where}-${name}`,
        kind: 'document',
        text: named.inputs.plaintext,
        tamper: { kind, where },
        expect: docRefused(),
      });
    }
  }

  // And the one that is not a refusal. This array answers zero when its length
  // is read and carries every element when its own properties are looked at;
  // reading the length as a property produced a document that validated with no
  // sections at all, which is the worst answer available — a successful document
  // that is not the document. Read by descriptor, the `get` trap never runs and
  // what comes back is what is there.
  cases.push({
    name: 'document/sections-report-a-shorter-length-when-read',
    kind: 'document',
    text: named.inputs.plaintext,
    tamper: { kind: 'shrinking-length', where: 'sections' },
    expect: docAdmitted(named.inputs.plaintext),
  });

  cases.push({
    name: 'document/lines-report-a-shorter-length-when-read',
    kind: 'document',
    text: named.inputs.plaintext,
    tamper: { kind: 'shrinking-length', where: 'lines' },
    expect: docAdmitted(named.inputs.plaintext),
  });

  // The shape both readers admit, written down as a case because a residual
  // nothing exercises is a residual nobody has seen. Exactness is a comparison
  // against a count, and a count is taken from what a value lists as its own
  // properties — so a value that lists one name fewer than it carries, where the
  // name it leaves out is an unexpected one, matches the count with a property
  // the reader was never told about. Every named field still reads, so nothing
  // else here refuses it.
  //
  // Admitted rather than refused, and that is the honest answer rather than a
  // gap left open: nothing available to a script tells a value that lies
  // consistently from the value it is pretending to be, and no value in the
  // shipped flow can be one — every one of them comes from `JSON.parse`, in one
  // realm, and both validators rebuild fresh literals from what they read. What
  // these two cases hold is that the readers behave the way their contracts now
  // say they do, so a contract quietly widened back to claiming more than that
  // has a case beside it that is about the claim.
  cases.push({
    name: 'document/lists-fewer-properties-than-it-has-hiding-an-extra',
    kind: 'document',
    text: named.inputs.plaintext,
    tamper: { kind: 'own-keys-hides-an-extra' },
    expect: docAdmitted(named.inputs.plaintext, expectedDoc(named.inputs.plaintext)),
  });

  cases.push({
    name: 'document/sections-list-fewer-properties-than-they-have-hiding-an-extra',
    kind: 'document',
    text: named.inputs.plaintext,
    tamper: { kind: 'own-keys-hides-an-extra', where: 'sections' },
    expect: docAdmitted(named.inputs.plaintext, expectedDoc(named.inputs.plaintext)),
  });

  cases.push({
    name: 'document/empty-sections',
    kind: 'document',
    text: wide.inputs.plaintext,
    expect: docAdmitted(wide.inputs.plaintext),
  });

  // ---- The two together ------------------------------------------------

  /** @type {[string, string, string][]} */
  const acceptedResolutions = [
    ['agreeing-unedited', named.inputs.aad, named.inputs.plaintext],
    ['agreeing-edited', edited.inputs.aad, edited.inputs.plaintext],
  ];
  for (const [name, aadInput, docInput] of acceptedResolutions) {
    cases.push({
      name: `resolve/${name}`,
      kind: 'resolve',
      aadText: aadInput,
      docText: docInput,
      expect: {
        ok: true,
        resultKeys: ['aad', 'doc', 'ok'],
        frozen: false,
        isTheRefusal: false,
        aad: expectedAad(aadInput),
        doc: expectedDoc(docInput),
      },
    });
  }

  /** @type {[string, string, string][]} */
  const rejectedResolutions = [
    ['document-claims-edited-aad-does-not', named.inputs.aad, docText((doc) => { doc['edited'] = true; })],
    ['aad-says-edited-document-does-not', edited.inputs.aad, named.inputs.plaintext],
    ['invalid-aad-valid-document', aadText((aad) => { aad['extra'] = 1; }), named.inputs.plaintext],
    ['valid-aad-invalid-document', named.inputs.aad, docText((doc) => { doc['extra'] = 1; })],
    ['unparseable-document', named.inputs.aad, 'not json at all'],
    ['unparseable-aad', '{', named.inputs.plaintext],
  ];
  for (const [name, aadInput, docInput] of rejectedResolutions) {
    cases.push({
      name: `resolve/${name}`,
      kind: 'resolve',
      aadText: aadInput,
      docText: docInput,
      expect: RESOLVE_REFUSED,
    });
  }

  // The step that reads both, handed a value that throws when it is looked at.
  // It reads nothing itself — it calls two validators and compares one field of
  // each answer — so what these ask is that the totality of those two is the
  // totality of this.
  /** @type {[string, { kind: string } | undefined, { kind: string } | undefined][]} */
  const hostileResolutions = [
    ['hostile-aad-revoked-proxy', { kind: 'revoked' }, undefined],
    ['hostile-aad-descriptors-cannot-be-read', { kind: 'descriptor-throws' }, undefined],
    ['hostile-document-revoked-proxy', undefined, { kind: 'revoked' }],
    ['hostile-document-cannot-be-enumerated', undefined, { kind: 'own-keys-throws' }],
  ];
  for (const [name, aadTamper, tamper] of hostileResolutions) {
    cases.push({
      name: `resolve/${name}`,
      kind: 'resolve',
      aadText: named.inputs.aad,
      docText: named.inputs.plaintext,
      aadTamper,
      tamper,
      expect: RESOLVE_REFUSED,
    });
  }

  // ---- Routing ---------------------------------------------------------

  // The dispatch table is a Map rather than an object literal so that a version
  // named after an inherited property does not resolve to one. An object literal
  // would answer `toString` and `constructor` with functions that clear nothing,
  // and `__proto__` with an object that is not a function at all — so the clear
  // count catches that on its own.
  //
  // What the clear count could not catch was the table being empty, because the
  // refusal path clears the root exactly as the handler does, and the roots
  // these cases use are not this viewer's page, so what is drawn after the clear
  // is nothing either way. `aadInspected` is what tells them apart: it says
  // whether anything looked at the authenticated data, which happens when a
  // handler ran and validated it and at no other point. With an empty table
  // every one of these reports false.
  /** @type {[string, unknown, boolean][]} */
  const routedVersions = [
    ['known-version', 'share_doc_v1', true],
    ['unknown-version', 'share_doc_v2', false],
    ['empty-version', '', false],
    ['inherited-toString', 'toString', false],
    ['inherited-valueOf', 'valueOf', false],
    ['inherited-constructor', 'constructor', false],
    ['inherited-hasOwnProperty', 'hasOwnProperty', false],
    ['inherited-proto', '__proto__', false],
    ['version-a-number', 1, false],
    ['version-null', null, false],
    ['version-an-object', {}, false],
    ['version-an-array', [], false],
  ];
  for (const [name, docVersion, aadInspected] of routedVersions) {
    cases.push({
      name: `dispatch/${name}`,
      kind: 'dispatch',
      root: 'element',
      docVersion,
      aadProbe: true,
      aadText: named.inputs.aad,
      docText: named.inputs.plaintext,
      expect: dispatchExpectation('element', aadInspected),
    });
  }

  cases.push({
    name: 'dispatch/known-version-refused-document',
    kind: 'dispatch',
    root: 'element',
    docVersion: 'share_doc_v1',
    aadProbe: true,
    aadText: named.inputs.aad,
    docText: docText((doc) => { doc['extra'] = 1; }),
    expect: dispatchExpectation('element', true),
  });

  // Neither of the two values routing is handed can make this throw, including
  // when looking at one is what throws. The document reaches a validator and the
  // authenticated data reaches another, and both of those are total; what these
  // add is that routing itself does not read either on the way past.
  /** @type {[string, { kind: string } | undefined, { kind: string } | undefined][]} */
  const hostileDispatches = [
    ['hostile-aad-revoked-proxy', { kind: 'revoked' }, undefined],
    ['hostile-aad-cannot-be-enumerated', { kind: 'own-keys-throws' }, undefined],
    ['hostile-document-revoked-proxy', undefined, { kind: 'revoked' }],
    ['hostile-document-descriptors-cannot-be-read', undefined, { kind: 'descriptor-throws' }],
  ];
  for (const [name, aadTamper, tamper] of hostileDispatches) {
    cases.push({
      name: `dispatch/${name}`,
      kind: 'dispatch',
      root: 'element',
      docVersion: 'share_doc_v1',
      aadTamper,
      tamper,
      aadText: named.inputs.aad,
      docText: named.inputs.plaintext,
      expect: dispatchExpectation('element', false),
    });
  }

  // A root that cannot be written into is a refusal, not an exception. `cleared`
  // counts writes that returned and `attempted` counts writes that were tried,
  // so a root whose write throws is not reported as identical to a root with no
  // write at all — the first was written to and refused, the second was never
  // touched. `remaining` is the third of those, and the only one that is about
  // the root rather than the call: `method-ignores` answers the write, returns
  // from it, and is still holding both its children afterwards.
  for (const root of UNCLEARABLE_ROOTS) {
    cases.push({
      name: `dispatch/root-${root}`,
      kind: 'dispatch',
      root,
      docVersion: 'share_doc_v1',
      aadProbe: true,
      aadText: named.inputs.aad,
      docText: named.inputs.plaintext,
      expect: dispatchExpectation(root, true),
    });
  }

  // Both render functions, against every root shape there is. The clearable ones
  // are where a write beyond the clear would land — a root that refuses the
  // clear is a root neither function draws on at all — so they are the cases
  // that carry the root's own property set as an expectation.
  for (const root of ROOT_SHAPES) {
    cases.push({
      name: `render/unavailable-root-${root}`,
      kind: 'render',
      render: 'unavailable',
      root,
      expect: renderExpectation(root),
    });
    cases.push({
      name: `render/share-doc-root-${root}`,
      kind: 'render',
      render: 'doc',
      root,
      aadText: named.inputs.aad,
      docText: named.inputs.plaintext,
      expect: renderExpectation(root),
    });
  }

  // What the clear answers, asked directly, because both render functions branch
  // on it and nothing they do afterwards can show it here: the roots below are
  // not this viewer's page, so the surface drawn after a successful clear is
  // nothing. A clear that reported nothing let both of them carry on as though
  // the root were empty — and on the unavailable path that meant the viewer
  // believing it had replaced a decrypted note with the generic surface while
  // the note was still on the page.
  //
  // The answer is reported beside the root's own state, which is what makes it
  // an answer about the root rather than about the call. `method-ignores` is the
  // pair that separates them: two children before, a write that returns, two
  // children after, and the only correct answer is that the root is not empty.
  // `method-needs-receiver` is the other pair: a write that only works when it
  // is called on the root, so the step that hands it the root is a step with an
  // answer rather than one nothing could tell from its absence.
  for (const root of ROOT_SHAPES) {
    cases.push({
      name: `clear/root-${root}`,
      kind: 'clear',
      root,
      expect: clearExpectation(root),
    });
  }

  // ---- The corpus's own instruments -------------------------------------

  // Every other case here says what the viewer did. These say what the things
  // the viewer is confronted with are, and they are here because an instrument
  // that has quietly stopped being one takes a whole family of cases with it
  // while every one of them stays green.
  //
  // Two of the three are values, and the third is a double. A value whose
  // `length` accessor answers instead of throwing turns every case built on it
  // into an ordinary wrong type — refused, for a reason that says nothing about
  // the order two questions were asked in. A typed array of another kind that
  // did not carry exactly the byte count key material carries would be refused
  // by the count rather than by the brand. And a double that no longer minds
  // being called without its root cannot tell the step that supplies the root
  // from its absence.
  //
  // The allocation counter is the same kind of thing and is held the same way,
  // by the counts the successful paths carry; there is nothing to add here for
  // it.
  /** @type {[string, string, string][]} */
  const instruments = [
    ['a-length-that-cannot-be-read-throws-when-it-is-read', 'a-length-that-cannot-be-read', 'threw'],
    [
      'a-write-that-needs-its-root-refuses-a-bare-call',
      'a-bare-call-of-a-write-that-needs-its-root',
      'threw',
    ],
    ['a-write-that-needs-its-root-answers-a-call-on-its-root', 'a-call-of-that-write-on-its-root', 'answered'],
  ];
  for (const [name, call, answer] of instruments) {
    cases.push({ name: `instrument/${name}`, kind: 'instrument', call, expect: { answer } });
  }

  /** @type {[string, { kind: string, carries?: number, claims?: number, how?: string }, number, number][]} */
  const measuredInstruments = [
    ['a-signed-typed-array-carries-what-a-link-capability-carries', { kind: 'another-typed-array', carries: 32, how: 'signed' }, 32, 32],
    ['a-wider-typed-array-carries-what-a-link-capability-carries', { kind: 'another-typed-array', carries: 16, how: 'wider' }, 16, 32],
    ['a-clamped-typed-array-carries-what-a-stored-key-carries', { kind: 'another-typed-array', carries: 32, how: 'clamped' }, 32, 32],
    ['a-length-that-lies-claims-more-than-it-carries', { kind: 'length-lies', carries: 31, claims: 32, how: 'own-property' }, 32, 31],
    ['a-length-that-lies-by-subclass-claims-more-than-it-carries', { kind: 'length-lies', carries: 15, claims: 16, how: 'subclass' }, 16, 15],
  ];
  for (const [name, hostile, claims, carries] of measuredInstruments) {
    cases.push({ name: `instrument/${name}`, kind: 'instrument', hostile, expect: { claims, carries } });
  }

  // Strings that must not turn up in anything the corpus reports, other than
  // where the accessor deliberately hands them over.
  //
  // Every one of them is scanned for in several spellings, because the failure
  // this scan exists to catch is key material appearing somewhere it was not
  // meant to, and the spelling it appears in is chosen by whatever put it there
  // rather than by this file. A `Uint8Array` becomes a comma-separated list of
  // decimals when it is turned into a string, an object of index keys when it is
  // serialised, and a different alphabet again if anything re-encodes it — so
  // every watched value is looked for in all of them.
  //
  // What is watched is every value that must not leak, which now includes the
  // stored key. It was absent, and it is half the key split: a viewer that put
  // it in an error, a log line or a payload would have been reporting the half
  // of the split the server already holds — which is exactly the half that turns
  // a stolen link into a readable note.
  /** @type {Set<string>} */
  const probeSet = new Set();
  /** @type {Set<string>} */
  const secretSet = new Set();

  /** @param {string} base64url */
  const probeFor = (base64url) => {
    const bytes = decode(base64url);
    const standard = Buffer.from(bytes).toString('base64');
    secretSet.add(base64url);
    probeSet.add(base64url);
    probeSet.add(standard);
    probeSet.add(standard.replace(/=+$/, ''));
    probeSet.add(Buffer.from(bytes).toString('hex'));
    probeSet.add(Buffer.from(bytes).toString('hex').toUpperCase());
    probeSet.add(Array.from(bytes).join(','));
    probeSet.add(JSON.stringify(Array.from(bytes)));
    probeSet.add(JSON.stringify(new Uint8Array(bytes)));
  };

  for (const fixture of fixtures) {
    probeFor(fixture.inputs.a);
    probeFor(fixture.inputs.b);
    probeFor(fixture.inputs.k);
    probeFor(fixture.derived.kek);
  }
  for (const derivation of derivations) {
    probeFor(derivation.inputs.a);
    probeFor(derivation.inputs.b);
    probeFor(derivation.derived.kek);
    probeFor(derivation.probe.k);
  }

  return { cases, probes: [...probeSet], secrets: secretSet.size };
}
