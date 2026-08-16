#!/bin/sh
#
# The switch: put a published release on the origin, and prove it is what is
# being served.
#
# GATE NOTE: this driver is disarmed. It refuses before it makes a single call
# unless VIEWER_RELEASE_ARMED is exactly `armed-by-the-gate`, and nothing in this
# repository sets it. That variable is deliberately not the deploy one and
# deliberately not the drill one: arming a deploy must not arm a release, and
# arming a release must not arm a drill.
#
# ONE CODE PATH FOR BOTH DIRECTIONS. A rollback is a switch to an older
# manifest. `--operation` is a field of the log, never a branch of the code,
# because a branch taken rarely is a branch nobody has watched work.
#
# WHAT "ATOMIC" MEANS HERE, verbatim from the ruling: a switch succeeds only
# after (i) the entry-point object is replaced, (ii) ONE invalidation batch
# covering exactly `/` and `/index.html` completes with its identifier recorded,
# and (iii) the release check runs post-invalidation and exits 0. Any step
# failing = failed switch, fail closed, logged. Success is never declared on (i)
# alone.
#
# THE TARGET IS NOT A FILE ARGUMENT. What gets served is the manifest the PUBLIC
# tip publishes under `releases/<id>.json`; the supplied `--release-dir` has to
# carry a byte-identical copy of it, and the identifier has to be the same string
# in the argument, in the manifest, and in the roster filename. Publication —
# commit AND push — precedes a switch by construction, because an unpushed
# manifest is invisible to the reading this does.
#
# THE TRUST MODEL, stated rather than implied. Reading `refs/remotes/origin/main`
# is a local act: no fetch, no network. It catches the MISTAKE classes — a
# forgotten push, the wrong repository, a local-only commit — and it cannot prove
# the remote's live state from a tool that reaches nothing. The ruled trust
# anchor puts manifest resolution in the hands of the person running the gate,
# and RELEASING.md prescribes that person's own first step before any armed run:
# `git fetch origin`. Two mechanical teeth back it up: the origin remote's host
# and path are asserted against the committed public ones, and the manifest's
# commit must be an ancestor of the public tip.
#
# Usage:
#   scripts/infra/release.sh <dev|prod> --release-id <id> --release-dir <dir>
#                            --operation <release|rollback>
#                            [--profile NAME] [--overlay PATH]
#                            [--retention-days N] [--poll-seconds N]
#                            [--timeout-seconds N]
#
# Exit codes: 0 = the switch is verified, 1 = it refused or failed,
# 2 = it could not run, 3 = disarmed.

set -eu

TOOL='release'

# ---------------------------------------------------------------------------
# The guard, first, before anything at all.
# ---------------------------------------------------------------------------
if [ "${VIEWER_RELEASE_ARMED:-}" != 'armed-by-the-gate' ]; then
  echo 'release — refusing: this driver is disarmed. It makes no call until the release gate arms it, and VIEWER_RELEASE_ARMED is not the deploy gate variable or the drill one.' >&2
  exit 3
fi

HERE=$(cd "$(dirname "$0")" && pwd)
CORE="$HERE/release-core.mjs"
SELF="$HERE/release.sh"

# shellcheck source=scripts/infra/release-common.sh
. "$HERE/release-common.sh"

require_no_inherited_account_expectation

# ---------------------------------------------------------------------------
# The command line
# ---------------------------------------------------------------------------
PROFILE="$DEFAULT_PROFILE"
OVERLAY="$DEFAULT_OVERLAY"
RETENTION_DAYS="$DEFAULT_RETENTION_DAYS"
POLL_SECONDS="$DEFAULT_POLL_SECONDS"
TIMEOUT_SECONDS="$DEFAULT_TIMEOUT_SECONDS"
RELEASE_ID=''
RELEASE_DIR=''
OPERATION=''

FLAVOUR="${1:-}"
case "$FLAVOUR" in
  dev|prod) shift ;;
  *) cannot_run 'the first argument must be dev or prod' ;;
esac

