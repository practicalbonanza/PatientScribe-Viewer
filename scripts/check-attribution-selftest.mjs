/**
 * Self-test for the attribution check.
 *
 * The check has two callers and neither of them can hold it. The hook runs at
 * commit time, where a failure is a commit that did not happen rather than
 * something a suite reports; the workflow runs it in a job whose own definition
 * is one of the things that could quietly stop naming it. So it is spawned here
 * as a real child process, pointed at messages with known answers, and judged on
 * the exit code it hands back — which is the only thing either caller reads.
 *
 * The claims tested here, and why each one exists:
 *
 *   - Each rule refuses a message that breaks only that rule. All four resting
 *     on one fixture would be four rules with one of them tested, because the
 *     spelling most likely to be written is the spelling every rule matches.
 *   - A clean message is accepted, and so is a co-author trailer naming a
 *     person. Without both, a check that refused everything would satisfy every
 *     other case here, and the rule that reads trailers would be a rule against
 *     trailers.
 *   - The set of rules is what it is pinned to be. Every rule is silent on a
 *     message that does not break it, so a rule deleted outright is invisible in
 *     a suite of messages that were going to pass anyway.
 *   - The history this repository has now is accepted. That is the state this
 *     whole thing exists to keep, and a check nobody has seen accept the real
 *     subject is a check that might be refusing it.
 *   - An empty history is refused rather than reported as clean. Reading nothing
 *     must not be a pass.
 *   - A history with commits in it is read, and read whole. Both of the subjects
 *     above are histories in which nothing is found — one clean, one empty — so
 *     replacing the text of every record with nothing satisfied both, and the
 *     scan became a loop that counted records and looked at none of them. A
 *     repository is built with an attribution in each field of the record in
 *     turn, and each must be found.
 *   - The workflow's step is not written to be skipped or forgiven.
 *   - The hook is on disk, is executable, and runs this program. A hook that is
 *     any of those things and not the others is a file that does nothing.
 *   - The workflow names this program and checks out enough history for it to
 *     mean anything. A scan of every branch is a scan of one commit if the
 *     checkout was shallow, and it exits 0 while it does.
 *   - The one-line setup is written down where somebody would look for it,
 *     because a hook nobody wires up is not wired up.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RULES } from './check-attribution-core.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CHECKER = fileURLToPath(new URL('./check-attribution.mjs', import.meta.url));
const HOOK = fileURLToPath(new URL('../.githooks/commit-msg', import.meta.url));
const WORKFLOW = fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url));
const CONTRIBUTING = fileURLToPath(new URL('../CONTRIBUTING.md', import.meta.url));

/** The one line that wires the hook up, written here as well as where it is documented. */
const SETUP_LINE = 'git config core.hooksPath .githooks';

/** How the workflow and the hook both reach the check. */
const INVOCATION = 'scripts/check-attribution.mjs';

/**
 * How the workflow reaches the gate, twice over.
 *
 * `CHAIN_INVOCATION` is the chain by name, and it is the one every check in this
 * repository is otherwise reached through. `PATH_INVOCATION` is a runner named by
 * its path, which is the same self suite arriving by a route that does not read
 * `package.json`'s script names to find it.
 *
 * Both are written out here rather than derived from the workflow, for the reason
 * everything else in this file is: a value taken from the thing under test agrees
 * with it whatever it says.
 */
const CHAIN_INVOCATION = 'npm run check';

/** @see CHAIN_INVOCATION */
const PATH_INVOCATION = 'node scripts/run-node-tests.mjs self';

/**
 * Run the checker as a child process, the way both of its callers do.
 *
 * @param {string[]} args
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runChecker(args) {
  const environment = { ...process.env };
  // This file is run by the fast-path runner, which marks its children so a
  // nested test run executes nothing. The child here is not a test run and the
  // mark means nothing to it; removed anyway, so what it inherits is the
  // environment either of its real callers would give it.
  delete environment['NODE_TEST_CONTEXT'];

  const result = spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8', env: environment });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * Write a message to a file of its own and hand it to the checker.
 *
 * @param {string} text
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function checkMessage(text) {
  const directory = mkdtempSync(join(tmpdir(), 'attribution-selftest-'));
  try {
    const file = join(directory, 'COMMIT_EDITMSG');
    writeFileSync(file, text, 'utf8');
    return runChecker(['--message', file]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('the rules are the rules this check is pinned to have', () => {
  // Written out rather than counted. Every rule here is silent on a message that
  // does not break it, so on a suite of messages that were going to pass anyway
  // a deleted rule and a kept one look exactly alike — and the messages below
  // are named after these, so a rule that disappeared would take its own case
  // with it if the list were read off the thing under test.
  assert.deepEqual(
    RULES.map((rule) => rule.name),
    ['tool-name', 'generated-credit', 'assistant-name', 'vendor-name'],
  );
  for (const rule of RULES) {
    assert.ok(rule.why.length > 0, `${rule.name} says nothing about why it refused`);
  }
});

test('each rule refuses a message that breaks only that rule, in each spelling it has', () => {
  // One message per spelling, each chosen so that no other rule matches it. The
  // spelling that arrives by default breaks three rules at once, and a suite
  // built on that spelling would be one rule tested and three assumed.
  //
  // More messages than rules, because a rule is not one spelling. A tool can be
  // named in a trailer, in a sentence, or in an address, and the first of those
  // was for a while the only one the rule matched — so a commit whose author was
  // called `ChatGPT` broke nothing. And a line crediting the change is written
  // both ways round.
  /** @type {[string, string, string][]} */
  const messages = [
    ['tool-name', 'a co-author trailer naming a tool', 'Add a thing\n\nCo-Authored-By: Copilot <bot@example.invalid>\n'],
    ['tool-name', 'a tool named in no trailer at all', 'Add a thing\n\nChatGPT wrote the awkward part of this.\n'],
    [
      'tool-name',
      'an address at the domain of one',
      'Add a thing\n\nCo-Authored-By: A Person <someone@openai.com>\n',
    ],
    // And every other name the rule alternates over. A rule whose pattern is a
    // list of names is the most fragile shape in this file — any one of them can
    // be dropped with the other seven still firing and every assertion below
    // still passing — and three of the eight were exercised while five were
    // written down and never asked. Each is spelled the way it would actually
    // arrive, and each has to be refused on its own.
    ['tool-name', 'a versioned model name', 'Add a thing\n\nDrafted with GPT-5.\n'],
    ['tool-name', 'another vendor assistant', 'Add a thing\n\nGemini suggested this shape.\n'],
    ['tool-name', 'a coding agent', 'Add a thing\n\nCodex made the edit.\n'],
    ['tool-name', 'an editor that writes commits', 'Add a thing\n\nWritten in Cursor.\n'],
    ['tool-name', 'an agent named in a trailer', 'Add a thing\n\nCo-Authored-By: Devin <bot@example.invalid>\n'],
    ['generated-credit', 'a line crediting what produced it', 'Add a thing\n\nGenerated with a tool.\n'],
    ['generated-credit', 'the same line the other way round', 'Add a thing\n\nGenerated by a tool.\n'],
    ['assistant-name', 'the name of an assistant', 'Add a thing, as Claude suggested\n'],
    ['vendor-name', 'the name of a vendor', 'Add a thing\n\nSee the Anthropic documentation.\n'],
  ];

  // Every rule has at least one message, and every message names a rule that is
  // still there. Read in the order the rules are declared, so a rule added
  // without a message of its own, or a message left behind by a rule that is
  // gone, is a mismatch rather than a count that happens to work out.
  assert.deepEqual(
    [...new Set(messages.map(([name]) => name))],
    RULES.map((rule) => rule.name),
    'a rule has no message of its own, or a message names a rule that is gone',
  );

  for (const [name, what, text] of messages) {
    const result = checkMessage(text);
    assert.equal(result.status, 1, `${what} was accepted:\n${result.stdout}`);
    assert.ok(result.stderr.includes(`(${name})`), `${name} was not the rule that refused ${what}:\n${result.stderr}`);

    // And only that rule, so each of these messages is holding one thing.
    const named = RULES.filter((rule) => result.stderr.includes(`(${rule.name})`)).map((rule) => rule.name);
    assert.deepEqual(named, [name], `the message for ${what} breaks more than the rule it is for`);
  }
});

