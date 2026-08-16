#!/bin/sh
#
# What the release build does, and what it refuses.
#
# The property everything else rests on is determinism: the switch driver proves a
# published manifest's provenance by rebuilding it and comparing bytes, so a build
# that was not a pure function of its inputs would make that proof impossible.
# That is the first case below and it is asserted as bytes — `diff -rq` over the
# layouts and `cmp` over the manifests — rather than as "the digests matched",
# because two builders that agree on contents and not on serialisation are two
# builders whose manifests differ.
#
# The instant is the only half of the identifier this fixes. The suffix is derived
# at run time from the commit being recorded, which is what lets this file pass at
# any HEAD: an identifier written out in full here would carry today's commit and
# would stop being a valid identifier the moment the history moved.
#
# Nothing here touches the real site/. The dirty-tree direction and both
# directions of the --commit rule are driven in scratch repositories this test
# creates in its own temporary directory, because the way to find out what a build
# does to an unclean checkout is not to make this checkout unclean.
#
# Exit codes: 0 = every case held, 1 = one did not.

set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
BUILD="$ROOT/scripts/infra/build-release.mjs"

WORK=$(mktemp -d)
# shellcheck disable=SC2064
trap "rm -rf '$WORK'" EXIT INT TERM

FAILURES=0

record() {
  if [ "$1" = 'ok' ]; then
    printf '  ok   %s\n' "$2"
  else
    FAILURES=$((FAILURES + 1))
    printf '  FAIL %s — %s\n' "$2" "$3"
  fi
}

# A commit-shaped value for the fixture trees, which have no history of their own.
FIXTURE_COMMIT='a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
FIXTURE_ID="20260101T000000Z-$(printf '%s' "$FIXTURE_COMMIT" | cut -c1-12)"

echo 'the transcriptions:'
STATUS=0
node "$ROOT/scripts/infra/frozen-spellings.mjs" --self-test | sed 's/^/  /' || STATUS=$?
if [ "$STATUS" -eq 0 ]; then
  record ok 'every frozen spelling this build writes is still spelled that way at its source'
else
  record fail 'every frozen spelling this build writes is still spelled that way at its source' "the self-test exited ${STATUS}"
fi
echo

# ---------------------------------------------------------------------------
# Two builds of the real site/, at one identifier.
# ---------------------------------------------------------------------------
HEAD_COMMIT=$(git -C "$ROOT" rev-parse HEAD)
REAL_ID="20260101T000000Z-$(printf '%s' "$HEAD_COMMIT" | cut -c1-12)"

STATUS=0
( cd "$ROOT" && node "$BUILD" --out "$WORK/one" --release-id "$REAL_ID" ) > "$WORK/one.log" 2>&1 || STATUS=$?
if [ "$STATUS" -eq 0 ]; then
  record ok 'the real site/ builds'
else
  record fail 'the real site/ builds' "exit ${STATUS}: $(cat "$WORK/one.log")"
fi

STATUS=0
( cd "$ROOT" && node "$BUILD" --out "$WORK/two" --release-id "$REAL_ID" ) > "$WORK/two.log" 2>&1 || STATUS=$?
if [ "$STATUS" -eq 0 ]; then
  record ok 'it builds a second time'
else
  record fail 'it builds a second time' "exit ${STATUS}: $(cat "$WORK/two.log")"
fi

ONE="$WORK/one/$REAL_ID"
TWO="$WORK/two/$REAL_ID"

if diff -rq "$ONE/layout" "$TWO/layout" > "$WORK/layout-diff.txt" 2>&1; then
  record ok 'two builds of one tree write byte-identical layouts'
else
  record fail 'two builds of one tree write byte-identical layouts' "$(cat "$WORK/layout-diff.txt")"
fi

if cmp -s "$ONE/manifest.json" "$TWO/manifest.json"; then
  record ok 'two builds of one tree write byte-identical manifests'
else
  record fail 'two builds of one tree write byte-identical manifests' 'the manifests differ'
fi

