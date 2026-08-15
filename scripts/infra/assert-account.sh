#!/bin/sh
#
# Refuse to go any further if the credentials in hand are not the account this
# deploy is for.
#
# GATE NOTE: this script makes one read-only AWS call and changes nothing. It is
# the thing that runs before the calls that do. It is not itself gated, because a
# check that is harder to run than the act it guards is a check that gets skipped.
#
# The expected account is never written in this file. It comes from the
# environment or from the deploy overlay, in that order, and if neither has it the
# script exits without calling anything — an assertion with no expectation is an
# assertion that passes whatever it is given, which is worse than no assertion at
# all because it looks like one.
#
# Usage:
#   scripts/infra/assert-account.sh [--profile NAME] [--overlay PATH]
#
# Exit codes: 0 = the account matches, 1 = it does not, 2 = the check could not
# be run at all.

set -eu

# Pinned, not defaulted, and not read from the environment. CloudFront's metrics
# and a distribution's certificate both live in this region only, so a call that
# lands somewhere else is a call whose answer means nothing here.
REGION='us-east-1'

PROFILE='patientscribe-dev'
OVERLAY='infra/parameters.json'

while [ $# -gt 0 ]; do
  case "$1" in
    --profile)
      [ $# -ge 2 ] || { echo 'assert-account — --profile needs a value' >&2; exit 2; }
      PROFILE="$2"
      shift 2
      ;;
    --overlay)
      [ $# -ge 2 ] || { echo 'assert-account — --overlay needs a value' >&2; exit 2; }
      OVERLAY="$2"
      shift 2
      ;;
    *)
      echo "assert-account — unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

HERE=$(dirname "$0")

EXPECTED="${VIEWER_EXPECTED_ACCOUNT_ID:-}"

if [ -z "$EXPECTED" ]; then
  if [ -f "$OVERLAY" ]; then
    EXPECTED=$(node "$HERE/read-overlay-parameter.mjs" "$OVERLAY" AccountId) || exit 2
  fi
fi

if [ -z "$EXPECTED" ]; then
  echo 'assert-account — cannot run: no expected account. Set VIEWER_EXPECTED_ACCOUNT_ID or supply an overlay carrying AccountId.' >&2
  exit 2
fi

ACTUAL=$(aws sts get-caller-identity --query Account --output text --region "$REGION" --profile "$PROFILE") || {
  echo 'assert-account — cannot run: the identity call did not answer' >&2
  exit 2
}

if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "assert-account — FAIL: these credentials are for a different account than this deploy expects (profile ${PROFILE})" >&2
  exit 1
fi

echo "assert-account — PASS: the profile ${PROFILE} resolves to the expected account"
exit 0