test('a message with nothing to report is accepted', () => {
  // Both directions. A check that refused everything would satisfy every case
  // above while having stopped saying anything, and the trailer rule in
  // particular has to be a rule about what a trailer names rather than a rule
  // against trailers.
  for (const text of [
    'Add the thing this commit adds\n',
    'Add the thing this commit adds\n\nCo-Authored-By: A Person <person@example.invalid>\n',
    // The instructions an editor session opens with are stripped before a
    // message becomes a commit, so they are not part of what is read.
    'Add the thing\n\n# Please enter the commit message for your changes.\n',
  ]) {
    const result = checkMessage(text);
    assert.equal(result.status, 0, `a clean message was refused:\n${result.stderr}`);
    assert.ok(result.stdout.includes('nothing to report'));
  }
});

test('a message that cannot be read, and a command line that is not one, are refused', () => {
  const missing = runChecker(['--message', join(tmpdir(), 'attribution-selftest-not-a-file')]);
  assert.equal(missing.status, 1, 'a message file that is not there was reported as clean');
  assert.ok(missing.stderr.includes('could not be read'));

  for (const args of [['--message'], ['--message', ''], ['--history'], ['--in'], ['--in', ''], ['--message', 'a', 'b']]) {
    const result = runChecker(args);
    assert.equal(result.status, 1, `the checker accepted ${JSON.stringify(args)}`);
    assert.ok(result.stderr.includes('usage'), `the checker gave a different reason for ${JSON.stringify(args)}`);
  }
});

/**
 * A repository built to order, and the scan of it.
 *
 * Identities come from the environment rather than from configuration, so the
 * author and the committer of a commit can be different people and neither is
 * whatever the machine running this happens to be set up as. Signing is turned
 * off and hooks are skipped, because a commit that cannot be made is a test that
 * says nothing about the scan.
 *
 * @param {{ message: string, authorName?: string, authorEmail?: string, committerName?: string, committerEmail?: string }[]} commits
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function historyOf(commits) {
  const directory = mkdtempSync(join(tmpdir(), 'attribution-selftest-history-'));
  try {
    const made = spawnSync('git', ['init', '--quiet', directory], { encoding: 'utf8' });
    assert.equal(made.status, 0, 'a repository could not be made to test against');

    for (const commit of commits) {
      const written = spawnSync(
        'git',
        ['-C', directory, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '--no-verify', '-m', commit.message],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: commit.authorName ?? 'A Person',
            GIT_AUTHOR_EMAIL: commit.authorEmail ?? 'person@example.invalid',
            GIT_COMMITTER_NAME: commit.committerName ?? 'A Person',
            GIT_COMMITTER_EMAIL: commit.committerEmail ?? 'person@example.invalid',
          },
        },
      );
      assert.equal(written.status, 0, `a commit could not be made to test against:\n${written.stderr ?? ''}`);
    }

    return runChecker(['--in', directory]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * How many commits a scan reported on.
 *
 * Each reported line begins with the short hash of the record it is about, so
 * counting the distinct ones counts records rather than reasons.
 *
 * @param {string} stderr
 * @returns {number}
 */
function commitsReported(stderr) {
  const hashes = new Set(
    stderr
      .split('\n')
      .map((line) => line.match(/^check:attribution — ([0-9a-f]{12}): /))
      .filter((match) => match !== null)
      .map((match) => String(match[1])),
  );
  return hashes.size;
}

