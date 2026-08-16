#!/bin/sh
#
# The acceptance drill: break the origin on purpose, watch the check refuse,
# put it back, and watch it pass.
#
# GATE NOTE: this driver is disarmed. It refuses before it makes a single call
# unless VIEWER_DRILL_ARMED is exactly `armed-by-the-gate`. That is deliberately
# not the deploy gate variable and deliberately not the release one: arming a
# release must not arm a drill.
#
# WHY IT IS A SEPARATE PROGRAM. The oracle observes and decides; it never
# mutates. This is the only thing here that mutates, and it mutates exactly what
# this file names — one object, the entry point, twice. A drill folded into the
# check would be a check with a write path in it.
#
# WHY THE ENTRY POINT. Both cache halves serve it `no-store` — the response
# header overrides the origin, and the edge cache is disabled entirely on that
# behaviour — so no edge and no browser holds the mangled bytes once they are
# restored. An asset-side mangle would put bytes with a year-long directive on
# them into whatever saw them; the asset-side refusal direction is proven by the
# frozen fixture corpus locally instead, where nothing is deployed.
#
# RESTORATION IS UNCONDITIONAL. Once the mangling put has been issued, the
# restore runs on every path out of this script — success, failure, or a signal —
# and it is the same code the `--restore` entry runs. Before the first mutation
# this script prints that entry's complete command line, every option spelled out
# and every path absolute, so that a crash at any later point leaves the operator
# one printed command away from a COMPLETE restoration rather than from a bare
# put.
#
# prod is refused in code. This unit drills dev.
#
# Usage:
#   scripts/infra/drill.sh dev --release-id <id> --release-dir <dir>
#                          [--profile NAME] [--overlay PATH]
#                          [--retention-days N] [--poll-seconds N]
#                          [--timeout-seconds N]
#   scripts/infra/drill.sh dev --release-id <id> --release-dir <dir> --restore
#
# Exit codes: 0 = the drill held, 1 = it refused or failed, 2 = it could not run,
# 3 = disarmed.

set -eu

TOOL='drill'

if [ "${VIEWER_DRILL_ARMED:-}" != 'armed-by-the-gate' ]; then
  echo 'drill — refusing: this driver is disarmed. It makes no call until the gate arms it, and VIEWER_DRILL_ARMED is not the release gate variable or the deploy one.' >&2
  exit 3
fi

HERE=$(cd "$(dirname "$0")" && pwd)
CORE="$HERE/release-core.mjs"
DRILL_CORE="$HERE/drill-core.mjs"
SELF="$HERE/drill.sh"

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
RESTORE_ONLY='no'
OPERATION='drill'

FLAVOUR="${1:-}"
case "$FLAVOUR" in
  dev)
    shift
    ;;
  prod)
    refuse 'a drill deliberately breaks the origin it runs against, and this unit does not do that to prod. The prod acceptance is a live run of the check, not a drill.'
    ;;
  *)
    cannot_run 'the first argument must be dev'
    ;;
esac

while [ $# -gt 0 ]; do
  case "$1" in
    --release-id) [ $# -ge 2 ] || cannot_run '--release-id needs a value'; RELEASE_ID="$2"; shift 2 ;;
    --release-dir) [ $# -ge 2 ] || cannot_run '--release-dir needs a value'; RELEASE_DIR="$2"; shift 2 ;;
    --profile) [ $# -ge 2 ] || cannot_run '--profile needs a value'; PROFILE="$2"; shift 2 ;;
    --overlay) [ $# -ge 2 ] || cannot_run '--overlay needs a value'; OVERLAY="$2"; shift 2 ;;
    --retention-days) [ $# -ge 2 ] || cannot_run '--retention-days needs a value'; RETENTION_DAYS="$2"; shift 2 ;;
    --poll-seconds) [ $# -ge 2 ] || cannot_run '--poll-seconds needs a value'; POLL_SECONDS="$2"; shift 2 ;;
    --timeout-seconds) [ $# -ge 2 ] || cannot_run '--timeout-seconds needs a value'; TIMEOUT_SECONDS="$2"; shift 2 ;;
    --restore) RESTORE_ONLY='yes'; shift ;;
    *) cannot_run "unknown argument: $1" ;;
  esac
done

[ -n "$RELEASE_ID" ] || cannot_run '--release-id is required'
[ -n "$RELEASE_DIR" ] || cannot_run '--release-dir is required'

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

MANGLE_PUT_ISSUED='no'
RESTORE_DONE='no'
CLEANED='no'
LOCK_HELD='no'

