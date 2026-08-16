#!/bin/sh
#
# The switch driver, driven end to end without a cloud.
#
# The subject is a SCRATCH REPOSITORY this test creates in its own temporary
# directory: the real site/ copied in and committed, two releases built from it,
# both manifests committed under releases/, the `origin` remote set to the
# committed public path, and `refs/remotes/origin/main` pointed at that commit.
# That fabricates the PUBLIC state locally — no network exists here — and it is
# what makes the whole target-and-roster-and-provenance regime drivable dark: the
# driver reads its git context from the working directory, so putting the working
# directory inside that repository is the whole of the arrangement.
#
# The happy path is not a mock. The fake CLI covers the aws argvs and nothing
# else; step [7] runs the REAL release check against a REAL local origin over a
# REAL socket, and the canned stack outputs steer the driver's own origin
# resolution to that origin rather than a flag doing it. When the transcript below
# says the check exited 0, a frozen oracle said so.
#
# Exit codes: 0 = every case held, 1 = one did not.

set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
SCRIPT="$ROOT/scripts/infra/release.sh"
BUILD="$ROOT/scripts/infra/build-release.mjs"
SERVE="$HERE/serve-built-release.mjs"

WORK=$(mktemp -d)
SERVER_PID=''
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

PATH="$HERE/fake-cli:$PATH"
export PATH

unset VIEWER_EXPECTED_ACCOUNT_ID || true
unset VIEWER_DEPLOY_ARMED || true
unset VIEWER_DRILL_ARMED || true

FAILURES=0

record() {
  if [ "$1" = 'ok' ]; then
    printf '  ok   %s\n' "$2"
  else
    FAILURES=$((FAILURES + 1))
    printf '  FAIL %s — %s\n' "$2" "$3"
  fi
}

echo 'the deciding halves:'
STATUS=0
node "$ROOT/scripts/infra/frozen-spellings.mjs" --self-test > "$WORK/frozen.txt" 2>&1 || STATUS=$?
if [ "$STATUS" -eq 0 ]; then
  record ok 'every frozen spelling is still spelled that way at its source'
else
  record fail 'every frozen spelling is still spelled that way at its source' "$(cat "$WORK/frozen.txt")"
fi
STATUS=0
node "$ROOT/scripts/infra/release-core.mjs" --self-test > "$WORK/core.txt" 2>&1 || STATUS=$?
if [ "$STATUS" -eq 0 ]; then
  record ok 'every failing direction of the deciding half is exercised'
else
  record fail 'every failing direction of the deciding half is exercised' "$(cat "$WORK/core.txt")"
fi
echo

# ---------------------------------------------------------------------------
# The scratch repository, and the public state fabricated in it
# ---------------------------------------------------------------------------
PUBLIC_REMOTE='https://github.com/practicalbonanza/PatientScribe-Viewer.git'
SCRATCH="$WORK/scratch"

scratch_repo() {
  mkdir -p "$1"
  git -C "$1" init -q -b main
  git -C "$1" config user.name 'viewer selftest'
  git -C "$1" config user.email 'viewer-selftest'
  cp -R "$ROOT/site" "$1/site"
  git -C "$1" add -A
  git -C "$1" commit -q -m 'the site as it is'
}

scratch_repo "$SCRATCH"
SITE_COMMIT=$(git -C "$SCRATCH" rev-parse HEAD)
COMMIT12=$(printf '%s' "$SITE_COMMIT" | cut -c1-12)

TARGET_ID="20260201T101500Z-${COMMIT12}"
RETAINED_ID="20260101T090000Z-${COMMIT12}"
STRANGER_ID="20251201T080000Z-${COMMIT12}"

for ONE in "$TARGET_ID" "$RETAINED_ID" "$STRANGER_ID"; do
  ( cd "$SCRATCH" && node "$BUILD" --out "$WORK/build" --release-id "$ONE" ) > "$WORK/build-$ONE.log" 2>&1
done

TARGET_DIR="$WORK/build/$TARGET_ID"

mkdir -p "$SCRATCH/releases"
cp "$TARGET_DIR/manifest.json" "$SCRATCH/releases/${TARGET_ID}.json"
cp "$WORK/build/$RETAINED_ID/manifest.json" "$SCRATCH/releases/${RETAINED_ID}.json"
git -C "$SCRATCH" add -A
git -C "$SCRATCH" commit -q -m 'publish two releases'
PUBLISHED=$(git -C "$SCRATCH" rev-parse HEAD)
git -C "$SCRATCH" remote add origin "$PUBLIC_REMOTE"
git -C "$SCRATCH" update-ref refs/remotes/origin/main "$PUBLISHED"

# ---------------------------------------------------------------------------
# The canned documents
# ---------------------------------------------------------------------------
ORIGIN_BUCKET_VALUE='viewer-origin-under-test'
LOG_BUCKET_VALUE='viewer-release-log-under-test'
LOG_PREFIX_VALUE='release-log/'
LOOPBACK='127.0.0.1:4173'

cat > "$WORK/overlay.json" <<'JSON'
[
  { "ParameterKey": "Environment", "ParameterValue": "dev" },
  { "ParameterKey": "AccountId", "ParameterValue": "account-under-test" },
  { "ParameterKey": "DomainName", "ParameterValue": "" }
]
JSON

write_stacks() {
  cat > "$1" <<JSON
{
  "Stacks": [
    {
      "StackName": "patientscribe-viewer-dev",
      "Outputs": [
        { "OutputKey": "DistributionId", "OutputValue": "EXAMPLEDISTID" },
        { "OutputKey": "DistributionDomainName", "OutputValue": "${LOOPBACK}" },
        { "OutputKey": "OriginBucket", "OutputValue": "${ORIGIN_BUCKET_VALUE}" },
        { "OutputKey": "ReleaseLogBucket", "OutputValue": "${LOG_BUCKET_VALUE}" },
        { "OutputKey": "ReleaseLogPrefix", "OutputValue": "$2" }
      ]
    }
  ]
}
JSON
}

write_stacks "$WORK/stacks.json" "$LOG_PREFIX_VALUE"
write_stacks "$WORK/stacks-empty-prefix.json" ''
write_stacks "$WORK/stacks-unterminated-prefix.json" 'release-log'

