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
