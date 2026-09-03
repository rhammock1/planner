// @ts-check

/**
 * Which plugins start, and what they are handed when they do.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { plan, installed, isPluginName, diff, signature } from '../src/core/plugins.js'

/** @typedef {import('../src/core/config.js').PluginConfig} PluginConfig */

const MANIFEST = `
name = "macos-calendar"
version = "0.1.0"
entry = "index.js"
slots = ["vault.contribute"]

[permissions]
capabilities = ["macos.calendar.read"]
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
      settings: settings?.settings ?? new Map(),
    },
  ]])
}

/** @param {string} [manifest] */
function folders(manifest) {
  return [{ name: 'macos-calendar', manifest: manifest ?? MANIFEST }]
}

test('a plugin the config enables starts with what both files agree on', () => {
  const { start, notices } = plan(folders(), configured())

  assert.deepEqual(start, [
    {
      name: 'macos-calendar',
      entry: 'index.js',
      slots: ['vault.contribute'],
      capabilities: ['macos.calendar.read'],
      open: [],
      settings: new Map(),
    },
  ])
  assert.deepEqual(notices, [])
})

test('a plugin the config does not mention does not start', () => {
  assert.deepEqual(plan(folders(), new Map()).start, [])
})

test('a plugin sitting in the folder switched off does not start, and says nothing', () => {
  const { start, notices } = plan(folders(), configured({ enabled: false }))
  // Installed and off is how a plugin waits. It is not a fault to report.
  assert.deepEqual(start, [])
  assert.deepEqual(notices, [])
})

test('a capability the config never approved is not granted, and is said out loud', () => {
  const { start, notices } = plan(folders(), configured({ approvedCapabilities: [] }))

  assert.deepEqual(start[0]?.capabilities, [])
  assert.deepEqual(notices, [
    'macos-calendar asks for the macos.calendar.read capability, which config.toml has not approved',
  ])
})

test('the manifest is the ceiling: the config cannot widen it', () => {
  const { start, notices } = plan(
    folders(),
    configured({ approvedCapabilities: ['macos.calendar.read', 'fs.read'] }),
  )

  // Approving something the plugin never asked for hands it nothing.
  assert.deepEqual(start[0]?.capabilities, ['macos.calendar.read'])
  assert.deepEqual(notices, [
    'config.toml approves the fs.read capability for macos-calendar, which does not ask for it',
  ])
})

test('a plugin still starts when a capability is refused', () => {
  // Half a calendar plugin is a plugin that says it cannot see the calendar.
  // Refusing to start it would leave nothing to say so.
  const { start } = plan(folders(), configured({ approvedCapabilities: [] }))
  assert.equal(start.length, 1)
})

test('a manifest that will not parse stops that plugin and nothing else', () => {
  const broken = [
    { name: 'broken', manifest: 'entry = ' },
    { name: 'macos-calendar', manifest: MANIFEST },
  ]
  const settings = configured()
  settings.set('broken', {
    enabled: true, approvedSlots: [], approvedCapabilities: [], approvedOpen: [], settings: new Map(),
  })

  const { start, notices } = plan(broken, settings)

  assert.deepEqual(start.map((one) => one.name), ['macos-calendar'])
  assert.equal(notices.length, 1)
  assert.match(notices[0] ?? '', /^broken: manifest\.toml could not be read/)
})

// The settings pane lists what is there, on or off - a folder that is
// switched off is exactly the one you opened the pane to switch on.

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
    problem: null,
    schema: [],
    settings: new Map(),
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
    problem: null,
    schema: [],
    settings: new Map(),
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

test('a folder whose name is not a plugin name never starts', () => {
  const bad = [{ name: 'Ticket Links', manifest: MANIFEST }]
  const configured = new Map([
    ['Ticket Links', {
      enabled: true, approvedSlots: [], approvedCapabilities: [], approvedOpen: [], settings: new Map(),
    }],
  ])
  const { start, notices } = plan(bad, configured)

  assert.deepEqual(start, [])
  assert.deepEqual(notices, [
    'Ticket Links: the folder name may only be lowercase letters, digits and hyphens, starting with a letter or a digit',
  ])
})

test('a badly named folder that is switched off says nothing', () => {
  const bad = [{ name: 'Ticket Links', manifest: MANIFEST }]
  // Installed and off is how a plugin waits, whatever it is called.
  assert.deepEqual(plan(bad, new Map()).notices, [])
})

test('what a plugin folder may be called', () => {
  for (const name of ['a', 'ticket-links', 'macos-calendar', 'x9', '0', 'a'.repeat(64)]) {
    assert.equal(isPluginName(name), true, `${name} was refused`)
  }
  for (const name of [
    '',
    '-leading',
    'Upper',
    'under_score',
    'dot.ted',
    'space here',
    'x]\n[plugins.other',
    '../escape',
    'a'.repeat(65),
    'café',
  ]) {
    assert.equal(isPluginName(name), false, `${name} was allowed`)
  }
})

test('a plugin is granted the slots both files agree on', () => {
  const { start } = plan(folders(), configured())
  assert.deepEqual(start[0]?.slots, ['vault.contribute'])
})

test('a slot the config has not approved is not granted, and is said out loud', () => {
  const { start, notices } = plan(folders(), configured({ approvedSlots: [] }))
  // The plugin still runs. It is simply never asked that question.
  assert.equal(start.length, 1)
  assert.deepEqual(start[0]?.slots, [])
  assert.equal(notices.length, 1)
  assert.match(notices[0] ?? '', /vault\.contribute/)
})

test('the manifest is the ceiling for slots too', () => {
  const { start, notices } = plan(
    folders(),
    configured({ approvedSlots: ['vault.contribute', 'item.badge'] }),
  )
  assert.deepEqual(start[0]?.slots, ['vault.contribute'])
  assert.equal(notices.length, 1)
  assert.match(notices[0] ?? '', /item\.badge/)
})

test('a slot this planner does not offer never reaches the config', () => {
  const manifest = `
