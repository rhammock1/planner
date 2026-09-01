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
 * @returns {void}
 */
function show(count, view = 'someday') {
  stage.replaceChildren()
  const root = document.createElement('main')
  root.id = 'app'
  stage.append(root)

  spreadPage.mount(root, {
    editsFor: () => ({
      onToggle: () => {},
      onEdit: async () => true,
      onNote: async () => true,
      onStrike: () => {},
      onRemove: async () => true,
      onAdd: async (line) => { added.push(line); return true },
      onDailyNote: async () => true,
    }),
    onView: () => {},
  })

  spreadPage.render({
    view,
    today: '2026-09-01',
    vault: buildIndex([{ page: 'someday', doc: parse(backPageOf(count)) }]),
    notices: [],
  })
}

/**
 * @param {string} selector
 * @returns {DOMRect}
 */
function box(selector) {
  const element = stage.querySelector(selector)
  if (!(element instanceof HTMLElement)) throw new Error(`no ${selector}`)
  return element.getBoundingClientRect()
}

check('the back page shows every line someday.md has', () => {
  show(4)
  equal(stage.querySelectorAll('.item').length, 4, 'rows')
})

check('a list longer than the window does not push the add row off it', () => {
  show(60)
  const window = box('.spread')
  const add = box('.add')
  ok(add.bottom <= window.bottom + 1, `add row at ${add.bottom} in a window ending at ${window.bottom}`)
})

check('the list is what scrolls, not the window', () => {
  show(60)
  const items = stage.querySelector('.items')
  if (!(items instanceof HTMLElement)) throw new Error('no list')
  ok(items.scrollHeight > items.clientHeight, 'the list has more in it than it shows')
  equal(stage.querySelector('.spread')?.scrollHeight, box('.spread').height, 'the window itself does not scroll')
})

check('a short list leaves the add row at the bottom', () => {
  show(2)
  const window = box('.spread')
  const add = box('.add')
  ok(add.bottom > window.bottom - 60, `add row at ${add.bottom}, window ends at ${window.bottom}`)
})

check('a view the shell asks for that does not exist falls back to one that does', () => {
  show(3, 'week')
  equal(spreadPage.showing(), VIEWS[0], 'showing')
  const back = stage.querySelector('.back-page')
  ok(back instanceof HTMLElement && !back.hidden, 'the back page is on screen')
})

check('the tab for the view on screen is the one marked on', () => {
  show(3)
  const on = [...stage.querySelectorAll('.tab.on')].map((tab) => tab.textContent)
  equal(on.length, 1, 'exactly one tab is on')
  equal(on[0], 'Someday', 'which one')
})

check('the add row commits a line', () => {
  show(1)
  added.length = 0
  const field = stage.querySelector('.add-field')
  if (!(field instanceof HTMLInputElement)) throw new Error('no add field')
  field.value = 'Fix the gate'
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  equal(added[0], 'Fix the gate', 'what was committed')
})

report()
