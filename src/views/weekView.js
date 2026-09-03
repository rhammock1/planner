// @ts-check

/**
 * The week: seven columns, today marked, each one a day's list (spec §5.6).
 *
 * The columns are built once and re-pointed as you move between weeks, so a
 * week away and back is a patch rather than seven lists thrown away and
 * rebuilt. Which day a column is showing is read at the moment of a gesture,
 * not bound when it was built - the column is the Tuesday slot, not a
 * particular Tuesday.
 */

import { el, setText, setClass } from '../ui/dom.js'
import { weekOf } from '../core/calendar.js'
import { addDays } from '../core/dates.js'
import { openCount } from '../core/glance.js'
import { createItemList, indexOf } from './itemList.js'
import { createAddRow } from './addRow.js'

/** @typedef {import('./spreadPage.js').SpreadState} SpreadState */

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' })
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' })
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const SPAN = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * How a line in flight is addressed. A custom type rather than `text/plain`,
 * so a line dragged in from a text editor is not mistaken for one of ours -
 * and so ours is not offered to every text field on the machine.
 */
const ITEM = 'application/x-planner-item'

/**
 * @param {(pageOf: () => string) => import('../pageEdits.js').PageEdits} editsFor
 * @param {(anchor: string) => void} onAnchor
 * @param {(from: string, index: number, to: string) => void} onMove
 * @param {(plugin: string, href: string) => void} onBadge
 * @returns {{element: HTMLElement, render: (state: SpreadState) => void}}
 */
export function createWeekView(editsFor, onAnchor, onMove, onBadge) {
  /** The seven days on screen. Empty until the first render. */
  /** @type {string[]} */
  let days = []

  const title = el('h2', 'view-title')
  const previous = el('button', undefined, '‹')
  const now = el('button', 'now', '•')
  const next = el('button', undefined, '›')
  previous.title = 'The week before'
  now.title = 'This week'
  next.title = 'The week after'
  const nav = el('div', 'page-nav')
  nav.append(previous, now, next)

  const head = el('div', 'view-head')
  head.append(title, nav)

  const columns = [0, 1, 2, 3, 4, 5, 6].map((slot) => createColumn(slot, () => days[slot] ?? '', editsFor, onBadge))

  /**
   * @param {EventTarget|null} target
   * @param {string} selector
   * @returns {HTMLElement|null}
   */
  function enclosing(target, selector) {
    // A drag begun inside an editable line reports the text node itself as the
    // target, and a text node has no `closest`. Without this the line carries
    // no payload, every column refuses the drop, and the line springs back
    // with nothing to say why.
    const from = target instanceof Text ? target.parentElement : target
    const found = from instanceof Element ? from.closest(selector) : null
    return found instanceof HTMLElement ? found : null
  }

  /**
   * @param {EventTarget|null} target
   * @returns {HTMLElement|null}
   */
  function rowOf(target) {
    return enclosing(target, '.item')
  }

  /**
   * @param {EventTarget|null} target
   * @returns {HTMLElement|null}
   */
  function columnOf(target) {
    return enclosing(target, '.day-column')
  }

  /**
   * The day a row is on, read off the column it sits in rather than the slot
   * it was built as - the columns are re-pointed every time the week moves.
   *
   * @param {HTMLElement} row
   * @returns {string|null}
   */
  function pageOf(row) {
    return columnOf(row)?.dataset['page'] ?? null
  }

  const grid = el('div', 'week-grid')
  for (const column of columns) grid.append(column.element)

  const element = el('section', 'view week')
  element.append(head, grid)

  // A line is dragged from one day to another. Delegated onto the grid,
  // because both ends of the gesture are inside it.
  grid.addEventListener('dragstart', (event) => {
    const row = rowOf(event.target)
    const from = row === null ? null : pageOf(row)
    const at = row === null ? null : indexOf(row)
    if (row === null || from === null || at === null || event.dataTransfer === null) return

    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(ITEM, JSON.stringify({ page: from, index: at }))
    row.classList.add('lifting')
  })

  grid.addEventListener('dragend', (event) => {
    const row = rowOf(event.target)
    row?.classList.remove('lifting')
    for (const column of columns) column.element.classList.remove('dropping')
  })

  grid.addEventListener('dragover', (event) => {
    const column = columnOf(event.target)
    if (column === null || !carriesItem(event.dataTransfer)) return
    // Without this the browser refuses the drop, and the line springs back
    // with no explanation.
    event.preventDefault()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
    for (const other of columns) setClass(other.element, 'dropping', other.element === column)
  })

  grid.addEventListener('dragleave', (event) => {
    // Only when the pointer has actually left the grid: moving between two
    // rows of the same column fires this too, and the highlight would flicker.
    if (event.relatedTarget instanceof Node && grid.contains(event.relatedTarget)) return
    for (const column of columns) column.element.classList.remove('dropping')
  })

  grid.addEventListener('drop', (event) => {
    for (const column of columns) column.element.classList.remove('dropping')
    const column = columnOf(event.target)
    const payload = event.dataTransfer?.getData(ITEM) ?? ''
    if (column === null || payload === '') return
    event.preventDefault()

    const to = column.dataset['page'] ?? ''
    const { page, index } = JSON.parse(payload)
    if (typeof page !== 'string' || typeof index !== 'number' || to === '' || to === page) return
    onMove(page, index, to)
  })

  previous.addEventListener('click', () => onAnchor(addDays(days[0] ?? '', -7)))
  next.addEventListener('click', () => onAnchor(addDays(days[0] ?? '', 7)))
  now.addEventListener('click', () => onAnchor(''))

  return {
    element,
    render: (state) => {
      days = weekOf(state.anchor)
      setText(title, label(days))
      // The dot lights when the week on screen is the one today is in, the
      // same way the day page's does.
      setClass(now, 'now', days.includes(state.today))
      for (const column of columns) column.render(state)
    },
  }
}

