// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseToml, getPath } from '../src/core/toml.js'
import {
  DEFAULTS, DEFAULT_CONFIG_TEXT, readConfig, updateConfig, updatePlugin, expandHome,
} from '../src/core/config.js'

/** @typedef {import('../src/core/toml.js').TomlValue} TomlValue */

describe('defaults', () => {
  test('an empty file is every default, with nothing to report', () => {
    const { config, notices } = readConfig('')
    assert.deepEqual(config, DEFAULTS)
    assert.deepEqual(notices, [])
  })

  test('the file written on first run reads back as the defaults', () => {
    const { config, notices } = readConfig(DEFAULT_CONFIG_TEXT)
    assert.deepEqual(config, DEFAULTS)
    assert.deepEqual(notices, [])
  })

  test('the defaults are the ones the spec names', () => {
    assert.equal(DEFAULTS.vault, '~/Planner')
    assert.equal(DEFAULTS.theme, 'ledger')
    assert.equal(DEFAULTS.hotkey, 'Alt+Space')
    assert.equal(DEFAULTS.horizonLeadDays, 7)
    assert.equal(DEFAULTS.carryForwardScanDays, 30)
    assert.equal(DEFAULTS.menuBarCount, true)
    assert.equal(DEFAULTS.menuBarHorizonDot, true)
    assert.equal(DEFAULTS.editor, '')
  })
})

describe('reading', () => {
  test('every setting comes off the file', () => {
    const { config } = readConfig([
      'vault = "~/Notes"\n',
      'theme = "console"\n',
      'hotkey = "Ctrl+Space"\n',
      'horizon_lead_days = 14\n',
      'carry_forward_scan_days = 5\n',
      'menu_bar_count = false\n',
      'menu_bar_horizon_dot = false\n',
      'editor = "nvim"\n',
    ].join(''))
    assert.deepEqual(config, {
      vault: '~/Notes', theme: 'console', hotkey: 'Ctrl+Space',
      horizonLeadDays: 14, carryForwardScanDays: 5,
      menuBarCount: false, menuBarHorizonDot: false, editor: 'nvim',
      plugins: new Map(),
    })
  })

  test('a partial file keeps the defaults for everything else', () => {
    const { config, notices } = readConfig('theme = "console"\n')
    assert.equal(config.theme, 'console')
    assert.equal(config.horizonLeadDays, 7)
    assert.deepEqual(notices, [])
  })

  test('plugin sections come back keyed by name', () => {
    const { config } = readConfig([
      '[plugins.macos-calendar]\n',
      'enabled = true\n',
      'approved_capabilities = ["macos.calendar.read"]\n',
      '\n',
      '[plugins.macos-reminders]\n',
      'enabled = false\n',
    ].join(''))
    assert.deepEqual([...config.plugins.keys()], ['macos-calendar', 'macos-reminders'])
    assert.deepEqual(config.plugins.get('macos-calendar'), {
      enabled: true, approvedSlots: [], approvedCapabilities: ['macos.calendar.read'], approvedOpen: [],
      approvedMoves: [],
      approvedRun: new Map(),
      settings: new Map(),
    })
    assert.deepEqual(config.plugins.get('macos-reminders'), {
      enabled: false, approvedSlots: [], approvedCapabilities: [], approvedOpen: [], approvedMoves: [], approvedRun: new Map(), settings: new Map(),
    })
  })

  // A plugin name is user-supplied. A plain object would let one called
  // __proto__ reach somewhere it has no business being.
  test('a plugin cannot be named into the prototype', () => {
    const { config } = readConfig('[plugins.__proto__]\nenabled = true\n')
    assert.equal(config.plugins.get('__proto__')?.enabled, true)
    assert.equal(/** @type {any} */ ({}).enabled, undefined)
  })
})

