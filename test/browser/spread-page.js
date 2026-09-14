// @ts-check

/**
 * The detached window's layout and view switching, which only a browser can
 * measure.
 *
 * The same shape of failure the day page had: a long list growing past the
 * bottom of the window and taking the add row with it. Here the window is
 * resizable and much taller, so the check is that the list is what gives.
 */

import { check, ok, equal, report } from './harness.js'
import { parse } from '../../src/core/parse.js'
import { buildIndex } from '../../src/core/vaultIndex.js'
import { VIEWS } from '../../src/views/spreadViews.js'
import * as spreadPage from '../../src/views/spreadPage.js'

const found = document.querySelector('#stage')
if (!(found instanceof HTMLElement)) throw new Error('no stage')
const stage = found

/** @type {string[]} */
const added = []

/** @type {string[]} */
const anchored = []

/** @type {string[]} */
const viewed = []

/** @type {string[]} */
const moved = []

/** Cards dropped in a column, as `id -> column` or `id -> column before id`. */
/** @type {string[]} */
const dropped = []

/** Cards dropped on the last column, which is not a drop target. */
/** @type {string[]} */
const finished = []

/**
 * @param {number} count
 * @returns {string}
 */
function backPageOf(count) {
  const lines = []
  for (let at = 1; at <= count; at += 1) lines.push(`- [ ] Something number ${at}`)
  return `# Someday\n\n${lines.join('\n')}\n`
}

/**
 * @param {number} count
 * @param {string} [view]
 * @param {string[]} [days]  days to give a page of their own, `YYYY-MM-DD`
 * @returns {void}
 */
function show(count, view = 'someday', days = [], lines = '') {
  showAt('2026-09-01', view, count, days, lines)
}

/**
 * The window with boards in it, which is the only thing the strip needs to
 * draw a board's tab.
 *
 * @param {string} view
 * @param {import('../../src/plugins/pageAsking.js').Board[]} boards
 * @returns {void}
 */
function showBoards(view, boards) {
  showAt('2026-09-01', view, 0, [], '', boards)
}

/**
 * @param {string} plugin
 * @param {string} tab
 * @param {import('../../src/core/board.js').Column[]|null} columns
 * @returns {import('../../src/plugins/pageAsking.js').Board}
 */
function board(plugin, tab, columns) {
  return { plugin, tab, board: '', answer: columns === null ? null : { columns, archive: [] } }
}

/**
 * @param {string} text
 * @param {string} id
 * @param {'done'|'dropped'|null} [ended]
 * @returns {import('../../src/core/board.js').Card}
 */
function card(text, id, ended = null) {
  return { id, index: null, text, ended }
}

/**
 * @param {string} anchor `YYYY-MM-DD`
 * @param {string} view
 * @param {number} [count]
 * @param {string[]} [days]
 * @param {string} [lines]  the body of each day's page, when given
 * @param {import('../../src/plugins/pageAsking.js').Board[]} [boards]
 * @returns {void}
 */
