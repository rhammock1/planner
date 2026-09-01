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
function show(count, view = 'someday', days = []) {
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
    onView: () => {},
    onAnchor: (next) => { anchored.push(next) },
  })

  spreadPage.render({
    view,
    today: '2026-09-01',
    anchor: '2026-09-01',
    vault: buildIndex([
      { page: 'someday', doc: parse(backPageOf(count)) },
      ...days.map((day) => ({ page: day, doc: parse(dayOf(day, count)) })),
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

report()
