# Releasing the viewer

A release is a set of bytes at a set of paths, built from this repository at one commit, named once,
published as a manifest in this repository's own history, and then switched to on the origin. Every
one of those is a separate act, and the order they happen in is not a convention — the tooling
enforces it, because each step is what makes the next one checkable.

This document is what the release tooling does and why. What the *check* does is `RELEASE-CHECK.md`;
what the *hosting* is is `infra/README.md`. The three are separate on purpose: one builds and
publishes, one observes and decides, one describes the place the bytes land.

## What a release is

**Built from the repository at a commit.** `scripts/infra/build-release.mjs` takes `site/` and a
release identifier and writes a release directory containing `layout/` — the served tree, and nothing
else — and `manifest.json` beside it, never inside it. A dirty `site/` refuses outright: a release
built from bytes no commit holds is a release nothing can be checked against afterwards.

**Named `<yyyymmddThhmmssZ>-<the commit's first twelve>`.** The instant says when, the suffix says
what from, and the manifest's `commit` field says the same thing in full. The check refuses an
identifier whose suffix contradicts the commit it sits beside, so the two cannot drift.

**Deterministic.** The build is a pure function of the tree and the identifier. Source files are
processed in byte-wise ascending order of their paths, the manifest's `objects` keys are serialised in
that same order, and the deploy-side listing is written in it too — three orderings, one rule, so that
two correct builds produce the same bytes rather than merely the same contents. Nothing in the build
reads a clock except the identifier derivation, and once derived the identifier is an input.

**Published by committing the manifest — and pushing it.** The manifest goes into `releases/<id>.json`
in this repository at the release-publish gate. That is the second, independent record of what was
released when: the release log lives in a private bucket and the git history lives here, and neither
can be quietly rewritten to agree with the other. Committing *and pushing* are both part of the gate,
and the switch driver enforces it by construction rather than by asking: the manifest it will serve is
materialised from the PUBLIC tip, so a release that has not been pushed has nothing to switch to.

### The layout, and why the origin table is not an asset

```
/index.html                     the entry document, no-store, both aliases
/js/config.js                   the committed origin table, no-store
/assets/<sha256>.<ext>          everything else, immutable for a year
```

Everything under `/assets/` is named by the digest of its own bytes. That is what makes a year-long
cache directive safe: the name cannot come to mean different bytes, so a copy held anywhere is a copy
of bytes that can never change. Modules are rewritten bottom-up — each relative sibling specifier is
replaced by the served path of what it names, so a module's own digest depends on the digests of its
dependencies — and the build refuses itself if any `./` specifier survives the rewrite.

The origin table cannot live there. `site/js/config.js` is the module whose bytes decide where the
page is allowed to send a share code, and the release check binds it three ways before it uses it: the
bytes this checkout holds, the digest the manifest records, and the bytes the origin serves must all be
the same. A binding needs a fixed path to be about, so the table is served at `/js/config.js` under the
default behaviour, `no-store` like the document it belongs to. The build refuses if the table comes out
of the rewrite even one byte different from what went in.

The entry document is stamped with exactly one HTML comment naming the release, on its own line
immediately after the closing tag. That comment is how a served origin answers "which release is up"
in a form a browser ignores and a person can read, and the check reads it under a grammar strict enough
that a comment which is nearly one is not one.

The layout is exactly those three classes. An object of any other class — an image, a font, a document
that is not the entry point — refuses the build rather than being placed somewhere by a rule nobody has
written down.

## The switch

`scripts/infra/release.sh` performs a switch. A rollback is a switch to an older manifest and takes the
same code path; `--operation` is a field of the log, never a branch, because a branch taken rarely is a
branch nobody has watched work.

### What "atomic" means, verbatim

> a switch (release OR rollback — same path) succeeds only after (i) the entry-point object is
> replaced, (ii) the edge invalidation **completes** (invalidation ID recorded), (iii) the postcondition
> holds — the served entry point identifies the target release. Any step failing = failed switch, fail
> closed, logged. Success is never declared on step (i) alone.

