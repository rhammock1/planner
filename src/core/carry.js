// @ts-check

/**
 * Carry-forward: what needs carrying, and the documents that carry it
 * (spec §5.4).
 *
 * Items don't silently rot. An open line on a past page is unfinished work,
 * and it stays unfinished until it is kept or dropped - which is also the
 * only record that a day was ever reviewed. Nothing in the file marks a page
 * as read, so `[ ]` is the question and `[>]` or `[-]` is the answer.
 */

import { createDayDocument, createItem } from './model.js'
import { addDays } from './dates.js'
import { getPage } from './vaultIndex.js'

/** @typedef {import('./model.js').Document} Document */
/** @typedef {import('./model.js').Item} Item */
/** @typedef {import('./model.js').Node} Node */
/** @typedef {import('./vaultIndex.js').PageKey} PageKey */
/** @typedef {import('./vaultIndex.js').VaultIndex} VaultIndex */
/** @typedef {import('./vaultIndex.js').IndexedItem} IndexedItem */

/**
 * The unfinished items of one past day, in file order.
 *
 * @typedef {object} CarryGroup
 * @property {string} from `YYYY-MM-DD`
 * @property {IndexedItem[]} items
 */

/**
 * @typedef {object} CarryDecision
 * @property {PageKey} page
 * @property {number} index  position in the page's `doc.nodes`
 * @property {'keep'|'drop'} action
 */

/**
 * One page's new content, ready for an atomic write.
 *
 * @typedef {object} PageWrite
 * @property {PageKey} page
 * @property {Document} doc
 */

/**
 * Walks backwards from yesterday, grouping open items by the day they are on.
 *
 * The walk is by date rather than over the index's keys because it has a
 * horizon to respect: a vault five years old must not be re-scanned to its
 * beginning every morning. Days with no file cost a Map miss each.
 *
 * The back page is excluded - `someday.md` is where undated things live on
 * purpose, and nothing there is late.
 *
 * @param {VaultIndex} index
 * @param {string} today `YYYY-MM-DD`
 * @param {number} scanDays how far back to look
 * @returns {CarryGroup[]} most recent day first
 */
export function unfinished(index, today, scanDays) {
  /** @type {CarryGroup[]} */
  const groups = []

  for (let back = 1; back <= scanDays; back += 1) {
    const from = addDays(today, -back)
    const doc = getPage(index, from)
    if (doc === null) continue

    /** @type {IndexedItem[]} */
    const open = []
    doc.nodes.forEach((node, at) => {
      if (node.kind === 'item' && node.state === 'open') {
        open.push({ page: from, index: at, item: node })
      }
    })

    if (open.length > 0) groups.push({ from, items: open })
  }

  return groups
}

/**
 * Turns decisions into the documents to write.
 *
 * Today comes first in the returned list, and the order is load-bearing: if a
 * later write fails, an item that exists on both pages is a visible duplicate
 * the user can fix, while an item marked migrated on a page that never
 * received it is gone (spec §8, never destroy something the user wrote).
 *
 * Input documents are never mutated - the index is shared with whatever is
 * rendering - so every changed page is rebuilt.
 *
 * @param {VaultIndex} index
 * @param {string} today `YYYY-MM-DD`
 * @param {CarryDecision[]} decisions
 * @returns {PageWrite[]}
 */
export function carryForward(index, today, decisions) {
  if (decisions.length === 0) return []

  // Today is both the destination and, under such a decision, a source. That
  // would put the same page in the write list twice, and the second write
  // would clobber the first.
  const onToday = decisions.find((decision) => decision.page === today)
  if (onToday !== undefined) throw new Error(`cannot carry ${today} forward onto itself`)

  // Oldest first, so a week of arrears lands on today in the order it
  // accumulated rather than in whatever order the UI collected the clicks.
  const ordered = [...decisions].sort(
    (a, b) => (a.page === b.page ? a.index - b.index : a.page < b.page ? -1 : 1),
  )

  /** @type {Map<PageKey, Node[]>} */
  const rewritten = new Map()
  /** @type {Item[]} */
  const kept = []

  for (const decision of ordered) {
    const item = itemAt(index, decision)
    const nodes = rewritten.get(decision.page) ?? [...pageNodes(index, decision.page)]

    if (decision.action === 'keep') {
      nodes[decision.index] = { ...item, state: 'migrated', movedTo: today }
      // The copy moves whole: time, due date, lead and note all travel with
      // it. The app does not quietly edit what the user wrote.
      kept.push(createItem(item.text, {
        time: item.time, due: item.due, lead: item.lead, note: item.note,
      }))
    } else {
      nodes[decision.index] = { ...item, state: 'dropped' }
    }

    rewritten.set(decision.page, nodes)
  }

  /** @type {PageWrite[]} */
  const writes = []
  if (kept.length > 0) {
    const doc = getPage(index, today) ?? createDayDocument(today)
    writes.push({ page: today, doc: { ...doc, nodes: [...doc.nodes, ...kept] } })
  }
  for (const [page, nodes] of rewritten) {
    writes.push({ page, doc: { ...pageDoc(index, page), nodes } })
  }
  return writes
}

/**
 * @param {VaultIndex} index
 * @param {PageKey} page
 * @returns {Document}
 */
function pageDoc(index, page) {
  const doc = getPage(index, page)
  if (doc === null) throw new Error(`no page in the vault at ${page}`)
  return doc
}

/**
 * @param {VaultIndex} index
 * @param {PageKey} page
 * @returns {Node[]}
 */
function pageNodes(index, page) {
  return pageDoc(index, page).nodes
}

/**
 * A decision that addresses something other than an item means the caller's
 * view of the vault is stale. Refusing is the only safe answer: writing to
 * the wrong line would destroy whatever is really there (spec §8).
 *
 * @param {VaultIndex} index
 * @param {CarryDecision} decision
 * @returns {Item}
 */
function itemAt(index, decision) {
  const node = pageNodes(index, decision.page)[decision.index]
  if (node === undefined || node.kind !== 'item') {
    throw new Error(`${decision.page} line ${decision.index} is not an item`)
  }
  return node
}
