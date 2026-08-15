/**
 * Issuing the matrix, and handing what came back to the core.
 *
 * This is the seam between a check that is arithmetic over data and a check that
 * touches something. Above it, `release-check-core/` decides; below it,
 * `capture.mjs` reads a socket. What lives here is the ordering that connects
 * the two, and one piece of ordering is load-bearing enough to be the reason
 * this file exists rather than being folded into the command line: the
 * conditional arm cannot be issued until the arm it depends on has answered.
 *
 * A conditional request carries a validator, and a validator the origin never
 * issued is a validator the origin has no reason to honour — the request gets a
 * 200 and the arm has measured nothing while reporting a pass. So the plan is
 * issued in two passes. Everything that stands on its own goes first; then, for
 * each path whose first response carried a validator, the conditional arm goes
 * out carrying that origin's own value. A path whose first response carried no
 * validator has no conditional arm to issue, and that is recorded as an arm that
 * did not run rather than quietly not appearing.
 *
 * Which origin the page may talk to is decided before any of it. The table is
 * the committed one, the answer is looked up for the origin under test, and an
 * origin the table does not answer for stops the run — it is not a check with
 * one expectation left blank, it is a check with no expectation for the field
 * that decides where a share code travels.
 */

import { judge } from '../release-check-core/check.mjs';
import { sha256Hex } from '../release-check-core/digest.mjs';
import { CONFIG_PATH } from '../release-check-core/manifest.mjs';
import { planRequests } from '../release-check-core/requests.mjs';
import { fail, PREDICATES } from '../release-check-core/verdict.mjs';
import { capture } from './capture.mjs';

/**
 * What one run needs.
 *
 * @typedef {object} RunInputs
 * @property {import('./capture.mjs').Target} target Where to send the requests.
 * @property {string} origin The origin under test, as the page would see it —
 *   scheme, host and port. This is the key the origin table is asked about.
 * @property {(origin: string) => string | null} apiOriginFor The committed
 *   table's own lookup. In live mode this is the local module the manifest
 *   binds; in fixture mode the caller supplies its own mapping, which is what
 *   makes a conformant fixture on a fixture port possible.
 * @property {import('../release-check-core/manifest.mjs').ReleaseManifest} manifest
 * @property {import('../release-check-core/manifest.mjs').OriginInventory | null} inventory
 * @property {boolean} inventorySupplied
 * @property {ReadonlyMap<string, string>} assetUnion Every `/assets/` path the
 *   union of the retained releases names, with the digest that release
 *   recorded. The digests are carried rather than discarded, because a retained
 *   release's objects are asked for and hashed like this release's.
 * @property {Uint8Array | null} localConfigBytes The bytes of the origin table
 *   as this checkout holds them.
 * @property {string} nonce
 */

/**
 * What one run produced.
 *
 * @typedef {object} RunResult
 * @property {import('../release-check-core/verdict.mjs').Refusal[]} refusals
 * @property {import('../release-check-core/observation.mjs').Observation[]} observations
 * @property {import('../release-check-core/check.mjs').NotRun[]} notRun
 * @property {string | null} apiOrigin
 */

/**
 * The fields a request arm sends.
 *
 * @param {import('../release-check-core/requests.mjs').PlannedRequest} planned
 * @returns {import('../release-check-core/observation.mjs').HeaderField[]}
 */
function fieldsFor(planned) {
  /** @type {import('../release-check-core/observation.mjs').HeaderField[]} */
  const fields = [];
  if (planned.acceptEncoding !== null) {
    fields.push({ name: 'accept-encoding', value: planned.acceptEncoding });
  }
  return fields;
}

/**
 * Run the matrix against an origin and judge what it answered.
 *
 * @param {RunInputs} inputs
 * @returns {Promise<RunResult>}
 */
export async function runReleaseCheck(inputs) {
  const apiOrigin = inputs.apiOriginFor(inputs.origin);
  if (apiOrigin === null) {
    return {
      refusals: [
        fail(
          PREDICATES.CONNECT_SRC_ORIGIN,
          inputs.origin,
          'the committed origin table does not answer for this origin, so there is no expected connect-src — a table that does not name an origin is a decision that has not been made, not a check to skip',
        ),
      ],
      observations: [],
      notRun: [],
      apiOrigin: null,
    };
  }

  const plan = planRequests(inputs.manifest, inputs.assetUnion, inputs.nonce);
  /** @type {import('../release-check-core/observation.mjs').Observation[]} */
  const observations = [];
  /** @type {import('../release-check-core/check.mjs').NotRun[]} */
  const notRun = [];

  for (const planned of plan.filter((one) => !one.conditional)) {
    observations.push(
      await capture(inputs.target, {
        arm: planned.arm,
        method: 'GET',
        path: planned.path,
        hasQuery: planned.hasQuery,
        query: planned.query,
        headers: fieldsFor(planned),
      }),
    );
  }

  for (const planned of plan.filter((one) => one.conditional)) {
    const first = observations.find((one) => one.path === planned.path && !one.hasQuery && one.status === 200);
    const etag = first?.headers.find((field) => field.name === 'etag')?.value ?? null;
    const modified = first?.headers.find((field) => field.name === 'last-modified')?.value ?? null;
    if (etag === null && modified === null) {
      notRun.push({
        arm: planned.arm,
        path: planned.path,
        reason: 'the first response carried no validator, so there is no conditional request the origin has a reason to honour',
      });
      continue;
    }
    observations.push(
      await capture(inputs.target, {
        arm: planned.arm,
        method: 'GET',
        path: planned.path,
        hasQuery: planned.hasQuery,
        query: planned.query,
        headers:
          etag === null
            ? [{ name: 'if-modified-since', value: String(modified) }]
            : [{ name: 'if-none-match', value: etag }],
      }),
    );
  }

  const liveConfig = observations.find((one) => one.arm === 'object-identity' && one.path === CONFIG_PATH);
  const liveDigest = liveConfig?.decoded === undefined || liveConfig.decoded === null ? null : sha256Hex(liveConfig.decoded);

  const refusals = judge({
    apiOrigin,
    manifest: inputs.manifest,
    assetUnion: inputs.assetUnion,
    inventory: inputs.inventory,
    inventorySupplied: inputs.inventorySupplied,
    observations,
    notRun,
    configBinding: {
      localDigest: inputs.localConfigBytes === null ? null : sha256Hex(inputs.localConfigBytes),
      liveDigest,
    },
  });

  return { refusals, observations, notRun, apiOrigin };
}