# ---------------------------------------------------------------------------
# The shape of what was built.
# ---------------------------------------------------------------------------
if [ -f "$ONE/manifest.json" ] && [ ! -e "$ONE/layout/manifest.json" ]; then
  record ok 'the manifest sits beside the layout, never inside it'
else
  record fail 'the manifest sits beside the layout, never inside it' "$(ls -R "$ONE")"
fi

if cmp -s "$ONE/layout/js/config.js" "$ROOT/site/js/config.js"; then
  record ok 'the origin table comes out byte-identical to the bytes it went in as'
else
  record fail 'the origin table comes out byte-identical to the bytes it went in as' 'they differ'
fi

SURVIVORS=$(grep -rl '\./' "$ONE/layout" --include='*.js' 2>/dev/null || true)
if [ -z "$SURVIVORS" ]; then
  record ok 'no ./ specifier survives in any built module'
else
  record fail 'no ./ specifier survives in any built module' "$SURVIVORS"
fi

COMMENTS=$(grep -c -- "<!-- release: ${REAL_ID} -->" "$ONE/layout/index.html" || true)
if [ "$COMMENTS" -eq 1 ]; then
  record ok 'the entry document carries exactly one release comment'
else
  record fail 'the entry document carries exactly one release comment' "found ${COMMENTS}"
fi

LAST_TWO=$(grep -v '^$' "$ONE/layout/index.html" | tail -2 | tr '\n' '|')
if [ "$LAST_TWO" = "</html>|<!-- release: ${REAL_ID} -->|" ]; then
  record ok 'the release comment sits on its own line immediately after </html>'
else
  record fail 'the release comment sits on its own line immediately after </html>' "$LAST_TWO"
fi

if grep -q 'href="/assets/' "$ONE/layout/index.html" && grep -q 'src="/assets/' "$ONE/layout/index.html"; then
  record ok 'the stylesheet and the module are rewritten to their digest paths'
else
  record fail 'the stylesheet and the module are rewritten to their digest paths' "$(head -12 "$ONE/layout/index.html")"
fi

if grep -q '"/js/config.js"' "$ONE/manifest.json" && ! grep -q '/assets/.*config' "$ONE/manifest.json"; then
  record ok 'the origin table is a document-prefix object and not an asset'
else
  record fail 'the origin table is a document-prefix object and not an asset' "$(cat "$ONE/manifest.json")"
fi

# ---------------------------------------------------------------------------
# The fixture trees this build refuses.
# ---------------------------------------------------------------------------
write_fixture_tree() {
  TREE="$1"
  mkdir -p "$TREE/js" "$TREE/css"
  cat > "$TREE/index.html" <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <link rel="stylesheet" href="css/viewer.css" />
    <script type="module" src="js/main.js"></script>
  </head>
  <body></body>
</html>
HTML
  printf 'body { margin: 0; }\n' > "$TREE/css/viewer.css"
  printf 'export function apiOriginFor() {\n  return null;\n}\n' > "$TREE/js/config.js"
  printf "import { apiOriginFor } from './config.js';\nexport const started = apiOriginFor;\n" > "$TREE/js/main.js"
}

refuses() {
  LABEL="$1"
  TREE="$2"
  STATUS=0
  node "$BUILD" --tree "$TREE" --out "$WORK/out-$3" --release-id "$FIXTURE_ID" --commit "$FIXTURE_COMMIT" \
    > "$WORK/out-$3.log" 2>&1 || STATUS=$?
  if [ "$STATUS" -eq 1 ] || [ "$STATUS" -eq 2 ]; then
    record ok "$LABEL"
  else
    record fail "$LABEL" "exit ${STATUS}: $(cat "$WORK/out-$3.log")"
  fi
}

write_fixture_tree "$WORK/tree-sound"
STATUS=0
node "$BUILD" --tree "$WORK/tree-sound" --out "$WORK/out-sound" --release-id "$FIXTURE_ID" --commit "$FIXTURE_COMMIT" \
  > "$WORK/out-sound.log" 2>&1 || STATUS=$?
if [ "$STATUS" -eq 0 ]; then
  record ok 'a sound fixture tree builds, so the refusals below are about what they name'
