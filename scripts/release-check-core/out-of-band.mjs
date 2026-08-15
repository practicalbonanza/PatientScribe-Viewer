/**
 * Requests the response starts, rather than the document.
 *
 * Everything the page's own policy governs, it governs from the point in the
 * byte stream where the parser reads it. A `Link` response header and a `103
 * Early Hints` interim response both name destinations before that point — the
 * header arrives with the response, the interim arrives before the response —
 * and the fetches they start are started by the response rather than by anything
 * written in the document. So a check on what the document contains cannot see
 * them, and a policy carried in the document cannot be relied on to refuse them.
 *
 * Two assertions, and they are separate on purpose.
 *
 * The first is about this deployment: the entry point's responses carry neither.
 * That is a thing an origin either does or does not do, it is measured on every
 * entry-point response in the matrix, and it is the assertion this check
 * enforces.
 *
 * The second is about engines, and it is measured rather than asserted — see the
 * documentation for the recorded matrix. Nothing here, and nothing anywhere in
 * this check, rests on a final response's policy governing a fetch that a 103
 * started. The reason the first assertion is written as an assertion is exactly
 * that the second cannot be: an origin that emits no hints needs no answer to
 * the question of what an engine would do with one.
 *
 * An adapter that cannot see a 103 would pass the second half of this
 * vacuously — every origin looks like an origin sending no early hints to a
 * client that discards interim responses. So the fixture corpus includes an
 * origin that emits one, and it must redden this. A pass here from a blind
 * adapter is not a pass.
 */

import { fail, PREDICATES } from './verdict.mjs';

/**
 * Does this response start anything out of band?
 *
 * @param {import('./observation.mjs').Observation} response
 * @returns {import('./verdict.mjs').Refusal[]}
 */
export function checkNoOutOfBandInitiation(response) {
  /** @type {import('./verdict.mjs').Refusal[]} */
  const refusals = [];
  const where = `${response.arm} ${response.path}`;

  const links = response.headers.filter((field) => field.name === 'link');
  if (links.length > 0) {
    refusals.push(
      fail(
        PREDICATES.LINK_HEADER,
        where,
        `the response carries ${links.length} Link field(s) — ${links.map((field) => JSON.stringify(field.value)).join(', ')} — each of which can start a fetch before the parser reads anything`,
      ),
    );
  }

  const hints = response.interim.filter((one) => one.status === 103);
  if (hints.length > 0) {
    refusals.push(
      fail(
        PREDICATES.EARLY_HINTS,
        where,
        `${hints.length} interim 103 response(s) arrived before the response, and every fetch they name is already in flight when it does`,
      ),
    );
  }

  return refusals;
}

/**
 * Every interim response an observation recorded, as one readable line.
 *
 * Used by reports rather than by judgements: an adapter that has been shown able
 * to see interim responses is worth being able to say so.
 *
 * @param {import('./observation.mjs').Observation} response
 * @returns {string}
 */
export function describeInterim(response) {
  if (response.interim.length === 0) {
    return 'none';
  }
  return response.interim
    .map((one) => `${one.status} {${one.headers.map((field) => `${field.name}: ${field.value}`).join('; ')}}`)
    .join(' | ');
}