entry = "index.js"
slots = ["vault.contribute", "theme.tokens"]
`
  const { start, notices } = plan(
    folders(manifest),
    // This manifest declares no permissions, so approvedCapabilities is
    // dropped to [] here - otherwise the default capability in configured()
    // would add its own, unrelated disagreement to notices.
    configured({ approvedSlots: ['vault.contribute', 'theme.tokens'], approvedCapabilities: [] }),
  )
  assert.deepEqual(start[0]?.slots, ['vault.contribute'])
  // Exactly one line for theme.tokens - the manifest's own notice. Nothing
  // about the config approving something the manifest no longer asks for,
  // because a slot this app has never heard of is not the person's mistake -
  // and a second notice would directly contradict the first.
  assert.deepEqual(notices, [
    'macos-calendar: manifest.toml asks for the theme.tokens slot, which this planner does not offer',
  ])
})

test('a slot the manifest never mentions is still a config mistake worth a notice', () => {
  // Unlike the case above, nothing here already told the person about
  // theme.tokens - the manifest never brought it up at all - so this is the
  // one notice that has to carry it, not a redundant second line.
  const manifest = 'entry = "index.js"'
  const { start, notices } = plan(
    folders(manifest),
    configured({ approvedSlots: ['theme.tokens'], approvedCapabilities: [] }),
  )
  assert.deepEqual(start[0]?.slots, [])
  assert.deepEqual(notices, [
    'config.toml approves the theme.tokens slot for macos-calendar, which does not ask for it',
  ])
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

const OPENS = `
entry = "index.js"
[permissions.open]
urls = ["https://github.com/gotab-inc/node/pull/"]
`

test('a plugin is granted the addresses both files agree on', () => {
  const { start } = plan(
    folders(OPENS),
    configured({ approvedOpen: ['https://github.com/gotab-inc/node/pull/'], approvedCapabilities: [] }),
  )
  assert.deepEqual(start[0]?.open, ['https://github.com/gotab-inc/node/pull/'])
})

test('an address the config has not approved is not granted, and is said out loud', () => {
  const { start, notices } = plan(
    folders(OPENS),
    configured({ approvedSlots: [], approvedCapabilities: [] }),
  )
  assert.equal(start.length, 1)
  assert.deepEqual(start[0]?.open, [])
  assert.equal(notices.length, 1)
  assert.match(notices[0] ?? '', /gotab-inc\/node\/pull/)
})

test('the manifest is the ceiling for addresses too', () => {
  const { start, notices } = plan(
    folders(OPENS),
    configured({
      approvedSlots: [],
      approvedOpen: ['https://github.com/gotab-inc/node/pull/', 'https://evil.example/x/'],
      approvedCapabilities: [],
    }),
  )
  assert.deepEqual(start[0]?.open, ['https://github.com/gotab-inc/node/pull/'])
  assert.equal(notices.length, 1)
  assert.match(notices[0] ?? '', /evil\.example/)
})

test('the pane is shown what a plugin asks to open', () => {
  const [listed] = installed(folders(OPENS), configured({ approvedSlots: [], approvedCapabilities: [] }))
  assert.deepEqual(listed?.open, ['https://github.com/gotab-inc/node/pull/'])
  assert.deepEqual(listed?.approvedOpen, [])
})

/** @param {Partial<import('../src/core/plugins.js').Start>} [over] */
function started(over) {
  return {
    name: over?.name ?? 'ticket-links',
    entry: over?.entry ?? 'index.js',
    slots: over?.slots ?? ['item.badge'],
    capabilities: over?.capabilities ?? ['shell.open'],
    open: over?.open ?? [],
    settings: over?.settings ?? new Map(),
  }
}

test('the same plugin, written two ways, has one signature', () => {
  // Order is not a difference. A config that lists two approvals the other way
  // round would otherwise restart every plugin at every launch.
  assert.equal(
    signature(started({ slots: ['item.badge'], capabilities: ['shell.open', 'a.b'] })),
    signature(started({ slots: ['item.badge'], capabilities: ['a.b', 'shell.open'] })),
  )
})

test('anything different is a different signature', () => {
  const base = signature(started())
  assert.notEqual(base, signature(started({ entry: 'main.js' })))
  assert.notEqual(base, signature(started({ slots: [] })))
  assert.notEqual(base, signature(started({ capabilities: [] })))
})

test('a plan with something new starts it', () => {
  const { stop, start } = diff(new Map(), [started()])
  assert.deepEqual(stop, [])
  assert.deepEqual(start.map((one) => one.name), ['ticket-links'])
})

test('a plugin no longer planned is stopped', () => {
  const running = new Map([['ticket-links', signature(started())]])
  const { stop, start } = diff(running, [])
  assert.deepEqual(stop, ['ticket-links'])
  assert.deepEqual(start, [])
})

test('a plugin running exactly as planned is left alone', () => {
  const running = new Map([['ticket-links', signature(started())]])
  const { stop, start } = diff(running, [started()])
  assert.deepEqual(stop, [])
  assert.deepEqual(start, [])
})

test('a plugin whose record changed is stopped and started again', () => {
  const running = new Map([['ticket-links', signature(started())]])
  const { stop, start } = diff(running, [started({ capabilities: [] })])
  assert.deepEqual(stop, ['ticket-links'])
  assert.deepEqual(start.map((one) => one.name), ['ticket-links'])
})

test('what is stopped comes back in a settled order', () => {
  const running = new Map([['zulu', 'x'], ['alpha', 'x']])
  assert.deepEqual(diff(running, []).stop, ['alpha', 'zulu'])
})

const SCHEMA = `
entry = "index.js"
slots = ["item.badge"]