while [ $# -gt 0 ]; do
  case "$1" in
    --release-id) [ $# -ge 2 ] || cannot_run '--release-id needs a value'; RELEASE_ID="$2"; shift 2 ;;
    --release-dir) [ $# -ge 2 ] || cannot_run '--release-dir needs a value'; RELEASE_DIR="$2"; shift 2 ;;
    --operation) [ $# -ge 2 ] || cannot_run '--operation needs a value'; OPERATION="$2"; shift 2 ;;
    --profile) [ $# -ge 2 ] || cannot_run '--profile needs a value'; PROFILE="$2"; shift 2 ;;
    --overlay) [ $# -ge 2 ] || cannot_run '--overlay needs a value'; OVERLAY="$2"; shift 2 ;;
    --retention-days) [ $# -ge 2 ] || cannot_run '--retention-days needs a value'; RETENTION_DAYS="$2"; shift 2 ;;
    --poll-seconds) [ $# -ge 2 ] || cannot_run '--poll-seconds needs a value'; POLL_SECONDS="$2"; shift 2 ;;
    --timeout-seconds) [ $# -ge 2 ] || cannot_run '--timeout-seconds needs a value'; TIMEOUT_SECONDS="$2"; shift 2 ;;
    *) cannot_run "unknown argument: $1" ;;
  esac
done

[ -n "$RELEASE_ID" ] || cannot_run '--release-id is required'
[ -n "$RELEASE_DIR" ] || cannot_run '--release-dir is required'
case "$OPERATION" in
  release|rollback) ;;
  *) cannot_run '--operation takes release or rollback' ;;
esac

require_no_newline '--release-dir' "$RELEASE_DIR"
require_no_newline '--overlay' "$OVERLAY"
require_no_newline '--release-id' "$RELEASE_ID"
require_no_newline '--profile' "$PROFILE"

require_positive_integer '--retention-days' "$RETENTION_DAYS"
require_positive_integer '--poll-seconds' "$POLL_SECONDS"
require_positive_integer '--timeout-seconds' "$TIMEOUT_SECONDS"
if [ "$TIMEOUT_SECONDS" -lt "$POLL_SECONDS" ]; then
  cannot_run "--timeout-seconds is ${TIMEOUT_SECONDS} and --poll-seconds is ${POLL_SECONDS}, and a timeout shorter than one interval is a timeout that expires before the first answer"
fi

node "$CORE" --is-release-id "$RELEASE_ID" || exit 1

[ -d "$RELEASE_DIR" ] || cannot_run "${RELEASE_DIR} does not exist"
RELEASE_DIR=$(cd "$RELEASE_DIR" && pwd)
if [ -f "$OVERLAY" ]; then
  OVERLAY="$(cd "$(dirname "$OVERLAY")" && pwd)/$(basename "$OVERLAY")"
fi

# ---------------------------------------------------------------------------
# The run, the lock, and the record area
# ---------------------------------------------------------------------------
RUN_ID=$(node "$CORE" --run-id)
RUN_TIMESTAMP="${RUN_ID%-*}"

LOCK_HELD='no'
# A trapped signal in this shell runs its handler and then CARRIES ON. Releasing
# the lock and returning would leave a run that is still uploading holding no
# lock at all, with the next armed act free to start beside it — so the signal
# handler ends the run. The exit handler is the same call, and the LOCK_HELD
# guard makes the second one a no-op. A run killed this way is a crash like any
# other: the way out is the fix-forward re-run, or the remediation the failure
# path would have printed.
trap 'release_the_lock' EXIT
trap 'release_the_lock; exit 130' INT TERM
take_the_lock

RECORD_DIR="$RELEASE_DIR/records/$RUN_ID"
mkdir -p "$RECORD_DIR"
SEQ_FILE="$RECORD_DIR/sequence"
echo 1 > "$SEQ_FILE"
INVALIDATION_IDS="$RECORD_DIR/invalidation-ids.txt"
: > "$INVALIDATION_IDS"

note "run ${RUN_ID}, ${OPERATION} of ${RELEASE_ID} on ${FLAVOUR}"
note "record area ${RECORD_DIR}"

# ---------------------------------------------------------------------------
# Remediation, printed rather than performed
# ---------------------------------------------------------------------------
#
# PRINT, NOT EXECUTE. An automatic rollback that itself fails invites a loop, and
# a rollback is its own gated act on this same path. What is printed is
# executable as printed: every value is POSIX single-quoted and every path-valued
# option is absolute, because a rollback runs in a fresh worktree where this
# run's relative paths mean nothing.