describe('a file the app cannot use', () => {
  // Spec §8: a malformed config falls back to defaults with a visible notice
  // rather than refusing to start.
  test('an unparseable file gives the defaults and says why', () => {
    const { config, notices } = readConfig('theme "ledger"\n')
    assert.deepEqual(config, DEFAULTS)
    assert.equal(notices.length, 1)
    assert.match(notices[0] ?? '', /line 1/)
  })

  test('a setting of the wrong type falls back alone', () => {
    const { config, notices } = readConfig('theme = 7\nhorizon_lead_days = 14\n')
    assert.equal(config.theme, 'ledger')
    assert.equal(config.horizonLeadDays, 14)
    assert.equal(notices.length, 1)
    assert.match(notices[0] ?? '', /theme/)
  })

  test('a count that is not a whole number falls back', () => {
    const { config, notices } = readConfig('horizon_lead_days = -1\ncarry_forward_scan_days = 1.5\n')
    assert.equal(config.horizonLeadDays, 7)
    assert.equal(config.carryForwardScanDays, 30)
    assert.equal(notices.length, 2)
  })

  test('a plugin section that is not a table is reported, not obeyed', () => {
    const { config, notices } = readConfig('plugins = "yes"\n')
    assert.deepEqual([...config.plugins.keys()], [])
    assert.equal(notices.length, 1)
  })

  test('a plugin entry with a bad field falls back for that field only', () => {
    const { config, notices } = readConfig([
      '[plugins.macos-calendar]\n',
      'enabled = "yes"\n',
      'approved_capabilities = ["macos.calendar.read"]\n',
    ].join(''))
    assert.deepEqual(config.plugins.get('macos-calendar'), {
      enabled: false, approvedSlots: [], approvedCapabilities: ['macos.calendar.read'], approvedOpen: [],
      approvedMoves: [],
      approvedRun: new Map(),
      settings: new Map(),
    })
    assert.equal(notices.length, 1)
    assert.match(notices[0] ?? '', /macos-calendar/)
  })
})

describe('writing', () => {
  test('a change lands in the file and reads back', () => {
    const next = updateConfig(DEFAULT_CONFIG_TEXT, { theme: 'console', horizonLeadDays: 14 })
    const { config, notices } = readConfig(next)
    assert.equal(config.theme, 'console')
    assert.equal(config.horizonLeadDays, 14)
    assert.deepEqual(notices, [])
  })

  test('keys the app does not know about are left where they are', () => {
    const text = 'theme = "ledger"\nexperimental_thing = "keep me"\n'
    const next = updateConfig(text, { theme: 'console' })
    assert.equal(getPath(parseToml(next), ['experimental_thing']), 'keep me')
  })

  test('an empty patch changes nothing', () => {
    assert.equal(updateConfig(DEFAULT_CONFIG_TEXT, {}), DEFAULT_CONFIG_TEXT)
  })

  test('a setting missing from the file is added', () => {
    const next = updateConfig('theme = "ledger"\n', { editor: 'nvim' })
    assert.equal(readConfig(next).config.editor, 'nvim')
  })
})

// The first run has no config file at all, so what gets written is the
// commented default with the chosen folder in it (spec §8).
describe('choosing a folder on the first run', () => {
  test('the chosen path lands in the default file', () => {
    const written = updateConfig(DEFAULT_CONFIG_TEXT, { vault: '/Users/someone/Notes/Planner' })
    assert.equal(readConfig(written).config.vault, '/Users/someone/Notes/Planner')
  })

  test('the comments the default file ships with survive it', () => {
    const written = updateConfig(DEFAULT_CONFIG_TEXT, { vault: '/tmp/pages' })
    assert.ok(written.includes('# planner - settings.'), 'the header comment was lost')
    assert.ok(written.includes('# remaining count on the icon'), 'an inline comment was lost')
  })

  test('nothing else in the file moves', () => {
    const written = updateConfig(DEFAULT_CONFIG_TEXT, { vault: '/tmp/pages' })
    const before = readConfig(DEFAULT_CONFIG_TEXT).config
    const after = readConfig(written).config
    assert.equal(after.theme, before.theme)
    assert.equal(after.hotkey, before.hotkey)
    assert.equal(after.horizonLeadDays, before.horizonLeadDays)
  })
})

