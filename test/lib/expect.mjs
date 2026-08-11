/**
 * The comparison.
 *
 * Runs in the host, never in the page: whatever the driver reports comes back
 * here to be judged, so a driver that quietly did nothing cannot report success.
 * The expectations never leave this side. They used to travel with the cases
 * into the page, which made "a driver that quietly did nothing" precisely the
 * driver that passed — echoing each case's own expectation back satisfied every
 * one of them. What crosses now is inputs, and results are matched to cases by
 * name here rather than by the order something else chose to report them in.
 *
 * Four things are checked for every case. What the viewer did must match what
 * the case said it must do — every field of it, in both directions, so an
 * observation carrying a field the case did not name is a failure rather than
 * something to ignore. Nothing may throw, because every refusal in this viewer
 * is a returned value and an exception escaping would be a second failure shape.
 * And no probe string may appear anywhere in the report except where the one
 * accessor deliberately handed it over: a link capability that turns up in an
 * error, a log line, or the serialisation of a parsed link is the failure this
 * whole design exists to prevent.
 *
 * The two-directional field comparison is the newest of those and the one that
 * changes how cases are written. A case that names a subset of what the driver
 * reports is not a shorter case, it is a case that has stopped asking about the
 * rest — and the rest is where a regression sits quietly. Every case names every
 * field its kind observes.
 *
 * Both the scan and that comparison read every own property an observation
 * carries rather than the ones an enumeration shows. A property defined without
 * `enumerable` is invisible to `Object.entries` and `Object.keys` and is an
 * ordinary property otherwise, so reading only what enumerates left a place
 * where a value could sit unscanned and a field could sit unnamed — the same
 * hole the symbol-keyed reading was added to close, in its plainer spelling.
 *
 * A case that threw is still scanned. It is a failure either way, but a thrown
 * value is a string built from whatever was in scope, and the question of
 * whether key material is in it is exactly the question this scan exists to
 * ask — skipping the scan for the cases most likely to be carrying something is
 * the wrong way round.
 *
 * The floors below are the other half of that. An empty corpus is not a corpus
 * that passed, and a comparison that returns "no failures" for one is a
 * comparison that cannot detect its own inputs going missing. It fails closed.
 */

/**
 * The fewest cases that can be called a corpus.
 *
 * Counted over distinct case names, not over entries: a corpus can lose a case
 * to a name collision without losing a line, and it did — two different
 * derivation cases were called `derive/salt-sensitivity`, so the corpus reported
 * 302 cases while asking 301 questions.
 */
export const MINIMUM_CASES = 512;

/**
 * A note on what this total can and cannot hold, because it is not the binding
 * one.
 *
 * The per-kind floors below already sum above this number, so any corpus that
 * satisfies all of them satisfies this as well: the total never fires alone, and
 * a corpus small enough to trip it has tripped several per-kind floors first. It
 * is kept because the per-kind table is a table, and a row deleted from it is a
 * kind with no floor rather than a kind with a low one — the total is what still
 * says something if that happens to several rows at once.
 *
 * Its comparison is held at the edge from `test/node/core.test.mjs`, against a
 * synthetic list of names rather than against the corpus, because no real corpus
 * can sit on this boundary while the per-kind floors are met.
 */

