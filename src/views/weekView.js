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
import { createItemList, openCount } from './itemList.js'
import { createAddRow } from './addRow.js'

/** @typedef {import('./spreadPage.js').SpreadState} SpreadState */

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' })
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' })
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const SPAN = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * @param {(pageOf: () => string) => import('../pageEdits.js').PageEdits} editsFor
 * @param {(anchor: string) => void} onAnchor
 * @returns {{element: HTMLElement, render: (state: SpreadState) => void}}
 */
export function createWeekView(editsFor, onAnchor) {
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

  const columns = [0, 1, 2, 3, 4, 5, 6].map((slot) => createColumn(slot, () => days[slot] ?? '', editsFor))

  const grid = el('div', 'week-grid')
  for (const column of columns) grid.append(column.element)

  const element = el('section', 'view week')
  element.append(head, grid)

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
 * @returns {{element: HTMLElement, render: (state: SpreadState) => void}}
 */
function createColumn(slot, pageOf, editsFor) {
  const edits = editsFor(pageOf)
  const name = el('span', 'day-name')
  const number = el('span', 'day-number')
  const head = el('div', 'day-head')
  head.append(name, number)

  const items = createItemList(edits)
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

      const doc = state.vault.get(page) ?? null
      items.render(doc)
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
