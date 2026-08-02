// Fixture: exactly one forbidden construct, on one line, matched by exactly one
// rule — the smallest tree the scan must report as a failure.
//
// The violations tree beside this one carries dozens, so a scan that reported a
// clean result unless it had found several would still fail that tree and look
// correct. This tree is the boundary: one is not none, and the difference
// between them is the whole of what "PASS" means here.
//
// Never served, never imported, never executed — read only as text by the
// self-test.
export function show(node, text) {
  node.innerHTML = text;
}