The invalidation is required even though the default behaviour's edge cache is disabled entirely. It is
not there to evict anything; it is the convergence proof, and a switch that has not seen one complete
has not converged.

### The steps

**[0] The preflight.** The disarmed guard; the flavour bound against the overlay's `Environment`; the
`origin` remote's host and path asserted against the committed public ones; the target materialised from
`origin/main` and compared byte for byte against the supplied release directory's manifest; the release
identifier required to be the same string in the argument, in the manifest and in the roster filename;
every roster manifest read strictly, target and retained alike, including the two static union defects a
document alone can show — an `/assets/` path whose embedded digest disagrees with the digest its own
manifest records, and two manifests recording different digests for one path; the origin table's digest
bound; and provenance proved by reconstruction.

**[1] Identity, then the deployed truth.** `assert-account.sh` runs before any other call, so a wrong
profile costs nothing. Then one `describe-stacks`, and every target is read from ITS outputs — the
distribution, the origin bucket, the release-log bucket and its prefix. The deployed truth wins over a
local file wherever both exist. The origin under test is never an argument: dev resolves to the
distribution's own domain, prod to the overlay's alias, because prod's check has to run against the live
name or a DNS or TLS failure goes unseen.

**[2] The prior-release capture.** A fresh listing decides whether a prior entry point exists. Where it
does not, the case is recorded as no-prior-release and nothing is read. Where it does, it is read and
scanned for its release comment, and a served release the public tip does not publish stops the run
rather than being mutated past — the printed way back leans on that manifest.

**[3] and [4] The uploads, then the entry point.** Assets carry the immutable directive as object
metadata and the content type their extension's table names; the origin table carries its document
content type and no cache directive of its own. Every key is the manifest path with its single leading
slash removed and nothing else changed — the distribution's default root object is exactly `index.html`,
and a key with a leading slash is a different object it would never serve. The entry point moves last.

**[5] One invalidation**, covering exactly `/` and `/index.html`, polled to completion with its
identifier recorded.

**[6] The deploy-side listing**, written as the inventory document the check reads. An origin cannot be
enumerated over HTTP, so the "is anything here this release does not name" verdicts have no other source.

**[7] The wire half of E-6**, post-invalidation. Its exit is the switch's verdict.

**[8] The record.**

### Refused, or logged

There is a line, and it is exactly at the first `-started` event.

Everything before it is a **refusal**: the disarmed guard, the environment binding, the whole preflight,
the account assertion, the output resolution and the prior-release capture. A refusal exits nonzero,
mutates nothing and logs nothing. There is nothing to record, because nothing happened.

From that write onward every outcome is **logged**. A failure after it ends the run fail-closed with a
`switch-failed` event naming the step, and the run prints the remediation for its class before exiting.

### When a switch fails

Two classes, because the two have different sound exits.

**A failure at the uploads or at the entry-point put — the way out is FORWARD.** Diagnose, then re-run
the same switch. Puts are idempotent: the re-run fills exactly what is missing, re-puts the entry point,
and converges the origin to the verified target whichever document the failed put left current. A lost
success response proves nothing about what landed, so after a failed entry-point put the served document
is **unknown** and is not to be assumed to be the prior one. A rollback cannot cure this: the target is
published, so its manifest is in the union the check probes, and the check asks for every object that
union names.

The corner this leaves is named rather than hidden. A published release whose upload is abandoned keeps
the origin refusing — extra or missing union assets, both fail-closed by design — until its switch
completes or a later gated retirement round removes its objects. No tool in this repository deletes
anything. The kill path is available meanwhile: disable the distribution.

**A failure at the invalidation, the listing or the check — the way out is BACK.** Every object of the
target landed before the entry point moved, so a rollback to the prior release runs clean. The driver
prints that rollback with this run's own facts filled in: the prior release's published manifest, already
materialised into the run's record area; the worktree-and-rebuild step; and the exact invocation, every
value single-quoted and every path absolute, because the rollback runs in a fresh worktree where this
run's relative paths mean nothing.