this_invocation() {
  printf 'VIEWER_RELEASE_ARMED=armed-by-the-gate %s %s --release-id %s --release-dir %s --operation %s --profile %s --overlay %s --retention-days %s --poll-seconds %s --timeout-seconds %s\n' \
    "$(q "$SELF")" "$(q "$FLAVOUR")" "$(q "$RELEASE_ID")" "$(q "$RELEASE_DIR")" "$(q "$OPERATION")" \
    "$(q "$PROFILE")" "$(q "$OVERLAY")" "$(q "$RETENTION_DAYS")" "$(q "$POLL_SECONDS")" "$(q "$TIMEOUT_SECONDS")"
}

remediate_forward() {
  echo
  echo 'THE WAY OUT IS FORWARD — re-run this same switch once you know why it failed.'
  echo
  echo '  The uploads did not all land, or the entry-point put was not confirmed. A lost'
  echo '  success response proves nothing about what landed, so after a failed entry-point'
  echo '  put THE SERVED DOCUMENT IS UNKNOWN — it is not to be assumed to be the prior one.'
  echo
  echo '  A rollback cannot come up green here: the target is published, so its manifest is'
  echo '  in the union the check probes, and the check asks for every object that union'
  echo '  names. Re-running this switch is what converges the origin — puts are idempotent,'
  echo '  the re-run fills exactly what is missing, re-puts the entry point, and lands on'
  echo '  the verified target whichever document the failed put left current.'
  echo
  echo '  Diagnose first, then:'
  echo
  printf '    '
  this_invocation
  echo
  echo '  THE CORNER THIS LEAVES, named rather than hidden: a published release whose upload'
  echo '  is ABANDONED keeps the origin refusing — extra or missing union assets, both'
  echo '  fail-closed by design — until its switch completes, or until a later gated'
  echo '  retirement round removes its objects. No tool in this repository deletes anything.'
  echo '  Meanwhile the kill path is available: disable the distribution.'
}

remediate_back() {
  echo
  echo 'THE WAY OUT IS BACK — the entry point was replaced and the target is unverified.'
  echo
  echo '  Every object of the target landed before the entry point moved, so a rollback to'
  echo '  the prior release runs clean: its own upload step re-puts the prior origin table,'
  echo '  and its union leg holds for target-caused refusals.'
  echo
  if [ "$PRIOR_RELEASE_ID" = 'no-prior-release' ]; then
    echo '  There is no prior release to go back to — this origin was serving nothing before'
    echo '  this run. The containment is the kill path the scope names: disable the'
    echo '  CloudFront distribution by hand. The carer then sees nothing, which is the'
    echo '  intended state until a release verifies.'
  else
    echo "  The prior release is ${PRIOR_RELEASE_ID}, and its published manifest is already"
    echo '  materialised in this run'"'"'s record area:'
    echo
    echo "    $(q "$RECORD_DIR/prior-manifest.json")"
    echo
    echo '  Rebuild its layout from its own commit, in a separate worktree, and roll back:'
    echo
    echo "    git worktree add ../viewer-rollback \$(node $(q "$CORE") --manifest-field $(q "$RECORD_DIR/prior-manifest.json") commit)"
    echo '    cd ../viewer-rollback'
    echo "    node $(q "$HERE/build-release.mjs") --out /absolute/path/to/rollback-build --release-id $(q "$PRIOR_RELEASE_ID")"
    echo
    printf '    VIEWER_RELEASE_ARMED=armed-by-the-gate %s %s --release-id %s --release-dir %s --operation %s --profile %s --overlay %s --retention-days %s --poll-seconds %s --timeout-seconds %s\n' \
      "$(q "$SELF")" "$(q "$FLAVOUR")" "$(q "$PRIOR_RELEASE_ID")" "$(q "/absolute/path/to/rollback-build/$PRIOR_RELEASE_ID")" "$(q 'rollback')" \
      "$(q "$PROFILE")" "$(q "$OVERLAY")" "$(q "$RETENTION_DAYS")" "$(q "$POLL_SECONDS")" "$(q "$TIMEOUT_SECONDS")"
    echo
    echo '  The rebuild is byte-identical to what was published — the build is a pure'
    echo '  function of the tree and the identifier — and the driver proves that for itself'
    echo '  before it calls anything.'
  fi
  echo
  echo '  READ THE REFUSALS FIRST. A refusal naming a RETAINED release'"'"'s missing assets is'
  echo '  the origin'"'"'s roster being damaged rather than this target being wrong: a rollback'
  echo '  runs the same union and refuses identically. The ways out of that are completing'
  echo '  that release'"'"'s own upload, or a later gated retirement round; the kill path is'
  echo '  available meanwhile.'
  echo
  echo '  If the cause looks transient, fix-forward is the alternative — re-run this switch:'
  echo
  printf '    '
  this_invocation
}

