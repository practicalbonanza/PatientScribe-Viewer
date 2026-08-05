/**
 * The corpus driver.
 *
 * One function, run in three places: the node fast path, and both browser
 * engines. It imports the viewer's own modules — the served files, unmodified,
 * never a copy — runs each case, and reports what it saw. It decides nothing,
 * and it is not told anything: the expectations stay in the host and are
 * stripped out of the payload before it crosses into the page, so what arrives
 * here is inputs and nothing else.
 *
 * That last part was the hole, and it was total. Cases used to travel with their
 * expectations attached, which meant a driver could satisfy the entire corpus
 * without importing a single viewer module — `payload.cases.map((item) => ({
 * name: item.name, observed: { ...item.expect } }))` passed all of it, in both
 * engines. Every green result in this suite, including the ones saying the
 * viewer is correct, was worth exactly as much as the assumption that this file
 * was doing what it says. It is not an assumption any more: there is nothing in
 * the payload to echo.
 *
 * What the split does and does not buy, now that it buys something. The
 * comparison runs where this file cannot reach it, so nothing here can make a
 * failing comparison pass, and nothing here knows what a passing one would look
 * like. It can still make a case pass for the wrong reason, by observing the
 * wrong thing or too little of it — a driver that reported `{ ok: false }` and
 * nothing else would satisfy every refusing case in the corpus while proving
 * almost nothing. Two things push against that: every branch below reports the
 * whole result rather than a summary of it, and the host rejects an observation
 * carrying any field the case did not name, so a field added here has to be
 * accounted for by every case that reaches it.
 *
 * It must stay self-contained. The browser suite hands this function to the page
 * as source text, so it may not reference anything outside its own body — no
 * import at the top of this file, no helper defined beside it, no closure over a
 * module local. Everything it needs is either declared inside it or arrives in
 * the payload. It also may not depend on the strictness of the code around it:
 * the page evaluates it as a plain function, where a refused write fails
 * silently rather than loudly, so every write this file attempts on purpose is
 * judged by whether the property is there afterwards and never by whether the
 * attempt threw.
 *
 * A refusal is reported as its shape and its identity, and a success as the
 * values it carries, because a driver that reported only `ok` would pass a
 * refusal that had grown a reason and a success that had altered what it
 * returned.
 *
 * The case as this file sees it: the inputs, and no expectation. The corpus
 * holds an expectation against every one of these, and `observableCases` in
 * `cases.mjs` is what keeps it on the host side of the boundary.
 *
 * @typedef {object} Case
 * @property {string} name
 * @property {string} kind
 * @property {unknown} [text] Usually the input as text, and deliberately not
 *   typed as a string: every exported function in the viewer takes whatever it
 *   is given, so the corpus has to be able to give it something else.
 * @property {string} [aadText]
 * @property {string} [docText]
 * @property {number[]} [a]
 * @property {number[]} [b]
 * @property {number[]} [id]
 * @property {string} [wrapped]
 * @property {string} [ciphertext]
 * @property {unknown} [response] A stored response, passed to the viewer exactly
 *   as written — including when it is not an object at all.
 * @property {Record<string, unknown>} [responseParts] A stored response with one
 *   field too large to write into the corpus, built by `synth` instead.
 * @property {{ field: string, char: string, length: number }} [synth]
 * @property {{ field: string, from: string, codeUnits: number[] }} [synthCodeUnit]
 *   A stored response with one character of one field respelled as bare UTF-16
 *   code units. Built here rather than written into the corpus because an
 *   unpaired surrogate does not survive the journey into the page as text, and
 *   a list rather than one unit because the boundaries of the surrogate range
 *   are only asked about by pairs as well as by singles.
 * @property {unknown} [docVersion] The version handed to `dispatchDoc`, which is
 *   whatever a document declared and so not necessarily a string.
 * @property {boolean} [aadProbe] Hands `dispatchDoc` an AAD that records whether
 *   anything looked at it, which is how a routing case tells "the handler for
 *   this version ran" from "something cleared the root".
 * @property {string} [root] Which root shape a render, dispatch or clear case
 *   uses.
 * @property {string} [render] Which render function a render case calls.
 * @property {string} [call] Which crypto function a guard case calls.
 * @property {string} [slot] Which of that function's arguments the hostile value
 *   replaces. Named for every guard case, including the ones with a single
 *   candidate, so that an argument added to one of these functions is a case the
 *   driver refuses rather than a case that quietly stopped naming its target.
 * @property {{ kind: string, carries?: number, claims?: number, how?: string }} [hostile]
 *   A value that cannot travel in the corpus: a proxy whose prototype cannot be
 *   read, a typed array whose `length` property disagrees with the bytes it
 *   holds, a typed array that is not the kind key material is, or a value whose
 *   `length` accessor throws.
 * @property {unknown} [record] The value a `fields` case hands to
 *   `readOwnFields`.
 * @property {unknown} [names] The name list a `fields` case asks for, which may
 *   deliberately repeat a name — or not be a list at all, which is the shape a
 *   string satisfied every step of that reader without being one.
 * @property {string} [namesKind] The name list a `fields` case cannot write
 *   down: a list whose own `indexOf` disagrees with its indices, which is the
 *   only shape that tells the duplicate rule from a comparison one token looser.
 * @property {boolean} [predicate] Asks a `fields` case's value of `isRecord`
 *   rather than of `readOwnFields`. The predicate is the step every allowlist in
 *   the viewer reaches through and the only one nothing reached directly, so a
 *   widening of it changed no answer any other case could see.
 * @property {unknown} [characters] The input length a `sizing` case asks about.
 *   Not typed as a number, because the question is what the sizing step does
 *   with anything at all.
 * @property {string} [characterKind] The two values a `sizing` case cannot write
 *   down. A `BigInt` and a `Symbol` are the inputs multiplication throws on, and
 *   neither survives the journey into the page as JSON.
 * @property {string} [wrap] Hands the viewer something the corpus cannot write
 *   down in place of the case's `text`: a value that is not a string but would
 *   become one if anything coerced it, or one whose `length` accessor throws.
 * @property {{ kind: string, field?: string, where?: string }} [tamper] A value
 *   rebuilt in a shape no JSON text can express: a field moved onto the
 *   prototype, an extra property hidden from enumeration or held under a symbol,
 *   a named field replaced by a getter or by a non-enumerable property, a named
 *   field holding a value whose length cannot be read, an array carrying
 *   something that is not an element, an array that answers a different length
 *   depending on how it is asked, or a value that throws when it is looked at.
 *   Built here because the corpus travels as JSON and JSON has no way to say any
 *   of it.
 * @property {{ kind: string, field?: string }} [aadTamper] The same, aimed at
 *   the authenticated data rather than at the document, for the two kinds that
 *   are handed both.
 * @property {{ k: number[], nonce: number[], text?: string, bytes?: number[] }} [reseal] A
 *   ciphertext the corpus cannot carry, because it does not exist until it is
 *   made: this fixture's own document, spelled the way the case wants it,
 *   sealed here under the fixture's own content key and nonce over the
 *   authenticated data the case's response carries. The published vectors are
 *   the shares the generator emitted, and there are questions about what comes
 *   back out of a decryption that no published share can ask — what a document
 *   sealed with a leading byte-order mark decodes to, and what happens at the
 *   exact length the bound on the authenticated data admits. Sealing is not
 *   asserting: what the case asserts is still what the viewer returned, read
 *   against the string that went in.
 *
 *   `text` seals a string, `bytes` seals bytes, and the second is not a
 *   convenience spelling of the first. A plaintext sealed from a string is
 *   well-formed UTF-8 by construction, so no case written that way can ask what
 *   the decoder does with a sequence of bytes that is not — and what it does is
 *   the difference between refusing such a document and handing back a repaired
 *   copy of it with replacement characters standing in for the bytes. A case
 *   names one or the other.
 *
 * @typedef {object} Observed
 * @property {string} name
 * @property {Record<string, unknown>} observed
 */