function showAt(anchor, view, count = 0, days = [], lines = '', boards = []) {
  stage.replaceChildren()
  const root = document.createElement('main')
  root.id = 'app'
  stage.append(root)

  spreadPage.mount(root, {
    editsFor: (pageOf) => ({
      onToggle: () => {},
      onEdit: async () => true,
      onNote: async () => true,
      onStrike: () => {},
      onRemove: async () => true,
      onAdd: async (line) => { added.push(pageOf() === 'someday' ? line : `${pageOf()}: ${line}`); return true },
      onDailyNote: async () => true,
    }),
    onView: (next) => { viewed.push(next) },
    onAnchor: (next) => { anchored.push(next) },
    onMove: (from, index, to) => { moved.push(`${from}:${index} -> ${to}`) },
    onCard: (plugin, id, column, before) => {
      dropped.push(`${plugin}/${id} -> ${column}${before === null ? '' : ` before ${before}`}`)
    },
    onFinish: (id) => { finished.push(id) },
    onBadge: () => {},
    onSearch: () => ({ groups: [], found: 0 }),
    onProviders: () => ({ groups: [], notices: [] }),
    onJump: () => {},
    onFollow: () => {},
    // These checks are about the tab strip and the three views behind it; the
    // file view is driven by `note-view.js`, against the editor itself.
    file: {
      onWrite: async () => true,
      onFollow: () => {},
      onOpenLink: () => {},
      onClose: () => {},
    },
  })

  spreadPage.render({
    view,
    today: '2026-09-01',
    anchor,
    file: null,
    boards,
    vault: buildIndex([
      { page: 'someday', doc: parse(backPageOf(count)) },
      ...days.map((day) => ({
        page: day,
        doc: parse(lines === '' ? dayOf(day, count) : `# ${day}\n\n${lines}`),
      })),
    ]),
    notices: [],
  })
}

/**
 * @param {string} day `YYYY-MM-DD`
 * @param {number} count
 * @returns {string}
 */
function dayOf(day, count) {
  const lines = []
  for (let at = 1; at <= count; at += 1) lines.push(`- [ ] Line number ${at}`)
  return `# ${day}\n\n${lines.join('\n')}\n`
}

/**
 * The view on screen. Hidden views keep their DOM, so a bare query against
 * the stage would just as happily return the week's first add row while the
 * back page is showing.
 *
 * @returns {HTMLElement}
 */
function onScreen() {
  const view = stage.querySelector('.view:not([hidden])')
  if (!(view instanceof HTMLElement)) throw new Error('nothing on screen')
  return view
}

/**
 * The month cell for a date. Cells carry it as their title, because a grid of
 * bare numbers has two 3rds in it.
 *
 * @param {string} date `YYYY-MM-DD`
 * @returns {HTMLElement}
 */
function cellFor(date) {
  return find(`.month-cell[title="${date}"]`)
}

/**
 * @param {string} selector
 * @param {ParentNode} [within]
 * @returns {HTMLElement}
 */
function find(selector, within) {
  const element = (within ?? onScreen()).querySelector(selector)
  if (!(element instanceof HTMLElement)) throw new Error(`no ${selector}`)
  return element
}

/**
 * @param {string} selector
 * @param {ParentNode} [within]
 * @returns {DOMRect}
 */
function box(selector, within) {
  if (selector === '.spread') {
    return find(selector, stage).getBoundingClientRect()
  }
  return find(selector, within).getBoundingClientRect()
}

check('the back page shows every line someday.md has', () => {
  show(4, 'someday')
  equal(onScreen().querySelectorAll('.item').length, 4, 'rows')
})

check('a list longer than the window does not push the add row off it', () => {
  show(60, 'someday')
  const window = box('.spread')
  const add = box('.add')
  ok(add.bottom <= window.bottom + 1, `add row at ${add.bottom} in a window ending at ${window.bottom}`)
})

check('the list is what scrolls, not the window', () => {
  show(60, 'someday')
  const items = find('.items')
  ok(items.scrollHeight > items.clientHeight, 'the list has more in it than it shows')
  equal(stage.querySelector('.spread')?.scrollHeight, box('.spread').height, 'the window itself does not scroll')
})

check('a short list leaves the add row at the bottom', () => {
  show(2, 'someday')
  const window = box('.spread')
  const add = box('.add')
  ok(add.bottom > window.bottom - 60, `add row at ${add.bottom}, window ends at ${window.bottom}`)
})

check('a view the shell asks for that does not exist falls back to one that does', () => {
  show(3, 'diary')
  equal(spreadPage.showing(), VIEWS[0], 'showing')
  const first = stage.querySelector(`.view:not([hidden])`)
  ok(first instanceof HTMLElement, 'something is on screen')
})

