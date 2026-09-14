// @ts-check

/**
 * `src/core/boardFile.js` - the two files `plugins/kanban` keeps in the
 * folder it owns, `<vault>/kanban/`. Pure text in, pure text out, so all of
 * it is testable here.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { cardOf, lineOf, FRESH, parseBoard, serialiseBoard, appendArchive, mergeBoard } from '../src/core/boardFile.js'

/** @typedef {import('../src/core/boardFile.js').Card} Card */

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

/**
 * `mergeBoard` - an answer's arrangement written back onto the file.
 *
 * This is the write the app makes after a board plugin answers, and the
 * rules it has to hold are the ones §9 argues for: an omission is not a
 * deletion, and a file nobody rearranged comes back byte for byte.
 */

const TODAY = '2026-09-14'

const MERGE_BOARD = [
  '# Board',
  '',
  'a note somebody left here',
  '',
  '## To do',
  '- Chase the printer firmware sign-off ^b40e17',
  'a line the parser does not understand',
  '- Book the rehearsal room ^c1d2e3',
  '',
  '## Doing',
  '- Pair with Dana on the offline queue ^a3f9k2',
  '',
  '## Done',
  '',
].join('\n')

/**
 * The columns of a board, as the answer reader hands them over.
 *
 * @param {string} text
 * @returns {{name: string, cards: {id: string, text: string, ended: 'done'|'dropped'|null}[]}[]}
 */
function columnsOf(text) {
  const { board } = parseBoard(text)
  assert.ok(board !== null, 'the fixture does not parse')
  return board.columns.map((column) => ({
    name: column.name,
    cards: column.entries.flatMap((entry) =>
      entry.kind === 'card' ? [{ id: entry.card.id, text: entry.card.text, ended: entry.card.ended }] : []),
  }))
}

test('a board nobody rearranged comes back byte for byte', () => {
  assert.equal(mergeBoard(MERGE_BOARD, columnsOf(MERGE_BOARD), TODAY), MERGE_BOARD)
})

test('a card moved to another column moves, and nothing else does', () => {
  const columns = columnsOf(MERGE_BOARD)
  const moved = columns[0]?.cards.shift()
  assert.ok(moved !== undefined)
  columns[1]?.cards.push(moved)

  assert.equal(mergeBoard(MERGE_BOARD, columns, TODAY), [
    '# Board',
    '',
    'a note somebody left here',
    '',
    '## To do',
    '- Book the rehearsal room ^c1d2e3',
    'a line the parser does not understand',
    '',
    '## Doing',
    '- Pair with Dana on the offline queue ^a3f9k2',
    '- Chase the printer firmware sign-off ^b40e17',
    '',
    '## Done',
    '',
  ].join('\n'))
})

test('a column that empties and refills at once fills its own slots in order', () => {
  // Every card leaves and other cards arrive, so every slot in the column is
  // vacant at the moment it is filled. Filling vacancies and rebuilding the
  // column agree on the output here, which is exactly why it is worth
  // pinning: it is the case that would let the wrong mechanism pass
  // unnoticed everywhere else.
  const columns = columnsOf(MERGE_BOARD)
  const [toDo, doing] = columns
  assert.ok(toDo !== undefined && doing !== undefined)
  const leaving = toDo.cards
  toDo.cards = doing.cards
  doing.cards = leaving

  assert.equal(mergeBoard(MERGE_BOARD, columns, TODAY), [
    '# Board',
    '',
    'a note somebody left here',
    '',
    '## To do',
    '- Pair with Dana on the offline queue ^a3f9k2',
    'a line the parser does not understand',
    '',
    '## Doing',
    '- Chase the printer firmware sign-off ^b40e17',
    '- Book the rehearsal room ^c1d2e3',
    '',
    '## Done',
    '',
  ].join('\n'))
})

test('a card the answer leaves out stays where the file has it', () => {
  // Design §9: an omission is not a deletion. A plugin that answered with
  // half a board must not be able to empty the file.
  const columns = columnsOf(MERGE_BOARD)
  const first = columns[0]
  assert.ok(first !== undefined)
  first.cards = []

  const merged = mergeBoard(MERGE_BOARD, columns, TODAY)
  assert.ok(merged !== null)
  assert.match(merged, /- Chase the printer firmware sign-off \^b40e17/)
  assert.match(merged, /- Book the rehearsal room \^c1d2e3/)
})

