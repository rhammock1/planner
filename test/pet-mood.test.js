// @ts-check

/**
 * `pet`'s decision, and the week it remembers.
 *
 * The whole of a creature's mind is four integers in and one word out, so the
 * whole of this file is that table and the precedence between its rows - plus
 * the history, which is the only thing here that can be wrong in a way nobody
 * notices for a week.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MOODS, REMEMBERED, moodOf, remembered, streak, deepening,
} from '../plugins/pet/mood.js'
import { petSvg } from '../plugins/pet/draw.js'
import { readPicture, LONGEST } from '../src/core/picture.js'

/**
 * @param {Partial<{open: number, done: number, due: number, overdue: number}>} some
 * @returns {{open: number, done: number, due: number, overdue: number}}
 */
function glance(some) {
  return { open: 0, done: 0, due: 0, overdue: 0, ...some }
}

test('four moods and no more', () => {
  assert.deepEqual([...MOODS].sort(), ['fresh', 'fretting', 'resting', 'working'])
})

test('a day with something open and nothing done is fresh', () => {
  assert.equal(moodOf(glance({ open: 3 })), 'fresh')
})

test('a day with something open and something done is working', () => {
  assert.equal(moodOf(glance({ open: 3, done: 1 })), 'working')
})

test('a day with something overdue is fretting', () => {
  assert.equal(moodOf(glance({ open: 3, overdue: 1 })), 'fretting')
})

test('a day with nothing open is resting', () => {
  assert.equal(moodOf(glance({})), 'resting')
  assert.equal(moodOf(glance({ done: 4 })), 'resting')
})

/**
 * The precedence, said as three pairs rather than as one ordering, because a
 * table is easy to reorder by accident and these three are what the reorder
 * would break.
 */
test('overdue wins over resting', () => {
  // Nothing open at all, and something late from another day.
  assert.equal(moodOf(glance({ overdue: 2 })), 'fretting')
})

test('resting wins over working', () => {
  // Everything done is not a creature still leaning in over the page.
  assert.equal(moodOf(glance({ open: 0, done: 6 })), 'resting')
})

test('working wins over fresh', () => {
  assert.equal(moodOf(glance({ open: 1, done: 1 })), 'working')
})

test('due on its own changes nothing: a day due today is a day with work on it', () => {
  assert.equal(moodOf(glance({ open: 2, due: 2 })), 'fresh')
})

test('today replaces an earlier look at today rather than sitting beside it', () => {
  let history = remembered([], '2026-09-14', glance({ open: 3 }))
  history = remembered(history, '2026-09-14', glance({ open: 2, done: 1 }))

  assert.equal(history.length, 1)
  assert.deepEqual(history[0], { date: '2026-09-14', open: 2, done: 1, due: 0, overdue: 0 })
})

test('a week is kept and the eighth day pushes the first out', () => {
  /** @type {ReturnType<typeof remembered>} */
  let history = []
  for (let day = 1; day <= REMEMBERED + 1; day += 1) {
    history = remembered(history, `2026-09-${String(day).padStart(2, '0')}`, glance({ open: day }))
  }

  assert.equal(history.length, REMEMBERED)
  assert.equal(history[0]?.date, '2026-09-02')
  assert.equal(history[REMEMBERED - 1]?.date, '2026-09-08')
})

test('days are kept oldest first however they arrive', () => {
  let history = remembered([], '2026-09-14', glance({ open: 1 }))
  history = remembered(history, '2026-09-12', glance({ open: 1 }))

  assert.deepEqual(history.map((day) => day.date), ['2026-09-12', '2026-09-14'])
})

test('a file somebody edited into nonsense is forgotten rather than believed', () => {
  for (const stored of [null, 'a week', 42, { date: '2026-09-14' }, [1, 2], [{}], [{ date: 'no' }]]) {
    const history = remembered(stored, '2026-09-14', glance({ open: 1 }))
    assert.deepEqual(history, [{ date: '2026-09-14', open: 1, done: 0, due: 0, overdue: 0 }])
  }
})

