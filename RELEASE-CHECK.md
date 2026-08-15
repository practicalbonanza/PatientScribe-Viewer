# The release check

Publishing this viewer means copying the files under `site/` to a place that serves them over
HTTPS. Copying is not a check. It establishes that bytes were written somewhere; it does not
establish that the right bytes are there, that they are the only things there, that they are
served with the headers the design settled, or that what is being served is the release someone
thinks is up.

The release check asks those questions afterwards, from outside, against expectations written
down before the deploy. It is a separate program from anything that publishes: it reads, it
compares, and it changes nothing. Given an origin and the manifest of the release that should be
on it, it either says the origin matches that release or it says which predicate refused and
why.

Everything it measures against is a file on the invoking side. **The origin is never asked what
to expect of it.** That is the one rule the whole design rests on — an origin that supplies its
own expectations passes by construction, and a check that can be satisfied by the thing it is
checking is not a check. The origin does not serve a manifest, is not asked for one, and could
not be believed if it offered one.

## What it checks

The response headers, first. Every response — the entry point, its alias, every object, every
error, every redirect — must carry the content security policy, the permissions policy, the
strict transport security directive, the referrer policy and the robots directive, each exactly
once and each spelled exactly as the design settled it. Exactly once matters: two policies is a
browser enforcing the intersection while an operator believes they configured one. Beyond that
set, a response may carry only what a frozen, class-scoped allowlist admits — `Location` on a 3xx
and nowhere else, and a short list of representation and transport fields. Anything else is
surfaced by name. `Content-Range` is admitted nowhere, for the reason given below: nothing here
asks for part of anything, so the field is either on a response that is not partial or on one
that is refused for being partial. `Set-Cookie` anywhere is a failure: this viewer has no session
and nothing to remember about anyone.

Then what may be kept. Objects under `/assets/` are named by the digest of their own bytes, so
the name can never come to mean different bytes and the response may be kept for a year.
Everything else reaches the browser with `no-store`, because everywhere else is where a shared
note can be. The distinction is tested as an outcome at every status the matrix produces — a 200,
a 206 and a 304 for an allowlisted object must each carry the immutable directive on their own,
rather than being assumed to inherit it, and every other response must say `no-store` in so many
words. Absence of `immutable` is not sufficient there: a 404 with no cache directive at all is
heuristically cacheable, which is to say a cache may invent a lifetime for it.

One request has two acceptable answers, and only one. A request for an allowlisted object with
something in its query is answered either with the canonical response — the object's own
immutable directive over the object's own bytes — or with an explicit `no-store`; anything else
is refused, and the refusal names both forms and quotes what arrived. Both answers are sound
because of how the two halves are configured: the cache in front of these objects is keyed on the
path alone and does not override what an object says about itself, so a request that differs from
the canonical one only in its query is answered out of the cache with the canonical response,
directive and all — and a copy of it kept in a browser for a year is a copy of bytes that cannot
come to mean anything else, because the object is named by their digest. The widening stops
there. A query on a path the allowlist does not carry says `no-store` like everything else that
is not allowlisted, and a bare `?` — cache-key-identical to no query at all — answers exactly as
the canonical request does.

Then the bytes — every body that arrives, not only the ones a particular request asked for.
Every object in the manifest is fetched three times, asking for plain bytes, for gzip and for
brotli, and every arm is decoded and hashed against the same manifest entry, so an origin
serving the right object as plain bytes and a stale one under gzip is an origin this notices. A
body whose declared coding will not come off is a failure rather than a body of unknown content.
The same comparison is made of every other 200 the check elicits at a path the release names —
the response to a conditional request, to a request carrying an empty query — because an origin
that serves the release under three codings and something else to a browser on its second visit
is an origin most of whose traffic is the something else.

A `304` must carry no body at all. It may carry a `Content-Length`, and that field is never
compared against the nothing that arrived: it describes the representation the browser is being
told it already holds, not this response. The conditional request replays a validator and asks
for no particular coding, and a validator that is not specific to one can validate a
representation other than the one that issued it — so the field is conformant when it is the
length of any representation of that path this run saw served, and a value that is none of them
is refused, naming every number it was compared against.

