// @ts-check

/**
 * Reading a plugin's manifest. Everything a plugin declares about itself
 * arrives here, and nothing else in the app reads that file.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { readManifest } from '../src/core/manifest.js'

test('a manifest says where to start and what it wants', () => {
  const read = readManifest(`
name = "ticket-links"
entry = "index.js"
slots = ["item.badge"]

[permissions]
capabilities = ["shell.open"]
`)
  assert.equal(read.error, null)
  assert.equal(read.entry, 'index.js')
  assert.deepEqual(read.slots, ['item.badge'])
  assert.deepEqual(read.capabilities, ['shell.open'])
  assert.deepEqual(read.notices, [])
})

test('a manifest with no slots declares no slots', () => {
  const read = readManifest('entry = "index.js"')
  assert.equal(read.error, null)
  assert.deepEqual(read.slots, [])
})

test('a slot this app does not offer is dropped, and said out loud', () => {
  // Not fatal: a plugin written against a later version of the planner should
  // still do the parts this version understands.
  const read = readManifest(`
entry = "index.js"
slots = ["item.badge", "theme.tokens"]
`)
  assert.equal(read.error, null)
  assert.deepEqual(read.slots, ['item.badge'])
  assert.equal(read.notices.length, 1)
  assert.match(read.notices[0] ?? '', /theme\.tokens/)
})

test('slots in the wrong shape are a fault, not a guess', () => {
  const read = readManifest(`
entry = "index.js"
slots = "item.badge"
`)
  assert.match(read.error ?? '', /slots/)
})

test('the same slot twice is one slot', () => {
  const read = readManifest(`
entry = "index.js"
slots = ["item.badge", "item.badge"]
`)
  assert.deepEqual(read.slots, ['item.badge'])
})

test('a manifest that will not parse says so', () => {
  const read = readManifest('entry = ')
  assert.match(read.error ?? '', /could not be read/)
})

test('a manifest with no entry does not start', () => {
  const read = readManifest('name = "x"')
  assert.match(read.error ?? '', /which file to start at/)
})

test('an entry that climbs out of the folder is refused', () => {
  for (const entry of ['../secrets.js', '/etc/passwd', 'a/../../b.js']) {
    const read = readManifest(`entry = ${JSON.stringify(entry)}`)
    assert.match(read.error ?? '', /outside the plugin's folder/, entry)
  }
})

test('permissions in the wrong shape are a fault', () => {
  assert.match(readManifest('entry = "i.js"\npermissions = "all"').error ?? '', /permissions/)
  assert.match(
    readManifest('entry = "i.js"\n[permissions]\ncapabilities = "all"').error ?? '',
    /capabilities/,
  )
})

test('a manifest with no permissions asks for nothing', () => {
  const read = readManifest('entry = "index.js"')
  assert.equal(read.error, null)
  assert.deepEqual(read.capabilities, [])
})

test('a manifest says what it may open', () => {
  const read = readManifest(`
entry = "index.js"
[permissions]
capabilities = ["shell.open"]
[permissions.open]
urls = ["https://github.com/gotab-inc/node/pull/"]
`)
  assert.equal(read.error, null)
  assert.deepEqual(read.open, ['https://github.com/gotab-inc/node/pull/'])
})

test('a prefix that is not an address is dropped, and said out loud', () => {
  const read = readManifest(`
entry = "index.js"
[permissions.open]
urls = ["https://ok.example/x/", "file:///etc/"]
`)
  assert.deepEqual(read.open, ['https://ok.example/x/'])
  assert.equal(read.notices.length, 1)
  assert.match(read.notices[0] ?? '', /file:/)
})

test('urls in the wrong shape are a fault', () => {
  const read = readManifest('entry = "i.js"\n[permissions.open]\nurls = "https://x/"')
  assert.match(read.error ?? '', /urls/)
})

test('a manifest that opens nothing has no prefixes', () => {
  assert.deepEqual(readManifest('entry = "i.js"').open, [])
})

test('a manifest declares its own settings, in the order the pane shows them', () => {
  const read = readManifest(`
entry = "index.js"

[settings.pattern]
label   = "Ticket pattern"
kind    = "text"
default = "#(\\\\d+)"

[settings.url]
label = "Ticket URL"
kind  = "text"
hint  = "https://github.com/org/repo/pull/$1"
`)
  assert.equal(read.error, null)
  assert.deepEqual(read.settings.map((one) => one.key), ['pattern', 'url'])
  assert.equal(read.settings[0]?.label, 'Ticket pattern')
  assert.equal(read.settings[0]?.kind, 'text')
  assert.equal(read.settings[0]?.fallback, '#(\\d+)')
  assert.equal(read.settings[1]?.hint, 'https://github.com/org/repo/pull/$1')
  assert.equal(read.settings[1]?.fallback, null)
})

test('the three kinds, and no others', () => {
  for (const kind of ['text', 'count', 'switch']) {
    const read = readManifest(`entry = "i.js"\n[settings.a]\nlabel = "A"\nkind = "${kind}"`)
    assert.equal(read.settings[0]?.kind, kind)
  }
  const read = readManifest('entry = "i.js"\n[settings.a]\nlabel = "A"\nkind = "path"')
  assert.deepEqual(read.settings, [])
  assert.match(read.notices[0] ?? '', /path/)
})

test('a default has to match its kind', () => {
  const read = readManifest('entry = "i.js"\n[settings.a]\nlabel = "A"\nkind = "count"\ndefault = "seven"')
  assert.deepEqual(read.settings, [])
  assert.match(read.notices[0] ?? '', /default/)
})

test('a settings key that could not be a config key is refused', () => {
  // `tomlEdit` writes keys verbatim, and a dotted one would be read back as a
  // path into somebody else's table (spec §1.1).
  const read = readManifest('entry = "i.js"\n[settings.a.b]\nlabel = "A"\nkind = "text"')
  assert.deepEqual(read.settings, [])
  assert.ok(read.notices.length > 0)
})

test('a settings key with no label is not a row anybody could read', () => {
  const read = readManifest('entry = "i.js"\n[settings.a]\nkind = "text"')
  assert.deepEqual(read.settings, [])
  assert.match(read.notices[0] ?? '', /label/)
})

test('a manifest with no settings has none', () => {
  assert.deepEqual(readManifest('entry = "i.js"').settings, [])
})