else
  record fail 'a sound fixture tree builds, so the refusals below are about what they name' "exit ${STATUS}: $(cat "$WORK/out-sound.log")"
fi

write_fixture_tree "$WORK/tree-cycle"
printf "import { b } from './b.js';\nexport const a = b;\n" > "$WORK/tree-cycle/js/a.js"
printf "import { a } from './a.js';\nexport const b = a;\n" > "$WORK/tree-cycle/js/b.js"
printf "import { a } from './a.js';\nexport const started = a;\n" > "$WORK/tree-cycle/js/main.js"
refuses 'a cycle in the import graph refuses' "$WORK/tree-cycle" 'cycle'
if grep -q 'cycle' "$WORK/out-cycle.log"; then
  record ok 'the cycle refusal names the cycle'
else
  record fail 'the cycle refusal names the cycle' "$(cat "$WORK/out-cycle.log")"
fi

write_fixture_tree "$WORK/tree-unresolvable"
printf "import { nothing } from './nowhere.js';\nexport const started = nothing;\n" > "$WORK/tree-unresolvable/js/main.js"
refuses 'a specifier that resolves to no sibling refuses' "$WORK/tree-unresolvable" 'unresolvable'

write_fixture_tree "$WORK/tree-no-close"
printf '<!doctype html>\n<link rel="stylesheet" href="css/viewer.css" />\n<script type="module" src="js/main.js"></script>\n' \
  > "$WORK/tree-no-close/index.html"
refuses 'an entry document with no </html> refuses' "$WORK/tree-no-close" 'no-close'

write_fixture_tree "$WORK/tree-two-closes"
cat > "$WORK/tree-two-closes/index.html" <<'HTML'
<!doctype html>
<html lang="en">
  <head>
    <link rel="stylesheet" href="css/viewer.css" />
    <script type="module" src="js/main.js"></script>
  </head>
  <body></body>
</html>
</html>
HTML
refuses 'an entry document with two </html> tags refuses' "$WORK/tree-two-closes" 'two-closes'

write_fixture_tree "$WORK/tree-parent"
printf "import { apiOriginFor } from '../js/config.js';\nexport const started = apiOriginFor;\n" > "$WORK/tree-parent/js/main.js"
refuses 'a ../ specifier refuses' "$WORK/tree-parent" 'parent'

write_fixture_tree "$WORK/tree-dynamic"
printf "export async function started() {\n  return import('/js/config.js');\n}\n" > "$WORK/tree-dynamic/js/main.js"
refuses 'a dynamic import refuses' "$WORK/tree-dynamic" 'dynamic'

write_fixture_tree "$WORK/tree-url"
printf 'body { background: url(/assets/nothing.png); }\n' > "$WORK/tree-url/css/viewer.css"
refuses 'a stylesheet that references another object refuses' "$WORK/tree-url" 'url'

write_fixture_tree "$WORK/tree-stranger"
printf 'not a module\n' > "$WORK/tree-stranger/js/notes.txt"
refuses 'an object of a class this layout does not serve refuses' "$WORK/tree-stranger" 'stranger'

STATUS=0
node "$BUILD" --tree "$WORK/tree-sound" --out "$WORK/out-suffix" --release-id "20260101T000000Z-ffffffffffff" \
  --commit "$FIXTURE_COMMIT" > "$WORK/out-suffix.log" 2>&1 || STATUS=$?
if [ "$STATUS" -eq 1 ]; then
  record ok 'a release identifier whose suffix contradicts the commit refuses'
else
  record fail 'a release identifier whose suffix contradicts the commit refuses' "exit ${STATUS}: $(cat "$WORK/out-suffix.log")"
fi

# ---------------------------------------------------------------------------
# Provenance, in scratch repositories.
# ---------------------------------------------------------------------------
scratch_repo() {
  REPO="$1"
  mkdir -p "$REPO"
  git -C "$REPO" init -q -b main
  git -C "$REPO" config user.name 'viewer selftest'
  git -C "$REPO" config user.email 'viewer-selftest'
  cp -R "$ROOT/site" "$REPO/site"
  git -C "$REPO" add -A
  git -C "$REPO" commit -q -m 'the site as it is'
}

