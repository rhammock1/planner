// @ts-check

/**
 * The clock. One function, in one place, outside `core/` - because core is
 * pure and takes today as an argument (spec §11.4). Everything that needs to
 * know what day it is asks here.
 */

/**
 * Local time, not UTC. The page you want when you click the icon is the one
 * on the wall behind you, and at 11pm those are different days.
 *
 * @returns {string} `YYYY-MM-DD`
 */
export function today() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * The time on the wall behind you, `HH:MM`, 24-hour.
 *
 * Every question put to a plugin carries this (spec §1.1), so that a plugin
 * needing to know what "now" is reads it from the question rather than
 * holding a clock of its own - a hidden webview's timers are throttled and
 * its idea of the time drifts.
 *
 * @returns {string} `HH:MM`
 */
export function nowTime() {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/**
 * The instant a `HH:MM` on a given day falls at, on the clock on the wall.
 *
 * Local, deliberately, and the one place in this app that is. Everything else
 * treats a date as the name of a page; an alarm is the one thing that has to
 * be an actual moment, and the moment meant by "10:30 on Tuesday" is the one
 * the person sitting here would point at.
 *
 * `Date` with separate arguments builds in local time, which is what makes
 * this correct across a daylight saving change: on the day the clocks go
 * forward, 10:30 is still 10:30.
 *
 * @param {string} date `YYYY-MM-DD`
 * @param {string} time `HH:MM`, 24-hour
 * @returns {number} milliseconds since the epoch
 */
export function instantAt(date, time) {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const at = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, 0, 0)
  const stamp = at.getTime()
  // A time the clocks skipped - 02:30 on the morning they go forward - is
  // moved on to 03:30 by `Date` itself, which is the right answer: the alarm
  // fires when that minute would have come round. Only malformed input gets
  // here as NaN, and a NaN alarm would be scheduled for the epoch and fire
  // the instant it arrived (spec §11.8).
  if (Number.isNaN(stamp)) throw new RangeError(`not a moment: ${date} ${time}`)
  return stamp
}
