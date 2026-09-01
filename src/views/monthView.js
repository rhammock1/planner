// @ts-check

/**
 * The month: a grid of date cells with counts and deadline markers, and a
 * click that takes you to the week a day is in (spec §5.6).
 *
 * The month is for finding your way, not for writing. There is nothing to
 * type into a cell - a day is too small a box to write a line in, and the
 * week is one click away.
 */

import { el, setText, setClass } from '../ui/dom.js'
import { monthGrid, addMonths, daySummary } from '../core/calendar.js'

/** @typedef {import('./spreadPage.js').SpreadState} SpreadState */

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' })
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** Monday first, matching the week view and `calendar.js`. */
const HEADINGS = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']

/** Six weeks is the most any month can touch; some touch four or five. */
const MOST_CELLS = 42

/**
 * @param {(anchor: string) => void} onAnchor
 * @param {(view: string) => void} onView
 * @returns {{element: HTMLElement, render: (state: SpreadState) => void}}
 */
export function createMonthView(onAnchor, onView) {
  /** The dates in the grid. Empty until the first render. */
  /** @type {string[]} */
  let dates = []

  const title = el('h2', 'view-title')
  const previous = el('button', undefined, '‹')
  const now = el('button', 'now', '•')
  const next = el('button', undefined, '›')
  previous.title = 'The month before'
  now.title = 'This month'
  next.title = 'The month after'
  const nav = el('div', 'page-nav')
  nav.append(previous, now, next)

  const head = el('div', 'view-head')
  head.append(title, nav)

  const headings = el('div', 'month-headings')
  for (const day of HEADINGS) {
    headings.append(el('span', 'day-name', WEEKDAY.format(new Date(`${day}T00:00:00Z`))))
  }

  // Every cell that any month could need, built once and hidden when a
  // shorter month does not reach them.
  /** @type {ReturnType<typeof createCell>[]} */
  const cells = []
  const grid = el('div', 'month-grid')
  for (let at = 0; at < MOST_CELLS; at += 1) {
    const cell = createCell(at, () => dates[at] ?? '', onAnchor, onView)
    cells.push(cell)
    grid.append(cell.element)
  }

  const element = el('section', 'view month')
  element.append(head, headings, grid)

  previous.addEventListener('click', () => onAnchor(addMonths(anchorOf(dates), -1)))
  next.addEventListener('click', () => onAnchor(addMonths(anchorOf(dates), 1)))
  now.addEventListener('click', () => onAnchor(''))

  return {
    element,
    render: (state) => {
      dates = monthGrid(state.anchor)
      const month = state.anchor.slice(0, 7)
      setText(title, MONTH.format(new Date(`${month}-01T00:00:00Z`)))
      setClass(now, 'now', month === state.today.slice(0, 7))
      // The rows a shorter month does not reach are taken out of the grid
      // rather than left as empty boxes, so a four-week February is four
      // weeks tall.
      grid.style.gridTemplateRows = `repeat(${dates.length / 7}, minmax(0, 1fr))`
      cells.forEach((cell, at) => {
        cell.element.hidden = at >= dates.length
        if (at < dates.length) cell.render(state, month)
      })
    },
  }
}

/**
 * The month a grid is showing, taken from the middle of it: the first cell
 * may belong to the month before and the last to the month after.
 *
 * @param {string[]} dates
 * @returns {string}
 */
function anchorOf(dates) {
  return dates[Math.floor(dates.length / 2)] ?? ''
}

/**
 * @param {number} at
 * @param {() => string} dateOf
 * @param {(anchor: string) => void} onAnchor
 * @param {(view: string) => void} onView
 * @returns {{element: HTMLButtonElement, render: (state: SpreadState, month: string) => void}}
 */
function createCell(at, dateOf, onAnchor, onView) {
  const number = el('span', 'cell-number')
  const open = el('span', 'cell-open')
  const due = el('span', 'cell-due')

  // A button: the whole cell is the click target, and the keyboard reaches it
  // for free.
  const element = document.createElement('button')
  element.className = 'month-cell'
  element.type = 'button'
  element.append(number, open, due)

  element.addEventListener('click', () => {
    const date = dateOf()
    if (date === '') return
    // Jumping means going to where the day can be read and written, which is
    // the week it sits in.
    onAnchor(date)
    onView('week')
  })

  return {
    element,
    render: (state, month) => {
      const date = dateOf()
      if (date === '') return
      setText(number, String(Number(date.slice(8, 10))))
      element.title = date

      // Days either side of the month are shown, dimmed: the week the 1st
      // falls in is easier to read whole than cut off.
      setClass(element, 'outside', date.slice(0, 7) !== month)
      setClass(element, 'is-today', date === state.today)

      const summary = daySummary(state.vault, date)
      setText(open, summary.open === 0 ? '' : String(summary.open))
      due.hidden = !summary.due
    },
  }
}