# The listing the origin answers with, built from the layout that will be on it.
listing_from_layout() {
  node -e '
    const { readdirSync, writeFileSync } = require("node:fs");
    const { join } = require("node:path");
    const root = process.argv[1];
    const keys = [];
    const walk = (at = "") => {
      for (const entry of readdirSync(join(root, at), { withFileTypes: true })) {
        const here = at === "" ? entry.name : at + "/" + entry.name;
        if (entry.isDirectory()) { walk(here); } else { keys.push(here); }
      }
    };
    walk();
    const extra = process.argv.slice(3).filter((one) => one !== "");
    const drop = process.env.DROP_KEY ?? "";
    const all = [...keys.filter((one) => one !== drop), ...extra].sort();
    writeFileSync(process.argv[2], JSON.stringify({ Contents: all.map((Key) => ({ Key })) }, null, 2) + "\n");
  ' "$1" "$2" "$3"
}

listing_from_layout "$TARGET_DIR/layout" "$WORK/listing.json" ''
DROP_KEY='index.html'; export DROP_KEY
listing_from_layout "$TARGET_DIR/layout" "$WORK/listing-no-entry.json" ''
unset DROP_KEY
listing_from_layout "$TARGET_DIR/layout" "$WORK/listing-extra.json" 'assets/zz.js'
printf '{"Contents": [{"Key": "index.html"}], "NextToken": "there-is-more"}\n' > "$WORK/listing-truncated.json"

printf 'InProgress\nCompleted\n' > "$WORK/statuses.txt"
printf 'InProgress\n' > "$WORK/statuses-stuck.txt"

# A document that carries two release comments, for the capture's second refusal.
{ cat "$WORK/build/$RETAINED_ID/layout/index.html"; printf '<!-- release: %s -->\n' "$TARGET_ID"; } > "$WORK/two-comments.html"

MIRROR="$WORK/origin"
mkdir -p "$MIRROR"

FAKE_AWS_TRANSCRIPT="$WORK/transcript.txt"; export FAKE_AWS_TRANSCRIPT
FAKE_AWS_ACCOUNT='account-under-test'; export FAKE_AWS_ACCOUNT
FAKE_AWS_STACKS="$WORK/stacks.json"; export FAKE_AWS_STACKS
FAKE_AWS_LISTING="$WORK/listing.json"; export FAKE_AWS_LISTING
FAKE_AWS_GET_OBJECT_BODY="$WORK/build/$RETAINED_ID/layout/index.html"; export FAKE_AWS_GET_OBJECT_BODY
FAKE_AWS_S3_ROOT="$MIRROR"; export FAKE_AWS_S3_ROOT
FAKE_AWS_S3_BUCKET="$ORIGIN_BUCKET_VALUE"; export FAKE_AWS_S3_BUCKET
FAKE_AWS_INVALIDATION_STATUSES="$WORK/statuses.txt"; export FAKE_AWS_INVALIDATION_STATUSES

# ---------------------------------------------------------------------------
# The local origin
# ---------------------------------------------------------------------------
node "$SERVE" "$MIRROR" > "$WORK/server.log" 2>&1 &
SERVER_PID=$!
WAITED=0
while [ "$WAITED" -lt 50 ]; do
  if grep -q 'listening' "$WORK/server.log" 2>/dev/null; then
    break
  fi
  sleep 0.2
  WAITED=$((WAITED + 1))
done
if grep -q 'listening' "$WORK/server.log" 2>/dev/null; then
  record ok 'the local origin is up on the one origin the committed table answers for'
else
  record fail 'the local origin is up on the one origin the committed table answers for' "$(cat "$WORK/server.log")"
fi

# ---------------------------------------------------------------------------
# Running the driver
# ---------------------------------------------------------------------------
LAST_STATUS=0
LAST_LABEL=''

run_switch() {
  LAST_LABEL="$1"
  shift
  : > "$FAKE_AWS_TRANSCRIPT"
  rm -f "${FAKE_AWS_INVALIDATION_STATUSES}.cursor"
  rm -rf "$MIRROR"
  mkdir -p "$MIRROR"
  LAST_STATUS=0
  ( cd "$SCRATCH" && sh "$SCRIPT" "$@" ) > "$WORK/out-${LAST_LABEL}.txt" 2>&1 || LAST_STATUS=$?
  cp "$FAKE_AWS_TRANSCRIPT" "$WORK/transcript-${LAST_LABEL}.txt"
}

switch_target() {
  run_switch "$1" dev --release-id "$TARGET_ID" --release-dir "$TARGET_DIR" --operation release \
    --profile patientscribe-dev --overlay "$WORK/overlay.json" \
    --retention-days 400 --poll-seconds 1 --timeout-seconds 5
}

out() {
  cat "$WORK/out-${1}.txt"
}

transcript() {
  cat "$WORK/transcript-${1}.txt"
}

expect_status() {
  if [ "$LAST_STATUS" -eq "$2" ]; then
    record ok "$1"
  else
    record fail "$1" "exit ${LAST_STATUS}: $(out "$LAST_LABEL")"
  fi
}

expect_no_mutation() {
  if grep -qE '^s3api put-object|^cloudfront create-invalidation' "$WORK/transcript-${LAST_LABEL}.txt"; then
    record fail "$1" "$(transcript "$LAST_LABEL")"
  else
    record ok "$1"
  fi
}

expect_nothing_logged() {
  if grep -q "$LOG_PREFIX_VALUE" "$WORK/transcript-${LAST_LABEL}.txt"; then
    record fail "$1" "$(transcript "$LAST_LABEL")"
  else
    record ok "$1"
  fi
}

# ---------------------------------------------------------------------------
# Disarmed
# ---------------------------------------------------------------------------
switch_target 'disarmed'
expect_status 'a disarmed run refuses' 3
if [ -s "$WORK/transcript-disarmed.txt" ]; then
  record fail 'a disarmed run makes no argv at all' "$(transcript disarmed)"
else
  record ok 'a disarmed run makes no argv at all'
fi

VIEWER_RELEASE_ARMED='armed-by-the-gate'
export VIEWER_RELEASE_ARMED

# ---------------------------------------------------------------------------
# An inherited account expectation
# ---------------------------------------------------------------------------
VIEWER_EXPECTED_ACCOUNT_ID='account-under-test'; export VIEWER_EXPECTED_ACCOUNT_ID
switch_target 'inherited-account'
unset VIEWER_EXPECTED_ACCOUNT_ID
expect_status 'an inherited VIEWER_EXPECTED_ACCOUNT_ID refuses outright' 2
expect_no_mutation 'the inherited-expectation refusal costs no aws argv'

# ---------------------------------------------------------------------------
# The numeric domains
# ---------------------------------------------------------------------------
for BAD in 0 -1 1.5 lots; do
  run_switch "poll-${BAD}" dev --release-id "$TARGET_ID" --release-dir "$TARGET_DIR" --operation release \
    --profile patientscribe-dev --overlay "$WORK/overlay.json" --poll-seconds "$BAD"
  expect_status "a --poll-seconds of ${BAD} refuses" 2
  expect_no_mutation "the ${BAD} refusal costs no aws argv"
