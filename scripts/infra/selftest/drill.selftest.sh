#!/bin/sh
#
# The acceptance drill, rehearsed end to end without a cloud.
#
# This is the dark rehearsal of the thing that will be done for real against the
# dev origin at the gate. The fake CLI's put writes into the directory a real
# local origin is serving, the canned stack outputs steer the driver's own origin
# resolution to that origin, and the REAL release check runs against it over a
# real socket. So D1's mangle actually reddens the oracle and D2's restore
# actually returns it to green — both verdicts are printed below, from the
# oracle's own output.
#
# The subject is the same scratch-repository posture the switch self-test uses:
# the real site/ copied into a fresh repository, two releases built and published
# under releases/, the origin remote set to the committed public path, and
# refs/remotes/origin/main pointed at that commit. The driver reads its git
# context from the working directory, so the whole target-and-roster-and-
# provenance regime runs against a repository whose public tip really does
# publish the target.
#
# Exit codes: 0 = every case held, 1 = one did not.

set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
SCRIPT="$ROOT/scripts/infra/drill.sh"
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
unset VIEWER_RELEASE_ARMED || true

FAILURES=0

record() {
  if [ "$1" = 'ok' ]; then
    printf '  ok   %s\n' "$2"
  else
    FAILURES=$((FAILURES + 1))
    printf '  FAIL %s — %s\n' "$2" "$3"
  fi
}

echo 'the deciding half:'
STATUS=0
node "$ROOT/scripts/infra/drill-core.mjs" --self-test > "$WORK/core.txt" 2>&1 || STATUS=$?
if [ "$STATUS" -eq 0 ]; then
  record ok 'both mangles do exactly what they say and nothing else'
else
  record fail 'both mangles do exactly what they say and nothing else' "$(cat "$WORK/core.txt")"
fi
echo

# ---------------------------------------------------------------------------
# The scratch repository and the published roster
# ---------------------------------------------------------------------------
PUBLIC_REMOTE='https://github.com/practicalbonanza/PatientScribe-Viewer.git'
SCRATCH="$WORK/scratch"
mkdir -p "$SCRATCH"
git -C "$SCRATCH" init -q -b main
git -C "$SCRATCH" config user.name 'viewer selftest'
git -C "$SCRATCH" config user.email 'viewer-selftest'
cp -R "$ROOT/site" "$SCRATCH/site"
git -C "$SCRATCH" add -A
git -C "$SCRATCH" commit -q -m 'the site as it is'

SITE_COMMIT=$(git -C "$SCRATCH" rev-parse HEAD)
COMMIT12=$(printf '%s' "$SITE_COMMIT" | cut -c1-12)
TARGET_ID="20260201T101500Z-${COMMIT12}"
RETAINED_ID="20260101T090000Z-${COMMIT12}"

for ONE in "$TARGET_ID" "$RETAINED_ID"; do
  ( cd "$SCRATCH" && node "$BUILD" --out "$WORK/build" --release-id "$ONE" ) > "$WORK/build-$ONE.log" 2>&1
done
TARGET_DIR="$WORK/build/$TARGET_ID"

mkdir -p "$SCRATCH/releases"
cp "$TARGET_DIR/manifest.json" "$SCRATCH/releases/${TARGET_ID}.json"
cp "$WORK/build/$RETAINED_ID/manifest.json" "$SCRATCH/releases/${RETAINED_ID}.json"
git -C "$SCRATCH" add -A
git -C "$SCRATCH" commit -q -m 'publish two releases'
git -C "$SCRATCH" remote add origin "$PUBLIC_REMOTE"
git -C "$SCRATCH" update-ref refs/remotes/origin/main "$(git -C "$SCRATCH" rev-parse HEAD)"

# ---------------------------------------------------------------------------
# The canned documents and the mirrored origin
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

cat > "$WORK/stacks.json" <<JSON
{
  "Stacks": [
    {
      "StackName": "patientscribe-viewer-dev",
      "Outputs": [
        { "OutputKey": "DistributionId", "OutputValue": "EXAMPLEDISTID" },
        { "OutputKey": "DistributionDomainName", "OutputValue": "${LOOPBACK}" },
        { "OutputKey": "OriginBucket", "OutputValue": "${ORIGIN_BUCKET_VALUE}" },
        { "OutputKey": "ReleaseLogBucket", "OutputValue": "${LOG_BUCKET_VALUE}" },
        { "OutputKey": "ReleaseLogPrefix", "OutputValue": "${LOG_PREFIX_VALUE}" }
      ]
    }
  ]
}
JSON