Which responses count as representations of the path is exactly the six requests that ask for
one: plain bytes, gzip and brotli, of an object and of an entry-point alias, with nothing in the
query. A request carrying a query is a request for a different target — an origin may answer one
with something else quite legitimately, and no conditional request in this matrix carries one —
so what comes back from the query probes is judged like any other response and contributes no
length here. Counting them would let an origin widen the set of numbers its own `304` is checked
against.

Nothing here asks for part of an object. No request carries a `Range`, and a partial response is
refused wherever one turns up. Whether an origin serves ranges is not a property of a release: it
is a property of the service in front of the bytes, a content delivery network may serve them to
real clients quite correctly, and this check simply does not assert it either way. What the
absence buys is the stronger statement — with nothing asking for part of anything, a `206` is an
origin answering a question nobody put to it, and "which bytes of the object are these" has no
answer a check comparing whole objects can use.

Then what is still there from before. Releases that are retained so that they can be rolled back
to are named to the check with `--union`, and the objects under `/assets/` they name are asked
the same questions on the same arms as this release's, and hashed against the digest each of
those releases recorded. An allowlist that permits those paths without ever asking for them says
a rollback may work; asking is what says it will. Their document-prefix paths are not asked for:
the live document set is exactly the current release's.

Then which release it is. The entry-point document carries exactly one HTML comment naming the
release, the manifest names the same one, and the two must agree. The document is scanned for its
comment spans and the identifier is looked for inside those and nowhere else, so a release
spelling in ordinary text, or in an attribute value, or in a script is not a release comment.
What that scan is not is a parser: a span that looks like a comment is read as one wherever it
appears, including inside script text or inside an attribute value, because the alternative is a
second implementation of a browser's reading of HTML held to a standard nothing here needs. That
is harmless, and what makes it harmless is the digest comparison above: a document carrying such
a span is not the document the manifest names, and the byte comparison is what says so. This
reading attributes identity; it does not hold the document's contents. The entry point answers at two URLs —
`/` and `/index.html` — and every check of it runs against both, on every arm including the
conditional one; a divergence between them is a failure in its own right.

Then what else is there. An origin cannot be enumerated over HTTP: `GET /` returns a document,
not a listing, and the absence of a response for a path nobody asked about says nothing. So "is
there anything served here that this release does not name" is answered from a listing produced
on the deploy side and handed in as an input. A run given no listing **fails**. It does not skip
that question — a check that quietly answers fewer questions when it is given less is a check
whose coverage its caller decides.

And where the page may talk. The expected `connect-src` is not a flag and cannot be supplied. It
is derived from the committed origin table, `site/js/config.js`, and that table's bytes are bound
three ways before any of it is used: the bytes this checkout holds, the digest the manifest
records, and the bytes the origin serves must all be the same. Only then is the local module
imported and asked what it answers for the origin under test. No JavaScript from the origin is
ever executed. An origin the table does not answer for is a failed check rather than a skipped
one — a table that does not name an origin is a decision nobody has made, not a gap to route
around.

## The frozen core and the replaceable adapters

The check is in two halves, and the boundary between them is structural rather than a comment.

`scripts/release-check-core/` decides. Its modules are pure: they take data and return refusals,
they open nothing, and they import nothing but each other. There is one exception, `node:crypto`
in `digest.mjs`, and it is admitted because a hash function computes a function of its input —
no file, no socket, no clock — which is the opposite of what the rule exists to prevent. Every
artifact of the core has a recorded digest in `scripts/release-check-core/digests.txt`, and
`npm run check:release` recomputes them, refuses any drift, refuses a recorded list that does not
name exactly the artifacts on disk, and refuses a core artifact that has grown an import.

`scripts/release-check-adapters/` touches things. `capture.mjs` speaks HTTP/1.1 over a plain
socket or a TLS one and reads each response two ways, described in the next section. `run.mjs`
issues the request matrix in the order the conditional arm needs and hands what came back to the
core. The browser-driven half lives in `test/release.spec.js`.

Adapters import the core. The core imports no adapter and no fixture. That direction is checked,
not assumed; written the other way round, "frozen core" and "replaceable adapter" would be two
names for one directory.

## What a response has to look like on the wire

