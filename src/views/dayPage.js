// @ts-check

/**
 * The day page - what the popover shows (spec §5.1).
 *
 * Composition and chrome: the date header, the add row, the daily note, the
 * footer. The three parts with behaviour of their own - the horizon strip,
 * the list, the carry-forward band - are their own modules, as are the three
 * things that lie over the page rather than sit on it: the search, the
 * settings, and a note (spec §2.1).
 *
 * DOM only. Every decision about what belongs on the page was made in core
 * before this module was called.
 */

import { addDays } from '../core/dates.js'
import { openCount } from '../core/glance.js'
import { el, setText, setClass } from '../ui/dom.js'
import { createAddRow } from './addRow.js'
import { createHorizonStrip } from './horizonStrip.js'
import { createItemList } from './itemList.js'
import { indexOf, textOf } from './itemRow.js'
import { createCarryBand } from './carryBand.js'
import { createDaySections } from './daySections.js'
import { createDayFooter, DAY_VIEW } from './dayFooter.js'
import { createBoardView, pluginOfView } from './boardView.js'
import { createNotices } from './notices.js'
import { createNoteView } from './noteView.js'
import { createSearchPanel } from './searchPanel.js'
import { createSettingsPanel } from './settingsPanel.js'

/** @typedef {import('../core/model.js').Document} Document */
/** @typedef {import('./notices.js').Action} Action */

/**
 * @typedef {object} DayState
 * @property {string} today `YYYY-MM-DD`
 * @property {string} page  the day being shown
 * @property {Document|null} doc  null when the day has no file yet
 * @property {import('../core/horizon.js').HorizonEntry[]} horizon
 * @property {import('../core/carry.js').CarryGroup[]} carry  empty unless today
 * @property {import('../core/contributions.js').Section[]} sections  one per contributing plugin; today only
 * @property {import('../core/sections.js').Block[]} blocks  what the plugins named for this day
 * @property {Map<string, string[]>} prefixes  who owns which sidecar prefix; a
 *   contributed row's note is found through these, never through a name
 * @property {Map<number, import('../core/badges.js').Badge[]>} [badges]  markers, keyed by line index
 * @property {import('../core/box.js').Box|null} [box]  the picture in the
 *   day's margin, when a plugin drew one and the window is tall enough to
 *   have asked (spec §5.1, phase four §1.1)
 * @property {string} view  what this window is showing: `DAY_VIEW`, or a
 *   board's view name (phase four §8.3)
 * @property {readonly import('./dayFooter.js').BoardTab[]} tabs  every plugin
 *   keeping a board, from the config rather than from any answer - a tab
 *   exists because a manifest says so, so the strip is drawn whether or not a
 *   board has been asked anything
 * @property {readonly import('../plugins/pageAsking.js').Board[]} boards  what
 *   those plugins made of today. Empty while the day itself is showing: a
 *   question nobody can see the answer to is not put (spec §1.4)
 * @property {string[]} notices
 * @property {Action[]} actions  offered under the notices; usually none
 */

