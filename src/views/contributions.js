// @ts-check

/**
 * What the plugins had to say about today, under the list (addendum §1).
 *
 * A meeting is not a task. It has no checkbox, cannot be ticked, edited,
 * struck out or dragged, and does not count towards how much is left: the
 * footer counts what is open in the file, and this is not in the file.
 *
 * Absent rather than empty. A day with nothing contributed shows no heading
 * and leaves no gap - a section that says "nothing" is a section earning its
 * space by lying about having some.
 */

import { el, setText } from '../ui/dom.js'
import { patchList } from '../ui/keyedList.js'

/** @typedef {import('../core/contributions.js').Event} Event */

/**
 * v1 has one contributing plugin and this is what it contributes. A second
 * one would need the heading to come from the plugin rather than from here.
 */
const HEADING = 'On the calendar'

/**
 * @returns {{element: HTMLElement, render: (events: Event[]) => void}}
 */
export function createContributions() {
  const list = el('ul', 'given-list')

  const section = el('section', 'given')
  section.append(el('h2', 'given-head', HEADING), list)
  section.hidden = true

  return {
    element: section,
    render: (events) => {
      section.hidden = events.length === 0
      patchList(list, events, {
        // Two meetings at the same hour are two rows, so the text is part of
        // what tells them apart.
        keyOf: (event) => `${event.time ?? ''}:${event.text}`,
        create: () => {
          const row = el('li', 'given-item')
          row.append(el('span', 'given-time'), el('span', 'given-text'))
          return row
        },
        update: (row, event) => {
          const [time, text] = row.children
          if (!(time instanceof HTMLElement) || !(text instanceof HTMLElement)) return
          // Blank rather than hidden: an all-day thing lines its title up
          // with the timed ones rather than sitting out to the left alone.
          setText(time, event.time ?? '')
          setText(text, event.text)
        },
      })
    },
  }
}
