// @ts-check

/**
 * `page.note`: what a plugin may put under a day, and what it may name.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { blockForRow, readSections, sectionKey } from '../src/core/sections.js'

const owned = new Map([['meeting-notes', ['meeting']], ['task-notes', ['note']]])
const existing = new Map([['meeting-standup', 'Standup']])

test('a suffix that exists is a block to type in', () => {
  const read = readSections(
    [{ plugin: 'meeting-notes', value: [{ suffix: 'meeting-standup' }] }],
    existing,
    owned,
  )
  assert.deepEqual(read.blocks, [
    { plugin: 'meeting-notes', suffix: 'meeting-standup', title: 'Standup', kind: 'editor' },
  ])
  assert.deepEqual(read.notices, [])
})

test('a suffix that does not exist is an offer under its own title', () => {
  const read = readSections(
    [{ plugin: 'meeting-notes', value: [{ suffix: 'meeting-1-1-with-priya', title: '1:1 with Priya' }] }],
    existing,
    owned,
  )
  assert.deepEqual(read.blocks, [{
    plugin: 'meeting-notes',
    suffix: 'meeting-1-1-with-priya',
    title: '1:1 with Priya',
    kind: 'offer',
  }])
})

test('the title on disk wins over the title the plugin sent', () => {
  // The file has a heading; a plugin cannot rename somebody's note by
  // answering with a different one.
  const read = readSections(
    [{ plugin: 'meeting-notes', value: [{ suffix: 'meeting-standup', title: 'Something else' }] }],
    existing,
    owned,
  )
  assert.equal(read.blocks[0]?.title, 'Standup')
})

test('a plugin may not name a file it does not own', () => {
  const read = readSections(
    [{ plugin: 'meeting-notes', value: [{ suffix: 'note-review', title: 'Review' }] }],
    existing,
    owned,
  )
  assert.deepEqual(read.blocks, [])
  assert.equal(read.notices.length, 1)
  assert.match(read.notices[0] ?? '', /meeting-notes/)
})

test('a plugin with no prefixes at all names nothing', () => {
  const read = readSections(
    [{ plugin: 'a-plugin', value: [{ suffix: 'meeting-standup' }] }],
    existing,
    new Map(),
  )
  assert.deepEqual(read.blocks, [])
  assert.equal(read.notices.length, 1)
})

test('what cannot be read is dropped and counted, once per answer', () => {
  const read = readSections(
    [{
      plugin: 'meeting-notes',
      value: [
        { suffix: 'MEETING-Standup' },
        { suffix: 'meeting-new' },
        'not an object',
        { title: 'no suffix at all' },
        null,
      ],
    }],
    existing,
    owned,
  )
  // `meeting-new` does not exist and carries no title, so it is not an offer
  // either: an offer with no title is a button with nothing written on it.
  assert.deepEqual(read.blocks, [])
  assert.equal(read.notices.length, 1)
  assert.match(read.notices[0] ?? '', /5 blocks/)
})

test('nothing to say is not the wrong shape', () => {
  const read = readSections(
    [{ plugin: 'meeting-notes', value: null }, { plugin: 'task-notes', value: undefined }],
    existing,
    owned,
  )
  assert.deepEqual(read.blocks, [])
  assert.deepEqual(read.notices, [])
})

test('something that is not a list is a line naming who sent it', () => {
  const read = readSections([{ plugin: 'meeting-notes', value: { suffix: 'meeting-standup' } }], existing, owned)
  assert.deepEqual(read.blocks, [])
  assert.equal(read.notices.length, 1)
  assert.match(read.notices[0] ?? '', /not a list/)
})

test('one suffix twice is one block', () => {
  const read = readSections(
    [{ plugin: 'meeting-notes', value: [{ suffix: 'meeting-standup' }, { suffix: 'meeting-standup' }] }],
    existing,
    owned,
  )
  assert.equal(read.blocks.length, 1)
  assert.equal(read.notices.length, 1, 'the second was dropped, and counted')
})

test('a plugin cannot take the whole page', () => {
  const many = Array.from({ length: 20 }, (_, at) => ({ suffix: `meeting-${at}`, title: `Note ${at}` }))
  const read = readSections([{ plugin: 'meeting-notes', value: many }], existing, owned)
  assert.equal(read.blocks.length, 12)
  assert.equal(read.notices.length, 1)
})

test('the key changes when the day does, and when a file appears', () => {
  const before = sectionKey('2026-09-01', new Map([['meeting-standup', 'Standup']]))
  assert.equal(before, sectionKey('2026-09-01', new Map([['meeting-standup', 'Standup']])))
  assert.notEqual(before, sectionKey('2026-09-02', new Map([['meeting-standup', 'Standup']])))
  assert.notEqual(before, sectionKey('2026-09-01', new Map()))
  // A title that changed is a heading that changed, and the plugin is shown
  // titles: asking again is what redraws it.
  assert.notEqual(before, sectionKey('2026-09-01', new Map([['meeting-standup', 'Stand up']])))
})

test('a title of exactly eighty characters is not cut', () => {
  const title = 'a'.repeat(80)
  const existing = new Map([['note-x', title]])
  const owned = new Map([['task-notes', ['note']]])
  const { blocks } = readSections(
    [{ plugin: 'task-notes', value: [{ suffix: 'note-x' }] }],
    existing,
    owned,
  )
  assert.equal(blocks[0]?.title, title)
})

test('a title of eighty-one characters is cut to seventy-nine and an ellipsis', () => {
  const existing = new Map([['note-x', 'b'.repeat(81)]])
  const owned = new Map([['task-notes', ['note']]])
  const { blocks } = readSections(
    [{ plugin: 'task-notes', value: [{ suffix: 'note-x' }] }],
    existing,
    owned,
  )
  assert.equal(blocks[0]?.title, `${'b'.repeat(79)}…`)
})

test('a title is measured in code points, the way Rust measures it', () => {
  // Rust's `title_of` counts `chars()`, so eighty of these is a title it
  // hands over whole. Measured with `.length` this is a hundred and sixty
  // units, and the old cut sliced a string Rust had already decided was
  // short enough - through the middle of a surrogate pair, at that.
  const title = '𝔘'.repeat(80)
  const existing = new Map([['note-x', title]])
  const owned = new Map([['task-notes', ['note']]])
  const { blocks } = readSections(
    [{ plugin: 'task-notes', value: [{ suffix: 'note-x' }] }],
    existing,
    owned,
  )
  assert.equal(blocks[0]?.title, title)
})

/**
 * Two plugins, both contributing timed rows, and both with a meeting called
 * Standup on the day. This is the shape the prefix rule exists for.
 */