/**
 * And the fewest of each kind.
 *
 * A single total is not a floor, it is an average. Every negative case for the
 * additional authenticated data and every negative document case could be
 * deleted at once and the total would still clear 200, which is to say the total
 * was not holding any of them up. These are per kind, so the loss of a whole
 * family of cases cannot hide inside a large total.
 *
 * Most of them sit below what their kind carries, so ordinary additions do not
 * touch them. Six do not, and which six is worth writing down rather than
 * leaving to be counted: `capability`, `clear`, `constants`, `cost`,
 * `instrument` and `render` are set at exactly what those kinds hold. Removing
 * one case of any of them is a failure and adding one is not, which is the right
 * arrangement wherever every case of a kind is the only case of its distinction.
 *
 * `clear` counts one case per root shape and `render` two, and six of those
 * shapes carry distinctions the corpus has nowhere else about the one DOM write:
 * the root that answers the call, returns, and keeps its children tells "the
 * call returned" from "the root is empty"; the root that refuses a call arriving
 * without its receiver tells a write made on the root from one made on nothing;
 * the root with nothing to read a first child back from tells "empty" from
 * "cannot say"; the root something already handed a child to is the one place
 * the count of arguments a write carries is not zero; the root whose write is an
 * object carrying its own `call` tells the callable test from the exception a
 * bare number's `call` throws; and the root that is itself callable tells the
 * type gate in front of that test from what would have refused a function
 * anyway. Dropping a root shape would take four cases with it — one `clear`, two
 * `render` and one `dispatch` — and land above any comfortable floor. Four
 * rather than the three these two kinds contribute, because `dispatch` uses the
 * same root shapes and was not counted; the two shapes no `dispatch` case uses
 * are the exception, and they cost three.
 *
 * The other four are each a kind with nothing to spare. `constants` and
 * `capability` are one case apiece and are the whole of what holds a bound or
 * the confinement of the link capability. `instrument` is one case per
 * instrument the rest of the corpus is measured with. `cost` is one case per
 * copying path, per edge of the fragment bound, and one for the edge of the
 * exact-length comparison behind it; those two comparisons have no other
 * witness, because both refuse the same inputs and differ only in what was
 * copied on the way.
 *
 * `cost` was the one of the six the paragraph above was wrong about: it stood at
 * seven against eight cases, so the kind it describes as having nothing to spare
 * had one case nothing held up, and the sentence naming it exact was false of
 * it. Since the slack case was one of the two the paragraph says have no other
 * witness, the fix is the number rather than the claim: it is eight, and every
 * one of the eight now has to be there.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const MINIMUM_CASES_BY_KIND = Object.freeze({
  aad: 63,
  base64: 26,
  capability: 1,
  clear: 15,
  constants: 1,
  cost: 8,
  // Set where the four shares that decrypt cleanly cannot be deleted together.
  // Three of them are sealed for an identifier their link does not carry and
  // must still be refused; the fourth is the control, sealed for the identifier
  // its own link carries, and it says the comparison admits that one — which is
  // what makes the other three a refusal of something rather than a comparison
  // that refuses everything. It stood at seventy against eighty-four, which is
  // fourteen of slack: the four could go, and every other addition of that round
  // with them, while this line still read as though it were holding them up.
  // Eighty-one is one above what is left when all four are gone.
  decrypt: 81,
  derive: 9,
  dispatch: 26,
  document: 99,
  // Set where neither of the two families the flow's decision logic is held by
  // can be deleted whole. Eleven cases ask what an answer to a share request is
  // classified as and ten ask what the submit control does next; the floor was
  // thirty-five against fifty-six, so either family could go — taking the wire
  // shape of the one request that carries a code a recipient typed with it — and
  // this number would still be clear. Forty-seven is one above the larger of the
  // two remainders, which is what makes losing either of them a failure here.
  fields: 47,
  fragment: 56,
  guard: 18,
  instrument: 8,
  ordering: 26,
  render: 30,
  resolve: 11,
  sizing: 24,
});

/**
 * The fewest secrets the confinement scan must be watching.
 *
 * Secrets, not spellings. Each secret is looked for in eight spellings, so a
 * floor counted over spellings was a floor of five secrets wearing the number
 * forty — and the corpus has more than three times that many. The count that
 * matters is how many distinct values would be caught if they leaked.
 */
export const MINIMUM_SECRETS = 30;

/** @see MINIMUM_SECRETS */
export const MINIMUM_PROBES = 230;

/**
 * Fields the accessor is supposed to hand back. Everything else in an
 * observation is scanned for probe strings; these are what the probes would
 * legitimately be found in.
 */
const ACCESSOR_FIELDS = ['take1', 'take2', 'take3', 'reparsedTake'];

