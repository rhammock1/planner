// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseEntry } from '../src/core/nldate.js'
import { describeEntry } from '../src/views/entryPreview.js'

// A Monday.
const TODAY = '2026-08-31'

/** @param {string} input */
const preview = (input) => describeEntry(parseEntry(input, TODAY), TODAY)

describe('what the field says back', () => {
  test('a line with nothing to read says nothing', () => {
    assert.equal(preview('Order the Pi Zero'), '')
  })

  test('days with names of their own use them', () => {
    assert.equal(preview('dentist today'), 'Today')
    assert.equal(preview('dentist tomorrow'), 'Tomorrow')
  })

  // en-GB abbreviates September as "Sept"; the day page uses the same locale,
  // which is the one the approved mockups were drawn in.
  test('the week ahead is named by its weekday', () => {
    assert.equal(preview('dentist friday'), 'Friday 4 Sept')
  })

  test('further out is a date', () => {
    assert.equal(preview('dentist in 20 days'), '20 Sept')
  })

  test('another year says so', () => {
    assert.equal(preview('dentist 1/5'), '5 Jan 2027')
  })

  test('a time comes after the day', () => {
    assert.equal(preview('pair with Dana tomorrow at 10:30'), 'Tomorrow, 10:30')
  })

  test('a time on its own is enough', () => {
    assert.equal(preview('standup at 9'), '09:00')
  })

  // The reading worth seeing before it is committed: an unqualified 4 in a
  // planner means the afternoon.
  test('an unqualified hour shows what it was taken to mean', () => {
    assert.equal(preview('call at 4'), '16:00')
  })

  test('a deadline is named as one', () => {
    assert.equal(preview('firmware sign-off by friday'), 'due Friday 4 Sept')
  })

  test('a day and a deadline both show', () => {
    assert.equal(preview('start the checklist tomorrow due 2026-09-10'), 'Tomorrow · due 10 Sept')
  })

  test('a date already gone is named plainly', () => {
    assert.equal(describeEntry({ text: '', date: '2026-08-30', time: null, due: null }, TODAY), 'Yesterday')
    assert.equal(describeEntry({ text: '', date: '2026-08-20', time: null, due: null }, TODAY), '20 Aug')
  })
})
