// Fixture: the shape the viewer is allowed to use. Must produce no violations.
//
// Note the attribute handling. The blanket setAttribute rule means attributes
// are set through property reflection instead: typed, one named property at a
// time, and impossible to hand a name computed at runtime. Anything the viewer
// legitimately needs to set has a reflected property, so the rule costs nothing.
export function attach(root, value) {
  const node = document.createElement('span');
  node.textContent = value;

  node.id = 'note-body';
  node.hidden = false;
  node.role = 'status';
  node.ariaLive = 'polite';
  node.inputMode = 'none';

  root.replaceChildren(node);
  node.addEventListener('click', () => {
    root.replaceChildren();
  });
  return node;
}
