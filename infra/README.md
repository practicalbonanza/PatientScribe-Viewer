# The viewer's hosting

`viewer-stack.yaml` is the whole of it: a private S3 bucket, a CloudFront distribution reading it
through an origin access control, the two response-headers policies the hardening list requires, two
log buckets with opposite jobs, and one alarm. One template, two flavours, selected by the
`Environment` parameter.

Nothing in this directory deploys anything. The scripts under `scripts/infra/` write out the deploy
as a change set and refuse to run at all unless a gate variable is set, which nothing in this
repository sets.

## What is public here and what is not

The template is public and every parameter *name* in it is public. Ten of those names carry values
that are not, and those values live in `infra/parameters.json`, which is git-ignored and which you
create by copying `parameters.json.example`.

| Parameter | What it is | Where the value lives |
|---|---|---|
| `AccountId` | The account this stack belongs in | overlay |
| `OriginBucketName` | The bucket the viewer is served from | overlay |
| `LogBucketName` | The access-log bucket | overlay |
| `ReleaseLogBucketName` | The release-log bucket | overlay |
| `LogOpsPrefix` | The key prefix release events are written under | overlay |
| `AlarmTopicArn` | The topic the request-count alarm notifies | overlay |
| `ApiOrigin` | The origin the policy's `connect-src` names | overlay |
| `CertificateArn` | prod only: the supplied certificate | overlay |
| `HostedZoneId` | prod only: the supplied hosted zone | overlay |
| `DomainName` | prod only: the alias | overlay |

Everything else the template takes — the environment flag, the alarm threshold, the access-log
retention — is public-safe and carries a default in the template.

The overlay is a CloudFormation parameters file, in exactly the shape the CLI reads:

```
aws cloudformation create-change-set --parameters file://infra/parameters.json ...
```

It is consumed directly. There is no script that reads it and builds a different argument list out of
it, because a translation layer between the file and the call is a place the two can disagree.

A dev overlay sets the three prod-only values to empty strings. They have no defaults in the
template on purpose: a boundary parameter with a default is a value in a public file, and an alias
assembled from an empty default is a question better never asked.

`scripts/infra/scan-private-values.mjs` is what holds this. It reads the tracked tree plus every
intended-public untracked file and refuses account-number shapes, literal ARNs, AWS key shapes, and —
if you have an overlay locally — any value out of it. On this directory and `scripts/infra/` it also
refuses e-mail addresses, which is where an ops contact would land if one ever did.

## Region

Everything is pinned to `us-east-1`, and the scripts pass `--region us-east-1` on every call rather
than reading a default from a profile or the environment.

Two reasons, both hard. CloudFront publishes its metrics into `us-east-1` and nowhere else, so an
alarm on `AWS/CloudFront` built anywhere else watches a metric that never arrives — it does not
error, it just never fires. And a certificate attached to a distribution must have been issued in
`us-east-1`, whatever region anything else is in.

## Deploying it

Nothing here runs `sam deploy`, and there is no `samconfig` file. Region and profile are arguments to
the scripts and facts in this document; they are never overlay content.

The idiom is a change set, always, in three steps with a human between them:

```
scripts/infra/deploy-changeset.sh dev --create CREATE
scripts/infra/deploy-changeset.sh dev --execute <change-set-name>
scripts/infra/assert-distribution.sh patientscribe-viewer-dev
```

`--create` takes `CREATE` for a stack that does not exist yet and `UPDATE` for one that does. It is
an argument rather than something the script works out, because a script that decides for itself
whether it is creating or updating is a script that will one day decide wrong and say so afterwards.

Before any of that, and inside the same scripts, `assert-account.sh` calls `sts get-caller-identity`
and compares the answer against the account the overlay names. It runs before the first
CloudFormation call, not after, so a wrong profile costs nothing.

`--parameter-overrides` appears nowhere. The overlay file is the parameters.

Stack names are fixed: `patientscribe-viewer-dev` and `patientscribe-viewer-prod`. The change-set
name is the stack name and a UTC timestamp, derived once per run.

The scripts are disarmed. Each checks `VIEWER_DEPLOY_ARMED` before anything else and exits without
making a single call if it is unset. Setting it is the deploy gate's act.

## Stances this hosting takes

**Stale bytes on an origin error are permitted.** Objects under `/assets/` are named by the digest of
their own contents, so a stale one is byte-identical to a fresh one by construction — there is no
version of it that differs. Release correctness rides the entry point, which is never cached at the
edge at all.

**There is no error document and no redirect.** Every status the distribution can be configured for
is configured to pass the origin's answer through, with nothing cached. A non-allowlisted response
reaches the browser with `no-store` on it. An error page would be a document this origin does not
have, served under a status that did not happen.

**A query string on an asset path is answered with the canonical response.** The cache key is the
normalised path and nothing else, so a request for an asset with a query attached is answered from
the single entry that path has — the object's own bytes, with the object's own immutable directive.
That is the design's accepted answer rather than a gap in it: the object is named by its digest, so
a browser holding a query-shaped variant is holding bytes that cannot change. A query on a path that
is *not* an allowlisted asset is `no-store`, like everything else that is not an asset.

**Cookies.** This origin sets none and receives none, and the check asserts all three readings of
that. While the viewer is on a CloudFront default domain the point is close to moot — that domain is
on the public suffix list, so nothing can set a cookie spanning it. A custom domain changes the
calculus, because a cookie scoped to a parent domain reaches every host under it. That assessment
belongs to whoever attaches the first custom domain, before they attach it, and it is not settled
here.

## Where the rest of it is checked

Not everything about this stack is provable from the stack.

- **Header and cache behaviour, live, per release** — the release check, `RELEASE-CHECK.md`. It reads
  the wire, not the console.
- **The two policies being identical but for one field** — `scripts/infra/check-headers-policies.mjs`,
  which reads this template.
- **Edge propagation** — no template setting decides when a point of presence has caught up. That is
  an acceptance drill against the live origin.
- **DNS and TLS identity** — the prod parameters' own gate. The certificate and the hosted zone are
  supplied to this stack, never created by it, and no prod value exists in this repository.
- **The distribution actually having been built the way this file says** — `assert-distribution.sh`,
  at the deploy gate, reading the control plane back.
