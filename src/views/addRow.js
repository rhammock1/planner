// @ts-check

/**
 * The line at the bottom of a list where the next thing gets written.
 *
 * Enter commits, Escape gives up on it (spec §5.1). The field is cleared only
 * once the write has come back, so a failed save leaves what was typed where
 * it is (spec §8).
 */

import { el } from '../ui/dom.js'

/**
 * @param {(line: string) => Promise<boolean>} onAdd  false when nothing was saved
 * @param {string} placeholder
 * @returns {{element: HTMLElement, field: HTMLInputElement}}
 */
export function createAddRow(onAdd, placeholder) {
  const field = document.createElement('input')
  field.className = 'add-field'
  field.placeholder = placeholder
  field.setAttribute('aria-label', 'Add an item')

  const element = el('div', 'add')
  element.append(field)

  field.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      field.value = ''
      field.blur()
      return
    }
    if (event.key !== 'Enter' || field.value.trim() === '') return

    const line = field.value
    onAdd(line).then((saved) => {
      // Only if it is still the same line: a slow write must not swallow
      // whatever was typed while it was in flight.
      if (saved && field.value === line) field.value = ''
    })
  })

  return { element, field }
}