/**
 * @typedef {object} DayHandlers
 * @property {(page: string) => void} onNavigate
 * @property {(index: number) => void} onToggle  index in the page's doc.nodes
 * @property {(index: number, text: string) => Promise<boolean>} onEdit
 * @property {(index: number, note: string) => Promise<boolean>} onNote
 * @property {(index: number) => void} onStrike
 * @property {(index: number) => Promise<boolean>} onRemove
 * @property {(plugin: string, href: string) => void} onBadge
 * @property {(note: string) => Promise<boolean>} onDailyNote
 * @property {(block: import('../core/sections.js').Block) => void} onOpenSidecar
 * @property {(line: string) => Promise<boolean>} onAdd  false if it was not saved
 * @property {(decisions: import('../core/carry.js').CarryDecision[]) => void} onCarry
 * @property {(pinned: boolean) => void} onPin
 * @property {(view: string) => void} onView  a tab in the footer: `DAY_VIEW`
 *   and a board are views of this window, week, month and someday open the
 *   other one. Which is which is not decided here (phase four §8.3)
 * @property {(plugin: string, id: string, column: string, before: string|null) => void} onCard
 *   a card dropped in another of a board's columns
 * @property {(id: string) => void} onFinish  a card dropped on the last
 *   column, which is not a drop target: a card gets there by its line being
 *   ticked (kanban design §6)
 * @property {(query: string) => {groups: import('../core/search.js').Group[], found: number}} onSearch
 * @property {(query: string) => {groups: {plugin: string, hits: import('../core/provided.js').Provided[]}[], notices: string[]}} onProviders
 * @property {(hit: import('../core/search.js').Hit) => void} onJump
 * @property {(hit: import('../core/provided.js').Provided) => void} onFollow
 * @property {import('./noteView.js').NoteHandlers} note  the overlay a note
 *   opens in (spec §2.1). Grouped rather than spread across five more
 *   `on…` names, the way the settings pane's handlers already are
 * @property {import('./settingsPanel.js').SettingsHandlers} settings
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
 * @property {ReturnType<typeof createNotices>} notices
 * @property {ReturnType<typeof createSearchPanel>} search
 * @property {ReturnType<typeof createSettingsPanel>} settings
 * @property {ReturnType<typeof createNoteView>} noteView
 * @property {ReturnType<typeof createDayFooter>} foot
 * @property {ReturnType<typeof createBoardView>} board
 * @property {HTMLElement} dayBody
 * @property {ReturnType<typeof createHorizonStrip>} horizon
 * @property {ReturnType<typeof createItemList>} items
 * @property {ReturnType<typeof createCarryBand>} carry
 * @property {ReturnType<typeof createDaySections>} sections
 * @property {HTMLElement} note
 * @property {HTMLElement} noteRow
 * @property {HTMLElement} margin
 */

/**
 * How tall the window has to be before the day's margin is asked for at all
 * (phase four §1.1).
 *
 * The popover opens at 560 and may be dragged down to 240. At the bottom of
 * that range the page is chrome and a sliver of list, and a picture 48 points
 * tall is a fifth of what is left - so below this the question is not put,
 * which also means a plugin is not woken to draw something nobody can see.
 *
 * 420 rather than a rounder number: it is the height at which the list still
 * holds about half a screen of lines after the note's row has grown to fit a
 * box. Measured against the default theme's metrics; a theme with a larger
 * body size moves the real figure, which is why this is the app's rule about
 * its own page rather than anything a plugin declares.
 */
export const ROOM_FOR_A_BOX = 420

/**
 * Whether this window is tall enough for the day to have a margin.
 *
 * Read on every draw rather than watched: a resize redraws the page anyway by
 * the time anything else on it has moved, and a listener that redrew on every
 * frame of a drag would put the question to a plugin sixty times a second.
 *
 * @param {Window} view
 * @returns {boolean}
 */
