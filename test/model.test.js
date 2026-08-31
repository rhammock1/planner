// @ts-check
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ITEM_STATES, markFor, stateFor, isValidDate, isValidTime,
  createItem, createDayDocument, createSomedayDocument,
} from '../src/core/model.js'

describe('state and mark mapping', () => {
  test('every state has a mark that maps back', () => {
    for (const state of ITEM_STATES) {
      assert.equal(stateFor(markFor(state)), state)
    }
  })

  test('marks are the documented characters', () => {
    assert.equal(markFor('open'), ' ')
    assert.equal(markFor('done'), 'x')
    assert.equal(markFor('migrated'), '>')
    assert.equal(markFor('dropped'), '-')
  })

  test('uppercase X is accepted as done', () => {
    assert.equal(stateFor('X'), 'done')
  })

  test('an unknown mark is not a state', () => {
    assert.equal(stateFor('?'), null)
    assert.equal(stateFor(''), null)
  })
})

describe('validators', () => {
  test('accepts real dates', () => {
    assert.equal(isValidDate('2026-08-31'), true)
    assert.equal(isValidDate('2024-02-29'), true)
  })

  test('rejects malformed and impossible dates', () => {
    assert.equal(isValidDate('2026-13-01'), false)
    assert.equal(isValidDate('2026-02-30'), false)
    assert.equal(isValidDate('2025-02-29'), false)
    assert.equal(isValidDate('26-08-31'), false)
    assert.equal(isValidDate('not a date'), false)
  })

  test('accepts real times and rejects impossible ones', () => {
    assert.equal(isValidTime(0, 0), true)
    assert.equal(isValidTime(23, 59), true)
    assert.equal(isValidTime(24, 0), false)
    assert.equal(isValidTime(10, 60), false)
    assert.equal(isValidTime(-1, 0), false)
  })
})

describe('constructors', () => {
  test('a new item is open with no metadata', () => {
    const item = createItem('Order the Pi Zero')
    assert.equal(item.kind, 'item')
    assert.equal(item.state, 'open')
    assert.equal(item.text, 'Order the Pi Zero')
    assert.equal(item.time, null)
    assert.equal(item.due, null)
    assert.equal(item.lead, null)
    assert.equal(item.movedTo, null)
    assert.equal(item.note, null)
  })

  test('overrides are applied', () => {
    const item = createItem('Dentist', { time: '08:40', state: 'done' })
    assert.equal(item.time, '08:40')
    assert.equal(item.state, 'done')
    assert.equal(item.text, 'Dentist')
  })

  test('a new day document has a blank line under its header', () => {
    const doc = createDayDocument('2026-08-31')
    assert.equal(doc.kind, 'day')
    assert.equal(doc.date, '2026-08-31')
    assert.equal(doc.dailyNote, '')
    assert.deepEqual(doc.nodes, [{ kind: 'opaque', raw: '' }])
  })

  test('a new someday document has no date', () => {
    const doc = createSomedayDocument()
    assert.equal(doc.kind, 'someday')
    assert.equal(doc.date, null)
    assert.deepEqual(doc.nodes, [{ kind: 'opaque', raw: '' }])
  })

  test('a new document has no frontmatter', () => {
    assert.equal(createDayDocument('2026-08-31').frontmatter, null)
    assert.equal(createSomedayDocument().frontmatter, null)
  })
})