// The settings pane writes these, and `config.toml` is still the file
// (spec §3.6, §7).
describe('switching a plugin on and off', () => {
  test('a plugin the file has never mentioned gets a section of its own', () => {
    const written = updatePlugin(DEFAULT_CONFIG_TEXT, 'macos-calendar', {
      enabled: true,
      approvedSlots: [],
      approvedCapabilities: ['macos.calendar.read'],
      approvedOpen: [],
      approvedMoves: [],
      approvedRun: new Map(),
      settings: new Map(),
    })
    const settings = readConfig(written).config.plugins.get('macos-calendar')
    assert.deepEqual(settings, {
      enabled: true, approvedSlots: [], approvedCapabilities: ['macos.calendar.read'], approvedOpen: [],
      approvedMoves: [],
      approvedRun: new Map(),
      settings: new Map(),
    })
  })

  test('switching one off leaves what it was approved for alone', () => {
    const on = updatePlugin(DEFAULT_CONFIG_TEXT, 'macos-calendar', {
      enabled: true,
      approvedSlots: [],
      approvedCapabilities: ['macos.calendar.read'],
      approvedOpen: [],
      approvedMoves: [],
      approvedRun: new Map(),
      settings: new Map(),
    })
    const off = updatePlugin(on, 'macos-calendar', {
      enabled: false,
      approvedSlots: [],
      approvedCapabilities: ['macos.calendar.read'],
      approvedOpen: [],
      approvedMoves: [],
      approvedRun: new Map(),
      settings: new Map(),
    })
    assert.deepEqual(readConfig(off).config.plugins.get('macos-calendar'), {
      enabled: false,
      approvedSlots: [],
      approvedCapabilities: ['macos.calendar.read'],
      approvedOpen: [],
      approvedMoves: [],
      approvedRun: new Map(),
      settings: new Map(),
    })
  })

  test('taking a capability away leaves the plugin switched on', () => {
    const on = updatePlugin(DEFAULT_CONFIG_TEXT, 'macos-calendar', {
      enabled: true,
      approvedSlots: [],
      approvedCapabilities: ['macos.calendar.read'],
      approvedOpen: [],
      approvedMoves: [],
      approvedRun: new Map(),
      settings: new Map(),
    })
    const none = updatePlugin(on, 'macos-calendar', {
      enabled: true, approvedSlots: [], approvedCapabilities: [], approvedOpen: [], approvedMoves: [], approvedRun: new Map(), settings: new Map(),
    })
    assert.deepEqual(readConfig(none).config.plugins.get('macos-calendar'), {
      enabled: true,
      approvedSlots: [],
      approvedCapabilities: [],
      approvedOpen: [],
      approvedMoves: [],
      approvedRun: new Map(),
      settings: new Map(),
    })
  })

  test('the rest of the file is untouched', () => {
    const written = updatePlugin(DEFAULT_CONFIG_TEXT, 'macos-calendar', {
      enabled: true,
      approvedSlots: [],
      approvedCapabilities: [],
      approvedOpen: [],
      approvedMoves: [],
      approvedRun: new Map(),
      settings: new Map(),
    })
    assert.ok(written.includes('# planner - settings.'), 'the header comment was lost')
    assert.equal(readConfig(written).config.theme, 'ledger')
  })

  test('two plugins keep their own sections', () => {
    let text = updatePlugin(DEFAULT_CONFIG_TEXT, 'macos-calendar', {
      enabled: true, approvedSlots: [], approvedCapabilities: ['a'], approvedOpen: [], approvedMoves: [], approvedRun: new Map(), settings: new Map(),
    })
    text = updatePlugin(text, 'macos-reminders', {
      enabled: false, approvedSlots: [], approvedCapabilities: ['b'], approvedOpen: [], approvedMoves: [], approvedRun: new Map(), settings: new Map(),
    })
    const plugins = readConfig(text).config.plugins
    assert.deepEqual(plugins.get('macos-calendar'), {
      enabled: true, approvedSlots: [], approvedCapabilities: ['a'], approvedOpen: [], approvedMoves: [], approvedRun: new Map(), settings: new Map(),
    })
    assert.deepEqual(plugins.get('macos-reminders'), {
      enabled: false, approvedSlots: [], approvedCapabilities: ['b'], approvedOpen: [], approvedMoves: [], approvedRun: new Map(), settings: new Map(),
    })
  })

  test('a plugin section says what it approves opening', () => {
    const written = updatePlugin(DEFAULT_CONFIG_TEXT, 'ticket-links', {
      enabled: true,
      approvedSlots: ['item.badge'],
      approvedCapabilities: ['shell.open'],
      approvedOpen: ['https://github.com/gotab-inc/node/pull/'],
      approvedMoves: [],
      approvedRun: new Map(),
      settings: new Map(),
    })
    assert.deepEqual(readConfig(written).config.plugins.get('ticket-links'), {
      enabled: true,
      approvedSlots: ['item.badge'],
      approvedCapabilities: ['shell.open'],
      approvedOpen: ['https://github.com/gotab-inc/node/pull/'],
      approvedMoves: [],
      approvedRun: new Map(),
      settings: new Map(),
    })
  })

  test('an empty approved_open is written out, not left off', () => {
    // `tomlEdit` cannot delete a key, so an empty list is written rather than
    // omitted - an absent key would otherwise read back the same as an empty
    // one, hiding "never asked" behind "asked, and approved for nothing".
    const written = updatePlugin(DEFAULT_CONFIG_TEXT, 'ticket-links', {
      enabled: true, approvedSlots: [], approvedCapabilities: [], approvedOpen: [], approvedMoves: [], approvedRun: new Map(), settings: new Map(),
    })
    assert.match(written, /approved_open\s*=\s*\[\]/)
  })
})

