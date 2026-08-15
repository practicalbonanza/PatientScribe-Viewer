#!/bin/sh
#
# Both directions of the account assertion, against the fake CLI.
#
# Exit codes: 0 = every case held, 1 = one did not.

set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
SCRIPT="$ROOT/scripts/infra/assert-account.sh"

WORK=$(mktemp -d)
# shellcheck disable=SC2064
trap "rm -rf '$WORK'" EXIT INT TERM

PATH="$HERE/fake-cli:$PATH"
export PATH

FAILURES=0

record() {
  if [ "$1" = 'ok' ]; then
    printf '  ok   %s\n' "$2"
  else
    FAILURES=$((FAILURES + 1))
    printf '  FAIL %s — %s\n' "$2" "$3"
  fi
}

run_case() {
  FAKE_AWS_TRANSCRIPT="$WORK/transcript.txt"
  export FAKE_AWS_TRANSCRIPT
  : > "$FAKE_AWS_TRANSCRIPT"
  STATUS=0
  sh "$SCRIPT" "$@" > "$WORK/out.txt" 2>&1 || STATUS=$?
}

# ---------------------------------------------------------------------------
# The account matches.
# ---------------------------------------------------------------------------
VIEWER_EXPECTED_ACCOUNT_ID='account-under-test'
export VIEWER_EXPECTED_ACCOUNT_ID
FAKE_AWS_ACCOUNT='account-under-test'
export FAKE_AWS_ACCOUNT

run_case --profile patientscribe-dev --overlay "$WORK/absent.json"
if [ "$STATUS" -eq 0 ]; then
  record ok 'a matching account passes'
else
  record fail 'a matching account passes' "exit ${STATUS}: $(cat "$WORK/out.txt")"
fi

if grep -q -- '--region us-east-1' "$WORK/transcript.txt"; then
  record ok 'the identity call carries the pinned region'
else
  record fail 'the identity call carries the pinned region' "transcript: $(cat "$WORK/transcript.txt")"
fi

if grep -q '^sts get-caller-identity' "$WORK/transcript.txt"; then
  record ok 'the call made is the identity call'
else
  record fail 'the call made is the identity call' "transcript: $(cat "$WORK/transcript.txt")"
fi

# ---------------------------------------------------------------------------
# The account does not match.
# ---------------------------------------------------------------------------
FAKE_AWS_ACCOUNT='a-different-account'
export FAKE_AWS_ACCOUNT

run_case --profile patientscribe-dev --overlay "$WORK/absent.json"
if [ "$STATUS" -eq 1 ]; then
  record ok 'a different account fails closed'
else
  record fail 'a different account fails closed' "exit ${STATUS}: $(cat "$WORK/out.txt")"
fi

if grep -q 'account-under-test' "$WORK/out.txt" || grep -q 'a-different-account' "$WORK/out.txt"; then
  record fail 'the refusal does not print either account' "$(cat "$WORK/out.txt")"
else
  record ok 'the refusal does not print either account'
fi

# ---------------------------------------------------------------------------
# Nothing to compare against: it must not call anything at all.
# ---------------------------------------------------------------------------
unset VIEWER_EXPECTED_ACCOUNT_ID
FAKE_AWS_ACCOUNT='account-under-test'
export FAKE_AWS_ACCOUNT

run_case --profile patientscribe-dev --overlay "$WORK/absent.json"
if [ "$STATUS" -eq 2 ]; then
  record ok 'no expectation is a refusal to run'
else
  record fail 'no expectation is a refusal to run' "exit ${STATUS}: $(cat "$WORK/out.txt")"
fi

if [ -s "$WORK/transcript.txt" ]; then
  record fail 'nothing is called when there is nothing to compare against' "transcript: $(cat "$WORK/transcript.txt")"
else
  record ok 'nothing is called when there is nothing to compare against'
fi

# ---------------------------------------------------------------------------
# The expectation comes out of the overlay when the environment is silent.
# ---------------------------------------------------------------------------
cat > "$WORK/overlay.json" <<'JSON'
[
  { "ParameterKey": "AccountId", "ParameterValue": "account-under-test" }
]
JSON

run_case --profile patientscribe-dev --overlay "$WORK/overlay.json"
if [ "$STATUS" -eq 0 ]; then
  record ok 'the expected account is read from the overlay'
else
  record fail 'the expected account is read from the overlay' "exit ${STATUS}: $(cat "$WORK/out.txt")"
fi

echo
echo 'transcript of the last passing run:'
sed 's/^/  /' "$WORK/transcript.txt"
echo

if [ "$FAILURES" -eq 0 ]; then
  echo 'assert-account self-test — PASS'
  exit 0
fi
echo "assert-account self-test — FAIL (${FAILURES} case(s))"
exit 1