MIRROR="$WORK/origin"
rm -rf "$MIRROR"
cp -R "$TARGET_DIR/layout" "$MIRROR"

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
  writeFileSync(process.argv[2], JSON.stringify({ Contents: keys.sort().map((Key) => ({ Key })) }, null, 2) + "\n");
' "$MIRROR" "$WORK/listing.json"

FAKE_AWS_TRANSCRIPT="$WORK/transcript.txt"; export FAKE_AWS_TRANSCRIPT
FAKE_AWS_ACCOUNT='account-under-test'; export FAKE_AWS_ACCOUNT
FAKE_AWS_STACKS="$WORK/stacks.json"; export FAKE_AWS_STACKS
FAKE_AWS_LISTING="$WORK/listing.json"; export FAKE_AWS_LISTING
FAKE_AWS_S3_ROOT="$MIRROR"; export FAKE_AWS_S3_ROOT
FAKE_AWS_S3_BUCKET="$ORIGIN_BUCKET_VALUE"; export FAKE_AWS_S3_BUCKET

HONEST="$TARGET_DIR/layout/index.html"

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
  record ok 'the local origin is serving the mirrored release'
else
  record fail 'the local origin is serving the mirrored release' "$(cat "$WORK/server.log")"
fi

LAST_STATUS=0
LAST_LABEL=''

run_drill() {
  LAST_LABEL="$1"
  shift
  : > "$FAKE_AWS_TRANSCRIPT"
  LAST_STATUS=0
  ( cd "$SCRATCH" && sh "$@" ) > "$WORK/out-${LAST_LABEL}.txt" 2>&1 || LAST_STATUS=$?
  cp "$FAKE_AWS_TRANSCRIPT" "$WORK/transcript-${LAST_LABEL}.txt"
}

drill_dev() {
  LABEL="$1"
  shift
  run_drill "$LABEL" "$SCRIPT" dev --release-id "$TARGET_ID" --release-dir "$TARGET_DIR" \
    --profile patientscribe-dev --overlay "$WORK/overlay.json" \
    --retention-days 400 --poll-seconds 1 --timeout-seconds 5 "$@"
}

out() {
  cat "$WORK/out-${1}.txt"
}

expect_status() {
  if [ "$LAST_STATUS" -eq "$2" ]; then
    record ok "$1"
  else
    record fail "$1" "exit ${LAST_STATUS}: $(out "$LAST_LABEL")"
  fi
}

mirror_is_honest() {
  if cmp -s "$MIRROR/index.html" "$HONEST"; then
    record ok "$1"
  else
    record fail "$1" 'the origin is not serving the proven bytes'
  fi
}

mangle_the_mirror_by_hand() {
  printf '<!-- drill-mangle -->\n' >> "$MIRROR/index.html"
}

# ---------------------------------------------------------------------------
# Disarmed, and prod
# ---------------------------------------------------------------------------
drill_dev 'disarmed'
expect_status 'a disarmed run refuses' 3
if [ -s "$WORK/transcript-disarmed.txt" ]; then
  record fail 'a disarmed run makes no argv at all' "$(cat "$WORK/transcript-disarmed.txt")"
else
  record ok 'a disarmed run makes no argv at all'
fi

VIEWER_DRILL_ARMED='armed-by-the-gate'
export VIEWER_DRILL_ARMED

run_drill 'prod' "$SCRIPT" prod --release-id "$TARGET_ID" --release-dir "$TARGET_DIR" \
  --overlay "$WORK/overlay.json"
expect_status 'a prod drill refuses in code' 1
if [ -s "$WORK/transcript-prod.txt" ]; then
  record fail 'the prod refusal costs no argv' "$(cat "$WORK/transcript-prod.txt")"
else
  record ok 'the prod refusal costs no argv'
fi

# ---------------------------------------------------------------------------
# D0 — a red baseline is a refusal
# ---------------------------------------------------------------------------
mangle_the_mirror_by_hand
drill_dev 'red-baseline'
expect_status 'a drill against an origin that is already red refuses' 1
if grep -q '^s3api put-object' "$WORK/transcript-red-baseline.txt"; then
  record fail 'the red-baseline refusal mutates nothing' "$(cat "$WORK/transcript-red-baseline.txt")"
else
  record ok 'the red-baseline refusal mutates nothing'
fi
if grep -q "$LOG_PREFIX_VALUE" "$WORK/transcript-red-baseline.txt"; then
  record fail 'the red-baseline refusal logs nothing' "$(cat "$WORK/transcript-red-baseline.txt")"
