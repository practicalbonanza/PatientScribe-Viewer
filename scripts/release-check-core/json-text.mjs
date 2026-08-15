/**
 * Reading a JSON document as the text it is.
 *
 * `JSON.parse` answers what a value is and says nothing about how it was
 * written, and for one question that difference is the whole question. A
 * document whose `objects` map names the same path twice parses without
 * complaint into a map with one entry: the second wins, the first is gone, and
 * nothing anywhere records that a choice was made. A release manifest is a
 * statement about which bytes are at which path, so a path stated twice is two
 * statements and at most one of them is being checked — which is not a manifest
 * that can be compared against an origin, it is a manifest with a hole in it
 * whose shape depends on the parser.
 *
 * So duplicates are detected in the text, before and independently of the parse.
 * This is a scanner rather than a parser: it walks the document, tracks where
 * objects begin and end, and records the member names each one carried. It does
 * not build values, and the only thing it returns is which names were stated
 * more than once and where.
 *
 * Written out rather than reached for, because there is nothing to reach for
 * that answers this — a parser that reported duplicates would be a different
 * parser from the one whose answer the rest of the check uses, and two readings
 * of one document are a thing to be avoided rather than a belt and braces. This
 * runs first, refuses the document if it disagrees with itself, and only then is
 * `JSON.parse` allowed to say what it means.
 *
 * The scanner is strict about the grammar it walks and total about the rest: an
 * input it cannot read comes back as a syntax complaint rather than an
 * exception, because a manifest that is not JSON at all must be refused by the
 * same path that refuses a manifest that is.
 */

/**
 * What a scan found.
 *
 * @typedef {object} TextScan
 * @property {string[]} duplicates One entry per member name stated more than
 *   once, as `<path-to-the-object>.<name>`.
 * @property {string | null} syntax A complaint about the document's syntax, or
 *   `null` where it has none.
 */

/**
 * Scan a JSON document for member names stated more than once.
 *
 * @param {string} text
 * @returns {TextScan}
 */
export function scanForDuplicateKeys(text) {
  /** @type {string[]} */
  const duplicates = [];
  let at = 0;

  /** @returns {string | null} */
  const skipWhitespace = () => {
    while (at < text.length) {
      const ch = text[at];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        at += 1;
        continue;
      }
      return ch ?? null;
    }
    return null;
  };

  /**
   * A JSON string, from the opening quote, returned without its quotes and with
   * its escapes resolved far enough to compare names by.
   *
   * @returns {string}
   */
  const readString = () => {
    if (text[at] !== '"') {
      throw new SyntaxError(`expected a string at ${at}`);
    }
    at += 1;
    let out = '';
    while (at < text.length) {
      const ch = text[at];
      if (ch === undefined) {
        break;
      }
      if (ch === '"') {
        at += 1;
        return out;
      }
      if (ch === '\\') {
        const escape = text[at + 1];
        at += 2;
        switch (escape) {
          case '"':
            out += '"';
            break;
          case '\\':
            out += '\\';
            break;
          case '/':
            out += '/';
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case 'n':
            out += '\n';
            break;
          case 'r':
            out += '\r';
            break;
          case 't':
            out += '\t';
            break;
          case 'u': {
            const code = text.slice(at, at + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(code)) {
              throw new SyntaxError(`a \\u escape at ${at} is not four hex digits`);
            }
            out += String.fromCharCode(Number.parseInt(code, 16));
            at += 4;
            break;
          }
          default:
            throw new SyntaxError(`an unknown escape at ${at - 1}`);
        }
        continue;
      }
      out += ch;
      at += 1;
    }
    throw new SyntaxError('a string was never closed');
  };

  /** @param {string} where */
  const readValue = (where) => {
    const ch = skipWhitespace();
    if (ch === null) {
      throw new SyntaxError('the document ended where a value was expected');
    }
    if (ch === '{') {
      at += 1;
      /** @type {Set<string>} */
      const seen = new Set();
      if (skipWhitespace() === '}') {
        at += 1;
        return;
      }
      for (;;) {
        if (skipWhitespace() !== '"') {
          throw new SyntaxError(`expected a member name at ${at}`);
        }
        const name = readString();
        if (seen.has(name)) {
          duplicates.push(`${where}.${name}`);
        }
        seen.add(name);
        if (skipWhitespace() !== ':') {
          throw new SyntaxError(`expected a colon at ${at}`);
        }
        at += 1;
        readValue(`${where}.${name}`);
        const next = skipWhitespace();
        if (next === ',') {
          at += 1;
          continue;
        }
        if (next === '}') {
          at += 1;
          return;
        }
        throw new SyntaxError(`expected a comma or a close at ${at}`);
      }
    }
    if (ch === '[') {
      at += 1;
      if (skipWhitespace() === ']') {
        at += 1;
        return;
      }
      let index = 0;
      for (;;) {
        readValue(`${where}[${index}]`);
        index += 1;
        const next = skipWhitespace();
        if (next === ',') {
          at += 1;
          continue;
        }
        if (next === ']') {
          at += 1;
          return;
        }
        throw new SyntaxError(`expected a comma or a close at ${at}`);
      }
    }
    if (ch === '"') {
      readString();
      return;
    }
    const literal = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(at));
    if (literal === null) {
      throw new SyntaxError(`expected a value at ${at}`);
    }
    at += literal[0].length;
  };

  try {
    readValue('');
    if (skipWhitespace() !== null) {
      throw new SyntaxError(`the document carries more than one value, from ${at}`);
    }
  } catch (error) {
    return { duplicates, syntax: error instanceof Error ? error.message : 'the document could not be scanned' };
  }

  return { duplicates, syntax: null };
}