test('an answer that names nothing at all changes nothing', () => {
  assert.equal(mergeBoard(MERGE_BOARD, [], TODAY), MERGE_BOARD)
})

test('a line the parser does not understand keeps its place', () => {
  const merged = mergeBoard(MERGE_BOARD, columnsOf(MERGE_BOARD), TODAY)
  assert.ok(merged !== null)
  const lines = merged.split('\n')
  assert.equal(lines.indexOf('a line the parser does not understand'), 6)
})

test('a card that just ended is stamped with the day it ended', () => {
  const columns = columnsOf(MERGE_BOARD)
  const card = columns[1]?.cards[0]
  assert.ok(card !== undefined)
  card.ended = 'done'

  const merged = mergeBoard(MERGE_BOARD, columns, TODAY)
  assert.ok(merged !== null)
  assert.match(merged, /- Pair with Dana on the offline queue {2}done 2026-09-14 \^a3f9k2/)
})

test('a card that ended earlier keeps the day it ended, not today', () => {
  // The marker is the only clock ageing has, so rewriting it on every draw
  // would mean a finished card never got old enough to leave.
  const ended = '## Done\n- Ticked a week ago  done 2026-09-07 ^d4e5f6\n'
  assert.equal(mergeBoard(ended, columnsOf(ended), TODAY), ended)
})

test('a card whose words changed is written again, and its neighbours are not', () => {
  const columns = columnsOf(MERGE_BOARD)
  const card = columns[0]?.cards[0]
  assert.ok(card !== undefined)
  card.text = 'Chase the printer firmware sign-off again'

  const merged = mergeBoard(MERGE_BOARD, columns, TODAY)
  assert.ok(merged !== null)
  assert.match(merged, /- Chase the printer firmware sign-off again \^b40e17/)
  assert.match(merged, /- Book the rehearsal room \^c1d2e3/)
})

