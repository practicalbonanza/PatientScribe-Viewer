// Fixture: spellings this scan is documented NOT to catch.
//
// Every line below is a real evasion, and every one is missed on purpose — a
// line-based lexical scan cannot see through any of them. The self-test asserts
// that this file produces zero violations. That assertion is the point: if a
// future rule change starts catching one of these, the self-test fails, and the
// list of misses below and the paragraph about the limits of this scan at the
// top of check-sinks-core.mjs get updated deliberately instead of drifting into
// a claim nobody checked.
export function misses(el, value) {
  // A property name assembled at runtime.
  const assembled = 'inner' + 'HTML';
  el[assembled] = value;

  // An identifier spelled with a unicode escape.
  el.innerHTM\u004C = value;

  // An alias captured with no call on the same line.
  const alias = eval;

  // A call split across lines.
  el.setAttribute
    (value, value);

  // A string reaching a timer through a variable. This one is not obfuscation
  // and not an oversight: it is undecidable in a line scan. A variable holding a
  // string is spelled exactly like a variable holding a function reference, and
  // the timer rule can only see the literal case. Catching this needs a type
  // checker or a linter with scope analysis, not a regular expression.
  const later = 'tick()';
  setTimeout(later, 0);

  // The constructor chain reached from a literal — the most widely cited route
  // to the same power as the Function constructor, spelled without either name.
  const chained = [].constructor.constructor(value);

  return alias;
}
