// @ts-check

/**
 * Everything under the add row and above the footer, short of the day's own
 * note: what the plugins had to say about the day, and the blocks you type
 * into.
 *
 * Two things in one file because they are one region of the page and share
 * its one rule - neither is in your day file. A contributed line came from a
 * calendar; a block is a window onto a file beside the day (spec §4.2). The
 * daily note sits under both, in `dayPage.js`: it has no dependency on either
 * one, and keeping it there is what keeps this file under the line count.
 *
 * A block writes 800 milliseconds after the last keystroke and on blur, and
 * is never overwritten while it holds the caret: an edit arriving from disk
 * is held until the caret leaves. There is no Save button here because there
 * is no Save button anywhere else in this app either.
 */

import { el, setText } from '../ui/dom.js'
import { patchList } from '../ui/keyedList.js'
import { createContributions } from './contributions.js'

/** @typedef {import('../core/sections.js').Block} Block */
/** @typedef {import('../core/contributions.js').Section} Section */

/**
 * @typedef {object} SectionsState
 * @property {string} date  the day being drawn, `YYYY-MM-DD`
 * @property {Section[]} contributed  one per contributing plugin; today only
 * @property {Block[]} blocks  the plugin blocks for the day being shown
 * @property {(suffix: string) => string|null} textOf  what a block's file says,
 *   or null while it is still being read
 */

/**
 * @typedef {object} SectionHandlers
 * @property {(date: string, suffix: string, text: string) => Promise<boolean>} onBlock
 *   write a block. The date is the block's own, not whatever day is on screen
 *   when the write finally goes: a block is flushed as it leaves the page,
 *   which is exactly the moment the two differ
 * @property {(block: Block) => void} onOpen  an offer was pressed
 */

/** How long after the last keystroke a block goes to disk. */
const SETTLE = 800

/**
 * What a block is holding that disk does not know about yet.
 *
 * Keyed by the block's key rather than by its element, so a block that is
 * rebuilt - a title changed, the list reordered - keeps its pending write.
 *
 * @typedef {object} Held
 * @property {string} suffix
 * @property {string} date  the day this block belongs to, remembered because
 *   the page may have moved on by the time the write goes
 * @property {ReturnType<typeof setTimeout>|null} timer
 * @property {string|null} arrived  text that came from disk while the caret
 *   was in this block, waiting for it to leave
 */

/**
 * @param {SectionHandlers} handlers
 * @returns {{element: HTMLElement, render: (state: SectionsState) => void, reveal: (suffix: string) => boolean, flushAll: () => Promise<void>}}
 */
export function createDaySections(handlers) {
  const given = createContributions()

  const blocks = el('div', 'blocks')
  blocks.hidden = true

  const element = el('div', 'day-sections')
  element.append(given.element, blocks)

  /** @type {Map<string, Held>} */
  const held = new Map()

  /**
   * @param {string} key
   * @param {HTMLElement} body
   * @returns {Promise<void>}
   */
  async function write(key, body) {
    const holding = held.get(key)
    if (holding === undefined) return
    if (holding.timer !== null) {
      clearTimeout(holding.timer)
      holding.timer = null
    }
    await handlers.onBlock(holding.date, holding.suffix, body.textContent ?? '')
  }

  return {
    element,

    render: (state) => {
      given.render(state.contributed)

      // Anything that is going away takes its unsaved text with it unless it
      // is written now: switching days inside the settle window would
      // otherwise lose the last few words typed.
      const wanted = new Set(state.blocks.map(keyOf))
      for (const [key, holding] of held) {
        if (wanted.has(key)) continue
        if (holding.timer !== null) {
          clearTimeout(holding.timer)
          const body = blocks.querySelector(`[data-key="${CSS.escape(key)}"] .block-body`)
          if (body instanceof HTMLElement) void handlers.onBlock(holding.date, holding.suffix, body.textContent ?? '')
        }
        held.delete(key)
      }

      blocks.hidden = state.blocks.length === 0
      patchList(blocks, state.blocks, {
        keyOf,
        create: (block) => (block.kind === 'offer' ? makeOffer() : makeEditor(handlers, held, write)),
        update: (element, block, caret) => {
          if (block.kind === 'offer') {
            updateOffer(element, block, handlers)
            return
          }
          updateEditor(element, block, state.date, state.textOf(block.suffix), caret, held)
        },
      })
    },

    /**
     * Puts the caret in a block, having scrolled it into view.
     *
     * What a `sidecar:` href does when the day it names is already on screen
     * (spec §4.3). False when there is no such block *yet*: a note that has
     * just been created is not on the page until the plugin has been asked
     * again, so the caller keeps asking on each draw until it lands - and
     * gives up quietly, because the href may name a note whose plugin has
     * since been switched off.
     */
    reveal: (suffix) => {
      for (const child of blocks.children) {
        if (!(child instanceof HTMLElement)) continue
        const body = child.querySelector('.block-body')
        if (!(body instanceof HTMLElement) || body.dataset['suffix'] !== suffix) continue
        child.scrollIntoView({ block: 'nearest' })
        body.focus()
        return true
      }
      return false
    },

    /** Writes every block holding an unsaved edit. */
    flushAll: async () => {
      for (const [key] of held) {
        const body = blocks.querySelector(`[data-key="${CSS.escape(key)}"] .block-body`)
        if (body instanceof HTMLElement) await write(key, body)
      }
    },
  }
}

