#!/bin/sh
#
# Put the viewer stack through a change set, in two acts with a person between
# them.
#
# GATE NOTE: this script is disarmed. It refuses before it makes a single call
# unless VIEWER_DEPLOY_ARMED is exactly `armed-by-the-gate`, and nothing in this
# repository sets it. Arming it is the deploy gate's act and nobody else's.
#
# Why a change set and not a deploy: a change set is the diff, written down,
# before anything happens. `--create` builds it and shows it; `--execute` applies
# one that has already been read. Two commands, because the reading is the point
# and a single command that prints a diff and then applies it is a command whose
# diff nobody reads.
#
# `--parameter-overrides` appears nowhere in this file. The overlay is a
# CloudFormation parameters file and is handed to the CLI as one, unmodified. A
# script that reads the overlay and rebuilds it as command-line arguments is a
# script with its own opinion about what the parameters are, and the deploy is not
# a place for a second opinion.
#
# Usage:
#   scripts/infra/deploy-changeset.sh <dev|prod> --create <CREATE|UPDATE> [--profile NAME] [--overlay PATH]
#   scripts/infra/deploy-changeset.sh <dev|prod> --execute <change-set-name>  [--profile NAME] [--overlay PATH]
#
# Exit codes: 0 = done, 1 = a call refused, 2 = the script could not run,
# 3 = disarmed.

set -eu

# ---------------------------------------------------------------------------
# The guard, first, before anything at all.
# ---------------------------------------------------------------------------
if [ "${VIEWER_DEPLOY_ARMED:-}" != 'armed-by-the-gate' ]; then
  echo 'deploy-changeset — refusing: this script is disarmed. It makes no calls until the deploy gate arms it.' >&2
  exit 3
fi

REGION='us-east-1'
TEMPLATE='infra/viewer-stack.yaml'

PROFILE='patientscribe-dev'
OVERLAY='infra/parameters.json'
MODE=''
CHANGE_SET_TYPE=''
SUPPLIED_NAME=''

FLAVOUR="${1:-}"
case "$FLAVOUR" in
  dev|prod) shift ;;
  *)
    echo 'deploy-changeset — cannot run: first argument must be dev or prod' >&2
    exit 2
    ;;
esac

# The stack name is prescribed, not invented and not configurable. It is public,
# it is one of two strings, and the flavour picks which.
STACK="patientscribe-viewer-${FLAVOUR}"

while [ $# -gt 0 ]; do
  case "$1" in
    --create)
      [ $# -ge 2 ] || { echo 'deploy-changeset — --create needs CREATE or UPDATE' >&2; exit 2; }
      MODE='create'
      CHANGE_SET_TYPE="$2"
      shift 2
      ;;
    --execute)
      [ $# -ge 2 ] || { echo 'deploy-changeset — --execute needs a change-set name' >&2; exit 2; }
      MODE='execute'
      SUPPLIED_NAME="$2"
      shift 2
      ;;
    --profile)
      [ $# -ge 2 ] || { echo 'deploy-changeset — --profile needs a value' >&2; exit 2; }
      PROFILE="$2"
      shift 2
      ;;
    --overlay)
      [ $# -ge 2 ] || { echo 'deploy-changeset — --overlay needs a value' >&2; exit 2; }
      OVERLAY="$2"
      shift 2
      ;;
    *)
      echo "deploy-changeset — unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

case "$MODE" in
  create)
    # CREATE or UPDATE is stated, never worked out. A script that inspects the
    # stack and decides for itself which one this is will one day decide wrong,
    # and it will say so after the fact rather than before.
    case "$CHANGE_SET_TYPE" in
      CREATE|UPDATE) ;;
      *)
        echo 'deploy-changeset — cannot run: --create takes CREATE or UPDATE' >&2
        exit 2
        ;;
    esac
    ;;
  execute) ;;
  *)
    echo 'deploy-changeset — cannot run: one of --create or --execute is required' >&2
    exit 2
    ;;
