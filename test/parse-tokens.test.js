// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/core/parse.js'

describe('inline tokens', () => {
  /** @param {string} line */
  const item = (line) => {
    const node = parse(`# 2026-08-31\n${line}\n`).nodes[0]
    assert.equal(node?.kind, 'item')
    return /** @type {import('../src/core/model.js').Item} */ (node)
  }

  test('extracts a time and strips it from the text', () => {
    const it = item('- [ ] Pair with Dana on the offline queue @10:30')
    assert.equal(it.text, 'Pair with Dana on the offline queue')
    assert.equal(it.time, '10:30')
  })

  test('zero-pads a single-digit hour', () => {
    assert.equal(item('- [ ] Dentist @8:40').time, '08:40')
  })

  test('extracts a due date and a lead time', () => {
    const it = item('- [ ] Firmware sign-off !2026-09-02 ~10d')
    assert.equal(it.text, 'Firmware sign-off')
    assert.equal(it.due, '2026-09-02')
    assert.equal(it.lead, 10)
  })

  test('extracts a migration target', () => {
    const it = item('- [>] Order the Pi Zero >2026-09-01')
    assert.equal(it.text, 'Order the Pi Zero')
    assert.equal(it.movedTo, '2026-09-01')
  })

  test('extracts tokens from anywhere in the line', () => {
    const it = item('- [ ] @09:00 Standup !2026-09-04')
    assert.equal(it.text, 'Standup')
    assert.equal(it.time, '09:00')
    assert.equal(it.due, '2026-09-04')
  })

  test('leaves an impossible time in the text', () => {
    const it = item('- [ ] Ping the API @25:99')
    assert.equal(it.text, 'Ping the API @25:99')
    assert.equal(it.time, null)
  })

  test('leaves an impossible date in the text', () => {
    const it = item('- [ ] Taxes !2026-02-30')
    assert.equal(it.text, 'Taxes !2026-02-30')
    assert.equal(it.due, null)
  })

  test('does not treat prose punctuation as tokens', () => {
    const it = item('- [ ] Email dana@gotab.io about the 5~10 range -> soon!')
    assert.equal(it.text, 'Email dana@gotab.io about the 5~10 range -> soon!')
    assert.equal(it.time, null)
    assert.equal(it.due, null)
    assert.equal(it.lead, null)
    assert.equal(it.movedTo, null)
  })

  test('collapses the whitespace left behind by a removed token', () => {
    const it = item('- [ ] Review PR @14:00 before standup')
    assert.equal(it.text, 'Review PR before standup')
  })

  test('the last occurrence wins, which is what keeps repeats stable', () => {
    // serialize writes the token at the end of the line, so reading the last
    // one means a file with two times settles instead of oscillating.
    const it = item('- [ ] Twice @09:00 @10:00')
    assert.equal(it.time, '10:00')
    assert.equal(it.text, 'Twice @09:00')
  })

  test('an invalid later token does not beat a valid earlier one', () => {
    const it = item('- [ ] Both @09:00 @25:99')
    assert.equal(it.time, '09:00')
    assert.equal(it.text, 'Both @25:99')
  })

  test('tokens with no whitespace between them stay prose', () => {
    // Both fail the whitespace-boundary requirement, so neither is a token.
    const it = item('- [ ] Twice @09:00@10:00')
    assert.equal(it.time, null)
    assert.equal(it.text, 'Twice @09:00@10:00')
  })
})
