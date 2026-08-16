#!/bin/sh
#
# What the switch driver and the drill driver both do, written once.
#
# NOT A COMMAND. This file is sourced by `release.sh` and by `drill.sh`; running
# it does nothing and it makes no call of its own.
#
# It exists because the two drivers share the part that must not differ between
# them. Both bind the flavour against the overlay, both read the target and the
# retained roster off the PUBLIC tip, both prove the target's provenance by
# rebuilding it, both assert the account before any other call, both resolve the
# deployment from the stack's own outputs, both invalidate the two aliases and
# wait for completion, both write the same append-only log, and both run the same
# wire check. A second copy of any of that would be a second set of rules, and the
# one that got the fix would be whichever one somebody was looking at.
#
# The house idioms it follows: `--region us-east-1` on every call rather than a
# default read from anywhere; the profile passed on every call rather than
# exported; the account assertion before the first call that could change
# something; `--parameter-overrides` nowhere.
#
# Two things it does NOT do, and they are the callers': arming, and the sequence.
# Each driver has its own gate variable — arming a deploy must not arm a release,
# and arming a release must not arm a drill — and each driver's step order is the
# thing each of them is specified to do, so neither is hidden in here.

# ---------------------------------------------------------------------------
# Pinned, and shared defaults
# ---------------------------------------------------------------------------
#
# Region: CloudFront publishes its metrics into us-east-1 and nowhere else, and a
# certificate for a distribution must have been issued there. Everything about
# this stack lives in that region and every call says so.
REGION='us-east-1'

# Public-safe, each with a stated default: nothing about a poll interval, a
# timeout or a retention period is private.
DEFAULT_PROFILE='patientscribe-dev'
DEFAULT_OVERLAY='infra/parameters.json'
DEFAULT_RETENTION_DAYS='400'
DEFAULT_POLL_SECONDS='15'
DEFAULT_TIMEOUT_SECONDS='900'

# A literal newline, for the argument reading below. Built this way because a
# command substitution strips trailing newlines and would leave it empty.
NEWLINE='
'

# ---------------------------------------------------------------------------
# Saying things
# ---------------------------------------------------------------------------

note() {
  echo "${TOOL} — $1"
}

refuse() {
  echo "${TOOL} — refusing: $1" >&2
  exit 1
}

cannot_run() {
  echo "${TOOL} — cannot run: $1" >&2
  exit 2
}

# POSIX single-quoting, so that a printed remediation is executable as printed.
#
# A path with a space, a quote or a dollar in it is a path a printed command has
# to carry as one word, and the operator reading that print is going to paste it.
# Every value in every remediation this round writes goes through here.
q() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# ---------------------------------------------------------------------------
# Argument discipline
# ---------------------------------------------------------------------------

require_no_newline() {
  case "$2" in
    *"$NEWLINE"*)
      cannot_run "$1 carries an embedded newline, and a path this cannot print as one word is a path this will not act on"
      ;;
  esac
}

# A positive whole number, and nothing that merely looks like one. Zero, a
# negative, a fraction and a word are each refused by name rather than coerced.
require_positive_integer() {
  case "$2" in
    ''|*[!0-9]*)
      cannot_run "$1 takes a positive whole number, and it was '$2'"
      ;;
  esac
  if [ "$2" -lt 1 ]; then
    cannot_run "$1 takes a positive whole number, and it was '$2'"
  fi
}

# One expectation source, and it is the overlay.
#
# assert-account.sh gives VIEWER_EXPECTED_ACCOUNT_ID precedence over the overlay,
# which is right for a check somebody is running by hand and wrong here: an
# inherited variable that happens to match a wrongly selected profile would bless
# mutations in the wrong account, and this driver mutates.
require_no_inherited_account_expectation() {
  if [ -n "${VIEWER_EXPECTED_ACCOUNT_ID+set}" ]; then
    cannot_run 'VIEWER_EXPECTED_ACCOUNT_ID is set in this environment, and this driver takes its expected account from the overlay only — unset it and run again'
  fi
}

