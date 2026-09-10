// @ts-check

/**
 * Everything under the add row and above the day's own note: what the plugins
 * had to say about the day, and the notes they offer to start.
 *
 * Two things in one file because they are one region of the page and share
 * its one rule - neither is in your day file. A contributed line came from a
 * calendar; an offer is a note that is not there yet, and pressing it is what
 * makes one (spec §4.1). The daily note sits under both, in `dayPage.js`,
 * because it has no dependency on either one.
 *
 * There are no editors here any more. A file beside the day used to be a
 * block you typed into on this page; it is a page of its own now
 * (`noteView.js`), reached from a marker, a search hit, or a control on the
 * row it is about (spec §1.2). So a `page.note` answer never draws anything
 * of its own in this region - `contributions.js` matches each answered
 * block back to the timed row it belongs to, by the suffix that row's own
 * title would make, and draws the note-or-offer control there instead.
 *
 * Thin as that leaves it, the file stays rather than folding into
 * `dayPage.js`, and the reason is the pairing: this is the one place holding
 * both halves of the day at once - what the plugins contributed, and what
 * they offered. An offer about a meeting belongs on that meeting's own row,
 * and nothing can match the two up without both of them in the same hand.
 */

import { el } from '../ui/dom.js'
import { createContributions } from './contributions.js'

/** @typedef {import('../core/sections.js').Block} Block */
/** @typedef {import('../core/contributions.js').Section} Section */

/**
 * @typedef {object} SectionsState
 * @property {Section[]} contributed  one per contributing plugin; today only
 * @property {Block[]} blocks  what the plugins named for the day being shown
 */

/**
 * @typedef {object} SectionHandlers
 * @property {(block: Block) => void} onOpen  a row's note-or-offer control was pressed
 */

/**
 * @param {SectionHandlers} handlers
 * @returns {{element: HTMLElement, evidence: HTMLElement, render: (state: SectionsState) => void}}
 */
export function createDaySections(handlers) {
  const given = createContributions(handlers)

  const element = el('div', 'day-sections')
  element.append(given.element)

  // Exposed rather than appended here: the untimed lines read as evidence
  // for the day's own note (spec §1.1), which `dayPage.js` places under that
  // note, not under these sections.
  const evidence = given.evidence

  return {
    element,
    evidence,

    render: (state) => {
      given.render(state.contributed, state.blocks)
    },
  }
}