The check accepts exactly the shape below and refuses everything else, and every refusal quotes
what the connection actually carried.

- **The framing is HTTP/1.1, read strictly.** The final response says HTTP/1.1; an older version
  is refused, because its framing rules are not the ones any of this is about. Zero or more
  interim (`1xx`) responses may arrive first, each of them read and recorded — the assertion that
  no `103 Early Hints` arrives is worth nothing from a client that cannot see one — and then
  exactly one final response. An interim response sends no body, so it frames none: a
  `Content-Length` or a `Transfer-Encoding` on one is refused, naming the status it arrived with
  and the field it carried.
- **A body is framed one way, and which ways are allowed depends on the status.** A response that
  carries a body carries either exactly one `Content-Length` or a `Transfer-Encoding` whose value
  is exactly the single terminal token `chunked` — never both, never neither. Neither is the
  interesting one: a body delimited by the connection closing is a body whose completeness cannot
  be told apart from a body that was cut off. A length stated twice is refused even when the two
  agree, which is stricter than the specification requires and is meant: two fields are two
  fields, and which of them something in front of this origin keeps is a question this check
  would rather not have an answer to. A status that carries no body — an interim response, a 204,
  a 304 — carries no body octets and no transfer coding, and its `Content-Length`, if it has one,
  is read as described above rather than compared against the nothing that arrived.
- **The head is a sequence of field lines and nothing else.** No obsolete line folding, no
  whitespace between a field name and its colon, no line without a colon. Every occurrence of
  every field is read separately, including the ones past the count at which an ordinary client
  stops recording them.
- **A chunked message ends where its framing says it ends.** Each chunk declares its own size, so
  where the message stops is worked out by reading each size and stepping over that many octets,
  down to the zero-length chunk, the trailer section and the blank line that closes it. A chunk
  size is a hex number and any spelling of zero is zero: a message ending `00` has ended, and an
  origin is not refused for writing it that way.
- **The trailer section of a chunked message may be empty and must be.** An empty one is
  ordinary; a field in it is refused by name. A trailer is where a header that would have been
  refused can be put by somebody who has read this document.
- **Nothing follows the message.** The request asks for the connection to be closed, so octets
  after the framed message are octets nobody asked for — whether they are noise or a whole second
  response. Stepping through the framing is what makes that judgement possible: a second response
  ends the way the first one did, so a reading that searched for an ending would find the wrong
  one and call two messages one.

How that is read is worth stating, because it is two readings rather than one. The framing is
read by the host's own HTTP parser in its strict mode, which is the thing to reach for when the
alternative is writing a second one: everything a hand-rolled parser does not refuse becomes
something this check accepts, and a parser that has been shown strict about duplicate lengths,
comma-joined lengths, a length beside a transfer coding, folded lines, whitespace before a colon,
lines with no colon, corrupt chunk framing and junk in the trailer position is a better answer
than a new one written here.

Alongside it, every octet that arrives is kept exactly as it arrived, and every refusal above
quotes from that record. The rules the parser does not police are enforced from it instead: the
response's version, the choice of framing, the completeness rule that a body with no length and
no coding does not satisfy, what an interim response declares about a body it does not send,
where a chunked message ends, and the octets after it. That last one is why the record exists at
all. A client cannot report it — to a
client, a second response on a connection is simply the next response, so it reads the first one
and says nothing — and a transcript can, because it is not reading anything.

## Running it at a deploy

```
node scripts/release-check.mjs <origin> <manifest> --inventory <listing> [--union <manifest> ...]
```

`<origin>` is the origin under test — a scheme and a host, nothing else. `<manifest>` is the
release manifest, resolved from this public repository at the commit the release was built from,
by the person running the gate. `--inventory` is the deploy-side listing of every path the origin
serves, and it is required. `--union` carries the manifests of the other releases still retained,
which is what makes the allowlist under `/assets/` a union rather than one release's worth —
objects there are named by their own digests, so retaining an older release means its objects are
still legitimately present.

Exit codes: 0 if every predicate held, 1 if one did not, 2 if the check could not be run at all.

## What this program sees, and what it does not