else
  record ok 'the red-baseline refusal logs nothing'
fi
cp "$HONEST" "$MIRROR/index.html"

# ---------------------------------------------------------------------------
# The recovery entry, run alone
# ---------------------------------------------------------------------------
mangle_the_mirror_by_hand
drill_dev 'restore-only' --restore
expect_status 'the recovery entry restores and verifies' 0
mirror_is_honest 'the recovery entry put the proven bytes back'
if grep -q 'drill-restored' "$WORK/transcript-restore-only.txt"; then
  record ok 'the recovery entry logs drill-restored'
else
  record fail 'the recovery entry logs drill-restored' "$(cat "$WORK/transcript-restore-only.txt")"
fi

# ---------------------------------------------------------------------------
# The whole drill
# ---------------------------------------------------------------------------
drill_dev 'whole'
expect_status 'the drill holds end to end' 0
mirror_is_honest 'the origin is serving the proven bytes afterwards'

WHOLE="$WORK/out-whole.txt"
WHOLE_TRANSCRIPT="$WORK/transcript-whole.txt"

for EVENT in drill-started drill-mangled drill-restored drill-succeeded; do
  if grep -q -- "${EVENT}.json" "$WHOLE_TRANSCRIPT"; then
    record ok "the run logged ${EVENT}"
  else
    record fail "the run logged ${EVENT}" "$(grep -- "--key ${LOG_PREFIX_VALUE}" "$WHOLE_TRANSCRIPT" || true)"
  fi
done

if grep -q -- "--key ${LOG_PREFIX_VALUE}${TARGET_ID}/[0-9]*T[0-9]*Z-[0-9a-f]*/01-drill-started.json" "$WHOLE_TRANSCRIPT"; then
  record ok 'the events are keyed by release, run and a two-digit sequence from 01'
else
  record fail 'the events are keyed by release, run and a two-digit sequence from 01' "$(grep -- "--key ${LOG_PREFIX_VALUE}" "$WHOLE_TRANSCRIPT" || true)"
fi

# The record catches up only after the origin is whole again. What proves it is
# where the mangled event sits in the transcript: after the restoring put AND
# after the invalidation that followed it, and before the restored event.
MANGLED_AT=$(grep -n -- '02-drill-mangled.json' "$WHOLE_TRANSCRIPT" | head -1 | cut -d: -f1)
RESTORED_AT=$(grep -n -- '03-drill-restored.json' "$WHOLE_TRANSCRIPT" | head -1 | cut -d: -f1)
RESTORING_PUT_AT=$(grep -n -- "--bucket ${ORIGIN_BUCKET_VALUE} --key index.html" "$WHOLE_TRANSCRIPT" | tail -1 | cut -d: -f1)
LAST_INVALIDATION_AT=$(grep -n '^cloudfront create-invalidation' "$WHOLE_TRANSCRIPT" | tail -1 | cut -d: -f1)
if [ -n "$MANGLED_AT" ] && [ -n "$RESTORED_AT" ] && [ -n "$RESTORING_PUT_AT" ] && [ -n "$LAST_INVALIDATION_AT" ] &&
  [ "$RESTORING_PUT_AT" -lt "$MANGLED_AT" ] && [ "$LAST_INVALIDATION_AT" -lt "$MANGLED_AT" ] &&
  [ "$MANGLED_AT" -lt "$RESTORED_AT" ]; then
  record ok 'the restoration completes before the mangled event is written, and the record still reads started, mangled, restored'
else
  record fail 'the restoration completes before the mangled event is written, and the record still reads started, mangled, restored' \
    "put ${RESTORING_PUT_AT}, invalidation ${LAST_INVALIDATION_AT}, mangled ${MANGLED_AT}, restored ${RESTORED_AT}"
fi

EVENT_ORDER=$(awk '{for (i = 1; i < NF; i++) if ($i == "--key") print $(i + 1)}' "$WHOLE_TRANSCRIPT" |
  sed -n 's#.*/\(0[0-9]-drill-[a-z]*\.json\)$#\1#p' | tr '\n' ' ')
if [ "$EVENT_ORDER" = '01-drill-started.json 02-drill-mangled.json 03-drill-restored.json 04-drill-succeeded.json ' ]; then
  record ok 'the sequence numbers follow attempt order, one through four'
else
  record fail 'the sequence numbers follow attempt order, one through four' "${EVENT_ORDER}"
fi