# ---------------------------------------------------------------------------
# Failing, from the first logged event onward
# ---------------------------------------------------------------------------
fail_switch() {
  FAIL_CLASS="$1"
  FAIL_STEP="$2"
  FAIL_DETAIL="$3"

  echo "${TOOL} — FAILED at ${FAIL_STEP}: ${FAIL_DETAIL}" >&2

  LOG_WRITE_FAILED='no'
  log_event 'switch-failed' 'failed' "${FAIL_STEP}: ${FAIL_DETAIL}; prior release ${PRIOR_RELEASE_ID}" || LOG_WRITE_FAILED='yes'

  if [ "$FAIL_CLASS" = 'forward' ]; then
    remediate_forward
  else
    remediate_back
  fi

  if [ "$LOG_WRITE_FAILED" = 'yes' ]; then
    echo
    echo 'AND THE RECORD IS MISSING TOO. Both failures are reported together: the switch'
    echo 'failed as described above, and the switch-failed event could not be written to'
    echo 'the release log — so nothing account-side records that this run happened.'
  fi

  exit 1
}

# ---------------------------------------------------------------------------
# [0] The preflight — every refusal here costs nothing and mutates nothing
# ---------------------------------------------------------------------------
bind_environment
git_context
materialise_roster
prove_config_binding
prove_provenance
note "[0] preflight held: ${RELEASE_ID} at ${MANIFEST_COMMIT} is what this repository produces, and the public tip publishes it"

# ---------------------------------------------------------------------------
# [1] Identity, then the deployed truth
# ---------------------------------------------------------------------------
resolve_deployment
note "[1] resolved: distribution ${DISTRIBUTION_ID}, origin ${ORIGIN}"

# ---------------------------------------------------------------------------
# [2] The prior-release capture — still the refusal regime
# ---------------------------------------------------------------------------
#
# The listing alone decides whether a prior entry point exists. Where it does not,
# get-object is not called at all; where it does, ANY failure of that call is a
# refusal, because existence was already settled and there is no error-mode
# parsing here to make a second reading out of.
aws_pinned s3api list-objects-v2 --bucket "$ORIGIN_BUCKET" --output json > "$RECORD_DIR/listing-capture.json" ||
  refuse 'the origin bucket could not be listed, and the prior-release capture is what a failed switch is remediated from'
node "$CORE" --listing-keys "$RECORD_DIR/listing-capture.json" > "$RECORD_DIR/keys-capture.txt" || exit 1

PRIOR_RELEASE_ID='no-prior-release'
if grep -qx 'index.html' "$RECORD_DIR/keys-capture.txt"; then
  aws_pinned s3api get-object --bucket "$ORIGIN_BUCKET" --key index.html "$RECORD_DIR/prior-index.html" --output json > "$RECORD_DIR/get-object.json" ||
    refuse 'the origin lists an entry point and it could not be read — existence was already decided by the listing, so this is a state to stop on rather than to mutate past'
  PRIOR_RELEASE_ID=$(node "$CORE" --scan-release-comment "$RECORD_DIR/prior-index.html") || exit 1

  if ! grep -qx "$PRIOR_RELEASE_ID" "$RECORD_DIR/roster.txt"; then
    refuse "the origin is serving ${PRIOR_RELEASE_ID} and the public tip does not publish it — the printed way back leans on that manifest, so this is a state to stop on. The manual out is the kill path: disable the distribution."
  fi
  git -C "$REPO" show "${PUBLIC_TIP}:releases/${PRIOR_RELEASE_ID}.json" > "$RECORD_DIR/prior-manifest.json" ||
    refuse "the public tip lists ${PRIOR_RELEASE_ID}.json and could not produce it"
fi
note "[2] the origin is serving ${PRIOR_RELEASE_ID}"

# ------------------------------------------------------------------
# From here on every outcome is logged.
# ------------------------------------------------------------------
log_event 'switch-started' 'ok' "the origin is serving ${PRIOR_RELEASE_ID}" ||
  refuse 'the switch-started event could not be written to the release log, and nothing has been mutated — a broken record stops a switch before it starts rather than after it'

