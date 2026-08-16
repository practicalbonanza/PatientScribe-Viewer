/**
 * The two mangles a drill uses, and nothing else.
 *
 * The ruled trust anchor requires the acceptance drill to cover both variants,
 * and they are not two shades of one thing. Variant one is an HONEST MANIFEST
 * over WRONG BYTES: the origin serves something the manifest does not describe,
 * which is the shape a tampered or half-finished deploy has. Variant two is a
 * WRONG MANIFEST over an HONEST ORIGIN: the expectation is the thing that is
 * off, which is the shape a mis-resolved release has. A check that caught only
 * the first would pass a release whose manifest nobody could reproduce, and one
 * that caught only the second would pass an origin nobody had looked at.
 *
 * Neither mangle is clever, and that is the point. The object-side one appends
 * one comment line to the entry point: the digest moves, and the release-comment
 * reading does not — the appended span carries `drill-mangle`, which is not the
 * release-comment grammar — so exactly one predicate is disturbed and the
 * drill's redness is attributable. The manifest-side one advances the last hex
 * character of the entry point's digest by one, which keeps it sixty-four
 * lowercase hex and makes it a digest of nothing.
 *
 * The doctored manifest is written into the run's record area and is never
 * uploaded anywhere. It is evidence, not a release.
 *
 * Usage:
 *   node scripts/infra/drill-core.mjs --mangle <index.html> <out> <release-id>
 *   node scripts/infra/drill-core.mjs --doctor-manifest <manifest.json> <out>
 *   node scripts/infra/drill-core.mjs --self-test
 *
 * Exit codes: 0 = written, 1 = refused, 2 = it could not run.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ENTRY_POINT, isDigest, releaseComments } from './frozen-spellings.mjs';

/** The line a drill appends to the entry point, and the whole of the object-side mangle. */
export const MANGLE_LINE = '<!-- drill-mangle -->';

/** The hex alphabet a digest is written in. Source: scripts/release-check-core/manifest.mjs. */
const HEX = '0123456789abcdef';

/**
 * @param {string} message
 * @returns {never}
 */
function cannotRun(message) {
  process.stderr.write(`drill-core — cannot run: ${message}\n`);
  process.exit(2);
}

/**
 * @param {string} message
 * @returns {never}
 */
function refuse(message) {
  process.stderr.write(`drill-core — refusing: ${message}\n`);
  process.exit(1);
}

/**
 * The entry point's bytes with one line appended.
 *
 * @param {string} document The built entry point, as text.
 * @returns {string}
 */
export function mangledDocument(document) {
  return `${document}${MANGLE_LINE}\n`;
}

/**
 * The last hex character of a digest, advanced by one.
 *
 * @param {string} digest
 * @returns {string}
 */
export function nextDigest(digest) {
  const last = digest.slice(-1);
  const at = HEX.indexOf(last);
  if (at < 0) {
    return digest;
  }
  return `${digest.slice(0, -1)}${HEX[(at + 1) % 16] ?? last}`;
}

/**
 * A manifest whose entry-point digest is one character out.
 *
 * The document is rewritten as text rather than reparsed and re-serialised: the
 * doctored copy has to differ from the honest one in exactly the way this
 * describes, and a round trip through a parser could differ in whitespace as
 * well and make the fixture about two things.
 *
 * @param {string} text
 * @returns {{ document: string, was: string, now: string } | { refusal: string }}
 */