/**
 * @param {number} slot 0 for Monday through 6 for Sunday
 * @param {() => string} pageOf
 * @param {(pageOf: () => string) => import('../pageEdits.js').PageEdits} editsFor
 * @param {(plugin: string, href: string) => void} onBadge
 * @returns {{element: HTMLElement, render: (state: SpreadState) => void}}
 */
function createColumn(slot, pageOf, editsFor, onBadge) {
  const edits = editsFor(pageOf)
  const name = el('span', 'day-name')
  const number = el('span', 'day-number')
  const head = el('div', 'day-head')
  head.append(name, number)

  const items = createItemList({ ...edits, onBadge }, { draggable: true, editable: false })
  const add = createAddRow(edits.onAdd, '')

  const element = el('div', 'day-column')
  element.append(head, items.element, add.element)

  return {
    element,
    render: (state) => {
      const page = pageOf()
      if (page === '') return
      const when = new Date(`${page}T00:00:00Z`)
      setText(name, WEEKDAY.format(when))
      setText(number, DAY.format(when))
      setClass(element, 'is-today', page === state.today)
      // A day already gone is not somewhere you write; it is somewhere you
      // look. Dimmed, not hidden - the week is the record as much as the plan.
      setClass(element, 'past', page < state.today)
      // Which day this column is, for a drag that has to know where it landed.
      element.dataset['page'] = page

      const doc = state.vault.get(page) ?? null
      items.render(doc, state.badges?.get(page))
      element.dataset['open'] = String(openCount(doc))
    },
  }
}

/**
 * `31 Aug – 6 Sep 2026` when the week straddles two months, `August 2026`
 * when it does not. The heading says which week without spelling out a range
 * nobody needed.
 *
 * @param {string[]} days
 * @returns {string}
 */
function label(days) {
  const first = days[0]
  const last = days[6]
  if (first === undefined || last === undefined) return ''
  const from = new Date(`${first}T00:00:00Z`)
  const to = new Date(`${last}T00:00:00Z`)
  if (first.slice(0, 7) === last.slice(0, 7)) return MONTH.format(from)
  return `${SPAN.format(from)} – ${SPAN.format(to)} ${last.slice(0, 4)}`
}

/**
 * @param {DataTransfer|null} data
 * @returns {boolean}
 */
function carriesItem(data) {
  return data !== null && data.types.includes(ITEM)
}
