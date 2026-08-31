// @ts-check

/**
 * Calendar arithmetic on `YYYY-MM-DD` strings.
 *
 * Every function works in UTC, so a day is always exactly 86400 seconds and
 * no result ever shifts under a daylight saving transition. Dates in this app
 * are calendar dates - they name a page in the vault, not an instant - so a
 * timezone would be a source of bugs rather than of meaning.
 *
 * Pure, per spec §11.4: today's date arrives as an argument, never from a clock.
 */

const MS_PER_DAY = 86_400_000

/**
 * Throws rather than returning NaN: a bad date would otherwise propagate
 * silently through the arithmetic and surface as `Invalid Date` in a view,
 * far from the caller that supplied it (spec §11.8).
 *
 * @param {string} date `YYYY-MM-DD`
 * @returns {number} milliseconds since the epoch at UTC midnight
 */
function epochOf(date) {
  const epoch = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(epoch)) throw new RangeError(`not a calendar date: ${date}`)
  return epoch
}

/**
 * @param {number} epoch
 * @returns {string} `YYYY-MM-DD`
 */
function dateOf(epoch) {
  return new Date(epoch).toISOString().slice(0, 10)
}

/**
 * @param {string} date `YYYY-MM-DD`
 * @param {number} days may be negative
 * @returns {string} `YYYY-MM-DD`
 */
export function addDays(date, days) {
  return dateOf(epochOf(date) + days * MS_PER_DAY)
}

/**
 * Signed day count: positive when `to` is later than `from`.
 *
 * @param {string} from `YYYY-MM-DD`
 * @param {string} to `YYYY-MM-DD`
 * @returns {number}
 */
export function daysBetween(from, to) {
  return Math.round((epochOf(to) - epochOf(from)) / MS_PER_DAY)
}

/**
 * @param {string} date `YYYY-MM-DD`
 * @returns {number} 0 for Sunday through 6 for Saturday
 */
export function weekdayOf(date) {
  return new Date(epochOf(date)).getUTCDay()
}

/**
 * The next occurrence of a weekday, strictly after `date`.
 *
 * Naming a weekday you are currently standing on means the one coming up:
 * "call the vet monday", typed on a Monday, is next Monday. Reading it as
 * today would silently turn a plan into a thing already overdue.
 *
 * @param {string} date `YYYY-MM-DD`
 * @param {number} weekday 0 for Sunday through 6 for Saturday
 * @returns {string} `YYYY-MM-DD`
 */
export function nextWeekday(date, weekday) {
  const ahead = (weekday - weekdayOf(date) + 7) % 7
  return addDays(date, ahead === 0 ? 7 : ahead)
}
