// @ts-check

/**
 * The back page: `someday.md` as one list (spec §5.6).
 *
 * Things without a day yet. No date header, no daily note, no carry-forward -
 * nothing here is late, because nothing here was ever due. What is left is the
 * list and the line to add to it, which is the whole point of the file.
 */

import { el, setText } from '../ui/dom.js'
import { SOMEDAY } from '../core/vaultIndex.js'
import { createItemList, openCount } from './itemList.js'
import { createAddRow } from './addRow.js'

/** @typedef {import('./spreadPage.js').SpreadState} SpreadState */

/**
 * @param {import('../pageEdits.js').PageEdits} edits
 * @returns {{element: HTMLElement, render: (state: SpreadState) => void}}
 */
export function createBackPage(edits) {
  const items = createItemList(edits)
  const add = createAddRow(edits.onAdd, 'Something for one day')

  const count = el('span', 'count')
  const head = el('div', 'view-head')
  // Its own heading, not an echo of the tab: this is the page at the back of
  // the book, where things without a day wait for one.
  head.append(el('h2', 'view-title', 'The back page'), count)

  const element = el('section', 'view back-page')
  element.append(head, items.element, add.element)

  return {
    element,
    render: (state) => {
      const doc = state.vault.get(SOMEDAY) ?? null
      items.render(doc)
      const open = openCount(doc)
      setText(count, open === 0 ? 'nothing here' : `${open} waiting`)
    },
  }
}