check('only the view on screen is in the document flow', () => {
  show(3, 'someday')
  const shown = [...stage.querySelectorAll('.view')].filter((view) => view instanceof HTMLElement && !view.hidden)
  equal(shown.length, 1, 'views on screen')
})

check('the tab for the view on screen is the one marked on', () => {
  show(3, 'someday')
  const on = [...stage.querySelectorAll('.tab.on')].map((tab) => tab.textContent)
  equal(on.length, 1, 'exactly one tab is on')
  equal(on[0], 'Someday', 'which one')
})

check('the add row commits a line', () => {
  show(1, 'someday')
  added.length = 0
  const field = find('.add-field')
  if (!(field instanceof HTMLInputElement)) throw new Error('no add field')
  field.value = 'Fix the gate'
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  equal(added[0], 'Fix the gate', 'what was committed')
})


check('the week is seven columns, Monday first', () => {
  show(2, 'week')
  const names = [...onScreen().querySelectorAll('.day-name')].map((name) => name.textContent)
  equal(names.length, 7, 'columns')
  equal(names[0], 'Mon', 'the first column')
  equal(names[6], 'Sun', 'the last column')
})

check('today is the only column marked as today', () => {
  show(2, 'week')
  const marked = [...onScreen().querySelectorAll('.day-column.is-today .day-number')].map((n) => n.textContent)
  equal(marked.length, 1, 'columns marked')
  equal(marked[0], '1', 'which one')
})

check("a column shows its own day's lines and nobody else's", () => {
  show(3, 'week', ['2026-09-02'])
  const columns = [...onScreen().querySelectorAll('.day-column')]
  const wednesday = columns[2]
  if (!(wednesday instanceof HTMLElement)) throw new Error('no Wednesday')
  equal(wednesday.querySelectorAll('.item').length, 3, 'Wednesday')
  const thursday = columns[3]
  if (!(thursday instanceof HTMLElement)) throw new Error('no Thursday')
  equal(thursday.querySelectorAll('.item').length, 0, 'Thursday')
})

check('a column longer than the window does not push the week past the bottom of it', () => {
  show(60, 'week', ['2026-09-02'])
  const window = box('.spread')
  const grid = box('.week-grid')
  ok(grid.bottom <= window.bottom + 1, `the grid ends at ${grid.bottom} in a window ending at ${window.bottom}`)
})

check("a column's add row stays in the column", () => {
  show(60, 'week', ['2026-09-02'])
  const column = onScreen().querySelectorAll('.day-column')[2]
  if (!(column instanceof HTMLElement)) throw new Error('no Wednesday')
  const add = column.querySelector('.add')
  if (!(add instanceof HTMLElement)) throw new Error('no add row')
  ok(add.getBoundingClientRect().bottom <= column.getBoundingClientRect().bottom + 1, 'add row inside its column')
})

check("a line added to a column is written to that column's day", () => {
  show(1, 'week', ['2026-09-02'])
  added.length = 0
  const column = onScreen().querySelectorAll('.day-column')[4]
  if (!(column instanceof HTMLElement)) throw new Error('no Friday')
  const field = column.querySelector('.add-field')
  if (!(field instanceof HTMLInputElement)) throw new Error('no add field')
  field.value = 'Call the vet'
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  equal(added[0], '2026-09-04: Call the vet', 'what was committed, and where')
})

check('a narrow window scrolls the week sideways rather than the page', () => {
  show(2, 'week')
  stage.style.width = '520px'
  const grid = find('.week-grid')
  ok(grid.scrollWidth > grid.clientWidth, 'the grid has more width than it shows')
  const spread = find('.spread', stage)
  equal(spread.scrollWidth, spread.clientWidth, 'the window itself does not scroll sideways')
  stage.style.width = '880px'
})

check('the arrows move a whole week at a time', () => {
  show(2, 'week')
  anchored.length = 0
  const nav = [...find('.view-head').querySelectorAll('button')]
  nav[0]?.click()
  nav[2]?.click()
  equal(anchored[0], '2026-08-24', 'the week before')
  equal(anchored[1], '2026-09-07', 'the week after')
})