/**
 * Are these the same value?
 *
 * Value equality, walked, rather than two serialisations compared as text. The
 * text comparison this replaces was one call and it collided: `JSON.stringify`
 * writes `null` for `null` and for `NaN`, writes `0` for `0` and for `-0`, drops
 * a member whose value is `undefined` so that a field holding nothing and a
 * field that is not there spell the same object, and writes `null` for a hole
 * and for a `null` element. Every one of those pairs is a case observing one
 * thing while requiring the other and being reported as a match — and the first
 * of them is reachable from one token in the driver, where the value that stands
 * for "there was nothing to report" is written.
 *
 * `Object.is` for the leaves, which is what makes `NaN` equal to itself and `0`
 * different from `-0`. Own property names and own symbols for the rest, so a
 * property that does not enumerate is compared like any other and a value hidden
 * under a symbol is not a value nothing looks at. Membership is asked as well as
 * value, which is what separates a field holding `undefined` from a field that
 * is absent, and an array's hole from an element that is `null`: a hole is not
 * an own property, and `length` is one, so both differences are differences in
 * the name list before any value is read.
 *
 * The walk's domain is what an observation can be, and that is narrower than
 * "any value" — it is what crosses out of a page and back as a report, which is
 * JSON-shaped: records, lists, strings, numbers, booleans, `null` and
 * `undefined`. Nothing here observes a `Date`, a `RegExp`, a `Map`, a `Set` or a
 * boxed primitive, and no observation can carry one, so the walk does not look
 * at what those keep in their internal slots. That is a documented residual
 * rather than a hole, and it is left as one deliberately — handling internal
 * slots would be machinery for values this comparison cannot be handed.
 *
 * Which of them the residual actually covers is worth stating exactly, and
 * saying "a boxed primitive" is not exact — the three boxes do not behave alike.
 * A `Date`, a `Map`, a `Set`, a boxed `Number` and a boxed `Boolean` all keep
 * everything they hold in internal slots and carry no own properties at all, so
 * two different ones of any of those do compare equal here. A `RegExp` does not:
 * it carries an own `lastIndex`, which this walk reads like any other own
 * property — so two of them agree only while that number does, which is by
 * accident rather than by design and is not a comparison of the pattern. A boxed
 * string is the one box that is further still from the rule: it carries an own
 * index per character and an own `length`, so two different ones compare unequal,
 * and reasoning about the boxes from that one is what made the earlier version of
 * this paragraph wrong. The residual is therefore about the five with nothing own
 * on them, and the reason is that they have no own state rather than no own
 * *enumerable* state — this walk does not filter on enumerability anywhere, which
 * is the point made two paragraphs above.
 *
 * It is also not the pair a reader might expect it to be: a `Date` and the
 * string it serialises as are told apart by the type test at the top of this
 * function, which refuses to compare an object with anything that is not one,
 * and never reach the walk at all.
 *
 * What it deliberately does not compare is the order own properties are listed
 * in, because that is not part of a value. Order is a claim the corpus makes
 * elsewhere, separately, and over some of what the viewer builds rather than all
 * of it. What is pinned: `keys` and `ownNames` are read off the parsed link and
 * compared as lists; `aadKeys` and `docKeys` are read off the one validated
 * record each of those two observations carries, at its top level. What is not:
 * `resultKeys` is `Object.keys(...).sort()` at all three of the driver sites
 * that report it, so it says which names a result carries and can say nothing
 * about the order they came in; the records nested inside a validated document —
 * a section, and the lines under it — carry no key list at all; and no
 * observation reports the order of anything below a record's top level. So a
 * field set that arrived in a different order is a failure where a list is
 * compared, and is nothing anywhere else.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function same(left, right) {
  if (Object.is(left, right)) {
    return true;
  }
  // Everything that is not an object is settled by the line above: two distinct
  // primitives are two values, and a function is only ever equal to itself.
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }
  // A list and a record are different values however alike their properties are.
  // Guarded because `Array.isArray` throws on a revoked proxy, and an
  // observation is allowed to be anything at all.
  try {
    if (Array.isArray(left) !== Array.isArray(right)) {
      return false;
    }
  } catch {
    return false;
  }

  const leftNames = Object.getOwnPropertyNames(left);
  const rightNames = Object.getOwnPropertyNames(right);
  if (leftNames.length !== rightNames.length) {
    return false;
  }
  const leftSymbols = Object.getOwnPropertySymbols(left);
  const rightSymbols = Object.getOwnPropertySymbols(right);
  if (leftSymbols.length !== rightSymbols.length) {
    return false;
  }

  const leftFields = /** @type {Record<string, unknown>} */ (left);
  const rightFields = /** @type {Record<string, unknown>} */ (right);
  for (const name of leftNames) {
    if (!Object.prototype.hasOwnProperty.call(right, name)) {
      return false;
    }
    if (!same(leftFields[name], rightFields[name])) {
      return false;
    }
  }

  const leftKeyed = /** @type {Record<symbol, unknown>} */ (left);
  const rightKeyed = /** @type {Record<symbol, unknown>} */ (right);
  for (const symbol of leftSymbols) {
    if (!Object.prototype.hasOwnProperty.call(right, symbol)) {
      return false;
    }
    if (!same(leftKeyed[symbol], rightKeyed[symbol])) {
      return false;
    }
  }

  return true;
}

