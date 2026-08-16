#!/bin/sh
#
# Read the built distribution back off the control plane and check it is the one
# the template describes.
#
# GATE NOTE: this script is disarmed. It refuses before it makes a single call
# unless VIEWER_DEPLOY_ARMED is exactly `armed-by-the-gate`, and nothing in this
# repository sets it. The deploy gate arms it, after the change set has been
# applied.
#
# This is the half of the gate the live release check cannot cover. That check
# reads responses, and a response only exists for a request something made — so
# it can tell you what a 404 carried but not that all eleven statuses are
# configured to pass through, and it can tell you what headers arrived but not
# which policy resource put them there. Those are configuration facts, and they
# are read from the configuration.
#
# The assertions themselves live in assert-distribution-core.mjs, which takes
# JSON and returns refusals. This file only fetches. That split is what lets
# every failing direction be exercised from canned documents rather than by
# breaking a real distribution to see what happens.
#
# The alarm's expected topic comes from the overlay or from the explicit option
# below. One of those has to provide it: a run that cannot say what the alarm
# should notify does not fall back to checking less — it refuses, and says what
# it was missing. The earlier shape-only reading ("exactly one action, whatever
# it is") would have passed an alarm notifying an entirely different topic.
#
# The expected THRESHOLD comes from somewhere else, and the difference is the
# point: it is read from the stack's own RequestCountAlarmThreshold output. A
# threshold read from a local file is a threshold that can drift from the one the
# stack was deployed with, and the two disagreeing is the case this assertion
# exists to catch — so the comparison is against what the stack itself states. A
# stack that states none is a refusal, named as one.
#
# Usage:
#   scripts/infra/assert-distribution.sh <stack-name> [--profile NAME] [--overlay PATH]
#                                        [--expected-alarm-action VALUE]
#
# Exit codes: 0 = everything held, 1 = something did not, 2 = could not run,
# 3 = disarmed.

set -eu

if [ "${VIEWER_DEPLOY_ARMED:-}" != 'armed-by-the-gate' ]; then
  echo 'assert-distribution — refusing: this script is disarmed. It makes no calls until the deploy gate arms it.' >&2
  exit 3
fi

REGION='us-east-1'
PROFILE='patientscribe-dev'
OVERLAY='infra/parameters.json'

STACK="${1:-}"
if [ -z "$STACK" ]; then
  echo 'assert-distribution — cannot run: a stack name is required' >&2
  exit 2
fi
shift

while [ $# -gt 0 ]; do
  case "$1" in
    --profile)
      [ $# -ge 2 ] || { echo 'assert-distribution — --profile needs a value' >&2; exit 2; }
      PROFILE="$2"
      shift 2
      ;;
    --overlay)
      [ $# -ge 2 ] || { echo 'assert-distribution — --overlay needs a value' >&2; exit 2; }
      OVERLAY="$2"
      shift 2
      ;;
    --expected-alarm-action)
      [ $# -ge 2 ] || { echo 'assert-distribution — --expected-alarm-action needs a value' >&2; exit 2; }
      EXPECTED_ACTION="$2"
      shift 2
      ;;
    *)
      echo "assert-distribution — unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

HERE=$(dirname "$0")
CORE="$HERE/assert-distribution-core.mjs"

# ---------------------------------------------------------------------------
# The alarm's expected topic, resolved before anything is called.
# ---------------------------------------------------------------------------
#
# The explicit option wins; the overlay fills it in where the option left it
# empty. Missing it is a refusal here rather than a weaker assertion later, and
# it happens before the first call so a run that could never have concluded
# anything costs nothing.
if [ -z "${EXPECTED_ACTION:-}" ] && [ -f "$OVERLAY" ]; then
  EXPECTED_ACTION=$(node "$HERE/read-overlay-parameter.mjs" "$OVERLAY" AlarmTopicArn) || EXPECTED_ACTION=''
fi

if [ -z "${EXPECTED_ACTION:-}" ]; then
  echo "assert-distribution — cannot run: no expected alarm topic. Supply --expected-alarm-action, or an overlay carrying AlarmTopicArn (looked in ${OVERLAY})." >&2
  exit 2
fi

WORK=$(mktemp -d)
# shellcheck disable=SC2064
trap "rm -rf '$WORK'" EXIT INT TERM

aws_pinned() {
  aws "$@" --region "$REGION" --profile "$PROFILE"
}

aws_pinned cloudformation describe-stacks \
  --stack-name "$STACK" \
  --output json > "$WORK/stacks.json"

DISTRIBUTION_ID=$(node "$CORE" --read-output "$WORK/stacks.json" DistributionId)

# The threshold the stack itself states it was deployed with. Read from the
# document already fetched above rather than from a second call, and refused by
# name where the stack states none.
EXPECTED_THRESHOLD=$(node "$CORE" --read-output "$WORK/stacks.json" RequestCountAlarmThreshold) || {
  echo "assert-distribution — cannot run: the stack states no RequestCountAlarmThreshold output, so there is nothing to compare the live alarm's threshold against." >&2
  exit 2
}

aws_pinned cloudfront get-distribution-config \
  --id "$DISTRIBUTION_ID" \
  --output json > "$WORK/distribution.json"

ALARM_NAME=$(node "$CORE" --read-output "$WORK/stacks.json" RequestCountAlarmName)

aws_pinned cloudwatch describe-alarms \
  --alarm-names "$ALARM_NAME" \
  --output json > "$WORK/alarms.json"

# Both expectations were resolved above — the topic before the first call, the
# threshold from the stack's own output — and the run refused if either was
# missing, so there is one branch here rather than a weaker and a stronger one.
#
# Not `exec`: the temp directory holding three documents read off this account is
# removed by the trap above, and exec would replace this shell before it ran.
STATUS=0
node "$CORE" --assert \
  "$WORK/stacks.json" "$WORK/distribution.json" "$WORK/alarms.json" \
  --expected-alarm-action "$EXPECTED_ACTION" \
  --expected-threshold "$EXPECTED_THRESHOLD" || STATUS=$?

exit "$STATUS"