check('the dot asks for today, and is lit when today is on screen', () => {
  show(2, 'week')
  anchored.length = 0
  const dot = [...find('.view-head').querySelectorAll('button')][1]
  ok(dot instanceof HTMLElement && dot.classList.contains('now'), 'lit for the week today is in')
  dot?.click()
  equal(anchored[0], '', 'what it asks for')
})

check('the month is whole weeks, Monday first', () => {
  show(0, 'month')
  const headings = [...find('.month-headings').querySelectorAll('.day-name')].map((n) => n.textContent)
  equal(headings.length, 7, 'headings')
  equal(headings[0], 'Mon', 'the first')
  equal(headings[6], 'Sun', 'the last')
  const cells = [...onScreen().querySelectorAll('.month-cell')].filter((c) => c instanceof HTMLElement && !c.hidden)
  equal(cells.length % 7, 0, `${cells.length} cells`)
})

check('the days either side of the month are shown, marked as outside it', () => {
  show(0, 'month')
  const outside = [...onScreen().querySelectorAll('.month-cell:not([hidden]).outside')]
  ok(outside.length > 0, 'September 2026 starts on a Tuesday, so August is in the grid')
  const inside = [...onScreen().querySelectorAll('.month-cell:not([hidden]):not(.outside)')]
  equal(inside.length, 30, 'days in September')
})

check('today is the only cell marked as today', () => {
  show(0, 'month')
  const marked = [...onScreen().querySelectorAll('.month-cell.is-today .cell-number')].map((n) => n.textContent)
  equal(marked.length, 1, 'cells marked')
  equal(marked[0], '1', 'which one')
})

check('a cell counts what is open on its day and marks what is due on it', () => {
  show(0, 'month', ['2026-09-02'], '- [ ] One\n- [x] Two\n- [ ] Three !2026-09-11\n')
  const cell = cellFor('2026-09-02')
  equal(cell.querySelector('.cell-open')?.textContent, '2', 'open on the 2nd')
  const eleventh = cellFor('2026-09-11')
  const dot = eleventh.querySelector('.cell-due')
  ok(dot instanceof HTMLElement && !dot.hidden, 'the deadline is marked on the day it falls, not the day it was written')
})

check('clicking a cell goes to the week that day is in', () => {
  show(0, 'month')
  anchored.length = 0
  viewed.length = 0
  cellFor('2026-09-17').click()
  equal(anchored[0], '2026-09-17', 'where')
  equal(viewed[0], 'week', 'and into which view')
})

check('the arrows move a whole month at a time', () => {
  show(0, 'month')
  anchored.length = 0
  const nav = [...find('.view-head').querySelectorAll('button')]
  nav[0]?.click()
  nav[2]?.click()
  equal(anchored[0], '2026-08-01', 'the month before')
  equal(anchored[1], '2026-10-01', 'the month after')
})

check('a month that needs fewer rows is fewer rows tall', () => {
  show(0, 'month')
  const tall = onScreen().querySelectorAll('.month-cell:not([hidden])').length
  // A month is four rows only when it has 28 days and starts on a Monday.
  showAt('2027-02-10', 'month')
  const short = onScreen().querySelectorAll('.month-cell:not([hidden])').length
  equal(tall, 35, 'September 2026')
  equal(short, 28, 'February 2027, which is exactly four weeks')
})

check('the month grid stays inside the window', () => {
  show(0, 'month')
  const window = box('.spread', stage)
  const grid = box('.month-grid')
  ok(grid.bottom <= window.bottom + 1, `the grid ends at ${grid.bottom} in a window ending at ${window.bottom}`)
})

/**
 * Picks a row up and drops it on a column, with the same events a pointer
 * would generate.
 *
 * @param {HTMLElement} row
 * @param {HTMLElement} onto
 * @returns {{allowed: boolean}}  whether the column agreed to take it
 */
