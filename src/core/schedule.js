// @ts-check

/**
 * Which of today's lines have a time to be announced at (spec §5.9).
 *
 * The whole schedule is worked out here, in one pass, and handed to Rust as a
 * complete replacement set. Nothing incremental: no "add this alarm, cancel
 * that one" protocol to get out of step with the file. What the day says is
 * what is scheduled, every time.
 *
 * Pure, like the rest of core - the current time arrives as an argument. What
 * turns `09:30` into an instant is `clock.js`, which is where this app keeps
 * its one opinion about what the wall clock says.
 */

import { getPage } from './vaultIndex.js'

/** @typedef {import('./vaultIndex.js').VaultIndex} VaultIndex */

/**
 * @typedef {object} Alarm
 * @property {string} time `HH:MM`, 24-hour
 * @property {string} text the line, as it reads on the page
 */

/**
 * Today's timed lines, earliest first.
 *
 * Only open items. A done line is one you have already dealt with, and being
 * reminded of it at four o'clock is the app arguing with the page. A dropped
 * one was decided against; a migrated one is owed on another day, where the
 * copy carries the time.
 *
 * Only today, because a `@10:30` on next Thursday is a time of day on a page,
 * not an appointment the app has been asked to keep. The horizon strip is
 * what looks ahead (spec §5.3).
 *
 * @param {VaultIndex} index
 * @param {string} today `YYYY-MM-DD`
 * @returns {Alarm[]}
 */
export function schedule(index, today) {
  const doc = getPage(index, today)
  if (doc === null) return []

  /** @type {Alarm[]} */
  const alarms = []
  for (const node of doc.nodes) {
    if (node.kind !== 'item' || node.state !== 'open') continue
    if (node.time === null || node.text === '') continue
    alarms.push({ time: node.time, text: node.text })
  }

  // Zero-padded 24-hour times sort correctly as strings, which is why the
  // parser normalises them. Two lines at the same time keep file order.
  return alarms.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
}

/**
 * Drops the alarms whose moment has already gone.
 *
 * Separate from `schedule` because it is the one part that depends on the
 * time rather than the date: the set is recomputed while the day is running,
 * and re-sending an alarm from this morning would fire it a second time.
 *
 * @param {Alarm[]} alarms
 * @param {(time: string) => number} at  `HH:MM` today -> milliseconds since the epoch
 * @param {number} now  milliseconds since the epoch
 * @returns {{at: number, text: string, time: string}[]}
 */
export function upcoming(alarms, at, now) {
  return alarms
    .map((alarm) => ({ at: at(alarm.time), text: alarm.text, time: alarm.time }))
    .filter((alarm) => alarm.at > now)
}
