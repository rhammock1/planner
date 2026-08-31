// @ts-check

import { patchList } from '../../src/ui/keyedList.js'
import { check, ok, equal, report } from './harness.js'

/** @typedef {{id: string, text: string}} Row */

const found = document.querySelector('#stage')
if (!(found instanceof HTMLElement)) throw new Error('no stage element')
/** @type {HTMLElement} */
const stage = found

/** @type {import('../../src/ui/keyedList.js').ListSpec<Row>} */
const spec = {
  keyOf: (row) => row.id,
  create: () => {
    const element = document.createElement('div')
    element.append(document.createElement('input'))
    return element
  },
  update: (element, row) => {
    const field = element.querySelector('input')
    if (field !== null) field.value = row.text
  },
}

/**
 * @param {Row[]} rows
 * @returns {HTMLElement}
 */
function listOf(rows) {
  const container = document.createElement('div')
  stage.append(container)
  patchList(container, rows, spec)
  return container
}

/**
 * @param {HTMLElement} container
 * @returns {string[]}
 */
const keys = (container) => [...container.children].map(
  (child) => /** @type {HTMLElement} */ (child).dataset['key'] ?? '',
)

check('builds the list in order', () => {
  const container = listOf([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }])
  equal(keys(container).join(','), 'a,b', 'keys')
})

// create makes the shell; only update knows what goes in it. A new row that
// never gets updated is an empty row.
check('fills a row it has just created', () => {
  const container = listOf([{ id: 'a', text: 'A' }])
  equal(container.querySelector('input')?.value, 'A', 'value')
})

check('keeps the same element for a key that stays', () => {
  const container = listOf([{ id: 'a', text: 'A' }])
  const before = container.firstElementChild
  patchList(container, [{ id: 'a', text: 'A changed' }], spec)
  equal(container.firstElementChild, before, 'element identity')
  equal(container.querySelector('input')?.value, 'A changed', 'updated value')
})

check('reorders without rebuilding', () => {
  const container = listOf([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }])
  const [first, second] = [...container.children]
  patchList(container, [{ id: 'b', text: 'B' }, { id: 'a', text: 'A' }], spec)
  equal(keys(container).join(','), 'b,a', 'new order')
  equal(container.children[0], second, 'b is the same element')
  equal(container.children[1], first, 'a is the same element')
})

check('inserts into the middle', () => {
  const container = listOf([{ id: 'a', text: 'A' }, { id: 'c', text: 'C' }])
  patchList(container, [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }], spec)
  equal(keys(container).join(','), 'a,b,c', 'new order')
})

check('removes what is gone', () => {
  const container = listOf([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }])
  patchList(container, [{ id: 'b', text: 'B' }], spec)
  equal(keys(container).join(','), 'b', 'remaining keys')
})

check('an empty list clears the container', () => {
  const container = listOf([{ id: 'a', text: 'A' }])
  patchList(container, [], spec)
  equal(container.children.length, 0, 'children')
})

// The reason this module exists: every edit round-trips through the
// filesystem, so a render lands on the list while the user is still typing.
check('leaves a focused row alone', () => {
  const container = listOf([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }])
  const field = container.querySelector('input')
  ok(field !== null, 'field exists')
  field.focus()
  field.value = 'half-typed'

  patchList(container, [{ id: 'a', text: 'A from disk' }, { id: 'b', text: 'B' }], spec)
  equal(field.value, 'half-typed', 'what was typed survives')
  equal(document.activeElement, field, 'focus survives')
})

check('keeps the caret where it was', () => {
  const container = listOf([{ id: 'a', text: 'hello' }])
  const field = container.querySelector('input')
  ok(field !== null, 'field exists')
  field.focus()
  field.setSelectionRange(2, 2)

  // The incoming text differs, so an unguarded update would assign .value and
  // send the caret to the end. Patching with the same text proves nothing.
  patchList(container, [{ id: 'a', text: 'hello there' }], spec)
  equal(field.selectionStart, 2, 'caret position')
})

// Chromium happens to keep focus through an insertBefore of an attached
// node; WKWebView, which is what this actually ships on, is not documented to.
// The check pins the intent rather than proving the hazard.
check('does not move a focused row out from under the caret', () => {
  const container = listOf([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }])
  const field = container.querySelector('input')
  ok(field !== null, 'field exists')
  field.focus()

  patchList(container, [{ id: 'b', text: 'B' }, { id: 'a', text: 'A' }], spec)
  equal(document.activeElement, field, 'focus survives the reorder')
})

// A focused button is not a caret. Skipping the update for one leaves a row
// showing the opposite of what the document says until it loses focus - which
// is exactly what a ticked checkbox looked like before this was fixed.
check('updates a row whose button has focus', () => {
  const container = document.createElement('div')
  stage.append(container)

  /** @type {import('../../src/ui/keyedList.js').ListSpec<Row>} */
  const withButton = {
    keyOf: (row) => row.id,
    create: () => {
      const element = document.createElement('div')
      element.append(document.createElement('button'), document.createElement('span'))
      return element
    },
    update: (element, row) => {
      element.className = row.text
      const label = element.querySelector('span')
      if (label !== null) label.textContent = row.text
    },
  }

  patchList(container, [{ id: 'a', text: 'open' }], withButton)
  const button = container.querySelector('button')
  ok(button !== null, 'button exists')
  button.focus()

  patchList(container, [{ id: 'a', text: 'done' }], withButton)
  equal(container.firstElementChild?.className, 'done', 'the row repainted')
  equal(document.activeElement, button, 'the button kept focus')
})

check('updates the rows around a focused one', () => {
  const container = listOf([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }])
  const field = container.querySelector('input')
  ok(field !== null, 'field exists')
  field.focus()

  patchList(container, [{ id: 'a', text: 'A' }, { id: 'b', text: 'B from disk' }], spec)
  equal(container.children[1]?.querySelector('input')?.value, 'B from disk', 'the other row')
})

report()
