// @ts-check

/**
 * Saying back what a typed line was understood to mean (spec §5.2).
 *
 * Natural-language parsing is only safe if it is visible. "Friday 3 Sep,
 * 08:40" under the field is what lets someone see that `at 4` was read as the
 * afternoon before they commit to it.
 *
 * Presentation, so it lives with the views - but it touches no DOM, which is
 * what lets it be tested under `node --test` with the rest.
 */

import { daysBetween } from '../core/dates.js'

/** @typedef {import('../core/nldate.js').Entry} Entry */

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' })
const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const WITH_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
})

/**
 * @param {Entry} entry
 * @param {string} today `YYYY-MM-DD`
 * @returns {string} empty when nothing was recognised
 */
export function describeEntry(entry, today) {
  /** @type {string[]} */
  const parts = []

  if (entry.date !== null) parts.push(dayName(entry.date, today))
  if (entry.time !== null) parts.push(entry.time)

  const when = parts.join(', ')
  if (entry.due === null) return when

  const due = `due ${dayName(entry.due, today)}`
  return when === '' ? due : `${when} · ${due}`
}

/**
 * The nearest true name for a day: the ones with names of their own, then the
 * weekday for the week ahead, then the date.
 *
 * @param {string} date `YYYY-MM-DD`
 * @param {string} today `YYYY-MM-DD`
 * @returns {string}
 */
function dayName(date, today) {
  const away = daysBetween(today, date)
  if (away === 0) return 'Today'
  if (away === 1) return 'Tomorrow'
  if (away === -1) return 'Yesterday'

  const when = new Date(`${date}T00:00:00Z`)
  if (away > 1 && away <= 6) return `${WEEKDAY.format(when)} ${SHORT.format(when)}`
  return date.slice(0, 4) === today.slice(0, 4) ? SHORT.format(when) : WITH_YEAR.format(when)
}
