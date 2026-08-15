/**
 * The release check, replayed against the corpus that shows it refuses things.
 *
 * A gate that has only ever been run against something correct is a gate nobody
 * has seen work. Every predicate in `release-check-core/` is silent on a sound
 * origin, which is the shape a check can be emptied in without anything
 * noticing — so each of them has an origin here built to break exactly it, and
 * this program runs every one of those origins and requires the refusal to
 * arrive.
 *
 * Exactly the refusal, and nothing else. A fixture is judged on the set of
 * predicates its run produced against the set it names: every one it names must
 * appear, and nothing it does not name may. Asserted only as "something
 * refused", a fixture keeps passing after the predicate it was written for is
 * replaced by a different one; asserted only as "this predicate appeared", it
 * keeps passing after its origin has grown a second defect that would have made
 * a different fixture pointless. The strict comparison is what makes each
 * fixture evidence about one thing.
 *
 * Each fixture runs alone. Its origin is started before it and stopped after it,
 * on a port nothing else in this repository uses, bound to the loopback address
 * and nowhere else. A fixture whose redness might have been the previous
 * fixture's origin still answering is not evidence of anything.
 *
 * The floors below are lower bounds on what a run has to have done, and they are
 * here for the reason every floor in this repository is: a program that iterates
 * an empty list exits 0 having checked nothing, and so does one whose list has
 * quietly lost half its entries. What they cannot say is whether the corpus
 * still covers what it is supposed to cover — a count cannot tell one fixture
 * from another — and that is asked from outside this file, in
 * `scripts/check-release-core.mjs`, which reads the corpus against the roster of
 * predicates and refuses a roster entry no fixture exercises.
 *
 * Exit codes: 0 = every fixture answered what it must, 1 = one did not.
 */

import { runReleaseCheck } from './release-check-adapters/run.mjs';
import { readInventoryDocument, readManifestDocument, retainedAssets } from './release-check-core/manifest.mjs';
import { planRequests } from './release-check-core/requests.mjs';
import { describe } from './release-check-core/verdict.mjs';
import { checkManifest, readManifest } from './check-manifest-core.mjs';
import { FIXTURES } from '../test/release-fixtures/corpus.mjs';
import { mintCertificate } from '../test/release-fixtures/certificate.mjs';
import { startFixtureOrigin } from '../test/release-fixtures/origin.mjs';

/**
 * The port the plain-socket fixtures bind.
 *
 * Written once. Not 4173, which is the development server's, and not a
 * neighbour of it: a fixture that answered on the port the browser suite's
 * server uses would be a fixture whose results depend on which of the two
 * started first.
 */
const HTTP_FIXTURE_PORT = 8721;

/**
 * The port the TLS fixture binds.
 */
const HTTPS_FIXTURE_PORT = 8723;

/**
 * The origin a plain-socket fixture is served from.
 */
const HTTP_ORIGIN = `http://127.0.0.1:${HTTP_FIXTURE_PORT}`;

/**
 * The origin the TLS fixture is served from.
 *
 * A name rather than an address, because a server name is what a certificate is
 * verified against and an address cannot be one. The connection is still made to
 * the loopback address literally — see `capture.mjs`, which takes the address
 * and the authority as separate fields for exactly this.
 */
const HTTPS_ORIGIN = `https://localhost:${HTTPS_FIXTURE_PORT}`;

/**
 * How many fixtures a run has to have executed.
 *
 * Exactly what the corpus carries, rather than a number below it. A floor with
 * slack in it is a floor a corpus can lose cases into without anything
 * noticing, which is the one thing this number exists to prevent — and adding a
 * fixture meaning an edit here is the point rather than the cost: the count is
 * a decision about coverage, so moving it should be a decision too.
 */
const MINIMUM_FIXTURES = 94;

/**
 * How many of them have to have refused something.
 *
 * A corpus of nothing but conformant deployments passes every assertion in this
 * file while showing that no predicate refuses anything.
 */
const MINIMUM_NEGATIVES = 84;

/**
 * How many of them have to have passed clean.
 *
 * The other direction, and it is not the same claim. A core whose every
 * predicate refuses everything reddens every negative fixture perfectly.
 */
const MINIMUM_CONFORMANT = 10;

/**
 * How many requests the conformant run has to have issued.
 *
 * Read from the plan the requirements fix rather than from what the client
 * happened to send, and compared against what came back — an arm the client
 * quietly stopped issuing is an arm whose assertions all pass.
 */
const MINIMUM_OBSERVATIONS = 36;

/** @type {string[]} */
const failures = [];

/**
 * @param {import('../test/release-fixtures/corpus.mjs').Fixture} fixture
 * @returns {Promise<{ predicates: Set<string>, observations: number, lines: string[] }>}
 */