function dragTo(row, onto) {
  const data = new DataTransfer()
  row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }))
  const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data })
  onto.dispatchEvent(over)
  onto.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
  row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }))
  return { allowed: over.defaultPrevented }
}

/**
 * @param {number} slot 0 for Monday
 * @returns {HTMLElement}
 */
function column(slot) {
  const found = onScreen().querySelectorAll('.day-column')[slot]
  if (!(found instanceof HTMLElement)) throw new Error(`no column ${slot}`)
  return found
}

check("a week column's lines can be picked up; the back page's cannot", () => {
  show(2, 'week', ['2026-09-02'])
  ok(find('.item', column(2)).draggable, 'a line in the week')
  show(2, 'someday')
  equal(find('.item').draggable, false, 'a line on the back page, which has nowhere to drop')
})

check('a line dropped on another day is moved to it', () => {
  show(2, 'week', ['2026-09-02'])
  moved.length = 0
  const { allowed } = dragTo(find('.item', column(2)), column(4))
  ok(allowed, 'the column agreed to take it')
  equal(moved[0], '2026-09-02:1 -> 2026-09-04', 'from where, which line, to where')
})

check('a line dropped back on its own day is not moved', () => {
  show(2, 'week', ['2026-09-02'])
  moved.length = 0
  dragTo(find('.item', column(2)), column(2))
  equal(moved.length, 0, 'moves')
})

check('a week line is read-only, so the press starts a drag rather than a caret', () => {
  show(2, 'week', ['2026-09-02'])
  const text = find('.item-text', column(2))
  equal(text.isContentEditable, false, 'a line in the week')
  // A contenteditable region takes the press to place a caret, and no drag
  // ever begins - which is what this is here to stop coming back.
  show(2, 'someday')
  equal(find('.item-text').isContentEditable, true, 'a line on the back page, which is written in')
})

check('a drag begun on the text inside a line still carries the line', () => {
  show(2, 'week', ['2026-09-02'])
  moved.length = 0
  // The browser reports the text node itself as the target of such a drag,
  // and a text node has no `closest`.
  const text = find('.item-text', column(2))
  const data = new DataTransfer()
  text.firstChild?.dispatchEvent?.(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }))
  text.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }))
  const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data })
  column(4).dispatchEvent(over)
  column(4).dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }))
  equal(moved[0], '2026-09-02:1 -> 2026-09-04', 'from where, which line, to where')
})

check('something dragged in from elsewhere is not offered a drop', () => {
  show(2, 'week', ['2026-09-02'])
  const data = new DataTransfer()
  data.setData('text/plain', 'a line from a text editor')
  const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data })
  column(4).dispatchEvent(over)
  equal(over.defaultPrevented, false, 'the column did not agree to take it')
})

check('the column a line would land in is the only one marked', () => {
  show(2, 'week', ['2026-09-02'])
  const data = new DataTransfer()
  const row = find('.item', column(2))
  row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }))
  column(5).dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }))
  const marked = [...onScreen().querySelectorAll('.day-column.dropping')]
  equal(marked.length, 1, 'columns marked')
  equal(marked[0], column(5), 'which one')
  row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }))
  equal(onScreen().querySelectorAll('.day-column.dropping').length, 0, 'and the mark is let go of')
})

/* ── the boards ─────────────────────────────────────────── */

check('a board plugin gets a tab, labelled the way the manifest asked', () => {
  showBoards('week', [board('kanban', 'Kanban', [])])
  const labels = [...stage.querySelectorAll('.tab')].map((tab) => tab.textContent)
  ok(labels.includes('Kanban'), `tabs are ${labels.join(', ')}`)
})

