// @ts-check

/**
 * The day page's layout, which only a browser can measure.
 *
 * A page with more lines than fit used to grow past the bottom of the window,
 * taking the footer - the day/week/month tabs and the count - somewhere no
 * scrollbar could reach. The list is what gives, and the frame around it
 * stays put.
 */

import { check, ok, equal, report } from './harness.js'
import { parse } from '../../src/core/parse.js'
import * as dayPage from '../../src/views/dayPage.js'

const found = document.querySelector('#stage')
if (!(found instanceof HTMLElement)) throw new Error('no stage')
const stage = found

/**
 * @param {number} count
 * @returns {string}
 */
function pageOf(count) {
  const lines = []
  for (let at = 1; at <= count; at += 1) lines.push(`- [ ] Line number ${at}`)
  return `# 2026-09-01\n\n${lines.join('\n')}\n\n---\n\nHow it went.\n`
}

/**
 * @param {number} count
 * @returns {void}
 */
function show(count) {
  stage.replaceChildren()
  const root = document.createElement('main')
  root.id = 'app'
  stage.append(root)

  dayPage.mount(root, {
    onNavigate: () => {},
    onToggle: () => {},
    onEdit: async () => true,
    onNote: async () => true,
    onStrike: () => {},
    onRemove: async () => true,
    onDailyNote: async () => true,
    onAdd: async () => true,
    onCarry: () => {},
    onPin: () => {},
    onOpenSpread: () => {},
  })
  dayPage.render({
    today: '2026-09-01',
    page: '2026-09-01',
    doc: parse(pageOf(count)),
    horizon: [],
    carry: [],
    notices: [],
  })
}

/**
 * @param {string} selector
 * @returns {HTMLElement}
 */
function part(selector) {
  const element = stage.querySelector(selector)
  if (!(element instanceof HTMLElement)) throw new Error(`no ${selector}`)
  return element
}

check('a short day fits without scrolling', () => {
  show(3)
  const items = part('.items')
  ok(items.scrollHeight <= items.clientHeight, 'a three-line day was made to scroll')
})

// The other half of filling the window: on a day with two lines on it the
// footer belongs at the bottom of the page, not floating a third of the way
// down with the window's transparent background showing under it.
check('a short day still puts the footer at the bottom', () => {
  show(3)
  const foot = part('.page-foot').getBoundingClientRect()
  const window = stage.getBoundingClientRect()
  ok(
    Math.abs(foot.bottom - window.bottom) <= 1,
    `the footer floats at ${Math.round(foot.bottom)} in a window ending at ${Math.round(window.bottom)}`,
  )
})

// The bug: twelve lines is an ordinary Tuesday, and it pushed the footer off
// the bottom of a 560pt window where nothing could scroll it back.
check('a long day keeps the page inside the window', () => {
  show(20)
  equal(Math.round(part('.page').getBoundingClientRect().height), 560, 'the page grew past the window')
})

check('the footer stays reachable however long the day is', () => {
  show(20)
  const foot = part('.page-foot')
  ok(
    foot.getBoundingClientRect().bottom <= stage.getBoundingClientRect().bottom + 1,
    `the footer sits at ${Math.round(foot.getBoundingClientRect().bottom)}, past the window`,
  )
})

check('the add row and the day s note stay reachable too', () => {
  show(20)
  const bottom = stage.getBoundingClientRect().bottom + 1
  ok(part('.add').getBoundingClientRect().bottom <= bottom, 'the add row was pushed off')
  ok(part('.note').getBoundingClientRect().bottom <= bottom, 'the day’s note was pushed off')
})

check('the list is what gives, and it scrolls', () => {
  show(20)
  const items = part('.items')
  ok(items.scrollHeight > items.clientHeight, 'the list did not become scrollable')

  items.scrollTop = items.scrollHeight
  const last = [...items.querySelectorAll('.item')].pop()
  ok(last instanceof HTMLElement, 'no last line')
  ok(
    last.getBoundingClientRect().bottom <= items.getBoundingClientRect().bottom + 1,
    'the last line cannot be scrolled to',
  )
})

// The day's own line is written in, not just displayed. It was rendered from
// the file and hidden when empty, which left no way to start one.
check('the day s note can be typed into', () => {
  show(3)
  const note = part('.note')
  equal(note.getAttribute('contenteditable'), 'plaintext-only', 'the note is read-only')
  note.focus()
  equal(document.activeElement, note, 'the note does not take focus')
})

check('an empty day still offers its note', () => {
  show(0)
  const note = part('.note')
  ok(!note.hidden, 'the note is hidden on a day with nothing on it')
})

report()