done

run_switch 'timeout-short' dev --release-id "$TARGET_ID" --release-dir "$TARGET_DIR" --operation release \
  --profile patientscribe-dev --overlay "$WORK/overlay.json" --poll-seconds 30 --timeout-seconds 10
expect_status 'a timeout shorter than one poll interval refuses' 2

# ---------------------------------------------------------------------------
# The lock
# ---------------------------------------------------------------------------
#
# Two directions, and the difference between them is the whole of what the lock
# has to get right. A holder that is still running is another armed act, and the
# run refuses naming it. A holder that is GONE left its directory behind when it
# was killed outright — refusing that forever would strand the printed recovery
# command at exactly the moment the origin is mangled and nothing else is going
# to put it back — so it is cleared and the run proceeds.
sleep 60 &
LIVE_HOLDER=$!
mkdir -p "$WORK/build/.viewer-armed-act.lock"
printf 'drill drill %s run somebody-else pid %s\n' "$TARGET_ID" "$LIVE_HOLDER" > "$WORK/build/.viewer-armed-act.lock/holder"
switch_target 'locked'
expect_status 'a run refuses while a live armed act holds the lock' 1
if grep -q 'somebody-else' "$WORK/out-locked.txt"; then
  record ok 'the lock refusal names the holder'
else
  record fail 'the lock refusal names the holder' "$(out locked)"
fi
expect_no_mutation 'the lock refusal costs no mutation'
kill "$LIVE_HOLDER" 2>/dev/null || true
wait "$LIVE_HOLDER" 2>/dev/null || true
rm -rf "$WORK/build/.viewer-armed-act.lock"

sleep 0 &
DEAD_HOLDER=$!
wait "$DEAD_HOLDER" 2>/dev/null || true
mkdir -p "$WORK/build/.viewer-armed-act.lock"
printf 'drill drill %s run a-run-that-was-killed pid %s\n' "$TARGET_ID" "$DEAD_HOLDER" > "$WORK/build/.viewer-armed-act.lock/holder"
switch_target 'stale-lock'
expect_status 'a lock left by a run that is gone is cleared and the run proceeds' 0
if grep -q 'clearing a lock left behind' "$WORK/out-stale-lock.txt"; then
  record ok 'the run says it cleared a stale lock rather than doing it quietly'
else
  record fail 'the run says it cleared a stale lock rather than doing it quietly' "$(out stale-lock)"
fi
rm -rf "$WORK/build/.viewer-armed-act.lock"

# ---------------------------------------------------------------------------
# [0] The preflight refusals
# ---------------------------------------------------------------------------
run_switch 'unpublished' dev --release-id '20250101T000000Z-abcdefabcdef' --release-dir "$TARGET_DIR" --operation release \
  --profile patientscribe-dev --overlay "$WORK/overlay.json"
expect_status 'a release the public tip does not publish refuses' 1
if grep -q 'release-publish gate' "$WORK/out-unpublished.txt"; then
  record ok 'the refusal names the release-publish gate'
else
  record fail 'the refusal names the release-publish gate' "$(out unpublished)"
fi
expect_no_mutation 'the unpublished refusal costs no mutation'
expect_nothing_logged 'the unpublished refusal logs nothing'

# Committed on the local branch and not on the public tip: the same refusal, and
# it is the one a forgotten push produces.
cp "$WORK/build/$STRANGER_ID/manifest.json" "$SCRATCH/releases/${STRANGER_ID}.json"
git -C "$SCRATCH" add -A
git -C "$SCRATCH" commit -q -m 'a release committed and not pushed'
run_switch 'unpushed' dev --release-id "$STRANGER_ID" --release-dir "$WORK/build/$STRANGER_ID" --operation release \
  --profile patientscribe-dev --overlay "$WORK/overlay.json"
expect_status 'a release committed locally and not pushed refuses' 1
if grep -q 'release-publish gate' "$WORK/out-unpushed.txt"; then
  record ok 'the unpushed refusal names the release-publish gate too'
else
  record fail 'the unpushed refusal names the release-publish gate too' "$(out unpushed)"
fi

git -C "$SCRATCH" remote set-url origin 'https://example.invalid/practicalbonanza/PatientScribe-Viewer.git'
switch_target 'wrong-remote'
expect_status 'a wrong origin remote refuses' 1
expect_no_mutation 'the wrong-remote refusal costs no aws argv'
git -C "$SCRATCH" remote set-url origin "$PUBLIC_REMOTE"

cp -R "$TARGET_DIR" "$WORK/altered"
printf ' \n' >> "$WORK/altered/manifest.json"
run_switch 'altered-manifest' dev --release-id "$TARGET_ID" --release-dir "$WORK/altered" --operation release \
  --profile patientscribe-dev --overlay "$WORK/overlay.json"
expect_status 'a release directory whose manifest is not the published one refuses' 1
expect_no_mutation 'the altered-manifest refusal costs no mutation'

# ---------------------------------------------------------------------------
# Preflight refusals that need a damaged public tip: each in its own clone
# ---------------------------------------------------------------------------
clone_scratch() {
  cp -R "$SCRATCH" "$WORK/$1"
  git -C "$WORK/$1" checkout -q -- . 2>/dev/null || true
}

run_in_clone() {
  CLONE="$WORK/$1"
  LAST_LABEL="$2"
  shift 2
  : > "$FAKE_AWS_TRANSCRIPT"
  rm -f "${FAKE_AWS_INVALIDATION_STATUSES}.cursor"
  rm -rf "$MIRROR"
  mkdir -p "$MIRROR"
  LAST_STATUS=0
  ( cd "$CLONE" && sh "$SCRIPT" "$@" ) > "$WORK/out-${LAST_LABEL}.txt" 2>&1 || LAST_STATUS=$?
  cp "$FAKE_AWS_TRANSCRIPT" "$WORK/transcript-${LAST_LABEL}.txt"
}

publish_in_clone() {
  git -C "$WORK/$1" add -A
  git -C "$WORK/$1" commit -q -m "$2"
  git -C "$WORK/$1" update-ref refs/remotes/origin/main "$(git -C "$WORK/$1" rev-parse HEAD)"
}

# A stray entry under the releases tree.
clone_scratch 'clone-stray'
printf 'notes about releases\n' > "$WORK/clone-stray/releases/README.md"
publish_in_clone 'clone-stray' 'a stray file under releases/'
run_in_clone 'clone-stray' 'stray' dev --release-id "$TARGET_ID" --release-dir "$TARGET_DIR" --operation release \
  --profile patientscribe-dev --overlay "$WORK/overlay.json"