test('a plugin section says which slots it approves', () => {
  const { config } = readConfig(`
[plugins.ticket-links]
enabled = true
approved_slots = ["item.badge"]
approved_capabilities = ["shell.open"]
`)
  const plugin = config.plugins.get('ticket-links')
  assert.deepEqual(plugin?.approvedSlots, ['item.badge'])
  assert.deepEqual(plugin?.approvedCapabilities, ['shell.open'])
})

test('a plugin section with no approved_slots approves none', () => {
  // What an upgrade looks like: the key has never been written. The plugin
  // runs and is asked nothing until somebody ticks the sentence.
  const { config } = readConfig('[plugins.ticket-links]\nenabled = true\n')
  assert.deepEqual(config.plugins.get('ticket-links')?.approvedSlots, [])
})

test('approved_slots in the wrong shape is empty, and says so', () => {
  const { config, notices } = readConfig(`
[plugins.ticket-links]
enabled = true
approved_slots = "item.badge"
`)
  assert.deepEqual(config.plugins.get('ticket-links')?.approvedSlots, [])
  assert.ok(notices.some((line) => /approved_slots/.test(line)))
})

test('a plugin section says which addresses it approves opening', () => {
  const { config } = readConfig(`
[plugins.ticket-links]
enabled = true
approved_open = ["https://github.com/gotab-inc/node/pull/"]
`)
  assert.deepEqual(
    config.plugins.get('ticket-links')?.approvedOpen,
    ['https://github.com/gotab-inc/node/pull/'],
  )
})

test('a plugin section with no approved_open approves nothing to open', () => {
  const { config } = readConfig('[plugins.ticket-links]\nenabled = true\n')
  assert.deepEqual(config.plugins.get('ticket-links')?.approvedOpen, [])
})

test('approved_open in the wrong shape is empty, and says so', () => {
  const { config, notices } = readConfig(`
[plugins.ticket-links]
enabled = true
approved_open = "https://github.com/gotab-inc/node/pull/"
`)
  assert.deepEqual(config.plugins.get('ticket-links')?.approvedOpen, [])
  assert.ok(notices.some((line) => /approved_open/.test(line)))
})

test('writing a plugin writes all three lists', () => {
  const written = updatePlugin('', 'ticket-links', {
    enabled: true,
    approvedSlots: ['item.badge'],
    approvedCapabilities: ['shell.open'],
    approvedOpen: ['https://github.com/gotab-inc/node/pull/'],
    approvedMoves: [],
    approvedRun: new Map(),
    settings: new Map(),
  })
  assert.match(written, /approved_slots\s*=\s*\["item\.badge"\]/)
  assert.match(written, /approved_capabilities\s*=\s*\["shell\.open"\]/)
  assert.match(written, /approved_open\s*=\s*\["https:\/\/github\.com\/gotab-inc\/node\/pull\/"\]/)
})

describe('expandHome', () => {
  test('a leading tilde becomes the home directory', () => {
    assert.equal(expandHome('~/Planner', '/Users/rob'), '/Users/rob/Planner')
    assert.equal(expandHome('~', '/Users/rob'), '/Users/rob')
  })

  test('anything else is left alone', () => {
    assert.equal(expandHome('/srv/planner', '/Users/rob'), '/srv/planner')
    assert.equal(expandHome('./relative', '/Users/rob'), './relative')
    assert.equal(expandHome('~notrob/x', '/Users/rob'), '~notrob/x')
  })
})