export function doctoredManifest(text) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { refusal: `the manifest is not JSON: ${error instanceof Error ? error.message : 'unknown'}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { refusal: 'the manifest is not a JSON object' };
  }
  const objects = /** @type {Record<string, unknown>} */ (parsed)['objects'];
  if (objects === null || typeof objects !== 'object' || Array.isArray(objects)) {
    return { refusal: 'the manifest has no objects' };
  }
  const was = /** @type {Record<string, unknown>} */ (objects)[ENTRY_POINT];
  if (typeof was !== 'string' || !isDigest(was)) {
    return { refusal: `the manifest records ${JSON.stringify(was)} at ${ENTRY_POINT}, which is not a digest` };
  }
  const now = nextDigest(was);
  if (now === was) {
    return { refusal: 'the entry-point digest could not be advanced' };
  }
  if (!text.includes(was)) {
    return { refusal: 'the entry-point digest does not appear in the manifest text' };
  }
  return { document: text.replace(was, now), was, now };
}

/**
 * @param {readonly string[]} argv
 * @returns {number}
 */
function run(argv) {
  const mode = argv[0];

  if (mode === '--mangle') {
    const source = argv[1];
    const out = argv[2];
    const releaseId = argv[3];
    if (source === undefined || out === undefined || releaseId === undefined) {
      cannotRun('usage: --mangle <index.html> <out> <release-id>');
    }
    /** @type {string} */
    let document;
    try {
      document = readFileSync(source, 'utf8');
    } catch {
      return cannotRun(`cannot open ${source}`);
    }
    const mangled = mangledDocument(document);
    if (createHash('sha256').update(Buffer.from(mangled, 'utf8')).digest('hex') ===
        createHash('sha256').update(Buffer.from(document, 'utf8')).digest('hex')) {
      refuse('the mangle did not move the digest, and a mangle that changes nothing proves nothing');
    }
    const found = releaseComments(mangled);
    if (found.length !== 1 || found[0] !== releaseId) {
      refuse(
        `the mangled document names ${JSON.stringify(found)} and it must still name exactly ${releaseId} — this mangle disturbs the digest and nothing else`,
      );
    }
    writeFileSync(out, mangled);
    return 0;
  }

  if (mode === '--doctor-manifest') {
    const source = argv[1];
    const out = argv[2];
    if (source === undefined || out === undefined) {
      cannotRun('usage: --doctor-manifest <manifest.json> <out>');
    }
    /** @type {string} */
    let text;
    try {
      text = readFileSync(source, 'utf8');
    } catch {
      return cannotRun(`cannot open ${source}`);
    }
    const doctored = doctoredManifest(text);
    if ('refusal' in doctored) {
      refuse(doctored.refusal);
    }
    writeFileSync(out, doctored.document);
    process.stdout.write(`${doctored.was} -> ${doctored.now}`);
    return 0;
  }

  if (mode === '--self-test') {
    return selfTest();
  }

  return cannotRun('usage: --mangle | --doctor-manifest | --self-test');
}

/**
 * @returns {number}
 */
function selfTest() {
  let failures = 0;

  /**
   * @param {string} label
   * @param {boolean} held
   * @param {string} detail
   */
  const record = (label, held, detail) => {
    if (held) {
      process.stdout.write(`  ok   ${label}\n`);
      return;
    }
    failures += 1;
    process.stdout.write(`  FAIL ${label} — ${detail}\n`);
  };

  const releaseId = '20260813T091500Z-a1b2c3d4e5f6';
  const document = `<!doctype html>\n<html lang="en"></html>\n<!-- release: ${releaseId} -->\n`;
  const mangled = mangledDocument(document);

  record('the mangle moves the bytes', mangled !== document, 'it did not');
  record(
    'the mangle leaves the release identity alone',
    releaseComments(mangled).length === 1 && releaseComments(mangled)[0] === releaseId,
    JSON.stringify(releaseComments(mangled)),
  );
  record('the appended span is not a release comment', releaseComments(MANGLE_LINE).length === 0, 'it was read as one');
  record('the mangle appends exactly one line', mangled.slice(document.length) === `${MANGLE_LINE}\n`, JSON.stringify(mangled.slice(document.length)));

  record('a digest ending in a moves on', nextDigest(`${'0'.repeat(63)}a`).endsWith('b'), nextDigest(`${'0'.repeat(63)}a`));
  record('a digest ending in f wraps to 0', nextDigest(`${'0'.repeat(63)}f`).endsWith('0'), nextDigest(`${'0'.repeat(63)}f`));
  record('a digest ending in 9 moves to a', nextDigest(`${'0'.repeat(63)}9`).endsWith('a'), nextDigest(`${'0'.repeat(63)}9`));
  record('the doctored digest is still sixty-four lowercase hex', isDigest(nextDigest('f'.repeat(64))), 'it was not');

  const entryDigest = 'd'.repeat(64);
  const manifest = `${JSON.stringify(
    {
      schema: 'viewer-release-manifest/1',
      commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      release_id: releaseId,
      objects: { [ENTRY_POINT]: entryDigest, '/js/config.js': 'e'.repeat(64) },
    },
    null,
    2,
  )}\n`;
  const doctored = doctoredManifest(manifest);
  record('an honest manifest can be doctored', !('refusal' in doctored), 'refusal' in doctored ? doctored.refusal : '');
  if (!('refusal' in doctored)) {
    record('exactly the entry-point digest moved', doctored.was === entryDigest && doctored.now !== entryDigest, `${doctored.was} -> ${doctored.now}`);
    record('the doctored digest is well formed', isDigest(doctored.now), doctored.now);
    record(
      'nothing else in the document moved',
      doctored.document.replace(doctored.now, doctored.was) === manifest,
      'more than one thing changed',
    );
  }

  const noEntry = doctoredManifest('{"objects":{}}');
  record('a manifest with no entry point cannot be doctored', 'refusal' in noEntry, 'it was doctored');

  // The command-line surface, through real files.
  const dir = mkdtempSync(join(tmpdir(), 'viewer-drill-core-'));
  const source = join(dir, 'index.html');
  const out = join(dir, 'mangled.html');
  writeFileSync(source, document);
  writeFileSync(out, mangledDocument(readFileSync(source, 'utf8')));
  record('a mangled document is written to disk', readFileSync(out, 'utf8') === mangled, 'it was not');

  if (failures === 0) {
    process.stdout.write('drill-core self-test — PASS\n');
    return 0;
  }
  process.stdout.write(`drill-core self-test — FAIL (${failures} case(s))\n`);
  return 1;
}

process.exit(run(process.argv.slice(2)));