test('a history with commits in it is read, and read field by field', () => {
  // The scan had two subjects and both of them were the wrong shape to hold it:
  // this repository's own history, which is clean, and an empty repository,
  // which has nothing in it. Neither reads a commit and finds something. So
  // replacing the text of every record with nothing — one expression — passed
  // every case here, and the whole history scan became a loop that read a count
  // and looked at none of the contents.
  //
  // Both directions, and the clean one first: a scan that refused every history
  // would satisfy all of the cases below while having stopped reading anything.
  const clean = historyOf([{ message: 'Add the thing this commit adds\n' }, { message: 'Add another thing\n' }]);
  assert.equal(clean.status, 0, `a history with nothing in it to find was refused:\n${clean.stderr}`);
  assert.ok(clean.stdout.includes('nothing to report'));

  // And one commit at a time, each putting the same kind of thing in a different
  // field of the record the scan reads. The format string names five fields
  // beyond the hash — the message, the author's name and address, and the
  // committer's — and dropping any one of them is a field nothing looks at. Each
  // history below is a clean commit and one that is not, so what is reported is
  // also about which commit.
  /** @type {[string, Parameters<typeof historyOf>[0][number], string][]} */
  const histories = [
    [
      'the message',
      { message: 'Add a thing\n\nGenerated with a tool that wrote this line.\n' },
      'generated-credit',
    ],
    ["the author's name", { message: 'Add a thing\n', authorName: 'ChatGPT' }, 'tool-name'],
    ["the author's address", { message: 'Add a thing\n', authorEmail: 'someone@openai.com' }, 'tool-name'],
    ["the committer's name", { message: 'Add a thing\n', committerName: 'ChatGPT' }, 'tool-name'],
    ["the committer's address", { message: 'Add a thing\n', committerEmail: 'someone@openai.com' }, 'tool-name'],
  ];

  for (const [field, commit, rule] of histories) {
    const result = historyOf([{ message: 'Add the thing this commit adds\n' }, commit]);
    assert.equal(result.status, 1, `an attribution in ${field} was reported as a clean history:\n${result.stdout}`);
    assert.ok(
      result.stderr.includes(`(${rule})`),
      `an attribution in ${field} was refused by a different rule:\n${result.stderr}`,
    );
    assert.equal(
      commitsReported(result.stderr),
      1,
      `an attribution in ${field} was reported against a number of commits that is not one:\n${result.stderr}`,
    );
  }

  // And the same commits, one deeper, under a clean tip.
  //
  // Every history above puts the commit it is about at HEAD, which makes all of
  // them a reading of the tip: adding `-1` to the `git log` this scan is built
  // on left every one of them passing, and turned "the whole history is read"
  // into "the newest commit is read". A commit message is fixed once it is
  // written, so the whole point of scanning a history rather than a working copy
  // is the commits that are already behind you.
  //
  // Both of the fields the scan reads a record out of, because the depth and the
  // field are separate questions and a scan could lose one without the other:
  // the message, which is the last field of the record, and the author's name,
  // which is the second.
  /** @type {[string, Parameters<typeof historyOf>[0][number]][]} */
  const buried = [
    ['the message', { message: 'Add a thing\n\nGenerated with a tool that wrote this line.\n' }],
    ["the author's name", { message: 'Add a thing\n', authorName: 'ChatGPT' }],
  ];
  for (const [field, commit] of buried) {
    const result = historyOf([
      { message: 'Add the thing this commit adds\n' },
      commit,
      { message: 'Add a later thing with nothing in it\n' },
    ]);
    assert.equal(
      result.status,
      1,
      `an attribution in ${field} of a commit that is not the tip was reported as a clean history:\n${result.stdout}`,
    );
    assert.equal(
      commitsReported(result.stderr),
      1,
      `an attribution one commit back was reported against a number of commits that is not one:\n${result.stderr}`,
    );
  }
});

