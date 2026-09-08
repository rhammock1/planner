// @ts-check

/**
 * One checkbox and the sentence it is the answer to.
 *
 * Its own file because both halves of the plugin pane draw one: a slot, a
 * capability and an address are each a sentence with a box beside it, and so
 * is a command's rendered line. Two copies of this would be two chances for
 * the boxes to stop looking alike.
 */

import { el } from '../ui/dom.js'

/**
 * One checkbox and the sentence it is the answer to.
 *
 * @param {string} label
 * @param {boolean} checked
 * @param {string} kind  for the class, so a slot and a capability can look different
 * @param {(on: boolean) => void} onToggle
 * @returns {HTMLElement}
 */
export function tick(label, checked, kind, onToggle) {
  const line = el('label', kind)
  const box = el('input', 'setting-box')
  box.setAttribute('type', 'checkbox')
  if (box instanceof HTMLInputElement) box.checked = checked
  box.addEventListener('change', () => {
    if (box instanceof HTMLInputElement) onToggle(box.checked)
  })
  line.append(box, el('span', `${kind}-name`, label))
  return line
}
