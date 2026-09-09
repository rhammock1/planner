// @ts-check

/**
 * Reading a plugin's manifest. Everything a plugin declares about itself
 * arrives here, and nothing else in the app reads that file.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { readManifest, slotOptions, optionText, optionNames } from '../src/core/manifest.js'

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
slots = ["item.badge", "page.footer"]
`)
  assert.equal(read.error, null)
  assert.deepEqual(read.slots, ['item.badge'])
  assert.equal(read.notices.length, 1)
  assert.match(read.notices[0] ?? '', /page\.footer/)
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

test('a slot that needs telling something has one table, named for its last word', () => {
  const read = readManifest(`
entry = "index.js"
slots = ["vault.contribute"]

[contribute]
heading = "From git"
`)
  assert.equal(read.error, null)
  assert.deepEqual(slotOptions(read, 'vault.contribute'), { heading: 'From git' })
  // A slot that was not declared is not asked, so its table is not read
  // either - a manifest cannot smuggle options in for a question nobody puts.
  assert.deepEqual(slotOptions(read, 'item.badge'), {})
})

test('an options table for a slot the manifest never declared is not read', () => {
  const read = readManifest(`
entry = "index.js"
slots = ["item.badge"]

[contribute]
heading = "From git"
`)
  assert.deepEqual(slotOptions(read, 'vault.contribute'), {})
})

test('an options key that is not a table is a line, not a refusal', () => {
  const read = readManifest(`
entry = "index.js"
slots = ["vault.contribute"]
contribute = "From git"
`)
  assert.equal(read.error, null)
  assert.deepEqual(slotOptions(read, 'vault.contribute'), {})
  assert.equal(read.notices.length, 1)
  assert.match(read.notices[0] ?? '', /contribute/)
})

test('an option that is text is one line, cut, and never markup', () => {
  const long = 'x'.repeat(60)
  const read = readManifest(`
entry = "index.js"
slots = ["vault.contribute"]

[contribute]
heading = "From\\ngit   log ${long}"
`)
  const heading = optionText(slotOptions(read, 'vault.contribute'), 'heading', 40)
  assert.equal(heading.includes('\n'), false)
  assert.equal(heading.length, 40)
  assert.match(heading, /^From git log x+…$/)
})

test('an option that is missing, or is not text, reads as nothing', () => {
  const read = readManifest(`
entry = "index.js"
slots = ["vault.contribute"]

[contribute]
heading = 4
`)
  assert.equal(optionText(slotOptions(read, 'vault.contribute'), 'heading', 40), '')
  assert.equal(optionText(slotOptions(read, 'vault.contribute'), 'missing', 40), '')
})

test('an option that is a list of names keeps only the strings', () => {
  // `moves` is not one of `vault.contribute`'s options and is not meant to be:
  // these readers are handed an options table and a key, and know nothing
  // about which slot has which. The first real `moves` is `theme.tokens`'s, in
  // PR #6 - written against this, and this is where it is proved.
  const read = readManifest(`
entry = "index.js"
slots = ["vault.contribute"]

[contribute]
moves = ["paper", "ink", "paper"]
`)
  // Declared twice is declared once, the same way `slots` is.
  assert.deepEqual(optionNames(slotOptions(read, 'vault.contribute'), 'moves'), ['paper', 'ink'])
  assert.deepEqual(optionNames(slotOptions(read, 'vault.contribute'), 'heading'), [])
  // A 4 is not a name and is simply not there. Handed to the reader directly,
  // because `core/toml.js` will not parse a mixed array at all - a manifest
  // holding one is refused whole, well before this reader is reached.
  assert.deepEqual(optionNames({ moves: /** @type {any} */ (['paper', 4, 'ink']) }, 'moves'), ['paper', 'ink'])
})

test('a manifest that declares commands carries them, rendered', () => {
  const read = readManifest(`
entry = "index.js"

[permissions]
capabilities = ["shell.run"]

[permissions.run.log]
command = ["git", "-C", "{repo}", "log"]
repo    = "settings.repo"
`)
  assert.equal(read.error, null)
  assert.deepEqual(read.run.map((one) => one.name), ['log'])
  assert.equal(read.run[0]?.line, 'git -C {repo=settings.repo} log')
})

test('a permissions.run that is not a table stops the plugin', () => {
  const read = readManifest('entry = "index.js"\n\n[permissions]\nrun = "git log"\n')
  assert.match(read.error ?? '', /permissions\.run/)
})

test('a plugin declares the prefixes it owns', () => {
  const read = readManifest([
    'entry = "index.js"',
    'slots = ["page.section"]',
    '',
    '[sidecars]',
    'prefixes = ["meeting", "standup"]',
  ].join('\n'))

  assert.equal(read.error, null)
  assert.deepEqual(read.prefixes, ['meeting', 'standup'])
})

test('a prefix that cannot make a filename is dropped with a line', () => {
  const read = readManifest([
    'entry = "index.js"',
    '',
    '[sidecars]',
    'prefixes = ["Meeting", "a-very-long-prefix-indeed", "meeting"]',
  ].join('\n'))

  assert.deepEqual(read.prefixes, ['meeting'])
  assert.equal(read.notices.length, 2)
  assert.ok(read.notices.some((one) => one.includes('Meeting')))
  assert.ok(read.notices.some((one) => one.includes('a-very-long-prefix-indeed')))
})

test('no sidecars table means no prefixes, and nothing to say about it', () => {
  const read = readManifest('entry = "index.js"\n')
  assert.deepEqual(read.prefixes, [])
  assert.deepEqual(read.notices, [])
})

test('a sidecars table that is not a table earns a line', () => {
  const read = readManifest('entry = "index.js"\nsidecars = "meeting"\n')
  assert.deepEqual(read.prefixes, [])
  assert.equal(read.notices.length, 1)
})
