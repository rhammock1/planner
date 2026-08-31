// @ts-check

/**
 * The day page - what the popover shows (spec §5.1).
 *
 * Composition and chrome: the date header, the add row, the daily note, the
 * footer. The three parts with behaviour of their own - the horizon strip,
 * the list, the carry-forward band - are their own modules.
 *
 * DOM only. Every decision about what belongs on the page was made in core
 * before this module was called.
 */

import { addDays } from '../core/dates.js'
import { el, setText, setClass } from '../ui/dom.js'
import { patchList } from '../ui/keyedList.js'
import { createHorizonStrip } from './horizonStrip.js'
import { createItemList, openCount } from './itemList.js'
import { createCarryBand } from './carryBand.js'

/** @typedef {import('../core/model.js').Document} Document */

/**
 * @typedef {object} DayState
 * @property {string} today `YYYY-MM-DD`
 * @property {string} page  the day being shown
 * @property {Document|null} doc  null when the day has no file yet
 * @property {import('../core/horizon.js').HorizonEntry[]} horizon
 * @property {import('../core/carry.js').CarryGroup[]} carry  empty unless today
 * @property {string[]} notices
 */

/**
 * @typedef {object} DayHandlers
 * @property {(page: string) => void} onNavigate
 * @property {(index: number) => void} onToggle  index in the page's doc.nodes
 * @property {(line: string) => Promise<boolean>} onAdd  false if it was not saved
 * @property {(decisions: import('../core/carry.js').CarryDecision[]) => void} onCarry
 */

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' })
const FULL_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
})

/** @type {Page|null} */
let page = null

/** @type {DayState|null} */
let currentState = null

/**
 * @typedef {object} Page
 * @property {HTMLElement} weekday
 * @property {HTMLElement} date
 * @property {HTMLElement} todayButton
 * @property {HTMLElement} notices
 * @property {HTMLElement} note
 * @property {HTMLElement} count
 * @property {ReturnType<typeof createHorizonStrip>} horizon
 * @property {ReturnType<typeof createItemList>} items
 * @property {ReturnType<typeof createCarryBand>} carry
 */

/**
 * Builds the page once. Everything after this is a patch.
 *
 * @param {HTMLElement} root
 * @param {DayHandlers} handlers
 * @returns {void}
 */
export function mount(root, handlers) {
  const weekday = el('span')
  const date = el('small')
  const heading = el('div', 'page-date')
  heading.append(weekday, date)

  const previous = el('button', undefined, '‹')
  const todayButton = el('button', 'now', '•')
  const next = el('button', undefined, '›')
  previous.title = 'The day before'
  todayButton.title = 'Today'
  next.title = 'The day after'
  const nav = el('div', 'page-nav')
  nav.append(previous, todayButton, next)

  const head = el('div', 'page-head')
  head.append(heading, nav)

  const notices = el('ul', 'notices')
  const carry = createCarryBand(handlers)
  const horizon = createHorizonStrip()
  const items = createItemList(handlers)
  const note = el('div', 'note')

  const field = document.createElement('input')
  field.className = 'add-field'
  field.placeholder = 'Write something down'
  field.setAttribute('aria-label', 'Add an item')
  const add = el('div', 'add')
  add.append(field)

  const count = el('span', 'count')
  const tabs = el('div', 'tabs')
  for (const name of ['Day', 'Week', 'Month', 'Someday']) {
    tabs.append(el('span', name === 'Day' ? 'tab on' : 'tab', name))
  }
  const foot = el('div', 'page-foot')
  foot.append(tabs, count)

  const surface = el('div', 'page')
  surface.append(head, notices, carry.element, horizon.element, items.element, add, note, foot)
  root.replaceChildren(surface)

  previous.addEventListener('click', () => handlers.onNavigate(step(-1)))
  next.addEventListener('click', () => handlers.onNavigate(step(1)))
  todayButton.addEventListener('click', () => handlers.onNavigate(currentState?.today ?? ''))

  field.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      field.value = ''
      field.blur()
      return
    }
    if (event.key !== 'Enter' || field.value.trim() === '') return

    // The field is cleared only once the write has come back. A failed save
    // leaves what was typed where it is (spec §8).
    const line = field.value
    handlers.onAdd(line).then((saved) => {
      if (saved && field.value === line) field.value = ''
    })
  })

  page = { weekday, date, todayButton, notices, note, count, horizon, items, carry }
}

/**
 * @param {DayState} state
 * @returns {void}
 */
export function render(state) {
  if (page === null) throw new Error('render before mount')
  currentState = state

  const when = new Date(`${state.page}T00:00:00Z`)
  setText(page.weekday, WEEKDAY.format(when))
  setText(page.date, FULL_DATE.format(when))
  setClass(page.todayButton, 'now', state.page === state.today)

  renderNotices(page.notices, state.notices)
  page.carry.render(state.carry, state.today)
  page.horizon.render(state.horizon)
  page.items.render(state.doc)
  renderNote(page.note, state.doc)

  const open = openCount(state.doc)
  setText(page.count, open === 0 ? 'nothing left' : `${open} left`)
}

/**
 * @param {number} days
 * @returns {string}
 */
function step(days) {
  return currentState === null ? '' : addDays(currentState.page, days)
}

/**
 * @param {HTMLElement} list
 * @param {string[]} notices
 * @returns {void}
 */
function renderNotices(list, notices) {
  patchList(list, notices, {
    keyOf: (notice) => notice,
    create: () => el('li'),
    update: (element, notice) => setText(element, notice),
  })
}

/**
 * @param {HTMLElement} element
 * @param {Document|null} doc
 * @returns {void}
 */
function renderNote(element, doc) {
  const note = doc?.dailyNote ?? null
  element.hidden = note === null || note === ''
  setText(element, note ?? '')
}
