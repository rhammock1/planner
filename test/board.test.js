// @ts-check

/**
 * `src/core/board.js` - the two files `plugins/kanban` keeps at the vault
 * root. Pure text in, pure text out, so all of it is testable here.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { cardOf, lineOf, FRESH, parseBoard, serialiseBoard, appendArchive } from '../src/core/board.js'

/** @typedef {import('../src/core/board.js').Card} Card */

/** @type {Card} */
const DONE = { id: 'd4e5f6', text: 'Review PR #4412 - printer retry', ended: 'done', endedOn: '2026-09-14' }

/** @type {Card} */
const DROPPED = { id: 'a1b2c3', text: 'Chase the vendor about pricing', ended: 'dropped', endedOn: '2026-09-13' }

const SAMPLE = [
  '# Board',
  '',
  '## To do',
  '- Chase the printer firmware sign-off ^b40e17',
  '- Read the offline queue RFC ^c1d2e3',
  '',
  '## Doing',
  '- Pair with Dana on the offline queue ^a3f9k2',
  '',
  '## Done',
  '- Standup - flag the sync bug  done 2026-09-14 ^d4e5f6',
  '',
].join('\n')

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

test('headings are the columns, in file order, and dash lines with ids are their cards', () => {
  const { board, problem } = parseBoard(SAMPLE)
  assert.equal(problem, null)
  assert.deepEqual(board?.columns.map((column) => column.name), ['To do', 'Doing', 'Done'])
  assert.deepEqual(
    board?.columns[0]?.entries.filter((entry) => entry.kind === 'card').map((entry) => entry.card.id),
    ['b40e17', 'c1d2e3'],
  )
  assert.equal(board?.columns[2]?.entries.find((entry) => entry.kind === 'card')?.card.ended, 'done')
})

test('parse then serialise is byte-identical, unrecognised text included', () => {
  for (const text of [
    SAMPLE,
    '',
    '# Board\n',
    '# Board\n\nA note to myself about how I use this.\n\n## To do\n- x ^a1b2c3\n  some prose under a card\n',
    '## To do\n- x ^a1b2c3',
    '## To do\n- a  double  spaced  line ^b40e17\n',
    'no headings at all, just prose\n',
  ]) {
    const { board } = parseBoard(text)
    assert.notEqual(board, null, `${JSON.stringify(text)} did not parse`)
    if (board !== null) assert.equal(serialiseBoard(board), text)
  }
})

test('a fresh board has the three columns the design names', () => {
  const { board, problem } = parseBoard(FRESH)
  assert.equal(problem, null)
  assert.deepEqual(board?.columns.map((column) => column.name), ['To do', 'Doing', 'Done'])
  assert.deepEqual(
    board?.columns.map((column) => column.entries.filter((entry) => entry.kind === 'card')),
    [[], [], []],
  )
})

test('a card above the first column is a file that cannot be written back', () => {
  const { board, problem } = parseBoard('# Board\n- Stray ^a1b2c3\n\n## To do\n')
  assert.equal(board, null)
  assert.match(problem ?? '', /above the first column/u)
})

test('two columns with one name is a file that cannot be written back', () => {
  const { board, problem } = parseBoard('## To do\n\n## Doing\n\n## To do\n')
  assert.equal(board, null)
  assert.match(problem ?? '', /two columns are named To do/u)
})

test('a column keeps its heading exactly as it was written', () => {
  const { board } = parseBoard('##   Spaced   out   \n')
  assert.equal(board?.columns[0]?.name, 'Spaced   out')
  assert.equal(board?.columns[0]?.heading, '##   Spaced   out   ')
})

test('an empty archive gets its heading, and the card lines follow', () => {
  assert.equal(
    appendArchive('', [DONE]),
    '# Archive\n\n- Review PR #4412 - printer retry  done 2026-09-14 ^d4e5f6\n',
  )
})

test('an archived line is the board line it came from, byte for byte', () => {
  assert.ok(appendArchive('', [DONE]).includes(`${lineOf(DONE)}\n`))
})

test('every write is a prefix of the next', () => {
  // Append-only, newest last, never read back (design §3.2). The property is
  // the whole of what the file promises, so it is the thing to test.
  let text = ''
  const written = [text]
  for (const cards of [[DONE], [], [DROPPED, DONE], [DONE]]) {
    text = appendArchive(text, cards)
    written.push(text)
  }
  for (let at = 1; at < written.length; at += 1) {
    assert.ok(
      (written[at] ?? '').startsWith(written[at - 1] ?? ''),
      `write ${at} is not a prefix of write ${at + 1}`,
    )
  }
})

test('archiving nothing writes nothing', () => {
  assert.equal(appendArchive('', []), '')
  assert.equal(appendArchive('# Archive\n\n', []), '# Archive\n\n')
})

test('an archive that lost its trailing newline gets one before the next line', () => {
  assert.equal(
    appendArchive('# Archive\n\n- Older  done 2026-09-01 ^000aaa', [DONE]),
    '# Archive\n\n- Older  done 2026-09-01 ^000aaa\n- Review PR #4412 - printer retry  done 2026-09-14 ^d4e5f6\n',
  )
})
