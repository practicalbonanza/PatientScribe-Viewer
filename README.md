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

`npm run check` runs the checked-JSDoc type-check, the forbidden-sink scan over `site/`, that
scan's own self-test, and the browser tests. CI runs the same command, so what passes locally
is what passes there. The individual steps are `npm run typecheck`, `npm run check:sinks`,
`npm run check:sinks:self` and `npm run test:smoke`.

See `LICENSE.md` — published for review, all rights reserved, not open source. See
`CONTRIBUTING.md` — contributions are not accepted. See `SECURITY.md` to report a security
issue.
