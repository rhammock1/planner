// @ts-check

/**
 * What a plugin sends is not this app's data. These are the rules it is held
 * to before any of it reaches a page.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { readContributions } from '../src/core/contributions.js'

const DAY = '2026-09-01'

/** @param {unknown[]} items */
function read(items) {
  return readContributions(items, DAY)
}

test('a well-formed event comes through', () => {
  const { events, notices } = read([{ date: DAY, time: '09:30', text: 'Standup' }])
  assert.deepEqual(events, [{ time: '09:30', text: 'Standup' }])
  assert.deepEqual(notices, [])
})

test('another day is not this day, and is not a fault', () => {
  const { events, notices } = read([{ date: '2026-09-02', time: '09:30', text: 'Standup' }])
  assert.deepEqual(events, [])
  assert.deepEqual(notices, [])
})

test('all-day things come first, then the clock', () => {
  const { events } = read([
    { date: DAY, time: '14:00', text: '1:1 with Priya' },
    { date: DAY, time: null, text: 'Labor Day' },
    { date: DAY, time: '09:30', text: 'Standup' },
  ])
  assert.deepEqual(events.map((one) => one.text), ['Labor Day', 'Standup', '1:1 with Priya'])
})

test('two events at the same time keep a settled order', () => {
  const { events } = read([
    { date: DAY, time: '09:00', text: 'Beta' },
    { date: DAY, time: '09:00', text: 'Alpha' },
  ])
  assert.deepEqual(events.map((one) => one.text), ['Alpha', 'Beta'])
})

test('an hour that is not an hour leaves the event without one', () => {
  // The meeting still happened. Only the time was unreadable.
  for (const time of ['half nine', '25:00', '9:30', '09:60', 930, null]) {
    const { events } = read([{ date: DAY, time, text: 'Standup' }])
    assert.deepEqual(events, [{ time: null, text: 'Standup' }], `${time} was read as a time`)
  }
})

test('an event with no readable text is dropped and counted', () => {
  const { events, notices } = read([
    { date: DAY, time: '09:30', text: '   ' },
    { date: DAY, time: '10:00' },
    { date: DAY, time: '11:00', text: 42 },
  ])
  assert.deepEqual(events, [])
  assert.deepEqual(notices, ['A plugin sent 3 lines this app could not read'])
})

test('one bad line reads as a line, not lines', () => {
  assert.deepEqual(read([{ date: DAY }]).notices, ['A plugin sent 1 line this app could not read'])
})

test('anything that is not an item at all is dropped', () => {
  const { events, notices } = read(['a string', 42, null, [], undefined])
  assert.deepEqual(events, [])
  assert.deepEqual(notices, ['A plugin sent 5 lines this app could not read'])
})

test('a date that is not a date is dropped rather than assumed to be today', () => {
  for (const date of ['tomorrow', '2026-9-1', '', 20260901, undefined]) {
    assert.deepEqual(read([{ date, text: 'Standup' }]).events, [], `${date} was accepted`)
  }
})

test('an event cannot decide how many lines of the page it takes', () => {
  const { events } = read([{ date: DAY, text: 'Standup\nand another thing\n\n\nand more' }])
  assert.deepEqual(events, [{ time: null, text: 'Standup and another thing and more' }])
})

test('an event cannot decide how much of the page it takes either', () => {
  const { events } = read([{ date: DAY, text: 'x'.repeat(500) }])
  assert.equal(events[0]?.text.length, 200)
  assert.ok(events[0]?.text.endsWith('…'), 'a cut line does not say it was cut')
})

test('a title exactly at the limit is left alone', () => {
  const { events } = read([{ date: DAY, text: 'x'.repeat(200) }])
  assert.equal(events[0]?.text, 'x'.repeat(200))
})

test('nothing contributed is nothing shown, and nothing said', () => {
  assert.deepEqual(read([]), { events: [], notices: [] })
})

test('a plugin cannot reach into the app through a key it made up', () => {
  // A plain object is built from the fields this app reads, and no others.
  const { events } = read([
    { date: DAY, text: 'Standup', __proto__: { polluted: true }, onclick: 'boom' },
  ])
  assert.deepEqual(events, [{ time: null, text: 'Standup' }])
  assert.equal(Object.keys(events[0] ?? {}).sort().join(','), 'text,time')
})