/**
 * The kind of a case, taken from its name rather than from its `kind` field.
 *
 * Names are `kind/what`, and the prefix is what a reader of a failure sees. The
 * two agree everywhere; the name is used here so that a case counted towards a
 * per-kind floor is a case a person can find.
 *
 * @param {{ name: string }} item
 * @returns {string}
 */
function kindOf(item) {
  const slash = item.name.indexOf('/');
  return slash === -1 ? item.name : item.name.slice(0, slash);
}

/**
 * Check the corpus itself, before anything is run against it.
 *
 * @param {import('./driver.mjs').Case[]} cases
 * @param {string[]} probes
 * @param {number} secrets
 * @returns {string[]}
 */
function checkCorpus(cases, probes, secrets) {
  /** @type {string[]} */
  const failures = [];

  if (!Array.isArray(cases)) {
    failures.push('the corpus is not a list of cases');
    return failures;
  }

  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Set<string>} */
  const duplicated = new Set();
  /** @type {Map<string, number>} */
  const byKind = new Map();
  for (const item of cases) {
    if (seen.has(item.name)) {
      duplicated.add(item.name);
    }
    seen.add(item.name);
    const kind = kindOf(item);
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    // The floors are counted over the name, and the question is asked by the
    // `kind` field: the name decides which floor a case is credited to, and the
    // field decides which branch of the driver runs. Written down as agreeing
    // and held by nothing, those are two counts of two different things wearing
    // one number — a case renamed into a kind it is not run as clears that
    // kind's floor without asking anything of it, and leaves the kind it is
    // actually run as one case shorter with no line anywhere to say so.
    if (kind !== item.kind) {
      failures.push(
        `${item.name} is counted as a ${kind} case and is run as a ${String(item.kind)} case, so it clears a floor for a question it does not ask`,
      );
    }
  }

  for (const name of [...duplicated].sort()) {
    failures.push(`two cases are called ${name}, so one of them is asking a question nobody can find`);
  }

  if (seen.size < MINIMUM_CASES) {
    failures.push(`the corpus is ${seen.size} distinct case(s), and fewer than ${MINIMUM_CASES} is not a corpus`);
  }

  for (const [kind, minimum] of Object.entries(MINIMUM_CASES_BY_KIND)) {
    const count = byKind.get(kind) ?? 0;
    if (count < minimum) {
      failures.push(`the corpus has ${count} ${kind} case(s), and fewer than ${minimum} is not coverage of ${kind}`);
    }
  }
  for (const kind of byKind.keys()) {
    if (!Object.prototype.hasOwnProperty.call(MINIMUM_CASES_BY_KIND, kind)) {
      failures.push(`the corpus has ${kind} cases and no floor for them, so they could all be deleted unnoticed`);
    }
  }

  if (!Array.isArray(probes) || probes.length < MINIMUM_PROBES) {
    failures.push(
      `the confinement scan has ${Array.isArray(probes) ? `${probes.length} probe(s)` : 'no list of probes'}, and fewer than ${MINIMUM_PROBES} is not a scan`,
    );
  }
  if (typeof secrets !== 'number' || secrets < MINIMUM_SECRETS) {
    failures.push(
      `the confinement scan watches ${typeof secrets === 'number' ? secrets : 'an unknown number of'} secret(s), and fewer than ${MINIMUM_SECRETS} is not a scan`,
    );
  }

  return failures;
}

