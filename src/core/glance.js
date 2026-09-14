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

import { pageKeys, items } from './vaultIndex.js'
import { dueState } from './horizon.js'

/** @typedef {import('./model.js').Document} Document */
/** @typedef {import('./vaultIndex.js').PageKey} PageKey */
/** @typedef {import('./vaultIndex.js').VaultIndex} VaultIndex */

/**
 * @typedef {object} Glance
 * @property {number} open  open items on the day itself
 * @property {boolean} near whether anything in the vault is inside its lead time
 */

/**
 * What one day amounts to, in four numbers.
 *
 * `open` and `done` are of the day: they count lines written on that page.
 * `due` and `overdue` are of the day but judged *from today* - a line dated
 * next Tuesday is `due` on the page it is written on, and becomes `overdue` on
 * that same page once Tuesday has passed. The two are disjoint, and together
 * they are that page's share of the horizon strip.
 *
 * Dropped and migrated lines are neither `open` nor `done`. A dropped line was
 * decided against; a migrated one has been copied onto another day, where the
 * copy is what is still owed. Counting either reports work that no longer
 * exists (spec §5.1).
 *
 * @typedef {object} DayGlance
 * @property {number} open
 * @property {number} done
 * @property {number} due
 * @property {number} overdue
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
 * What one document amounts to.
 *
 * The day page's reader: it holds one day's file and wants four numbers about
 * it, and walking the whole vault to find the row for the page already in hand
 * would be a pass over every day in the vault on every keystroke in the add
 * row.
 *
 * The same rule as `dayGlances`, because it is literally the same lines - both
 * hand each item to `count` below. Two readers, one rule.
 *
 * @param {Document|null} doc  null when the day has no file yet
 * @param {string} today `YYYY-MM-DD`
 * @param {number} defaultLead days, for items carrying no `~Nd`
 * @returns {DayGlance}
 */
export function glanceOf(doc, today, defaultLead) {
  const day = blank()
  if (doc === null) return day
  for (const node of doc.nodes) {
    if (node.kind === 'item') count(day, node, today, defaultLead)
  }
  return day
}

/**
 * One item, added to a day's four numbers.
 *
 * @param {DayGlance} day
 * @param {import('./model.js').Item} item
 * @param {string} today
 * @param {number} defaultLead
 * @returns {void}
 */
function count(day, item, today, defaultLead) {
  if (item.state === 'open') day.open += 1
  else if (item.state === 'done') day.done += 1

  // Asked of `horizon.js` rather than answered here, so the strip and these
  // counts cannot drift apart. `dueState` already refuses anything that is
  // not open and dated.
  const showing = dueState(item, today, defaultLead)
  if (showing === 'due') day.due += 1
  else if (showing === 'overdue') day.overdue += 1
}

/**
 * Every page in the vault, counted, in one pass.
 *
 * Asked when something wants a number about *every* day at once - the week's
 * seven columns, and the icon's whole-vault question. `openCount` and
 * `glanceOf` stay for the callers that hold a single document, because that is
 * a different question with a different input, not this one narrowed.
 *
 * What must not happen is the two answering differently, and `glance.test.js`
 * is where that is nailed down: for every page in a vault, the count here and
 * the count `openCount` gives are asserted equal. The rule has one home even
 * where the readers are two.
 *
 * Every page in the index gets an entry, including the ones holding no items:
 * a caller asking about an empty Tuesday wants four zeroes, not `undefined`.
 * A page with no file at all is absent, and `blank()` is what to read then.
 *
 * @param {VaultIndex} index
 * @param {string} today `YYYY-MM-DD`
 * @param {number} defaultLead days, for items carrying no `~Nd`
 * @returns {Map<PageKey, DayGlance>}
 */
export function dayGlances(index, today, defaultLead) {
  /** @type {Map<PageKey, DayGlance>} */
  const counted = new Map()
  for (const page of pageKeys(index)) counted.set(page, blank())

  for (const { page, item } of items(index)) {
    const day = counted.get(page)
    if (day === undefined) continue
    count(day, item, today, defaultLead)
  }

  return counted
}

/**
 * A day with nothing on it. Its own function because "no file yet" and "a file
 * with no lines in it" should read the same to everything downstream.
 *
 * @returns {DayGlance}
 */
export function blank() {
  return { open: 0, done: 0, due: 0, overdue: 0 }
}

/**
 * @param {VaultIndex} index
 * @param {string} today `YYYY-MM-DD`
 * @param {number} defaultLead days, for items carrying no `~Nd`
 * @returns {Glance}
 */
export function glance(index, today, defaultLead) {
  const counted = dayGlances(index, today, defaultLead)

  let near = false
  // The same rule the strip draws, asked as a yes or no, and asked of the
  // whole vault rather than of today: a deadline on any page raises the dot.
  // An overdue item never ages out of the horizon, so it stays up until it is
  // dealt with.
  for (const day of counted.values()) {
    if (day.due > 0 || day.overdue > 0) {
      near = true
      break
    }
  }

  return { open: (counted.get(today) ?? blank()).open, near }
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