test('a column the answer never mentions is left alone', () => {
  const columns = columnsOf(MERGE_BOARD).filter((column) => column.name !== 'Doing')
  const merged = mergeBoard(MERGE_BOARD, columns, TODAY)
  assert.ok(merged !== null)
  assert.match(merged, /## Doing\n- Pair with Dana on the offline queue \^a3f9k2/)
})

test('a column the answer adds is written at the end', () => {
  const columns = columnsOf(MERGE_BOARD)
  columns.push({ name: 'Blocked', cards: [{ id: 'a1b2c3', text: 'Waiting on legal', ended: null }] })

  const merged = mergeBoard(MERGE_BOARD, columns, TODAY)
  assert.ok(merged !== null)
  assert.ok(merged.endsWith('## Blocked\n- Waiting on legal ^a1b2c3'), merged)
})

test('a card that has been archived leaves the board', () => {
  // The archive is append-only, so a card left on the board after its line
  // was written into `archive.md` is archived again on the next draw, and
  // again after that. `leaving` is what closes that loop.
  const columns = columnsOf(MERGE_BOARD)
  const first = columns[0]
  assert.ok(first !== undefined)
  first.cards = first.cards.filter((card) => card.id !== 'b40e17')

  const merged = mergeBoard(MERGE_BOARD, columns, TODAY, ['b40e17'])
  assert.ok(merged !== null)
  assert.doesNotMatch(merged, /\^b40e17/)
  assert.match(merged, /- Book the rehearsal room \^c1d2e3/)
})

test('a card leaving takes its line with it, and nothing fills the gap', () => {
  const ended = '## Done\n- One  done 2026-09-01 ^d4e5f6\n- Two  done 2026-09-02 ^a1b2c3\n'
  const columns = [{ name: 'Done', cards: [{ id: 'a1b2c3', text: 'Two', ended: /** @type {'done'} */ ('done') }] }]
  assert.equal(
    mergeBoard(ended, columns, TODAY, ['d4e5f6']),
    '## Done\n- Two  done 2026-09-02 ^a1b2c3\n',
  )
})

test('a card that leaves from between two blank lines does not leave a double blank', () => {
  // Taking the line out would otherwise push its neighbours together, and
  // two blank lines where there was one is the board slowly growing gaps
  // every time anything moves.
  const spaced = '## Doing\n\n- Call the vet ^a1b2c3\n\n## Done\n'
  const columns = [
    { name: 'Doing', cards: [] },
    { name: 'Done', cards: [{ id: 'a1b2c3', text: 'Call the vet', ended: null }] },
  ]
  assert.equal(mergeBoard(spaced, columns, TODAY), '## Doing\n\n## Done\n- Call the vet ^a1b2c3\n')
})

test('a blank line that is not doubled by a card leaving is left alone', () => {
  // The blank under a heading belongs to the column, not to the card that
  // happened to sit after it, so a column that still has cards keeps it.
  const spaced = '## Doing\n\n- One ^a1b2c3\n- Two ^b40e17\n\n## Done\n'
  const columns = [
    { name: 'Doing', cards: [{ id: 'b40e17', text: 'Two', ended: null }] },
    { name: 'Done', cards: [{ id: 'a1b2c3', text: 'One', ended: null }] },
  ]
  assert.equal(mergeBoard(spaced, columns, TODAY), '## Doing\n\n- Two ^b40e17\n\n## Done\n- One ^a1b2c3\n')
})

test('a card a drag placed below a column blank line is left where the drag put it', () => {
  // The other path that writes this file is a drop, and it puts a card into
  // an empty column after the column's blank rather than above it. The next
  // draw merges that file back, and if the merge had its own opinion about
  // where the card belongs, every drop into an empty column would be undone
  // and rewritten on the following draw. The merge places, it does not tidy.
  const dropped = '## Doing\n\n## Done\n\n- Call the vet ^a1b2c3\n\n## Later\n'
  const columns = [
    { name: 'Doing', cards: [] },
    { name: 'Done', cards: [{ id: 'a1b2c3', text: 'Call the vet', ended: null }] },
    { name: 'Later', cards: [] },
  ]
  assert.equal(mergeBoard(dropped, columns, TODAY), dropped)
})

test('an id leaving that the file never held changes nothing', () => {
  assert.equal(mergeBoard(MERGE_BOARD, columnsOf(MERGE_BOARD), TODAY, ['000aaa']), MERGE_BOARD)
})

test('a card both placed and leaving leaves, because its line is already archived', () => {
  // The app only names an id in `leaving` after it has written that line
  // into `archive.md`. Keeping it on the board would archive it twice; the
  // other wrong answer is a card drawn in a column for one more draw.
  const merged = mergeBoard(MERGE_BOARD, columnsOf(MERGE_BOARD), TODAY, ['b40e17'])
  assert.ok(merged !== null)
  assert.doesNotMatch(merged, /\^b40e17/)
})

test('a card leaving a column the answer never mentions still leaves', () => {
  const columns = columnsOf(MERGE_BOARD).filter((column) => column.name !== 'Doing')
  const merged = mergeBoard(MERGE_BOARD, columns, TODAY, ['a3f9k2'])
  assert.ok(merged !== null)
  assert.doesNotMatch(merged, /\^a3f9k2/)
  assert.match(merged, /## Doing/)
})

test('leaving nothing is the merge that was there before', () => {
  assert.equal(mergeBoard(MERGE_BOARD, columnsOf(MERGE_BOARD), TODAY, []), MERGE_BOARD)
})

test('a card placed in one column is not left behind in an unmentioned one', () => {
  // Naming a card in a column is not an omission of the column it came from,
  // so its old line vacates even when that column is not in the answer. The
  // alternative is one task on the board twice, under the same name.
  const columns = columnsOf(MERGE_BOARD).filter((column) => column.name === 'To do')
  const toDo = columns[0]
  assert.ok(toDo !== undefined)
  toDo.cards.push({ id: 'a3f9k2', text: 'Pair with Dana on the offline queue', ended: null })

  const merged = mergeBoard(MERGE_BOARD, columns, TODAY, [])
  assert.ok(merged !== null)
  assert.equal(merged.match(/\^a3f9k2/gu)?.length, 1)
  assert.match(merged, /## To do\n[\s\S]*\^a3f9k2/)
})

test('a board that is not there yet is merged onto the three default columns', () => {
  const merged = mergeBoard('', [{ name: 'To do', cards: [{ id: 'a1b2c3', text: 'First ever', ended: null }] }], TODAY)
  assert.equal(merged, '# Board\n\n## To do\n- First ever ^a1b2c3\n\n## Doing\n\n## Done\n')
})

test('a board nobody could read is merged to nothing, so the file is left alone', () => {
  assert.equal(mergeBoard('# Board\n- Stray ^a1b2c3\n\n## To do\n', [], TODAY), null)
})
