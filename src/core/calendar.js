// @ts-check

/**
 * Laying dates out on a page: the seven days of a week, and the cells of a
 * month.
 *
 * Pure calendar arithmetic on `YYYY-MM-DD` strings, like dates.js and for the
 * same reason - a page in the vault is a calendar date, not an instant, so
 * nothing here has a timezone or a clock (spec §11.4).
 */

import { addDays, weekdayOf } from './dates.js'
import { getPage, items } from './vaultIndex.js'

/** @typedef {import('./vaultIndex.js').VaultIndex} VaultIndex */

/**
 * The week starts on Monday.
 *
 * Not configurable, and deliberately: a planner opened to "this week" wants
 * the working week where the eye expects it, and every extra setting is a
 * setting somebody has to decide about. The app formats its dates in en-GB,
 * where Monday is where a week starts.
 */
const WEEK_STARTS_ON = 1

/**
 * The Monday on or before a date.
 *
 * @param {string} date `YYYY-MM-DD`
 * @returns {string} `YYYY-MM-DD`
 */
export function startOfWeek(date) {
  const back = (weekdayOf(date) - WEEK_STARTS_ON + 7) % 7
  return addDays(date, -back)
}

/**
 * The seven days of the week a date falls in, Monday first.
 *
 * @param {string} date `YYYY-MM-DD`
 * @returns {string[]} seven `YYYY-MM-DD`, ascending
 */
export function weekOf(date) {
  const start = startOfWeek(date)
  return [0, 1, 2, 3, 4, 5, 6].map((day) => addDays(start, day))
}

/**
 * The first day of the month a date falls in.
 *
 * @param {string} date `YYYY-MM-DD`
 * @returns {string} `YYYY-MM-01`
 */
export function startOfMonth(date) {
  return `${date.slice(0, 7)}-01`
}

/**
 * A whole number of months later, or earlier.
 *
 * Always the first of that month: what this addresses is the month, not a
 * day inside it, so there is no 31st of February to decide about.
 *
 * @param {string} date `YYYY-MM-DD`
 * @param {number} months may be negative
 * @returns {string} `YYYY-MM-01`
 */
export function addMonths(date, months) {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new RangeError(`not a calendar date: ${date}`)
  }
  const total = year * 12 + (month - 1) + months
  const shifted = Math.floor(total / 12)
  return `${String(shifted).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

/**
 * Every cell of a month grid: whole weeks, Monday first, from the week the
 * 1st falls in to the week the last day falls in.
 *
 * Days either side of the month are included rather than left blank, because
 * the last few days of August are part of how the week beginning the 31st
 * reads - and a grid with holes in it is harder to count across than one
 * without.
 *
 * @param {string} date `YYYY-MM-DD` any day in the month
 * @returns {string[]} 28, 35 or 42 dates, ascending
 */
export function monthGrid(date) {
  const first = startOfMonth(date)
  // 32 days from the 1st lands in the next month whatever its length, and
  // trimming to the 1st of that month gives the day after the last.
  const afterLast = startOfMonth(addDays(first, 32))
  const start = startOfWeek(first)
  const end = addDays(startOfWeek(addDays(afterLast, -1)), 6)

  /** @type {string[]} */
  const cells = []
  for (let day = start; day <= end; day = addDays(day, 1)) cells.push(day)
  return cells
}

/**
 * What a month cell has to say about a day: how much is still open on it, and
 * whether anything anywhere in the vault is due that day.
 *
 * The deadline is looked for across the whole vault, not only on that day's
 * page: an item written on Monday and due on Friday belongs to Friday's cell
 * as much as to Monday's list.
 *
 * @param {VaultIndex} index
 * @param {string} date `YYYY-MM-DD`
 * @returns {{open: number, due: boolean}}
 */
export function daySummary(index, date) {
  const doc = getPage(index, date)
  const open = doc === null
    ? 0
    : doc.nodes.filter((node) => node.kind === 'item' && node.state === 'open').length

  let due = false
  for (const { item } of items(index)) {
    if (item.state === 'open' && item.due === date) {
      due = true
      break
    }
  }
  return { open, due }
}
