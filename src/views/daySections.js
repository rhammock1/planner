// @ts-check

/**
 * Everything under the add row and above the day's own note: what the plugins
 * had to say about the day, and the notes they offer to start.
 *
 * Two things in one file because they are one region of the page and share
 * its one rule - neither is in your day file. A contributed line came from a
 * calendar; an offer is a note that is not there yet, and pressing it is what
 * makes one (spec §4.1). The daily note sits under both, in `dayPage.js`: it
 * has no dependency on either one, and keeping it there is what keeps this
 * file under the line count.
 *
 * There are no editors here any more. A file beside the day used to be a
 * block you typed into on this page; it is a page of its own now
 * (`noteView.js`), reached from a marker, a search hit, or one of these
 * offers. So a `page.note` answer naming a file that already *exists* draws
 * nothing here - the offers are the half of that answer this region still has
 * anything to say about.
 */

import { el, setText } from '../ui/dom.js'
import { patchList } from '../ui/keyedList.js'
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
 * @property {(block: Block) => void} onOpen  an offer was pressed
 */

/**
 * @param {SectionHandlers} handlers
 * @returns {{element: HTMLElement, evidence: HTMLElement, render: (state: SectionsState) => void}}
 */
export function createDaySections(handlers) {
  const given = createContributions()

  const offers = el('div', 'blocks')
  offers.hidden = true

  const element = el('div', 'day-sections')
  element.append(given.element, offers)

  // Exposed rather than appended here: the untimed lines read as evidence
  // for the day's own note (spec §1.1), which `dayPage.js` places under that
  // note, not under these sections.
  const evidence = given.evidence

  return {
    element,
    evidence,

    render: (state) => {
      given.render(state.contributed)

      // Only the offers. A block for a file that exists names a note, and a
      // note opens over the day rather than under it.
      const offered = state.blocks.filter((block) => block.kind === 'offer')
      offers.hidden = offered.length === 0
      patchList(offers, offered, {
        keyOf,
        create: () => makeOffer(),
        update: (element, block) => updateOffer(element, block, handlers),
      })
    },
  }
}

/**
 * An offer is one plugin's file. Two plugins cannot own one suffix, so the
 * suffix alone would do - but the plugin is in the key so that an offer whose
 * owner was switched off is torn down rather than adopted.
 *
 * A space joins the two because a plugin name and a suffix are both lowercase
 * words and hyphens, so neither can contain one.
 *
 * @param {Block} block
 * @returns {string}
 */
function keyOf(block) {
  return `${block.plugin} ${block.suffix}`
}

/** @returns {HTMLElement} */
function makeOffer() {
  const button = el('button', 'block-offer')
  button.setAttribute('type', 'button')
  return button
}

/**
 * @param {HTMLElement} element
 * @param {Block} block
 * @param {SectionHandlers} handlers
 * @returns {void}
 */
function updateOffer(element, block, handlers) {
  setText(element, `＋ Notes on ${block.title}`)
  element.onclick = () => handlers.onOpen(block)
}
