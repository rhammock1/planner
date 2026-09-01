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
 * @property {(index: number, text: string) => Promise<boolean>} onEdit
 * @property {(index: number, note: string) => Promise<boolean>} onNote
 * @property {(line: string) => Promise<boolean>} onAdd  false if it was not saved
 * @property {(decisions: import('../core/carry.js').CarryDecision[]) => void} onCarry
 * @property {(pinned: boolean) => void} onPin
 */

/**
 * A thumbtack, seen from the side: the head, its shoulders, and the pin. Drawn
 * rather than set in a font, because no font this app depends on has one.
 */
const PIN_GLYPH =
  '<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true" focusable="false">' +
  '<path d="M4.4 1.7h5.2v1.3h-.9l.7 3.5 1.2 1.2v1.1H3.4V7.7l1.2-1.2.7-3.5h-.9z"/>' +
  '<path d="M7 8.8v3.6" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/>' +
  '</svg>'

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
 * @property {HTMLElement} head
 * @property {HTMLButtonElement} pin
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
  // A pinned popover stays when you click away, and can be dragged by its
  // header - so a page you want to keep in view can be put somewhere it is
  // not in the way. Unpinned, the header is not a handle: dragging the day
  // out from under the menu bar is not what a glance is for.
  const pin = document.createElement('button')
  pin.className = 'pin'
  pin.type = 'button'
  pin.setAttribute('aria-pressed', 'false')
  pin.title = 'Keep this open'
  pin.innerHTML = PIN_GLYPH

  const nav = el('div', 'page-nav')
  nav.append(previous, todayButton, next, pin)

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

  pin.addEventListener('click', () => {
    handlers.onPin(pin.getAttribute('aria-pressed') !== 'true')
  })

  page = { weekday, date, todayButton, head, pin, notices, note, count, horizon, items, carry }
}

/**
 * Shows whether the popover is pinned.
 *
 * `deep` makes the whole header a handle rather than only its bare padding.
 * The buttons inside it still take their clicks: Tauri's drag script stops at
 * the first clickable element on the way up.
 *
 * @param {boolean} pinned
 * @returns {void}
 */
export function setPinned(pinned) {
  if (page === null) throw new Error('setPinned before mount')
  page.pin.setAttribute('aria-pressed', pinned ? 'true' : 'false')
  page.pin.title = pinned ? 'Let it close when you click away' : 'Keep this open'
  if (pinned) page.head.setAttribute('data-tauri-drag-region', 'deep')
  else page.head.removeAttribute('data-tauri-drag-region')
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
