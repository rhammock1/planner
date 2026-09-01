// @ts-check

/**
 * The bottom of the day page: where to go, and how much is left (spec §5.1).
 *
 * The popover only ever shows a day. The other three tabs open the window
 * that shows more than one, which is why they are buttons rather than labels:
 * they do something, and the keyboard has to be able to reach them.
 */

import { el, setText } from '../ui/dom.js'
import { VIEWS, viewLabel } from './spreadViews.js'

/**
 * @param {(view: string) => void} onOpenSpread
 * @returns {{element: HTMLElement, render: (open: number) => void}}
 */
export function createDayFooter(onOpenSpread) {
  const count = el('span', 'count')

  const tabs = el('div', 'tabs')
  for (const view of VIEWS) {
    const tab = el('button', 'tab', viewLabel(view))
    tab.setAttribute('type', 'button')
    tab.addEventListener('click', () => onOpenSpread(view))
    tabs.append(tab)
  }
  // The day is where you already are, so it is a label rather than a way out.
  tabs.prepend(el('span', 'tab on', 'Day'))

  const element = el('div', 'page-foot')
  element.append(tabs, count)

  return {
    element,
    // "nothing left" rather than "0 left", for the same reason the menu bar
    // icon goes bare: a zero is a number to read and then dismiss.
    render: (open) => setText(count, open === 0 ? 'nothing left' : `${open} left`),
  }
}
