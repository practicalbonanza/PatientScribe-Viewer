/**
 * Read one value out of the deploy overlay.
 *
 * Usage:
 *   node scripts/infra/read-overlay-parameter.mjs <overlay.json> <ParameterKey>
 *
 * Exit codes: 0 = the value was found and printed, 2 = it was not.
 *
 * There is no exit 1 here, because there is no such thing as a value this file
 * disagrees with. Either the overlay has the key or it does not, and both of the
 * ways it can fail — a file that will not parse, a key nothing wrote — are the
 * same kind of failure: the caller asked for something that is not there, and
 * carrying on with an empty string would turn that into a comparison against
 * nothing that quietly succeeds.
 *
 * The overlay is a CloudFormation parameters file and is read as one: an array
 * of objects with `ParameterKey` and `ParameterValue`. It is the same file the
 * deploy hands to `--parameters file://`, unmodified, which is the point — the
 * scripts read it the way the CLI reads it rather than through a shape of their
 * own that could drift from it.
 */

import { readFileSync } from 'node:fs';

/**
 * @param {string} message
 * @returns {never}
 */
function cannotRead(message) {
  process.stderr.write(`read-overlay-parameter — ${message}\n`);
  process.exit(2);
}

const file = process.argv[2];
const key = process.argv[3];

if (file === undefined || key === undefined) {
  cannotRead('usage: read-overlay-parameter.mjs <overlay.json> <ParameterKey>');
}

/** @type {string} */
let text;
try {
  text = readFileSync(file, 'utf8');
} catch {
  cannotRead(`cannot open ${file}`);
}

/** @type {unknown} */
let parsed;
try {
  parsed = JSON.parse(text);
} catch (error) {
  cannotRead(`${file} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
}

if (!Array.isArray(parsed)) {
  cannotRead(`${file} is not a CloudFormation parameters array`);
}

for (const entry of parsed) {
  if (entry === null || typeof entry !== 'object') {
    continue;
  }
  const record = /** @type {Record<string, unknown>} */ (entry);
  if (record['ParameterKey'] !== key) {
    continue;
  }
  const value = record['ParameterValue'];
  if (typeof value !== 'string') {
    cannotRead(`${key} in ${file} has no string value`);
  }
  process.stdout.write(value);
  process.exit(0);
}

cannotRead(`${file} carries no ${key}`);
