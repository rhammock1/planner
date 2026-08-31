// @ts-check

/**
 * The day page - what the popover shows (spec §5.1).
 *
 * DOM only. Every decision about what belongs on the page was made in core
 * before this module was called; this turns that answer into elements and
 * hands clicks back out.
 */

import { patchList } from '../ui/keyedList.js'
import { el, setText, setClass } from '../ui/dom.js'

/** @typedef {import('../core/model.js').Document} Document */
/** @typedef {import('../core/model.js').Node} Node */
/** @typedef {import('../core/horizon.js').HorizonEntry} HorizonEntry */

/**
 * @typedef {object} DayState
 * @property {string} today `YYYY-MM-DD`
 * @property {string} page  the day being shown
 * @property {Document|null} doc  null when the day has no file yet
 * @property {HorizonEntry[]} horizon
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

/** @typedef {{kind: string, index: number, node: Node}} Row */

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' })
const FULL_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
})
const SHORT_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', timeZone: 'UTC',
})

/** @type {{root: HTMLElement, parts: Parts}|null} */
let mounted = null

/**
 * @typedef {object} Parts
 * @property {HTMLElement} weekday
 * @property {HTMLElement} date
 * @property {HTMLElement} today
 * @property {HTMLElement} notices
 * @property {HTMLElement} carry
 * @property {HTMLElement} carryLabel
 * @property {HTMLElement} carryItems
 * @property {HTMLElement} review
 * @property {HTMLElement} horizon
 * @property {HTMLElement} horizonTrack
 * @property {HTMLElement} items
 * @property {HTMLElement} note
 * @property {HTMLElement} count
 */

/**
 * Builds the page once. Everything after this is a patch.
 *
 * @param {HTMLElement} root
 * @param {DayHandlers} handlers
 * @returns {void}
 */
export function mount(root, handlers) {
  const page = el('div', 'page')

  const weekday = el('span')
  const date = el('small')
  const heading = el('div', 'page-date')
  heading.append(weekday, date)

  const previous = el('button', undefined, '‹')
  const today = el('button', 'now', '•')
  const next = el('button', undefined, '›')
  previous.title = 'The day before'
  today.title = 'Today'
  next.title = 'The day after'
  const nav = el('div', 'page-nav')
  nav.append(previous, today, next)

  const head = el('div', 'page-head')
  head.append(heading, nav)

  const notices = el('ul', 'notices')

  const carryLabel = el('span', 'carry-label')
  const keepAll = el('button', 'carry-action', 'Keep all')
  const review = el('button', 'carry-action', 'Review')
  const carryHead = el('div', 'carry-head')
  carryHead.append(carryLabel, keepAll, review)
  const carryItems = el('ul', 'carry-items')
  carryItems.hidden = true
  const carry = el('div', 'carry')
  carry.append(carryHead, carryItems)

  const horizonTrack = el('div', 'horizon-track')
  const mask = el('div', 'horizon-mask')
  mask.append(horizonTrack)
  const horizon = el('div', 'horizon')
  horizon.append(el('span', 'horizon-label', 'Ahead'), mask)

  const items = el('ul', 'items')

  const field = el('input')
  if (!(field instanceof HTMLInputElement)) throw new Error('input element expected')
  field.className = 'add-field'
  field.placeholder = 'Write something down'
  field.setAttribute('aria-label', 'Add an item')
  const add = el('div', 'add')
  add.append(field)

  const note = el('div', 'note')

  const count = el('span', 'count')
  const tabs = el('div', 'tabs')
  for (const name of ['Day', 'Week', 'Month', 'Someday']) {
    tabs.append(el('span', name === 'Day' ? 'tab on' : 'tab', name))
  }
  const foot = el('div', 'page-foot')
  foot.append(tabs, count)

  page.append(head, notices, carry, horizon, items, add, note, foot)
  root.replaceChildren(page)

  previous.addEventListener('click', () => handlers.onNavigate(step(-1)))
  next.addEventListener('click', () => handlers.onNavigate(step(1)))
  today.addEventListener('click', () => handlers.onNavigate(currentState?.today ?? ''))

  // Delegated, so a row that is patched in later needs no wiring of its own.
  items.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.classList.contains('item-check')) return
    const row = target.closest('.item')
    const index = row instanceof HTMLElement ? Number(row.dataset['key']?.split(':')[1]) : Number.NaN
    if (Number.isInteger(index)) handlers.onToggle(index)
  })

  keepAll.addEventListener('click', () => {
    handlers.onCarry(decisionsFor(currentState?.carry ?? [], 'keep'))
  })

  review.addEventListener('click', () => {
    carryItems.hidden = !carryItems.hidden
    setText(review, carryItems.hidden ? 'Review' : 'Hide')
  })

  carryItems.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const action = target.dataset['action']
    const row = target.closest('li')
    const ref = row instanceof HTMLElement ? row.dataset['ref'] : undefined
    if (ref === undefined || (action !== 'keep' && action !== 'drop')) return
    const [page, index] = ref.split('@')
    if (page === undefined || index === undefined) return
    handlers.onCarry([{ page, index: Number(index), action }])
  })

  field.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      field.value = ''
      field.blur()
      return
    }
    if (event.key !== 'Enter' || field.value.trim() === '') return
    const line = field.value
    // The field is cleared only once the write has come back. A failed save
    // leaves what was typed where it is (spec §8).
    handlers.onAdd(line).then((saved) => {
      if (saved && field.value === line) field.value = ''
    })
  })

  mounted = {
    root,
    parts: {
      weekday, date, today, notices, carry, carryLabel, carryItems, review,
      horizon, horizonTrack, items, note, count,
    },
  }
}