# The D1 verdict, held back until the origin is whole again. Restoring comes
# first and the record catches up afterwards: a log write that hung would
# otherwise prolong serving mangled bytes, which is the one thing a drill must
# not do. Empty on the recovery entry and on the exit trap, neither of which
# carries a verdict — they restore and say so, and nothing else.
PENDING_EVENT=''
PENDING_OUTCOME=''
PENDING_DETAIL=''

on_exit() {
  set +e
  if [ "$CLEANED" = 'yes' ]; then
    return 0
  fi
  CLEANED='yes'
  if [ "$MANGLE_PUT_ISSUED" = 'yes' ] && [ "$RESTORE_DONE" != 'yes' ]; then
    echo 'drill — this run is ending with the origin mangled. Restoring before anything else.' >&2
    d2_restore || {
      echo 'drill — THE RESTORATION FAILED. This is the loudest failure this driver has.' >&2
      print_restore_command
    }
  fi
  release_the_lock
  return 0
}
trap 'on_exit' EXIT
trap 'on_exit; exit 130' INT TERM

take_the_lock

RECORD_DIR="$RELEASE_DIR/records/$RUN_ID"
mkdir -p "$RECORD_DIR"
SEQ_FILE="$RECORD_DIR/sequence"
echo 1 > "$SEQ_FILE"
INVALIDATION_IDS="$RECORD_DIR/invalidation-ids.txt"
: > "$INVALIDATION_IDS"

note "run ${RUN_ID}, drill of ${RELEASE_ID} on ${FLAVOUR}"
note "record area ${RECORD_DIR}"

print_restore_command() {
  echo
  echo 'THE RECOVERY COMMAND — one command, and its semantics are the whole of D2:'
  echo 'the put, the two-alias invalidation, the completion poll, a fresh listing, the'
  echo 'wire check, and the drill-restored record. Every option this run is using is'
  echo 'spelled out and every path is absolute, because a crash recovery may be run from'
  echo 'anywhere.'
  echo
  printf '  VIEWER_DRILL_ARMED=armed-by-the-gate %s dev --release-id %s --release-dir %s --profile %s --overlay %s --retention-days %s --poll-seconds %s --timeout-seconds %s --restore\n' \
    "$(q "$SELF")" "$(q "$RELEASE_ID")" "$(q "$RELEASE_DIR")" "$(q "$PROFILE")" "$(q "$OVERLAY")" \
    "$(q "$RETENTION_DAYS")" "$(q "$POLL_SECONDS")" "$(q "$TIMEOUT_SECONDS")"
  echo
}

# ---------------------------------------------------------------------------
# D2 — the restoration, and the whole of what `--restore` runs
# ---------------------------------------------------------------------------
#
# Restoration comes FIRST and a log failure is reported after it rather than
# blocking it: a live origin serving the wrong bytes is a worse state than a
# record with a hole in it.
d2_restore() {
  note 'D2 — restoring the proven entry-point bytes'
  RESTORE_OK='yes'

  aws_pinned s3api put-object \
    --bucket "$ORIGIN_BUCKET" \
    --key index.html \
    --body "$STAGED_ENTRY" \
    --content-type "$ENTRY_CONTENT_TYPE" < /dev/null > /dev/null || RESTORE_OK='no'

  if [ "$RESTORE_OK" = 'yes' ]; then
    invalidate_two_aliases 'restore' || RESTORE_OK='no'
  fi
  if [ "$RESTORE_OK" = 'yes' ]; then
    fresh_inventory "$RECORD_DIR/inventory-restore.json" 'restore' || RESTORE_OK='no'
  fi
  if [ "$RESTORE_OK" = 'yes' ]; then
    run_wire_check "$RECORD_DIR/inventory-restore.json" "$TARGET_MANIFEST" "$RECORD_DIR/check-restore.txt" || RESTORE_OK='no'
  fi

  RESTORE_DONE='yes'

  if [ "$RESTORE_OK" != 'yes' ]; then
    return 1
  fi

  # The record catches up now, in the order the events happened. Sequence numbers
  # still follow attempt order, so the mangled event carries the number it was
  # always going to carry — it is simply written after the restoration completed
  # rather than before it.
  if [ -n "$PENDING_EVENT" ]; then
    log_event "$PENDING_EVENT" "$PENDING_OUTCOME" "$PENDING_DETAIL" ||
      note "the ${PENDING_EVENT} event could not be written — the origin IS restored, and only the record is missing"
    PENDING_EVENT=''
  fi

  log_event 'drill-restored' 'ok' 'the entry point is the proven bytes again and the wire half of E-6 exited 0' ||
    note 'the drill-restored event could not be written — the origin IS restored and verified, and only the record is missing'
  return 0
}

