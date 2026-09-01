// @ts-check

/**
 * What can be known about a day without opening it (spec §5.8).
 *
 * The menu bar icon is the only part of this app that is always on screen, so
 * it is the only part that can say something before it is asked. It says two
 * things: how much of today is still open, and whether a deadline has come
 * inside its lead time.
 *
 * The counting itself lives here rather than in a view because the footer, the
 * week's columns and the icon all count the same thing, and they should never
 * be able to disagree about it.
 */

import { getPage } from './vaultIndex.js'
import { horizon } from './horizon.js'

/** @typedef {import('./model.js').Document} Document */
/** @typedef {import('./vaultIndex.js').VaultIndex} VaultIndex */

/**
 * @typedef {object} Glance
 * @property {number} open  open items on the day itself
 * @property {boolean} near whether anything in the vault is inside its lead time
 */

/**
 * How much of a page is still open.
 *
 * Only `open` counts. A dropped item was decided against and a migrated one
 * has been copied onto another day, where the copy is what is still owed -
 * counting either would report work that no longer exists (spec §5.1).
 *
 * @param {Document|null} doc  null when the day has no file yet
 * @returns {number}
 */
export function openCount(doc) {
  if (doc === null) return 0
  return doc.nodes.filter((node) => node.kind === 'item' && node.state === 'open').length
}

/**
 * @param {VaultIndex} index
 * @param {string} today `YYYY-MM-DD`
 * @param {number} defaultLead days, for items carrying no `~Nd`
 * @returns {Glance}
 */
export function glance(index, today, defaultLead) {
  return {
    open: openCount(getPage(index, today)),
    // The same rule the strip draws, asked as a yes or no. An overdue item
    // never ages out of the horizon, so the dot stays until it is dealt with.
    near: horizon(index, today, defaultLead).length > 0,
  }
}

/**
 * What the icon should carry, or null for a bare icon.
 *
 * A zero is left off deliberately. `0` beside the icon is a number to read and
 * then dismiss; nothing beside the icon is a day with nothing left in it, read
 * without stopping. The same reasoning the footer uses when it says "nothing
 * left" rather than "0 left".
 *
 * @param {Glance} state
 * @param {{count: boolean, dot: boolean}} showing  the two config settings
 * @returns {string|null}
 */
export function badge(state, showing) {
  const parts = []
  if (showing.count && state.open > 0) parts.push(String(state.open))
  if (showing.dot && state.near) parts.push('•')
  return parts.length === 0 ? null : parts.join(' ')
}
