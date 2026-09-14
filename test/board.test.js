// @ts-check

/**
 * `src/core/board.js` - the two files `plugins/kanban` keeps at the vault
 * root. Pure text in, pure text out, so all of it is testable here.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { cardOf, lineOf } from '../src/core/board.js'

test('a card is its text and the id last on the line', () => {
  assert.deepEqual(cardOf('- Read the offline queue RFC ^c1d2e3'), {
    id: 'c1d2e3',
    text: 'Read the offline queue RFC',
    ended: null,
    endedOn: null,
  })
})

test('an ended card carries which ending it was and the day it was seen', () => {
  assert.deepEqual(cardOf('- Standup - flag the sync bug  done 2026-09-14 ^d4e5f6'), {
    id: 'd4e5f6',
    text: 'Standup - flag the sync bug',
    ended: 'done',
    endedOn: '2026-09-14',
  })
  assert.deepEqual(cardOf('- Chase the vendor  dropped 2026-09-13 ^a1b2c3'), {
    id: 'a1b2c3',
    text: 'Chase the vendor',
    ended: 'dropped',
    endedOn: '2026-09-13',
  })
})

test('a dash line with no id is not a card', () => {
  // The board is not a second place to write tasks (design §1), so a line you
  // typed by hand is text the file keeps, not a card that cannot be dragged.
  assert.equal(cardOf('- something I typed in here'), null)
  assert.equal(cardOf('- an id that is too short ^abc'), null)
  assert.equal(cardOf('- an id with a capital in it ^A3F9K2'), null)
  assert.equal(cardOf('## To do'), null)
  assert.equal(cardOf(''), null)
})

test('the last id on a line is the one that names the card', () => {
  // `^abc123` is last on the line, after every other token (design §4.2), so
  // a line mentioning one in its prose still ends with the one that counts.
  const card = cardOf('- see ^a1b2c3 and ^d4e5f6')
  assert.equal(card?.id, 'd4e5f6')
  assert.equal(card?.text, 'see ^a1b2c3 and')
})

test('a card writes back the line it was read from', () => {
  for (const line of [
    '- Read the offline queue RFC ^c1d2e3',
    '- Standup - flag the sync bug  done 2026-09-14 ^d4e5f6',
    '- Chase the vendor  dropped 2026-09-13 ^a1b2c3',
  ]) {
    const card = cardOf(line)
    assert.notEqual(card, null, `${line} did not parse`)
    if (card !== null) assert.equal(lineOf(card), line)
  }
})

test('a written line cannot be misread as an ending it does not have', () => {
  // A line whose own words read `  done 2026-01-01` would come back as an
  // ended card, so runs of spaces are collapsed on the way out. That is the
  // one thing `lineOf` does not round-trip, and it only ever touches a line
  // the app is rewriting anyway - a line nobody changed is written back from
  // `raw` by `serialiseBoard`, untouched, which is where the file's
  // byte-identity actually comes from.
  const line = lineOf({ id: 'a3f9k2', text: 'Foo  done 2026-01-01', ended: null, endedOn: null })
  assert.equal(cardOf(line)?.ended, null)
  assert.equal(cardOf(line)?.text, 'Foo done 2026-01-01')
})

test('reading a line never touches the spaces in it', () => {
  // The collapse is on the way out and only on the way out. A double-spaced
  // line you wrote by hand reads as the words you wrote.
  assert.equal(cardOf('- a  double  spaced  line ^b40e17')?.text, 'a  double  spaced  line')
})
