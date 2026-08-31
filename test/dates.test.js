// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, daysBetween, weekdayOf, nextWeekday } from '../src/core/dates.js'

describe('addDays', () => {
  test('moves forward and back within a month', () => {
    assert.equal(addDays('2026-08-31', 1), '2026-09-01')
    assert.equal(addDays('2026-09-01', -1), '2026-08-31')
    assert.equal(addDays('2026-08-31', 0), '2026-08-31')
  })

  test('crosses year boundaries', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01')
    assert.equal(addDays('2027-01-01', -1), '2026-12-31')
  })

  test('handles leap days', () => {
    assert.equal(addDays('2024-02-28', 1), '2024-02-29')
    assert.equal(addDays('2025-02-28', 1), '2025-03-01')
  })

  // The whole module works in UTC so that a day is always exactly 86400
  // seconds. In US/Pacific, 2026-03-08 is a 23-hour local day.
  test('is unaffected by daylight saving transitions', () => {
    assert.equal(addDays('2026-03-07', 1), '2026-03-08')
    assert.equal(addDays('2026-03-08', 1), '2026-03-09')
    assert.equal(addDays('2026-11-01', 1), '2026-11-02')
  })

  test('spans a long range', () => {
    assert.equal(addDays('2026-08-31', 365), '2027-08-31')
  })
})

describe('daysBetween', () => {
  test('counts forward, backward, and zero', () => {
    assert.equal(daysBetween('2026-08-31', '2026-09-02'), 2)
    assert.equal(daysBetween('2026-09-02', '2026-08-31'), -2)
    assert.equal(daysBetween('2026-08-31', '2026-08-31'), 0)
  })

  test('is unaffected by daylight saving transitions', () => {
    assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2)
    assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2)
  })

  test('is the inverse of addDays', () => {
    for (const n of [-400, -30, -1, 0, 1, 30, 400]) {
      assert.equal(daysBetween('2026-08-31', addDays('2026-08-31', n)), n)
    }
  })
})

describe('weekdayOf', () => {
  test('numbers Sunday through Saturday', () => {
    assert.equal(weekdayOf('2026-08-30'), 0)
    assert.equal(weekdayOf('2026-08-31'), 1)
    assert.equal(weekdayOf('2026-09-05'), 6)
  })
})

describe('nextWeekday', () => {
  test('finds the next occurrence after the given day', () => {
    // 2026-08-31 is a Monday.
    assert.equal(nextWeekday('2026-08-31', 2), '2026-09-01')
    assert.equal(nextWeekday('2026-08-31', 0), '2026-09-06')
  })

  // "call the vet monday", typed on a Monday, means the Monday coming up -
  // not the day you are already standing on.
  test('a weekday that is today means the one a week out', () => {
    assert.equal(nextWeekday('2026-08-31', 1), '2026-09-07')
  })
})

describe('bad input', () => {
  test('throws instead of returning NaN', () => {
    assert.throws(() => addDays('not a date', 1), RangeError)
    assert.throws(() => daysBetween('2026-08-31', '2026-13-01'), RangeError)
    assert.throws(() => weekdayOf(''), RangeError)
  })
})
