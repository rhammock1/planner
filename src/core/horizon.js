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
    if (item.state !== 'open' || item.due === null) continue

    const daysRemaining = daysBetween(today, item.due)
    if (daysRemaining > (item.lead ?? defaultLead)) continue

    entries.push({
      page, index: at, item, due: item.due, daysRemaining, overdue: daysRemaining < 0,
    })
  }

  return entries.sort((a, b) => a.daysRemaining - b.daysRemaining)
}