test('a count that is not a count reads as none of them', () => {
  const stored = [{ date: '2026-09-13', open: 'three', done: -1, due: 2.7, overdue: NaN }]
  const history = remembered(stored, '2026-09-14', glance({ open: 1 }))

  assert.deepEqual(history[0], { date: '2026-09-13', open: 0, done: 0, due: 2, overdue: 0 })
})

test('a streak counts back only while the mood holds', () => {
  const week = [
    { date: '2026-09-09', ...glance({ open: 1 }) },
    { date: '2026-09-10', ...glance({ open: 2, overdue: 1 }) },
    { date: '2026-09-11', ...glance({ open: 2, overdue: 3 }) },
    { date: '2026-09-12', ...glance({ open: 1, overdue: 1 }) },
  ]
  assert.equal(streak(week), 3)
})

test('a streak of one is a day, not a run', () => {
  assert.equal(streak([{ date: '2026-09-14', ...glance({ open: 1 }) }]), 1)
  assert.equal(deepening(1), 0)
  assert.equal(deepening(0), 0)
})

test('a full week is as deep as it goes, and no deeper', () => {
  assert.equal(deepening(REMEMBERED), 1)
  assert.equal(deepening(REMEMBERED + 5), 1)
  assert.ok(deepening(2) > 0 && deepening(2) < 1)
})

test('an empty history is no streak at all', () => {
  assert.equal(streak([]), 0)
})

/**
 * The drawing is held to the app's own reader rather than to a snapshot of
 * itself: what matters about `pet`'s SVG is that `src/core/picture.js` will
 * draw it, and a snapshot would only pin the shapes.
 */
test('every mood draws a picture the app will accept', () => {
  const theme = {
    paper: '#fffdf5', ink: '#2b2b2b', dim: '#c9c3b4', accent: '#3d6ea5', alert: '#b03a2e',
  }
  for (const mood of MOODS) {
    for (const deep of [0, 0.5, 1]) {
      const svg = petSvg({ mood, deep, theme })
      const read = readPicture(svg)
      assert.ok('picture' in read, `${mood} at ${deep}: ${'refused' in read ? read.refused : ''}`)
      assert.ok(new TextEncoder().encode(svg).length < LONGEST / 4, `${mood} is a big picture`)
    }
  }
})

test('a theme missing its colours still draws', () => {
  const read = readPicture(petSvg({ mood: 'fresh', deep: 0, theme: {} }))
  assert.ok('picture' in read)
})

/**
 * A theme is a file a person edits, and this string becomes a document. A
 * colour with a bracket in it must not be able to close the tag it is in.
 */
test('a colour that is not a colour is refused rather than written into the document', () => {
  const svg = petSvg({
    mood: 'fresh',
    deep: 0,
    theme: { ink: '"><script>alert(1)</script>', paper: '#fff' },
  })
  assert.ok(!svg.includes('script'))
  assert.ok('picture' in readPicture(svg))
})

test('only fretting carries the alert colour, and only once', () => {
  const theme = { paper: '#fff', ink: '#000', dim: '#ccc', accent: '#07f', alert: '#f00' }
  const marks = (/** @type {string} */ svg) => svg.split('#f00').length - 1

  assert.equal(marks(petSvg({ mood: 'fretting', deep: 0, theme })), 2, 'a stroke and its dot')
  for (const mood of /** @type {const} */ (['fresh', 'working', 'resting'])) {
    assert.equal(marks(petSvg({ mood, deep: 0, theme })), 0, mood)
  }
})

/**
 * Motion is the one thing in the picture that cannot be undone by the person
 * looking at it, so it has to undo itself.
 */
test('a picture that moves says what to do when motion is unwelcome', () => {
  const theme = { paper: '#fff', ink: '#000' }
  for (const mood of MOODS) {
    const svg = petSvg({ mood, deep: 0, theme })
    if (!svg.includes('animation:')) continue
    assert.ok(svg.includes('prefers-reduced-motion'), `${mood} moves without saying when not to`)
  }
})