# ---------------------------------------------------------------------------
# One armed act at a time
# ---------------------------------------------------------------------------
#
# An atomic mkdir beside the release directories, holding the run that took it.
# The two drivers take the same lock because interleaving them is the thing that
# goes wrong quietly: an armed drill restoring its baseline while an armed switch
# is midway through replacing the entry point would put back exactly what the
# switch had just moved past, and neither would notice.
#
# The scope is the area the release directories are built in — `dirname` of the
# release directory handed in. Two armed acts run from two different build areas
# are not excluded by this, which is stated in RELEASING.md rather than left to be
# discovered.
take_the_lock() {
  LOCK_DIR="$(dirname "$RELEASE_DIR")/.viewer-armed-act.lock"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    HOLDER='(the holder file could not be read)'
    if [ -f "$LOCK_DIR/holder" ]; then
      HOLDER=$(cat "$LOCK_DIR/holder")
    fi

    # A lock left behind by a run that was killed outright — SIGKILL, a lost
    # host — is a lock whose exit handler never ran. Refusing it forever would
    # break the one property the printed recovery command rests on: that it
    # works, at the moment the origin is mangled and nothing else is going to
    # put it back. So a holder whose process is gone is cleared and the mkdir is
    # retried ONCE. The mkdir stays the atomic arbiter: a concurrent starter
    # that loses the retry refuses exactly as it would have.
    #
    # Pid recycling can make a dead holder look alive. That fails in the
    # refusing direction — a run that could have proceeded stops and names who
    # it thinks is holding it — which is the safe half of the trade.
    HOLDER_PID=$(printf '%s' "$HOLDER" | sed -n 's/.*[[:space:]]pid \([0-9][0-9]*\)$/\1/p')
    if [ -n "$HOLDER_PID" ] && ! kill -0 "$HOLDER_PID" 2>/dev/null; then
      note "clearing a lock left behind by a run that is no longer running: ${HOLDER}"
      rm -rf "$LOCK_DIR"
      mkdir "$LOCK_DIR" 2>/dev/null ||
        refuse "another armed act took ${LOCK_DIR} while this run was clearing a stale one"
    else
      refuse "another armed act holds ${LOCK_DIR}: ${HOLDER}"
    fi
  fi
  LOCK_HELD='yes'
  printf '%s\n' "${TOOL} ${OPERATION} ${RELEASE_ID} run ${RUN_ID} pid $$" > "$LOCK_DIR/holder"
}

release_the_lock() {
  if [ "${LOCK_HELD:-}" = 'yes' ]; then
    rm -rf "$LOCK_DIR"
    LOCK_HELD='no'
  fi
}

# ---------------------------------------------------------------------------
# Calls
# ---------------------------------------------------------------------------
#
# Every call carries the pinned region and the profile, at the end of the
# argument list, which is where the CLI is unambiguous about them.
aws_pinned() {
  aws "$@" --region "$REGION" --profile "$PROFILE"
}

# ---------------------------------------------------------------------------
# The flavour and the overlay have to be talking about the same environment
# ---------------------------------------------------------------------------
#
# Exactly as deploy-changeset.sh binds them, and before any call: the dev|prod
# argument picks the stack, the overlay carries `Environment`, and nothing else
# connects the two.
bind_environment() {
  OVERLAY_ENVIRONMENT=$(node "$HERE/read-overlay-parameter.mjs" "$OVERLAY" Environment) || {
    cannot_run "${OVERLAY} must exist and must carry an Environment parameter"
  }
  if [ "$OVERLAY_ENVIRONMENT" != "$FLAVOUR" ]; then
    refuse "this is a ${FLAVOUR} run and ${OVERLAY} is a ${OVERLAY_ENVIRONMENT} overlay"
  fi
  STACK="patientscribe-viewer-${FLAVOUR}"
}

