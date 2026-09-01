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
