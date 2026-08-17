#!/bin/sh
#
# The fetching half of the control-plane assertions, against the fake CLI.
#
# The deciding half — every way a distribution can be wrong — is exercised by
# `assert-distribution-core.mjs --self-test`, which this runs first. What is left
# for this file is what the core cannot see: that the calls are the three
# expected ones, that each carries the pinned region, that the distribution the
# second call asks about is the one the first call named, and that a disarmed run
# reaches none of them.
#
# Exit codes: 0 = every case held, 1 = one did not.

set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
SCRIPT="$ROOT/scripts/infra/assert-distribution.sh"
CORE="$ROOT/scripts/infra/assert-distribution-core.mjs"

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

echo 'the assertions themselves:'
STATUS=0
node "$CORE" --self-test | sed 's/^/  /' || STATUS=$?
if [ "$STATUS" -eq 0 ]; then
  record ok 'every failing direction of the assertions is exercised'
else
  record fail 'every failing direction of the assertions is exercised' "the core self-test exited ${STATUS}"
fi
echo

# ---------------------------------------------------------------------------
# The canned documents the fake CLI answers with.
# ---------------------------------------------------------------------------
cat > "$WORK/stacks.json" <<'JSON'
{
  "Stacks": [
    {
      "StackName": "patientscribe-viewer-dev",
      "Outputs": [
        { "OutputKey": "DistributionId", "OutputValue": "EXAMPLEDISTID" },
        { "OutputKey": "DefaultResponseHeadersPolicyId", "OutputValue": "policy-default" },
        { "OutputKey": "AssetResponseHeadersPolicyId", "OutputValue": "policy-assets" },
        { "OutputKey": "RequestCountAlarmName", "OutputValue": "patientscribe-viewer-dev-requests" },
        { "OutputKey": "RequestCountAlarmThreshold", "OutputValue": "10000" }
      ]
    }
  ]
}
JSON

# The error responses carry `""` for the page and the code, because that is what
# the control plane answers with for the fields this template never sets. The
# fake answers as the service answers: a document that omitted them would be a
# document no distribution ever returns, and a rule that misread the real shape
# would stay green here right up to the first armed run.
cat > "$WORK/distribution.json" <<'JSON'
{
  "DistributionConfig": {
    "DefaultRootObject": "index.html",
    "IsIPV6Enabled": true,
    "Origins": { "Quantity": 1, "Items": [{ "Id": "viewer-origin", "OriginAccessControlId": "oac-1" }] },
    "DefaultCacheBehavior": { "TargetOriginId": "viewer-origin", "ResponseHeadersPolicyId": "policy-default" },
    "CacheBehaviors": {
      "Quantity": 1,
      "Items": [{ "PathPattern": "/assets/*", "TargetOriginId": "viewer-origin", "ResponseHeadersPolicyId": "policy-assets" }]
    },
    "CustomErrorResponses": {
      "Quantity": 11,
      "Items": [
        { "ErrorCode": 400, "ErrorCachingMinTTL": 0, "ResponsePagePath": "", "ResponseCode": "" },
        { "ErrorCode": 403, "ErrorCachingMinTTL": 0, "ResponsePagePath": "", "ResponseCode": "" },
        { "ErrorCode": 404, "ErrorCachingMinTTL": 0, "ResponsePagePath": "", "ResponseCode": "" },
        { "ErrorCode": 405, "ErrorCachingMinTTL": 0, "ResponsePagePath": "", "ResponseCode": "" },
        { "ErrorCode": 414, "ErrorCachingMinTTL": 0, "ResponsePagePath": "", "ResponseCode": "" },
        { "ErrorCode": 416, "ErrorCachingMinTTL": 0, "ResponsePagePath": "", "ResponseCode": "" },
        { "ErrorCode": 500, "ErrorCachingMinTTL": 0, "ResponsePagePath": "", "ResponseCode": "" },
        { "ErrorCode": 501, "ErrorCachingMinTTL": 0, "ResponsePagePath": "", "ResponseCode": "" },
        { "ErrorCode": 502, "ErrorCachingMinTTL": 0, "ResponsePagePath": "", "ResponseCode": "" },
        { "ErrorCode": 503, "ErrorCachingMinTTL": 0, "ResponsePagePath": "", "ResponseCode": "" },
        { "ErrorCode": 504, "ErrorCachingMinTTL": 0, "ResponsePagePath": "", "ResponseCode": "" }
      ]
    }
  }
}
JSON

