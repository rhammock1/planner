// @ts-check

/**
 * The band under the date: what went wrong, and what can be done about it.
 *
 * Nothing here is fatal. A theme that is not there, a shortcut another app
 * already holds, a vault folder that has been moved - each is a line saying
 * so, above a page that still works (spec §8).
 */

import { el, setText } from '../ui/dom.js'
import { patchList } from '../ui/keyedList.js'

/**
 * Something a notice needs the reader to do about it.
 *
 * Most notices are the whole story and there is nothing to press. A missing
 * vault is the exception: the app will not create one somewhere nobody asked
 * for, so it has to ask (spec §8).
 *
 * @typedef {object} Action
 * @property {string} label
 * @property {() => void} run
 */

/**
 * @returns {{element: HTMLElement, render: (notices: string[], actions: Action[]) => void}}
 */
export function createNotices() {
  const list = el('ul', 'notices')
  const bar = el('div', 'notice-actions')

  const element = el('div', 'notice-band')
  element.append(list, bar)

  return {
    element,
    render: (notices, actions) => {
      // Keyed on the text: a notice that is still there between two draws
      // keeps its element, so the band does not flicker every time the page
      // is repainted.
      patchList(list, notices, {
        keyOf: (notice) => notice,
        create: () => el('li'),
        update: (element, notice) => setText(element, notice),
      })

      // Rebuilt rather than patched: there is at most one of these, and it
      // exists only while something is wrong.
      bar.hidden = actions.length === 0
      bar.replaceChildren(...actions.map((action) => {
        const button = el('button', 'notice-action', action.label)
        button.setAttribute('type', 'button')
        button.addEventListener('click', () => action.run())
        return button
      }))
    },
  }
}
