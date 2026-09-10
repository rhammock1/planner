// @ts-check

/**
 * What a row says, read back off the DOM.
 *
 * `itemList.js` draws rows - the keyboard, the drag handling, the patch loop
 * that keeps a row's element stable across a render. This file does not draw
 * anything; it only answers, for an element somewhere inside a row, which
 * line that is and what the line says. One home for what a row means, so a
 * caller outside the list - `weekView.js` moving a line between days,
 * `dayPage.js` naming the line under the caret - has exactly one place to
 * ask, not a second copy of the row's shape kept nearby.
 */

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
 * What a row's line says on screen.
 *
 * From the DOM, not from the document that was last rendered: a line holding
 * the caret is deliberately not written back by `updateRow`, so the document
 * is behind by whatever is half-typed. A gesture about "this line" is about
 * the words in front of you (spec §4.3).
 *
 * Exported alongside `indexOf` for the same reason: what a row means belongs
 * to one file that reads rows, not to whichever view happens to need it.
 *
 * @param {HTMLElement} within
 * @returns {string|null}
 */
export function textOf(within) {
  const row = within.closest('.item')
  if (!(row instanceof HTMLElement)) return null
  const text = row.querySelector('.item-text')
  return text instanceof HTMLElement ? (text.textContent ?? '') : null
}
