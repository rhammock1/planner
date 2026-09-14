// @ts-check

/**
 * Which deadlines are visible today, in what order (spec §5.3).
 *
 * The horizon strip is the app's one piece of ambient pressure: a thin band
 * above the list showing what is coming. An item enters it when
 * `due - today <= lead`, where lead is the item's own `~Nd` or the
 * configured default.
 */

import { daysBetween } from './dates.js'
import { items } from './vaultIndex.js'

/** @typedef {import('./model.js').Item} Item */
/** @typedef {import('./vaultIndex.js').PageKey} PageKey */
/** @typedef {import('./vaultIndex.js').VaultIndex} VaultIndex */

/**
 * @typedef {object} HorizonEntry
 * @property {PageKey} page
 * @property {number} index      position in the page's `doc.nodes`
 * @property {Item} item
 * @property {string} due        `YYYY-MM-DD`, the item's own due date
 * @property {number} daysRemaining  negative once the date has passed
 * @property {boolean} overdue
 */

/**
 * Whether a line is showing on the horizon today, and which side of its date
 * it is on.
 *
 * The rule itself, in one place, because two readers ask it: the strip, which
 * wants the lines, and `dayGlances`, which wants them counted. A second copy
 * of `due - today <= lead` is a second answer to the same question, and this
 * module and `glance.js` exist precisely so those two can never differ.
 *
 * @param {Item} item
 * @param {string} today `YYYY-MM-DD`
 * @param {number} defaultLead days, used when an item has no `~Nd`
 * @returns {'due'|'overdue'|null} null when the line is not on the horizon
 */
export function dueState(item, today, defaultLead) {
  // Only open items. A done or dropped deadline is not a deadline, and a
  // migrated one has been copied onto another day where the copy carries the
  // date - counting both would double every carried deadline.
  if (item.state !== 'open' || item.due === null) return null
  const daysRemaining = daysBetween(today, item.due)
  if (daysRemaining > (item.lead ?? defaultLead)) return null
  return daysRemaining < 0 ? 'overdue' : 'due'
}

/**
 * Dated items from anywhere in the vault, soonest first.
 *
 * Only open items appear. A done or dropped deadline is not a deadline, and a
 * migrated one has been copied onto another day where the copy carries the
 * date - counting both would double every carried deadline in the strip.
 *
 * An overdue item never ages out: it sorts first and keeps sorting first until
 * it is dealt with. Items don't silently rot (spec §5.4) applies here too.
 *
 * @param {VaultIndex} index
 * @param {string} today `YYYY-MM-DD`
 * @param {number} defaultLead days, used when an item has no `~Nd`
 * @returns {HorizonEntry[]}
 */
export function horizon(index, today, defaultLead) {
  /** @type {HorizonEntry[]} */
  const entries = []

  // items() returns page order then file order, so pushing in that order and
  // sorting stably below is what holds two items with the same due date in a
  // fixed sequence. The strip marquees; a jittering band is unreadable.
  for (const { page, index: at, item } of items(index)) {
    // Pulled out first so `due` narrows to a string for the entry below;
    // `dueState` refuses a null date anyway.
    const { due } = item
    if (due === null) continue
    const showing = dueState(item, today, defaultLead)
    if (showing === null) continue

    entries.push({
      page,
      index: at,
      item,
      due,
      daysRemaining: daysBetween(today, due),
      overdue: showing === 'overdue',
    })
  }

  return entries.sort((a, b) => a.daysRemaining - b.daysRemaining)
}