test('a plugin section holds the plugin own settings, unvalidated', () => {
  const { config } = readConfig(`
[plugins.ticket-links]
enabled = true

[plugins.ticket-links.settings]
pattern = "#(\\\\d+)"
depth   = 3
loud    = true
`)
  const held = config.plugins.get('ticket-links')?.settings
  assert.equal(held?.get('pattern'), '#(\\d+)')
  assert.equal(held?.get('depth'), 3)
  assert.equal(held?.get('loud'), true)
})

test('a plugin with no settings table has an empty map, not undefined', () => {
  const { config } = readConfig('[plugins.ticket-links]\nenabled = true\n')
  assert.equal(config.plugins.get('ticket-links')?.settings.size, 0)
})

test('the settings table is a Map, so a setting called __proto__ is a setting', () => {
  const { config } = readConfig(`
[plugins.x]
enabled = true
[plugins.x.settings]
__proto__ = "no"
`)
  assert.equal(config.plugins.get('x')?.settings.get('__proto__'), 'no')
})

test('writing settings writes one key each, under the plugin own table', () => {
  const written = updatePlugin('', 'ticket-links', {
    enabled: true,
    approvedSlots: [],
    approvedCapabilities: [],
    approvedOpen: [],
    approvedMoves: [],
    approvedRun: new Map(),
    settings: new Map(/** @type {[string, TomlValue][]} */ ([['pattern', '#(\\d+)'], ['depth', 3]])),
  })
  assert.match(written, /\[plugins\.ticket-links\.settings\]/)
  assert.match(written, /pattern\s*=\s*"#\(\\\\d\+\)"/)
  assert.match(written, /depth\s*=\s*3/)
})

test('a plugin whose folder cannot be a plugin name is never written to the config', () => {
  const before = 'vault = "~/Planner"\n'
  // The whole reason the name rule exists: `tomlEdit` writes a header
  // verbatim, so this would open a table belonging to somebody else.
  const after = updatePlugin(before, 'x]\n[plugins.other', {
    enabled: true,
    approvedSlots: [],
    approvedCapabilities: [],
    approvedOpen: [],
    approvedMoves: [],
    approvedRun: new Map(),
    settings: new Map(),
  })

  assert.equal(after, before)
})

test('a plugin section carries the commands it approved, as lines', () => {
  const read = readConfig(`
[plugins.git-activity]
enabled = true

[plugins.git-activity.run]
log = "git -C {repo=settings.repo} log"
`)
  const plugin = read.config.plugins.get('git-activity')
  assert.equal(plugin?.approvedRun.get('log'), 'git -C {repo=settings.repo} log')
})

test('a run entry that is not a line is not an approval', () => {
  const read = readConfig(`
[plugins.git-activity]
enabled = true

[plugins.git-activity.run]
log = 4
`)
  assert.equal(read.config.plugins.get('git-activity')?.approvedRun.has('log'), false)
})

test('approving a command writes its line under its name', () => {
  const written = updatePlugin('', 'git-activity', {
    enabled: true,
    approvedSlots: [],
    approvedCapabilities: ['shell.run'],
    approvedOpen: [],
    approvedMoves: [],
    approvedRun: new Map([['log', 'git -C {repo=settings.repo} log']]),
    settings: new Map(),
  })
  assert.match(written, /\[plugins\.git-activity\.run\]/)
  assert.match(written, /log = "git -C \{repo=settings\.repo\} log"/)
})

test('unticking a command writes an empty line, which is never an approval', () => {
  // `tomlEdit` cannot delete a key (spec §1.6), and an empty string can never
  // equal a rendered command line - so the leftover key reads as not
  // approved, which is exactly what it means.
  const written = updatePlugin(`
[plugins.git-activity.run]
log = "git -C {repo=settings.repo} log"
`, 'git-activity', {
    enabled: true,
    approvedSlots: [],
    approvedCapabilities: [],
    approvedOpen: [],
    approvedMoves: [],
    approvedRun: new Map([['log', '']]),
    settings: new Map(),
  })
  assert.match(written, /log = ""/)
})