The print is honest about the one thing a rollback cannot cure. Read the refusals: one naming a
**retained** release's missing assets is the origin's roster being damaged rather than this target being
wrong, and a rollback runs the same union and refuses identically. The ways out of that are completing
that release's own upload, or a later gated retirement round.

Both remediations are **printed, never executed**. An automatic rollback that itself fails invites a
loop, and a rollback is its own gated act on the same path.

**When the log itself fails.** A failed `switch-started` write refuses with the origin untouched — a
broken record stops a switch before it starts rather than after it. A failed `switch-succeeded` write
exits nonzero saying plainly that the switch itself is verified green and only the record is missing, and
prescribes the idempotent re-run once the log system is fixed. A failed `switch-failed` write reports both
failures together.

## Provenance by reconstruction

The switch driver does not trust the manifest it is handed. It reproduces it.

The build is a pure function of the tree and the identifier, so the repository at the commit a manifest
names either produces exactly those bytes or the manifest is not what it says it is — and no reading of
the document alone can tell those two apart. So the driver asserts that `site/` is clean, that this
checkout's site tree is the site tree at the manifest's commit, and that the commit is an ancestor of the
public tip; then it rebuilds the release at that commit into a scratch directory and compares the
manifest byte for byte and the layout file for file.

Two things follow from that, and both are worth stating.

The first is that a rollback needs the right checkout. Check the prior release's own commit out in a
separate worktree and run the driver from inside it. Determinism is what makes the rebuild byte-identical
to what was published, the committed manifest is the cross-check, and the provenance and origin-table
preflights are what refuse a mismatch early rather than after the entry point has moved. A worktree shares
the repository's ref store, so the public roster stays complete there even though the worktree's checkout
predates later releases — which is exactly the point of using one.

The second is the trust model, stated rather than implied. Reading `refs/remotes/origin/main` is a local
act: no fetch, no network, nothing contacted. It catches the mistake classes — a forgotten push, the wrong
repository, a commit that only exists here — and it cannot prove the remote's live state from a tool that
reaches nothing. The ruled trust anchor puts manifest resolution in the hands of the person running the
gate, and that person's own first step before any armed run is:

```
git fetch origin
```

That is a gate-time act, network and all, and no self-test performs it.

## The two halves of E-6

The check the switch runs is the **wire half**: an HTTP/1.1 socket view of the origin, and its
release-identifier predicate is the served-entry-point postcondition the atomicity rule names. It runs on
every switch and it is the machine gate.

The **browser-measured half** — the cookie jar after a page has loaded, a policy enforced by an engine as
it parses and executes — cannot be made from a socket. It rides this repository's browser suites, which
run every browser-measured item in both engines, and the unit's live acceptance against the deployed
origin. Neither half is offered as a substitute for the other.

## The release log

One immutable object per event, in the release-log bucket, under the prefix the stack states. Nothing
serves that bucket; it is not an origin and the distribution does not reference it.

**The key.**

```
<prefix><release_id>/<run>/<NN>-<event>.json
```

`<run>` is derived once per armed run as a UTC instant and six hex characters of entropy. It is there for
disambiguation rather than secrecy: the key carries the release identifier and a timestamp per the ruling,
and two runs of one release in one second would otherwise collide. `<NN>` starts at `01` and advances by
one on every **attempted** write — a failed write's number is consumed, and nothing retries under it. A run
that somehow reaches ninety-nine refuses rather than wrapping.

**The write is conditional.** Every put carries `--if-none-match '*'`, so an existing key is a
service-refused write and a collision is loud rather than silent.

**What is claimed, exactly.** The immutable record is the RETAINED VERSION. Object Lock holds that version
for its term whatever later happens to the key; the conditional write closes the accidental same-key
overwrite. A delete marker could make a key look absent and admit a second version — no tool in this
repository issues any delete, and the retained version survives that game regardless. A deny-delete bucket
policy would close the marker path structurally; that is a later round's option, named here rather than
quietly assumed.

**The body.**