# ---------------------------------------------------------------------------
# The git context
# ---------------------------------------------------------------------------
#
# The repository of the CURRENT WORKING DIRECTORY, never the one these scripts
# happen to be checked out in. A rollback runs from a worktree at the target's
# older commit, and a worktree shares the ref store — which is what keeps the
# public roster complete there even though its checkout predates later releases.
git_context() {
  REPO=$(git rev-parse --show-toplevel 2>/dev/null) || cannot_run 'there is no git repository at the working directory, and the target and the roster are read from one'

  REMOTE_URL=$(git -C "$REPO" remote get-url origin 2>/dev/null) || refuse 'this repository has no origin remote, and the roster is read from the public tip'
  node "$CORE" --check-remote "$REMOTE_URL" || exit 1

  # The public tip. A LOCAL-ONLY commit is invisible here by construction, so an
  # unpushed manifest cannot switch: the push IS the publish. Reading a
  # remote-tracking ref is a local act — no fetch, no contact — and what it
  # catches is the mistake class: a forgotten push, a wrong repository, a
  # local-only commit. It cannot prove the remote's live state, which is why
  # RELEASING.md prescribes `git fetch origin` as the operator's own first step
  # before an armed run.
  # Fully qualified, and that is the whole of the point. Written as `origin/main`
  # this resolves by git's own search order, and a LOCAL BRANCH literally named
  # `origin/main` wins that search over the remote-tracking ref — so a commit
  # nobody pushed could stand in for the public tip. Every resolution below —
  # the verify, the tree listing, each show, the ancestry test — uses the full
  # ref name. The prose keeps the short spelling, because that is what a person
  # reading a refusal is looking for.
  PUBLIC_TIP='refs/remotes/origin/main'
  PUBLIC_TIP_NAME='origin/main'
  git -C "$REPO" rev-parse --verify --quiet "${PUBLIC_TIP}^{commit}" > /dev/null 2>&1 ||
    refuse "this repository has no ${PUBLIC_TIP_NAME}, so there is no public tip to read the roster from"
}

# ---------------------------------------------------------------------------
# The target and the roster, from the public tip
# ---------------------------------------------------------------------------
#
# The target is not a file argument. A manifest sitting in a directory is a
# document somebody wrote; the roster on the public tip is the record the release
# gate produced, and a release that is not on it has not been published. So the
# manifest that will be switched to is materialised from the tip, the supplied
# directory's copy is compared against it byte for byte, and the release
# identifier has to be the same string in all three places it appears.
materialise_roster() {
  ROSTER_TREE="${PUBLIC_TIP}:releases"

  git -C "$REPO" ls-tree "$ROSTER_TREE" > "$RECORD_DIR/roster-tree.txt" 2>/dev/null ||
    refuse "the public tip carries no releases tree, so no release has been published — publication (commit AND push) precedes a switch by construction"

  node "$CORE" --roster-entries "$RECORD_DIR/roster-tree.txt" > "$RECORD_DIR/roster.txt" || exit 1

  if ! grep -qx "$RELEASE_ID" "$RECORD_DIR/roster.txt"; then
    refuse "the public tip does not publish ${RELEASE_ID} — the release-publish gate is what puts a manifest under releases/ and pushes it, and the driver switches to what that gate published, never to a file it was handed"
  fi

  TARGET_MANIFEST="$RECORD_DIR/target-manifest.json"
  git -C "$REPO" show "${PUBLIC_TIP}:releases/${RELEASE_ID}.json" > "$TARGET_MANIFEST" ||
    refuse "the public tip lists ${RELEASE_ID}.json and could not produce it"

  SUPPLIED_MANIFEST="$RELEASE_DIR/manifest.json"
  [ -f "$SUPPLIED_MANIFEST" ] || cannot_run "${SUPPLIED_MANIFEST} does not exist, and a release directory is a layout and its manifest"
  [ -d "$RELEASE_DIR/layout" ] || cannot_run "${RELEASE_DIR}/layout does not exist, and a release directory is a layout and its manifest"

  cmp -s "$SUPPLIED_MANIFEST" "$TARGET_MANIFEST" ||
    refuse "${SUPPLIED_MANIFEST} is not the manifest the public tip publishes for ${RELEASE_ID}"

  # The union: every OTHER entry on the tip, materialised the same way. It may be
  # empty — the first release's is — and the frozen command line permits zero
  # --union arguments.
  : > "$RECORD_DIR/union.txt"
  while IFS= read -r STEM; do
    [ -n "$STEM" ] || continue
    [ "$STEM" != "$RELEASE_ID" ] || continue
    RETAINED="$RECORD_DIR/retained-${STEM}.json"
    git -C "$REPO" show "${PUBLIC_TIP}:releases/${STEM}.json" > "$RETAINED" ||
      refuse "the public tip lists ${STEM}.json and could not produce it"
    printf '%s\n' "$RETAINED" >> "$RECORD_DIR/union.txt"
  done < "$RECORD_DIR/roster.txt"

  # Every roster manifest, target and retained, read strictly — and the two
  # static union defects with them. A malformed retained manifest refuses here,
  # before any mutation, rather than after the entry point has moved, where no
  # rollback cures it.
  set -- "$TARGET_MANIFEST"
  while IFS= read -r RETAINED; do
    [ -n "$RETAINED" ] || continue
    set -- "$@" "$RETAINED"
  done < "$RECORD_DIR/union.txt"
  node "$CORE" --preflight-manifests "$@" || exit 1

  MANIFEST_RELEASE_ID=$(node "$CORE" --manifest-field "$TARGET_MANIFEST" release_id) || exit 1
  if [ "$MANIFEST_RELEASE_ID" != "$RELEASE_ID" ]; then
    refuse "the manifest published as ${RELEASE_ID}.json names ${MANIFEST_RELEASE_ID}, and a valid manifest for one release sitting in another's file is a switch that would serve the wrong thing"
  fi

  MANIFEST_COMMIT=$(node "$CORE" --manifest-field "$TARGET_MANIFEST" commit) || exit 1
}

