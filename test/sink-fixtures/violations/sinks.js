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

  // Not sinks. The three ways to tell the type checker to stop looking, which a
  // whole-configuration pin cannot see because neither configuration changes.
  // @ts-nocheck
  // @ts-ignore
  // @ts-expect-error
  return import(value);
}