scratch_repo "$WORK/dirty"
printf '\n<!-- a byte no commit holds -->\n' >> "$WORK/dirty/site/index.html"
STATUS=0
( cd "$WORK/dirty" && node "$BUILD" --out "$WORK/out-dirty" ) > "$WORK/out-dirty.log" 2>&1 || STATUS=$?
if [ "$STATUS" -eq 1 ] && grep -q 'uncommitted' "$WORK/out-dirty.log"; then
  record ok 'a dirty site/ refuses, and the refusal says why'
else
  record fail 'a dirty site/ refuses, and the refusal says why' "exit ${STATUS}: $(cat "$WORK/out-dirty.log")"
fi

scratch_repo "$WORK/commits"
FIRST=$(git -C "$WORK/commits" rev-parse HEAD)
printf 'a note that is not site/\n' > "$WORK/commits/NOTES.md"
git -C "$WORK/commits" add -A
git -C "$WORK/commits" commit -q -m 'something outside site/'

STATUS=0
( cd "$WORK/commits" && node "$BUILD" --out "$WORK/out-equal" --commit "$FIRST" ) > "$WORK/out-equal.log" 2>&1 || STATUS=$?
if [ "$STATUS" -eq 0 ]; then
  record ok 'an explicit commit whose site tree equals the working one is accepted'
else
  record fail 'an explicit commit whose site tree equals the working one is accepted' "exit ${STATUS}: $(cat "$WORK/out-equal.log")"
fi

EQUAL_DIR=$(find "$WORK/out-equal" -maxdepth 1 -mindepth 1 -type d | head -1)
if grep -q "\"commit\": \"${FIRST}\"" "$EQUAL_DIR/manifest.json"; then
  record ok 'the manifest records the commit it was told to'
else
  record fail 'the manifest records the commit it was told to' "$(head -4 "$EQUAL_DIR/manifest.json")"
fi
if grep -q "\"release_id\": \"[0-9]\{8\}T[0-9]\{6\}Z-$(printf '%s' "$FIRST" | cut -c1-12)\"" "$EQUAL_DIR/manifest.json"; then
  record ok 'the derived identifier takes its suffix from the commit being recorded, not from HEAD'
else
  record fail 'the derived identifier takes its suffix from the commit being recorded, not from HEAD' "$(head -4 "$EQUAL_DIR/manifest.json")"
fi

printf '\n<!-- a later change to the site -->\n' >> "$WORK/commits/site/index.html"
git -C "$WORK/commits" add -A
git -C "$WORK/commits" commit -q -m 'a change inside site/'

STATUS=0
( cd "$WORK/commits" && node "$BUILD" --out "$WORK/out-unequal" --commit "$FIRST" ) > "$WORK/out-unequal.log" 2>&1 || STATUS=$?
if [ "$STATUS" -eq 1 ] && grep -q 'site tree' "$WORK/out-unequal.log"; then
  record ok 'an explicit commit whose site tree differs refuses'
else
  record fail 'an explicit commit whose site tree differs refuses' "exit ${STATUS}: $(cat "$WORK/out-unequal.log")"
fi

STATUS=0
( cd "$WORK/commits" && node "$BUILD" --out "$WORK/out-unknown" --commit '0123456789abcdef0123456789abcdef01234567' ) \
  > "$WORK/out-unknown.log" 2>&1 || STATUS=$?
if [ "$STATUS" -eq 1 ]; then
  record ok 'a commit git does not know refuses'
else
  record fail 'a commit git does not know refuses' "exit ${STATUS}: $(cat "$WORK/out-unknown.log")"
fi

echo
echo 'the manifest of the first build:'
sed 's/^/  /' "$ONE/manifest.json"
echo
echo 'the built entry document:'
sed 's/^/  /' "$ONE/layout/index.html"
echo

if [ "$FAILURES" -eq 0 ]; then
  echo 'build-release self-test — PASS'
  exit 0
fi
echo "build-release self-test — FAIL (${FAILURES} case(s))"
exit 1
