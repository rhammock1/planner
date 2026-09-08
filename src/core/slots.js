// @ts-check

/**
 * Every slot that exists, and the sentence the pane shows beside its tick.
 *
 * A slot is what a plugin is *shown*, which is why it is approved rather than
 * free: `item.badge` hands a plugin the text of every line on a page, and a
 * sentence nobody is asked to tick is not consent (spec §1.1).
 *
 * This list grows one entry at a time, with the plugin that first needs it. A
 * slot with no consumer is a guess about an API.
 */

/**
 * @typedef {object} Slot
 * @property {string} name
 * @property {string} sentence  what the pane shows beside the tick
 * @property {string|null} options  the manifest table holding what this slot
 *   needs to know that the question does not carry, named for the slot's last
 *   word - or null for a slot that needs nothing (spec §1.1)
 */

/** @type {Slot[]} */
export const SLOTS = [
  {
    name: 'vault.contribute',
    sentence: 'Puts lines under the day. Is told nothing.',
    options: 'contribute',
  },
  {
    name: 'item.badge',
    sentence: 'Is shown the text of every line on a page you look at, and can put a marker after one.',
    options: null,
  },
  {
    name: 'theme.tokens',
    sentence: 'Moves colours over the theme.',
    options: 'tokens',
  },
]

const BY_NAME = new Map(SLOTS.map((slot) => [slot.name, slot]))

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isSlot(name) {
  return BY_NAME.has(name)
}

/**
 * The manifest table a slot's options live in.
 *
 * One shape for all of them: a table named for the slot's last word, read only
 * when the slot is declared. A slot this version does not offer has no table,
 * because it has no options this version could act on.
 *
 * @param {string} name
 * @returns {string|null}
 */
export function optionsTableOf(name) {
  return BY_NAME.get(name)?.options ?? null
}

/**
 * The sentence beside a slot's tick.
 *
 * A slot this version has never heard of still gets a line, because the pane
 * has to draw the manifest it was given rather than the one it expected. It
 * cannot be approved: `isSlot` is what the intersection asks.
 *
 * @param {string} name
 * @returns {string}
 */
export function sentenceFor(name) {
  const slot = BY_NAME.get(name)
  if (slot !== undefined) return slot.sentence
  return `Asks for ${name}, which this version of the planner does not offer.`
}
