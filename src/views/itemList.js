// @ts-check

/**
 * The day's list: one row per line the parser understood, plus the lines it
 * did not.
 *
 * An unrecognised line is shown, dimmed, rather than hidden. The file is the
 * user's; a page that quietly omits part of it would be lying about what is
 * on the day (spec §3.4).
 */

import { patchList } from '../ui/keyedList.js'
import { el, setText } from '../ui/dom.js'

/** @typedef {import('../core/model.js').Document} Document */
/** @typedef {import('../core/model.js').Item} Item */
/** @typedef {import('../core/model.js').Node} Node */
/** @typedef {{kind: string, index: number, node: Node}} Row */

/**
 * @param {{onToggle: (index: number) => void}} handlers
 * @returns {{element: HTMLElement, render: (doc: Document|null) => void}}
 */
export function createItemList(handlers) {
  const element = el('ul', 'items')

  // Delegated, so a row patched in later needs no wiring of its own.
  element.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.classList.contains('item-check')) return
    const row = target.closest('.item')
    const index = row instanceof HTMLElement ? Number(row.dataset['key']?.split(':')[1]) : Number.NaN
    if (Number.isInteger(index)) handlers.onToggle(index)
  })

  return {
    element,
    render: (doc) => {
      patchList(element, rowsOf(doc), {
        keyOf: (row) => `${row.kind}:${row.index}`,
        create: (row) => (row.node.kind === 'item' ? createRow() : el('li', 'opaque')),
        update: (row, data) => {
          if (data.node.kind === 'opaque') setText(row, data.node.raw)
          else updateRow(row, data.node)
        },
      })
    },
  }
}

/**
 * How many lines on this page are still open. The footer's count, and the
 * same number the menu bar icon shows (spec §5.8).
 *
 * @param {Document|null} doc
 * @returns {number}
 */
export function openCount(doc) {
  if (doc === null) return 0
  return doc.nodes.filter((node) => node.kind === 'item' && node.state === 'open').length
}

/** @returns {HTMLElement} */
function createRow() {
  const row = el('li', 'item')
  const check = el('span', 'item-check')
  check.setAttribute('role', 'checkbox')
  row.append(check, el('span', 'item-text'), el('span', 'item-time'), el('span', 'item-note'))
  return row
}

/**
 * @param {HTMLElement} row
 * @param {Item} item
 * @returns {void}
 */
function updateRow(row, item) {
  const [check, text, time, note] = row.children
  if (!(text instanceof HTMLElement) || !(time instanceof HTMLElement) || !(note instanceof HTMLElement)) return

  row.className = `item ${item.state}${item.due === null ? '' : ' due'}`
  check?.setAttribute('aria-checked', String(item.state === 'done'))

  setText(text, item.text)
  setText(time, item.time ?? '')
  time.hidden = item.time === null
  setText(note, item.note ?? '')
  note.hidden = item.note === null
}

/**
 * Blank lines are structure, not content: preserved in the file, left off the
 * page.
 *
 * @param {Document|null} doc
 * @returns {Row[]}
 */
function rowsOf(doc) {
  if (doc === null) return []
  /** @type {Row[]} */
  const rows = []
  doc.nodes.forEach((node, index) => {
    if (node.kind === 'opaque' && node.raw.trim() === '') return
    rows.push({ kind: node.kind, index, node })
  })
  return rows
}