```json
{
  "schema": "viewer-release-log/1",
  "event": "switch-started",
  "release_id": "<yyyymmddThhmmssZ>-<commit12>",
  "operation": "release | rollback | drill",
  "timestamp": "<yyyymmddThhmmssZ>",
  "invalidation_ids": [],
  "outcome": "ok | failed",
  "detail": "one public-voice sentence; the failing step's name lands here"
}
```

Exactly those eight fields. `timestamp` is the run's compact UTC spelling — the release-id grammar's own
half. `invalidation_ids` is an array of strings, empty where none exist yet. The values may name
account-side facts, because the bucket is private and never served; the schema is public, and it is
documented here.

**The events**: `switch-started`, `switch-succeeded`, `switch-failed`, `drill-started`, `drill-mangled`,
`drill-restored`, `drill-succeeded`, `drill-failed`.

**Retention** is applied per object at the put, never by a bucket default. The mode is fixed at
`GOVERNANCE` in code with the rationale stated there: changing the mode is a policy decision for a gate
rather than a flag on a driver, and `COMPLIANCE` cannot be shortened by anyone including the account root,
which is a thing to choose deliberately or not at all. The period defaults to 400 days and is the one part
`--retention-days` moves.

**Append-only, and there is no delete tooling.** Nothing in this repository issues an S3 delete, removes a
remote object, or retires a release. Release retirement is a later, gated round; until it exists, the
retained roster is exactly the committed manifests.

## The drill

`scripts/infra/drill.sh` is the acceptance drill: break the origin on purpose, watch the check refuse, put
it back, watch it pass. It is a separate program from the check because the oracle observes and decides
and never mutates, and it is a separate program from the switch because the two arm separately.

**D-pre** runs the same preflight and the same resolution a switch does — the same code — so the bytes it
will restore are proven against the published manifest before anything is touched. It then stages those
bytes in the run's record area and prints the complete recovery command, every option in force spelled out
and every path absolute, **before the first mutation**. A crash at any later point therefore leaves the
operator one printed command away from a complete restoration rather than from a bare put.

**D0** takes a fresh listing and runs the check. It must exit 0. A red baseline is a refusal: breaking an
origin that is already broken proves nothing, and nothing is mutated and nothing is logged. Then
`drill-started`.

**D1** is the object-side mangle — an honest manifest over wrong bytes. The target is the entry point,
deliberately: both cache halves serve it `no-store`, so no edge and no browser holds the mangled bytes
after restoration. The mangle appends one comment line, which moves the digest and leaves the release
identity alone, so exactly one predicate is disturbed and the redness is attributable. Put, invalidate to
completion, list, check — and the check **must** refuse, naming the entry point's digest. A green check here
is a failed drill.

**D2** restores, **unconditionally**. It runs on every path out of D1 — success, failure, or a signal caught
by the exit trap — and it is the same code the `--restore` entry runs: put the staged bytes, invalidate both
aliases to completion, list, check, log `drill-restored`. Restoration precedes any log write it would
otherwise wait on: a live origin serving the wrong bytes is a worse state than a record with a hole in it. A
failed restoration is the loudest failure this driver has — it prints the recovery command again, logs
`drill-failed` if the log is reachable, and exits nonzero.

**D3** is the manifest-side mangle — a wrong manifest over an honest origin, and no mutation at all. A
doctored copy of the manifest, with the entry point's digest advanced by one hex character, is checked
against the restored origin and must refuse with that same digest named. The doctored copy stays in the
record area as evidence and is uploaded nowhere.

**D4** is the closing clean run: fresh listing, check exits 0, `drill-succeeded` with every invalidation
identifier collected.

`prod` is refused in code. This unit drills dev.

**The A → B → A rehearsal is not this driver's act.** It needs a second release, and union probing only
bites once there is one, so it belongs to the second release's gate rather than to the first.

**The residual, named.** The mangled entry-point bytes persist as a NONCURRENT VERSION in the versioned,
delete-free origin bucket. They are the public document plus one marker comment and nothing else, and
nothing serves them — the current version is what is served, and the check has confirmed it. Retirement
tooling may lifecycle noncurrent versions in a later round.

