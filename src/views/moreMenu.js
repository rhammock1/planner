// @ts-check

/**
 * The `...` at the end of the day's tab strip, and the list it opens (phase
 * four §8.3).
 *
 * A menu rather than a wider strip or a second row, because the popover is
 * 380 points across and may be dragged to 300: the tabs that fit are the ones
 * you use, and the rest have to go somewhere that costs one tab's width no
 * matter how many plugins keep a board.
 *
 * It holds whatever `tabFit` demoted, which is Someday first and then boards
 * from the last backwards. Nothing here decides that; this draws a list and
 * says which row was pressed.
 *
 * Opens upwards. The strip is at the bottom of the window, so a list hanging
 * below it would hang off the screen.
 */

import { el, setText, setClass } from '../ui/dom.js'
import { patchList } from '../ui/keyedList.js'

/** @typedef {{key: string, label: string, on: boolean}} Entry */

/**
 * @param {(key: string) => void} onChoose
 * @returns {{element: HTMLElement, render: (entries: Entry[]) => void, isOpen: () => boolean, close: () => void}}
 */
export function createMoreMenu(onChoose) {
  const button = el('button', 'tab more-tab', '…')
  button.setAttribute('type', 'button')
  button.setAttribute('aria-haspopup', 'true')
  button.setAttribute('aria-expanded', 'false')
  button.title = 'The rest of the views'

  const list = el('ul', 'more-list')
  list.hidden = true

  const element = el('div', 'more')
  element.append(button, list)

  /** @returns {boolean} */
  function isOpen() {
    return !list.hidden
  }

  /** @param {boolean} open */
  function show(open) {
    list.hidden = !open
    button.setAttribute('aria-expanded', open ? 'true' : 'false')
    setClass(button, 'on', open)
  }

  function close() {
    if (isOpen()) show(false)
  }

  button.addEventListener('click', (event) => {
    // The document listener below would otherwise see this same click on its
    // way up and close what it just opened.
    event.stopPropagation()
    show(!isOpen())
  })

  // Delegated, because the rows are patched away and back.
  list.addEventListener('click', (event) => {
    const from = event.target
    const row = from instanceof Element ? from.closest('button[data-view]') : null
    if (!(row instanceof HTMLElement)) return
    const key = row.dataset['view'] ?? ''
    if (key === '') return
    close()
    onChoose(key)
  })

  // A click anywhere else puts it away, which is what every menu on this
  // platform does and what a person will try before looking for a way out.
  element.ownerDocument.addEventListener('click', (event) => {
    if (event.target instanceof Node && element.contains(event.target)) return
    close()
  })

  element.ownerDocument.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isOpen()) return
    // Taken from Escape's other meanings on this page - putting the popover
    // away, cancelling an edit - because the nearest open thing is the one
    // Escape is about.
    event.preventDefault()
    close()
    button.focus()
  })

  return {
    element,
    isOpen,
    close,

    /**
     * @param {Entry[]} entries
     * @returns {void}
     */
    render: (entries) => {
      // No `...` at all when nothing was demoted: a button that opens an
      // empty list is a tab's width spent saying nothing.
      element.hidden = entries.length === 0
      if (entries.length === 0) close()
      patchList(list, entries, SPEC)
    },
  }
}

/** @type {import('../ui/keyedList.js').ListSpec<Entry>} */
const SPEC = {
  keyOf: (entry) => entry.key,
  create: () => {
    const row = el('li')
    const button = el('button', 'more-row')
    button.setAttribute('type', 'button')
    row.append(button)
    return row
  },
  update: (element, entry) => {
    const [button] = element.children
    if (!(button instanceof HTMLElement)) return
    button.dataset['view'] = entry.key
    setText(button, entry.label)
    // The view you are on can be in here - a board's tab is demoted by width,
    // not by whether you are looking at it - so the list says which, the way
    // the strip does.
    setClass(button, 'on', entry.on)
  },
}
