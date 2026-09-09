// @ts-check

/**
 * `readProvided`: turning what a plugin sent back for `search.provide` into
 * groups ⌘F can draw, or a notice about why it could not.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readProvided } from '../src/core/provided.js'

const owned = new Map([['meeting-notes', ['meeting']], ['task-notes', ['note']]])

test('a hit is a line, a day and a place to go', () => {
  const read = readProvided([{
    plugin: 'meeting-notes',
    value: [{
      text: 'Daryoush wants the retry to back off',
      date: '2026-09-01',
      href: 'sidecar:2026-09-01/meeting-standup',
    }],
  }], owned)

  assert.deepEqual(read.groups, [{
    plugin: 'meeting-notes',
    hits: [{
      plugin: 'meeting-notes',
      text: 'Daryoush wants the retry to back off',
      date: '2026-09-01',
      href: 'sidecar:2026-09-01/meeting-standup',
    }],
  }])
  assert.deepEqual(read.notices, [])
})

test('a hit needs only its text', () => {
  const read = readProvided([{ plugin: 'meeting-notes', value: [{ text: 'a line' }] }], owned)
  assert.deepEqual(read.groups[0]?.hits, [
    { plugin: 'meeting-notes', text: 'a line', date: null, href: null },
  ])
})

test('a plugin may not point at a file it does not own', () => {
  const read = readProvided([{
    plugin: 'meeting-notes',
    value: [{ text: 'a line', href: 'sidecar:2026-09-01/note-review' }],
  }], owned)
  assert.deepEqual(read.groups, [])
  assert.equal(read.notices.length, 1)
})

test('a URL in a hit is dropped until something needs one', () => {
  const read = readProvided([{
    plugin: 'meeting-notes',
    value: [{ text: 'a line', href: 'https://example.com' }],
  }], owned)
  assert.deepEqual(read.groups, [])
  assert.equal(read.notices.length, 1)
})

test('a line is one line, cut', () => {
  const read = readProvided([{
    plugin: 'meeting-notes',
    value: [{ text: `over\nthree\nlines ${'x'.repeat(300)}` }],
  }], owned)
  const hit = read.groups[0]?.hits[0]
  assert.equal(hit?.text.includes('\n'), false)
  assert.equal(hit?.text.length, 200)
})

test('a date that is not one is dropped, and the hit survives without it', () => {
  const read = readProvided([{ plugin: 'meeting-notes', value: [{ text: 'a line', date: 'yesterday' }] }], owned)
  assert.equal(read.groups[0]?.hits[0]?.date, null)
})

test('twenty is as many as one provider gets', () => {
  const many = Array.from({ length: 30 }, (_, at) => ({ text: `line ${at}` }))
  const read = readProvided([{ plugin: 'meeting-notes', value: many }], owned)
  assert.equal(read.groups[0]?.hits.length, 20)
  assert.equal(read.notices.length, 1)
})

test('a provider with nothing has no group', () => {
  const read = readProvided([
    { plugin: 'meeting-notes', value: [] },
    { plugin: 'task-notes', value: null },
  ], owned)
  assert.deepEqual(read.groups, [])
  assert.deepEqual(read.notices, [])
})

test('something that is not a list is a line naming who sent it', () => {
  const read = readProvided([{ plugin: 'meeting-notes', value: 'a hit' }], owned)
  assert.deepEqual(read.groups, [])
  assert.match(read.notices[0] ?? '', /not a list/)
})
