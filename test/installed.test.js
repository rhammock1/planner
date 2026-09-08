// @ts-check

/**
 * Every plugin folder as the ⌘, pane needs to see it.
 *
 * The pane's job is to let a person decide, so this reader's job is to hand
 * over what there is to decide about: what is declared, what is approved, and
 * - for a command - what will actually be on the command line.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { installed } from '../src/core/installed.js'

const RUNNER = `
entry = "index.js"

[permissions]
capabilities = ["shell.run"]

[permissions.run.log]
command = ["git", "-C", "{repo}", "log", "--since={from} 00:00"]
repo    = "settings.repo"
from    = "date"

[settings.repo]
label = "Repository"
kind  = "text"
`

const LINE = "git -C {repo=settings.repo} log '--since={from=date} 00:00'"

/**
 * @param {Partial<import('../src/core/config.js').PluginConfig>} [patch]
 * @returns {Map<string, import('../src/core/config.js').PluginConfig>}
 */
function runConfigured(patch) {
  return new Map([['git-activity', {
    enabled: true,
    approvedSlots: [],
    approvedCapabilities: ['shell.run'],
    approvedOpen: [],
    approvedRun: new Map([['log', LINE]]),
    settings: new Map([['repo', '~/gotab/node']]),
    ...patch,
  }]])
}

test('a command is listed with its line, its tick, and what each hole will hold', () => {
  const [one] = installed([{ name: 'git-activity', manifest: RUNNER }], runConfigured())
  assert.deepEqual(one?.run, [{
    name: 'log',
    line: LINE,
    approved: true,
    binds: [
      { name: 'repo', rule: 'setting', key: 'repo', value: '~/gotab/node' },
      { name: 'from', rule: 'date', key: '', value: null },
    ],
  }])
})

test('a command whose line has changed is listed, unticked', () => {
  // Which is the whole point of storing the line: the pane shows the new
  // command with an empty box beside it rather than running it silently.
  const [one] = installed(
    [{ name: 'git-activity', manifest: RUNNER }],
    runConfigured({ approvedRun: new Map([['log', 'git -C {repo} log']]) }),
  )
  assert.equal(one?.run[0]?.approved, false)
})

test('a setting nobody set shows as nothing, not as the author default', () => {
  const withDefault = RUNNER.replace('kind  = "text"', 'kind  = "text"\ndefault = "~/somewhere"')
  const [one] = installed(
    [{ name: 'git-activity', manifest: withDefault }],
    runConfigured({ settings: new Map() }),
  )
  assert.equal(one?.run[0]?.binds[0]?.value, null)
})

test('the raw approvals come back, so a tick can be written without losing the rest', () => {
  const [one] = installed([{ name: 'git-activity', manifest: RUNNER }], runConfigured())
  assert.equal(one?.approvedRun.get('log'), LINE)
})

test('a folder that cannot be a plugin is listed with its problem and nothing else', () => {
  const [one] = installed([{ name: 'Not A Plugin', manifest: RUNNER }], new Map())
  assert.match(one?.problem ?? '', /lowercase/)
  assert.deepEqual(one?.run, [])
  assert.equal(one?.heading, 'Not A Plugin')
})

// The calendar's fixtures. These tests came from `test/plugins.test.js` with
// `installed()` itself: they are about the pane's view of a plugin, and that
// is what moved.

/** @typedef {import('../src/core/config.js').PluginConfig} PluginConfig */

const MANIFEST = `
name = "macos-calendar"
version = "0.1.0"
entry = "index.js"
slots = ["vault.contribute"]

[permissions]
capabilities = ["macos.calendar.read"]
`

const OPENS = `
entry = "index.js"
[permissions.open]
urls = ["https://github.com/gotab-inc/node/pull/"]
`

/**
 * @param {Partial<PluginConfig>} [settings]
 * @returns {Map<string, PluginConfig>}
 */
function configured(settings) {
  return new Map([[
    'macos-calendar',
    {
      enabled: settings?.enabled ?? true,
      approvedSlots: settings?.approvedSlots ?? ['vault.contribute'],
      approvedCapabilities: settings?.approvedCapabilities ?? ['macos.calendar.read'],
      approvedOpen: settings?.approvedOpen ?? [],
      approvedRun: new Map(),
      settings: settings?.settings ?? new Map(),
    },
  ]])
}

/** @param {string} [manifest] */
function folders(manifest) {
  return [{ name: 'macos-calendar', manifest: manifest ?? MANIFEST }]
}

test('a plugin that is switched off is still listed', () => {
  assert.deepEqual(installed(folders(), configured({ enabled: false })), [{
    name: 'macos-calendar',
    enabled: false,
    slots: ['vault.contribute'],
    approvedSlots: ['vault.contribute'],
    asked: ['macos.calendar.read'],
    approved: ['macos.calendar.read'],
    open: [],
    approvedOpen: [],
    run: [],
    approvedRun: new Map(),
    heading: 'macos-calendar',
    moves: [],
    problem: null,
    schema: [],
    settings: new Map(),
    held: new Map(),
  }])
})

