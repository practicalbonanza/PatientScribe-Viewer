/**
 * Bind the release target's origin table to the deployed share stack.
 *
 * Usage:
 *   node scripts/infra/check-share-api-binding.mjs <config.js> <origin> <endpoint>
 *   node scripts/infra/check-share-api-binding.mjs --table-answer <config.js> <origin>
 *
 * Exit codes: 0 = the two agree, 1 = they do not, 2 = it could not run. The
 * query mode never exits 1 — see the note on it below.
 *
 * WHAT THIS IS FOR. The committed origin table decides where a recipient's
 * access code travels. Nothing bound that decision to the API that actually
 * serves shares, and the consequence has already been measured: a viewer shipped
 * naming a different API of the same account entirely, through every gate green,
 * because every gate compared the table against a transcription of itself. This
 * compares it against the deployed truth instead — the share stack's own
 * `ShareApiEndpoint` output — and a disagreement is a refusal in the release
 * preflight, before a single object is uploaded.
 *
 * WHICH TABLE. The one the switch will SERVE: the `config.js` of the checkout
 * the driver is running from, which the preflight has already digest-bound to
 * the target manifest. Not the public tip's, and the difference is the whole
 * point of the choice — a switch to a release whose table disagrees with the
 * deployed share stack is exactly the switch this must refuse, and refusing it
 * here costs nothing, while a table read from anywhere else would let those
 * bytes be uploaded and die at the wire verdict afterwards.
 *
 * ASKED, NOT PARSED. The module is imported and its one exported function is
 * asked what it answers for the origin under test. A reading of the text would
 * be a claim about the module; this is the module. It is pure — one frozen table
 * and one total function, nothing that reaches a socket or the disk — which is
 * why importing it is a measurement rather than an act, and it is why the
 * release check imports the same file for the same reason.
 *
 * ORIGINS, COMPARED AS ORIGINS. The stack output carries the API's stage on the
 * end of it (`.../prod`); the table holds origins and nothing else, because the
 * stage rides the request path in `flow.js`. So the output is reduced to its
 * scheme and host before the comparison, and the comparison is of two origins.
 * A default port written out explicitly is normalised away by that reduction,
 * which is the behaviour wanted: `https://host:443` and `https://host` are one
 * origin and a refusal between them would be a refusal about spelling.
 */

import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const TOOL = 'check-share-api-binding';

/**
 * @param {string} message
 * @returns {never}
 */
function cannotRun(message) {
  process.stderr.write(`${TOOL} — cannot run: ${message}\n`);
  process.exit(2);
}

/**
 * @param {string} message
 * @returns {never}
 */
function refuse(message) {
  process.stderr.write(`${TOOL} — refusing: ${message}\n`);
  process.exit(1);
}

/**
 * The origin of a URL — its scheme and host, and nothing after them.
 *
 * `null` for anything that is not an absolute URL of a scheme a browser will
 * make this request over. A stack that answers with something else has not
 * answered with an endpoint, and guessing at what it meant is how a comparison
 * against nothing quietly succeeds.
 *
 * @param {string} url
 * @returns {string | null}
 */
function originOf(url) {
  /** @type {URL} */
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }
  return parsed.origin;
}

/** The mode that answers the table-side half of the comparison and stops there. */
const ASK_MODE = '--table-answer';

/** What the query mode prints where the table answers nothing at all. */
const ANSWERS_NOTHING = 'nothing';

/** What a message says in place of an answer, where the table could not be asked. */
const COULD_NOT_ASK = 'an answer this could not read out of the table';

const USAGE = `usage: check-share-api-binding.mjs [${ASK_MODE}] <config.js> <origin> [<endpoint>]`;

/**
 * The committed table, or the reason there is not one. NEVER exits.
 *
 * One import path, because there is one table and reading it twice two ways is
 * how the two readings come to disagree. What differs between the callers below
 * is not how the table is read, it is what a failure to read it MEANS to each of
 * them — and that is a decision each caller makes, on top of this.
 *
 * @param {string} file
 * @returns {Promise<{ table: { apiOriginFor: (origin: unknown) => string | null } } | { why: string }>}
 */
