// @ts-check

/**
 * `src/core/tabFit.js` - which tabs fit in the day footer's strip, and which
 * go behind the `...` (spec §4).
 *
 * The widths here are the ones the spec's table estimates from the real CSS -
 * 10.5px uppercase with 0.08em tracking and 8px of padding each side - rounded
 * to whole pixels. They are not what the footer will measure on any particular
 * machine, and nothing in `tabFit` depends on their being right: what is being
 * checked is that Robert's three cases come out of the one rule, and the
 * numbers only have to be in proportion for that to mean anything.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { fitTabs } from '../src/core/tabFit.js'

/** @typedef {import('../src/core/tabFit.js').Tab} Tab */
/** @typedef {import('../src/core/tabFit.js').Room} Room */

const WIDTH = { day: 40, week: 46, month: 54, someday: 68, board: 60 }

/** The `...` button, and the space between two tabs. */
const MORE = 26
const GAP = 3
const CAP = 5

/**
 * The strip as the footer builds it: the fixed four, then a tab per board.
 *
 * @param {readonly string[]} boards  board view names, in the order the
 *   plugins folder lists them
 * @returns {Tab[]}
 */
function strip(boards = []) {
  return [
    { key: 'day', width: WIDTH.day },
    { key: 'week', width: WIDTH.week },
    { key: 'month', width: WIDTH.month },
    { key: 'someday', width: WIDTH.someday },
    ...boards.map((key) => ({ key, width: WIDTH.board })),
  ]
}

/**
 * The demotion order the footer passes: Someday first, then the boards from
 * the last backwards.
 *
 * @param {readonly string[]} boards
 * @returns {string[]}
 */
function demotion(boards = []) {
  return ['someday', ...[...boards].reverse()]
}

/**
 * @param {number} available
 * @param {number} [cap]
 * @returns {Room}
 */
function room(available, cap = CAP) {
  return { available, gap: GAP, more: MORE, cap }
}

test('at minimum width the bar is DAY WEEK MONTH ...', () => {
  // Robert's first case. Someday goes, and the one board does not fit either:
  // the three plus the board plus the `...` is wider than the strip.
  const boards = ['board:kanban']
  const fit = fitTabs(strip(boards), demotion(boards), room(200))
  assert.deepEqual(fit.shown, ['day', 'week', 'month'])
  assert.deepEqual(fit.hidden, ['someday', 'board:kanban'])
})

test('when there is room, Someday and one more board', () => {
  // Robert's second case, at the width the popover opens at. Nothing is
  // demoted, so there is no `...` to make room for.
  const boards = ['board:kanban']
  const fit = fitTabs(strip(boards), demotion(boards), room(280))
  assert.deepEqual(fit.shown, ['day', 'week', 'month', 'someday', 'board:kanban'])
  assert.deepEqual(fit.hidden, [])
})

test('past five, `...` appears and Someday is in it', () => {
  // Robert's third case. The window is as wide as it likes - this is the cap
  // talking, not the measure - and Someday is still the first to go.
  const boards = ['board:a', 'board:b', 'board:c', 'board:d', 'board:e', 'board:f']
  const fit = fitTabs(strip(boards), demotion(boards), room(4000))
  assert.equal(fit.shown.length, CAP)
  assert.deepEqual(fit.shown, ['day', 'week', 'month', 'board:a', 'board:b'])
  assert.ok(fit.hidden.includes('someday'), fit.hidden.join(' '))
})

test('the cap counts the tabs, not the `...` beside them', () => {
  // Six names and a cap of five, in a window with room for all of them: one
  // goes, not two. The button is not a name, so five shown beside it is the
  // cap met rather than the cap exceeded.
  const boards = ['board:a', 'board:b']
  const fit = fitTabs(strip(boards), demotion(boards), room(4000))
  assert.deepEqual(fit.shown, ['day', 'week', 'month', 'board:a', 'board:b'])
  assert.deepEqual(fit.hidden, ['someday'])
})

test('the boards go from the last backwards, so the first board keeps its tab', () => {
  const boards = ['board:a', 'board:b', 'board:c']
  const fit = fitTabs(strip(boards), demotion(boards), room(300))
  assert.ok(fit.shown.includes('board:a'), fit.shown.join(' '))
  assert.deepEqual(fit.hidden, ['someday', 'board:b', 'board:c'])
})

test('both lists come back in display order, not in demotion order', () => {
  // The menu reads down the strip its rows came out of, so `hidden` is in the
  // order the tabs were in - not the order they were taken in, which would put
  // the last board above the ones before it.
  const boards = ['board:a', 'board:b', 'board:c', 'board:d']
  const fit = fitTabs(strip(boards), demotion(boards), room(240))
  assert.deepEqual(fit.hidden, ['someday', 'board:b', 'board:c', 'board:d'])
})

test('a strip narrower than the fixed three clips rather than emptying', () => {
  // The floor. Day, Week and Month are absent from the demotion order, so
  // there is nothing left to hide and the loop stops: a strip with no way out
  // of wherever you are would be worse than one that clips.
  const boards = ['board:kanban']
  const fit = fitTabs(strip(boards), demotion(boards), room(20))
  assert.deepEqual(fit.shown, ['day', 'week', 'month'])
  assert.deepEqual(fit.hidden, ['someday', 'board:kanban'])
})

test('nothing to lay out is nothing demoted', () => {
  assert.deepEqual(fitTabs([], [], room(0)), { shown: [], hidden: [] })
})

test('a board list that changes between fits is answered as it now is', () => {
  // `fitTabs` remembers nothing, which is what lets the footer call it again
  // when a plugin is switched off mid-session. The second answer is about the
  // second strip - the board that left is in neither list.
  const before = ['board:a', 'board:b']
  const first = fitTabs(strip(before), demotion(before), room(4000))
  assert.deepEqual(first.hidden, ['someday'])

  const after = ['board:a']
  const second = fitTabs(strip(after), demotion(after), room(4000))
  assert.deepEqual(second.shown, ['day', 'week', 'month', 'someday', 'board:a'])
  assert.deepEqual(second.hidden, [])
})

test('a board installed between fits pushes Someday into the menu', () => {
  // The board that arrives is not the one that goes. Someday is first in the
  // demotion order whatever caused the crowding, so installing a plugin costs
  // the strip its least-visited fixed view rather than the tab just added.
  const before = ['board:a']
  assert.deepEqual(fitTabs(strip(before), demotion(before), room(4000)).hidden, [])

  const after = ['board:a', 'board:b']
  const second = fitTabs(strip(after), demotion(after), room(4000))
  assert.deepEqual(second.shown, ['day', 'week', 'month', 'board:a', 'board:b'])
  assert.deepEqual(second.hidden, ['someday'])
})