export function roomForABox(view) {
  return view.innerHeight >= ROOM_FOR_A_BOX
}

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

  const notices = createNotices()
  const search = createSearchPanel({
    onQuery: handlers.onSearch,
    onProviders: handlers.onProviders,
    onJump: handlers.onJump,
    onFollow: handlers.onFollow,
  })
  const settings = createSettingsPanel(handlers.settings)
  const noteView = createNoteView(handlers.note)
  const carry = createCarryBand(handlers)
  const horizon = createHorizonStrip()
  const items = createItemList(handlers)

  const add = createAddRow(handlers.onAdd, 'Write something down')
  const sections = createDaySections({ onOpen: handlers.onOpenSidecar })

  // The day's own line, under everything else, the way the bottom of a
  // planner page is left blank for one (spec §5.1). `sections.evidence`
  // follows it: the untimed lines a plugin sent read as the same tense as
  // this note, so they sit under it as dim corroboration rather than in a
  // section of their own (spec §1.1).
  const note = el('div', 'note')
  note.setAttribute('contenteditable', 'plaintext-only')
  note.setAttribute('role', 'textbox')
  note.setAttribute('aria-label', 'A note on the day')

  // The margin, at the right-hand end of the note's row (phase four §1.1).
  // Outside the note rather than inside it: the note is contenteditable, and
  // anything within it is something the caret can be put in and the person
  // can delete.
  const margin = el('div', 'box')
  const noteRow = el('div', 'note-row')
  noteRow.append(note, margin)

  const foot = createDayFooter(handlers.onView)

  // The day's own parts, gathered so that the board can take their place
  // rather than sit under them (phase four §8.3). Exactly one of these two is
  // on screen; the header, the notices and the footer stand above and below
  // both, because the date, the app's voice and the way out belong to the
  // window rather than to either view.
  const dayBody = el('div', 'day-body')
  dayBody.append(
    carry.element, horizon.element, items.element,
    add.element, sections.element, noteRow, sections.evidence,
  )

  // The same board the spread window draws, laid out downwards by a class
  // rather than rebuilt by a second component: a board drawn twice by two
  // modules would be two things to keep in step, and the half that drifted
  // would be the drag.
  const board = createBoardView(() => boardShowing(), handlers.onCard, handlers.onFinish)
  board.element.classList.add('stacked')

  const surface = el('div', 'page')
  surface.append(
    head, notices.element, dayBody, board.element,
    foot.element, search.element, settings.element, noteView.element,
  )
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

  page = { weekday, date, todayButton, head, pin, notices, foot, board, dayBody, horizon, items, carry, sections, note, noteRow, margin, search, settings, noteView }
}

/**
 * The view on screen, which is the one asked for unless there is nothing
 * behind it.
 *
 * A plugin can be switched off while its board is the tab you are looking at,
 * and a page left showing a board that no longer exists is a page showing
 * nothing. The same rule the spread window's `showing()` follows, and the day
 * is this window's fallback the way the week is that one's.
 *
 * @returns {string}
 */
export function showing() {
  const asked = currentState?.view ?? DAY_VIEW
  if (pluginOfView(asked) === null) return DAY_VIEW
  return boardShowing() === null ? DAY_VIEW : asked
}

/**
 * The board on screen, or null when what is on screen is not one.
 *
 * Read off `tabs` rather than `boards`: a tab exists because a manifest says
 * so, and a board whose plugin has not answered yet is still the board you
 * asked for. The answer, when there is one, comes from `boards`.
 *
 * @returns {import('../plugins/pageAsking.js').Board|null}
 */
