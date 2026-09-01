import { test } from 'node:test'
import assert from 'node:assert/strict'

import { startOfWeek, weekOf } from '../src/core/calendar.js'

test('startOfWeek', async (t) => {
  await t.test('leaves a Monday where it is', () => {
    assert.equal(startOfWeek('2026-08-31'), '2026-08-31')
  })

  await t.test('walks back to the Monday of the same week', () => {
    assert.equal(startOfWeek('2026-09-02'), '2026-08-31')
  })

  await t.test('reads Sunday as the end of the week it closes, not the start of the next', () => {
    assert.equal(startOfWeek('2026-09-06'), '2026-08-31')
  })

  await t.test('crosses a month boundary', () => {
    assert.equal(startOfWeek('2026-09-01'), '2026-08-31')
  })

  await t.test('crosses a year boundary', () => {
    assert.equal(startOfWeek('2027-01-01'), '2026-12-28')
  })

  await t.test('crosses the end of February in a leap year', () => {
    assert.equal(startOfWeek('2028-03-01'), '2028-02-28')
  })

  await t.test('refuses a date that is not one', () => {
    assert.throws(() => startOfWeek('2026-13-01'), RangeError)
  })
})

test('weekOf', async (t) => {
  await t.test('is seven days, Monday first, ascending', () => {
    assert.deepEqual(weekOf('2026-09-02'), [
      '2026-08-31', '2026-09-01', '2026-09-02',
      '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06',
    ])
  })

  await t.test('is the same seven days whichever of them you ask about', () => {
    const week = weekOf('2026-08-31')
    for (const day of week) assert.deepEqual(weekOf(day), week)
  })

  await t.test('spans a month boundary without a gap or a repeat', () => {
    const week = weekOf('2026-09-30')
    assert.deepEqual(week, [
      '2026-09-28', '2026-09-29', '2026-09-30',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ])
    assert.equal(new Set(week).size, 7)
  })
})