# ---------------------------------------------------------------------------
# Provenance by reconstruction
# ---------------------------------------------------------------------------
#
# A manifest is not trusted, it is reproduced. The build is a pure function of
# the tree and the identifier, so the repository at the commit the manifest names
# either produces exactly these bytes or the manifest is not what it says it is —
# and no reading of the document alone could have told the two apart.
prove_provenance() {
  DIRTY=$(git -C "$REPO" status --porcelain -- site) || cannot_run 'git could not report the state of site/'
  if [ -n "$DIRTY" ]; then
    refuse "site/ carries uncommitted changes, so this checkout cannot reproduce any published release:${NEWLINE}${DIRTY}"
  fi

  git -C "$REPO" rev-parse --verify --quiet "${MANIFEST_COMMIT}^{commit}" > /dev/null 2>&1 ||
    refuse "this repository does not know the commit ${MANIFEST_COMMIT} the manifest names — fetch it, or check the release's own commit out in a separate worktree and run from there"

  THEIR_TREE=$(git -C "$REPO" rev-parse "${MANIFEST_COMMIT}:site") || refuse "the commit ${MANIFEST_COMMIT} has no site tree"
  OUR_TREE=$(git -C "$REPO" rev-parse 'HEAD:site') || cannot_run 'HEAD has no site tree'
  if [ "$THEIR_TREE" != "$OUR_TREE" ]; then
    refuse "the site tree at ${MANIFEST_COMMIT} is ${THEIR_TREE} and this checkout's is ${OUR_TREE} — to switch to this release, check its own commit out in a separate worktree and run the driver from inside that worktree"
  fi

  # Not an ancestor of the public tip is a release built on a branch nobody
  # published, however well-formed its manifest is.
  git -C "$REPO" merge-base --is-ancestor "$MANIFEST_COMMIT" "$PUBLIC_TIP" ||
    refuse "the commit ${MANIFEST_COMMIT} is not an ancestor of ${PUBLIC_TIP_NAME}, so the bytes this release was built from are not on the public tip"

  REBUILD="$RECORD_DIR/rebuild"
  mkdir -p "$REBUILD"
  ( cd "$REPO" && node "$HERE/build-release.mjs" --out "$REBUILD" --release-id "$RELEASE_ID" --commit "$MANIFEST_COMMIT" ) > "$RECORD_DIR/rebuild.log" 2>&1 ||
    refuse "the release could not be rebuilt from ${MANIFEST_COMMIT}; see ${RECORD_DIR}/rebuild.log"

  cmp -s "$REBUILD/$RELEASE_ID/manifest.json" "$TARGET_MANIFEST" ||
    refuse "the manifest this repository produces at ${MANIFEST_COMMIT} is not the manifest published as ${RELEASE_ID}.json — a manifest that is not what the repo produces at its named commit is not a release this will serve"

  diff -rq "$REBUILD/$RELEASE_ID/layout" "$RELEASE_DIR/layout" > "$RECORD_DIR/layout-diff.txt" 2>&1 ||
    refuse "the layout in ${RELEASE_DIR} is not the layout this repository produces at ${MANIFEST_COMMIT}; see ${RECORD_DIR}/layout-diff.txt"
}