check('no board plugin, no extra tab', () => {
  show(1, 'week')
  // The file's tab is built at mount and hidden until there is a file, so the
  // count is of what is on the strip rather than of what is in it.
  const labels = [...stage.querySelectorAll('.tab')]
    .filter((tab) => tab instanceof HTMLElement && !tab.hidden)
    .map((tab) => tab.textContent)
  equal(labels.length, VIEWS.length, `tabs are ${labels.join(', ')}`)
})

check('a board tab asks for that board and no other', () => {
  showBoards('week', [board('kanban', 'Kanban', []), board('scrum', 'Scrum', [])])
  viewed.length = 0
  const tab = [...stage.querySelectorAll('.tab')].find((one) => one.textContent === 'Scrum')
  if (!(tab instanceof HTMLElement)) throw new Error('no Scrum tab')
  tab.click()
  equal(viewed[0], 'board:scrum', 'what the tab asked for')
})

check("the board on screen is the one the strip asked for, and it is the only tab marked on", () => {
  showBoards('board:scrum', [board('kanban', 'Kanban', []), board('scrum', 'Scrum', [])])
  equal(find('.view-title', onScreen()).textContent, 'Scrum', 'the board on screen')
  const on = [...stage.querySelectorAll('.tab.on')].map((tab) => tab.textContent)
  equal(on.length, 1, 'exactly one tab is on')
  equal(on[0], 'Scrum', 'which one')
})

check('a board whose plugin has gone falls back to a view that is there', () => {
  showBoards('board:kanban', [])
  equal(spreadPage.showing(), VIEWS[0], 'showing')
  equal(stage.querySelectorAll('.view:not([hidden])').length, 1, 'views on screen')
})

check("a board draws its columns and each column's own cards", () => {
  showBoards('board:kanban', [board('kanban', 'Kanban', [
    { name: 'To do', cards: [card('Fix the gate', 'k4m2qa'), card('Call the vet', 'p9x1bb')] },
    { name: 'Done', cards: [card('Water the plants', 'q7r3cc', 'done')] },
  ])])
  const columns = [...onScreen().querySelectorAll('.board-column')]
  equal(columns.length, 2, 'columns')
  equal(find('.board-column-name', columns[0] ?? undefined).textContent, 'To do', 'the first column')
  equal((columns[0] ?? stage).querySelectorAll('.board-card').length, 2, 'cards in the first')
  equal((columns[1] ?? stage).querySelectorAll('.board-card').length, 1, 'cards in the second')
  equal(find('.board-card', columns[0] ?? undefined).textContent, 'Fix the gate', 'the first card')
  ok(find('.board-card', columns[1] ?? undefined).classList.contains('done'), 'a finished card says so')
})

check('a board that has not answered yet is a tab and an empty board, not a blank window', () => {
  showBoards('board:kanban', [board('kanban', 'Kanban', null)])
  equal(find('.view-title', onScreen()).textContent, 'Kanban', 'the title is there')
  equal(find('.count', onScreen()).textContent, 'waiting', 'and it says so')
  equal(onScreen().querySelectorAll('.board-column').length, 0, 'columns')
})

check('a board longer than the window scrolls its own cards, not the window', () => {
  const many = []
  for (let at = 1; at <= 60; at += 1) many.push(card(`Card number ${at}`, `k4m2q${at}`))
  showBoards('board:kanban', [board('kanban', 'Kanban', [{ name: 'To do', cards: many }])])
  const cards = find('.board-cards', onScreen())
  ok(cards.scrollHeight > cards.clientHeight, 'the list has more in it than it shows')
  const window = box('.spread')
  ok(cards.getBoundingClientRect().bottom <= window.bottom + 1, 'and it ends inside the window')
  equal(stage.querySelector('.spread')?.scrollHeight, window.height, 'the window itself does not scroll')
})

/* ── a card dragged between columns ──────────────────────── */