expect_status 'a stray entry under the public tip'"'"'s releases tree refuses' 1
expect_no_mutation 'the stray-entry refusal costs no aws argv'

# A duplicate member name in a published manifest.
clone_scratch 'clone-duplicate'
node -e '
  const { readFileSync, writeFileSync } = require("node:fs");
  const text = readFileSync(process.argv[1], "utf8");
  writeFileSync(process.argv[2], text.replace("\"commit\"", "\"schema\": \"viewer-release-manifest/1\",\n  \"commit\""));
' "$SCRATCH/releases/${RETAINED_ID}.json" "$WORK/clone-duplicate/releases/${RETAINED_ID}.json"
publish_in_clone 'clone-duplicate' 'a retained manifest that states a field twice'
run_in_clone 'clone-duplicate' 'duplicate' dev --release-id "$TARGET_ID" --release-dir "$TARGET_DIR" --operation release \
  --profile patientscribe-dev --overlay "$WORK/overlay.json"
expect_status 'a retained manifest with a duplicate member name refuses' 1
if grep -q 'more than once' "$WORK/out-duplicate.txt"; then
  record ok 'the duplicate refusal names the member stated twice'
else
  record fail 'the duplicate refusal names the member stated twice' "$(out duplicate)"
fi
expect_no_mutation 'the duplicate refusal costs no aws argv'

# A wrong schema in a published manifest.
clone_scratch 'clone-schema'
sed 's|viewer-release-manifest/1|viewer-release-manifest/2|' "$SCRATCH/releases/${TARGET_ID}.json" \
  > "$WORK/clone-schema/releases/${TARGET_ID}.json"
cp "$WORK/clone-schema/releases/${TARGET_ID}.json" "$WORK/schema-dir-manifest.json"
publish_in_clone 'clone-schema' 'a manifest naming a schema this is not'
mkdir -p "$WORK/schema-dir"
cp -R "$TARGET_DIR/layout" "$WORK/schema-dir/layout"
cp "$WORK/schema-dir-manifest.json" "$WORK/schema-dir/manifest.json"
run_in_clone 'clone-schema' 'schema' dev --release-id "$TARGET_ID" --release-dir "$WORK/schema-dir" --operation release \
  --profile patientscribe-dev --overlay "$WORK/overlay.json"
expect_status 'a published manifest naming the wrong schema refuses' 1
expect_no_mutation 'the wrong-schema refusal costs no aws argv'

# A manifest whose release_id is not its roster filename.
clone_scratch 'clone-misfiled'
MISFILED_ID="20260301T110000Z-${COMMIT12}"
cp "$SCRATCH/releases/${TARGET_ID}.json" "$WORK/clone-misfiled/releases/${MISFILED_ID}.json"
publish_in_clone 'clone-misfiled' 'a manifest filed under another release'
mkdir -p "$WORK/misfiled-dir"
cp -R "$TARGET_DIR/layout" "$WORK/misfiled-dir/layout"
cp "$TARGET_DIR/manifest.json" "$WORK/misfiled-dir/manifest.json"
run_in_clone 'clone-misfiled' 'misfiled' dev --release-id "$MISFILED_ID" --release-dir "$WORK/misfiled-dir" --operation release \
  --profile patientscribe-dev --overlay "$WORK/overlay.json"
expect_status 'a valid manifest sitting in another release'"'"'s file refuses' 1
expect_no_mutation 'the misfiled refusal costs no aws argv'

# A doctored config digest: the binding preflight, before anything is called.
clone_scratch 'clone-config'
node "$ROOT/scripts/infra/drill-core.mjs" --doctor-manifest "$SCRATCH/releases/${TARGET_ID}.json" "$WORK/config-doctored.json" > /dev/null
node -e '
  const { readFileSync, writeFileSync } = require("node:fs");
  const text = readFileSync(process.argv[1], "utf8");
  const parsed = JSON.parse(text);
  const was = parsed.objects["/js/config.js"];
  const hex = "0123456789abcdef";
  const now = was.slice(0, -1) + hex[(hex.indexOf(was.slice(-1)) + 1) % 16];
  writeFileSync(process.argv[2], text.replace(was, now));
' "$SCRATCH/releases/${TARGET_ID}.json" "$WORK/clone-config/releases/${TARGET_ID}.json"
cp "$WORK/clone-config/releases/${TARGET_ID}.json" "$WORK/config-dir-manifest.json"
publish_in_clone 'clone-config' 'a manifest binding a different origin table'
mkdir -p "$WORK/config-dir"
cp -R "$TARGET_DIR/layout" "$WORK/config-dir/layout"
cp "$WORK/config-dir-manifest.json" "$WORK/config-dir/manifest.json"
run_in_clone 'clone-config' 'config-binding' dev --release-id "$TARGET_ID" --release-dir "$WORK/config-dir" --operation release \
  --profile patientscribe-dev --overlay "$WORK/overlay.json"
expect_status 'a manifest binding an origin table this checkout does not hold refuses' 1
if grep -q 'connect-src' "$WORK/out-config-binding.txt"; then
  record ok 'the config-binding refusal says what it is about'
else
  record fail 'the config-binding refusal says what it is about' "$(out config-binding)"
fi
expect_no_mutation 'the config-binding refusal costs no aws argv'

# A doctored entry-point digest: reconstruction refuses it.
clone_scratch 'clone-reconstruct'
node "$ROOT/scripts/infra/drill-core.mjs" --doctor-manifest "$SCRATCH/releases/${TARGET_ID}.json" \
  "$WORK/clone-reconstruct/releases/${TARGET_ID}.json" > /dev/null
cp "$WORK/clone-reconstruct/releases/${TARGET_ID}.json" "$WORK/reconstruct-manifest.json"
publish_in_clone 'clone-reconstruct' 'a manifest this repository does not produce'
mkdir -p "$WORK/reconstruct-dir"
cp -R "$TARGET_DIR/layout" "$WORK/reconstruct-dir/layout"
cp "$WORK/reconstruct-manifest.json" "$WORK/reconstruct-dir/manifest.json"
run_in_clone 'clone-reconstruct' 'reconstruct' dev --release-id "$TARGET_ID" --release-dir "$WORK/reconstruct-dir" --operation release \
  --profile patientscribe-dev --overlay "$WORK/overlay.json"
expect_status 'a manifest that is not what the repository produces at its commit refuses' 1
if grep -q 'rebuilt\|produces' "$WORK/out-reconstruct.txt"; then
  record ok 'the reconstruction refusal says the repository does not produce it'
else
  record fail 'the reconstruction refusal says the repository does not produce it' "$(out reconstruct)"
