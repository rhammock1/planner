// @ts-check

/**
 * What a manifest's `[permissions]` tables ask for.
 *
 * A capability that carries a list of things it may reach brings its own
 * table, and every rule about that table is a rule about reach.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { parseToml } from '../src/core/toml.js'
import { readCapabilities, readOpen, readRun } from '../src/core/permissions.js'

/** @param {string} text @returns {unknown} */
function permissionsOf(text) {
  return parseToml(text)['permissions']
}

/**
 * `readRun` returns a string when the whole table is wrong, so a test that
 * reaches into the result has to narrow first or `run[0].name` is an error
 * on `string`. Failing loudly here beats an optional chain that quietly
 * reads `undefined` off the refusal path.
 *
 * @param {string} text
 * @param {string[]} notices
 * @returns {import('../src/core/permissions.js').RunCommand[]}
 */
function runOf(text, notices = []) {
  const read = readRun(permissionsOf(text), notices)
  assert.ok(Array.isArray(read), `readRun refused the whole table: ${read}`)
  return read
}

test('a manifest that asks for nothing gets nothing, and says nothing about it', () => {
  /** @type {string[]} */
  const notices = []
  assert.deepEqual(readCapabilities(undefined), [])
  assert.deepEqual(readOpen(undefined, notices), [])
  assert.deepEqual(readRun(undefined, notices), [])
  assert.deepEqual(notices, [])
})

test('a command is a name, an argument list, and a rule per placeholder', () => {
  /** @type {string[]} */
  const notices = []
  const run = runOf(`
[permissions.run.log]
command = ["git", "-C", "{repo}", "log", "--since={from} 00:00"]
repo    = "settings.repo"
from    = "date"
`, notices)

  assert.deepEqual(notices, [])
  assert.equal(run.length, 1)
  assert.equal(run[0]?.name, 'log')
  assert.deepEqual(run[0]?.command, ['git', '-C', '{repo}', 'log', '--since={from} 00:00'])
  assert.deepEqual(run[0]?.binds, [
    { name: 'repo', rule: 'setting', key: 'repo' },
    { name: 'from', rule: 'date', key: '' },
  ])
  // The stored line carries the rules, so the two halves of the table cannot
  // drift apart under a tick that stands (spec §1.6, as amended above).
  assert.equal(run[0]?.line, "git -C {repo=settings.repo} log '--since={from=date} 00:00'")
})

test('the stored line changes when only a binding rule changes', () => {
  // The whole reason the rule lives inside the placeholder. Same arguments,
  // same name, different source for the value - and it has to show up as a
  // different string, or the old tick would still be standing.
  const [before] = runOf(`
[permissions.run.log]
command = ["git", "-C", "{repo}"]
repo    = "settings.repo"
`)
  const [after] = runOf(`
[permissions.run.log]
command = ["git", "-C", "{repo}"]
repo    = "settings.token"
`)
  assert.deepEqual(before?.command, after?.command)
  assert.notEqual(before?.line, after?.line)
})

test('commands come back in name order, whatever order the file wrote them', () => {
  const run = runOf(`
[permissions.run.zulu]
command = ["git", "status"]

[permissions.run.alpha]
command = ["git", "log"]
`)
  assert.deepEqual(run.map((one) => one.name), ['alpha', 'zulu'])
})

test('a placeholder with no rule is a command that is not granted', () => {
  /** @type {string[]} */
  const notices = []
  const run = readRun(permissionsOf(`
[permissions.run.log]
command = ["git", "-C", "{repo}"]
`), notices)
  assert.deepEqual(run, [])
  assert.equal(notices.length, 1)
  assert.match(notices[0] ?? '', /\{repo\}/)
})

test('a rule for a placeholder the command does not use is a command that is not granted', () => {
  // The two halves of the table disagree, and a manifest to look at is better
  // than a rule this app silently ignores.
  /** @type {string[]} */
  const notices = []
  const run = readRun(permissionsOf(`
[permissions.run.log]
command = ["git", "log"]
repo    = "settings.repo"
`), notices)
  assert.deepEqual(run, [])
  assert.match(notices[0] ?? '', /does not use/)
})