cat > "$WORK/alarms.json" <<'JSON'
{
  "MetricAlarms": [
    {
      "AlarmName": "patientscribe-viewer-dev-requests",
      "Namespace": "AWS/CloudFront",
      "MetricName": "Requests",
      "Dimensions": [
        { "Name": "DistributionId", "Value": "EXAMPLEDISTID" },
        { "Name": "Region", "Value": "Global" }
      ],
      "Statistic": "Sum",
      "Period": 300,
      "EvaluationPeriods": 1,
      "ComparisonOperator": "GreaterThanThreshold",
      "TreatMissingData": "notBreaching",
      "Threshold": 10000,
      "ActionsEnabled": true,
      "AlarmActions": ["topic-under-test"],
      "OKActions": [],
      "InsufficientDataActions": []
    }
  ],
  "CompositeAlarms": []
}
JSON

# A real overlay, because the alarm expectations are read from one.
cat > "$WORK/overlay.json" <<'JSON'
[
  { "ParameterKey": "AlarmTopicArn", "ParameterValue": "topic-under-test" },
  { "ParameterKey": "RequestCountAlarmThreshold", "ParameterValue": "10000" }
]
JSON

cat > "$WORK/wrong-topic-overlay.json" <<'JSON'
[
  { "ParameterKey": "AlarmTopicArn", "ParameterValue": "a-different-topic" },
  { "ParameterKey": "RequestCountAlarmThreshold", "ParameterValue": "10000" }
]
JSON

FAKE_AWS_TRANSCRIPT="$WORK/transcript.txt"
export FAKE_AWS_TRANSCRIPT
FAKE_AWS_STACKS="$WORK/stacks.json"
export FAKE_AWS_STACKS
FAKE_AWS_DISTRIBUTION="$WORK/distribution.json"
export FAKE_AWS_DISTRIBUTION
FAKE_AWS_ALARMS="$WORK/alarms.json"
export FAKE_AWS_ALARMS

# ---------------------------------------------------------------------------
# Disarmed.
# ---------------------------------------------------------------------------
: > "$FAKE_AWS_TRANSCRIPT"
unset VIEWER_DEPLOY_ARMED || true
STATUS=0
sh "$SCRIPT" patientscribe-viewer-dev --overlay "$WORK/absent.json" > "$WORK/out.txt" 2>&1 || STATUS=$?

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
# Armed, against a conforming distribution.
# ---------------------------------------------------------------------------
VIEWER_DEPLOY_ARMED='armed-by-the-gate'
export VIEWER_DEPLOY_ARMED

# ---------------------------------------------------------------------------
# No expectation to compare the alarm against: refuse, do not check less.
# ---------------------------------------------------------------------------
: > "$FAKE_AWS_TRANSCRIPT"
STATUS=0
sh "$SCRIPT" patientscribe-viewer-dev --overlay "$WORK/absent.json" > "$WORK/out.txt" 2>&1 || STATUS=$?

if [ "$STATUS" -eq 2 ]; then
  record ok 'no expected topic is a refusal rather than a shape-only pass'
else
  record fail 'no expected topic is a refusal rather than a shape-only pass' "exit ${STATUS}: $(cat "$WORK/out.txt")"
fi
if grep -q 'AlarmTopicArn' "$WORK/out.txt"; then
  record ok 'the refusal names what it needed'
else
  record fail 'the refusal names what it needed' "$(cat "$WORK/out.txt")"
fi
if [ -s "$FAKE_AWS_TRANSCRIPT" ]; then
  record fail 'a run with no expectation costs no aws argv' "transcript: $(cat "$FAKE_AWS_TRANSCRIPT")"
else
  record ok 'a run with no expectation costs no aws argv'
fi

# ---------------------------------------------------------------------------
# The threshold comes from the stack, so a stack that states none refuses.
# ---------------------------------------------------------------------------
#
# This is where the expectation moved to. A threshold read from a local file is a
# threshold that can drift from the one the stack was deployed with, and the two
# disagreeing is the case the assertion exists to catch — so the value is read
# from the stack's own output, and a stack that carries no such output is a run
# that cannot conclude anything rather than a run that checks less.
sed '/RequestCountAlarmThreshold/d; s/"patientscribe-viewer-dev-requests" },/"patientscribe-viewer-dev-requests" }/' \
  "$WORK/stacks.json" > "$WORK/stacks-no-threshold.json"

FAKE_AWS_STACKS="$WORK/stacks-no-threshold.json"
export FAKE_AWS_STACKS