fi
expect_no_mutation 'the reconstruction refusal costs no aws argv'

# A site tree that has moved since the release was built.
clone_scratch 'clone-moved'
printf '\n<!-- a later change to the site -->\n' >> "$WORK/clone-moved/site/index.html"
publish_in_clone 'clone-moved' 'a change inside site/ after the release'
run_in_clone 'clone-moved' 'moved-tree' dev --release-id "$TARGET_ID" --release-dir "$TARGET_DIR" --operation release \
  --profile patientscribe-dev --overlay "$WORK/overlay.json"
expect_status 'a checkout whose site tree is not the release'"'"'s refuses' 1
if grep -q 'worktree' "$WORK/out-moved-tree.txt"; then
  record ok 'the tree-inequality refusal names the rollback procedure'
else
  record fail 'the tree-inequality refusal names the rollback procedure' "$(out moved-tree)"
fi

# A commit that is not an ancestor of the public tip.
clone_scratch 'clone-orphan'
git -C "$WORK/clone-orphan" checkout -q --orphan sideline
git -C "$WORK/clone-orphan" add -A
git -C "$WORK/clone-orphan" commit -q -m 'a tip with no shared history'
ORPHAN=$(git -C "$WORK/clone-orphan" rev-parse HEAD)
git -C "$WORK/clone-orphan" checkout -q main
git -C "$WORK/clone-orphan" update-ref refs/remotes/origin/main "$ORPHAN"
run_in_clone 'clone-orphan' 'orphan' dev --release-id "$TARGET_ID" --release-dir "$TARGET_DIR" --operation release \
  --profile patientscribe-dev --overlay "$WORK/overlay.json"
expect_status 'a manifest commit that is not an ancestor of the public tip refuses' 1
if grep -q 'ancestor' "$WORK/out-orphan.txt"; then
  record ok 'the ancestry refusal says so'
else
  record fail 'the ancestry refusal says so' "$(out orphan)"
fi

# A LOCAL BRANCH literally named origin/main. Git's own search order puts
# refs/heads ahead of refs/remotes, so a short spelling would resolve to this
# rather than to the remote-tracking ref — and a commit nobody pushed would be
# standing in for the public tip. The branch here points at a commit that
# publishes nothing, so a run that read it could not possibly succeed.
clone_scratch 'clone-dwim'
git -C "$WORK/clone-dwim" branch 'origin/main' "$SITE_COMMIT"
run_in_clone 'clone-dwim' 'dwim' dev --release-id "$TARGET_ID" --release-dir "$TARGET_DIR" --operation release \
  --profile patientscribe-dev --overlay "$WORK/overlay.json" \
  --retention-days 400 --poll-seconds 1 --timeout-seconds 5
expect_status 'a local branch named origin/main does not stand in for the public tip' 0

# And the other way round: with the remote-tracking ref gone and only the local
# branch of that name left, there is no public tip at all.
clone_scratch 'clone-no-tracking-ref'
git -C "$WORK/clone-no-tracking-ref" branch 'origin/main' \
  "$(git -C "$WORK/clone-no-tracking-ref" rev-parse refs/remotes/origin/main)"
git -C "$WORK/clone-no-tracking-ref" update-ref -d refs/remotes/origin/main
run_in_clone 'clone-no-tracking-ref' 'no-tracking-ref' dev --release-id "$TARGET_ID" --release-dir "$TARGET_DIR" --operation release \
  --profile patientscribe-dev --overlay "$WORK/overlay.json"
expect_status 'with only a local branch of that name there is no public tip' 1
if grep -q 'no public tip' "$WORK/out-no-tracking-ref.txt"; then
  record ok 'the refusal says there is no public tip'
else
  record fail 'the refusal says there is no public tip' "$(out no-tracking-ref)"
fi
expect_no_mutation 'the no-public-tip refusal costs no aws argv'

# ---------------------------------------------------------------------------
# The resolved log prefix
# ---------------------------------------------------------------------------
FAKE_AWS_STACKS="$WORK/stacks-empty-prefix.json"
switch_target 'empty-prefix'
expect_status 'a stack stating an empty release-log prefix refuses' 1
expect_no_mutation 'the empty-prefix refusal costs no mutation'

FAKE_AWS_STACKS="$WORK/stacks-unterminated-prefix.json"
switch_target 'unterminated-prefix'
expect_status 'a release-log prefix with no trailing slash refuses' 1
expect_no_mutation 'the unterminated-prefix refusal costs no mutation'

FAKE_AWS_STACKS="$WORK/stacks.json"

# ---------------------------------------------------------------------------
# [2] The prior-release capture
# ---------------------------------------------------------------------------
FAKE_AWS_LISTING="$WORK/listing-truncated.json"
switch_target 'truncated'
expect_status 'a truncated listing refuses' 1
expect_no_mutation 'the truncated-listing refusal costs no mutation'
FAKE_AWS_LISTING="$WORK/listing.json"

FAKE_AWS_GET_OBJECT_FAILS='yes'; export FAKE_AWS_GET_OBJECT_FAILS
switch_target 'get-object-fails'
unset FAKE_AWS_GET_OBJECT_FAILS
expect_status 'a get-object failure after a positive listing refuses' 1
expect_no_mutation 'the failed capture costs no mutation'
expect_nothing_logged 'the failed capture logs nothing'

FAKE_AWS_GET_OBJECT_BODY="$WORK/build/$STRANGER_ID/layout/index.html"
switch_target 'prior-not-on-roster'
FAKE_AWS_GET_OBJECT_BODY="$WORK/build/$RETAINED_ID/layout/index.html"
expect_status 'a served release the public tip does not publish refuses' 1
if grep -q 'kill path' "$WORK/out-prior-not-on-roster.txt"; then
  record ok 'the refusal names the kill path as the manual out'
else
  record fail 'the refusal names the kill path as the manual out' "$(out prior-not-on-roster)"
fi
expect_no_mutation 'the prior-not-on-roster refusal costs no mutation'
expect_nothing_logged 'the prior-not-on-roster refusal logs nothing'

FAKE_AWS_GET_OBJECT_BODY="$WORK/two-comments.html"
switch_target 'two-comments'
FAKE_AWS_GET_OBJECT_BODY="$WORK/build/$RETAINED_ID/layout/index.html"
expect_status 'a served document carrying two release comments refuses' 1
expect_no_mutation 'the two-comment refusal costs no mutation'

