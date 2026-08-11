/**
 * Formatting.
 *
 * Two pure functions, no DOM, no network, no state. Both are total: anything at
 * all may be handed to either of them, and what comes back is a string rather
 * than an exception.
 *
 * The date formatter writes its own month and weekday names out of tables in
 * this file rather than asking the platform. That looks like the wrong choice
 * and is the right one here. A platform formatter's output depends on the
 * internationalisation data the engine was built with, so the same expiry reads
 * differently in two browsers, and a pinned expectation is then a claim about
 * one engine's build rather than about this viewer. The names below are English
 * abbreviations, fixed, and the same everywhere.
 *
 * What is not fixed is the timezone, deliberately. An expiry is a moment, and
 * the moment is shown in the timezone of the device reading it — which is the
 * one reading a recipient can act on. The tables decide the spelling; the device
 * decides the offset.
 */

/** Abbreviated English weekday names, indexed as the platform indexes days. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Abbreviated English month names, indexed as the platform indexes months. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Base64url alphabet, in value order. Unpadded: padding is never written. */
const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * The byte count of a typed array, read from the internal slot.
 *
 * `.length` is an accessor on the prototype and can be shadowed, so a value can
 * claim a count that is not the count of bytes it holds. `crypto.js` reads the
 * slot for the same reason and says why at greater length; the reason it matters
 * here is narrower but real — an encoder that trusted a claimed length would
 * write an identifier that is not the identifier it was handed, and the
 * identifier is what one end of this protocol compares against the other.
 */
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength',
)?.get;

/**
 * Twelve-hour clock: midnight and noon are both twelve.
 *
 * @param {number} hours The hour on a twenty-four hour clock.
 * @returns {number}
 */
function twelveHour(hours) {
  const remainder = hours % 12;
  return remainder === 0 ? 12 : remainder;
}

/**
 * An expiry, as a recipient reads it: `Tue 15 Jul, 6:12 pm`.
 *
 * Abbreviated weekday, day of the month with no leading zero, abbreviated
 * month, comma, then a twelve-hour time with no leading zero on the hour, two
 * digits of minutes, and `am` or `pm`. In the timezone of the device.
 *
 * Anything that is not a whole number of seconds, and anything the platform
 * cannot make a date of, comes back as the empty string. A caller that writes
 * the empty string writes a lead with nothing after it, which is a line that
 * says less rather than a line that says something wrong — and nothing reaches
 * this function that a validator has not already required to be a positive safe
 * integer.
 *
 * @param {unknown} epochSeconds Seconds since the epoch.
 * @returns {string} The formatted moment, or the empty string.
 */
export function formatDateTime(epochSeconds) {
  if (typeof epochSeconds !== 'number' || !Number.isSafeInteger(epochSeconds)) {
    return '';
  }

  const when = new Date(epochSeconds * 1000);
  const weekday = WEEKDAYS[when.getDay()];
  const month = MONTHS[when.getMonth()];
  // Both lookups answer `undefined` for a date the platform could not build,
  // because every field of such a date is not a number and no index of either
  // table is. That is the one test needed for it: a caller cannot be handed a
  // day called `undefined`.
  if (weekday === undefined || month === undefined) {
    return '';
  }

  const hours = when.getHours();
  const minutes = when.getMinutes();
  const padded = minutes < 10 ? `0${minutes}` : `${minutes}`;
  const half = hours < 12 ? 'am' : 'pm';

  return `${weekday} ${when.getDate()} ${month}, ${twelveHour(hours)}:${padded} ${half}`;
}

/**
 * Bytes as canonical unpadded base64url.
 *
 * The inverse of the decoder in `parse.js`, and the reason it exists is the one
 * comparison that needs an identifier in its encoded spelling: the fragment
 * carries the identifier as bytes, the authenticated data carries it as text,
 * and one of the two has to be brought to the other. Bringing the bytes to the
 * text is the direction that does not decode anything an attacker chose.
 *
 * Canonical in the sense the decoder requires: the alphabet with `-` and `_`, no
 * padding, and the unused low bits of the final character written as zero. So a
 * round trip through the decoder is the identity in both directions, which is
 * what makes the comparison a comparison of bytes rather than of spellings.
 *
 * Total: anything that is not a byte array in this realm comes back as the empty
 * string, which is a value no identifier encodes to and so a value that matches
 * nothing.
 *
 * @param {unknown} bytes
 * @returns {string} The encoding, or the empty string.
 */
export function encodeBase64url(bytes) {
  if (TYPED_ARRAY_BYTE_LENGTH === undefined) {
    return '';
  }

  /** @type {number} */
  let count;
  try {
    if (!(bytes instanceof Uint8Array)) {
      return '';
    }
    count = TYPED_ARRAY_BYTE_LENGTH.call(bytes);
  } catch {
    // A revoked proxy throws when its prototype is read, and a total function
    // may not be the thing that turns a hostile value into an exception.
    return '';
  }

  const source = /** @type {Uint8Array} */ (bytes);
  let out = '';
  let accumulator = 0;
  let bits = 0;

  for (let index = 0; index < count; index += 1) {
    accumulator = (accumulator << 8) | (source[index] ?? 0);
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += B64URL_ALPHABET[(accumulator >> bits) & 0x3f] ?? '';
    }
  }
  if (bits > 0) {
    // The leftover bits, padded with zeros on the right. Writing them any other
    // way would produce a string the strict decoder refuses.
    out += B64URL_ALPHABET[(accumulator << (6 - bits)) & 0x3f] ?? '';
  }

  return out;
}
