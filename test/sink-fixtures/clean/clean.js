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

// Two spellings that a rule scoped to the other kind of file would match, and
// which this file must produce no violation for. Scoping is a comparison like
// any other: every case in the self-test asks whether a markup rule reaches a
// markup file and whether a script rule reaches a script file, and none of them
// asks whether either stops there. A rule declared for every extension is one
// token from a rule declared for markup, and this line is what refuses it.
export const attributeSpelling = ' onclick=';