test('a plugin the config has never heard of is listed as off and ungranted', () => {
  assert.deepEqual(installed(folders(), new Map()), [{
    name: 'macos-calendar',
    enabled: false,
    slots: ['vault.contribute'],
    approvedSlots: [],
    asked: ['macos.calendar.read'],
    approved: [],
    open: [],
    approvedOpen: [],
    run: [],
    approvedRun: new Map(),
    heading: 'macos-calendar',
    moves: [],
    problem: null,
    schema: [],
    settings: new Map(),
    held: new Map(),
  }])
})

// The manifest is the ceiling, so a tick for something the plugin never asked
// for would be showing a permission that does not exist.
test('a capability the config approves but the manifest does not ask for is not shown as granted', () => {
  const settings = configured({ approvedCapabilities: ['macos.calendar.read', 'macos.reminders.read'] })
  assert.deepEqual(installed(folders(), settings)[0]?.approved, ['macos.calendar.read'])
})

test('a manifest that cannot be read says why, instead of listing nothing', () => {
  const one = installed(folders('entry = '), configured())[0]
  assert.equal(one?.name, 'macos-calendar')
  assert.ok(one?.problem !== null && one?.problem !== undefined, 'no reason was given')
  assert.deepEqual(one?.asked, [])
})

test('nothing installed is an empty list, not an error', () => {
  assert.deepEqual(installed([], configured()), [])
})

test('a folder whose name is not a plugin name is listed with the problem', () => {
  const bad = [{ name: 'x]\n[plugins.other', manifest: MANIFEST }]
  const [one] = installed(bad, new Map())

  assert.equal(one?.name, 'x]\n[plugins.other')
  assert.equal(
    one?.problem,
    'the folder name may only be lowercase letters, digits and hyphens, starting with a letter or a digit',
  )
  // The manifest is not read at all: a name that could rewrite config.toml
  // has not earned a reading of anything else it says.
  assert.deepEqual(one?.asked, [])
  assert.deepEqual(one?.approved, [])
})

test('the pane is shown what a plugin asks to be shown', () => {
  const [listed] = installed(folders(), configured({ approvedSlots: [] }))
  assert.deepEqual(listed?.slots, ['vault.contribute'])
  assert.deepEqual(listed?.approvedSlots, [])
})

test('an approved slot the manifest does not ask for is not shown as granted', () => {
  const [listed] = installed(folders(), configured({ approvedSlots: ['item.badge'] }))
  assert.deepEqual(listed?.approvedSlots, [])
})

test('the pane is shown what a plugin asks to open', () => {
  const [listed] = installed(folders(OPENS), configured({ approvedSlots: [], approvedCapabilities: [] }))
  assert.deepEqual(listed?.open, ['https://github.com/gotab-inc/node/pull/'])
  assert.deepEqual(listed?.approvedOpen, [])
})

test('a contributing plugin is listed with the heading it asked for', () => {
  const folders = [{
    name: 'git-activity',
    manifest: `
entry = "index.js"
slots = ["vault.contribute"]

[contribute]
heading = "From git"
`,
  }]
  const [one] = installed(folders, new Map())
  assert.equal(one?.heading, 'From git')
})

test('a contributing plugin with no heading is listed under its own name', () => {
  const folders = [{ name: 'macos-calendar', manifest: 'entry = "index.js"\nslots = ["vault.contribute"]\n' }]
  const [one] = installed(folders, new Map())
  assert.equal(one?.heading, 'macos-calendar')
})

test('a plugin that does not contribute still has a heading, and it is its name', () => {
  // The pane and the day page both read one list. A plugin that never
  // contributes never has its heading drawn, and a null here would only mean
  // every reader had to check for it.
  const folders = [{ name: 'ticket-links', manifest: 'entry = "index.js"\nslots = ["item.badge"]\n' }]
  const [one] = installed(folders, new Map())
  assert.equal(one?.heading, 'ticket-links')
})

test('a plugin that moves colours is listed with the ones it named', () => {
  const [one] = installed([{
    name: 'dusk',
    manifest: `
entry = "index.js"
slots = ["theme.tokens"]

[tokens]
moves = ["paper", "ink"]
`,
  }], new Map())
  assert.deepEqual(one?.moves, ['paper', 'ink'])
})

test('a plugin that moves nothing has an empty list, not a missing one', () => {
  const [one] = installed([{ name: 'ticket-links', manifest: 'entry = "index.js"\n' }], new Map())
  assert.deepEqual(one?.moves, [])
})

test("what the pane writes back is what the person set, never the author's default", () => {
  // The defect this guards: `Installed.settings` is the *settled* map, with the
  // manifest's defaults filled in. The pane used to hand that straight back to
  // `updatePlugin`, so the first tick on any row wrote the author's default
  // into `[plugins.<name>.settings]` - and from then on `personSet` could not
  // tell it from a value somebody typed. The pane said "not set, this command
  // will be refused" and the same click made it run (spec §3.2).
  const withDefault = RUNNER.replace('kind  = "text"', 'kind  = "text"\ndefault = "~/somewhere"')
  const [one] = installed(
    [{ name: 'git-activity', manifest: withDefault }],
    runConfigured({ settings: new Map() }),
  )
  // The plugin is still handed the default - that half is by design.
  assert.equal(one?.settings.get('repo'), '~/somewhere')
  // What a writeback carries is empty, because nobody has set anything.
  assert.equal(one?.held.size, 0)
  // And so the command still reads as unbindable, which is the truth.
  assert.equal(one?.run[0]?.binds[0]?.value, null)
})
