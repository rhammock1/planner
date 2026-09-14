// @ts-check

/**
 * Which plugins start, and what they are handed when they do.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { plan, isPluginName, vaultFolder, diff, signature } from '../src/core/plugins.js'

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
      approvedMoves: settings?.approvedMoves ?? [],
      approvedRun: new Map(),
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
      run: [],
      asked: ['macos.calendar.read'],
      askedRun: [],
      prefixes: [],
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
    enabled: true, approvedSlots: [], approvedCapabilities: [], approvedOpen: [], approvedMoves: [], approvedRun: new Map(), settings: new Map(),
  })

  const { start, notices } = plan(broken, settings)

  assert.deepEqual(start.map((one) => one.name), ['macos-calendar'])
  assert.equal(notices.length, 1)
  assert.match(notices[0] ?? '', /^broken: manifest\.toml could not be read/)
})

// The settings pane lists what is there, on or off - a folder that is
// switched off is exactly the one you opened the pane to switch on.

test('a folder whose name is not a plugin name never starts', () => {
  const bad = [{ name: 'Ticket Links', manifest: MANIFEST }]
  const configured = new Map([
    ['Ticket Links', {
      enabled: true, approvedSlots: [], approvedCapabilities: [], approvedOpen: [],
    approvedMoves: [], approvedRun: new Map(), settings: new Map(),
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
slots = ["vault.contribute", "page.footer"]
`
  const { start, notices } = plan(
    folders(manifest),
    // This manifest declares no permissions, so approvedCapabilities is
    // dropped to [] here - otherwise the default capability in configured()
    // would add its own, unrelated disagreement to notices.
    configured({ approvedSlots: ['vault.contribute', 'page.footer'], approvedCapabilities: [] }),
  )
  assert.deepEqual(start[0]?.slots, ['vault.contribute'])
  // Exactly one line for theme.tokens - the manifest's own notice. Nothing
  // about the config approving something the manifest no longer asks for,
  // because a slot this app has never heard of is not the person's mistake -
  // and a second notice would directly contradict the first.
  assert.deepEqual(notices, [
    'macos-calendar: manifest.toml asks for the page.footer slot, which this planner does not offer',
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
      approvedMoves: [],
      approvedRun: new Map(),
      approvedCapabilities: [],
    }),
  )
  assert.deepEqual(start[0]?.open, ['https://github.com/gotab-inc/node/pull/'])
  assert.equal(notices.length, 1)
  assert.match(notices[0] ?? '', /evil\.example/)
})

/** @param {Partial<import('../src/core/plugins.js').Start>} [over] */
function started(over) {
  return {
    name: over?.name ?? 'ticket-links',
    entry: over?.entry ?? 'index.js',
    slots: over?.slots ?? ['item.badge'],
    capabilities: over?.capabilities ?? ['shell.open'],
    open: over?.open ?? [],
    run: over?.run ?? [],
    asked: over?.asked ?? ['shell.open'],
    askedRun: over?.askedRun ?? [],
    prefixes: over?.prefixes ?? [],
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

const SETTINGS_URL = `
entry = "index.js"
[permissions.open]
urls = ["settings.url"]

[settings.url]
label = "Ticket URL"
kind  = "text"
`

test('an address named by a setting with no value resolves to no prefix, and one notice', () => {
  const { start, notices } = plan(
    folders(SETTINGS_URL),
    configured({ approvedSlots: [], approvedCapabilities: [] }),
  )
  assert.deepEqual(start[0]?.open, [])
  assert.equal(notices.length, 1)
  assert.match(notices[0] ?? '', /url has not been set/)
})

test('an address named by a setting with a value resolves to the cut prefix', () => {
  const config = configured({
    approvedSlots: [],
    approvedCapabilities: [],
    approvedOpen: ['https://git.example/org/repo/pull/'],
    approvedMoves: [],
    approvedRun: new Map(),
  })
  const macosCalendar = config.get('macos-calendar')
  assert.ok(macosCalendar)
  macosCalendar.settings = new Map([['url', 'https://git.example/org/repo/pull/$1']])

  const { start, notices } = plan(folders(SETTINGS_URL), config)
  assert.deepEqual(start[0]?.open, ['https://git.example/org/repo/pull/'])
  assert.deepEqual(notices, [])
})

test('changing the setting an address depends on changes the signature, so the plugin restarts', () => {
  const config = configured({
    approvedSlots: [],
    approvedCapabilities: [],
    approvedOpen: ['https://git.example/org/repo/pull/', 'https://other.example/x/'],
    approvedMoves: [],
    approvedRun: new Map(),
  })
  const macosCalendar = config.get('macos-calendar')
  assert.ok(macosCalendar)

  macosCalendar.settings = new Map([['url', 'https://git.example/org/repo/pull/$1']])
  const before = plan(folders(SETTINGS_URL), config).start[0]
  assert.ok(before)

  macosCalendar.settings = new Map([['url', 'https://other.example/x/$1']])
  const after = plan(folders(SETTINGS_URL), config).start[0]
  assert.ok(after)

  assert.notEqual(signature(before), signature(after))
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
 * `configured` above is the calendar's; this one is the runner's. Two
 * manifests with different settings and different approvals cannot share a
 * fixture without one of them being written in terms of the other's defaults.
 *
 * @param {Partial<import('../src/core/config.js').PluginConfig>} [patch]
 * @returns {Map<string, import('../src/core/config.js').PluginConfig>}
 */
function runConfigured(patch) {
  return new Map([['git-activity', {
    enabled: true,
    approvedSlots: [],
    approvedCapabilities: ['shell.run'],
    approvedOpen: [],
    approvedMoves: [],
    approvedRun: new Map([['log', LINE]]),
    settings: new Map([['repo', '~/gotab/node']]),
    ...patch,
  }]])
}

test('a command approved as written is granted, with its bindings settled', () => {
  const result = plan([{ name: 'git-activity', manifest: RUNNER }], runConfigured())
  const [start] = result.start
  assert.deepEqual(start?.run, [{
    name: 'log',
    command: ['git', '-C', '{repo}', 'log', '--since={from} 00:00'],
    binds: [
      { name: 'repo', rule: 'setting', key: 'repo', value: '~/gotab/node' },
      { name: 'from', rule: 'date' },
    ],
  }])
})

test('a command whose line no longer matches the manifest is not granted', () => {
  const result = plan(
    [{ name: 'git-activity', manifest: RUNNER }],
    runConfigured({ approvedRun: new Map([['log', 'git -C {repo} log']]) }),
  )
  assert.deepEqual(result.start[0]?.run, [])
  assert.equal(result.notices.length, 1)
  assert.match(result.notices[0] ?? '', /log/)
})

test('a command nobody approved is not granted', () => {
  const result = plan(
    [{ name: 'git-activity', manifest: RUNNER }],
    runConfigured({ approvedRun: new Map() }),
  )
  assert.deepEqual(result.start[0]?.run, [])
})

test('a setting that is only the manifest default does not bind', () => {
  // A default is the author's string, and the pane is meant to show the
  // person's. The command is still granted - it is the call that is refused,
  // in Rust, which is what lets the pane say the setting is not set.
  const withDefault = RUNNER.replace('kind  = "text"', 'kind  = "text"\ndefault = "~/somewhere"')
  const result = plan(
    [{ name: 'git-activity', manifest: withDefault }],
    runConfigured({ settings: new Map() }),
  )
  assert.deepEqual(result.start[0]?.run[0]?.binds[0], {
    name: 'repo', rule: 'setting', key: 'repo', value: null,
  })
  // The default still reaches the plugin's own `planner.settings`; it is only
  // binding a command that it cannot do.
  assert.equal(result.start[0]?.settings.get('repo'), '~/somewhere')
})

test('a setting of the wrong kind is not a value the person set', () => {
  const result = plan(
    [{ name: 'git-activity', manifest: RUNNER }],
    runConfigured({ settings: new Map([['repo', 4]]) }),
  )
  // Narrowed rather than optional-chained: `GrantedBind` is a union and only
  // its `setting` half has a value, so `binds[0]?.value` is an error on the
  // other half rather than a null.
  const bound = result.start[0]?.run[0]?.binds[0]
  assert.ok(bound !== undefined && bound.rule === 'setting')
  assert.equal(bound.value, null)
})

test('a command ticked without shell.run grants nothing, and says so', () => {
  // The trap this closes: Rust checks the capability before it looks at the
  // command, and that refusal is a strike. Somebody who ticks the git command
  // and leaves the plain `shell.run` box alone - which is the reasonable
  // instinct, the specific line looking like the sensitive one - would
  // otherwise see a ✓ in the pane and get their plugin put away on the third
  // ask (spec §1.2).
  const result = plan(
    [{ name: 'git-activity', manifest: RUNNER }],
    runConfigured({ approvedCapabilities: [] }),
  )
  assert.deepEqual(result.start[0]?.run, [])
  assert.ok(result.notices.some((line) => /shell\.run/.test(line)))
})

test('a plugin restarts when a command it may run changes', () => {
  const one = plan([{ name: 'git-activity', manifest: RUNNER }], runConfigured())
  const two = plan([{ name: 'git-activity', manifest: RUNNER }], runConfigured({ approvedRun: new Map() }))
  const first = one.start[0]
  const second = two.start[0]
  assert.ok(first !== undefined && second !== undefined)
  assert.notEqual(signature(first), signature(second))
})

test('a plugin restarts when the value bound into a command changes', () => {
  // Against `signature` directly rather than through `plan`, because two
  // configs that differ in a setting already differ in `start.settings` - so
  // the same test written through `plan` would pass with the run clause
  // deleted, which is not a test of the run clause.
  const base = {
    name: 'git-activity', entry: 'index.js',
    slots: [], capabilities: [], open: [], asked: [], askedRun: [], prefixes: [], settings: new Map(),
  }
  /** @param {string|null} value */
  const bound = (value) => ({
    ...base,
    run: [{
      name: 'log',
      command: ['git', '-C', '{repo}'],
      binds: [{
        name: 'repo', rule: /** @type {'setting'} */ ('setting'), key: 'repo', value,
      }],
    }],
  })
  assert.notEqual(signature(bound('~/gotab/node')), signature(bound('~/elsewhere')))
  assert.notEqual(signature(bound('~/gotab/node')), signature(bound(null)))
})

test('a field added to a Start is a field the signature reads', () => {
  // `signature` is written out by hand, so a field added to `Start` and
  // forgotten in it produces a plugin that keeps running with its old grant
  // and says nothing.
  //
  // The guard is driven off a real `Start` rather than off a list kept beside
  // it: a list would be a second place to add the field to, and forgetting
  // *that* is the same bug wearing a different hat.
  const start = plan([{ name: 'git-activity', manifest: RUNNER }], runConfigured()).start[0]
  assert.ok(start !== undefined)

  const base = signature(start)
  /** Something of the right shape, so the check is "was it read" and not
   *  "did it throw". @param {unknown} held */
  const otherwise = (held) => {
    if (held instanceof Map) return new Map([...held, ['other', 'value']])
    if (Array.isArray(held)) {
      return held.length > 0 && typeof held[0] === 'object'
        ? [...held, { name: 'other', command: ['other'], binds: [] }]
        : [...held, 'other']
    }
    return `${String(held)} other`
  }
  for (const field of /** @type {(keyof typeof start)[]} */ (Object.keys(start))) {
    const changed = { ...start, [field]: otherwise(start[field]) }
    assert.notEqual(
      signature(/** @type {any} */ (changed)), base,
      `signature does not read ${field}`,
    )
  }
})

test('the plan settles a contested prefix in name order', () => {
  const folders = [
    { name: 'zebra-notes', manifest: 'entry = "index.js"\n\n[sidecars]\nprefixes = ["meeting"]\n' },
    { name: 'meeting-notes', manifest: 'entry = "index.js"\n\n[sidecars]\nprefixes = ["meeting"]\n' },
  ]
  const configured = new Map([
    ['zebra-notes', { enabled: true, approvedSlots: [], approvedCapabilities: [], approvedOpen: [], approvedRun: new Map(), approvedMoves: [], settings: new Map() }],
    ['meeting-notes', { enabled: true, approvedSlots: [], approvedCapabilities: [], approvedOpen: [], approvedRun: new Map(), approvedMoves: [], settings: new Map() }],
  ])

  const planned = plan(folders, configured)
  const byName = new Map(planned.start.map((one) => [one.name, one]))
  assert.deepEqual(byName.get('meeting-notes')?.prefixes, ['meeting'])
  assert.deepEqual(byName.get('zebra-notes')?.prefixes, [])
  assert.ok(planned.notices.some((one) => one.includes('zebra-notes') && one.includes('meeting')))
})

test('a plugin that is switched off does not hold a prefix', () => {
  const folders = [
    { name: 'a-notes', manifest: 'entry = "index.js"\n\n[sidecars]\nprefixes = ["meeting"]\n' },
    { name: 'b-notes', manifest: 'entry = "index.js"\n\n[sidecars]\nprefixes = ["meeting"]\n' },
  ]
  const configured = new Map([
    ['a-notes', { enabled: false, approvedSlots: [], approvedCapabilities: [], approvedOpen: [], approvedRun: new Map(), approvedMoves: [], settings: new Map() }],
    ['b-notes', { enabled: true, approvedSlots: [], approvedCapabilities: [], approvedOpen: [], approvedRun: new Map(), approvedMoves: [], settings: new Map() }],
  ])

  const planned = plan(folders, configured)
  assert.deepEqual(planned.start.map((one) => one.name), ['b-notes'])
  assert.deepEqual(planned.start[0]?.prefixes, ['meeting'], 'nobody else is holding it')
})

test('a changed prefix restarts the plugin', () => {
  const one = { name: 'a', entry: 'index.js', slots: [], capabilities: [], open: [], run: [], asked: [], askedRun: [], prefixes: ['meeting'], settings: new Map() }
  const other = { ...one, prefixes: ['note'] }
  assert.notEqual(signature(one), signature(other))
})

test('a plugin owns the folder in the vault its own name makes', () => {
  assert.equal(vaultFolder('kanban'), 'kanban')
  assert.equal(vaultFolder('task-notes'), 'task-notes')
  assert.equal(vaultFolder('a'), 'a')
})

test('a name that begins with a digit owns no folder in the vault', () => {
  // The whole reason this rule is stricter than the plugin-folder one. A
  // folder called `2026` *is* a year folder, and the vault scanner would walk
  // into it looking for months (spec §2.5).
  assert.equal(vaultFolder('2026'), null)
  assert.equal(vaultFolder('2026-planner'), null)
  // And it is still a perfectly good plugin folder, which is the point: the
  // plugin runs, it simply keeps nothing in the vault.
  assert.equal(isPluginName('2026'), true)
})

test('someday owns no folder in the vault', () => {
  // Not a collision - `someday.md` is a file and a directory sits beside it
  // quite happily. A vault holding both is one nobody can read at a glance.
  assert.equal(vaultFolder('someday'), null)
  assert.equal(vaultFolder('someday-notes'), 'someday-notes')
})

test('a name that is not a plugin name owns no folder in the vault either', () => {
  for (const name of ['', 'Kanban', 'kan ban', 'kan/ban', '..', '-kanban', 'k'.repeat(65)]) {
    assert.equal(vaultFolder(name), null, `${name} was given a folder`)
  }
})

test('a board plugin whose name owns no folder is told, in the rule\'s own words', () => {
  const folders = [{ name: '2026', manifest: 'entry = "index.js"\nslots = ["spread.board"]\n' }]
  const configured = new Map([['2026', {
    enabled: true,
    approvedSlots: ['spread.board'],
    approvedCapabilities: [], approvedOpen: [], approvedMoves: [], approvedRun: new Map(), settings: new Map(),
  }]])

  const planned = plan(folders, configured)
  // It still starts, with its slot: the board has nowhere to keep a file, and
  // that is a smaller thing than the plugin not running.
  assert.deepEqual(planned.start.map((one) => one.name), ['2026'])
  assert.deepEqual(planned.start[0]?.slots, ['spread.board'])
  assert.ok(
    planned.notices.some((one) => one.includes('2026') && one.includes('begin with a letter')),
    `no notice naming the rule: ${planned.notices.join(' | ')}`,
  )
})

test('a plugin that keeps no board is not told about a folder it never wanted', () => {
  // Every plugin may own one and almost none want one, so a notice on every
  // name that fails would be a page of complaints about nothing.
  const folders = [{ name: '2026', manifest: 'entry = "index.js"\nslots = ["item.badge"]\n' }]
  const configured = new Map([['2026', {
    enabled: true,
    approvedSlots: ['item.badge'],
    approvedCapabilities: [], approvedOpen: [], approvedMoves: [], approvedRun: new Map(), settings: new Map(),
  }]])

  assert.deepEqual(plan(folders, configured).notices, [])
})

test('a board plugin whose slot nobody ticked is not told about the folder', () => {
  // The notice is about a slot that cannot work. An unticked slot does not
  // work for a reason the person already knows and is already told - saying
  // both would read as two problems where there is one decision.
  const folders = [{ name: '2026', manifest: 'entry = "index.js"\nslots = ["spread.board"]\n' }]
  const configured = new Map([['2026', {
    enabled: true,
    approvedSlots: [],
    approvedCapabilities: [], approvedOpen: [], approvedMoves: [], approvedRun: new Map(), settings: new Map(),
  }]])

  const { notices } = plan(folders, configured)
  assert.deepEqual(notices, ['2026 asks for the spread.board slot, which config.toml has not approved'])
})