# The origin table, bound before anything is called.
#
# The oracle enforces a three-way binding — this checkout's bytes, the manifest's
# digest, and the origin's bytes — and the first two of those are decidable here
# for nothing. Failing it after the switch costs a switch.
prove_config_binding() {
  LOCAL_CONFIG_DIGEST=$(node "$CORE" --sha256 "$REPO/site/js/config.js") || exit 1
  BOUND_CONFIG_DIGEST=$(node "$CORE" --manifest-field "$TARGET_MANIFEST" config-digest) || exit 1
  if [ "$LOCAL_CONFIG_DIGEST" != "$BOUND_CONFIG_DIGEST" ]; then
    refuse "this checkout's origin table digests to ${LOCAL_CONFIG_DIGEST} and the manifest binds ${BOUND_CONFIG_DIGEST} — the expected connect-src is derived from those bytes, and the check will refuse exactly this"
  fi
}

# ---------------------------------------------------------------------------
# Identity, then the deployed truth
# ---------------------------------------------------------------------------
#
# The account assertion runs before any other call, so a wrong profile costs
# nothing. Then describe-stacks — the only cloudformation call this round makes —
# and every target below is read from ITS outputs rather than from the overlay:
# the deployed truth wins over a local file wherever both exist.
resolve_deployment() {
  sh "$HERE/assert-account.sh" --profile "$PROFILE" --overlay "$OVERLAY" || exit $?

  aws_pinned cloudformation describe-stacks --stack-name "$STACK" --output json > "$RECORD_DIR/stacks.json" ||
    refuse "the stack ${STACK} could not be described"

  DISTRIBUTION_ID=$(node "$CORE" --read-output "$RECORD_DIR/stacks.json" DistributionId) || exit 2
  ORIGIN_BUCKET=$(node "$CORE" --read-output "$RECORD_DIR/stacks.json" OriginBucket) || exit 2
  LOG_BUCKET=$(node "$CORE" --read-output "$RECORD_DIR/stacks.json" ReleaseLogBucket) || exit 2
  # Read raw, so that an EMPTY prefix arrives here as an empty prefix and is
  # refused by name below rather than as an output the stack does not carry.
  LOG_PREFIX=$(node "$CORE" --read-output-raw "$RECORD_DIR/stacks.json" ReleaseLogPrefix) || exit 2

  # The template's parameter carries no pattern, so an empty or unterminated
  # prefix would silently write at the bucket root or fuse into the key. Refused
  # by name, before any mutation.
  case "$LOG_PREFIX" in
    '')
      refuse 'the stack states an empty release-log prefix, and an empty prefix writes the record at the bucket root'
      ;;
    */)
      ;;
    *)
      refuse "the stack states the release-log prefix '${LOG_PREFIX}', which does not end in a slash — a prefix that does not is a prefix that fuses into the key"
      ;;
  esac

  resolve_origin
}