/**
 * Run every case and report what happened.
 *
 * @param {{ moduleBase: string, cases: Case[] }} payload The base every viewer
 *   module is imported from — a served URL in the browser, a file URL in node —
 *   and the corpus.
 * @returns {Promise<Observed[]>}
 */
export async function observeCases(payload) {
  const parse = await import(`${payload.moduleBase}parse.js`);
  const cryptoCore = await import(`${payload.moduleBase}crypto.js`);
  const validate = await import(`${payload.moduleBase}validate.js`);
  const dispatch = await import(`${payload.moduleBase}dispatch.js`);
  const render = await import(`${payload.moduleBase}render.js`);

  /**
   * @param {unknown} value
   * @returns {number[] | null}
   */
  const asNumbers = (value) => (value === null || value === undefined ? null : Array.from(/** @type {Uint8Array} */ (value)));

  /**
   * What a key object is, reported rather than assumed.
   *
   * A key this viewer derives must be non-extractable, must be able to do
   * exactly the one thing it was derived for, and must be the algorithm it was
   * asked for. None of those show up in whether a decryption succeeded, so all
   * three are reported and pinned: an extractable key decrypts exactly as well
   * as a non-extractable one, and the difference is the whole of the design.
   *
   * @param {any} key
   * @returns {Record<string, unknown> | null}
   */
  const keyShape = (key) => {
    if (key === null || key === undefined) {
      return null;
    }
    const algorithm = /** @type {any} */ (key.algorithm);
    return {
      extractable: key.extractable,
      usages: Array.from(key.usages).sort(),
      algorithm: { name: algorithm.name, length: algorithm.length },
    };
  };

  /**
   * Try to hang a property off a value, and report whether it is there
   * afterwards rather than whether the attempt threw.
   *
   * @param {any} target
   * @param {string} name
   * @returns {string}
   */
  const tryAttach = (target, name) => {
    try {
      target[name] = () => 'attached';
    } catch {
      // A frozen target refuses loudly here and silently in a page. Neither
      // answer is the observation; what is on the object afterwards is.
    }
    return Object.prototype.hasOwnProperty.call(target, name) ? 'attached' : 'refused';
  };

  /**
   * Try to define a property, which reports its own failure in every mode.
   *
   * @param {any} target
   * @param {string} name
   * @param {unknown} value
   * @returns {string}
   */
  const tryDefine = (target, name, value) => {
    try {
      Object.defineProperty(target, name, { value, configurable: true });
    } catch {
      return 'refused';
    }
    return 'defined';
  };

  /**
   * The root shapes a render, dispatch or clear case can be given, with real
   * child state and counters rather than one.
   *
   * `attempted` counts entries into the one DOM write the viewer makes;
   * `completed` counts the ones that returned. The pair is what tells a root
   * that was never written to apart from a root that was written to and refused
   * — which the single counter could not, so a root whose write throws and a
   * root with no write at all reported the same thing.
   *
   * `remaining` is the third, and it is about the root rather than about the
   * call: how many children it is still holding afterwards. The doubles used to
   * have none, which made "the write returned" and "the root is empty" the same
   * observation and left the difference between them unaskable — so a clear that
   * reported success for a root that had answered the call and kept everything
   * on it passed every case here. `method-ignores` is that root, and it is only
   * distinguishable because these doubles now hold something to lose.
   *
   * `ownNames` and `writeArguments` are about what else was done to the root, and
   * they exist because the three counters above could not see any of it. The
   * scaffold's render functions draw nothing after clearing, so a line writing
   * text onto the root — a safe write, permitted by every sink rule there is —
   * changed no counter, no child count and no outcome, and passed the whole
   * corpus in both engines. What the root is carrying afterwards is the
   * observation that catches it: a property written onto the double is an own
   * property of the double, and a clear handed something to put back is a clear
   * with an argument.
   *
   * @param {string | undefined} tag
   * @returns {{ root: unknown, known: boolean, attempted: () => number, completed: () => number, remaining: () => number | null, ownNames: () => string[] | null, writeArguments: () => number }}
   */
  const rootFor = (tag) => {
    let attempted = 0;
    let completed = 0;
    let writeArguments = 0;
    /** @type {string[] | null} */
    let held = null;

    /**
     * A node-shaped double: children it really holds, and a `firstChild` that
     * answers out of them the way a node's does.
     *
     * `needs-receiver` is the one that is fussy about how it is called. Every
     * other double here answers the same whether the write is invoked as a
     * method of the root or as a bare function, so the step that supplies the
     * receiver was doing nothing any case could see — and dropping it is one
     * word. This double refuses a call that arrives without its root, which is
     * what a real node's method does.
     *
     * @param {string} behaviour
     * @returns {object}
     */
    const node = (behaviour) => {
      held = ['one', 'two'];
      /** @type {Record<string, unknown>} */
      const target = {
        get firstChild() {
          const children = held ?? [];
          return children.length === 0 ? null : children[0];
        },
        /** @param {unknown[]} args */
        replaceChildren(...args) {
          attempted += 1;
          writeArguments += args.length;
          if (behaviour === 'needs-receiver' && this !== target) {
            throw new TypeError('replaceChildren was called without its receiver');
          }
          if (behaviour === 'throws') {
            throw new Error('cannot clear');
          }
          if (behaviour !== 'ignores') {
            held = [];
          }
          completed += 1;
        },
      };
      return target;
    };

    /**
     * A double with a write and nothing to read back from.
     *
     * The emptiness test asks the root what its first child is and compares the
     * answer against `null`, which is what a node with no children answers.
     * Something with no such property answers `undefined`, and the difference
     * between those two is one character in that comparison — so a root that
     * cannot say whether it is empty was, with the comparison loosened, a root
     * reported as empty.
     *
     * @returns {object}
     */
    const writeOnly = () => ({
      /** @param {unknown[]} args */
      replaceChildren(...args) {
        attempted += 1;
        writeArguments += args.length;
        completed += 1;
      },
    });

    /** @type {Record<string, () => unknown>} */
    const shapes = {
      element: () => node('empties'),
      // Answers the call, returns, and keeps its children.
      'method-ignores': () => node('ignores'),
      'method-throws': () => node('throws'),
      // Empties, but only when the write is called on it rather than on nothing.
      'method-needs-receiver': () => node('needs-receiver'),
      // A node that has already been written to once, with one child, before the
      // viewer ever sees it. Nothing the viewer does passes an argument to the
      // write, so the count of arguments it passes is zero in every other case
      // here and would be zero as readily from a counter that had stopped
      // counting. This is the case that says it has not: the number it reports is
      // one, and it is one because something really did hand the write a child.
      'already-written-to': () => {
        const target = /** @type {{ replaceChildren: (...args: unknown[]) => void }} */ (node('empties'));
        target.replaceChildren('a child this root was handed');
        return target;
      },
      'method-without-firstChild': () => writeOnly(),
      'method-not-callable': () => ({ replaceChildren: 1 }),
      // A node-shaped double whose write is not callable and would work if it
      // were reached anyway: an object carrying its own `call`. A number's
      // `.call` throws and the throw is caught, so `method-not-callable` above
      // is refused whether the callable test runs or not. This one is refused
      // only by that test — reached past it, its `call` empties the root and the
      // clear reports a success.
      'method-is-an-object-with-call': () => {
        held = ['one', 'two'];
        /** @type {Record<string, unknown>} */
        const target = {
          get firstChild() {
            const children = held ?? [];
            return children.length === 0 ? null : children[0];
          },
          replaceChildren: {
            /**
             * @param {unknown} _receiver
             * @param {unknown[]} args
             */
            call(_receiver, ...args) {
              attempted += 1;
              writeArguments += args.length;
              held = [];
              completed += 1;
            },
          },
        };
        return target;
      },
      // A root that is callable and carries a write that works. The type gate in
      // front of the clear names `'object'`, and nothing else in this list is a
      // function — so every root that gate refuses is refused a step later for
      // having no write at all, and widening it to admit callables changed no
      // answer any case could report. This is the one root where that gate is
      // the only thing standing between the viewer and a DOM write.
      'callable-with-a-write': () => {
        held = ['one', 'two'];
        const carrier = () => undefined;
        Object.defineProperty(carrier, 'firstChild', {
          get() {
            const children = held ?? [];
            return children.length === 0 ? null : children[0];
          },
          configurable: true,
        });
        Object.defineProperty(carrier, 'replaceChildren', {
          /** @param {unknown[]} args */
          value: (...args) => {
            attempted += 1;
            writeArguments += args.length;
            held = [];
            completed += 1;
          },
          configurable: true,
        });
        return carrier;
      },
      'no-method': () => ({}),
      null: () => null,
      undefined: () => undefined,
      number: () => 1,
      string: () => 'root',
      array: () => [],
    };
    const known = tag !== undefined && Object.prototype.hasOwnProperty.call(shapes, tag);
    const build = known ? shapes[/** @type {string} */ (tag)] : undefined;
    const root = build === undefined ? undefined : build();
    return {
      root,
      known,
      attempted: () => attempted,
      completed: () => completed,
      remaining: () => (held === null ? null : held.length),
      // Read after the call, not before: this is what the root is carrying once
      // the viewer has finished with it. `null` for the shapes that are not the
      // kind of thing own properties can be read off.
      ownNames: () =>
        root === null || (typeof root !== 'object' && typeof root !== 'function')
          ? null
          : Object.getOwnPropertyNames(root).slice().sort(),
      writeArguments: () => writeArguments,
    };
  };

  /**
   * A value that is not a string and answers a read of its `length` by throwing.
   *
   * The shape every "is this a string?" test in the viewer is really about. A
   * wrong type is refused by a type test and by a length test alike, so a corpus
   * of wrong types cannot tell which of the two ran, or in which order — and the
   * order is the whole of it. Reading `.length` before the type is proved runs an
   * accessor an untrusted value chose, outside the guards the cryptographic
   * calls sit in, which turns the module's one returned refusal into an escaping
   * exception. This value is what makes that visible: it is refused silently
   * when the type is asked first, and it throws when the length is.
   *
   * The accessor is enumerable and configurable so that nothing but the read
   * itself distinguishes it from an ordinary field.
   *
   * @returns {object}
   */
  const hostileLength = () => {
    /** @type {Record<string, unknown>} */
    const value = {};
    Object.defineProperty(value, 'length', {
      get() {
        throw new Error('the length of this value cannot be read');
      },
      enumerable: true,
      configurable: true,
    });
    return value;
  };

  /**
   * The input a case hands to the viewer.
   *
   * Normally the case's `text`, which the corpus can carry as anything JSON can
   * express — including things that are not strings at all. A case marked
   * `coercible` gets that text inside an object that would become the string if
   * anything ever coerced it, which is the one shape the corpus cannot write
   * down and the one that catches a parser handing its input to something that
   * stringifies. A case marked `hostile-length` gets the value above instead.
   *
   * @param {Case} item
   * @returns {unknown}
   */
  const inputOf = (item) => {
    if (item.wrap === 'coercible') {
      return { toString: () => item.text };
    }
    if (item.wrap === 'hostile-length') {
      return hostileLength();
    }
    return item.text;
  };

  /**
   * A value key material cannot be taken from, in a shape the corpus cannot
   * write down.
   *
   * Four families. A proxy whose prototype cannot be read is what makes
   * `instanceof` a guard that throws rather than a guard that answers — revoked,
   * or with a trap that throws, either way the reflection itself is the failure.
   * A typed array whose `length` property disagrees with its internal slot is
   * the quieter one: the brand check passes, the length check passes, and
   * everything that copies from it copies the slot, so the missing bytes are
   * silently zeroes and the key derived from them is a key nobody chose.
   *
   * A typed array of another kind is the third, and it is what the brand check
   * is for. The byte count is read from the slot through the accessor on the
   * shared prototype, which answers for every typed array there is — so an
   * `Int8Array` of thirty-two bytes, or a `Uint16Array` of sixteen elements,
   * satisfies the count exactly. Only `instanceof Uint8Array` tells them from
   * key material, and without it a key is derived from whatever they are
   * carrying, in the second case from half of it.
   *
   * The fourth is not key material at all: a value whose `length` accessor
   * throws, for the arguments that are meant to be strings.
   *
   * @param {{ kind: string, carries?: number, claims?: number, how?: string }} spec
   * @returns {{ known: boolean, value: unknown }}
   */
  const hostileFor = (spec) => {
    if (spec.kind === 'length-throws') {
      return { known: true, value: hostileLength() };
    }
    if (spec.kind === 'another-typed-array') {
      const carries = spec.carries ?? 0;
      if (spec.how === 'signed') {
        return { known: true, value: new Int8Array(carries) };
      }
      if (spec.how === 'wider') {
        return { known: true, value: new Uint16Array(carries) };
      }
      if (spec.how === 'clamped') {
        return { known: true, value: new Uint8ClampedArray(carries) };
      }
      return { known: false, value: undefined };
    }
    if (spec.kind === 'revoked-proxy') {
      const revocable = Proxy.revocable(new Uint8Array(32), {});
      revocable.revoke();
      return { known: true, value: revocable.proxy };
    }
    if (spec.kind === 'prototype-throws') {
      return {
        known: true,
        value: new Proxy(new Uint8Array(32), {
          getPrototypeOf() {
            throw new Error('the prototype of this value cannot be read');
          },
        }),
      };
    }
    if (spec.kind === 'length-lies') {
      const carries = spec.carries ?? 0;
      const claims = spec.claims ?? 0;
      if (spec.how === 'subclass') {
        class Shadowed extends Uint8Array {
          /** @override */
          get length() {
            return claims;
          }
        }
        return { known: true, value: new Shadowed(carries) };
      }
      const bytes = new Uint8Array(carries);
      Object.defineProperty(bytes, 'length', { value: claims, configurable: true });
      return { known: true, value: bytes };
    }
    return { known: false, value: undefined };
  };

  /**
   * A value that throws when it is looked at, wrapped around whatever it is
   * given.
   *
   * Every exported function in the viewer is total, and totality is a claim
   * about the reflection calls its guards make rather than about the values they
   * are made on: `Array.isArray` throws on a revoked proxy, `ownKeys` runs a
   * trap that can throw, and so does a descriptor read. Those three are what the
   * try blocks in `isRecord`, `readOwnFields` and `readOwnElements` are for, and
   * every one of them could be deleted without a case noticing, because the only
   * hostile values in the corpus were aimed at the three functions that take key
   * material.
   *
   * @param {object} target
   * @param {string} kind
   * @returns {{ known: boolean, value: unknown }}
   */
  const throwingView = (target, kind) => {
    if (kind === 'revoked') {
      const revocable = Proxy.revocable(target, {});
      revocable.revoke();
      return { known: true, value: revocable.proxy };
    }
    if (kind === 'own-keys-throws') {
      return {
        known: true,
        value: new Proxy(target, {
          ownKeys() {
            throw new Error('the properties of this value cannot be listed');
          },
        }),
      };
    }
    if (kind === 'descriptor-throws') {
      return {
        known: true,
        value: new Proxy(target, {
          getOwnPropertyDescriptor() {
            throw new Error('the descriptor of this property cannot be read');
          },
        }),
      };
    }
    return { known: false, value: undefined };
  };

  /**
   * A value that lists fewer own properties than it answers for.
   *
   * The exactness both readers claim is a comparison against a count, and every
   * hostile shape the corpus had was aimed at one side of it: an unexpected own
   * property, a hidden one, a symbol-keyed one — all of them make the count too
   * large. So the comparison could be read as "not too many" instead of "exactly
   * this many" and refuse every one of them unchanged, while a value that
   * listed fewer names than it holds walked through. This is that value: a
   * listing shorter than the truth, over a target that still answers for every
   * property it left out. The language permits it because a configurable own
   * property of an extensible object may be omitted from a listing.
   *
   * @param {object} target
   * @param {(keys: (string | symbol)[]) => (string | symbol)[]} fewer
   * @returns {unknown}
   */
  const underReportingView = (target, fewer) =>
    new Proxy(target, {
      ownKeys(actual) {
        return fewer(Reflect.ownKeys(actual));
      },
    });

  /**
   * The kind of a tampering neither function below knows how to build.
   *
   * Every other dispatch in this file answers an input it does not recognise
   * with an `unknown…` field the host fails on — fourteen of them, one per thing
   * a case can name. The two tamper functions were the exception: an unrecognised
   * kind fell through to `return copy`, which is the untampered value, so a case
   * naming a kind that no longer exists ran against an input with nothing wrong
   * with it and passed if its expectation happened to be the untampered outcome.
   * Two of the fifteen kinds are used only by accepting cases whose expectations
   * are exactly that, so renaming that kind left both of them exercising nothing
   * with the whole gate green.
   *
   * A recorded name rather than a returned marker because those functions are
   * called from inside the value being built, several levels down; recorded here
   * and read once, where the observation is made, it reaches the host as the
   * same kind of `unknown…` answer as its fourteen siblings.
   *
   * @type {string | null}
   */
  let unrecognisedTamper = null;

  /**
   * Rebuild a record in a shape JSON cannot express, so a reader can be asked
   * whether its field set is exact in the senses text cannot put to it.
   *
   * Two of these are not rebuilds of the value at all: a callable, and a
   * callable that can be constructed. JSON has no way to say either, and they
   * are what the shape question is really about — `typeof` answers `'function'`
   * for both, so a predicate that admits anything which is not a primitive
   * admits them while every predicate that names `'object'` does not.
   *
   * @param {unknown} value
   * @param {{ kind: string, field?: string }} tamper
   * @returns {unknown}
   */
  const tamperWith = (value, tamper) => {
    if (tamper.kind === 'callable') {
      // Carrying a field, so that anything reading its properties finds one to
      // read rather than refusing it for being empty.
      const carrier = () => undefined;
      Object.defineProperty(carrier, 'a', { value: 1, enumerable: true, configurable: true });
      return carrier;
    }
    if (tamper.kind === 'constructible') {
      // The same, constructible: a class is a function with a prototype and an
      // own property set, which is as close to a record as a callable gets.
      class Carrier {}
      Object.defineProperty(Carrier, 'a', { value: 1, enumerable: true, configurable: true });
      return Carrier;
    }
    if (value === null || typeof value !== 'object') {
      // Nothing below can rebuild a value that is not an object, and every kind
      // that could have been meant for one was answered above. Reaching here is
      // a case pointed at something it cannot tamper with, which is the same
      // mistake as naming a kind nothing builds.
      unrecognisedTamper = tamper.kind;
      return value;
    }
    const source = /** @type {Record<string, unknown>} */ (value);
    const field = tamper.field ?? '';

    if (tamper.kind === 'callable-with-fields') {
      // A callable that lists exactly the names a record would, which is the one
      // shape in which the reader's first line is the only thing refusing it.
      // The two carriers above are refused a step later for carrying the wrong
      // field set — a function's own `length` and `name` are two names no case's
      // list asks for — so with the shape question deleted they were still
      // refused, and nothing observed that it had been asked.
      //
      // Both of those properties are configurable on a function, so they can be
      // taken off; an arrow function has no `prototype`. What is left carries the
      // source record's own fields and nothing else, and answers every reflection
      // exactly as the record does.
      const carrier = () => undefined;
      Reflect.deleteProperty(carrier, 'length');
      Reflect.deleteProperty(carrier, 'name');
      for (const key of Object.keys(source)) {
        Object.defineProperty(carrier, key, {
          value: source[key],
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return carrier;
    }

    if (tamper.kind === 'inherit') {
      // The expected field is on the prototype and an unexpected one is own, so
      // the own count is right and the own field set is not.
      const inherited = /** @type {Record<string, unknown>} */ (Object.create({ [field]: source[field] }));
      for (const key of Object.keys(source)) {
        if (key !== field) {
          inherited[key] = source[key];
        }
      }
      inherited['unexpected'] = 1;
      return inherited;
    }

    /** @type {Record<string, unknown>} */
    const copy = {};
    for (const key of Object.keys(source)) {
      copy[key] = source[key];
    }

    if (tamper.kind === 'hide') {
      Object.defineProperty(copy, 'unexpected', { value: 1, enumerable: false, configurable: true });
      return copy;
    }
    if (tamper.kind === 'symbol') {
      Object.defineProperty(copy, Symbol('unexpected'), { value: 1, enumerable: true, configurable: true });
      return copy;
    }
    if (tamper.kind === 'getter') {
      Object.defineProperty(copy, field, {
        get: () => { throw new Error('read of a field that is not a field'); },
        enumerable: true,
        configurable: true,
      });
      return copy;
    }
    if (tamper.kind === 'quiet-getter') {
      // The same substitution, by a getter that behaves. The loud one is refused
      // whether or not anything checks the descriptor, because reading `.value`
      // off an accessor descriptor gives `undefined` and every field is
      // type-checked — so it never showed that the descriptor was consulted.
      // This one hands back exactly the value that was there, so the only thing
      // that can refuse it is the rule that a field must be a value.
      const held = source[field];
      Object.defineProperty(copy, field, { get: () => held, enumerable: true, configurable: true });
      return copy;
    }
    if (tamper.kind === 'not-enumerable') {
      // A named field, its own value, hidden from enumeration. The own-property
      // count is unchanged, so nothing but the enumerable rule refuses it.
      Object.defineProperty(copy, field, {
        value: source[field],
        enumerable: false,
        writable: true,
        configurable: true,
      });
      return copy;
    }
    if (tamper.kind === 'hostile-length') {
      // An ordinary own data property, holding a value that throws when its
      // length is read. The field reader admits it — it is a value, not a getter
      // — and what happens next depends on whether the reader that receives it
      // asks what it is before asking how long it is.
      copy[field] = hostileLength();
      return copy;
    }
    if (tamper.kind === 'own-keys-under-reports') {
      // The other side of the exactness comparison, and the side nothing here
      // reached: a record whose own property listing is one name short of what
      // it carries, with every named field still readable through it.
      return underReportingView(copy, (keys) => keys.slice(1));
    }
    if (tamper.kind === 'own-keys-hides-an-extra') {
      // The same under-reporting, aimed one step over: an unexpected own
      // property, and a listing that leaves out exactly that one. The count then
      // matches the named field set, every named field reads, and the value is
      // carrying a property the reader was never told about. This is the case
      // the reader admits, and it is here to say so.
      Object.defineProperty(copy, 'unexpected', { value: 1, enumerable: true, configurable: true });
      return underReportingView(copy, (keys) => keys.filter((key) => key !== 'unexpected'));
    }
    const throwing = throwingView(copy, tamper.kind);
    if (throwing.known) {
      return throwing.value;
    }
    unrecognisedTamper = tamper.kind;
    return copy;
  };

  /**
   * The same, for an array.
   *
   * `readOwnElements` claims the exactness `readOwnFields` claims, and these are
   * the shapes that put the claim to it: an array carrying something that is not
   * an element, an element that is not an own enumerable value, and an array
   * that answers one length when it is read and another when its own property is
   * looked at.
   *
   * @param {unknown} value
   * @param {{ kind: string }} tamper
   * @returns {unknown}
   */
  const tamperArray = (value, tamper) => {
    if (!Array.isArray(value)) {
      unrecognisedTamper = tamper.kind;
      return value;
    }
    const copy = value.slice();

    if (tamper.kind === 'extra') {
      /** @type {any} */ (copy)['unexpected'] = 1;
      return copy;
    }
    if (tamper.kind === 'hide') {
      Object.defineProperty(copy, 'unexpected', { value: 1, enumerable: false, configurable: true });
      return copy;
    }
    if (tamper.kind === 'symbol') {
      Object.defineProperty(copy, Symbol('unexpected'), { value: 1, enumerable: true, configurable: true });
      return copy;
    }
    if (tamper.kind === 'getter') {
      Object.defineProperty(copy, 0, {
        get: () => { throw new Error('read of an element that is not an element'); },
        enumerable: true,
        configurable: true,
      });
      return copy;
    }
    if (tamper.kind === 'quiet-getter') {
      const held = copy[0];
      Object.defineProperty(copy, 0, { get: () => held, enumerable: true, configurable: true });
      return copy;
    }
    if (tamper.kind === 'not-enumerable') {
      Object.defineProperty(copy, 0, { value: copy[0], enumerable: false, writable: true, configurable: true });
      return copy;
    }
    if (tamper.kind === 'inherit') {
      // The first element is on the prototype and an unexpected property is own,
      // so the own count is still one more than the length and the own property
      // set is still not the index set.
      const held = copy[0];
      const prototype = Object.create(Array.prototype);
      Object.defineProperty(prototype, 0, { value: held, enumerable: true, configurable: true });
      delete copy[0];
      Object.setPrototypeOf(copy, prototype);
      /** @type {any} */ (copy)['unexpected'] = 1;
      return copy;
    }
    if (tamper.kind === 'own-keys-under-reports') {
      // The same, for an array: a listing carrying `length` and none of the
      // indices, over an array that still answers for every one of them.
      // `length` has to stay — it is a non-configurable own property, and a
      // listing that left it out would be refused by the language rather than by
      // the reader.
      return underReportingView(copy, (keys) => keys.filter((key) => key === 'length'));
    }
    if (tamper.kind === 'own-keys-hides-an-extra') {
      // And the shape the array reader admits: one unexpected own property, left
      // out of the listing, so the count is still one name per element plus
      // `length` and every element still reads.
      Object.defineProperty(copy, 'unexpected', { value: 1, enumerable: true, configurable: true });
      return underReportingView(copy, (keys) => keys.filter((key) => key !== 'unexpected'));
    }
    if (tamper.kind === 'shrinking-length') {
      // Still an array to `Array.isArray`, and still carrying every element —
      // but it answers zero when its length is read. Reading the length as a
      // property returned an empty list and, for a document's sections, a
      // document that validated with none of them.
      return new Proxy(copy, {
        get(target, key, receiver) {
          return key === 'length' ? 0 : Reflect.get(target, key, receiver);
        },
      });
    }
    const throwing = throwingView(copy, tamper.kind);
    if (throwing.known) {
      return throwing.value;
    }
    unrecognisedTamper = tamper.kind;
    return copy;
  };

  /**
   * Apply a case's tampering, wherever in the value it is aimed.
   *
   * @param {unknown} value
   * @param {Case} item
   * @returns {unknown}
   */
  const tampered = (value, item) => {
    if (item.tamper === undefined) {
      return value;
    }
    const where = item.tamper.where ?? 'record';
    if (where === 'record') {
      return tamperWith(value, item.tamper);
    }
    if (value === null || typeof value !== 'object') {
      return value;
    }

    const source = /** @type {Record<string, unknown>} */ (value);
    /** @type {Record<string, unknown>} */
    const copy = {};
    for (const key of Object.keys(source)) {
      copy[key] = source[key];
    }

    if (where === 'sections') {
      copy['sections'] = tamperArray(copy['sections'], item.tamper);
      return copy;
    }

    const sections = /** @type {unknown[]} */ (copy['sections']).slice();
    if (where === 'section') {
      sections[0] = tamperWith(sections[0], item.tamper);
      copy['sections'] = sections;
      return copy;
    }
    if (where === 'lines') {
      const first = /** @type {Record<string, unknown>} */ (sections[0]);
      /** @type {Record<string, unknown>} */
      const firstCopy = {};
      for (const key of Object.keys(first)) {
        firstCopy[key] = first[key];
      }
      firstCopy['lines'] = tamperArray(firstCopy['lines'], item.tamper);
      sections[0] = firstCopy;
      copy['sections'] = sections;
      return copy;
    }
    // A place in the value that this does not know how to reach, which drops the
    // tampering just as silently as an unrecognised kind did.
    unrecognisedTamper = where;
    return copy;
  };

  /**
   * The same, aimed at the authenticated data, for the two kinds that are handed
   * both it and a document.
   *
   * @param {unknown} value
   * @param {Case} item
   * @returns {unknown}
   */
  const tamperedAad = (value, item) =>
    item.aadTamper === undefined ? value : tamperWith(value, item.aadTamper);

  /**
   * The stored response a case hands to the viewer, including the one field it
   * could not write down.
   *
   * @param {Case} item
   * @returns {unknown}
   */
  const responseOf = (item) => {
    if (item.synth !== undefined) {
      const parts = { ...item.responseParts };
      parts[item.synth.field] = item.synth.char.repeat(item.synth.length);
      return parts;
    }
    if (item.synthCodeUnit !== undefined) {
      const parts = { ...item.responseParts };
      const current = parts[item.synthCodeUnit.field];
      parts[item.synthCodeUnit.field] =
        typeof current === 'string'
          ? current.replace(item.synthCodeUnit.from, String.fromCharCode(...item.synthCodeUnit.codeUnits))
          : current;
      return parts;
    }
    return item.response;
  };

  /**
   * A stored response whose ciphertext this case had to make.
   *
   * The published fixtures are the shares the generator emitted, and a share is
   * a sealed thing: there is no way to ask "what does a document sealed like
   * *this* come back as" by editing one. So a case may name the fixture's own
   * content key and nonce and the exact string to seal, and the ciphertext is
   * built here — nonce first, then what the tag covers, which is the layout the
   * viewer's own splitting step expects.
   *
   * The authenticated data is the response's own `aad`, unchanged, so the tag
   * covers what the case hands the viewer alongside it. Anything else would be a
   * share that does not authenticate, which is a different question and one the
   * corpus already asks many ways.
   *
   * What is sealed is either a string or bytes, and the difference is the whole
   * of why the second spelling exists. Encoding a string produces well-formed
   * UTF-8 whatever the string is, so a case that names `text` cannot ask what
   * the viewer does with a plaintext that is not — and the decoder's answer to
   * that question is a refusal or a repaired copy, which is the same class of
   * difference as the byte-order mark above. So `bytes` is assembled straight
   * into the buffer that is sealed, one byte per element, with nothing between
   * the case and the tag that could make it well-formed on the way.
   *
   * Total in the same way as everything else here: a case with no `reseal` gets
   * its response back untouched, and a response that is not an object is handed
   * on as it is, because "not an object" is itself a case.
   *
   * @param {unknown} response
   * @param {Case} item
   * @returns {Promise<unknown>}
   */
  const resealed = async (response, item) => {
    if (item.reseal === undefined || response === null || typeof response !== 'object') {
      return response;
    }
    const source = /** @type {Record<string, unknown>} */ (response);
    const nonce = new Uint8Array(item.reseal.nonce);
    const key = await crypto.subtle.importKey('raw', new Uint8Array(item.reseal.k), { name: 'AES-GCM' }, false, [
      'encrypt',
    ]);
    const sealed = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        tagLength: 128,
        additionalData: new TextEncoder().encode(String(source['aad'])),
      },
      key,
      item.reseal.bytes === undefined
        ? new TextEncoder().encode(item.reseal.text ?? '')
        : new Uint8Array(item.reseal.bytes),
    );
    const blob = new Uint8Array(nonce.length + sealed.byteLength);
    blob.set(nonce, 0);
    blob.set(new Uint8Array(sealed), nonce.length);
    let text = '';
    for (const byte of blob) {
      text += String.fromCharCode(byte);
    }
    return { ...source, ciphertext: btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
  };

  /**
   * Run something, and count the typed arrays the viewer allocated while it ran.
   *
   * "Types before lengths, lengths before anything is decoded" is a claim about
   * order, and no outcome can carry it: a field over its bound is refused by the
   * bound and would have been refused by the tag check anyway, so moving the
   * decode in front of every check it is supposed to follow leaves every case in
   * this corpus answering exactly what it answered before. Eleven mutations of
   * that shape survived the whole suite. Counting allocations makes the order
   * observable instead of asserted: the decoder allocates before it decodes, so
   * a case that must be refused before anything is decoded is a case that must
   * allocate nothing at all.
   *
   * The counter is a proxy over the global binding, installed for the length of
   * one call and removed in a `finally`. Every construction goes through to the
   * real constructor with the real `new.target`, so what is counted is the
   * viewer reaching for `new Uint8Array`, and nothing else changes: an instance
   * built through it is an ordinary typed array, and `instanceof` and the
   * species lookups that `subarray` makes both reach the real constructor rather
   * than this one.
   *
   * @param {() => Promise<unknown>} run
   * @returns {Promise<{ value: unknown, allocations: number }>}
   */
  const countingAllocations = async (run) => {
    const real = Uint8Array;
    let allocations = 0;
    globalThis.Uint8Array = new Proxy(real, {
      construct(target, args, newTarget) {
        allocations += 1;
        // The real constructor, with the real `new.target`, so what comes back
        // is an ordinary typed array and a subclass of one stays a subclass.
        return Reflect.construct(target, args, newTarget);
      },
    });
    try {
      const value = await run();
      return { value, allocations };
    } finally {
      globalThis.Uint8Array = real;
    }
  };

  /**
   * Run something, and count the copies of a string the viewer took while it
   * ran.
   *
   * The fragment parser has one bound that no outcome can reach: the largest
   * input it will look at. Anything longer is refused by that bound and would
   * have been refused two lines later by the comparison against the one legal
   * length, so widening the bound a thousandfold, or deleting the comparison
   * that uses it, leaves every fragment in the corpus answering exactly what it
   * answered before. What the bound buys is that an oversized fragment is
   * refused before this page copies it, and a copy is what `slice` makes — so
   * counting those calls is to this bound what counting typed arrays is to the
   * ones in the cryptography.
   *
   * The counting method stands in for the real one for the length of a single
   * synchronous call and is put back in a `finally`. It does no work of its own:
   * every call goes through to the real method with the same receiver and the
   * same arguments.
   *
   * @param {() => unknown} run
   * @returns {{ value: unknown, copies: number }}
   */
  const countingCopies = (run) => {
    const real = String.prototype.slice;
    let copies = 0;
    /** @type {(this: string, start?: number, end?: number) => string} */
    const counting = function (start, end) {
      copies += 1;
      return real.call(this, start, end);
    };
    String.prototype.slice = counting;
    try {
      const value = run();
      return { value, copies };
    } finally {
      String.prototype.slice = real;
    }
  };

  /**
   * @param {Case} item
   * @returns {Promise<Record<string, unknown>>}
   */
  const observeOne = async (item) => {
    if (item.kind === 'fragment') {
      const params = parse.parseLinkFragment(inputOf(item));
      if (params === null) {
        return { parsed: false };
      }
      return {
        parsed: true,
        v: params.v,
        id: asNumbers(params.id),
        keys: Object.keys(params),
        ownNames: Object.getOwnPropertyNames(params),
        symbolCount: Object.getOwnPropertySymbols(params).length,
        json: JSON.stringify(params),
        frozen: Object.isFrozen(params),
        take1: asNumbers(params.takeLinkKey()),
        take2: asNumbers(params.takeLinkKey()),
        take3: asNumbers(params.takeLinkKey()),
      };
    }

    if (item.kind === 'capability') {
      const params = parse.parseLinkFragment(item.text);
      if (params === null) {
        return { parsed: false };
      }

      const descriptor = Object.getOwnPropertyDescriptor(params, 'takeLinkKey');

      // What is already on the accessor, rather than only what can be added to
      // it. Every attempt below tries to attach something and reports that it
      // was refused, and none of them ever looked at what the function was
      // carrying to begin with — so the capability, hung off the accessor as an
      // own property before it was frozen, rode through the entire corpus. A
      // frozen arrow function has exactly two own properties and no symbols.
      const accessorOwnNames = Object.getOwnPropertyNames(params.takeLinkKey).slice().sort();
      const accessorOwnSymbols = Object.getOwnPropertySymbols(params.takeLinkKey).length;

      // And the same reading, of a function that is carrying one, so that the
      // clean answer above is an answer rather than a blind spot.
      const planted = () => null;
      Object.defineProperty(planted, 'linkKey', { value: 'planted', enumerable: false, configurable: true });
      const plantedOwnNames = Object.getOwnPropertyNames(planted).slice().sort();

      const before = JSON.stringify(params);
      const attachToAccessor = tryAttach(params.takeLinkKey, 'toJSON');
      const attachToParams = tryAttach(params, 'toJSON');
      const defineOnAccessor = tryDefine(params.takeLinkKey, 'toJSON', () => params.takeLinkKey());
      const defineOnParams = tryDefine(params, 'toJSON', () => params.takeLinkKey());
      const replaceAccessor = tryDefine(params, 'takeLinkKey', () => 'replaced');

      /** @type {string} */
      let cloned;
      try {
        cloned = JSON.stringify(structuredClone(params));
      } catch {
        cloned = 'not cloneable';
      }

      return {
        parsed: true,
        accessorEnumerable: descriptor === undefined ? null : descriptor.enumerable,
        accessorWritable: descriptor === undefined ? null : descriptor.writable,
        accessorConfigurable: descriptor === undefined ? null : descriptor.configurable,
        accessorFrozen: Object.isFrozen(params.takeLinkKey),
        accessorOwnNames,
        accessorOwnSymbols,
        plantedOwnNames,
        frozen: Object.isFrozen(params),
        extensible: Object.isExtensible(params),
        attachToAccessor,
        attachToParams,
        defineOnAccessor,
        defineOnParams,
        replaceAccessor,
        json: before,
        jsonAfterAttempts: JSON.stringify(params),
        entries: JSON.stringify(Object.entries(params)),
        spreadKeys: Object.keys({ ...params }),
        spreadJson: JSON.stringify({ ...params }),
        cloned,
        // Re-parsing the same fragment yields the capability again, and must:
        // the fragment is the carrier, so holding it is holding the capability.
        // Recorded so that stays a stated property rather than an oversight.
        reparsedTake: asNumbers(parse.parseLinkFragment(item.text).takeLinkKey()),
        take1: asNumbers(params.takeLinkKey()),
        take2: asNumbers(params.takeLinkKey()),
      };
    }

    if (item.kind === 'base64') {
      return { bytes: asNumbers(parse.decodeBase64url(inputOf(item))) };
    }

    if (item.kind === 'cost') {
      // What parsing a fragment cost, beside whether it parsed. Zero is a
      // measurement here rather than the only number this can report: the
      // fragments that are refused after the bound, and the one that parses,
      // carry the counts they really make.
      const counted = countingCopies(() => parse.parseLinkFragment(item.text));
      return { parsed: counted.value !== null, copies: counted.copies };
    }

    if (item.kind === 'sizing') {
      /** @type {Record<string, () => unknown>} */
      const sizes = {
        // The ordinary case, and every value JSON can carry: a number, or
        // something that is not one.
        written: () => item.characters,
        // The two that cannot travel, and the two that multiplication throws
        // on rather than answering.
        bigint: () => BigInt(0),
        symbol: () => Symbol('characters'),
        nan: () => Number.NaN,
        infinity: () => Number.POSITIVE_INFINITY,
      };
      const kind = item.characterKind ?? 'written';
      const size = Object.prototype.hasOwnProperty.call(sizes, kind) ? sizes[kind] : undefined;
      if (size === undefined) {
        return { unknownCharacterKind: kind };
      }
      return { bytes: parse.decodedByteLength(size()) };
    }

    if (item.kind === 'fields') {
      const value = tampered(item.record, item);

      // The predicate that reader starts from, asked on its own. Almost every
      // other case in this family reaches it through `readOwnFields`, where a
      // value it wrongly admitted is refused a step later for not carrying the
      // named fields — so for those, its answer was never the answer to
      // anything, and the call to it in that reader could be deleted with all of
      // them still green. The one case that is not like that is the callable
      // carrying exactly the named fields: it answers every later question the
      // way a record does, so the shape question is the only thing left.
      if (item.predicate === true) {
        return { isRecord: parse.isRecord(value) };
      }

      /** @type {Record<string, () => unknown>} */
      const nameLists = {
        // A list by every test that reader makes — `Array.isArray` reaches
        // through a proxy — whose `indexOf` answers a position after the one
        // being asked about. A real array cannot: `indexOf` answers the first
        // position holding the name, which for a duplicate is below its index
        // and for a distinct name is its index. So this is the only shape that
        // separates `indexOf(name) !== index` from `indexOf(name) < index`.
        'indexOf-answers-past-the-index': () =>
          new Proxy(['a', 'b'], {
            get(target, property, receiver) {
              if (property === 'indexOf') {
                return () => target.length + 1;
              }
              return Reflect.get(target, property, receiver);
            },
          }),
      };
      if (item.namesKind !== undefined) {
        const build = Object.prototype.hasOwnProperty.call(nameLists, item.namesKind)
          ? nameLists[item.namesKind]
          : undefined;
        if (build === undefined) {
          return { unknownNamesKind: item.namesKind };
        }
        return { fields: parse.readOwnFields(value, build()) };
      }

      // The name list as the case wrote it, including when what it wrote is not
      // a list. `??` would turn a case's deliberate `null` into an empty array,
      // so only an absent list defaults.
      const names = item.names === undefined ? [] : item.names;
      return { fields: parse.readOwnFields(value, names) };
    }

    if (item.kind === 'constants') {
      // Bounds and pinned lengths, reported so that widening or deleting one is
      // a failure. No outcome can show any of them: a value over a bound is
      // refused by the bound and would have been refused by the tag check
      // anyway, so the constants themselves are the only thing there is to
      // check.
      return {
        ciphertextMaxB64Length: cryptoCore.CIPHERTEXT_MAX_B64_LENGTH,
        aadMaxLength: cryptoCore.AAD_MAX_LENGTH,
        minBlobByteLength: cryptoCore.MIN_BLOB_BYTE_LENGTH,
        wrappedKeyB64Length: cryptoCore.WRAPPED_KEY_B64_LENGTH,
        serverKeyB64Length: cryptoCore.SERVER_KEY_B64_LENGTH,
        maxFragmentLength: parse.MAX_FRAGMENT_LENGTH,
        shareIdB64Length: parse.SHARE_ID_B64_LENGTH,
        shareIdByteLength: parse.SHARE_ID_BYTE_LENGTH,
        linkSplitV1: parse.LINK_SPLIT_V1,
        shareDocV1: validate.SHARE_DOC_V1,
        relayBannerSharedV1: validate.RELAY_BANNER_SHARED_V1,
      };
    }

    if (item.kind === 'aad') {
      const value = tampered(parse.parseAad(inputOf(item)), item);
      const result = validate.validateAadV1(value);
      return {
        ok: result.ok,
        resultKeys: Object.keys(result).sort(),
        frozen: Object.isFrozen(result),
        isTheRefusal: result === validate.validateAadV1(undefined),
        aadKeys: result.ok ? Object.keys(result.aad) : null,
        aad: result.ok ? result.aad : null,
      };
    }

    if (item.kind === 'document') {
      const parsed = parse.parseShareDoc(inputOf(item));
      if (parsed === null) {
        return {
          parsed: false,
          docVersion: null,
          ok: false,
          resultKeys: null,
          frozen: null,
          isTheRefusal: null,
          docKeys: null,
          doc: null,
        };
      }
      const result = validate.validateShareDocV1(tampered(parsed.value, item));
      return {
        parsed: true,
        docVersion: parsed.docVersion,
        ok: result.ok,
        resultKeys: Object.keys(result).sort(),
        frozen: Object.isFrozen(result),
        isTheRefusal: result === validate.validateShareDocV1(undefined),
        docKeys: result.ok ? Object.keys(result.doc) : null,
        doc: result.ok ? result.doc : null,
      };
    }

    if (item.kind === 'resolve') {
      const aad = tamperedAad(parse.parseAad(item.aadText), item);
      const parsed = parse.parseShareDoc(item.docText);
      const result = dispatch.resolveShareDocV1(aad, tampered(parsed === null ? null : parsed.value, item));
      return {
        ok: result.ok,
        resultKeys: Object.keys(result).sort(),
        frozen: Object.isFrozen(result),
        isTheRefusal: result === dispatch.resolveShareDocV1(undefined, undefined),
        aad: result.ok ? result.aad : null,
        doc: result.ok ? result.doc : null,
      };
    }

    if (item.kind === 'dispatch') {
      const target = rootFor(item.root);
      if (!target.known) {
        return { unknownRoot: item.root ?? null };
      }
      let inspected = false;
      let aad = tamperedAad(item.aadText === undefined ? null : parse.parseAad(item.aadText), item);
      if (item.aadProbe === true && aad !== null && typeof aad === 'object') {
        // The routing cases could once all be satisfied by an empty table: every
        // one of them ended in the root being cleared exactly once, and the
        // refusal path clears it too. This records whether the AAD was ever
        // looked at, which only happens when a handler ran and validated it.
        aad = new Proxy(/** @type {object} */ (aad), {
          getOwnPropertyDescriptor(target2, key) {
            inspected = true;
            return Reflect.getOwnPropertyDescriptor(target2, key);
          },
        });
      }
      const parsed = item.docText === undefined ? null : parse.parseShareDoc(item.docText);
      dispatch.dispatchDoc(target.root, item.docVersion, aad, tampered(parsed === null ? null : parsed.value, item));
      return {
        cleared: target.completed(),
        attempted: target.attempted(),
        remaining: target.remaining(),
        rootOwnNames: target.ownNames(),
        writeArguments: target.writeArguments(),
        aadInspected: inspected,
      };
    }

    if (item.kind === 'render') {
      const target = rootFor(item.root);
      if (!target.known) {
        return { unknownRoot: item.root ?? null };
      }
      if (item.render === 'unavailable') {
        render.renderUnavailable(target.root);
      } else {
        const aad = item.aadText === undefined ? null : parse.parseAad(item.aadText);
        const parsed = item.docText === undefined ? null : parse.parseShareDoc(item.docText);
        const resolved = dispatch.resolveShareDocV1(aad, parsed === null ? null : parsed.value);
        render.renderShareDocV1(target.root, resolved.aad ?? null, resolved.doc ?? null);
      }
      // What the root is carrying afterwards, beside what the call did. The
      // scaffold draws nothing after a successful clear, so the counters alone
      // could not tell a render that drew nothing from a render that wrote text
      // onto the root — and writing text onto an element is a permitted write,
      // so no sink rule would have refused it either.
      return {
        cleared: target.completed(),
        attempted: target.attempted(),
        remaining: target.remaining(),
        rootOwnNames: target.ownNames(),
        writeArguments: target.writeArguments(),
      };
    }

    if (item.kind === 'clear') {
      const target = rootFor(item.root);
      if (!target.known) {
        return { unknownRoot: item.root ?? null };
      }
      // The one DOM write, asked directly, because what it answers is what both
      // render functions branch on and nothing else can show it: the surface
      // they draw after a successful clear is, so far, nothing at all.
      //
      // `remaining` is reported beside the answer so the two can be compared. A
      // root that answers `true` while still holding children is the failure
      // this pair exists to make visible, and it is a failure the answer alone
      // cannot describe.
      const emptied = render.clearRoot(target.root);
      return {
        emptied,
        attempted: target.attempted(),
        completed: target.completed(),
        remaining: target.remaining(),
        rootOwnNames: target.ownNames(),
        writeArguments: target.writeArguments(),
      };
    }

    if (item.kind === 'derive') {
      const kek = await cryptoCore.deriveKek(
        new Uint8Array(item.a ?? []),
        new Uint8Array(item.b ?? []),
        new Uint8Array(item.id ?? []),
      );
      if (kek === null) {
        return { ok: false, kek: null, contentKey: null };
      }
      const contentKey = await cryptoCore.unwrapContentKey(kek, item.wrapped);
      return { ok: contentKey !== null, kek: keyShape(kek), contentKey: keyShape(contentKey) };
    }

    if (item.kind === 'guard') {
      const spec = item.hostile ?? { kind: '' };
      const hostile = hostileFor(spec);
      if (!hostile.known) {
        return { unknownHostile: spec.kind };
      }
      if (item.call === 'deriveKek') {
        /** @type {Record<string, unknown>} */
        const args = {
          linkKey: new Uint8Array(item.a ?? []),
          serverKey: new Uint8Array(item.b ?? []),
          shareId: new Uint8Array(item.id ?? []),
        };
        if (!Object.prototype.hasOwnProperty.call(args, item.slot ?? '')) {
          return { unknownSlot: item.slot ?? null };
        }
        args[/** @type {string} */ (item.slot)] = hostile.value;
        const kek = await cryptoCore.deriveKek(args['linkKey'], args['serverKey'], args['shareId']);
        return { ok: kek !== null };
      }
      // The other two calls take a key and then values that are meant to be
      // strings, and the hostile value can go in any of those slots. Where it is
      // not the key, the genuine key is derived first, so what the case is
      // asking about is the argument it replaced and not a refusal that would
      // have happened anyway.
      if (item.call === 'unwrapContentKey') {
        /** @type {Record<string, unknown>} */
        const args = { kek: undefined, wrapped: item.wrapped };
        if (!Object.prototype.hasOwnProperty.call(args, item.slot ?? '')) {
          return { unknownSlot: item.slot ?? null };
        }
        if (item.slot !== 'kek') {
          args['kek'] = await cryptoCore.deriveKek(
            new Uint8Array(item.a ?? []),
            new Uint8Array(item.b ?? []),
            new Uint8Array(item.id ?? []),
          );
        }
        args[/** @type {string} */ (item.slot)] = hostile.value;
        return { ok: (await cryptoCore.unwrapContentKey(args['kek'], args['wrapped'])) !== null };
      }
      if (item.call === 'decryptContent') {
        /** @type {Record<string, unknown>} */
        const args = { contentKey: undefined, ciphertext: item.ciphertext, aad: item.aadText };
        if (!Object.prototype.hasOwnProperty.call(args, item.slot ?? '')) {
          return { unknownSlot: item.slot ?? null };
        }
        if (item.slot !== 'contentKey') {
          const kek = await cryptoCore.deriveKek(
            new Uint8Array(item.a ?? []),
            new Uint8Array(item.b ?? []),
            new Uint8Array(item.id ?? []),
          );
          args['contentKey'] = await cryptoCore.unwrapContentKey(kek, item.wrapped);
        }
        args[/** @type {string} */ (item.slot)] = hostile.value;
        return {
          ok: (await cryptoCore.decryptContent(args['contentKey'], args['ciphertext'], args['aad'])) !== null,
        };
      }
      return { unknownCall: item.call ?? null };
    }

    if (item.kind === 'decrypt') {
      const result = await cryptoCore.decryptShare(
        new Uint8Array(item.a ?? []),
        new Uint8Array(item.id ?? []),
        tampered(await resealed(responseOf(item), item), item),
      );
      if (result === null) {
        return { ok: false, plaintext: null, aad: null };
      }
      return { ok: true, plaintext: result.plaintext, aad: result.aad };
    }

    if (item.kind === 'ordering') {
      // Everything up to the call under test is set up outside the counter, so
      // what is counted is one call and not a share.
      const linkKey = new Uint8Array(item.a ?? []);
      const serverKey = new Uint8Array(item.b ?? []);
      const shareId = new Uint8Array(item.id ?? []);
      const response = /** @type {Record<string, unknown>} */ (responseOf(item));

      if (item.call === 'share') {
        const counted = await countingAllocations(() => cryptoCore.decryptShare(linkKey, shareId, response));
        return { ok: counted.value !== null, allocations: counted.allocations };
      }
      if (item.call === 'wrap') {
        const kek = await cryptoCore.deriveKek(linkKey, serverKey, shareId);
        const counted = await countingAllocations(() => cryptoCore.unwrapContentKey(kek, response['wrapped_k']));
        return { ok: counted.value !== null, allocations: counted.allocations };
      }
      if (item.call === 'content') {
        const kek = await cryptoCore.deriveKek(linkKey, serverKey, shareId);
        const contentKey = await cryptoCore.unwrapContentKey(kek, item.wrapped);
        const counted = await countingAllocations(() =>
          cryptoCore.decryptContent(contentKey, response['ciphertext'], response['aad']),
        );
        return { ok: counted.value !== null, allocations: counted.allocations };
      }
      return { unknownCall: item.call ?? null };
    }

    if (item.kind === 'instrument') {
      // The corpus's own instruments, asked what they do.
      //
      // Everything else here reports what the viewer did. These report what the
      // things the corpus confronts the viewer with are, and they are here
      // because an instrument that has stopped being one takes its whole family
      // of cases with it silently: a value whose `length` accessor answers
      // instead of throwing turns every hostile-length case into an ordinary
      // wrong type, which the viewer refuses for a reason that proves nothing,
      // and every one of those cases stays green. A counter is the same shape of
      // thing, and the allocation counts on the successful paths are what hold
      // that one; these hold the rest.
      if (item.hostile !== undefined) {
        const built = hostileFor(item.hostile);
        if (!built.known) {
          return { unknownHostile: item.hostile.kind };
        }
        const value = /** @type {any} */ (built.value);
        return { claims: value.length, carries: value.byteLength };
      }

      /** @type {Record<string, () => string>} */
      const probes = {
        'a-length-that-cannot-be-read': () => {
          const value = /** @type {Record<string, unknown>} */ (hostileLength());
          try {
            void value['length'];
            return 'answered';
          } catch {
            return 'threw';
          }
        },
        'a-bare-call-of-a-write-that-needs-its-root': () => {
          const target = rootFor('method-needs-receiver');
          const clear = /** @type {any} */ (target.root)['replaceChildren'];
          try {
            clear();
            return 'answered';
          } catch {
            return 'threw';
          }
        },
        // And the other direction, so a double that refuses everything is not
        // mistaken for one that is particular about how it is called.
        'a-call-of-that-write-on-its-root': () => {
          const target = rootFor('method-needs-receiver');
          const clear = /** @type {any} */ (target.root)['replaceChildren'];
          try {
            clear.call(target.root);
            return 'answered';
          } catch {
            return 'threw';
          }
        },
      };
      const name = item.call ?? '';
      const probe = Object.prototype.hasOwnProperty.call(probes, name) ? probes[name] : undefined;
      if (probe === undefined) {
        return { unknownCall: item.call ?? null };
      }
      return { answer: probe() };
    }

    return { unknownKind: item.kind };
  };

  /** @type {Observed[]} */
  const results = [];
  for (const item of payload.cases) {
    try {
      unrecognisedTamper = null;
      const observed = await observeOne(item);
      // A tampering that was named and not built is a case running against an
      // input with nothing wrong with it, which is worse than a case that fails:
      // it passes. Reported as the answer rather than folded into it, because
      // what the viewer did with an untampered value is not what the case asked.
      results.push({
        name: item.name,
        observed: unrecognisedTamper === null ? observed : { unknownTamper: unrecognisedTamper },
      });
    } catch (error) {
      // A thrown value is itself an observation: nothing in this corpus is
      // allowed to throw, and the host asserts that as hard as it asserts the
      // outcomes.
      results.push({ name: item.name, observed: { threw: String(error) } });
    }
  }
  return results;
}