/**
 * Compare what the driver observed against what the corpus requires.
 *
 * @param {object} input
 * @param {import('./cases.mjs').CorpusCase[]} input.cases
 * @param {string[]} input.probes
 * @param {number} input.secrets How many distinct values the probes spell.
 * @param {import('./driver.mjs').Observed[]} input.results
 * @returns {string[]} One line per failure; empty means everything held.
 */
export function checkObservations({ cases, probes, secrets, results }) {
  const failures = checkCorpus(cases, probes, secrets);
  if (failures.length > 0) {
    return failures;
  }

  // Exact rather than at-least, and the difference is not one anything can be
  // built to show. More results than cases means either two results under one
  // name or a result under a name nobody asked about — there is no third
  // arrangement, because names are what results are matched by — and both of
  // those are failures a few lines below. So `!==` and `<` refuse exactly the
  // same reports here. It is written as the exact comparison because that is the
  // claim, and because the two checks below are about a name while this one is
  // about a count.
  if (!Array.isArray(results) || results.length !== cases.length) {
    failures.push(`ran ${Array.isArray(results) ? results.length : 'no'} case(s), expected ${cases.length}`);
    return failures;
  }

  // Results are matched to cases by name rather than by position. Position was
  // an agreement with the driver about ordering, and an agreement is one more
  // thing that can be true by accident; a name is what the case is called and
  // what a person reading a failure looks for.
  /** @type {Map<string, unknown>} */
  const observations = new Map();
  for (const result of results) {
    if (result === undefined || result === null || typeof result.name !== 'string') {
      failures.push('an observation arrived without the name of the case it is of');
      continue;
    }
    if (observations.has(result.name)) {
      failures.push(`two observations are reported as ${result.name}`);
      continue;
    }
    observations.set(result.name, result.observed);
  }
  const asked = new Set(cases.map((item) => item.name));
  for (const name of observations.keys()) {
    if (!asked.has(name)) {
      failures.push(`${name}: observed, and no case by that name was asked`);
    }
  }
  if (failures.length > 0) {
    return failures;
  }

  for (const item of cases) {
    const reported = observations.get(item.name);
    if (reported === undefined || reported === null || typeof reported !== 'object') {
      failures.push(`${item.name}: nothing was observed`);
      continue;
    }

    const observed = /** @type {Record<string, unknown>} */ (reported);

    // The confinement scan runs first, and runs for every case, so that a case
    // that threw or ran no viewer code at all is still scanned before it is
    // reported as a failure for those reasons.
    /** @type {Record<string, unknown>} */
    const scanned = {};
    // Every own string-keyed property, not only the enumerable ones. A property
    // defined without `enumerable` is invisible to `Object.entries` and to every
    // other ordinary enumeration, and it is an ordinary property in every other
    // respect — readable, serialisable once it is copied out, and exactly as
    // capable of carrying key material as the fields beside it. The symbol case
    // below was closed on this reasoning and the plainer half of it was left
    // open: a name is as good a place to hide as a symbol, and easier.
    for (const field of Object.getOwnPropertyNames(observed)) {
      if (!ACCESSOR_FIELDS.includes(field)) {
        scanned[field] = observed[field];
      }
    }
    // Symbol-keyed properties are not reached by either, so a value hidden under
    // one would be a value the scan never saw. Their names are scanned too: a
    // symbol description is a string an author chose, and it can carry as much
    // as a value can.
    const symbols = Object.getOwnPropertySymbols(observed);
    for (let position = 0; position < symbols.length; position += 1) {
      const symbol = symbols[position];
      if (symbol === undefined) {
        continue;
      }
      scanned[`symbol ${position} name`] = String(symbol);
      scanned[`symbol ${position} value`] = /** @type {Record<symbol, unknown>} */ (observed)[symbol];
    }

    const text = JSON.stringify(scanned);
    for (const probe of probes) {
      if (text.includes(probe)) {
        failures.push(`${item.name}: key material appears in what the viewer reported`);
        break;
      }
    }

    if ('threw' in observed) {
      failures.push(`${item.name}: threw instead of refusing — ${String(observed['threw'])}`);
      continue;
    }
    if ('unknownKind' in observed) {
      failures.push(`${item.name}: the driver has no case kind ${String(observed['unknownKind'])}`);
      continue;
    }
    if ('unknownRoot' in observed) {
      failures.push(`${item.name}: the driver has no root shape ${String(observed['unknownRoot'])}`);
      continue;
    }
    if ('unknownHostile' in observed) {
      failures.push(`${item.name}: the driver has no hostile value ${String(observed['unknownHostile'])}`);
      continue;
    }
    if ('unknownCall' in observed) {
      failures.push(`${item.name}: the driver has no guarded call ${String(observed['unknownCall'])}`);
      continue;
    }
    if ('unknownSlot' in observed) {
      failures.push(`${item.name}: the driver has no argument called ${String(observed['unknownSlot'])}`);
      continue;
    }
    if ('unknownCharacterKind' in observed) {
      failures.push(`${item.name}: the driver has no input kind ${String(observed['unknownCharacterKind'])}`);
      continue;
    }
    if ('unknownNamesKind' in observed) {
      failures.push(`${item.name}: the driver has no name list ${String(observed['unknownNamesKind'])}`);
      continue;
    }
    if ('unknownTamper' in observed) {
      failures.push(`${item.name}: the driver has no tampering ${String(observed['unknownTamper'])}`);
      continue;
    }

    for (const [field, expected] of Object.entries(item.expect)) {
      if (!(field in observed)) {
        failures.push(`${item.name}: ${field} was not observed at all, expected ${JSON.stringify(expected)}`);
        continue;
      }
      if (!same(observed[field], expected)) {
        // The message is a serialisation and the comparison above is not, so
        // there are failures this line cannot show: the pairs `JSON.stringify`
        // spells identically are exactly the ones the comparison was rewritten
        // to separate, and a reader handed `was null, expected null` has been
        // told nothing. So when the two spell the same way, the line says so.
        const was = JSON.stringify(observed[field]);
        const wanted = JSON.stringify(expected);
        failures.push(
          `${item.name}: ${field} was ${was}, expected ${wanted}${
            was === wanted ? ' — two different values that serialise the same way' : ''
          }`,
        );
      }
    }

    // And the other direction. A case that names some of what it saw has
    // stopped asking about the rest, which is where a change nobody meant would
    // sit — so an unexpected field is a failure, not a spare.
    //
    // Own names rather than enumerable ones, for the reason the scan above uses
    // them: a field defined without `enumerable` is a field, and "the case names
    // everything the observation carries" is not a claim an enumeration can
    // make.
    for (const field of Object.getOwnPropertyNames(observed)) {
      if (!Object.prototype.hasOwnProperty.call(item.expect, field)) {
        failures.push(
          `${item.name}: observed ${field} = ${JSON.stringify(observed[field])}, which the case does not name`,
        );
      }
    }

    // And the same direction for a field kept under a symbol, which the list
    // above does not return. `getOwnPropertyNames` is names only, so a
    // symbol-keyed field on an observation was compared when a case happened to
    // carry a symbol of its own and was otherwise a field nothing asked about —
    // the one place a value could sit on a reported observation and be neither
    // named nor refused. It is also the place a value would be put deliberately:
    // no ordinary enumeration shows it.
    //
    // Described by the symbol rather than keyed by it, because two symbols with
    // the same description are two different keys and the report is for a reader.
    for (const symbol of Object.getOwnPropertySymbols(observed)) {
      if (!Object.prototype.hasOwnProperty.call(item.expect, symbol)) {
        failures.push(
          `${item.name}: observed ${String(symbol)} = ${JSON.stringify(
            /** @type {Record<symbol, unknown>} */ (observed)[symbol],
          )}, which the case does not name`,
        );
      }
    }
  }

  return failures;
}
