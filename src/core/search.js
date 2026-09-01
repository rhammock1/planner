// @ts-check

/**
 * Finding a line again (spec §5.7).
 *
 * Over the in-memory index, every time, with no search index of its own. A
 * decade of pages is under 2MB of text: walking all of it costs less than
 * keeping a second structure honest, and a second structure is a thing that
 * can be wrong about what is on disk.
 *
 * Raw text, deliberately. What you remember typing is what you typed - `@`
 * and all - so an unrecognised line is as findable as a task, and a `!` in
 * the query matches a deadline rather than meaning something clever.
 */

import { SOMEDAY } from './vaultIndex.js'
import { serializeItem } from './serialize.js'

/** @typedef {import('./model.js').Document} Document */
/** @typedef {import('./model.js').Node} Node */
/** @typedef {import('./vaultIndex.js').PageKey} PageKey */
/** @typedef {import('./vaultIndex.js').VaultIndex} VaultIndex */

/**
 * How many lines are worth showing. Past this, the query is the thing to
 * change, not the list.
 */
export const MOST = 50

/**
 * One line that matched.
 *
 * `index` is the position in `doc.nodes`, so a result can be jumped to
 * exactly - the same address an edit uses (spec §3.5). A daily note is not in
 * `nodes` and has no address; it carries -1 and jumps to the page.
 *
 * @typedef {object} Hit
 * @property {PageKey} page
 * @property {number} index  -1 for the day's own note
 * @property {string} text
 * @property {'item'|'note'|'other'} kind
 */

/**
 * @typedef {object} Group
 * @property {PageKey} page
 * @property {Hit[]} hits
 */

/**
 * Every line in the vault containing `query`, grouped by the page it is on.
 *
 * Newest page first, with the back page last: `someday` has no date, so it
 * cannot be sorted among days, and it is the page you are least often looking
 * for a particular line on.
 *
 * @param {VaultIndex} index
 * @param {string} query  matched case-insensitively, as plain text
 * @returns {{groups: Group[], found: number}} `found` counts every hit, not
 *   only the ones returned
 */
export function search(index, query) {
  const wanted = query.trim().toLowerCase()
  // An empty query matches every line in the vault, which is not a search
  // result - it is the vault.
  if (wanted === '') return { groups: [], found: 0 }

  /** @type {Group[]} */
  const groups = []
  let found = 0
  let shown = 0

  for (const page of order([...index.keys()])) {
    const doc = index.get(page)
    if (doc === undefined) continue

    /** @type {Hit[]} */
    const hits = []
    for (const line of linesOf(page, doc)) {
      if (!line.match.toLowerCase().includes(wanted)) continue
      found += 1
      if (shown >= MOST) continue
      shown += 1
      hits.push(line.hit)
    }
    if (hits.length > 0) groups.push({ page, hits })
  }

  return { groups, found }
}

/**
 * Every line of a page, twice over: what is searched, and what is shown.
 *
 * They differ for an item. What is searched is the line as it stands in the
 * file, tokens and all, because that is what was typed. What is shown is the
 * line as the page reads it, because a result you cannot read is not one.
 *
 * An item's note is part of the item rather than a line of its own: it is one
 * line as far as the page is concerned, and two results pointing at one line
 * is two things to read and one to press.
 *
 * @param {PageKey} page
 * @param {Document} doc
 * @returns {{hit: Hit, match: string}[]}
 */
function linesOf(page, doc) {
  /** @type {{hit: Hit, match: string}[]} */
  const lines = []

  doc.nodes.forEach((node, index) => {
    if (node.kind === 'item') {
      const note = node.note === null ? '' : ` ${node.note}`
      lines.push({
        hit: { page, index, text: `${node.text}${note}`, kind: 'item' },
        match: `${serializeItem(node)}${note}`,
      })
      return
    }
    // Blank lines are opaque nodes too, and matching one would put the whole
    // vault in the results for a query of a single space.
    if (node.raw.trim() === '') return
    lines.push({ hit: { page, index, text: node.raw, kind: 'other' }, match: node.raw })
  })

  if (doc.dailyNote !== null && doc.dailyNote.trim() !== '') {
    const note = doc.dailyNote
    lines.push({ hit: { page, index: -1, text: note, kind: 'note' }, match: note })
  }
  return lines
}

/**
 * @param {PageKey[]} pages
 * @returns {PageKey[]}
 */
function order(pages) {
  return pages.sort((a, b) => {
    if (a === SOMEDAY) return b === SOMEDAY ? 0 : 1
    if (b === SOMEDAY) return -1
    return a < b ? 1 : a > b ? -1 : 0
  })
}
