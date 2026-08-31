// @ts-check

/**
 * The band that says what did not get done (spec §5.4).
 *
 * It is the only place this app nags, and it stops on its own: keeping or
 * dropping settles a line, and a settled line is no longer open, so there is
 * nothing left for the scan to find. Nothing in the file marks a page as
 * reviewed, because nothing needs to.
 */

import { daysBetween } from '../core/dates.js'
import { patchList } from '../ui/keyedList.js'
import { el, setText } from '../ui/dom.js'

/** @typedef {import('../core/carry.js').CarryGroup} CarryGroup */
/** @typedef {import('../core/carry.js').CarryDecision} CarryDecision */
/** @typedef {{page: string, index: number, text: string}} CarryRow */

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' })
const SHORT_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * @param {{onCarry: (decisions: CarryDecision[]) => void}} handlers
 * @returns {{element: HTMLElement, render: (groups: CarryGroup[], today: string) => void}}
 */
export function createCarryBand(handlers) {
  /** @type {CarryGroup[]} */
  let groups = []

  const label = el('span', 'carry-label')
  const keepAll = el('button', 'carry-action', 'Keep all')
  const review = el('button', 'carry-action', 'Review')
  const head = el('div', 'carry-head')
  head.append(label, keepAll, review)

  const list = el('ul', 'carry-items')
  list.hidden = true

  const element = el('div', 'carry')
  element.append(head, list)

  keepAll.addEventListener('click', () => handlers.onCarry(decisionsFor(groups, 'keep')))

  review.addEventListener('click', () => {
    list.hidden = !list.hidden
    setText(review, list.hidden ? 'Review' : 'Hide')
  })

  list.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const action = target.dataset['action']
    const row = target.closest('li')
    const reference = row instanceof HTMLElement ? row.dataset['ref'] : undefined
    if (reference === undefined || (action !== 'keep' && action !== 'drop')) return

    const [page, index] = reference.split('@')
    if (page === undefined || index === undefined) return
    handlers.onCarry([{ page, index: Number(index), action }])
  })

  return {
    element,
    render: (next, today) => {
      groups = next
      element.hidden = groups.length === 0
      if (groups.length === 0) {
        list.hidden = true
        setText(review, 'Review')
        return
      }

      const total = groups.reduce((sum, group) => sum + group.items.length, 0)
      const first = groups[0]
      const from = groups.length === 1 && first !== undefined
        ? dayName(first.from, today)
        : `${groups.length} earlier days`
      setText(label, `${total} unfinished from ${from}`)

      patchList(list, rowsOf(groups), {
        keyOf: (row) => `${row.page}@${row.index}`,
        create: createRow,
        update: (element_, row) => {
          element_.dataset['ref'] = `${row.page}@${row.index}`
          const text = element_.firstElementChild
          if (text instanceof HTMLElement) setText(text, row.text)
        },
      })
    },
  }
}

/** @returns {HTMLElement} */
function createRow() {
  const row = el('li')
  const keep = el('button', 'carry-action', 'Keep')
  keep.dataset['action'] = 'keep'
  const drop = el('button', 'carry-action', 'Drop')
  drop.dataset['action'] = 'drop'
  row.append(el('span', 'carry-text'), keep, drop)
  return row
}

/**
 * @param {CarryGroup[]} groups
 * @returns {CarryRow[]}
 */
function rowsOf(groups) {
  return groups.flatMap((group) => group.items.map((entry) => ({
    page: entry.page, index: entry.index, text: entry.item.text,
  })))
}

/**
 * @param {CarryGroup[]} groups
 * @param {'keep'|'drop'} action
 * @returns {CarryDecision[]}
 */
function decisionsFor(groups, action) {
  return groups.flatMap((group) => group.items.map(
    (entry) => ({ page: entry.page, index: entry.index, action }),
  ))
}

/**
 * A weekday for the last few days, a date beyond that - the way a person
 * refers to a day they can still picture, versus one they cannot.
 *
 * Measured against the app's `today` rather than a clock of its own: a view
 * that reads the time behind the app's back can disagree with it.
 *
 * @param {string} date `YYYY-MM-DD`
 * @param {string} today `YYYY-MM-DD`
 * @returns {string}
 */
function dayName(date, today) {
  const when = new Date(`${date}T00:00:00Z`)
  return daysBetween(date, today) <= 6 ? WEEKDAY.format(when) : SHORT_DATE.format(when)
}