function boardShowing() {
  const plugin = pluginOfView(currentState?.view ?? '')
  if (plugin === null) return null
  const answered = (currentState?.boards ?? []).find((board) => board.plugin === plugin)
  if (answered !== undefined) return answered

  // Named in the strip but not yet asked - the draw that switched to it. Drawn
  // as the empty board rather than as nothing, so the tab is never a blank
  // page.
  const tab = (currentState?.tabs ?? []).find((one) => one.plugin === plugin)
  return tab === undefined ? null : { plugin, tab: tab.tab, board: '', answer: null }
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
 * The search that lies over the page (spec §5.7): opened, closed, and asked
 * whether it is up.
 *
 * @returns {ReturnType<typeof createSearchPanel>}
 */
export function search() {
  if (page === null) throw new Error('search before mount')
  return page.search
}

/**
 * The settings pane, which lies over the page in the same way (spec §3.6).
 *
 * @returns {ReturnType<typeof createSettingsPanel>}
 */
export function settings() {
  if (page === null) throw new Error('settings before mount')
  return page.settings
}

/**
 * A note, which lies over the page in the same way (spec §2.1).
 *
 * The day underneath is left exactly as it was: this view is opened, closed
 * and asked what it is showing, and never redraws the page behind it.
 *
 * @returns {ReturnType<typeof createNoteView>}
 */
export function noteView() {
  if (page === null) throw new Error('noteView before mount')
  return page.noteView
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

  const on = showing()
  const board = pluginOfView(on) !== null
  page.dayBody.hidden = board
  page.board.element.hidden = !board
  // Stepping through days while a board is up would move a date that the
  // board does not follow: a board is an arrangement of today and only today
  // (spec, `.plan/spec.md`). The date itself stays - it says which day the
  // board is about - but the way to change it does not.
  setClass(page.head, 'on-board', board)

  page.notices.render(state.notices, state.actions)
  // Only what is on screen is drawn, the way the spread window's views are: a
  // hidden list measures nothing correctly and redrawing it on every keystroke
  // is work nobody can see.
  if (board) page.board.render()
  page.foot.render({ open: openCount(state.doc), boards: state.tabs, view: on })
  if (board) return

  page.carry.render(state.carry, state.today)
  page.horizon.render(state.horizon)
  page.items.render(state.doc, state.badges)
  page.sections.render({ contributed: state.sections, blocks: state.blocks, prefixes: state.prefixes })
  renderNote(page.note, state.doc)
  renderBox(page.margin, state.box ?? null)
  // The row is only there for what is in it. A day with no file and no
  // picture keeps the blank bottom the page had before this row existed,
  // rather than a rule across it with nothing under.
  page.noteRow.hidden = page.note.hidden && page.margin.hidden
}

/**
 * @param {number} days
 * @returns {string}
 */
function step(days) {
  return currentState === null ? '' : addDays(currentState.page, days)
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

/**
 * The picture in the day's margin.
 *
 * An `<img>` with a `data:` URI, and that is the whole of the isolation: an
 * SVG loaded this way is an independent document with no script, no network
 * and no reach into this one, whatever `picture.js` may have missed. The
 * reader is a belt over these braces rather than the other way round.
 *
 * Rebuilt only when the drawing actually changed. `render` runs on every
 * keystroke in the add row, and re-assigning the same `src` makes the browser
 * decode the picture again.
 *
 * @param {HTMLElement} element
 * @param {import('../core/box.js').Box|null} box
 * @returns {void}
 */
function renderBox(element, box) {
  element.hidden = box === null
  if (box === null) {
    element.replaceChildren()
    return
  }

  const src = `data:image/svg+xml,${encodeURIComponent(box.picture.svg)}`
  const showing = element.firstElementChild
  /** @type {HTMLImageElement} */
  const img = showing instanceof HTMLImageElement
    ? showing
    : element.ownerDocument.createElement('img')
  if (img !== showing) element.replaceChildren(img)

  if (img.getAttribute('src') !== src) img.setAttribute('src', src)
  img.width = box.width
  img.height = box.height
  // The only word the app has for it. A plugin is never asked for one: a slot
  // that is told no line's words cannot be trusted to describe the page, and
  // a picture that could put text on screen is a picture that could say
  // something about a day it was never shown.
  img.alt = box.plugin
}

/**
 * The line holding the caret, as it reads on screen (spec §4.3).
 *
 * Null when the caret is somewhere that is not a line - the add row, the
 * daily note, a note's own page, the search field, or nowhere at all. A
 * gesture about a line simply does not fire, rather than guessing at which
 * line was meant.
 *
 * The note under a line counts as that line: `closest('.item')` resolves both
 * to the row, which is the same rule dragging already follows.
 *
 * @returns {{index: number, text: string}|null}
 */
export function focusedLine() {
  if (page === null) return null
  const active = page.items.element.ownerDocument.activeElement
  if (!(active instanceof HTMLElement)) return null

  const index = indexOf(active)
  const text = textOf(active)
  if (index === null || text === null) return null
  return { index, text }
}