: > "$FAKE_AWS_TRANSCRIPT"
STATUS=0
sh "$SCRIPT" patientscribe-viewer-dev --overlay "$WORK/absent.json" \
  --expected-alarm-action topic-under-test > "$WORK/out.txt" 2>&1 || STATUS=$?

if [ "$STATUS" -eq 2 ] && grep -q 'RequestCountAlarmThreshold' "$WORK/out.txt"; then
  record ok 'a stack that states no threshold is a refusal, named as one'
else
  record fail 'a stack that states no threshold is a refusal, named as one' "exit ${STATUS}: $(cat "$WORK/out.txt")"
fi

FAKE_AWS_STACKS="$WORK/stacks.json"
export FAKE_AWS_STACKS

# ---------------------------------------------------------------------------
# An expectation that does not match what the alarm notifies.
# ---------------------------------------------------------------------------
: > "$FAKE_AWS_TRANSCRIPT"
STATUS=0
sh "$SCRIPT" patientscribe-viewer-dev --overlay "$WORK/wrong-topic-overlay.json" > "$WORK/out.txt" 2>&1 || STATUS=$?

if [ "$STATUS" -eq 1 ]; then
  record ok 'an alarm notifying a different topic fails'
else
  record fail 'an alarm notifying a different topic fails' "exit ${STATUS}: $(cat "$WORK/out.txt")"
fi

# ---------------------------------------------------------------------------
# The expectation present and matching.
# ---------------------------------------------------------------------------
: > "$FAKE_AWS_TRANSCRIPT"
STATUS=0
sh "$SCRIPT" patientscribe-viewer-dev --overlay "$WORK/overlay.json" > "$WORK/out.txt" 2>&1 || STATUS=$?

if [ "$STATUS" -eq 0 ]; then
  record ok 'a conforming distribution passes'
else
  record fail 'a conforming distribution passes' "exit ${STATUS}: $(cat "$WORK/out.txt")"
fi

for CALL in 'cloudformation describe-stacks' 'cloudfront get-distribution-config' 'cloudwatch describe-alarms'; do
  if grep -q "^${CALL} " "$FAKE_AWS_TRANSCRIPT"; then
    record ok "the ${CALL} call is made"
  else
    record fail "the ${CALL} call is made" "$(cat "$FAKE_AWS_TRANSCRIPT")"
  fi
done

OFF_REGION=$(grep -v -- '--region us-east-1' "$FAKE_AWS_TRANSCRIPT" || true)
if [ -z "$OFF_REGION" ]; then
  record ok 'every call carries the pinned region'
else
  record fail 'every call carries the pinned region' "$OFF_REGION"
fi

if grep -q -- '--id EXAMPLEDISTID' "$FAKE_AWS_TRANSCRIPT"; then
  record ok 'the distribution asked about is the one the stack named'
else
  record fail 'the distribution asked about is the one the stack named' "$(cat "$FAKE_AWS_TRANSCRIPT")"
fi

if grep -q -- '--alarm-names patientscribe-viewer-dev-requests' "$FAKE_AWS_TRANSCRIPT"; then
  record ok 'the alarm asked about is the one the stack named'
else
  record fail 'the alarm asked about is the one the stack named' "$(cat "$FAKE_AWS_TRANSCRIPT")"
fi

PASS_TRANSCRIPT=$(cat "$FAKE_AWS_TRANSCRIPT")

# ---------------------------------------------------------------------------
# Armed, against a distribution that has drifted.
# ---------------------------------------------------------------------------
sed 's/"DefaultRootObject": "index.html"/"DefaultRootObject": "home.html"/' \
  "$WORK/distribution.json" > "$WORK/drifted.json"
FAKE_AWS_DISTRIBUTION="$WORK/drifted.json"
export FAKE_AWS_DISTRIBUTION

: > "$FAKE_AWS_TRANSCRIPT"
STATUS=0
sh "$SCRIPT" patientscribe-viewer-dev --overlay "$WORK/overlay.json" > "$WORK/out.txt" 2>&1 || STATUS=$?

if [ "$STATUS" -eq 1 ]; then
  record ok 'a drifted distribution fails through the fetching half too'
else
  record fail 'a drifted distribution fails through the fetching half too' "exit ${STATUS}: $(cat "$WORK/out.txt")"
fi

echo
echo 'transcript of the passing run:'
printf '%s\n' "$PASS_TRANSCRIPT" | sed 's/^/  /'
echo

if [ "$FAILURES" -eq 0 ]; then
  echo 'assert-distribution self-test — PASS'
  exit 0
fi
echo "assert-distribution self-test — FAIL (${FAILURES} case(s))"
exit 1
