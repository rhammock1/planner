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
import { VIEWS, viewLabel } from './spreadViews.js'
import { createAddRow } from './addRow.js'
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
 * @property {(index: number) => void} onStrike
 * @property {(index: number) => Promise<boolean>} onRemove
 * @property {(note: string) => Promise<boolean>} onDailyNote
 * @property {(line: string) => Promise<boolean>} onAdd  false if it was not saved
 * @property {(decisions: import('../core/carry.js').CarryDecision[]) => void} onCarry
 * @property {(pinned: boolean) => void} onPin
 * @property {(view: string) => void} onOpenSpread  week, month or someday
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
  // The day's own line, under everything else, the way the bottom of a
  // planner page is left blank for one (spec §5.1).
  const note = el('div', 'note')
  note.setAttribute('contenteditable', 'plaintext-only')
  note.setAttribute('role', 'textbox')
  note.setAttribute('aria-label', "A note on the day")

  const add = createAddRow(handlers.onAdd, 'Write something down')

  const count = el('span', 'count')
  // The popover only ever shows a day; the other three open the window that
  // shows more than one (spec §5.1). Buttons, not labels: they do something,
  // and the keyboard has to be able to reach them.
  const tabs = el('div', 'tabs')
  for (const view of VIEWS) {
    const tab = el('button', 'tab', viewLabel(view))
    tab.setAttribute('type', 'button')
    tab.addEventListener('click', () => handlers.onOpenSpread(view))
    tabs.append(tab)
  }
  tabs.prepend(el('span', 'tab on', 'Day'))
  const foot = el('div', 'page-foot')
  foot.append(tabs, count)

  const surface = el('div', 'page')
  surface.append(head, notices, carry.element, horizon.element, items.element, add.element, note, foot)
  root.replaceChildren(surface)

  previous.addEventListener('click', () => handlers.onNavigate(step(-1)))
  next.addEventListener('click', () => handlers.onNavigate(step(1)))
  todayButton.addEventListener('click', () => handlers.onNavigate(currentState?.today ?? ''))

  pin.addEventListener('click', () => {
    handlers.onPin(pin.getAttribute('aria-pressed') !== 'true')
  })

  // What the note said when editing began, so Escape has something to put back
  // and blur knows whether anything actually changed.
  let noteBefore = ''
  note.addEventListener('focusin', () => { noteBefore = note.textContent ?? '' })

  note.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setText(note, noteBefore)
      note.blur()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      note.blur()
    }
  })

  note.addEventListener('focusout', () => {
    const now = note.textContent ?? ''
    if (now.trim() === noteBefore.trim()) return
    handlers.onDailyNote(now).then((saved) => {
      if (!saved) setText(note, noteBefore)
    })
  })

  note.addEventListener('paste', (event) => {
    event.preventDefault()
    const text = event.clipboardData?.getData('text/plain') ?? ''
    note.ownerDocument.execCommand('insertText', false, text)
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
  // Never overwritten while it is being written in: every edit re-renders the
  // page, and this one is not in a keyed list to be protected by.
  if (element.ownerDocument.activeElement === element) return

  // Always on the page, empty or not. A note you cannot see is a note you
  // cannot start; the placeholder is where the day's line goes.
  element.hidden = doc === null
  setText(element, doc?.dailyNote ?? '')
}
