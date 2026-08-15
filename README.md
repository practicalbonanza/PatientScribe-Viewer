# PatientScribe Viewer

This repository holds the source of the PatientScribe viewer: the static web page a person
opens when a note has been shared with them from the PatientScribe app. It is published so that
the page can be read and reviewed. The page is plain HTML, CSS and JavaScript — no framework,
no runtime dependencies and no build step, so the files under `site/` are the files that are
served. Everything else in the repository is development tooling, which is never part of what
is served.

## Checks

```
npm ci                # install the dev tooling from the lockfile
npm run browsers      # install the test browsers (once per machine)
npm run check         # run everything
```

`npm run check` runs the checked-JSDoc type-check, the forbidden-sink scan over `site/`, the
self-tests, the release check's own self-test, the fast test path, the release check's fixture
corpus, and the browser tests. CI runs the same command, so what passes locally is what passes
there. The individual steps are `npm run typecheck`, `npm run check:sinks`, `npm run check:self`,
`npm run check:release`, `npm run test:fast`, `npm run test:release` and `npm run test:smoke`.

The self-tests are there because a check nobody checks reports whatever it reports. Each spawns
the thing it is about as a child process, against fixture trees with known answers, and reads
the exit code from outside it. There is one for the sink scan, one for each of the two test
runners, and they are collected and run by a runner rather than named one at a time — a check
whose own invocation is a single line in the manifest is a check a single line can silence.

Both test paths go through a runner that decides whether the suite ran, rather than only
whether anything failed. A test runner answers the second question and not the first: a pattern
that matches nothing, a file that has moved, a suite that is entirely skipped, or a spec file
collected out of the run are all reported as a pass. The runners judge each run on what it
reported having done — enough files, the files the suite is built from, enough tests actually
executed, and both engines for the browser path — and they check the manifest, so replacing a
step of `npm run check` with something that does nothing is noticed by the steps that still
run.

## Checking a deployed release

The files under `site/` are what is served, and copying them somewhere is not a check that the
right bytes arrived, that they are the only things there, or that they are served with the
headers this design settled. `scripts/release-check.mjs` asks that of a live origin, from
outside, against a manifest resolved from this repository at the commit a release was built
from. It reads and compares; it changes nothing. See `RELEASE-CHECK.md` for what it checks, how
its frozen core and its replaceable adapters are separated, and how it is invoked at a deploy.

See `LICENSE.md` — published for review, all rights reserved, not open source. See
`CONTRIBUTING.md` — contributions are not accepted. See `SECURITY.md` to report a security
issue.
