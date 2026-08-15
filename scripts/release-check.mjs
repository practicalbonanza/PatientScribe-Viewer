/**
 * The release check — the command line.
 *
 * Usage:
 *   node scripts/release-check.mjs <origin> <manifest> --inventory <listing>
 *                                  [--union <manifest> ...]
 *
 * Exit codes: 0 = the origin matched the release it was measured against,
 * 1 = it did not, 2 = the check could not be run.
 *
 * What this is for: a release is published by copying bytes somewhere, and
 * "the right bytes are there, served the right way" is not something the act of
 * copying can establish. This asks it afterwards, from outside, against
 * expectations that were written down before the deploy — the manifest comes
 * from the public repository at the named commit, resolved by the person running
 * the gate. The origin never supplies it. An origin that told the check what to
 * expect would pass by construction, which is the one thing a release check must
 * not be able to do.
 *
 * Every input is a file on the invoking side. That includes the listing: an
 * origin cannot be enumerated over HTTP, so "is there anything served here that
 * this release does not name" is answered from a deploy-side listing or not at
 * all — and `--inventory` is required rather than optional because a check that
 * quietly answers fewer questions when it is given less is a check whose
 * coverage the caller sets.
 *
 * `--union` carries the manifests of the other releases still retained, which is
 * what makes the allowlist under `/assets/` a union rather than one release's
 * worth. An object under `/assets/` is named by its own digest, so retaining an
 * older release means its objects are still legitimately there — and a release
 * is retained so that it can be rolled back to, which is a claim about bytes.
 * So the digests those manifests record are carried through rather than reduced
 * to a set of permitted paths: every one of those objects is asked for on the
 * same arms as this release's and hashed against what its own release recorded,
 * and one that is absent, or that answers with something else, is a rollback
 * that would not work reported on a day when it does not have to.
 *
 * There is no way to tell this what `connect-src` should be. The expected value
 * is derived from the committed origin table, and the table's bytes are bound
 * three ways before they are used: what this checkout holds, what the manifest
 * records, and what the origin serves must all be the same bytes. Then the local
 * module — the one this checkout holds, whose bytes have just been shown to be
 * the bytes the manifest binds — is imported and asked. No JavaScript from the
 * origin is ever executed here, and no flag can substitute an answer.
 *
 * This program observes. It writes nothing anywhere but its own output, changes
 * nothing at the origin, and has no side effect a second run would not have.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runReleaseCheck } from './release-check-adapters/run.mjs';
import { readInventoryDocument, readManifestDocument, retainedAssets } from './release-check-core/manifest.mjs';
import { describe } from './release-check-core/verdict.mjs';

/**
 * The command line, read.
 *
 * @param {readonly string[]} argv
 * @returns {{ origin: string, manifest: string, inventory: string, union: string[] } | null}
 */
function commandLine(argv) {
  const positional = [];
  /** @type {string | null} */
  let inventory = null;
  /** @type {string[]} */
  const union = [];
  let at = 0;
  while (at < argv.length) {
    const argument = argv[at];
    if (argument === '--inventory') {
      const value = argv[at + 1];
      if (value === undefined || value.startsWith('--')) {
        return null;
      }
      inventory = value;
      at += 2;
      continue;
    }
    if (argument === '--union') {
      at += 1;
      while (at < argv.length) {
        const value = argv[at];
        if (value === undefined || value.startsWith('--')) {
          break;
        }
        union.push(value);
        at += 1;
      }
      continue;
    }
    if (argument === undefined || argument.startsWith('--')) {
      return null;
    }
    positional.push(argument);
    at += 1;
  }
  const [origin, manifest] = positional;
  if (positional.length !== 2 || origin === undefined || manifest === undefined || inventory === null) {
    return null;
  }
  return { origin, manifest, inventory, union };
}

/**
 * Where to send the requests, from the origin the check was pointed at.
 *
 * @param {string} origin
 * @returns {import('./release-check-adapters/capture.mjs').Target | null}
 */
