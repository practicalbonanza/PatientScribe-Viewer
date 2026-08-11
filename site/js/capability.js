/**
 * Can this browser do the work?
 *
 * The viewer's refusals are deliberately indistinguishable from one another, and
 * that is right for everything a recipient must not be able to tell apart. It is
 * wrong for one thing: a browser that cannot do this scheme at all refuses every
 * share it will ever be handed, and tells the recipient to ask the sender about
 * something no sender can fix. The two situations look identical from the
 * outside and they need different advice.
 *
 * So the viewer runs one share of its own first. The bytes below are a probe
 * produced by the interop generator — the same fixed, obviously synthetic
 * counting patterns everything else in that file is built from — and they are
 * sealed by a different implementation in a different language, which is what
 * makes them a check rather than this code agreeing with itself. A test compares
 * these constants against the generator's published probe, so a spelling that
 * drifted here is a failure rather than a check that quietly began asking a
 * question of its own devising.
 *
 * NOTHING HERE IS SECRET. The probe protects nothing, it came from no share, and
 * it carries no document: it is a fixed string sealed under a fixed key so that
 * a reader can find out whether it can unseal anything at all.
 *
 * What the probe establishes, exactly:
 *
 *   - The derivation, the unwrap and the decryption all run and agree with a
 *     producer that is not this code.
 *   - The additional authenticated data reaches the tag. The probe's is
 *     non-empty, so a reader that dropped it would fail here rather than on a
 *     recipient's own note.
 *   - The decoder refuses bytes that are not well-formed and keeps a leading
 *     byte-order mark. Those two are the difference between handing back the
 *     document that was sealed and handing back a repaired copy of it, and no
 *     amount of successful decryption shows either one.
 *
 * What it does not establish is anything about a recipient's share, and it never
 * touches one: it runs before any code is typed and reads nothing but the
 * constants below. A failure of this check is advice on the screen, not a block —
 * the code field stays usable, and a recipient who goes on either sees their note
 * or sees the single unavailable surface they would have seen in any case.
 *
 * Total, like everything else here: any failure at all, including one thrown
 * from inside the platform, comes back as `false`.
 */

import { decryptContent, deriveKek, unwrapContentKey } from './crypto.js';
import { decodeBase64url } from './parse.js';

/** The probe, as the interop generator published it. */
export const CAPABILITY_PROBE = Object.freeze({
  a: 'kZKTlJWWl5iZmpucnZ6foKGio6SlpqeoqaqrrK2ur7A',
  b: 's7S1tre4ubq7vL2-v8DBwsPExcbHyMnKy8zNzs_Q0dI',
  id: '8PHy8_T19vf4-fr7_P3-_w',
  wrapped_k: 'bm9wcXJzdHV2d3h58DP3nJqllmTuuz-f9QK9Mo-_qnVHFduURTehW3m6rAXrHj9YJNeZuktyGs0qjlNh',
  ciphertext: 'jI2Oj5CRkpOUlZaXdatS5fxCJ37RqstHEyBQIF7_HLMHLd2EwGb2CJ1Ymx_y3bYK7EGnXtZHyq3peBFYUE937fL6cLrKZoY',
  aad: 'patientscribe/capability_check_v1/aad',
  plaintext: 'patientscribe/capability_check_v1/plaintext',
});

/** A byte no well-formed sequence begins, and no sequence continues. */
const ILL_FORMED = [0xff];

/** The byte-order mark, followed by one ordinary character. */
const MARKED = [0xef, 0xbb, 0xbf, 0x41];

/**
 * What those four bytes decode to when nothing has been deleted from them.
 *
 * Written as an escape rather than as the character, because the character is
 * invisible and a source file is a place invisible characters go missing.
 */
const MARKED_TEXT = '\uFEFFA';

/**
 * Does this browser's decoder behave the way the document path needs it to?
 *
 * Two questions, and the pair is deliberate. A decoder that repairs ill-formed
 * bytes hands back a document nobody sealed, with replacement characters where
 * the bytes were. A decoder that deletes a leading byte-order mark hands back a
 * document one character shorter than the one that was sealed — and in the one
 * position where that turns something the protocol refuses into something that
 * renders.
 *
 * Asked of a decoder built here with the same options the document path uses,
 * rather than of that path's own decoder, because what is being asked is whether
 * this engine honours the options at all.
 *
 * @returns {boolean}
 */
function decoderIsStrict() {
  /** @type {TextDecoder} */
  let decoder;
  try {
    decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  } catch {
    return false;
  }

  try {
    decoder.decode(new Uint8Array(ILL_FORMED));
    // It answered, which means it repaired. A document that is not well-formed
    // must be a refusal.
    return false;
  } catch {
    // As required.
  }

  try {
    return decoder.decode(new Uint8Array(MARKED)) === MARKED_TEXT;
  } catch {
    return false;
  }
}

/**
 * Run the probe, and say whether this browser can be relied on.
 *
 * @returns {Promise<boolean>}
 */
export async function checkCapability() {
  try {
    const linkKey = decodeBase64url(CAPABILITY_PROBE.a);
    const serverKey = decodeBase64url(CAPABILITY_PROBE.b);
    const shareId = decodeBase64url(CAPABILITY_PROBE.id);

    const kek = await deriveKek(linkKey, serverKey, shareId);
    if (kek === null) {
      return false;
    }
    const contentKey = await unwrapContentKey(kek, CAPABILITY_PROBE.wrapped_k);
    if (contentKey === null) {
      return false;
    }
    const plaintext = await decryptContent(contentKey, CAPABILITY_PROBE.ciphertext, CAPABILITY_PROBE.aad);
    if (plaintext !== CAPABILITY_PROBE.plaintext) {
      return false;
    }

    return decoderIsStrict();
  } catch {
    // Nothing above is expected to throw — every step is one of this viewer's
    // own total functions, and each answers with a value. The guard is here
    // because this one runs before anything else does, and a rejection escaping
    // it would be a rejection nobody is waiting for.
    return false;
  }
}
