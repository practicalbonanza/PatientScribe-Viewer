#!/bin/sh
#
# What the deploy script does, read off the transcript the fake CLI writes.
#
# The properties asserted here are the ones that cannot be read off the source by
# looking at it and being satisfied: that the identity check really does happen
# before the first CloudFormation call rather than somewhere near it, that no call
# escaped the region pin, that the change-set name is one name and not two that
# usually agree, and that the disarmed guard refuses before anything at all.
#
# Exit codes: 0 = every case held, 1 = one did not.

set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
SCRIPT="$ROOT/scripts/infra/deploy-changeset.sh"

WORK=$(mktemp -d)
# shellcheck disable=SC2064
trap "rm -rf '$WORK'" EXIT INT TERM

PATH="$HERE/fake-cli:$PATH"
export PATH

FAKE_AWS_TRANSCRIPT="$WORK/transcript.txt"
export FAKE_AWS_TRANSCRIPT
FAKE_AWS_ACCOUNT='account-under-test'
export FAKE_AWS_ACCOUNT
VIEWER_EXPECTED_ACCOUNT_ID='account-under-test'
export VIEWER_EXPECTED_ACCOUNT_ID

FAILURES=0

record() {
  if [ "$1" = 'ok' ]; then
    printf '  ok   %s\n' "$2"
  else
    FAILURES=$((FAILURES + 1))
    printf '  FAIL %s — %s\n' "$2" "$3"
  fi
}

# Real overlays, because the flavour binding reads one. A dev overlay and a prod
# overlay that differ in the one field the binding is about.
cat > "$WORK/dev-overlay.json" <<'JSON'
[
  { "ParameterKey": "Environment", "ParameterValue": "dev" },
  { "ParameterKey": "AccountId", "ParameterValue": "account-under-test" }
]
JSON

cat > "$WORK/prod-overlay.json" <<'JSON'
[
  { "ParameterKey": "Environment", "ParameterValue": "prod" },
  { "ParameterKey": "AccountId", "ParameterValue": "account-under-test" }
]
JSON

cat > "$WORK/no-environment-overlay.json" <<'JSON'
[
  { "ParameterKey": "AccountId", "ParameterValue": "account-under-test" }
]
JSON

# ---------------------------------------------------------------------------
# Disarmed: nothing may be called.
# ---------------------------------------------------------------------------
: > "$FAKE_AWS_TRANSCRIPT"
unset VIEWER_DEPLOY_ARMED || true
STATUS=0
(cd "$ROOT" && sh "$SCRIPT" dev --create CREATE --overlay "$WORK/dev-overlay.json") > "$WORK/out.txt" 2>&1 || STATUS=$?

if [ "$STATUS" -eq 3 ]; then
  record ok 'a disarmed run refuses'
else
  record fail 'a disarmed run refuses' "exit ${STATUS}: $(cat "$WORK/out.txt")"
fi

if [ -s "$FAKE_AWS_TRANSCRIPT" ]; then
  record fail 'a disarmed run calls nothing at all' "transcript: $(cat "$FAKE_AWS_TRANSCRIPT")"
else
  record ok 'a disarmed run calls nothing at all'
fi

# ---------------------------------------------------------------------------
# Armed, building a change set.
# ---------------------------------------------------------------------------
VIEWER_DEPLOY_ARMED='armed-by-the-gate'
export VIEWER_DEPLOY_ARMED

# ---------------------------------------------------------------------------
# The flavour and the overlay must agree, and disagreeing costs no calls.
# ---------------------------------------------------------------------------
: > "$FAKE_AWS_TRANSCRIPT"
STATUS=0
(cd "$ROOT" && sh "$SCRIPT" dev --create CREATE --overlay "$WORK/prod-overlay.json") > "$WORK/out.txt" 2>&1 || STATUS=$?

if [ "$STATUS" -eq 1 ]; then
  record ok 'a prod overlay handed to a dev run refuses'
else
  record fail 'a prod overlay handed to a dev run refuses' "exit ${STATUS}: $(cat "$WORK/out.txt")"
fi
if [ -s "$FAKE_AWS_TRANSCRIPT" ]; then
  record fail 'the flavour mismatch refuses before any aws argv' "transcript: $(cat "$FAKE_AWS_TRANSCRIPT")"
else
  record ok 'the flavour mismatch refuses before any aws argv'
fi