function targetFor(origin) {
  /** @type {URL} */
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    return null;
  }
  const scheme = parsed.protocol === 'https:' ? 'https' : 'http';
  const port = parsed.port === '' ? (scheme === 'https' ? 443 : 80) : Number(parsed.port);
  return { scheme, address: parsed.hostname, port, authority: parsed.host, trustAnchor: null };
}

const invocation = commandLine(process.argv.slice(2));
if (invocation === null) {
  process.stderr.write(
    'release-check — usage: release-check.mjs <origin> <manifest> --inventory <listing> [--union <manifest> ...]\n',
  );
  process.exit(2);
}

// The origin is written without a trailing slash, which is how a page reports
// its own origin and therefore how the committed table is keyed.
const origin = invocation.origin.replace(/\/$/, '');
const target = targetFor(origin);
if (target === null) {
  process.stderr.write(`release-check — ${invocation.origin} is not an origin: a scheme, a host, and nothing else\n`);
  process.exit(2);
}

/** @param {string} file */
const read = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    process.stderr.write(`release-check — ${file} could not be read: ${error instanceof Error ? error.message : 'unknown'}\n`);
    process.exit(2);
  }
};

const expected = readManifestDocument(read(invocation.manifest), invocation.manifest);
const listing = readInventoryDocument(read(invocation.inventory), invocation.inventory);

/** @type {import('./release-check-core/verdict.mjs').Refusal[]} */
const documentRefusals = [...expected.refusals, ...listing.refusals];

/** @type {import('./release-check-core/manifest.mjs').ReleaseManifest[]} */
const ratified = expected.manifest === null ? [] : [expected.manifest];
for (const file of invocation.union) {
  const retained = readManifestDocument(read(file), file);
  documentRefusals.push(...retained.refusals);
  if (retained.manifest !== null) {
    ratified.push(retained.manifest);
  }
}
const union = retainedAssets(ratified);
documentRefusals.push(...union.refusals);
const assetUnion = union.assets;

if (expected.manifest === null) {
  process.stderr.write('release-check — the release manifest was refused, so there is nothing to measure the origin against:\n');
  for (const refusal of documentRefusals) {
    process.stderr.write(`  ${describe(refusal)}\n`);
  }
  process.exit(1);
}

// The origin table, three ways. The bytes this checkout holds are read here; the
// manifest's record of them and the origin's copy of them are compared inside
// the judgement. Only after all three agree is the local module asked what it
// answers — and it is the local module rather than the served one, because
// running an origin's JavaScript to find out what that origin is allowed to do
// is not a check.
const configFile = fileURLToPath(new URL('../site/js/config.js', import.meta.url));
/** @type {Uint8Array | null} */
let localConfigBytes = null;
try {
  localConfigBytes = readFileSync(configFile);
} catch {
  localConfigBytes = null;
}
const { apiOriginFor } = await import('../site/js/config.js');

const result = await runReleaseCheck({
  target,
  origin,
  apiOriginFor,
  manifest: expected.manifest,
  inventory: listing.inventory,
  inventorySupplied: true,
  assetUnion,
  localConfigBytes,
  nonce: `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`,
});

const refusals = [...documentRefusals, ...result.refusals];
process.stdout.write(
  `release-check — ${origin} against ${invocation.manifest}: ${result.observations.length} response(s) captured, ${result.notRun.length} arm(s) not run\n`,
);

if (refusals.length === 0) {
  process.stdout.write(`PASS — every predicate held, and connect-src was expected to be ${result.apiOrigin}\n`);
} else {
  process.exitCode = 1;
  const failed = refusals.filter((one) => one.severity === 'fail');
  const found = refusals.filter((one) => one.severity === 'finding');
  process.stdout.write(`FAIL — ${failed.length} failure(s) and ${found.length} finding(s):\n\n`);
  for (const refusal of refusals) {
    process.stdout.write(`  ${describe(refusal)}\n`);
  }
  process.stdout.write('\nA finding is not a lesser failure that a run may exit 0 with. It is a\nrefusal whose subject the design did not choose, reported under its own\nname so that it can be read as that rather than as a policy violation.\n');
}
