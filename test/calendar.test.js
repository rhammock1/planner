import { test } from 'node:test'
import assert from 'node:assert/strict'

import { startOfWeek, weekOf, startOfMonth, addMonths, monthGrid, daySummary } from '../src/core/calendar.js'
import { addDays, daysBetween, weekdayOf } from '../src/core/dates.js'
import { buildIndex } from '../src/core/vaultIndex.js'
import { parse } from '../src/core/parse.js'

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

/** @param {string[]} cells */
function first(cells) {
  const value = cells[0]
  if (value === undefined) throw new Error('no cells')
  return value
}

/** @param {string[]} cells */
function last(cells) {
  const value = cells[cells.length - 1]
  if (value === undefined) throw new Error('no cells')
  return value
}

/** @param {string[]} cells @param {number} at */
function at1(cells, at) {
  const value = cells[at]
  if (value === undefined) throw new Error(`no cell ${at}`)
  return value
}

test('startOfMonth', async (t) => {
  await t.test('is the first of the month a date falls in', () => {
    assert.equal(startOfMonth('2026-09-17'), '2026-09-01')
  })

  await t.test('leaves the first where it is', () => {
    assert.equal(startOfMonth('2026-09-01'), '2026-09-01')
  })
})

test('addMonths', async (t) => {
  await t.test('moves forward to the first of the month', () => {
    assert.equal(addMonths('2026-09-17', 1), '2026-10-01')
  })

  await t.test('moves back', () => {
    assert.equal(addMonths('2026-09-17', -1), '2026-08-01')
  })

  await t.test('crosses the end of a year forwards', () => {
    assert.equal(addMonths('2026-12-15', 1), '2027-01-01')
  })

  await t.test('crosses the start of a year backwards', () => {
    assert.equal(addMonths('2026-01-15', -1), '2025-12-01')
  })

  await t.test('crosses several years', () => {
    assert.equal(addMonths('2026-05-01', -17), '2024-12-01')
  })

  await t.test('has no 31st of February to decide about', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-01')
  })

  await t.test('is its own inverse', () => {
    for (let month = -30; month <= 30; month += 1) {
      assert.equal(addMonths(addMonths('2026-06-11', month), -month), '2026-06-01')
    }
  })

  await t.test('refuses a date that is not one', () => {
    assert.throws(() => addMonths('not-a-date', 1), RangeError)
  })
})

test('monthGrid', async (t) => {
  await t.test('starts on a Monday and ends on a Sunday', () => {
    const cells = monthGrid('2026-09-15')
    assert.equal(weekdayOf(first(cells)), 1)
    assert.equal(weekdayOf(last(cells)), 0)
  })

  await t.test('is a whole number of weeks', () => {
    for (let month = 0; month < 36; month += 1) {
      const cells = monthGrid(addMonths('2025-01-01', month))
      assert.equal(cells.length % 7, 0, `${cells.length} cells`)
    }
  })

  await t.test('is consecutive days with no gap and no repeat', () => {
    const cells = monthGrid('2026-09-15')
    assert.equal(new Set(cells).size, cells.length)
    for (let at = 1; at < cells.length; at += 1) {
      assert.equal(cells[at], addDays(at1(cells, at - 1), 1))
    }
  })

  await t.test('contains every day of the month it is asked about', () => {
    const cells = new Set(monthGrid('2026-02-10'))
    for (let day = 1; day <= 28; day += 1) {
      assert.ok(cells.has(`2026-02-${String(day).padStart(2, '0')}`), `day ${day}`)
    }
  })

  await t.test('is four weeks for a 28-day month that starts on a Monday', () => {
    assert.equal(monthGrid('2027-02-10').length, 28)
    assert.equal(first(monthGrid('2027-02-10')), '2027-02-01')
  })

  await t.test('is five weeks for a February that starts on a Sunday', () => {
    assert.equal(monthGrid('2026-02-10').length, 35)
  })

  await t.test('contains the 29th in a leap February', () => {
    assert.ok(monthGrid('2028-02-10').includes('2028-02-29'))
  })

  await t.test('is the same grid whichever day of the month you ask about', () => {
    const grid = monthGrid('2026-09-01')
    assert.deepEqual(monthGrid('2026-09-30'), grid)
  })

  await t.test('reaches no further either side than one week', () => {
    for (let month = 0; month < 36; month += 1) {
      const anchor = addMonths('2025-01-01', month)
      const cells = monthGrid(anchor)
      assert.ok(daysBetween(first(cells), anchor) < 7, `leading days in ${anchor}`)
      assert.ok(cells.length <= 42, `${cells.length} cells in ${anchor}`)
    }
  })
})

test('daySummary', async (t) => {
  const vault = buildIndex([
    { page: '2026-09-01', doc: parse('# 2026-09-01\n\n- [ ] One\n- [x] Two\n- [ ] Three !2026-09-04\n') },
    { page: '2026-09-02', doc: parse('# 2026-09-02\n\n- [-] Dropped !2026-09-05\n') },
  ])

  await t.test('counts only what is still open on that day', () => {
    assert.equal(daySummary(vault, '2026-09-01').open, 2)
  })

  await t.test('is zero for a day with no page', () => {
    assert.deepEqual(daySummary(vault, '2026-09-09'), { open: 0, due: false })
  })

  await t.test('marks a day something elsewhere is due on', () => {
    assert.equal(daySummary(vault, '2026-09-04').due, true)
    assert.equal(daySummary(vault, '2026-09-04').open, 0)
  })

  await t.test('does not mark a day whose only deadline was dropped', () => {
    assert.equal(daySummary(vault, '2026-09-05').due, false)
  })
})