: > "$FAKE_AWS_TRANSCRIPT"
STATUS=0
(cd "$ROOT" && sh "$SCRIPT" prod --create CREATE --overlay "$WORK/dev-overlay.json") > "$WORK/out.txt" 2>&1 || STATUS=$?

if [ "$STATUS" -eq 1 ]; then
  record ok 'a dev overlay handed to a prod run refuses'
else
  record fail 'a dev overlay handed to a prod run refuses' "exit ${STATUS}: $(cat "$WORK/out.txt")"
fi
if [ -s "$FAKE_AWS_TRANSCRIPT" ]; then
  record fail 'the reverse mismatch also refuses before any aws argv' "transcript: $(cat "$FAKE_AWS_TRANSCRIPT")"
else
  record ok 'the reverse mismatch also refuses before any aws argv'
fi

: > "$FAKE_AWS_TRANSCRIPT"
STATUS=0
(cd "$ROOT" && sh "$SCRIPT" dev --create CREATE --overlay "$WORK/no-environment-overlay.json") > "$WORK/out.txt" 2>&1 || STATUS=$?

if [ "$STATUS" -eq 2 ]; then
  record ok 'an overlay with no Environment cannot be bound, and refuses'
else
  record fail 'an overlay with no Environment cannot be bound, and refuses' "exit ${STATUS}: $(cat "$WORK/out.txt")"
fi
if [ -s "$FAKE_AWS_TRANSCRIPT" ]; then
  record fail 'an unbindable overlay costs no aws argv' "transcript: $(cat "$FAKE_AWS_TRANSCRIPT")"
else
  record ok 'an unbindable overlay costs no aws argv'
fi

# ---------------------------------------------------------------------------
# Armed, matching, building a change set.
# ---------------------------------------------------------------------------
: > "$FAKE_AWS_TRANSCRIPT"
STATUS=0
(cd "$ROOT" && sh "$SCRIPT" dev --create CREATE --overlay "$WORK/dev-overlay.json") > "$WORK/out.txt" 2>&1 || STATUS=$?

if [ "$STATUS" -eq 0 ]; then
  record ok 'an armed create runs'
else
  record fail 'an armed create runs' "exit ${STATUS}: $(cat "$WORK/out.txt")"
fi

FIRST_LINE=$(head -1 "$FAKE_AWS_TRANSCRIPT")
case "$FIRST_LINE" in
  'sts get-caller-identity'*) record ok 'the identity call is the first call made' ;;
  *) record fail 'the identity call is the first call made' "first line: ${FIRST_LINE}" ;;
esac

STS_AT=$(grep -n '^sts ' "$FAKE_AWS_TRANSCRIPT" | head -1 | cut -d: -f1)
CFN_AT=$(grep -n '^cloudformation ' "$FAKE_AWS_TRANSCRIPT" | head -1 | cut -d: -f1)
if [ "$STS_AT" -lt "$CFN_AT" ]; then
  record ok 'the identity call precedes every cloudformation call'
else
  record fail 'the identity call precedes every cloudformation call' "sts at ${STS_AT}, cloudformation at ${CFN_AT}"
fi

# Only the four operations, and only in the shapes named.
UNEXPECTED=$(grep '^cloudformation ' "$FAKE_AWS_TRANSCRIPT" \
  | grep -v '^cloudformation create-change-set ' \
  | grep -v '^cloudformation describe-change-set ' \
  | grep -v '^cloudformation wait change-set-create-complete ' \
  | grep -v '^cloudformation execute-change-set ' || true)
if [ -z "$UNEXPECTED" ]; then
  record ok 'the only cloudformation calls are the four named ones'
else
  record fail 'the only cloudformation calls are the four named ones' "$UNEXPECTED"
fi

if grep -q -- '--change-set-type CREATE' "$FAKE_AWS_TRANSCRIPT"; then
  record ok 'the change-set type passed in is the one on the wire'
else
  record fail 'the change-set type passed in is the one on the wire' "$(cat "$FAKE_AWS_TRANSCRIPT")"
fi

if grep -q -- '--parameter-overrides' "$FAKE_AWS_TRANSCRIPT"; then
  record fail 'no call carries --parameter-overrides' "$(cat "$FAKE_AWS_TRANSCRIPT")"
else
  record ok 'no call carries --parameter-overrides'
fi