const CROSS = new Map([['macos-calendar', ['meeting']], ['macos-reminders', ['remind']]])

/** @type {import('../src/core/sections.js').Block} */
const MEETING = { plugin: 'macos-calendar', suffix: 'meeting-standup', title: 'Standup', kind: 'editor' }

/** @type {import('../src/core/sections.js').Block} */
const REMINDER = { plugin: 'macos-reminders', suffix: 'remind-standup', title: 'Standup', kind: 'offer' }

const BOTH = [MEETING, REMINDER]

test('a row finds the block its own plugin named for it', () => {
  assert.deepEqual(blockForRow('macos-calendar', 'Standup', BOTH, CROSS), MEETING)
  assert.deepEqual(blockForRow('macos-reminders', 'Standup', BOTH, CROSS), REMINDER)
})

test('a row never reaches another plugin\'s file, however alike the titles', () => {
  // The calendar's block is the only one on the day, and the reminder's row
  // is called exactly the same thing. Matching on the suffix alone - or on a
  // prefix name written into the view - opens somebody else's note.
  assert.equal(blockForRow('macos-reminders', 'Standup', [MEETING], CROSS), null)
})

test('a plugin that owns no prefix matches nothing', () => {
  assert.equal(blockForRow('macos-calendar', 'Standup', BOTH, new Map()), null)
})

test('a title that makes no stem names no file', () => {
  // Nothing but punctuation: `suffixFor` gives back `''`, and an empty
  // suffix must not be looked up as if it were one.
  assert.equal(blockForRow('macos-calendar', '!!!', BOTH, CROSS), null)
  assert.equal(blockForRow('macos-calendar', '', BOTH, CROSS), null)
})
