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

import { cardKey, cardMarkKey } from '../core/board.js'
import { el, setText, setClass } from '../ui/dom.js'
import { patchList } from '../ui/keyedList.js'
import { autoScroll } from './dragScroll.js'
import { drawBadges, badgeClicked } from './itemBadges.js'

/** @typedef {import('../plugins/pageAsking.js').Board} Board */
/** @typedef {import('../core/board.js').Card} Card */
/** @typedef {import('../core/badges.js').Badge} Badge */

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
 * @param {() => Map<string, Badge[]>} marksOf  what `cardBadgesFor` last said
 *   about this board's cards, keyed `${plugin}\u0000${cardKey(card)}`
 * @param {(plugin: string, id: string, column: string, before: string|null) => void} onDrop
 * @param {(id: string) => void} onFinish  a drop on the last column, which is
 *   refused as a move and answered as a question about where ticking happens
 * @param {(plugin: string, href: string) => void} onMarker  a chip pressed,
 *   which opens the note it points at (spec §8)
 * @returns {{element: HTMLElement, render: () => void}}
 */
export function createBoardView(showing, marksOf, onDrop, onFinish, onMarker) {
  const title = el('h2', 'view-title')
  const count = el('span', 'count')
  const head = el('div', 'view-head')
  head.append(title, count)

  const columns = el('div', 'board-columns')

  const element = el('section', 'view board')
  element.append(head, columns)

  // A drag holds the pointer captive - no wheel, no scroll gesture - so
  // without this the columns below the fold cannot be reached by dragging.
  // It matters stacked, which is how the popover draws a board: three columns
  // down a 560-point window, and the one you want is usually off the bottom.
  // In the spread window the same element scrolls sideways and has no vertical
  // overflow, so this costs a listener there and does nothing.
  autoScroll(columns, carriesCard)

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

  /**
   * Whether the press that a drag would grow out of landed on a chip.
   *
   * A card is draggable, so a press target inside it is a hazard both ways: a
   * chip that starts a drag is a note you cannot open, and a chip that
   * swallows the press is a card you cannot move by grabbing its right-hand
   * end. `draggable="false"` on the chip is not enough on its own - a press
   * on a non-draggable descendant still lifts its draggable ancestor - and
   * `dragstart` cannot tell where the press was, because by then the event's
   * target is the card. So the press is remembered and the drag refused.
   */
  let onChip = false

  columns.addEventListener('mousedown', (event) => {
    onChip = enclosing(event.target, '.item-badge') !== null
  })

  columns.addEventListener('click', (event) => {
    if (badgeClicked(event, onMarker)) onChip = false
  })

  // Delegated onto the strip of columns: both ends of the gesture are inside
  // it, and the columns themselves are patched away and back.
  columns.addEventListener('dragstart', (event) => {
    if (onChip) {
      // The press was the chip's. Refused here rather than prevented on the
      // chip, so the rest of the card goes on dragging exactly as it did.
      event.preventDefault()
      onChip = false
      return
    }
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

  /**
   * The arrangement the columns are holding, and whose it is.
   *
   * A board's answer is cached against its own file, so the draw that follows
   * a drop is always a miss: the file has changed, and the plugin has not yet
   * said what it now makes of it. Drawing that miss as the empty board is the
   * whole board blinking out on every drop, so what is on screen stays there
   * until there is something newer to put in its place.
   *
   * Drawn only, and that is the point of keeping it here rather than in
   * `boardsFor`. The write path reads the same `Board` and must go on seeing
   * the null answer: an arrangement kept from before the drop, merged onto the
   * file the drop just wrote, would put the card back where it came from
   * (`boardWrites.js`).
   *
   * @type {{plugin: string, columns: import('../core/board.js').Column[]}|null}
   */
  let held = null

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
        patchList(columns, [], specFor(new Map(), ''))
        held = null
        return
      }

      setText(title, board.tab)
      // The answer if there is one; otherwise what is already on screen, and
      // only while that is this board's own. A tab pressed for a board that
      // has not answered yet draws the empty board rather than leaving the
      // board beside it under the new one's name.
      const drawing = board.answer?.columns
        ?? (held !== null && held.plugin === board.plugin ? held.columns : [])
      const cards = drawing.reduce((total, column) => total + column.cards.length, 0)
      setText(
        count,
        // `waiting` says there is nothing to show, not that there is nothing
        // newer: a board still holding its cards counts the cards, which is
        // what the person is looking at.
        board.answer === null && drawing.length === 0
          ? 'waiting'
          : cards === 1 ? '1 card' : `${cards} cards`,
      )
      patchList(columns, drawing, specFor(marksOf(), board.plugin))
      held = { plugin: board.plugin, columns: drawing }
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

/**
 * The two list specs, built for the board being drawn.
 *
 * Built per draw rather than held as module constants, because a card's
 * markers are looked up by the board's own name and there are two views alive
 * at once - the popover's and the window's. A constant would have to reach a
 * shared variable for that, and the two boards would take turns writing it.
 *
 * @param {Map<string, Badge[]>} marks
 * @param {string} plugin  whose board is being drawn, which is half of a
 *   card's name in `marks`
 * @returns {import('../ui/keyedList.js').ListSpec<import('../core/board.js').Column>}
 */
function specFor(marks, plugin) {
  /** @type {import('../ui/keyedList.js').ListSpec<Card>} */
  const cards = {
    // The same name `cardBadgesFor` asks under, which is why it is shared
    // rather than spelled here: a marker keyed one way and looked up the
    // other is a marker that never appears, silently.
    keyOf: cardKey,
    create: () => {
      const card = el('li', 'board-card')
      card.append(el('span', 'board-card-text'), el('span', 'board-card-badges'))
      return card
    },
    update: (element, card) => {
      const [text, badges] = element.children
      if (text instanceof HTMLElement) setText(text, card.text)
      if (badges instanceof HTMLElement) {
        drawBadges(badges, marks.get(cardMarkKey(plugin, card)) ?? [])
      }
      // Only a named card can be picked up. A card the answer pointed at by
      // line has never been in the file, so there is nothing in `board.md`
      // for a drop to move - and by the next draw the write path has named it
      // and it is draggable like any other.
      element.dataset['card'] = card.id ?? ''
      element.draggable = card.id !== null
      // `done` and `dropped` are two ways of being finished with a task and
      // the day page already draws them differently, so the board says which
      // rather than only that the card is off the list.
      element.className = card.ended === null ? 'board-card' : `board-card ended ${card.ended}`
    },
  }

  return {
    // The name, which `readBoard` has already made unique across the answer -
    // two columns of one name would otherwise be one column here.
    keyOf: (column) => column.name,
    create: () => {
      const column = el('section', 'board-column')
      column.append(el('h3', 'board-column-name'), el('ul', 'board-cards'))
      return column
    },
    update: (element, column) => {
      const [name, list] = element.children
      // Which column this is, for a drop that has to name one. On the column
      // rather than read off its heading, the way the week view's columns
      // carry the day they are showing.
      element.dataset['column'] = column.name
      if (name instanceof HTMLElement) setText(name, column.name)
      if (list instanceof HTMLElement) patchList(list, column.cards, cards)
    },
  }
}