/** @type {DayState|null} */
let currentState = null

/**
 * @param {number} days
 * @returns {string}
 */
function step(days) {
  if (currentState === null) return ''
  const at = new Date(`${currentState.page}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

/**
 * @param {DayState} state
 * @returns {void}
 */
export function render(state) {
  if (mounted === null) throw new Error('render before mount')
  currentState = state
  const parts = mounted.parts
  const when = new Date(`${state.page}T00:00:00Z`)

  setText(parts.weekday, WEEKDAY.format(when))
  setText(parts.date, FULL_DATE.format(when))
  setClass(parts.today, 'now', state.page === state.today)

  renderNotices(parts.notices, state.notices)
  renderCarry(parts, state.carry)
  renderHorizon(parts.horizon, parts.horizonTrack, state.horizon)
  renderItems(parts.items, state.doc)
  renderNote(parts.note, state.doc)

  const open = rowsOf(state.doc).filter(
    (row) => row.node.kind === 'item' && row.node.state === 'open',
  ).length
  setText(parts.count, open === 0 ? 'nothing left' : `${open} left`)
}

/**
 * @param {HTMLElement} list
 * @param {string[]} notices
 * @returns {void}
 */
function renderNotices(list, notices) {
  patchList(list, notices, {
    keyOf: (notice) => notice,
    create: (notice) => el('li', undefined, notice),
    update: (element, notice) => setText(element, notice),
  })
}

/**
 * The band that says what did not get done (spec §5.4). It is the only place
 * the app nags, and it stops as soon as every line is answered - keeping or
 * dropping settles an item, and a settled item is not open any more.
 *
 * @param {Parts} parts
 * @param {import('../core/carry.js').CarryGroup[]} groups
 * @returns {void}
 */
function renderCarry(parts, groups) {
  parts.carry.hidden = groups.length === 0
  if (groups.length === 0) {
    parts.carryItems.hidden = true
    setText(parts.review, 'Review')
    return
  }

  const total = groups.reduce((sum, group) => sum + group.items.length, 0)
  const from = groups.length === 1 && groups[0] !== undefined
    ? dayName(groups[0].from)
    : `${groups.length} earlier days`
  setText(parts.carryLabel, `${total} unfinished from ${from}`)

  /** @type {{page: string, index: number, text: string}[]} */
  const rows = groups.flatMap((group) => group.items.map((entry) => ({
    page: entry.page, index: entry.index, text: entry.item.text,
  })))

  patchList(parts.carryItems, rows, {
    keyOf: (row) => `${row.page}@${row.index}`,
    create: () => {
      const row = el('li')
      const keep = el('button', 'carry-action', 'Keep')
      keep.dataset['action'] = 'keep'
      const drop = el('button', 'carry-action', 'Drop')
      drop.dataset['action'] = 'drop'
      row.append(el('span', 'carry-text'), keep, drop)
      return row
    },
    update: (element, row) => {
      element.dataset['ref'] = `${row.page}@${row.index}`
      const text = element.firstElementChild
      if (text instanceof HTMLElement) setText(text, row.text)
    },
  })
}

/**
 * A weekday for the last few days, a date beyond that - the way a person
 * refers to a day they can still picture, versus one they cannot.
 *
 * @param {string} date `YYYY-MM-DD`
 * @returns {string}
 */
function dayName(date) {
  const when = new Date(`${date}T00:00:00Z`)
  const days = Math.round((Date.now() - when.getTime()) / 86400000)
  return days <= 6 ? WEEKDAY.format(when) : SHORT_DATE.format(when)
}

/**
 * @param {import('../core/carry.js').CarryGroup[]} groups
 * @param {'keep'|'drop'} action
 * @returns {import('../core/carry.js').CarryDecision[]}
 */
function decisionsFor(groups, action) {
  return groups.flatMap((group) => group.items.map(
    (entry) => ({ page: entry.page, index: entry.index, action }),
  ))
}

/**
 * The strip only marquees when it has to (spec §5.3). Deadlines that fit sit
 * still, because a band that scrolls when there is nothing to scroll to is
 * movement for its own sake.
 *
 * When it does overflow, the track carries the same run twice so the loop can
 * translate exactly half its width. The copy is hidden from assistive
 * technology, and from a reduced-motion reader who scrolls the first one.
 *
 * @param {HTMLElement} strip
 * @param {HTMLElement} track
 * @param {HorizonEntry[]} entries
 * @returns {void}
 */
function renderHorizon(strip, track, entries) {
  strip.hidden = entries.length === 0
  if (entries.length === 0) return

  const run = buildRun(entries, false)
  track.replaceChildren(run)

  // Measured after the run is in the document, and only then: the width of
  // the text is not knowable any other way.
  const mask = track.parentElement
  const overflows = mask !== null && run.scrollWidth > mask.clientWidth
  setClass(track, 'marquee', overflows)
  if (overflows) track.append(buildRun(entries, true))
  else run.style.paddingRight = '0'
}

/**
 * @param {HorizonEntry[]} entries
 * @param {boolean} repeat
 * @returns {HTMLElement}
 */
function buildRun(entries, repeat) {
  const run = el('div', repeat ? 'horizon-run repeat' : 'horizon-run')
  if (repeat) run.setAttribute('aria-hidden', 'true')
  for (const entry of entries) {
    const item = el('span', entry.overdue ? 'hz due' : 'hz')
    item.append(el('b', undefined, daysLabel(entry.daysRemaining)), document.createTextNode(entry.item.text))
    run.append(item)
  }
  return run
}

/**
 * @param {number} days
 * @returns {string}
 */
function daysLabel(days) {
  if (days < 0) return `${Math.abs(days)}d late`
  if (days === 0) return 'today'
  return `${days}d`
}

/**
 * @param {HTMLElement} list
 * @param {Document|null} doc
 * @returns {void}
 */
function renderItems(list, doc) {
  patchList(list, rowsOf(doc), {
    keyOf: (row) => `${row.kind}:${row.index}`,
    create: (row) => (row.node.kind === 'item' ? createItem() : el('li', 'opaque')),
    update: (element, row) => {
      if (row.node.kind === 'opaque') {
        setText(element, row.node.raw)
        return
      }
      updateItem(element, row.node)
    },
  })
}

/** @returns {HTMLElement} */
function createItem() {
  const row = el('li', 'item')
  const check = el('span', 'item-check')
  check.setAttribute('role', 'checkbox')
  row.append(check, el('span', 'item-text'), el('span', 'item-time'), el('span', 'item-note'))
  return row
}

/**
 * @param {HTMLElement} row
 * @param {import('../core/model.js').Item} item
 * @returns {void}
 */
function updateItem(row, item) {
  const [, text, time, note] = row.children
  if (!(text instanceof HTMLElement) || !(time instanceof HTMLElement) || !(note instanceof HTMLElement)) return

  row.className = `item ${item.state}${item.due === null ? '' : ' due'}`
  setText(text, item.text)
  setText(time, item.time ?? '')
  time.hidden = item.time === null
  setText(note, item.note ?? '')
  note.hidden = item.note === null
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

/**
 * Blank lines are structure, not content: they are preserved in the file and
 * left out of the page.
 *
 * @param {Document|null} doc
 * @returns {Row[]}
 */
function rowsOf(doc) {
  if (doc === null) return []
  /** @type {Row[]} */
  const rows = []
  doc.nodes.forEach((node, index) => {
    if (node.kind === 'opaque' && node.raw.trim() === '') return
    rows.push({ kind: node.kind, index, node })
  })
  return rows
}
