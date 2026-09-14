// @ts-check

/**
 * A plugin's board, in a tab of the spread window (spec §2.2).
 *
 * One view for every board, not one per plugin: only one board is ever on
 * screen, so a second element per plugin would be a second thing to keep in
 * step for a thing nobody is looking at. Which board it draws is whichever the
 * strip has picked.
 *
 * What it draws is the plugin's *answer*, which is the board rearranged for
 * the day in front of you. The file behind it is the truth about what a board
 * holds - a card the answer leaves out is still in the file, because an
 * omission is not a deletion - and reconciling the two is the write path's
 * job, not this one's. A board that has not answered yet draws as the empty
 * board rather than as nothing, so the tab is never a blank window.
 */

import { el, setText } from '../ui/dom.js'
import { patchList } from '../ui/keyedList.js'

/** @typedef {import('./spreadPage.js').SpreadState} SpreadState */
/** @typedef {import('../plugins/pageAsking.js').Board} Board */
/** @typedef {import('../core/board.js').Card} Card */

/** The prefix a board's view name takes, so `board:kanban` cannot collide with
 *  a view called `kanban` and `showing()` can tell the two kinds apart. */
export const BOARD_VIEW = 'board:'

/**
 * The view name for one plugin's board.
 *
 * @param {string} plugin
 * @returns {string}
 */
export function boardViewOf(plugin) {
  return `${BOARD_VIEW}${plugin}`
}

/**
 * The plugin a view name names, or null when it is not a board's.
 *
 * @param {string} view
 * @returns {string|null}
 */
export function pluginOfView(view) {
  return view.startsWith(BOARD_VIEW) ? view.slice(BOARD_VIEW.length) : null
}

/**
 * @param {() => Board|null} showing  which board the strip has picked
 * @returns {{element: HTMLElement, render: (state: SpreadState) => void}}
 */
export function createBoardView(showing) {
  const title = el('h2', 'view-title')
  const count = el('span', 'count')
  const head = el('div', 'view-head')
  head.append(title, count)

  const columns = el('div', 'board-columns')

  const element = el('section', 'view board')
  element.append(head, columns)

  return {
    element,
    render: () => {
      const board = showing()
      if (board === null) {
        // The strip is showing a board that is no longer there - a plugin
        // switched off between one draw and the next. `showing()` in
        // `spreadPage.js` falls back to the week for exactly this, so this is
        // the frame in between and not a state anyone sits in.
        setText(title, '')
        setText(count, '')
        patchList(columns, [], SPEC)
        return
      }

      setText(title, board.tab)
      const held = board.answer?.columns ?? []
      const cards = held.reduce((total, column) => total + column.cards.length, 0)
      setText(
        count,
        board.answer === null ? 'waiting' : cards === 1 ? '1 card' : `${cards} cards`,
      )
      patchList(columns, held, SPEC)
    },
  }
}

/** @type {import('../ui/keyedList.js').ListSpec<import('../core/board.js').Column>} */
const SPEC = {
  // The name, which `readBoard` has already made unique across the answer -
  // two columns of one name would otherwise be one column here.
  keyOf: (column) => column.name,
  create: () => {
    const column = el('section', 'board-column')
    column.append(el('h3', 'board-column-name'), el('ul', 'board-cards'))
    return column
  },
  update: (element, column) => {
    const [name, cards] = element.children
    if (name instanceof HTMLElement) setText(name, column.name)
    if (cards instanceof HTMLElement) patchList(cards, column.cards, CARDS)
  },
}

/** @type {import('../ui/keyedList.js').ListSpec<Card>} */
const CARDS = {
  // A card names exactly one of the two, which is what `readCard` guarantees,
  // so this is a key and not a guess. The prefix keeps a card named `4` from
  // sharing a key with the line at index 4.
  keyOf: (card) => (card.id === null ? `line:${card.index}` : `id:${card.id}`),
  create: () => {
    const card = el('li', 'board-card')
    card.append(el('span', 'board-card-text'))
    return card
  },
  update: (element, card) => {
    const [text] = element.children
    if (text instanceof HTMLElement) setText(text, card.text)
    // `done` and `dropped` are two ways of being finished with a task and the
    // day page already draws them differently, so the board says which rather
    // than only that the card is off the list.
    element.className = card.ended === null ? 'board-card' : `board-card ended ${card.ended}`
  },
}
