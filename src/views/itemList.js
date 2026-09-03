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
import { drawBadges, badgeClicked } from './itemBadges.js'

/** @typedef {import('../core/model.js').Document} Document */
/** @typedef {import('../core/model.js').Item} Item */
/** @typedef {import('../core/model.js').Node} Node */
/** @typedef {import('../core/badges.js').Badge} Badge */
/** @typedef {{kind: string, index: number, node: Node}} Row */

/**
 * @param {{onToggle: (index: number) => void, onEdit: (index: number, text: string) => Promise<boolean>, onNote: (index: number, note: string) => Promise<boolean>, onStrike: (index: number) => void, onRemove: (index: number) => Promise<boolean>, onBadge: (plugin: string, href: string) => void}} handlers
 * @param {{draggable?: boolean, editable?: boolean}} [options]
 *   `draggable`: rows can be picked up and dropped on another day. Only where
 *   there is somewhere to drop them.
 *   `editable`: the line's text and note are written in place. On by default;
 *   off is what makes a row draggable at all, because a contenteditable
 *   region takes the press to place a caret and no drag ever begins.
 * @returns {{element: HTMLElement, render: (doc: Document|null, badges?: Map<number, Badge[]>) => void}}
 */
export function createItemList(handlers, options) {
  const element = el('ul', 'items')

  // What the text said when editing began, so Escape has something to put
  // back and blur knows whether anything actually changed.
  /** @type {WeakMap<HTMLElement, string>} */
  const before = new WeakMap()

  // Delegated, so a row patched in later needs no wiring of its own.
  element.addEventListener('click', (event) => {
    if (badgeClicked(event, handlers.onBadge)) return

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

    // Crossing a line out, then rubbing it out. The first press says you are
    // not doing it and leaves the record the page is for (spec §5.1); the
    // second, on a line already crossed out, takes it off the page. Nothing is
    // ever deleted in one keystroke.
    if ((event.metaKey || event.ctrlKey) && (event.key === 'Backspace' || event.key === 'Delete')) {
      event.preventDefault()
      const index = indexOf(target)
      if (index === null) return

      // A line about to leave the page must let go of the caret first. Rows
      // are keyed by position, so the one below moves up into this element -
      // and a caret still in it would hold the departed line's words on
      // screen, over the top of somebody else's.
      if (target.closest('.item')?.classList.contains('dropped')) target.blur()
      handlers.onStrike(index)
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

    // A line rubbed out to nothing is not a line. The refusal when it carries
    // more than words comes back as false, and the text is put back.
    const saved = target.classList.contains('item-note')
      ? handlers.onNote(index, now)
      : now.trim() === ''
        ? handlers.onRemove(index)
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
    render: (doc, badges) => {
      patchList(element, rowsOf(doc), {
        keyOf: (row) => `${row.kind}:${row.index}`,
        create: (row) => (
          row.node.kind === 'item'
            ? createRow(options?.draggable === true, options?.editable !== false)
            : el('li', 'opaque')
        ),
        update: (row, data, caret) => {
          if (data.node.kind === 'opaque') setText(row, data.node.raw)
          else updateRow(row, data.node, badges?.get(data.index) ?? [], caret)
        },
      })
    },
  }
}

/**
 * @param {boolean} draggable
 * @param {boolean} editable
 * @returns {HTMLElement}
 */
function createRow(draggable, editable) {
  const row = el('li', 'item')
  if (draggable) row.draggable = true

  // A button, not a styled span: Space and Enter activate it for free, which
  // is what spec §5.1 asks of the keyboard and what a screen reader expects.
  const check = el('button', 'item-check')
  check.setAttribute('type', 'button')
  check.setAttribute('role', 'checkbox')

  const text = el('span', 'item-text')
  const note = el('span', 'item-note')
  note.setAttribute('aria-label', 'A note under this line')

  if (editable) {
    // plaintext-only keeps the line a line; where it is not supported the
    // paste handler and a textContent read on commit do the same job.
    for (const line of [text, note]) {
      line.setAttribute('contenteditable', 'plaintext-only')
      line.setAttribute('role', 'textbox')
    }
  }

  const badges = el('span', 'item-badges')
  badges.hidden = true

  row.append(check, text, el('span', 'item-time'), badges, note)
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
 * Exported because moving a line between days happens above any one list: the
 * week view reads the index off the row it is given, rather than keeping a
 * second copy of what the rows mean.
 *
 * @param {HTMLElement} within
 * @returns {number|null}
 */
export function indexOf(within) {
  const row = within.closest('.item')
  if (!(row instanceof HTMLElement)) return null
  const index = Number(row.dataset['key']?.split(':')[1])
  return Number.isInteger(index) ? index : null
}

/**
 * @param {HTMLElement} row
 * @param {Item} item
 * @param {Badge[]} badges
 * @param {HTMLElement|null} caret  the line being typed into, if any
 * @returns {void}
 */
function updateRow(row, item, badges, caret) {
  const [check, text, time, marks, note] = row.children
  if (!(text instanceof HTMLElement) || !(time instanceof HTMLElement)) return
  if (!(marks instanceof HTMLElement) || !(note instanceof HTMLElement)) return

  // Always. A line struck out under the caret has to show it: the same
  // keystroke pressed again takes the line off the page.
  row.className = `item ${item.state}${item.due === null ? '' : ' due'}`
  check?.setAttribute('aria-checked', String(item.state === 'done'))
  setText(time, item.time ?? '')
  time.hidden = item.time === null

  if (text !== caret) setText(text, item.text)

  drawBadges(marks, badges)

  // An empty note that is being typed into must not be hidden out from under
  // the caret: it was opened with Shift+Enter and has nothing in it yet.
  if (note !== caret) {
    setText(note, item.note ?? '')
    note.hidden = item.note === null
  }
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