FAKE_AWS_PUT_FAILS='switch-started'; export FAKE_AWS_PUT_FAILS
switch_target 'started-put-fails'
unset FAKE_AWS_PUT_FAILS
expect_status 'a switch-started write that fails refuses' 1
LAST_CALL=$(tail -1 "$WORK/transcript-started-put-fails.txt")
case "$LAST_CALL" in
  's3api put-object'*'switch-started'*)
    record ok 'nothing is called after the failed switch-started write'
    ;;
  *)
    record fail 'nothing is called after the failed switch-started write' "last call: ${LAST_CALL}"
    ;;
esac

# ---------------------------------------------------------------------------
# The happy path
# ---------------------------------------------------------------------------
switch_target 'happy'
expect_status 'the switch runs and the wire check exits 0' 0

HAPPY="$WORK/transcript-happy.txt"

FIRST_CALL=$(head -1 "$HAPPY")
case "$FIRST_CALL" in
  'sts get-caller-identity'*) record ok 'the identity call is the first call made' ;;
  *) record fail 'the identity call is the first call made' "first line: ${FIRST_CALL}" ;;
esac

OFF_REGION=$(grep -v -- '--region us-east-1' "$HAPPY" || true)
if [ -z "$OFF_REGION" ]; then
  record ok 'every call carries the pinned region'
else
  record fail 'every call carries the pinned region' "$OFF_REGION"
fi

UNPARSED=$(grep -E '^cloudformation describe-stacks|^s3api list-objects-v2|^s3api get-object|^cloudfront ' "$HAPPY" \
  | grep -v -- '--output json' || true)
if [ -z "$UNPARSED" ]; then
  record ok 'every call whose output is parsed carries --output json'
else
  record fail 'every call whose output is parsed carries --output json' "$UNPARSED"
fi

if grep -q '^sts get-caller-identity --query Account --output text' "$HAPPY"; then
  record ok 'the one sts call keeps the account assertion'"'"'s own accepted shape'
else
  record fail 'the one sts call keeps the account assertion'"'"'s own accepted shape' "$(grep '^sts ' "$HAPPY")"
fi

CFN=$(grep -c '^cloudformation ' "$HAPPY" || true)
if [ "$CFN" -eq 1 ] && grep -q '^cloudformation describe-stacks ' "$HAPPY"; then
  record ok 'describe-stacks is the only cloudformation call this round makes'
else
  record fail 'describe-stacks is the only cloudformation call this round makes' "$(grep '^cloudformation ' "$HAPPY")"
fi

if grep -q -- '--parameter-overrides' "$HAPPY"; then
  record fail 'no call carries --parameter-overrides' "$HAPPY"
else
  record ok 'no call carries --parameter-overrides'
fi

if grep -q -- "--bucket ${ORIGIN_BUCKET_VALUE}" "$HAPPY" && grep -q -- "--distribution-id EXAMPLEDISTID" "$HAPPY"; then
  record ok 'the targets come from the canned stack outputs'
else
  record fail 'the targets come from the canned stack outputs' "$HAPPY"
fi

ENTRY_AT=$(grep -n '^s3api put-object .*--key index.html ' "$HAPPY" | head -1 | cut -d: -f1)
CONFIG_AT=$(grep -n '^s3api put-object .*--key js/config.js ' "$HAPPY" | head -1 | cut -d: -f1)
ASSET_AT=$(grep -n '^s3api put-object .*--key assets/' "$HAPPY" | head -1 | cut -d: -f1)
if [ -n "$ENTRY_AT" ] && [ -n "$CONFIG_AT" ] && [ -n "$ASSET_AT" ] && [ "$CONFIG_AT" -lt "$ENTRY_AT" ] && [ "$ASSET_AT" -lt "$ENTRY_AT" ]; then
  record ok 'the assets and the origin table are put strictly before the entry point'
else
  record fail 'the assets and the origin table are put strictly before the entry point' "$HAPPY"
fi

BAD_KEYS=$(awk '{for (i = 1; i < NF; i++) if ($i == "--key") print $(i + 1)}' "$HAPPY" | grep '^/' || true)
if [ -z "$BAD_KEYS" ]; then
  record ok 'no key carries a leading slash'
else
  record fail 'no key carries a leading slash' "$BAD_KEYS"
fi

if awk '{for (i = 1; i < NF; i++) if ($i == "--key") print $(i + 1)}' "$HAPPY" | grep -qx 'index.html'; then
  record ok 'the entry point'"'"'s key is spelled exactly index.html'
else
  record fail 'the entry point'"'"'s key is spelled exactly index.html' "$HAPPY"
fi

if grep -q -- '--key js/config.js .*--content-type text/javascript; charset=utf-8' "$HAPPY" \
  && ! grep -- '--key js/config.js ' "$HAPPY" | grep -q -- '--cache-control'; then
  record ok 'the origin table is put as a document, with no cache directive of its own'
else
  record fail 'the origin table is put as a document, with no cache directive of its own' "$(grep -- '--key js/config.js ' "$HAPPY")"
fi

if grep -- '--key assets/' "$HAPPY" | grep -q -- '--cache-control public, max-age=31536000, immutable'; then
  record ok 'every asset carries the immutable directive as object metadata'
else
  record fail 'every asset carries the immutable directive as object metadata' "$(grep -- '--key assets/' "$HAPPY" | head -2)"
fi

INVALIDATIONS=$(grep -c '^cloudfront create-invalidation' "$HAPPY" || true)
if [ "$INVALIDATIONS" -eq 1 ]; then
  record ok 'exactly one invalidation batch is created'
else
  record fail 'exactly one invalidation batch is created' "${INVALIDATIONS} of them"
fi
if grep -q '^cloudfront create-invalidation --distribution-id EXAMPLEDISTID --paths / /index.html --output json ' "$HAPPY"; then
  record ok 'the batch covers exactly / and /index.html, in the pinned spelling'
else
  record fail 'the batch covers exactly / and /index.html, in the pinned spelling' "$(grep '^cloudfront create-invalidation' "$HAPPY")"
fi
if grep -q -- '--invalidation-batch' "$HAPPY"; then
  record fail 'the invalidation is not written as a batch document' "$HAPPY"
else
  record ok 'the invalidation is not written as a batch document'
fi

POLLS=$(grep -c '^cloudfront get-invalidation' "$HAPPY" || true)
if [ "$POLLS" -eq 2 ]; then
  record ok 'the poll loop read the canned InProgress and then the canned Completed'
else
  record fail 'the poll loop read the canned InProgress and then the canned Completed' "${POLLS} poll(s)"
fi

LOG_PUTS=$(grep -c -- "--key ${LOG_PREFIX_VALUE}" "$HAPPY" || true)
if [ "$LOG_PUTS" -eq 2 ]; then
  record ok 'the run wrote a started and a succeeded event under the canned prefix'
else
  record fail 'the run wrote a started and a succeeded event under the canned prefix' "${LOG_PUTS} event(s)"
