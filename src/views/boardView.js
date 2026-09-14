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

import { el, setText, setClass } from '../ui/dom.js'
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
 * How a card in flight is addressed. Its own type beside the week view's
 * `x-planner-item`, and for that type's reason: a card dropped on a day column
 * is not a line to move, and a line dragged in from a text editor is not a
 * card.
 */
const CARD = 'application/x-planner-card'

/**
 * @param {() => Board|null} showing  which board the strip has picked
 * @param {(plugin: string, id: string, column: string, before: string|null) => void} onDrop
 * @param {(id: string) => void} onFinish  a drop on the last column, which is
 *   refused as a move and answered as a question about where ticking happens
 * @returns {{element: HTMLElement, render: (state: SpreadState) => void}}
 */
export function createBoardView(showing, onDrop, onFinish) {
  const title = el('h2', 'view-title')
  const count = el('span', 'count')
  const head = el('div', 'view-head')
  head.append(title, count)

  const columns = el('div', 'board-columns')

  const element = el('section', 'view board')
  element.append(head, columns)

  /**
   * @param {EventTarget|null} target
   * @param {string} selector
   * @returns {HTMLElement|null}
   */
  function enclosing(target, selector) {
    const from = target instanceof Text ? target.parentElement : target
    const found = from instanceof Element ? from.closest(selector) : null
    return found instanceof HTMLElement ? found : null
  }

  /** Whether an element is the done column, which is the last one by position
   *  and not by name (design §3.1).
   *  @param {HTMLElement} column
   *  @returns {boolean} */
  function isDone(column) {
    return column === columns.lastElementChild
  }

  /** @param {HTMLElement|null} on */
  function markDropping(on) {
    for (const child of columns.children) {
      if (!(child instanceof HTMLElement)) continue
      setClass(child, 'dropping', child === on && !isDone(child))
      // A different class for the done column, because it is not refusing to
      // hear the gesture - it is answering it differently, and the pointer
      // should say so before the mouse comes up rather than after.
      setClass(child, 'refusing', child === on && isDone(child))
    }
  }

  // Delegated onto the strip of columns: both ends of the gesture are inside
  // it, and the columns themselves are patched away and back.
  columns.addEventListener('dragstart', (event) => {
    const card = enclosing(event.target, '.board-card')
    const id = card?.dataset['card'] ?? ''
    const plugin = showing()?.plugin ?? ''
    if (card === null || id === '' || plugin === '' || event.dataTransfer === null) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(CARD, JSON.stringify({ plugin, id }))
    card.classList.add('lifting')
  })

  columns.addEventListener('dragend', (event) => {
    enclosing(event.target, '.board-card')?.classList.remove('lifting')
    markDropping(null)
  })

  columns.addEventListener('dragover', (event) => {
    const column = enclosing(event.target, '.board-column')
    if (column === null || !carriesCard(event.dataTransfer)) return
    // Called for the done column too. Without it the browser swallows the
    // drop, the card springs back, and the one thing the board had to say
    // about finishing goes unsaid (design §6).
    event.preventDefault()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    markDropping(column)
  })

  columns.addEventListener('dragleave', (event) => {
    // Only when the pointer has left the strip: moving between two cards of
    // one column fires this too, and the highlight would flicker.
    if (event.relatedTarget instanceof Node && columns.contains(event.relatedTarget)) return
    markDropping(null)
  })

  columns.addEventListener('drop', (event) => {
    markDropping(null)
    const column = enclosing(event.target, '.board-column')
    const payload = event.dataTransfer?.getData(CARD) ?? ''
    if (column === null || payload === '') return
    event.preventDefault()

    const { plugin, id } = JSON.parse(payload)
    if (typeof plugin !== 'string' || typeof id !== 'string' || id === '') return
    // A board switched under the gesture - the strip was clicked, or the
    // plugin went away - and this card belongs to a file nobody is looking at.
    if (plugin !== showing()?.plugin) return

    // The last column is not a drop target (design §6): a card gets there by
    // the line being ticked, which is a write into your day file and the one
    // thing a board does not do. The refusal does the useful half instead.
    if (isDone(column)) {
      onFinish(id)
      return
    }

    const name = column.dataset['column'] ?? ''
    // The card the pointer came up over, which the dropped one lands in front
    // of. Nothing under it means the empty space below the last card.
    const onto = enclosing(event.target, '.board-card')?.dataset['card'] ?? ''
    if (name === '') return
    onDrop(plugin, id, name, onto === '' || onto === id ? null : onto)
  })

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

/**
 * Whether a drag is carrying one of our cards. Read off the types rather than
 * the data, which a browser will not hand over until the drop.
 *
 * @param {DataTransfer|null} data
 * @returns {boolean}
 */
function carriesCard(data) {
  return data !== null && data.types.includes(CARD)
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
    // Which column this is, for a drop that has to name one. On the column
    // rather than read off its heading, the way the week view's columns carry
    // the day they are showing.
    element.dataset['column'] = column.name
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
    // Only a named card can be picked up. A card the answer pointed at by
    // line has never been in the file, so there is nothing in `board.md` for
    // a drop to move - and by the next draw the write path has named it and
    // it is draggable like any other.
    element.dataset['card'] = card.id ?? ''
    element.draggable = card.id !== null
    // `done` and `dropped` are two ways of being finished with a task and the
    // day page already draws them differently, so the board says which rather
    // than only that the card is off the list.
    element.className = card.ended === null ? 'board-card' : `board-card ended ${card.ended}`
  },
}