# ---------------------------------------------------------------------------
# D-pre — the same preflight and the same resolution as a switch
# ---------------------------------------------------------------------------
#
# Same code, so the bytes this drill will restore are PROVEN against the
# published manifest before anything is touched.
bind_environment
git_context
materialise_roster
prove_config_binding
prove_provenance
note "D-pre preflight held: ${RELEASE_ID} at ${MANIFEST_COMMIT} is what this repository produces, and the public tip publishes it"

resolve_deployment
note "D-pre resolved: distribution ${DISTRIBUTION_ID}, origin ${ORIGIN}"

node "$CORE" --plan "$TARGET_MANIFEST" > "$RECORD_DIR/plan.tsv" || exit 1
ENTRY_CONTENT_TYPE=$(awk -F'\t' '$1 == "/index.html" { print $3 }' "$RECORD_DIR/plan.tsv")
[ -n "$ENTRY_CONTENT_TYPE" ] || cannot_run 'the plan names no content type for the entry point'

STAGED_ENTRY="$RECORD_DIR/restore-index.html"
cp "$RELEASE_DIR/layout/index.html" "$STAGED_ENTRY"
note "D-pre staged the restoration bytes at ${STAGED_ENTRY}"

print_restore_command

if [ "$RESTORE_ONLY" = 'yes' ]; then
  note 'running the recovery entry alone: D2 in full and nothing else'
  d2_restore || {
    echo 'drill — THE RESTORATION FAILED.' >&2
    print_restore_command
    log_event 'drill-failed' 'failed' 'the recovery entry could not restore the entry point' || true
    exit 1
  }
  note 'RESTORED — the origin is serving the proven bytes and the wire half of E-6 exited 0'
  exit 0
fi

# ---------------------------------------------------------------------------
# D0 — the baseline. A red baseline is a refusal: nothing mutated, nothing logged
# ---------------------------------------------------------------------------
fresh_inventory "$RECORD_DIR/inventory-baseline.json" 'baseline' ||
  refuse 'the origin bucket could not be listed, so there is no baseline to drill from'

run_wire_check "$RECORD_DIR/inventory-baseline.json" "$TARGET_MANIFEST" "$RECORD_DIR/check-baseline.txt" ||
  refuse 'the baseline check did not exit 0 — a drill starts from a green origin, and breaking one that is already broken proves nothing. Nothing has been mutated and nothing is logged.'
note 'D0 — the baseline is green'

log_event 'drill-started' 'ok' "the baseline check exited 0 against ${ORIGIN}" ||
  refuse 'the drill-started event could not be written to the release log, and nothing has been mutated'

# ---------------------------------------------------------------------------
# D1 — object-side mangle: honest manifest, wrong bytes
# ---------------------------------------------------------------------------
D1_VERDICT='error'
MANGLE_MADE='no'

if node "$DRILL_CORE" --mangle "$RELEASE_DIR/layout/index.html" "$RECORD_DIR/mangled-index.html" "$RELEASE_ID"; then
  MANGLE_MADE='yes'
fi

if [ "$MANGLE_MADE" = 'yes' ]; then
  MANGLE_PUT_ISSUED='yes'
  D1_STEPS='ok'
  aws_pinned s3api put-object \
    --bucket "$ORIGIN_BUCKET" \
    --key index.html \
    --body "$RECORD_DIR/mangled-index.html" \
    --content-type "$ENTRY_CONTENT_TYPE" < /dev/null > /dev/null || D1_STEPS='no'

  if [ "$D1_STEPS" = 'ok' ]; then
    invalidate_two_aliases 'mangle' || D1_STEPS='no'
  fi
  if [ "$D1_STEPS" = 'ok' ]; then
    fresh_inventory "$RECORD_DIR/inventory-mangled.json" 'mangled' || D1_STEPS='no'
  fi

  if [ "$D1_STEPS" = 'ok' ]; then
    D1_CHECK=0
    run_wire_check "$RECORD_DIR/inventory-mangled.json" "$TARGET_MANIFEST" "$RECORD_DIR/check-mangled.txt" || D1_CHECK=$?
    if [ "$D1_CHECK" -eq 0 ]; then
      D1_VERDICT='green-which-is-a-failure'
    elif grep -qE '/index\.html.*the decoded bytes digest to' "$RECORD_DIR/check-mangled.txt"; then
      D1_VERDICT='red-as-expected'
    else
      D1_VERDICT='red-for-the-wrong-reason'
    fi
  fi
fi

