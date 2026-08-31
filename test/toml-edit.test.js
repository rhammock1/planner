// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseToml, getPath } from '../src/core/toml.js'
import { updateToml } from '../src/core/tomlEdit.js'

describe('updating a file in place', () => {
  const config = [
    '# my planner\n',
    'vault             = "~/Planner"\n',
    'theme             = "ledger"   # the good one\n',
    'horizon_lead_days = 7\n',
    '\n',
    '[plugins.macos-calendar]\n',
    'enabled = true\n',
  ].join('')

  test('an existing value is replaced where it stands', () => {
    const next = updateToml(config, [{ path: ['theme'], value: 'console' }])
    assert.match(next, /^theme {13}= "console" {3}# the good one$/m)
  })

  // Everything the app does not know about survives, because the file is
  // edited rather than regenerated (spec §3.6).
  test('comments, alignment and unknown keys are untouched', () => {
    const next = updateToml(config, [{ path: ['theme'], value: 'console' }])
    assert.match(next, /^# my planner$/m)
    assert.match(next, /^vault {13}= "~\/Planner"$/m)
    assert.match(next, /^horizon_lead_days = 7$/m)
  })

  test('a value inside a table is replaced', () => {
    const next = updateToml(config, [{ path: ['plugins', 'macos-calendar', 'enabled'], value: false }])
    assert.equal(getPath(parseToml(next), ['plugins', 'macos-calendar', 'enabled']), false)
    assert.equal(getPath(parseToml(next), ['theme']), 'ledger')
  })

  test('a new key joins the table it belongs to', () => {
    const next = updateToml(config, [{ path: ['plugins', 'macos-calendar', 'approved_capabilities'], value: ['macos.calendar.read'] }])
    assert.deepEqual(getPath(parseToml(next), ['plugins', 'macos-calendar', 'approved_capabilities']), ['macos.calendar.read'])
    assert.equal(getPath(parseToml(next), ['horizon_lead_days']), 7)
  })

  // A root key added while tables exist must not fall inside one, or it
  // silently becomes a different key.
  test('a new root key goes above the first table', () => {
    const next = updateToml(config, [{ path: ['hotkey'], value: 'Alt+Space' }])
    assert.equal(getPath(parseToml(next), ['hotkey']), 'Alt+Space')
    assert.equal(next.indexOf('hotkey') < next.indexOf('[plugins'), true)
  })

  test('a table that does not exist yet is created', () => {
    const next = updateToml(config, [{ path: ['plugins', 'macos-reminders', 'enabled'], value: true }])
    assert.equal(getPath(parseToml(next), ['plugins', 'macos-reminders', 'enabled']), true)
    assert.equal(getPath(parseToml(next), ['plugins', 'macos-calendar', 'enabled']), true)
  })

  test('several changes apply together', () => {
    const next = updateToml(config, [
      { path: ['theme'], value: 'console' },
      { path: ['horizon_lead_days'], value: 14 },
      { path: ['plugins', 'macos-calendar', 'enabled'], value: false },
    ])
    const parsed = parseToml(next)
    assert.equal(getPath(parsed, ['theme']), 'console')
    assert.equal(getPath(parsed, ['horizon_lead_days']), 14)
    assert.equal(getPath(parsed, ['plugins', 'macos-calendar', 'enabled']), false)
  })

  test('every value type writes back readable', () => {
    const next = updateToml('', [
      { path: ['s'], value: 'a "quoted" \\ path' },
      { path: ['n'], value: 7 },
      { path: ['b'], value: false },
      { path: ['a'], value: ['one', 'two'] },
    ])
    assert.deepEqual(parseToml(next), { s: 'a "quoted" \\ path', n: 7, b: false, a: ['one', 'two'] })
  })

  test('an unchanged file comes back byte for byte', () => {
    assert.equal(updateToml(config, []), config)
  })

  test('the file keeps ending in a newline', () => {
    const next = updateToml('theme = "ledger"', [{ path: ['vault'], value: '~/P' }])
    assert.equal(next.endsWith('\n'), true)
  })
})
