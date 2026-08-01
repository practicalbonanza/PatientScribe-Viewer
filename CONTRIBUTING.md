# Contributing

**Contributions are not accepted.**

This repository is published for review, not for collaboration. Pull requests, patches and
feature requests are not accepted, and issues are disabled. There is no contributor agreement
because there is no contribution process. See `LICENSE.md`: reading the source is the only use
contemplated.

While this repository is hosted publicly on GitHub, GitHub users have the rights GitHub's Terms
of Service confer in respect of public repository content, including viewing and forking. Those
are the only rights granted, and none of them permit use, modification, or redistribution
outside GitHub's Service. See `LICENSE.md`.

The single exception to "no correspondence" is a security report. See `SECURITY.md`.

## Repository rules

This repository is public from its first commit, and its history is public along with it.
Nothing can be added and later removed — a deleted file stays in the history, and a rewritten
history does not reach anyone who already cloned. So these rules apply to every file, every
comment, every commit message and every test fixture, from the first commit onward:

- **No internal material.** No internal documents, planning or design records, review chains,
  handovers, or evidence of any kind. This repository carries source and the documentation a
  reader of that source needs — nothing about how it came to be written.
- **No deployment configuration values.** No account identifiers, stack names, bucket names,
  distribution identifiers, role names, or any other environment-specific value. Ever, in any
  file. Infrastructure definitions may live here; the values they are deployed with do not.
- **No secrets.** None exist here by construction, and nothing may introduce one. A viewer that
  needed a secret to do its job would be the wrong design, not a key-management problem.
- **No third-party assets.** Fonts, scripts, styles and images are first-party and stay that
  way. Nothing under `site/` may reference anything outside `site/`.