# Where the wire check is pointed, in one function.
#
# dev is the distribution's own domain, which is the viewer origin there and is
# the reason the Output exists. prod is the overlay's DomainName, and it is the
# one value whose role continues past the resolution step: the Output is
# CloudFront's own hostname, and prod's E-6 has to run against the live alias or
# a DNS or TLS failure would go unseen.
#
# There is no origin override flag. The scheme is https, with one exception
# stated here rather than left implicit: a resolved host that is loopback takes
# http, because the committed origin table answers for exactly one plain-HTTP
# loopback origin, local conformance runs live there, and no CloudFront domain
# can ever look like that.
resolve_origin() {
  if [ "$FLAVOUR" = 'dev' ]; then
    ORIGIN_HOST=$(node "$CORE" --read-output "$RECORD_DIR/stacks.json" DistributionDomainName) || exit 2
  else
    ORIGIN_HOST=$(node "$HERE/read-overlay-parameter.mjs" "$OVERLAY" DomainName) ||
      cannot_run "${OVERLAY} carries no DomainName, and prod's check runs against the live alias"
    [ -n "$ORIGIN_HOST" ] || cannot_run "${OVERLAY} carries an empty DomainName, and prod's check runs against the live alias"
  fi

  ORIGIN_SCHEME='https'
  case "$ORIGIN_HOST" in
    127.0.0.1)
      ORIGIN_SCHEME='http'
      ;;
    127.0.0.1:*)
      ORIGIN_PORT="${ORIGIN_HOST#127.0.0.1:}"
      case "$ORIGIN_PORT" in
        ''|*[!0-9]*) ORIGIN_SCHEME='https' ;;
        *) ORIGIN_SCHEME='http' ;;
      esac
      ;;
  esac

  ORIGIN="${ORIGIN_SCHEME}://${ORIGIN_HOST}"
}

# ---------------------------------------------------------------------------
# The append-only log
# ---------------------------------------------------------------------------
#
# One immutable object per event, under the deployed prefix, at a key carrying
# the release identifier, the run, a two-digit sequence and the event name. The
# sequence advances on every ATTEMPTED write — a failed write's number is
# consumed and nothing retries under it — and a run that somehow reaches 99
# refuses rather than wrapping.
#
# The claim this makes, exactly: the immutable record is the RETAINED VERSION.
# Object Lock holds that version for its term whatever later happens to the key;
# the conditional write closes the accidental same-key overwrite. A delete marker
# could make a key look absent and admit a second version — no tool in this
# repository issues any delete, and the retained version survives that game
# regardless. A deny-delete bucket policy would close the marker path
# structurally; that is named in RELEASING.md as a later round's option, not this
# round's template change.
#
# Retention mode is GOVERNANCE, fixed in code. Changing the mode is a policy
# decision for a gate rather than a flag on a driver, and COMPLIANCE mode cannot
# be shortened by anyone including the account root — which is a thing to choose
# deliberately or not at all. The days are the one part that moves.
log_event() {
  LOG_EVENT_NAME="$1"
  LOG_OUTCOME="$2"
  LOG_DETAIL="$3"

  SEQ=$(cat "$SEQ_FILE")
  if [ "$SEQ" -gt 99 ]; then
    refuse 'this run has written ninety-nine events, and the key form carries two digits — a run that reached a hundred is a run something is wrong with'
  fi
  SEQ_LABEL=$(printf '%02d' "$SEQ")
  echo $((SEQ + 1)) > "$SEQ_FILE"

  LOG_KEY="${LOG_PREFIX}${RELEASE_ID}/${RUN_ID}/${SEQ_LABEL}-${LOG_EVENT_NAME}.json"
  LOG_BODY_FILE="$RECORD_DIR/${SEQ_LABEL}-${LOG_EVENT_NAME}.json"

  set -- --event "$LOG_EVENT_NAME" --release-id "$RELEASE_ID" --operation "$OPERATION" \
    --timestamp "$RUN_TIMESTAMP" --outcome "$LOG_OUTCOME" --detail "$LOG_DETAIL"
  while IFS= read -r ONE_ID; do
    [ -n "$ONE_ID" ] || continue
    set -- "$@" --invalidation-id "$ONE_ID"
  done < "$INVALIDATION_IDS"

  node "$CORE" --log-body "$LOG_BODY_FILE" "$@" || return 1

  RETAIN_UNTIL=$(node "$CORE" --retain-until "$RETENTION_DAYS") || return 1

  aws_pinned s3api put-object \
    --bucket "$LOG_BUCKET" \
    --key "$LOG_KEY" \
    --body "$LOG_BODY_FILE" \
    --content-type application/json \
    --object-lock-mode GOVERNANCE \
    --object-lock-retain-until-date "$RETAIN_UNTIL" \
    --if-none-match '*' > /dev/null || return 1

  note "logged ${LOG_EVENT_NAME} at ${LOG_KEY}"
  return 0
}

