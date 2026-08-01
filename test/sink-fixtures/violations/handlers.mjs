// Fixture: proves the script-scoped rules reach .mjs, not only .js.
export function attach(el, value) {
  el.onclick = value;
}