[settings.pattern]
label   = "Ticket pattern"
kind    = "text"
default = "#(\\\\d+)"

[settings.depth]
label = "How far back"
kind  = "count"
`

test('a setting the person has not set falls back to the manifest default', () => {
  const { start } = plan(folders(SCHEMA), configured())
  assert.equal(start[0]?.settings.get('pattern'), '#(\\d+)')
})

test('a setting with no default and no value is simply absent', () => {
  const { start } = plan(folders(SCHEMA), configured())
  assert.equal(start[0]?.settings.has('depth'), false)
})

test('a value the person set wins over the default', () => {
  const config = configured()
  const macosCalendar = config.get('macos-calendar')
  assert.ok(macosCalendar)
  macosCalendar.settings = new Map([['pattern', 'TICKET-(\\d+)']])
  const { start } = plan(folders(SCHEMA), config)
  assert.equal(start[0]?.settings.get('pattern'), 'TICKET-(\\d+)')
})

test('a value of the wrong kind is dropped, the default used, and a line said', () => {
  const config = configured()
  const macosCalendar = config.get('macos-calendar')
  assert.ok(macosCalendar)
  macosCalendar.settings = new Map([['depth', 'lots']])
  const { start, notices } = plan(folders(SCHEMA), config)
  assert.equal(start[0]?.settings.has('depth'), false)
  assert.ok(notices.some((line) => /depth/.test(line)))
})

test('a setting the manifest never declared is not handed to the plugin', () => {
  // The manifest is the ceiling here too: a key in config.toml the plugin
  // knows nothing about is a typo, not a permission.
  const config = configured()
  const macosCalendar = config.get('macos-calendar')
  assert.ok(macosCalendar)
  macosCalendar.settings = new Map([['pattren', 'oops']])
  const { start } = plan(folders(SCHEMA), config)
  assert.equal(start[0]?.settings.has('pattren'), false)
})

test('changing a setting changes the signature, so the plugin restarts', () => {
  const config = configured()
  const first = plan(folders(SCHEMA), config).start[0]
  assert.ok(first)
  const before = signature(first)

  const macosCalendar = config.get('macos-calendar')
  assert.ok(macosCalendar)
  macosCalendar.settings = new Map([['pattern', 'X-(\\d+)']])

  const second = plan(folders(SCHEMA), config).start[0]
  assert.ok(second)
  assert.notEqual(before, signature(second))
})