# ---------------------------------------------------------------------------
# The convergence proof
# ---------------------------------------------------------------------------
#
# One invalidation batch covering exactly the two aliases, and then the wait. The
# default behaviour's edge cache is disabled, so nothing should be held there at
# all — and the invalidation is still required, by ruling, because it is the
# convergence proof rather than a cache eviction. A switch that has not seen one
# complete has not converged.
invalidate_two_aliases() {
  aws_pinned cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/" "/index.html" \
    --output json > "$RECORD_DIR/invalidation-created-${1}.json" || return 1

  THIS_INVALIDATION=$(node "$CORE" --read-json "$RECORD_DIR/invalidation-created-${1}.json" Invalidation.Id) || return 1
  printf '%s\n' "$THIS_INVALIDATION" >> "$INVALIDATION_IDS"
  note "invalidation ${THIS_INVALIDATION} covers / and /index.html"

  WAITED=0
  while :; do
    aws_pinned cloudfront get-invalidation \
      --distribution-id "$DISTRIBUTION_ID" \
      --id "$THIS_INVALIDATION" \
      --output json > "$RECORD_DIR/invalidation-status-${1}.json" || return 1
    INVALIDATION_STATUS=$(node "$CORE" --read-json "$RECORD_DIR/invalidation-status-${1}.json" Invalidation.Status) || return 1
    if [ "$INVALIDATION_STATUS" = 'Completed' ]; then
      note "invalidation ${THIS_INVALIDATION} completed"
      return 0
    fi
    if [ "$WAITED" -ge "$TIMEOUT_SECONDS" ]; then
      note "invalidation ${THIS_INVALIDATION} was ${INVALIDATION_STATUS} after ${WAITED}s"
      return 1
    fi
    sleep "$POLL_SECONDS"
    WAITED=$((WAITED + POLL_SECONDS))
  done
}

# ---------------------------------------------------------------------------
# The deploy-side listing
# ---------------------------------------------------------------------------
#
# An origin cannot be enumerated over HTTP, so the extra-object verdicts have no
# other source than a listing produced on this side and handed to the check.
fresh_inventory() {
  aws_pinned s3api list-objects-v2 --bucket "$ORIGIN_BUCKET" --output json > "$RECORD_DIR/listing-${2}.json" || return 1
  node "$CORE" --listing-keys "$RECORD_DIR/listing-${2}.json" > "$RECORD_DIR/keys-${2}.txt" || return 1
  node "$CORE" --inventory "$RECORD_DIR/keys-${2}.txt" "$1" || return 1
  return 0
}

# ---------------------------------------------------------------------------
# The wire half of E-6
# ---------------------------------------------------------------------------
#
# This is the per-switch machine gate, and it is HALF of E-6 — the half a socket
# can make. Its release-identifier predicate is the served-entry-point
# postcondition of the atomicity rule the release documentation quotes. The
# browser-measured half — the cookie jar, the policy enforced in an engine —
# rides the repository's browser suites and the unit's live acceptance, and
# neither half stands in for the other.
run_wire_check() {
  WIRE_INVENTORY="$1"
  WIRE_MANIFEST="$2"
  WIRE_OUTPUT="$3"

  set -- "$ORIGIN" "$WIRE_MANIFEST" --inventory "$WIRE_INVENTORY"
  while IFS= read -r RETAINED; do
    [ -n "$RETAINED" ] || continue
    set -- "$@" --union "$RETAINED"
  done < "$RECORD_DIR/union.txt"

  # The whole invocation, recorded beside its output. A check is only as good as
  # what it was pointed at, and "which origin, which manifest, which union" is
  # not a thing to have to reconstruct afterwards.
  printf '%s\n' "$*" > "${WIRE_OUTPUT}.argv"

  WIRE_STATUS=0
  node "$HERE/../release-check.mjs" "$@" > "$WIRE_OUTPUT" 2>&1 || WIRE_STATUS=$?
  sed 's/^/    /' "$WIRE_OUTPUT"
  return "$WIRE_STATUS"
}
