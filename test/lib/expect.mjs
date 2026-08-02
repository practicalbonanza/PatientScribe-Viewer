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
export const MINIMUM_CASES = 485;

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
 * @type {Readonly<Record<string, number>>}
 */
export const MINIMUM_CASES_BY_KIND = Object.freeze({
  aad: 63,
  base64: 26,
  capability: 1,
  clear: 15,
  constants: 1,
  cost: 7,
  decrypt: 66,
  derive: 9,
  dispatch: 26,
  document: 99,
  fields: 12,
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
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
        failures.push(
          `${item.name}: ${field} was ${JSON.stringify(observed[field])}, expected ${JSON.stringify(expected)}`,
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
  }

  return failures;
}