/**
 * A block is one plugin's file. Two plugins cannot own one suffix, so the
 * suffix alone would do - but the plugin is in the key so that a block whose
 * owner was switched off is torn down rather than adopted.
 *
 * The *kind* is in it too, and that one is load-bearing: an offer is a button
 * and an editor is a heading over a `contenteditable`, so a suffix that goes
 * from one to the other - which is what pressing an offer does - has to be
 * rebuilt rather than patched. Without this, `patchList` would hand an offer's
 * `<button>` to the editor's updater, which would find no children and draw
 * nothing at all.
 *
 * Spaces join the three because a plugin name and a suffix are both lowercase
 * words and hyphens, so neither can contain one.
 *
 * @param {Block} block
 * @returns {string}
 */
function keyOf(block) {
  return `${block.plugin} ${block.kind} ${block.suffix}`
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

/**
 * @param {SectionHandlers} handlers
 * @param {Map<string, Held>} held
 * @param {(key: string, body: HTMLElement) => Promise<void>} write
 * @returns {HTMLElement}
 */
function makeEditor(handlers, held, write) {
  const head = el('h2', 'block-head')
  const body = el('div', 'block-body')
  body.setAttribute('contenteditable', 'plaintext-only')
  body.setAttribute('role', 'textbox')

  const section = el('section', 'block')
  section.append(head, body)

  body.addEventListener('input', () => {
    const key = section.dataset['key'] ?? ''
    const holding = held.get(key)
    if (holding === undefined) return
    if (holding.timer !== null) clearTimeout(holding.timer)
    holding.timer = setTimeout(() => { void write(key, body) }, SETTLE)
  })

  body.addEventListener('focusout', () => {
    const key = section.dataset['key'] ?? ''
    void write(key, body).then(() => {
      // Whatever arrived from disk while the caret was here has been waiting
      // for it to leave.
      const holding = held.get(key)
      if (holding === undefined || holding.arrived === null) return
      setText(body, holding.arrived)
      holding.arrived = null
    })
  })

  // Escape leaves the block rather than putting anything back. A block has
  // been saving all along, so there is no "before" to return to - unlike the
  // daily note in `dayPage.js`, which commits on blur and therefore has one.
  body.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    body.blur()
  })

  body.addEventListener('paste', (event) => {
    event.preventDefault()
    const text = event.clipboardData?.getData('text/plain') ?? ''
    body.ownerDocument.execCommand('insertText', false, text)
  })

  return section
}

/**
 * @param {HTMLElement} element
 * @param {Block} block
 * @param {string} date  the day being drawn
 * @param {string|null} text  null while the file is still being read
 * @param {HTMLElement|null} caret
 * @param {Map<string, Held>} held
 * @returns {void}
 */
function updateEditor(element, block, date, text, caret, held) {
  const [head, body] = element.children
  if (!(head instanceof HTMLElement) || !(body instanceof HTMLElement)) return

  setText(head, `NOTES — ${block.title}`)
  body.dataset['suffix'] = block.suffix
  body.setAttribute('aria-label', `Notes on ${block.title}`)

  const key = element.dataset['key'] ?? keyOf(block)
  const holding = held.get(key) ?? { suffix: block.suffix, date, timer: null, arrived: null }
  holding.date = date
  held.set(key, holding)

  // Never while it holds the caret: an edit arriving from disk mid-sentence
  // would take the words out from under whoever is typing them. Held, and
  // applied when the caret leaves.
  if (caret === body) {
    if (text !== null && text !== body.textContent) holding.arrived = text
    return
  }
  setText(body, text ?? '')
}
