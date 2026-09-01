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
 * @param {{onToggle: (index: number) => void, onEdit: (index: number, text: string) => Promise<boolean>, onNote: (index: number, note: string) => Promise<boolean>}} handlers
 * @returns {{element: HTMLElement, render: (doc: Document|null) => void}}
 */
export function createItemList(handlers) {
  const element = el('ul', 'items')

  // What the text said when editing began, so Escape has something to put
  // back and blur knows whether anything actually changed.
  /** @type {WeakMap<HTMLElement, string>} */
  const before = new WeakMap()

  // Delegated, so a row patched in later needs no wiring of its own.
  element.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.classList.contains('item-check')) return
    const index = indexOf(target)
    if (index !== null) handlers.onToggle(index)
  })

  element.addEventListener('focusin', (event) => {
    const target = editable(event.target)
    if (target !== null) before.set(target, target.textContent ?? '')
  })

  element.addEventListener('keydown', (event) => {
    const target = editable(event.target)
    if (target === null) return

    if (event.key === 'Escape') {
      event.preventDefault()
      setText(target, before.get(target) ?? '')
      target.blur()
      return
    }

    // Shift+Enter opens the line underneath - the one you would write in
    // smaller handwriting, tucked under the task. It is the only nesting the
    // format has, and the only nesting it will get.
    if (event.key === 'Enter' && event.shiftKey && target.classList.contains('item-text')) {
      event.preventDefault()
      const note = target.parentElement?.querySelector('.item-note')
      if (note instanceof HTMLElement) {
        note.hidden = false
        note.focus()
        caretToEnd(note)
      }
      return
    }

    if (event.key === 'Enter') {
      // A line is a line. Enter finishes it rather than starting a second one.
      event.preventDefault()
      target.blur()
    }
  })

  element.addEventListener('focusout', (event) => {
    const target = editable(event.target)
    if (target === null) return

    const was = before.get(target)
    const now = target.textContent ?? ''
    const index = indexOf(target)
    if (was === undefined || index === null) return
    if (now.trim() === was.trim()) {
      // An empty note that was never written to is put away again, so opening
      // one and changing your mind leaves no gap under the item.
      if (target.classList.contains('item-note') && now.trim() === '') target.hidden = true
      return
    }

    const saved = target.classList.contains('item-note')
      ? handlers.onNote(index, now)
      : handlers.onEdit(index, now)

    saved.then((ok) => {
      // A refused write must not leave the page showing something the file
      // does not say (spec §8).
      if (!ok) setText(target, was)
    })
  })

  // Paste arrives as whatever was on the clipboard. A planner line is text.
  element.addEventListener('paste', (event) => {
    const target = editable(event.target)
    if (target === null) return
    event.preventDefault()
    const text = event.clipboardData?.getData('text/plain') ?? ''
    target.ownerDocument.execCommand('insertText', false, text.replace(/\s+/g, ' '))
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

  // A button, not a styled span: Space and Enter activate it for free, which
  // is what spec §5.1 asks of the keyboard and what a screen reader expects.
  const check = el('button', 'item-check')
  check.setAttribute('type', 'button')
  check.setAttribute('role', 'checkbox')

  const text = el('span', 'item-text')
  // plaintext-only keeps the line a line; where it is not supported the paste
  // handler and a textContent read on commit do the same job.
  text.setAttribute('contenteditable', 'plaintext-only')
  text.setAttribute('role', 'textbox')

  const note = el('span', 'item-note')
  note.setAttribute('contenteditable', 'plaintext-only')
  note.setAttribute('role', 'textbox')
  note.setAttribute('aria-label', 'A note under this line')

  row.append(check, text, el('span', 'item-time'), note)
  return row
}

/**
 * The editable line an event happened in, or null if it happened somewhere
 * else. An item's text and its note behave identically; only what they are
 * saved as differs.
 *
 * @param {EventTarget|null} target
 * @returns {HTMLElement|null}
 */
function editable(target) {
  if (!(target instanceof HTMLElement)) return null
  const isLine = target.classList.contains('item-text') || target.classList.contains('item-note')
  return isLine ? target : null
}

/**
 * Puts the caret at the end, so typing continues the line rather than
 * appearing in front of it.
 *
 * @param {HTMLElement} element
 * @returns {void}
 */
function caretToEnd(element) {
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  const selection = element.ownerDocument.defaultView?.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/**
 * The node index a row addresses, from the key the list patcher wrote.
 *
 * @param {HTMLElement} within
 * @returns {number|null}
 */
function indexOf(within) {
  const row = within.closest('.item')
  if (!(row instanceof HTMLElement)) return null
  const index = Number(row.dataset['key']?.split(':')[1])
  return Number.isInteger(index) ? index : null
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
  // A note being typed into is never re-hidden underneath the caret; the list
  // patcher does not update a row whose editable line has focus.
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