async function runFixture(fixture) {
  const https = fixture.https === true;
  const scenario = fixture.build(https ? HTTPS_ORIGIN : HTTP_ORIGIN);

  const read = readManifestDocument(scenario.manifestText, `${fixture.name}: the release manifest`);
  /** @type {import('./release-check-core/verdict.mjs').Refusal[]} */
  const refusals = [...read.refusals];
  let observations = 0;

  if (read.manifest !== null) {
    const listing =
      scenario.inventoryText === null
        ? { inventory: null, refusals: [] }
        : readInventoryDocument(scenario.inventoryText, `${fixture.name}: the origin inventory`);
    refusals.push(...listing.refusals);

    // The retained releases, read as documents and merged into the allowlist by
    // the same core function the command line uses. A fixture that assembled a
    // set of paths for itself would be a fixture that agrees with whatever the
    // union does, including nothing.
    const ratified = [read.manifest];
    for (const [at, text] of scenario.unionManifestTexts.entries()) {
      const retained = readManifestDocument(text, `${fixture.name}: retained release manifest ${at + 1}`);
      refusals.push(...retained.refusals);
      if (retained.manifest !== null) {
        ratified.push(retained.manifest);
      }
    }
    const union = retainedAssets(ratified);
    refusals.push(...union.refusals);

    const certificate = https ? mintCertificate() : null;
    const origin = await startFixtureOrigin({
      port: https ? HTTPS_FIXTURE_PORT : HTTP_FIXTURE_PORT,
      route: scenario.route,
      tls: certificate === null ? null : { key: certificate.key, cert: certificate.cert },
    });
    try {
      const result = await runReleaseCheck({
        target: https
          ? {
              scheme: 'https',
              address: '127.0.0.1',
              port: HTTPS_FIXTURE_PORT,
              authority: `localhost:${HTTPS_FIXTURE_PORT}`,
              trustAnchor: certificate === null ? null : certificate.cert,
            }
          : {
              scheme: 'http',
              address: '127.0.0.1',
              port: HTTP_FIXTURE_PORT,
              authority: `127.0.0.1:${HTTP_FIXTURE_PORT}`,
              trustAnchor: null,
            },
        origin: scenario.origin,
        // Fixture mode supplies its own mapping, explicitly, at this layer. The
        // committed table names one origin and it is not a fixture's — which is
        // the whole reason the live command line takes no override and this does
        // not go through it.
        apiOriginFor: (asked) => (asked === scenario.deployment.origin ? scenario.deployment.apiOrigin : null),
        manifest: read.manifest,
        inventory: listing.inventory,
        inventorySupplied: scenario.inventoryText !== null,
        assetUnion: union.assets,
        localConfigBytes: scenario.localConfigBytes,
        nonce: 'fixture-probe',
      });
      refusals.push(...result.refusals);
      observations = result.observations.length;
    } finally {
      await origin.close();
      certificate?.discard();
    }
  }

  return {
    predicates: new Set(refusals.map((one) => one.predicate)),
    observations,
    lines: refusals.map((one) => describe(one)),
  };
}

const manifestFailures = checkManifest(readManifest());
for (const failure of manifestFailures) {
  failures.push(failure);
}

let negatives = 0;
let conformant = 0;
let conformantObservations = 0;
/** @type {Set<string>} */
const exercised = new Set();

for (const fixture of FIXTURES) {
  /** @type {{ predicates: Set<string>, observations: number, lines: string[] }} */
  let outcome;
  try {
    outcome = await runFixture(fixture);
  } catch (error) {
    failures.push(`${fixture.name} — the fixture could not be run: ${error instanceof Error ? error.message : 'unknown'}`);
    continue;
  }

  const expected = [...fixture.expect].sort();
  const actual = [...outcome.predicates].sort();
  if (expected.join(',') !== actual.join(',')) {
    failures.push(
      `${fixture.name} — refused under [${actual.join(', ')}] and the branch it is for is [${expected.join(', ')}]\n    ${outcome.lines.join('\n    ')}`,
    );
    continue;
  }

  for (const predicate of actual) {
    exercised.add(predicate);
  }
  if (expected.length === 0) {
    conformant += 1;
    conformantObservations = Math.max(conformantObservations, outcome.observations);
  } else {
    negatives += 1;
  }
}

if (FIXTURES.length < MINIMUM_FIXTURES) {
  failures.push(`the corpus carries ${FIXTURES.length} fixture(s), and fewer than ${MINIMUM_FIXTURES} means it has lost most of itself`);
}
if (negatives < MINIMUM_NEGATIVES) {
  failures.push(`${negatives} fixture(s) refused something, and fewer than ${MINIMUM_NEGATIVES} means the predicates are not being shown to refuse anything`);
}
if (conformant < MINIMUM_CONFORMANT) {
  failures.push(`${conformant} fixture(s) passed clean, and fewer than ${MINIMUM_CONFORMANT} means nothing shows these predicates admit a sound origin`);
}
if (conformantObservations < MINIMUM_OBSERVATIONS) {
  failures.push(
    `the conformant run captured ${conformantObservations} response(s), and fewer than ${MINIMUM_OBSERVATIONS} means arms of the matrix were not issued`,
  );
}

if (failures.length === 0) {
  // The plan is reported alongside the count so that the number a reader sees is
  // a number they can check against the requirements rather than against the
  // client that produced it.
  const planned = planRequests(
    { schema: 'viewer-release-manifest/1', commit: '0'.repeat(40), release_id: '20260101T000000Z-000000000000', objects: { '/index.html': '0'.repeat(64) } },
    new Map(),
    'shape',
  ).length;
  process.stdout.write(
    `test:release — ${FIXTURES.length} fixture(s): ${conformant} conformant, ${negatives} refusing, ${exercised.size} predicate(s) exercised; the conformant run captured ${conformantObservations} response(s) (a one-object release plans ${planned})\n`,
  );
} else {
  process.exitCode = 1;
  for (const failure of failures) {
    process.stderr.write(`test:release — ${failure}\n`);
  }
}