if grep -q -- '--parameters file://infra/parameters.json' "$FAKE_AWS_TRANSCRIPT" \
  || grep -q -- '--parameters file://' "$FAKE_AWS_TRANSCRIPT"; then
  record ok 'the overlay is handed over as a parameters file'
else
  record fail 'the overlay is handed over as a parameters file' "$(cat "$FAKE_AWS_TRANSCRIPT")"
fi

OFF_REGION=$(grep -v -- '--region us-east-1' "$FAKE_AWS_TRANSCRIPT" || true)
if [ -z "$OFF_REGION" ]; then
  record ok 'every call carries the pinned region'
else
  record fail 'every call carries the pinned region' "$OFF_REGION"
fi

# One change-set name across the whole transcript.
NAMES=$(awk '{for (i = 1; i < NF; i++) if ($i == "--change-set-name") print $(i + 1)}' "$FAKE_AWS_TRANSCRIPT" | sort -u)
NAME_COUNT=$(printf '%s\n' "$NAMES" | grep -c . || true)
if [ "$NAME_COUNT" -eq 1 ]; then
  record ok 'one change-set name is used across create, wait and describe'
else
  record fail 'one change-set name is used across create, wait and describe' "names: ${NAMES}"
fi

CHANGE_SET_NAME=$(printf '%s\n' "$NAMES" | head -1)
case "$CHANGE_SET_NAME" in
  patientscribe-viewer-dev-*Z) record ok 'the change-set name is the stack name and a UTC timestamp' ;;
  *) record fail 'the change-set name is the stack name and a UTC timestamp' "name: ${CHANGE_SET_NAME}" ;;
esac

if awk '{for (i = 1; i < NF; i++) if ($i == "--stack-name") print $(i + 1)}' "$FAKE_AWS_TRANSCRIPT" \
  | sort -u | grep -qx 'patientscribe-viewer-dev'; then
  record ok 'the stack name is the prescribed one'
else
  record fail 'the stack name is the prescribed one' "$(cat "$FAKE_AWS_TRANSCRIPT")"
fi

CREATE_TRANSCRIPT=$(cat "$FAKE_AWS_TRANSCRIPT")

# ---------------------------------------------------------------------------
# Armed, applying the change set that was just built.
# ---------------------------------------------------------------------------
: > "$FAKE_AWS_TRANSCRIPT"
STATUS=0
(cd "$ROOT" && sh "$SCRIPT" dev --execute "$CHANGE_SET_NAME" --overlay "$WORK/dev-overlay.json") > "$WORK/out.txt" 2>&1 || STATUS=$?

if [ "$STATUS" -eq 0 ]; then
  record ok 'an armed execute runs'
else
  record fail 'an armed execute runs' "exit ${STATUS}: $(cat "$WORK/out.txt")"
fi

if grep -q "^cloudformation execute-change-set .*--change-set-name ${CHANGE_SET_NAME} " "$FAKE_AWS_TRANSCRIPT" \
  || grep -q "^cloudformation execute-change-set .*--change-set-name ${CHANGE_SET_NAME}$" "$FAKE_AWS_TRANSCRIPT"; then
  record ok 'the change set applied is the one that was built'
else
  record fail 'the change set applied is the one that was built' "$(cat "$FAKE_AWS_TRANSCRIPT")"
fi

EXEC_STS=$(head -1 "$FAKE_AWS_TRANSCRIPT")
case "$EXEC_STS" in
  'sts get-caller-identity'*) record ok 'the execute step checks identity first too' ;;
  *) record fail 'the execute step checks identity first too' "first line: ${EXEC_STS}" ;;
esac

OFF_REGION=$(grep -v -- '--region us-east-1' "$FAKE_AWS_TRANSCRIPT" || true)
if [ -z "$OFF_REGION" ]; then
  record ok 'every call in the execute step carries the pinned region'
else
  record fail 'every call in the execute step carries the pinned region' "$OFF_REGION"
fi

echo
echo 'transcript — the create step:'
printf '%s\n' "$CREATE_TRANSCRIPT" | sed 's/^/  /'
echo
echo 'transcript — the execute step:'
sed 's/^/  /' "$FAKE_AWS_TRANSCRIPT"
echo

if [ "$FAILURES" -eq 0 ]; then
  echo 'deploy-changeset self-test — PASS'
  exit 0
fi
echo "deploy-changeset self-test — FAIL (${FAILURES} case(s))"
exit 1