fi
if grep -q -- "--key ${LOG_PREFIX_VALUE}${TARGET_ID}/[0-9]*T[0-9]*Z-[0-9a-f]*/01-switch-started.json" "$HAPPY"; then
  record ok 'the first event is 01-switch-started.json, under <prefix><release>/<run>/'
else
  record fail 'the first event is 01-switch-started.json, under <prefix><release>/<run>/' "$(grep -- "--key ${LOG_PREFIX_VALUE}" "$HAPPY")"
fi
if grep -q -- '02-switch-succeeded.json' "$HAPPY"; then
  record ok 'the sequence advances to 02 for the second event'
else
  record fail 'the sequence advances to 02 for the second event' "$(grep -- "--key ${LOG_PREFIX_VALUE}" "$HAPPY")"
fi
LOG_LINES=$(grep -- "--key ${LOG_PREFIX_VALUE}" "$HAPPY")
if printf '%s\n' "$LOG_LINES" | grep -vq -- '--if-none-match \*'; then
  record fail 'every log put is a conditional write' "$LOG_LINES"
else
  record ok 'every log put is a conditional write'
fi
if printf '%s\n' "$LOG_LINES" | grep -vq -- '--content-type application/json'; then
  record fail 'every log put is application/json' "$LOG_LINES"
else
  record ok 'every log put is application/json'
fi
if printf '%s\n' "$LOG_LINES" | grep -vq -- '--object-lock-mode GOVERNANCE --object-lock-retain-until-date'; then
  record fail 'every log put carries its retention' "$LOG_LINES"
else
  record ok 'every log put carries its retention'
fi
if printf '%s\n' "$LOG_LINES" | grep -q -- "--bucket ${LOG_BUCKET_VALUE}"; then
  record ok 'the log lands in the release-log bucket the stack names'
else
  record fail 'the log lands in the release-log bucket the stack names' "$LOG_LINES"
fi

# The run says which record area it took, so that is where this looks. Picking
# the newest directory off the filesystem sorts two runs of the same second by
# their random suffix, which is a gate that reads whichever one it feels like.
RECORD_DIR=$(sed -n 's/^release — record area //p' "$WORK/out-happy.txt" | head -1)
if [ -d "$RECORD_DIR" ]; then
  record ok 'the run named its own record area'
else
  record fail 'the run named its own record area' "${RECORD_DIR}"
fi
ARGV=$(cat "$RECORD_DIR/release-check.txt.argv")
case "$ARGV" in
  "http://${LOOPBACK} "*"--inventory "*"--union "*) record ok 'the check argv carries the resolved origin, the inventory and the roster' ;;
  *) record fail 'the check argv carries the resolved origin, the inventory and the roster' "$ARGV" ;;
esac
if printf '%s' "$ARGV" | grep -q -- "--union .*retained-${RETAINED_ID}.json"; then
  record ok 'the other published release arrives as --union'
else
  record fail 'the other published release arrives as --union' "$ARGV"
fi
if printf '%s' "$ARGV" | grep -q -- "--union .*retained-${TARGET_ID}.json" \
  || printf '%s' "$ARGV" | grep -q -- '--union .*target-manifest.json'; then
  record fail 'the target'"'"'s own manifest never arrives as --union' "$ARGV"
else
  record ok 'the target'"'"'s own manifest never arrives as --union'
fi
UNION_COUNT=$(printf '%s\n' "$ARGV" | tr ' ' '\n' | grep -c -- '^--union$' || true)
if [ "$UNION_COUNT" -eq 1 ]; then
  record ok 'the roster of two publishes exactly one retained manifest to the check'
else
  record fail 'the roster of two publishes exactly one retained manifest to the check' "${UNION_COUNT} of them"
fi
if grep -q 'PASS — every predicate held' "$RECORD_DIR/release-check.txt"; then
  record ok 'the real oracle passed against the real local origin'
else
  record fail 'the real oracle passed against the real local origin' "$(cat "$RECORD_DIR/release-check.txt")"
fi
if grep -q '"/index.html"' "$RECORD_DIR/inventory.json" && grep -q 'viewer-origin-inventory/1' "$RECORD_DIR/inventory.json"; then
  record ok 'the merged listing produced the inventory the check reads'
else
  record fail 'the merged listing produced the inventory the check reads' "$(cat "$RECORD_DIR/inventory.json")"
fi

HAPPY_TRANSCRIPT=$(cat "$HAPPY")
HAPPY_OUTPUT=$(out happy)

# ---------------------------------------------------------------------------
# The no-prior-release direction
# ---------------------------------------------------------------------------
FAKE_AWS_LISTING="$WORK/listing-no-entry.json"
switch_target 'no-prior'
expect_status 'a run against an origin with no entry point ends nonzero here' 1
if grep -q '^s3api get-object' "$WORK/transcript-no-prior.txt"; then
  record fail 'no get-object is issued when the listing decides there is no prior release' "$(transcript no-prior)"
else
  record ok 'no get-object is issued when the listing decides there is no prior release'
fi
if grep -q 'no-prior-release' "$WORK/out-no-prior.txt"; then
  record ok 'the run records no-prior-release'
else
  record fail 'the run records no-prior-release' "$(out no-prior)"
fi
if grep -q 'disable the' "$WORK/out-no-prior.txt"; then
  record ok 'the no-prior remediation is the kill path'
else
  record fail 'the no-prior remediation is the kill path' "$(out no-prior)"
fi
FAKE_AWS_LISTING="$WORK/listing.json"

# ---------------------------------------------------------------------------
# The logged failure directions
# ---------------------------------------------------------------------------
FAKE_AWS_PUT_FAILS='assets/'; export FAKE_AWS_PUT_FAILS
switch_target 'upload-fails'
unset FAKE_AWS_PUT_FAILS
expect_status 'a failed object upload fails the switch' 1
if grep -q 'switch-failed' "$WORK/transcript-upload-fails.txt"; then
  record ok 'a failed upload logs switch-failed'
else
  record fail 'a failed upload logs switch-failed' "$(transcript upload-fails)"
fi
if grep -q 'THE WAY OUT IS FORWARD' "$WORK/out-upload-fails.txt" && grep -q 'VIEWER_RELEASE_ARMED=armed-by-the-gate' "$WORK/out-upload-fails.txt"; then
  record ok 'a [3] failure prints the same-invocation re-run'
else
  record fail 'a [3] failure prints the same-invocation re-run' "$(out upload-fails)"
fi
if grep -q 'ABANDONED' "$WORK/out-upload-fails.txt"; then
  record ok 'a [3] failure names the abandoned-release corner'
