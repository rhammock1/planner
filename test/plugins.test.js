// @ts-check

/**
 * Which plugins start, and what they are handed when they do.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { plan } from '../src/core/plugins.js'

/** @typedef {import('../src/core/config.js').PluginConfig} PluginConfig */

const MANIFEST = `
name = "macos-calendar"
version = "0.1.0"
entry = "index.js"

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
      approvedCapabilities: settings?.approvedCapabilities ?? ['macos.calendar.read'],
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
    { name: 'macos-calendar', entry: 'index.js', capabilities: ['macos.calendar.read'] },
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
    'macos-calendar asks for macos.calendar.read, which config.toml has not approved',
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
    'config.toml approves fs.read for macos-calendar, which does not ask for it',
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
  settings.set('broken', { enabled: true, approvedCapabilities: [] })

  const { start, notices } = plan(broken, settings)

  assert.deepEqual(start.map((one) => one.name), ['macos-calendar'])
  assert.equal(notices.length, 1)
  assert.match(notices[0] ?? '', /^broken: manifest\.toml could not be read/)
})

test('a manifest with no entry does not start', () => {
  const { start, notices } = plan(folders('name = "x"'), configured())
  assert.deepEqual(start, [])
  assert.deepEqual(notices, ['macos-calendar: manifest.toml does not say which file to start at'])
})

test('an entry that climbs out of the folder does not start', () => {
  for (const entry of ['../../../etc/passwd', '/etc/passwd', 'a/../../b.js']) {
    const { start, notices } = plan(folders(`entry = "${entry}"`), configured())
    assert.deepEqual(start, [], `${entry} was allowed`)
    assert.match(notices[0] ?? '', /outside the plugin's folder/)
  }
})

test('a manifest asking for permissions in the wrong shape does not start', () => {
  for (const permissions of ['[permissions]\ncapabilities = "fs.read"', 'permissions = 3']) {
    const { start } = plan(folders(`entry = "index.js"\n${permissions}`), configured())
    assert.deepEqual(start, [], `${permissions} was allowed`)
  }
})

test('a manifest with no permissions at all is granted nothing', () => {
  const { start, notices } = plan(
    folders('entry = "index.js"'),
    configured({ approvedCapabilities: [] }),
  )
  assert.deepEqual(start, [{ name: 'macos-calendar', entry: 'index.js', capabilities: [] }])
  assert.deepEqual(notices, [])
})
