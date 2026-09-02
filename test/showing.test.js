// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createShowing } from '../src/showing.js'

describe('the day on screen', () => {
  test('opens on today', () => {
    const showing = createShowing('2026-09-01')
    assert.equal(showing.page(), '2026-09-01')
  })

  test('follows the clock over midnight when nobody has flipped away', () => {
    const showing = createShowing('2026-09-01')
    assert.equal(showing.page(), '2026-09-01')

    // Only at a redraw: until then the page is the one the list on screen
    // belongs to, so a gesture aimed at its fourth line lands there.
    showing.tick('2026-09-02')
    assert.equal(showing.page(), '2026-09-02')
  })

  test('follows across days the app slept through', () => {
    const showing = createShowing('2026-09-01')

    // The lid was shut on Tuesday and opened on Friday: no draw happened in
    // between, so the roll-over cannot depend on having seen each midnight.
    showing.tick('2026-09-04')
    assert.equal(showing.page(), '2026-09-04')
  })

  test('a day chosen on purpose stays put', () => {
    const showing = createShowing('2026-09-01')

    showing.go('2026-08-28', '2026-09-01')
    assert.equal(showing.page(), '2026-08-28')

    showing.tick('2026-09-02')
    assert.equal(showing.page(), '2026-08-28')
  })

  test('flipping back to today follows the clock again', () => {
    const showing = createShowing('2026-09-01')

    showing.go('2026-08-28', '2026-09-01')
    showing.go('2026-09-01', '2026-09-01')

    showing.tick('2026-09-02')
    assert.equal(showing.page(), '2026-09-02')
  })

  test('a day chosen ahead becomes the day it is, and then follows', () => {
    const showing = createShowing('2026-09-01')

    // Tomorrow, looked at last thing at night.
    showing.go('2026-09-02', '2026-09-01')
    assert.equal(showing.page(), '2026-09-02')

    // Which is today by morning, and so is today's page from then on.
    showing.tick('2026-09-02')
    assert.equal(showing.page(), '2026-09-02')
    showing.tick('2026-09-03')
    assert.equal(showing.page(), '2026-09-03')
  })

  test('the back page is not a day and never follows', () => {
    const showing = createShowing('2026-09-01')

    showing.go('someday', '2026-09-01')
    showing.tick('2026-09-02')
    assert.equal(showing.page(), 'someday')
  })
})