esac

# ---------------------------------------------------------------------------
# The change-set name, decided once.
# ---------------------------------------------------------------------------
#
# One variable, set here and read everywhere below. On a create it is derived
# from the clock; on an execute it is the one the caller read off the create.
# Either way nothing downstream re-derives it, which is the property worth
# protecting: a name computed twice is a name that can differ between the change
# set that was reviewed and the change set that was applied.
if [ "$MODE" = 'create' ]; then
  CHANGE_SET_NAME="${STACK}-$(date -u +%Y%m%dT%H%M%SZ)"
else
  CHANGE_SET_NAME="$SUPPLIED_NAME"
fi

HERE=$(dirname "$0")

# ---------------------------------------------------------------------------
# The flavour and the overlay have to be talking about the same environment.
# ---------------------------------------------------------------------------
#
# The dev|prod argument picks the stack name. The overlay carries `Environment`,
# which picks whether the template builds the prod identity. Nothing connected
# those two, so a prod overlay handed to a `dev` run would have built the prod
# certificate, alias and DNS records into the stack named
# patientscribe-viewer-dev — and the reverse would have stood prod up with no
# alias at all. Both are one mistyped word away and neither announces itself.
#
# So they are compared, here, before the first call of any kind. The overlay is
# required rather than optional: it is the parameters file the change set is
# built from, so a run without one was never going to work, and finding that out
# before the identity call is better than after it.
OVERLAY_ENVIRONMENT=$(node "$HERE/read-overlay-parameter.mjs" "$OVERLAY" Environment) || {
  echo "deploy-changeset — cannot run: ${OVERLAY} must exist and must carry an Environment parameter" >&2
  exit 2
}

if [ "$OVERLAY_ENVIRONMENT" != "$FLAVOUR" ]; then
  echo "deploy-changeset — refusing: this is a ${FLAVOUR} run and ${OVERLAY} is a ${OVERLAY_ENVIRONMENT} overlay" >&2
  exit 1
fi

# Every call goes through here, so every call carries the region and the profile.
# Pinned at the end of the argument list rather than the front because that is
# where the CLI is unambiguous about them, and passed on every call rather than
# set once in the environment because an environment variable is a thing that can
# be unset by something else in the same shell.
aws_pinned() {
  aws "$@" --region "$REGION" --profile "$PROFILE"
}

# ---------------------------------------------------------------------------
# Identity, before anything that changes something.
# ---------------------------------------------------------------------------
sh "$HERE/assert-account.sh" --profile "$PROFILE" --overlay "$OVERLAY"

if [ "$MODE" = 'create' ]; then
  echo "deploy-changeset — building ${CHANGE_SET_NAME} (${CHANGE_SET_TYPE}) on ${STACK}"

  aws_pinned cloudformation create-change-set \
    --stack-name "$STACK" \
    --change-set-name "$CHANGE_SET_NAME" \
    --change-set-type "$CHANGE_SET_TYPE" \
    --template-body "file://${TEMPLATE}" \
    --parameters "file://${OVERLAY}"

  aws_pinned cloudformation wait change-set-create-complete \
    --stack-name "$STACK" \
    --change-set-name "$CHANGE_SET_NAME"

  aws_pinned cloudformation describe-change-set \
    --stack-name "$STACK" \
    --change-set-name "$CHANGE_SET_NAME" \
    --output json

  echo
  echo "deploy-changeset — the change set above is not applied. Read it, then:"
  echo "  VIEWER_DEPLOY_ARMED=armed-by-the-gate $0 ${FLAVOUR} --execute ${CHANGE_SET_NAME}"
  exit 0
fi

echo "deploy-changeset — applying ${CHANGE_SET_NAME} on ${STACK}"

aws_pinned cloudformation execute-change-set \
  --stack-name "$STACK" \
  --change-set-name "$CHANGE_SET_NAME"

echo 'deploy-changeset — applied. The stack is settling; the control-plane assertions are the next act.'
exit 0
