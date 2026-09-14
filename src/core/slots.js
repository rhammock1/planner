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
 *
 * A slot that changes what it means is renamed rather than reworded.
 * `config.toml` holds `approved_slots` as slot *names*, so a sentence changed
 * under an old name would keep the tick it was given for the old meaning and
 * apply it silently to the new one. A new name has no tick anywhere, so
 * everybody is asked once, in the words that are now true. `approvedRun` has
 * the other property - it stores the rendered line and compares it - and
 * giving slots that machinery would be a mechanism where a rename does.
 */

/**
 * @typedef {object} Slot
 * @property {string} name
 * @property {string} sentence  what the pane shows beside the tick
 * @property {string|null} options  the manifest table holding what this slot
 *   needs to know that the question does not carry, named for the slot's last
 *   word - or null for a slot that needs nothing (spec §1.1)
 *
 *   `spread.board` is the one that is not its last word: its table is `[tab]`,
 *   because what it holds configures the tab strip rather than the board, and
 *   the strip is machinery a second slot would share. A `[board]` here and a
 *   `[view]` beside it would be two tables holding one tab's name.
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
  {
    name: 'page.note',
    sentence: "Keeps a page of its own beside the day's file, which you open from the day.",
    options: null,
  },
  {
    name: 'page.box',
    sentence: "Draws a small picture in the day's margin. Is told how many lines are open, done and overdue, and no line's words.",
    options: 'box',
  },
  {
    name: 'item.action',
    sentence: 'Is shown the text of a line you pick, and can open a page of its own about it.',
    options: 'action',
  },
  {
    name: 'search.provide',
    sentence: 'Is shown what you type into ⌘F, and can answer alongside the vault.',
    options: null,
  },
  {
    name: 'spread.board',
    sentence: 'Is shown the text of every line on a page you look at, and keeps a board of its own in a tab of the spread window.',
    options: 'tab',
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
 * Two slots may name the same table, which is why this is a field rather than
 * the last word computed - see `spread.board`.
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