## Least privilege

Documented with placeholder resource names, because no account-side value appears in this repository. These
are the **complete** sets: nothing else is needed, and nothing else should be granted.

**Both drivers:**

| Action | On |
|---|---|
| `cloudformation:DescribeStacks` | the viewer stack |
| `s3:PutObject` | the origin bucket |
| `s3:ListBucket` | the origin bucket |
| `cloudfront:CreateInvalidation` | the distribution |
| `cloudfront:GetInvalidation` | the distribution |
| `s3:PutObject` | the release-log bucket, under the log prefix |
| `s3:PutObjectRetention` | the release-log bucket, under the log prefix |

**The switch driver alone, additionally:**

| Action | On | Why |
|---|---|---|
| `s3:GetObject` | the origin bucket | one read: the pre-switch prior-release capture, which the drill never performs |

Nothing else. No delete action of any kind, no read of any other bucket, no IAM, no CloudFormation
mutation. The identity call both flows make needs no grant at all — the service model says so, and a
permission that grants nothing has no place in a least-privilege document.

## The first deploy, in order

1. **Deploy the dev stack** through the change-set idiom (`infra/README.md`).
2. **Capture the dev origin string** from the stack's `DistributionDomainName` output. It does not exist
   until the stack has been built once; capturing it is the point of the dev stand-up.
3. **The config fold — a gated `site/` commit.** The captured origin is added to the committed origin
   table as one key, in a reviewed change, because an entry in that table is a decision about where share
   codes travel and it should read as one in a diff.

   That same commit also reconciles the entry document's **meta** policy, and the fold has been made: the
   shipped meta now carries `connect-src 'self' <the dev API origin>`. A browser enforces the INTERSECTION of
   the meta policy and the response-header policy, so while the meta named only `'self'` the live
   cross-origin request would have been blocked however the header was written. The wire check cannot see any
   of this: it reads response headers and never parses the document. The browser legs can, and one of them
   now measures the permission directly — the request is intercepted by the harness, so what is read is the
   policy's decision and nothing leaves the machine. The edit sits inside the pinned safe prefix of the entry
   document, so it carried its own re-pin round.
4. **Build at that commit.** `node scripts/infra/build-release.mjs`.
5. **Publish at the release-publish gate: commit the manifest under `releases/` AND push it.** The drivers
   read the public tip, so an unpushed manifest cannot switch.
6. **The first switch.** Its prior-release capture records no-prior-release, and its printed remediation is
   the kill path rather than a rollback, because there is nothing to roll back to.

## Notes

**Local conformance runs use `127.0.0.1:4173`.** That is the local-conformance entry of the committed
table — the entry that answers for itself, alongside the hosted entry that sends a viewer to its share API —
and `scripts/infra/selftest/serve-built-release.mjs` binds it and nothing else. It exists for the
self-tests; nothing else invokes it, and no response it writes is evidence about the real distribution. Its
conformance bar is the real check's verdict: if the check refuses it, the defect is in that server or in
the layout it was handed, never in the frozen expectation.

**One armed act at a time.** Both drivers take the same lock — an atomic directory beside the release
directories — and refuse while it is held, naming the holder. The scope is the build area the release
directory sits in; two armed acts run from two different build areas are not excluded by this, which is a
residual rather than a design choice, and the way to avoid it is to run releases from one area.

**Two residuals ride to the deploy gate**, and both are loud rather than silent if they are wrong:

- **The Object-Lock put checksum.** A bucket with Object Lock enabled requires a checksum on a put. The CLI
  supplies one for itself; whether it does so on this version, for this shape of call, is a thing the first
  armed log write establishes. A put that is refused for want of one fails the run at the
  `switch-started` write, which is the earliest and safest place for it to fail.
- **The service honouring the conditional write.** `--if-none-match '*'` is what makes a same-key write a
  refused write rather than a silent overwrite. If the CLI or the service does not honour it, the first
  collision is what says so — and the key form makes a collision very unlikely, which is why the retained
  version, not the key, is what the immutability claim rests on.
