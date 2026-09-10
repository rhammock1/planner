// @ts-check

/**
 * What a plugin sent, turned into something a page can show.
 *
 * Everything here arrived from somebody else's code, so the shape is checked,
 * the text is flattened to one line, and anything that does not survive is
 * dropped and counted rather than drawn.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { readContributions, foldsUnderNote } from '../src/core/contributions.js'

const HEADINGS = new Map([
  ['macos-calendar', 'On the calendar'],
  ['git-activity', 'From git'],
])

test('each plugin gets a section of its own, headed by what it said to call it', () => {
  const read = readContributions(
    [
      { plugin: 'git-activity', value: [{ date: '2026-09-02', time: null, text: '6 commits to gotab-inc/node' }] },
      { plugin: 'macos-calendar', value: [{ date: '2026-09-02', time: '09:30', text: 'Standup' }] },
    ],
    '2026-09-02',
    HEADINGS,
  )

  assert.deepEqual(read.sections.map((one) => one.plugin), ['git-activity', 'macos-calendar'])
  assert.deepEqual(read.sections.map((one) => one.heading), ['From git', 'On the calendar'])
  assert.equal(read.sections[0]?.events.length, 1)
  assert.equal(read.sections[1]?.events[0]?.time, '09:30')
  assert.deepEqual(read.notices, [])
})

test('a plugin with nothing for this day has no section at all', () => {
  // Absent rather than empty, per section: a heading over nothing is a
  // section earning its space by lying about having some.
  const read = readContributions(
    [
      { plugin: 'git-activity', value: [] },
      { plugin: 'macos-calendar', value: [{ date: '2026-09-02', time: null, text: 'A holiday' }] },
    ],
    '2026-09-02',
    HEADINGS,
  )
  assert.deepEqual(read.sections.map((one) => one.plugin), ['macos-calendar'])
})

test('a plugin with no heading is headed by its own name', () => {
  const read = readContributions(
    [{ plugin: 'unnamed', value: [{ date: '2026-09-02', time: null, text: 'A line' }] }],
    '2026-09-02',
    new Map(),
  )
  assert.equal(read.sections[0]?.heading, 'unnamed')
})

test('another day is not a fault, and is not on this page', () => {
  const read = readContributions(
    [{ plugin: 'macos-calendar', value: [
      { date: '2026-09-03', time: '09:30', text: 'Tomorrow' },
      { date: '2026-09-02', time: '09:30', text: 'Today' },
    ] }],
    '2026-09-02',
    HEADINGS,
  )
  assert.deepEqual(read.sections[0]?.events.map((one) => one.text), ['Today'])
  assert.deepEqual(read.notices, [])
})

test('the same line twice from one plugin is one line', () => {
  const read = readContributions(
    [{ plugin: 'macos-calendar', value: [
      { date: '2026-09-02', time: null, text: 'A holiday' },
      { date: '2026-09-02', time: null, text: 'A holiday' },
    ] }],
    '2026-09-02',
    HEADINGS,
  )
  assert.equal(read.sections[0]?.events.length, 1)
})

test('the same line from two plugins is two lines, because they are labelled', () => {
  // Deduplication is inside a section, not across them. Two sections each say
  // who spoke, so the same sentence under two headings is information.
  const read = readContributions(
    [
      { plugin: 'git-activity', value: [{ date: '2026-09-02', time: null, text: 'Same' }] },
      { plugin: 'macos-calendar', value: [{ date: '2026-09-02', time: null, text: 'Same' }] },
    ],
    '2026-09-02',
    HEADINGS,
  )
  assert.equal(read.sections.length, 2)
})

test('all-day things come first, then the clock, then the text', () => {
  const read = readContributions(
    [{ plugin: 'macos-calendar', value: [
      { date: '2026-09-02', time: '14:00', text: 'Later' },
      { date: '2026-09-02', time: null, text: 'A holiday' },
      { date: '2026-09-02', time: '09:00', text: 'Earlier' },
    ] }],
    '2026-09-02',
    HEADINGS,
  )
  assert.deepEqual(read.sections[0]?.events.map((one) => one.text), ['A holiday', 'Earlier', 'Later'])
})

test('a plugin that did not answer with a list is named, once', () => {
  const read = readContributions(
    [{ plugin: 'macos-calendar', value: { date: '2026-09-02' } }],
    '2026-09-02',
    HEADINGS,
  )
  assert.deepEqual(read.sections, [])
  assert.equal(read.notices.length, 1)
  assert.match(read.notices[0] ?? '', /macos-calendar/)
})

test('lines this app cannot read are counted, per plugin, and never drawn', () => {
  const read = readContributions(
    [{ plugin: 'macos-calendar', value: [
      { date: '2026-09-02', time: null, text: 'Kept' },
      { date: 'not a date', text: 'Dropped' },
      { date: '2026-09-02', text: '' },
      'not even an object',
    ] }],
    '2026-09-02',
    HEADINGS,
  )
  assert.deepEqual(read.sections[0]?.events.map((one) => one.text), ['Kept'])
  assert.equal(read.notices.length, 1)
  assert.match(read.notices[0] ?? '', /macos-calendar sent 3 lines/)
})

test('a title is one line, however many the plugin sent', () => {
  const read = readContributions(
    [{ plugin: 'macos-calendar', value: [
      { date: '2026-09-02', time: null, text: `Standup\nand${' x'.repeat(400)}` },
    ] }],
    '2026-09-02',
    HEADINGS,
  )
  const text = read.sections[0]?.events[0]?.text ?? ''
  assert.equal(text.includes('\n'), false)
  assert.equal(text.length, 200)
})

test('an hour this app cannot read is a line without a time, not a dropped line', () => {
  const read = readContributions(
    [{ plugin: 'macos-calendar', value: [{ date: '2026-09-02', time: '25:00', text: 'Standup' }] }],
    '2026-09-02',
    HEADINGS,
  )
  assert.equal(read.sections[0]?.events[0]?.time, null)
  assert.deepEqual(read.notices, [])
})

test('a section with no times folds under the day note', () => {
  assert.equal(foldsUnderNote({
    plugin: 'git-activity',
    heading: 'From Git',
    events: [{ time: null, text: '3 commits to repos/node' }],
  }), true)
})

test('a section with a time keeps its own section', () => {
  assert.equal(foldsUnderNote({
    plugin: 'macos-calendar',
    heading: 'On the calendar',
    events: [{ time: '08:45', text: 'Nahla Allergy Shot' }],
  }), false)
})

test('one timed event is enough to keep a section', () => {
  assert.equal(foldsUnderNote({
    plugin: 'mixed',
    heading: 'Mixed',
    events: [{ time: null, text: 'all day' }, { time: '14:00', text: 'timed' }],
  }), false)
})

test('a section with nothing in it folds, and shows nothing either way', () => {
  assert.equal(foldsUnderNote({ plugin: 'quiet', heading: 'Quiet', events: [] }), true)
})
