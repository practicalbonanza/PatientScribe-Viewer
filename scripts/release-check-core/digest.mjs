/**
 * The one computation this core cannot write for itself.
 *
 * Every other module here is arithmetic over strings and lists, and imports
 * nothing but its siblings. This one imports `node:crypto`, and that is the
 * single exception the purity check admits — named here, and named in the check,
 * so that "the core imports nothing" stays a claim somebody can read rather than
 * one that has quietly become "the core imports a few things".
 *
 * It is admitted because of what it is rather than because it was inconvenient
 * to avoid. `createHash` computes a function of its input: no file, no socket,
 * no clock, no process state, nothing that can differ between two runs over the
 * same bytes. What the purity rule is for is the other kind of import — a core
 * that can read a file is a core whose expectations can come from the thing it
 * is checking, and a core that can open a socket is a core that can be told what
 * it wants to hear. A hash function can do neither.
 *
 * Writing SHA-256 out by hand instead would trade an audited implementation for
 * an unaudited one to preserve the letter of a rule whose purpose is not served
 * by the trade.
 */

import { createHash } from 'node:crypto';

/**
 * The digest of some bytes, as the manifest records digests: lowercase hex.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
