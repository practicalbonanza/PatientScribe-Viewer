// Fixture: spellings this scan is documented NOT to catch.
//
// Every line below is a real evasion or a spelling no rule here is anchored to
// reach, and every one is missed on purpose — a
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

  // A member reached through an optional chain, where the rule that names it is
  // anchored to a dot. Two rules here name a member of `document` and one of
  // them is anchored that way, so this is a miss of that one and not of the
  // other: the pair the persistence rule names is written out in this spelling
  // too, and is caught.
  document?.write(value);

  // A member pulled out by destructuring, which puts the object's name and the
  // member's name on the same line without the two ever being written together.
  // Any rule matching either name alone still sees it; the ones that name a pair
  // do not, and that is the shape below.
  const { storage } = navigator;

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

  // A request captured with no call on the same line. The rule that refuses
  // requests is anchored to the parenthesis, because the word is ordinary
  // English and this project's prose uses it; the four names beside it in the
  // egress rule are not anchored for exactly that reason, and the cost of the
  // difference is this line.
  const captured = fetch;

  // A destination that borrows the page's scheme, written into markup with
  // nothing quoted around it. The two characters that open one also open a
  // comment in every script this scan reads, so the pair is only read where a
  // quote sits in front of it, and an attribute written bare has none. That
  // spelling cannot be written in a script at all, so it is in the markup file
  // beside this one, where it is an actual attribute rather than a description
  // of one.

  // And the same destination with BOTH of its slashes leaning the other way,
  // which a browser reads as the same two characters. The value below is
  // `\\evil.example/x` once this file has run, and the platform's own parser
  // resolves it to the host `evil.example`, off this origin.
  //
  // What would find it is a pair this repository's own served code writes after
  // a quote in front of an ordinary letter whenever it escapes one — three lines
  // of `flow.js`, measured — so looking for that pair there refuses lines that
  // name nothing. The two mixed spellings, one character leaning each way, cost
  // nothing and are caught; this is the one that is given up, and it is given up
  // for a measured reason rather than by oversight.
  //
  // The line this replaces was `'\\example.invalid/x'`, one backslash at run
  // time, which a parser resolves to a path on this very origin — so it was a
  // line demonstrating no miss at all, sitting under a paragraph saying it was
  // one.
  const leaning = '\\\\evil.example/x';

  // A destination assembled out of two strings joined at a seam. Neither half
  // carries a scheme, and neither carries the two characters that open a host,
  // so to a reading of this line neither is a destination — while the value the
  // two make between them resolves to `evil.example`. This is undecidable in a
  // line scan in the way the timer string above is: what is written here is two
  // ordinary strings and an operator, and only running it makes the third thing.
  //
  // The same shape is what would put a token on the end of an admitted
  // destination, or a host after one, with neither half ever being a destination
  // this scan could refuse.
  const seam = 'https:/' + '/evil.example/x';

  // A destination whose scheme is followed by fewer than the two characters this
  // reads. The platform's own parser takes what follows one of these schemes as
  // the part naming a host — whether the pair is written, half written, or left
  // out altogether — but only where that scheme is not the one the page itself
  // was served over. Where the two are the same the parser reads what follows as
  // relative to the page, and the host ends up in the PATH on this very origin.
  //
  // So this shape is TWO lines rather than one, and the second is not a
  // variation on the first. The first names `evil.example` from a page served
  // over `http` and stays on that page's own origin from one served over
  // `https`; the second does exactly the opposite. The suite's own server serves
  // this page over `http`, and `https` is the other scheme a page can be served
  // over, so one line on its own is a fixture that demonstrates the miss under
  // one of the two and nothing at all under the other. What the single line here
  // used to be read as — that the value resolves off this origin, full stop —
  // was true of the scheme the harness runs on and false of the other one.
  //
  // Reaching either would mean matching a scheme and its colon and nothing else,
  // which refuses every line that so much as writes one — a comment about a
  // scheme, a sentence about a policy. That is a decision about what this scan
  // costs a reader, not a pattern to widen quietly, so the shape is written down
  // here and left missed.
  const shortFromAnHttpPage = 'https:/evil.example/x';
  const shortFromAnHttpsPage = 'http:/evil.example/x';

  return [alias, leaning, seam, shortFromAnHttpPage, shortFromAnHttpsPage];
}