test('a rule this app does not know how to bind is refused', () => {
  for (const rule of ['"whatever"', '"settings.a.b"', '4', 'true']) {
    /** @type {string[]} */
  const notices = []
    const run = readRun(permissionsOf(`
[permissions.run.log]
command = ["git", "-C", "{repo}"]
repo    = ${rule}
`), notices)
    assert.deepEqual(run, [], `${rule} was read as a binding rule`)
    assert.equal(notices.length, 1)
  }
})

test('the program a command runs may not be a placeholder', () => {
  // The pane shows the rendered line and the tick beside it is the approval.
  // A bound program renders as `{prog}`, so the person ticking it would be
  // approving a command whose program they cannot see.
  /** @type {string[]} */
  const notices = []
  const run = readRun(permissionsOf(`
[permissions.run.anything]
command = ["{prog}", "log"]
prog    = "settings.prog"
`), notices)
  assert.deepEqual(run, [])
  assert.match(notices[0] ?? '', /program/)
})

test('a command whose name could not be a config key is refused', () => {
  // Handed in directly rather than parsed: this app's TOML subset has no
  // quoted keys at all, so `"a.b" = 1` never gets past `parseToml` to be
  // refused here. The check stays because `readRun` reads a table it did not
  // build, and the name becomes a `config.toml` key.
  /** @type {string[]} */
  const notices = []
  assert.deepEqual(readRun({ run: { 'a.b': { command: ['git'] } } }, notices), [])
  assert.equal(notices.length, 1)
})

test('an argument list that is not a list of strings is refused', () => {
  for (const command of ['"git log"', '[]']) {
    /** @type {string[]} */
  const notices = []
    const run = readRun(permissionsOf(`
[permissions.run.log]
command = ${command}
`), notices)
    assert.deepEqual(run, [], `${command} was read as an argument list`)
    assert.equal(notices.length, 1)
  }
  // Handed in directly, for the same reason as the quoted key above: a mixed
  // list is a `parseToml` error long before it is a `readRun` refusal.
  /** @type {string[]} */
  const notices = []
  assert.deepEqual(readRun({ run: { log: { command: ['git', 4] } } }, notices), [])
  assert.equal(notices.length, 1)
})

test('an argument that is not printable ASCII is refused', () => {
  // A tab or a non-breaking space is drawn as a space and collapses to one in
  // HTML, so the argument boundaries a person sees would not be the argument
  // boundaries that run. A bidi override is worse: it reorders the label
  // without changing what runs. The rendering quotes all of these, but the
  // approval label is read by a person and this is the cheaper place to stop.
  for (const argument of ['a\tb', 'a b', 'a‮b', 'ré']) {
    /** @type {string[]} */
  const notices = []
    const run = readRun({ run: { log: { command: ['git', argument] } } }, notices)
    assert.deepEqual(run, [], `${JSON.stringify(argument)} was read as an argument`)
    assert.equal(notices.length, 1)
  }
})

test('an empty argument is refused, because the line would not show it', () => {
  /** @type {string[]} */
  const notices = []
  const run = readRun(permissionsOf(`
[permissions.run.log]
command = ["git", "", "log"]
`), notices)
  assert.deepEqual(run, [])
  assert.match(notices[0] ?? '', /empty/)
})

test('a placeholder that spans two arguments is refused', () => {
  /** @type {string[]} */
  const notices = []
  const run = readRun(permissionsOf(`
[permissions.run.log]
command = ["git", "--since={from", "00:00}"]
from    = "date"
`), notices)
  assert.deepEqual(run, [])
  assert.match(notices[0] ?? '', /does not close/)
})

test('a permissions.run that is not a table is an error, not a notice', () => {
  assert.equal(typeof readRun(permissionsOf('[permissions]\nrun = "git log"\n'), []), 'string')
})