# The verdict is SAID now and WRITTEN after the restoration. Nothing about the
# reading changes; what changes is that the origin stops serving mangled bytes
# before anything waits on a log put.
PENDING_EVENT='drill-mangled'
case "$D1_VERDICT" in
  red-as-expected)
    note 'D1 — the check refused, naming the entry point'"'"'s digest. That is the drill working.'
    PENDING_OUTCOME='ok'
    PENDING_DETAIL='the check refused the mangled entry point, naming its digest'
    ;;
  green-which-is-a-failure)
    note 'D1 — THE CHECK CAME UP GREEN AGAINST MANGLED BYTES. The drill has failed.'
    PENDING_OUTCOME='failed'
    PENDING_DETAIL='the check exited 0 against an entry point this run had mangled'
    ;;
  *)
    note "D1 — the drill could not be carried out (${D1_VERDICT})."
    PENDING_OUTCOME='failed'
    PENDING_DETAIL="the mangle step did not reach a verdict: ${D1_VERDICT}"
    ;;
esac

# ---------------------------------------------------------------------------
# D2 — restore, on every path out of D1
# ---------------------------------------------------------------------------
D2_OK='yes'
d2_restore || D2_OK='no'

if [ "$D2_OK" != 'yes' ]; then
  echo 'drill — THE RESTORATION FAILED. This is the loudest failure this driver has: the' >&2
  echo 'origin may still be serving the mangled entry point.' >&2
  print_restore_command
  log_event 'drill-failed' 'failed' "the restoration did not complete, and the origin may still be serving mangled bytes; D1 read ${D1_VERDICT}" || true
  exit 1
fi

if [ "$D1_VERDICT" != 'red-as-expected' ]; then
  log_event 'drill-failed' 'failed' "D1 did not refuse as it must: ${D1_VERDICT}" || true
  refuse "the drill failed at D1 (${D1_VERDICT}); the origin has been restored and verified"
fi

# ---------------------------------------------------------------------------
# D3 — manifest-side mangle: wrong manifest, honest origin, no mutation
# ---------------------------------------------------------------------------
#
# The doctored copy stays here as evidence and is uploaded nowhere.
node "$DRILL_CORE" --doctor-manifest "$TARGET_MANIFEST" "$RECORD_DIR/doctored-manifest.json" > "$RECORD_DIR/doctored.txt" || {
  log_event 'drill-failed' 'failed' 'the manifest could not be doctored, so variant two of the drill could not be carried out' || true
  refuse 'the manifest could not be doctored, and variant two of the drill is what proves a wrong expectation is caught'
}
note "D3 — doctored the entry-point digest ($(cat "$RECORD_DIR/doctored.txt"))"

D3_CHECK=0
run_wire_check "$RECORD_DIR/inventory-restore.json" "$RECORD_DIR/doctored-manifest.json" "$RECORD_DIR/check-doctored.txt" || D3_CHECK=$?
if [ "$D3_CHECK" -eq 0 ]; then
  log_event 'drill-failed' 'failed' 'the check exited 0 against a manifest whose entry-point digest was doctored' || true
  refuse 'D3 — the check accepted a doctored manifest against an honest origin'
fi
if ! grep -qE '/index\.html.*the decoded bytes digest to' "$RECORD_DIR/check-doctored.txt"; then
  log_event 'drill-failed' 'failed' 'the check refused the doctored manifest for something other than the entry-point digest' || true
  refuse 'D3 — the check refused, but not with the entry-point digest refusal this variant is about'
fi
note 'D3 — the check refused the doctored manifest, naming the entry point'"'"'s digest'

# ---------------------------------------------------------------------------
# D4 — the closing clean run
# ---------------------------------------------------------------------------
fresh_inventory "$RECORD_DIR/inventory-closing.json" 'closing' || {
  log_event 'drill-failed' 'failed' 'the closing listing could not be taken, so the closing clean run could not be judged' || true
  refuse 'the closing listing could not be taken'
}

D4_CHECK=0
run_wire_check "$RECORD_DIR/inventory-closing.json" "$TARGET_MANIFEST" "$RECORD_DIR/check-closing.txt" || D4_CHECK=$?
if [ "$D4_CHECK" -ne 0 ]; then
  log_event 'drill-failed' 'failed' "the closing clean run exited ${D4_CHECK}" || true
  refuse "D4 — the closing clean run did not exit 0 (${D4_CHECK})"
fi

log_event 'drill-succeeded' 'ok' 'both mangle variants were refused, the origin was restored, and the closing clean run exited 0' ||
  refuse 'the drill held and the drill-succeeded event could not be written — the origin is restored and verified, and the record is missing'

note 'DRILLED — object-side refused, manifest-side refused, origin restored, closing run green'
exit 0
