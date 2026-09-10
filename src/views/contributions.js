// @ts-check

/**
 * What the plugins had to say about today, under the list (spec §3.2).
 *
 * One section per plugin that had something *with a time on it*, each under
 * the heading its manifest asked for. With two contributors, one heading
 * over both would be wrong for one of them - and the answer being keyed by
 * who gave it is what makes a heading possible at all (spec §1.3).
 *
 * A plugin whose events carry no time at all is not drawn here. Untimed is
 * the tense of something that already happened, the same tense as "how the
 * day went" - so those lines are handed to the caller as `evidence` instead,
 * to sit under the day's own note rather than compete with it for a section
 * (spec §1.1, `foldsUnderNote`). A section with a mix keeps its place here;
 * one timed line is enough that it is not only a record of what happened.
 *
 * A meeting is not a task. It has no checkbox, cannot be ticked, edited,
 * struck out or dragged, and does not count towards how much is left: the
 * footer counts what is open in the file, and this is not in the file.
 *
 * Absent rather than empty, per section. A plugin with nothing shows no
 * heading and leaves no gap - a section that says "nothing" is a section
 * earning its space by lying about having some.
 */

import { el, setText } from '../ui/dom.js'
import { patchList } from '../ui/keyedList.js'
import { foldsUnderNote } from '../core/contributions.js'

/** @typedef {import('../core/contributions.js').Event} Event */
/** @typedef {import('../core/contributions.js').Section} Section */

/** One folded line, under the heading that said it. */
/** @typedef {{key: string, heading: string, text: string}} EvidenceLine */

/**
 * @returns {{element: HTMLElement, evidence: HTMLElement, render: (sections: Section[]) => void}}
 */
export function createContributions() {
  const stack = el('div', 'givens')
  stack.hidden = true

  // Not part of `element`: it belongs under the day's own note, wherever the
  // page puts that, not under the list of timed sections.
  const evidence = el('div', 'evidence')
  evidence.hidden = true

  return {
    element: stack,
    evidence,
    render: (sections) => {
      const timed = sections.filter((section) => !foldsUnderNote(section))

      stack.hidden = timed.length === 0
      patchList(stack, timed, {
        // The plugin, not the heading: a plugin that renames its section is
        // the same section, and should not be torn down and rebuilt for it.
        keyOf: (section) => section.plugin,
        create: () => {
          const block = el('section', 'given')
          block.append(el('h2', 'given-head'), el('ul', 'given-list'))
          return block
        },
        update: (block, section) => {
          const [head, list] = block.children
          if (!(head instanceof HTMLElement) || !(list instanceof HTMLElement)) return
          setText(head, section.heading)
          patchList(list, section.events, {
            // Two meetings at the same hour are two rows, so the text is part
            // of what tells them apart.
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
      })

      const lines = sections
        .filter(foldsUnderNote)
        .flatMap((section) => section.events.map((event) => ({
          // The plugin as well as the line, so the same sentence from two
          // plugins is two rows rather than one patched into the other.
          key: `${section.plugin}:${event.time ?? ''}:${event.text}`,
          heading: section.heading,
          text: event.text,
        })))

      evidence.hidden = lines.length === 0
      patchList(evidence, lines, {
        keyOf: (line) => line.key,
        create: () => {
          const row = el('div', 'evidence-row')
          row.append(el('span', 'evidence-src'), el('span', 'evidence-text'))
          return row
        },
        update: (row, line) => {
          const [src, text] = row.children
          if (!(src instanceof HTMLElement) || !(text instanceof HTMLElement)) return
          setText(src, line.heading)
          setText(text, line.text)
        },
      })
    },
  }
}