async function readTableIn(file) {
  /** @type {{ apiOriginFor: (origin: unknown) => string | null }} */
  let module;
  try {
    module = /** @type {{ apiOriginFor: (origin: unknown) => string | null }} */ (
      await import(pathToFileURL(resolve(file)).href)
    );
  } catch (error) {
    return { why: `${file} could not be imported: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof module.apiOriginFor !== 'function') {
    return { why: `${file} exports no apiOriginFor, so what the table answers cannot be asked of it` };
  }
  return { table: module };
}

/**
 * The table, for a caller that cannot proceed without one.
 *
 * A table this cannot read is a comparison this cannot make, which is a run that
 * could not happen rather than a verdict it reached: exit 2.
 *
 * @param {string} file
 * @returns {Promise<{ apiOriginFor: (origin: unknown) => string | null }>}
 */
async function tableIn(file) {
  const read = await readTableIn(file);
  if ('why' in read) {
    cannotRun(read.why);
  }
  return read.table;
}

/**
 * What the table answers, as a phrase a REFUSAL can carry. NEVER exits.
 *
 * The other discipline, and the one the refusals need. A refusal that is already
 * happening for its own reason must not be turned into an exit 2 by a table this
 * could not read, and must not be silenced by one either — so this always hands
 * back something a message can say, and the caller refuses regardless. It is the
 * same defensive read the shell caller makes around the query mode, made here
 * for the refusals this file issues itself.
 *
 * @param {string} file
 * @param {string} origin
 * @returns {Promise<string>}
 */
async function answerPhraseIn(file, origin) {
  const read = await readTableIn(file);
  if ('why' in read) {
    return COULD_NOT_ASK;
  }
  const answer = read.table.apiOriginFor(origin);
  return answer === null ? ANSWERS_NOTHING : answer;
}

const asking = process.argv[2] === ASK_MODE;
const args = asking ? process.argv.slice(3) : process.argv.slice(2);
const configFile = args[0];
const originUnderTest = args[1];

if (configFile === undefined || originUnderTest === undefined) {
  cannotRun(USAGE);
}

// THE QUERY MODE, and what it is for. Every refusal the release preflight makes
// about this binding has to name BOTH values — what the table answers and what
// the deployed stack serves — and two of those refusals happen when the stack
// side is exactly what could not be had: an unreadable stack, or a stack with no
// endpoint output. The table side is readable in all of them, so the caller asks
// for it here and puts it in the message. Asked rather than transcribed, for the
// same reason the comparison below is: a second spelling of this value is the
// first thing nothing keeps in step.
//
// Exit codes are the caller's contract and they are the whole discipline of it.
// This answers 0 with the value, or 2 having said why it could not. It never
// exits 1, because a query is not a verdict — and a caller that treats a failed
// query as an answer would be turning a refusal into a wrong-reason success.
if (asking) {
  const asked = await tableIn(configFile);
  const answer = asked.apiOriginFor(originUnderTest);
  process.stdout.write(answer === null ? ANSWERS_NOTHING : answer);
  process.exit(0);
}

const endpoint = args[2];
if (endpoint === undefined) {
  cannotRun(USAGE);
}

const deployed = originOf(endpoint);
if (deployed === null) {
  // BOTH VALUES here too, and this is the direction where saying so costs the
  // most care. The stack side is present and unusable, so the deployed half of
  // the message is the endpoint as it was spelled; the table half is readable as
  // it always is, and a refusal that named only the unusable half would leave
  // the operator to go and look up the one on the disk in front of them.
  //
  // Read defensively, because this refusal is already decided. A table that
  // cannot be asked must not turn it into an exit 2 and must not silence it —
  // the phrase says so and the refusal fires.
  const phrase = await answerPhraseIn(configFile, originUnderTest);
  refuse(
    `the share stack states its endpoint as ${JSON.stringify(endpoint)}, which is not an http or https URL, and the origin table this run would serve answers ${phrase} for ${originUnderTest} — there is no origin in that endpoint to bind that answer to`,
  );
}

const table = await tableIn(configFile);
const answered = table.apiOriginFor(originUnderTest);

if (answered === null) {
  refuse(
    `the origin table answers nothing for ${originUnderTest}, and the share stack serves ${deployed} — a table that does not name the origin under test is a decision nobody has made rather than a gap to route around`,
  );
}

if (answered !== deployed) {
  refuse(
    `the origin table sends a page served from ${originUnderTest} to ${answered}, and the deployed share stack serves ${deployed} — switching to this release would ship a viewer whose share codes travel somewhere the share API is not`,
  );
}

process.stdout.write(`${TOOL} — ${originUnderTest} is answered ${answered}, which is the deployed share API origin\n`);
