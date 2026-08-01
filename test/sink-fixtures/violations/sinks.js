// Fixture: constructs the scan must catch. Never served, never imported, never
// executed — read only as text by the self-test.
export function sinks(root, el, range, value) {
  root.innerHTML = value;
  el.outerHTML = value;
  root.insertAdjacentHTML('beforeend', value);
  document.write(value);

  eval(value);
  const indirectEval = (0, eval);
  const built = new Function(value);
  const indirectFunction = (0, Function);

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

  const objectUrl = URL.createObjectURL(value);
  location.assign(value);
  window.open(value);
  open(value);

  setTimeout('tick()', 0);
  setInterval('tick()', 0);

  const injected = document.createElement('script');

  // A style element's text content is CSS, so the pair is a CSS-injection sink.
  const styleEl = document.createElement('style');
  styleEl.textContent = value;

  return import(value);
}
