/**
 * Commit-message attribution check — the rules.
 *
 * Holds the patterns and the reading. No CLI, no argument parsing, no exit
 * codes, no output: this module is importable from a test without checking
 * anything, which it has to be, because the test that holds these rules would
 * otherwise be asking the thing under test what it thinks.
 *
 * What this is for. This repository's history is public from its first commit,
 * and a commit message cannot be taken back — a rewritten history does not reach
 * anyone who already cloned. So the rule that this project's history carries a
 * description of the change and nothing about how the change came to be written
 * is a rule that has to hold at the moment a message is written, not afterwards.
 * The history is clean today; this is what keeps it that way.
 *
 * The reading is a case-insensitive match over the text of a message and, for a
 * scan of the history, over the names and addresses recorded with it. It does
 * not parse trailers and does not try to, and it does not decide which line of a
 * record it is looking at either: an author's name, an address, a trailer and a
 * sentence of the message are all text, and a name that must not be in the
 * history must not be in any of them.
 *
 * The limits are the limits of any lexical scan and are worth stating rather
 * than assuming away. A name written with an unusual spelling, spelled across
 * two lines, or left out entirely is not caught by any of this. That is
 * acceptable for what this is — a guard against habit and default behaviour,
 * where the thing being guarded against is a trailer something adds without
 * being asked — and it is not a control against an author who is deliberately
 * working around it. There is no suppression mechanism and no allowlist, for the
 * reason the forbidden-sink scan has none: a check that can be switched off one
 * line at a time stops being a check the first time somebody is in a hurry.
 */

/**
 * One rule: what it is called, what it matches, and what it is for.
 *
 * @typedef {object} Rule
 * @property {string} name
 * @property {RegExp} pattern
 * @property {string} why What a reader who has just been refused needs to know.
 */

/**
 * The rules, each aimed at one spelling.
 *
 * Four rather than one alternation, so a message that is refused says which rule
 * refused it, and so each of them can be put to a message of its own in the
 * self-test rather than all four resting on whichever fixture happens to match
 * first.
 *
 * The first rule used to require the trailer as well as the name, and that was
 * the wrong half to anchor on. A trailer is one place a name appears and the
 * scan is handed several others — a commit's author name and address, and its
 * committer's — so a commit whose author was literally called `ChatGPT` broke no
 * rule at all while a trailer saying the same thing broke one. The two other
 * rules that match a name — the assistant's and the vendor's, which are the last
 * two of the four — were already written that way, matching their name wherever
 * it appears, and this one is now written to match theirs. A trailer naming a
 * tool still breaks it, because a trailer is text.
 *
 * The names those three name-matching rules cover are disjoint on purpose: the
 * assistant and the vendor have a rule each, and the rest are here, so a refusal
 * names one rule and the self-test can require exactly that. The fourth rule is
 * not a name at all — it matches the phrase a generated credit is written with.
 *
 * @type {readonly Rule[]}
 */
export const RULES = Object.freeze([
  Object.freeze({
    name: 'tool-name',
    pattern: /\b(?:copilot|chatgpt|openai|gpt-\d|gemini|codex|cursor|devin)\b/i,
    why: 'the name of a tool or of its vendor, wherever it appears — in the message, or in a name or address recorded with the commit',
  }),
  Object.freeze({
    name: 'generated-credit',
    pattern: /generated (?:with|by)/i,
    why: 'a line crediting the change or the message to whatever produced it',
  }),
  Object.freeze({
    name: 'assistant-name',
    pattern: /\bclaude\b/i,
    why: 'the name of an assistant, which this history does not record',
  }),
  Object.freeze({
    name: 'vendor-name',
    pattern: /\banthropic\b/i,
    why: 'the name of a vendor, which this history does not record',
  }),
]);

/**
 * Which rules this text breaks.
 *
 * Total and incurious: anything that is not a string is text with nothing in it,
 * because a caller that could not read a message is a caller whose answer should
 * be decided by the caller rather than by an exception thrown from here.
 *
 * @param {unknown} text
 * @returns {Rule[]} Empty means the text is clean.
 */
export function brokenRules(text) {
  if (typeof text !== 'string') {
    return [];
  }
  return RULES.filter((rule) => rule.pattern.test(text));
}