/**
 * The whole gesture, on the elements themselves: `dragstart` on the card,
 * `dragover` on where it is going, `drop` there.
 *
 * One `DataTransfer` for all three, which is what the browser does - and the
 * reason a check can be written at all, since the payload is what the drop
 * reads and a synthetic event with a fresh transfer per step would carry
 * nothing.
 *
 * @param {Element|null|undefined} card  the card being picked up
 * @param {Element|null|undefined} onto  what the pointer comes up over
 * @returns {void}
 */
function drag(card, onto) {
  if (!(card instanceof HTMLElement) || !(onto instanceof HTMLElement)) {
    throw new Error('nothing to drag')
  }
  const dataTransfer = new DataTransfer()
  card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
  onto.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer }))
  onto.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }))
}

/** @returns {import('../../src/plugins/pageAsking.js').Board[]} */
function threeColumns() {
  return [board('kanban', 'Kanban', [
    { name: 'To do', cards: [card('Fix the gate', 'k4m2qa')] },
    { name: 'Doing', cards: [card('Call the vet', 'p9x1bb')] },
    { name: 'Done', cards: [card('Water the plants', 'q7r3cc', 'done')] },
  ])]
}

check('a named card can be picked up; one the answer pointed at by line cannot', () => {
  showBoards('board:kanban', [board('kanban', 'Kanban', [
    { name: 'To do', cards: [card('Fix the gate', 'k4m2qa'), { id: null, index: 3, text: 'New', ended: null }] },
  ])])
  const cards = [...onScreen().querySelectorAll('.board-card')]
  ok(cards[0] instanceof HTMLElement && cards[0].draggable, 'the named one')
  ok(cards[1] instanceof HTMLElement && !cards[1].draggable, 'the one with no name yet')
})

check('a card dropped on another column says which card and which column', () => {
  showBoards('board:kanban', threeColumns())
  dropped.length = 0
  const columns = [...onScreen().querySelectorAll('.board-column')]
  drag(onScreen().querySelector('.board-card'), find('.board-cards', columns[1] ?? undefined))
  equal(dropped[0], 'kanban/k4m2qa -> Doing', 'what the drop asked for')
})

check('and dropped on a card, it lands in front of that one', () => {
  showBoards('board:kanban', threeColumns())
  dropped.length = 0
  const columns = [...onScreen().querySelectorAll('.board-column')]
  drag(onScreen().querySelector('.board-card'), find('.board-card', columns[1] ?? undefined))
  equal(dropped[0], 'kanban/k4m2qa -> Doing before p9x1bb', 'what the drop asked for')
})

// The last column is not a drop target (kanban design §6): a card gets there
// by its line being ticked, which is the one write a board does not make.
check('a card dropped on the last column is not moved, and asks about the line instead', () => {
  showBoards('board:kanban', threeColumns())
  dropped.length = 0
  finished.length = 0
  const columns = [...onScreen().querySelectorAll('.board-column')]
  drag(onScreen().querySelector('.board-card'), find('.board-cards', columns[2] ?? undefined))
  equal(dropped.length, 0, 'nothing was moved')
  equal(finished[0], 'k4m2qa', 'and the card it was about')
})

check('the column under the pointer is marked, and the last one is marked as the refusal it is', () => {
  showBoards('board:kanban', threeColumns())
  const columns = [...onScreen().querySelectorAll('.board-column')]
  const card = onScreen().querySelector('.board-card')
  if (!(card instanceof HTMLElement)) throw new Error('no card')

  const dataTransfer = new DataTransfer()
  card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
  columns[1]?.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer }))
  ok(columns[1]?.classList.contains("dropping") === true, 'an ordinary column takes it')
  ok(!columns[1]?.classList.contains('refusing'), 'and does not refuse')

  columns[2]?.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer }))
  ok(columns[2]?.classList.contains("refusing") === true, 'the last one says no')
  ok(!columns[2]?.classList.contains('dropping'), 'and is not a drop target')
  ok(!columns[1]?.classList.contains('dropping'), 'and the mark moved off the one before')
})

report()