The command line observes one thing: the HTTP/1.1 socket view of the origin. It opens a
connection, writes a request, and reads the bytes that come back — the status line, every header
occurrence in the order it arrived, any interim response ahead of the final one, and the body as
framed on the wire. That is a deliberately narrow view, and it is narrow in a useful direction:
it sees exactly what was sent, and it sees it the same way twice.

It is not a browser, and nothing it reports is a claim about one. How a browser negotiates
HTTP/2 with the origin, what it does with cookies, and how it enforces a content security policy
as it parses and executes a page are questions about an engine, and they are answered where they
can be answered: by the browser suites in this repository, which run every browser-measured item
in both Chromium and WebKit, and by the acceptance runs performed against a deployed origin
before a release is accepted. The two halves are complementary rather than redundant — the
socket view sees a header the browser would normalise away, and the browser sees a behaviour no
socket can produce — and neither is offered as a substitute for the other.

A run reports failures and findings separately. A finding is a refusal whose subject the design
did not choose — a header outside the allowlist, an arm that could not be issued — and it is
reported under its own name so that it reads as that rather than as a policy violation. It is not
a lesser failure that a run may exit 0 with. A gate whose findings are printed above a green
summary is a gate whose findings nobody reads twice.

## What is measured rather than asserted

A destination named in a `Link` response header is fetched before the parser has read a byte of
the document. A policy carried in the document therefore cannot govern it, and whether a policy
carried in the *response* does is a question about engines rather than about this page.

The check's answer to that is not to reason about it. It refuses a `Link` response header on the
entry point outright, and it refuses a `103 Early Hints` interim response there too — assertions
that need no engine to hold, and that the capture client has been shown able to make, because a
fixture that emits each of them reddens each of them. Nothing anywhere in this repository depends
on a final response's policy governing a fetch that an early hint started.

Separately, and for the record rather than as a requirement, the behaviour was measured. A local
fixture served a page whose response carried `Link: rel=preload` naming a same-origin resource
the document never references, across three preload destinations and two policy arms — the full
policy present, and no policy at all. The second arm is the counterfactual: without it, a fetch
that does not happen could be the policy's doing or could be a hint that was never going to be
followed.

| destination | admitted by | policy present | policy absent |
| --- | --- | --- | --- |
| `as=script` | `script-src 'self'` | fetch issued | fetch issued |
| `as=image` | `img-src 'self'` | fetch issued | fetch issued |
| `as=font` | no directive names it, so `default-src 'none'` | **no fetch** | fetch issued |

Identical in both engines: Chromium 151.0.7922.34 and WebKit 26.5, on 13 August 2026. The reading
is that where the response's policy admits the destination the hinted fetch happens, where the
policy does not name the destination at all it does not, and the no-policy arm shows the hint was
otherwise going to be followed. That is what was observed on those versions. It is not a
requirement, it is not relied on, and a later version behaving differently would change nothing
in this repository — which is the point of writing it down as a measurement.

The measurement is re-taken on every run: `test/release.spec.js` performs it in both engines and
records the matrix in its output.

## What holds the check itself

The predicates are silent on a sound origin, which is the shape a check can be emptied in without
anything noticing. So each of them has an origin built to break exactly it. `npm run test:release`
starts each of those origins in turn — alone, on a loopback port of its own, stopped before the
next one — runs the whole check against it, and requires the set of predicates that refused to be
exactly the set that fixture names. Every one it names must appear and nothing else may: asserted
only as "something refused", a fixture keeps passing after the predicate it was written for is
replaced by another; asserted only as "this predicate appeared", it keeps passing after its origin
has grown a second defect.

The corpus is written against the requirements rather than against the code. Every branch of the
classification and of the request matrix has a fixture, and each fixture records the requirement
it is for in its own words. Whether the corpus still covers the whole roster is asked from a
different step — `npm run check:release` reads the roster of predicates against the corpus and
refuses a predicate no fixture exercises — because a corpus judged only by the runner that runs it
cannot tell a corpus that has lost half its cases from a runner that has stopped comparing.

Two of those predicates cannot be driven from a socket: whether a request carried a cookie the
browser was already holding, and whether anything is left in the jar afterwards. Those are driven
in `test/release.spec.js`, in both engines, each with its own control — one fixture seeds a cookie
before navigation and one sets one in a response, and each must redden its own half.