test('a commit no branch points at is still read', () => {
  // The other half of "every commit there is", and the one the histories above
  // cannot reach however deep they are buried: they are all ancestors of HEAD,
  // so a scan walking HEAD's ancestry alone finds them. What that scan would not
  // find is a commit reachable only from somewhere else — and the flag making
  // this scan read every ref rather than the current branch is one word, which
  // no case here was looking at. Dropping it left every other history passing.
  //
  // A tag rather than a branch, because a tag is the ref kind a selector written
  // for branches quietly leaves out, and because it is what a release is marked
  // with — the commits most likely to be read long after they were written.
  const directory = mkdtempSync(join(tmpdir(), 'attribution-selftest-tagged-'));
  try {
    const made = spawnSync('git', ['init', '--quiet', directory], { encoding: 'utf8' });
    assert.equal(made.status, 0, 'a repository could not be made to test against');

    /** @param {{ message: string, authorName?: string }} commit */
    const commit = (commit) => {
      const written = spawnSync(
        'git',
        ['-C', directory, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '--no-verify', '-m', commit.message],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: commit.authorName ?? 'A Person',
            GIT_AUTHOR_EMAIL: 'person@example.invalid',
            GIT_COMMITTER_NAME: 'A Person',
            GIT_COMMITTER_EMAIL: 'person@example.invalid',
          },
        },
      );
      assert.equal(written.status, 0, `a commit could not be made to test against:\n${written.stderr ?? ''}`);
    };

    commit({ message: 'Add the thing this commit adds\n' });
    const base = spawnSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    assert.equal(base.status, 0, 'the first commit could not be read back');

    // The commit this case is about, marked with a tag and then taken off the
    // branch, so nothing reachable from HEAD carries it.
    commit({ message: 'Add a thing\n\nGenerated with a tool that wrote this line.\n' });
    const tagged = spawnSync('git', ['-C', directory, 'tag', 'a-release'], { encoding: 'utf8' });
    assert.equal(tagged.status, 0, 'the commit could not be tagged');
    const moved = spawnSync('git', ['-C', directory, 'reset', '--hard', '--quiet', String(base.stdout).trim()], {
      encoding: 'utf8',
    });
    assert.equal(moved.status, 0, 'the branch could not be moved back off the tagged commit');

    // The tip is clean, and a scan reading only what HEAD reaches would say so.
    const tip = spawnSync('git', ['-C', directory, 'log', '--format=%H'], { encoding: 'utf8' });
    assert.equal(String(tip.stdout).trim().split('\n').length, 1, 'the tagged commit is still on the branch');

    const result = runChecker(['--in', directory]);
    assert.equal(result.status, 1, `an attribution on a tagged commit no branch points at was not read:\n${result.stdout}`);
    assert.equal(
      commitsReported(result.stderr),
      1,
      `the tagged commit was reported against a number of commits that is not one:\n${result.stderr}`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a commit merged in from a branch is still read', () => {
  // Which refs the scan starts from is pinned — `--all`, by the tagged commit
  // above — and that it goes deeper than the tip is pinned, by the buried
  // commits. The shape of the walk between those two is not, and it is a third
  // thing: a traversal can start everywhere, go all the way down, and still
  // visit only some of what it reaches.
  //
  // `--first-parent` is the one word that does it. Added to the `git log` this
  // scan is built on, every history above still passes — each is a straight line
  // where the first parent is the only parent — and every commit that arrived on
  // a branch disappears from the scan. That is not an exotic shape: it is what
  // the ordinary merge of an ordinary branch leaves behind, and it is where the
  // commits somebody else wrote live.
  //
  // So the fixture is that shape exactly. An attribution on a branch, the branch
  // merged with a merge commit, and the branch deleted — which is what a merge
  // workflow does, and which leaves the commit reachable from the tip through
  // the second parent and from nowhere else.
  const directory = mkdtempSync(join(tmpdir(), 'attribution-selftest-merged-'));
  try {
    const git = (/** @type {string[]} */ args, /** @type {Record<string, string>} */ identity = {}) => {
      const result = spawnSync('git', ['-C', directory, '-c', 'commit.gpgsign=false', ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'A Person',
          GIT_AUTHOR_EMAIL: 'person@example.invalid',
          GIT_COMMITTER_NAME: 'A Person',
          GIT_COMMITTER_EMAIL: 'person@example.invalid',
          ...identity,
        },
      });
      assert.equal(result.status, 0, `git ${args[0] ?? ''} failed:\n${result.stderr ?? ''}`);
      return String(result.stdout ?? '');
    };

    const made = spawnSync('git', ['init', '--quiet', '--initial-branch=main', directory], { encoding: 'utf8' });
    assert.equal(made.status, 0, 'a repository could not be made to test against');

    git(['commit', '--allow-empty', '--no-verify', '-m', 'Add the thing this commit adds\n']);

    // The commit this case is about, made on a branch of its own.
    git(['checkout', '--quiet', '-b', 'a-branch']);
    git(['commit', '--allow-empty', '--no-verify', '-m', 'Add a thing\n\nGenerated with a tool that wrote this line.\n']);

    // And the branch merged back with a merge commit of its own, then deleted —
    // so what reaches the branch commit is the merge's second parent and nothing
    // else.
    git(['checkout', '--quiet', 'main']);
    git(['commit', '--allow-empty', '--no-verify', '-m', 'Add a later thing with nothing in it\n']);
    git(['merge', '--no-ff', '--no-verify', '--quiet', '-m', 'Merge the branch\n', 'a-branch']);
    git(['branch', '--quiet', '-D', 'a-branch']);

    // The fixture is the shape this case needs, read back rather than assumed:
    // the walk that follows first parents only does not reach the commit, and
    // the walk that follows every parent does. Without this pair the case would
    // pass on a history where there was nothing to miss.
    const alongFirstParents = git(['log', '--all', '--first-parent', '--format=%s']);
    const everywhere = git(['log', '--all', '--format=%s']);
    assert.ok(
      !alongFirstParents.includes('Add a thing'),
      'the merged commit is on the first-parent line, so this fixture no longer holds the case it is for',
    );
    assert.ok(everywhere.includes('Add a thing'), 'the merged commit is not in the history at all');

    const result = runChecker(['--in', directory]);
    assert.equal(
      result.status,
      1,
      `an attribution on a commit merged in from a branch was not read:\n${result.stdout}`,
    );
    assert.equal(
      commitsReported(result.stderr),
      1,
      `the merged commit was reported against a number of commits that is not one:\n${result.stderr}`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the history this repository has is accepted, and an empty one is not', () => {
  // The real subject, which is the state all of this exists to keep. A check
  // nobody has seen accept it is a check that might be refusing it.
  const real = runChecker([]);
  assert.equal(real.status, 0, `the history of this repository was refused:\n${real.stderr}`);
  assert.ok(real.stdout.includes('nothing to report'));

  // And a history with nothing in it, which must not read as clean. A shallow
  // checkout is the ordinary way a scan of every branch ends up reading one
  // commit, and reading none of them has to be louder than finding nothing.
  const directory = mkdtempSync(join(tmpdir(), 'attribution-selftest-empty-'));
  try {
    const made = spawnSync('git', ['init', '--quiet', directory], { encoding: 'utf8' });
    assert.equal(made.status, 0, 'an empty repository could not be made to test against');
    const empty = runChecker(['--in', directory]);
    assert.equal(empty.status, 1, 'a history with no commits in it was reported as clean');
    assert.ok(empty.stderr.includes('nothing was read'), `the empty run gave a different reason:\n${empty.stderr}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the hook is on disk, executable, and refuses what it is for', () => {
  // The file itself first, because git runs a hook by executing it: a hook
  // without the bit is skipped, and one without an interpreter line is a file
  // the shell has to guess about.
  const stats = statSync(HOOK);
  assert.ok(stats.isFile(), '.githooks/commit-msg is not a file');
  assert.ok((stats.mode & 0o111) !== 0, '.githooks/commit-msg is not executable, so git will not run it');
  const source = readFileSync(HOOK, 'utf8');
  assert.ok(source.startsWith('#!'), '.githooks/commit-msg names no interpreter');
  assert.ok(source.includes(SETUP_LINE), '.githooks/commit-msg no longer says how to wire it up');

  // And then what it does, by running it the way git does — a path to a message
  // as its one argument — rather than by looking for the name of the check
  // inside it. Reading the text was what this test used to do and it was not the
  // claim: the file explains itself in a comment, so the name it is supposed to
  // run appears in it whether the line that runs it says that or something else
  // entirely. Pointing the executable line at another program left this test
  // green and the hook doing nothing.
  for (const [what, text, status] of /** @type {[string, string, number][]} */ ([
    ['a message with nothing to report', 'Add the thing this commit adds\n', 0],
    ['a message crediting a tool', 'Add a thing\n\nGenerated with a tool that wrote this line.\n', 1],
  ])) {
    const directory = mkdtempSync(join(tmpdir(), 'attribution-selftest-hook-'));
    try {
      const file = join(directory, 'COMMIT_EDITMSG');
      writeFileSync(file, text, 'utf8');
      const result = spawnSync(HOOK, [file], { encoding: 'utf8' });
      assert.equal(result.error, undefined, `the hook could not be run: ${result.error?.message ?? ''}`);
      assert.equal(result.status, status, `the hook gave the wrong answer for ${what}:\n${result.stderr ?? ''}`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

/**
 * The keys of the block whose header is on `lines[header]`, in order, with the
 * line each is on.
 *
 * A block's own keys are the lines one indentation level inside it: the first
 * line deeper than the header sets that level, lines at exactly that level are
 * its keys, lines deeper belong to one of them, and the first line back at or
 * outside the header's level ends it. Blank lines and comments are skipped
 * rather than ending anything.
 *
 * This is a reading of indentation and it is deliberately not a YAML reader. It
 * parses no scalar, resolves no type, and understands no flow mapping, no
 * anchor, no alias and no tag — every one of which the shape assertions in the
 * test below require this workflow not to carry, which is what makes reading a
 * line as a key sound here. Teaching this to handle one of them would be a YAML
 * parser arriving one construct at a time, which is the thing being avoided; the
 * file's shape is pinned instead, so the reading stays this small.
 *
 * A step written as a sequence item is a block like any other: `- uses: …` is
 * the header, and the mapping keys that follow it are indented past the dash.
 *
 * @param {readonly string[]} lines The workflow's lines, untrimmed.
 * @param {number} header
 * @returns {{ index: number, key: string }[]}
 */
function blockKeys(lines, header) {
  const headerLine = lines[header] ?? '';
  const headerIndent = headerLine.length - headerLine.trimStart().length;

  /** @type {{ index: number, key: string }[]} */
  const keys = [];
  /** @type {number | null} */
  let level = null;

  for (let index = header + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const key = line.trim();
    if (key.length === 0 || key.startsWith('#')) {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent <= headerIndent) {
      break;
    }
    if (level === null) {
      level = indent;
    }
    if (indent === level) {
      keys.push({ index, key });
    }
  }

  return keys;
}

/**
 * Is this text the key `name` — the key, rather than a string that begins with
 * its letters?
 *
 * A colon on its own does not make a key. YAML requires the colon of a block
 * mapping key to be followed by whitespace or by the end of the line, and
 * `push:false` has neither: it is a plain scalar, spelled `push:false`, and a
 * parser handed `on:` with that under it reports the whole `on` value as the
 * string rather than as a mapping with a `push` key in it. A reading written as
 * `startsWith('push:')` said the workflow was triggered by a push while the
 * workflow was triggered by nothing, and `check:self` exited 0.
 *
 * So the separator is part of what is matched. Space or tab or end of line —
 * tab because YAML allows one after the colon as separation, even though nothing
 * in this file is written that way, and a reading that refused it would be
 * refusing a valid key rather than catching an invalid one.
 *
 * @param {string} text A trimmed line, or a key from `blockKeys`.
 * @param {string} name
 * @returns {boolean}
 */
function isKey(text, name) {
  if (!text.startsWith(`${name}:`)) {
    return false;
  }
  const after = text.charAt(name.length + 1);
  return after === '' || after === ' ' || after === '\t';
}

test('the workflow reads the whole history, and reads it with this check', () => {
  // The half that survives an unwired hook, a skipped hook, and a commit made
  // somewhere else. Both halves of it matter and only one is obvious: a scan of
  // every branch is a scan of one commit when the checkout was shallow, and it
  // exits 0 the whole time it is.
  // Read as lines, and as whole lines, because a step commented out while its
  // text stays in the file is exactly what a substring search cannot see — and
  // this file explains itself in prose, so the name of the check appears in it
  // several times over whether anything runs it or not.
  // The block reader first, on lines written here, because the two reads below
  // rest on it and the workflow cannot show what it does. Every question it
  // answers is answered the same way by a reader that stopped bounding the block
  // at all — the workflow is well-formed, so a reader returning every line of it
  // still finds `push:` under `on:` and `fetch-depth: 0` under the checkout's
  // `with:`. That is not a small difference: a reader that does not stop at the
  // end of a block puts every `with:` in the file into every other step's
  // inputs, which is exactly the evasion the checkout read exists to refuse.
  // Deleting the line that ends a block left `check:self` exiting 0 both on the
  // real workflow and on one whose depth had been moved to another step.
  //
  // A pure reading of lines is the one thing hand-written input is the right
  // instrument for: there is no wiring here, only the answer.
  const sample = [
    'on:',
    '  # a comment inside the block',
    '  push:',
    '',
    '    branches:',
    '      - main',
    '  workflow_dispatch:',
    'jobs:',
    '  checks:',
  ];
  assert.deepEqual(
    blockKeys(sample, 0).map(({ key }) => key),
    ['push:', 'workflow_dispatch:'],
    'the block reader does not read a block: its keys are the lines one level in, and nothing else',
  );
  assert.deepEqual(
    blockKeys(sample, sample.indexOf('  push:')).map(({ key }) => key),
    ['branches:'],
    'a nested block is not read as its own',
  );
  // The end of a block, which is the whole of the claim: a key of the next block
  // is not a key of this one.
  assert.ok(
    !blockKeys(sample, 0).some(({ key }) => key === 'checks:'),
    'the block reader ran past the end of the block and into the next one',
  );
  // And a block with nothing in it has no keys, rather than borrowing the next
  // block's.
  assert.deepEqual(blockKeys(['empty:', 'next:', '  key:'], 0), []);

  const raw = readFileSync(WORKFLOW, 'utf8').split(/\r?\n/);
  const lines = raw.map((line) => line.trim());
  assert.ok(lines.includes(`run: node ${INVOCATION}`), `the workflow no longer runs ${INVOCATION}`);

  // And that CI runs the gate at all, which nothing here asked. Every assertion
  // in this test was about the attribution step, the triggers, the action shapes
  // and the checkout depth, and not one of them required the chain to be run:
  // deleting the step that runs it left `npm run check` exiting 0 with CI
  // running the checks nowhere.
  assert.ok(
    lines.includes(`run: ${CHAIN_INVOCATION}`),
    `the workflow no longer runs ${CHAIN_INVOCATION}, so CI runs none of the checks`,
  );

  // And that it also reaches the gate by a path rather than by a script name.
  //
  // This is the step that survives the manifest itself being the thing edited.
  // Every step of `npm run check` is one string in `package.json`, and replacing
  // all five of them with a command that does nothing leaves the chain exiting 0
  // having run none of it — including the two runners that read the manifest,
  // because those are reached only through the names being replaced. Naming a
  // runner by its path is a route into the gate that does not consult those names
  // at all, and that runner reads the whole manifest, so this single step reports
  // every substituted step rather than the one it happens to be about.
  //
  // One step, and only one, for that reason. A copy of the step list in the
  // workflow would be a second definition of the checks that can drift from the
  // first, which is what the comment at the top of that file exists to refuse.
  assert.ok(
    lines.includes(`run: ${PATH_INVOCATION}`),
    `the workflow no longer runs ${PATH_INVOCATION}, so a manifest with every step silenced is caught nowhere`,
  );

  // And that the workflow is triggered by something, which is the half of "does
  // this run" that reading the steps cannot answer. A file whose steps are
  // perfect runs nothing if nothing starts it, and swapping `push` for
  // `workflow_dispatch` is one word: every step still names the right program,
  // every assertion above still passes, and no commit is ever checked again
  // unless somebody presses a button. `on:` is repository state like the rest of
  // this file, so it is read like the rest of this file.
  //
  // Read as the `on:` block's own keys rather than as whatever appears near it.
  // This used to be a window — a trimmed line beginning `push:` within five
  // lines of `on:` — and a window is a proximity rather than a reading. An `on:`
  // block carrying `workflow_dispatch:` with an input named `push` puts the word
  // exactly where the window looks while leaving the workflow manual-only: a
  // parser reports the sole trigger as `workflow_dispatch`, no commit is ever
  // checked again unless somebody presses a button, and this assertion passed
  // the whole time.
  //
  // `on:` is required to be a line of its own at the top level, which is the
  // shape the block read below needs and is also what refuses `on: [push]` and
  // `"on":` — neither is this file's shape, and a trigger this cannot read is
  // reported as no trigger rather than assumed to be a good one.
  //
  // And exactly one of them. This was `raw.indexOf('on:')`, which is the first
  // one: a second top-level `on:` block carrying nothing but `workflow_dispatch:`
  // left this assertion reading the first block and passing, while a parser reads
  // the effective trigger off the last and reports `workflow_dispatch` alone.
  // Every commit would arrive unchecked with the word `push` still in the file
  // where this was looking. So the count is the reading: one top-level `on`, in
  // any spelling of the key, and it has to be the bare block form this file is
  // written in.
  const topLevelOn = raw.filter((line) => /^["']?on["']?\s*:/.test(line));
  assert.equal(
    topLevelOn.length,
    1,
    `the workflow carries ${topLevelOn.length} top-level \`on\` keys, and which one decides the trigger is not something a line read can say`,
  );
  assert.equal(topLevelOn[0], 'on:', 'the workflow names its trigger in a spelling this cannot read as a block');
  const trigger = raw.indexOf('on:');
  assert.ok(trigger !== -1, 'the workflow names no trigger at all, so nothing starts it');
  assert.ok(
    blockKeys(raw, trigger).some(({ key }) => isKey(key, 'push')),
    'the workflow is not triggered by a push, so commits can arrive without these checks running',
  );

  // And that the key carries nothing beneath it, which is the half of "does this
  // run on every commit" that finding the key cannot answer. A trigger is a key;
  // a filter is what sits under it. `branches-ignore: ['**']`, `branches:
  // [release]`, `paths:`, `paths-ignore:` and `tags:` each leave the word `push`
  // exactly where the read above looks while narrowing which commits start the
  // run, and the first of them narrows it to none. Reproduced first-hand: with
  // that one filter in place the whole of `npm run check` exited 0 on a workflow
  // no push could start, and every assertion above passed the entire time.
  //
  // The honest file has nothing there, so this is a reading rather than a
  // tolerance: `push:` is the last line of the `on:` block, the blank line after
  // it is skipped as blank, and the top-level `permissions:` ends the block, so
  // the sub-block read is empty.
  //
  // Counted rather than found, for the reason the top-level `on` count above is
  // counted. A read written as `.find` takes the first of two `push` keys while
  // a parser resolves the last — so a bare `push:` followed by a second one
  // carrying a filter satisfies a first-match read while the run starts on
  // nothing that reaches it. One key, or which one decides is not something a
  // line read can say.
  //
  // And the key is required to be bare, because a filter can be written on the
  // key's own line rather than under it. `push: {branches: [release]}` is a flow
  // mapping and `push: &somewhere` is an anchor; in both, the block beneath the
  // line is empty or belongs to something else, so the sub-block read would
  // report no filter on a key that carries one.
  //
  // Two spellings this refuses that are not filters, both deliberate and both
  // failing the bare-key comparison rather than the sub-block one: a trailing
  // comment on the trigger line, `push:  # every commit`, and an explicit null,
  // `push: ~`. Neither narrows anything. It fails closed, which is the right
  // direction for a gate about whether commits are checked at all — but it is
  // why adding a comment to that one line turns this red, and the next person to
  // reach for one should know that before spending an afternoon on it.
  const pushes = blockKeys(raw, trigger).filter(({ key }) => isKey(key, 'push'));
  assert.equal(
    pushes.length,
    1,
    `the \`on:\` block carries ${pushes.length} \`push\` keys, and which one decides the trigger is not something a line read can say`,
  );
  const push = pushes[0];
  assert.ok(push !== undefined, 'the `on:` block names no push trigger this can read as a key');
  assert.equal(
    push.key,
    'push:',
    `the push trigger is written as \`${push.key}\`, which puts something on the key's own line where a filter can sit`,
  );
  assert.deepEqual(
    blockKeys(raw, push.index),
    [],
    'the push trigger carries a filter, so the checks run on some commits rather than on every commit',
  );

  // And that nothing in the workflow is written to be skipped or forgiven. A
  // step naming the right program still runs nothing behind `if: false`, and a
  // step that runs and fails still passes the job under `continue-on-error:
  // true` — both of which satisfy the line above exactly. Neither key appears
  // anywhere in this file today, so what is asserted is that it carries none:
  // the same "it is what it is" reading the rest of this suite uses, and one
  // that does not need a YAML parser to make.
  //
  // Quoted as well as bare. YAML reads `"if": false` and `'if': false` as the
  // same key as `if: false`, and a pattern anchored on the bare name matched
  // none of them — so the one spelling this refused was the one an author writes
  // by accident, and the two it admitted were the ones somebody choosing to
  // silence a step would reach for. The optional quote is part of the key rather
  // than an alternative to it, so all three spellings are one pattern.
  for (const key of ['if', 'continue-on-error']) {
    assert.ok(
      !lines.some((line) => new RegExp(`^-?\\s*["']?${key}["']?\\s*:`).test(line)),
      `the workflow carries a \`${key}:\`, so a step can name this check and not run it`,
    );
  }

  // And the whole of what makes reading this file by lines a reading of its
  // keys: it is written in block style, one key per line, and the key is the
  // literal text at the start of that line. YAML offers four ways for that to
  // stop being true, and each one was checked against a parser rather than
  // guessed at — each of the four below really does produce the key `if` on the
  // step it is written in, and each one really did leave `check:self` exiting 0.
  //
  //   - A flow mapping puts a whole step on one line — `- { name: …, if: false,
  //     run: … }` — where every key sits mid-line.
  //   - A backslash is an escape inside a double-quoted key, and an escaped
  //     letter is not the letter to a pattern reading letters: `"\x69f": false`
  //     and `"if": false` are both the key `if`. This is the one that
  //     survived the last broadening, which covered `"if"` and `'if'` and
  //     stopped there.
  //   - `?` is the explicit key indicator, which puts the key on a line of its
  //     own with the colon on the next line, so a pattern requiring a colon
  //     after the name never matches.
  //   - `!` introduces a tag, and `!!str if: false` is the key `if` behind an
  //     annotation nothing above expects.
  //
  //   - `&` introduces an anchor, and a node property may be written in front of
  //     a key: `&mute if: false` is the key `if` carrying an anchor, and every
  //     pattern above is anchored to the start of the trimmed line, where the
  //     `&` now sits. GitHub Actions supports anchors on every repository, so
  //     this is a spelling that works rather than one that would be rejected —
  //     `check:self` exited 0 with `npm run check` skipped in CI.
  //
  // Rather than teach a line scan to see through any of them — which is a YAML
  // parser arriving one construct at a time, and the thing this file has
  // declined to build four times over — the shape is pinned: this workflow
  // carries none of these characters anywhere, so a key is a line and every read
  // above is a read of a key.
  //
  // The list used to stop at four, and said in as many words that anchors and
  // aliases needed no ban of their own because an anchor still spells its keys
  // out somewhere and those lines are read like any others. That was wrong in
  // the one way that mattered: the anchor is written *on* the key's own line, in
  // front of it, so the line stops beginning with the key. An alias needs no
  // separate ban, and that part of the claim survives for a reason worth
  // stating — an alias is a reference to an anchor, and a document with no `&`
  // in it has nothing for a `*` to name.
  //
  // Anywhere rather than in key position, deliberately. It is a claim a reader
  // can check at a glance, it is the same trade the flow-mapping ban already
  // made, and a workflow that genuinely needed one of these characters — in
  // prose or in a value — is a change worth making deliberately rather than one
  // that quietly widens what a line can mean.
  for (const [indicator, what] of /** @type {[string, string][]} */ ([
    ['{', 'a flow-style mapping, in which a key is not a line'],
    ['\\', 'a backslash, which inside a double-quoted key is an escape, so an escaped letter spells a key no pattern above can read'],
    ['?', 'an explicit key indicator, which puts a key on a line with no colon after it'],
    ['!', 'a tag, which puts a key behind an annotation nothing above expects'],
    ['&', 'an anchor, which is written in front of the key it belongs to, so the key is no longer what the line begins with'],
    // The two block scalar indicators, which are the same hole from the other
    // direction: rather than hiding a real key from a line read, they offer a
    // line read a key that is not one. A value written as a block scalar is a
    // string, and every line of it is indented under its key while still being,
    // to a reader of lines, a line like any other. An `env:` value spelled that
    // way and carrying the text of a checkout step satisfied every read below —
    // the step, its `with:` block and its `fetch-depth: 0` — while the real
    // checkout beside it asked for a shallow history and was written in a
    // spelling `isKey` does not recognise. Parser-verified in both halves: the
    // scalar really is one string, and the quoted key really is the step.
    ['|', 'a literal block scalar, whose lines are the text of a value and are read above as keys'],
    ['>', 'a folded block scalar, which is the same value in the other spelling'],
  ])) {
    assert.ok(
      !lines.some((line) => line.includes(indicator)),
      `the workflow carries ${what}, and nothing above can read a key through it`,
    );
  }

  // And the other half of "a key is a line": that every key of this file is
  // written where the reads above look for one. Two spellings leave a key exactly
  // where a parser finds it and exactly where `isKey` does not, and both were
  // checked against a parser rather than guessed at.
  //
  //   - A quoted key. `- "uses": actions/checkout@…` is the key `uses`, and
  //     `isKey` refuses it — so that step is not among the ones read below, its
  //     action is never required to name a commit, and its `fetch-depth` is never
  //     read.
  //   - A space before the colon. YAML allows one and strips it, so `uses : …` is
  //     that same key again, and the same step goes unread.
  //
  // Refused rather than read, for the reason the list above gives: a line scan
  // taught to see through one more spelling is a YAML parser arriving one
  // construct at a time. What is pinned is that this file is written in the one
  // shape every read above assumes — a key is the literal text its line begins
  // with, and its colon comes immediately after it.
  for (const line of lines) {
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const head = line.replace(/^-\s+/, '');
    assert.ok(
      !/^["']/.test(head),
      `the workflow writes \`${line}\` as a quoted key, and nothing above reads one`,
    );
    assert.ok(
      !/^[^:]*[ \t]:/.test(head),
      `the workflow writes \`${line}\` with a space before its colon, and nothing above reads that as a key`,
    );
  }

  // And the depth, read as the checkout step's own input rather than as a line
  // somewhere in the file.
  //
  // This was `lines.includes('fetch-depth: 0')`, which is a line anywhere, and
  // the whole shallow-history defence is delegated to it — the scan's own
  // comment says so. Taking the input off the checkout, so CI clones one commit,
  // and putting a bare inert `fetch-depth: 0` under `setup-node`'s `with:` left
  // this passing with the checkout's only input being `persist-credentials`.
  // It passed for the wrong reason: the words were in the file and the setting
  // was not on the step that takes it.
  // Every action this workflow runs, read as a step of its own and required to
  // be pinned to a commit. `startsWith('- uses: actions/checkout@')` is satisfied
  // by `actions/checkout@main`, which is a branch and moves — while the sentence
  // at the top of the workflow, and the message this assertion used to carry,
  // both call the action pinned. And `setup-node` was not read at all, so the
  // claim that this file pins its actions was a claim about one of the two.
  //
  // Read as: every `uses:` is the first key of its step, and every one of them
  // names a full 40-character commit. The first half is what lets the block read
  // below be a read of that step's inputs — a `uses:` written under a `name:` is
  // a step whose header is somewhere else — and the second is the pin itself,
  // spelled as a shape rather than as a list of the two actions this file
  // happens to use today.
  const usesSteps = raw
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => isKey(line.replace(/^-\s+/, ''), 'uses'));
  assert.ok(usesSteps.length > 0, 'the workflow runs no actions at all');
  for (const { line } of usesSteps) {
    assert.ok(
      line.startsWith('- uses: '),
      `the workflow writes \`${line}\` somewhere other than at the head of its step, so the inputs read below are not that step's`,
    );
    const action = (line.slice('- uses: '.length).split('#')[0] ?? '').trim();
    assert.ok(
      /^[^@\s]+@[0-9a-f]{40}$/.test(action),
      `the workflow runs ${JSON.stringify(action)}, which is not pinned to a commit — a tag or a branch can be moved under it`,
    );
  }

  // And the depth, on every checkout rather than on the first one found. A second
  // checkout after the deep one is a step that runs and leaves the history it
  // finds: `fetch-depth: 1` over a full clone writes `.git/shallow` and cuts what
  // is reachable to one commit, which is exactly the state the attribution scan
  // reads as a clean history. The read was `findIndex`, so the second step was
  // invisible and `check:self` exited 0.
  const checkouts = usesSteps.filter(({ line }) => line.startsWith('- uses: actions/checkout@'));
  assert.ok(checkouts.length > 0, 'the workflow does not check this repository out with a pinned checkout action');
  for (const { index } of checkouts) {
    const withBlock = blockKeys(raw, index).find(({ key }) => isKey(key, 'with'));
    assert.ok(withBlock !== undefined, 'a checkout step names no inputs, so it takes the default shallow history');
    assert.ok(
      blockKeys(raw, withBlock.index).some(({ key }) => key === 'fetch-depth: 0'),
      'a checkout step does not ask for the whole history, so this check reads one commit and reports on all of them',
    );
  }

  // What this cannot reach, said rather than implied. Everything above is a
  // reading of a file in this repository, and it is a reading of lines: the file
  // is split on a line feed or on a carriage-return-and-line-feed pair, and
  // indentation is however much `trimStart` removes. A spelling that a parser
  // resolves one way and this reader resolves another therefore sits inside the
  // gap rather than outside it, and a trigger is one of the things that can sit
  // there — so "a job nothing triggers is caught here" holds for the spellings
  // this reader sees and is not the general claim it reads like.
  //
  // `CONTRIBUTING.md` is where the boundary is actually drawn, and it is drawn
  // in the other direction from the one this comment used to point in: edits
  // confined to files in this repository, passing every check in it, can survive
  // — what they run into is the reviewable diff rather than another check. The
  // whitespace and line breaks this reader does not see belong to that same
  // boundary and are named there with the rest of it.

  // And the setup line lives where a reader would look for it.
  assert.ok(readFileSync(CONTRIBUTING, 'utf8').includes(SETUP_LINE), 'the one-line setup is not written down');

  // And this file is reading the repository's own copies rather than something
  // it made, which is the whole point of reading them off disk.
  assert.ok(WORKFLOW.startsWith(REPO_ROOT) && CONTRIBUTING.startsWith(REPO_ROOT));
});