MANGLE_PUTS=$(grep -c -- "--bucket ${ORIGIN_BUCKET_VALUE} --key index.html" "$WHOLE_TRANSCRIPT" || true)
if [ "$MANGLE_PUTS" -eq 2 ]; then
  record ok 'exactly two puts touched the origin: the mangle and the restore'
else
  record fail 'exactly two puts touched the origin: the mangle and the restore' "${MANGLE_PUTS} put(s)"
fi

if grep -q -- '--key assets/' "$WHOLE_TRANSCRIPT"; then
  record fail 'a drill never touches an asset' "$(grep -- '--key assets/' "$WHOLE_TRANSCRIPT")"
else
  record ok 'a drill never touches an asset'
fi

INVALIDATIONS=$(grep -c '^cloudfront create-invalidation' "$WHOLE_TRANSCRIPT" || true)
if [ "$INVALIDATIONS" -eq 2 ]; then
  record ok 'each mutation is followed by its own two-alias invalidation'
else
  record fail 'each mutation is followed by its own two-alias invalidation' "${INVALIDATIONS} of them"
fi
if grep -q '^cloudfront create-invalidation --distribution-id EXAMPLEDISTID --paths / /index.html --output json ' "$WHOLE_TRANSCRIPT"; then
  record ok 'the batches cover exactly / and /index.html'
else
  record fail 'the batches cover exactly / and /index.html' "$(grep '^cloudfront create-invalidation' "$WHOLE_TRANSCRIPT")"
fi

# The run says which record area it took. Picking the newest directory off the
# filesystem sorts two runs of the same second by their random suffix, which is a
# gate that reads whichever one it feels like.
RECORD_DIR=$(sed -n 's/^drill — record area //p' "$WHOLE" | head -1)
if [ -d "$RECORD_DIR" ]; then
  record ok 'the run named its own record area'
else
  record fail 'the run named its own record area' "${RECORD_DIR}"
fi
if grep -q 'FAIL' "$RECORD_DIR/check-mangled.txt" && grep -qE '/index\.html.*the decoded bytes digest to' "$RECORD_DIR/check-mangled.txt"; then
  record ok 'D1 — the real oracle refused the mangled entry point, naming its digest'
else
  record fail 'D1 — the real oracle refused the mangled entry point, naming its digest' "$(cat "$RECORD_DIR/check-mangled.txt")"
fi
if grep -q 'PASS — every predicate held' "$RECORD_DIR/check-restore.txt"; then
  record ok 'D2 — the real oracle passed once the bytes were put back'
else
  record fail 'D2 — the real oracle passed once the bytes were put back' "$(cat "$RECORD_DIR/check-restore.txt")"
fi
if grep -qE '/index\.html.*the decoded bytes digest to' "$RECORD_DIR/check-doctored.txt"; then
  record ok 'D3 — the real oracle refused the doctored manifest against an honest origin'
else
  record fail 'D3 — the real oracle refused the doctored manifest against an honest origin' "$(cat "$RECORD_DIR/check-doctored.txt")"
fi
if [ -f "$RECORD_DIR/doctored-manifest.json" ]; then
  record ok 'the doctored manifest stays in the record area as evidence'
else
  record fail 'the doctored manifest stays in the record area as evidence' 'it is not there'
fi
if grep -q 'PASS — every predicate held' "$RECORD_DIR/check-closing.txt"; then
  record ok 'D4 — the closing clean run passed'
else
  record fail 'D4 — the closing clean run passed' "$(cat "$RECORD_DIR/check-closing.txt")"
fi
if grep -q -- '--restore' "$WHOLE"; then
  record ok 'the complete recovery command is printed before the first mutation'
else
  record fail 'the complete recovery command is printed before the first mutation' "$(cat "$WHOLE")"
fi

RECOVERY_LINE=$(grep -- '--restore' "$WHOLE" | head -1)
case "$RECOVERY_LINE" in
  *"--profile 'patientscribe-dev'"*"--poll-seconds '1'"*"--timeout-seconds '5'"*)
    record ok 'the recovery command carries every effective option, single-quoted'
    ;;
  *)
    record fail 'the recovery command carries every effective option, single-quoted' "$RECOVERY_LINE"
    ;;
esac
case "$RECOVERY_LINE" in
  *"'/"*) record ok 'every path in the recovery command is absolute' ;;
  *) record fail 'every path in the recovery command is absolute' "$RECOVERY_LINE" ;;
esac

