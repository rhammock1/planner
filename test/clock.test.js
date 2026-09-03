// @ts-check

/**
 * The clock. One function per question, and both are local.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { today, nowTime } from '../src/clock.js'

test('today is a date the way a page is named', () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/)
})

test('the time is the one on the wall, zero-padded, on a 24-hour clock', () => {
  const time = nowTime()
  assert.match(time, /^([01]\d|2[0-3]):[0-5]\d$/)
  // The same instant, read two ways: `Date` is the only clock in the app.
  const at = new Date()
  assert.equal(time.slice(0, 2), String(at.getHours()).padStart(2, '0'))
})