else
  record fail 'a [3] failure names the abandoned-release corner' "$(out upload-fails)"
fi

FAKE_AWS_PUT_FAILS='index.html'; export FAKE_AWS_PUT_FAILS
switch_target 'entry-put-fails'
unset FAKE_AWS_PUT_FAILS
expect_status 'a failed entry-point put fails the switch' 1
if grep -q 'SERVED DOCUMENT IS UNKNOWN' "$WORK/out-entry-put-fails.txt"; then
  record ok 'a [4] failure states that the served document is unknown'
else
  record fail 'a [4] failure states that the served document is unknown' "$(out entry-put-fails)"
fi
# The prior release is named in the LOG DETAIL, which is the record that outlives
# the terminal this run was watched in. Read out of the event body the run wrote,
# in the record area the run itself named.
ENTRY_RECORD=$(sed -n 's/^release — record area //p' "$WORK/out-entry-put-fails.txt" | head -1)
if grep -q "prior release ${RETAINED_ID}" "$ENTRY_RECORD"/*-switch-failed.json 2>/dev/null; then
  record ok 'a failing run from the first mutating put onward names the recorded prior release in its log detail'
else
  record fail 'a failing run from the first mutating put onward names the recorded prior release in its log detail' \
    "$(cat "$ENTRY_RECORD"/*-switch-failed.json 2>/dev/null || echo 'no switch-failed event was written')"
fi

FAKE_AWS_INVALIDATION_STATUSES="$WORK/statuses-stuck.txt"
switch_target 'invalidation-times-out'
FAKE_AWS_INVALIDATION_STATUSES="$WORK/statuses.txt"
expect_status 'an invalidation that never completes fails the switch' 1
if grep -q 'switch-failed' "$WORK/transcript-invalidation-times-out.txt"; then
  record ok 'a timed-out invalidation logs switch-failed'
else
  record fail 'a timed-out invalidation logs switch-failed' "$(transcript invalidation-times-out)"
fi
if grep -q 'THE WAY OUT IS BACK' "$WORK/out-invalidation-times-out.txt" && grep -q 'git worktree add' "$WORK/out-invalidation-times-out.txt"; then
  record ok 'a [5] failure prints the rollback procedure with its rebuild step'
else
  record fail 'a [5] failure prints the rollback procedure with its rebuild step' "$(out invalidation-times-out)"
fi
if grep -q "$RETAINED_ID" "$WORK/out-invalidation-times-out.txt"; then
  record ok 'the rollback print names the prior release it was captured with'
else
  record fail 'the rollback print names the prior release it was captured with' "$(out invalidation-times-out)"
fi

# ---------------------------------------------------------------------------
# A run that is signalled has to END
# ---------------------------------------------------------------------------
#
# A trapped signal in this shell runs its handler and then carries on. A handler
# that only released the lock would leave a run still uploading while the next
# armed act was free to start beside it. So the run is interrupted while it waits
# on an invalidation that never completes, and it has to be over — not merely
# unlocked — when the signal has been handled.
FAKE_AWS_INVALIDATION_STATUSES="$WORK/statuses-stuck.txt"
: > "$FAKE_AWS_TRANSCRIPT"
rm -f "${FAKE_AWS_INVALIDATION_STATUSES}.cursor"
rm -rf "$MIRROR"
mkdir -p "$MIRROR"
( cd "$SCRATCH" && exec sh "$SCRIPT" dev --release-id "$TARGET_ID" --release-dir "$TARGET_DIR" --operation release \
  --profile patientscribe-dev --overlay "$WORK/overlay.json" --poll-seconds 1 --timeout-seconds 20 ) \
  > "$WORK/out-signalled.txt" 2>&1 &
SWITCH_PID=$!

WAITED=0
while [ "$WAITED" -lt 300 ]; do
  if grep -q '^cloudfront get-invalidation' "$FAKE_AWS_TRANSCRIPT" 2>/dev/null; then
    break
  fi
  sleep 0.2
  WAITED=$((WAITED + 1))
done

kill -TERM "$SWITCH_PID" 2>/dev/null || true
SIGNAL_STATUS=0
wait "$SWITCH_PID" 2>/dev/null || SIGNAL_STATUS=$?
if [ "$SIGNAL_STATUS" -eq 130 ]; then
  record ok 'a signalled run ends, rather than carrying on with its lock released'
else
  record fail 'a signalled run ends, rather than carrying on with its lock released' \
    "exit ${SIGNAL_STATUS}: $(cat "$WORK/out-signalled.txt")"
fi
if [ -d "$WORK/build/.viewer-armed-act.lock" ]; then
  record fail 'and it released its lock on the way out' 'the lock directory is still there'
else
  record ok 'and it released its lock on the way out'
fi
FAKE_AWS_INVALIDATION_STATUSES="$WORK/statuses.txt"

FAKE_AWS_LISTING="$WORK/listing-extra.json"
switch_target 'check-refuses'
expect_status 'a nonzero check exit fails the switch' 1
if grep -q 'THE WAY OUT IS BACK' "$WORK/out-check-refuses.txt"; then
  record ok 'a [7] failure prints the rollback procedure'
else
  record fail 'a [7] failure prints the rollback procedure' "$(out check-refuses)"
fi
if grep -q 'READ THE REFUSALS FIRST' "$WORK/out-check-refuses.txt"; then
  record ok 'a [7] failure tells the operator to read the refusals'
else
  record fail 'a [7] failure tells the operator to read the refusals' "$(out check-refuses)"
fi
FAKE_AWS_LISTING="$WORK/listing.json"

FAKE_AWS_PUT_FAILS='switch-succeeded'; export FAKE_AWS_PUT_FAILS
switch_target 'succeeded-put-fails'
unset FAKE_AWS_PUT_FAILS
expect_status 'a failed switch-succeeded write exits nonzero' 1
if grep -q 'VERIFIED GREEN' "$WORK/out-succeeded-put-fails.txt"; then
  record ok 'it states that the switch itself is verified and only the record is missing'
else
  record fail 'it states that the switch itself is verified and only the record is missing' "$(out succeeded-put-fails)"
fi

# ---------------------------------------------------------------------------
# The transcripts
# ---------------------------------------------------------------------------
echo
echo 'transcript of the passing switch:'
printf '%s\n' "$HAPPY_TRANSCRIPT" | sed 's/^/  /'
echo
echo 'output of the passing switch:'
printf '%s\n' "$HAPPY_OUTPUT" | sed 's/^/  /'
echo

if [ "$FAILURES" -eq 0 ]; then
  echo 'release self-test — PASS'
  exit 0
fi
echo "release self-test — FAIL (${FAILURES} case(s))"
exit 1
