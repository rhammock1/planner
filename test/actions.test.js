// @ts-check

import assert from 'node:assert/strict'
import test from 'node:test'

import { readActions, routeTo } from '../src/core/actions.js'

/** The one plugin in these tests, and the one prefix it owns. */
const OWNED = new Map([['task-notes', ['note']]])

test('an answer naming a sidecar the plugin owns is an opening', () => {
  const { openings, notices } = readActions(
    [{ plugin: 'task-notes', value: { open: 'sidecar:2026-09-01/note-review-pr-4412' } }],
    OWNED,
  )
  assert.deepEqual(openings, [{ plugin: 'task-notes', date: '2026-09-01', suffix: 'note-review-pr-4412' }])
  assert.deepEqual(notices, [])
})

test('a plugin cannot name another plugin\'s file', () => {
  const { openings, notices } = readActions(
    [{ plugin: 'task-notes', value: { open: 'sidecar:2026-09-01/meeting-standup' } }],
    OWNED,
  )
  assert.deepEqual(openings, [])
  assert.equal(notices.length, 1)
})

test('a plugin that owns no prefix at all opens nothing', () => {
  // What a plugin left owning nothing by an overlapping claim looks like from
  // here: it answers, and every answer is refused.
  const { openings } = readActions(
    [{ plugin: 'task-notes', value: { open: 'sidecar:2026-09-01/note-x' } }],
    new Map(),
  )
  assert.deepEqual(openings, [])
})

test('an href that is not a sidecar ref is refused', () => {
  for (const open of ['https://example.com/', 'sidecar:not-a-date/note-x', 'sidecar:2026-09-01', '', 'note-x']) {
    const { openings } = readActions([{ plugin: 'task-notes', value: { open } }], OWNED)
    assert.deepEqual(openings, [], `${open} should not open anything`)
  }
})

test('a handler that answers with nothing is answering', () => {
  // Not the same as the wrong shape: nothing to open is a legitimate answer,
  // and must not put a notice on the page.
  for (const value of [null, undefined]) {
    const { openings, notices } = readActions([{ plugin: 'task-notes', value }], OWNED)
    assert.deepEqual(openings, [])
    assert.deepEqual(notices, [])
  }
})

test('a shape that is not an object with an open string is counted', () => {
  for (const value of [[], 'sidecar:2026-09-01/note-x', 42, {}, { open: 7 }]) {
    const { openings, notices } = readActions([{ plugin: 'task-notes', value }], OWNED)
    assert.deepEqual(openings, [])
    assert.equal(notices.length, 1, `${JSON.stringify(value)} should be counted once`)
  }
})

test('two plugins answering is two openings, and the caller decides', () => {
  // This version opens one and says so; the shape stays a list so the pick
  // list spec §4.3 describes is a view rather than a rewrite.
  const { openings } = readActions(
    [
      { plugin: 'task-notes', value: { open: 'sidecar:2026-09-01/note-x' } },
      { plugin: 'other-notes', value: { open: 'sidecar:2026-09-01/jot-x' } },
    ],
    new Map([['task-notes', ['note']], ['other-notes', ['jot']]]),
  )
  assert.equal(openings.length, 2)
})

test('a note on the day you are looking at is shown where you are', () => {
  assert.deepEqual(
    routeTo({ date: '2026-09-01', suffix: 'note-x' }, '2026-09-01', true),
    { go: null, create: false },
  )
})

test('a note on an earlier day takes you to that day', () => {
  // The carried-line case: the line is on today's page, the note it points at
  // was written a week ago and stays there.
  assert.deepEqual(
    routeTo({ date: '2026-09-01', suffix: 'note-x' }, '2026-09-08', true),
    { go: '2026-09-01', create: false },
  )
})

test('a note that does not exist is made on the page you are looking at', () => {
  assert.deepEqual(
    routeTo({ date: '2026-09-08', suffix: 'note-x' }, '2026-09-08', false),
    { go: null, create: true },
  )
})

test('a file is never made on a day you are not looking at', () => {
  // Decision 3, enforced rather than trusted: a plugin answering with a date
  // of its own choosing cannot put a file in the vault on a day nobody can
  // see it appear on.
  assert.equal(routeTo({ date: '2026-09-01', suffix: 'note-x' }, '2026-09-08', false), null)
  assert.equal(routeTo({ date: '2099-01-01', suffix: 'note-x' }, '2026-09-08', false), null)
})