# ---------------------------------------------------------------------------
# [3] and [4] The uploads, and then the entry point
# ---------------------------------------------------------------------------
#
# THE KEY RULE: an object's key is its manifest path with the single leading
# slash removed and nothing else changed. The distribution's default root object
# is exactly `index.html`, and a key with a leading slash is a different object
# that would never be served.
node "$CORE" --plan "$TARGET_MANIFEST" > "$RECORD_DIR/plan.tsv" || exit 1

TAB=$(printf '\t')
while IFS="$TAB" read -r PLAN_PATH PLAN_KEY PLAN_TYPE PLAN_CACHE; do
  [ -n "$PLAN_PATH" ] || continue
  BODY="$RELEASE_DIR/layout/$PLAN_KEY"
  [ -f "$BODY" ] ||
    fail_switch 'forward' '[3] the object uploads' "the layout has no ${PLAN_KEY}"

  if [ "$PLAN_PATH" = '/index.html' ]; then
    STEP='[4] the entry-point put'
    CLASS='forward'
  else
    STEP='[3] the object uploads'
    CLASS='forward'
  fi

  if [ "$PLAN_CACHE" = '-' ]; then
    aws_pinned s3api put-object \
      --bucket "$ORIGIN_BUCKET" \
      --key "$PLAN_KEY" \
      --body "$BODY" \
      --content-type "$PLAN_TYPE" < /dev/null > /dev/null ||
      fail_switch "$CLASS" "$STEP" "${PLAN_KEY} was not put"
  else
    aws_pinned s3api put-object \
      --bucket "$ORIGIN_BUCKET" \
      --key "$PLAN_KEY" \
      --body "$BODY" \
      --content-type "$PLAN_TYPE" \
      --cache-control "$PLAN_CACHE" < /dev/null > /dev/null ||
      fail_switch "$CLASS" "$STEP" "${PLAN_KEY} was not put"
  fi
  note "  put ${PLAN_KEY}"
done < "$RECORD_DIR/plan.tsv"
note '[3] and [4] every object is on the origin, and the entry point moved last'

# ---------------------------------------------------------------------------
# [5] One invalidation, covering exactly the two aliases, to completion
# ---------------------------------------------------------------------------
invalidate_two_aliases 'switch' ||
  fail_switch 'back' '[5] the invalidation' "the invalidation did not complete within ${TIMEOUT_SECONDS}s"

# ---------------------------------------------------------------------------
# [6] The deploy-side listing
# ---------------------------------------------------------------------------
fresh_inventory "$RECORD_DIR/inventory.json" 'switch' ||
  fail_switch 'back' '[6] the deploy-side listing' 'the origin bucket could not be listed as a complete, untruncated listing'

# ---------------------------------------------------------------------------
# [7] The wire half of E-6, post-invalidation. Its exit IS the verdict.
# ---------------------------------------------------------------------------
CHECK_STATUS=0
run_wire_check "$RECORD_DIR/inventory.json" "$TARGET_MANIFEST" "$RECORD_DIR/release-check.txt" || CHECK_STATUS=$?
if [ "$CHECK_STATUS" -ne 0 ]; then
  fail_switch 'back' '[7] the wire half of E-6' "the release check exited ${CHECK_STATUS}"
fi

# ---------------------------------------------------------------------------
# [8] The record
# ---------------------------------------------------------------------------
LAST_INVALIDATION=$(tail -1 "$INVALIDATION_IDS")
log_event 'switch-succeeded' 'ok' "the wire half of E-6 exited 0 after invalidation ${LAST_INVALIDATION}" || {
  echo
  echo 'THE SWITCH ITSELF IS VERIFIED GREEN. The entry point was replaced, the invalidation' >&2
  echo 'completed, and the release check exited 0 against the live origin. What failed is the' >&2
  echo 'RECORD: the switch-succeeded event could not be written to the release log.' >&2
  echo >&2
  echo 'Fix the log system, then re-run this switch. It is idempotent — the puts land the same' >&2
  echo 'bytes, and the re-run writes a complete started/succeeded pair:' >&2
  echo >&2
  printf '  ' >&2
  this_invocation >&2
  exit 1
}

note "SWITCHED — ${ORIGIN} is serving ${RELEASE_ID}, verified post-invalidation by the wire half of E-6"
note "  the browser-measured half of E-6 rides the repository's browser suites and the unit's live acceptance"
exit 0
