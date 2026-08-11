// Fixture: constructs the scan must catch. Never served, never imported, never
// executed — read only as text by the self-test.
export function sinks(root, el, range, value) {
  root.innerHTML = value;
  // A line longer than the width a report truncates at, so that the truncation
  // is a step something can read rather than one no fixture reaches. The
  // property this assigns to does not matter; the length of the line does.
  aVeryLongIdentifierWrittenSolelyToPushThisSingleLineWellPastTheWidthAtWhichAReportTruncatesIt.innerHTML = aValueAlsoWrittenAtLength;
  el.outerHTML = value;
  root.insertAdjacentHTML('beforeend', value);
  document.write(value);
  document.writeln(value);

  eval(value);
  const indirectEval = (0, eval);
  const built = new Function(value);
  const indirectFunction = (0, Function);
  // The third punctuation each of those two rules names, and the one no other
  // line here reaches: the name captured in a list, which is neither a call nor
  // the closing half of the indirect form above.
  const capturedRunner = [eval, 0];
  const capturedBuilder = [Function, 0];

  const scheme = 'javascript:void 0';
  el.onclick = value;

  const parser = new DOMParser();
  const parsedDoc = parser.parseFromString(value, 'text/html');
  const fragment = range.createContextualFragment(value);
  el.setHTMLUnsafe(value);
  const unsafeDoc = Document.parseHTMLUnsafe(value);

  el.style = value;
  el.style.cssText = value;
  el.style.setProperty('color', value);
  el.style.color = value;

  el.setAttribute('data-x', value);
  el.setAttributeNS(null, 'data-x', value);
  Object.assign(el, { href: value });

  el.href = value;
  el.src = value;
  el.srcset = value;
  el.imageSrcset = value;
  el.srcdoc = value;
  el.action = value;
  el.formAction = value;
  // The one of these an anchor in this project's own page could carry, and the
  // one that is a request rather than a resource: a link with it set posts to
  // wherever it names as soon as the link is used.
  el.ping = value;

  const objectUrl = URL.createObjectURL(value);
  location.assign(value);
  location.replace(value);
  location = value;
  window.open(value);
  // The unqualified global, which the rule names separately because the binding
  // is callable without `window` in front of it. Bound to a name so this line
  // reads differently from the one above it — a spelling that appears in both is
  // a spelling that cannot say which of the two fired.
  const opened = open(value);

  setTimeout('tick()', 0);
  setInterval('tick()', 0);

  // Every element the rule names, because a rule that alternates over a list of
  // names fires on the whole list from one of them.
  const injected = document.createElement('script');
  const framed = document.createElement('iframe');
  const embedded = document.createElement('object');
  const plugged = document.createElement('embed');
  const linked = document.createElement('link');
  const based = document.createElement('base');
  const declared = document.createElement('meta');
  const submitted = document.createElement('form');

  // A style element's text content is CSS, so the pair is a CSS-injection sink.
  const styleEl = document.createElement('style');
  styleEl.textContent = value;

  // Five ways off the page. The link capability lives in the fragment and never
  // reaches a server on its own; each of these is one line that would change
  // that, and a beacon in particular returns nothing a caller has to read.
  fetch('https://example.invalid/', { body: value });
  navigator.sendBeacon('https://example.invalid/', value);
  // And a beacon captured rather than called. `sendBeacon` is matched as a
  // name, so the reference is refused without a call anywhere on the line.
  const beacon = navigator.sendBeacon;
  const request = new XMLHttpRequest();
  const socket = new WebSocket('wss://example.invalid/');
  const events = new EventSource('https://example.invalid/');

  // A request written with a space before its parenthesis, which the anchor on
  // that rule still reaches. The spelling it does not reach is a reference
  // captured with no call on the line, which the known-miss fixture carries.
  fetch ('https://example.invalid/', { body: value });

  // Every place something could be kept after the page holding it is gone.
  const kept = localStorage;
  const forTheTab = sessionStorage;
  const database = indexedDB;
  const crumb = document.cookie;
  const cached = caches;
  const worker = navigator.serviceWorker;
  const jar = cookieStore;
  const quota = navigator.storage;

  // The two of those eight that are a member of an ordinary object, in the
  // spellings that are not a plain dot. Six of the names are one word and are
  // reached the same way however they are written; these two are a pair, and a
  // pair can be written without the dot the rule used to be anchored to.
  const chainedCrumb = document?.cookie;
  const computedCrumb = document['cookie'];
  const chainedQuota = navigator?.storage;
  const computedQuota = navigator['storage'];

  // Every way of reaching the output channel this page has none of, which is one
  // word to a rule that matches a name: the member, the member by a key, the
  // global itself, and a member pulled off it.
  console.log(value);
  console['warn'](value);
  const output = console;
  const { error } = console;

  // The record the browser keeps of the address this page was loaded from, which
  // still carries the fragment after the address bar has been rewritten without
  // it. Three reaches, and the reading is spelled three ways.
  //
  // A line each, and not one line doing several at once: the obvious spelling
  // puts the object and a reading of the entries on the same line, and a fixture
  // written that way satisfies two of the entries in the list beside this rule
  // from a single match — after which either alternative can be dropped from the
  // pattern with everything still green. The object is bound on its own here for
  // that reason, and each reading is called on something already holding it.
  const timings = performance;
  const navigations = timings.getEntriesByType('navigation');
  const marked = timings.getEntriesByName('a-mark');
  const everything = timings.getEntries();
  const watcher = new PerformanceObserver(value);

  // A destination outside this page, under each scheme. A line each rather than
  // one line carrying two: a line satisfying two spellings from one match leaves
  // either of them free to stop matching unnoticed. The resource named from
  // inside a stylesheet used to be three lines here and is a rule of its own now,
  // declared for stylesheets, so its fixture is the stylesheet beside this file.
  const plain = 'http://example.invalid/';
  const secure = 'https://example.invalid/x.png';

  // The same destination with one of the two characters after the scheme leaning
  // the other way, once each way. A parser reading one of these schemes treats a
  // backslash as a slash, so each of these names the host the two lines above do.
  const leaningOut = 'https:/\example.invalid/x.png';
  const leaningBack = 'https:\/example.invalid/x.png';

  // A destination that leaves the scheme out and borrows the page's: with a
  // name for a host, with an address, which is written in brackets, and with a
  // first character an allow-set of letters, digits and that bracket refused
  // while a parser read it as the start of a host perfectly well.
  const borrowed = '//example.invalid/x.png';
  const bracketed = '//[2001:db8::1]/x.png';
  const underscored = '//_example.invalid/x.png';

  // And the same borrowed-scheme destination with one character leaning each
  // way. The spelling with BOTH of them leaning is not here: it is the one this
  // scan gives up on purpose, and it is in the known-miss fixture with the
  // measurement that made it a decision.
  const borrowedOut = '/\example.invalid/x.png';
  const borrowedBack = '\/example.invalid/x.png';

  // And the same two shapes written with a character a parser deletes before it
  // reads anything. There is a TAB between the two characters after the scheme on
  // the first line, and a SPACE between the quote and the pair on the second —
  // both invisible here, both removed by the parser, and each naming the host the
  // lines above name. A reading that required the characters around them to be
  // next to each other admitted the pair.
  const strippedInside = 'https:/	/example.invalid/x.png';
  const trimmedInFront = ' //example.invalid/x.png';

  // Not sinks. The three ways to tell the type checker to stop looking, which a
  // whole-configuration pin cannot see because neither configuration changes.
  // @ts-nocheck
  // @ts-ignore
  // @ts-expect-error
  return import(value);
}
