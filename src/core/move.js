// @ts-check

/**
 * Moving a line from one page to another (spec §5.6).
 *
 * Two pages change at once, so this returns both rather than mutating either:
 * the caller writes them in the order given, and a failure part way through
 * can only leave the line on two pages, never on none (spec §8).
 *
 * What the source page keeps depends on whether it has happened yet. Moving
 * Thursday's line to Friday before Thursday arrives is planning, and planning
 * leaves no scar: the line simply is not on Thursday. Moving a line off a day
 * that has already been and gone is triage, and the page keeps the record -
 * `[>]` with the date it went to - for the same reason carry-forward does
 * (spec §5.4).
 */

import { createDayDocument, createSomedayDocument, createItem } from './model.js'
import { appendItem, removeItem } from './edit.js'
import { getPage, SOMEDAY } from './vaultIndex.js'

/** @typedef {import('./model.js').Document} Document */
/** @typedef {import('./vaultIndex.js').PageKey} PageKey */
/** @typedef {import('./vaultIndex.js').VaultIndex} VaultIndex */

/** @typedef {{page: PageKey, doc: Document}} PageWrite */

/**
 * @param {VaultIndex} index
 * @param {PageKey} from
 * @param {number} at  position in the source page's `doc.nodes`
 * @param {PageKey} to
 * @param {string} today `YYYY-MM-DD`
 * @returns {PageWrite[]} the destination first, then the source
 */
export function moveItem(index, from, at, to, today) {
  if (from === to) return []

  const source = getPage(index, from)
  const node = source?.nodes[at]
  if (source === null || source === undefined || node === undefined || node.kind !== 'item') {
    throw new Error(`no line at ${at} on ${from}`)
  }

  // The line moves whole: time, deadline, lead and note all travel with it.
  // The app does not quietly edit what the user wrote.
  const moved = createItem(node.text, {
    time: node.time, due: node.due, lead: node.lead, note: node.note,
  })

  // The destination is written first, so the moment where both pages hold the
  // line is the one that can be recovered from by hand.
  const writes = [
    { page: to, doc: appendItem(getPage(index, to) ?? blankPage(to), moved) },
    { page: from, doc: recordOrRemove(source, at, to, from < today) },
  ]
  return writes
}

/**
 * @param {Document} doc
 * @param {number} at
 * @param {PageKey} to
 * @param {boolean} record  whether the source page keeps the line as migrated
 * @returns {Document}
 */
function recordOrRemove(doc, at, to, record) {
  if (!record) return removeItem(doc, at)
  const node = doc.nodes[at]
  if (node === undefined || node.kind !== 'item') throw new Error(`no line at ${at}`)

  const nodes = [...doc.nodes]
  // `movedTo` is a date. The back page has none, so a line sent there from a
  // day that has already been leaves the mark without one.
  nodes[at] = { ...node, state: 'migrated', movedTo: to === SOMEDAY ? null : to }
  return { ...doc, nodes }
}

/**
 * @param {PageKey} page
 * @returns {Document}
 */
function blankPage(page) {
  return page === SOMEDAY ? createSomedayDocument() : createDayDocument(page)
}