# ---------------------------------------------------------------------------
# A check that cannot go red: the drill has to fail, and still restore
# ---------------------------------------------------------------------------
#
# Driven through a shadow copy of the tooling whose release check is a stub that
# always exits 0. That is the only way to reach this direction — the real oracle
# refuses mangled bytes, which is the whole point of it.
SHADOW="$WORK/shadow"
mkdir -p "$SHADOW/scripts/infra"
cp "$ROOT/scripts/infra/"*.sh "$ROOT/scripts/infra/"*.mjs "$SHADOW/scripts/infra/"
cat > "$SHADOW/scripts/release-check.mjs" <<'JS'
// NOT THE RELEASE CHECK. A stand-in that always passes, so that one self-test
// direction — "a check that comes up green against mangled bytes fails the
// drill" — can be reached at all.
process.stdout.write('PASS — a canned check that cannot refuse anything\n');
JS

cp "$HONEST" "$MIRROR/index.html"
run_drill 'always-green' "$SHADOW/scripts/infra/drill.sh" dev --release-id "$TARGET_ID" --release-dir "$TARGET_DIR" \
  --profile patientscribe-dev --overlay "$WORK/overlay.json" --poll-seconds 1 --timeout-seconds 5
expect_status 'a check that comes up green against mangled bytes fails the drill' 1
mirror_is_honest 'and the origin is restored anyway'
if grep -q 'drill-failed' "$WORK/transcript-always-green.txt"; then
  record ok 'the failed drill is logged as drill-failed'
else
  record fail 'the failed drill is logged as drill-failed' "$(grep -- "--key ${LOG_PREFIX_VALUE}" "$WORK/transcript-always-green.txt" || true)"
fi

# ---------------------------------------------------------------------------
# A run that is cut short between the mangle and the restore
# ---------------------------------------------------------------------------
#
# The restoration is on an exit trap rather than on the happy path alone, and an
# exit trap is only worth what a crash proves. So this one is interrupted while
# it is waiting on an invalidation that never completes, and the origin has to
# come back anyway.
printf 'InProgress\n' > "$WORK/statuses-hang.txt"
FAKE_AWS_INVALIDATION_STATUSES="$WORK/statuses-hang.txt"; export FAKE_AWS_INVALIDATION_STATUSES
: > "$FAKE_AWS_TRANSCRIPT"

( cd "$SCRATCH" && exec sh "$SCRIPT" dev --release-id "$TARGET_ID" --release-dir "$TARGET_DIR" \
  --profile patientscribe-dev --overlay "$WORK/overlay.json" --poll-seconds 1 --timeout-seconds 120 ) \
  > "$WORK/out-interrupted.txt" 2>&1 &
DRILL_PID=$!

WAITED=0
while [ "$WAITED" -lt 300 ]; do
  if grep -q '^cloudfront create-invalidation' "$FAKE_AWS_TRANSCRIPT" 2>/dev/null; then
    break
  fi
  sleep 0.2
  WAITED=$((WAITED + 1))
done

if grep -q -- "--bucket ${ORIGIN_BUCKET_VALUE} --key index.html" "$FAKE_AWS_TRANSCRIPT" 2>/dev/null; then
  record ok 'the interrupted run had already put the mangled entry point'
else
  record fail 'the interrupted run had already put the mangled entry point' "$(cat "$FAKE_AWS_TRANSCRIPT")"
fi

kill -TERM "$DRILL_PID" 2>/dev/null || true
# The restoration's own invalidation has to be able to complete, or the trap
# would be waiting on the same stuck answer the run was interrupted during.
printf 'Completed\n' > "$WORK/statuses-hang.txt"
wait "$DRILL_PID" 2>/dev/null || true
cp "$FAKE_AWS_TRANSCRIPT" "$WORK/transcript-interrupted.txt"

mirror_is_honest 'the exit trap restored the origin after the run was cut short'
if grep -q 'Restoring before anything else' "$WORK/out-interrupted.txt"; then
  record ok 'the interrupted run says it is restoring before anything else'
else
  record fail 'the interrupted run says it is restoring before anything else' "$(cat "$WORK/out-interrupted.txt")"
fi
unset FAKE_AWS_INVALIDATION_STATUSES

# ---------------------------------------------------------------------------
# The transcripts
# ---------------------------------------------------------------------------
echo
echo 'the drill, as it ran:'
sed 's/^/  /' "$WHOLE"
echo
echo 'transcript of the drill:'
sed 's/^/  /' "$WHOLE_TRANSCRIPT"
echo

if [ "$FAILURES" -eq 0 ]; then
  echo 'drill self-test — PASS'
  exit 0
fi
echo "drill self-test — FAIL (${FAILURES} case(s))"
exit 1
